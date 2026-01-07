//! PDF cache for rendered pages and text layers
//!
//! The cache now delegates all PDF parsing operations to PdfService,
//! which manages PDFium's lifecycle through an Actor pattern.
//! This cache provides:
//! - LRU caching for rendered page images
//! - LRU caching for text layers
//! - Concurrency limiting for memory management during renders

use std::num::NonZeroUsize;
use std::sync::Arc;

use lru::LruCache;
use tokio::sync::{RwLock, Semaphore};

use super::parser::PdfParseError;
use super::service::{PdfService, PdfServiceError};
use super::types::{ImageFormat, PageRenderRequest, ParsedPdf, TextLayer};

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

/// Default number of concurrent render operations
const DEFAULT_CONCURRENT_RENDERS: usize = 4;

/// Thread-safe PDF cache that delegates to PdfService
#[derive(Clone)]
pub struct PdfCache {
    /// The PDF service actor handle
    pdf_service: PdfService,
    /// Parsed PDF metadata cache (LRU to avoid service calls for metadata)
    pdfs: Arc<RwLock<LruCache<String, ParsedPdf>>>,
    /// LRU cache for rendered pages
    page_cache: Arc<RwLock<LruCache<PageCacheKey, Vec<u8>>>>,
    /// LRU cache for text layers (bounded to prevent memory leaks)
    text_cache: Arc<RwLock<LruCache<(String, usize), TextLayer>>>,
    /// Semaphore to limit concurrent render operations (memory management)
    render_semaphore: Arc<Semaphore>,
}

impl PdfCache {
    /// Create a new cache with the given PdfService
    pub fn new(pdf_service: PdfService) -> Self {
        Self::with_config(pdf_service, 100, DEFAULT_CONCURRENT_RENDERS)
    }

    /// Create a cache with specified page cache capacity
    pub fn with_capacity(pdf_service: PdfService, page_cache_size: usize) -> Self {
        Self::with_config(pdf_service, page_cache_size, DEFAULT_CONCURRENT_RENDERS)
    }

    /// Create a cache with page and concurrency config
    ///
    /// # Arguments
    /// * `pdf_service` - The PdfService actor handle
    /// * `page_cache_size` - Maximum number of rendered pages to cache
    /// * `concurrent_renders` - Maximum concurrent render operations (memory management)
    pub fn with_config(
        pdf_service: PdfService,
        page_cache_size: usize,
        concurrent_renders: usize,
    ) -> Self {
        let page_size =
            NonZeroUsize::new(page_cache_size).unwrap_or(NonZeroUsize::new(100).unwrap());
        // Text cache is 2x page cache size (text layers are smaller than rendered pages)
        let text_size =
            NonZeroUsize::new(page_cache_size * 2).unwrap_or(NonZeroUsize::new(200).unwrap());
        // PDF metadata cache
        let pdf_size = NonZeroUsize::new(50).unwrap();
        // Ensure at least 1 concurrent render
        let renders = concurrent_renders.max(1);

        Self {
            pdf_service,
            pdfs: Arc::new(RwLock::new(LruCache::new(pdf_size))),
            page_cache: Arc::new(RwLock::new(LruCache::new(page_size))),
            text_cache: Arc::new(RwLock::new(LruCache::new(text_size))),
            render_semaphore: Arc::new(Semaphore::new(renders)),
        }
    }

    /// Load and cache a PDF from bytes
    pub async fn load_from_bytes(
        &self,
        data: &[u8],
        book_id: String,
    ) -> Result<ParsedPdf, PdfParseError> {
        // Delegate to PdfService
        let pdf = self
            .pdf_service
            .parse_from_bytes(data.to_vec(), book_id.clone())
            .await
            .map_err(|e| PdfParseError::LoadError(e.to_string()))?;

        // Cache the metadata locally
        {
            let mut pdfs = self.pdfs.write().await;
            pdfs.put(book_id, pdf.clone());
        }

        Ok(pdf)
    }

    /// Load and cache a PDF from a file path
    pub async fn load_from_path(
        &self,
        path: impl AsRef<std::path::Path>,
        book_id: String,
    ) -> Result<ParsedPdf, PdfParseError> {
        let path_buf = path.as_ref().to_path_buf();

        // Delegate to PdfService
        let pdf = self
            .pdf_service
            .parse_from_path(path_buf, book_id.clone())
            .await
            .map_err(|e| PdfParseError::LoadError(e.to_string()))?;

        // Cache the metadata locally
        {
            let mut pdfs = self.pdfs.write().await;
            pdfs.put(book_id, pdf.clone());
        }

        Ok(pdf)
    }

    /// Get cached PDF metadata (promotes to most-recently-used)
    pub async fn get_pdf(&self, id: &str) -> Option<ParsedPdf> {
        // Try local cache first
        let mut pdfs = self.pdfs.write().await;
        pdfs.get(id).cloned()
    }

    /// Get all cached PDFs (does not update LRU order)
    pub async fn get_all_pdfs(&self) -> Vec<ParsedPdf> {
        let pdfs = self.pdfs.read().await;
        pdfs.iter().map(|(_, v)| v.clone()).collect()
    }

    /// Check if a PDF is cached (peek - does not update LRU order)
    pub async fn contains(&self, id: &str) -> bool {
        // Check local cache first, then service
        {
            let pdfs = self.pdfs.read().await;
            if pdfs.peek(id).is_some() {
                return true;
            }
        }

        // Check service
        self.pdf_service
            .has_pdf(id)
            .await
            .unwrap_or(false)
    }

    /// Render a page (with caching and concurrency limiting)
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

        // Acquire render permit (limits concurrent renders for memory management)
        let _permit = self.render_semaphore.acquire().await.map_err(|_| {
            PdfParseError::RenderError("Render semaphore closed".to_string())
        })?;

        // Delegate to PdfService
        let data = self
            .pdf_service
            .render_page(book_id, request.clone())
            .await
            .map_err(|e| PdfParseError::RenderError(e.to_string()))?;

        // Cache the result
        {
            let mut page_cache = self.page_cache.write().await;
            page_cache.put(cache_key, data.clone());
        }

        Ok(data)
    }

    /// Render a thumbnail (with caching and concurrency limiting)
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

        // Acquire render permit (limits concurrent renders for memory management)
        let _permit = self.render_semaphore.acquire().await.map_err(|_| {
            PdfParseError::RenderError("Render semaphore closed".to_string())
        })?;

        // Delegate to PdfService
        let data = self
            .pdf_service
            .render_thumbnail(book_id, page, max_size)
            .await
            .map_err(|e| PdfParseError::RenderError(e.to_string()))?;

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

        // Check text cache first
        {
            let mut text_cache = self.text_cache.write().await;
            if let Some(layer) = text_cache.get(&cache_key) {
                return Ok(layer.clone());
            }
        }

        // Delegate to PdfService
        let layer = self
            .pdf_service
            .get_text_layer(book_id, page)
            .await
            .map_err(|e| PdfParseError::LoadError(e.to_string()))?;

        // Cache the result
        {
            let mut text_cache = self.text_cache.write().await;
            text_cache.put(cache_key, layer.clone());
        }

        Ok(layer)
    }

    /// Search PDF content
    pub async fn search(
        &self,
        book_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<super::types::PdfSearchResult>, PdfParseError> {
        // Delegate to PdfService (no caching for search results)
        self.pdf_service
            .search(book_id, query, limit)
            .await
            .map_err(|e| PdfParseError::LoadError(e.to_string()))
    }

    /// Get page text
    pub async fn get_page_text(&self, book_id: &str, page: usize) -> Result<String, PdfParseError> {
        // Delegate to PdfService
        self.pdf_service
            .get_page_text(book_id, page)
            .await
            .map_err(|e| PdfParseError::LoadError(e.to_string()))
    }

    /// Get page dimensions
    pub async fn get_page_dimensions(
        &self,
        book_id: &str,
        page: usize,
    ) -> Result<super::types::PageDimensions, PdfParseError> {
        // Delegate to PdfService
        self.pdf_service
            .get_page_dimensions(book_id, page)
            .await
            .map_err(|e| PdfParseError::LoadError(e.to_string()))
    }

    /// Remove a PDF from the cache
    pub async fn remove(&self, id: &str) {
        // Remove from local metadata cache
        {
            let mut pdfs = self.pdfs.write().await;
            pdfs.pop(id);
        }

        // Tell service to remove the PDF
        let _ = self.pdf_service.remove_pdf(id).await;

        // Remove cached pages
        {
            let mut page_cache = self.page_cache.write().await;
            let keys_to_remove: Vec<PageCacheKey> = page_cache
                .iter()
                .filter(|(k, _)| k.book_id == id)
                .map(|(k, _)| k.clone())
                .collect();
            for key in keys_to_remove {
                page_cache.pop(&key);
            }
        }

        // Remove cached text layers
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
        // Clear local caches
        {
            let mut pdfs = self.pdfs.write().await;
            pdfs.clear();
        }
        {
            let mut page_cache = self.page_cache.write().await;
            page_cache.clear();
        }
        {
            let mut text_cache = self.text_cache.write().await;
            text_cache.clear();
        }

        // Get all PDFs from service and remove them
        if let Ok(ids) = self.pdf_service.list_pdfs().await {
            for id in ids {
                let _ = self.pdf_service.remove_pdf(&id).await;
            }
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

    /// Get page cache statistics (current, capacity)
    pub async fn page_cache_stats(&self) -> (usize, usize) {
        let page_cache = self.page_cache.read().await;
        (page_cache.len(), page_cache.cap().get())
    }

    /// Shutdown the underlying PDF service
    pub async fn shutdown(&self) -> Result<(), PdfServiceError> {
        self.pdf_service.shutdown().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: Tests require PdfService which requires pdfium to be installed
    // Full integration tests should be done through the API endpoints

    #[test]
    fn test_page_cache_key() {
        let request = PageRenderRequest {
            page: 1,
            scale: 1.5,
            format: ImageFormat::Png,
            rotation: 0,
            quality: 85,
        };
        let key = PageCacheKey::new("test-book", &request);
        assert_eq!(key.book_id, "test-book");
        assert_eq!(key.page, 1);
        assert_eq!(key.scale, 150); // 1.5 * 100
    }
}
