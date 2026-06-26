use super::{DirectoryEntryKind, ListingQuery, RootRelativePath};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteRootEntry {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteRootsResponse {
    pub items: Vec<RemoteRootEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFileListRequest {
    pub root_id: String,
    pub path: RootRelativePath,
    pub flatten_view: bool,
    pub entry_limit: Option<usize>,
    pub entry_offset: usize,
    pub query: ListingQuery,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteListingEntry {
    pub name: String,
    pub path: RootRelativePath,
    pub kind: DirectoryEntryKind,
    pub is_empty: Option<bool>,
    pub entry_count: Option<usize>,
    pub size: Option<u64>,
    pub last_modified_ms: Option<u64>,
    pub mime_type: Option<String>,
    pub preview_kind: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFileListResponse {
    pub root_id: String,
    pub path: RootRelativePath,
    pub flatten_view: bool,
    pub items: Vec<RemoteListingEntry>,
    pub is_truncated: bool,
    pub next_offset: Option<usize>,
}
