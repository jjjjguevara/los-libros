//! PDF parsing module
//!
//! Provides PDF parsing functionality using pdfium-render.
//! Includes types, parsing, caching, and page rendering.
//!
//! ## Architecture
//!
//! PDFium has global C++ state that gets corrupted when initialized/destroyed
//! multiple times. The `PdfService` actor pattern ensures PDFium is:
//! - Initialized ONCE at server startup
//! - All operations happen on a dedicated OS thread (thread affinity)
//! - Destroyed only at server shutdown

mod cache;
mod parser;
mod service;
pub mod svg_text;
mod types;

pub use cache::PdfCache;
pub use parser::{PdfParseError, PdfParser};
pub use service::{PdfService, PdfServiceError};
pub use svg_text::generate_svg;
pub use types::{
    CharPosition, ImageFormat, NormalizedPosition, NormalizedRect, PageDimensions,
    PageOrientation, PageRenderRequest, ParsedPdf, PdfMetadata, PdfSearchResult, TextItem,
    TextLayer,
};
