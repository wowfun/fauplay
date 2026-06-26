use std::io::{Read, Write};
use std::net::TcpStream;

pub(crate) fn send_mcp_request(address: &str, session_id: Option<&str>, body: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let session_header = session_id
        .map(|session_id| format!("mcp-session-id: {session_id}\r\n"))
        .unwrap_or_default();
    write!(
        stream,
        "POST /v1/mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n{session_header}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
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

pub(crate) fn response_header(response: &str, header_name: &str) -> Option<String> {
    response.lines().skip(1).find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case(header_name)
            .then(|| value.trim().to_owned())
    })
}
