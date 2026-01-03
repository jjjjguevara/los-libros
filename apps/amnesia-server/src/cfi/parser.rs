//! CFI Parser
//!
//! Parses EPUB CFI strings into structured Cfi objects.
//!
//! Grammar (simplified):
//! ```text
//! cfi       = "epubcfi(" path ["," range] ")"
//! path      = step+ [offset]
//! step      = "/" number [id] | "!" [id]
//! id        = "[" text "]"
//! offset    = ":" number [assertion] | "~" number | "@" number ":" number
//! range     = path "," path
//! ```

use super::types::*;
use thiserror::Error;

/// CFI parsing errors
#[derive(Debug, Error)]
pub enum CfiParseError {
    #[error("Empty CFI string")]
    Empty,

    #[error("CFI must start with 'epubcfi('")]
    MissingPrefix,

    #[error("CFI must end with ')'")]
    MissingClosingParen,

    #[error("Expected '/' or '!' at position {0}")]
    ExpectedStep(usize),

    #[error("Expected number at position {0}")]
    ExpectedNumber(usize),

    #[error("Unclosed bracket at position {0}")]
    UnclosedBracket(usize),

    #[error("Invalid character offset at position {0}")]
    InvalidCharacterOffset(usize),

    #[error("Invalid temporal offset at position {0}")]
    InvalidTemporalOffset(usize),

    #[error("Invalid spatial offset at position {0}")]
    InvalidSpatialOffset(usize),

    #[error("Unexpected character '{0}' at position {1}")]
    UnexpectedChar(char, usize),

    #[error("Invalid range format")]
    InvalidRange,
}

/// Parser state
struct Parser<'a> {
    input: &'a str,
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(input: &'a str) -> Self {
        Self { input, pos: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.input[self.pos..].chars().next()
    }

    fn advance(&mut self) -> Option<char> {
        let ch = self.peek()?;
        self.pos += ch.len_utf8();
        Some(ch)
    }

    fn skip_if(&mut self, expected: char) -> bool {
        if self.peek() == Some(expected) {
            self.advance();
            true
        } else {
            false
        }
    }

    fn expect(&mut self, expected: char) -> Result<(), CfiParseError> {
        if self.skip_if(expected) {
            Ok(())
        } else {
            Err(CfiParseError::UnexpectedChar(
                self.peek().unwrap_or('\0'),
                self.pos,
            ))
        }
    }

    fn starts_with(&self, s: &str) -> bool {
        self.input[self.pos..].starts_with(s)
    }

    fn skip_str(&mut self, s: &str) -> bool {
        if self.starts_with(s) {
            self.pos += s.len();
            true
        } else {
            false
        }
    }

    fn at_end(&self) -> bool {
        self.pos >= self.input.len()
    }

    fn remaining(&self) -> &str {
        &self.input[self.pos..]
    }

    /// Parse a sequence of digits as u32
    fn parse_number(&mut self) -> Result<u32, CfiParseError> {
        let start = self.pos;
        while let Some(ch) = self.peek() {
            if ch.is_ascii_digit() {
                self.advance();
            } else {
                break;
            }
        }

        if self.pos == start {
            return Err(CfiParseError::ExpectedNumber(start));
        }

        self.input[start..self.pos]
            .parse()
            .map_err(|_| CfiParseError::ExpectedNumber(start))
    }

    /// Parse a floating point number
    fn parse_float(&mut self) -> Result<f64, CfiParseError> {
        let start = self.pos;

        // Optional negative sign
        self.skip_if('-');

        // Integer part
        while let Some(ch) = self.peek() {
            if ch.is_ascii_digit() {
                self.advance();
            } else {
                break;
            }
        }

        // Decimal part
        if self.skip_if('.') {
            while let Some(ch) = self.peek() {
                if ch.is_ascii_digit() {
                    self.advance();
                } else {
                    break;
                }
            }
        }

        if self.pos == start {
            return Err(CfiParseError::ExpectedNumber(start));
        }

        self.input[start..self.pos]
            .parse()
            .map_err(|_| CfiParseError::ExpectedNumber(start))
    }

    /// Parse text inside brackets, handling escapes
    fn parse_bracket_content(&mut self) -> Result<String, CfiParseError> {
        let start = self.pos;
        let mut result = String::new();
        let mut escaped = false;

        while let Some(ch) = self.peek() {
            if escaped {
                result.push(ch);
                escaped = false;
                self.advance();
            } else if ch == '^' {
                escaped = true;
                self.advance();
            } else if ch == ']' {
                return Ok(result);
            } else if ch == '[' {
                // Nested brackets not allowed without escape
                return Err(CfiParseError::UnexpectedChar('[', self.pos));
            } else {
                result.push(ch);
                self.advance();
            }
        }

        Err(CfiParseError::UnclosedBracket(start))
    }

    /// Parse an ID assertion [id] or text assertion [prefix,suffix]
    fn parse_assertion(&mut self) -> Result<(Option<String>, Option<TextAssertion>), CfiParseError> {
        if !self.skip_if('[') {
            return Ok((None, None));
        }

        let content = self.parse_bracket_content()?;
        self.expect(']')?;

        // Check if this is a text assertion (contains comma) or ID assertion
        if let Some(comma_pos) = content.find(',') {
            let prefix = if comma_pos > 0 {
                Some(content[..comma_pos].to_string())
            } else {
                None
            };

            let after_comma = &content[comma_pos + 1..];

            // Check for parameters (;key=value)
            let (suffix_str, params) = if let Some(semi_pos) = after_comma.find(';') {
                let suffix_part = &after_comma[..semi_pos];
                let params_part = &after_comma[semi_pos + 1..];
                (suffix_part, parse_parameters(params_part))
            } else {
                (after_comma, Vec::new())
            };

            let suffix = if suffix_str.is_empty() {
                None
            } else {
                Some(suffix_str.to_string())
            };

            Ok((
                None,
                Some(TextAssertion {
                    prefix,
                    suffix,
                    parameters: params,
                }),
            ))
        } else {
            // Simple ID assertion
            Ok((Some(content), None))
        }
    }

    /// Parse a single step (/ or !)
    fn parse_step(&mut self) -> Result<CfiStep, CfiParseError> {
        if self.skip_if('/') {
            let index = self.parse_number()?;
            let (id_assertion, text_assertion) = self.parse_assertion()?;

            Ok(CfiStep {
                step_type: StepType::Element(index),
                id_assertion,
                text_assertion,
            })
        } else if self.skip_if('!') {
            let (id_assertion, text_assertion) = self.parse_assertion()?;

            Ok(CfiStep {
                step_type: StepType::Indirection,
                id_assertion,
                text_assertion,
            })
        } else {
            Err(CfiParseError::ExpectedStep(self.pos))
        }
    }

    /// Parse a path (sequence of steps with optional offset)
    fn parse_path(&mut self) -> Result<CfiPath, CfiParseError> {
        let mut steps = Vec::new();

        // Parse steps
        while self.peek() == Some('/') || self.peek() == Some('!') {
            steps.push(self.parse_step()?);
        }

        let mut path = CfiPath::with_steps(steps);

        // Parse optional offsets
        if self.skip_if(':') {
            // Character offset
            let offset = self.parse_number()?;
            let (_, text_assertion) = self.parse_assertion()?;
            path.character_offset = Some(CharacterOffset {
                offset,
                assertion: text_assertion,
            });
        }

        if self.skip_if('~') {
            // Temporal offset
            let seconds = self.parse_float()?;
            path.temporal_offset = Some(TemporalOffset { seconds });
        }

        if self.skip_if('@') {
            // Spatial offset
            let x = self.parse_float()?;
            self.expect(':')?;
            let y = self.parse_float()?;
            path.spatial_offset = Some(SpatialOffset { x, y });
        }

        Ok(path)
    }

    /// Parse a complete CFI
    fn parse_cfi(&mut self) -> Result<Cfi, CfiParseError> {
        // Expect "epubcfi("
        if !self.skip_str("epubcfi(") {
            return Err(CfiParseError::MissingPrefix);
        }

        // Parse the main path
        let path = self.parse_path()?;

        // Check for range
        let range = if self.skip_if(',') {
            let start = self.parse_path()?;
            self.expect(',')?;
            let end = self.parse_path()?;
            Some(CfiRange { start, end })
        } else {
            None
        };

        // Expect closing paren
        if !self.skip_if(')') {
            return Err(CfiParseError::MissingClosingParen);
        }

        Ok(Cfi { path, range })
    }
}

/// Parse parameters from a string like "key1=value1;key2=value2"
fn parse_parameters(s: &str) -> Vec<(String, String)> {
    s.split(';')
        .filter_map(|part| {
            let mut kv = part.splitn(2, '=');
            let key = kv.next()?.trim();
            let value = kv.next()?.trim();
            if key.is_empty() {
                None
            } else {
                Some((key.to_string(), value.to_string()))
            }
        })
        .collect()
}

/// Parse a CFI string into a Cfi struct
pub fn parse(input: &str) -> Result<Cfi, CfiParseError> {
    let input = input.trim();
    if input.is_empty() {
        return Err(CfiParseError::Empty);
    }

    let mut parser = Parser::new(input);
    let cfi = parser.parse_cfi()?;

    // Ensure we consumed all input
    if !parser.at_end() {
        return Err(CfiParseError::UnexpectedChar(
            parser.peek().unwrap_or('\0'),
            parser.pos,
        ));
    }

    Ok(cfi)
}

/// Parse a CFI string, returning the Cfi or the original string on failure
pub fn try_parse(input: &str) -> Option<Cfi> {
    parse(input).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_cfi() {
        let cfi = parse("epubcfi(/6/4!/4/2)").unwrap();
        // Steps: /6, /4, !, /4, /2 = 5 steps
        assert_eq!(cfi.path.steps.len(), 5);
        assert_eq!(cfi.path.steps[0].step_type, StepType::Element(6));
        assert_eq!(cfi.path.steps[1].step_type, StepType::Element(4));
        assert_eq!(cfi.path.steps[2].step_type, StepType::Indirection);
        assert_eq!(cfi.path.steps[3].step_type, StepType::Element(4));
        assert_eq!(cfi.path.steps[4].step_type, StepType::Element(2));
        assert!(!cfi.is_range());
    }

    #[test]
    fn test_parse_cfi_with_id() {
        let cfi = parse("epubcfi(/6/4[chapter1]!/4/2)").unwrap();
        assert_eq!(cfi.path.steps[1].id_assertion, Some("chapter1".to_string()));
    }

    #[test]
    fn test_parse_cfi_with_character_offset() {
        let cfi = parse("epubcfi(/6/4!/4/2/1:42)").unwrap();
        assert_eq!(cfi.path.character_offset.as_ref().unwrap().offset, 42);
    }

    #[test]
    fn test_parse_cfi_with_text_assertion() {
        let cfi = parse("epubcfi(/6/4!/4/2/1:42[hello,world])").unwrap();
        let offset = cfi.path.character_offset.as_ref().unwrap();
        let assertion = offset.assertion.as_ref().unwrap();
        assert_eq!(assertion.prefix, Some("hello".to_string()));
        assert_eq!(assertion.suffix, Some("world".to_string()));
    }

    #[test]
    fn test_parse_cfi_range() {
        let cfi = parse("epubcfi(/6/4!/4/2,/1:0,/1:10)").unwrap();
        assert!(cfi.is_range());
        let range = cfi.range.as_ref().unwrap();
        assert_eq!(range.start.character_offset.as_ref().unwrap().offset, 0);
        assert_eq!(range.end.character_offset.as_ref().unwrap().offset, 10);
    }

    #[test]
    fn test_parse_cfi_temporal_offset() {
        let cfi = parse("epubcfi(/6/4!/4~12.5)").unwrap();
        assert_eq!(cfi.path.temporal_offset.as_ref().unwrap().seconds, 12.5);
    }

    #[test]
    fn test_parse_cfi_spatial_offset() {
        let cfi = parse("epubcfi(/6/4!/4@50.5:25.0)").unwrap();
        let spatial = cfi.path.spatial_offset.as_ref().unwrap();
        assert_eq!(spatial.x, 50.5);
        assert_eq!(spatial.y, 25.0);
    }

    #[test]
    fn test_roundtrip() {
        let original = "epubcfi(/6/4[chapter1]!/4/2/1:42)";
        let cfi = parse(original).unwrap();
        assert_eq!(cfi.to_string(), original);
    }

    #[test]
    fn test_roundtrip_range() {
        let original = "epubcfi(/6/4!/4/2,/1:0,/1:10)";
        let cfi = parse(original).unwrap();
        assert_eq!(cfi.to_string(), original);
    }

    #[test]
    fn test_error_empty() {
        assert!(matches!(parse(""), Err(CfiParseError::Empty)));
    }

    #[test]
    fn test_error_missing_prefix() {
        assert!(matches!(parse("/6/4"), Err(CfiParseError::MissingPrefix)));
    }

    #[test]
    fn test_error_missing_paren() {
        assert!(matches!(
            parse("epubcfi(/6/4"),
            Err(CfiParseError::MissingClosingParen)
        ));
    }

    #[test]
    fn test_escaped_bracket() {
        let cfi = parse("epubcfi(/6/4[test^]value]!/4)").unwrap();
        assert_eq!(cfi.path.steps[1].id_assertion, Some("test]value".to_string()));
    }
}
