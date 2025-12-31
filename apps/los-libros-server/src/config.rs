//! Configuration management for Los Libros Server

use serde::Deserialize;
use std::env;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub server: ServerConfig,
    pub storage: StorageConfig,
    pub database: DatabaseConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StorageConfig {
    pub provider: StorageProvider,
    pub endpoint: String,
    pub bucket: String,
    pub access_key: String,
    pub secret_key: String,
    pub region: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StorageProvider {
    Minio,
    R2,
    S3,
    B2,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    pub url: String,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            server: ServerConfig {
                host: "0.0.0.0".to_string(),
                port: 3000,
            },
            storage: StorageConfig {
                provider: StorageProvider::Minio,
                endpoint: "http://localhost:9000".to_string(),
                bucket: "library".to_string(),
                access_key: "admin".to_string(),
                secret_key: "password123".to_string(),
                region: Some("us-east-1".to_string()),
            },
            database: DatabaseConfig {
                url: "sqlite:./libros.db".to_string(),
            },
        }
    }
}

impl Config {
    pub fn from_env() -> Result<Self, env::VarError> {
        Ok(Config {
            server: ServerConfig {
                host: env::var("SERVER_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
                port: env::var("SERVER_PORT")
                    .unwrap_or_else(|_| "3000".to_string())
                    .parse()
                    .unwrap_or(3000),
            },
            storage: StorageConfig {
                provider: match env::var("S3_PROVIDER").unwrap_or_else(|_| "minio".to_string()).as_str() {
                    "r2" => StorageProvider::R2,
                    "s3" => StorageProvider::S3,
                    "b2" => StorageProvider::B2,
                    _ => StorageProvider::Minio,
                },
                endpoint: env::var("S3_ENDPOINT")?,
                bucket: env::var("S3_BUCKET")?,
                access_key: env::var("S3_ACCESS_KEY")?,
                secret_key: env::var("S3_SECRET_KEY")?,
                region: env::var("S3_REGION").ok(),
            },
            database: DatabaseConfig {
                url: env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:./libros.db".to_string()),
            },
        })
    }
}
