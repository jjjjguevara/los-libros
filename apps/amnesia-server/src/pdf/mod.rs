//! PDF parsing module
//!
//! Provides PDF parsing functionality using MuPDF.
//! Includes types, parsing, caching, and page rendering.
//!
//! MuPDF provides:
//! - Better thread safety (proper Rust lifetimes, no unsafe transmutes)
//! - Accurate character positions via stext API
//! - Search with bounding boxes for highlighting
//! - Actual font metadata extraction
//! - Native page labels support

mod cache;
mod mupdf_parser;
mod types;

pub use cache::PdfCache;
pub use mupdf_parser::{PdfParseError, PdfParser};
pub use types::{
    BoundingBox, CharPosition, FillFormRequest, FillFormResult, FormField, FormFieldType,
    FormInfo, FormOption, ImageFormat, NormalizedPosition, NormalizedRect, PageDimensions,
    PageOrientation, PageRenderRequest, ParsedPdf, PdfMetadata, PdfSearchResult, SignatureInfo,
    SignatureValidationStatus, TextItem, TextLayer,
};
