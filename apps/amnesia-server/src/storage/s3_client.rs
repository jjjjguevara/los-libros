//! S3-compatible storage client
//!
//! Wraps the AWS SDK for S3-compatible storage access.

use aws_config::BehaviorVersion;
use aws_sdk_s3::{
    config::{Credentials, Region},
    primitives::ByteStream,
    Client,
};
use chrono::{DateTime, Utc};

use crate::config::StorageConfig;
use crate::error::{AppError, Result, StorageError};

use super::types::{ListOptions, ObjectList, ObjectMetadata, StorageObject};

/// S3-compatible storage client
#[derive(Clone)]
pub struct S3Client {
    client: Client,
    bucket: String,
}

impl S3Client {
    /// Create a new S3 client from configuration
    pub async fn new(config: &StorageConfig) -> Result<Self> {
        let credentials = Credentials::new(
            &config.access_key,
            &config.secret_key,
            None,
            None,
            "los-libros",
        );

        let region = config
            .region
            .clone()
            .unwrap_or_else(|| "us-east-1".to_string());

        let s3_config = aws_sdk_s3::Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .endpoint_url(&config.endpoint)
            .region(Region::new(region))
            .credentials_provider(credentials)
            .force_path_style(true) // Required for MinIO and other S3-compatible services
            .build();

        let client = Client::from_conf(s3_config);

        // Test connection by checking if bucket exists
        let bucket = config.bucket.clone();
        match client.head_bucket().bucket(&bucket).send().await {
            Ok(_) => {
                tracing::info!("Connected to S3 bucket: {}", bucket);
            }
            Err(e) => {
                tracing::warn!(
                    "Could not verify bucket {}: {}. Will attempt operations anyway.",
                    bucket,
                    e
                );
            }
        }

        Ok(Self { client, bucket })
    }

    /// Get the bucket name
    pub fn bucket(&self) -> &str {
        &self.bucket
    }

    /// List objects in the bucket
    pub async fn list_objects(&self, options: ListOptions) -> Result<ObjectList> {
        let mut request = self.client.list_objects_v2().bucket(&self.bucket);

        if let Some(prefix) = options.prefix {
            request = request.prefix(prefix);
        }

        if let Some(delimiter) = options.delimiter {
            request = request.delimiter(delimiter);
        }

        if let Some(max_keys) = options.max_keys {
            request = request.max_keys(max_keys);
        }

        if let Some(token) = options.continuation_token {
            request = request.continuation_token(token);
        }

        let response = request.send().await.map_err(|e| {
            StorageError::SdkError(format!("Failed to list objects: {}", e))
        })?;

        let objects: Vec<ObjectMetadata> = response
            .contents()
            .iter()
            .map(|obj| ObjectMetadata {
                key: obj.key().unwrap_or_default().to_string(),
                size: obj.size().unwrap_or(0),
                last_modified: obj.last_modified().and_then(|dt| {
                    DateTime::from_timestamp(dt.secs(), dt.subsec_nanos())
                }),
                content_type: None, // Not available in list response
                etag: obj.e_tag().map(|s| s.to_string()),
            })
            .collect();

        let prefixes: Vec<String> = response
            .common_prefixes()
            .iter()
            .filter_map(|p| p.prefix().map(|s| s.to_string()))
            .collect();

        Ok(ObjectList {
            objects,
            prefixes,
            continuation_token: response.next_continuation_token().map(|s| s.to_string()),
            is_truncated: response.is_truncated().unwrap_or(false),
        })
    }

    /// Get object metadata (HEAD request)
    pub async fn head_object(&self, key: &str) -> Result<ObjectMetadata> {
        let response = self
            .client
            .head_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| {
                if e.to_string().contains("404") || e.to_string().contains("NoSuchKey") {
                    AppError::Storage(StorageError::ObjectNotFound(key.to_string()))
                } else {
                    AppError::Storage(StorageError::SdkError(format!("Failed to head object {}: {}", key, e)))
                }
            })?;

        Ok(ObjectMetadata {
            key: key.to_string(),
            size: response.content_length().unwrap_or(0),
            last_modified: response.last_modified().and_then(|dt| {
                DateTime::from_timestamp(dt.secs(), dt.subsec_nanos())
            }),
            content_type: response.content_type().map(|s| s.to_string()),
            etag: response.e_tag().map(|s| s.to_string()),
        })
    }

    /// Get an object's data
    pub async fn get_object(&self, key: &str) -> Result<StorageObject> {
        let response = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| {
                if e.to_string().contains("404") || e.to_string().contains("NoSuchKey") {
                    AppError::Storage(StorageError::ObjectNotFound(key.to_string()))
                } else {
                    AppError::Storage(StorageError::SdkError(format!("Failed to get object {}: {}", key, e)))
                }
            })?;

        let metadata = ObjectMetadata {
            key: key.to_string(),
            size: response.content_length().unwrap_or(0),
            last_modified: response.last_modified().and_then(|dt| {
                DateTime::from_timestamp(dt.secs(), dt.subsec_nanos())
            }),
            content_type: response.content_type().map(|s| s.to_string()),
            etag: response.e_tag().map(|s| s.to_string()),
        };

        let data = response
            .body
            .collect()
            .await
            .map_err(|e| StorageError::SdkError(format!("Failed to read object body: {}", e)))?
            .into_bytes()
            .to_vec();

        Ok(StorageObject { metadata, data })
    }

    /// Get object as a byte stream (for large files)
    pub async fn get_object_stream(&self, key: &str) -> Result<ByteStream> {
        let response = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| {
                if e.to_string().contains("404") || e.to_string().contains("NoSuchKey") {
                    AppError::Storage(StorageError::ObjectNotFound(key.to_string()))
                } else {
                    AppError::Storage(StorageError::SdkError(format!("Failed to get object stream {}: {}", key, e)))
                }
            })?;

        Ok(response.body)
    }

    /// Check if an object exists
    pub async fn object_exists(&self, key: &str) -> Result<bool> {
        match self.head_object(key).await {
            Ok(_) => Ok(true),
            Err(crate::error::AppError::Storage(StorageError::ObjectNotFound(_))) => Ok(false),
            Err(e) => Err(e),
        }
    }

    /// List all objects with a given prefix (handles pagination)
    pub async fn list_all_objects(&self, prefix: Option<&str>) -> Result<Vec<ObjectMetadata>> {
        let mut all_objects = Vec::new();
        let mut continuation_token = None;

        loop {
            let mut options = ListOptions::new().with_max_keys(1000);

            if let Some(p) = prefix {
                options = options.with_prefix(p);
            }

            if let Some(token) = continuation_token.take() {
                options = options.with_continuation_token(token);
            }

            let result = self.list_objects(options).await?;
            all_objects.extend(result.objects);

            if !result.is_truncated {
                break;
            }

            continuation_token = result.continuation_token;
        }

        Ok(all_objects)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Integration tests would go here, using testcontainers for MinIO
    // For now, we just have unit test stubs

    #[test]
    fn test_list_options_builder() {
        let options = ListOptions::new()
            .with_prefix("books/")
            .with_delimiter("/")
            .with_max_keys(100);

        assert_eq!(options.prefix, Some("books/".to_string()));
        assert_eq!(options.delimiter, Some("/".to_string()));
        assert_eq!(options.max_keys, Some(100));
    }
}
