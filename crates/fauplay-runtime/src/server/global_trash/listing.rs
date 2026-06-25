use std::collections::HashMap;

use crate::{FauplayRuntime, GlobalTrashListRequest, GlobalTrashListResponse};

use super::super::{
    HttpResponse, error_json, escape_json_string, http_response, optional_usize_json,
    parse_entry_limit, parse_entry_offset,
};

pub(in crate::server) fn handle_list_global_trash(
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
