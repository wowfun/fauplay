use std::path::PathBuf;

use super::RootRelativePath;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileIndexEnsureRequest {
    pub root_path: PathBuf,
    pub root_relative_paths: Vec<RootRelativePath>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileIndexEnsureResponse {
    pub total: usize,
    pub indexed: usize,
    pub skipped: usize,
    pub failed: usize,
    pub items: Vec<FileIndexEnsureItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileIndexEnsureItem {
    pub root_relative_path: RootRelativePath,
    pub absolute_path: Option<PathBuf>,
    pub size: Option<u64>,
    pub last_modified_ms: Option<u64>,
    pub ok: bool,
    pub skipped: bool,
    pub reason: Option<FileIndexFailureReason>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileIndexFailureReason {
    IndexFresh,
    SourceNotFound,
    NotFile,
    IndexFailed,
}
