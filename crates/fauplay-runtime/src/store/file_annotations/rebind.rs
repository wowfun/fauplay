use std::path::Path;

use crate::{
    FileAnnotationPathRebindFailureReason, FileAnnotationPathRebindItem,
    FileAnnotationPathRebindRequest, FileAnnotationPathRebindResponse, RuntimeError,
};

use super::super::file_annotation_records::{
    file_annotations_path, merge_annotation_tags, read_file_annotation_records,
    write_file_annotation_records,
};
use super::super::{file_annotation_absolute_path, root_path_key, root_relative_path_key};

pub(crate) fn rebind_file_annotation_paths(
    runtime_home_path: &Path,
    request: FileAnnotationPathRebindRequest,
) -> Result<FileAnnotationPathRebindResponse, RuntimeError> {
    let metadata_path = file_annotations_path(runtime_home_path);
    let mut records = read_file_annotation_records(&metadata_path)?;
    let root_path_key = root_path_key(&request.root_path);
    let mut items = Vec::new();

    for mapping in request.mappings {
        let from_root_relative_path_key = root_relative_path_key(&mapping.from_root_relative_path);
        let to_root_relative_path_key = root_relative_path_key(&mapping.to_root_relative_path);

        if from_root_relative_path_key == to_root_relative_path_key {
            items.push(FileAnnotationPathRebindItem {
                from_root_relative_path: mapping.from_root_relative_path,
                to_root_relative_path: mapping.to_root_relative_path,
                ok: true,
                skipped: true,
                reason: Some(FileAnnotationPathRebindFailureReason::NoChange),
                error: None,
            });
            continue;
        }

        let target_absolute_path =
            file_annotation_absolute_path(&request.root_path, &mapping.to_root_relative_path)?;
        if !target_absolute_path.is_file() {
            items.push(FileAnnotationPathRebindItem {
                from_root_relative_path: mapping.from_root_relative_path,
                to_root_relative_path: mapping.to_root_relative_path,
                ok: false,
                skipped: false,
                reason: Some(FileAnnotationPathRebindFailureReason::TargetNotFound),
                error: Some("target path was not found".to_owned()),
            });
            continue;
        }

        let Some(source_index) = records.iter().position(|record| {
            record.root_path == root_path_key
                && record.root_relative_path == from_root_relative_path_key
        }) else {
            items.push(FileAnnotationPathRebindItem {
                from_root_relative_path: mapping.from_root_relative_path,
                to_root_relative_path: mapping.to_root_relative_path,
                ok: false,
                skipped: false,
                reason: Some(FileAnnotationPathRebindFailureReason::SourceNotFound),
                error: Some("source File Annotation was not found".to_owned()),
            });
            continue;
        };

        let mut source_record = records.remove(source_index);
        source_record.root_relative_path = to_root_relative_path_key.clone();
        if let Some(target_record) = records.iter_mut().find(|record| {
            record.root_path == root_path_key
                && record.root_relative_path == to_root_relative_path_key
        }) {
            merge_annotation_tags(&mut target_record.tags, source_record.tags);
        } else {
            records.push(source_record);
        }

        items.push(FileAnnotationPathRebindItem {
            from_root_relative_path: mapping.from_root_relative_path,
            to_root_relative_path: mapping.to_root_relative_path,
            ok: true,
            skipped: false,
            reason: None,
            error: None,
        });
    }

    if items.iter().any(|item| item.ok && !item.skipped) {
        write_file_annotation_records(&metadata_path, &records)?;
    }

    let total = items.len();
    let updated = items.iter().filter(|item| item.ok && !item.skipped).count();
    let skipped = items.iter().filter(|item| item.skipped).count();
    let failed = total - updated - skipped;

    Ok(FileAnnotationPathRebindResponse {
        total,
        updated,
        skipped,
        failed,
        items,
    })
}
