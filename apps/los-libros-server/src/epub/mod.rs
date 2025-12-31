//! EPUB parsing module
//!
//! Provides EPUB parsing functionality using the rbook crate.
//! Includes types, parsing, and caching for efficient book handling.

mod cache;
mod parser;
mod types;

pub use cache::BookCache;
pub use parser::{EpubParser, ParseError};
pub use types::{
    BookMetadata, ChapterContent, Creator, ManifestItem, ParsedBook, Resource, SpineItem, TocEntry,
};
