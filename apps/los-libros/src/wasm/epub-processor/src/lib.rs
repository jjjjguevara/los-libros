//! EPUB Processor for Los Libros
//!
//! A WASM-based EPUB processor that provides:
//! - EPUB parsing and extraction
//! - CFI (Canonical Fragment Identifier) generation and resolution
//! - Full-text search with indexing
//!
//! This crate is designed to work entirely in the browser without a server.

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

pub mod epub;
pub mod cfi;
pub mod search;

// Re-export common types
pub use epub::{ParsedBook, ChapterContent, BookMetadata, TocEntry};
pub use cfi::{Cfi, CfiLocation};
pub use search::{SearchResult, SearchIndex};

/// Initialize the WASM module
/// Call this before using any other functions
#[wasm_bindgen(start)]
pub fn init() {
    // Set up better panic messages in debug mode
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// EPUB Processor - main interface for working with EPUB files
#[wasm_bindgen]
pub struct EpubProcessor {
    books: std::collections::HashMap<String, epub::EpubBook>,
    search_indices: std::collections::HashMap<String, search::SearchIndex>,
}

#[wasm_bindgen]
impl EpubProcessor {
    /// Create a new EPUB processor instance
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            books: std::collections::HashMap::new(),
            search_indices: std::collections::HashMap::new(),
        }
    }

    /// Load an EPUB file from raw bytes
    /// Returns a Promise that resolves to a ParsedBook object
    #[wasm_bindgen(js_name = "loadBook")]
    pub async fn load_book(&mut self, data: &[u8]) -> Result<JsValue, JsValue> {
        let book = epub::EpubBook::from_bytes(data)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let book_id = book.id.clone();
        let parsed = book.to_parsed_book();

        // Store the book for later access
        self.books.insert(book_id.clone(), book);

        // Return the parsed book info
        serde_wasm_bindgen::to_value(&parsed)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Get a chapter's content by href
    #[wasm_bindgen(js_name = "getChapter")]
    pub fn get_chapter(&self, book_id: &str, href: &str) -> Result<JsValue, JsValue> {
        let book = self.books.get(book_id)
            .ok_or_else(|| JsValue::from_str("Book not found"))?;

        let content = book.get_chapter_content(href)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        serde_wasm_bindgen::to_value(&content)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Get a resource (image, CSS, etc.) by href
    #[wasm_bindgen(js_name = "getResource")]
    pub fn get_resource(&self, book_id: &str, href: &str) -> Result<Vec<u8>, JsValue> {
        let book = self.books.get(book_id)
            .ok_or_else(|| JsValue::from_str("Book not found"))?;

        book.get_resource(href)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Generate a CFI from a location
    #[wasm_bindgen(js_name = "generateCfi")]
    pub fn generate_cfi(
        &self,
        book_id: &str,
        spine_index: usize,
        path: &str,
        offset: usize,
    ) -> Result<String, JsValue> {
        let book = self.books.get(book_id)
            .ok_or_else(|| JsValue::from_str("Book not found"))?;

        cfi::generate_cfi(book, spine_index, path, offset)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Resolve a CFI to a location
    #[wasm_bindgen(js_name = "resolveCfi")]
    pub fn resolve_cfi(&self, book_id: &str, cfi_str: &str) -> Result<JsValue, JsValue> {
        let book = self.books.get(book_id)
            .ok_or_else(|| JsValue::from_str("Book not found"))?;

        let location = cfi::resolve_cfi(book, cfi_str)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        serde_wasm_bindgen::to_value(&location)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Build a search index for a book
    #[wasm_bindgen(js_name = "buildSearchIndex")]
    pub async fn build_search_index(&mut self, book_id: &str) -> Result<(), JsValue> {
        let book = self.books.get(book_id)
            .ok_or_else(|| JsValue::from_str("Book not found"))?;

        let index = search::SearchIndex::build(book)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        self.search_indices.insert(book_id.to_string(), index);
        Ok(())
    }

    /// Search a book's content
    #[wasm_bindgen(js_name = "search")]
    pub fn search(&self, book_id: &str, query: &str, limit: usize) -> Result<JsValue, JsValue> {
        let index = self.search_indices.get(book_id)
            .ok_or_else(|| JsValue::from_str("Search index not built. Call buildSearchIndex first."))?;

        let results = index.search(query, limit);

        serde_wasm_bindgen::to_value(&results)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Unload a book to free memory
    #[wasm_bindgen(js_name = "unloadBook")]
    pub fn unload_book(&mut self, book_id: &str) {
        self.books.remove(book_id);
        self.search_indices.remove(book_id);
    }

    /// Get list of loaded book IDs
    #[wasm_bindgen(js_name = "getLoadedBooks")]
    pub fn get_loaded_books(&self) -> Vec<String> {
        self.books.keys().cloned().collect()
    }
}

impl Default for EpubProcessor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_processor_creation() {
        let processor = EpubProcessor::new();
        assert!(processor.get_loaded_books().is_empty());
    }
}
