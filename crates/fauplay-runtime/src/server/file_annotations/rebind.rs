use std::path::PathBuf;

use crate::{
    FauplayRuntime, FileAnnotationPathMapping, FileAnnotationPathRebindFailureReason,
    FileAnnotationPathRebindRequest, FileAnnotationPathRebindResponse, RootRelativePath,
};

use super::super::{
    HttpResponse, error_json, escape_json_string, http_response, json_mapping_path_field,
    json_string_field, optional_string_json, parse_json_body,
};

pub(in crate::server) fn handle_rebind_file_annotation_paths_json(
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

fn file_annotation_rebind_failure_reason_code(
    value: FileAnnotationPathRebindFailureReason,
) -> &'static str {
    match value {
        FileAnnotationPathRebindFailureReason::SourceNotFound => "SOURCE_NOT_FOUND",
        FileAnnotationPathRebindFailureReason::TargetNotFound => "TARGET_NOT_FOUND",
        FileAnnotationPathRebindFailureReason::NoChange => "NO_CHANGE",
    }
}
