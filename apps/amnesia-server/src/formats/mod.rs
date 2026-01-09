//! Format-specific document implementations
//!
//! This module contains implementations of the document abstraction traits
//! for specific formats (PDF, EPUB).
//!
//! # Architecture
//!
//! Each format module provides:
//! - `Parser`: Implements `DocumentParser` for metadata and text extraction
//! - `Renderer`: Implements `DocumentRenderer` for page/chapter rendering
//!
//! These implementations wrap the lower-level MuPDF bindings and provide
//! the unified interface defined in the `document` module.

pub mod epub;
pub mod pdf;
