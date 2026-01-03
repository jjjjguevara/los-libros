//! Book types and structures

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// A book in the library
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryBook {
    /// Unique identifier
    pub id: String,

    /// Book title
    pub title: String,

    /// Primary author
    pub author: Option<String>,

    /// Author sort name (e.g., "Lastname, Firstname")
    pub author_sort: Option<String>,

    /// Additional authors
    pub authors: Vec<String>,

    /// Publisher
    pub publisher: Option<String>,

    /// Publication date
    pub pubdate: Option<String>,

    /// Language code (e.g., "en", "es")
    pub language: Option<String>,

    /// Book description/summary
    pub description: Option<String>,

    /// Series name
    pub series: Option<String>,

    /// Position in series
    pub series_index: Option<f32>,

    /// Tags/genres
    pub tags: Vec<String>,

    /// Identifiers (isbn, uuid, amazon, etc.)
    pub identifiers: HashMap<String, String>,

    /// Available formats with their S3 keys
    pub formats: Vec<BookFormat>,

    /// Cover image S3 key
    pub cover_key: Option<String>,

    /// Path prefix in S3 (Author/Title)
    pub s3_prefix: String,

    /// When the book was added to the library
    pub added_at: DateTime<Utc>,

    /// When the book metadata was last updated
    pub updated_at: DateTime<Utc>,
}

impl LibraryBook {
    /// Create a new book with minimal information
    pub fn new(title: String, s3_prefix: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            title,
            author: None,
            author_sort: None,
            authors: Vec::new(),
            publisher: None,
            pubdate: None,
            language: None,
            description: None,
            series: None,
            series_index: None,
            tags: Vec::new(),
            identifiers: HashMap::new(),
            formats: Vec::new(),
            cover_key: None,
            s3_prefix,
            added_at: now,
            updated_at: now,
        }
    }

    /// Get the primary format (prefer EPUB)
    pub fn primary_format(&self) -> Option<&BookFormat> {
        // Prefer EPUB, then PDF, then others
        self.formats
            .iter()
            .find(|f| f.format == FormatType::Epub)
            .or_else(|| self.formats.iter().find(|f| f.format == FormatType::Pdf))
            .or_else(|| self.formats.first())
    }

    /// Get the EPUB format if available
    pub fn epub(&self) -> Option<&BookFormat> {
        self.formats.iter().find(|f| f.format == FormatType::Epub)
    }

    /// Get display author (first author or "Unknown")
    pub fn display_author(&self) -> &str {
        self.author.as_deref().unwrap_or("Unknown Author")
    }
}

/// A book format (file type)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookFormat {
    /// Format type
    pub format: FormatType,

    /// S3 key for this format
    pub s3_key: String,

    /// File size in bytes
    pub size: i64,
}

/// Supported ebook formats
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FormatType {
    Epub,
    Pdf,
    Mobi,
    Azw3,
    Cbz,
    Cbr,
    Fb2,
    Other,
}

impl FormatType {
    /// Parse format from file extension
    pub fn from_extension(ext: &str) -> Self {
        match ext.to_lowercase().as_str() {
            "epub" => FormatType::Epub,
            "pdf" => FormatType::Pdf,
            "mobi" => FormatType::Mobi,
            "azw3" | "azw" => FormatType::Azw3,
            "cbz" => FormatType::Cbz,
            "cbr" => FormatType::Cbr,
            "fb2" => FormatType::Fb2,
            _ => FormatType::Other,
        }
    }

    /// Get MIME type for this format
    pub fn mime_type(&self) -> &'static str {
        match self {
            FormatType::Epub => "application/epub+zip",
            FormatType::Pdf => "application/pdf",
            FormatType::Mobi => "application/x-mobipocket-ebook",
            FormatType::Azw3 => "application/vnd.amazon.mobi8-ebook",
            FormatType::Cbz => "application/vnd.comicbook+zip",
            FormatType::Cbr => "application/vnd.comicbook-rar",
            FormatType::Fb2 => "application/x-fictionbook+xml",
            FormatType::Other => "application/octet-stream",
        }
    }
}

/// Library statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryStats {
    pub total_books: usize,
    pub total_authors: usize,
    pub total_series: usize,
    pub formats: HashMap<String, usize>,
    pub languages: HashMap<String, usize>,
    pub last_scan: Option<DateTime<Utc>>,
}
