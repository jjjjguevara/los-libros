//! CFI (Canonical Fragment Identifier) module for EPUB
//!
//! This module provides parsing, generation, and comparison of EPUB CFI strings.
//!
//! # Overview
//!
//! EPUB CFI is a standardized way to reference specific locations within EPUB publications.
//! It uses a path-based syntax similar to XPath but designed specifically for EPUBs.
//!
//! # Example CFI
//!
//! ```text
//! epubcfi(/6/4[chapter1]!/4/2/1:42)
//!         │  │          │ │ │ │ └── character offset 42
//!         │  │          │ │ │ └──── text node (odd = text)
//!         │  │          │ │ └────── element index
//!         │  │          │ └──────── element index (body)
//!         │  │          └────────── indirection (into content doc)
//!         │  └───────────────────── spine item with ID
//!         └──────────────────────── spine element
//! ```
//!
//! # Usage
//!
//! ```ignore
//! use crate::cfi::{parse, CfiBuilder, is_before};
//!
//! // Parse a CFI string
//! let cfi = parse("epubcfi(/6/4!/4/2/1:42)").unwrap();
//!
//! // Build a CFI programmatically
//! let cfi = CfiBuilder::new()
//!     .package_step()
//!     .spine_item(1)
//!     .indirection()
//!     .element(0)
//!     .text_node(0)
//!     .character_offset(42)
//!     .build();
//!
//! // Compare CFIs
//! let a = parse("epubcfi(/6/4!/4/2/1:10)").unwrap();
//! let b = parse("epubcfi(/6/4!/4/2/1:20)").unwrap();
//! assert!(is_before(&a, &b));
//! ```

mod comparator;
mod generator;
mod parser;
mod types;

// Re-export main types
pub use types::{
    CharacterOffset, Cfi, CfiPath, CfiRange, CfiStep, SpatialOffset, StepType, TemporalOffset,
    TextAssertion,
};

// Re-export parser functions
pub use parser::{parse, try_parse, CfiParseError};

// Re-export generator
pub use generator::{generate_cfi, generate_cfi_range, generate_progression_cfi, CfiBuilder};

// Re-export comparator functions
pub use comparator::{compare_cfi_strings, is_after, is_before, is_in_range};
