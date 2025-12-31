//! Annotation module
//!
//! Provides multi-selector annotation support following the W3C Web Annotation
//! and Readium annotation formats.
//!
//! # Features
//!
//! - Multiple selector types for robust text anchoring:
//!   - CFI (FragmentSelector) - EPUB-specific
//!   - TextQuote - text with context
//!   - TextPosition - character offsets
//!   - Progression - percentage-based
//!
//! - Annotation types:
//!   - Highlights
//!   - Notes
//!   - Bookmarks
//!
//! - SQLite persistence with sync metadata

mod store;
mod types;

pub use store::{AnnotationQuery, AnnotationRepository};
pub use types::{
    Annotation, AnnotationBody, AnnotationStyle, AnnotationTarget, AnnotationType, BodyType,
    Selector, SyncMetadata,
};
