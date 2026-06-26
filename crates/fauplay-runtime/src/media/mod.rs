//! Media-derived runtime capabilities, such as thumbnails and previews.

use std::fs;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

use image::ImageReader;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::{FilterType, crop_imm, resize};

use crate::{
    FaceBoundingBox, FaceCropResponse, FaceMediaType, FileContentRange, FileContentRequest,
    FileContentResponse, RuntimeError, TextPreviewRequest, TextPreviewResponse, TextPreviewStatus,
    store::FaceCropSource,
};

const FACE_CROP_CONTENT_TYPE: &str = "image/jpeg";

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

pub(crate) fn read_face_crop(
    source: FaceCropSource,
    size: u32,
    padding: f64,
) -> Result<FaceCropResponse, RuntimeError> {
    if source.media_type == FaceMediaType::Video {
        return Err(RuntimeError::runtime_capability(format!(
            "video Face Crop is not supported yet{}",
            source
                .frame_ts_ms
                .map(|frame_ts_ms| format!(" at {frame_ts_ms}ms"))
                .unwrap_or_default()
        )));
    }

    let image = ImageReader::open(&source.absolute_path)
        .map_err(|source_error| RuntimeError::read_file(&source.absolute_path, source_error))?
        .with_guessed_format()
        .map_err(|source_error| RuntimeError::read_file(&source.absolute_path, source_error))?
        .decode()
        .map_err(|source_error| {
            RuntimeError::runtime_capability(format!(
                "failed to decode Face Crop source {}: {source_error}",
                source.absolute_path.display()
            ))
        })?
        .to_rgb8();
    let (image_width, image_height) = image.dimensions();
    let bounds = square_crop_bounds(
        image_width,
        image_height,
        source.bounding_box,
        padding.max(0.0),
    );
    let cropped = crop_imm(&image, bounds.left, bounds.top, bounds.width, bounds.height).to_image();
    let size = size.clamp(1, 1024);
    let resized = resize(&cropped, size, size, FilterType::Lanczos3);

    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 90)
        .encode_image(&resized)
        .map_err(|source_error| {
            RuntimeError::runtime_capability(format!("failed to encode Face Crop: {source_error}"))
        })?;

    Ok(FaceCropResponse {
        content_type: FACE_CROP_CONTENT_TYPE.to_owned(),
        bytes,
    })
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

#[derive(Debug, Clone, Copy)]
struct CropBounds {
    left: u32,
    top: u32,
    width: u32,
    height: u32,
}

fn square_crop_bounds(
    image_width: u32,
    image_height: u32,
    bounding_box: FaceBoundingBox,
    padding: f64,
) -> CropBounds {
    let image_width_f = f64::from(image_width.max(1));
    let image_height_f = f64::from(image_height.max(1));
    let (x1, y1, x2, y2) = face_crop_pixels(bounding_box, image_width_f, image_height_f);
    let box_width = (x2 - x1).max(1.0);
    let box_height = (y2 - y1).max(1.0);
    let center_x = (x1 + x2) / 2.0;
    let center_y = (y1 + y2) / 2.0;
    let side = (box_width.max(box_height) * (1.0 + padding * 2.0))
        .min(image_width_f.max(image_height_f))
        .max(1.0);
    let half = side / 2.0;

    let mut left = center_x - half;
    let mut top = center_y - half;
    let mut right = center_x + half;
    let mut bottom = center_y + half;

    if left < 0.0 {
        right -= left;
        left = 0.0;
    }
    if top < 0.0 {
        bottom -= top;
        top = 0.0;
    }
    if right > image_width_f {
        left -= right - image_width_f;
        right = image_width_f;
    }
    if bottom > image_height_f {
        top -= bottom - image_height_f;
        bottom = image_height_f;
    }

    let left = left.clamp(0.0, image_width_f - 1.0).floor() as u32;
    let top = top.clamp(0.0, image_height_f - 1.0).floor() as u32;
    let right = right.clamp(f64::from(left + 1), image_width_f).ceil() as u32;
    let bottom = bottom.clamp(f64::from(top + 1), image_height_f).ceil() as u32;

    CropBounds {
        left,
        top,
        width: right.saturating_sub(left).max(1),
        height: bottom.saturating_sub(top).max(1),
    }
}

fn face_crop_pixels(
    bounding_box: FaceBoundingBox,
    image_width: f64,
    image_height: f64,
) -> (f64, f64, f64, f64) {
    if bounding_box.x1 >= 0.0
        && bounding_box.y1 >= 0.0
        && bounding_box.x2 <= 1.0
        && bounding_box.y2 <= 1.0
    {
        return (
            bounding_box.x1 * image_width,
            bounding_box.y1 * image_height,
            bounding_box.x2 * image_width,
            bounding_box.y2 * image_height,
        );
    }

    (
        bounding_box.x1,
        bounding_box.y1,
        bounding_box.x2,
        bounding_box.y2,
    )
}
