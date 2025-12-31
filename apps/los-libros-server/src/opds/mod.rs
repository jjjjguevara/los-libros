//! OPDS (Open Publication Distribution System) module
//!
//! Generates OPDS 1.2 Atom feeds for browsing and downloading books.

mod feed;
mod xml;

pub use feed::*;
pub use xml::*;
