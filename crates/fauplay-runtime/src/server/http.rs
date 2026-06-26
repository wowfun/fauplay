use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};

use crate::{FauplayRuntime, FileContentRangeRequest, FileContentResponse, RuntimeError};

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
    let response = super::handle_http_request(runtime, &request);
    let response_bytes = response.into_bytes();

    stream
        .write_all(&response_bytes)
        .map_err(|source| RuntimeError::network("failed to write Runtime API response", source))?;

    Ok(())
}

fn read_http_request(stream: &mut impl Read) -> Result<String, RuntimeError> {
    let mut request = Vec::new();
    let mut buffer = [0_u8; REQUEST_CHUNK_SIZE];
    let mut expected_request_length = None;

    loop {
        let byte_count = stream.read(&mut buffer).map_err(|source| {
            RuntimeError::network("failed to read Runtime API request", source)
        })?;
        if byte_count == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..byte_count]);
        if expected_request_length.is_none() {
            if let Some(header_end) = find_http_header_end(&request) {
                let header_text = String::from_utf8_lossy(&request[..header_end]).into_owned();
                let content_length = parse_header_value(&header_text, "content-length")
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                expected_request_length = Some(header_end + content_length);
            }
        }
        if expected_request_length.is_some_and(|expected| request.len() >= expected) {
            break;
        }
    }

    Ok(String::from_utf8_lossy(&request).into_owned())
}

fn find_http_header_end(request: &[u8]) -> Option<usize> {
    request
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
}

pub(super) fn parse_header_value<'a>(request: &'a str, header_name: &str) -> Option<&'a str> {
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

pub(super) fn parse_http_request_line(request: &str) -> Option<(&str, &str)> {
    let line = request.lines().next()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?;
    let target = parts.next()?;
    Some((method, target))
}

pub(super) fn file_content_response(response: FileContentResponse) -> HttpResponse {
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

pub(super) fn parse_file_content_range(value: &str) -> Option<FileContentRangeRequest> {
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

pub(super) struct HttpResponse {
    status_code: u16,
    reason: &'static str,
    content_type: String,
    extra_headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl HttpResponse {
    fn into_bytes(self) -> Vec<u8> {
        let mut response = format!(
            "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Range, Authorization, mcp-session-id\r\nAccess-Control-Expose-Headers: mcp-session-id\r\n",
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

pub(super) fn http_response(status_code: u16, reason: &'static str, body: &str) -> HttpResponse {
    binary_response(
        status_code,
        reason,
        "application/json",
        body.as_bytes().to_vec(),
    )
}

pub(super) fn http_response_with_headers(
    status_code: u16,
    reason: &'static str,
    body: &str,
    extra_headers: Vec<(String, String)>,
) -> HttpResponse {
    binary_response_with_headers(
        status_code,
        reason,
        "application/json",
        body.as_bytes().to_vec(),
        extra_headers,
    )
}

pub(super) fn binary_response(
    status_code: u16,
    reason: &'static str,
    content_type: &str,
    body: Vec<u8>,
) -> HttpResponse {
    binary_response_with_headers(status_code, reason, content_type, body, Vec::new())
}

pub(super) fn binary_response_with_headers(
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
