//! OCR Module
//!
//! Provides OCR (Optical Character Recognition) functionality for scanned PDFs.
//!
//! ## Features
//!
//! - **Text Extraction**: Extract text from image regions in PDFs
//! - **Text Layer Injection**: Permanently embed searchable text into scanned PDFs
//!
//! ## Extraction Backends
//!
//! - Tesseract (local, requires installation)
//! - Ollama vision models (local LLM)
//!
//! ## Injection Backend
//!
//! - ocrmypdf (wraps Tesseract with PDF/A output)
//!
//! ## Usage
//!
//! ```rust,ignore
//! use los_libros_server::ocr::{OcrService, OcrServiceConfig, OcrRect, OcrInjector};
//!
//! // Text extraction
//! let config = OcrServiceConfig::default();
//! let service = OcrService::new(config);
//! let result = service.ocr_pdf_region(
//!     "pdf-id", 1,
//!     &OcrRect { x: 0.1, y: 0.1, width: 0.3, height: 0.1 },
//!     None, Some("eng"), &pdf_cache
//! ).await?;
//!
//! // Text layer injection
//! let injector = OcrInjector::new(OcrInjectorConfig::default());
//! if injector.is_available().await {
//!     let result = injector.inject(&pdf_bytes, Some("eng")).await?;
//!     // result.output_data contains the searchable PDF
//! }
//! ```

mod injector;
mod provider;
mod service;
mod types;

pub use injector::{OcrInjectionResult, OcrInjector, OcrInjectorConfig};
pub use provider::{OcrProviderTrait, OllamaProvider};
pub use service::{OcrService, OcrServiceConfig};
pub use types::{OcrError, OcrProvider, OcrRect, OcrRequest, OcrResult, OcrWord, PixelRect};

#[cfg(feature = "ocr-tesseract")]
pub use provider::TesseractProvider;
