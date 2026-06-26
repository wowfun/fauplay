use crate::{FauplayRuntime, RemoteAccessConfigResponse, RemoteAccessTokenVerifyRequest};

use super::{
    HttpResponse, error_json, escape_json_string, http_response, json_string_or_default,
    parse_json_body,
};

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
