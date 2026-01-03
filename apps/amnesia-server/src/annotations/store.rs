//! SQLite storage for annotations
//!
//! Provides CRUD operations for annotations using SQLite.

use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use super::types::{Annotation, AnnotationType};

/// Repository for annotation persistence
pub struct AnnotationRepository<'a> {
    pool: &'a SqlitePool,
}

/// Query filters for listing annotations
#[derive(Debug, Default)]
pub struct AnnotationQuery {
    pub book_id: Option<String>,
    pub user_id: Option<String>,
    pub annotation_type: Option<AnnotationType>,
    pub chapter_href: Option<String>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

impl<'a> AnnotationRepository<'a> {
    /// Create a new repository
    pub fn new(pool: &'a SqlitePool) -> Self {
        Self { pool }
    }

    /// Initialize the annotations table
    pub async fn init(&self) -> Result<()> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS annotations (
                id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL,
                user_id TEXT,
                annotation_type TEXT NOT NULL,
                source TEXT NOT NULL,
                cfi TEXT,
                text_quote TEXT,
                progression REAL,
                selectors_json TEXT NOT NULL,
                body_json TEXT,
                style_json TEXT,
                sync_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_annotations_book ON annotations(book_id);
            CREATE INDEX IF NOT EXISTS idx_annotations_user ON annotations(user_id);
            CREATE INDEX IF NOT EXISTS idx_annotations_type ON annotations(annotation_type);
            CREATE INDEX IF NOT EXISTS idx_annotations_source ON annotations(source);
            "#,
        )
        .execute(self.pool)
        .await?;

        Ok(())
    }

    /// Save an annotation (insert or update)
    pub async fn save(&self, annotation: &Annotation) -> Result<()> {
        let annotation_type = match annotation.annotation_type {
            AnnotationType::Highlight => "highlight",
            AnnotationType::Bookmark => "bookmark",
            AnnotationType::Note => "note",
            AnnotationType::Underline => "underline",
        };

        let selectors_json = serde_json::to_string(&annotation.target.selectors)?;
        let body_json = annotation
            .body
            .as_ref()
            .map(|b| serde_json::to_string(b))
            .transpose()?;
        let style_json = annotation
            .style
            .as_ref()
            .map(|s| serde_json::to_string(s))
            .transpose()?;
        let sync_json = annotation
            .sync
            .as_ref()
            .map(|s| serde_json::to_string(s))
            .transpose()?;

        sqlx::query(
            r#"
            INSERT INTO annotations (
                id, book_id, user_id, annotation_type, source,
                cfi, text_quote, progression, selectors_json,
                body_json, style_json, sync_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                annotation_type = excluded.annotation_type,
                source = excluded.source,
                cfi = excluded.cfi,
                text_quote = excluded.text_quote,
                progression = excluded.progression,
                selectors_json = excluded.selectors_json,
                body_json = excluded.body_json,
                style_json = excluded.style_json,
                sync_json = excluded.sync_json,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&annotation.id)
        .bind(&annotation.book_id)
        .bind(&annotation.user_id)
        .bind(annotation_type)
        .bind(&annotation.target.source)
        .bind(annotation.cfi())
        .bind(annotation.text_quote())
        .bind(annotation.progression())
        .bind(&selectors_json)
        .bind(&body_json)
        .bind(&style_json)
        .bind(&sync_json)
        .bind(annotation.created_at.to_rfc3339())
        .bind(annotation.updated_at.to_rfc3339())
        .execute(self.pool)
        .await?;

        Ok(())
    }

    /// Get an annotation by ID
    pub async fn get(&self, id: &str) -> Result<Option<Annotation>> {
        let row = sqlx::query_as::<_, AnnotationRow>(
            r#"
            SELECT id, book_id, user_id, annotation_type, source,
                   selectors_json, body_json, style_json, sync_json,
                   created_at, updated_at
            FROM annotations
            WHERE id = ?
            "#,
        )
        .bind(id)
        .fetch_optional(self.pool)
        .await?;

        row.map(|r| r.into_annotation()).transpose()
    }

    /// List annotations with optional filters
    pub async fn list(&self, query: &AnnotationQuery) -> Result<Vec<Annotation>> {
        let mut sql = String::from(
            r#"
            SELECT id, book_id, user_id, annotation_type, source,
                   selectors_json, body_json, style_json, sync_json,
                   created_at, updated_at
            FROM annotations
            WHERE 1=1
            "#,
        );

        let mut conditions = Vec::new();

        if query.book_id.is_some() {
            conditions.push("book_id = ?");
        }
        if query.user_id.is_some() {
            conditions.push("user_id = ?");
        }
        if query.annotation_type.is_some() {
            conditions.push("annotation_type = ?");
        }
        if query.chapter_href.is_some() {
            conditions.push("source = ?");
        }

        for cond in conditions {
            sql.push_str(" AND ");
            sql.push_str(cond);
        }

        sql.push_str(" ORDER BY created_at DESC");

        if let Some(limit) = query.limit {
            sql.push_str(&format!(" LIMIT {}", limit));
        }
        if let Some(offset) = query.offset {
            sql.push_str(&format!(" OFFSET {}", offset));
        }

        let mut q = sqlx::query_as::<_, AnnotationRow>(&sql);

        if let Some(ref book_id) = query.book_id {
            q = q.bind(book_id);
        }
        if let Some(ref user_id) = query.user_id {
            q = q.bind(user_id);
        }
        if let Some(ref ann_type) = query.annotation_type {
            let type_str = match ann_type {
                AnnotationType::Highlight => "highlight",
                AnnotationType::Bookmark => "bookmark",
                AnnotationType::Note => "note",
                AnnotationType::Underline => "underline",
            };
            q = q.bind(type_str);
        }
        if let Some(ref chapter) = query.chapter_href {
            q = q.bind(chapter);
        }

        let rows = q.fetch_all(self.pool).await?;

        rows.into_iter().map(|r| r.into_annotation()).collect()
    }

    /// Delete an annotation
    pub async fn delete(&self, id: &str) -> Result<bool> {
        let result = sqlx::query("DELETE FROM annotations WHERE id = ?")
            .bind(id)
            .execute(self.pool)
            .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Delete all annotations for a book
    pub async fn delete_for_book(&self, book_id: &str) -> Result<u64> {
        let result = sqlx::query("DELETE FROM annotations WHERE book_id = ?")
            .bind(book_id)
            .execute(self.pool)
            .await?;

        Ok(result.rows_affected())
    }

    /// Count annotations for a book
    pub async fn count_for_book(&self, book_id: &str) -> Result<i64> {
        let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM annotations WHERE book_id = ?")
            .bind(book_id)
            .fetch_one(self.pool)
            .await?;

        Ok(row.0)
    }

    /// Get annotations modified after a timestamp (for sync)
    pub async fn get_modified_since(
        &self,
        book_id: &str,
        since: DateTime<Utc>,
    ) -> Result<Vec<Annotation>> {
        let rows = sqlx::query_as::<_, AnnotationRow>(
            r#"
            SELECT id, book_id, user_id, annotation_type, source,
                   selectors_json, body_json, style_json, sync_json,
                   created_at, updated_at
            FROM annotations
            WHERE book_id = ? AND updated_at > ?
            ORDER BY updated_at ASC
            "#,
        )
        .bind(book_id)
        .bind(since.to_rfc3339())
        .fetch_all(self.pool)
        .await?;

        rows.into_iter().map(|r| r.into_annotation()).collect()
    }
}

/// Internal row type for SQLite queries
#[derive(sqlx::FromRow)]
struct AnnotationRow {
    id: String,
    book_id: String,
    user_id: Option<String>,
    annotation_type: String,
    source: String,
    selectors_json: String,
    body_json: Option<String>,
    style_json: Option<String>,
    sync_json: Option<String>,
    created_at: String,
    updated_at: String,
}

impl AnnotationRow {
    fn into_annotation(self) -> Result<Annotation> {
        use super::types::{AnnotationBody, AnnotationStyle, AnnotationTarget, Selector, SyncMetadata};

        let annotation_type = match self.annotation_type.as_str() {
            "highlight" => AnnotationType::Highlight,
            "bookmark" => AnnotationType::Bookmark,
            "note" => AnnotationType::Note,
            "underline" => AnnotationType::Underline,
            _ => AnnotationType::Highlight,
        };

        let selectors: Vec<Selector> = serde_json::from_str(&self.selectors_json)?;
        let body: Option<AnnotationBody> = self
            .body_json
            .as_ref()
            .map(|s| serde_json::from_str(s))
            .transpose()?;
        let style: Option<AnnotationStyle> = self
            .style_json
            .as_ref()
            .map(|s| serde_json::from_str(s))
            .transpose()?;
        let sync: Option<SyncMetadata> = self
            .sync_json
            .as_ref()
            .map(|s| serde_json::from_str(s))
            .transpose()?;

        let created_at = DateTime::parse_from_rfc3339(&self.created_at)?.with_timezone(&Utc);
        let updated_at = DateTime::parse_from_rfc3339(&self.updated_at)?.with_timezone(&Utc);

        Ok(Annotation {
            id: self.id,
            book_id: self.book_id,
            user_id: self.user_id,
            annotation_type,
            target: AnnotationTarget {
                source: self.source,
                selectors,
            },
            body,
            style,
            sync,
            created_at,
            updated_at,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::annotations::types::AnnotationTarget;

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        let repo = AnnotationRepository::new(&pool);
        repo.init().await.unwrap();
        pool
    }

    #[tokio::test]
    async fn test_save_and_get() {
        let pool = setup_test_db().await;
        let repo = AnnotationRepository::new(&pool);

        let target = AnnotationTarget::from_cfi("chapter1.xhtml", "epubcfi(/6/4!/4/2)");
        let annotation = Annotation::new_highlight("book-123", target);
        let id = annotation.id.clone();

        repo.save(&annotation).await.unwrap();

        let loaded = repo.get(&id).await.unwrap().unwrap();
        assert_eq!(loaded.book_id, "book-123");
        assert_eq!(loaded.annotation_type, AnnotationType::Highlight);
    }

    #[tokio::test]
    async fn test_list_by_book() {
        let pool = setup_test_db().await;
        let repo = AnnotationRepository::new(&pool);

        // Create annotations for different books
        for i in 0..3 {
            let target = AnnotationTarget::from_cfi("chapter1.xhtml", "epubcfi(/6/4!/4/2)");
            let annotation = Annotation::new_highlight("book-a", target);
            repo.save(&annotation).await.unwrap();
        }

        let target = AnnotationTarget::from_cfi("chapter1.xhtml", "epubcfi(/6/4!/4/2)");
        let annotation = Annotation::new_highlight("book-b", target);
        repo.save(&annotation).await.unwrap();

        let query = AnnotationQuery {
            book_id: Some("book-a".to_string()),
            ..Default::default()
        };

        let results = repo.list(&query).await.unwrap();
        assert_eq!(results.len(), 3);
    }

    #[tokio::test]
    async fn test_delete() {
        let pool = setup_test_db().await;
        let repo = AnnotationRepository::new(&pool);

        let target = AnnotationTarget::from_cfi("chapter1.xhtml", "epubcfi(/6/4!/4/2)");
        let annotation = Annotation::new_highlight("book-123", target);
        let id = annotation.id.clone();

        repo.save(&annotation).await.unwrap();
        assert!(repo.get(&id).await.unwrap().is_some());

        repo.delete(&id).await.unwrap();
        assert!(repo.get(&id).await.unwrap().is_none());
    }
}
