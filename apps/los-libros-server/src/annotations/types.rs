//! Annotation types following Web Annotation / Readium format
//!
//! These types are compatible with the W3C Web Annotation Data Model
//! and Readium's annotation format for interoperability.
//!
//! Reference: <https://www.w3.org/TR/annotation-model/>

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A complete annotation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Annotation {
    /// Unique identifier (UUID)
    pub id: String,
    /// The book this annotation belongs to
    #[serde(rename = "bookId")]
    pub book_id: String,
    /// User or device ID
    #[serde(rename = "userId", skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    /// Type of annotation
    #[serde(rename = "type")]
    pub annotation_type: AnnotationType,
    /// The target of the annotation (what is being annotated)
    pub target: AnnotationTarget,
    /// The body/content of the annotation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<AnnotationBody>,
    /// Style information (color, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<AnnotationStyle>,
    /// Creation timestamp
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
    /// Last modification timestamp
    #[serde(rename = "updatedAt")]
    pub updated_at: DateTime<Utc>,
    /// Sync metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync: Option<SyncMetadata>,
}

/// Types of annotations
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationType {
    /// Text highlight
    Highlight,
    /// Bookmark (position marker)
    Bookmark,
    /// Text note with content
    Note,
    /// Underline
    Underline,
}

/// The target of an annotation (what is being annotated)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnotationTarget {
    /// Source document (spine item href)
    pub source: String,
    /// Multiple selectors for robust anchoring
    pub selectors: Vec<Selector>,
}

/// Selector types for identifying text/positions
/// Multiple selectors provide fallback options for resolution
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "PascalCase")]
pub enum Selector {
    /// EPUB CFI fragment identifier
    #[serde(rename = "FragmentSelector")]
    Fragment {
        /// The CFI value
        value: String,
    },
    /// Text quote with context
    #[serde(rename = "TextQuoteSelector")]
    TextQuote {
        /// The exact text that was highlighted
        exact: String,
        /// Text before the selection (for context)
        #[serde(skip_serializing_if = "Option::is_none")]
        prefix: Option<String>,
        /// Text after the selection (for context)
        #[serde(skip_serializing_if = "Option::is_none")]
        suffix: Option<String>,
    },
    /// Character position within document
    #[serde(rename = "TextPositionSelector")]
    TextPosition {
        /// Start character offset
        start: usize,
        /// End character offset
        end: usize,
    },
    /// Progression through the book (0.0-1.0)
    #[serde(rename = "ProgressionSelector")]
    Progression {
        /// Position as percentage
        value: f64,
    },
    /// DOM range (for client-side use)
    #[serde(rename = "DomRangeSelector")]
    DomRange {
        /// Start container path
        #[serde(rename = "startContainerPath")]
        start_container_path: String,
        /// Start offset
        #[serde(rename = "startOffset")]
        start_offset: usize,
        /// End container path
        #[serde(rename = "endContainerPath")]
        end_container_path: String,
        /// End offset
        #[serde(rename = "endOffset")]
        end_offset: usize,
    },
}

/// Body/content of an annotation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnotationBody {
    /// Type of body content
    #[serde(rename = "type")]
    pub body_type: BodyType,
    /// The actual content
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    /// Format of the content
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
}

/// Types of annotation body content
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum BodyType {
    /// Plain text note
    TextualBody,
    /// No body (e.g., simple highlight)
    None,
}

/// Visual style for highlights
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnotationStyle {
    /// Highlight color (CSS color value)
    pub color: String,
    /// Opacity (0.0-1.0)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f32>,
}

impl Default for AnnotationStyle {
    fn default() -> Self {
        Self {
            color: "#ffff00".to_string(), // Yellow
            opacity: Some(0.3),
        }
    }
}

/// Sync metadata for conflict resolution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncMetadata {
    /// Version for optimistic locking
    pub version: u64,
    /// Device that last modified
    #[serde(rename = "deviceId")]
    pub device_id: String,
    /// Whether this has been synced to server
    pub synced: bool,
    /// Checksum for change detection
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum: Option<String>,
}

impl Annotation {
    /// Create a new highlight annotation
    pub fn new_highlight(book_id: &str, target: AnnotationTarget) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            book_id: book_id.to_string(),
            user_id: None,
            annotation_type: AnnotationType::Highlight,
            target,
            body: None,
            style: Some(AnnotationStyle::default()),
            created_at: now,
            updated_at: now,
            sync: None,
        }
    }

    /// Create a new note annotation
    pub fn new_note(book_id: &str, target: AnnotationTarget, note: &str) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            book_id: book_id.to_string(),
            user_id: None,
            annotation_type: AnnotationType::Note,
            target,
            body: Some(AnnotationBody {
                body_type: BodyType::TextualBody,
                value: Some(note.to_string()),
                format: Some("text/plain".to_string()),
            }),
            style: Some(AnnotationStyle::default()),
            created_at: now,
            updated_at: now,
            sync: None,
        }
    }

    /// Create a new bookmark annotation
    pub fn new_bookmark(book_id: &str, target: AnnotationTarget) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            book_id: book_id.to_string(),
            user_id: None,
            annotation_type: AnnotationType::Bookmark,
            target,
            body: None,
            style: None,
            created_at: now,
            updated_at: now,
            sync: None,
        }
    }

    /// Set the user ID
    pub fn with_user(mut self, user_id: &str) -> Self {
        self.user_id = Some(user_id.to_string());
        self
    }

    /// Set the color
    pub fn with_color(mut self, color: &str) -> Self {
        self.style = Some(AnnotationStyle {
            color: color.to_string(),
            opacity: Some(0.3),
        });
        self
    }

    /// Get the primary CFI selector if available
    pub fn cfi(&self) -> Option<&str> {
        self.target.selectors.iter().find_map(|s| match s {
            Selector::Fragment { value } => Some(value.as_str()),
            _ => None,
        })
    }

    /// Get the text quote selector if available
    pub fn text_quote(&self) -> Option<&str> {
        self.target.selectors.iter().find_map(|s| match s {
            Selector::TextQuote { exact, .. } => Some(exact.as_str()),
            _ => None,
        })
    }

    /// Get the progression value if available
    pub fn progression(&self) -> Option<f64> {
        self.target.selectors.iter().find_map(|s| match s {
            Selector::Progression { value } => Some(*value),
            _ => None,
        })
    }
}

impl AnnotationTarget {
    /// Create a new target with a single CFI selector
    pub fn from_cfi(source: &str, cfi: &str) -> Self {
        Self {
            source: source.to_string(),
            selectors: vec![Selector::Fragment {
                value: cfi.to_string(),
            }],
        }
    }

    /// Create a target with multiple selectors for robust anchoring
    pub fn with_selectors(source: &str, selectors: Vec<Selector>) -> Self {
        Self {
            source: source.to_string(),
            selectors,
        }
    }

    /// Add a text quote selector
    pub fn add_text_quote(&mut self, exact: &str, prefix: Option<&str>, suffix: Option<&str>) {
        self.selectors.push(Selector::TextQuote {
            exact: exact.to_string(),
            prefix: prefix.map(|s| s.to_string()),
            suffix: suffix.map(|s| s.to_string()),
        });
    }

    /// Add a progression selector
    pub fn add_progression(&mut self, value: f64) {
        self.selectors.push(Selector::Progression { value });
    }

    /// Add a text position selector
    pub fn add_text_position(&mut self, start: usize, end: usize) {
        self.selectors.push(Selector::TextPosition { start, end });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_highlight() {
        let target = AnnotationTarget::from_cfi("chapter1.xhtml", "epubcfi(/6/4!/4/2/1:10)");
        let highlight = Annotation::new_highlight("book-123", target);

        assert_eq!(highlight.annotation_type, AnnotationType::Highlight);
        assert_eq!(highlight.book_id, "book-123");
        assert!(highlight.cfi().is_some());
        assert_eq!(highlight.cfi().unwrap(), "epubcfi(/6/4!/4/2/1:10)");
    }

    #[test]
    fn test_create_note() {
        let target = AnnotationTarget::from_cfi("chapter1.xhtml", "epubcfi(/6/4!/4/2)");
        let note = Annotation::new_note("book-123", target, "This is my note");

        assert_eq!(note.annotation_type, AnnotationType::Note);
        assert!(note.body.is_some());
        assert_eq!(note.body.unwrap().value.unwrap(), "This is my note");
    }

    #[test]
    fn test_multi_selector_target() {
        let mut target = AnnotationTarget::from_cfi("chapter1.xhtml", "epubcfi(/6/4!/4/2/1:10)");
        target.add_text_quote("hello world", Some("say "), Some("!"));
        target.add_progression(0.25);

        assert_eq!(target.selectors.len(), 3);
    }

    #[test]
    fn test_serialization() {
        let target = AnnotationTarget::from_cfi("chapter1.xhtml", "epubcfi(/6/4!/4/2)");
        let highlight = Annotation::new_highlight("book-123", target).with_color("#ff0000");

        let json = serde_json::to_string_pretty(&highlight).unwrap();
        assert!(json.contains("\"type\": \"highlight\""));
        assert!(json.contains("FragmentSelector"));
        assert!(json.contains("#ff0000"));

        // Verify round-trip
        let parsed: Annotation = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.book_id, "book-123");
    }
}
