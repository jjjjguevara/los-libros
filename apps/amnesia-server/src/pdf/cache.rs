//! PDF cache for parsed documents and rendered pages
//!
//! In-memory cache to avoid re-parsing PDFs and re-rendering pages.
//!
//! IMPORTANT: pdfium is NOT thread-safe. Each PdfParser is wrapped in a Mutex
//! to serialize all operations on a given PDF document. This prevents crashes
//! when multiple requests access the same document concurrently.

use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::sync::{Arc, Mutex};

use lru::LruCache;
use tokio::sync::RwLock;
use tokio::time::{timeout, Duration};

/// Timeout for PDF parsing operations (loading a new PDF)
/// Note: Some PDFs cause pdfium to hang indefinitely. This timeout ensures
/// the client gets a response rather than waiting forever.
/// The blocking thread may continue running, but at least the request completes.
const PARSE_TIMEOUT_SECS: u64 = 30; // 30 seconds max - faster feedback on problematic PDFs
/// Timeout for page rendering operations
const RENDER_TIMEOUT_SECS: u64 = 30; // 30 seconds per page
/// Timeout for text extraction operations
const TEXT_TIMEOUT_SECS: u64 = 15; // 15 seconds per page
/// Timeout for search operations (prevent DoS on large PDFs)
const SEARCH_TIMEOUT_SECS: u64 = 30; // 30 seconds max for search

use super::parser::{PdfParseError, PdfParser};
use super::types::{ImageFormat, PageRenderRequest, ParsedPdf, TextLayer};

/// Thread-safe wrapper for PdfParser that serializes all operations
/// pdfium is NOT thread-safe, so we must use a Mutex to prevent concurrent access
pub struct SafePdfParser {
    inner: Mutex<PdfParser>,
}

impl SafePdfParser {
    pub fn new(parser: PdfParser) -> Self {
        Self {
            inner: Mutex::new(parser),
        }
    }

    /// Render a page with exclusive access to the parser
    pub fn render_page(&self, request: &PageRenderRequest) -> Result<Vec<u8>, PdfParseError> {
        let parser = self.inner.lock().map_err(|e| {
            PdfParseError::RenderError(format!("Failed to acquire parser lock: {}", e))
        })?;
        parser.render_page(request)
    }

    /// Render a thumbnail with exclusive access
    pub fn render_thumbnail(&self, page: usize, max_size: u32) -> Result<Vec<u8>, PdfParseError> {
        let parser = self.inner.lock().map_err(|e| {
            PdfParseError::RenderError(format!("Failed to acquire parser lock: {}", e))
        })?;
        parser.render_thumbnail(page, max_size)
    }

    /// Get text layer with exclusive access
    pub fn get_text_layer(&self, page: usize) -> Result<TextLayer, PdfParseError> {
        let parser = self.inner.lock().map_err(|e| {
            PdfParseError::LoadError(format!("Failed to acquire parser lock: {}", e))
        })?;
        parser.get_text_layer(page)
    }

    /// Search with exclusive access
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<super::types::PdfSearchResult>, PdfParseError> {
        let parser = self.inner.lock().map_err(|e| {
            PdfParseError::LoadError(format!("Failed to acquire parser lock: {}", e))
        })?;
        parser.search(query, limit)
    }

    /// Get page text with exclusive access
    pub fn get_page_text(&self, page: usize) -> Result<String, PdfParseError> {
        let parser = self.inner.lock().map_err(|e| {
            PdfParseError::LoadError(format!("Failed to acquire parser lock: {}", e))
        })?;
        parser.get_page_text(page)
    }

    /// Get page dimensions with exclusive access
    pub fn get_page_dimensions(&self, page: usize) -> Result<super::types::PageDimensions, PdfParseError> {
        let parser = self.inner.lock().map_err(|e| {
            PdfParseError::LoadError(format!("Failed to acquire parser lock: {}", e))
        })?;
        parser.get_page_dimensions(page)
    }
}

/// Cache key for rendered pages
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct PageCacheKey {
    pub book_id: String,
    pub page: usize,
    pub scale: u32, // Scale * 100 as integer for hashing
    pub rotation: u16,
    pub format: ImageFormat,
}

impl PageCacheKey {
    pub fn new(book_id: &str, request: &PageRenderRequest) -> Self {
        Self {
            book_id: book_id.to_string(),
            page: request.page,
            scale: (request.scale * 100.0) as u32,
            rotation: request.rotation,
            format: request.format,
        }
    }

    pub fn thumbnail(book_id: &str, page: usize, max_size: u32) -> Self {
        Self {
            book_id: book_id.to_string(),
            page,
            scale: max_size,
            rotation: 0,
            format: ImageFormat::Jpeg,
        }
    }
}

impl std::hash::Hash for ImageFormat {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        match self {
            ImageFormat::Png => 0u8.hash(state),
            ImageFormat::Webp => 1u8.hash(state),
            ImageFormat::Jpeg => 2u8.hash(state),
        }
    }
}

/// Thread-safe PDF cache
#[derive(Clone)]
pub struct PdfCache {
    /// Parsed PDF metadata cache
    pdfs: Arc<RwLock<HashMap<String, ParsedPdf>>>,
    /// Active parser instances wrapped in SafePdfParser for thread-safety
    parsers: Arc<RwLock<HashMap<String, Arc<SafePdfParser>>>>,
    /// LRU cache for rendered pages
    page_cache: Arc<RwLock<LruCache<PageCacheKey, Vec<u8>>>>,
    /// LRU cache for text layers (bounded to prevent memory leaks)
    text_cache: Arc<RwLock<LruCache<(String, usize), TextLayer>>>,
}

impl Default for PdfCache {
    fn default() -> Self {
        Self::new()
    }
}

impl PdfCache {
    /// Create a new empty cache
    pub fn new() -> Self {
        Self::with_capacity(100) // Default to 100 cached pages
    }

    /// Create a cache with specified page cache capacity
    pub fn with_capacity(page_cache_size: usize) -> Self {
        let page_size = NonZeroUsize::new(page_cache_size).unwrap_or(NonZeroUsize::new(100).unwrap());
        // Text cache is 2x page cache size (text layers are smaller than rendered pages)
        let text_size = NonZeroUsize::new(page_cache_size * 2).unwrap_or(NonZeroUsize::new(200).unwrap());

        Self {
            pdfs: Arc::new(RwLock::new(HashMap::new())),
            parsers: Arc::new(RwLock::new(HashMap::new())),
            page_cache: Arc::new(RwLock::new(LruCache::new(page_size))),
            text_cache: Arc::new(RwLock::new(LruCache::new(text_size))),
        }
    }

    /// Load and cache a PDF from bytes
    pub async fn load_from_bytes(
        &self,
        data: &[u8],
        book_id: String,
    ) -> Result<ParsedPdf, PdfParseError> {
        // Clone data for the blocking task
        let data_owned = data.to_vec();
        let book_id_clone = book_id.clone();

        // Offload CPU-bound PDF parsing to a blocking thread pool
        // This prevents blocking the async runtime for large PDFs
        // Add timeout to prevent indefinite hangs on problematic PDFs
        let parse_result = timeout(
            Duration::from_secs(PARSE_TIMEOUT_SECS),
            tokio::task::spawn_blocking(move || {
                let parser = PdfParser::from_bytes(&data_owned, book_id_clone)?;
                let pdf = parser.parse()?;
                Ok::<_, PdfParseError>((parser, pdf))
            }),
        )
        .await;

        // Handle timeout and join errors
        let (parser, pdf) = match parse_result {
            Ok(join_result) => join_result
                .map_err(|e| PdfParseError::LoadError(format!("Task join error: {}", e)))??,
            Err(_) => return Err(PdfParseError::Timeout(PARSE_TIMEOUT_SECS)),
        };

        let id = pdf.id.clone();

        // Cache the parsed metadata
        {
            let mut pdfs = self.pdfs.write().await;
            pdfs.insert(id.clone(), pdf.clone());
        }

        // Cache the parser wrapped in SafePdfParser for thread-safety
        {
            let mut parsers = self.parsers.write().await;
            parsers.insert(id, Arc::new(SafePdfParser::new(parser)));
        }

        Ok(pdf)
    }

    /// Load and cache a PDF from a file path
    pub async fn load_from_path(
        &self,
        path: impl AsRef<std::path::Path>,
        book_id: String,
    ) -> Result<ParsedPdf, PdfParseError> {
        // Clone path for the blocking task
        let path_owned = path.as_ref().to_path_buf();
        let book_id_clone = book_id.clone();

        // Offload CPU-bound PDF parsing to a blocking thread pool
        // Add timeout to prevent indefinite hangs on problematic PDFs
        let parse_result = timeout(
            Duration::from_secs(PARSE_TIMEOUT_SECS),
            tokio::task::spawn_blocking(move || {
                let parser = PdfParser::from_path(&path_owned, book_id_clone)?;
                let pdf = parser.parse()?;
                Ok::<_, PdfParseError>((parser, pdf))
            }),
        )
        .await;

        // Handle timeout and join errors
        let (parser, pdf) = match parse_result {
            Ok(join_result) => join_result
                .map_err(|e| PdfParseError::LoadError(format!("Task join error: {}", e)))??,
            Err(_) => return Err(PdfParseError::Timeout(PARSE_TIMEOUT_SECS)),
        };

        let id = pdf.id.clone();

        // Cache the parsed metadata
        {
            let mut pdfs = self.pdfs.write().await;
            pdfs.insert(id.clone(), pdf.clone());
        }

        // Cache the parser wrapped in SafePdfParser for thread-safety
        {
            let mut parsers = self.parsers.write().await;
            parsers.insert(id, Arc::new(SafePdfParser::new(parser)));
        }

        Ok(pdf)
    }

    /// Get cached PDF metadata
    pub async fn get_pdf(&self, id: &str) -> Option<ParsedPdf> {
        let pdfs = self.pdfs.read().await;
        pdfs.get(id).cloned()
    }

    /// Get all cached PDFs
    pub async fn get_all_pdfs(&self) -> Vec<ParsedPdf> {
        let pdfs = self.pdfs.read().await;
        pdfs.values().cloned().collect()
    }

    /// Check if a PDF is cached
    pub async fn contains(&self, id: &str) -> bool {
        let pdfs = self.pdfs.read().await;
        pdfs.contains_key(id)
    }

    /// Render a page (with caching)
    pub async fn render_page(
        &self,
        book_id: &str,
        request: &PageRenderRequest,
    ) -> Result<Vec<u8>, PdfParseError> {
        let cache_key = PageCacheKey::new(book_id, request);

        // Check page cache first
        {
            let mut page_cache = self.page_cache.write().await;
            if let Some(data) = page_cache.get(&cache_key) {
                return Ok(data.clone());
            }
        }

        // Get the parser
        let parser = {
            let parsers = self.parsers.read().await;
            parsers
                .get(book_id)
                .cloned()
                .ok_or_else(|| PdfParseError::LoadError(format!("PDF {} not cached", book_id)))?
        };

        // Offload CPU-bound rendering to blocking thread pool with timeout
        let request_clone = request.clone();
        let render_result = timeout(
            Duration::from_secs(RENDER_TIMEOUT_SECS),
            tokio::task::spawn_blocking(move || parser.render_page(&request_clone)),
        )
        .await;

        let data = match render_result {
            Ok(join_result) => join_result
                .map_err(|e| PdfParseError::RenderError(format!("Task join error: {}", e)))??,
            Err(_) => return Err(PdfParseError::Timeout(RENDER_TIMEOUT_SECS)),
        };

        // Cache the result
        {
            let mut page_cache = self.page_cache.write().await;
            page_cache.put(cache_key, data.clone());
        }

        Ok(data)
    }

    /// Render a thumbnail (with caching)
    pub async fn render_thumbnail(
        &self,
        book_id: &str,
        page: usize,
        max_size: u32,
    ) -> Result<Vec<u8>, PdfParseError> {
        let cache_key = PageCacheKey::thumbnail(book_id, page, max_size);

        // Check page cache first
        {
            let mut page_cache = self.page_cache.write().await;
            if let Some(data) = page_cache.get(&cache_key) {
                return Ok(data.clone());
            }
        }

        // Get the parser
        let parser = {
            let parsers = self.parsers.read().await;
            parsers
                .get(book_id)
                .cloned()
                .ok_or_else(|| PdfParseError::LoadError(format!("PDF {} not cached", book_id)))?
        };

        // Offload CPU-bound rendering to blocking thread pool with timeout
        let render_result = timeout(
            Duration::from_secs(RENDER_TIMEOUT_SECS),
            tokio::task::spawn_blocking(move || parser.render_thumbnail(page, max_size)),
        )
        .await;

        let data = match render_result {
            Ok(join_result) => join_result
                .map_err(|e| PdfParseError::RenderError(format!("Task join error: {}", e)))??,
            Err(_) => return Err(PdfParseError::Timeout(RENDER_TIMEOUT_SECS)),
        };

        // Cache the result
        {
            let mut page_cache = self.page_cache.write().await;
            page_cache.put(cache_key, data.clone());
        }

        Ok(data)
    }

    /// Get text layer for a page (with caching)
    pub async fn get_text_layer(
        &self,
        book_id: &str,
        page: usize,
    ) -> Result<TextLayer, PdfParseError> {
        let cache_key = (book_id.to_string(), page);

        // Check text cache first (need write lock for LRU to update access order)
        {
            let mut text_cache = self.text_cache.write().await;
            if let Some(layer) = text_cache.get(&cache_key) {
                return Ok(layer.clone());
            }
        }

        // Get the parser
        let parser = {
            let parsers = self.parsers.read().await;
            parsers
                .get(book_id)
                .cloned()
                .ok_or_else(|| PdfParseError::LoadError(format!("PDF {} not cached", book_id)))?
        };

        // Offload text extraction to blocking thread pool with timeout
        let text_result = timeout(
            Duration::from_secs(TEXT_TIMEOUT_SECS),
            tokio::task::spawn_blocking(move || parser.get_text_layer(page)),
        )
        .await;

        let layer = match text_result {
            Ok(join_result) => join_result
                .map_err(|e| PdfParseError::LoadError(format!("Task join error: {}", e)))??,
            Err(_) => return Err(PdfParseError::Timeout(TEXT_TIMEOUT_SECS)),
        };

        // Cache the result using LRU put
        {
            let mut text_cache = self.text_cache.write().await;
            text_cache.put(cache_key, layer.clone());
        }

        Ok(layer)
    }

    /// Search PDF content (with timeout to prevent DoS on large PDFs)
    pub async fn search(
        &self,
        book_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<super::types::PdfSearchResult>, PdfParseError> {
        let parser = {
            let parsers = self.parsers.read().await;
            parsers
                .get(book_id)
                .cloned()
                .ok_or_else(|| PdfParseError::LoadError(format!("PDF {} not cached", book_id)))?
        };

        let query_owned = query.to_string();

        // Add timeout to prevent indefinite hangs on large PDFs (DoS prevention)
        let search_result = timeout(
            Duration::from_secs(SEARCH_TIMEOUT_SECS),
            tokio::task::spawn_blocking(move || parser.search(&query_owned, limit)),
        )
        .await;

        match search_result {
            Ok(join_result) => join_result
                .map_err(|e| PdfParseError::LoadError(format!("Task join error: {}", e)))?,
            Err(_) => Err(PdfParseError::Timeout(SEARCH_TIMEOUT_SECS)),
        }
    }

    /// Get page text
    pub async fn get_page_text(&self, book_id: &str, page: usize) -> Result<String, PdfParseError> {
        let parser = {
            let parsers = self.parsers.read().await;
            parsers
                .get(book_id)
                .cloned()
                .ok_or_else(|| PdfParseError::LoadError(format!("PDF {} not cached", book_id)))?
        };

        tokio::task::spawn_blocking(move || parser.get_page_text(page))
            .await
            .map_err(|e| PdfParseError::LoadError(format!("Task join error: {}", e)))?
    }

    /// Get page dimensions
    pub async fn get_page_dimensions(
        &self,
        book_id: &str,
        page: usize,
    ) -> Result<super::types::PageDimensions, PdfParseError> {
        let parser = {
            let parsers = self.parsers.read().await;
            parsers
                .get(book_id)
                .cloned()
                .ok_or_else(|| PdfParseError::LoadError(format!("PDF {} not cached", book_id)))?
        };

        tokio::task::spawn_blocking(move || parser.get_page_dimensions(page))
            .await
            .map_err(|e| PdfParseError::LoadError(format!("Task join error: {}", e)))?
    }

    /// Remove a PDF from the cache
    pub async fn remove(&self, id: &str) {
        // Remove metadata
        {
            let mut pdfs = self.pdfs.write().await;
            pdfs.remove(id);
        }

        // Remove parser
        {
            let mut parsers = self.parsers.write().await;
            parsers.remove(id);
        }

        // Remove cached pages (need to iterate through LRU)
        {
            let mut page_cache = self.page_cache.write().await;
            // LruCache doesn't have a filter method, so we collect keys to remove
            let keys_to_remove: Vec<PageCacheKey> = page_cache
                .iter()
                .filter(|(k, _)| k.book_id == id)
                .map(|(k, _)| k.clone())
                .collect();
            for key in keys_to_remove {
                page_cache.pop(&key);
            }
        }

        // Remove cached text layers (LruCache doesn't have retain, so collect and pop)
        {
            let mut text_cache = self.text_cache.write().await;
            let keys_to_remove: Vec<(String, usize)> = text_cache
                .iter()
                .filter(|((book_id, _), _)| book_id == id)
                .map(|(k, _)| k.clone())
                .collect();
            for key in keys_to_remove {
                text_cache.pop(&key);
            }
        }
    }

    /// Clear the entire cache
    pub async fn clear(&self) {
        {
            let mut pdfs = self.pdfs.write().await;
            pdfs.clear();
        }
        {
            let mut parsers = self.parsers.write().await;
            parsers.clear();
        }
        {
            let mut page_cache = self.page_cache.write().await;
            page_cache.clear();
        }
        {
            let mut text_cache = self.text_cache.write().await;
            text_cache.clear();
        }
    }

    /// Get the number of cached PDFs
    pub async fn len(&self) -> usize {
        let pdfs = self.pdfs.read().await;
        pdfs.len()
    }

    /// Check if cache is empty
    pub async fn is_empty(&self) -> bool {
        let pdfs = self.pdfs.read().await;
        pdfs.is_empty()
    }

    /// Get page cache statistics
    pub async fn page_cache_stats(&self) -> (usize, usize) {
        let page_cache = self.page_cache.read().await;
        (page_cache.len(), page_cache.cap().get())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_pdf_cache_creation() {
        let cache = PdfCache::new();
        assert!(cache.is_empty().await);
        assert_eq!(cache.len().await, 0);
    }

    #[tokio::test]
    async fn test_pdf_cache_with_capacity() {
        let cache = PdfCache::with_capacity(50);
        let (_, cap) = cache.page_cache_stats().await;
        assert_eq!(cap, 50);
    }

    #[tokio::test]
    async fn test_page_cache_key() {
        let request = PageRenderRequest {
            page: 1,
            scale: 1.5,
            format: ImageFormat::Png,
            rotation: 0,
        };
        let key = PageCacheKey::new("test-book", &request);
        assert_eq!(key.book_id, "test-book");
        assert_eq!(key.page, 1);
        assert_eq!(key.scale, 150); // 1.5 * 100
    }
}
