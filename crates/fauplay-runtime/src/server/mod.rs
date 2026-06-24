use std::collections::HashMap;
use std::path::PathBuf;

use crate::{
    DirectoryEntryKind, DuplicateFilesRequest, DuplicateFilesResponse, DuplicateSeedSkipReason,
    FauplayRuntime, FileContentRequest, FileMetadataRequest, FileMetadataResponse,
    GlobalShortcutConfigResponse, ListDirectoryRequest, ListingEntryFilter, ListingOrder,
    ListingQuery, ListingSortDirection, ListingSortKey, LocalRootBinding,
    LocalRootBindingUpsertRequest, LocalRootBindingsResponse, RootRelativePath, TextPreviewRequest,
    TextPreviewStatus,
};

mod file_annotations;
mod global_trash;
mod http;
mod request;
mod root_operations;

pub use http::{serve_http, serve_one_http_request};

use http::{
    HttpResponse, file_content_response, http_response, parse_file_content_range,
    parse_header_value, parse_http_request_line,
};
use request::{
    first_query_value, http_request_body, json_bool_field, json_i64_or_default,
    json_mapping_path_field, json_root_relative_path_values, json_string_array_field,
    json_string_field, json_string_or_default, json_usize_or_default, parse_json_body,
    parse_query_pairs, parse_query_string, query_values,
};

fn handle_http_request(runtime: &FauplayRuntime, request: &str) -> HttpResponse {
    match parse_http_request_line(request) {
        Some(("GET", "/v1/health")) => http_response(
            200,
            "OK",
            "{\"status\":\"ok\",\"runtime\":\"fauplay-runtime\"}",
        ),
        Some(("GET", "/v1/config/shortcuts")) => handle_global_shortcut_config(runtime),
        Some(("GET", target))
            if target == "/v1/local-root-bindings"
                || target.starts_with("/v1/local-root-bindings?") =>
        {
            handle_list_local_root_bindings(runtime)
        }
        Some(("PUT", target)) if target.starts_with("/v1/local-root-bindings?") => {
            let query = parse_query_string(&target["/v1/local-root-bindings?".len()..]);
            handle_upsert_local_root_binding(runtime, &query)
        }
        Some(("OPTIONS", target)) if is_preflight_target(target) => {
            http_response(204, "No Content", "")
        }
        Some(("GET", target))
            if target == "/v1/global-trash" || target.starts_with("/v1/global-trash?") =>
        {
            let query = target
                .strip_prefix("/v1/global-trash?")
                .map(parse_query_string)
                .unwrap_or_default();
            global_trash::handle_list_global_trash(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/global-trash/file-content?") => {
            let query = parse_query_string(&target["/v1/global-trash/file-content?".len()..]);
            global_trash::handle_global_trash_file_content(
                runtime,
                &query,
                parse_header_value(request, "range"),
            )
        }
        Some(("GET", target)) if target.starts_with("/v1/global-trash/text-preview?") => {
            let query = parse_query_string(&target["/v1/global-trash/text-preview?".len()..]);
            global_trash::handle_global_trash_text_preview(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/global-trash/file-metadata?") => {
            let query = parse_query_string(&target["/v1/global-trash/file-metadata?".len()..]);
            global_trash::handle_global_trash_file_metadata(runtime, &query)
        }
        Some(("POST", target))
            if target == "/v1/global-trash/move"
                || target.starts_with("/v1/global-trash/move?") =>
        {
            let query = target
                .strip_prefix("/v1/global-trash/move?")
                .map(parse_query_pairs)
                .unwrap_or_default();
            global_trash::handle_move_to_global_trash(runtime, &query)
        }
        Some(("POST", target))
            if target == "/v1/global-trash/restore"
                || target.starts_with("/v1/global-trash/restore?") =>
        {
            let query = target
                .strip_prefix("/v1/global-trash/restore?")
                .map(parse_query_pairs)
                .unwrap_or_default();
            global_trash::handle_restore_global_trash(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/local-directory?") => {
            let query = parse_query_string(&target["/v1/local-directory?".len()..]);
            handle_list_local_directory(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/text-preview?") => {
            let query = parse_query_string(&target["/v1/text-preview?".len()..]);
            handle_text_preview(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/file-content?") => {
            let query = parse_query_string(&target["/v1/file-content?".len()..]);
            handle_file_content(runtime, &query, parse_header_value(request, "range"))
        }
        Some(("GET", target)) if target.starts_with("/v1/file-metadata?") => {
            let query = parse_query_string(&target["/v1/file-metadata?".len()..]);
            handle_file_metadata(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/duplicate-files?") => {
            let query = parse_query_pairs(&target["/v1/duplicate-files?".len()..]);
            handle_find_duplicate_files(runtime, &query)
        }
        Some(("POST", "/v1/duplicate-files")) => handle_find_duplicate_files_json(runtime, request),
        Some(("PUT", "/v1/file-annotations")) => {
            file_annotations::handle_set_file_annotation_json(runtime, request)
        }
        Some(("POST", "/v1/file-annotations/tags/bind")) => {
            file_annotations::handle_bind_file_annotation_tag_json(runtime, request)
        }
        Some(("POST", "/v1/file-annotations/tags/unbind")) => {
            file_annotations::handle_unbind_file_annotation_tag_json(runtime, request)
        }
        Some(("PATCH", "/v1/files/relative-paths")) => {
            file_annotations::handle_rebind_file_annotation_paths_json(runtime, request)
        }
        Some(("POST", "/v1/files/missing/cleanups")) => {
            file_annotations::handle_cleanup_missing_file_annotations_json(runtime, request)
        }
        Some(("POST", "/v1/files/indexes")) => {
            file_annotations::handle_ensure_file_index_entries_json(runtime, request)
        }
        Some(("POST", "/v1/data/tags/file")) => {
            file_annotations::handle_read_file_annotation_json(runtime, request)
        }
        Some(("POST", "/v1/data/tags/options")) => {
            file_annotations::handle_list_annotation_tag_options_json(runtime, request)
        }
        Some(("POST", "/v1/data/tags/query")) => {
            file_annotations::handle_query_file_annotations_json(runtime, request)
        }
        Some(("POST", "/v1/root-move/batch")) => {
            root_operations::handle_root_move_batch_json(runtime, request)
        }
        Some(("POST", target))
            if target == "/v1/root-move" || target.starts_with("/v1/root-move?") =>
        {
            let query = target
                .strip_prefix("/v1/root-move?")
                .map(parse_query_string)
                .unwrap_or_default();
            root_operations::handle_root_move(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/root-trash?") => {
            let query = parse_query_string(&target["/v1/root-trash?".len()..]);
            root_operations::handle_list_root_trash(runtime, &query)
        }
        Some(("POST", target)) if target.starts_with("/v1/root-trash/move?") => {
            let query = parse_query_pairs(&target["/v1/root-trash/move?".len()..]);
            root_operations::handle_move_to_root_trash(runtime, &query)
        }
        Some(("POST", target)) if target.starts_with("/v1/root-trash/restore?") => {
            let query = parse_query_pairs(&target["/v1/root-trash/restore?".len()..]);
            root_operations::handle_restore_from_root_trash(runtime, &query)
        }
        _ => http_response(404, "Not Found", "{\"error\":\"not found\"}"),
    }
}

fn is_preflight_target(target: &str) -> bool {
    matches!(
        target,
        "/v1/local-directory"
            | "/v1/config/shortcuts"
            | "/v1/local-root-bindings"
            | "/v1/global-trash"
            | "/v1/global-trash/file-content"
            | "/v1/global-trash/text-preview"
            | "/v1/global-trash/file-metadata"
            | "/v1/global-trash/move"
            | "/v1/global-trash/restore"
            | "/v1/text-preview"
            | "/v1/file-content"
            | "/v1/file-metadata"
            | "/v1/duplicate-files"
            | "/v1/file-annotations"
            | "/v1/file-annotations/tags/bind"
            | "/v1/file-annotations/tags/unbind"
            | "/v1/files/relative-paths"
            | "/v1/files/missing/cleanups"
            | "/v1/files/indexes"
            | "/v1/data/tags/file"
            | "/v1/data/tags/options"
            | "/v1/data/tags/query"
            | "/v1/root-move"
            | "/v1/root-move/batch"
            | "/v1/root-trash"
            | "/v1/root-trash/move"
            | "/v1/root-trash/restore"
    )
}

fn handle_global_shortcut_config(runtime: &FauplayRuntime) -> HttpResponse {
    match runtime.load_global_shortcut_config() {
        Ok(response) => http_response(200, "OK", &global_shortcut_config_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_list_local_root_bindings(runtime: &FauplayRuntime) -> HttpResponse {
    match runtime.list_local_root_bindings() {
        Ok(response) => http_response(200, "OK", &local_root_bindings_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_upsert_local_root_binding(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
) -> HttpResponse {
    let Some(root_id) = query.get("rootId").map(String::as_str) else {
        return http_response(400, "Bad Request", "{\"error\":\"rootId is required\"}");
    };
    let Some(root_path) = query.get("rootPath").map(String::as_str) else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };

    match runtime.upsert_local_root_binding(LocalRootBindingUpsertRequest {
        root_id: root_id.to_owned(),
        root_path: PathBuf::from(root_path),
    }) {
        Ok(response) => http_response(200, "OK", &local_root_binding_json(&response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

fn handle_list_local_directory(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
) -> HttpResponse {
    let Some(root_path) = query.get("rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_path = query
        .get("rootRelativePath")
        .map(String::as_str)
        .unwrap_or("");

    let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };

    match runtime.list_local_directory(ListDirectoryRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
        flattened: query.get("flattened").is_some_and(|value| value == "true"),
        entry_limit: parse_entry_limit(query.get("limit").map(String::as_str)),
        entry_offset: parse_entry_offset(query.get("offset").map(String::as_str)),
        query: parse_listing_query(query),
    }) {
        Ok(response) => http_response(200, "OK", &list_directory_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn parse_entry_limit(value: Option<&str>) -> Option<usize> {
    let limit = value?.parse::<usize>().ok()?;
    (limit > 0).then_some(limit)
}

fn parse_entry_offset(value: Option<&str>) -> usize {
    value
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0)
}

fn parse_listing_query(query: &HashMap<String, String>) -> ListingQuery {
    ListingQuery {
        name_contains: query
            .get("nameContains")
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty()),
        entry_filter: parse_listing_entry_filter(query.get("entryFilter").map(String::as_str)),
        order: ListingOrder {
            sort_key: parse_listing_sort_key(query.get("sortBy").map(String::as_str)),
            direction: parse_listing_sort_direction(query.get("sortOrder").map(String::as_str)),
        },
        hide_empty_folders: query
            .get("hideEmptyFolders")
            .is_some_and(|value| value == "true"),
    }
}

fn parse_listing_entry_filter(value: Option<&str>) -> ListingEntryFilter {
    match value {
        Some("image") => ListingEntryFilter::Image,
        Some("video") => ListingEntryFilter::Video,
        _ => ListingEntryFilter::All,
    }
}

fn parse_listing_sort_key(value: Option<&str>) -> ListingSortKey {
    match value {
        Some("date") => ListingSortKey::Date,
        Some("size") => ListingSortKey::Size,
        _ => ListingSortKey::Name,
    }
}

fn parse_listing_sort_direction(value: Option<&str>) -> ListingSortDirection {
    match value {
        Some("desc") => ListingSortDirection::Desc,
        _ => ListingSortDirection::Asc,
    }
}

fn handle_text_preview(runtime: &FauplayRuntime, query: &HashMap<String, String>) -> HttpResponse {
    let Some(root_path) = query.get("rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_path = query
        .get("rootRelativePath")
        .map(String::as_str)
        .unwrap_or("");
    let size_limit_bytes = query
        .get("sizeLimitBytes")
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(1024 * 1024);

    let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };

    match runtime.read_text_preview(TextPreviewRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
        size_limit_bytes,
    }) {
        Ok(response) => http_response(200, "OK", &text_preview_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_file_content(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
    range_header: Option<&str>,
) -> HttpResponse {
    let Some(root_path) = query.get("rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_path = query
        .get("rootRelativePath")
        .map(String::as_str)
        .unwrap_or("");

    let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };

    match runtime.read_file_content(FileContentRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
        range: range_header.and_then(parse_file_content_range),
    }) {
        Ok(response) => file_content_response(response),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_file_metadata(runtime: &FauplayRuntime, query: &HashMap<String, String>) -> HttpResponse {
    let Some(root_path) = query.get("rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_path = query
        .get("rootRelativePath")
        .map(String::as_str)
        .unwrap_or("");

    let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };

    match runtime.read_file_metadata(FileMetadataRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
    }) {
        Ok(response) => http_response(200, "OK", &file_metadata_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_find_duplicate_files(
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

fn handle_find_duplicate_files_json(runtime: &FauplayRuntime, request: &str) -> HttpResponse {
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

fn list_directory_response_json(response: crate::ListDirectoryResponse) -> String {
    let entries = response
        .entries
        .into_iter()
        .map(|entry| {
            let mut json = format!(
                "{{\"name\":\"{}\",\"rootRelativePath\":\"{}\",\"kind\":\"{}\"",
                escape_json_string(&entry.name),
                escape_json_string(&entry.root_relative_path.to_string()),
                directory_entry_kind_json(entry.kind),
            );

            if let Some(is_empty) = entry.is_empty {
                json.push_str(&format!(",\"isEmpty\":{is_empty}"));
            }
            if let Some(entry_count) = entry.entry_count {
                json.push_str(&format!(",\"entryCount\":{entry_count}"));
            }
            if let Some(size) = entry.size {
                json.push_str(&format!(",\"size\":{size}"));
            }
            if let Some(last_modified_ms) = entry.last_modified_ms {
                json.push_str(&format!(",\"lastModifiedMs\":{last_modified_ms}"));
            }

            json.push('}');
            json
        })
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"entries\":[{entries}],\"isTruncated\":{},\"nextOffset\":{}}}",
        response.is_truncated,
        optional_usize_json(response.next_offset)
    )
}

fn optional_usize_json(value: Option<usize>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_owned())
}

fn optional_u64_json(value: Option<u64>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_owned())
}

fn text_preview_response_json(response: crate::TextPreviewResponse) -> String {
    format!(
        "{{\"status\":\"{}\",\"content\":{},\"fileSizeBytes\":{},\"sizeLimitBytes\":{},\"error\":{}}}",
        text_preview_status_json(response.status),
        optional_string_json(response.content.as_deref()),
        response.file_size_bytes,
        response.size_limit_bytes,
        optional_string_json(response.error.as_deref()),
    )
}

fn file_metadata_response_json(response: FileMetadataResponse) -> String {
    let mut json = format!(
        "{{\"rootRelativePath\":\"{}\",\"size\":{}",
        escape_json_string(&response.root_relative_path.to_string()),
        response.size,
    );
    if let Some(last_modified_ms) = response.last_modified_ms {
        json.push_str(&format!(",\"lastModifiedMs\":{last_modified_ms}"));
    }
    json.push('}');
    json
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

fn global_shortcut_config_response_json(response: GlobalShortcutConfigResponse) -> String {
    let mut json = format!(
        "{{\"ok\":true,\"loaded\":{},\"path\":\"{}\"",
        response.loaded,
        escape_json_string(&response.path.display().to_string()),
    );
    if response.loaded {
        let config_json = response
            .config_json
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("null");
        json.push_str(&format!(",\"config\":{config_json}"));
    }
    json.push('}');
    json
}

fn local_root_bindings_response_json(response: LocalRootBindingsResponse) -> String {
    let items = response
        .items
        .iter()
        .map(local_root_binding_json)
        .collect::<Vec<_>>()
        .join(",");

    format!("{{\"items\":[{items}]}}")
}

fn local_root_binding_json(binding: &LocalRootBinding) -> String {
    format!(
        "{{\"rootId\":\"{}\",\"rootPath\":\"{}\"}}",
        escape_json_string(&binding.root_id),
        escape_json_string(&binding.root_path.display().to_string()),
    )
}

fn optional_path_json(value: Option<&PathBuf>) -> String {
    match value {
        Some(value) => format!("\"{}\"", escape_json_string(&value.display().to_string())),
        None => "null".to_owned(),
    }
}

fn duplicate_seed_skip_reason_json(value: DuplicateSeedSkipReason) -> &'static str {
    match value {
        DuplicateSeedSkipReason::SourceNotFound => "source_not_found",
        DuplicateSeedSkipReason::NotFile => "not_file",
    }
}

fn text_preview_status_json(status: TextPreviewStatus) -> &'static str {
    match status {
        TextPreviewStatus::Ready => "ready",
        TextPreviewStatus::TooLarge => "too_large",
        TextPreviewStatus::Binary => "binary",
    }
}

fn optional_string_json(value: Option<&str>) -> String {
    match value {
        Some(value) => format!("\"{}\"", escape_json_string(value)),
        None => "null".to_owned(),
    }
}

fn directory_entry_kind_json(kind: DirectoryEntryKind) -> &'static str {
    match kind {
        DirectoryEntryKind::Directory => "directory",
        DirectoryEntryKind::File => "file",
    }
}

fn error_json(message: &str) -> String {
    format!("{{\"error\":\"{}\"}}", escape_json_string(message))
}

fn escape_json_string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}
