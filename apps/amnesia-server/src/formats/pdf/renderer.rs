//! PDF DocumentRenderer implementation
//!
//! Implements the unified `DocumentRenderer` trait for PDF documents.
//! Uses MuPDF for page rendering and image encoding.

use std::io::Cursor;
use std::sync::Arc;

use async_trait::async_trait;
use image::DynamicImage;
use mupdf::{Colorspace, Matrix};

use crate::document::{
    DocumentError, DocumentRenderer, DocumentResult, ImageFormat, RenderRequest, RenderResult,
    Resource,
};
use crate::mupdf::SafeDocument;

use super::PdfDocumentHandler;

#[async_trait]
impl DocumentRenderer for PdfDocumentHandler {
    async fn render_item(&self, request: &RenderRequest) -> DocumentResult<RenderResult> {
        let item_index = request.item_index;
        if item_index >= self.doc.item_count() {
            return Err(DocumentError::ItemNotFound(item_index));
        }

        let doc = self.doc.clone();
        let scale = request.scale.clamp(0.1, 4.0);
        let rotation = request.rotation;
        let format = request.format;

        tokio::task::spawn_blocking(move || {
            doc.with_doc(|mupdf_doc| {
                let page = mupdf_doc.load_page(item_index as i32)?;

                // Build transformation matrix with scale and rotation
                let mut matrix = Matrix::new_scale(scale, scale);
                if rotation != 0 {
                    let rotation_matrix = Matrix::new_rotate(rotation as f32);
                    matrix.concat(rotation_matrix);
                }

                // Render to pixmap
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
        if item_index >= self.doc.item_count() {
            return Err(DocumentError::ItemNotFound(item_index));
        }

        let doc = self.doc.clone();

        tokio::task::spawn_blocking(move || {
            doc.with_doc(|mupdf_doc| {
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

    async fn get_resource(&self, _href: &str) -> DocumentResult<Resource> {
        // PDFs don't have external resources like EPUBs
        // Embedded images could be extracted but that's not typically needed
        Err(DocumentError::ResourceNotFound(
            "PDF resources not supported".to_string(),
        ))
    }
}

/// Standalone PDF renderer (if you need renderer without parser)
pub struct PdfDocumentRenderer {
    doc: Arc<SafeDocument>,
}

impl PdfDocumentRenderer {
    /// Create a new PDF renderer from bytes
    pub fn from_bytes(data: Vec<u8>, id: String) -> DocumentResult<Self> {
        let doc = SafeDocument::from_bytes(data, id)?;
        Ok(Self { doc: Arc::new(doc) })
    }

    /// Create a new PDF renderer from a file path
    pub fn from_path<P: AsRef<std::path::Path>>(path: P, id: String) -> DocumentResult<Self> {
        let doc = SafeDocument::from_path(path, id)?;
        Ok(Self { doc: Arc::new(doc) })
    }
}

#[async_trait]
impl DocumentRenderer for PdfDocumentRenderer {
    async fn render_item(&self, request: &RenderRequest) -> DocumentResult<RenderResult> {
        let item_index = request.item_index;
        if item_index >= self.doc.item_count() {
            return Err(DocumentError::ItemNotFound(item_index));
        }

        let doc = self.doc.clone();
        let scale = request.scale.clamp(0.1, 4.0);
        let rotation = request.rotation;
        let format = request.format;

        tokio::task::spawn_blocking(move || {
            doc.with_doc(|mupdf_doc| {
                let page = mupdf_doc.load_page(item_index as i32)?;

                let mut matrix = Matrix::new_scale(scale, scale);
                if rotation != 0 {
                    let rotation_matrix = Matrix::new_rotate(rotation as f32);
                    matrix.concat(rotation_matrix);
                }

                let colorspace = Colorspace::device_rgb();
                let pixmap = page.to_pixmap(&matrix, &colorspace, true, true)?;
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
        if item_index >= self.doc.item_count() {
            return Err(DocumentError::ItemNotFound(item_index));
        }

        let doc = self.doc.clone();

        tokio::task::spawn_blocking(move || {
            doc.with_doc(|mupdf_doc| {
                let page = mupdf_doc.load_page(item_index as i32)?;
                let bounds = page.bounds()?;

                let width = bounds.x1 - bounds.x0;
                let height = bounds.y1 - bounds.y0;
                let scale = (max_size as f32) / width.max(height);

                let matrix = Matrix::new_scale(scale, scale);
                let colorspace = Colorspace::device_rgb();
                let pixmap = page.to_pixmap(&matrix, &colorspace, true, false)?;
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

    async fn get_resource(&self, _href: &str) -> DocumentResult<Resource> {
        Err(DocumentError::ResourceNotFound(
            "PDF resources not supported".to_string(),
        ))
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

#[cfg(test)]
mod tests {
    use super::*;

    // Tests would require actual PDF files
    // For now, just verify the module compiles correctly
}
