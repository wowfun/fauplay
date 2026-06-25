use std::path::PathBuf;

use crate::{
    DuplicateFilesRequest, DuplicateFilesResponse, DuplicateSeedSkipReason, FauplayRuntime,
    RootRelativePath,
};

use super::super::{
    HttpResponse, error_json, escape_json_string, first_query_value, http_request_body,
    http_response, json_root_relative_path_values, json_string_field, query_values,
};

pub(in crate::server) fn handle_find_duplicate_files(
    runtime: &FauplayRuntime,
    query: &[(String, String)],
) -> HttpResponse {
    let Some(root_path) = first_query_value(query, "rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_paths = query_values(query, "rootRelativePath");
    if root_relative_paths.is_empty() {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"rootRelativePath is required\"}",
        );
    }

    let mut seed_root_relative_paths = Vec::new();
    for root_relative_path in root_relative_paths {
        let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
            Ok(path) => path,
            Err(error) => {
                return http_response(400, "Bad Request", &error_json(&error.to_string()));
            }
        };
        seed_root_relative_paths.push(root_relative_path);
    }

    match runtime.find_duplicate_files(DuplicateFilesRequest {
        root_path: PathBuf::from(root_path),
        seed_root_relative_paths,
    }) {
        Ok(response) => http_response(200, "OK", &duplicate_files_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(in crate::server) fn handle_find_duplicate_files_json(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let body = http_request_body(request).trim();
    if body.is_empty() {
        return http_response(400, "Bad Request", "{\"error\":\"JSON body is required\"}");
    }

    let payload = match serde_json::from_str::<serde_json::Value>(body) {
        Ok(payload) => payload,
        Err(error) => {
            return http_response(
                400,
                "Bad Request",
                &error_json(&format!("invalid JSON body: {error}")),
            );
        }
    };
    let Some(root_path) = json_string_field(&payload, "rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_paths = json_root_relative_path_values(&payload);
    if root_relative_paths.is_empty() {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"rootRelativePath is required\"}",
        );
    }

    let mut seed_root_relative_paths = Vec::new();
    for root_relative_path in root_relative_paths {
        let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
            Ok(path) => path,
            Err(error) => {
                return http_response(400, "Bad Request", &error_json(&error.to_string()));
            }
        };
        seed_root_relative_paths.push(root_relative_path);
    }

    match runtime.find_duplicate_files(DuplicateFilesRequest {
        root_path: PathBuf::from(root_path),
        seed_root_relative_paths,
    }) {
        Ok(response) => http_response(200, "OK", &duplicate_files_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn duplicate_files_response_json(response: DuplicateFilesResponse) -> String {
    let skipped_seeds = response
        .skipped_seeds
        .into_iter()
        .map(|skip| {
            format!(
                "{{\"rootRelativePath\":\"{}\",\"reason\":\"{}\"}}",
                escape_json_string(&skip.root_relative_path.to_string()),
                duplicate_seed_skip_reason_json(skip.reason),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let duplicate_set_count = response.duplicate_sets.len();
    let duplicate_sets = response
        .duplicate_sets
        .into_iter()
        .map(|duplicate_set| {
            let seed_paths = duplicate_set
                .seed_root_relative_paths
                .iter()
                .map(|path| format!("\"{}\"", escape_json_string(&path.to_string())))
                .collect::<Vec<_>>()
                .join(",");
            let files = duplicate_set
                .files
                .into_iter()
                .map(|file| {
                    let mut json = format!(
                        "{{\"name\":\"{}\",\"rootRelativePath\":\"{}\",\"absolutePath\":\"{}\",\"size\":{}",
                        escape_json_string(&file.name),
                        escape_json_string(&file.root_relative_path.to_string()),
                        escape_json_string(&file.absolute_path.display().to_string()),
                        file.size,
                    );
                    if let Some(last_modified_ms) = file.last_modified_ms {
                        json.push_str(&format!(",\"lastModifiedMs\":{last_modified_ms}"));
                    }
                    json.push('}');
                    json
                })
                .collect::<Vec<_>>()
                .join(",");
            format!(
                "{{\"setId\":\"{}\",\"seedRootRelativePaths\":[{seed_paths}],\"files\":[{files}]}}",
                escape_json_string(&duplicate_set.set_id),
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"ok\":true,\"seedCount\":{},\"skippedSeeds\":[{skipped_seeds}],\"duplicateSetCount\":{duplicate_set_count},\"duplicateSets\":[{duplicate_sets}]}}",
        response.seed_count,
    )
}

fn duplicate_seed_skip_reason_json(value: DuplicateSeedSkipReason) -> &'static str {
    match value {
        DuplicateSeedSkipReason::SourceNotFound => "source_not_found",
        DuplicateSeedSkipReason::NotFile => "not_file",
    }
}
