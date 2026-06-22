use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;

use crate::{
    DirectoryEntryKind, FauplayRuntime, FileContentRangeRequest, FileContentRequest,
    FileContentResponse, FileMetadataRequest, FileMetadataResponse, GlobalShortcutConfigResponse,
    GlobalTrashFailureReason, GlobalTrashListRequest, GlobalTrashListResponse,
    GlobalTrashMoveRequest, GlobalTrashMoveResponse, GlobalTrashRestoreRequest,
    GlobalTrashRestoreResponse, ListDirectoryRequest, ListingEntryFilter, ListingOrder,
    ListingQuery, ListingSortDirection, ListingSortKey, RootMoveFailureReason, RootMoveRequest,
    RootMoveResponse, RootRelativePath, RootTrashFailureReason, RootTrashListRequest,
    RootTrashListResponse, RootTrashMutationResponse, RootTrashRequest, RuntimeError,
    TextPreviewRequest, TextPreviewStatus,
};

const REQUEST_CHUNK_SIZE: usize = 1024;

pub fn serve_one_http_request(
    listener: TcpListener,
    runtime: FauplayRuntime,
) -> Result<(), RuntimeError> {
    let (mut stream, _) = listener
        .accept()
        .map_err(|source| RuntimeError::network("failed to accept Runtime API request", source))?;

    serve_http_stream(&runtime, &mut stream)
}

pub fn serve_http(listener: TcpListener, runtime: FauplayRuntime) -> Result<(), RuntimeError> {
    for stream_result in listener.incoming() {
        let mut stream = stream_result.map_err(|source| {
            RuntimeError::network("failed to accept Runtime API request", source)
        })?;
        serve_http_stream(&runtime, &mut stream)?;
    }

    Ok(())
}

fn serve_http_stream(runtime: &FauplayRuntime, stream: &mut TcpStream) -> Result<(), RuntimeError> {
    let request = read_http_request(&mut *stream)?;
    let response = handle_http_request(runtime, &request);
    let response_bytes = response.into_bytes();

    stream
        .write_all(&response_bytes)
        .map_err(|source| RuntimeError::network("failed to write Runtime API response", source))?;

    Ok(())
}

fn read_http_request(stream: &mut impl Read) -> Result<String, RuntimeError> {
    let mut request = Vec::new();
    let mut buffer = [0_u8; REQUEST_CHUNK_SIZE];

    loop {
        let byte_count = stream.read(&mut buffer).map_err(|source| {
            RuntimeError::network("failed to read Runtime API request", source)
        })?;
        if byte_count == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..byte_count]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }

    Ok(String::from_utf8_lossy(&request).into_owned())
}

fn handle_http_request(runtime: &FauplayRuntime, request: &str) -> HttpResponse {
    match parse_http_request_line(request) {
        Some(("GET", "/v1/health")) => http_response(
            200,
            "OK",
            "{\"status\":\"ok\",\"runtime\":\"fauplay-runtime\"}",
        ),
        Some(("GET", "/v1/config/shortcuts")) => handle_global_shortcut_config(runtime),
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
            handle_list_global_trash(runtime, &query)
        }
        Some(("POST", target))
            if target == "/v1/global-trash/move"
                || target.starts_with("/v1/global-trash/move?") =>
        {
            let query = target
                .strip_prefix("/v1/global-trash/move?")
                .map(parse_query_pairs)
                .unwrap_or_default();
            handle_move_to_global_trash(runtime, &query)
        }
        Some(("POST", target))
            if target == "/v1/global-trash/restore"
                || target.starts_with("/v1/global-trash/restore?") =>
        {
            let query = target
                .strip_prefix("/v1/global-trash/restore?")
                .map(parse_query_pairs)
                .unwrap_or_default();
            handle_restore_global_trash(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/local-directory?") => {
            let query = parse_query_string(&target["/v1/local-directory?".len()..]);
            handle_list_local_directory(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/text-preview?") => {
            let query = parse_query_string(&target["/v1/text-preview?".len()..]);
            handle_text_preview(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/file-content?") => {
            let query = parse_query_string(&target["/v1/file-content?".len()..]);
            handle_file_content(runtime, &query, parse_header_value(request, "range"))
        }
        Some(("GET", target)) if target.starts_with("/v1/file-metadata?") => {
            let query = parse_query_string(&target["/v1/file-metadata?".len()..]);
            handle_file_metadata(runtime, &query)
        }
        Some(("POST", target))
            if target == "/v1/root-move" || target.starts_with("/v1/root-move?") =>
        {
            let query = target
                .strip_prefix("/v1/root-move?")
                .map(parse_query_string)
                .unwrap_or_default();
            handle_root_move(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/root-trash?") => {
            let query = parse_query_string(&target["/v1/root-trash?".len()..]);
            handle_list_root_trash(runtime, &query)
        }
        Some(("POST", target)) if target.starts_with("/v1/root-trash/move?") => {
            let query = parse_query_pairs(&target["/v1/root-trash/move?".len()..]);
            handle_move_to_root_trash(runtime, &query)
        }
        Some(("POST", target)) if target.starts_with("/v1/root-trash/restore?") => {
            let query = parse_query_pairs(&target["/v1/root-trash/restore?".len()..]);
            handle_restore_from_root_trash(runtime, &query)
        }
        _ => http_response(404, "Not Found", "{\"error\":\"not found\"}"),
    }
}

fn is_preflight_target(target: &str) -> bool {
    matches!(
        target,
        "/v1/local-directory"
            | "/v1/config/shortcuts"
            | "/v1/global-trash"
            | "/v1/global-trash/move"
            | "/v1/global-trash/restore"
            | "/v1/text-preview"
            | "/v1/file-content"
            | "/v1/file-metadata"
            | "/v1/root-move"
            | "/v1/root-trash"
            | "/v1/root-trash/move"
            | "/v1/root-trash/restore"
    )
}

fn handle_global_shortcut_config(runtime: &FauplayRuntime) -> HttpResponse {
    match runtime.load_global_shortcut_config() {
        Ok(response) => http_response(200, "OK", &global_shortcut_config_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_list_global_trash(
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

fn handle_move_to_global_trash(
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

fn handle_restore_global_trash(
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

fn handle_list_local_directory(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
) -> HttpResponse {
    let Some(root_path) = query.get("rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_path = query
        .get("rootRelativePath")
        .map(String::as_str)
        .unwrap_or("");

    let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };

    match runtime.list_local_directory(ListDirectoryRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
        flattened: query.get("flattened").is_some_and(|value| value == "true"),
        entry_limit: parse_entry_limit(query.get("limit").map(String::as_str)),
        entry_offset: parse_entry_offset(query.get("offset").map(String::as_str)),
        query: parse_listing_query(query),
    }) {
        Ok(response) => http_response(200, "OK", &list_directory_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
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

fn parse_listing_query(query: &HashMap<String, String>) -> ListingQuery {
    ListingQuery {
        name_contains: query
            .get("nameContains")
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty()),
        entry_filter: parse_listing_entry_filter(query.get("entryFilter").map(String::as_str)),
        order: ListingOrder {
            sort_key: parse_listing_sort_key(query.get("sortBy").map(String::as_str)),
            direction: parse_listing_sort_direction(query.get("sortOrder").map(String::as_str)),
        },
        hide_empty_folders: query
            .get("hideEmptyFolders")
            .is_some_and(|value| value == "true"),
    }
}

fn parse_listing_entry_filter(value: Option<&str>) -> ListingEntryFilter {
    match value {
        Some("image") => ListingEntryFilter::Image,
        Some("video") => ListingEntryFilter::Video,
        _ => ListingEntryFilter::All,
    }
}

fn parse_listing_sort_key(value: Option<&str>) -> ListingSortKey {
    match value {
        Some("date") => ListingSortKey::Date,
        Some("size") => ListingSortKey::Size,
        _ => ListingSortKey::Name,
    }
}

fn parse_listing_sort_direction(value: Option<&str>) -> ListingSortDirection {
    match value {
        Some("desc") => ListingSortDirection::Desc,
        _ => ListingSortDirection::Asc,
    }
}

fn handle_text_preview(runtime: &FauplayRuntime, query: &HashMap<String, String>) -> HttpResponse {
    let Some(root_path) = query.get("rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_path = query
        .get("rootRelativePath")
        .map(String::as_str)
        .unwrap_or("");
    let size_limit_bytes = query
        .get("sizeLimitBytes")
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(1024 * 1024);

    let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };

    match runtime.read_text_preview(TextPreviewRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
        size_limit_bytes,
    }) {
        Ok(response) => http_response(200, "OK", &text_preview_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_file_content(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
    range_header: Option<&str>,
) -> HttpResponse {
    let Some(root_path) = query.get("rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_path = query
        .get("rootRelativePath")
        .map(String::as_str)
        .unwrap_or("");

    let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };

    match runtime.read_file_content(FileContentRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
        range: range_header.and_then(parse_file_content_range),
    }) {
        Ok(response) => file_content_response(response),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_file_metadata(runtime: &FauplayRuntime, query: &HashMap<String, String>) -> HttpResponse {
    let Some(root_path) = query.get("rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_path = query
        .get("rootRelativePath")
        .map(String::as_str)
        .unwrap_or("");

    let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };

    match runtime.read_file_metadata(FileMetadataRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
    }) {
        Ok(response) => http_response(200, "OK", &file_metadata_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_root_move(runtime: &FauplayRuntime, query: &HashMap<String, String>) -> HttpResponse {
    let Some(root_path) = query.get("rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let Some(source_root_relative_path) = query.get("sourceRootRelativePath") else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"sourceRootRelativePath is required\"}",
        );
    };
    let Some(target_root_relative_path) = query.get("targetRootRelativePath") else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"targetRootRelativePath is required\"}",
        );
    };

    let source_root_relative_path =
        match RootRelativePath::try_from(source_root_relative_path.as_str()) {
            Ok(path) => path,
            Err(error) => {
                return http_response(400, "Bad Request", &error_json(&error.to_string()));
            }
        };
    let target_root_relative_path =
        match RootRelativePath::try_from(target_root_relative_path.as_str()) {
            Ok(path) => path,
            Err(error) => {
                return http_response(400, "Bad Request", &error_json(&error.to_string()));
            }
        };

    match runtime.move_root_path(RootMoveRequest {
        root_path: PathBuf::from(root_path),
        source_root_relative_path,
        target_root_relative_path,
        dry_run: query.get("dryRun").is_some_and(|value| value == "true"),
    }) {
        Ok(response) => http_response(200, "OK", &root_move_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_list_root_trash(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
) -> HttpResponse {
    let Some(root_path) = query.get("rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };

    match runtime.list_root_trash(RootTrashListRequest {
        root_path: PathBuf::from(root_path),
        entry_limit: parse_entry_limit(query.get("limit").map(String::as_str)),
        entry_offset: parse_entry_offset(query.get("offset").map(String::as_str)),
    }) {
        Ok(response) => http_response(200, "OK", &root_trash_list_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_move_to_root_trash(runtime: &FauplayRuntime, query: &[(String, String)]) -> HttpResponse {
    handle_root_trash_mutation(runtime, query, RootTrashMutationKind::Move)
}

fn handle_restore_from_root_trash(
    runtime: &FauplayRuntime,
    query: &[(String, String)],
) -> HttpResponse {
    handle_root_trash_mutation(runtime, query, RootTrashMutationKind::Restore)
}

#[derive(Debug, Clone, Copy)]
enum RootTrashMutationKind {
    Move,
    Restore,
}

fn handle_root_trash_mutation(
    runtime: &FauplayRuntime,
    query: &[(String, String)],
    kind: RootTrashMutationKind,
) -> HttpResponse {
    let Some(root_path) = first_query_value(query, "rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_paths = query_values(query, "rootRelativePath");
    if root_relative_paths.is_empty() {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"rootRelativePath is required\"}",
        );
    };
    let mut parsed_root_relative_paths = Vec::with_capacity(root_relative_paths.len());
    for root_relative_path in root_relative_paths {
        let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
            Ok(path) => path,
            Err(error) => {
                return http_response(400, "Bad Request", &error_json(&error.to_string()));
            }
        };
        parsed_root_relative_paths.push(root_relative_path);
    }
    let request = RootTrashRequest {
        root_path: PathBuf::from(root_path),
        root_relative_paths: parsed_root_relative_paths,
        dry_run: first_query_value(query, "dryRun").is_some_and(|value| value == "true"),
    };
    let result = match kind {
        RootTrashMutationKind::Move => runtime.move_to_root_trash(request),
        RootTrashMutationKind::Restore => runtime.restore_from_root_trash(request),
    };

    match result {
        Ok(response) => http_response(200, "OK", &root_trash_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn parse_header_value<'a>(request: &'a str, header_name: &str) -> Option<&'a str> {
    for line in request.lines().skip(1) {
        if line.is_empty() {
            break;
        }
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case(header_name) {
            return Some(value.trim());
        }
    }

    None
}

fn parse_http_request_line(request: &str) -> Option<(&str, &str)> {
    let line = request.lines().next()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?;
    let target = parts.next()?;
    Some((method, target))
}

fn parse_query_string(query: &str) -> HashMap<String, String> {
    let mut values = HashMap::new();

    for (key, value) in parse_query_pairs(query) {
        values.insert(key, value);
    }

    values
}

fn parse_query_pairs(query: &str) -> Vec<(String, String)> {
    let mut values = Vec::new();

    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or_default();
        let value = parts.next().unwrap_or_default();
        values.push((percent_decode(key), percent_decode(value)));
    }

    values
}

fn first_query_value<'a>(query: &'a [(String, String)], key: &str) -> Option<&'a str> {
    query
        .iter()
        .find(|(candidate_key, _)| candidate_key == key)
        .map(|(_, value)| value.as_str())
}

fn query_values<'a>(query: &'a [(String, String)], key: &str) -> Vec<&'a str> {
    query
        .iter()
        .filter_map(|(candidate_key, value)| (candidate_key == key).then_some(value.as_str()))
        .collect()
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Some(byte) = decode_hex_byte(bytes[index + 1], bytes[index + 2]) {
                decoded.push(byte);
                index += 3;
                continue;
            }
        }

        if bytes[index] == b'+' {
            decoded.push(b' ');
        } else {
            decoded.push(bytes[index]);
        }
        index += 1;
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

fn decode_hex_byte(high: u8, low: u8) -> Option<u8> {
    Some(decode_hex_digit(high)? * 16 + decode_hex_digit(low)?)
}

fn decode_hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn list_directory_response_json(response: crate::ListDirectoryResponse) -> String {
    let entries = response
        .entries
        .into_iter()
        .map(|entry| {
            let mut json = format!(
                "{{\"name\":\"{}\",\"rootRelativePath\":\"{}\",\"kind\":\"{}\"",
                escape_json_string(&entry.name),
                escape_json_string(&entry.root_relative_path.to_string()),
                directory_entry_kind_json(entry.kind),
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

fn optional_usize_json(value: Option<usize>) -> String {
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

fn file_metadata_response_json(response: FileMetadataResponse) -> String {
    let mut json = format!(
        "{{\"rootRelativePath\":\"{}\",\"size\":{}",
        escape_json_string(&response.root_relative_path.to_string()),
        response.size,
    );
    if let Some(last_modified_ms) = response.last_modified_ms {
        json.push_str(&format!(",\"lastModifiedMs\":{last_modified_ms}"));
    }
    json.push('}');
    json
}

fn root_move_response_json(response: RootMoveResponse) -> String {
    format!(
        "{{\"dryRun\":{},\"sourceRootRelativePath\":\"{}\",\"targetRootRelativePath\":\"{}\",\"absolutePath\":\"{}\",\"targetAbsolutePath\":\"{}\",\"ok\":{},\"reason\":{},\"error\":{}}}",
        response.dry_run,
        escape_json_string(&response.source_root_relative_path.to_string()),
        escape_json_string(&response.target_root_relative_path.to_string()),
        escape_json_string(&response.absolute_path.display().to_string()),
        escape_json_string(&response.target_absolute_path.display().to_string()),
        response.ok,
        optional_root_move_failure_reason_json(response.reason),
        optional_string_json(response.error.as_deref()),
    )
}

fn root_trash_response_json(response: RootTrashMutationResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(|item| {
            format!(
                "{{\"rootRelativePath\":\"{}\",\"nextRootRelativePath\":{},\"absolutePath\":\"{}\",\"nextAbsolutePath\":{},\"ok\":{},\"reason\":{},\"error\":{}}}",
                escape_json_string(&item.root_relative_path.to_string()),
                optional_root_relative_path_json(item.next_root_relative_path.as_ref()),
                escape_json_string(&item.absolute_path.display().to_string()),
                optional_path_json(item.next_absolute_path.as_ref()),
                item.ok,
                optional_root_trash_failure_reason_json(item.reason),
                optional_string_json(item.error.as_deref()),
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"dryRun\":{},\"total\":{},\"completed\":{},\"failed\":{},\"items\":[{items}]}}",
        response.dry_run, response.total, response.completed, response.failed,
    )
}

fn root_trash_list_response_json(response: RootTrashListResponse) -> String {
    let entries = response
        .entries
        .into_iter()
        .map(|entry| {
            let mut json = format!(
                "{{\"name\":\"{}\",\"rootRelativePath\":\"{}\",\"originalRootRelativePath\":\"{}\",\"absolutePath\":\"{}\",\"originalAbsolutePath\":\"{}\",\"size\":{}",
                escape_json_string(&entry.name),
                escape_json_string(&entry.root_relative_path.to_string()),
                escape_json_string(&entry.original_root_relative_path.to_string()),
                escape_json_string(&entry.absolute_path.display().to_string()),
                escape_json_string(&entry.original_absolute_path.display().to_string()),
                entry.size,
            );
            if let Some(last_modified_ms) = entry.last_modified_ms {
                json.push_str(&format!(",\"lastModifiedMs\":{last_modified_ms}"));
            }
            if let Some(deleted_at_ms) = entry.deleted_at_ms {
                json.push_str(&format!(",\"deletedAtMs\":{deleted_at_ms}"));
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

fn global_shortcut_config_response_json(response: GlobalShortcutConfigResponse) -> String {
    let mut json = format!(
        "{{\"ok\":true,\"loaded\":{},\"path\":\"{}\"",
        response.loaded,
        escape_json_string(&response.path.display().to_string()),
    );
    if response.loaded {
        let config_json = response
            .config_json
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("null");
        json.push_str(&format!(",\"config\":{config_json}"));
    }
    json.push('}');
    json
}

fn optional_root_relative_path_json(value: Option<&RootRelativePath>) -> String {
    match value {
        Some(value) => format!("\"{}\"", escape_json_string(&value.to_string())),
        None => "null".to_owned(),
    }
}

fn optional_path_json(value: Option<&PathBuf>) -> String {
    match value {
        Some(value) => format!("\"{}\"", escape_json_string(&value.display().to_string())),
        None => "null".to_owned(),
    }
}

fn optional_root_trash_failure_reason_json(value: Option<RootTrashFailureReason>) -> String {
    match value {
        Some(value) => format!("\"{}\"", root_trash_failure_reason_json(value)),
        None => "null".to_owned(),
    }
}

fn optional_global_trash_failure_reason_json(value: Option<GlobalTrashFailureReason>) -> String {
    match value {
        Some(value) => format!("\"{}\"", global_trash_failure_reason_json(value)),
        None => "null".to_owned(),
    }
}

fn optional_root_move_failure_reason_json(value: Option<RootMoveFailureReason>) -> String {
    match value {
        Some(value) => format!("\"{}\"", root_move_failure_reason_json(value)),
        None => "null".to_owned(),
    }
}

fn root_move_failure_reason_json(value: RootMoveFailureReason) -> &'static str {
    match value {
        RootMoveFailureReason::InvalidSource => "invalid_source",
        RootMoveFailureReason::InvalidTarget => "invalid_target",
        RootMoveFailureReason::SourceNotFound => "source_not_found",
        RootMoveFailureReason::UnsupportedKind => "unsupported_kind",
        RootMoveFailureReason::TargetExists => "target_exists",
        RootMoveFailureReason::MutationFailed => "mutation_failed",
    }
}

fn root_trash_failure_reason_json(value: RootTrashFailureReason) -> &'static str {
    match value {
        RootTrashFailureReason::InvalidSource => "invalid_source",
        RootTrashFailureReason::SourceNotFound => "source_not_found",
        RootTrashFailureReason::UnsupportedKind => "unsupported_kind",
        RootTrashFailureReason::TargetExists => "target_exists",
        RootTrashFailureReason::MutationFailed => "mutation_failed",
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

fn directory_entry_kind_json(kind: DirectoryEntryKind) -> &'static str {
    match kind {
        DirectoryEntryKind::Directory => "directory",
        DirectoryEntryKind::File => "file",
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

fn file_content_response(response: FileContentResponse) -> HttpResponse {
    if let Some(range) = response.range {
        return binary_response_with_headers(
            206,
            "Partial Content",
            &response.content_type,
            response.bytes,
            vec![
                ("Accept-Ranges".to_owned(), "bytes".to_owned()),
                (
                    "Content-Range".to_owned(),
                    format!(
                        "bytes {}-{}/{}",
                        range.start, range.end_inclusive, response.total_size
                    ),
                ),
            ],
        );
    }

    binary_response_with_headers(
        200,
        "OK",
        &response.content_type,
        response.bytes,
        vec![("Accept-Ranges".to_owned(), "bytes".to_owned())],
    )
}

fn parse_file_content_range(value: &str) -> Option<FileContentRangeRequest> {
    let range_spec = value.trim().strip_prefix("bytes=")?;
    if range_spec.contains(',') {
        return None;
    }
    let (start_raw, end_raw) = range_spec.split_once('-')?;

    if start_raw.is_empty() {
        return Some(FileContentRangeRequest::Suffix {
            length: end_raw.parse::<u64>().ok()?,
        });
    }

    let start = start_raw.parse::<u64>().ok()?;
    if end_raw.is_empty() {
        return Some(FileContentRangeRequest::From { start });
    }

    Some(FileContentRangeRequest::Exact {
        start,
        end_inclusive: end_raw.parse::<u64>().ok()?,
    })
}

struct HttpResponse {
    status_code: u16,
    reason: &'static str,
    content_type: String,
    extra_headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl HttpResponse {
    fn into_bytes(self) -> Vec<u8> {
        let mut response = format!(
            "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Range\r\n",
            self.status_code,
            self.reason,
            self.content_type
        )
        .into_bytes();
        for (name, value) in self.extra_headers {
            response.extend_from_slice(format!("{name}: {value}\r\n").as_bytes());
        }
        response.extend_from_slice(
            format!(
                "Content-Length: {}\r\nConnection: close\r\n\r\n",
                self.body.len()
            )
            .as_bytes(),
        );
        response.extend_from_slice(&self.body);
        response
    }
}

fn http_response(status_code: u16, reason: &'static str, body: &str) -> HttpResponse {
    binary_response(
        status_code,
        reason,
        "application/json",
        body.as_bytes().to_vec(),
    )
}

fn binary_response(
    status_code: u16,
    reason: &'static str,
    content_type: &str,
    body: Vec<u8>,
) -> HttpResponse {
    binary_response_with_headers(status_code, reason, content_type, body, Vec::new())
}

fn binary_response_with_headers(
    status_code: u16,
    reason: &'static str,
    content_type: &str,
    body: Vec<u8>,
    extra_headers: Vec<(String, String)>,
) -> HttpResponse {
    HttpResponse {
        status_code,
        reason,
        content_type: content_type.to_owned(),
        extra_headers,
        body,
    }
}
