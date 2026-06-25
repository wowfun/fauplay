use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::{thread, time::Duration};

pub(crate) fn send_list_request(address: &str, root_path: &Path) -> String {
    send_list_request_with_root_relative_path(address, &root_path.display().to_string(), "")
}

pub(crate) fn send_list_request_with_root_relative_path(
    address: &str,
    root_path: &str,
    root_relative_path: &str,
) -> String {
    send_list_request_with_options(address, root_path, root_relative_path, &[])
}

pub(crate) fn send_list_request_with_options(
    address: &str,
    root_path: &str,
    root_relative_path: &str,
    options: &[(&str, &str)],
) -> String {
    let mut last_error = None;
    for _ in 0..20 {
        match TcpStream::connect(address) {
            Ok(mut stream) => {
                let option_query = options
                    .iter()
                    .map(|(key, value)| format!("{key}={value}"))
                    .collect::<Vec<_>>()
                    .join("&");
                let option_query = if option_query.is_empty() {
                    String::new()
                } else {
                    format!("&{option_query}")
                };
                write!(
                    stream,
                    "GET /v1/local-directory?rootPath={root_path}&rootRelativePath={root_relative_path}{option_query} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
                )
                .expect("request should be written");

                let mut response = String::new();
                stream
                    .read_to_string(&mut response)
                    .expect("response should be readable");
                return response;
            }
            Err(error) => {
                last_error = Some(error);
                thread::sleep(Duration::from_millis(25));
            }
        }
    }

    panic!("client should connect to Runtime API: {last_error:?}");
}
