mod api;
mod fs;
mod mcp;
mod media;
mod server;
mod store;
mod tasks;

pub use api::{
    DirectoryEntry, DirectoryEntryKind, DuplicateFile, DuplicateFilesRequest,
    DuplicateFilesResponse, DuplicateSeedSkip, DuplicateSeedSkipReason, DuplicateSet,
    FileContentRange, FileContentRangeRequest, FileContentRequest, FileContentResponse,
    FileMetadataRequest, FileMetadataResponse, GlobalShortcutConfigResponse, GlobalTrashEntry,
    GlobalTrashFailureReason, GlobalTrashListRequest, GlobalTrashListResponse, GlobalTrashMoveItem,
    GlobalTrashMoveRequest, GlobalTrashMoveResponse, GlobalTrashRestoreItem,
    GlobalTrashRestoreRequest, GlobalTrashRestoreResponse, ListDirectoryRequest,
    ListDirectoryResponse, ListingEntryFilter, ListingOrder, ListingQuery, ListingSortDirection,
    ListingSortKey, RootMoveBatchFailureReason, RootMoveBatchItem, RootMoveBatchRequest,
    RootMoveBatchResponse, RootMoveFailureReason, RootMoveRequest, RootMoveResponse, RootMoveRule,
    RootMoveSearchMode, RootRelativePath, RootTrashEntry, RootTrashFailureReason,
    RootTrashListRequest, RootTrashListResponse, RootTrashMutationItem, RootTrashMutationResponse,
    RootTrashRequest, RuntimeError, TextPreviewRequest, TextPreviewResponse, TextPreviewStatus,
};
pub use server::{serve_http, serve_one_http_request};
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct FauplayRuntime {
    runtime_home_path: PathBuf,
}

impl FauplayRuntime {
    pub fn new() -> Self {
        Self::with_runtime_home_path(store::resolve_default_runtime_home_path())
    }

    pub fn with_runtime_home_path(runtime_home_path: impl Into<PathBuf>) -> Self {
        Self {
            runtime_home_path: runtime_home_path.into(),
        }
    }

    pub fn runtime_home_path(&self) -> &std::path::Path {
        &self.runtime_home_path
    }

    pub fn load_global_shortcut_config(
        &self,
    ) -> Result<GlobalShortcutConfigResponse, RuntimeError> {
        store::load_global_shortcut_config(&self.runtime_home_path)
    }

    pub fn list_global_trash(
        &self,
        request: GlobalTrashListRequest,
    ) -> Result<GlobalTrashListResponse, RuntimeError> {
        store::list_global_trash(&self.runtime_home_path, request)
    }

    pub fn move_to_global_trash(
        &self,
        request: GlobalTrashMoveRequest,
    ) -> Result<GlobalTrashMoveResponse, RuntimeError> {
        store::move_to_global_trash(&self.runtime_home_path, request)
    }

    pub fn restore_global_trash(
        &self,
        request: GlobalTrashRestoreRequest,
    ) -> Result<GlobalTrashRestoreResponse, RuntimeError> {
        store::restore_global_trash(&self.runtime_home_path, request)
    }

    pub fn list_local_directory(
        &self,
        request: ListDirectoryRequest,
    ) -> Result<ListDirectoryResponse, RuntimeError> {
        fs::list_local_directory(request)
    }

    pub fn read_text_preview(
        &self,
        request: TextPreviewRequest,
    ) -> Result<TextPreviewResponse, RuntimeError> {
        media::read_text_preview(request)
    }

    pub fn read_file_content(
        &self,
        request: FileContentRequest,
    ) -> Result<FileContentResponse, RuntimeError> {
        media::read_file_content(request)
    }

    pub fn read_file_metadata(
        &self,
        request: FileMetadataRequest,
    ) -> Result<FileMetadataResponse, RuntimeError> {
        fs::read_file_metadata(request)
    }

    pub fn find_duplicate_files(
        &self,
        request: DuplicateFilesRequest,
    ) -> Result<DuplicateFilesResponse, RuntimeError> {
        fs::find_duplicate_files(request)
    }

    pub fn move_root_path(
        &self,
        request: RootMoveRequest,
    ) -> Result<RootMoveResponse, RuntimeError> {
        fs::move_root_path(request)
    }

    pub fn move_root_path_batch(
        &self,
        request: RootMoveBatchRequest,
    ) -> Result<RootMoveBatchResponse, RuntimeError> {
        fs::move_root_path_batch(request)
    }

    pub fn move_to_root_trash(
        &self,
        request: RootTrashRequest,
    ) -> Result<RootTrashMutationResponse, RuntimeError> {
        fs::move_to_root_trash(request)
    }

    pub fn restore_from_root_trash(
        &self,
        request: RootTrashRequest,
    ) -> Result<RootTrashMutationResponse, RuntimeError> {
        fs::restore_from_root_trash(request)
    }

    pub fn list_root_trash(
        &self,
        request: RootTrashListRequest,
    ) -> Result<RootTrashListResponse, RuntimeError> {
        fs::list_root_trash(request)
    }
}

impl Default for FauplayRuntime {
    fn default() -> Self {
        Self::new()
    }
}
