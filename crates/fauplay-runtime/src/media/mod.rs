//! Media-derived runtime capabilities, such as thumbnails and previews.

use std::fs;

use crate::{RuntimeError, TextPreviewRequest, TextPreviewResponse, TextPreviewStatus};

pub(crate) fn read_text_preview(
    request: TextPreviewRequest,
) -> Result<TextPreviewResponse, RuntimeError> {
    let file_path = request.root_path.join(request.root_relative_path.as_path());
    let metadata =
        fs::metadata(&file_path).map_err(|source| RuntimeError::read_file(&file_path, source))?;
    let file_size_bytes = metadata.len();

    if file_size_bytes > request.size_limit_bytes {
        return Ok(TextPreviewResponse {
            status: TextPreviewStatus::TooLarge,
            content: None,
            file_size_bytes,
            size_limit_bytes: request.size_limit_bytes,
            error: None,
        });
    }

    let bytes =
        fs::read(&file_path).map_err(|source| RuntimeError::read_file(&file_path, source))?;
    if bytes.contains(&0) {
        return Ok(TextPreviewResponse {
            status: TextPreviewStatus::Binary,
            content: None,
            file_size_bytes,
            size_limit_bytes: request.size_limit_bytes,
            error: None,
        });
    }

    let content = match String::from_utf8(bytes) {
        Ok(content) => content,
        Err(_) => {
            return Ok(TextPreviewResponse {
                status: TextPreviewStatus::Binary,
                content: None,
                file_size_bytes,
                size_limit_bytes: request.size_limit_bytes,
                error: None,
            });
        }
    };

    Ok(TextPreviewResponse {
        status: TextPreviewStatus::Ready,
        content: Some(content),
        file_size_bytes,
        size_limit_bytes: request.size_limit_bytes,
        error: None,
    })
}
