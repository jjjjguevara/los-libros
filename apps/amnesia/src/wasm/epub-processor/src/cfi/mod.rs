//! CFI (Canonical Fragment Identifier) module
//!
//! Implements EPUB CFI generation and resolution.
//! CFIs provide a way to identify specific locations within an EPUB document.
//!
//! CFI Format: epubcfi(/6/4!/4/2/1:5)
//! - /6/4 - Package document path (spine reference)
//! - ! - Step indirection (into content document)
//! - /4/2/1 - Element path within document
//! - :5 - Character offset within text node

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::epub::EpubBook;

#[derive(Error, Debug)]
pub enum CfiError {
    #[error("Invalid CFI format: {0}")]
    InvalidFormat(String),

    #[error("CFI resolution failed: {0}")]
    ResolutionFailed(String),

    #[error("Spine item not found: {0}")]
    SpineNotFound(String),
}

/// Parsed CFI structure
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cfi {
    /// The raw CFI string
    pub raw: String,
    /// Spine index (0-based)
    pub spine_index: usize,
    /// Path within the document
    pub path: Vec<usize>,
    /// Character offset (if any)
    pub offset: Option<usize>,
}

/// Location resolved from a CFI
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CfiLocation {
    /// Spine item href
    pub href: String,
    /// Spine index (0-based)
    pub spine_index: usize,
    /// XPath-like path to element
    pub element_path: String,
    /// Character offset within text node
    pub offset: Option<usize>,
}

/// Generate a CFI for a specific location in the book
///
/// # Arguments
/// * `book` - The EPUB book
/// * `spine_index` - Index in the spine
/// * `path` - DOM path (e.g., "/html/body/p[2]")
/// * `offset` - Character offset within the element
pub fn generate_cfi(
    book: &EpubBook,
    spine_index: usize,
    path: &str,
    offset: usize,
) -> Result<String, CfiError> {
    // Validate spine index
    if spine_index >= book.spine.len() {
        return Err(CfiError::SpineNotFound(format!(
            "Spine index {} out of range (max: {})",
            spine_index,
            book.spine.len() - 1
        )));
    }

    // Calculate spine step (EPUB uses 1-based, even-numbered indices for content documents)
    // /6 is the spine element in the package document
    // /N where N = (spine_index + 1) * 2 is the specific spine item
    let spine_step = (spine_index + 1) * 2;

    // Convert DOM path to CFI path
    let cfi_path = path_to_cfi_path(path);

    // Build the CFI string
    let cfi = if offset > 0 {
        format!("epubcfi(/6/{}!{}:{})", spine_step, cfi_path, offset)
    } else {
        format!("epubcfi(/6/{}!{})", spine_step, cfi_path)
    };

    Ok(cfi)
}

/// Resolve a CFI to a location in the book
pub fn resolve_cfi(book: &EpubBook, cfi_str: &str) -> Result<CfiLocation, CfiError> {
    let cfi = parse_cfi(cfi_str)?;

    // Get spine item
    let spine_item = book.get_spine_item(cfi.spine_index)
        .ok_or_else(|| CfiError::SpineNotFound(format!(
            "Spine index {} not found",
            cfi.spine_index
        )))?;

    // Convert CFI path back to XPath-like path
    let element_path = cfi_path_to_xpath(&cfi.path);

    Ok(CfiLocation {
        href: spine_item.href.clone(),
        spine_index: cfi.spine_index,
        element_path,
        offset: cfi.offset,
    })
}

/// Parse a CFI string into a Cfi struct
pub fn parse_cfi(cfi_str: &str) -> Result<Cfi, CfiError> {
    // Remove the epubcfi() wrapper
    let inner = cfi_str
        .strip_prefix("epubcfi(")
        .and_then(|s| s.strip_suffix(")"))
        .ok_or_else(|| CfiError::InvalidFormat("Missing epubcfi() wrapper".to_string()))?;

    // Split by the step indirection (!)
    let parts: Vec<&str> = inner.split('!').collect();
    if parts.is_empty() {
        return Err(CfiError::InvalidFormat("Empty CFI".to_string()));
    }

    // Parse the package document path to get spine index
    let spine_index = parse_spine_index(parts[0])?;

    // Parse the content document path (if present)
    let (path, offset) = if parts.len() > 1 {
        parse_content_path(parts[1])?
    } else {
        (Vec::new(), None)
    };

    Ok(Cfi {
        raw: cfi_str.to_string(),
        spine_index,
        path,
        offset,
    })
}

/// Parse spine index from package document path
fn parse_spine_index(path: &str) -> Result<usize, CfiError> {
    // Path format: /6/N where N is (spine_index + 1) * 2
    let steps: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    if steps.len() < 2 {
        return Err(CfiError::InvalidFormat("Invalid package path".to_string()));
    }

    // First step should be 6 (spine element)
    if steps[0] != "6" {
        return Err(CfiError::InvalidFormat("Expected /6 for spine".to_string()));
    }

    // Second step is the spine item index
    let spine_step: usize = steps[1].parse()
        .map_err(|_| CfiError::InvalidFormat("Invalid spine step".to_string()))?;

    // Convert back to 0-based index
    Ok((spine_step / 2) - 1)
}

/// Parse content document path
fn parse_content_path(path: &str) -> Result<(Vec<usize>, Option<usize>), CfiError> {
    // Check for character offset
    let (path_part, offset) = if let Some(colon_idx) = path.rfind(':') {
        let offset_str = &path[colon_idx + 1..];
        let offset: usize = offset_str.parse()
            .map_err(|_| CfiError::InvalidFormat("Invalid character offset".to_string()))?;
        (&path[..colon_idx], Some(offset))
    } else {
        (path, None)
    };

    // Parse the element path
    let steps: Vec<usize> = path_part
        .split('/')
        .filter(|s| !s.is_empty())
        .map(|s| {
            // Handle assertions like [id="foo"] by stripping them
            let base = s.split('[').next().unwrap_or(s);
            base.parse().unwrap_or(0)
        })
        .collect();

    Ok((steps, offset))
}

/// Convert a DOM path to CFI path notation
fn path_to_cfi_path(path: &str) -> String {
    // This is a simplified conversion
    // Full implementation would need actual DOM traversal
    path.replace("/", "/")
}

/// Convert CFI path steps to XPath-like notation
fn cfi_path_to_xpath(steps: &[usize]) -> String {
    steps.iter()
        .map(|&step| {
            // CFI uses even numbers for element children
            let child_index = step / 2;
            format!("/*[{}]", child_index)
        })
        .collect::<Vec<_>>()
        .join("")
}

/// Compare two CFIs to determine their order
pub fn compare_cfis(cfi_a: &str, cfi_b: &str) -> Result<std::cmp::Ordering, CfiError> {
    let a = parse_cfi(cfi_a)?;
    let b = parse_cfi(cfi_b)?;

    // First compare spine index
    if a.spine_index != b.spine_index {
        return Ok(a.spine_index.cmp(&b.spine_index));
    }

    // Then compare path depth and values
    for (step_a, step_b) in a.path.iter().zip(b.path.iter()) {
        if step_a != step_b {
            return Ok(step_a.cmp(step_b));
        }
    }

    // If one path is longer, it comes after
    if a.path.len() != b.path.len() {
        return Ok(a.path.len().cmp(&b.path.len()));
    }

    // Finally compare character offsets
    match (a.offset, b.offset) {
        (Some(off_a), Some(off_b)) => Ok(off_a.cmp(&off_b)),
        (Some(_), None) => Ok(std::cmp::Ordering::Greater),
        (None, Some(_)) => Ok(std::cmp::Ordering::Less),
        (None, None) => Ok(std::cmp::Ordering::Equal),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_cfi() {
        let cfi = parse_cfi("epubcfi(/6/4!/4/2)").unwrap();
        assert_eq!(cfi.spine_index, 1);
        assert_eq!(cfi.path, vec![4, 2]);
        assert_eq!(cfi.offset, None);
    }

    #[test]
    fn test_parse_cfi_with_offset() {
        let cfi = parse_cfi("epubcfi(/6/4!/4/2:10)").unwrap();
        assert_eq!(cfi.spine_index, 1);
        assert_eq!(cfi.offset, Some(10));
    }

    #[test]
    fn test_compare_cfis() {
        assert_eq!(
            compare_cfis("epubcfi(/6/4!/4/2)", "epubcfi(/6/4!/4/4)").unwrap(),
            std::cmp::Ordering::Less
        );
        assert_eq!(
            compare_cfis("epubcfi(/6/4!/4/2)", "epubcfi(/6/6!/4/2)").unwrap(),
            std::cmp::Ordering::Less
        );
    }
}
