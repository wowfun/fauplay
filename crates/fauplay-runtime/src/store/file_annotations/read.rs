use std::path::Path;

use crate::{
    AnnotationTag, FileAnnotationFile, FileAnnotationReadRequest, FileAnnotationReadResponse,
    RuntimeError,
};

use super::super::file_annotation_records::{
    file_annotations_path, read_file_annotation_records, sort_annotation_tags,
};
use super::super::{file_annotation_absolute_path, root_path_key, root_relative_path_key};

pub(crate) fn read_file_annotation(
    runtime_home_path: &Path,
    request: FileAnnotationReadRequest,
) -> Result<FileAnnotationReadResponse, RuntimeError> {
    let metadata_path = file_annotations_path(runtime_home_path);
    let records = read_file_annotation_records(&metadata_path)?;
    let root_path_key = root_path_key(&request.root_path);
    let root_relative_path_key = root_relative_path_key(&request.root_relative_path);
    let absolute_path =
        file_annotation_absolute_path(&request.root_path, &request.root_relative_path)?;

    let Some(record) = records.iter().find(|record| {
        record.root_path == root_path_key && record.root_relative_path == root_relative_path_key
    }) else {
        return Ok(FileAnnotationReadResponse { file: None });
    };

    if record.tags.is_empty() || !absolute_path.is_file() {
        return Ok(FileAnnotationReadResponse { file: None });
    }

    let mut tags = record
        .tags
        .iter()
        .map(|tag| AnnotationTag {
            key: tag.key.clone(),
            value: tag.value.clone(),
            source: tag.source.clone(),
            applied_at_ms: tag.applied_at_ms,
        })
        .collect::<Vec<_>>();
    sort_annotation_tags(&mut tags);

    Ok(FileAnnotationReadResponse {
        file: Some(FileAnnotationFile {
            root_relative_path: request.root_relative_path,
            absolute_path,
            tags,
        }),
    })
}
