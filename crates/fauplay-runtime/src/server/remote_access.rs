use crate::{
    FauplayRuntime, RemoteAccessConfigResponse, RemoteAccessSessionAuthorizeRequest,
    RemoteAccessSessionLoginRequest, RemoteAccessSessionLogoutRequest, RemoteAccessSessionResponse,
    RemoteAccessTokenVerifyRequest,
};

use super::{
    HttpResponse, error_json, escape_json_string, http_response, http_response_with_headers,
    json_bool_field, json_string_or_default, parse_header_value, parse_json_body,
};

const REMOTE_SESSION_COOKIE_NAME: &str = "__Host-fauplay-remote-session";
const REMOTE_REMEMBER_DEVICE_COOKIE_NAME: &str = "__Host-fauplay-remote-remember-device";

pub(in crate::server) fn handle_remote_access_config(runtime: &FauplayRuntime) -> HttpResponse {
    match runtime.load_remote_access_config() {
        Ok(response) => http_response(200, "OK", &remote_access_config_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(in crate::server) fn handle_remote_access_authorize(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let bearer_token = json_string_or_default(&payload, "bearerToken", "");

    match runtime.verify_remote_access_token(RemoteAccessTokenVerifyRequest { bearer_token }) {
        Ok(true) => http_response(200, "OK", "{\"ok\":true}"),
        Ok(false) => http_response(
            401,
            "Unauthorized",
            "{\"ok\":false,\"error\":\"Unauthorized\",\"code\":\"REMOTE_UNAUTHORIZED\"}",
        ),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(in crate::server) fn handle_remote_session_login(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let bearer_token = read_bearer_token(request);
    let remember_device = json_bool_field(&payload, "rememberDevice");
    let remember_device_label = json_string_or_default(&payload, "rememberDeviceLabel", "");

    match runtime.login_remote_access_session(RemoteAccessSessionLoginRequest {
        bearer_token,
        remember_device,
        remember_device_label,
        remembered_device_cookie: read_cookie_value(request, REMOTE_REMEMBER_DEVICE_COOKIE_NAME),
        user_agent: parse_header_value(request, "user-agent")
            .unwrap_or_default()
            .to_owned(),
        client_id: read_remote_client_id(request),
    }) {
        Ok(response) => remote_session_http_response(response, false),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(in crate::server) fn handle_remote_session_authorize(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    match runtime.authorize_remote_access_session(RemoteAccessSessionAuthorizeRequest {
        session_cookie: read_cookie_value(request, REMOTE_SESSION_COOKIE_NAME),
        remembered_device_cookie: read_cookie_value(request, REMOTE_REMEMBER_DEVICE_COOKIE_NAME),
    }) {
        Ok(response) => remote_session_http_response(response, false),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(in crate::server) fn handle_remote_session_logout(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };

    match runtime.logout_remote_access_session(RemoteAccessSessionLogoutRequest {
        session_cookie: read_cookie_value(request, REMOTE_SESSION_COOKIE_NAME),
        remembered_device_cookie: read_cookie_value(request, REMOTE_REMEMBER_DEVICE_COOKIE_NAME),
        forget_device: json_bool_field(&payload, "forgetDevice"),
    }) {
        Ok(response) => remote_session_http_response(response, true),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn remote_access_config_json(response: RemoteAccessConfigResponse) -> String {
    let roots = response
        .roots
        .into_iter()
        .map(|item| {
            format!(
                "{{\"id\":\"{}\",\"label\":\"{}\",\"path\":\"{}\",\"realPath\":\"{}\"}}",
                escape_json_string(&item.id),
                escape_json_string(&item.label),
                escape_json_string(&item.path.display().to_string()),
                escape_json_string(&item.real_path.display().to_string()),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let config_sources = response
        .config_sources
        .into_iter()
        .map(|source| {
            format!(
                "{{\"label\":\"{}\",\"path\":\"{}\",\"loaded\":{}}}",
                escape_json_string(&source.label),
                escape_json_string(&source.path.display().to_string()),
                source.loaded,
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"ok\":true,\"enabled\":{},\"configured\":{},\"authConfigured\":{},\"rootSource\":\"{}\",\"roots\":[{}],\"configSources\":[{}],\"fingerprint\":\"{}\"}}",
        response.enabled,
        response.configured,
        response.auth_configured,
        escape_json_string(&response.root_source),
        roots,
        config_sources,
        escape_json_string(&response.fingerprint),
    )
}

fn remote_session_http_response(
    response: RemoteAccessSessionResponse,
    include_json_body: bool,
) -> HttpResponse {
    let headers = response
        .set_cookies
        .into_iter()
        .map(|cookie| ("Set-Cookie".to_owned(), cookie))
        .collect::<Vec<_>>();

    if response.authorized {
        if include_json_body {
            return http_response_with_headers(200, "OK", "{\"ok\":true}", headers);
        }
        return http_response_with_headers(204, "No Content", "", headers);
    }

    http_response_with_headers(
        401,
        "Unauthorized",
        "{\"ok\":false,\"error\":\"Unauthorized\",\"code\":\"REMOTE_UNAUTHORIZED\"}",
        headers,
    )
}

fn read_bearer_token(request: &str) -> String {
    let Some(header) = parse_header_value(request, "authorization") else {
        return String::new();
    };
    header
        .trim()
        .strip_prefix("Bearer ")
        .map(str::trim)
        .unwrap_or_default()
        .to_owned()
}

fn read_cookie_value(request: &str, cookie_name: &str) -> String {
    let Some(header) = parse_header_value(request, "cookie") else {
        return String::new();
    };
    for part in header.split(';') {
        let Some((name, value)) = part.split_once('=') else {
            continue;
        };
        if name.trim() == cookie_name {
            return value.trim().to_owned();
        }
    }
    String::new()
}

fn read_remote_client_id(request: &str) -> String {
    if let Some(forwarded_for) = parse_header_value(request, "x-forwarded-for") {
        if let Some(first_hop) = forwarded_for.split(',').next().map(str::trim) {
            if !first_hop.is_empty() {
                return first_hop.to_owned();
            }
        }
    }
    parse_header_value(request, "x-real-ip")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown")
        .to_owned()
}
