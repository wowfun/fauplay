use std::path::PathBuf;

use crate::{
    AnnotationTagOptionsRequest, AnnotationTagOptionsResponse, FauplayRuntime,
    FileAnnotationActionSource, FileAnnotationMatchMode, FileAnnotationMissingCleanupRequest,
    FileAnnotationMissingCleanupResponse, FileAnnotationMutationResponse,
    FileAnnotationPathMapping, FileAnnotationPathRebindFailureReason,
    FileAnnotationPathRebindRequest, FileAnnotationPathRebindResponse, FileAnnotationQueryRequest,
    FileAnnotationQueryResponse, FileAnnotationReadRequest, FileAnnotationReadResponse,
    FileAnnotationSetValueRequest, FileAnnotationTagBindingRequest,
    FileAnnotationTagMutationResponse, FileIndexEnsureRequest, FileIndexEnsureResponse,
    FileIndexFailureReason, RootRelativePath,
};

use super::{
    HttpResponse, error_json, escape_json_string, http_response, json_bool_field,
    json_mapping_path_field, json_root_relative_path_values, json_string_array_field,
    json_string_field, json_string_or_default, json_usize_or_default, optional_path_json,
    optional_string_json, optional_u64_json, parse_json_body,
};

pub(super) fn handle_set_file_annotation_json(
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
    let Some(root_relative_path) = json_file_annotation_relative_path(&payload) else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"relativePath is required\"}",
        );
    };
    let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };
    let Some(key) =
        json_string_field(&payload, "fieldKey").or_else(|| json_string_field(&payload, "key"))
    else {
        return http_response(400, "Bad Request", "{\"error\":\"fieldKey is required\"}");
    };
    let Some(value) = json_string_field(&payload, "value") else {
        return http_response(400, "Bad Request", "{\"error\":\"value is required\"}");
    };

    match runtime.set_file_annotation_value(FileAnnotationSetValueRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
        key: key.to_owned(),
        value: value.to_owned(),
        source: parse_file_annotation_action_source(json_string_field(&payload, "source")),
    }) {
        Ok(response) => http_response(200, "OK", &file_annotation_set_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

pub(super) fn handle_bind_file_annotation_tag_json(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    handle_file_annotation_tag_binding_json(runtime, request, FileAnnotationTagBindingKind::Bind)
}

pub(super) fn handle_unbind_file_annotation_tag_json(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    handle_file_annotation_tag_binding_json(runtime, request, FileAnnotationTagBindingKind::Unbind)
}

pub(super) fn handle_read_file_annotation_json(
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
    let Some(root_relative_path) = json_file_annotation_relative_path(&payload) else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"relativePath is required\"}",
        );
    };
    let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };

    match runtime.read_file_annotation(FileAnnotationReadRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
    }) {
        Ok(response) => http_response(200, "OK", &file_annotation_read_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

pub(super) fn handle_list_annotation_tag_options_json(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    match runtime.list_annotation_tag_options(AnnotationTagOptionsRequest {
        root_path: json_string_field(&payload, "rootPath").map(PathBuf::from),
    }) {
        Ok(response) => http_response(200, "OK", &annotation_tag_options_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

pub(super) fn handle_query_file_annotations_json(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let page = json_usize_or_default(&payload, "page", 1)
        .unwrap_or(1)
        .max(1);
    let size = json_usize_or_default(&payload, "size", 500)
        .unwrap_or(500)
        .clamp(1, 5000);
    let include_match_mode =
        match json_string_or_default(&payload, "includeMatchMode", "or").as_str() {
            "and" => FileAnnotationMatchMode::And,
            _ => FileAnnotationMatchMode::Or,
        };

    match runtime.query_file_annotations(FileAnnotationQueryRequest {
        root_path: json_string_field(&payload, "rootPath").map(PathBuf::from),
        include_tag_keys: json_string_array_field(&payload, "includeTagKeys"),
        exclude_tag_keys: json_string_array_field(&payload, "excludeTagKeys"),
        include_match_mode,
        page,
        size,
    }) {
        Ok(response) => http_response(200, "OK", &file_annotation_query_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

pub(super) fn handle_rebind_file_annotation_paths_json(
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
    let Some(mappings) = payload
        .get("mappings")
        .and_then(serde_json::Value::as_array)
    else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"mappings must be an array\"}",
        );
    };
    let mut parsed_mappings = Vec::with_capacity(mappings.len());
    for mapping in mappings {
        let Some(from_root_relative_path) =
            json_mapping_path_field(mapping, "fromRelativePath", Some("relativePath"))
        else {
            return http_response(
                400,
                "Bad Request",
                "{\"error\":\"fromRelativePath is required\"}",
            );
        };
        let Some(to_root_relative_path) =
            json_mapping_path_field(mapping, "toRelativePath", Some("nextRelativePath"))
        else {
            return http_response(
                400,
                "Bad Request",
                "{\"error\":\"toRelativePath is required\"}",
            );
        };
        let from_root_relative_path = match RootRelativePath::try_from(from_root_relative_path) {
            Ok(path) => path,
            Err(error) => {
                return http_response(400, "Bad Request", &error_json(&error.to_string()));
            }
        };
        let to_root_relative_path = match RootRelativePath::try_from(to_root_relative_path) {
            Ok(path) => path,
            Err(error) => {
                return http_response(400, "Bad Request", &error_json(&error.to_string()));
            }
        };
        parsed_mappings.push(FileAnnotationPathMapping {
            from_root_relative_path,
            to_root_relative_path,
        });
    }

    match runtime.rebind_file_annotation_paths(FileAnnotationPathRebindRequest {
        root_path: PathBuf::from(root_path),
        mappings: parsed_mappings,
    }) {
        Ok(response) => http_response(200, "OK", &file_annotation_rebind_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

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

pub(super) fn handle_ensure_file_index_entries_json(
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
    let root_relative_paths = json_root_relative_path_values(&payload);
    if root_relative_paths.is_empty() {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"relativePaths is required\"}",
        );
    }

    let mut parsed_root_relative_paths = Vec::with_capacity(root_relative_paths.len());
    for root_relative_path in root_relative_paths {
        let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
            Ok(path) => path,
            Err(error) => {
                return http_response(400, "Bad Request", &error_json(&error.to_string()));
            }
        };
        parsed_root_relative_paths.push(root_relative_path);
    }

    match runtime.ensure_file_index_entries(FileIndexEnsureRequest {
        root_path: PathBuf::from(root_path),
        root_relative_paths: parsed_root_relative_paths,
    }) {
        Ok(response) => http_response(200, "OK", &file_index_ensure_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

#[derive(Debug, Clone, Copy)]
enum FileAnnotationTagBindingKind {
    Bind,
    Unbind,
}

fn handle_file_annotation_tag_binding_json(
    runtime: &FauplayRuntime,
    request: &str,
    kind: FileAnnotationTagBindingKind,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let Some(root_path) = json_string_field(&payload, "rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let Some(root_relative_path) = json_file_annotation_relative_path(&payload) else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"relativePath is required\"}",
        );
    };
    let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };
    let Some(key) = json_string_field(&payload, "key") else {
        return http_response(400, "Bad Request", "{\"error\":\"key is required\"}");
    };
    let Some(value) = json_string_field(&payload, "value") else {
        return http_response(400, "Bad Request", "{\"error\":\"value is required\"}");
    };
    let request = FileAnnotationTagBindingRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
        key: key.to_owned(),
        value: value.to_owned(),
    };
    let result = match kind {
        FileAnnotationTagBindingKind::Bind => runtime.bind_file_annotation_tag(request),
        FileAnnotationTagBindingKind::Unbind => runtime.unbind_file_annotation_tag(request),
    };

    match result {
        Ok(response) => http_response(200, "OK", &file_annotation_tag_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

fn json_file_annotation_relative_path(payload: &serde_json::Value) -> Option<&str> {
    json_string_field(payload, "relativePath")
        .or_else(|| json_string_field(payload, "rootRelativePath"))
}

fn parse_file_annotation_action_source(value: Option<&str>) -> FileAnnotationActionSource {
    match value {
        Some("hotkey") => FileAnnotationActionSource::Hotkey,
        _ => FileAnnotationActionSource::Click,
    }
}

fn file_annotation_set_response_json(response: FileAnnotationMutationResponse) -> String {
    let root_relative_path = response.root_relative_path.to_string();
    format!(
        "{{\"ok\":true,\"absolutePath\":\"{}\",\"relativePath\":\"{}\",\"rootRelativePath\":\"{}\",\"fieldKey\":\"{}\",\"key\":\"{}\",\"value\":\"{}\",\"source\":\"{}\"}}",
        escape_json_string(&response.absolute_path.display().to_string()),
        escape_json_string(&root_relative_path),
        escape_json_string(&root_relative_path),
        escape_json_string(&response.key),
        escape_json_string(&response.key),
        escape_json_string(&response.value),
        file_annotation_action_source_json(response.source),
    )
}

fn file_annotation_tag_response_json(response: FileAnnotationTagMutationResponse) -> String {
    let root_relative_path = response.root_relative_path.to_string();
    format!(
        "{{\"ok\":true,\"absolutePath\":\"{}\",\"relativePath\":\"{}\",\"rootRelativePath\":\"{}\",\"key\":\"{}\",\"value\":\"{}\",\"source\":\"{}\"}}",
        escape_json_string(&response.absolute_path.display().to_string()),
        escape_json_string(&root_relative_path),
        escape_json_string(&root_relative_path),
        escape_json_string(&response.key),
        escape_json_string(&response.value),
        escape_json_string(&response.source),
    )
}

fn file_annotation_read_response_json(response: FileAnnotationReadResponse) -> String {
    match response.file {
        Some(file) => format!(
            "{{\"ok\":true,\"file\":{}}}",
            file_annotation_file_json(file)
        ),
        None => "{\"ok\":true,\"file\":null}".to_owned(),
    }
}

fn annotation_tag_options_response_json(response: AnnotationTagOptionsResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(|item| {
            format!(
                "{{\"tagKey\":\"{}\",\"key\":\"{}\",\"value\":\"{}\",\"source\":\"{}\",\"fileCount\":{}}}",
                escape_json_string(&item.tag_key),
                escape_json_string(&item.key),
                escape_json_string(&item.value),
                escape_json_string(&item.source),
                item.file_count,
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!("{{\"ok\":true,\"items\":[{items}]}}")
}

fn file_annotation_query_response_json(response: FileAnnotationQueryResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(file_annotation_file_json)
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"ok\":true,\"page\":{},\"size\":{},\"total\":{},\"items\":[{items}]}}",
        response.page, response.size, response.total,
    )
}

fn file_annotation_rebind_response_json(response: FileAnnotationPathRebindResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(|item| {
            let reason_code = item.reason.map(file_annotation_rebind_failure_reason_code);
            format!(
                "{{\"fromRelativePath\":\"{}\",\"toRelativePath\":\"{}\",\"ok\":{},\"skipped\":{},\"reasonCode\":{},\"reason\":{},\"error\":{}}}",
                escape_json_string(&item.from_root_relative_path.to_string()),
                escape_json_string(&item.to_root_relative_path.to_string()),
                item.ok,
                item.skipped,
                optional_string_json(reason_code),
                optional_string_json(reason_code),
                optional_string_json(item.error.as_deref()),
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"ok\":true,\"total\":{},\"updated\":{},\"skipped\":{},\"failed\":{},\"items\":[{items}]}}",
        response.total, response.updated, response.skipped, response.failed,
    )
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

fn file_index_ensure_response_json(response: FileIndexEnsureResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(|item| {
            let root_relative_path = item.root_relative_path.to_string();
            let reason_code = item.reason.map(file_index_failure_reason_code);
            format!(
                "{{\"relativePath\":\"{}\",\"rootRelativePath\":\"{}\",\"ok\":{},\"skipped\":{},\"assetId\":null,\"absolutePath\":{},\"fileMtimeMs\":{},\"lastModifiedMs\":{},\"size\":{},\"reasonCode\":{},\"reason\":{},\"error\":{}}}",
                escape_json_string(&root_relative_path),
                escape_json_string(&root_relative_path),
                item.ok,
                item.skipped,
                optional_path_json(item.absolute_path.as_ref()),
                optional_u64_json(item.last_modified_ms),
                optional_u64_json(item.last_modified_ms),
                optional_u64_json(item.size),
                optional_string_json(reason_code),
                optional_string_json(reason_code),
                optional_string_json(item.error.as_deref()),
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"ok\":true,\"total\":{},\"indexed\":{},\"skipped\":{},\"failed\":{},\"items\":[{items}]}}",
        response.total, response.indexed, response.skipped, response.failed,
    )
}

fn file_annotation_file_json(file: crate::FileAnnotationFile) -> String {
    let root_relative_path = file.root_relative_path.to_string();
    let tags = file
        .tags
        .into_iter()
        .map(|tag| {
            format!(
                "{{\"key\":\"{}\",\"value\":\"{}\",\"source\":\"{}\",\"appliedAt\":{},\"updatedAt\":{}}}",
                escape_json_string(&tag.key),
                escape_json_string(&tag.value),
                escape_json_string(&tag.source),
                tag.applied_at_ms,
                tag.applied_at_ms,
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"absolutePath\":\"{}\",\"relativePath\":\"{}\",\"rootRelativePath\":\"{}\",\"tags\":[{tags}]}}",
        escape_json_string(&file.absolute_path.display().to_string()),
        escape_json_string(&root_relative_path),
        escape_json_string(&root_relative_path),
    )
}

fn file_annotation_action_source_json(value: FileAnnotationActionSource) -> &'static str {
    match value {
        FileAnnotationActionSource::Click => "click",
        FileAnnotationActionSource::Hotkey => "hotkey",
    }
}

fn file_annotation_rebind_failure_reason_code(
    value: FileAnnotationPathRebindFailureReason,
) -> &'static str {
    match value {
        FileAnnotationPathRebindFailureReason::SourceNotFound => "SOURCE_NOT_FOUND",
        FileAnnotationPathRebindFailureReason::TargetNotFound => "TARGET_NOT_FOUND",
        FileAnnotationPathRebindFailureReason::NoChange => "NO_CHANGE",
    }
}

fn file_index_failure_reason_code(value: FileIndexFailureReason) -> &'static str {
    match value {
        FileIndexFailureReason::IndexFresh => "INDEX_FRESH",
        FileIndexFailureReason::SourceNotFound => "SOURCE_NOT_FOUND",
        FileIndexFailureReason::NotFile => "NOT_FILE",
        FileIndexFailureReason::IndexFailed => "INDEX_FAILED",
    }
}
