//! Thread-safe document wrapper for MuPDF
//!
//! Provides a safe abstraction over MuPDF documents that ensures
//! thread-safe access through serialization.
//!
//! # Design
//!
//! MuPDF documents are not thread-safe. This wrapper:
//!
//! 1. Stores the document data (bytes or path)
//! 2. Opens a fresh document for each operation
//! 3. Uses `parking_lot::Mutex` to serialize access
//!
//! This approach avoids the need to hold long-lived Document references
//! and ensures that each operation gets a clean document state.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use mupdf::Document;
use parking_lot::Mutex;

use crate::document::{DocumentError, DocumentFormat, DocumentResult};

/// Source data for a document
#[derive(Clone)]
pub enum DocumentSource {
    /// Document loaded from owned bytes
    Bytes(Arc<Vec<u8>>),
    /// Document loaded from a file path
    Path(PathBuf),
}

impl DocumentSource {
    /// Create source from bytes
    pub fn from_bytes(data: Vec<u8>) -> Self {
        Self::Bytes(Arc::new(data))
    }

    /// Create source from path
    pub fn from_path<P: AsRef<Path>>(path: P) -> Self {
        Self::Path(path.as_ref().to_path_buf())
    }
}

/// Thread-safe document wrapper
///
/// Serializes all access to MuPDF documents to ensure thread safety.
/// The document is opened fresh for each operation to avoid stale state.
pub struct SafeDocument {
    /// Document source data
    source: DocumentSource,
    /// Document identifier
    id: String,
    /// Detected document format
    format: DocumentFormat,
    /// Cached page/item count
    item_count: usize,
    /// Mutex for serializing access
    _lock: Mutex<()>,
}

// SAFETY: SafeDocument is Send + Sync because:
//
// 1. DocumentSource::Bytes contains Arc<Vec<u8>>:
//    - Arc is Send + Sync (reference counted pointer)
//    - Vec<u8> is Send + Sync (owned data with no interior mutability)
//    - Arc<Vec<u8>> can be safely sent between threads and accessed concurrently
//
// 2. DocumentSource::Path contains PathBuf:
//    - PathBuf is Send + Sync (owned path data)
//    - No interior mutability or raw pointers
//
// 3. String (id field) is Send + Sync:
//    - Owned string data with no interior mutability
//
// 4. DocumentFormat and usize are Copy types:
//    - Can be safely copied between threads
//
// 5. All mutable operations go through with_doc/with_doc_map:
//    - These methods acquire _lock (Mutex<()>) which serializes all document access
//    - parking_lot::Mutex is Send + Sync
//    - No document reference escapes the closure scope
//    - Each operation opens a fresh document, performs work, and drops it
//
// 6. No shared mutable state:
//    - All fields except _lock are immutable after construction
//    - _lock provides interior mutability but is explicitly designed for Send + Sync
//
// Therefore, SafeDocument can be safely sent between threads (Send) and accessed
// concurrently (Sync) because all access is serialized through the mutex.
//
// NOTE: Concurrency control at the application level (limiting simultaneous MuPDF
// operations) is handled by the ContextPool at the cache/service layer, following
// the pattern established in pdf/cache.rs where tokio::spawn_blocking is used with
// timeouts for CPU-bound MuPDF operations.
unsafe impl Send for SafeDocument {}
unsafe impl Sync for SafeDocument {}

impl SafeDocument {
    /// Create a SafeDocument from bytes
    pub fn from_bytes(data: Vec<u8>, id: String) -> DocumentResult<Self> {
        // Detect format
        let format = DocumentFormat::from_magic_bytes(&data)
            .ok_or_else(|| DocumentError::UnsupportedFormat("Unknown format".into()))?;

        // Validate document can be opened and get item count
        let mime = Self::format_to_mime(format);
        let doc = Document::from_bytes(&data, mime)?;
        let item_count = doc.page_count()? as usize;

        Ok(Self {
            source: DocumentSource::from_bytes(data),
            id,
            format,
            item_count,
            _lock: Mutex::new(()),
        })
    }

    /// Create a SafeDocument from a file path
    pub fn from_path<P: AsRef<Path>>(path: P, id: String) -> DocumentResult<Self> {
        let path_buf = path.as_ref().to_path_buf();

        // Detect format from extension
        let format = path_buf
            .extension()
            .and_then(|ext| ext.to_str())
            .and_then(DocumentFormat::from_extension)
            .ok_or_else(|| DocumentError::UnsupportedFormat("Unknown file extension".into()))?;

        // Validate document can be opened and get item count
        let path_str = path_buf.to_string_lossy();
        let doc = Document::open(&*path_str)?;
        let item_count = doc.page_count()? as usize;

        Ok(Self {
            source: DocumentSource::from_path(path_buf),
            id,
            format,
            item_count,
            _lock: Mutex::new(()),
        })
    }

    /// Get the document ID
    pub fn id(&self) -> &str {
        &self.id
    }

    /// Get the document format
    pub fn format(&self) -> DocumentFormat {
        self.format
    }

    /// Get the number of items (pages for PDF, chapters for EPUB)
    pub fn item_count(&self) -> usize {
        self.item_count
    }

    /// Open a fresh document instance for an operation
    ///
    /// This is called internally by `with_doc` to ensure each operation
    /// gets a clean document state.
    fn open_document(&self) -> DocumentResult<Document> {
        match &self.source {
            DocumentSource::Bytes(data) => {
                let mime = Self::format_to_mime(self.format);
                Document::from_bytes(data, mime).map_err(Into::into)
            }
            DocumentSource::Path(path) => {
                let path_str = path.to_string_lossy();
                Document::open(&*path_str).map_err(Into::into)
            }
        }
    }

    /// Execute a closure with access to the document
    ///
    /// This opens a fresh document, executes the closure, and ensures
    /// the document is dropped afterward. Access is serialized via mutex.
    ///
    /// # Example
    ///
    /// ```ignore
    /// let result = safe_doc.with_doc(|doc| {
    ///     let page = doc.load_page(0)?;
    ///     Ok(page.bounds()?)
    /// })?;
    /// ```
    pub fn with_doc<F, R>(&self, f: F) -> DocumentResult<R>
    where
        F: FnOnce(&Document) -> DocumentResult<R>,
    {
        // Serialize access
        let _guard = self._lock.lock();

        // Open fresh document
        let doc = self.open_document()?;

        // Execute operation
        f(&doc)
    }

    /// Execute a closure that may fail with a custom error
    ///
    /// Similar to `with_doc` but allows returning any error type that
    /// can be converted to `DocumentError`.
    pub fn with_doc_map<F, R, E>(&self, f: F) -> DocumentResult<R>
    where
        F: FnOnce(&Document) -> Result<R, E>,
        E: Into<DocumentError>,
    {
        let _guard = self._lock.lock();
        let doc = self.open_document()?;
        f(&doc).map_err(Into::into)
    }

    /// Execute a closure with mutable access to the document
    ///
    /// This is needed for operations like EPUB layout which require
    /// mutable document access.
    ///
    /// # Example
    ///
    /// ```ignore
    /// safe_doc.with_doc_mut(|doc| {
    ///     doc.layout(800.0, 600.0, 12.0)?;
    ///     Ok(())
    /// })?;
    /// ```
    pub fn with_doc_mut<F, R>(&self, f: F) -> DocumentResult<R>
    where
        F: FnOnce(&mut Document) -> DocumentResult<R>,
    {
        // Serialize access
        let _guard = self._lock.lock();

        // Open fresh document
        let mut doc = self.open_document()?;

        // Execute operation
        f(&mut doc)
    }

    /// Get MIME type for format
    fn format_to_mime(format: DocumentFormat) -> &'static str {
        match format {
            DocumentFormat::Pdf => "application/pdf",
            DocumentFormat::Epub => "application/epub+zip",
        }
    }

    /// Get the document source data as bytes
    ///
    /// Returns the raw bytes for documents loaded from bytes,
    /// or reads the file for documents loaded from a path.
    /// Useful for EPUB resource extraction via ZIP.
    pub fn get_bytes(&self) -> DocumentResult<Arc<Vec<u8>>> {
        match &self.source {
            DocumentSource::Bytes(data) => Ok(Arc::clone(data)),
            DocumentSource::Path(path) => {
                let data = std::fs::read(path).map_err(|e| {
                    DocumentError::IoErrorStr(format!("Failed to read {}: {}", path.display(), e))
                })?;
                Ok(Arc::new(data))
            }
        }
    }

    /// Check if the document has a text layer
    ///
    /// For PDFs, this checks if the first page has extractable text.
    /// For EPUBs, this always returns true (text is always available).
    pub fn has_text_layer(&self) -> DocumentResult<bool> {
        if self.format == DocumentFormat::Epub {
            return Ok(true);
        }

        self.with_doc(|doc| {
            if self.item_count == 0 {
                return Ok(false);
            }

            let page = doc.load_page(0)?;
            let text_page = page.to_text_page(mupdf::TextPageOptions::empty())?;
            let text = text_page.to_text()?;

            Ok(!text.trim().is_empty())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_document_source_from_bytes() {
        let data = vec![1, 2, 3, 4];
        let source = DocumentSource::from_bytes(data.clone());

        match source {
            DocumentSource::Bytes(arc_data) => {
                assert_eq!(*arc_data, data);
            }
            _ => panic!("Expected Bytes variant"),
        }
    }

    #[test]
    fn test_document_source_from_path() {
        let path = "/test/path.pdf";
        let source = DocumentSource::from_path(path);

        match source {
            DocumentSource::Path(path_buf) => {
                assert_eq!(path_buf.to_str().unwrap(), "/test/path.pdf");
            }
            _ => panic!("Expected Path variant"),
        }
    }

    #[test]
    fn test_format_to_mime() {
        assert_eq!(
            SafeDocument::format_to_mime(DocumentFormat::Pdf),
            "application/pdf"
        );
        assert_eq!(
            SafeDocument::format_to_mime(DocumentFormat::Epub),
            "application/epub+zip"
        );
    }
}
