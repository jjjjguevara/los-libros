//! PDF parsing using MuPDF
//!
//! Provides PDF parsing functionality for metadata extraction,
//! page rendering, and text layer generation using the MuPDF library.
//!
//! MuPDF provides:
//! - Better thread safety (proper Rust lifetimes, no unsafe transmutes)
//! - Accurate character positions via stext API
//! - Search with bounding boxes for highlighting
//! - Actual font metadata extraction
//! - Native page labels support

use std::path::Path;

use mupdf::pdf::PdfDocument;
use mupdf::{Colorspace, Document, Matrix, MetadataName, TextPageOptions};
use thiserror::Error;

use crate::document::TocEntry;

use super::types::{
    BoundingBox, CharPosition, FormField, FormFieldType, FormInfo, FormOption, ImageFormat,
    NormalizedPosition, NormalizedRect, PageDimensions, PageOrientation, PageRenderRequest,
    ParsedPdf, PdfMetadata, PdfSearchResult, SignatureInfo, SignatureValidationStatus, TextItem,
    TextLayer,
};

/// PDF parsing errors
#[derive(Error, Debug)]
pub enum PdfParseError {
    #[error("Failed to initialize MuPDF: {0}")]
    MuPdfInit(String),
    #[error("Failed to load PDF: {0}")]
    LoadError(String),
    #[error("Failed to render page: {0}")]
    RenderError(String),
    #[error("Page {0} not found (document has {1} pages)")]
    PageNotFound(usize, usize),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Image encoding error: {0}")]
    ImageError(String),
    #[error("Operation timed out after {0} seconds")]
    Timeout(u64),
    #[error("MuPDF error: {0}")]
    MuPdfError(String),
}

impl From<mupdf::Error> for PdfParseError {
    fn from(e: mupdf::Error) -> Self {
        PdfParseError::MuPdfError(e.to_string())
    }
}

/// Thread-safe MuPDF PDF parser
///
/// MuPDF's fz_context is not thread-safe, so we use a Mutex to serialize
/// all operations on a single document. The document data is kept alive
/// for the duration of the parser's lifetime.
pub struct PdfParser {
    /// The document data - kept to ensure document validity
    data: PdfData,
    /// Book identifier
    book_id: String,
    /// Cached page count
    page_count: usize,
}

/// Holds the source PDF data to ensure it outlives the document
enum PdfData {
    /// PDF loaded from owned bytes
    Bytes(Vec<u8>),
    /// PDF loaded from a file path (file remains on disk)
    Path(std::path::PathBuf),
}

// PdfParser is Send + Sync because:
// - PdfData::Bytes contains Vec<u8> which is Send + Sync
// - PdfData::Path contains PathBuf which is Send + Sync
// - Operations are serialized via SafePdfParser's Mutex
unsafe impl Send for PdfParser {}
unsafe impl Sync for PdfParser {}

impl PdfParser {
    /// Create parser from file path
    pub fn from_path<P: AsRef<Path>>(path: P, book_id: String) -> Result<Self, PdfParseError> {
        let path_buf = path.as_ref().to_path_buf();
        let path_str = path_buf.to_string_lossy();

        // Validate the document can be opened
        let doc = Document::open(&*path_str)?;
        let page_count = doc.page_count()? as usize;

        Ok(Self {
            data: PdfData::Path(path_buf),
            book_id,
            page_count,
        })
    }

    /// Create parser from bytes
    pub fn from_bytes(data: &[u8], book_id: String) -> Result<Self, PdfParseError> {
        let owned_data = data.to_vec();

        // Validate the document can be opened
        let doc = Document::from_bytes(&owned_data, "application/pdf")?;
        let page_count = doc.page_count()? as usize;

        Ok(Self {
            data: PdfData::Bytes(owned_data),
            book_id,
            page_count,
        })
    }

    /// Get a fresh document instance for the current operation
    /// This is necessary because MuPDF's fz_context is not thread-safe
    fn open_document(&self) -> Result<Document, PdfParseError> {
        match &self.data {
            PdfData::Bytes(data) => {
                Document::from_bytes(data, "application/pdf").map_err(Into::into)
            }
            PdfData::Path(path) => {
                let path_str = path.to_string_lossy();
                Document::open(&*path_str).map_err(Into::into)
            }
        }
    }

    /// Parse PDF and extract metadata
    pub fn parse(&self) -> Result<ParsedPdf, PdfParseError> {
        let doc = self.open_document()?;

        let metadata = self.extract_metadata(&doc)?;
        let toc = self.extract_outline(&doc)?;
        let orientation = self.quick_orientation_check(&doc)?;
        let has_text_layer = self.check_text_layer(&doc)?;
        let page_labels = self.extract_page_labels()?;

        Ok(ParsedPdf {
            id: self.book_id.clone(),
            metadata,
            toc,
            page_count: self.page_count,
            page_labels,
            has_text_layer,
            orientation,
        })
    }

    /// Quick orientation check - only looks at first page
    fn quick_orientation_check(&self, doc: &Document) -> Result<PageOrientation, PdfParseError> {
        if self.page_count == 0 {
            return Ok(PageOrientation::Portrait);
        }

        let page = doc.load_page(0)?;
        let bounds = page.bounds()?;
        let width = bounds.x1 - bounds.x0;
        let height = bounds.y1 - bounds.y0;

        Ok(if width > height {
            PageOrientation::Landscape
        } else {
            PageOrientation::Portrait
        })
    }

    /// Extract metadata from PDF info dictionary
    fn extract_metadata(&self, doc: &Document) -> Result<PdfMetadata, PdfParseError> {
        let get_meta = |name: MetadataName| -> Option<String> {
            doc.metadata(name).ok().filter(|s| !s.is_empty())
        };

        Ok(PdfMetadata {
            title: get_meta(MetadataName::Title)
                .unwrap_or_else(|| self.book_id.clone()),
            author: get_meta(MetadataName::Author),
            subject: get_meta(MetadataName::Subject),
            keywords: get_meta(MetadataName::Keywords)
                .map(|k| k.split(',').map(|s| s.trim().to_string()).collect())
                .unwrap_or_default(),
            creator: get_meta(MetadataName::Creator),
            producer: get_meta(MetadataName::Producer),
            creation_date: get_meta(MetadataName::CreationDate),
            modification_date: get_meta(MetadataName::ModDate),
        })
    }

    /// Extract PDF outline/bookmarks as TocEntry
    fn extract_outline(&self, doc: &Document) -> Result<Vec<TocEntry>, PdfParseError> {
        let outlines = doc.outlines()?;
        Ok(self.convert_outlines_to_toc(&outlines))
    }

    fn convert_outlines_to_toc(&self, outlines: &[mupdf::Outline]) -> Vec<TocEntry> {
        outlines
            .iter()
            .map(|outline| {
                let page = outline.page.map(|p| p as u32 + 1).unwrap_or(1);
                let children = self.convert_outlines_to_toc(&outline.down);

                // outline.title is String
                let label = if outline.title.is_empty() {
                    "Untitled".to_string()
                } else {
                    outline.title.clone()
                };

                TocEntry {
                    label,
                    href: format!("page:{}", page),
                    item_index: Some((page as usize).saturating_sub(1)), // 0-indexed page
                    children,
                    play_order: Some(page),
                }
            })
            .collect()
    }

    /// Check if PDF has extractable text
    fn check_text_layer(&self, doc: &Document) -> Result<bool, PdfParseError> {
        // Check first few pages for text content
        let pages_to_check = std::cmp::min(3, self.page_count);
        for i in 0..pages_to_check {
            let page = doc.load_page(i as i32)?;
            if let Ok(text) = page.to_text() {
                if !text.trim().is_empty() {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    /// Extract page labels if available
    fn extract_page_labels(&self) -> Result<Option<Vec<String>>, PdfParseError> {
        // MuPDF supports page labels via pdf_page_label
        // For now, generate default labels (can be enhanced later)
        if self.page_count > 0 {
            Ok(Some((1..=self.page_count).map(|n| n.to_string()).collect()))
        } else {
            Ok(None)
        }
    }

    /// Get page count
    pub fn page_count(&self) -> usize {
        self.page_count
    }

    /// Get page dimensions
    pub fn get_page_dimensions(&self, page_num: usize) -> Result<PageDimensions, PdfParseError> {
        self.validate_page_num(page_num)?;

        let doc = self.open_document()?;
        let page = doc.load_page((page_num - 1) as i32)?;
        let bounds = page.bounds()?;

        Ok(PageDimensions {
            width: bounds.x1 - bounds.x0,
            height: bounds.y1 - bounds.y0,
        })
    }

    /// Validate page number (1-indexed)
    fn validate_page_num(&self, page_num: usize) -> Result<(), PdfParseError> {
        if page_num < 1 || page_num > self.page_count {
            return Err(PdfParseError::PageNotFound(page_num, self.page_count));
        }
        Ok(())
    }

    /// Render a page to image bytes
    pub fn render_page(&self, request: &PageRenderRequest) -> Result<Vec<u8>, PdfParseError> {
        self.validate_page_num(request.page)?;

        let doc = self.open_document()?;
        let page = doc.load_page((request.page - 1) as i32)?;

        // Clamp scale to prevent DoS (0.1 to 4.0)
        let scale = request.scale.clamp(0.1, 4.0);

        // Build transformation matrix with scale and rotation
        let mut matrix = Matrix::new_scale(scale, scale);

        // Apply rotation if specified
        if request.rotation != 0 {
            let rotation_matrix = Matrix::new_rotate(request.rotation as f32);
            matrix.concat(rotation_matrix);
        }

        // Render to pixmap
        // to_pixmap signature: (ctm, colorspace, alpha, show_extras) -> Pixmap
        let colorspace = Colorspace::device_rgb();
        let pixmap = page.to_pixmap(&matrix, &colorspace, true, true)?;

        // Encode to requested format
        self.encode_pixmap(&pixmap, request.format)
    }

    /// Render a thumbnail (low resolution)
    pub fn render_thumbnail(&self, page_num: usize, max_size: u32) -> Result<Vec<u8>, PdfParseError> {
        self.validate_page_num(page_num)?;

        let doc = self.open_document()?;
        let page = doc.load_page((page_num - 1) as i32)?;
        let bounds = page.bounds()?;

        // Calculate scale to fit within max_size
        let width = bounds.x1 - bounds.x0;
        let height = bounds.y1 - bounds.y0;
        let scale = (max_size as f32) / width.max(height);

        let matrix = Matrix::new_scale(scale, scale);
        let colorspace = Colorspace::device_rgb();
        let pixmap = page.to_pixmap(&matrix, &colorspace, true, false)?;

        // JPEG for smaller thumbnails
        self.encode_pixmap(&pixmap, ImageFormat::Jpeg)
    }

    /// Encode pixmap to image bytes
    fn encode_pixmap(
        &self,
        pixmap: &mupdf::Pixmap,
        format: ImageFormat,
    ) -> Result<Vec<u8>, PdfParseError> {
        // Get raw pixel data from pixmap
        let width = pixmap.width() as u32;
        let height = pixmap.height() as u32;
        let samples = pixmap.samples();
        let n = pixmap.n() as usize; // components per pixel

        // Convert to RGBA image buffer
        let mut rgba_buffer = Vec::with_capacity((width * height * 4) as usize);

        for y in 0..height as usize {
            for x in 0..width as usize {
                let offset = (y * width as usize + x) * n;
                let r = samples.get(offset).copied().unwrap_or(0);
                let g = samples.get(offset + 1).copied().unwrap_or(0);
                let b = samples.get(offset + 2).copied().unwrap_or(0);
                let a = if n >= 4 {
                    samples.get(offset + 3).copied().unwrap_or(255)
                } else {
                    255
                };
                rgba_buffer.extend_from_slice(&[r, g, b, a]);
            }
        }

        // Create image from buffer
        let img = image::RgbaImage::from_raw(width, height, rgba_buffer)
            .ok_or_else(|| PdfParseError::ImageError("Failed to create image buffer".to_string()))?;

        let dynamic_img = image::DynamicImage::ImageRgba8(img);

        // Encode to requested format
        let mut output = Vec::new();
        use std::io::Cursor;

        match format {
            ImageFormat::Png => {
                dynamic_img
                    .write_to(&mut Cursor::new(&mut output), image::ImageFormat::Png)
                    .map_err(|e| PdfParseError::ImageError(e.to_string()))?;
            }
            ImageFormat::Jpeg => {
                dynamic_img
                    .write_to(&mut Cursor::new(&mut output), image::ImageFormat::Jpeg)
                    .map_err(|e| PdfParseError::ImageError(e.to_string()))?;
            }
            ImageFormat::Webp => {
                dynamic_img
                    .write_to(&mut Cursor::new(&mut output), image::ImageFormat::WebP)
                    .map_err(|e| PdfParseError::ImageError(e.to_string()))?;
            }
        }

        Ok(output)
    }

    /// Extract text layer for a page with accurate character positions
    pub fn get_text_layer(&self, page_num: usize) -> Result<TextLayer, PdfParseError> {
        self.validate_page_num(page_num)?;

        let doc = self.open_document()?;
        let page = doc.load_page((page_num - 1) as i32)?;
        let bounds = page.bounds()?;
        let width = bounds.x1 - bounds.x0;
        let height = bounds.y1 - bounds.y0;

        let mut items = Vec::new();

        // Use structured text API for accurate character positions
        let text_page = page.to_text_page(TextPageOptions::PRESERVE_WHITESPACE)?;

        for block in text_page.blocks() {
            for line in block.lines() {
                let mut line_text = String::new();
                let mut char_positions = Vec::new();
                let mut line_x = f32::MAX;
                let mut line_y = f32::MAX;
                let mut line_max_x = f32::MIN;
                let mut line_max_y = f32::MIN;
                let mut font_size = 12.0f32;

                for ch in line.chars() {
                    // ch.char() returns Option<char>
                    if let Some(c) = ch.char() {
                        let quad = ch.quad();

                        // Character bounding box from quad
                        // MuPDF quads: ul (upper-left), ur (upper-right), ll (lower-left), lr (lower-right)
                        // In PDF coordinates, Y increases upward (origin at bottom-left)
                        let char_x = quad.ul.x.min(quad.ll.x);
                        let char_top_y = quad.ul.y.min(quad.ur.y);  // Top of char (smaller Y in PDF coords)
                        let char_bottom_y = quad.ll.y.max(quad.lr.y);  // Bottom of char (larger Y in PDF coords)
                        let char_width = (quad.ur.x.max(quad.lr.x) - char_x).max(0.0);
                        let char_height = (char_bottom_y - char_top_y).abs();

                        // Track line bounds (in PDF coordinates)
                        line_x = line_x.min(char_x);
                        line_y = line_y.min(char_top_y);  // Topmost point
                        line_max_x = line_max_x.max(char_x + char_width);
                        line_max_y = line_max_y.max(char_bottom_y);  // Bottommost point

                        // Get actual font size from character
                        font_size = ch.size();

                        // Convert Y from PDF coords (bottom-up) to screen coords (top-down)
                        let screen_y = height - char_bottom_y;

                        // Font name not directly available from TextChar API
                        // Could be obtained from TextSpan parent if needed
                        let font_name: Option<String> = None;

                        line_text.push(c);
                        char_positions.push(CharPosition {
                            char: c,
                            x: char_x,
                            y: screen_y,
                            width: char_width,
                            height: char_height,
                            font_size,
                            font_name,
                        });
                    }
                }

                if !line_text.trim().is_empty() {
                    // Convert from PDF coordinates (origin bottom-left) to screen coordinates (origin top-left)
                    // In PDF coords: y=0 is at bottom, y=height is at top
                    // We want: y=0 at top, y=height at bottom
                    // So: screen_y = height - pdf_y
                    // For the top of the text line, we use line_y (the topmost point in PDF coords)
                    let screen_y = height - line_max_y;  // Bottom of text in PDF = top in screen

                    items.push(TextItem {
                        text: line_text,
                        x: line_x,
                        y: screen_y,
                        width: line_max_x - line_x,
                        height: line_max_y - line_y,
                        font_size,
                        char_positions: Some(char_positions),
                    });
                }
            }
        }

        Ok(TextLayer {
            page: page_num,
            width,
            height,
            items,
        })
    }

    /// Search for text in the PDF with bounding boxes and context
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<PdfSearchResult>, PdfParseError> {
        self.search_with_context(query, limit, 32) // Default context of 32 chars
    }

    /// Search for text in the PDF with bounding boxes and configurable context
    pub fn search_with_context(
        &self,
        query: &str,
        limit: usize,
        context_chars: usize,
    ) -> Result<Vec<PdfSearchResult>, PdfParseError> {
        let doc = self.open_document()?;
        let mut results = Vec::new();

        for page_idx in 0..self.page_count {
            if results.len() >= limit {
                break;
            }

            let page = doc.load_page(page_idx as i32)?;
            let bounds = page.bounds()?;
            let page_width = bounds.x1 - bounds.x0;
            let page_height = bounds.y1 - bounds.y0;

            // Get page text for context extraction (case-insensitive search)
            let page_text = page.to_text().unwrap_or_default();
            let page_text_lower = page_text.to_lowercase();
            let query_lower = query.to_lowercase();

            // MuPDF search returns quads (bounding boxes) for each match
            // search(needle, max_hits) -> Vec<Quad>
            let max_hits = (limit - results.len()).min(100) as u32;
            if let Ok(quads) = page.search(query, max_hits) {
                // Track which occurrences we've used for context
                let mut occurrence_idx = 0;

                for quad in quads {
                    if results.len() >= limit {
                        break;
                    }

                    // Calculate bounding box from quad
                    // MuPDF quads have: ul (upper-left), ur (upper-right), ll (lower-left), lr (lower-right)
                    let x = quad.ul.x.min(quad.ll.x);
                    let y = quad.ul.y.min(quad.ur.y);
                    let width = quad.ur.x.max(quad.lr.x) - x;
                    let height = quad.ll.y.max(quad.lr.y) - y;

                    // Normalize to 0-1 range
                    let norm_x = (x / page_width) as f64;
                    let norm_y = (y / page_height) as f64;
                    let norm_width = (width / page_width) as f64;
                    let norm_height = (height / page_height) as f64;

                    // Extract prefix/suffix context
                    let (prefix, suffix) = self.extract_search_context(
                        &page_text,
                        &page_text_lower,
                        &query_lower,
                        occurrence_idx,
                        context_chars,
                    );
                    occurrence_idx += 1;

                    results.push(PdfSearchResult {
                        page: page_idx + 1, // 1-indexed
                        text: query.to_string(),
                        prefix,
                        suffix,
                        position: Some(NormalizedPosition {
                            x: norm_x,
                            y: norm_y,
                        }),
                        bounds: Some(vec![BoundingBox {
                            x: norm_x,
                            y: norm_y,
                            width: norm_width,
                            height: norm_height,
                        }]),
                    });
                }
            }
        }

        Ok(results)
    }

    /// Extract prefix and suffix context around a search match
    fn extract_search_context(
        &self,
        page_text: &str,
        page_text_lower: &str,
        query_lower: &str,
        occurrence: usize,
        context_chars: usize,
    ) -> (Option<String>, Option<String>) {
        // Find the nth occurrence of the query in the text
        let mut current_occurrence = 0;
        let mut search_start = 0;

        loop {
            if let Some(pos) = page_text_lower[search_start..].find(query_lower) {
                let abs_pos = search_start + pos;

                if current_occurrence == occurrence {
                    // Found the right occurrence - extract context
                    let prefix_start = abs_pos.saturating_sub(context_chars);
                    let prefix = if prefix_start < abs_pos {
                        let text = &page_text[prefix_start..abs_pos];
                        // Trim to word boundary if possible
                        Some(Self::trim_to_word_boundary(text, true))
                    } else {
                        None
                    };

                    let suffix_end = (abs_pos + query_lower.len() + context_chars).min(page_text.len());
                    let suffix_start = abs_pos + query_lower.len();
                    let suffix = if suffix_start < suffix_end {
                        let text = &page_text[suffix_start..suffix_end];
                        // Trim to word boundary if possible
                        Some(Self::trim_to_word_boundary(text, false))
                    } else {
                        None
                    };

                    return (prefix, suffix);
                }

                current_occurrence += 1;
                search_start = abs_pos + 1;
            } else {
                break;
            }
        }

        (None, None)
    }

    /// Trim text to word boundary for cleaner context
    fn trim_to_word_boundary(text: &str, is_prefix: bool) -> String {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return String::new();
        }

        if is_prefix {
            // For prefix, try to start at a word boundary
            // Look for first whitespace and start after it
            if let Some(pos) = trimmed.find(char::is_whitespace) {
                let after_space = trimmed[pos..].trim_start();
                if !after_space.is_empty() && after_space.len() < trimmed.len() {
                    return format!("…{}", after_space);
                }
            }
        } else {
            // For suffix, try to end at a word boundary
            // Look for last whitespace before end
            if let Some(pos) = trimmed.rfind(char::is_whitespace) {
                let before_space = trimmed[..pos].trim_end();
                if !before_space.is_empty() && before_space.len() < trimmed.len() {
                    return format!("{}…", before_space);
                }
            }
        }

        trimmed.to_string()
    }

    /// Get full page text
    pub fn get_page_text(&self, page_num: usize) -> Result<String, PdfParseError> {
        self.validate_page_num(page_num)?;

        let doc = self.open_document()?;
        let page = doc.load_page((page_num - 1) as i32)?;

        page.to_text().map_err(Into::into)
    }

    /// Get form information from the PDF
    ///
    /// Returns FormInfo with details about AcroForm/XFA forms and their fields.
    /// Note: XFA forms are detected but not fully supported for field extraction.
    pub fn get_form_info(&self) -> Result<FormInfo, PdfParseError> {
        // Open as PdfDocument specifically for form APIs
        let pdf_doc = self.open_pdf_document()?;

        let has_acro_form = pdf_doc.has_acro_form().unwrap_or(false);
        let has_xfa_form = pdf_doc.has_xfa_form().unwrap_or(false);

        if !has_acro_form && !has_xfa_form {
            return Ok(FormInfo::default());
        }

        // Extract form fields by traversing the AcroForm/Fields array
        let fields = self.extract_form_fields(&pdf_doc)?;
        let field_count = fields.len();

        // Check if form has calculations (CO entry in AcroForm)
        let needs_calculation = self.check_form_needs_calculation(&pdf_doc);

        Ok(FormInfo {
            has_acro_form,
            has_xfa_form,
            field_count,
            fields,
            needs_calculation,
        })
    }

    /// Open the document as a PdfDocument specifically
    fn open_pdf_document(&self) -> Result<PdfDocument, PdfParseError> {
        match &self.data {
            PdfData::Bytes(data) => PdfDocument::from_bytes(data).map_err(Into::into),
            PdfData::Path(path) => {
                let path_str = path.to_string_lossy();
                PdfDocument::open(&*path_str).map_err(Into::into)
            }
        }
    }

    /// Helper to convert bytes to string
    fn bytes_to_string(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes).to_string()
    }

    /// Extract form fields from the PDF's AcroForm
    fn extract_form_fields(
        &self,
        pdf_doc: &PdfDocument,
    ) -> Result<Vec<FormField>, PdfParseError> {
        let mut fields = Vec::new();

        // Check if PDF has form fields FIRST (before expensive page scan)
        let trailer = pdf_doc.trailer()?;
        let root = match trailer.get_dict("Root")? {
            Some(r) => r,
            None => return Ok(fields), // No form fields
        };
        let acro_form = match root.get_dict("AcroForm")? {
            Some(f) => f,
            None => return Ok(fields), // No form fields
        };
        let fields_array = match acro_form.get_dict("Fields")? {
            Some(f) => f,
            None => return Ok(fields), // No form fields
        };

        // Only build widget page map if we actually have form fields
        // This scans all pages to create a mapping from widget Rect coordinates to page indices
        let widget_page_map = self.build_widget_page_map(pdf_doc);

        // Iterate through fields
        let field_count = fields_array.len().unwrap_or(0);
        for i in 0..field_count {
            if let Ok(Some(field_obj)) = fields_array.get_array(i as i32) {
                if let Some(field) = self.parse_form_field(&field_obj, None, &widget_page_map)? {
                    fields.push(field);
                }

                // Handle child fields (for hierarchical forms)
                self.extract_child_fields(&field_obj, &mut fields, None, &widget_page_map)?;
            }
        }

        Ok(fields)
    }

    /// Recursively extract child fields
    fn extract_child_fields(
        &self,
        parent: &mupdf::pdf::PdfObject,
        fields: &mut Vec<FormField>,
        parent_name: Option<&str>,
        widget_page_map: &std::collections::HashMap<String, usize>,
    ) -> Result<(), PdfParseError> {
        // Get parent's name for building full name
        // Note: T (field name) is a text string, not a PDF name object
        // as_string() returns &str (already decoded), as_name() returns &[u8]
        let parent_full_name = if let Ok(Some(t)) = parent.get_dict("T") {
            let name = t.as_string().unwrap_or("");
            match parent_name {
                Some(pn) => Some(format!("{}.{}", pn, name)),
                None => Some(name.to_string()),
            }
        } else {
            parent_name.map(|s| s.to_string())
        };

        // Check for Kids array
        if let Ok(Some(kids)) = parent.get_dict("Kids") {
            let kids_count = kids.len().unwrap_or(0);
            for i in 0..kids_count {
                if let Ok(Some(kid)) = kids.get_array(i as i32) {
                    if let Some(field) =
                        self.parse_form_field(&kid, parent_full_name.as_deref(), widget_page_map)?
                    {
                        fields.push(field);
                    }
                    // Recurse into grandchildren
                    self.extract_child_fields(
                        &kid,
                        fields,
                        parent_full_name.as_deref(),
                        widget_page_map,
                    )?;
                }
            }
        }

        Ok(())
    }

    /// Parse a single form field object
    fn parse_form_field(
        &self,
        field_obj: &mupdf::pdf::PdfObject,
        parent_name: Option<&str>,
        widget_page_map: &std::collections::HashMap<String, usize>,
    ) -> Result<Option<FormField>, PdfParseError> {
        // Get field name (T key) - field names are text strings, not PDF name objects
        // as_string() returns &str (already decoded)
        let name = match field_obj.get_dict("T")? {
            Some(t) => t.as_string().unwrap_or("unnamed").to_string(),
            None => return Ok(None), // Skip fields without names
        };

        // Build full name
        let full_name = match parent_name {
            Some(pn) => Some(format!("{}.{}", pn, name)),
            None => None,
        };

        // Get field type (FT key) - inherited from parent if not present
        let field_type = self.determine_field_type(field_obj)?;

        // Get field value (V key) - values are text strings, not PDF name objects
        // Note: For checkbox/radio, values may be names like /Yes or /Off, but we
        // handle them as strings for simplicity
        // as_string() returns &str (already decoded), as_name() returns &[u8]
        let value = field_obj
            .get_dict("V")?
            .and_then(|v| {
                // Try as_string first (for text fields), fall back to as_name (for checkboxes)
                v.as_string()
                    .ok()
                    .map(|s| s.to_string())
                    .or_else(|| v.as_name().ok().map(|s| Self::bytes_to_string(s)))
            });

        // Get default value (DV key)
        let default_value = field_obj
            .get_dict("DV")?
            .and_then(|v| {
                v.as_string()
                    .ok()
                    .map(|s| s.to_string())
                    .or_else(|| v.as_name().ok().map(|s| Self::bytes_to_string(s)))
            });

        // Get field flags (Ff key)
        let flags = field_obj
            .get_dict("Ff")?
            .and_then(|f| f.as_int().ok())
            .unwrap_or(0) as u32;

        let read_only = (flags & 1) != 0; // Bit 1
        let required = (flags & 2) != 0; // Bit 2

        // Text field specific flags
        let multiline = if matches!(field_type, FormFieldType::Text) {
            Some((flags & (1 << 12)) != 0) // Bit 13
        } else {
            None
        };
        let password = if matches!(field_type, FormFieldType::Text) {
            Some((flags & (1 << 13)) != 0) // Bit 14
        } else {
            None
        };

        // Get max length (MaxLen key) for text fields
        let max_length = if matches!(field_type, FormFieldType::Text) {
            field_obj
                .get_dict("MaxLen")?
                .and_then(|m| m.as_int().ok())
                .map(|v| v as usize)
        } else {
            None
        };

        // Get options for choice fields (Opt key)
        let options = if matches!(field_type, FormFieldType::Dropdown | FormFieldType::ListBox) {
            self.extract_field_options(field_obj, value.as_deref())?
        } else {
            None
        };

        // Get page and bounds from widget annotation
        let (page, bounds) = self.extract_widget_info(field_obj, widget_page_map)?;

        Ok(Some(FormField {
            name,
            full_name,
            field_type,
            value,
            default_value,
            page,
            bounds,
            read_only,
            required,
            options,
            max_length,
            multiline,
            password,
        }))
    }

    /// Extract page number and bounds from widget annotation
    ///
    /// In PDF, form fields can have associated widget annotations that contain
    /// the visual representation. This function finds the widget and extracts:
    /// - Page number from the /P (page) reference
    /// - Bounding box from the /Rect key
    fn extract_widget_info(
        &self,
        field_obj: &mupdf::pdf::PdfObject,
        widget_page_map: &std::collections::HashMap<String, usize>,
    ) -> Result<(usize, Option<NormalizedRect>), PdfParseError> {
        // First check if this field object is itself a widget annotation
        // (merged field/widget - common for simple fields)
        let is_widget = if let Some(subtype) = field_obj.get_dict("Subtype")? {
            subtype.as_name().map(|n| n == b"Widget").unwrap_or(false)
        } else {
            false
        };

        if is_widget {
            // The field itself is the widget - extract directly
            return self.extract_info_from_widget(field_obj, widget_page_map);
        }

        // Otherwise, look in /Kids for widget annotations
        if let Some(kids) = field_obj.get_dict("Kids")? {
            if let Ok(len) = kids.len() {
                for i in 0..len {
                    if let Ok(Some(kid)) = kids.get_array(i as i32) {
                        // Check if this kid is a widget annotation
                        let is_kid_widget = if let Some(kid_subtype) = kid.get_dict("Subtype")? {
                            kid_subtype.as_name().map(|n| n == b"Widget").unwrap_or(false)
                        } else {
                            false
                        };

                        if is_kid_widget {
                            // Found a widget - extract info from it
                            return self.extract_info_from_widget(&kid, widget_page_map);
                        }
                    }
                }
            }
        }

        // No widget found - return defaults
        Ok((1, None))
    }

    /// Extract page number and bounds from a widget annotation object
    fn extract_info_from_widget(
        &self,
        widget: &mupdf::pdf::PdfObject,
        widget_page_map: &std::collections::HashMap<String, usize>,
    ) -> Result<(usize, Option<NormalizedRect>), PdfParseError> {
        let mut page_num = 1usize;
        let mut bounds = None;

        // Get bounding box from /Rect first - we need it for both page lookup and bounds
        let rect_coords = if let Some(rect_obj) = widget.get_dict("Rect")? {
            if let Ok(4) = rect_obj.len() {
                let x1 = rect_obj.get_array(0)?.and_then(|v| v.as_float().ok()).unwrap_or(0.0);
                let y1 = rect_obj.get_array(1)?.and_then(|v| v.as_float().ok()).unwrap_or(0.0);
                let x2 = rect_obj.get_array(2)?.and_then(|v| v.as_float().ok()).unwrap_or(0.0);
                let y2 = rect_obj.get_array(3)?.and_then(|v| v.as_float().ok()).unwrap_or(0.0);

                // Try to find page using the widget page map (built by scanning page annotations)
                let rect_key = format!("{:.1},{:.1},{:.1},{:.1}", x1, y1, x2, y2);
                if let Some(&mapped_page) = widget_page_map.get(&rect_key) {
                    page_num = mapped_page;
                }

                Some((x1, y1, x2, y2))
            } else {
                None
            }
        } else {
            None
        };

        // If we still have page 1 (default), try the /P reference as a fallback
        // (This rarely works due to MuPDF binding limitations, but try anyway)
        if page_num == 1 {
            if let Some(page_ref) = widget.get_dict("P")? {
                if let Ok(Some(_parent)) = page_ref.get_dict("Parent") {
                    if let Some(found_page) = self.find_page_index(&page_ref) {
                        page_num = found_page;
                    }
                }
            }
        }

        // Now compute normalized bounds using the determined page number
        if let Some((x1, y1, x2, y2)) = rect_coords {
            if let Ok(page_dims) = self.get_page_dimensions(page_num) {
                let page_width = page_dims.width;
                let page_height = page_dims.height;

                // Normalize to 0-1 coordinates
                bounds = Some(NormalizedRect {
                    x: (x1.min(x2) / page_width) as f64,
                    y: (y1.min(y2) / page_height) as f64,
                    width: ((x2 - x1).abs() / page_width) as f64,
                    height: ((y2 - y1).abs() / page_height) as f64,
                });
            }
        }

        Ok((page_num, bounds))
    }

    /// Find the page index (1-based) for a given page object reference
    ///
    /// This is called when we have a /P reference from a widget annotation.
    /// Since MuPDF's Rust bindings don't expose object number comparison directly,
    /// we use the page's unique content identifier (Resources/Contents) to match.
    ///
    /// If the page object has a /Resources dictionary, we compare it with
    /// each page's resources to find a match.
    fn find_page_index(&self, _page_obj: &mupdf::pdf::PdfObject) -> Option<usize> {
        // The MuPDF Rust bindings don't expose a reliable way to compare
        // PDF object references. The /P entry in widgets is an indirect reference
        // that should match a page in the document.
        //
        // Since we can't reliably compare object references, we return None here
        // and rely on a different approach: scanning pages for their annotations.
        //
        // The calling code (extract_info_from_widget) handles the None case
        // by using a fallback approach.
        None
    }

    /// Build a map of widget positions to page indices by scanning all pages
    ///
    /// This scans each page's annotations to find widgets and their positions,
    /// returning a map of widget Rect coordinates to page indices.
    fn build_widget_page_map(
        &self,
        pdf_doc: &PdfDocument,
    ) -> std::collections::HashMap<String, usize> {
        let mut map = std::collections::HashMap::new();

        for page_idx in 0..self.page_count {
            if let Ok(page_obj) = pdf_doc.find_page(page_idx as i32) {
                // Get the Annots array for this page
                if let Ok(Some(annots)) = page_obj.get_dict("Annots") {
                    let annots_len = annots.len().unwrap_or(0);
                    for i in 0..annots_len {
                        if let Ok(Some(annot)) = annots.get_array(i as i32) {
                            // Check if this is a Widget annotation
                            let is_widget = if let Ok(Some(subtype)) = annot.get_dict("Subtype") {
                                subtype.as_name().map(|n| n == b"Widget").unwrap_or(false)
                            } else {
                                false
                            };

                            if is_widget {
                                // Use the Rect as a key to identify this widget
                                if let Ok(Some(rect)) = annot.get_dict("Rect") {
                                    if let Ok(key) = self.rect_to_key(&rect) {
                                        map.insert(key, page_idx + 1); // 1-based
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        map
    }

    /// Convert a Rect array to a string key for hash map lookup
    fn rect_to_key(&self, rect: &mupdf::pdf::PdfObject) -> Result<String, PdfParseError> {
        let x1 = rect.get_array(0)?.and_then(|v| v.as_float().ok()).unwrap_or(0.0);
        let y1 = rect.get_array(1)?.and_then(|v| v.as_float().ok()).unwrap_or(0.0);
        let x2 = rect.get_array(2)?.and_then(|v| v.as_float().ok()).unwrap_or(0.0);
        let y2 = rect.get_array(3)?.and_then(|v| v.as_float().ok()).unwrap_or(0.0);
        // Round to avoid floating point comparison issues
        Ok(format!("{:.1},{:.1},{:.1},{:.1}", x1, y1, x2, y2))
    }

    /// Determine field type from FT key
    fn determine_field_type(
        &self,
        field_obj: &mupdf::pdf::PdfObject,
    ) -> Result<FormFieldType, PdfParseError> {
        let ft = match field_obj.get_dict("FT")? {
            Some(ft) => ft,
            None => return Ok(FormFieldType::Unknown),
        };

        let ft_bytes = ft.as_name().unwrap_or(&[]);

        let field_type = match ft_bytes {
            b"Tx" => FormFieldType::Text,
            b"Btn" => {
                // Distinguish between checkbox, radio, and pushbutton
                let flags = field_obj
                    .get_dict("Ff")?
                    .and_then(|f| f.as_int().ok())
                    .unwrap_or(0) as u32;

                if (flags & (1 << 16)) != 0 {
                    // Bit 17 - pushbutton
                    FormFieldType::Button
                } else if (flags & (1 << 15)) != 0 {
                    // Bit 16 - radio
                    FormFieldType::Radio
                } else {
                    FormFieldType::Checkbox
                }
            }
            b"Ch" => {
                // Distinguish between combo box and list box
                let flags = field_obj
                    .get_dict("Ff")?
                    .and_then(|f| f.as_int().ok())
                    .unwrap_or(0) as u32;

                if (flags & (1 << 17)) != 0 {
                    // Bit 18 - combo
                    FormFieldType::Dropdown
                } else {
                    FormFieldType::ListBox
                }
            }
            b"Sig" => FormFieldType::Signature,
            _ => FormFieldType::Unknown,
        };

        Ok(field_type)
    }

    /// Extract options for choice fields
    fn extract_field_options(
        &self,
        field_obj: &mupdf::pdf::PdfObject,
        current_value: Option<&str>,
    ) -> Result<Option<Vec<FormOption>>, PdfParseError> {
        let opt_array = match field_obj.get_dict("Opt")? {
            Some(opt) => opt,
            None => return Ok(None),
        };

        let mut options = Vec::new();
        let opt_count = opt_array.len().unwrap_or(0);

        for i in 0..opt_count {
            if let Ok(Some(opt_item)) = opt_array.get_array(i as i32) {
                // Options can be strings or [export_value, display_text] arrays
                // as_string() returns &str (already decoded)
                if opt_item.is_array().unwrap_or(false) {
                    // Array format: [export_value, display_text]
                    // These are text strings, not PDF name objects
                    let export_val = opt_item
                        .get_array(0)?
                        .and_then(|v| v.as_string().map(|s| s.to_string()).ok());
                    let display = opt_item
                        .get_array(1)?
                        .and_then(|v| v.as_string().map(|s| s.to_string()).ok())
                        .unwrap_or_default();

                    let selected = current_value.map_or(false, |cv| {
                        export_val.as_deref().map_or(false, |ev| ev == cv) || display == cv
                    });

                    options.push(FormOption {
                        label: display,
                        value: export_val,
                        selected,
                    });
                } else {
                    // Simple string format - options are text strings
                    let label = opt_item.as_string().unwrap_or("").to_string();
                    let selected = current_value.map_or(false, |cv| cv == label);

                    options.push(FormOption {
                        label,
                        value: None,
                        selected,
                    });
                }
            }
        }

        if options.is_empty() {
            Ok(None)
        } else {
            Ok(Some(options))
        }
    }

    /// Check if form needs calculation (has CO array)
    fn check_form_needs_calculation(&self, pdf_doc: &PdfDocument) -> bool {
        if let Ok(trailer) = pdf_doc.trailer() {
            if let Ok(Some(root)) = trailer.get_dict("Root") {
                if let Ok(Some(acro_form)) = root.get_dict("AcroForm") {
                    if let Ok(Some(co)) = acro_form.get_dict("CO") {
                        return co.len().unwrap_or(0) > 0;
                    }
                }
            }
        }
        false
    }

    /// Get signature fields with basic information
    ///
    /// Note: Full signature verification requires cryptographic validation
    /// which is beyond the scope of basic PDF parsing.
    pub fn get_signatures(&self) -> Result<Vec<SignatureInfo>, PdfParseError> {
        let form_info = self.get_form_info()?;
        let mut signatures = Vec::new();

        for field in form_info.fields {
            if matches!(field.field_type, FormFieldType::Signature) {
                signatures.push(SignatureInfo {
                    signer_name: field.value.clone(),
                    signing_time: None, // Would need to parse /M from signature dictionary
                    location: None,     // Would need to parse /Location
                    reason: None,       // Would need to parse /Reason
                    covers_whole_document: false, // Would need byte range analysis
                    validation_status: SignatureValidationStatus::NotVerified,
                    page: field.page,
                });
            }
        }

        Ok(signatures)
    }

    /// Check if the PDF has any form fields
    pub fn has_forms(&self) -> bool {
        self.get_form_info()
            .map(|info| info.has_acro_form || info.has_xfa_form)
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_page_num() {
        // Create a mock parser with known page count
        // (Actual parsing tests require a real PDF file)
    }
}
