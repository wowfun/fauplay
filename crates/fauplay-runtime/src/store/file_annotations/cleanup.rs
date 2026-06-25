use std::collections::HashSet;
use std::path::Path;

use crate::{
    MissingFileCleanupImpact, MissingFileCleanupRequest, MissingFileCleanupResponse,
    RootRelativePath, RuntimeError,
};

use super::super::file_annotation_records::{
    file_annotations_path, read_file_annotation_records, write_file_annotation_records,
};
use super::super::file_index::{
    file_index_path, read_file_index_records, write_file_index_records,
};
use super::super::{file_annotation_absolute_path, root_path_key};

pub(crate) fn cleanup_missing_files(
    runtime_home_path: &Path,
    request: MissingFileCleanupRequest,
) -> Result<MissingFileCleanupResponse, RuntimeError> {
    let annotation_metadata_path = file_annotations_path(runtime_home_path);
    let index_metadata_path = file_index_path(runtime_home_path);
    let mut annotation_records = read_file_annotation_records(&annotation_metadata_path)?;
    let mut index_records = read_file_index_records(&index_metadata_path)?;
    let root_path_key = root_path_key(&request.root_path);
    let mut missing_root_relative_paths = Vec::new();
    let mut missing_absolute_paths = Vec::new();
    let mut seen_missing_paths = HashSet::new();
    let mut missing_annotation_indexes = HashSet::new();
    let mut missing_index_indexes = HashSet::new();
    let mut annotation_tags = 0;

    for (index, record) in annotation_records.iter().enumerate() {
        if record.root_path != root_path_key {
            continue;
        }
        let Ok(root_relative_path) = RootRelativePath::try_from(record.root_relative_path.as_str())
        else {
            continue;
        };
        let absolute_path = file_annotation_absolute_path(&request.root_path, &root_relative_path)?;
        if absolute_path.is_file() {
            continue;
        }

        annotation_tags += record.tags.len();
        if seen_missing_paths.insert(root_relative_path.to_string()) {
            missing_root_relative_paths.push(root_relative_path);
            missing_absolute_paths.push(absolute_path);
        }
        missing_annotation_indexes.insert(index);
    }

    for (index, record) in index_records.iter().enumerate() {
        if record.root_path != root_path_key {
            continue;
        }
        let Ok(root_relative_path) = RootRelativePath::try_from(record.root_relative_path.as_str())
        else {
            continue;
        };
        let absolute_path = file_annotation_absolute_path(&request.root_path, &root_relative_path)?;
        if absolute_path.is_file() {
            continue;
        }

        if seen_missing_paths.insert(root_relative_path.to_string()) {
            missing_root_relative_paths.push(root_relative_path);
            missing_absolute_paths.push(absolute_path);
        }
        missing_index_indexes.insert(index);
    }

    if request.confirm && !missing_annotation_indexes.is_empty() {
        let mut next_index = 0;
        annotation_records.retain(|_| {
            let keep = !missing_annotation_indexes.contains(&next_index);
            next_index += 1;
            keep
        });
        write_file_annotation_records(&annotation_metadata_path, &annotation_records)?;
    }

    if request.confirm && !missing_index_indexes.is_empty() {
        let mut next_index = 0;
        index_records.retain(|_| {
            let keep = !missing_index_indexes.contains(&next_index);
            next_index += 1;
            keep
        });
        write_file_index_records(&index_metadata_path, &index_records)?;
    }

    let removed = if request.confirm {
        missing_annotation_indexes.len() + missing_index_indexes.len()
    } else {
        0
    };

    Ok(MissingFileCleanupResponse {
        dry_run: !request.confirm,
        missing_root_relative_paths,
        missing_absolute_paths,
        impact: MissingFileCleanupImpact {
            file_annotations: missing_annotation_indexes.len(),
            annotation_tags,
            file_index_entries: missing_index_indexes.len(),
        },
        removed,
    })
}
