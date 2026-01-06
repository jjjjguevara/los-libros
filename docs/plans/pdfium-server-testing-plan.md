# Pdfium Server Testing Plan & Benchmarks

## Overview

This document defines the comprehensive testing strategy for the `amnesia-server` PDF rendering functionality, powered by `pdfium-render 0.8`. The plan covers unit tests, integration tests, performance benchmarks, and stress tests.

---

## 1. Test Infrastructure

### 1.1 Test Dependencies

```toml
[dev-dependencies]
axum-test = "14"
tokio-test = "0.4"
tempfile = "3"
criterion = "0.5"      # For benchmarks
fake = "2.9"           # Test data generation
proptest = "1.4"       # Property-based testing
```

### 1.2 Test Fixtures

**Location**: `apps/amnesia-server/tests/fixtures/`

| File | Size | Pages | Purpose |
|------|------|-------|---------|
| `simple.pdf` | < 100KB | 5 | Basic rendering tests |
| `large.pdf` | 50MB | 500 | Stress/memory tests |
| `scanned.pdf` | 10MB | 20 | OCR integration tests |
| `corrupted.pdf` | - | - | Error handling tests |
| `encrypted.pdf` | 1MB | 10 | Password protection tests |
| `complex-layout.pdf` | 5MB | 50 | Multi-column, tables |
| `text-heavy.pdf` | 2MB | 100 | Search performance tests |

---

## 2. Unit Tests

### 2.1 Cache Tests (`src/pdf/cache.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_pdf_cache_creation() {
        let cache = PdfCache::new();
        assert_eq!(cache.len().await, 0);
    }

    #[tokio::test]
    async fn test_page_cache_key_generation() {
        let key1 = PageCacheKey::new("book1", 1, 1.5, 0, ImageFormat::Png);
        let key2 = PageCacheKey::new("book1", 1, 1.5, 0, ImageFormat::Png);
        assert_eq!(key1, key2);

        let key3 = PageCacheKey::new("book1", 1, 2.0, 0, ImageFormat::Png);
        assert_ne!(key1, key3);
    }

    #[tokio::test]
    async fn test_text_cache_lru_eviction() {
        let cache = PdfCache::with_capacity(3);
        // Add 4 items, verify first is evicted
        for i in 1..=4 {
            cache.cache_text_layer(&format!("book{}", i), 1, TextLayer::default()).await;
        }
        // book1 should be evicted
        assert!(cache.get_cached_text("book1", 1).await.is_none());
        assert!(cache.get_cached_text("book4", 1).await.is_some());
    }

    #[tokio::test]
    async fn test_page_cache_hit_rate() {
        let cache = PdfCache::with_capacity(10);
        let key = PageCacheKey::new("book1", 1, 1.5, 0, ImageFormat::Png);

        // Miss
        assert!(cache.get_cached_page(&key).await.is_none());

        // Put
        cache.cache_page(&key, vec![1, 2, 3]).await;

        // Hit
        assert!(cache.get_cached_page(&key).await.is_some());
    }

    #[tokio::test]
    async fn test_concurrent_cache_access() {
        let cache = Arc::new(PdfCache::new());
        let handles: Vec<_> = (0..10)
            .map(|i| {
                let cache = cache.clone();
                tokio::spawn(async move {
                    let key = PageCacheKey::new(&format!("book{}", i), 1, 1.5, 0, ImageFormat::Png);
                    cache.cache_page(&key, vec![i as u8]).await;
                    cache.get_cached_page(&key).await
                })
            })
            .collect();

        for handle in handles {
            assert!(handle.await.unwrap().is_some());
        }
    }
}
```

### 2.2 Parser Tests (`src/pdf/parser.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture_path(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    #[test]
    fn test_parser_from_path() {
        let parser = PdfParser::from_path(fixture_path("simple.pdf"));
        assert!(parser.is_ok());
        assert_eq!(parser.unwrap().page_count(), 5);
    }

    #[test]
    fn test_parser_from_bytes() {
        let bytes = std::fs::read(fixture_path("simple.pdf")).unwrap();
        let parser = PdfParser::from_bytes(bytes, "test-id".to_string());
        assert!(parser.is_ok());
    }

    #[test]
    fn test_metadata_extraction() {
        let parser = PdfParser::from_path(fixture_path("simple.pdf")).unwrap();
        let metadata = parser.metadata();
        assert!(metadata.title.is_some() || metadata.author.is_some());
    }

    #[test]
    fn test_page_rendering_formats() {
        let parser = PdfParser::from_path(fixture_path("simple.pdf")).unwrap();

        for format in [ImageFormat::Png, ImageFormat::Jpeg, ImageFormat::WebP] {
            let result = parser.render_page(1, 1.0, format, 0);
            assert!(result.is_ok());
            assert!(!result.unwrap().is_empty());
        }
    }

    #[test]
    fn test_page_rendering_scales() {
        let parser = PdfParser::from_path(fixture_path("simple.pdf")).unwrap();

        let img_1x = parser.render_page(1, 1.0, ImageFormat::Png, 0).unwrap();
        let img_2x = parser.render_page(1, 2.0, ImageFormat::Png, 0).unwrap();

        // 2x should be larger (more pixels)
        assert!(img_2x.len() > img_1x.len());
    }

    #[test]
    fn test_page_rendering_rotations() {
        let parser = PdfParser::from_path(fixture_path("simple.pdf")).unwrap();

        for rotation in [0, 90, 180, 270] {
            let result = parser.render_page(1, 1.0, ImageFormat::Png, rotation);
            assert!(result.is_ok());
        }
    }

    #[test]
    fn test_text_extraction() {
        let parser = PdfParser::from_path(fixture_path("text-heavy.pdf")).unwrap();
        let text_layer = parser.extract_text(1).unwrap();

        assert!(!text_layer.segments.is_empty());
        // Verify coordinate normalization (0-1 range)
        for segment in &text_layer.segments {
            assert!(segment.x >= 0.0 && segment.x <= 1.0);
            assert!(segment.y >= 0.0 && segment.y <= 1.0);
        }
    }

    #[test]
    fn test_search_functionality() {
        let parser = PdfParser::from_path(fixture_path("text-heavy.pdf")).unwrap();
        let results = parser.search("the", 10).unwrap();

        assert!(!results.is_empty());
        assert!(results.len() <= 10);

        for result in &results {
            assert!(result.text.to_lowercase().contains("the"));
            assert!(result.page >= 1);
        }
    }

    #[test]
    fn test_invalid_page_number() {
        let parser = PdfParser::from_path(fixture_path("simple.pdf")).unwrap();

        assert!(parser.render_page(0, 1.0, ImageFormat::Png, 0).is_err());
        assert!(parser.render_page(999, 1.0, ImageFormat::Png, 0).is_err());
    }

    #[test]
    fn test_corrupted_pdf() {
        let result = PdfParser::from_path(fixture_path("corrupted.pdf"));
        assert!(result.is_err());
    }
}
```

### 2.3 Type Tests (`src/pdf/types.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_image_format_content_type() {
        assert_eq!(ImageFormat::Png.content_type(), "image/png");
        assert_eq!(ImageFormat::Jpeg.content_type(), "image/jpeg");
        assert_eq!(ImageFormat::WebP.content_type(), "image/webp");
    }

    #[test]
    fn test_page_render_request_defaults() {
        let json = r#"{"page": 5}"#;
        let request: PageRenderRequest = serde_json::from_str(json).unwrap();

        assert_eq!(request.page, 5);
        assert_eq!(request.scale, 1.5); // default
        assert_eq!(request.format, ImageFormat::Png); // default
        assert_eq!(request.rotation, 0); // default
    }

    #[test]
    fn test_pdf_metadata_serialization() {
        let metadata = PdfMetadata {
            title: Some("Test".to_string()),
            author: Some("Author".to_string()),
            ..Default::default()
        };

        let json = serde_json::to_string(&metadata).unwrap();
        let parsed: PdfMetadata = serde_json::from_str(&json).unwrap();

        assert_eq!(metadata.title, parsed.title);
    }
}
```

---

## 3. Integration Tests

### 3.1 API Endpoint Tests

**Location**: `apps/amnesia-server/tests/pdf_api_tests.rs`

```rust
use axum_test::TestServer;
use amnesia_server::{create_app, AppState};

async fn create_test_server() -> TestServer {
    let state = AppState::new_for_testing().await;
    let app = create_app(state);
    TestServer::new(app).unwrap()
}

#[tokio::test]
async fn test_health_endpoint() {
    let server = create_test_server().await;
    let response = server.get("/health").await;

    response.assert_status_ok();
    response.assert_json_contains(&json!({
        "status": "healthy"
    }));
}

#[tokio::test]
async fn test_pdf_upload() {
    let server = create_test_server().await;
    let pdf_bytes = include_bytes!("fixtures/simple.pdf");

    let response = server
        .post("/api/v1/pdfs")
        .multipart(MultipartForm::new().file("file", pdf_bytes.to_vec(), "test.pdf"))
        .await;

    response.assert_status_ok();
    let body: UploadResponse = response.json();
    assert!(!body.id.is_empty());
}

#[tokio::test]
async fn test_pdf_page_render() {
    let server = create_test_server().await;

    // Upload first
    let pdf_bytes = include_bytes!("fixtures/simple.pdf");
    let upload_response = server
        .post("/api/v1/pdfs")
        .multipart(MultipartForm::new().file("file", pdf_bytes.to_vec(), "test.pdf"))
        .await;
    let upload: UploadResponse = upload_response.json();

    // Render page
    let response = server
        .get(&format!("/api/v1/pdfs/{}/pages/1", upload.id))
        .await;

    response.assert_status_ok();
    response.assert_header("content-type", "image/png");
    assert!(response.as_bytes().len() > 1000); // Non-trivial image
}

#[tokio::test]
async fn test_pdf_page_render_with_params() {
    let server = create_test_server().await;
    let pdf_id = upload_test_pdf(&server).await;

    let response = server
        .get(&format!(
            "/api/v1/pdfs/{}/pages/1?scale=2.0&format=jpeg&rotation=90",
            pdf_id
        ))
        .await;

    response.assert_status_ok();
    response.assert_header("content-type", "image/jpeg");
}

#[tokio::test]
async fn test_pdf_text_extraction() {
    let server = create_test_server().await;
    let pdf_id = upload_test_pdf(&server).await;

    let response = server
        .get(&format!("/api/v1/pdfs/{}/pages/1/text", pdf_id))
        .await;

    response.assert_status_ok();
    let text_layer: TextLayer = response.json();
    assert!(!text_layer.segments.is_empty());
}

#[tokio::test]
async fn test_pdf_search() {
    let server = create_test_server().await;
    let pdf_id = upload_test_pdf(&server).await;

    let response = server
        .get(&format!("/api/v1/pdfs/{}/search?q=test&limit=10", pdf_id))
        .await;

    response.assert_status_ok();
    let results: Vec<PdfSearchResult> = response.json();
    // Results may be empty if "test" not in PDF, but should not error
}

#[tokio::test]
async fn test_pdf_not_found() {
    let server = create_test_server().await;

    let response = server.get("/api/v1/pdfs/nonexistent/pages/1").await;
    response.assert_status(StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_invalid_page_number() {
    let server = create_test_server().await;
    let pdf_id = upload_test_pdf(&server).await;

    let response = server
        .get(&format!("/api/v1/pdfs/{}/pages/999", pdf_id))
        .await;
    response.assert_status(StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_pdf_delete() {
    let server = create_test_server().await;
    let pdf_id = upload_test_pdf(&server).await;

    let response = server.delete(&format!("/api/v1/pdfs/{}", pdf_id)).await;
    response.assert_status(StatusCode::NO_CONTENT);

    // Verify deleted
    let get_response = server.get(&format!("/api/v1/pdfs/{}", pdf_id)).await;
    get_response.assert_status(StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_thumbnail_endpoint() {
    let server = create_test_server().await;
    let pdf_id = upload_test_pdf(&server).await;

    let response = server
        .get(&format!("/api/v1/pdfs/{}/pages/1/thumbnail?size=150", pdf_id))
        .await;

    response.assert_status_ok();
    response.assert_header("content-type", "image/jpeg");
}
```

### 3.2 Upload System Tests

```rust
#[tokio::test]
async fn test_chunked_upload_handshake() {
    let server = create_test_server().await;

    let response = server
        .post("/api/v1/upload/handshake")
        .json(&json!({
            "filename": "large.pdf",
            "size": 50_000_000,
            "hash": "abc123"
        }))
        .await;

    response.assert_status_ok();
    let handshake: HandshakeResponse = response.json();
    assert!(!handshake.session_id.is_empty());
}

#[tokio::test]
async fn test_chunked_upload_full_flow() {
    let server = create_test_server().await;
    let pdf_bytes = include_bytes!("fixtures/simple.pdf");
    let chunk_size = 1024 * 64; // 64KB chunks

    // Handshake
    let handshake = server
        .post("/api/v1/upload/handshake")
        .json(&json!({
            "filename": "test.pdf",
            "size": pdf_bytes.len(),
            "hash": calculate_hash(pdf_bytes)
        }))
        .await
        .json::<HandshakeResponse>();

    // Upload chunks
    for (i, chunk) in pdf_bytes.chunks(chunk_size).enumerate() {
        let response = server
            .post(&format!(
                "/api/v1/upload/{}/chunks/{}",
                handshake.session_id, i
            ))
            .body(chunk.to_vec())
            .await;
        response.assert_status_ok();
    }

    // Finalize
    let finalize = server
        .post(&format!("/api/v1/upload/{}/finalize", handshake.session_id))
        .await;
    finalize.assert_status_ok();
}
```

---

## 4. Performance Benchmarks

### 4.1 Benchmark Setup

**File**: `apps/amnesia-server/benches/pdf_benchmarks.rs`

```rust
use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};

fn bench_page_render(c: &mut Criterion) {
    let parser = PdfParser::from_path("tests/fixtures/simple.pdf").unwrap();

    let mut group = c.benchmark_group("page_render");

    for scale in [1.0, 1.5, 2.0, 3.0] {
        group.bench_with_input(
            BenchmarkId::new("scale", scale),
            &scale,
            |b, &scale| {
                b.iter(|| {
                    parser.render_page(black_box(1), scale, ImageFormat::Png, 0)
                })
            },
        );
    }

    group.finish();
}

fn bench_text_extraction(c: &mut Criterion) {
    let parser = PdfParser::from_path("tests/fixtures/text-heavy.pdf").unwrap();

    c.bench_function("text_extraction", |b| {
        b.iter(|| parser.extract_text(black_box(1)))
    });
}

fn bench_search(c: &mut Criterion) {
    let parser = PdfParser::from_path("tests/fixtures/text-heavy.pdf").unwrap();

    let mut group = c.benchmark_group("search");

    for limit in [10, 50, 100] {
        group.bench_with_input(
            BenchmarkId::new("limit", limit),
            &limit,
            |b, &limit| {
                b.iter(|| parser.search(black_box("the"), limit))
            },
        );
    }

    group.finish();
}

fn bench_cache_operations(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let cache = Arc::new(PdfCache::with_capacity(100));

    c.bench_function("cache_put", |b| {
        b.iter(|| {
            rt.block_on(async {
                let key = PageCacheKey::new("book1", 1, 1.5, 0, ImageFormat::Png);
                cache.cache_page(&key, vec![1, 2, 3, 4, 5]).await
            })
        })
    });

    c.bench_function("cache_get_hit", |b| {
        let key = PageCacheKey::new("book1", 1, 1.5, 0, ImageFormat::Png);
        rt.block_on(cache.cache_page(&key, vec![1, 2, 3, 4, 5]));

        b.iter(|| {
            rt.block_on(async { cache.get_cached_page(&key).await })
        })
    });
}

criterion_group!(
    benches,
    bench_page_render,
    bench_text_extraction,
    bench_search,
    bench_cache_operations,
);
criterion_main!(benches);
```

### 4.2 Performance Targets

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| **First page render (cold)** | < 500ms | Timer from upload complete to first render |
| **Page render (cached)** | < 50ms | Cache hit response time |
| **Text extraction** | < 100ms/page | Single page text layer |
| **Search (100 pages)** | < 2s | Full-text search with 50 results |
| **Thumbnail render** | < 200ms | 200px thumbnail |
| **Memory (50-page PDF)** | < 100MB RSS | Process memory after load |
| **Memory (500-page PDF)** | < 300MB RSS | Process memory after load |
| **Concurrent renders** | 10 req/s | Sustained throughput |
| **Cache hit rate** | > 80% | After warmup period |

### 4.3 Memory Profiling

```bash
# Run with memory profiling
MALLOC_CONF=prof:true cargo run --release

# Profile specific test
heaptrack ./target/release/amnesia-server &
sleep 5
curl -X POST -F file=@large.pdf http://localhost:3000/api/v1/pdfs
curl http://localhost:3000/api/v1/pdfs/ID/pages/1
pkill amnesia-server

# Analyze
heaptrack_gui heaptrack.amnesia-server.*.gz
```

---

## 5. Stress Tests

### 5.1 Concurrent Request Tests

```rust
#[tokio::test]
async fn test_concurrent_page_renders() {
    let server = Arc::new(create_test_server().await);
    let pdf_id = upload_test_pdf(&server).await;

    let handles: Vec<_> = (1..=10)
        .map(|page| {
            let server = server.clone();
            let id = pdf_id.clone();
            tokio::spawn(async move {
                server
                    .get(&format!("/api/v1/pdfs/{}/pages/{}", id, page))
                    .await
            })
        })
        .collect();

    for handle in handles {
        let response = handle.await.unwrap();
        response.assert_status_ok();
    }
}

#[tokio::test]
async fn test_concurrent_different_pdfs() {
    let server = Arc::new(create_test_server().await);

    // Upload 5 different PDFs
    let pdf_ids: Vec<_> = futures::future::join_all(
        (0..5).map(|i| {
            let server = server.clone();
            async move {
                upload_pdf_with_name(&server, &format!("test{}.pdf", i)).await
            }
        })
    ).await;

    // Render page 1 of each concurrently
    let handles: Vec<_> = pdf_ids
        .iter()
        .map(|id| {
            let server = server.clone();
            let id = id.clone();
            tokio::spawn(async move {
                server
                    .get(&format!("/api/v1/pdfs/{}/pages/1", id))
                    .await
            })
        })
        .collect();

    for handle in handles {
        handle.await.unwrap().assert_status_ok();
    }
}

#[tokio::test]
async fn test_cache_eviction_under_load() {
    let server = create_test_server().await;
    let pdf_id = upload_large_pdf(&server).await; // 500 pages

    // Render all pages sequentially (exceeds cache capacity)
    for page in 1..=500 {
        let response = server
            .get(&format!("/api/v1/pdfs/{}/pages/{}", pdf_id, page))
            .await;
        response.assert_status_ok();
    }

    // Re-render early pages (should be cache miss, but should work)
    for page in 1..=10 {
        let response = server
            .get(&format!("/api/v1/pdfs/{}/pages/{}", pdf_id, page))
            .await;
        response.assert_status_ok();
    }
}
```

### 5.2 Large PDF Tests

```rust
#[tokio::test]
async fn test_large_pdf_upload() {
    let server = create_test_server().await;
    let large_pdf = std::fs::read("tests/fixtures/large.pdf").unwrap(); // 50MB

    let start = std::time::Instant::now();
    let response = server
        .post("/api/v1/pdfs")
        .multipart(MultipartForm::new().file("file", large_pdf, "large.pdf"))
        .await;
    let duration = start.elapsed();

    response.assert_status_ok();
    assert!(duration < Duration::from_secs(120)); // Within timeout
}

#[tokio::test]
async fn test_large_pdf_memory_usage() {
    let initial_memory = get_process_memory();

    let server = create_test_server().await;
    let pdf_id = upload_large_pdf(&server).await;

    // Render 10 pages
    for page in 1..=10 {
        server
            .get(&format!("/api/v1/pdfs/{}/pages/{}", pdf_id, page))
            .await;
    }

    let final_memory = get_process_memory();
    let memory_increase = final_memory - initial_memory;

    assert!(memory_increase < 300 * 1024 * 1024); // < 300MB increase
}
```

---

## 6. Timeout & Error Handling Tests

### 6.1 Timeout Tests

```rust
#[tokio::test]
async fn test_search_timeout() {
    let server = create_test_server().await;
    let pdf_id = upload_large_pdf(&server).await;

    // Search with very common term (could take long)
    let start = std::time::Instant::now();
    let response = server
        .get(&format!("/api/v1/pdfs/{}/search?q=a&limit=1000", pdf_id))
        .await;
    let duration = start.elapsed();

    // Should either succeed within timeout or return timeout error
    assert!(duration < Duration::from_secs(35)); // 30s timeout + buffer
}

#[tokio::test]
async fn test_render_timeout() {
    let server = create_test_server().await;
    let pdf_id = upload_complex_pdf(&server).await;

    let start = std::time::Instant::now();
    let response = server
        .get(&format!("/api/v1/pdfs/{}/pages/1?scale=10.0", pdf_id)) // Very high scale
        .await;
    let duration = start.elapsed();

    // Should complete or timeout within configured limit
    assert!(duration < Duration::from_secs(35));
}
```

### 6.2 Error Handling Tests

```rust
#[tokio::test]
async fn test_corrupted_pdf_upload() {
    let server = create_test_server().await;
    let corrupted = b"not a pdf at all";

    let response = server
        .post("/api/v1/pdfs")
        .multipart(MultipartForm::new().file("file", corrupted.to_vec(), "bad.pdf"))
        .await;

    response.assert_status(StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_invalid_rotation() {
    let server = create_test_server().await;
    let pdf_id = upload_test_pdf(&server).await;

    let response = server
        .get(&format!("/api/v1/pdfs/{}/pages/1?rotation=45", pdf_id))
        .await;

    response.assert_status(StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_zero_scale() {
    let server = create_test_server().await;
    let pdf_id = upload_test_pdf(&server).await;

    let response = server
        .get(&format!("/api/v1/pdfs/{}/pages/1?scale=0", pdf_id))
        .await;

    response.assert_status(StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_negative_page() {
    let server = create_test_server().await;
    let pdf_id = upload_test_pdf(&server).await;

    // This will likely be caught by type parsing
    let response = server
        .get(&format!("/api/v1/pdfs/{}/pages/-1", pdf_id))
        .await;

    response.assert_status(StatusCode::BAD_REQUEST);
}
```

---

## 7. Thread-Safety Tests

```rust
#[tokio::test]
async fn test_parser_mutex_contention() {
    let parser = Arc::new(SafePdfParser::new(
        PdfParser::from_path("tests/fixtures/simple.pdf").unwrap()
    ));

    // Concurrent operations on same parser
    let handles: Vec<_> = (0..20)
        .map(|i| {
            let parser = parser.clone();
            tokio::spawn(async move {
                let page = (i % 5) + 1;
                parser.lock().await.render_page(page, 1.0, ImageFormat::Png, 0)
            })
        })
        .collect();

    for handle in handles {
        assert!(handle.await.unwrap().is_ok());
    }
}

#[tokio::test]
async fn test_cache_race_conditions() {
    let cache = Arc::new(PdfCache::new());

    // Concurrent reads and writes
    let handles: Vec<_> = (0..100)
        .map(|i| {
            let cache = cache.clone();
            tokio::spawn(async move {
                let key = PageCacheKey::new("book1", i % 10, 1.5, 0, ImageFormat::Png);
                if i % 2 == 0 {
                    cache.cache_page(&key, vec![i as u8]).await;
                } else {
                    cache.get_cached_page(&key).await;
                }
            })
        })
        .collect();

    for handle in handles {
        handle.await.unwrap();
    }
}
```

---

## 8. Test Execution

### 8.1 Commands

```bash
# Run all tests
cd apps/amnesia-server
cargo test

# Run with output
cargo test -- --nocapture

# Run specific test
cargo test test_pdf_upload

# Run integration tests only
cargo test --test pdf_api_tests

# Run benchmarks
cargo bench

# Run with coverage
cargo tarpaulin --out Html

# Run stress tests (longer timeout)
cargo test --release stress -- --test-threads=1
```

### 8.2 CI Configuration

```yaml
# .github/workflows/server-tests.yml
name: Server Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Cache cargo
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: apps/amnesia-server

      - name: Run tests
        working-directory: apps/amnesia-server
        run: cargo test --all-features

      - name: Run benchmarks (dry run)
        working-directory: apps/amnesia-server
        run: cargo bench --no-run

  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          components: llvm-tools-preview

      - name: Install cargo-llvm-cov
        uses: taiki-e/install-action@cargo-llvm-cov

      - name: Generate coverage
        working-directory: apps/amnesia-server
        run: cargo llvm-cov --html

      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: apps/amnesia-server/target/llvm-cov/html
```

---

## 9. Test Checklist

### Unit Tests
- [ ] Cache creation and capacity
- [ ] Cache key generation
- [ ] LRU eviction behavior
- [ ] Parser loading (path and bytes)
- [ ] Metadata extraction
- [ ] Page rendering (formats, scales, rotations)
- [ ] Text extraction
- [ ] Search functionality
- [ ] Invalid input handling
- [ ] Type serialization/deserialization

### Integration Tests
- [ ] Health endpoint
- [ ] PDF upload (single file)
- [ ] PDF upload (chunked)
- [ ] Page rendering endpoint
- [ ] Text extraction endpoint
- [ ] Search endpoint
- [ ] Thumbnail endpoint
- [ ] PDF deletion
- [ ] 404 handling
- [ ] Parameter validation

### Performance Tests
- [ ] Page render time by scale
- [ ] Text extraction time
- [ ] Search time by result limit
- [ ] Cache operation latency
- [ ] Memory usage profiling

### Stress Tests
- [ ] Concurrent page renders
- [ ] Concurrent PDF operations
- [ ] Cache eviction under load
- [ ] Large PDF handling
- [ ] Memory limits

### Error Handling
- [ ] Corrupted PDF upload
- [ ] Invalid parameters
- [ ] Timeout scenarios
- [ ] Out-of-range pages

### Thread Safety
- [ ] Parser mutex contention
- [ ] Cache race conditions

---

## 10. API Endpoint Reference

| Method | Path | Parameters | Response | Purpose |
|--------|------|------------|----------|---------|
| GET | `/health` | - | JSON | Health check |
| GET | `/api/v1/pdfs` | - | `PdfListResponse` | List cached PDFs |
| POST | `/api/v1/pdfs` | Multipart file | `UploadResponse` | Upload PDF |
| GET | `/api/v1/pdfs/{id}` | `id` | `PdfDetailResponse` | PDF metadata |
| DELETE | `/api/v1/pdfs/{id}` | `id` | 204 | Delete PDF |
| GET | `/api/v1/pdfs/{id}/pages/{page}` | `scale`, `rotation`, `format` | Image bytes | Render page |
| GET | `/api/v1/pdfs/{id}/pages/{page}/text` | - | `TextLayer` | Text extraction |
| GET | `/api/v1/pdfs/{id}/pages/{page}/thumbnail` | `size` | JPEG bytes | Thumbnail |
| GET | `/api/v1/pdfs/{id}/search` | `q`, `limit` | `Vec<PdfSearchResult>` | Search |
| POST | `/api/v1/upload/handshake` | JSON | `HandshakeResponse` | Chunked upload init |
| POST | `/api/v1/upload/{session}/chunks/{idx}` | bytes | 200 | Upload chunk |
| POST | `/api/v1/upload/{session}/finalize` | - | `FinalizeResponse` | Complete upload |

---

## 11. Timeout Configuration

| Operation | Timeout | Constant |
|-----------|---------|----------|
| PDF parsing | 120s | `PARSE_TIMEOUT_SECS` |
| Page render | 30s | `RENDER_TIMEOUT_SECS` |
| Text extraction | 15s | `TEXT_TIMEOUT_SECS` |
| Search | 30s | `SEARCH_TIMEOUT_SECS` |

---

## 12. Frontend Testing with Obsidian DevTools MCP

This section covers live testing of the Amnesia plugin's PDF reader UI using the Obsidian DevTools MCP server.

### 12.1 Prerequisites

1. **Obsidian running with remote debugging enabled**:
   ```bash
   # macOS
   /Applications/Obsidian.app/Contents/MacOS/Obsidian --remote-debugging-port=9222

   # Linux
   obsidian --remote-debugging-port=9222

   # Windows
   "C:\Users\...\Obsidian.exe" --remote-debugging-port=9222
   ```

2. **MCP Server connected**:
   ```javascript
   mcp__obsidian-devtools__obsidian_connect({ port: 9222 })
   ```

3. **Plugin loaded and test PDF opened** in the reader

### 12.2 Test Helper Functions

These helper functions enable structured testing via MCP:

```javascript
// Helper: Get PDF reader view and components
const getReaderContext = `
(function() {
  const leaves = app.workspace.getLeavesOfType('amnesia-reader');
  if (!leaves.length) return { error: 'No reader view open' };

  const view = leaves[0].view;
  const component = view.component;
  const ctx = component.$$.ctx;

  return {
    view,
    component,
    reader: ctx[3],
    navigator: ctx[3]?.navigator,
    provider: ctx[3]?.provider,
    currentPage: ctx[3]?.navigator?.currentPage,
    totalPages: ctx[3]?.provider?.getPageCount?.()
  };
})()
`;

// Helper: Get server status from UI
const getServerStatus = `
(function() {
  const plugin = app.plugins.plugins['amnesia'];
  if (!plugin) return { error: 'Plugin not loaded' };

  const serverManager = plugin.serverManager;
  return {
    status: serverManager?.getStatus(),
    state: serverManager?.getState(),
    isRunning: serverManager?.isRunning()
  };
})()
`;

// Helper: Capture PDF page container dimensions
const getPageDimensions = `
(function() {
  const leaves = app.workspace.getLeavesOfType('amnesia-reader');
  const view = leaves[0]?.view;
  const contentEl = view?.contentEl;

  const pageContainer = contentEl?.querySelector('.pdf-page-container');
  if (!pageContainer) return { error: 'No PDF page container found' };

  const rect = pageContainer.getBoundingClientRect();
  const img = pageContainer.querySelector('img');

  return {
    container: { width: rect.width, height: rect.height },
    image: img ? {
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      displayWidth: img.width,
      displayHeight: img.height
    } : null
  };
})()
`;
```

### 12.3 PDF Reader UI Tests

#### Test: PDF Opens Successfully

```javascript
// Test: Open PDF and verify rendering
mcp__obsidian-devtools__obsidian_execute_js({
  code: `
(async function() {
  const plugin = app.plugins.plugins['amnesia'];
  const testPdfPath = 'test-files/simple.pdf';

  // Open PDF in reader
  await plugin.openPdfInReader(testPdfPath);

  // Wait for render
  await new Promise(r => setTimeout(r, 2000));

  // Verify
  const leaves = app.workspace.getLeavesOfType('amnesia-reader');
  const view = leaves[0]?.view;
  const ctx = view?.component?.$$.ctx;
  const reader = ctx?.[3];

  return {
    success: !!reader,
    pageCount: reader?.provider?.getPageCount?.(),
    currentPage: reader?.navigator?.currentPage,
    hasImage: !!view?.contentEl?.querySelector('.pdf-page-container img')
  };
})()
  `
})
```

**Expected Result**:
```json
{
  "success": true,
  "pageCount": 5,
  "currentPage": 1,
  "hasImage": true
}
```

#### Test: Page Rendering Quality

```javascript
// Test: Verify rendered image meets quality expectations
mcp__obsidian-devtools__obsidian_execute_js({
  code: `
(function() {
  const leaves = app.workspace.getLeavesOfType('amnesia-reader');
  const view = leaves[0]?.view;
  const img = view?.contentEl?.querySelector('.pdf-page-container img');

  if (!img) return { error: 'No image found' };

  return {
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    aspectRatio: (img.naturalWidth / img.naturalHeight).toFixed(3),
    isLoaded: img.complete && img.naturalHeight > 0,
    hasMinimumResolution: img.naturalWidth >= 800
  };
})()
  `
})
```

**Expected Result**:
- `isLoaded`: true
- `hasMinimumResolution`: true (at scale 1.5, should be ~900px wide for letter-size PDF)

### 12.4 Navigation Tests

#### Test: Page Navigation

```javascript
// Test: Navigate through pages
mcp__obsidian-devtools__obsidian_execute_js({
  code: `
(async function() {
  const leaves = app.workspace.getLeavesOfType('amnesia-reader');
  const ctx = leaves[0]?.view?.component?.$$.ctx;
  const nav = ctx?.[3]?.navigator;

  const results = [];
  const startPage = nav.currentPage;

  // Next page
  await nav.next();
  await new Promise(r => setTimeout(r, 500));
  results.push({ action: 'next', page: nav.currentPage });

  // Next page again
  await nav.next();
  await new Promise(r => setTimeout(r, 500));
  results.push({ action: 'next', page: nav.currentPage });

  // Previous page
  await nav.prev();
  await new Promise(r => setTimeout(r, 500));
  results.push({ action: 'prev', page: nav.currentPage });

  // Go to specific page
  await nav.goToPage(5);
  await new Promise(r => setTimeout(r, 500));
  results.push({ action: 'goToPage(5)', page: nav.currentPage });

  // Return to start
  await nav.goToPage(startPage);

  return { startPage, results };
})()
  `
})
```

**Expected Result**:
```json
{
  "startPage": 1,
  "results": [
    { "action": "next", "page": 2 },
    { "action": "next", "page": 3 },
    { "action": "prev", "page": 2 },
    { "action": "goToPage(5)", "page": 5 }
  ]
}
```

#### Test: Boundary Navigation

```javascript
// Test: Edge cases at first/last page
mcp__obsidian-devtools__obsidian_execute_js({
  code: `
(async function() {
  const leaves = app.workspace.getLeavesOfType('amnesia-reader');
  const ctx = leaves[0]?.view?.component?.$$.ctx;
  const nav = ctx?.[3]?.navigator;
  const provider = ctx?.[3]?.provider;
  const totalPages = provider.getPageCount();

  // Go to first page
  await nav.goToPage(1);
  await new Promise(r => setTimeout(r, 300));

  // Try to go previous (should stay at 1)
  await nav.prev();
  await new Promise(r => setTimeout(r, 300));
  const staysAtFirst = nav.currentPage === 1;

  // Go to last page
  await nav.goToPage(totalPages);
  await new Promise(r => setTimeout(r, 300));

  // Try to go next (should stay at last)
  await nav.next();
  await new Promise(r => setTimeout(r, 300));
  const staysAtLast = nav.currentPage === totalPages;

  return {
    totalPages,
    staysAtFirst,
    staysAtLast
  };
})()
  `
})
```

**Expected Result**:
```json
{
  "totalPages": 5,
  "staysAtFirst": true,
  "staysAtLast": true
}
```

### 12.5 Server Status UI Tests

#### Test: Server Status Display

```javascript
// Test: Server status shows correctly in UI
mcp__obsidian-devtools__obsidian_execute_js({
  code: `
(function() {
  const plugin = app.plugins.plugins['amnesia'];
  const serverManager = plugin?.serverManager;

  if (!serverManager) return { error: 'Server manager not found' };

  const state = serverManager.getState();

  return {
    status: state.status,
    port: state.port,
    isRunning: serverManager.isRunning(),
    uptime: state.uptime,
    restartCount: state.restartCount
  };
})()
  `
})
```

#### Test: Server Health Check

```javascript
// Test: Verify server responds to health check
mcp__obsidian-devtools__obsidian_execute_js({
  code: `
(async function() {
  const plugin = app.plugins.plugins['amnesia'];
  const serverManager = plugin?.serverManager;
  const port = serverManager?.config?.port || 3000;

  try {
    const response = await fetch(\`http://localhost:\${port}/health\`);
    const data = await response.json();

    return {
      reachable: true,
      status: response.status,
      body: data
    };
  } catch (error) {
    return {
      reachable: false,
      error: error.message
    };
  }
})()
  `
})
```

**Expected Result**:
```json
{
  "reachable": true,
  "status": 200,
  "body": { "status": "healthy" }
}
```

### 12.6 Highlight/Annotation Tests

#### Test: Create PDF Highlight

```javascript
// Test: Create a highlight on the current page
mcp__obsidian-devtools__obsidian_execute_js({
  code: `
(async function() {
  const plugin = app.plugins.plugins['amnesia'];
  const leaves = app.workspace.getLeavesOfType('amnesia-reader');
  const view = leaves[0]?.view;
  const ctx = view?.component?.$$.ctx;
  const reader = ctx?.[3];

  // Get current book ID and page
  const bookId = reader?.currentBookId;
  const page = reader?.navigator?.currentPage;

  if (!bookId) return { error: 'No book loaded' };

  // Create test highlight
  const highlight = await plugin.highlightService.createHighlight({
    bookId,
    text: 'Test highlight text',
    selector: {
      primary: { type: 'PdfPageSelector', page },
      fallback: { type: 'PdfTextQuoteSelector', page, exact: 'Test highlight text' },
      region: { type: 'PdfRegionSelector', page, x: 0.1, y: 0.2, width: 0.3, height: 0.05 }
    },
    chapter: \`Page \${page}\`,
    pagePercent: (page / reader.provider.getPageCount()) * 100,
    spineIndex: page - 1
  });

  return {
    created: !!highlight,
    highlightId: highlight?.id,
    bookId,
    page
  };
})()
  `
})
```

#### Test: Render Highlights on Page

```javascript
// Test: Verify highlights render on page change
mcp__obsidian-devtools__obsidian_execute_js({
  code: `
(function() {
  const leaves = app.workspace.getLeavesOfType('amnesia-reader');
  const view = leaves[0]?.view;
  const contentEl = view?.contentEl;

  // Look for highlight overlay elements
  const highlightRects = contentEl?.querySelectorAll('.pdf-highlight-rect');
  const annotationLayer = contentEl?.querySelector('.pdf-annotation-layer');

  return {
    hasAnnotationLayer: !!annotationLayer,
    highlightCount: highlightRects?.length || 0,
    highlights: Array.from(highlightRects || []).map(el => ({
      id: el.dataset.highlightId,
      style: {
        left: el.style.left,
        top: el.style.top,
        width: el.style.width,
        height: el.style.height
      }
    }))
  };
})()
  `
})
```

### 12.7 Settings Integration Tests

#### Test: Server Port Setting

```javascript
// Test: Verify server port setting is applied
mcp__obsidian-devtools__obsidian_execute_js({
  code: `
(function() {
  const plugin = app.plugins.plugins['amnesia'];
  const settings = plugin?.settings;
  const serverManager = plugin?.serverManager;

  return {
    settingsPort: settings?.serverPort,
    actualPort: serverManager?.config?.port,
    match: settings?.serverPort === serverManager?.config?.port
  };
})()
  `
})
```

#### Test: Auto-Start Setting

```javascript
// Test: Verify auto-start setting works
mcp__obsidian-devtools__obsidian_execute_js({
  code: `
(function() {
  const plugin = app.plugins.plugins['amnesia'];
  const settings = plugin?.settings;
  const serverManager = plugin?.serverManager;

  return {
    autoStartEnabled: settings?.serverAutoStart,
    serverRunning: serverManager?.isRunning(),
    serverStatus: serverManager?.getStatus()
  };
})()
  `
})
```

### 12.8 Visual Regression Tests

#### Test: Capture Page Screenshot

```javascript
// Capture screenshot of current PDF page for visual comparison
mcp__obsidian-devtools__obsidian_capture_screenshot({
  selector: '.amnesia-reader-container',
  format: 'png',
  outputPath: '/tmp/amnesia-pdf-page-test.png'
})
```

#### Test: Capture Full Reader View

```javascript
// Capture full reader view including toolbar
mcp__obsidian-devtools__obsidian_capture_screenshot({
  selector: '.workspace-leaf-content[data-type="amnesia-reader"]',
  format: 'png',
  outputPath: '/tmp/amnesia-reader-full-test.png'
})
```

### 12.9 Performance Benchmarks (Frontend)

#### Test: Page Load Time

```javascript
// Benchmark: Measure page render time
mcp__obsidian-devtools__obsidian_execute_js({
  code: `
(async function() {
  const leaves = app.workspace.getLeavesOfType('amnesia-reader');
  const ctx = leaves[0]?.view?.component?.$$.ctx;
  const nav = ctx?.[3]?.navigator;

  const times = [];
  const pagesToTest = [1, 3, 5];

  for (const page of pagesToTest) {
    const start = performance.now();
    await nav.goToPage(page);

    // Wait for image to load
    await new Promise(resolve => {
      const img = leaves[0]?.view?.contentEl?.querySelector('.pdf-page-container img');
      if (img?.complete) resolve();
      else img?.addEventListener('load', resolve);
      setTimeout(resolve, 5000); // Timeout
    });

    const duration = performance.now() - start;
    times.push({ page, duration: Math.round(duration) });
  }

  const avg = times.reduce((sum, t) => sum + t.duration, 0) / times.length;

  return {
    times,
    averageMs: Math.round(avg),
    meetsTarget: avg < 500 // Target: < 500ms
  };
})()
  `
})
```

**Performance Targets**:

| Metric | Target | Measurement |
|--------|--------|-------------|
| Page load (cached) | < 100ms | Time from goToPage to image load |
| Page load (cold) | < 500ms | First page render |
| Navigation response | < 50ms | Time from click to navigation start |
| Highlight render | < 10ms | Time to render highlight overlay |

#### Test: Memory Usage

```javascript
// Check memory usage of PDF reader
mcp__obsidian-devtools__obsidian_execute_js({
  code: `
(function() {
  // Note: performance.memory is Chrome-only
  const memory = performance.memory;

  return {
    usedJSHeapSize: Math.round(memory?.usedJSHeapSize / 1024 / 1024) + ' MB',
    totalJSHeapSize: Math.round(memory?.totalJSHeapSize / 1024 / 1024) + ' MB',
    jsHeapSizeLimit: Math.round(memory?.jsHeapSizeLimit / 1024 / 1024) + ' MB'
  };
})()
  `
})
```

### 12.10 Error Handling Tests

#### Test: Invalid PDF Handling

```javascript
// Test: UI handles invalid PDF gracefully
mcp__obsidian-devtools__obsidian_execute_js({
  code: `
(async function() {
  const plugin = app.plugins.plugins['amnesia'];

  try {
    await plugin.openPdfInReader('nonexistent/invalid.pdf');
    return { error: 'Should have thrown an error' };
  } catch (error) {
    return {
      errorHandled: true,
      errorMessage: error.message,
      noticeFired: true // Check if Notice was shown
    };
  }
})()
  `
})
```

#### Test: Server Unavailable Handling

```javascript
// Test: UI handles server being unavailable
mcp__obsidian-devtools__obsidian_execute_js({
  code: `
(async function() {
  const plugin = app.plugins.plugins['amnesia'];
  const serverManager = plugin?.serverManager;

  // Stop server
  await serverManager?.stop();

  // Try to load a PDF
  const leaves = app.workspace.getLeavesOfType('amnesia-reader');
  const ctx = leaves[0]?.view?.component?.$$.ctx;
  const reader = ctx?.[3];

  // Check if fallback mode is activated or error shown
  const provider = reader?.provider;

  return {
    serverStopped: !serverManager?.isRunning(),
    providerMode: provider?.mode || 'unknown',
    hasErrorState: !!reader?.errorState
  };
})()
  `
})
```

### 12.11 Console Log Monitoring

#### Test: Check for Errors During Operation

```javascript
// Monitor console for errors during test sequence
mcp__obsidian-devtools__obsidian_clear_console_logs()

// ... run tests ...

mcp__obsidian-devtools__obsidian_get_console_logs({
  level: 'error',
  limit: 50
})
```

**Expected Result**: No errors in console during normal operation.

### 12.12 Frontend Test Checklist

#### Reader UI
- [ ] PDF opens successfully
- [ ] Page renders with correct dimensions
- [ ] Page image has minimum quality resolution
- [ ] Loading indicator shown during render
- [ ] Error state displayed for invalid PDFs

#### Navigation
- [ ] Next page works
- [ ] Previous page works
- [ ] Go to specific page works
- [ ] Boundary conditions (first/last page)
- [ ] Keyboard navigation (arrow keys)
- [ ] Page indicator updates correctly

#### Server Integration
- [ ] Server status displayed correctly
- [ ] Server health check passes
- [ ] Server auto-starts if enabled
- [ ] Server restart on crash
- [ ] Graceful fallback when server unavailable

#### Highlights/Annotations
- [ ] Highlight creation works
- [ ] Highlights render on correct page
- [ ] Highlight popup on click
- [ ] Edit/delete highlight
- [ ] Highlights persist after reload

#### Settings
- [ ] Server port setting applied
- [ ] Auto-start setting works
- [ ] Notices setting respected

#### Performance
- [ ] Page load < 500ms (cold)
- [ ] Page load < 100ms (cached)
- [ ] Memory usage stable
- [ ] No memory leaks on navigation

#### Error Handling
- [ ] Invalid PDF shows error
- [ ] Network errors handled gracefully
- [ ] Server timeout handled
- [ ] No console errors during normal use

### 12.13 Automated Test Script

Create a comprehensive test script that can be run via MCP:

```javascript
// Full test suite runner
mcp__obsidian-devtools__obsidian_execute_js({
  code: `
(async function() {
  const results = {
    passed: [],
    failed: [],
    timestamp: new Date().toISOString()
  };

  const test = async (name, fn) => {
    try {
      const result = await fn();
      if (result.success !== false && !result.error) {
        results.passed.push({ name, result });
      } else {
        results.failed.push({ name, result });
      }
    } catch (error) {
      results.failed.push({ name, error: error.message });
    }
  };

  // Test 1: Plugin loaded
  await test('Plugin loaded', () => {
    const plugin = app.plugins.plugins['amnesia'];
    return { success: !!plugin };
  });

  // Test 2: Server running
  await test('Server running', () => {
    const plugin = app.plugins.plugins['amnesia'];
    return { success: plugin?.serverManager?.isRunning() };
  });

  // Test 3: Reader opens
  await test('Reader view exists', () => {
    const leaves = app.workspace.getLeavesOfType('amnesia-reader');
    return { success: leaves.length > 0 };
  });

  // Test 4: Navigation works
  await test('Navigation works', async () => {
    const leaves = app.workspace.getLeavesOfType('amnesia-reader');
    const ctx = leaves[0]?.view?.component?.$$.ctx;
    const nav = ctx?.[3]?.navigator;
    if (!nav) return { success: false, error: 'No navigator' };

    const startPage = nav.currentPage;
    await nav.next();
    await new Promise(r => setTimeout(r, 300));
    const moved = nav.currentPage !== startPage;
    await nav.goToPage(startPage);

    return { success: moved };
  });

  // Summary
  results.summary = {
    total: results.passed.length + results.failed.length,
    passed: results.passed.length,
    failed: results.failed.length,
    passRate: ((results.passed.length / (results.passed.length + results.failed.length)) * 100).toFixed(1) + '%'
  };

  return results;
})()
  `
})
```

---

## 13. End-to-End Test Scenarios

These scenarios test the complete flow from server to frontend.

### Scenario 1: Full PDF Workflow

1. Start with server stopped
2. Open Obsidian with plugin
3. Verify server auto-starts
4. Open a PDF file
5. Navigate through pages
6. Create a highlight
7. Close and reopen PDF
8. Verify highlight persists

### Scenario 2: Large PDF Stress Test

1. Open 500-page PDF
2. Navigate to page 250
3. Monitor memory usage
4. Navigate rapidly through 50 pages
5. Verify no crashes or memory leaks

### Scenario 3: Server Recovery

1. Open PDF with server running
2. Kill server process externally
3. Verify plugin detects failure
4. Verify auto-restart triggers
5. Verify reader recovers gracefully
