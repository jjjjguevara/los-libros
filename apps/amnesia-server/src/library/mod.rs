//! Library module for book management
//!
//! Handles Calibre library scanning, metadata parsing, and book indexing.

mod book;
mod metadata;
mod scanner;

pub use book::*;
pub use metadata::*;
pub use scanner::*;
