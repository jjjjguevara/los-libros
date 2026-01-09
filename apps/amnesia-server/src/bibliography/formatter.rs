//! Citation formatter
//!
//! Generates citations in various academic formats.

use super::types::{BookMetadata, CitationFormat, CitationResult};

/// Generate a citation for a book in the specified format
pub fn generate_citation(metadata: &BookMetadata, format: CitationFormat) -> CitationResult<String> {
    match format {
        CitationFormat::BibTeX => generate_bibtex(metadata),
        CitationFormat::APA => generate_apa(metadata),
        CitationFormat::MLA => generate_mla(metadata),
        CitationFormat::Chicago => generate_chicago(metadata),
        CitationFormat::IEEE => generate_ieee(metadata),
    }
}

/// Generate citations for multiple books
pub fn generate_citation_list(
    metadata_list: &[BookMetadata],
    format: CitationFormat,
) -> CitationResult<String> {
    let citations: Vec<String> = metadata_list
        .iter()
        .map(|m| generate_citation(m, format))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(citations.join("\n\n"))
}

/// Generate BibTeX format
///
/// Example:
/// ```bibtex
/// @book{zinsser_1988_writing,
///   author = {William Zinsser},
///   title = {Writing to Learn},
///   year = {1988},
///   publisher = {Harper \& Row},
///   isbn = {978-0060158590}
/// }
/// ```
pub fn generate_bibtex(metadata: &BookMetadata) -> CitationResult<String> {
    let key = metadata.bibtex_key();
    let mut lines = vec![format!("@book{{{},", key)];

    // Author (required)
    let authors = metadata.authors.join(" and ");
    lines.push(format!("  author = {{{}}},", escape_bibtex(&authors)));

    // Title (required)
    lines.push(format!("  title = {{{}}},", escape_bibtex(&metadata.title)));

    // Year
    if let Some(year) = metadata.year {
        lines.push(format!("  year = {{{}}},", year));
    }

    // Publisher
    if let Some(ref publisher) = metadata.publisher {
        lines.push(format!("  publisher = {{{}}},", escape_bibtex(publisher)));
    }

    // Address/Place
    if let Some(ref place) = metadata.place {
        lines.push(format!("  address = {{{}}},", escape_bibtex(place)));
    }

    // Edition
    if let Some(ref edition) = metadata.edition {
        lines.push(format!("  edition = {{{}}},", escape_bibtex(edition)));
    }

    // ISBN
    if let Some(ref isbn) = metadata.isbn {
        lines.push(format!("  isbn = {{{}}},", isbn));
    }

    // DOI
    if let Some(ref doi) = metadata.doi {
        lines.push(format!("  doi = {{{}}},", doi));
    }

    // URL
    if let Some(ref url) = metadata.url {
        lines.push(format!("  url = {{{}}},", url));
    }

    // Series
    if let Some(ref series) = metadata.series {
        lines.push(format!("  series = {{{}}},", escape_bibtex(series)));
    }

    // Volume
    if let Some(ref volume) = metadata.volume {
        lines.push(format!("  volume = {{{}}},", volume));
    }

    // Pages
    if let Some(pages) = metadata.pages {
        lines.push(format!("  pages = {{{}}},", pages));
    }

    // Abstract
    if let Some(ref abstract_text) = metadata.abstract_text {
        lines.push(format!("  abstract = {{{}}},", escape_bibtex(abstract_text)));
    }

    // Keywords
    if !metadata.keywords.is_empty() {
        lines.push(format!(
            "  keywords = {{{}}},",
            metadata.keywords.join(", ")
        ));
    }

    // Remove trailing comma from last field
    if let Some(last) = lines.last_mut() {
        if last.ends_with(',') {
            last.pop();
        }
    }

    lines.push("}".to_string());

    Ok(lines.join("\n"))
}

/// Generate APA 7th edition format
///
/// Format: Author, A. A., & Author, B. B. (Year). Title (Edition ed.). Publisher.
///
/// Example:
/// Klabnik, S., & Nichols, C. (2023). The Rust programming language (2nd ed.). No Starch Press.
pub fn generate_apa(metadata: &BookMetadata) -> CitationResult<String> {
    let mut parts = Vec::new();

    // Authors
    let authors = metadata.format_authors_apa();
    parts.push(authors);

    // Year
    let year = metadata
        .year
        .map(|y| format!("({})", y))
        .unwrap_or_else(|| "(n.d.)".to_string());
    parts.push(year);

    // Title (italicized in rendered output, indicated by asterisks for plain text)
    let mut title = format!("*{}*", metadata.title);
    if let Some(ref edition) = metadata.edition {
        title.push_str(&format!(" ({} ed.)", edition));
    }
    title.push('.');
    parts.push(title);

    // Publisher
    if let Some(ref publisher) = metadata.publisher {
        parts.push(format!("{}.", publisher));
    }

    // DOI or URL
    if let Some(ref doi) = metadata.doi {
        parts.push(format!("https://doi.org/{}", doi));
    } else if let Some(ref url) = metadata.url {
        parts.push(url.clone());
    }

    Ok(parts.join(" "))
}

/// Generate MLA 9th edition format
///
/// Format: Last, First. *Title*. Edition, Publisher, Year.
///
/// Example:
/// Klabnik, Steve, and Carol Nichols. *The Rust Programming Language*. 2nd ed., No Starch Press, 2023.
pub fn generate_mla(metadata: &BookMetadata) -> CitationResult<String> {
    let mut parts = Vec::new();

    // Authors
    let authors = metadata.format_authors_mla();
    parts.push(format!("{}.", authors));

    // Title (italicized)
    parts.push(format!("*{}*.", metadata.title));

    // Edition (if not first)
    if let Some(ref edition) = metadata.edition {
        parts.push(format!("{} ed.,", edition));
    }

    // Publisher
    if let Some(ref publisher) = metadata.publisher {
        parts.push(format!("{},", publisher));
    }

    // Year
    if let Some(year) = metadata.year {
        parts.push(format!("{}.", year));
    }

    Ok(parts.join(" "))
}

/// Generate Chicago Manual of Style 17th edition format (Notes-Bibliography)
///
/// Format: Last, First. *Title*. Place: Publisher, Year.
///
/// Example:
/// Klabnik, Steve, and Carol Nichols. *The Rust Programming Language*. San Francisco: No Starch Press, 2023.
pub fn generate_chicago(metadata: &BookMetadata) -> CitationResult<String> {
    let mut parts = Vec::new();

    // Authors
    let authors = metadata.format_authors_chicago();
    parts.push(format!("{}.", authors));

    // Title (italicized)
    parts.push(format!("*{}*.", metadata.title));

    // Edition (if present)
    if let Some(ref edition) = metadata.edition {
        parts.push(format!("{} ed.", edition));
    }

    // Place and Publisher
    match (&metadata.place, &metadata.publisher) {
        (Some(place), Some(publisher)) => {
            parts.push(format!("{}: {},", place, publisher));
        }
        (None, Some(publisher)) => {
            parts.push(format!("{},", publisher));
        }
        (Some(place), None) => {
            parts.push(format!("{},", place));
        }
        (None, None) => {}
    }

    // Year
    if let Some(year) = metadata.year {
        parts.push(format!("{}.", year));
    }

    Ok(parts.join(" "))
}

/// Generate IEEE format
///
/// Format: [#] A. A. Author and B. B. Author, *Title*, Edition ed. Place: Publisher, Year.
///
/// Example:
/// S. Klabnik and C. Nichols, *The Rust Programming Language*, 2nd ed. San Francisco, CA: No Starch Press, 2023.
pub fn generate_ieee(metadata: &BookMetadata) -> CitationResult<String> {
    let mut parts = Vec::new();

    // Authors
    let authors = metadata.format_authors_ieee();
    parts.push(format!("{},", authors));

    // Title (italicized)
    parts.push(format!("*{}*,", metadata.title));

    // Edition
    if let Some(ref edition) = metadata.edition {
        parts.push(format!("{} ed.", edition));
    }

    // Place and Publisher
    match (&metadata.place, &metadata.publisher) {
        (Some(place), Some(publisher)) => {
            parts.push(format!("{}: {},", place, publisher));
        }
        (None, Some(publisher)) => {
            parts.push(format!("{},", publisher));
        }
        _ => {}
    }

    // Year
    if let Some(year) = metadata.year {
        parts.push(format!("{}.", year));
    }

    Ok(parts.join(" "))
}

/// Escape special characters for BibTeX
fn escape_bibtex(s: &str) -> String {
    s.replace('&', r"\&")
        .replace('%', r"\%")
        .replace('$', r"\$")
        .replace('#', r"\#")
        .replace('_', r"\_")
        .replace('{', r"\{")
        .replace('}', r"\}")
        .replace('~', r"\textasciitilde{}")
        .replace('^', r"\textasciicircum{}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_book() -> BookMetadata {
        BookMetadata {
            id: "test-book".to_string(),
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
    fn test_bibtex_escaping() {
        assert_eq!(escape_bibtex("Test & Test"), r"Test \& Test");
        assert_eq!(escape_bibtex("100%"), r"100\%");
    }

    #[test]
    fn test_bibtex_format() {
        let book = sample_book();
        let result = generate_bibtex(&book).unwrap();

        assert!(result.starts_with("@book{"));
        assert!(result.contains("author = {Steve Klabnik and Carol Nichols}"));
        assert!(result.contains("title = {The Rust Programming Language}"));
        assert!(result.contains("year = {2023}"));
        assert!(result.contains("publisher = {No Starch Press}"));
        assert!(result.contains("isbn = {978-1718503106}"));
        assert!(result.ends_with("}"));
    }

    #[test]
    fn test_apa_format() {
        let book = sample_book();
        let result = generate_apa(&book).unwrap();

        // Should contain author names in APA format
        assert!(result.contains("Klabnik, S."));
        assert!(result.contains("& Nichols, C."));
        // Should contain year in parentheses
        assert!(result.contains("(2023)"));
        // Should have italicized title
        assert!(result.contains("*The Rust Programming Language*"));
        // Should have edition
        assert!(result.contains("2nd ed."));
        // Should have publisher
        assert!(result.contains("No Starch Press"));
    }

    #[test]
    fn test_mla_format() {
        let book = sample_book();
        let result = generate_mla(&book).unwrap();

        // First author in Last, First format
        assert!(result.contains("Klabnik, Steve"));
        // Second author in First Last format
        assert!(result.contains("and Carol Nichols"));
        // Italicized title
        assert!(result.contains("*The Rust Programming Language*"));
        // Edition
        assert!(result.contains("2nd ed."));
        // Publisher and year
        assert!(result.contains("No Starch Press"));
        assert!(result.contains("2023"));
    }

    #[test]
    fn test_chicago_format() {
        let book = sample_book();
        let result = generate_chicago(&book).unwrap();

        // Authors
        assert!(result.contains("Klabnik, Steve"));
        // Place: Publisher format
        assert!(result.contains("San Francisco: No Starch Press"));
        // Year
        assert!(result.contains("2023"));
    }

    #[test]
    fn test_ieee_format() {
        let book = sample_book();
        let result = generate_ieee(&book).unwrap();

        // IEEE uses initials first: S. Klabnik
        assert!(result.contains("S. Klabnik"));
        assert!(result.contains("C. Nichols"));
        // Italicized title
        assert!(result.contains("*The Rust Programming Language*"));
        // Edition
        assert!(result.contains("2nd ed."));
    }

    #[test]
    fn test_generate_citation_list() {
        let books = vec![
            BookMetadata::new("book1", "First Book", vec!["Author One".to_string()]),
            BookMetadata::new("book2", "Second Book", vec!["Author Two".to_string()]),
        ];

        let result = generate_citation_list(&books, CitationFormat::BibTeX).unwrap();
        assert!(result.contains("First Book"));
        assert!(result.contains("Second Book"));
        assert!(result.contains("\n\n")); // Separated by blank line
    }

    #[test]
    fn test_minimal_book() {
        let book = BookMetadata {
            id: "minimal".to_string(),
            title: "Minimal Book".to_string(),
            authors: vec!["Single Author".to_string()],
            ..Default::default()
        };

        // All formats should work with minimal metadata
        assert!(generate_bibtex(&book).is_ok());
        assert!(generate_apa(&book).is_ok());
        assert!(generate_mla(&book).is_ok());
        assert!(generate_chicago(&book).is_ok());
        assert!(generate_ieee(&book).is_ok());
    }
}
