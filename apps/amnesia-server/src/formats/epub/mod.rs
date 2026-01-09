//! EPUB format implementation
//!
//! This module provides `DocumentParser` and `DocumentRenderer` implementations
//! for EPUB documents using MuPDF.
//!
//! # Architecture
//!
//! - [`EpubDocumentHandler`]: Unified handler implementing both traits
//!
//! MuPDF treats EPUBs as reflowable documents. The `layout()` method is used
//! to set virtual page dimensions before rendering or text extraction.
//!
//! # Note on Raw XHTML Access
//!
//! The MuPDF Rust bindings (v0.5) don't expose the fz_archive API for direct
//! access to raw EPUB XHTML content. For now, content is accessed via MuPDF's
//! page rendering and text extraction APIs. Raw XHTML access would require
//! custom FFI bindings or using rbook as a fallback.

mod parser;
mod renderer;

pub use parser::EpubDocumentHandler;
pub use parser::EpubDocumentParser;
pub use renderer::EpubDocumentRenderer;
