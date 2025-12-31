//! CFI (Canonical Fragment Identifier) types for EPUB
//!
//! EPUB CFI is a standardized way to reference specific locations within EPUB publications.
//! Format: epubcfi(/6/4[chap01ref]!/4/2/22/3:268)
//!
//! Reference: <https://idpf.org/epub/linking/cfi/epub-cfi.html>

use serde::{Deserialize, Serialize};
use std::fmt;

/// A complete EPUB CFI
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cfi {
    /// The path components of this CFI
    pub path: CfiPath,
    /// Optional range end (for selections)
    pub range: Option<CfiRange>,
}

/// A CFI path (sequence of steps)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CfiPath {
    /// Steps in this path
    pub steps: Vec<CfiStep>,
    /// Optional character offset at the end
    pub character_offset: Option<CharacterOffset>,
    /// Optional temporal offset (for audio/video)
    pub temporal_offset: Option<TemporalOffset>,
    /// Optional spatial offset (for images)
    pub spatial_offset: Option<SpatialOffset>,
}

/// A CFI range (for text selections)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CfiRange {
    /// Start of the range (relative path from common ancestor)
    pub start: CfiPath,
    /// End of the range (relative path from common ancestor)
    pub end: CfiPath,
}

/// A single step in a CFI path
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CfiStep {
    /// The step type (element index or indirection)
    pub step_type: StepType,
    /// Optional ID assertion [id]
    pub id_assertion: Option<String>,
    /// Optional text assertion (side bias)
    pub text_assertion: Option<TextAssertion>,
}

/// Type of CFI step
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum StepType {
    /// Element step with index (e.g., /4 = 4th child element)
    Element(u32),
    /// Indirection step (!) - steps into a referenced document
    Indirection,
}

/// Text location assertion for disambiguation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextAssertion {
    /// Text before the location
    pub prefix: Option<String>,
    /// Text after the location
    pub suffix: Option<String>,
    /// Additional parameters
    pub parameters: Vec<(String, String)>,
}

/// Character offset within a text node
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CharacterOffset {
    /// The character index (0-based)
    pub offset: u32,
    /// Optional text assertion for validation
    pub assertion: Option<TextAssertion>,
}

/// Temporal offset for audio/video (in seconds)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TemporalOffset {
    /// Time in seconds
    pub seconds: f64,
}

impl Eq for TemporalOffset {}

/// Spatial offset for images (percentage-based)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpatialOffset {
    /// X coordinate as percentage (0.0-100.0)
    pub x: f64,
    /// Y coordinate as percentage (0.0-100.0)
    pub y: f64,
}

impl Eq for SpatialOffset {}

impl Cfi {
    /// Create a new CFI from a path
    pub fn new(path: CfiPath) -> Self {
        Self { path, range: None }
    }

    /// Create a new CFI with a range
    pub fn with_range(path: CfiPath, range: CfiRange) -> Self {
        Self {
            path,
            range: Some(range),
        }
    }

    /// Check if this CFI represents a range (text selection)
    pub fn is_range(&self) -> bool {
        self.range.is_some()
    }

    /// Get the spine index if this CFI references a spine item
    /// The spine index is typically at position 2 in the path (after /6/N)
    pub fn spine_index(&self) -> Option<u32> {
        // Standard EPUB CFI format: /6/N where N is 2*(spine_index+1)
        // /6 refers to the spine element in the package document
        if self.path.steps.len() >= 2 {
            if let StepType::Element(6) = self.path.steps[0].step_type {
                if let StepType::Element(n) = self.path.steps[1].step_type {
                    // Convert from CFI index to 0-based spine index
                    // CFI uses 1-based even numbering: 2, 4, 6, 8...
                    return Some((n / 2).saturating_sub(1));
                }
            }
        }
        None
    }
}

impl CfiPath {
    /// Create an empty path
    pub fn new() -> Self {
        Self {
            steps: Vec::new(),
            character_offset: None,
            temporal_offset: None,
            spatial_offset: None,
        }
    }

    /// Create a path with steps
    pub fn with_steps(steps: Vec<CfiStep>) -> Self {
        Self {
            steps,
            character_offset: None,
            temporal_offset: None,
            spatial_offset: None,
        }
    }

    /// Add a step to the path
    pub fn push(&mut self, step: CfiStep) {
        self.steps.push(step);
    }

    /// Set the character offset
    pub fn set_character_offset(&mut self, offset: u32) {
        self.character_offset = Some(CharacterOffset {
            offset,
            assertion: None,
        });
    }
}

impl Default for CfiPath {
    fn default() -> Self {
        Self::new()
    }
}

impl CfiStep {
    /// Create an element step
    pub fn element(index: u32) -> Self {
        Self {
            step_type: StepType::Element(index),
            id_assertion: None,
            text_assertion: None,
        }
    }

    /// Create an element step with ID assertion
    pub fn element_with_id(index: u32, id: impl Into<String>) -> Self {
        Self {
            step_type: StepType::Element(index),
            id_assertion: Some(id.into()),
            text_assertion: None,
        }
    }

    /// Create an indirection step
    pub fn indirection() -> Self {
        Self {
            step_type: StepType::Indirection,
            id_assertion: None,
            text_assertion: None,
        }
    }

    /// Check if this is an indirection step
    pub fn is_indirection(&self) -> bool {
        matches!(self.step_type, StepType::Indirection)
    }

    /// Get the element index if this is an element step
    pub fn element_index(&self) -> Option<u32> {
        match self.step_type {
            StepType::Element(n) => Some(n),
            StepType::Indirection => None,
        }
    }
}

// Display implementations for serialization

impl fmt::Display for Cfi {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "epubcfi({}", self.path)?;
        if let Some(ref range) = self.range {
            write!(f, ",{},{}", range.start, range.end)?;
        }
        write!(f, ")")?;
        Ok(())
    }
}

impl fmt::Display for CfiPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for step in &self.steps {
            write!(f, "{}", step)?;
        }
        if let Some(ref offset) = self.character_offset {
            write!(f, ":{}", offset.offset)?;
            if let Some(ref assertion) = offset.assertion {
                write!(f, "{}", assertion)?;
            }
        }
        if let Some(ref temporal) = self.temporal_offset {
            write!(f, "~{}", temporal.seconds)?;
        }
        if let Some(ref spatial) = self.spatial_offset {
            write!(f, "@{}:{}", spatial.x, spatial.y)?;
        }
        Ok(())
    }
}

impl fmt::Display for CfiStep {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.step_type {
            StepType::Element(n) => write!(f, "/{}", n)?,
            StepType::Indirection => write!(f, "!")?,
        }
        if let Some(ref id) = self.id_assertion {
            write!(f, "[{}]", id)?;
        }
        if let Some(ref assertion) = self.text_assertion {
            write!(f, "{}", assertion)?;
        }
        Ok(())
    }
}

impl fmt::Display for TextAssertion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[")?;
        if let Some(ref prefix) = self.prefix {
            write!(f, "{}", prefix)?;
        }
        if self.prefix.is_some() || self.suffix.is_some() {
            write!(f, ",")?;
        }
        if let Some(ref suffix) = self.suffix {
            write!(f, "{}", suffix)?;
        }
        for (key, value) in &self.parameters {
            write!(f, ";{}={}", key, value)?;
        }
        write!(f, "]")?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_cfi_display() {
        let cfi = Cfi::new(CfiPath::with_steps(vec![
            CfiStep::element(6),
            CfiStep::element(4),
            CfiStep::indirection(),
            CfiStep::element(4),
            CfiStep::element(2),
        ]));

        assert_eq!(cfi.to_string(), "epubcfi(/6/4!/4/2)");
    }

    #[test]
    fn test_cfi_with_id_assertion() {
        let cfi = Cfi::new(CfiPath::with_steps(vec![
            CfiStep::element(6),
            CfiStep::element_with_id(4, "chapter1"),
            CfiStep::indirection(),
            CfiStep::element(4),
        ]));

        assert_eq!(cfi.to_string(), "epubcfi(/6/4[chapter1]!/4)");
    }

    #[test]
    fn test_cfi_with_character_offset() {
        let mut path = CfiPath::with_steps(vec![
            CfiStep::element(6),
            CfiStep::element(4),
            CfiStep::indirection(),
            CfiStep::element(4),
            CfiStep::element(2),
            CfiStep::element(1),
        ]);
        path.set_character_offset(42);

        let cfi = Cfi::new(path);
        assert_eq!(cfi.to_string(), "epubcfi(/6/4!/4/2/1:42)");
    }

    #[test]
    fn test_spine_index_extraction() {
        // /6/4 means spine item at index 1 (4/2 - 1 = 1)
        let cfi = Cfi::new(CfiPath::with_steps(vec![
            CfiStep::element(6),
            CfiStep::element(4),
            CfiStep::indirection(),
            CfiStep::element(4),
        ]));

        assert_eq!(cfi.spine_index(), Some(1));

        // /6/2 means spine item at index 0
        let cfi2 = Cfi::new(CfiPath::with_steps(vec![
            CfiStep::element(6),
            CfiStep::element(2),
        ]));

        assert_eq!(cfi2.spine_index(), Some(0));
    }
}
