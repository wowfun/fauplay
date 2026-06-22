use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;

use crate::{
    DirectoryEntryKind, FauplayRuntime, FileContentRangeRequest, FileContentRequest,
    FileContentResponse, ListDirectoryRequest, ListingEntryFilter, ListingOrder, ListingQuery,
    ListingSortDirection, ListingSortKey, RootRelativePath, RuntimeError, TextPreviewRequest,
    TextPreviewStatus,
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
        Some(("OPTIONS", target))
            if target == "/v1/local-directory"
                || target == "/v1/text-preview"
                || target == "/v1/file-content" =>
        {
            http_response(204, "No Content", "")
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
        _ => http_response(404, "Not Found", "{\"error\":\"not found\"}"),
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

    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or_default();
        let value = parts.next().unwrap_or_default();
        values.insert(percent_decode(key), percent_decode(value));
    }

    values
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

        decoded.push(bytes[index]);
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
            "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Range\r\n",
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
