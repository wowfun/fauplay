mod api;
mod fs;
mod mcp;
mod media;
mod server;
mod store;
mod tasks;

pub use api::{
    DirectoryEntry, DirectoryEntryKind, ListDirectoryRequest, ListDirectoryResponse,
    RootRelativePath, RuntimeError, TextPreviewRequest, TextPreviewResponse, TextPreviewStatus,
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
}
