use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::{thread, time::Duration};

use fauplay_runtime::{FauplayRuntime, serve_one_http_request};

#[test]
fn runtime_api_lists_a_local_root_directory() {
    let fixture = Fixture::new("runtime_api_lists_a_local_root_directory");
    fixture.create_dir("albums");
    fixture.write_file("photo.jpg", "image");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/local-directory?rootPath={}&rootRelativePath= HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
        fixture.root.display()
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"albums\""),
        "response should include the directory entry: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"photo.jpg\""),
        "response should include the file entry: {response}"
    );
}

#[test]
fn runtime_api_decodes_query_values_before_listing() {
    let fixture = Fixture::new("runtime api decodes query values");
    fixture.create_dir("albums/2024 photos");
    fixture.write_file("albums/2024 photos/photo one.jpg", "image");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_list_request_with_root_relative_path(
        &address.to_string(),
        &percent_encode(&fixture.root.to_string_lossy()),
        &percent_encode("albums/2024 photos"),
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"albums/2024 photos/photo one.jpg\""),
        "response should include the decoded child entry: {response}"
    );
}

#[test]
fn runtime_api_rejects_root_relative_path_escape() {
    let fixture = Fixture::new("runtime_api_rejects_root_relative_path_escape");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(listener, FauplayRuntime::new())
            .expect("Runtime API request should be served");
    });

    let response = send_list_request_with_root_relative_path(
        &address.to_string(),
        &fixture.root.display().to_string(),
        "..",
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 400 Bad Request\r\n"),
        "response should reject invalid Root-relative Path: {response}"
    );
    assert!(
        response.contains("Root-relative Path"),
        "response should name the invalid domain term: {response}"
    );
}

#[test]
fn binary_serves_one_runtime_api_request() {
    let fixture = Fixture::new("binary_serves_one_runtime_api_request");
    fixture.create_dir("albums");
    fixture.write_file("photo.jpg", "image");

    let mut child = Command::new(env!("CARGO_BIN_EXE_fauplay-runtime"))
        .arg("serve-once")
        .arg("127.0.0.1:0")
        .stdout(Stdio::piped())
        .spawn()
        .expect("runtime binary should start");

    let stdout = child.stdout.take().expect("stdout should be captured");
    let mut stdout = BufReader::new(stdout);
    let mut line = String::new();
    stdout
        .read_line(&mut line)
        .expect("runtime binary should print listen address");
    let address = line
        .trim()
        .strip_prefix("listening\t")
        .expect("listen line should include address")
        .to_owned();

    let response = send_list_request(&address, &fixture.root);
    let status = child.wait().expect("runtime binary should exit");

    assert!(
        status.success(),
        "runtime binary should exit after one request"
    );
    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"photo.jpg\""),
        "response should include the file entry: {response}"
    );
}

#[test]
fn binary_runtime_api_server_handles_multiple_requests() {
    let fixture = Fixture::new("binary_runtime_api_server_handles_multiple_requests");
    fixture.create_dir("albums");
    fixture.write_file("photo.jpg", "image");

    let mut child = Command::new(env!("CARGO_BIN_EXE_fauplay-runtime"))
        .arg("serve")
        .arg("127.0.0.1:0")
        .stdout(Stdio::piped())
        .spawn()
        .expect("runtime binary should start");

    let stdout = child.stdout.take().expect("stdout should be captured");
    let mut stdout = BufReader::new(stdout);
    let address = read_listen_address(&mut stdout);

    let first_response = send_list_request(&address, &fixture.root);
    let second_response = send_list_request(&address, &fixture.root);

    child.kill().expect("runtime server should stop");
    let _ = child.wait();

    assert!(
        first_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "first response should be OK: {first_response}"
    );
    assert!(
        second_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "second response should be OK: {second_response}"
    );
    assert!(
        second_response.contains("\"rootRelativePath\":\"photo.jpg\""),
        "second response should include the file entry: {second_response}"
    );
}

fn send_list_request(address: &str, root_path: &Path) -> String {
    send_list_request_with_root_relative_path(address, &root_path.display().to_string(), "")
}

fn send_list_request_with_root_relative_path(
    address: &str,
    root_path: &str,
    root_relative_path: &str,
) -> String {
    let mut last_error = None;
    for _ in 0..20 {
        match TcpStream::connect(address) {
            Ok(mut stream) => {
                write!(
                    stream,
                    "GET /v1/local-directory?rootPath={root_path}&rootRelativePath={root_relative_path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
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

fn read_listen_address(stdout: &mut impl BufRead) -> String {
    let mut line = String::new();
    stdout
        .read_line(&mut line)
        .expect("runtime binary should print listen address");
    line.trim()
        .strip_prefix("listening\t")
        .expect("listen line should include address")
        .to_owned()
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new(name: &str) -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test-fixtures")
            .join(name);
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("fixture root should be created");
        Self { root }
    }

    fn create_dir(&self, relative_path: &str) {
        fs::create_dir_all(self.root.join(relative_path))
            .expect("fixture directory should be created");
    }

    fn write_file(&self, relative_path: &str, contents: &str) {
        fs::write(self.root.join(relative_path), contents).expect("fixture file should be written");
    }
}
