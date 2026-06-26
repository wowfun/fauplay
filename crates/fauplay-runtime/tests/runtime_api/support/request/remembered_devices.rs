use std::io::{Read, Write};
use std::net::TcpStream;

use super::super::percent_encode;

pub(crate) fn send_remembered_devices_request(address: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/admin/remembered-devices HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_rename_remembered_device_request(
    address: &str,
    device_id: &str,
    label: &str,
) -> String {
    let device_id = percent_encode(device_id);
    let body = format!("{{\"label\":\"{}\"}}", json_string(label));
    send_json_request(
        address,
        "PATCH",
        &format!("/v1/admin/remembered-devices/{device_id}"),
        &body,
    )
}

pub(crate) fn send_revoke_remembered_device_request(address: &str, device_id: &str) -> String {
    let device_id = percent_encode(device_id);
    send_json_request(
        address,
        "DELETE",
        &format!("/v1/admin/remembered-devices/{device_id}"),
        "{}",
    )
}

pub(crate) fn send_revoke_all_remembered_devices_request(address: &str) -> String {
    send_json_request(
        address,
        "POST",
        "/v1/admin/remembered-devices/revoke-all",
        "{}",
    )
}

fn send_json_request(address: &str, method: &str, endpoint_path: &str, body: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "{method} {endpoint_path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body,
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

fn json_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}
