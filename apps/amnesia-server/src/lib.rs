//! Amnesia Server Library
//!
//! This crate exposes types needed for benchmarking and testing.
//! The main server binary is in main.rs.
//!
//! # Modules
//!
//! - `document`: Unified document abstraction (format-agnostic)
//! - `formats`: Format-specific implementations (PDF, EPUB)
//! - `pdf`: Low-level PDF parsing via MuPDF

// Core modules needed for benchmarks
pub mod document;
pub mod formats;
pub mod pdf;

// Internal modules that document/formats/pdf depend on
// These are not exposed publicly but are needed for compilation
mod mupdf;
