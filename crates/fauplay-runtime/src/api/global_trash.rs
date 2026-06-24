use std::path::PathBuf;

use super::FileContentRangeRequest;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalTrashListRequest {
    pub entry_limit: Option<usize>,
    pub entry_offset: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalTrashListResponse {
    pub entries: Vec<GlobalTrashEntry>,
    pub is_truncated: bool,
    pub next_offset: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalTrashMoveRequest {
    pub absolute_paths: Vec<PathBuf>,
    pub dry_run: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalTrashMoveResponse {
    pub dry_run: bool,
    pub total: usize,
    pub moved: usize,
    pub failed: usize,
    pub items: Vec<GlobalTrashMoveItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalTrashMoveItem {
    pub absolute_path: PathBuf,
    pub next_absolute_path: Option<PathBuf>,
    pub recycle_id: String,
    pub deleted_at_ms: Option<u64>,
    pub ok: bool,
    pub reason: Option<GlobalTrashFailureReason>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalTrashRestoreRequest {
    pub recycle_ids: Vec<String>,
    pub dry_run: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalTrashRestoreResponse {
    pub dry_run: bool,
    pub total: usize,
    pub restored: usize,
    pub failed: usize,
    pub items: Vec<GlobalTrashRestoreItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalTrashRestoreItem {
    pub recycle_id: String,
    pub absolute_path: PathBuf,
    pub original_absolute_path: PathBuf,
    pub next_absolute_path: Option<PathBuf>,
    pub ok: bool,
    pub reason: Option<GlobalTrashFailureReason>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GlobalTrashFailureReason {
    RecycleItemNotFound,
    SourceNotFound,
    UnsupportedKind,
    TargetExists,
    MutationFailed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalTrashEntry {
    pub name: String,
    pub absolute_path: PathBuf,
    pub original_absolute_path: PathBuf,
    pub recycle_id: String,
    pub size: u64,
    pub mime_type: String,
    pub preview_kind: String,
    pub display_path: String,
    pub last_modified_ms: Option<u64>,
    pub deleted_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalTrashFileContentRequest {
    pub recycle_id: String,
    pub range: Option<FileContentRangeRequest>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalTrashTextPreviewRequest {
    pub recycle_id: String,
    pub size_limit_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalTrashFileMetadataRequest {
    pub recycle_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalTrashFileMetadataResponse {
    pub recycle_id: String,
    pub size: u64,
    pub last_modified_ms: Option<u64>,
}
