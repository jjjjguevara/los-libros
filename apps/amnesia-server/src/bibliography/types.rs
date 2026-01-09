//! Bibliography types

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Citation format options
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CitationFormat {
    /// BibTeX format for LaTeX
    BibTeX,
    /// APA 7th edition
    APA,
    /// MLA 9th edition
    MLA,
    /// Chicago Manual of Style 17th edition
    Chicago,
    /// IEEE format
    IEEE,
}

impl std::fmt::Display for CitationFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BibTeX => write!(f, "bibtex"),
            Self::APA => write!(f, "apa"),
            Self::MLA => write!(f, "mla"),
            Self::Chicago => write!(f, "chicago"),
            Self::IEEE => write!(f, "ieee"),
        }
    }
}

impl std::str::FromStr for CitationFormat {
    type Err = CitationError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "bibtex" | "bib" => Ok(Self::BibTeX),
            "apa" | "apa7" => Ok(Self::APA),
            "mla" | "mla9" => Ok(Self::MLA),
            "chicago" | "chicago17" | "cmos" => Ok(Self::Chicago),
            "ieee" => Ok(Self::IEEE),
            _ => Err(CitationError::InvalidFormat(s.to_string())),
        }
    }
}

/// Book metadata for citation generation
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookMetadata {
    /// Unique book identifier
    pub id: String,
    /// Book title
    pub title: String,
    /// List of authors
    pub authors: Vec<String>,
    /// Publication year
    pub year: Option<i32>,
    /// Publisher name
    pub publisher: Option<String>,
    /// ISBN (10 or 13)
    pub isbn: Option<String>,
    /// DOI
    pub doi: Option<String>,
    /// URL
    pub url: Option<String>,
    /// Publication place (city)
    pub place: Option<String>,
    /// Edition (e.g., "2nd", "revised")
    pub edition: Option<String>,
    /// Series name
    pub series: Option<String>,
    /// Volume number
    pub volume: Option<String>,
    /// Number of pages
    pub pages: Option<i32>,
    /// Language code (e.g., "en", "es")
    pub language: Option<String>,
    /// Book description/abstract
    pub abstract_text: Option<String>,
    /// Keywords/tags
    pub keywords: Vec<String>,
}

impl BookMetadata {
    /// Create a new BookMetadata with required fields
    pub fn new(id: impl Into<String>, title: impl Into<String>, authors: Vec<String>) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            authors,
            ..Default::default()
        }
    }

    /// Generate a BibTeX key from metadata
    pub fn bibtex_key(&self) -> String {
        let author_part = self
            .authors
            .first()
            .map(|a| {
                // Get last name (everything after the last space, or the whole name)
                a.split_whitespace()
                    .last()
                    .unwrap_or(a)
                    .chars()
                    .filter(|c| c.is_alphanumeric())
                    .collect::<String>()
                    .to_lowercase()
            })
            .unwrap_or_else(|| "unknown".to_string());

        let year_part = self.year.map(|y| y.to_string()).unwrap_or_else(|| "nd".to_string());

        let title_part = self
            .title
            .split_whitespace()
            .next()
            .unwrap_or("untitled")
            .chars()
            .filter(|c| c.is_alphanumeric())
            .collect::<String>()
            .to_lowercase();

        format!("{}_{}_{}",author_part, year_part, title_part)
    }

    /// Format authors for APA style (Last, F. M., & Last, F. M.)
    pub fn format_authors_apa(&self) -> String {
        if self.authors.is_empty() {
            return "Unknown Author".to_string();
        }

        let formatted: Vec<String> = self
            .authors
            .iter()
            .map(|author| format_author_apa(author))
            .collect();

        match formatted.len() {
            1 => formatted[0].clone(),
            2 => format!("{} & {}", formatted[0], formatted[1]),
            _ => {
                let last = formatted.last().unwrap();
                let rest: Vec<&str> = formatted.iter().take(formatted.len() - 1).map(|s| s.as_str()).collect();
                format!("{}, & {}", rest.join(", "), last)
            }
        }
    }

    /// Format authors for MLA style (Last, First Middle)
    pub fn format_authors_mla(&self) -> String {
        if self.authors.is_empty() {
            return "Unknown Author".to_string();
        }

        let formatted: Vec<String> = self
            .authors
            .iter()
            .enumerate()
            .map(|(i, author)| {
                if i == 0 {
                    // First author: Last, First
                    format_author_mla_first(author)
                } else {
                    // Subsequent: First Last
                    author.clone()
                }
            })
            .collect();

        match formatted.len() {
            1 => formatted[0].clone(),
            2 => format!("{}, and {}", formatted[0], formatted[1]),
            _ => format!("{}, et al.", formatted[0]),
        }
    }

    /// Format authors for Chicago style
    pub fn format_authors_chicago(&self) -> String {
        // Chicago is similar to MLA for bibliography
        self.format_authors_mla()
    }

    /// Format authors for IEEE style (F. M. Last)
    pub fn format_authors_ieee(&self) -> String {
        if self.authors.is_empty() {
            return "Unknown Author".to_string();
        }

        let formatted: Vec<String> = self
            .authors
            .iter()
            .map(|author| format_author_ieee(author))
            .collect();

        match formatted.len() {
            1 => formatted[0].clone(),
            2 => format!("{} and {}", formatted[0], formatted[1]),
            _ => {
                let last = formatted.last().unwrap();
                let rest: Vec<&str> = formatted.iter().take(formatted.len() - 1).map(|s| s.as_str()).collect();
                format!("{}, and {}", rest.join(", "), last)
            }
        }
    }
}

/// Format a single author for APA style: Last, F. M.
fn format_author_apa(name: &str) -> String {
    let parts: Vec<&str> = name.split_whitespace().collect();
    if parts.is_empty() {
        return "Unknown".to_string();
    }

    if parts.len() == 1 {
        return parts[0].to_string();
    }

    let last = parts.last().unwrap();
    let initials: String = parts[..parts.len() - 1]
        .iter()
        .filter_map(|p| p.chars().next())
        .map(|c| format!("{}.", c.to_uppercase()))
        .collect::<Vec<_>>()
        .join(" ");

    format!("{}, {}", last, initials)
}

/// Format a single author for MLA first position: Last, First Middle
fn format_author_mla_first(name: &str) -> String {
    let parts: Vec<&str> = name.split_whitespace().collect();
    if parts.is_empty() {
        return "Unknown".to_string();
    }

    if parts.len() == 1 {
        return parts[0].to_string();
    }

    let last = parts.last().unwrap();
    let rest = parts[..parts.len() - 1].join(" ");

    format!("{}, {}", last, rest)
}

/// Format a single author for IEEE style: F. M. Last
fn format_author_ieee(name: &str) -> String {
    let parts: Vec<&str> = name.split_whitespace().collect();
    if parts.is_empty() {
        return "Unknown".to_string();
    }

    if parts.len() == 1 {
        return parts[0].to_string();
    }

    let last = parts.last().unwrap();
    let initials: String = parts[..parts.len() - 1]
        .iter()
        .filter_map(|p| p.chars().next())
        .map(|c| format!("{}.", c.to_uppercase()))
        .collect::<Vec<_>>()
        .join(" ");

    format!("{} {}", initials, last)
}

/// Citation generation errors
#[derive(Debug, Error)]
pub enum CitationError {
    #[error("Invalid citation format: {0}")]
    InvalidFormat(String),

    #[error("Missing required field: {0}")]
    MissingField(String),

    #[error("Formatting error: {0}")]
    FormatError(String),
}

/// Result type for citation operations
pub type CitationResult<T> = Result<T, CitationError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_author_apa() {
        assert_eq!(format_author_apa("Steve Klabnik"), "Klabnik, S.");
        assert_eq!(format_author_apa("Carol Ann Nichols"), "Nichols, C. A.");
        assert_eq!(format_author_apa("Zinsser"), "Zinsser");
    }

    #[test]
    fn test_format_author_ieee() {
        assert_eq!(format_author_ieee("Steve Klabnik"), "S. Klabnik");
        assert_eq!(format_author_ieee("Carol Ann Nichols"), "C. A. Nichols");
    }

    #[test]
    fn test_bibtex_key() {
        let book = BookMetadata::new("id", "The Rust Book", vec!["Steve Klabnik".to_string()]);
        let key = book.bibtex_key();
        assert!(key.contains("klabnik"));
        assert!(key.contains("the"));
    }

    #[test]
    fn test_format_authors_apa() {
        // Single author
        let book1 = BookMetadata::new("id", "Test", vec!["John Smith".to_string()]);
        assert_eq!(book1.format_authors_apa(), "Smith, J.");

        // Two authors
        let book2 = BookMetadata::new(
            "id",
            "Test",
            vec!["John Smith".to_string(), "Jane Doe".to_string()],
        );
        assert_eq!(book2.format_authors_apa(), "Smith, J. & Doe, J.");

        // Three+ authors
        let book3 = BookMetadata::new(
            "id",
            "Test",
            vec![
                "John Smith".to_string(),
                "Jane Doe".to_string(),
                "Bob Jones".to_string(),
            ],
        );
        assert_eq!(book3.format_authors_apa(), "Smith, J., Doe, J., & Jones, B.");
    }

    #[test]
    fn test_citation_format_from_str() {
        assert_eq!(
            "bibtex".parse::<CitationFormat>().unwrap(),
            CitationFormat::BibTeX
        );
        assert_eq!(
            "apa".parse::<CitationFormat>().unwrap(),
            CitationFormat::APA
        );
        assert_eq!(
            "mla9".parse::<CitationFormat>().unwrap(),
            CitationFormat::MLA
        );
        assert!("invalid".parse::<CitationFormat>().is_err());
    }
}
