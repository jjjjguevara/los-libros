//! PDF format implementation
//!
//! This module provides `DocumentParser` and `DocumentRenderer` implementations
//! for PDF documents using MuPDF.
//!
//! # Architecture
//!
//! - [`PdfDocumentParser`]: Implements parsing and text extraction
//! - [`PdfDocumentRenderer`]: Implements page rendering and thumbnails
//!
//! Both use [`SafeDocument`] from the mupdf module for thread-safe access.

mod parser;
mod renderer;

pub use parser::PdfDocumentParser;
pub use renderer::PdfDocumentRenderer;

// Re-export unified handler for convenience
pub use parser::PdfDocumentHandler;
