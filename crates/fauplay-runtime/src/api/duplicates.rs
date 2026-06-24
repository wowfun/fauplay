use std::path::PathBuf;

use super::RootRelativePath;

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
