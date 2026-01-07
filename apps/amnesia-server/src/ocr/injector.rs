//! OCR Text Layer Injector
//!
//! Permanently embeds OCR text layers into PDF files using ocrmypdf.
//! The resulting PDF becomes searchable and has copy-able text.
//!
//! ## Requirements
//!
//! - `ocrmypdf` must be installed and available in PATH
//! - Tesseract must be installed (used by ocrmypdf)
//!
//! ## Usage
//!
//! ```rust,ignore
//! use crate::ocr::{OcrInjector, OcrInjectorConfig};
//!
//! let injector = OcrInjector::new(OcrInjectorConfig::default());
//!
//! // Check if ocrmypdf is available
//! if injector.is_available().await {
//!     // Inject OCR layer into a scanned PDF
//!     let result = injector.inject(&pdf_bytes, Some("eng")).await?;
//!     // result.output_data contains the OCRed PDF
//! }
//! ```

use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use super::types::OcrError;

/// Configuration for the OCR injector
#[derive(Debug, Clone)]
pub struct OcrInjectorConfig {
    /// Path to ocrmypdf executable (default: "ocrmypdf" - uses PATH)
    pub ocrmypdf_path: String,
    /// Temporary directory for processing (default: system temp)
    pub temp_dir: Option<PathBuf>,
    /// Default language for OCR (default: "eng")
    pub default_language: String,
    /// DPI for rendering scanned pages (default: 300)
    pub dpi: u32,
    /// Skip text detection (force OCR even on text pages) (default: false)
    pub force_ocr: bool,
    /// Optimization level: 0 (fastest, largest), 1, 2, 3 (slowest, smallest)
    pub optimize: u8,
    /// Number of parallel jobs (default: CPU count / 2)
    pub jobs: Option<usize>,
}

impl Default for OcrInjectorConfig {
    fn default() -> Self {
        Self {
            ocrmypdf_path: "ocrmypdf".to_string(),
            temp_dir: None,
            default_language: "eng".to_string(),
            dpi: 300,
            force_ocr: false,
            optimize: 1,
            jobs: None,
        }
    }
}

/// Result of OCR injection
#[derive(Debug)]
pub struct OcrInjectionResult {
    /// OCRed PDF data
    pub output_data: Vec<u8>,
    /// Number of pages processed
    pub pages_processed: usize,
    /// Whether any pages already had text
    pub had_existing_text: bool,
    /// Elapsed time in seconds
    pub elapsed_secs: f64,
}

/// OCR text layer injector using ocrmypdf
pub struct OcrInjector {
    config: OcrInjectorConfig,
}

impl OcrInjector {
    /// Create a new OCR injector
    pub fn new(config: OcrInjectorConfig) -> Self {
        Self { config }
    }

    /// Validate language code to prevent argument injection
    fn validate_language(lang: &str) -> Result<(), OcrError> {
        // Language codes should be alphanumeric with optional underscore/plus (e.g., "eng", "eng+deu", "chi_sim")
        if lang.is_empty() || lang.len() > 20 {
            return Err(OcrError::InjectionError("Invalid language code length".to_string()));
        }
        for c in lang.chars() {
            if !c.is_ascii_alphanumeric() && c != '+' && c != '_' {
                return Err(OcrError::InjectionError(format!(
                    "Invalid character in language code: {}",
                    c
                )));
            }
        }
        Ok(())
    }

    /// Check if ocrmypdf is available
    pub async fn is_available(&self) -> bool {
        let result = Command::new(&self.config.ocrmypdf_path)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;

        matches!(result, Ok(status) if status.success())
    }

    /// Get ocrmypdf version
    pub async fn version(&self) -> Result<String, OcrError> {
        let output = Command::new(&self.config.ocrmypdf_path)
            .arg("--version")
            .output()
            .await
            .map_err(|e| {
                OcrError::ProviderNotAvailable(format!("Failed to run ocrmypdf: {}", e))
            })?;

        if !output.status.success() {
            return Err(OcrError::ProviderNotAvailable(
                "ocrmypdf not available".to_string(),
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    /// Inject OCR text layer into a PDF
    ///
    /// Takes raw PDF bytes and returns OCRed PDF bytes
    pub async fn inject(
        &self,
        pdf_data: &[u8],
        language: Option<&str>,
    ) -> Result<OcrInjectionResult, OcrError> {
        let start_time = std::time::Instant::now();
        let lang = language.unwrap_or(&self.config.default_language);

        // Validate language code to prevent argument injection
        Self::validate_language(lang)?;

        // Create temp directory
        let temp_dir = self.config.temp_dir.clone().unwrap_or_else(std::env::temp_dir);
        let unique_id = uuid::Uuid::new_v4().to_string();
        let input_path = temp_dir.join(format!("ocr_input_{}.pdf", unique_id));
        let output_path = temp_dir.join(format!("ocr_output_{}.pdf", unique_id));

        // Write input PDF to temp file
        tokio::fs::write(&input_path, pdf_data)
            .await
            .map_err(|e| OcrError::InjectionError(format!("Failed to write input PDF: {}", e)))?;

        // Build ocrmypdf command
        let mut cmd = Command::new(&self.config.ocrmypdf_path);

        // Language
        cmd.arg("-l").arg(lang);

        // DPI
        cmd.arg("--image-dpi").arg(self.config.dpi.to_string());

        // Skip text - don't OCR pages that already have text
        if !self.config.force_ocr {
            cmd.arg("--skip-text");
        } else {
            cmd.arg("--force-ocr");
        }

        // Optimization level
        cmd.arg("--optimize").arg(self.config.optimize.to_string());

        // Parallel jobs
        if let Some(jobs) = self.config.jobs {
            cmd.arg("-j").arg(jobs.to_string());
        }

        // Quiet mode for cleaner output
        cmd.arg("-q");

        // Input and output paths
        cmd.arg(&input_path).arg(&output_path);

        // Run ocrmypdf
        let output = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| OcrError::InjectionError(format!("Failed to run ocrmypdf: {}", e)))?;

        // Clean up input file
        let _ = tokio::fs::remove_file(&input_path).await;

        // Check for errors
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);

            // Clean up output file if it exists
            let _ = tokio::fs::remove_file(&output_path).await;

            // Check for specific error conditions
            if stderr.contains("PriorOcrFoundError") || stderr.contains("already has text") {
                // PDF already has text - not an error, just return original
                return Ok(OcrInjectionResult {
                    output_data: pdf_data.to_vec(),
                    pages_processed: 0,
                    had_existing_text: true,
                    elapsed_secs: start_time.elapsed().as_secs_f64(),
                });
            }

            return Err(OcrError::InjectionError(format!(
                "ocrmypdf failed: {}",
                stderr
            )));
        }

        // Read output PDF
        let output_data = tokio::fs::read(&output_path).await;

        // Clean up output file (always happens, even on read error)
        let _ = tokio::fs::remove_file(&output_path).await;

        // Now handle read errors
        let output_data = output_data
            .map_err(|e| OcrError::InjectionError(format!("Failed to read output PDF: {}", e)))?;

        // Parse stdout for statistics (ocrmypdf outputs JSON with -v)
        // For now, we estimate based on file size change
        let had_existing_text = output_data.len() == pdf_data.len();

        Ok(OcrInjectionResult {
            output_data,
            pages_processed: 0, // Could parse from ocrmypdf output with verbosity
            had_existing_text,
            elapsed_secs: start_time.elapsed().as_secs_f64(),
        })
    }

    /// Inject OCR using stdin/stdout (avoids temp files)
    ///
    /// More efficient for small PDFs but may have memory constraints for large files
    pub async fn inject_streaming(
        &self,
        pdf_data: &[u8],
        language: Option<&str>,
    ) -> Result<OcrInjectionResult, OcrError> {
        let start_time = std::time::Instant::now();
        let lang = language.unwrap_or(&self.config.default_language);

        // Validate language code to prevent argument injection
        Self::validate_language(lang)?;

        // Build ocrmypdf command with stdin/stdout
        let mut cmd = Command::new(&self.config.ocrmypdf_path);

        cmd.arg("-l").arg(lang);
        cmd.arg("--image-dpi").arg(self.config.dpi.to_string());

        if !self.config.force_ocr {
            cmd.arg("--skip-text");
        } else {
            cmd.arg("--force-ocr");
        }

        cmd.arg("--optimize").arg(self.config.optimize.to_string());

        if let Some(jobs) = self.config.jobs {
            cmd.arg("-j").arg(jobs.to_string());
        }

        cmd.arg("-q");

        // Use - for stdin and stdout
        cmd.arg("-").arg("-");

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| {
            OcrError::InjectionError(format!("Failed to spawn ocrmypdf: {}", e))
        })?;

        // Write PDF to stdin with proper error handling
        if let Some(mut stdin) = child.stdin.take() {
            if let Err(e) = stdin.write_all(pdf_data).await {
                // Kill the child process on write error
                let _ = child.kill().await;
                return Err(OcrError::InjectionError(format!(
                    "Failed to write to ocrmypdf stdin: {}",
                    e
                )));
            }
            // Flush and explicitly close stdin to signal end of input
            if let Err(e) = stdin.flush().await {
                let _ = child.kill().await;
                return Err(OcrError::InjectionError(format!(
                    "Failed to flush ocrmypdf stdin: {}",
                    e
                )));
            }
            drop(stdin); // Explicitly close stdin
        }

        // Wait for completion and collect output
        let output = child.wait_with_output().await.map_err(|e| {
            OcrError::InjectionError(format!("Failed to wait for ocrmypdf: {}", e))
        })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);

            if stderr.contains("PriorOcrFoundError") || stderr.contains("already has text") {
                return Ok(OcrInjectionResult {
                    output_data: pdf_data.to_vec(),
                    pages_processed: 0,
                    had_existing_text: true,
                    elapsed_secs: start_time.elapsed().as_secs_f64(),
                });
            }

            return Err(OcrError::InjectionError(format!(
                "ocrmypdf failed: {}",
                stderr
            )));
        }

        Ok(OcrInjectionResult {
            output_data: output.stdout,
            pages_processed: 0,
            had_existing_text: false,
            elapsed_secs: start_time.elapsed().as_secs_f64(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_injector_creation() {
        let config = OcrInjectorConfig::default();
        let injector = OcrInjector::new(config);

        // Just verify it can be created
        assert!(injector.config.dpi == 300);
    }

    #[tokio::test]
    async fn test_availability_check() {
        let injector = OcrInjector::new(OcrInjectorConfig::default());

        // This test may pass or fail depending on whether ocrmypdf is installed
        // It should not panic
        let _available = injector.is_available().await;
    }
}
