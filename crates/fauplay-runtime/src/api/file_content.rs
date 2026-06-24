use std::path::PathBuf;

use super::RootRelativePath;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextPreviewRequest {
    pub root_path: PathBuf,
    pub root_relative_path: RootRelativePath,
    pub size_limit_bytes: u64,
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
