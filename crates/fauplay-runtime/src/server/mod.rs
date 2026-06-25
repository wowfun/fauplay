use std::path::PathBuf;

use crate::{FauplayRuntime, TextPreviewStatus};

mod file_annotations;
mod file_index;
mod global_trash;
mod http;
mod local_files;
mod local_root_bindings;
mod missing_files;
mod request;
mod root_operations;
mod runtime_config;

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
        Some(("GET", "/v1/config/shortcuts")) => {
            runtime_config::handle_global_shortcut_config(runtime)
        }
        Some(("GET", target))
            if target == "/v1/local-root-bindings"
                || target.starts_with("/v1/local-root-bindings?") =>
        {
            local_root_bindings::handle_list_local_root_bindings(runtime)
        }
        Some(("PUT", target)) if target.starts_with("/v1/local-root-bindings?") => {
            let query = parse_query_string(&target["/v1/local-root-bindings?".len()..]);
            local_root_bindings::handle_upsert_local_root_binding(runtime, &query)
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
            local_files::handle_list_local_directory(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/text-preview?") => {
            let query = parse_query_string(&target["/v1/text-preview?".len()..]);
            local_files::handle_text_preview(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/file-content?") => {
            let query = parse_query_string(&target["/v1/file-content?".len()..]);
            local_files::handle_file_content(runtime, &query, parse_header_value(request, "range"))
        }
        Some(("GET", target)) if target.starts_with("/v1/file-metadata?") => {
            let query = parse_query_string(&target["/v1/file-metadata?".len()..]);
            local_files::handle_file_metadata(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/duplicate-files?") => {
            let query = parse_query_pairs(&target["/v1/duplicate-files?".len()..]);
            local_files::handle_find_duplicate_files(runtime, &query)
        }
        Some(("POST", "/v1/duplicate-files")) => {
            local_files::handle_find_duplicate_files_json(runtime, request)
        }
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
            missing_files::handle_cleanup_missing_file_annotations_json(runtime, request)
        }
        Some(("POST", "/v1/files/indexes")) => {
            file_index::handle_ensure_file_index_entries_json(runtime, request)
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

fn parse_entry_limit(value: Option<&str>) -> Option<usize> {
    let limit = value?.parse::<usize>().ok()?;
    (limit > 0).then_some(limit)
}

fn parse_entry_offset(value: Option<&str>) -> usize {
    value
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0)
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

fn optional_path_json(value: Option<&PathBuf>) -> String {
    match value {
        Some(value) => format!("\"{}\"", escape_json_string(&value.display().to_string())),
        None => "null".to_owned(),
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
