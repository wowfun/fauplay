use std::fs;
use std::path::Path;

use crate::{FileMetadataRequest, FileMetadataResponse, RuntimeError};

use super::modified_timestamp_ms;

pub(crate) fn read_file_metadata(
    request: FileMetadataRequest,
) -> Result<FileMetadataResponse, RuntimeError> {
    let file_path = request.root_path.join(request.root_relative_path.as_path());
    let metadata = read_file_metadata_at_path(&file_path)?;

    Ok(FileMetadataResponse {
        root_relative_path: request.root_relative_path,
        size: metadata.size,
        last_modified_ms: metadata.last_modified_ms,
    })
}

pub(crate) fn read_file_metadata_at_path(path: &Path) -> Result<FileMetadata, RuntimeError> {
    let metadata = fs::metadata(path).map_err(|source| RuntimeError::read_file(path, source))?;

    Ok(FileMetadata {
        size: metadata.len(),
        last_modified_ms: modified_timestamp_ms(&metadata),
    })
}

pub(crate) struct FileMetadata {
    pub(crate) size: u64,
    pub(crate) last_modified_ms: Option<u64>,
}
