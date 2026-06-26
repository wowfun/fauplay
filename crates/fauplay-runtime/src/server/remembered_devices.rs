use crate::{
    FauplayRuntime, RememberedDeviceCreateRequest, RememberedDeviceCredential,
    RememberedDeviceRevokeRequest, RememberedDeviceRevokeResponse, RememberedDeviceRotateRequest,
    RememberedDevicesAdminResponse,
};

use super::{
    HttpResponse, error_json, escape_json_string, http_response, json_string_or_default,
    parse_json_body, percent_decode,
};

pub(in crate::server) fn handle_list_remembered_devices(runtime: &FauplayRuntime) -> HttpResponse {
    match runtime.list_remembered_devices() {
        Ok(response) => http_response(200, "OK", &remembered_devices_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(in crate::server) fn handle_create_remembered_device(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };

    match runtime.create_remembered_device(RememberedDeviceCreateRequest {
        label: json_string_or_default(&payload, "label", ""),
        user_agent: json_string_or_default(&payload, "userAgent", ""),
    }) {
        Ok(device) => http_response(
            200,
            "OK",
            &format!(
                "{{\"ok\":true,\"device\":{}}}",
                remembered_device_credential_json(device),
            ),
        ),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(in crate::server) fn handle_rotate_remembered_device(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };

    match runtime.rotate_remembered_device(RememberedDeviceRotateRequest {
        cookie_value: json_string_or_default(&payload, "cookieValue", ""),
    }) {
        Ok(Some(device)) => http_response(
            200,
            "OK",
            &format!(
                "{{\"ok\":true,\"device\":{}}}",
                remembered_device_credential_json(device),
            ),
        ),
        Ok(None) => http_response(404, "Not Found", "{\"error\":\"not found\"}"),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(in crate::server) fn handle_revoke_remembered_device_credential(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };

    match runtime.revoke_remembered_device_credential(RememberedDeviceRevokeRequest {
        cookie_value: json_string_or_default(&payload, "cookieValue", ""),
    }) {
        Ok(response) => http_response(
            200,
            "OK",
            &format!(
                "{{\"ok\":true,\"revokedDeviceIds\":{}}}",
                remembered_device_ids_json(response),
            ),
        ),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(in crate::server) fn handle_rename_remembered_device(
    runtime: &FauplayRuntime,
    target: &str,
    request: &str,
) -> HttpResponse {
    let device_id = match remembered_device_id_from_target(target) {
        Ok(device_id) => device_id,
        Err(response) => return response,
    };
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let Some(label) = payload.get("label").and_then(serde_json::Value::as_str) else {
        return http_response(400, "Bad Request", "{\"error\":\"label is required\"}");
    };

    match runtime.rename_remembered_device(device_id, label.to_owned()) {
        Ok(true) => http_response(200, "OK", "{\"ok\":true}"),
        Ok(false) => http_response(404, "Not Found", "{\"error\":\"not found\"}"),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(in crate::server) fn handle_revoke_remembered_device(
    runtime: &FauplayRuntime,
    target: &str,
) -> HttpResponse {
    let device_id = match remembered_device_id_from_target(target) {
        Ok(device_id) => device_id,
        Err(response) => return response,
    };

    match runtime.revoke_remembered_device(device_id) {
        Ok(true) => http_response(200, "OK", "{\"ok\":true}"),
        Ok(false) => http_response(404, "Not Found", "{\"error\":\"not found\"}"),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(in crate::server) fn handle_revoke_all_remembered_devices(
    runtime: &FauplayRuntime,
) -> HttpResponse {
    match runtime.revoke_all_remembered_devices() {
        Ok(()) => http_response(200, "OK", "{\"ok\":true}"),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn remembered_device_id_from_target(target: &str) -> Result<String, HttpResponse> {
    let target = target
        .split_once('?')
        .map(|(path, _)| path)
        .unwrap_or(target);
    let raw_device_id = target
        .strip_prefix("/v1/admin/remembered-devices/")
        .unwrap_or_default();
    let device_id = percent_decode(raw_device_id).trim().to_owned();
    if device_id.is_empty() || device_id.contains('/') {
        return Err(http_response(404, "Not Found", "{\"error\":\"not found\"}"));
    }
    Ok(device_id)
}

fn remembered_devices_response_json(response: RememberedDevicesAdminResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(|item| {
            format!(
                "{{\"id\":\"{}\",\"label\":\"{}\",\"autoLabel\":\"{}\",\"userAgentSummary\":\"{}\",\"createdAtMs\":{},\"lastUsedAtMs\":{},\"expiresAtMs\":{}}}",
                escape_json_string(&item.id),
                escape_json_string(&item.label),
                escape_json_string(&item.auto_label),
                escape_json_string(&item.user_agent_summary),
                item.created_at_ms,
                item.last_used_at_ms,
                item.expires_at_ms,
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!("{{\"items\":[{items}]}}")
}

fn remembered_device_credential_json(device: RememberedDeviceCredential) -> String {
    format!(
        "{{\"id\":\"{}\",\"cookieValue\":\"{}\",\"label\":\"{}\",\"autoLabel\":\"{}\",\"userAgentSummary\":\"{}\",\"expiresAtMs\":{}}}",
        escape_json_string(&device.id),
        escape_json_string(&device.cookie_value),
        escape_json_string(&device.label),
        escape_json_string(&device.auto_label),
        escape_json_string(&device.user_agent_summary),
        device.expires_at_ms,
    )
}

fn remembered_device_ids_json(response: RememberedDeviceRevokeResponse) -> String {
    let ids = response
        .revoked_device_ids
        .into_iter()
        .map(|id| format!("\"{}\"", escape_json_string(&id)))
        .collect::<Vec<_>>()
        .join(",");
    format!("[{ids}]")
}
