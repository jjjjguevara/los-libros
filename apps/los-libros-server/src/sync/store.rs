//! Sync state persistence
//!
//! SQLite storage for sync operations and version tracking.

use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use super::types::{EntityType, OperationType, SyncOperation, SyncStatus};

/// Repository for sync state persistence
pub struct SyncRepository<'a> {
    pool: &'a SqlitePool,
}

impl<'a> SyncRepository<'a> {
    pub fn new(pool: &'a SqlitePool) -> Self {
        Self { pool }
    }

    /// Initialize sync tables
    pub async fn init(&self) -> Result<()> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS sync_operations (
                id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL,
                operation_type TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                payload TEXT,
                base_version INTEGER NOT NULL,
                device_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                applied INTEGER DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_sync_book ON sync_operations(book_id);
            CREATE INDEX IF NOT EXISTS idx_sync_timestamp ON sync_operations(timestamp);
            CREATE INDEX IF NOT EXISTS idx_sync_entity ON sync_operations(entity_type, entity_id);

            CREATE TABLE IF NOT EXISTS sync_versions (
                book_id TEXT PRIMARY KEY,
                current_version INTEGER NOT NULL DEFAULT 0,
                last_sync TEXT,
                device_id TEXT
            );
            "#,
        )
        .execute(self.pool)
        .await?;

        Ok(())
    }

    /// Record a sync operation
    pub async fn record_operation(&self, book_id: &str, op: &SyncOperation) -> Result<()> {
        let payload = op
            .payload
            .as_ref()
            .map(|p| serde_json::to_string(p))
            .transpose()?;

        sqlx::query(
            r#"
            INSERT INTO sync_operations (
                id, book_id, operation_type, entity_type, entity_id,
                payload, base_version, device_id, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&op.id)
        .bind(book_id)
        .bind(format!("{:?}", op.operation_type).to_lowercase())
        .bind(format!("{:?}", op.entity_type).to_lowercase())
        .bind(&op.entity_id)
        .bind(&payload)
        .bind(op.base_version as i64)
        .bind(&op.device_id)
        .bind(op.timestamp.to_rfc3339())
        .execute(self.pool)
        .await?;

        Ok(())
    }

    /// Get operations since a version for a book
    pub async fn get_operations_since(
        &self,
        book_id: &str,
        since_version: u64,
        limit: Option<i32>,
    ) -> Result<Vec<SyncOperation>> {
        let limit = limit.unwrap_or(100);

        let rows = sqlx::query_as::<_, OperationRow>(
            r#"
            SELECT id, operation_type, entity_type, entity_id,
                   payload, base_version, device_id, timestamp
            FROM sync_operations
            WHERE book_id = ? AND base_version > ?
            ORDER BY base_version ASC
            LIMIT ?
            "#,
        )
        .bind(book_id)
        .bind(since_version as i64)
        .bind(limit)
        .fetch_all(self.pool)
        .await?;

        rows.into_iter().map(|r| r.into_operation()).collect()
    }

    /// Get current version for a book
    pub async fn get_version(&self, book_id: &str) -> Result<u64> {
        let row: Option<(i64,)> =
            sqlx::query_as("SELECT current_version FROM sync_versions WHERE book_id = ?")
                .bind(book_id)
                .fetch_optional(self.pool)
                .await?;

        Ok(row.map(|(v,)| v as u64).unwrap_or(0))
    }

    /// Increment and get new version for a book
    pub async fn increment_version(&self, book_id: &str, device_id: &str) -> Result<u64> {
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            r#"
            INSERT INTO sync_versions (book_id, current_version, last_sync, device_id)
            VALUES (?, 1, ?, ?)
            ON CONFLICT(book_id) DO UPDATE SET
                current_version = current_version + 1,
                last_sync = excluded.last_sync,
                device_id = excluded.device_id
            "#,
        )
        .bind(book_id)
        .bind(&now)
        .bind(device_id)
        .execute(self.pool)
        .await?;

        self.get_version(book_id).await
    }

    /// Get sync status for a book
    pub async fn get_status(&self, book_id: &str) -> Result<SyncStatus> {
        let row: Option<SyncVersionRow> = sqlx::query_as(
            r#"
            SELECT current_version, last_sync, device_id
            FROM sync_versions
            WHERE book_id = ?
            "#,
        )
        .bind(book_id)
        .fetch_optional(self.pool)
        .await?;

        let pending: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM sync_operations WHERE book_id = ? AND applied = 0",
        )
        .bind(book_id)
        .fetch_one(self.pool)
        .await?;

        Ok(match row {
            Some(r) => SyncStatus {
                last_sync: r.last_sync.and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
                    .map(|dt| dt.with_timezone(&Utc)),
                version: r.current_version as u64,
                pending_changes: pending.0 as usize,
                in_progress: false,
                error: None,
            },
            None => SyncStatus {
                pending_changes: pending.0 as usize,
                ..Default::default()
            },
        })
    }

    /// Mark operations as applied
    pub async fn mark_applied(&self, operation_ids: &[String]) -> Result<()> {
        if operation_ids.is_empty() {
            return Ok(());
        }

        let placeholders: Vec<&str> = operation_ids.iter().map(|_| "?").collect();
        let query = format!(
            "UPDATE sync_operations SET applied = 1 WHERE id IN ({})",
            placeholders.join(", ")
        );

        let mut q = sqlx::query(&query);
        for id in operation_ids {
            q = q.bind(id);
        }

        q.execute(self.pool).await?;
        Ok(())
    }

    /// Clean up old operations
    pub async fn cleanup_old_operations(&self, older_than: DateTime<Utc>) -> Result<u64> {
        let result = sqlx::query(
            "DELETE FROM sync_operations WHERE applied = 1 AND timestamp < ?",
        )
        .bind(older_than.to_rfc3339())
        .execute(self.pool)
        .await?;

        Ok(result.rows_affected())
    }
}

#[derive(sqlx::FromRow)]
struct OperationRow {
    id: String,
    operation_type: String,
    entity_type: String,
    entity_id: String,
    payload: Option<String>,
    base_version: i64,
    device_id: String,
    timestamp: String,
}

impl OperationRow {
    fn into_operation(self) -> Result<SyncOperation> {
        let operation_type = match self.operation_type.as_str() {
            "create" => OperationType::Create,
            "update" => OperationType::Update,
            "delete" => OperationType::Delete,
            _ => OperationType::Update,
        };

        let entity_type = match self.entity_type.as_str() {
            "annotation" => EntityType::Annotation,
            "progress" => EntityType::Progress,
            "bookmark" => EntityType::Bookmark,
            _ => EntityType::Annotation,
        };

        let payload = self
            .payload
            .as_ref()
            .map(|s| serde_json::from_str(s))
            .transpose()?;

        let timestamp = DateTime::parse_from_rfc3339(&self.timestamp)?.with_timezone(&Utc);

        Ok(SyncOperation {
            id: self.id,
            operation_type,
            entity_type,
            entity_id: self.entity_id,
            payload,
            base_version: self.base_version as u64,
            device_id: self.device_id,
            timestamp,
        })
    }
}

#[derive(sqlx::FromRow)]
struct SyncVersionRow {
    current_version: i64,
    last_sync: Option<String>,
    device_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        let repo = SyncRepository::new(&pool);
        repo.init().await.unwrap();
        pool
    }

    #[tokio::test]
    async fn test_version_tracking() {
        let pool = setup_test_db().await;
        let repo = SyncRepository::new(&pool);

        assert_eq!(repo.get_version("book-1").await.unwrap(), 0);

        let v1 = repo.increment_version("book-1", "device-1").await.unwrap();
        assert_eq!(v1, 1);

        let v2 = repo.increment_version("book-1", "device-2").await.unwrap();
        assert_eq!(v2, 2);
    }

    #[tokio::test]
    async fn test_record_and_get_operations() {
        let pool = setup_test_db().await;
        let repo = SyncRepository::new(&pool);

        let op = SyncOperation {
            id: "op-1".to_string(),
            operation_type: OperationType::Create,
            entity_type: EntityType::Annotation,
            entity_id: "ann-1".to_string(),
            payload: Some(serde_json::json!({"color": "red"})),
            base_version: 1,
            device_id: "device-1".to_string(),
            timestamp: Utc::now(),
        };

        repo.record_operation("book-1", &op).await.unwrap();

        let ops = repo.get_operations_since("book-1", 0, None).await.unwrap();
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].entity_id, "ann-1");
    }

    #[tokio::test]
    async fn test_sync_status() {
        let pool = setup_test_db().await;
        let repo = SyncRepository::new(&pool);

        let status = repo.get_status("book-1").await.unwrap();
        assert_eq!(status.version, 0);
        assert!(status.last_sync.is_none());

        repo.increment_version("book-1", "device-1").await.unwrap();

        let status = repo.get_status("book-1").await.unwrap();
        assert_eq!(status.version, 1);
        assert!(status.last_sync.is_some());
    }
}
