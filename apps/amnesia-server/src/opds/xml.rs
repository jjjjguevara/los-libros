//! OPDS XML serialization
//!
//! Generates Atom XML for OPDS feeds.

use quick_xml::{
    events::{BytesCData, BytesDecl, BytesEnd, BytesStart, BytesText, Event},
    Writer,
};
use std::io::Cursor;

use super::feed::{OPDSCategory, OPDSContent, OPDSEntry, OPDSFeed, OPDSLink};
use crate::error::Result;

/// Serialize an OPDS feed to XML
pub fn serialize_feed(feed: &OPDSFeed) -> Result<String> {
    let mut writer = Writer::new(Cursor::new(Vec::new()));

    // XML declaration
    writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("utf-8"), None)))?;

    // Feed element with namespaces
    let mut feed_elem = BytesStart::new("feed");
    feed_elem.push_attribute(("xmlns", "http://www.w3.org/2005/Atom"));
    feed_elem.push_attribute(("xmlns:dc", "http://purl.org/dc/terms/"));
    feed_elem.push_attribute(("xmlns:opds", "http://opds-spec.org/2010/catalog"));
    writer.write_event(Event::Start(feed_elem))?;

    // ID
    write_simple_element(&mut writer, "id", &feed.id)?;

    // Title
    write_simple_element(&mut writer, "title", &feed.title)?;

    // Updated
    write_simple_element(&mut writer, "updated", &feed.updated.to_rfc3339())?;

    // Subtitle
    if let Some(ref subtitle) = feed.subtitle {
        write_simple_element(&mut writer, "subtitle", subtitle)?;
    }

    // Icon
    if let Some(ref icon) = feed.icon {
        write_simple_element(&mut writer, "icon", icon)?;
    }

    // Author
    if let Some(ref author) = feed.author {
        writer.write_event(Event::Start(BytesStart::new("author")))?;
        write_simple_element(&mut writer, "name", &author.name)?;
        if let Some(ref uri) = author.uri {
            write_simple_element(&mut writer, "uri", uri)?;
        }
        writer.write_event(Event::End(BytesEnd::new("author")))?;
    }

    // Links
    for link in &feed.links {
        write_link(&mut writer, link)?;
    }

    // Entries
    for entry in &feed.entries {
        write_entry(&mut writer, entry)?;
    }

    writer.write_event(Event::End(BytesEnd::new("feed")))?;

    let result = writer.into_inner().into_inner();
    Ok(String::from_utf8(result)?)
}

fn write_simple_element<W: std::io::Write>(
    writer: &mut Writer<W>,
    name: &str,
    value: &str,
) -> Result<()> {
    writer.write_event(Event::Start(BytesStart::new(name)))?;
    writer.write_event(Event::Text(BytesText::new(value)))?;
    writer.write_event(Event::End(BytesEnd::new(name)))?;
    Ok(())
}

fn write_link<W: std::io::Write>(writer: &mut Writer<W>, link: &OPDSLink) -> Result<()> {
    let mut elem = BytesStart::new("link");
    elem.push_attribute(("href", link.href.as_str()));
    if let Some(ref rel) = link.rel {
        elem.push_attribute(("rel", rel.as_str()));
    }
    if let Some(ref link_type) = link.link_type {
        elem.push_attribute(("type", link_type.as_str()));
    }
    if let Some(ref title) = link.title {
        elem.push_attribute(("title", title.as_str()));
    }
    writer.write_event(Event::Empty(elem))?;
    Ok(())
}

fn write_entry<W: std::io::Write>(writer: &mut Writer<W>, entry: &OPDSEntry) -> Result<()> {
    writer.write_event(Event::Start(BytesStart::new("entry")))?;

    // ID
    write_simple_element(writer, "id", &entry.id)?;

    // Title
    write_simple_element(writer, "title", &entry.title)?;

    // Updated
    write_simple_element(writer, "updated", &entry.updated.to_rfc3339())?;

    // Published
    if let Some(ref published) = entry.published {
        write_simple_element(writer, "published", published)?;
    }

    // Language
    if let Some(ref language) = entry.language {
        write_simple_element(writer, "dc:language", language)?;
    }

    // Authors
    for author in &entry.authors {
        writer.write_event(Event::Start(BytesStart::new("author")))?;
        write_simple_element(writer, "name", &author.name)?;
        if let Some(ref uri) = author.uri {
            write_simple_element(writer, "uri", uri)?;
        }
        writer.write_event(Event::End(BytesEnd::new("author")))?;
    }

    // Categories
    for category in &entry.categories {
        write_category(writer, category)?;
    }

    // Summary
    if let Some(ref summary) = entry.summary {
        let mut elem = BytesStart::new("summary");
        elem.push_attribute(("type", "text"));
        writer.write_event(Event::Start(elem))?;
        writer.write_event(Event::Text(BytesText::new(summary)))?;
        writer.write_event(Event::End(BytesEnd::new("summary")))?;
    }

    // Content
    if let Some(ref content) = entry.content {
        write_content(writer, content)?;
    }

    // Links
    for link in &entry.links {
        write_link(writer, link)?;
    }

    writer.write_event(Event::End(BytesEnd::new("entry")))?;
    Ok(())
}

fn write_category<W: std::io::Write>(writer: &mut Writer<W>, category: &OPDSCategory) -> Result<()> {
    let mut elem = BytesStart::new("category");
    elem.push_attribute(("term", category.term.as_str()));
    if let Some(ref label) = category.label {
        elem.push_attribute(("label", label.as_str()));
    }
    if let Some(ref scheme) = category.scheme {
        elem.push_attribute(("scheme", scheme.as_str()));
    }
    writer.write_event(Event::Empty(elem))?;
    Ok(())
}

fn write_content<W: std::io::Write>(writer: &mut Writer<W>, content: &OPDSContent) -> Result<()> {
    let mut elem = BytesStart::new("content");
    elem.push_attribute(("type", content.content_type.as_str()));
    writer.write_event(Event::Start(elem))?;

    if content.content_type == "html" || content.content_type == "xhtml" {
        writer.write_event(Event::CData(BytesCData::new(&content.value)))?;
    } else {
        writer.write_event(Event::Text(BytesText::new(&content.value)))?;
    }

    writer.write_event(Event::End(BytesEnd::new("content")))?;
    Ok(())
}

