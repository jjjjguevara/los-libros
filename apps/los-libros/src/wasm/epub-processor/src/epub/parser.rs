//! HTML/XHTML content parser
//!
//! Extracts CSS and image references from chapter content.

use regex::Regex;

/// Extract CSS and image references from HTML content
pub fn extract_resources(html: &str) -> (Vec<String>, Vec<String>) {
    let mut css_refs = Vec::new();
    let mut image_refs = Vec::new();

    // Extract CSS links
    let css_regex = Regex::new(r#"<link[^>]+href=["']([^"']+\.css)["'][^>]*>"#).unwrap();
    for cap in css_regex.captures_iter(html) {
        if let Some(href) = cap.get(1) {
            css_refs.push(href.as_str().to_string());
        }
    }

    // Also check for stylesheet rels
    let stylesheet_regex = Regex::new(r#"<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["'][^>]*>"#).unwrap();
    for cap in stylesheet_regex.captures_iter(html) {
        if let Some(href) = cap.get(1) {
            let href_str = href.as_str().to_string();
            if !css_refs.contains(&href_str) {
                css_refs.push(href_str);
            }
        }
    }

    // Extract image sources
    let img_regex = Regex::new(r#"<img[^>]+src=["']([^"']+)["'][^>]*>"#).unwrap();
    for cap in img_regex.captures_iter(html) {
        if let Some(src) = cap.get(1) {
            image_refs.push(src.as_str().to_string());
        }
    }

    // Also check for SVG image elements
    let svg_img_regex = Regex::new(r#"<image[^>]+xlink:href=["']([^"']+)["'][^>]*>"#).unwrap();
    for cap in svg_img_regex.captures_iter(html) {
        if let Some(src) = cap.get(1) {
            image_refs.push(src.as_str().to_string());
        }
    }

    (css_refs, image_refs)
}

/// Normalize whitespace in text content
pub fn normalize_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Extract plain text from HTML for search indexing
pub fn extract_plain_text(html: &str) -> String {
    // Remove script and style content
    let no_script = Regex::new(r"(?s)<script[^>]*>.*?</script>").unwrap()
        .replace_all(html, "");
    let no_style = Regex::new(r"(?s)<style[^>]*>.*?</style>").unwrap()
        .replace_all(&no_script, "");

    // Remove all HTML tags
    let no_tags = Regex::new(r"<[^>]+>").unwrap()
        .replace_all(&no_style, " ");

    // Decode common HTML entities
    let decoded = no_tags
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'");

    normalize_text(&decoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_css() {
        let html = r#"
            <html>
            <head>
                <link href="styles.css" rel="stylesheet"/>
                <link rel="stylesheet" href="other.css"/>
            </head>
            <body></body>
            </html>
        "#;

        let (css, _) = extract_resources(html);
        assert!(css.contains(&"styles.css".to_string()));
        assert!(css.contains(&"other.css".to_string()));
    }

    #[test]
    fn test_extract_images() {
        let html = r#"
            <html>
            <body>
                <img src="image1.jpg"/>
                <img src="images/photo.png"/>
            </body>
            </html>
        "#;

        let (_, images) = extract_resources(html);
        assert!(images.contains(&"image1.jpg".to_string()));
        assert!(images.contains(&"images/photo.png".to_string()));
    }

    #[test]
    fn test_extract_plain_text() {
        let html = "<p>Hello <b>World</b>!</p><script>alert('x')</script>";
        let text = extract_plain_text(html);
        assert_eq!(text, "Hello World !");
    }
}
