//! Media-derived runtime capabilities, such as thumbnails and previews.

use std::fs;
use std::path::Path;

use crate::{
    FileContentRequest, FileContentResponse, RuntimeError, TextPreviewRequest, TextPreviewResponse,
    TextPreviewStatus,
};

pub(crate) fn read_file_content(
    request: FileContentRequest,
) -> Result<FileContentResponse, RuntimeError> {
    let file_path = request.root_path.join(request.root_relative_path.as_path());
    let bytes =
        fs::read(&file_path).map_err(|source| RuntimeError::read_file(&file_path, source))?;

    Ok(FileContentResponse {
        content_type: infer_content_type(request.root_relative_path.as_path()).to_owned(),
        bytes,
    })
}

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

fn infer_content_type(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match extension.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "ogg" => "video/ogg",
        "txt" => "text/plain; charset=utf-8",
        "md" | "markdown" => "text/markdown; charset=utf-8",
        "json" => "application/json",
        "csv" => "text/csv; charset=utf-8",
        "html" | "htm" => "text/html; charset=utf-8",
        "xml" => "application/xml",
        "css" => "text/css; charset=utf-8",
        "js" | "jsx" => "text/javascript; charset=utf-8",
        "ts" | "tsx" => "text/typescript; charset=utf-8",
        _ => "application/octet-stream",
    }
}
