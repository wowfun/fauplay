use std::collections::HashMap;
use std::path::PathBuf;

use crate::{
    FauplayRuntime, GlobalTrashFailureReason, GlobalTrashFileContentRequest,
    GlobalTrashFileMetadataRequest, GlobalTrashFileMetadataResponse, GlobalTrashListRequest,
    GlobalTrashListResponse, GlobalTrashMoveRequest, GlobalTrashMoveResponse,
    GlobalTrashRestoreRequest, GlobalTrashRestoreResponse, GlobalTrashTextPreviewRequest,
};

use super::{
    HttpResponse, error_json, escape_json_string, file_content_response, first_query_value,
    http_response, optional_path_json, optional_string_json, optional_usize_json,
    parse_entry_limit, parse_entry_offset, parse_file_content_range, query_values,
    text_preview_response_json,
};

pub(super) fn handle_list_global_trash(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
) -> HttpResponse {
    match runtime.list_global_trash(GlobalTrashListRequest {
        entry_limit: parse_entry_limit(query.get("limit").map(String::as_str)),
        entry_offset: parse_entry_offset(query.get("offset").map(String::as_str)),
    }) {
        Ok(response) => http_response(200, "OK", &global_trash_list_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(super) fn handle_global_trash_file_content(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
    range_header: Option<&str>,
) -> HttpResponse {
    let Some(recycle_id) = query.get("recycleId").map(String::as_str) else {
        return http_response(400, "Bad Request", "{\"error\":\"recycleId is required\"}");
    };

    match runtime.read_global_trash_file_content(GlobalTrashFileContentRequest {
        recycle_id: recycle_id.to_owned(),
        range: range_header.and_then(parse_file_content_range),
    }) {
        Ok(Some(response)) => file_content_response(response),
        Ok(None) => http_response(
            404,
            "Not Found",
            "{\"error\":\"Global Trash Entry was not found\"}",
        ),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(super) fn handle_global_trash_text_preview(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
) -> HttpResponse {
    let Some(recycle_id) = query.get("recycleId").map(String::as_str) else {
        return http_response(400, "Bad Request", "{\"error\":\"recycleId is required\"}");
    };
    let size_limit_bytes = query
        .get("sizeLimitBytes")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(64 * 1024);

    match runtime.read_global_trash_text_preview(GlobalTrashTextPreviewRequest {
        recycle_id: recycle_id.to_owned(),
        size_limit_bytes,
    }) {
        Ok(Some(response)) => http_response(200, "OK", &text_preview_response_json(response)),
        Ok(None) => http_response(
            404,
            "Not Found",
            "{\"error\":\"Global Trash Entry was not found\"}",
        ),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(super) fn handle_global_trash_file_metadata(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
) -> HttpResponse {
    let Some(recycle_id) = query.get("recycleId").map(String::as_str) else {
        return http_response(400, "Bad Request", "{\"error\":\"recycleId is required\"}");
    };

    match runtime.read_global_trash_file_metadata(GlobalTrashFileMetadataRequest {
        recycle_id: recycle_id.to_owned(),
    }) {
        Ok(Some(response)) => http_response(
            200,
            "OK",
            &global_trash_file_metadata_response_json(response),
        ),
        Ok(None) => http_response(
            404,
            "Not Found",
            "{\"error\":\"Global Trash Entry was not found\"}",
        ),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(super) fn handle_move_to_global_trash(
    runtime: &FauplayRuntime,
    query: &[(String, String)],
) -> HttpResponse {
    let absolute_paths = query_values(query, "absolutePath")
        .into_iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    if absolute_paths.is_empty() {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"absolutePath is required\"}",
        );
    }

    match runtime.move_to_global_trash(GlobalTrashMoveRequest {
        absolute_paths,
        dry_run: first_query_value(query, "dryRun").is_some_and(|value| value == "true"),
    }) {
        Ok(response) => http_response(200, "OK", &global_trash_move_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(super) fn handle_restore_global_trash(
    runtime: &FauplayRuntime,
    query: &[(String, String)],
) -> HttpResponse {
    let recycle_ids = query_values(query, "recycleId")
        .into_iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    if recycle_ids.is_empty() {
        return http_response(400, "Bad Request", "{\"error\":\"recycleId is required\"}");
    }

    match runtime.restore_global_trash(GlobalTrashRestoreRequest {
        recycle_ids,
        dry_run: first_query_value(query, "dryRun").is_some_and(|value| value == "true"),
    }) {
        Ok(response) => http_response(200, "OK", &global_trash_restore_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn global_trash_file_metadata_response_json(response: GlobalTrashFileMetadataResponse) -> String {
    let mut json = format!(
        "{{\"recycleId\":\"{}\",\"size\":{}",
        escape_json_string(&response.recycle_id),
        response.size,
    );
    if let Some(last_modified_ms) = response.last_modified_ms {
        json.push_str(&format!(",\"lastModifiedMs\":{last_modified_ms}"));
    }
    json.push('}');
    json
}

fn global_trash_list_response_json(response: GlobalTrashListResponse) -> String {
    let entries = response
        .entries
        .into_iter()
        .map(|entry| {
            let absolute_path = entry.absolute_path.display().to_string();
            let original_absolute_path = entry.original_absolute_path.display().to_string();
            let mut json = format!(
                "{{\"path\":\"{}\",\"absolutePath\":\"{}\",\"name\":\"{}\",\"kind\":\"file\",\"size\":{},\"mimeType\":\"{}\",\"previewKind\":\"{}\",\"displayPath\":\"{}\",\"deletedAt\":{},\"sourceType\":\"global_recycle\",\"recycleId\":\"{}\",\"originalAbsolutePath\":\"{}\"",
                escape_json_string(&absolute_path),
                escape_json_string(&absolute_path),
                escape_json_string(&entry.name),
                entry.size,
                escape_json_string(&entry.mime_type),
                escape_json_string(&entry.preview_kind),
                escape_json_string(&entry.display_path),
                entry.deleted_at_ms,
                escape_json_string(&entry.recycle_id),
                escape_json_string(&original_absolute_path),
            );
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

fn global_trash_move_response_json(response: GlobalTrashMoveResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(|item| {
            let mut json = format!(
                "{{\"sourceType\":\"global_recycle\",\"recycleId\":\"{}\",\"absolutePath\":\"{}\",\"nextAbsolutePath\":{},\"ok\":{},\"reason\":{},\"error\":{}",
                escape_json_string(&item.recycle_id),
                escape_json_string(&item.absolute_path.display().to_string()),
                optional_path_json(item.next_absolute_path.as_ref()),
                item.ok,
                optional_global_trash_failure_reason_json(item.reason),
                optional_string_json(item.error.as_deref()),
            );
            if let Some(deleted_at_ms) = item.deleted_at_ms {
                json.push_str(&format!(",\"deletedAt\":{deleted_at_ms}"));
            }
            json.push('}');
            json
        })
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"dryRun\":{},\"total\":{},\"moved\":{},\"failed\":{},\"items\":[{items}]}}",
        response.dry_run, response.total, response.moved, response.failed,
    )
}

fn global_trash_restore_response_json(response: GlobalTrashRestoreResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(|item| {
            format!(
                "{{\"sourceType\":\"global_recycle\",\"recycleId\":\"{}\",\"absolutePath\":\"{}\",\"originalAbsolutePath\":\"{}\",\"nextAbsolutePath\":{},\"ok\":{},\"reason\":{},\"error\":{}}}",
                escape_json_string(&item.recycle_id),
                escape_json_string(&item.absolute_path.display().to_string()),
                escape_json_string(&item.original_absolute_path.display().to_string()),
                optional_path_json(item.next_absolute_path.as_ref()),
                item.ok,
                optional_global_trash_failure_reason_json(item.reason),
                optional_string_json(item.error.as_deref()),
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"dryRun\":{},\"total\":{},\"restored\":{},\"failed\":{},\"items\":[{items}]}}",
        response.dry_run, response.total, response.restored, response.failed,
    )
}

fn optional_global_trash_failure_reason_json(value: Option<GlobalTrashFailureReason>) -> String {
    match value {
        Some(value) => format!("\"{}\"", global_trash_failure_reason_json(value)),
        None => "null".to_owned(),
    }
}

fn global_trash_failure_reason_json(value: GlobalTrashFailureReason) -> &'static str {
    match value {
        GlobalTrashFailureReason::RecycleItemNotFound => "recycle_item_not_found",
        GlobalTrashFailureReason::SourceNotFound => "source_not_found",
        GlobalTrashFailureReason::UnsupportedKind => "unsupported_kind",
        GlobalTrashFailureReason::TargetExists => "target_exists",
        GlobalTrashFailureReason::MutationFailed => "mutation_failed",
    }
}
