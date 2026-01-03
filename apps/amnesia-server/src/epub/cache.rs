//! Book cache for parsed EPUBs
//!
//! In-memory cache to avoid re-parsing EPUBs on every request.

use std::collections::HashMap;
use std::io::{Read, Seek};
use std::path::Path;
use std::sync::Arc;

use tokio::sync::RwLock;

use super::parser::{EpubParser, ParseError};
use super::types::{ChapterContent, ParsedBook, Resource};

/// Thread-safe book cache
#[derive(Clone)]
pub struct BookCache {
    /// Parsed book metadata cache
    books: Arc<RwLock<HashMap<String, ParsedBook>>>,
    /// Active parser instances (for content retrieval)
    parsers: Arc<RwLock<HashMap<String, Arc<EpubParser>>>>,
}

impl Default for BookCache {
    fn default() -> Self {
        Self::new()
    }
}

impl BookCache {
    /// Create a new empty cache
    pub fn new() -> Self {
        Self {
            books: Arc::new(RwLock::new(HashMap::new())),
            parsers: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Load and cache a book from a file path
    pub async fn load_from_path<P: AsRef<Path>>(&self, path: P) -> Result<ParsedBook, ParseError> {
        let parser = EpubParser::from_path(&path)?;
        let book = parser.parse()?;
        let id = book.id.clone();

        // Cache the parsed metadata
        {
            let mut books = self.books.write().await;
            books.insert(id.clone(), book.clone());
        }

        // Cache the parser for content retrieval
        {
            let mut parsers = self.parsers.write().await;
            parsers.insert(id, Arc::new(parser));
        }

        Ok(book)
    }

    /// Load and cache a book from bytes
    pub async fn load_from_reader<R: Read + Seek + Send + Sync + 'static>(
        &self,
        reader: R,
        book_id: String,
    ) -> Result<ParsedBook, ParseError> {
        let parser = EpubParser::from_reader(reader, book_id)?;
        let book = parser.parse()?;
        let id = book.id.clone();

        // Cache the parsed metadata
        {
            let mut books = self.books.write().await;
            books.insert(id.clone(), book.clone());
        }

        // Cache the parser for content retrieval
        {
            let mut parsers = self.parsers.write().await;
            parsers.insert(id, Arc::new(parser));
        }

        Ok(book)
    }

    /// Get cached book metadata
    pub async fn get_book(&self, id: &str) -> Option<ParsedBook> {
        let books = self.books.read().await;
        books.get(id).cloned()
    }

    /// Get all cached books
    pub async fn get_all_books(&self) -> Vec<ParsedBook> {
        let books = self.books.read().await;
        books.values().cloned().collect()
    }

    /// Check if a book is cached
    pub async fn contains(&self, id: &str) -> bool {
        let books = self.books.read().await;
        books.contains_key(id)
    }

    /// Get chapter content from a cached book
    pub async fn get_chapter(
        &self,
        book_id: &str,
        spine_index: usize,
    ) -> Result<ChapterContent, ParseError> {
        let parsers = self.parsers.read().await;
        let parser = parsers
            .get(book_id)
            .ok_or_else(|| ParseError::ContentError(format!("Book {} not cached", book_id)))?;

        parser.get_chapter(spine_index)
    }

    /// Get chapter content by href from a cached book
    pub async fn get_chapter_by_href(
        &self,
        book_id: &str,
        href: &str,
    ) -> Result<ChapterContent, ParseError> {
        let parsers = self.parsers.read().await;
        let parser = parsers
            .get(book_id)
            .ok_or_else(|| ParseError::ContentError(format!("Book {} not cached", book_id)))?;

        parser.get_chapter_by_href(href)
    }

    /// Get a resource from a cached book
    pub async fn get_resource(&self, book_id: &str, href: &str) -> Result<Resource, ParseError> {
        let parsers = self.parsers.read().await;
        let parser = parsers
            .get(book_id)
            .ok_or_else(|| ParseError::ContentError(format!("Book {} not cached", book_id)))?;

        parser.get_resource(href)
    }

    /// Remove a book from the cache
    pub async fn remove(&self, id: &str) {
        {
            let mut books = self.books.write().await;
            books.remove(id);
        }
        {
            let mut parsers = self.parsers.write().await;
            parsers.remove(id);
        }
    }

    /// Clear the entire cache
    pub async fn clear(&self) {
        {
            let mut books = self.books.write().await;
            books.clear();
        }
        {
            let mut parsers = self.parsers.write().await;
            parsers.clear();
        }
    }

    /// Get the number of cached books
    pub async fn len(&self) -> usize {
        let books = self.books.read().await;
        books.len()
    }

    /// Check if cache is empty
    pub async fn is_empty(&self) -> bool {
        let books = self.books.read().await;
        books.is_empty()
    }
}
