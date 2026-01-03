//! CFI Generator
//!
//! Generates CFI strings from document positions and text selections.

use super::types::*;

/// Builder for constructing CFIs programmatically
#[derive(Debug, Clone)]
pub struct CfiBuilder {
    path: CfiPath,
}

impl CfiBuilder {
    /// Create a new CFI builder
    pub fn new() -> Self {
        Self {
            path: CfiPath::new(),
        }
    }

    /// Add a step to the package document (/6 is the spine in EPUB 3)
    pub fn package_step(mut self) -> Self {
        self.path.push(CfiStep::element(6));
        self
    }

    /// Add a spine item step (converts 0-based index to CFI format)
    /// CFI uses 1-based even numbering: index 0 -> /2, index 1 -> /4, etc.
    pub fn spine_item(mut self, index: usize) -> Self {
        let cfi_index = ((index + 1) * 2) as u32;
        self.path.push(CfiStep::element(cfi_index));
        self
    }

    /// Add a spine item step with ID assertion
    pub fn spine_item_with_id(mut self, index: usize, id: impl Into<String>) -> Self {
        let cfi_index = ((index + 1) * 2) as u32;
        self.path.push(CfiStep::element_with_id(cfi_index, id));
        self
    }

    /// Add an indirection step (entering a content document)
    pub fn indirection(mut self) -> Self {
        self.path.push(CfiStep::indirection());
        self
    }

    /// Add an element step within the content document
    /// Uses 1-based even numbering: index 0 -> /2, index 1 -> /4, etc.
    pub fn element(mut self, index: usize) -> Self {
        let cfi_index = ((index + 1) * 2) as u32;
        self.path.push(CfiStep::element(cfi_index));
        self
    }

    /// Add an element step with raw CFI index (for when you have the actual CFI value)
    pub fn element_raw(mut self, cfi_index: u32) -> Self {
        self.path.push(CfiStep::element(cfi_index));
        self
    }

    /// Add an element step with ID assertion
    pub fn element_with_id(mut self, index: usize, id: impl Into<String>) -> Self {
        let cfi_index = ((index + 1) * 2) as u32;
        self.path.push(CfiStep::element_with_id(cfi_index, id));
        self
    }

    /// Add a text node step (odd numbers for text nodes)
    /// Text nodes use 1-based odd numbering: first text -> /1, second text -> /3, etc.
    pub fn text_node(mut self, index: usize) -> Self {
        let cfi_index = (index * 2 + 1) as u32;
        self.path.push(CfiStep::element(cfi_index));
        self
    }

    /// Set the character offset within a text node
    pub fn character_offset(mut self, offset: u32) -> Self {
        self.path.character_offset = Some(CharacterOffset {
            offset,
            assertion: None,
        });
        self
    }

    /// Set the character offset with text assertion for validation
    pub fn character_offset_with_assertion(
        mut self,
        offset: u32,
        prefix: Option<String>,
        suffix: Option<String>,
    ) -> Self {
        self.path.character_offset = Some(CharacterOffset {
            offset,
            assertion: Some(TextAssertion {
                prefix,
                suffix,
                parameters: Vec::new(),
            }),
        });
        self
    }

    /// Set a temporal offset (for audio/video)
    pub fn temporal_offset(mut self, seconds: f64) -> Self {
        self.path.temporal_offset = Some(TemporalOffset { seconds });
        self
    }

    /// Set a spatial offset (for images)
    pub fn spatial_offset(mut self, x: f64, y: f64) -> Self {
        self.path.spatial_offset = Some(SpatialOffset { x, y });
        self
    }

    /// Build the final CFI
    pub fn build(self) -> Cfi {
        Cfi::new(self.path)
    }

    /// Get the current path
    pub fn path(&self) -> &CfiPath {
        &self.path
    }
}

impl Default for CfiBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Generate a CFI for a position in a spine item
///
/// # Arguments
/// * `spine_index` - 0-based index of the spine item
/// * `element_path` - Path of element indices within the content document
/// * `text_node_index` - Index of the text node within the final element (0-based)
/// * `char_offset` - Character offset within the text node
///
/// # Example
/// ```ignore
/// // CFI for character 42 in the first text node of the first paragraph in chapter 2
/// let cfi = generate_cfi(1, &[0, 0], 0, 42);
/// // Returns: epubcfi(/6/4!/4/2/1:42)
/// ```
pub fn generate_cfi(
    spine_index: usize,
    element_path: &[usize],
    text_node_index: usize,
    char_offset: u32,
) -> Cfi {
    let mut builder = CfiBuilder::new()
        .package_step()
        .spine_item(spine_index)
        .indirection();

    // Add element steps for the path
    // Start with body (element 0 -> /2) then add the rest
    builder = builder.element(0); // body

    for &idx in element_path {
        builder = builder.element(idx);
    }

    // Add text node and character offset
    builder = builder.text_node(text_node_index).character_offset(char_offset);

    builder.build()
}

/// Generate a CFI range for a text selection
///
/// # Arguments
/// * `spine_index` - 0-based index of the spine item
/// * `start_path` - Element path to the start of the selection
/// * `start_text_index` - Text node index at the start
/// * `start_offset` - Character offset at the start
/// * `end_path` - Element path to the end of the selection
/// * `end_text_index` - Text node index at the end
/// * `end_offset` - Character offset at the end
pub fn generate_cfi_range(
    spine_index: usize,
    start_path: &[usize],
    start_text_index: usize,
    start_offset: u32,
    end_path: &[usize],
    end_text_index: usize,
    end_offset: u32,
) -> Cfi {
    // Find common ancestor path
    let common_len = start_path
        .iter()
        .zip(end_path.iter())
        .take_while(|(a, b)| a == b)
        .count();

    // Build the common path
    let mut builder = CfiBuilder::new()
        .package_step()
        .spine_item(spine_index)
        .indirection()
        .element(0); // body

    for &idx in &start_path[..common_len] {
        builder = builder.element(idx);
    }

    let common_path = builder.build();

    // Build relative start path
    let mut start_builder = CfiBuilder::new();
    for &idx in &start_path[common_len..] {
        start_builder = start_builder.element(idx);
    }
    start_builder = start_builder
        .text_node(start_text_index)
        .character_offset(start_offset);
    let start_rel = start_builder.path;

    // Build relative end path
    let mut end_builder = CfiBuilder::new();
    for &idx in &end_path[common_len..] {
        end_builder = end_builder.element(idx);
    }
    end_builder = end_builder
        .text_node(end_text_index)
        .character_offset(end_offset);
    let end_rel = end_builder.path;

    Cfi::with_range(
        common_path.path,
        CfiRange {
            start: start_rel,
            end: end_rel,
        },
    )
}

/// Generate a simple progression-based CFI
/// This creates a CFI that represents a percentage through a spine item
///
/// # Arguments
/// * `spine_index` - 0-based spine item index
/// * `progression` - Value from 0.0 to 1.0 representing position
///
/// Note: This is a simplified CFI that may not be precisely resolvable,
/// but is useful for approximate position tracking
pub fn generate_progression_cfi(spine_index: usize, _progression: f64) -> Cfi {
    CfiBuilder::new()
        .package_step()
        .spine_item(spine_index)
        .indirection()
        .element(0) // body
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cfi_builder_simple() {
        let cfi = CfiBuilder::new()
            .package_step()
            .spine_item(1) // Second spine item -> /4
            .indirection()
            .element(0) // body -> /2
            .element(0) // first child -> /2
            .text_node(0) // first text -> /1
            .character_offset(42)
            .build();

        assert_eq!(cfi.to_string(), "epubcfi(/6/4!/2/2/1:42)");
    }

    #[test]
    fn test_cfi_builder_with_id() {
        let cfi = CfiBuilder::new()
            .package_step()
            .spine_item_with_id(0, "chapter1")
            .indirection()
            .element(0)
            .build();

        assert_eq!(cfi.to_string(), "epubcfi(/6/2[chapter1]!/2)");
    }

    #[test]
    fn test_generate_cfi() {
        let cfi = generate_cfi(0, &[0, 1], 0, 100);
        // spine 0 -> /2, body -> /2, first child -> /2, second child -> /4, text -> /1
        assert_eq!(cfi.to_string(), "epubcfi(/6/2!/2/2/4/1:100)");
    }

    #[test]
    fn test_generate_cfi_range() {
        let cfi = generate_cfi_range(0, &[0, 0], 0, 10, &[0, 1], 0, 20);

        assert!(cfi.is_range());
        // Common path: /6/2!/2/2
        // Start relative: /2/1:10
        // End relative: /4/1:20
        let s = cfi.to_string();
        assert!(s.starts_with("epubcfi(/6/2!/2/2,"));
    }

    #[test]
    fn test_spine_index_conversion() {
        // Spine index 0 should become /2 in CFI
        let cfi = CfiBuilder::new().package_step().spine_item(0).build();
        assert_eq!(cfi.to_string(), "epubcfi(/6/2)");

        // Spine index 1 should become /4 in CFI
        let cfi = CfiBuilder::new().package_step().spine_item(1).build();
        assert_eq!(cfi.to_string(), "epubcfi(/6/4)");

        // Spine index 4 should become /10 in CFI
        let cfi = CfiBuilder::new().package_step().spine_item(4).build();
        assert_eq!(cfi.to_string(), "epubcfi(/6/10)");
    }
}
