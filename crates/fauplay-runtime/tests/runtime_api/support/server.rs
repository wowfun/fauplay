use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;

use fauplay_runtime::{FauplayRuntime, serve_one_http_request};

pub(crate) fn serve_runtime_once(runtime: FauplayRuntime) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener
        .local_addr()
        .expect("listener should have address")
        .to_string();
    let server = thread::spawn(move || {
        serve_one_http_request(listener, runtime).expect("Runtime API request should be served");
    });
    (address, server)
}

pub(crate) fn send_runtime_home_request_once(
    runtime_home_path: &Path,
    send_request: impl FnOnce(&str) -> String,
) -> String {
    let mut child = Command::new(env!("CARGO_BIN_EXE_fauplay-runtime"))
        .arg("serve-once")
        .arg("127.0.0.1:0")
        .env("FAUPLAY_HOME", runtime_home_path)
        .stdout(Stdio::piped())
        .spawn()
        .expect("runtime binary should start");

    let stdout = child.stdout.take().expect("stdout should be captured");
    let mut stdout = BufReader::new(stdout);
    let address = read_listen_address(&mut stdout);
    let response = send_request(&address);
    let status = child.wait().expect("runtime binary should exit");
    assert!(
        status.success(),
        "runtime binary should serve one request successfully"
    );

    response
}

pub(crate) fn read_listen_address(stdout: &mut impl BufRead) -> String {
    let mut line = String::new();
    stdout
        .read_line(&mut line)
        .expect("runtime binary should print listen address");
    line.trim()
        .strip_prefix("listening\t")
        .expect("listen line should include address")
        .to_owned()
}
