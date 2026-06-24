use std::path::PathBuf;

use crate::{
    FauplayRuntime, FileIndexEnsureRequest, FileIndexEnsureResponse, FileIndexFailureReason,
    RootRelativePath,
};

use super::{
    HttpResponse, error_json, escape_json_string, http_response, json_root_relative_path_values,
    json_string_field, optional_path_json, optional_string_json, optional_u64_json,
    parse_json_body,
};

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

fn file_index_failure_reason_code(value: FileIndexFailureReason) -> &'static str {
    match value {
        FileIndexFailureReason::IndexFresh => "INDEX_FRESH",
        FileIndexFailureReason::SourceNotFound => "SOURCE_NOT_FOUND",
        FileIndexFailureReason::NotFile => "NOT_FILE",
        FileIndexFailureReason::IndexFailed => "INDEX_FAILED",
    }
}
