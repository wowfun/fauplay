use std::collections::HashMap;
use std::time::{Duration, UNIX_EPOCH};

use crate::{
    AnnotationTagOptionsResponse, DirectoryEntryKind, FauplayRuntime, FileAnnotationFile,
    FileAnnotationMatchMode, FileAnnotationQueryResponse, FileAnnotationReadResponse,
    ListingEntryFilter, ListingOrder, ListingQuery, ListingSortDirection, ListingSortKey,
    RemoteAccessConfigResponse, RemoteAccessSessionAuthorizeRequest,
    RemoteAccessSessionLoginRequest, RemoteAccessSessionLogoutRequest, RemoteAccessSessionResponse,
    RemoteAccessTokenVerifyRequest, RemoteAnnotationTagOptionsRequest,
    RemoteFileAnnotationQueryRequest, RemoteFileAnnotationReadRequest, RemoteFileContentRequest,
    RemoteFileContentResponse, RemoteFileListRequest, RemoteFileListResponse,
    RemoteFileThumbnailRequest, RemoteFileThumbnailResponse, RemoteListingEntry,
    RemoteRootsResponse, RemoteTextPreviewRequest, RemoteTextPreviewResponse, RootRelativePath,
};

use super::{
    HttpResponse, binary_response_with_headers, error_json, escape_json_string, http_response,
    http_response_with_headers, json_bool_field, json_string_array_field, json_string_field,
    json_string_or_default, json_usize_or_default, optional_usize_json, parse_header_value,
    parse_json_body, text_preview_response_json,
};

const REMOTE_SESSION_COOKIE_NAME: &str = "__Host-fauplay-remote-session";
const REMOTE_REMEMBER_DEVICE_COOKIE_NAME: &str = "__Host-fauplay-remote-remember-device";
const REMOTE_CONTENT_CACHE_CONTROL: &str = "private, no-store";
const REMOTE_DERIVATIVE_CACHE_CONTROL: &str = "private, max-age=300";

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

pub(in crate::server) fn handle_remote_roots(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let headers = match authorize_remote_session_headers(runtime, request) {
        Ok(headers) => headers,
        Err(response) => return response,
    };

    match runtime.list_remote_roots() {
        Ok(response) => {
            http_response_with_headers(200, "OK", &remote_roots_json(response), headers)
        }
        Err(error) => remote_error_response(error, headers),
    }
}

pub(in crate::server) fn handle_remote_file_list(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let headers = match authorize_remote_session_headers(runtime, request) {
        Ok(headers) => headers,
        Err(response) => return response,
    };
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let Some(root_id) = json_string_field(&payload, "rootId") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootId is required\"}");
    };
    let path = json_string_or_default(&payload, "path", "");
    let path = match RootRelativePath::try_from(path.as_str()) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };

    match runtime.list_remote_files(RemoteFileListRequest {
        root_id: root_id.to_owned(),
        path,
        flatten_view: json_bool_field(&payload, "flattenView"),
        entry_limit: positive_usize_field(&payload, "limit"),
        entry_offset: positive_usize_field(&payload, "offset").unwrap_or(0),
        query: remote_listing_query(&payload),
    }) {
        Ok(response) => {
            http_response_with_headers(200, "OK", &remote_file_list_json(response), headers)
        }
        Err(error) => remote_error_response(error, headers),
    }
}

pub(in crate::server) fn handle_remote_file_content(
    runtime: &FauplayRuntime,
    request: &str,
    query: &HashMap<String, String>,
    range_header: Option<&str>,
) -> HttpResponse {
    let headers = match authorize_remote_session_headers(runtime, request) {
        Ok(headers) => headers,
        Err(response) => return response,
    };
    let Some(root_id) = query
        .get("rootId")
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return http_response(400, "Bad Request", "{\"error\":\"rootId is required\"}");
    };
    let path = query
        .get("relativePath")
        .map(String::as_str)
        .unwrap_or_default();
    let path = match RootRelativePath::try_from(path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };

    match runtime.read_remote_file_content(RemoteFileContentRequest {
        root_id: root_id.to_owned(),
        path,
        range_header: range_header.map(ToOwned::to_owned),
    }) {
        Ok(response) => remote_file_content_http_response(response, headers),
        Err(error) => remote_error_response(error, headers),
    }
}

pub(in crate::server) fn handle_remote_file_thumbnail(
    runtime: &FauplayRuntime,
    request: &str,
    query: &HashMap<String, String>,
) -> HttpResponse {
    let headers = match authorize_remote_session_headers(runtime, request) {
        Ok(headers) => headers,
        Err(response) => return response,
    };
    let Some(root_id) = query
        .get("rootId")
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return http_response(400, "Bad Request", "{\"error\":\"rootId is required\"}");
    };
    let path = query
        .get("relativePath")
        .map(String::as_str)
        .unwrap_or_default();
    let path = match RootRelativePath::try_from(path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };

    match runtime.read_remote_file_thumbnail(RemoteFileThumbnailRequest {
        root_id: root_id.to_owned(),
        path,
        size_preset: query
            .get("sizePreset")
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty()),
    }) {
        Ok(response) => remote_thumbnail_http_response(response, headers),
        Err(error) => remote_error_response(error, headers),
    }
}

pub(in crate::server) fn handle_remote_text_preview(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let headers = match authorize_remote_session_headers(runtime, request) {
        Ok(headers) => headers,
        Err(response) => return response,
    };
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let Some(root_id) = json_string_field(&payload, "rootId") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootId is required\"}");
    };
    let Some(relative_path) = json_string_field(&payload, "relativePath") else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"relativePath is required\"}",
        );
    };
    let path = match RootRelativePath::try_from(relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };
    let size_limit_bytes = payload
        .get("sizeLimitBytes")
        .and_then(serde_json::Value::as_u64)
        .filter(|value| *value > 0)
        .unwrap_or(64 * 1024);

    match runtime.read_remote_text_preview(RemoteTextPreviewRequest {
        root_id: root_id.to_owned(),
        path,
        size_limit_bytes,
    }) {
        Ok(response) => remote_text_preview_http_response(response, headers),
        Err(error) => remote_error_response(error, headers),
    }
}

pub(in crate::server) fn handle_remote_tag_options(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let headers = match authorize_remote_session_headers(runtime, request) {
        Ok(headers) => headers,
        Err(response) => return response,
    };
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let Some(root_id) = json_string_field(&payload, "rootId") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootId is required\"}");
    };

    match runtime.list_remote_annotation_tag_options(RemoteAnnotationTagOptionsRequest {
        root_id: root_id.to_owned(),
    }) {
        Ok(response) => http_response_with_headers(
            200,
            "OK",
            &remote_annotation_tag_options_response_json(response),
            headers,
        ),
        Err(error) => remote_error_response(error, headers),
    }
}

pub(in crate::server) fn handle_remote_tag_query(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let headers = match authorize_remote_session_headers(runtime, request) {
        Ok(headers) => headers,
        Err(response) => return response,
    };
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let Some(root_id) = json_string_field(&payload, "rootId") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootId is required\"}");
    };
    let page = json_usize_or_default(&payload, "page", 1)
        .unwrap_or(1)
        .max(1);
    let size = json_usize_or_default(&payload, "size", 500)
        .unwrap_or(500)
        .clamp(1, 5000);
    let include_match_mode =
        match json_string_or_default(&payload, "includeMatchMode", "or").as_str() {
            "and" => FileAnnotationMatchMode::And,
            _ => FileAnnotationMatchMode::Or,
        };

    match runtime.query_remote_file_annotations(RemoteFileAnnotationQueryRequest {
        root_id: root_id.to_owned(),
        include_tag_keys: json_string_array_field(&payload, "includeTagKeys"),
        exclude_tag_keys: json_string_array_field(&payload, "excludeTagKeys"),
        include_match_mode,
        page,
        size,
    }) {
        Ok(response) => http_response_with_headers(
            200,
            "OK",
            &remote_file_annotation_query_response_json(response),
            headers,
        ),
        Err(error) => remote_error_response(error, headers),
    }
}

pub(in crate::server) fn handle_remote_tag_file(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let headers = match authorize_remote_session_headers(runtime, request) {
        Ok(headers) => headers,
        Err(response) => return response,
    };
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let Some(root_id) = json_string_field(&payload, "rootId") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootId is required\"}");
    };
    let Some(relative_path) = json_string_field(&payload, "relativePath") else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"relativePath is required\"}",
        );
    };
    let path = match RootRelativePath::try_from(relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };

    match runtime.read_remote_file_annotation(RemoteFileAnnotationReadRequest {
        root_id: root_id.to_owned(),
        path,
    }) {
        Ok(response) => http_response_with_headers(
            200,
            "OK",
            &remote_file_annotation_read_response_json(response),
            headers,
        ),
        Err(error) => remote_error_response(error, headers),
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
    let headers = remote_session_set_cookie_headers(response.set_cookies);

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

fn authorize_remote_session_headers(
    runtime: &FauplayRuntime,
    request: &str,
) -> Result<Vec<(String, String)>, HttpResponse> {
    match runtime.authorize_remote_access_session(RemoteAccessSessionAuthorizeRequest {
        session_cookie: read_cookie_value(request, REMOTE_SESSION_COOKIE_NAME),
        remembered_device_cookie: read_cookie_value(request, REMOTE_REMEMBER_DEVICE_COOKIE_NAME),
    }) {
        Ok(response) if response.authorized => {
            Ok(remote_session_set_cookie_headers(response.set_cookies))
        }
        Ok(response) => Err(remote_session_http_response(response, false)),
        Err(error) => Err(http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        )),
    }
}

fn remote_session_set_cookie_headers(set_cookies: Vec<String>) -> Vec<(String, String)> {
    set_cookies
        .into_iter()
        .map(|cookie| ("Set-Cookie".to_owned(), cookie))
        .collect()
}

fn remote_error_response(
    error: crate::RuntimeError,
    headers: Vec<(String, String)>,
) -> HttpResponse {
    let message = error.to_string();
    if message.contains("Unknown Remote Root") {
        return http_response_with_headers(404, "Not Found", &error_json(&message), headers);
    }
    if message.to_ascii_lowercase().contains("not found") {
        return http_response_with_headers(404, "Not Found", &error_json(&message), headers);
    }
    if message.contains("escapes Remote Root") {
        return http_response_with_headers(403, "Forbidden", &error_json(&message), headers);
    }
    if message.contains("exceeds remote budget") {
        return http_response_with_headers(
            422,
            "Unprocessable Entity",
            &error_json(&message),
            headers,
        );
    }
    if message.contains("required") || message.contains("invalid Root-relative Path") {
        return http_response_with_headers(400, "Bad Request", &error_json(&message), headers);
    }
    if message.contains("relativePath must point to a file") {
        return http_response_with_headers(400, "Bad Request", &error_json(&message), headers);
    }
    http_response_with_headers(500, "Internal Server Error", &error_json(&message), headers)
}

fn remote_file_content_http_response(
    response: RemoteFileContentResponse,
    headers: Vec<(String, String)>,
) -> HttpResponse {
    match response {
        RemoteFileContentResponse::Content {
            content,
            last_modified_ms,
        } => {
            let mut headers = remote_file_content_headers(headers, last_modified_ms);
            headers.push(("Accept-Ranges".to_owned(), "bytes".to_owned()));
            if let Some(range) = content.range {
                headers.push((
                    "Content-Range".to_owned(),
                    format!(
                        "bytes {}-{}/{}",
                        range.start, range.end_inclusive, content.total_size
                    ),
                ));
                return binary_response_with_headers(
                    206,
                    "Partial Content",
                    &content.content_type,
                    content.bytes,
                    headers,
                );
            }

            binary_response_with_headers(200, "OK", &content.content_type, content.bytes, headers)
        }
        RemoteFileContentResponse::RangeNotSatisfiable {
            total_size,
            last_modified_ms,
        } => {
            let mut headers = remote_file_content_headers(headers, last_modified_ms);
            headers.push(("Accept-Ranges".to_owned(), "bytes".to_owned()));
            headers.push(("Content-Range".to_owned(), format!("bytes */{total_size}")));
            binary_response_with_headers(
                416,
                "Range Not Satisfiable",
                "application/octet-stream",
                Vec::new(),
                headers,
            )
        }
    }
}

fn remote_thumbnail_http_response(
    response: RemoteFileThumbnailResponse,
    headers: Vec<(String, String)>,
) -> HttpResponse {
    let mut headers = headers;
    headers.push((
        "Cache-Control".to_owned(),
        REMOTE_DERIVATIVE_CACHE_CONTROL.to_owned(),
    ));
    headers.push(("Accept-Ranges".to_owned(), "bytes".to_owned()));
    binary_response_with_headers(
        200,
        "OK",
        &response.content.content_type,
        response.content.bytes,
        headers,
    )
}

fn remote_text_preview_http_response(
    response: RemoteTextPreviewResponse,
    headers: Vec<(String, String)>,
) -> HttpResponse {
    http_response_with_headers(
        200,
        "OK",
        &text_preview_response_json(response.preview),
        headers,
    )
}

fn remote_annotation_tag_options_response_json(response: AnnotationTagOptionsResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(|item| {
            format!(
                "{{\"tagKey\":\"{}\",\"key\":\"{}\",\"value\":\"{}\",\"source\":\"{}\",\"fileCount\":{}}}",
                escape_json_string(&item.tag_key),
                escape_json_string(&item.key),
                escape_json_string(&item.value),
                escape_json_string(&item.source),
                item.file_count,
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!("{{\"ok\":true,\"items\":[{items}]}}")
}

fn remote_file_annotation_query_response_json(response: FileAnnotationQueryResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(remote_file_annotation_file_json)
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"ok\":true,\"page\":{},\"size\":{},\"total\":{},\"items\":[{items}]}}",
        response.page, response.size, response.total,
    )
}

fn remote_file_annotation_read_response_json(response: FileAnnotationReadResponse) -> String {
    match response.file {
        Some(file) => format!(
            "{{\"ok\":true,\"file\":{}}}",
            remote_file_annotation_file_json(file)
        ),
        None => "{\"ok\":true,\"file\":null}".to_owned(),
    }
}

fn remote_file_annotation_file_json(file: FileAnnotationFile) -> String {
    let root_relative_path = file.root_relative_path.to_string();
    let tags = file
        .tags
        .into_iter()
        .map(|tag| {
            format!(
                "{{\"key\":\"{}\",\"value\":\"{}\",\"source\":\"{}\",\"appliedAt\":{},\"updatedAt\":{}}}",
                escape_json_string(&tag.key),
                escape_json_string(&tag.value),
                escape_json_string(&tag.source),
                tag.applied_at_ms,
                tag.applied_at_ms,
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"relativePath\":\"{}\",\"rootRelativePath\":\"{}\",\"tags\":[{tags}]}}",
        escape_json_string(&root_relative_path),
        escape_json_string(&root_relative_path),
    )
}

fn remote_file_content_headers(
    mut headers: Vec<(String, String)>,
    last_modified_ms: Option<u64>,
) -> Vec<(String, String)> {
    headers.push((
        "Cache-Control".to_owned(),
        REMOTE_CONTENT_CACHE_CONTROL.to_owned(),
    ));
    if let Some(last_modified_ms) = last_modified_ms {
        headers.push((
            "Last-Modified".to_owned(),
            httpdate::fmt_http_date(UNIX_EPOCH + Duration::from_millis(last_modified_ms)),
        ));
    }
    headers
}

fn remote_roots_json(response: RemoteRootsResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(|item| {
            format!(
                "{{\"id\":\"{}\",\"label\":\"{}\"}}",
                escape_json_string(&item.id),
                escape_json_string(&item.label),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("{{\"ok\":true,\"items\":[{items}]}}")
}

fn remote_file_list_json(response: RemoteFileListResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(remote_listing_entry_json)
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"ok\":true,\"rootId\":\"{}\",\"path\":\"{}\",\"flattenView\":{},\"items\":[{}],\"isTruncated\":{},\"nextOffset\":{}}}",
        escape_json_string(&response.root_id),
        escape_json_string(&response.path.to_string()),
        response.flatten_view,
        items,
        response.is_truncated,
        optional_usize_json(response.next_offset),
    )
}

fn remote_listing_entry_json(entry: RemoteListingEntry) -> String {
    let mut json = format!(
        "{{\"name\":\"{}\",\"path\":\"{}\",\"kind\":\"{}\",\"displayPath\":\"{}\"",
        escape_json_string(&entry.name),
        escape_json_string(&entry.path.to_string()),
        directory_entry_kind_json(entry.kind),
        escape_json_string(&entry.path.to_string()),
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
    if let Some(mime_type) = entry.mime_type {
        json.push_str(&format!(
            ",\"mimeType\":\"{}\"",
            escape_json_string(&mime_type)
        ));
    }
    if let Some(preview_kind) = entry.preview_kind {
        json.push_str(&format!(
            ",\"previewKind\":\"{}\"",
            escape_json_string(&preview_kind)
        ));
    }

    json.push('}');
    json
}

fn directory_entry_kind_json(kind: DirectoryEntryKind) -> &'static str {
    match kind {
        DirectoryEntryKind::Directory => "directory",
        DirectoryEntryKind::File => "file",
    }
}

fn positive_usize_field(payload: &serde_json::Value, key: &str) -> Option<usize> {
    payload
        .get(key)
        .and_then(serde_json::Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| *value > 0)
}

fn remote_listing_query(payload: &serde_json::Value) -> ListingQuery {
    ListingQuery {
        name_contains: json_string_field(payload, "nameContains").map(ToOwned::to_owned),
        entry_filter: match json_string_field(payload, "entryFilter") {
            Some("image") => ListingEntryFilter::Image,
            Some("video") => ListingEntryFilter::Video,
            _ => ListingEntryFilter::All,
        },
        order: ListingOrder {
            sort_key: match json_string_field(payload, "sortBy") {
                Some("date") => ListingSortKey::Date,
                Some("size") => ListingSortKey::Size,
                _ => ListingSortKey::Name,
            },
            direction: match json_string_field(payload, "sortOrder") {
                Some("desc") => ListingSortDirection::Desc,
                _ => ListingSortDirection::Asc,
            },
        },
        hide_empty_folders: json_bool_field(payload, "hideEmptyFolders"),
    }
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
