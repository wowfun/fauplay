use std::collections::HashMap;

use crate::{
    FauplayRuntime, GlobalTrashFileContentRequest, GlobalTrashFileMetadataRequest,
    GlobalTrashFileMetadataResponse, GlobalTrashTextPreviewRequest,
};

use super::super::{
    HttpResponse, error_json, escape_json_string, file_content_response, http_response,
    parse_file_content_range, text_preview_response_json,
};

pub(in crate::server) fn handle_global_trash_file_content(
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

pub(in crate::server) fn handle_global_trash_text_preview(
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

pub(in crate::server) fn handle_global_trash_file_metadata(
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
