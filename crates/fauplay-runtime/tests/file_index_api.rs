use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::thread;

use fauplay_runtime::{FauplayRuntime, serve_one_http_request};

#[test]
fn runtime_api_ensures_file_index_entries_from_relative_paths() {
    let fixture = Fixture::new("runtime_api_ensures_file_index_entries_from_relative_paths");
    fixture.write_file("root/albums/photo.jpg", "image");

    let body = format!(
        r#"{{"rootPath":"{}","relativePaths":["albums/photo.jpg"]}}"#,
        json_path(&fixture.local_root()),
    );
    let indexed_response =
        serve_json_request(fixture.runtime_home(), "POST", "/v1/files/indexes", &body);

    assert!(
        indexed_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "index response should be OK: {indexed_response}"
    );
    assert!(
        indexed_response.contains(r#""ok":true"#)
            && indexed_response.contains(r#""total":1"#)
            && indexed_response.contains(r#""indexed":1"#)
            && indexed_response.contains(r#""relativePath":"albums/photo.jpg""#)
            && indexed_response.contains(r#""fileMtimeMs":"#)
            && indexed_response.contains(r#""size":5"#),
        "index response should report the indexed File Index Entry: {indexed_response}"
    );

    let fresh_response =
        serve_json_request(fixture.runtime_home(), "POST", "/v1/files/indexes", &body);

    assert!(
        fresh_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "fresh response should be OK: {fresh_response}"
    );
    assert!(
        fresh_response.contains(r#""indexed":0"#)
            && fresh_response.contains(r#""skipped":1"#)
            && fresh_response.contains(r#""reasonCode":"INDEX_FRESH""#),
        "fresh response should report a fresh File Index Entry skip: {fresh_response}"
    );
}

fn serve_json_request(
    runtime_home_path: PathBuf,
    method: &str,
    target: &str,
    body: &str,
) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("listener should have address");
    let server = thread::spawn(move || {
        serve_one_http_request(
            listener,
            FauplayRuntime::with_runtime_home_path(runtime_home_path),
        )
        .expect("Runtime API request should be served");
    });

    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "{method} {target} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body,
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    server.join().expect("server thread should finish");
    response
}

fn json_path(path: &Path) -> String {
    path.display().to_string().replace('\\', "\\\\")
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

    fn local_root(&self) -> PathBuf {
        self.root.join("root")
    }

    fn runtime_home(&self) -> PathBuf {
        self.root.join("runtime-home")
    }

    fn write_file(&self, relative_path: &str, contents: &str) {
        let path = self.root.join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("fixture parent should be created");
        }
        fs::write(path, contents).expect("fixture file should be written");
    }
}
