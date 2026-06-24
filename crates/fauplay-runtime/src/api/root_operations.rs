use std::path::PathBuf;

use super::RootRelativePath;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RootTrashRequest {
    pub root_path: PathBuf,
    pub root_relative_paths: Vec<RootRelativePath>,
    pub dry_run: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RootTrashListRequest {
    pub root_path: PathBuf,
    pub entry_limit: Option<usize>,
    pub entry_offset: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RootTrashListResponse {
    pub entries: Vec<RootTrashEntry>,
    pub is_truncated: bool,
    pub next_offset: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RootTrashEntry {
    pub name: String,
    pub root_relative_path: RootRelativePath,
    pub original_root_relative_path: RootRelativePath,
    pub absolute_path: PathBuf,
    pub original_absolute_path: PathBuf,
    pub size: u64,
    pub last_modified_ms: Option<u64>,
    pub deleted_at_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RootTrashMutationResponse {
    pub dry_run: bool,
    pub total: usize,
    pub completed: usize,
    pub failed: usize,
    pub items: Vec<RootTrashMutationItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RootTrashMutationItem {
    pub root_relative_path: RootRelativePath,
    pub next_root_relative_path: Option<RootRelativePath>,
    pub absolute_path: PathBuf,
    pub next_absolute_path: Option<PathBuf>,
    pub ok: bool,
    pub reason: Option<RootTrashFailureReason>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootTrashFailureReason {
    InvalidSource,
    SourceNotFound,
    UnsupportedKind,
    TargetExists,
    MutationFailed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RootMoveRequest {
    pub root_path: PathBuf,
    pub source_root_relative_path: RootRelativePath,
    pub target_root_relative_path: RootRelativePath,
    pub dry_run: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RootMoveResponse {
    pub dry_run: bool,
    pub source_root_relative_path: RootRelativePath,
    pub target_root_relative_path: RootRelativePath,
    pub absolute_path: PathBuf,
    pub target_absolute_path: PathBuf,
    pub ok: bool,
    pub reason: Option<RootMoveFailureReason>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RootMoveBatchRequest {
    pub root_path: PathBuf,
    pub source_root_relative_paths: Vec<RootRelativePath>,
    pub rule: RootMoveRule,
    pub dry_run: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RootMoveRule {
    pub name_mask: String,
    pub find_text: String,
    pub replace_text: String,
    pub search_mode: RootMoveSearchMode,
    pub regex_flags: String,
    pub counter_start: i64,
    pub counter_step: i64,
    pub counter_pad: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootMoveSearchMode {
    Plain,
    Regex,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RootMoveBatchResponse {
    pub dry_run: bool,
    pub total: usize,
    pub moved: usize,
    pub skipped: usize,
    pub failed: usize,
    pub items: Vec<RootMoveBatchItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RootMoveBatchItem {
    pub root_relative_path: RootRelativePath,
    pub next_root_relative_path: Option<RootRelativePath>,
    pub absolute_path: PathBuf,
    pub next_absolute_path: Option<PathBuf>,
    pub ok: bool,
    pub skipped: bool,
    pub reason: Option<RootMoveBatchFailureReason>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootMoveBatchFailureReason {
    InvalidPath,
    InvalidRule,
    InvalidTarget,
    SourceNotFound,
    UnsupportedKind,
    TargetExists,
    NoChange,
    MutationFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootMoveFailureReason {
    InvalidSource,
    InvalidTarget,
    SourceNotFound,
    UnsupportedKind,
    TargetExists,
    MutationFailed,
}
