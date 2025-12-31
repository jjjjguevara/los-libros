//! CFI Comparison and Ordering
//!
//! Implements comparison logic for CFIs to enable sorting annotations
//! and determining reading progress order.

use std::cmp::Ordering;

use super::types::*;

impl Ord for Cfi {
    fn cmp(&self, other: &Self) -> Ordering {
        self.path.cmp(&other.path)
    }
}

impl PartialOrd for Cfi {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for CfiPath {
    fn cmp(&self, other: &Self) -> Ordering {
        // Compare steps first
        let step_cmp = compare_steps(&self.steps, &other.steps);
        if step_cmp != Ordering::Equal {
            return step_cmp;
        }

        // Then compare character offsets
        match (&self.character_offset, &other.character_offset) {
            (Some(a), Some(b)) => a.offset.cmp(&b.offset),
            (Some(_), None) => Ordering::Greater,
            (None, Some(_)) => Ordering::Less,
            (None, None) => Ordering::Equal,
        }
    }
}

impl PartialOrd for CfiPath {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for CfiStep {
    fn cmp(&self, other: &Self) -> Ordering {
        match (&self.step_type, &other.step_type) {
            // Indirection steps are "equal" for ordering purposes
            // (they just mark document boundaries)
            (StepType::Indirection, StepType::Indirection) => Ordering::Equal,
            // Element steps are compared by index
            (StepType::Element(a), StepType::Element(b)) => a.cmp(b),
            // Indirection comes before element steps at the same level
            (StepType::Indirection, StepType::Element(_)) => Ordering::Less,
            (StepType::Element(_), StepType::Indirection) => Ordering::Greater,
        }
    }
}

impl PartialOrd for CfiStep {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Compare two sequences of CFI steps
fn compare_steps(a: &[CfiStep], b: &[CfiStep]) -> Ordering {
    for (step_a, step_b) in a.iter().zip(b.iter()) {
        let cmp = step_a.cmp(step_b);
        if cmp != Ordering::Equal {
            return cmp;
        }
    }

    // If all compared steps are equal, longer path is "greater"
    a.len().cmp(&b.len())
}

/// Determine if CFI `a` comes before CFI `b` in reading order
pub fn is_before(a: &Cfi, b: &Cfi) -> bool {
    a < b
}

/// Determine if CFI `a` comes after CFI `b` in reading order
pub fn is_after(a: &Cfi, b: &Cfi) -> bool {
    a > b
}

/// Check if a CFI falls within a range
pub fn is_in_range(cfi: &Cfi, start: &Cfi, end: &Cfi) -> bool {
    cfi >= start && cfi <= end
}

/// Compare two CFI strings, returning their ordering
/// Returns None if either CFI is invalid
pub fn compare_cfi_strings(a: &str, b: &str) -> Option<Ordering> {
    let cfi_a = super::parser::parse(a).ok()?;
    let cfi_b = super::parser::parse(b).ok()?;
    Some(cfi_a.cmp(&cfi_b))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cfi::parser::parse;

    #[test]
    fn test_cfi_ordering_same_chapter() {
        let a = parse("epubcfi(/6/4!/4/2/1:10)").unwrap();
        let b = parse("epubcfi(/6/4!/4/2/1:20)").unwrap();

        assert!(a < b);
        assert!(is_before(&a, &b));
        assert!(is_after(&b, &a));
    }

    #[test]
    fn test_cfi_ordering_different_chapters() {
        let a = parse("epubcfi(/6/4!/4/2)").unwrap();
        let b = parse("epubcfi(/6/6!/4/2)").unwrap();

        assert!(a < b);
    }

    #[test]
    fn test_cfi_ordering_different_elements() {
        let a = parse("epubcfi(/6/4!/4/2)").unwrap();
        let b = parse("epubcfi(/6/4!/4/4)").unwrap();

        assert!(a < b);
    }

    #[test]
    fn test_cfi_ordering_nested_depth() {
        let a = parse("epubcfi(/6/4!/4/2)").unwrap();
        let b = parse("epubcfi(/6/4!/4/2/1)").unwrap();

        // Deeper path comes after shallower path
        assert!(a < b);
    }

    #[test]
    fn test_cfi_equality() {
        let a = parse("epubcfi(/6/4!/4/2/1:42)").unwrap();
        let b = parse("epubcfi(/6/4!/4/2/1:42)").unwrap();

        assert_eq!(a, b);
        assert_eq!(a.cmp(&b), Ordering::Equal);
    }

    #[test]
    fn test_cfi_in_range() {
        let start = parse("epubcfi(/6/4!/4/2/1:0)").unwrap();
        let end = parse("epubcfi(/6/4!/4/2/1:100)").unwrap();
        let middle = parse("epubcfi(/6/4!/4/2/1:50)").unwrap();
        let outside = parse("epubcfi(/6/4!/4/2/1:150)").unwrap();

        assert!(is_in_range(&middle, &start, &end));
        assert!(!is_in_range(&outside, &start, &end));
    }

    #[test]
    fn test_sort_cfis() {
        let mut cfis = vec![
            parse("epubcfi(/6/8!/4/2/1:50)").unwrap(),
            parse("epubcfi(/6/4!/4/2/1:10)").unwrap(),
            parse("epubcfi(/6/6!/4/2/1:30)").unwrap(),
            parse("epubcfi(/6/4!/4/2/1:5)").unwrap(),
        ];

        cfis.sort();

        // Verify sorted order
        assert_eq!(cfis[0].to_string(), "epubcfi(/6/4!/4/2/1:5)");
        assert_eq!(cfis[1].to_string(), "epubcfi(/6/4!/4/2/1:10)");
        assert_eq!(cfis[2].to_string(), "epubcfi(/6/6!/4/2/1:30)");
        assert_eq!(cfis[3].to_string(), "epubcfi(/6/8!/4/2/1:50)");
    }

    #[test]
    fn test_compare_cfi_strings() {
        assert_eq!(
            compare_cfi_strings(
                "epubcfi(/6/4!/4/2/1:10)",
                "epubcfi(/6/4!/4/2/1:20)"
            ),
            Some(Ordering::Less)
        );

        assert_eq!(
            compare_cfi_strings("invalid", "epubcfi(/6/4!/4/2)"),
            None
        );
    }
}
