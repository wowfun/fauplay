use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;

use super::super::encoding::percent_encode;

pub(crate) fn send_global_trash_request(address: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/global-trash HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_global_trash_file_content_request(address: &str, recycle_id: &str) -> Vec<u8> {
    send_global_trash_file_content_request_with_headers(address, recycle_id, "")
}

pub(crate) fn send_global_trash_file_content_request_with_range(
    address: &str,
    recycle_id: &str,
    range: &str,
) -> Vec<u8> {
    send_global_trash_file_content_request_with_headers(
        address,
        recycle_id,
        &format!("Range: {range}\r\n"),
    )
}

pub(crate) fn send_global_trash_file_content_request_with_headers(
    address: &str,
    recycle_id: &str,
    headers: &str,
) -> Vec<u8> {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/global-trash/file-content?recycleId={} HTTP/1.1\r\nHost: 127.0.0.1\r\n{headers}Connection: close\r\n\r\n",
        percent_encode(recycle_id)
    )
    .expect("request should be written");

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_global_trash_text_preview_request(
    address: &str,
    recycle_id: &str,
    size_limit_bytes: u64,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/global-trash/text-preview?recycleId={}&sizeLimitBytes={size_limit_bytes} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
        percent_encode(recycle_id)
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_global_trash_file_metadata_request(address: &str, recycle_id: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/global-trash/file-metadata?recycleId={} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
        percent_encode(recycle_id)
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_global_trash_move_request(
    address: &str,
    absolute_paths: &[&Path],
    dry_run: bool,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let absolute_path_query = absolute_paths
        .iter()
        .map(|absolute_path| {
            format!(
                "absolutePath={}",
                percent_encode(&absolute_path.display().to_string())
            )
        })
        .collect::<Vec<_>>()
        .join("&");
    write!(
        stream,
        "POST /v1/global-trash/move?{absolute_path_query}&dryRun={dry_run} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_global_trash_restore_request(
    address: &str,
    recycle_ids: &[&str],
    dry_run: bool,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let recycle_id_query = recycle_ids
        .iter()
        .map(|recycle_id| format!("recycleId={}", percent_encode(recycle_id)))
        .collect::<Vec<_>>()
        .join("&");
    write!(
        stream,
        "POST /v1/global-trash/restore?{recycle_id_query}&dryRun={dry_run} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}
