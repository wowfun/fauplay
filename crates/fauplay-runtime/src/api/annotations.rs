use std::path::PathBuf;

use super::RootRelativePath;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileAnnotationSetValueRequest {
    pub root_path: PathBuf,
    pub root_relative_path: RootRelativePath,
    pub key: String,
    pub value: String,
    pub source: FileAnnotationActionSource,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileAnnotationTagBindingRequest {
    pub root_path: PathBuf,
    pub root_relative_path: RootRelativePath,
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnnotationTagOptionsRequest {
    pub root_path: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnnotationTagOptionsResponse {
    pub items: Vec<AnnotationTagOption>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnnotationTagOption {
    pub tag_key: String,
    pub key: String,
    pub value: String,
    pub source: String,
    pub file_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileAnnotationQueryRequest {
    pub root_path: Option<PathBuf>,
    pub include_tag_keys: Vec<String>,
    pub exclude_tag_keys: Vec<String>,
    pub include_match_mode: FileAnnotationMatchMode,
    pub page: usize,
    pub size: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileAnnotationQueryResponse {
    pub page: usize,
    pub size: usize,
    pub total: usize,
    pub items: Vec<FileAnnotationFile>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileAnnotationMatchMode {
    Or,
    And,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileAnnotationPathRebindRequest {
    pub root_path: PathBuf,
    pub mappings: Vec<FileAnnotationPathMapping>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissingFileCleanupRequest {
    pub root_path: PathBuf,
    pub confirm: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissingFileCleanupResponse {
    pub dry_run: bool,
    pub missing_root_relative_paths: Vec<RootRelativePath>,
    pub missing_absolute_paths: Vec<PathBuf>,
    pub impact: MissingFileCleanupImpact,
    pub removed: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissingFileCleanupImpact {
    pub file_annotations: usize,
    pub annotation_tags: usize,
    pub file_index_entries: usize,
}

pub type FileAnnotationMissingCleanupRequest = MissingFileCleanupRequest;
pub type FileAnnotationMissingCleanupResponse = MissingFileCleanupResponse;
pub type FileAnnotationMissingCleanupImpact = MissingFileCleanupImpact;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileAnnotationPathMapping {
    pub from_root_relative_path: RootRelativePath,
    pub to_root_relative_path: RootRelativePath,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileAnnotationPathRebindResponse {
    pub total: usize,
    pub updated: usize,
    pub skipped: usize,
    pub failed: usize,
    pub items: Vec<FileAnnotationPathRebindItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileAnnotationPathRebindItem {
    pub from_root_relative_path: RootRelativePath,
    pub to_root_relative_path: RootRelativePath,
    pub ok: bool,
    pub skipped: bool,
    pub reason: Option<FileAnnotationPathRebindFailureReason>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileAnnotationPathRebindFailureReason {
    SourceNotFound,
    TargetNotFound,
    NoChange,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileAnnotationReadRequest {
    pub root_path: PathBuf,
    pub root_relative_path: RootRelativePath,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileAnnotationReadResponse {
    pub file: Option<FileAnnotationFile>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileAnnotationMutationResponse {
    pub root_relative_path: RootRelativePath,
    pub absolute_path: PathBuf,
    pub key: String,
    pub value: String,
    pub source: FileAnnotationActionSource,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileAnnotationTagMutationResponse {
    pub root_relative_path: RootRelativePath,
    pub absolute_path: PathBuf,
    pub key: String,
    pub value: String,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileAnnotationFile {
    pub root_relative_path: RootRelativePath,
    pub absolute_path: PathBuf,
    pub tags: Vec<AnnotationTag>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnnotationTag {
    pub key: String,
    pub value: String,
    pub source: String,
    pub applied_at_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileAnnotationActionSource {
    Click,
    Hotkey,
}
