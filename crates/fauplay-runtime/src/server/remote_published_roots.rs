use std::path::PathBuf;

use crate::{FauplayRuntime, RemotePublishedRootSyncEntry, RemotePublishedRootSyncRequest};

use super::{HttpResponse, error_json, http_response, parse_json_body};

pub(in crate::server) fn handle_sync_from_local_browser(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let Some(items) = payload.as_array() else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"Request body must be a JSON array\"}",
        );
    };

    let request = RemotePublishedRootSyncRequest {
        items: items
            .iter()
            .filter_map(remote_published_root_sync_entry_from_json)
            .collect(),
    };

    match runtime.sync_remote_published_roots(request) {
        Ok(response) => http_response(
            200,
            "OK",
            &format!(
                "{{\"ok\":true,\"publishedRootCount\":{}}}",
                response.published_root_count,
            ),
        ),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn remote_published_root_sync_entry_from_json(
    value: &serde_json::Value,
) -> Option<RemotePublishedRootSyncEntry> {
    let object = value.as_object()?;
    let label = object
        .get("label")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let absolute_path = object
        .get("absolutePath")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let favorite_paths = object
        .get("favoritePaths")
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default();

    Some(RemotePublishedRootSyncEntry {
        label,
        absolute_path: PathBuf::from(absolute_path),
        favorite_paths,
    })
}
