use std::path::PathBuf;

use crate::{
    FauplayRuntime, RemotePublishedRootSyncEntry, RemotePublishedRootSyncRequest,
    RemotePublishedRootsResponse, RemoteSharedFavorite, RemoteSharedFavoriteRemoveRequest,
    RemoteSharedFavoriteUpsertRequest, RemoteSharedFavoritesResponse,
};

use super::{
    HttpResponse, error_json, escape_json_string, http_response, json_string_field, parse_json_body,
};

pub(in crate::server) fn handle_list_shared_favorites(runtime: &FauplayRuntime) -> HttpResponse {
    match runtime.list_remote_shared_favorites() {
        Ok(response) => http_response(200, "OK", &remote_shared_favorites_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(in crate::server) fn handle_list_resolved_published_roots(
    runtime: &FauplayRuntime,
) -> HttpResponse {
    match runtime.list_resolved_remote_published_roots() {
        Ok(response) => http_response(200, "OK", &remote_published_roots_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(in crate::server) fn handle_upsert_shared_favorite(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let Some(root_id) = json_string_field(&payload, "rootId") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootId is required\"}");
    };
    let path = json_string_field(&payload, "path").unwrap_or_default();

    match runtime.upsert_remote_shared_favorite(RemoteSharedFavoriteUpsertRequest {
        root_id: root_id.to_owned(),
        path: path.to_owned(),
        favorited_at_ms: json_u64_field(&payload, "favoritedAtMs"),
    }) {
        Ok(item) => http_response(
            200,
            "OK",
            &format!(
                "{{\"ok\":true,\"item\":{}}}",
                remote_shared_favorite_json(item),
            ),
        ),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

pub(in crate::server) fn handle_remove_shared_favorite(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let Some(root_id) = json_string_field(&payload, "rootId") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootId is required\"}");
    };
    let path = json_string_field(&payload, "path").unwrap_or_default();

    match runtime.remove_remote_shared_favorite(RemoteSharedFavoriteRemoveRequest {
        root_id: root_id.to_owned(),
        path: path.to_owned(),
    }) {
        Ok(response) => http_response(
            200,
            "OK",
            &format!("{{\"ok\":true,\"removed\":{}}}", response.removed),
        ),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

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

fn remote_shared_favorites_response_json(response: RemoteSharedFavoritesResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(remote_shared_favorite_json)
        .collect::<Vec<_>>()
        .join(",");

    format!("{{\"ok\":true,\"items\":[{items}]}}")
}

fn remote_published_roots_response_json(response: RemotePublishedRootsResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(|item| {
            format!(
                "{{\"id\":\"{}\",\"label\":\"{}\",\"absolutePath\":\"{}\",\"realPath\":\"{}\"}}",
                escape_json_string(&item.id),
                escape_json_string(&item.label),
                escape_json_string(&item.absolute_path.display().to_string()),
                escape_json_string(&item.real_path.display().to_string()),
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!("{{\"ok\":true,\"items\":[{items}]}}")
}

fn remote_shared_favorite_json(item: RemoteSharedFavorite) -> String {
    format!(
        "{{\"rootId\":\"{}\",\"path\":\"{}\",\"favoritedAtMs\":{}}}",
        escape_json_string(&item.root_id),
        escape_json_string(&item.path),
        item.favorited_at_ms,
    )
}

fn json_u64_field(payload: &serde_json::Value, key: &str) -> Option<u64> {
    let value = payload.get(key)?;
    if let Some(value) = value.as_u64() {
        return Some(value);
    }
    let value = value.as_f64()?;
    value.is_finite().then_some(value.max(0.0).trunc() as u64)
}
