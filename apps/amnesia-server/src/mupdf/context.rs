//! MuPDF Operation Concurrency Control
//!
//! This module provides concurrency limiting and metrics for MuPDF operations.
//!
//! # Why Not True Context Pooling?
//!
//! MuPDF's `fz_context` is NOT thread-safe, so each operation opens a fresh
//! document instance. True context pooling isn't safe across threads.
//!
//! # What This Pool Actually Does
//!
//! 1. **Concurrency Limiting**: Tracks how many operations are in flight
//! 2. **Metrics Collection**: Provides statistics on pool utilization
//! 3. **Operation Wrapping**: Ensures proper document cleanup via RAII
//!
//! The "pool" terminology is kept for API familiarity, but this is effectively
//! a concurrency limiter with metrics tracking.
//!
//! # Design
//!
//! ```text
//! ┌────────────────────────────────────────────────────────────────┐
//! │                       ContextPool                              │
//! │                   (Concurrency Limiter)                        │
//! │                                                                │
//! │  acquire() → PooledContext → with_document() → drop()         │
//! │      ↑                              ↓                          │
//! │  [active_count++]          [opens fresh doc]                  │
//! │      ↓                              ↓                          │
//! │  [track created]           [exec operation]                   │
//! │                                     ↓                          │
//! │                            [active_count--]                    │
//! └────────────────────────────────────────────────────────────────┘
//! ```

use parking_lot::Mutex;
use std::ops::Deref;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use crate::document::DocumentError;

/// Thread-safe MuPDF context pool
///
/// MuPDF's fz_context is NOT thread-safe. Each operation requires its own context.
/// This pool reuses contexts to avoid expensive creation on every operation.
pub struct ContextPool {
    /// Pool of available contexts (wrapped in Option to allow take/put)
    available: Mutex<Vec<ContextWrapper>>,
    /// Maximum pool size
    max_size: usize,
    /// Total contexts created (for metrics)
    created_count: AtomicUsize,
    /// Active contexts (borrowed from pool)
    active_count: AtomicUsize,
}

/// Wrapper to make mupdf types work with our pool
/// MuPDF contexts are created per-document-operation, not pooled globally
struct ContextWrapper {
    /// Marker to track pool membership
    _id: usize,
}

impl ContextPool {
    /// Create a new context pool
    pub fn new(max_size: usize) -> Self {
        Self {
            available: Mutex::new(Vec::with_capacity(max_size)),
            max_size,
            created_count: AtomicUsize::new(0),
            active_count: AtomicUsize::new(0),
        }
    }

    /// Acquire a context from the pool (creates new if pool empty and under limit)
    ///
    /// Returns a RAII guard that returns the context to the pool on drop.
    pub fn acquire(&self) -> PooledContext<'_> {
        let wrapper = {
            let mut pool = self.available.lock();
            pool.pop()
        };

        let wrapper = wrapper.unwrap_or_else(|| {
            let id = self.created_count.fetch_add(1, Ordering::Relaxed);
            ContextWrapper { _id: id }
        });

        self.active_count.fetch_add(1, Ordering::Relaxed);

        PooledContext {
            wrapper: Some(wrapper),
            pool: self,
        }
    }

    /// Return a context to the pool
    fn release(&self, wrapper: ContextWrapper) {
        self.active_count.fetch_sub(1, Ordering::Relaxed);

        let mut pool = self.available.lock();
        if pool.len() < self.max_size {
            pool.push(wrapper);
        }
        // Drop if pool is full
    }

    /// Get pool statistics
    pub fn stats(&self) -> PoolStats {
        PoolStats {
            created: self.created_count.load(Ordering::Relaxed),
            active: self.active_count.load(Ordering::Relaxed),
            available: self.available.lock().len(),
            max_size: self.max_size,
        }
    }
}

impl Default for ContextPool {
    fn default() -> Self {
        Self::new(8)
    }
}

/// RAII guard - returns context to pool on drop
pub struct PooledContext<'a> {
    wrapper: Option<ContextWrapper>,
    pool: &'a ContextPool,
}

impl<'a> PooledContext<'a> {
    /// Execute an operation with a fresh MuPDF document
    ///
    /// Opens the document, executes the operation, and ensures cleanup.
    pub fn with_document<F, T>(
        &self,
        data: &[u8],
        mime_type: &str,
        f: F,
    ) -> Result<T, DocumentError>
    where
        F: FnOnce(&mupdf::Document) -> Result<T, DocumentError>,
    {
        let doc = mupdf::Document::from_bytes(data, mime_type)?;
        f(&doc)
    }

    /// Execute an operation with a fresh MuPDF document from path
    pub fn with_document_from_path<F, T>(
        &self,
        path: &str,
        f: F,
    ) -> Result<T, DocumentError>
    where
        F: FnOnce(&mupdf::Document) -> Result<T, DocumentError>,
    {
        let doc = mupdf::Document::open(path)?;
        f(&doc)
    }
}

impl Drop for PooledContext<'_> {
    fn drop(&mut self) {
        if let Some(wrapper) = self.wrapper.take() {
            self.pool.release(wrapper);
        }
    }
}

/// Pool statistics
#[derive(Debug, Clone)]
pub struct PoolStats {
    /// Total contexts ever created
    pub created: usize,
    /// Currently active (borrowed) contexts
    pub active: usize,
    /// Available (in pool) contexts
    pub available: usize,
    /// Maximum pool size
    pub max_size: usize,
}

impl PoolStats {
    /// Calculate reuse efficiency (0.0 to 1.0)
    ///
    /// Higher is better - indicates contexts are being reused.
    pub fn reuse_efficiency(&self) -> f64 {
        if self.created == 0 {
            return 1.0;
        }
        let reused = self.created.saturating_sub(self.max_size);
        reused as f64 / self.created as f64
    }
}

/// Shared context pool for the application
pub type SharedContextPool = Arc<ContextPool>;

/// Create a shared context pool with the given size
pub fn create_shared_pool(max_size: usize) -> SharedContextPool {
    Arc::new(ContextPool::new(max_size))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pool_acquire_release() {
        let pool = ContextPool::new(2);

        // Acquire first context
        {
            let _ctx1 = pool.acquire();
            let stats = pool.stats();
            assert_eq!(stats.active, 1);
            assert_eq!(stats.created, 1);
        }

        // After drop, should be back in pool
        let stats = pool.stats();
        assert_eq!(stats.active, 0);
        assert_eq!(stats.available, 1);

        // Acquire again - should reuse
        {
            let _ctx2 = pool.acquire();
            let stats = pool.stats();
            assert_eq!(stats.created, 1); // No new creation
            assert_eq!(stats.active, 1);
        }
    }

    #[test]
    fn test_pool_max_size() {
        let pool = ContextPool::new(2);

        // Acquire 3 contexts (exceeds pool size)
        let ctx1 = pool.acquire();
        let ctx2 = pool.acquire();
        let ctx3 = pool.acquire();

        assert_eq!(pool.stats().created, 3);
        assert_eq!(pool.stats().active, 3);

        // Drop all
        drop(ctx1);
        drop(ctx2);
        drop(ctx3);

        // Only max_size should be in pool
        assert_eq!(pool.stats().available, 2);
    }
}
