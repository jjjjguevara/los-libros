//! Storage module for S3-compatible backends
//!
//! Supports MinIO, Cloudflare R2, Backblaze B2, and AWS S3.

mod s3_client;
mod types;

pub use s3_client::S3Client;
pub use types::*;
