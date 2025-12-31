//! Highlight injection using lol_html for streaming HTML processing
//!
//! This module handles injecting highlight spans into EPUB chapter HTML
//! based on annotation selectors.

use lol_html::{element, rewrite_str, RewriteStrSettings};
use std::collections::HashMap;

use crate::annotations::Annotation;

/// Configuration for highlight injection
#[derive(Debug, Clone)]
pub struct HighlightConfig {
    /// CSS class prefix for highlights
    pub class_prefix: String,
    /// Data attribute for annotation ID
    pub id_attribute: String,
    /// Data attribute for annotation type
    pub type_attribute: String,
    /// Whether to include inline styles
    pub include_inline_styles: bool,
}

impl Default for HighlightConfig {
    fn default() -> Self {
        Self {
            class_prefix: "ll-highlight".to_string(),
            id_attribute: "data-annotation-id".to_string(),
            type_attribute: "data-annotation-type".to_string(),
            include_inline_styles: true,
        }
    }
}

/// Result of highlight injection
#[derive(Debug)]
pub struct InjectionResult {
    /// The processed HTML with highlight spans
    pub html: String,
    /// Number of highlights successfully injected
    pub injected_count: usize,
    /// Annotations that couldn't be resolved
    pub failed_annotations: Vec<String>,
}

/// Inject highlight spans into HTML content
///
/// This uses a marker-based approach:
/// 1. Pre-process annotations to find text positions
/// 2. Inject highlight spans at those positions using lol_html
///
/// Note: Full CFI resolution requires DOM context. For server-side injection,
/// we rely on text quote matching when CFI resolution isn't possible.
pub fn inject_highlights(
    html: &str,
    annotations: &[Annotation],
    config: &HighlightConfig,
) -> Result<InjectionResult, InjectError> {
    if annotations.is_empty() {
        return Ok(InjectionResult {
            html: html.to_string(),
            injected_count: 0,
            failed_annotations: vec![],
        });
    }

    // Build a map of text quotes to annotations for matching
    let quote_map: HashMap<&str, &Annotation> = annotations
        .iter()
        .filter_map(|a| a.text_quote().map(|q| (q, a)))
        .collect();

    if quote_map.is_empty() {
        // No text quotes to match - can't inject server-side without CFI resolution
        return Ok(InjectionResult {
            html: html.to_string(),
            injected_count: 0,
            failed_annotations: annotations.iter().map(|a| a.id.clone()).collect(),
        });
    }

    let mut injected_count = 0;
    let mut output = html.to_string();

    // Simple text replacement approach for now
    // A production implementation would use proper DOM position tracking
    for (quote, annotation) in &quote_map {
        if let Some(pos) = output.find(*quote) {
            let highlight_span = format_highlight_span(annotation, quote, config);
            output = format!(
                "{}{}{}",
                &output[..pos],
                highlight_span,
                &output[pos + quote.len()..]
            );
            injected_count += 1;
        }
    }

    let failed_annotations: Vec<String> = annotations
        .iter()
        .filter(|a| {
            a.text_quote()
                .map(|q| !output.contains(&format!("{}=\"{}\"", config.id_attribute, a.id)))
                .unwrap_or(true)
        })
        .map(|a| a.id.clone())
        .collect();

    Ok(InjectionResult {
        html: output,
        injected_count,
        failed_annotations,
    })
}

/// Format a highlight span element
fn format_highlight_span(annotation: &Annotation, text: &str, config: &HighlightConfig) -> String {
    let class = format!(
        "{} {}-{}",
        config.class_prefix,
        config.class_prefix,
        format!("{:?}", annotation.annotation_type).to_lowercase()
    );

    let style = if config.include_inline_styles {
        annotation
            .style
            .as_ref()
            .map(|s| {
                format!(
                    " style=\"background-color: {}; opacity: {};\"",
                    s.color,
                    s.opacity.unwrap_or(0.3)
                )
            })
            .unwrap_or_default()
    } else {
        String::new()
    };

    format!(
        "<span class=\"{}\" {}=\"{}\" {}=\"{:?}\"{}>{}</span>",
        class,
        config.id_attribute,
        annotation.id,
        config.type_attribute,
        annotation.annotation_type,
        style,
        text
    )
}

/// Errors during highlight injection
#[derive(Debug, thiserror::Error)]
pub enum InjectError {
    #[error("HTML rewrite failed: {0}")]
    RewriteError(String),
}

/// Sanitize HTML to remove potentially dangerous elements
/// while preserving content structure for EPUB display
pub fn sanitize_html(html: &str) -> Result<String, InjectError> {
    // Remove script tags and event handlers
    let result = rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![
                // Remove script elements entirely
                element!("script", |el| {
                    el.remove();
                    Ok(())
                }),
                // Remove style elements (EPUB should use external CSS)
                element!("style", |el| {
                    el.remove();
                    Ok(())
                }),
                // Strip dangerous attributes from all elements
                element!("*", |el| {
                    // Remove event handlers
                    for attr in ["onclick", "onload", "onerror", "onmouseover"] {
                        el.remove_attribute(attr);
                    }
                    // Remove javascript: URLs
                    if let Some(href) = el.get_attribute("href") {
                        if href.trim().to_lowercase().starts_with("javascript:") {
                            el.remove_attribute("href");
                        }
                    }
                    if let Some(src) = el.get_attribute("src") {
                        if src.trim().to_lowercase().starts_with("javascript:") {
                            el.remove_attribute("src");
                        }
                    }
                    Ok(())
                }),
            ],
            ..RewriteStrSettings::default()
        },
    )
    .map_err(|e| InjectError::RewriteError(e.to_string()))?;

    Ok(result)
}

/// Add base URL to relative paths in HTML
pub fn rewrite_urls(html: &str, base_url: &str) -> Result<String, InjectError> {
    let result = rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![
                // Rewrite img src
                element!("img[src]", |el| {
                    if let Some(src) = el.get_attribute("src") {
                        if !src.starts_with("http") && !src.starts_with("data:") {
                            el.set_attribute("src", &format!("{}/{}", base_url, src))?;
                        }
                    }
                    Ok(())
                }),
                // Rewrite link href
                element!("link[href]", |el| {
                    if let Some(href) = el.get_attribute("href") {
                        if !href.starts_with("http") {
                            el.set_attribute("href", &format!("{}/{}", base_url, href))?;
                        }
                    }
                    Ok(())
                }),
            ],
            ..RewriteStrSettings::default()
        },
    )
    .map_err(|e| InjectError::RewriteError(e.to_string()))?;

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::annotations::{AnnotationTarget, AnnotationType};

    #[test]
    fn test_inject_single_highlight() {
        let html = "<p>Hello world, this is a test.</p>";
        let target = AnnotationTarget::from_cfi("test.xhtml", "epubcfi(/6/4!/4/2)");
        let mut annotation = Annotation::new_highlight("book-1", target);
        annotation.target.add_text_quote("world", Some("Hello "), Some(","));

        let result = inject_highlights(html, &[annotation], &HighlightConfig::default()).unwrap();

        assert_eq!(result.injected_count, 1);
        assert!(result.html.contains("ll-highlight"));
        assert!(result.html.contains("data-annotation-id"));
    }

    #[test]
    fn test_inject_no_annotations() {
        let html = "<p>Hello world</p>";
        let result = inject_highlights(html, &[], &HighlightConfig::default()).unwrap();

        assert_eq!(result.injected_count, 0);
        assert_eq!(result.html, html);
    }

    #[test]
    fn test_sanitize_script_removal() {
        let html = "<p>Hello</p><script>alert('xss')</script><p>World</p>";
        let result = sanitize_html(html).unwrap();

        assert!(!result.contains("script"));
        assert!(result.contains("Hello"));
        assert!(result.contains("World"));
    }

    #[test]
    fn test_sanitize_event_handlers() {
        let html = r#"<p onclick="alert('xss')">Hello</p>"#;
        let result = sanitize_html(html).unwrap();

        assert!(!result.contains("onclick"));
        assert!(result.contains("Hello"));
    }

    #[test]
    fn test_rewrite_urls() {
        let html = r#"<img src="images/cover.jpg"><link href="styles.css">"#;
        let result = rewrite_urls(html, "/api/books/123/resources").unwrap();

        assert!(result.contains("/api/books/123/resources/images/cover.jpg"));
        assert!(result.contains("/api/books/123/resources/styles.css"));
    }

    #[test]
    fn test_rewrite_preserves_absolute_urls() {
        let html = r#"<img src="https://example.com/image.jpg">"#;
        let result = rewrite_urls(html, "/api/books/123/resources").unwrap();

        assert!(result.contains("https://example.com/image.jpg"));
    }
}
