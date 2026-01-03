//! Library scanner for Calibre folder structure
//!
//! Scans S3 bucket for books following Calibre's Author/Title structure.

use chrono::Utc;
use std::collections::{HashMap, HashSet};

use crate::error::Result;
use crate::storage::{ListOptions, S3Client};

use super::book::{BookFormat, FormatType, LibraryBook, LibraryStats};
use super::metadata::CalibreMetadata;

/// Scanner for Calibre-style libraries in S3
pub struct LibraryScanner {
    s3_client: S3Client,
}

impl LibraryScanner {
    /// Create a new library scanner
    pub fn new(s3_client: S3Client) -> Self {
        Self { s3_client }
    }

    /// Scan the entire library and return all books
    pub async fn scan_library(&self) -> Result<Vec<LibraryBook>> {
        tracing::info!("Starting library scan...");
        let start = std::time::Instant::now();

        // List all objects in the bucket
        let objects = self.s3_client.list_all_objects(None).await?;
        tracing::info!("Found {} objects in bucket", objects.len());

        // Group objects by book folder (Author/Title/)
        let mut book_folders: HashMap<String, Vec<(String, i64)>> = HashMap::new();

        for obj in objects {
            let key = &obj.key;

            // Parse path: Author/Title/filename
            let parts: Vec<&str> = key.split('/').collect();
            if parts.len() >= 3 {
                let folder = format!("{}/{}", parts[0], parts[1]);
                book_folders
                    .entry(folder)
                    .or_default()
                    .push((key.clone(), obj.size));
            }
        }

        tracing::info!("Found {} book folders", book_folders.len());

        // Process each book folder
        let mut books = Vec::new();

        for (folder, files) in book_folders {
            match self.process_book_folder(&folder, &files).await {
                Ok(Some(book)) => {
                    books.push(book);
                }
                Ok(None) => {
                    tracing::debug!("Skipping folder without valid book: {}", folder);
                }
                Err(e) => {
                    tracing::warn!("Error processing folder {}: {}", folder, e);
                }
            }
        }

        let elapsed = start.elapsed();
        tracing::info!(
            "Library scan complete: {} books in {:?}",
            books.len(),
            elapsed
        );

        Ok(books)
    }

    /// Process a single book folder
    async fn process_book_folder(
        &self,
        folder: &str,
        files: &[(String, i64)],
    ) -> Result<Option<LibraryBook>> {
        let parts: Vec<&str> = folder.split('/').collect();
        if parts.len() < 2 {
            return Ok(None);
        }

        let author_folder = parts[0];
        let title_folder = parts[1];

        // Find metadata.opf file
        let metadata_key = files
            .iter()
            .find(|(key, _)| key.ends_with("metadata.opf"))
            .map(|(key, _)| key.clone());

        // Find book formats
        let mut formats = Vec::new();
        for (key, size) in files {
            if let Some(ext) = key.rsplit('.').next() {
                let format_type = FormatType::from_extension(ext);
                if format_type != FormatType::Other
                    || ext.eq_ignore_ascii_case("epub")
                    || ext.eq_ignore_ascii_case("pdf")
                {
                    formats.push(BookFormat {
                        format: format_type,
                        s3_key: key.clone(),
                        size: *size,
                    });
                }
            }
        }

        // Must have at least one format
        if formats.is_empty() {
            return Ok(None);
        }

        // Find cover image
        let cover_key = files
            .iter()
            .find(|(key, _)| {
                key.ends_with("cover.jpg")
                    || key.ends_with("cover.jpeg")
                    || key.ends_with("cover.png")
            })
            .map(|(key, _)| key.clone());

        // Parse metadata if available
        let metadata = if let Some(ref key) = metadata_key {
            match self.s3_client.get_object(key).await {
                Ok(obj) => {
                    let xml = String::from_utf8_lossy(&obj.data);
                    CalibreMetadata::parse(&xml).ok()
                }
                Err(e) => {
                    tracing::debug!("Could not read metadata.opf for {}: {}", folder, e);
                    None
                }
            }
        } else {
            None
        };

        // Build book from metadata or folder names
        let mut book = if let Some(meta) = metadata {
            let mut b = LibraryBook::new(
                meta.title.unwrap_or_else(|| title_folder.to_string()),
                folder.to_string(),
            );
            b.author = meta.author;
            b.author_sort = meta.author_sort;
            b.authors = meta.authors;
            b.publisher = meta.publisher;
            b.pubdate = meta.pubdate;
            b.language = meta.language;
            b.description = meta.description;
            b.series = meta.series;
            b.series_index = meta.series_index;
            b.tags = meta.tags;
            b.identifiers = meta.identifiers;
            b
        } else {
            // Fallback to folder names
            let mut b = LibraryBook::new(title_folder.to_string(), folder.to_string());
            b.author = Some(author_folder.to_string());
            b
        };

        book.formats = formats;
        book.cover_key = cover_key;
        book.updated_at = Utc::now();

        Ok(Some(book))
    }

    /// Get library statistics
    pub async fn get_stats(&self, books: &[LibraryBook]) -> LibraryStats {
        let mut authors: HashSet<String> = HashSet::new();
        let mut series: HashSet<String> = HashSet::new();
        let mut formats: HashMap<String, usize> = HashMap::new();
        let mut languages: HashMap<String, usize> = HashMap::new();

        for book in books {
            // Authors
            if let Some(ref author) = book.author {
                authors.insert(author.clone());
            }
            for author in &book.authors {
                authors.insert(author.clone());
            }

            // Series
            if let Some(ref s) = book.series {
                series.insert(s.clone());
            }

            // Formats
            for format in &book.formats {
                let key = format!("{:?}", format.format).to_lowercase();
                *formats.entry(key).or_insert(0) += 1;
            }

            // Languages
            if let Some(ref lang) = book.language {
                *languages.entry(lang.clone()).or_insert(0) += 1;
            }
        }

        LibraryStats {
            total_books: books.len(),
            total_authors: authors.len(),
            total_series: series.len(),
            formats,
            languages,
            last_scan: Some(Utc::now()),
        }
    }

    /// Scan for changes since last scan (incremental update)
    pub async fn scan_changes(
        &self,
        existing_books: &[LibraryBook],
        since: chrono::DateTime<Utc>,
    ) -> Result<LibraryChanges> {
        let all_books = self.scan_library().await?;

        let existing_ids: HashSet<String> =
            existing_books.iter().map(|b| b.s3_prefix.clone()).collect();

        let new_ids: HashSet<String> = all_books.iter().map(|b| b.s3_prefix.clone()).collect();

        let added: Vec<LibraryBook> = all_books
            .iter()
            .filter(|b| !existing_ids.contains(&b.s3_prefix))
            .cloned()
            .collect();

        let removed: Vec<String> = existing_ids
            .difference(&new_ids)
            .cloned()
            .collect();

        // Check for updated books (modified after since)
        let updated: Vec<LibraryBook> = all_books
            .iter()
            .filter(|b| {
                existing_ids.contains(&b.s3_prefix) && b.updated_at > since
            })
            .cloned()
            .collect();

        Ok(LibraryChanges {
            added,
            updated,
            removed,
        })
    }
}

/// Changes detected in the library
#[derive(Debug)]
pub struct LibraryChanges {
    pub added: Vec<LibraryBook>,
    pub updated: Vec<LibraryBook>,
    pub removed: Vec<String>,
}

impl LibraryChanges {
    pub fn is_empty(&self) -> bool {
        self.added.is_empty() && self.updated.is_empty() && self.removed.is_empty()
    }
}
