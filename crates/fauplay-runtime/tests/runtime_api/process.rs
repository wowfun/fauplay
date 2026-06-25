use std::io::BufReader;
use std::process::{Command, Stdio};

use super::support::*;

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
    let address = read_listen_address(&mut stdout);

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
