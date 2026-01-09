//! Bibliography Generation Module
//!
//! Generates bibliographic citations in multiple formats from book metadata.
//!
//! # Supported Formats
//!
//! - **BibTeX**: LaTeX bibliography format
//! - **APA 7th**: American Psychological Association, 7th edition
//! - **MLA 9th**: Modern Language Association, 9th edition
//! - **Chicago 17th**: Chicago Manual of Style, 17th edition
//! - **IEEE**: Institute of Electrical and Electronics Engineers
//!
//! # Example
//!
//! ```rust,ignore
//! use amnesia_server::bibliography::{generate_citation, CitationFormat, BookMetadata};
//!
//! let metadata = BookMetadata {
//!     title: "Writing to Learn".to_string(),
//!     authors: vec!["William Zinsser".to_string()],
//!     year: Some(1988),
//!     publisher: Some("Harper & Row".to_string()),
//!     isbn: Some("978-0060158590".to_string()),
//!     ..Default::default()
//! };
//!
//! let bibtex = generate_citation(&metadata, CitationFormat::BibTeX)?;
//! let apa = generate_citation(&metadata, CitationFormat::APA)?;
//! ```

mod formatter;
mod types;

pub use formatter::{generate_bibtex, generate_citation, generate_citation_list};
pub use types::{BookMetadata, CitationFormat};

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_book() -> BookMetadata {
        BookMetadata {
            id: "test-book-1".to_string(),
            title: "The Rust Programming Language".to_string(),
            authors: vec![
                "Steve Klabnik".to_string(),
                "Carol Nichols".to_string(),
            ],
            year: Some(2023),
            publisher: Some("No Starch Press".to_string()),
            isbn: Some("978-1718503106".to_string()),
            place: Some("San Francisco".to_string()),
            edition: Some("2nd".to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn test_generate_bibtex() {
        let book = sample_book();
        let result = generate_citation(&book, CitationFormat::BibTeX).unwrap();

        assert!(result.contains("@book{"));
        assert!(result.contains("Klabnik"));
        assert!(result.contains("Rust Programming Language"));
        assert!(result.contains("2023"));
    }

    #[test]
    fn test_generate_apa() {
        let book = sample_book();
        let result = generate_citation(&book, CitationFormat::APA).unwrap();

        // APA format: Authors (Year). Title (Edition). Publisher.
        assert!(result.contains("Klabnik"));
        assert!(result.contains("2023"));
        assert!(result.contains("No Starch Press"));
    }

    #[test]
    fn test_generate_mla() {
        let book = sample_book();
        let result = generate_citation(&book, CitationFormat::MLA).unwrap();

        // MLA format: Authors. Title. Edition, Publisher, Year.
        assert!(result.contains("Klabnik"));
        assert!(result.contains("No Starch Press"));
        assert!(result.contains("2023"));
    }

    #[test]
    fn test_generate_chicago() {
        let book = sample_book();
        let result = generate_citation(&book, CitationFormat::Chicago).unwrap();

        // Chicago format: Authors. Title. Place: Publisher, Year.
        assert!(result.contains("Klabnik"));
        assert!(result.contains("San Francisco"));
        assert!(result.contains("2023"));
    }

    #[test]
    fn test_generate_ieee() {
        let book = sample_book();
        let result = generate_citation(&book, CitationFormat::IEEE).unwrap();

        // IEEE format: [#] Authors, Title, Edition. Place: Publisher, Year.
        assert!(result.contains("Klabnik"));
        assert!(result.contains("2023"));
    }

    #[test]
    fn test_minimal_metadata() {
        let book = BookMetadata {
            id: "minimal".to_string(),
            title: "Test Book".to_string(),
            authors: vec!["Test Author".to_string()],
            ..Default::default()
        };

        // Should work with minimal metadata
        let bibtex = generate_citation(&book, CitationFormat::BibTeX).unwrap();
        assert!(bibtex.contains("Test Book"));

        let apa = generate_citation(&book, CitationFormat::APA).unwrap();
        assert!(apa.contains("Test Author"));
    }
}
