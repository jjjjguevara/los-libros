//! Low-level MuPDF Wrapper
//!
//! This module provides a safe, thread-aware wrapper around the MuPDF library.
//! It handles the complexities of MuPDF's threading model and provides
//! ergonomic Rust interfaces for document operations.
//!
//! # Thread Safety
//!
//! MuPDF's `fz_context` is **NOT thread-safe**. This module addresses this via:
//!
//! 1. **ContextPool**: Reuses contexts to avoid creation overhead
//! 2. **SafeDocument**: Opens fresh document per operation for thread safety
//! 3. **Operation Serialization**: Mutex guards for document-level operations
//!
//! # Usage
//!
//! ```rust,ignore
//! use amnesia_server::mupdf::{SafeDocument, create_shared_pool};
//!
//! // Create shared pool
//! let pool = create_shared_pool(8);
//!
//! // Load document
//! let doc = SafeDocument::from_bytes(pdf_bytes, "doc-123".into(), "application/pdf".into())?;
//!
//! // Use document with thread-safe operation
//! let page_count = doc.with_doc(|d| {
//!     Ok(d.page_count()? as usize)
//! })?;
//!
//! // Extract structured text
//! let stext = doc.with_page(0, |page| {
//!     stext::extract_structured_text(page, &StextOptions::default())
//! })?;
//! ```

mod context;
mod safe;
mod stext;

pub use context::{create_shared_pool, ContextPool, PoolStats, PooledContext, SharedContextPool};
pub use safe::{DocumentSource, SafeDocument};
pub use stext::{extract_plain_text, extract_structured_text, search_text, StextOptions};
