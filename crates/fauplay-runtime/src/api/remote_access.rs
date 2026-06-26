use super::{
    DirectoryEntryKind, FileAnnotationMatchMode, FileContentResponse, ListingQuery,
    RootRelativePath, TextPreviewResponse,
};

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFileContentRequest {
    pub root_id: String,
    pub path: RootRelativePath,
    pub range_header: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteFileContentResponse {
    Content {
        content: FileContentResponse,
        last_modified_ms: Option<u64>,
    },
    RangeNotSatisfiable {
        total_size: u64,
        last_modified_ms: Option<u64>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteTextPreviewRequest {
    pub root_id: String,
    pub path: RootRelativePath,
    pub size_limit_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteTextPreviewResponse {
    pub preview: TextPreviewResponse,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFileThumbnailRequest {
    pub root_id: String,
    pub path: RootRelativePath,
    pub size_preset: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFileThumbnailResponse {
    pub content: FileContentResponse,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RemoteFaceCropRequest {
    pub root_id: String,
    pub face_id: String,
    pub size: u32,
    pub padding: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFaceListPeopleRequest {
    pub root_id: String,
    pub query: Option<String>,
    pub page: usize,
    pub size: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFaceListPersonFacesRequest {
    pub root_id: String,
    pub person_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteAnnotationTagOptionsRequest {
    pub root_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFileAnnotationQueryRequest {
    pub root_id: String,
    pub include_tag_keys: Vec<String>,
    pub exclude_tag_keys: Vec<String>,
    pub include_match_mode: FileAnnotationMatchMode,
    pub page: usize,
    pub size: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFileAnnotationReadRequest {
    pub root_id: String,
    pub path: RootRelativePath,
}
