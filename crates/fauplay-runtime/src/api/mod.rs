use std::fmt;
use std::io;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListDirectoryRequest {
    pub root_path: PathBuf,
    pub root_relative_path: RootRelativePath,
    pub flattened: bool,
    pub entry_limit: Option<usize>,
    pub entry_offset: usize,
    pub query: ListingQuery,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListDirectoryResponse {
    pub entries: Vec<DirectoryEntry>,
    pub is_truncated: bool,
    pub next_offset: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ListingQuery {
    pub name_contains: Option<String>,
    pub entry_filter: ListingEntryFilter,
    pub order: ListingOrder,
    pub hide_empty_folders: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ListingEntryFilter {
    #[default]
    All,
    Image,
    Video,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ListingOrder {
    pub sort_key: ListingSortKey,
    pub direction: ListingSortDirection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ListingSortKey {
    #[default]
    Name,
    Date,
    Size,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ListingSortDirection {
    #[default]
    Asc,
    Desc,
}

impl Default for ListingOrder {
    fn default() -> Self {
        Self {
            sort_key: ListingSortKey::Name,
            direction: ListingSortDirection::Asc,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextPreviewRequest {
    pub root_path: PathBuf,
    pub root_relative_path: RootRelativePath,
    pub size_limit_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileContentRequest {
    pub root_path: PathBuf,
    pub root_relative_path: RootRelativePath,
    pub range: Option<FileContentRangeRequest>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileContentResponse {
    pub content_type: String,
    pub bytes: Vec<u8>,
    pub total_size: u64,
    pub range: Option<FileContentRange>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileMetadataRequest {
    pub root_path: PathBuf,
    pub root_relative_path: RootRelativePath,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileMetadataResponse {
    pub root_relative_path: RootRelativePath,
    pub size: u64,
    pub last_modified_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalShortcutConfigResponse {
    pub loaded: bool,
    pub path: PathBuf,
    pub config_json: Option<String>,
}

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileContentRangeRequest {
    Exact { start: u64, end_inclusive: u64 },
    From { start: u64 },
    Suffix { length: u64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileContentRange {
    pub start: u64,
    pub end_inclusive: u64,
}

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootMoveFailureReason {
    InvalidSource,
    InvalidTarget,
    SourceNotFound,
    UnsupportedKind,
    TargetExists,
    MutationFailed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DuplicateFilesRequest {
    pub root_path: PathBuf,
    pub seed_root_relative_paths: Vec<RootRelativePath>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DuplicateFilesResponse {
    pub seed_count: usize,
    pub skipped_seeds: Vec<DuplicateSeedSkip>,
    pub duplicate_sets: Vec<DuplicateSet>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DuplicateSeedSkip {
    pub root_relative_path: RootRelativePath,
    pub reason: DuplicateSeedSkipReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DuplicateSeedSkipReason {
    SourceNotFound,
    NotFile,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DuplicateSet {
    pub set_id: String,
    pub seed_root_relative_paths: Vec<RootRelativePath>,
    pub files: Vec<DuplicateFile>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DuplicateFile {
    pub name: String,
    pub root_relative_path: RootRelativePath,
    pub absolute_path: PathBuf,
    pub size: u64,
    pub last_modified_ms: Option<u64>,
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
pub struct TextPreviewResponse {
    pub status: TextPreviewStatus,
    pub content: Option<String>,
    pub file_size_bytes: u64,
    pub size_limit_bytes: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextPreviewStatus {
    Ready,
    TooLarge,
    Binary,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectoryEntry {
    pub name: String,
    pub root_relative_path: RootRelativePath,
    pub kind: DirectoryEntryKind,
    pub is_empty: Option<bool>,
    pub entry_count: Option<usize>,
    pub size: Option<u64>,
    pub last_modified_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirectoryEntryKind {
    Directory,
    File,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RootRelativePath {
    path: PathBuf,
}

impl RootRelativePath {
    pub fn root() -> Self {
        Self {
            path: PathBuf::new(),
        }
    }

    pub fn as_path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn child(&self, name: &str) -> Self {
        let mut path = self.path.clone();
        path.push(name);
        Self { path }
    }
}

impl FileContentRangeRequest {
    pub(crate) fn resolve(self, total_size: u64) -> Option<FileContentRange> {
        if total_size == 0 {
            return None;
        }

        match self {
            Self::Exact {
                start,
                end_inclusive,
            } => {
                if start > end_inclusive || start >= total_size {
                    return None;
                }
                Some(FileContentRange {
                    start,
                    end_inclusive: end_inclusive.min(total_size - 1),
                })
            }
            Self::From { start } => {
                if start >= total_size {
                    return None;
                }
                Some(FileContentRange {
                    start,
                    end_inclusive: total_size - 1,
                })
            }
            Self::Suffix { length } => {
                if length == 0 {
                    return None;
                }
                let length = length.min(total_size);
                Some(FileContentRange {
                    start: total_size - length,
                    end_inclusive: total_size - 1,
                })
            }
        }
    }
}

impl TryFrom<PathBuf> for RootRelativePath {
    type Error = RuntimeError;

    fn try_from(path: PathBuf) -> Result<Self, Self::Error> {
        let mut normalized = PathBuf::new();

        for component in path.components() {
            match component {
                Component::Normal(part) => normalized.push(part),
                Component::CurDir => {}
                Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                    return Err(RuntimeError::invalid_root_relative_path(&path));
                }
            }
        }

        Ok(Self { path: normalized })
    }
}

impl TryFrom<&str> for RootRelativePath {
    type Error = RuntimeError;

    fn try_from(path: &str) -> Result<Self, Self::Error> {
        PathBuf::from(path).try_into()
    }
}

impl fmt::Display for RootRelativePath {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.path.display())
    }
}

#[derive(Debug)]
pub struct RuntimeError {
    message: String,
}

impl RuntimeError {
    pub(crate) fn read_directory(path: &Path, source: io::Error) -> Self {
        Self {
            message: format!("failed to read directory {}: {source}", path.display()),
        }
    }

    pub(crate) fn read_directory_entry(path: &Path, source: io::Error) -> Self {
        Self {
            message: format!(
                "failed to read directory entry {}: {source}",
                path.display()
            ),
        }
    }

    pub(crate) fn read_file(path: &Path, source: io::Error) -> Self {
        Self {
            message: format!("failed to read file {}: {source}", path.display()),
        }
    }

    pub(crate) fn write_file(path: &Path, source: io::Error) -> Self {
        Self {
            message: format!("failed to write file {}: {source}", path.display()),
        }
    }

    pub(crate) fn invalid_config(path: &Path, message: &str) -> Self {
        Self {
            message: format!(
                "invalid global shortcut config {}: {message}",
                path.display()
            ),
        }
    }

    pub(crate) fn invalid_runtime_home_file(path: &Path, message: &str) -> Self {
        Self {
            message: format!("invalid Runtime Home file {}: {message}", path.display()),
        }
    }

    pub(crate) fn network(message: &str, source: io::Error) -> Self {
        Self {
            message: format!("{message}: {source}"),
        }
    }

    fn invalid_root_relative_path(path: &Path) -> Self {
        Self {
            message: format!(
                "invalid Root-relative Path {}: path must stay within the Local Root",
                path.display()
            ),
        }
    }
}

impl fmt::Display for RuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for RuntimeError {}
