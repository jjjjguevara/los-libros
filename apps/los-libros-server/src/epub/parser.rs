//! EPUB parser using rbook
//!
//! Wraps the rbook crate to provide a clean API for parsing EPUBs.

use std::io::{Read, Seek};
use std::path::Path;

use rbook::Epub;
use rbook::prelude::*;
use thiserror::Error;

use super::types::{
    BookMetadata, ChapterContent, Creator, ManifestItem, ParsedBook, Resource, SpineItem,
    TocEntry as OurTocEntry,
};

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("Failed to open EPUB: {0}")]
    OpenError(String),
    #[error("Failed to parse metadata: {0}")]
    MetadataError(String),
    #[error("Failed to parse TOC: {0}")]
    TocError(String),
    #[error("Failed to read content: {0}")]
    ContentError(String),
    #[error("Resource not found: {0}")]
    ResourceNotFound(String),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

/// EPUB parser that maintains an open book
pub struct EpubParser {
    epub: Epub,
    book_id: String,
}

impl EpubParser {
    /// Open an EPUB from a file path
    pub fn from_path<P: AsRef<Path>>(path: P) -> Result<Self, ParseError> {
        let path = path.as_ref();
        let book_id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        // Use lenient parsing to handle EPUBs with missing metadata
        let epub = Epub::options()
            .strict(false)
            .open(path)
            .map_err(|e| ParseError::OpenError(e.to_string()))?;

        Ok(Self { epub, book_id })
    }

    /// Open an EPUB from bytes (for uploads)
    pub fn from_reader<R: Read + Seek + Send + Sync + 'static>(
        reader: R,
        book_id: String,
    ) -> Result<Self, ParseError> {
        // Use lenient parsing to handle EPUBs with missing metadata
        let epub = Epub::options()
            .strict(false)
            .read(reader)
            .map_err(|e| ParseError::OpenError(e.to_string()))?;

        Ok(Self { epub, book_id })
    }

    /// Parse the complete book structure
    pub fn parse(&self) -> Result<ParsedBook, ParseError> {
        let metadata = self.extract_metadata()?;
        let toc = self.extract_toc()?;
        let spine = self.extract_spine()?;
        let manifest = self.extract_manifest()?;

        Ok(ParsedBook {
            id: self.book_id.clone(),
            metadata,
            toc,
            spine,
            manifest,
        })
    }

    /// Extract book metadata
    fn extract_metadata(&self) -> Result<BookMetadata, ParseError> {
        let meta = self.epub.metadata();

        // Get title
        let title = meta
            .title()
            .map(|t| t.value().to_string())
            .unwrap_or_else(|| "Unknown".to_string());

        // Get creators
        let creators: Vec<Creator> = meta
            .creators()
            .map(|c| Creator {
                name: c.value().to_string(),
                role: None, // Simplified - roles have complex API
                file_as: c.file_as().map(|f| f.to_string()),
            })
            .collect();

        // Publisher
        let publisher = meta.publishers().next().map(|p| p.value().to_string());

        // Language
        let language = meta
            .language()
            .map(|l| l.value().to_string())
            .unwrap_or_else(|| "en".to_string());

        // Identifier
        let identifier = meta.identifier().map(|i| i.value().to_string());

        // Description
        let description = meta.description().map(|d| d.value().to_string());

        // Find cover image from manifest
        let cover_href = self.find_cover_href();

        // Date - try the modified entry or fallback
        let date = meta
            .by_property("dcterms:modified")
            .next()
            .or_else(|| meta.by_property("dc:date").next())
            .map(|d| d.value().to_string());

        // Rights
        let rights = meta
            .by_property("dc:rights")
            .next()
            .map(|r| r.value().to_string());

        // Subjects/tags
        let subjects: Vec<String> = meta.tags().map(|s| s.value().to_string()).collect();

        Ok(BookMetadata {
            title,
            creators,
            publisher,
            language,
            identifier,
            description,
            cover_href,
            date,
            rights,
            subjects,
        })
    }

    /// Find cover image href from manifest
    fn find_cover_href(&self) -> Option<String> {
        let manifest = self.epub.manifest();

        // First try to find item with cover-image property
        if let Some(cover) = manifest.cover_image() {
            return Some(Self::normalize_href(&cover.href().to_string()));
        }

        // Fallback: look for item with id containing "cover" and image type
        for item in manifest.images() {
            let id = item.id().to_lowercase();
            if id.contains("cover") {
                return Some(Self::normalize_href(&item.href().to_string()));
            }
        }

        None
    }

    /// Normalize href by stripping leading slashes and common EPUB directory prefixes
    fn normalize_href(href: &str) -> String {
        let href = href.trim_start_matches('/');
        // Strip common EPUB content directory prefixes
        let href = href
            .strip_prefix("OEBPS/")
            .or_else(|| href.strip_prefix("OPS/"))
            .or_else(|| href.strip_prefix("EPUB/"))
            .unwrap_or(href);
        href.to_string()
    }

    /// Extract table of contents
    fn extract_toc(&self) -> Result<Vec<OurTocEntry>, ParseError> {
        let toc = self.epub.toc();

        // Get the root contents entry
        let Some(root) = toc.contents() else {
            return Ok(Vec::new());
        };

        // Convert root children to our format
        fn convert_entry<'a>(entry: impl rbook::prelude::TocEntry<'a>) -> OurTocEntry {
            let label = entry.label().to_string();
            // Get href from resource key
            let href = entry
                .resource()
                .map(|r| {
                    use rbook::ebook::resource::ResourceKey;
                    match r.key() {
                        ResourceKey::Value(s) => s.to_string(),
                        ResourceKey::Position(pos) => pos.to_string(),
                    }
                })
                .unwrap_or_default();
            let children: Vec<OurTocEntry> = entry
                .children()
                .iter()
                .map(convert_entry)
                .collect();

            OurTocEntry {
                label,
                href,
                children,
                play_order: None,
            }
        }

        Ok(root.children().iter().map(convert_entry).collect())
    }

    /// Extract spine (reading order)
    fn extract_spine(&self) -> Result<Vec<SpineItem>, ParseError> {
        let spine = self.epub.spine();
        let manifest = self.epub.manifest();

        let mut result = Vec::new();
        for (index, item) in spine.entries().enumerate() {
            let idref = item.idref().to_string();

            // Resolve href from manifest
            let href = manifest
                .by_id(&idref)
                .map(|m| m.href().to_string())
                .unwrap_or_default();

            // Properties as single string
            let properties: Option<String> = {
                let props: Vec<String> = item.properties().into_iter().map(|p| p.to_string()).collect();
                if props.is_empty() {
                    None
                } else {
                    Some(props.join(" "))
                }
            };

            result.push(SpineItem {
                index,
                idref,
                href,
                linear: item.is_linear(),
                properties,
            });
        }

        Ok(result)
    }

    /// Extract manifest (all resources)
    fn extract_manifest(&self) -> Result<Vec<ManifestItem>, ParseError> {
        let manifest = self.epub.manifest();

        Ok(manifest
            .entries()
            .map(|item| {
                let properties: Option<String> = {
                    let props: Vec<String> = item.properties().into_iter().map(|p| p.to_string()).collect();
                    if props.is_empty() {
                        None
                    } else {
                        Some(props.join(" "))
                    }
                };

                ManifestItem {
                    id: item.id().to_string(),
                    href: item.href().to_string(),
                    media_type: item.media_type().to_string(),
                    properties,
                }
            })
            .collect())
    }

    /// Get chapter content by spine index
    pub fn get_chapter(&self, spine_index: usize) -> Result<ChapterContent, ParseError> {
        let spine = self.epub.spine();
        let spine_item = spine.entries().nth(spine_index).ok_or_else(|| {
            ParseError::ContentError(format!("Spine index {} not found", spine_index))
        })?;

        let manifest = self.epub.manifest();
        let idref = spine_item.idref();
        let manifest_item = manifest.by_id(idref).ok_or_else(|| {
            ParseError::ContentError(format!("Manifest item {} not found", idref))
        })?;

        let href = manifest_item.href();
        let html = self
            .epub
            .read_resource_str(href)
            .map_err(|e| ParseError::ContentError(e.to_string()))?;

        // Try to find title from TOC
        let title = self.find_toc_title(&href.to_string());

        Ok(ChapterContent {
            index: spine_index,
            href: href.to_string(),
            html,
            title,
        })
    }

    /// Get chapter content by href
    pub fn get_chapter_by_href(&self, href: &str) -> Result<ChapterContent, ParseError> {
        let spine = self.epub.spine();
        let manifest = self.epub.manifest();

        // Find spine index for this href
        let spine_index = spine
            .entries()
            .enumerate()
            .find(|(_, item)| {
                manifest
                    .by_id(item.idref())
                    .map(|m| m.href().as_str() == href)
                    .unwrap_or(false)
            })
            .map(|(i, _)| i)
            .unwrap_or(0);

        // Get the manifest item for this href
        let manifest_item = manifest.by_href(href).ok_or_else(|| {
            ParseError::ContentError(format!("Manifest item for href {} not found", href))
        })?;

        let html = self
            .epub
            .read_resource_str(manifest_item.href())
            .map_err(|e| ParseError::ContentError(e.to_string()))?;

        let title = self.find_toc_title(href);

        Ok(ChapterContent {
            index: spine_index,
            href: href.to_string(),
            html,
            title,
        })
    }

    /// Find TOC title for a given href
    fn find_toc_title(&self, href: &str) -> Option<String> {
        fn search_toc(entries: &[OurTocEntry], href: &str) -> Option<String> {
            for entry in entries {
                // Handle fragment identifiers
                let entry_href = entry.href.split('#').next().unwrap_or(&entry.href);
                if entry_href == href || entry.href == href {
                    return Some(entry.label.clone());
                }
                if let Some(title) = search_toc(&entry.children, href) {
                    return Some(title);
                }
            }
            None
        }

        let toc = self.extract_toc().ok()?;
        search_toc(&toc, href)
    }

    /// Get a resource (image, CSS, font, etc.)
    pub fn get_resource(&self, href: &str) -> Result<Resource, ParseError> {
        let manifest = self.epub.manifest();

        // Try original href first, then normalized version
        let manifest_item = manifest
            .by_href(href)
            .or_else(|| {
                let normalized = Self::normalize_href(href);
                manifest.by_href(&normalized)
            })
            .ok_or_else(|| ParseError::ResourceNotFound(href.to_string()))?;

        let data = self
            .epub
            .read_resource_bytes(manifest_item.href())
            .map_err(|e| ParseError::ContentError(e.to_string()))?;

        Ok(Resource {
            href: href.to_string(),
            media_type: manifest_item.media_type().to_string(),
            data,
        })
    }

    /// Get book ID
    pub fn id(&self) -> &str {
        &self.book_id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parser_creation() {
        // Placeholder - real tests need fixture files
        assert!(true);
    }
}
