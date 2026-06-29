use std::io::{BufReader, Read};
use std::process::{Command, Stdio};

use super::support::*;

#[test]
fn binary_fauplay_starts_with_default_address_and_prints_open_url() {
    let fixture = Fixture::new("binary_fauplay_starts_with_default_address_and_prints_open_url");
    write_web_app_build(&fixture);

    let mut child = Command::new(env!("CARGO_BIN_EXE_fauplay"))
        .current_dir(&fixture.root)
        .stdout(Stdio::piped())
        .spawn()
        .expect("fauplay binary should start");

    let stdout = child.stdout.take().expect("stdout should be captured");
    let mut stdout = BufReader::new(stdout);
    let address = read_listen_address(&mut stdout);
    let open_url = read_open_url(&mut stdout);

    child.kill().expect("fauplay server should stop");
    let _ = child.wait();

    assert_eq!(address, "127.0.0.1:3211");
    assert_eq!(open_url, "http://127.0.0.1:3211/");
}

#[test]
fn binary_fauplay_addr_option_serves_web_app_and_runtime_api() {
    let fixture = Fixture::new("binary_fauplay_addr_option_serves_web_app_and_runtime_api");
    fixture.create_dir("albums");
    fixture.write_file("photo.jpg", "image");
    write_web_app_build(&fixture);

    let mut child = Command::new(env!("CARGO_BIN_EXE_fauplay"))
        .arg("--addr")
        .arg("127.0.0.1:0")
        .current_dir(&fixture.root)
        .stdout(Stdio::piped())
        .spawn()
        .expect("fauplay binary should start");

    let stdout = child.stdout.take().expect("stdout should be captured");
    let mut stdout = BufReader::new(stdout);
    let address = read_listen_address(&mut stdout);
    let open_url = read_open_url(&mut stdout);

    let index_response = send_get_request(&address, "/");
    let asset_response = send_get_request(&address, "/assets/app.js");
    let runtime_response = send_list_request(&address, &fixture.root);

    child.kill().expect("fauplay server should stop");
    let _ = child.wait();

    assert_eq!(open_url, format!("http://{address}/"));
    assert!(
        index_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "index response should be OK: {index_response}"
    );
    assert!(
        index_response.contains("<div id=\"root\"></div>"),
        "index response should include the Web App shell: {index_response}"
    );
    assert!(
        asset_response.contains("Content-Type: text/javascript; charset=utf-8"),
        "asset response should include JavaScript content type: {asset_response}"
    );
    assert!(
        asset_response.ends_with("console.log('fauplay')\n"),
        "asset response should include asset body: {asset_response}"
    );
    assert!(
        runtime_response.contains("\"rootRelativePath\":\"photo.jpg\""),
        "runtime response should come from the Runtime API: {runtime_response}"
    );
}

#[test]
fn binary_fauplay_requires_web_app_build() {
    let fixture = Fixture::new("binary_fauplay_requires_web_app_build");

    let output = Command::new(env!("CARGO_BIN_EXE_fauplay"))
        .arg("--addr")
        .arg("127.0.0.1:0")
        .current_dir(&fixture.root)
        .output()
        .expect("fauplay binary should start");

    assert!(
        !output.status.success(),
        "fauplay should fail when dist/index.html is missing"
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("Web App build not found"),
        "stderr should explain the missing build: {stderr}"
    );
    assert!(
        stderr.contains("pnpm run build"),
        "stderr should tell users how to build: {stderr}"
    );
}

#[test]
fn binary_fauplay_prints_help() {
    let output = Command::new(env!("CARGO_BIN_EXE_fauplay"))
        .arg("--help")
        .output()
        .expect("fauplay binary should run");

    assert!(
        output.status.success(),
        "help should exit successfully: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        "usage: fauplay [--addr <host:port>]\n"
    );
}

#[test]
fn binary_fauplay_rejects_invalid_arguments() {
    let output = Command::new(env!("CARGO_BIN_EXE_fauplay"))
        .arg("serve")
        .output()
        .expect("fauplay binary should run");

    assert!(
        !output.status.success(),
        "invalid arguments should exit unsuccessfully"
    );
    assert_eq!(
        String::from_utf8_lossy(&output.stderr),
        "usage: fauplay [--addr <host:port>]\n"
    );
}

fn write_web_app_build(fixture: &Fixture) {
    fixture.write_file(
        "dist/index.html",
        "<!doctype html><html><body><div id=\"root\"></div></body></html>",
    );
    fixture.write_file("dist/assets/app.js", "console.log('fauplay')\n");
}

fn send_get_request(address: &str, target: &str) -> String {
    let mut stream = std::net::TcpStream::connect(address).expect("client should connect");
    use std::io::Write;
    write!(
        stream,
        "GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}
