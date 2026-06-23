//! Media-derived runtime capabilities, such as thumbnails and previews.

use std::fs;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

use crate::{
    FileContentRange, FileContentRequest, FileContentResponse, RuntimeError, TextPreviewRequest,
    TextPreviewResponse, TextPreviewStatus,
};

pub(crate) fn read_file_content(
    request: FileContentRequest,
) -> Result<FileContentResponse, RuntimeError> {
    let file_path = request.root_path.join(request.root_relative_path.as_path());
    read_file_content_at_path(file_path, request.range)
}

pub(crate) fn read_file_content_at_path(
    file_path: std::path::PathBuf,
    range: Option<crate::FileContentRangeRequest>,
) -> Result<FileContentResponse, RuntimeError> {
    let mut file =
        fs::File::open(&file_path).map_err(|source| RuntimeError::read_file(&file_path, source))?;
    let total_size = file
        .metadata()
        .map_err(|source| RuntimeError::read_file(&file_path, source))?
        .len();
    let range = range.and_then(|range_request| range_request.resolve(total_size));
    let bytes = match range {
        Some(range) => read_file_content_range(&file_path, &mut file, range)?,
        None => {
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)
                .map_err(|source| RuntimeError::read_file(&file_path, source))?;
            bytes
        }
    };

    Ok(FileContentResponse {
        content_type: infer_content_type(&file_path).to_owned(),
        bytes,
        total_size,
        range,
    })
}

fn read_file_content_range(
    file_path: &Path,
    file: &mut fs::File,
    range: FileContentRange,
) -> Result<Vec<u8>, RuntimeError> {
    let byte_count = range.end_inclusive - range.start + 1;
    let byte_count = usize::try_from(byte_count).map_err(|_| {
        RuntimeError::read_file(
            file_path,
            io::Error::new(
                io::ErrorKind::InvalidData,
                "File Content Range is too large",
            ),
        )
    })?;
    let mut bytes = vec![0; byte_count];

    file.seek(SeekFrom::Start(range.start))
        .map_err(|source| RuntimeError::read_file(file_path, source))?;
    file.read_exact(&mut bytes)
        .map_err(|source| RuntimeError::read_file(file_path, source))?;

    Ok(bytes)
}

pub(crate) fn read_text_preview(
    request: TextPreviewRequest,
) -> Result<TextPreviewResponse, RuntimeError> {
    let file_path = request.root_path.join(request.root_relative_path.as_path());
    read_text_preview_at_path(file_path, request.size_limit_bytes)
}

pub(crate) fn read_text_preview_at_path(
    file_path: std::path::PathBuf,
    size_limit_bytes: u64,
) -> Result<TextPreviewResponse, RuntimeError> {
    let metadata =
        fs::metadata(&file_path).map_err(|source| RuntimeError::read_file(&file_path, source))?;
    let file_size_bytes = metadata.len();

    if file_size_bytes > size_limit_bytes {
        return Ok(TextPreviewResponse {
            status: TextPreviewStatus::TooLarge,
            content: None,
            file_size_bytes,
            size_limit_bytes,
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
            size_limit_bytes,
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
                size_limit_bytes,
                error: None,
            });
        }
    };

    Ok(TextPreviewResponse {
        status: TextPreviewStatus::Ready,
        content: Some(content),
        file_size_bytes,
        size_limit_bytes,
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
