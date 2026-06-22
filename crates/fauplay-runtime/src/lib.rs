mod api;
mod fs;
mod server;

pub use api::{
    DirectoryEntry, DirectoryEntryKind, ListDirectoryRequest, ListDirectoryResponse,
    RootRelativePath, RuntimeError,
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
}
