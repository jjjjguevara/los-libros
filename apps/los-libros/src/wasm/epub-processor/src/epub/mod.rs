//! EPUB parsing and extraction module
//!
//! Handles reading EPUB files and extracting content.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Cursor, Read};
use thiserror::Error;
use zip::ZipArchive;

pub mod parser;
mod opf;

pub use opf::*;
use opf::{find_toc_doc, TocDocInfo};

#[derive(Error, Debug)]
pub enum EpubError {
    #[error("Failed to read ZIP archive: {0}")]
    ZipError(#[from] zip::result::ZipError),

    #[error("Failed to read file: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Invalid EPUB: {0}")]
    InvalidEpub(String),

    #[error("XML parse error: {0}")]
    XmlError(String),

    #[error("Resource not found: {0}")]
    ResourceNotFound(String),
}

/// Parsed book metadata and structure
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedBook {
    pub id: String,
    pub metadata: BookMetadata,
    pub spine: Vec<SpineItem>,
    pub toc: Vec<TocEntry>,
}

/// Book metadata
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BookMetadata {
    pub title: String,
    pub creators: Vec<Creator>,
    pub language: Option<String>,
    pub identifier: Option<String>,
    pub publisher: Option<String>,
    pub description: Option<String>,
    pub cover_href: Option<String>,
}

/// Creator (author) information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Creator {
    pub name: String,
    pub role: Option<String>,
}

/// Spine item (reading order entry)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpineItem {
    pub id: String,
    pub href: String,
    pub media_type: String,
    pub linear: bool,
}

/// Table of contents entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TocEntry {
    pub id: String,
    pub href: String,
    pub label: String,
    pub level: usize,
    pub children: Vec<TocEntry>,
}

/// Chapter content
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterContent {
    pub href: String,
    pub html: String,
    pub css: Vec<String>,
    pub images: Vec<String>,
}

/// Internal representation of an EPUB book
pub struct EpubBook {
    pub id: String,
    pub metadata: BookMetadata,
    pub spine: Vec<SpineItem>,
    pub toc: Vec<TocEntry>,
    pub manifest: HashMap<String, ManifestItem>,
    resources: HashMap<String, Vec<u8>>,
    opf_dir: String,
}

/// Manifest item from OPF
#[derive(Debug, Clone)]
pub struct ManifestItem {
    pub id: String,
    pub href: String,
    pub media_type: String,
    pub properties: Option<String>,
}

impl EpubBook {
    /// Parse an EPUB from raw bytes
    pub fn from_bytes(data: &[u8]) -> Result<Self, EpubError> {
        let cursor = Cursor::new(data);
        let mut archive = ZipArchive::new(cursor)?;

        // Read container.xml to find the OPF file
        let opf_path = Self::find_opf_path(&mut archive)?;
        let opf_dir = opf_path.rsplit_once('/')
            .map(|(dir, _)| dir.to_string())
            .unwrap_or_default();

        // Read and parse OPF
        let opf_content = Self::read_file(&mut archive, &opf_path)?;
        let opf = opf::parse_opf(&opf_content, &opf_dir)?;

        // Generate book ID from identifier or title
        let id = opf.metadata.identifier
            .clone()
            .unwrap_or_else(|| {
                use std::collections::hash_map::DefaultHasher;
                use std::hash::{Hash, Hasher};
                let mut hasher = DefaultHasher::new();
                opf.metadata.title.hash(&mut hasher);
                format!("book-{:x}", hasher.finish())
            });

        // Extract all resources into memory
        let mut resources = HashMap::new();
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            if file.is_file() {
                let name = file.name().to_string();
                let mut content = Vec::new();
                file.read_to_end(&mut content)?;
                resources.insert(name, content);
            }
        }

        // Parse ToC from NAV or NCX document
        let opf_doc = roxmltree::Document::parse(&opf_content)
            .map_err(|e| EpubError::XmlError(e.to_string()))?;
        let toc_info = find_toc_doc(&opf_doc, &opf.manifest);

        let toc = match toc_info {
            TocDocInfo::Nav { href } => {
                let full_path = if opf_dir.is_empty() {
                    href.clone()
                } else {
                    format!("{}/{}", opf_dir, href)
                };
                if let Some(bytes) = resources.get(&full_path) {
                    if let Ok(content) = String::from_utf8(bytes.clone()) {
                        Self::parse_nav_document(&content)
                    } else {
                        Vec::new()
                    }
                } else {
                    Vec::new()
                }
            }
            TocDocInfo::Ncx { href } => {
                let full_path = if opf_dir.is_empty() {
                    href.clone()
                } else {
                    format!("{}/{}", opf_dir, href)
                };
                if let Some(bytes) = resources.get(&full_path) {
                    if let Ok(content) = String::from_utf8(bytes.clone()) {
                        Self::parse_ncx_document(&content)
                    } else {
                        Vec::new()
                    }
                } else {
                    Vec::new()
                }
            }
            TocDocInfo::None => {
                // Generate ToC from spine
                Self::generate_toc_from_spine(&opf.spine)
            }
        };

        Ok(Self {
            id,
            metadata: opf.metadata,
            spine: opf.spine,
            toc,
            manifest: opf.manifest,
            resources,
            opf_dir,
        })
    }

    /// Parse EPUB 3 Navigation Document (NAV)
    fn parse_nav_document(content: &str) -> Vec<TocEntry> {
        let doc = match roxmltree::Document::parse(content) {
            Ok(d) => d,
            Err(_) => return Vec::new(),
        };

        // Find the nav element with epub:type="toc"
        for node in doc.descendants() {
            if node.tag_name().name() == "nav" {
                // Check for epub:type="toc" or just use the first nav with an ol
                let is_toc = node.attributes()
                    .any(|a| a.name() == "type" && a.value().contains("toc"));

                if is_toc {
                    // Find the ol element inside
                    for child in node.descendants() {
                        if child.tag_name().name() == "ol" {
                            return Self::parse_nav_ol(&child, 0);
                        }
                    }
                }
            }
        }

        // Fallback: find any nav > ol structure
        for node in doc.descendants() {
            if node.tag_name().name() == "nav" {
                for child in node.descendants() {
                    if child.tag_name().name() == "ol" {
                        let entries = Self::parse_nav_ol(&child, 0);
                        if !entries.is_empty() {
                            return entries;
                        }
                    }
                }
            }
        }

        Vec::new()
    }

    /// Parse an ol element in the NAV document
    fn parse_nav_ol(ol: &roxmltree::Node, level: usize) -> Vec<TocEntry> {
        let mut entries = Vec::new();

        for child in ol.children() {
            if child.tag_name().name() == "li" {
                if let Some(entry) = Self::parse_nav_li(&child, level) {
                    entries.push(entry);
                }
            }
        }

        entries
    }

    /// Parse an li element in the NAV document
    fn parse_nav_li(li: &roxmltree::Node, level: usize) -> Option<TocEntry> {
        let mut href = String::new();
        let mut label = String::new();
        let mut children = Vec::new();

        for child in li.children() {
            match child.tag_name().name() {
                "a" => {
                    href = child.attribute("href").unwrap_or("").to_string();
                    // Get text content recursively
                    label = Self::get_text_content(&child);
                }
                "span" => {
                    if label.is_empty() {
                        label = Self::get_text_content(&child);
                    }
                }
                "ol" => {
                    children = Self::parse_nav_ol(&child, level + 1);
                }
                _ => {}
            }
        }

        if !label.is_empty() || !href.is_empty() {
            Some(TocEntry {
                id: format!("toc-{}-{}", level, href.replace(['/', '#', '.'], "-")),
                href,
                label: label.trim().to_string(),
                level,
                children,
            })
        } else {
            None
        }
    }

    /// Get text content from a node recursively
    fn get_text_content(node: &roxmltree::Node) -> String {
        let mut text = String::new();
        for child in node.children() {
            if child.is_text() {
                if let Some(t) = child.text() {
                    text.push_str(t);
                }
            } else {
                text.push_str(&Self::get_text_content(&child));
            }
        }
        text
    }

    /// Parse EPUB 2 NCX Document
    fn parse_ncx_document(content: &str) -> Vec<TocEntry> {
        let doc = match roxmltree::Document::parse(content) {
            Ok(d) => d,
            Err(_) => return Vec::new(),
        };

        // Find navMap element
        for node in doc.descendants() {
            if node.tag_name().name() == "navMap" {
                return Self::parse_ncx_nav_map(&node, 0);
            }
        }

        Vec::new()
    }

    /// Parse navMap element in NCX
    fn parse_ncx_nav_map(nav_map: &roxmltree::Node, level: usize) -> Vec<TocEntry> {
        let mut entries = Vec::new();

        for child in nav_map.children() {
            if child.tag_name().name() == "navPoint" {
                if let Some(entry) = Self::parse_ncx_nav_point(&child, level) {
                    entries.push(entry);
                }
            }
        }

        entries
    }

    /// Parse navPoint element in NCX
    fn parse_ncx_nav_point(nav_point: &roxmltree::Node, level: usize) -> Option<TocEntry> {
        let id = nav_point.attribute("id").unwrap_or("").to_string();
        let mut label = String::new();
        let mut href = String::new();
        let mut children = Vec::new();

        for child in nav_point.children() {
            match child.tag_name().name() {
                "navLabel" => {
                    // Find text element inside navLabel
                    for sub in child.descendants() {
                        if sub.tag_name().name() == "text" {
                            if let Some(text) = sub.text() {
                                label = text.trim().to_string();
                            }
                        }
                    }
                }
                "content" => {
                    href = child.attribute("src").unwrap_or("").to_string();
                }
                "navPoint" => {
                    // Nested navPoint
                    if let Some(entry) = Self::parse_ncx_nav_point(&child, level + 1) {
                        children.push(entry);
                    }
                }
                _ => {}
            }
        }

        if !label.is_empty() || !href.is_empty() {
            Some(TocEntry {
                id: if id.is_empty() {
                    format!("ncx-{}-{}", level, href.replace(['/', '#', '.'], "-"))
                } else {
                    id
                },
                href,
                label,
                level,
                children,
            })
        } else {
            None
        }
    }

    /// Generate ToC from spine when no NAV/NCX is available
    fn generate_toc_from_spine(spine: &[SpineItem]) -> Vec<TocEntry> {
        spine.iter().enumerate()
            .filter(|(_, item)| item.linear)
            .map(|(i, item)| TocEntry {
                id: format!("spine-{}", i),
                href: item.href.clone(),
                label: format!("Chapter {}", i + 1),
                level: 0,
                children: Vec::new(),
            })
            .collect()
    }

    /// Find the path to the OPF file from container.xml
    fn find_opf_path(archive: &mut ZipArchive<Cursor<&[u8]>>) -> Result<String, EpubError> {
        let container_content = Self::read_file(archive, "META-INF/container.xml")?;
        let doc = roxmltree::Document::parse(&container_content)
            .map_err(|e| EpubError::XmlError(e.to_string()))?;

        // Find <rootfile> element
        for node in doc.descendants() {
            if node.tag_name().name() == "rootfile" {
                if let Some(path) = node.attribute("full-path") {
                    return Ok(path.to_string());
                }
            }
        }

        Err(EpubError::InvalidEpub("Could not find OPF path in container.xml".to_string()))
    }

    /// Read a file from the ZIP archive
    fn read_file(archive: &mut ZipArchive<Cursor<&[u8]>>, path: &str) -> Result<String, EpubError> {
        let mut file = archive.by_name(path)?;
        let mut content = String::new();
        file.read_to_string(&mut content)?;
        Ok(content)
    }

    /// Get parsed book info for JavaScript
    pub fn to_parsed_book(&self) -> ParsedBook {
        ParsedBook {
            id: self.id.clone(),
            metadata: self.metadata.clone(),
            spine: self.spine.clone(),
            toc: self.toc.clone(),
        }
    }

    /// Get chapter content
    pub fn get_chapter_content(&self, href: &str) -> Result<ChapterContent, EpubError> {
        let full_path = self.resolve_path(href);
        let html = self.get_resource_as_string(&full_path)?;

        // Parse HTML to extract CSS and image references
        let (css, images) = parser::extract_resources(&html);

        Ok(ChapterContent {
            href: href.to_string(),
            html,
            css,
            images,
        })
    }

    /// Get a resource by href
    pub fn get_resource(&self, href: &str) -> Result<Vec<u8>, EpubError> {
        let full_path = self.resolve_path(href);
        self.resources.get(&full_path)
            .cloned()
            .ok_or_else(|| EpubError::ResourceNotFound(href.to_string()))
    }

    /// Get a resource as string
    fn get_resource_as_string(&self, path: &str) -> Result<String, EpubError> {
        let bytes = self.resources.get(path)
            .ok_or_else(|| EpubError::ResourceNotFound(path.to_string()))?;
        String::from_utf8(bytes.clone())
            .map_err(|e| EpubError::InvalidEpub(format!("Invalid UTF-8: {}", e)))
    }

    /// Resolve a relative path to the full path in the archive
    fn resolve_path(&self, href: &str) -> String {
        if self.opf_dir.is_empty() {
            href.to_string()
        } else {
            format!("{}/{}", self.opf_dir, href)
        }
    }

    /// Get spine index for a given href
    pub fn get_spine_index(&self, href: &str) -> Option<usize> {
        self.spine.iter().position(|item| item.href == href)
    }

    /// Get spine item by index
    pub fn get_spine_item(&self, index: usize) -> Option<&SpineItem> {
        self.spine.get(index)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metadata_default() {
        let metadata = BookMetadata::default();
        assert!(metadata.title.is_empty());
    }
}
