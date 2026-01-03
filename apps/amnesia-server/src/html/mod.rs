//! HTML processing module
//!
//! Provides HTML manipulation for EPUB content including:
//! - Highlight span injection
//! - HTML sanitization
//! - URL rewriting
//!
//! Uses lol_html for efficient streaming HTML processing.

mod highlight_injector;

pub use highlight_injector::{
    inject_highlights, rewrite_urls, sanitize_html, HighlightConfig, InjectError, InjectionResult,
};
