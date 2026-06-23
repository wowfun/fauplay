use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::thread;

use fauplay_runtime::{FauplayRuntime, serve_one_http_request};

#[test]
fn runtime_api_sets_and_reads_file_annotation_tags() {
    let fixture = Fixture::new("runtime_api_sets_and_reads_file_annotation_tags");
    fixture.write_file("root/albums/photo.jpg", "image");

    let set_body = format!(
        r#"{{"rootPath":"{}","relativePath":"albums/photo.jpg","fieldKey":"rating","value":"5","source":"hotkey"}}"#,
        json_path(&fixture.local_root()),
    );
    let set_response = serve_json_request(
        fixture.runtime_home(),
        "PUT",
        "/v1/file-annotations",
        &set_body,
    );
    assert!(
        set_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "set response should be OK: {set_response}"
    );
    assert!(
        set_response.contains(r#""source":"hotkey""#),
        "set response should preserve action source: {set_response}"
    );

    let read_body = format!(
        r#"{{"rootPath":"{}","relativePath":"albums/photo.jpg"}}"#,
        json_path(&fixture.local_root()),
    );
    let read_response = serve_json_request(
        fixture.runtime_home(),
        "POST",
        "/v1/data/tags/file",
        &read_body,
    );
    assert!(
        read_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "read response should be OK: {read_response}"
    );
    assert!(
        read_response.contains(r#""relativePath":"albums/photo.jpg""#),
        "read response should include the file path: {read_response}"
    );
    assert!(
        read_response.contains(r#""key":"rating""#)
            && read_response.contains(r#""value":"5""#)
            && read_response.contains(r#""source":"meta.annotation""#),
        "read response should include the Annotation Tag: {read_response}"
    );
}

#[test]
fn runtime_api_cleans_up_missing_file_annotations() {
    let fixture = Fixture::new("runtime_api_cleans_up_missing_file_annotations");
    fixture.write_file("root/albums/photo.jpg", "image");

    let set_body = format!(
        r#"{{"rootPath":"{}","relativePath":"albums/photo.jpg","fieldKey":"status","value":"missing"}}"#,
        json_path(&fixture.local_root()),
    );
    let set_response = serve_json_request(
        fixture.runtime_home(),
        "PUT",
        "/v1/file-annotations",
        &set_body,
    );
    assert!(
        set_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "set response should be OK: {set_response}"
    );

    fs::remove_file(fixture.local_root().join("albums/photo.jpg"))
        .expect("fixture file should be removed");
    let cleanup_body = format!(
        r#"{{"rootPath":"{}","confirm":true}}"#,
        json_path(&fixture.local_root()),
    );
    let cleanup_response = serve_json_request(
        fixture.runtime_home(),
        "POST",
        "/v1/files/missing/cleanups",
        &cleanup_body,
    );

    assert!(
        cleanup_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "cleanup response should be OK: {cleanup_response}"
    );
    assert!(
        cleanup_response.contains(r#""dryRun":false"#)
            && cleanup_response.contains(r#""removed":1"#)
            && cleanup_response.contains(r#""missingRootRelativePaths":["albums/photo.jpg"]"#),
        "cleanup response should report removed missing annotation: {cleanup_response}"
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
