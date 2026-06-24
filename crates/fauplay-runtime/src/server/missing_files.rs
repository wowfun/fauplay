use std::path::PathBuf;

use crate::{
    FauplayRuntime, FileAnnotationMissingCleanupRequest, FileAnnotationMissingCleanupResponse,
};

use super::{
    HttpResponse, error_json, escape_json_string, http_response, json_bool_field,
    json_string_field, parse_json_body,
};

pub(super) fn handle_cleanup_missing_file_annotations_json(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let Some(root_path) = json_string_field(&payload, "rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };

    match runtime.cleanup_missing_file_annotations(FileAnnotationMissingCleanupRequest {
        root_path: PathBuf::from(root_path),
        confirm: json_bool_field(&payload, "confirm"),
    }) {
        Ok(response) => http_response(
            200,
            "OK",
            &file_annotation_missing_cleanup_response_json(response),
        ),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

fn file_annotation_missing_cleanup_response_json(
    response: FileAnnotationMissingCleanupResponse,
) -> String {
    let missing_root_relative_paths = response
        .missing_root_relative_paths
        .iter()
        .map(|path| format!("\"{}\"", escape_json_string(&path.to_string())))
        .collect::<Vec<_>>()
        .join(",");
    let missing_absolute_paths = response
        .missing_absolute_paths
        .iter()
        .map(|path| format!("\"{}\"", escape_json_string(&path.display().to_string())))
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"ok\":true,\"dryRun\":{},\"missingRootRelativePaths\":[{missing_root_relative_paths}],\"missingAbsolutePaths\":[{missing_absolute_paths}],\"impact\":{{\"fileAnnotation\":{},\"annotationTag\":{},\"fileIndexEntry\":{}}},\"removed\":{}}}",
        response.dry_run,
        response.impact.file_annotations,
        response.impact.annotation_tags,
        response.impact.file_index_entries,
        response.removed,
    )
}
