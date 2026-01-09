//! Structured Text Helpers
//!
//! Helpers for extracting structured text from MuPDF pages,
//! including character positions, font information, and text direction.

use mupdf::{Page, TextPageOptions, WriteMode};

use crate::document::{
    BoundingBox, CharPosition, Rect, Result, StructuredText, TextBlock, TextDirection, TextLine,
};

/// Options for structured text extraction
#[derive(Debug, Clone, Default)]
pub struct StextOptions {
    /// Preserve whitespace
    pub preserve_whitespace: bool,
    /// Preserve images
    pub preserve_images: bool,
    /// Preserve ligatures
    pub preserve_ligatures: bool,
    /// Inhibit spaces between characters
    pub inhibit_spaces: bool,
    /// Dehyphenate lines
    pub dehyphenate: bool,
    /// Preserve line breaks
    pub preserve_line_breaks: bool,
}

impl StextOptions {
    /// Convert to MuPDF TextPageOptions
    pub fn to_mupdf_options(&self) -> TextPageOptions {
        let mut opts = TextPageOptions::empty();

        if self.preserve_whitespace {
            opts |= TextPageOptions::PRESERVE_WHITESPACE;
        }
        if self.preserve_images {
            opts |= TextPageOptions::PRESERVE_IMAGES;
        }
        if self.preserve_ligatures {
            opts |= TextPageOptions::PRESERVE_LIGATURES;
        }
        if self.inhibit_spaces {
            opts |= TextPageOptions::INHIBIT_SPACES;
        }
        // DEHYPHENATE not available in mupdf 0.5.0
        // if self.dehyphenate {
        //     opts |= TextPageOptions::DEHYPHENATE;
        // }

        opts
    }
}

/// Extract structured text from a page
pub fn extract_structured_text(
    page: &Page,
    item_index: usize,
    options: &StextOptions,
) -> Result<StructuredText> {
    let text_page = page.to_text_page(options.to_mupdf_options())?;
    let bounds = page.bounds()?;

    let width = bounds.x1 - bounds.x0;
    let height = bounds.y1 - bounds.y0;

    let mut blocks = Vec::new();

    for block in text_page.blocks() {
        let block_bounds = block.bounds();
        let bbox = BoundingBox::new(
            block_bounds.x0,
            block_bounds.y0,
            block_bounds.x1 - block_bounds.x0,
            block_bounds.y1 - block_bounds.y0,
        );

        let mut lines = Vec::new();

        for line in block.lines() {
            let line_bounds = line.bounds();
            let line_bbox = BoundingBox::new(
                line_bounds.x0,
                line_bounds.y0,
                line_bounds.x1 - line_bounds.x0,
                line_bounds.y1 - line_bounds.y0,
            );

            let mut chars = Vec::new();
            let mut line_text = String::new();

            for ch in line.chars() {
                if let Some(c) = ch.char() {
                    let quad = ch.quad();

                    // Character bounding box from quad
                    let char_x = quad.ul.x.min(quad.ll.x);
                    let char_y = quad.ul.y.min(quad.ur.y);
                    let char_width = (quad.ur.x.max(quad.lr.x) - char_x).max(0.0);
                    let char_height = (quad.ll.y.max(quad.lr.y) - char_y).abs();

                    let font_size = ch.size();

                    // Font name and flags not directly available from TextChar API
                    // in MuPDF 0.5.0
                    let font_name: Option<String> = None;
                    let font_flags: Option<u32> = None;

                    line_text.push(c);
                    chars.push(CharPosition {
                        char: c,
                        x: char_x,
                        y: char_y,
                        width: char_width,
                        height: char_height,
                        font_size: Some(font_size),
                        font_name,
                        font_flags,
                        color: None,
                    });
                }
            }

            // Determine text direction from wmode
            let dir = match line.wmode() {
                WriteMode::Horizontal => Some(TextDirection::Ltr),
                WriteMode::Vertical => Some(TextDirection::Ttb),
            };

            lines.push(TextLine {
                bbox: line_bbox,
                dir,
                chars,
                text: if line_text.is_empty() {
                    None
                } else {
                    Some(line_text)
                },
            });
        }

        blocks.push(TextBlock { bbox, lines });
    }

    Ok(StructuredText {
        item_index,
        width,
        height,
        blocks,
    })
}

/// Get plain text from a page (without positions)
pub fn extract_plain_text(page: &Page) -> Result<String> {
    let text_page = page.to_text_page(TextPageOptions::empty())?;
    let mut text = String::new();

    for block in text_page.blocks() {
        for line in block.lines() {
            for ch in line.chars() {
                if let Some(c) = ch.char() {
                    text.push(c);
                }
            }
            text.push('\n');
        }
        text.push('\n');
    }

    Ok(text)
}

/// Search for text in a page, returning bounding boxes
pub fn search_text(page: &Page, query: &str, max_hits: u32) -> Result<Vec<Rect>> {
    let quads = page.search(query, max_hits)?;

    Ok(quads
        .into_iter()
        .map(|q| {
            // Convert Quad to Rect using corner points
            let x = q.ul.x.min(q.ll.x);
            let y = q.ul.y.min(q.ur.y);
            let width = q.ur.x.max(q.lr.x) - x;
            let height = q.ll.y.max(q.lr.y) - y;
            Rect::new(x, y, width, height)
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stext_options_default() {
        let opts = StextOptions::default();
        let mupdf_opts = opts.to_mupdf_options();
        assert!(mupdf_opts.is_empty());
    }

    #[test]
    fn test_stext_options_preserve_whitespace() {
        let opts = StextOptions {
            preserve_whitespace: true,
            ..Default::default()
        };
        let mupdf_opts = opts.to_mupdf_options();
        assert!(mupdf_opts.contains(TextPageOptions::PRESERVE_WHITESPACE));
    }
}
