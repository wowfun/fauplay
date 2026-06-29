use std::io::BufRead;
use std::net::TcpListener;
use std::path::Path;
use std::thread;

use fauplay_runtime::{FauplayRuntime, serve_one_fauplay_app_request, serve_one_http_request};

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

pub(crate) fn serve_fauplay_app_once(
    runtime: FauplayRuntime,
    web_dist_path: impl AsRef<Path>,
) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener
        .local_addr()
        .expect("listener should have address")
        .to_string();
    let web_dist_path = web_dist_path.as_ref().to_path_buf();
    let server = thread::spawn(move || {
        serve_one_fauplay_app_request(listener, runtime, web_dist_path)
            .expect("Fauplay request should be served");
    });
    (address, server)
}

pub(crate) fn send_runtime_home_request_once(
    runtime_home_path: &Path,
    send_request: impl FnOnce(&str) -> String,
) -> String {
    let (address, server) =
        serve_runtime_once(FauplayRuntime::with_runtime_home_path(runtime_home_path));
    let response = send_request(&address);
    server.join().expect("server thread should finish");

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

pub(crate) fn read_open_url(stdout: &mut impl BufRead) -> String {
    let mut line = String::new();
    stdout
        .read_line(&mut line)
        .expect("runtime binary should print open URL");
    line.trim()
        .strip_prefix("open\t")
        .expect("open line should include URL")
        .to_owned()
}
