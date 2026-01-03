//! Metadata parsing for Calibre metadata.opf files
//!
//! Parses Dublin Core metadata from Calibre's metadata.opf XML files.

use quick_xml::de::from_str;
use serde::Deserialize;
use std::collections::HashMap;

use crate::error::Result;

/// Parsed Calibre metadata
#[derive(Debug, Clone, Default)]
pub struct CalibreMetadata {
    pub title: Option<String>,
    pub author: Option<String>,
    pub author_sort: Option<String>,
    pub authors: Vec<String>,
    pub publisher: Option<String>,
    pub pubdate: Option<String>,
    pub language: Option<String>,
    pub description: Option<String>,
    pub series: Option<String>,
    pub series_index: Option<f32>,
    pub tags: Vec<String>,
    pub identifiers: HashMap<String, String>,
    pub cover_path: Option<String>,
}

impl CalibreMetadata {
    /// Parse metadata from an OPF XML string
    pub fn parse(xml: &str) -> Result<Self> {
        let package: OPFPackage = from_str(xml)?;
        Ok(Self::from_opf(package))
    }

    fn from_opf(package: OPFPackage) -> Self {
        let metadata = package.metadata;
        let mut result = CalibreMetadata::default();

        // Title
        result.title = metadata.title.map(|t| t.content);

        // Authors
        if let Some(creators) = metadata.creator {
            for creator in creators {
                if let Some(name) = creator.content {
                    result.authors.push(name.clone());
                    if result.author.is_none() {
                        result.author = Some(name);
                    }
                }
                if creator.file_as.is_some() && result.author_sort.is_none() {
                    result.author_sort = creator.file_as;
                }
            }
        }

        // Publisher
        result.publisher = metadata.publisher.map(|p| p.content);

        // Publication date
        if let Some(dates) = metadata.date {
            for date in dates {
                if date.event.as_deref() == Some("publication") || result.pubdate.is_none() {
                    result.pubdate = date.content;
                }
            }
        }

        // Language
        result.language = metadata.language.map(|l| l.content);

        // Description
        result.description = metadata.description.map(|d| d.content);

        // Tags/subjects
        if let Some(subjects) = metadata.subject {
            result.tags = subjects.into_iter().map(|s| s.content).collect();
        }

        // Identifiers
        if let Some(identifiers) = metadata.identifier {
            for id in identifiers {
                if let (Some(scheme), Some(value)) = (id.scheme.or(id.id), id.content) {
                    let key = scheme.to_lowercase().replace("calibre:", "");
                    result.identifiers.insert(key, value);
                }
            }
        }

        // Calibre-specific metadata
        if let Some(metas) = metadata.meta {
            for meta in metas {
                match meta.name.as_deref() {
                    Some("calibre:series") => {
                        result.series = meta.content;
                    }
                    Some("calibre:series_index") => {
                        result.series_index = meta.content.and_then(|s| s.parse().ok());
                    }
                    Some("calibre:author_link_map") => {
                        // Could parse author links if needed
                    }
                    Some("cover") => {
                        result.cover_path = meta.content;
                    }
                    _ => {}
                }
            }
        }

        // Cover from manifest
        if result.cover_path.is_none() {
            if let Some(manifest) = package.manifest {
                for item in manifest.item {
                    if item.id.as_deref() == Some("cover")
                        || item.properties.as_deref() == Some("cover-image")
                    {
                        result.cover_path = item.href;
                        break;
                    }
                }
            }
        }

        result
    }
}

// OPF XML structures for deserialization

#[derive(Debug, Deserialize)]
struct OPFPackage {
    metadata: OPFMetadata,
    manifest: Option<OPFManifest>,
}

#[derive(Debug, Deserialize)]
struct OPFMetadata {
    #[serde(rename = "title", default)]
    title: Option<DCElement>,

    #[serde(rename = "creator", default)]
    creator: Option<Vec<DCCreator>>,

    #[serde(rename = "publisher", default)]
    publisher: Option<DCElement>,

    #[serde(rename = "date", default)]
    date: Option<Vec<DCDate>>,

    #[serde(rename = "language", default)]
    language: Option<DCElement>,

    #[serde(rename = "description", default)]
    description: Option<DCElement>,

    #[serde(rename = "subject", default)]
    subject: Option<Vec<DCElement>>,

    #[serde(rename = "identifier", default)]
    identifier: Option<Vec<DCIdentifier>>,

    #[serde(rename = "meta", default)]
    meta: Option<Vec<OPFMeta>>,
}

#[derive(Debug, Deserialize)]
struct DCElement {
    #[serde(rename = "$text", default)]
    content: String,
}

#[derive(Debug, Deserialize)]
struct DCCreator {
    #[serde(rename = "@file-as", default)]
    file_as: Option<String>,

    #[serde(rename = "@role", default)]
    role: Option<String>,

    #[serde(rename = "$text", default)]
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DCDate {
    #[serde(rename = "@event", default)]
    event: Option<String>,

    #[serde(rename = "$text", default)]
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DCIdentifier {
    #[serde(rename = "@id", default)]
    id: Option<String>,

    #[serde(rename = "@scheme", default)]
    scheme: Option<String>,

    #[serde(rename = "$text", default)]
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OPFMeta {
    #[serde(rename = "@name", default)]
    name: Option<String>,

    #[serde(rename = "@content", default)]
    content: Option<String>,

    #[serde(rename = "@property", default)]
    property: Option<String>,

    #[serde(rename = "$text", default)]
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OPFManifest {
    #[serde(rename = "item", default)]
    item: Vec<OPFManifestItem>,
}

#[derive(Debug, Deserialize)]
struct OPFManifestItem {
    #[serde(rename = "@id", default)]
    id: Option<String>,

    #[serde(rename = "@href", default)]
    href: Option<String>,

    #[serde(rename = "@media-type", default)]
    media_type: Option<String>,

    #[serde(rename = "@properties", default)]
    properties: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_basic_opf() {
        let xml = r#"<?xml version='1.0' encoding='utf-8'?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="2.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
        <dc:title>Test Book</dc:title>
        <dc:creator opf:file-as="Author, Test" opf:role="aut">Test Author</dc:creator>
        <dc:language>en</dc:language>
        <dc:identifier id="isbn" opf:scheme="ISBN">978-1234567890</dc:identifier>
        <meta name="calibre:series" content="Test Series"/>
        <meta name="calibre:series_index" content="1.0"/>
    </metadata>
</package>"#;

        let metadata = CalibreMetadata::parse(xml).unwrap();
        assert_eq!(metadata.title, Some("Test Book".to_string()));
        assert_eq!(metadata.author, Some("Test Author".to_string()));
        assert_eq!(metadata.language, Some("en".to_string()));
        assert_eq!(metadata.series, Some("Test Series".to_string()));
        assert_eq!(metadata.series_index, Some(1.0));
    }
}
