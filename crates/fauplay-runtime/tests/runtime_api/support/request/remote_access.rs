use std::io::{Read, Write};
use std::net::TcpStream;

pub(crate) fn send_remote_session_login_request(
    address: &str,
    authorization: &str,
    cookie: Option<&str>,
    user_agent: Option<&str>,
    body: &str,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let cookie_header = cookie
        .map(|value| format!("Cookie: {value}\r\n"))
        .unwrap_or_default();
    let user_agent_header = user_agent
        .map(|value| format!("User-Agent: {value}\r\n"))
        .unwrap_or_default();
    write!(
        stream,
        "POST /v1/remote/session/login HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: {authorization}\r\nContent-Type: application/json\r\n{cookie_header}{user_agent_header}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
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

pub(crate) fn send_remote_session_authorize_request(address: &str, cookie: Option<&str>) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let cookie_header = cookie
        .map(|value| format!("Cookie: {value}\r\n"))
        .unwrap_or_default();
    write!(
        stream,
        "POST /v1/remote/session/authorize HTTP/1.1\r\nHost: 127.0.0.1\r\n{cookie_header}Content-Length: 2\r\nConnection: close\r\n\r\n{{}}",
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_remote_session_logout_request(
    address: &str,
    cookie: Option<&str>,
    body: &str,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let cookie_header = cookie
        .map(|value| format!("Cookie: {value}\r\n"))
        .unwrap_or_default();
    write!(
        stream,
        "POST /v1/remote/session/logout HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n{cookie_header}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
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

pub(crate) fn send_remote_access_config_request(address: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/remote/access/config HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_remote_access_authorize_request(address: &str, body: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "POST /v1/remote/access/authorize HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
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

pub(crate) fn send_remote_roots_request(address: &str, cookie: Option<&str>) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let cookie_header = cookie
        .map(|value| format!("Cookie: {value}\r\n"))
        .unwrap_or_default();
    write!(
        stream,
        "GET /v1/remote/roots HTTP/1.1\r\nHost: 127.0.0.1\r\n{cookie_header}Connection: close\r\n\r\n",
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_remote_file_list_request(
    address: &str,
    cookie: Option<&str>,
    body: &str,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let cookie_header = cookie
        .map(|value| format!("Cookie: {value}\r\n"))
        .unwrap_or_default();
    write!(
        stream,
        "POST /v1/remote/files/list HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n{cookie_header}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
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

pub(crate) fn send_remote_file_content_request(
    address: &str,
    cookie: Option<&str>,
    query: &str,
    range_header: Option<&str>,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let cookie_header = cookie
        .map(|value| format!("Cookie: {value}\r\n"))
        .unwrap_or_default();
    let range_header = range_header
        .map(|value| format!("Range: {value}\r\n"))
        .unwrap_or_default();
    write!(
        stream,
        "GET /v1/remote/files/content?{query} HTTP/1.1\r\nHost: 127.0.0.1\r\n{cookie_header}{range_header}Connection: close\r\n\r\n",
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_remote_thumbnail_request(
    address: &str,
    cookie: Option<&str>,
    query: &str,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let cookie_header = cookie
        .map(|value| format!("Cookie: {value}\r\n"))
        .unwrap_or_default();
    write!(
        stream,
        "GET /v1/remote/files/thumbnail?{query} HTTP/1.1\r\nHost: 127.0.0.1\r\n{cookie_header}Connection: close\r\n\r\n",
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_remote_text_preview_request(
    address: &str,
    cookie: Option<&str>,
    body: &str,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let cookie_header = cookie
        .map(|value| format!("Cookie: {value}\r\n"))
        .unwrap_or_default();
    write!(
        stream,
        "POST /v1/remote/files/text-preview HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n{cookie_header}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
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

pub(crate) fn send_remote_tags_request(
    address: &str,
    cookie: Option<&str>,
    endpoint_path: &str,
    body: &str,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let cookie_header = cookie
        .map(|value| format!("Cookie: {value}\r\n"))
        .unwrap_or_default();
    write!(
        stream,
        "POST {endpoint_path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n{cookie_header}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
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

pub(crate) fn send_remote_favorites_list_request(address: &str, cookie: Option<&str>) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let cookie_header = cookie
        .map(|value| format!("Cookie: {value}\r\n"))
        .unwrap_or_default();
    write!(
        stream,
        "GET /v1/remote/favorites HTTP/1.1\r\nHost: 127.0.0.1\r\n{cookie_header}Connection: close\r\n\r\n",
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_remote_favorite_request(
    address: &str,
    cookie: Option<&str>,
    endpoint_path: &str,
    body: &str,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let cookie_header = cookie
        .map(|value| format!("Cookie: {value}\r\n"))
        .unwrap_or_default();
    write!(
        stream,
        "POST {endpoint_path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n{cookie_header}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
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
