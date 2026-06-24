use std::path::PathBuf;

use super::RootRelativePath;

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
