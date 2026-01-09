//! OPF (Open Packaging Format) parser
//!
//! Parses the OPF file to extract metadata, manifest, spine, and TOC.

use super::{BookMetadata, Creator, EpubError, ManifestItem, SpineItem, TocEntry};
use std::collections::HashMap;

/// Parsed OPF structure
pub struct ParsedOpf {
    pub metadata: BookMetadata,
    pub manifest: HashMap<String, ManifestItem>,
    pub spine: Vec<SpineItem>,
    pub toc: Vec<TocEntry>,
}

/// Parse an OPF file
pub fn parse_opf(content: &str, opf_dir: &str) -> Result<ParsedOpf, EpubError> {
    let doc = roxmltree::Document::parse(content)
        .map_err(|e| EpubError::XmlError(e.to_string()))?;

    let root = doc.root_element();

    // Parse metadata
    let metadata = parse_metadata(&doc)?;

    // Parse manifest
    let manifest = parse_manifest(&doc, opf_dir)?;

    // Parse spine
    let spine = parse_spine(&doc, &manifest)?;

    // Try to parse TOC (NCX or NAV)
    let toc = parse_toc(&doc, &manifest, opf_dir)?;

    Ok(ParsedOpf {
        metadata,
        manifest,
        spine,
        toc,
    })
}

fn parse_metadata(doc: &roxmltree::Document) -> Result<BookMetadata, EpubError> {
    let mut metadata = BookMetadata::default();

    // Find metadata element
    for node in doc.descendants() {
        match node.tag_name().name() {
            "title" => {
                if let Some(text) = node.text() {
                    metadata.title = text.trim().to_string();
                }
            }
            "creator" => {
                if let Some(text) = node.text() {
                    let role = node.attribute(("opf", "role"))
                        .or_else(|| node.attribute("role"))
                        .map(|s| s.to_string());
                    metadata.creators.push(Creator {
                        name: text.trim().to_string(),
                        role,
                    });
                }
            }
            "language" => {
                metadata.language = node.text().map(|s| s.trim().to_string());
            }
            "identifier" => {
                metadata.identifier = node.text().map(|s| s.trim().to_string());
            }
            "publisher" => {
                metadata.publisher = node.text().map(|s| s.trim().to_string());
            }
            "description" => {
                metadata.description = node.text().map(|s| s.trim().to_string());
            }
            _ => {}
        }
    }

    Ok(metadata)
}

fn parse_manifest(
    doc: &roxmltree::Document,
    _opf_dir: &str,
) -> Result<HashMap<String, ManifestItem>, EpubError> {
    let mut manifest = HashMap::new();

    for node in doc.descendants() {
        if node.tag_name().name() == "item" {
            if let (Some(id), Some(href), Some(media_type)) = (
                node.attribute("id"),
                node.attribute("href"),
                node.attribute("media-type"),
            ) {
                let properties = node.attribute("properties").map(|s| s.to_string());

                manifest.insert(id.to_string(), ManifestItem {
                    id: id.to_string(),
                    href: href.to_string(),
                    media_type: media_type.to_string(),
                    properties,
                });
            }
        }
    }

    Ok(manifest)
}

fn parse_spine(
    doc: &roxmltree::Document,
    manifest: &HashMap<String, ManifestItem>,
) -> Result<Vec<SpineItem>, EpubError> {
    let mut spine = Vec::new();

    for node in doc.descendants() {
        if node.tag_name().name() == "itemref" {
            if let Some(idref) = node.attribute("idref") {
                if let Some(item) = manifest.get(idref) {
                    let linear = node.attribute("linear")
                        .map(|s| s != "no")
                        .unwrap_or(true);

                    spine.push(SpineItem {
                        id: item.id.clone(),
                        href: item.href.clone(),
                        media_type: item.media_type.clone(),
                        linear,
                    });
                }
            }
        }
    }

    Ok(spine)
}

/// Information about the ToC document
pub enum TocDocInfo {
    /// EPUB 3 Navigation Document
    Nav { href: String },
    /// EPUB 2 NCX Document
    Ncx { href: String },
    /// No ToC document found
    None,
}

/// Find the ToC document (NAV or NCX)
pub fn find_toc_doc(
    doc: &roxmltree::Document,
    manifest: &HashMap<String, ManifestItem>,
) -> TocDocInfo {
    // Debug: Log manifest items with properties
    for (id, item) in manifest.iter() {
        if item.properties.is_some() {
            web_sys::console::log_1(&format!("[EPUB] Manifest item '{}': href='{}', properties={:?}",
                id, item.href, item.properties).into());
        }
    }

    // Try to find NAV (EPUB 3) first
    for item in manifest.values() {
        if let Some(props) = &item.properties {
            if props.contains("nav") {
                web_sys::console::log_1(&format!("[EPUB] Found NAV document: {}", item.href).into());
                return TocDocInfo::Nav { href: item.href.clone() };
            }
        }
    }

    // Fall back to NCX (EPUB 2)
    for node in doc.descendants() {
        if node.tag_name().name() == "spine" {
            if let Some(toc_id) = node.attribute("toc") {
                web_sys::console::log_1(&format!("[EPUB] Spine has toc attribute: '{}'", toc_id).into());
                if let Some(ncx_item) = manifest.get(toc_id) {
                    web_sys::console::log_1(&format!("[EPUB] Found NCX document: {}", ncx_item.href).into());
                    return TocDocInfo::Ncx { href: ncx_item.href.clone() };
                } else {
                    web_sys::console::log_1(&format!("[EPUB] NCX id '{}' not found in manifest. Available: {:?}",
                        toc_id, manifest.keys().collect::<Vec<_>>()).into());
                }
            } else {
                web_sys::console::log_1(&"[EPUB] Spine element has no 'toc' attribute".into());
            }
        }
    }

    web_sys::console::log_1(&"[EPUB] No NAV or NCX found, will fallback to spine".into());
    TocDocInfo::None
}

fn parse_toc(
    doc: &roxmltree::Document,
    manifest: &HashMap<String, ManifestItem>,
    _opf_dir: &str,
) -> Result<Vec<TocEntry>, EpubError> {
    // Just return empty - actual parsing happens in mod.rs after resources are loaded
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_opf() {
        let opf = r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Test Book</dc:title>
        <dc:creator>Test Author</dc:creator>
        <dc:language>en</dc:language>
    </metadata>
    <manifest>
        <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    </manifest>
    <spine>
        <itemref idref="chapter1"/>
    </spine>
</package>"#;

        let result = parse_opf(opf, "");
        assert!(result.is_ok());

        let parsed = result.unwrap();
        assert_eq!(parsed.metadata.title, "Test Book");
        assert_eq!(parsed.spine.len(), 1);
    }
}
