use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;

use crate::{
    DirectoryEntryKind, FauplayRuntime, ListDirectoryRequest, RootRelativePath, RuntimeError,
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

    stream
        .write_all(response.as_bytes())
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

fn handle_http_request(runtime: &FauplayRuntime, request: &str) -> String {
    match parse_http_request_line(request) {
        Some(("GET", target)) if target.starts_with("/v1/local-directory?") => {
            let query = parse_query_string(&target["/v1/local-directory?".len()..]);
            handle_list_local_directory(runtime, &query)
        }
        _ => http_response(404, "Not Found", "{\"error\":\"not found\"}"),
    }
}

fn handle_list_local_directory(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
) -> String {
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
    }) {
        Ok(response) => http_response(200, "OK", &list_directory_response_json(response.entries)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
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

fn list_directory_response_json(entries: Vec<crate::DirectoryEntry>) -> String {
    let entries = entries
        .into_iter()
        .map(|entry| {
            format!(
                "{{\"name\":\"{}\",\"rootRelativePath\":\"{}\",\"kind\":\"{}\"}}",
                escape_json_string(&entry.name),
                escape_json_string(&entry.root_relative_path.to_string()),
                directory_entry_kind_json(entry.kind)
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!("{{\"entries\":[{entries}]}}")
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

fn http_response(status_code: u16, reason: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status_code} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}
