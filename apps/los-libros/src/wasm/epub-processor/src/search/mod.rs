//! Full-text search module
//!
//! Provides search indexing and querying for EPUB content.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use unicode_normalization::UnicodeNormalization;

use crate::epub::{parser, EpubBook};

#[derive(Error, Debug)]
pub enum SearchError {
    #[error("Failed to build index: {0}")]
    IndexBuildError(String),

    #[error("Search failed: {0}")]
    SearchFailed(String),
}

/// A search result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    /// The chapter href
    pub href: String,
    /// Spine index
    pub spine_index: usize,
    /// CFI of the result location
    pub cfi: String,
    /// Text excerpt with match highlighted
    pub excerpt: String,
    /// Character position in chapter
    pub position: usize,
}

/// Search index for a book
pub struct SearchIndex {
    /// Indexed chapters
    chapters: Vec<ChapterIndex>,
}

/// Index for a single chapter
struct ChapterIndex {
    href: String,
    spine_index: usize,
    /// Normalized text content
    text: String,
    /// Original text (for excerpts)
    original_text: String,
}

impl SearchIndex {
    /// Build a search index for a book
    pub fn build(book: &EpubBook) -> Result<Self, SearchError> {
        let mut chapters = Vec::new();

        for (spine_index, item) in book.spine.iter().enumerate() {
            // Get chapter content
            let content = match book.get_chapter_content(&item.href) {
                Ok(c) => c,
                Err(_) => continue, // Skip chapters we can't read
            };

            // Extract plain text
            let original_text = parser::extract_plain_text(&content.html);
            let text = normalize_for_search(&original_text);

            chapters.push(ChapterIndex {
                href: item.href.clone(),
                spine_index,
                text,
                original_text,
            });
        }

        Ok(Self { chapters })
    }

    /// Search for a query in the book
    pub fn search(&self, query: &str, limit: usize) -> Vec<SearchResult> {
        let normalized_query = normalize_for_search(query);
        let mut results = Vec::new();

        for chapter in &self.chapters {
            // Find all occurrences in this chapter
            let mut search_pos = 0;
            while let Some(pos) = chapter.text[search_pos..].find(&normalized_query) {
                let absolute_pos = search_pos + pos;

                // Create excerpt
                let excerpt = create_excerpt(&chapter.original_text, absolute_pos, query.len());

                // Generate CFI (simplified - would need actual DOM mapping)
                let cfi = format!(
                    "epubcfi(/6/{}!/4:{})",
                    (chapter.spine_index + 1) * 2,
                    absolute_pos
                );

                results.push(SearchResult {
                    href: chapter.href.clone(),
                    spine_index: chapter.spine_index,
                    cfi,
                    excerpt,
                    position: absolute_pos,
                });

                // Move past this match
                search_pos = absolute_pos + normalized_query.len();

                if results.len() >= limit {
                    return results;
                }
            }
        }

        results
    }

    /// Get total word count
    pub fn word_count(&self) -> usize {
        self.chapters.iter()
            .map(|c| c.text.split_whitespace().count())
            .sum()
    }
}

/// Normalize text for search (lowercase, remove accents, normalize unicode)
fn normalize_for_search(text: &str) -> String {
    text.nfkd()
        .filter(|c| !c.is_mark_nonspacing())
        .collect::<String>()
        .to_lowercase()
}

/// Create an excerpt around a match position
fn create_excerpt(text: &str, position: usize, match_len: usize) -> String {
    const CONTEXT_CHARS: usize = 50;

    let start = position.saturating_sub(CONTEXT_CHARS);
    let end = (position + match_len + CONTEXT_CHARS).min(text.len());

    // Find word boundaries
    let start = text[..start].rfind(char::is_whitespace)
        .map(|i| i + 1)
        .unwrap_or(start);
    let end = text[end..].find(char::is_whitespace)
        .map(|i| end + i)
        .unwrap_or(end);

    let excerpt = &text[start..end];

    // Add ellipsis if truncated
    let prefix = if start > 0 { "..." } else { "" };
    let suffix = if end < text.len() { "..." } else { "" };

    format!("{}{}{}", prefix, excerpt.trim(), suffix)
}

trait IsMarkNonspacing {
    fn is_mark_nonspacing(&self) -> bool;
}

impl IsMarkNonspacing for char {
    fn is_mark_nonspacing(&self) -> bool {
        matches!(
            unicode_normalization::char::decompose_canonical(*self, |_| {}),
            ()
        ) && self.is_combining_mark()
    }
}

trait IsCombiningMark {
    fn is_combining_mark(&self) -> bool;
}

impl IsCombiningMark for char {
    fn is_combining_mark(&self) -> bool {
        let code = *self as u32;
        // Combining Diacritical Marks
        (0x0300..=0x036F).contains(&code) ||
        // Combining Diacritical Marks Extended
        (0x1AB0..=0x1AFF).contains(&code) ||
        // Combining Diacritical Marks Supplement
        (0x1DC0..=0x1DFF).contains(&code) ||
        // Combining Diacritical Marks for Symbols
        (0x20D0..=0x20FF).contains(&code) ||
        // Combining Half Marks
        (0xFE20..=0xFE2F).contains(&code)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_for_search() {
        assert_eq!(normalize_for_search("Hello World"), "hello world");
        assert_eq!(normalize_for_search("Café"), "cafe");
        assert_eq!(normalize_for_search("Naïve"), "naive");
    }

    #[test]
    fn test_create_excerpt() {
        let text = "This is a test of the excerpt creation function for search results.";
        let excerpt = create_excerpt(text, 10, 4);
        assert!(excerpt.contains("test"));
    }
}
