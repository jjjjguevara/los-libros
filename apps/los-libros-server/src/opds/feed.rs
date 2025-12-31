//! OPDS feed generation

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::library::{BookFormat, FormatType, LibraryBook};

/// OPDS feed types
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeedType {
    Navigation,
    Acquisition,
}

/// OPDS link relations
pub mod rel {
    pub const SELF: &str = "self";
    pub const START: &str = "start";
    pub const UP: &str = "up";
    pub const SUBSECTION: &str = "subsection";
    pub const ACQUISITION: &str = "http://opds-spec.org/acquisition";
    pub const ACQUISITION_OPEN: &str = "http://opds-spec.org/acquisition/open-access";
    pub const IMAGE: &str = "http://opds-spec.org/image";
    pub const THUMBNAIL: &str = "http://opds-spec.org/image/thumbnail";
    pub const SEARCH: &str = "search";
    pub const NEXT: &str = "next";
    pub const PREVIOUS: &str = "previous";
}

/// MIME types for OPDS
pub mod mime {
    pub const ATOM_XML: &str = "application/atom+xml";
    pub const ATOM_CATALOG: &str = "application/atom+xml;profile=opds-catalog;kind=navigation";
    pub const ATOM_ACQUISITION: &str = "application/atom+xml;profile=opds-catalog;kind=acquisition";
    pub const OPENSEARCH: &str = "application/opensearchdescription+xml";
}

/// An OPDS feed
#[derive(Debug, Clone)]
pub struct OPDSFeed {
    pub id: String,
    pub title: String,
    pub updated: DateTime<Utc>,
    pub author: Option<OPDSAuthor>,
    pub links: Vec<OPDSLink>,
    pub entries: Vec<OPDSEntry>,
    pub icon: Option<String>,
    pub subtitle: Option<String>,
}

impl OPDSFeed {
    /// Create a navigation feed (for browsing)
    pub fn navigation(title: &str, self_href: &str) -> Self {
        Self {
            id: format!("urn:uuid:{}", Uuid::new_v4()),
            title: title.to_string(),
            updated: Utc::now(),
            author: Some(OPDSAuthor {
                name: "Los Libros".to_string(),
                uri: None,
            }),
            links: vec![
                OPDSLink {
                    href: self_href.to_string(),
                    rel: Some(rel::SELF.to_string()),
                    link_type: Some(mime::ATOM_CATALOG.to_string()),
                    title: None,
                },
                OPDSLink {
                    href: "/opds".to_string(),
                    rel: Some(rel::START.to_string()),
                    link_type: Some(mime::ATOM_CATALOG.to_string()),
                    title: None,
                },
            ],
            entries: Vec::new(),
            icon: None,
            subtitle: None,
        }
    }

    /// Create an acquisition feed (for book listings)
    pub fn acquisition(title: &str, self_href: &str) -> Self {
        let mut feed = Self::navigation(title, self_href);
        feed.links[0].link_type = Some(mime::ATOM_ACQUISITION.to_string());
        feed
    }

    /// Add a navigation entry
    pub fn add_navigation_entry(&mut self, entry: OPDSEntry) {
        self.entries.push(entry);
    }

    /// Add entries from books
    pub fn add_books(&mut self, books: &[LibraryBook], base_url: &str) {
        for book in books {
            self.entries.push(OPDSEntry::from_book(book, base_url));
        }
    }

    /// Create the root catalog
    pub fn root_catalog(base_url: &str) -> Self {
        let mut feed = Self::navigation("Los Libros Catalog", &format!("{}/opds", base_url));
        feed.subtitle = Some("Your personal ebook library".to_string());

        // Add navigation entries
        feed.add_navigation_entry(OPDSEntry::navigation(
            "All Books",
            "Browse all books in the library",
            &format!("{}/opds/all", base_url),
        ));

        feed.add_navigation_entry(OPDSEntry::navigation(
            "By Author",
            "Browse books by author",
            &format!("{}/opds/authors", base_url),
        ));

        feed.add_navigation_entry(OPDSEntry::navigation(
            "By Series",
            "Browse books by series",
            &format!("{}/opds/series", base_url),
        ));

        feed.add_navigation_entry(OPDSEntry::navigation(
            "Recent",
            "Recently added books",
            &format!("{}/opds/recent", base_url),
        ));

        feed
    }
}

/// An OPDS feed entry
#[derive(Debug, Clone)]
pub struct OPDSEntry {
    pub id: String,
    pub title: String,
    pub updated: DateTime<Utc>,
    pub links: Vec<OPDSLink>,
    pub content: Option<OPDSContent>,
    pub summary: Option<String>,
    pub authors: Vec<OPDSAuthor>,
    pub categories: Vec<OPDSCategory>,
    pub published: Option<String>,
    pub language: Option<String>,
}

impl OPDSEntry {
    /// Create a navigation entry
    pub fn navigation(title: &str, summary: &str, href: &str) -> Self {
        Self {
            id: format!("urn:uuid:{}", Uuid::new_v4()),
            title: title.to_string(),
            updated: Utc::now(),
            links: vec![OPDSLink {
                href: href.to_string(),
                rel: Some(rel::SUBSECTION.to_string()),
                link_type: Some(mime::ATOM_ACQUISITION.to_string()),
                title: None,
            }],
            content: None,
            summary: Some(summary.to_string()),
            authors: Vec::new(),
            categories: Vec::new(),
            published: None,
            language: None,
        }
    }

    /// Create an entry from a LibraryBook
    pub fn from_book(book: &LibraryBook, base_url: &str) -> Self {
        let mut links = Vec::new();

        // Add acquisition links for each format
        for format in &book.formats {
            links.push(OPDSLink::acquisition(format, base_url));
        }

        // Add cover image links
        if let Some(ref cover_key) = book.cover_key {
            links.push(OPDSLink {
                href: format!("{}/files/{}", base_url, cover_key),
                rel: Some(rel::IMAGE.to_string()),
                link_type: Some("image/jpeg".to_string()),
                title: None,
            });
            links.push(OPDSLink {
                href: format!("{}/files/{}", base_url, cover_key),
                rel: Some(rel::THUMBNAIL.to_string()),
                link_type: Some("image/jpeg".to_string()),
                title: None,
            });
        }

        let authors: Vec<OPDSAuthor> = book
            .authors
            .iter()
            .map(|name| OPDSAuthor {
                name: name.clone(),
                uri: None,
            })
            .collect();

        let categories: Vec<OPDSCategory> = book
            .tags
            .iter()
            .map(|tag| OPDSCategory {
                term: tag.clone(),
                label: Some(tag.clone()),
                scheme: None,
            })
            .collect();

        // Build content with description and series info
        let content = book.description.as_ref().map(|desc| {
            let mut html = desc.clone();
            if let Some(ref series) = book.series {
                let index = book.series_index.map_or(String::new(), |i| format!(" #{}", i));
                html = format!("<p><em>Series: {}{}</em></p>{}", series, index, html);
            }
            OPDSContent {
                content_type: "html".to_string(),
                value: html,
            }
        });

        Self {
            id: format!("urn:book:{}", book.id),
            title: book.title.clone(),
            updated: book.updated_at,
            links,
            content,
            summary: book.description.clone().map(|d| {
                // Truncate for summary
                if d.len() > 200 {
                    format!("{}...", &d[..197])
                } else {
                    d
                }
            }),
            authors,
            categories,
            published: book.pubdate.clone(),
            language: book.language.clone(),
        }
    }
}

/// An OPDS link
#[derive(Debug, Clone)]
pub struct OPDSLink {
    pub href: String,
    pub rel: Option<String>,
    pub link_type: Option<String>,
    pub title: Option<String>,
}

impl OPDSLink {
    /// Create an acquisition link for a book format
    pub fn acquisition(format: &BookFormat, base_url: &str) -> Self {
        Self {
            href: format!("{}/files/{}", base_url, format.s3_key),
            rel: Some(rel::ACQUISITION_OPEN.to_string()),
            link_type: Some(format.format.mime_type().to_string()),
            title: Some(format!("{:?}", format.format)),
        }
    }
}

/// An OPDS author
#[derive(Debug, Clone)]
pub struct OPDSAuthor {
    pub name: String,
    pub uri: Option<String>,
}

/// An OPDS category
#[derive(Debug, Clone)]
pub struct OPDSCategory {
    pub term: String,
    pub label: Option<String>,
    pub scheme: Option<String>,
}

/// OPDS content (HTML or text)
#[derive(Debug, Clone)]
pub struct OPDSContent {
    pub content_type: String,
    pub value: String,
}

/// Author index entry
#[derive(Debug, Clone)]
pub struct AuthorEntry {
    pub name: String,
    pub sort_name: Option<String>,
    pub book_count: usize,
}

/// Series index entry
#[derive(Debug, Clone)]
pub struct SeriesEntry {
    pub name: String,
    pub book_count: usize,
}
