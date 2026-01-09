//! EPUB DocumentRenderer implementation using MuPDF
//!
//! Implements the unified `DocumentRenderer` trait for EPUB documents.
//! Uses MuPDF for page rendering after layout, and ZIP for resource extraction.
//!
//! # Rendering Approach
//!
//! Since the MuPDF Rust bindings don't expose fz_archive for raw XHTML access,
//! EPUB pages are rendered to images after layout, similar to PDF rendering.
//!
//! # Resource Extraction
//!
//! EPUB resources (CSS, images, fonts) are extracted directly from the ZIP
//! archive using fuzzy path matching to handle path inconsistencies.

use std::io::{Cursor, Read};

use async_trait::async_trait;
use image::DynamicImage;
use mupdf::{Colorspace, Matrix};
use zip::ZipArchive;

use crate::document::{
    DocumentError, DocumentParser, DocumentRenderer, DocumentResult, ImageFormat, RenderRequest,
    RenderResult, Resource,
};

use super::parser::EpubDocumentHandler;

#[async_trait]
impl DocumentRenderer for EpubDocumentHandler {
    async fn render_item(&self, request: &RenderRequest) -> DocumentResult<RenderResult> {
        let item_index = request.item_index;
        if item_index >= self.item_count() {
            return Err(DocumentError::ItemNotFound(item_index));
        }

        let doc = self.document().clone();
        let scale = request.scale.clamp(0.1, 4.0);
        let rotation = request.rotation;
        let format = request.format;
        let layout_config = self.layout_config();

        tokio::task::spawn_blocking(move || {
            doc.with_doc_mut(|mupdf_doc| {
                // Ensure document is laid out
                if mupdf_doc.is_reflowable().unwrap_or(false) {
                    mupdf_doc.layout(layout_config.width, layout_config.height, layout_config.em)?;
                }

                let page = mupdf_doc.load_page(item_index as i32)?;

                // Build transformation matrix with scale and rotation
                let mut matrix = Matrix::new_scale(scale, scale);
                if rotation != 0 {
                    let rotation_matrix = Matrix::new_rotate(rotation as f32);
                    matrix.concat(rotation_matrix);
                }

                // Render to pixmap with alpha for proper text rendering
                let colorspace = Colorspace::device_rgb();
                let pixmap = page.to_pixmap(&matrix, &colorspace, true, true)?;

                // Encode to requested format
                let (data, width, height) = encode_pixmap(&pixmap, format)?;

                Ok(RenderResult {
                    data,
                    format,
                    width,
                    height,
                })
            })
        })
        .await
        .map_err(|e| DocumentError::RenderError(format!("Task join error: {}", e)))?
    }

    async fn render_thumbnail(
        &self,
        item_index: usize,
        max_size: u32,
    ) -> DocumentResult<RenderResult> {
        if item_index >= self.item_count() {
            return Err(DocumentError::ItemNotFound(item_index));
        }

        let doc = self.document().clone();
        let layout_config = self.layout_config();

        tokio::task::spawn_blocking(move || {
            doc.with_doc_mut(|mupdf_doc| {
                // Ensure document is laid out
                if mupdf_doc.is_reflowable().unwrap_or(false) {
                    mupdf_doc.layout(layout_config.width, layout_config.height, layout_config.em)?;
                }

                let page = mupdf_doc.load_page(item_index as i32)?;
                let bounds = page.bounds()?;

                // Calculate scale to fit within max_size
                let width = bounds.x1 - bounds.x0;
                let height = bounds.y1 - bounds.y0;
                let scale = (max_size as f32) / width.max(height);

                let matrix = Matrix::new_scale(scale, scale);
                let colorspace = Colorspace::device_rgb();
                let pixmap = page.to_pixmap(&matrix, &colorspace, true, false)?;

                // JPEG for smaller thumbnails
                let (data, out_width, out_height) = encode_pixmap(&pixmap, ImageFormat::Jpeg)?;

                Ok(RenderResult {
                    data,
                    format: ImageFormat::Jpeg,
                    width: out_width,
                    height: out_height,
                })
            })
        })
        .await
        .map_err(|e| DocumentError::RenderError(format!("Task join error: {}", e)))?
    }

    async fn get_resource(&self, href: &str) -> DocumentResult<Resource> {
        // Extract resource from EPUB ZIP archive with fuzzy path matching
        let doc = self.document();
        let bytes = doc.get_bytes()?;

        let href = href.to_string();
        let result = tokio::task::spawn_blocking(move || {
            extract_epub_resource(&bytes, &href)
        })
        .await
        .map_err(|e| DocumentError::IoErrorStr(format!("Task join error: {}", e)))?;

        result
    }
}

/// Standalone EPUB renderer (if you need renderer without parser functionality)
pub struct EpubDocumentRenderer {
    handler: EpubDocumentHandler,
}

impl EpubDocumentRenderer {
    /// Create a new EPUB renderer from bytes
    pub fn from_bytes(data: Vec<u8>, id: String) -> DocumentResult<Self> {
        let handler = EpubDocumentHandler::from_bytes(data, id)?;
        Ok(Self { handler })
    }

    /// Create a new EPUB renderer from a file path
    pub fn from_path<P: AsRef<std::path::Path>>(path: P, id: String) -> DocumentResult<Self> {
        let handler = EpubDocumentHandler::from_path(path, id)?;
        Ok(Self { handler })
    }

    /// Get item count from the underlying handler
    pub fn item_count(&self) -> usize {
        DocumentParser::item_count(&self.handler)
    }
}

#[async_trait]
impl DocumentRenderer for EpubDocumentRenderer {
    async fn render_item(&self, request: &RenderRequest) -> DocumentResult<RenderResult> {
        self.handler.render_item(request).await
    }

    async fn render_thumbnail(
        &self,
        item_index: usize,
        max_size: u32,
    ) -> DocumentResult<RenderResult> {
        self.handler.render_thumbnail(item_index, max_size).await
    }

    async fn get_resource(&self, href: &str) -> DocumentResult<Resource> {
        self.handler.get_resource(href).await
    }
}

// Helper functions

fn encode_pixmap(
    pixmap: &mupdf::Pixmap,
    format: ImageFormat,
) -> DocumentResult<(Vec<u8>, u32, u32)> {
    let width = pixmap.width() as u32;
    let height = pixmap.height() as u32;
    let samples = pixmap.samples();
    let n = pixmap.n() as usize;

    // Convert to RGBA buffer
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

    // Create image
    let img = image::RgbaImage::from_raw(width, height, rgba_buffer)
        .ok_or_else(|| DocumentError::ImageError("Failed to create image buffer".to_string()))?;

    let dynamic_img = DynamicImage::ImageRgba8(img);

    // Encode
    let mut output = Vec::new();
    match format {
        ImageFormat::Png => {
            dynamic_img
                .write_to(&mut Cursor::new(&mut output), image::ImageFormat::Png)
                .map_err(|e| DocumentError::ImageError(e.to_string()))?;
        }
        ImageFormat::Jpeg => {
            dynamic_img
                .write_to(&mut Cursor::new(&mut output), image::ImageFormat::Jpeg)
                .map_err(|e| DocumentError::ImageError(e.to_string()))?;
        }
        ImageFormat::Webp => {
            dynamic_img
                .write_to(&mut Cursor::new(&mut output), image::ImageFormat::WebP)
                .map_err(|e| DocumentError::ImageError(e.to_string()))?;
        }
    }

    Ok((output, width, height))
}

/// Extract a resource from an EPUB ZIP archive with fuzzy path matching
///
/// This implements "fuzzy" resource resolution to handle common path mismatches:
/// 1. Exact match first (e.g., "OEBPS/Styles/style.css")
/// 2. Path without leading directories (e.g., "Styles/style.css" matches "OEBPS/Styles/style.css")
/// 3. Filename only match (e.g., "style.css" matches any file named "style.css")
/// 4. URL fragment stripped (e.g., "chapter1.xhtml#section1" → "chapter1.xhtml")
fn extract_epub_resource(epub_bytes: &[u8], href: &str) -> DocumentResult<Resource> {
    let cursor = Cursor::new(epub_bytes);
    let mut archive = ZipArchive::new(cursor).map_err(|e| {
        DocumentError::ResourceNotFound(format!("Failed to open EPUB archive: {}", e))
    })?;

    // Strip URL fragment (e.g., "chapter1.xhtml#section1" → "chapter1.xhtml")
    let href_clean = href.split('#').next().unwrap_or(href);

    // Normalize path separators and URL encoding
    let href_normalized = normalize_epub_path(href_clean);

    // Collect all file names in the archive for matching
    let file_names: Vec<String> = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
        .collect();

    // Try to find a matching file
    let matched_name = find_matching_file(&file_names, &href_normalized);

    match matched_name {
        Some(name) => {
            let mut file = archive.by_name(&name).map_err(|e| {
                DocumentError::ResourceNotFound(format!("Failed to read '{}': {}", name, e))
            })?;

            let mut content = Vec::new();
            file.read_to_end(&mut content).map_err(|e| {
                DocumentError::IoErrorStr(format!("Failed to read resource content: {}", e))
            })?;

            // Determine MIME type from filename
            let mime_type = mime_guess::from_path(&name)
                .first()
                .map(|m| m.to_string())
                .unwrap_or_else(|| "application/octet-stream".to_string());

            Ok(Resource {
                href: name,
                mime_type,
                content,
            })
        }
        None => Err(DocumentError::ResourceNotFound(format!(
            "Resource '{}' not found in EPUB (searched: exact, suffix, filename)",
            href
        ))),
    }
}

/// Normalize EPUB path for matching
///
/// - URL-decode percent-encoded characters
/// - Replace backslashes with forward slashes
/// - Remove leading "./" or "/"
fn normalize_epub_path(path: &str) -> String {
    // URL decode
    let decoded = urlencoding::decode(path).unwrap_or_else(|_| path.into());

    // Normalize separators and leading chars
    decoded
        .replace('\\', "/")
        .trim_start_matches("./")
        .trim_start_matches('/')
        .to_string()
}

/// Find a matching file in the archive using fuzzy matching
///
/// Match priority:
/// 1. Exact match
/// 2. Suffix match (path ends with the requested path)
/// 3. Filename-only match (basename matches)
fn find_matching_file(file_names: &[String], href: &str) -> Option<String> {
    let href_lower = href.to_lowercase();
    let href_filename = href.rsplit('/').next().unwrap_or(href).to_lowercase();

    // 1. Exact match (case-insensitive)
    for name in file_names {
        let name_normalized = normalize_epub_path(name);
        if name_normalized.to_lowercase() == href_lower {
            return Some(name.clone());
        }
    }

    // 2. Suffix match (e.g., "Styles/style.css" matches "OEBPS/Styles/style.css")
    // The match must be the entire string OR preceded by a path separator to avoid
    // false positives like "OEBPSstyle.css" matching "style.css"
    for name in file_names {
        let name_normalized = normalize_epub_path(name);
        let name_lower = name_normalized.to_lowercase();

        // Check for exact match first
        if name_lower == href_lower {
            return Some(name.clone());
        }

        // Check for suffix match with path separator
        // Either the archive name ends with "/href" (e.g., "OEBPS/Styles/style.css" ends with "/Styles/style.css")
        // or the entire archive path equals the href
        if name_lower.ends_with(&format!("/{}", href_lower)) {
            return Some(name.clone());
        }
    }

    // 3. Filename-only match (basename matches)
    for name in file_names {
        let name_filename = name.rsplit('/').next().unwrap_or(name).to_lowercase();
        if name_filename == href_filename {
            return Some(name.clone());
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_epub_path() {
        assert_eq!(normalize_epub_path("./OEBPS/style.css"), "OEBPS/style.css");
        assert_eq!(normalize_epub_path("/OEBPS/style.css"), "OEBPS/style.css");
        assert_eq!(normalize_epub_path("OEBPS\\style.css"), "OEBPS/style.css");
        assert_eq!(
            normalize_epub_path("OEBPS/chapter%201.xhtml"),
            "OEBPS/chapter 1.xhtml"
        );
    }

    #[test]
    fn test_find_matching_file_exact() {
        let files = vec![
            "OEBPS/Styles/main.css".to_string(),
            "OEBPS/Text/chapter1.xhtml".to_string(),
        ];

        // Exact match
        assert_eq!(
            find_matching_file(&files, "OEBPS/Styles/main.css"),
            Some("OEBPS/Styles/main.css".to_string())
        );
    }

    #[test]
    fn test_find_matching_file_suffix() {
        let files = vec![
            "OEBPS/Styles/main.css".to_string(),
            "OEBPS/Text/chapter1.xhtml".to_string(),
        ];

        // Suffix match (without leading OEBPS/)
        assert_eq!(
            find_matching_file(&files, "Styles/main.css"),
            Some("OEBPS/Styles/main.css".to_string())
        );
    }

    #[test]
    fn test_find_matching_file_filename() {
        let files = vec![
            "OEBPS/Styles/main.css".to_string(),
            "content/images/cover.jpg".to_string(),
        ];

        // Filename-only match
        assert_eq!(
            find_matching_file(&files, "cover.jpg"),
            Some("content/images/cover.jpg".to_string())
        );
    }

    #[test]
    fn test_find_matching_file_not_found() {
        let files = vec!["OEBPS/style.css".to_string()];
        assert_eq!(find_matching_file(&files, "nonexistent.css"), None);
    }

    #[test]
    fn test_find_matching_file_no_false_positives() {
        // Test that we don't match "OEBPSstyle.css" when looking for "style.css"
        // This would happen with naive ends_with() matching
        let files = vec![
            "OEBPSstyle.css".to_string(),    // Should NOT match (no path separator)
            "OEBPS/style.css".to_string(),   // Should match (has path separator)
        ];

        // Should match the correct one with path separator
        assert_eq!(
            find_matching_file(&files, "style.css"),
            Some("OEBPS/style.css".to_string())
        );

        // Another false positive test: filename that ends with the search term
        let files2 = vec!["mystyle.css".to_string()];
        // Should NOT match - use filename-only match which requires exact basename match
        // Since "mystyle.css" basename equals "mystyle.css", not "style.css", should be None
        assert_eq!(find_matching_file(&files2, "style.css"), None);
    }
}
