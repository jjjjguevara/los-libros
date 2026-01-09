//! Unified document cache with LRU eviction
//!
//! Provides a single caching layer for all document formats (PDF, EPUB).
//! Uses LRU eviction for bounded memory usage.
//!
//! # Thread Safety
//!
//! All caches use `tokio::sync::RwLock` for async-safe access.
//! Parser and renderer instances are wrapped in `Arc` for efficient sharing.

use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::sync::Arc;

use lru::LruCache;
use tokio::sync::RwLock;
use tokio::time::{timeout, Duration};

use super::{
    DocumentError, DocumentParser, DocumentRenderer, DocumentResult, ImageFormat, ParsedDocument,
    RenderRequest, RenderResult, SearchOptions, SearchResult, StructuredText,
};

/// Timeout for document parsing operations
const PARSE_TIMEOUT_SECS: u64 = 30;
/// Timeout for rendering operations
const RENDER_TIMEOUT_SECS: u64 = 30;
/// Timeout for text extraction operations
const TEXT_TIMEOUT_SECS: u64 = 15;
/// Timeout for search operations
const SEARCH_TIMEOUT_SECS: u64 = 30;

/// Cache configuration options
#[derive(Debug, Clone)]
pub struct CacheConfig {
    /// Maximum number of parser instances to keep
    pub max_parsers: usize,
    /// Maximum number of renderer instances to keep
    pub max_renderers: usize,
    /// Maximum number of rendered pages/chapters to cache
    pub max_renders: usize,
    /// Maximum number of structured text entries to cache
    pub max_stext: usize,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self {
            max_parsers: 50,
            max_renderers: 50,
            max_renders: 500,
            max_stext: 1000,
        }
    }
}

/// Cache key for rendered output
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct RenderCacheKey {
    /// Document ID
    pub doc_id: String,
    /// Item index (page or chapter)
    pub item_index: usize,
    /// Scale factor (multiplied by 100 for integer hashing)
    pub scale: u32,
    /// Rotation in degrees
    pub rotation: u16,
    /// Output format
    pub format: ImageFormat,
}

impl RenderCacheKey {
    /// Create a cache key from a render request
    pub fn new(doc_id: &str, request: &RenderRequest) -> Self {
        Self {
            doc_id: doc_id.to_string(),
            item_index: request.item_index,
            scale: (request.scale * 100.0) as u32,
            rotation: request.rotation as u16,
            format: request.format,
        }
    }

    /// Create a cache key for a thumbnail
    pub fn thumbnail(doc_id: &str, item_index: usize, max_size: u32) -> Self {
        Self {
            doc_id: doc_id.to_string(),
            item_index,
            scale: max_size,
            rotation: 0,
            format: ImageFormat::Jpeg,
        }
    }
}

/// Unified document cache for all formats
///
/// Stores parsed metadata, parser/renderer instances, and cached outputs
/// with LRU eviction to bound memory usage.
#[derive(Clone)]
pub struct DocumentCache {
    /// Parsed document metadata (unbounded, small per-document)
    documents: Arc<RwLock<HashMap<String, ParsedDocument>>>,

    /// Parser instances with LRU eviction
    parsers: Arc<RwLock<LruCache<String, Arc<dyn DocumentParser>>>>,

    /// Renderer instances with LRU eviction
    renderers: Arc<RwLock<LruCache<String, Arc<dyn DocumentRenderer>>>>,

    /// Rendered output cache (pages/chapters)
    render_cache: Arc<RwLock<LruCache<RenderCacheKey, Vec<u8>>>>,

    /// Structured text cache
    stext_cache: Arc<RwLock<LruCache<(String, usize), StructuredText>>>,

    /// Configuration
    config: CacheConfig,
}

impl Default for DocumentCache {
    fn default() -> Self {
        Self::new(CacheConfig::default())
    }
}

impl DocumentCache {
    /// Create a new document cache with the given configuration
    pub fn new(config: CacheConfig) -> Self {
        let parsers_size = NonZeroUsize::new(config.max_parsers)
            .unwrap_or(NonZeroUsize::new(50).unwrap());
        let renderers_size = NonZeroUsize::new(config.max_renderers)
            .unwrap_or(NonZeroUsize::new(50).unwrap());
        let renders_size = NonZeroUsize::new(config.max_renders)
            .unwrap_or(NonZeroUsize::new(500).unwrap());
        let stext_size = NonZeroUsize::new(config.max_stext)
            .unwrap_or(NonZeroUsize::new(1000).unwrap());

        Self {
            documents: Arc::new(RwLock::new(HashMap::new())),
            parsers: Arc::new(RwLock::new(LruCache::new(parsers_size))),
            renderers: Arc::new(RwLock::new(LruCache::new(renderers_size))),
            render_cache: Arc::new(RwLock::new(LruCache::new(renders_size))),
            stext_cache: Arc::new(RwLock::new(LruCache::new(stext_size))),
            config,
        }
    }

    /// Store a parsed document and its parser
    pub async fn store_document(
        &self,
        doc_id: String,
        parsed: ParsedDocument,
        parser: Arc<dyn DocumentParser>,
    ) {
        // Store metadata
        {
            let mut docs = self.documents.write().await;
            docs.insert(doc_id.clone(), parsed);
        }

        // Store parser
        {
            let mut parsers = self.parsers.write().await;
            parsers.put(doc_id, parser);
        }
    }

    /// Store a document with both parser and renderer
    pub async fn store_document_with_renderer(
        &self,
        doc_id: String,
        parsed: ParsedDocument,
        parser: Arc<dyn DocumentParser>,
        renderer: Arc<dyn DocumentRenderer>,
    ) {
        // Store metadata
        {
            let mut docs = self.documents.write().await;
            docs.insert(doc_id.clone(), parsed);
        }

        // Store parser
        {
            let mut parsers = self.parsers.write().await;
            parsers.put(doc_id.clone(), parser);
        }

        // Store renderer
        {
            let mut renderers = self.renderers.write().await;
            renderers.put(doc_id, renderer);
        }
    }

    /// Get parsed document metadata
    pub async fn get_document(&self, doc_id: &str) -> Option<ParsedDocument> {
        let docs = self.documents.read().await;
        docs.get(doc_id).cloned()
    }

    /// Get all cached documents
    pub async fn get_all_documents(&self) -> Vec<ParsedDocument> {
        let docs = self.documents.read().await;
        docs.values().cloned().collect()
    }

    /// Check if a document is cached
    pub async fn contains(&self, doc_id: &str) -> bool {
        let docs = self.documents.read().await;
        docs.contains_key(doc_id)
    }

    /// Get parser for a document
    pub async fn get_parser(&self, doc_id: &str) -> Option<Arc<dyn DocumentParser>> {
        let mut parsers = self.parsers.write().await;
        parsers.get(doc_id).cloned()
    }

    /// Get renderer for a document
    pub async fn get_renderer(&self, doc_id: &str) -> Option<Arc<dyn DocumentRenderer>> {
        let mut renderers = self.renderers.write().await;
        renderers.get(doc_id).cloned()
    }

    /// Extract text from a document item with caching
    pub async fn extract_text(
        &self,
        doc_id: &str,
        item_index: usize,
    ) -> DocumentResult<String> {
        let parser = self.get_parser(doc_id).await
            .ok_or_else(|| DocumentError::NotFound(format!("Document {} not cached", doc_id)))?;

        let result = timeout(
            Duration::from_secs(TEXT_TIMEOUT_SECS),
            parser.extract_text(item_index),
        )
        .await
        .map_err(|_| DocumentError::Timeout(TEXT_TIMEOUT_SECS))?;

        result
    }

    /// Get structured text with caching
    pub async fn get_structured_text(
        &self,
        doc_id: &str,
        item_index: usize,
    ) -> DocumentResult<StructuredText> {
        let cache_key = (doc_id.to_string(), item_index);

        // Check cache first
        {
            let mut cache = self.stext_cache.write().await;
            if let Some(stext) = cache.get(&cache_key) {
                return Ok(stext.clone());
            }
        }

        // Get parser and extract
        let parser = self.get_parser(doc_id).await
            .ok_or_else(|| DocumentError::NotFound(format!("Document {} not cached", doc_id)))?;

        let result = timeout(
            Duration::from_secs(TEXT_TIMEOUT_SECS),
            parser.get_structured_text(item_index),
        )
        .await
        .map_err(|_| DocumentError::Timeout(TEXT_TIMEOUT_SECS))??;

        // Cache the result
        {
            let mut cache = self.stext_cache.write().await;
            cache.put(cache_key, result.clone());
        }

        Ok(result)
    }

    /// Search document with timeout
    pub async fn search(
        &self,
        doc_id: &str,
        query: &str,
        options: SearchOptions,
    ) -> DocumentResult<Vec<SearchResult>> {
        let parser = self.get_parser(doc_id).await
            .ok_or_else(|| DocumentError::NotFound(format!("Document {} not cached", doc_id)))?;

        let result = timeout(
            Duration::from_secs(SEARCH_TIMEOUT_SECS),
            parser.search(query, options),
        )
        .await
        .map_err(|_| DocumentError::Timeout(SEARCH_TIMEOUT_SECS))?;

        result
    }

    /// Render an item with caching
    pub async fn render(
        &self,
        doc_id: &str,
        request: &RenderRequest,
    ) -> DocumentResult<RenderResult> {
        let cache_key = RenderCacheKey::new(doc_id, request);

        // Check cache first
        {
            let mut cache = self.render_cache.write().await;
            if let Some(data) = cache.get(&cache_key) {
                return Ok(RenderResult {
                    data: data.clone(),
                    format: request.format,
                    width: 0,  // TODO: cache dimensions
                    height: 0,
                });
            }
        }

        // Get renderer and render
        let renderer = self.get_renderer(doc_id).await
            .ok_or_else(|| DocumentError::NotFound(format!("Document {} not cached", doc_id)))?;

        let result = timeout(
            Duration::from_secs(RENDER_TIMEOUT_SECS),
            renderer.render_item(request),
        )
        .await
        .map_err(|_| DocumentError::Timeout(RENDER_TIMEOUT_SECS))??;

        // Cache the result
        {
            let mut cache = self.render_cache.write().await;
            cache.put(cache_key, result.data.clone());
        }

        Ok(result)
    }

    /// Render a thumbnail with caching
    pub async fn render_thumbnail(
        &self,
        doc_id: &str,
        item_index: usize,
        max_size: u32,
    ) -> DocumentResult<RenderResult> {
        let cache_key = RenderCacheKey::thumbnail(doc_id, item_index, max_size);

        // Check cache first
        {
            let mut cache = self.render_cache.write().await;
            if let Some(data) = cache.get(&cache_key) {
                return Ok(RenderResult {
                    data: data.clone(),
                    format: ImageFormat::Jpeg,
                    width: 0,
                    height: 0,
                });
            }
        }

        // Get renderer and render
        let renderer = self.get_renderer(doc_id).await
            .ok_or_else(|| DocumentError::NotFound(format!("Document {} not cached", doc_id)))?;

        let result = timeout(
            Duration::from_secs(RENDER_TIMEOUT_SECS),
            renderer.render_thumbnail(item_index, max_size),
        )
        .await
        .map_err(|_| DocumentError::Timeout(RENDER_TIMEOUT_SECS))??;

        // Cache the result
        {
            let mut cache = self.render_cache.write().await;
            cache.put(cache_key, result.data.clone());
        }

        Ok(result)
    }

    /// Remove a document from all caches
    pub async fn remove(&self, doc_id: &str) {
        // Remove metadata
        {
            let mut docs = self.documents.write().await;
            docs.remove(doc_id);
        }

        // Remove parser
        {
            let mut parsers = self.parsers.write().await;
            parsers.pop(doc_id);
        }

        // Remove renderer
        {
            let mut renderers = self.renderers.write().await;
            renderers.pop(doc_id);
        }

        // Remove cached renders
        {
            let mut cache = self.render_cache.write().await;
            let keys_to_remove: Vec<RenderCacheKey> = cache
                .iter()
                .filter(|(k, _)| k.doc_id == doc_id)
                .map(|(k, _)| k.clone())
                .collect();
            for key in keys_to_remove {
                cache.pop(&key);
            }
        }

        // Remove cached structured text
        {
            let mut cache = self.stext_cache.write().await;
            let keys_to_remove: Vec<(String, usize)> = cache
                .iter()
                .filter(|((id, _), _)| id == doc_id)
                .map(|(k, _)| k.clone())
                .collect();
            for key in keys_to_remove {
                cache.pop(&key);
            }
        }
    }

    /// Clear all caches
    pub async fn clear(&self) {
        {
            let mut docs = self.documents.write().await;
            docs.clear();
        }
        {
            let mut parsers = self.parsers.write().await;
            parsers.clear();
        }
        {
            let mut renderers = self.renderers.write().await;
            renderers.clear();
        }
        {
            let mut cache = self.render_cache.write().await;
            cache.clear();
        }
        {
            let mut cache = self.stext_cache.write().await;
            cache.clear();
        }
    }

    /// Get the number of cached documents
    pub async fn len(&self) -> usize {
        let docs = self.documents.read().await;
        docs.len()
    }

    /// Check if cache is empty
    pub async fn is_empty(&self) -> bool {
        let docs = self.documents.read().await;
        docs.is_empty()
    }

    /// Get cache statistics
    pub async fn stats(&self) -> CacheStats {
        let documents = {
            let docs = self.documents.read().await;
            docs.len()
        };
        let parsers = {
            let parsers = self.parsers.read().await;
            (parsers.len(), parsers.cap().get())
        };
        let renderers = {
            let renderers = self.renderers.read().await;
            (renderers.len(), renderers.cap().get())
        };
        let renders = {
            let cache = self.render_cache.read().await;
            (cache.len(), cache.cap().get())
        };
        let stext = {
            let cache = self.stext_cache.read().await;
            (cache.len(), cache.cap().get())
        };

        CacheStats {
            documents,
            parsers_used: parsers.0,
            parsers_capacity: parsers.1,
            renderers_used: renderers.0,
            renderers_capacity: renderers.1,
            renders_used: renders.0,
            renders_capacity: renders.1,
            stext_used: stext.0,
            stext_capacity: stext.1,
        }
    }
}

/// Cache statistics
#[derive(Debug, Clone)]
pub struct CacheStats {
    /// Number of cached document metadata entries
    pub documents: usize,
    /// Number of cached parsers
    pub parsers_used: usize,
    /// Parser cache capacity
    pub parsers_capacity: usize,
    /// Number of cached renderers
    pub renderers_used: usize,
    /// Renderer cache capacity
    pub renderers_capacity: usize,
    /// Number of cached render outputs
    pub renders_used: usize,
    /// Render cache capacity
    pub renders_capacity: usize,
    /// Number of cached structured text entries
    pub stext_used: usize,
    /// Structured text cache capacity
    pub stext_capacity: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_cache_creation() {
        let cache = DocumentCache::default();
        assert!(cache.is_empty().await);
        assert_eq!(cache.len().await, 0);
    }

    #[tokio::test]
    async fn test_cache_stats() {
        let config = CacheConfig {
            max_parsers: 10,
            max_renderers: 10,
            max_renders: 100,
            max_stext: 200,
        };
        let cache = DocumentCache::new(config);
        let stats = cache.stats().await;

        assert_eq!(stats.parsers_capacity, 10);
        assert_eq!(stats.renderers_capacity, 10);
        assert_eq!(stats.renders_capacity, 100);
        assert_eq!(stats.stext_capacity, 200);
    }

    #[tokio::test]
    async fn test_render_cache_key() {
        let request = RenderRequest {
            item_index: 5,
            scale: 1.5,
            rotation: 90,
            format: ImageFormat::Png,
            clip: None,
            background: None,
        };
        let key = RenderCacheKey::new("doc-123", &request);

        assert_eq!(key.doc_id, "doc-123");
        assert_eq!(key.item_index, 5);
        assert_eq!(key.scale, 150); // 1.5 * 100
        assert_eq!(key.rotation, 90);
    }

    #[tokio::test]
    async fn test_thumbnail_cache_key() {
        let key = RenderCacheKey::thumbnail("doc-456", 0, 256);

        assert_eq!(key.doc_id, "doc-456");
        assert_eq!(key.item_index, 0);
        assert_eq!(key.scale, 256);
        assert_eq!(key.format, ImageFormat::Jpeg);
    }
}
