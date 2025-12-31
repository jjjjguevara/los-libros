//! Storage types

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Metadata about a storage object
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectMetadata {
    pub key: String,
    pub size: i64,
    pub last_modified: Option<DateTime<Utc>>,
    pub content_type: Option<String>,
    pub etag: Option<String>,
}

/// A storage object with its data
#[derive(Debug)]
pub struct StorageObject {
    pub metadata: ObjectMetadata,
    pub data: Vec<u8>,
}

/// List of objects with optional continuation token
#[derive(Debug, Clone, Serialize)]
pub struct ObjectList {
    pub objects: Vec<ObjectMetadata>,
    pub prefixes: Vec<String>,
    pub continuation_token: Option<String>,
    pub is_truncated: bool,
}

/// Options for listing objects
#[derive(Debug, Clone, Default)]
pub struct ListOptions {
    pub prefix: Option<String>,
    pub delimiter: Option<String>,
    pub max_keys: Option<i32>,
    pub continuation_token: Option<String>,
}

impl ListOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_prefix(mut self, prefix: impl Into<String>) -> Self {
        self.prefix = Some(prefix.into());
        self
    }

    pub fn with_delimiter(mut self, delimiter: impl Into<String>) -> Self {
        self.delimiter = Some(delimiter.into());
        self
    }

    pub fn with_max_keys(mut self, max_keys: i32) -> Self {
        self.max_keys = Some(max_keys);
        self
    }

    pub fn with_continuation_token(mut self, token: impl Into<String>) -> Self {
        self.continuation_token = Some(token.into());
        self
    }
}
