mod api;
mod fs;
mod mcp;
mod media;
mod server;
mod store;
mod tasks;

pub use api::{
    DirectoryEntry, DirectoryEntryKind, FileContentRange, FileContentRangeRequest,
    FileContentRequest, FileContentResponse, ListDirectoryRequest, ListDirectoryResponse,
    ListingEntryFilter, ListingOrder, ListingQuery, ListingSortDirection, ListingSortKey,
    RootRelativePath, RootTrashEntry, RootTrashFailureReason, RootTrashListRequest,
    RootTrashListResponse, RootTrashMutationItem, RootTrashMutationResponse, RootTrashRequest,
    RuntimeError, TextPreviewRequest, TextPreviewResponse, TextPreviewStatus,
};
pub use server::{serve_http, serve_one_http_request};

#[derive(Debug, Default)]
pub struct FauplayRuntime;

impl FauplayRuntime {
    pub fn new() -> Self {
        Self
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
