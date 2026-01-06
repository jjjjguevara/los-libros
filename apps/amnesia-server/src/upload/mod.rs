//! Chunked Upload Module (up2k Protocol)
//!
//! Implements reliable large file uploads with:
//! - SHA-256 content hashing for deduplication
//! - Chunked upload with resume support
//! - Server-side chunk storage and reassembly
//!
//! Protocol Flow:
//! 1. Client sends handshake with file hash and chunk hashes
//! 2. Server responds with which chunks are needed (deduplication)
//! 3. Client uploads only needed chunks
//! 4. Server reassembles file and returns book ID

pub mod chunk_store;
pub mod deduplication;
pub mod session;
pub mod types;

pub use chunk_store::{ChunkStore, compute_hash, verify_hash};
pub use deduplication::{DeduplicationService, CacheStats, SavingsInfo, calculate_savings};
pub use session::SessionManager;
pub use types::*;
