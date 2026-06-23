use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
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

pub(crate) fn send_text_preview_request(
    address: &str,
    root_path: &str,
    root_relative_path: &str,
    size_limit_bytes: u64,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/text-preview?rootPath={root_path}&rootRelativePath={root_relative_path}&sizeLimitBytes={size_limit_bytes} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_file_content_request(
    address: &str,
    root_path: &str,
    root_relative_path: &str,
) -> Vec<u8> {
    send_file_content_request_with_headers(address, root_path, root_relative_path, "")
}

pub(crate) fn send_file_content_request_with_range(
    address: &str,
    root_path: &str,
    root_relative_path: &str,
    range: &str,
) -> Vec<u8> {
    send_file_content_request_with_headers(
        address,
        root_path,
        root_relative_path,
        &format!("Range: {range}\r\n"),
    )
}

pub(crate) fn send_file_content_request_with_headers(
    address: &str,
    root_path: &str,
    root_relative_path: &str,
    headers: &str,
) -> Vec<u8> {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/file-content?rootPath={root_path}&rootRelativePath={root_relative_path} HTTP/1.1\r\nHost: 127.0.0.1\r\n{headers}Connection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_file_metadata_request(
    address: &str,
    root_path: &str,
    root_relative_path: &str,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/file-metadata?rootPath={root_path}&rootRelativePath={root_relative_path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_root_move_request(
    address: &str,
    root_path: &str,
    source_root_relative_path: &str,
    target_root_relative_path: &str,
    dry_run: bool,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "POST /v1/root-move?rootPath={root_path}&sourceRootRelativePath={source_root_relative_path}&targetRootRelativePath={target_root_relative_path}&dryRun={dry_run} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_root_move_batch_json_request(
    address: &str,
    root_path: &str,
    root_relative_paths: &[&str],
    dry_run: bool,
) -> String {
    let root_relative_paths = root_relative_paths
        .iter()
        .map(|path| format!("\"{path}\""))
        .collect::<Vec<_>>()
        .join(",");
    let body = format!(
        "{{\"rootPath\":\"{}\",\"rootRelativePaths\":[{root_relative_paths}],\"nameMask\":\"[P]-[C]-[N]\",\"findText\":\"\",\"replaceText\":\"\",\"searchMode\":\"plain\",\"regexFlags\":\"g\",\"counterStart\":3,\"counterStep\":1,\"counterPad\":2,\"dryRun\":{dry_run}}}",
        json_path(Path::new(root_path)),
    );
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "POST /v1/root-move/batch HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
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

pub(crate) fn send_root_trash_request(
    address: &str,
    operation: &str,
    root_path: &str,
    root_relative_path: &str,
    dry_run: bool,
) -> String {
    send_root_trash_request_with_paths(
        address,
        operation,
        root_path,
        &[root_relative_path],
        dry_run,
    )
}

pub(crate) fn send_root_trash_request_with_paths(
    address: &str,
    operation: &str,
    root_path: &str,
    root_relative_paths: &[&str],
    dry_run: bool,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let root_relative_path_query = root_relative_paths
        .iter()
        .map(|path| format!("rootRelativePath={path}"))
        .collect::<Vec<_>>()
        .join("&");
    write!(
        stream,
        "POST /v1/root-trash/{operation}?rootPath={root_path}&{root_relative_path_query}&dryRun={dry_run} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_root_trash_list_request(address: &str, root_path: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/root-trash?rootPath={root_path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_duplicate_files_request(
    address: &str,
    root_path: &str,
    root_relative_paths: &[&str],
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let mut query = format!("rootPath={}", percent_encode(root_path));
    for root_relative_path in root_relative_paths {
        query.push_str("&rootRelativePath=");
        query.push_str(&percent_encode(root_relative_path));
    }
    write!(
        stream,
        "GET /v1/duplicate-files?{query} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_duplicate_files_json_request(
    address: &str,
    root_path: &str,
    root_relative_paths: &[&str],
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let root_relative_paths_json = root_relative_paths
        .iter()
        .map(|path| format!("\"{}\"", path))
        .collect::<Vec<_>>()
        .join(",");
    let body = format!(
        "{{\"rootPath\":\"{}\",\"rootRelativePath\":[{root_relative_paths_json}]}}",
        json_path(Path::new(root_path)),
    );
    write!(
        stream,
        "POST /v1/duplicate-files HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
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

pub(crate) fn send_global_shortcut_config_request(address: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/config/shortcuts HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_global_trash_request(address: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/global-trash HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_global_trash_file_content_request(address: &str, recycle_id: &str) -> Vec<u8> {
    send_global_trash_file_content_request_with_headers(address, recycle_id, "")
}

pub(crate) fn send_global_trash_file_content_request_with_range(
    address: &str,
    recycle_id: &str,
    range: &str,
) -> Vec<u8> {
    send_global_trash_file_content_request_with_headers(
        address,
        recycle_id,
        &format!("Range: {range}\r\n"),
    )
}

pub(crate) fn send_global_trash_file_content_request_with_headers(
    address: &str,
    recycle_id: &str,
    headers: &str,
) -> Vec<u8> {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/global-trash/file-content?recycleId={} HTTP/1.1\r\nHost: 127.0.0.1\r\n{headers}Connection: close\r\n\r\n",
        percent_encode(recycle_id)
    )
    .expect("request should be written");

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_global_trash_text_preview_request(
    address: &str,
    recycle_id: &str,
    size_limit_bytes: u64,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/global-trash/text-preview?recycleId={}&sizeLimitBytes={size_limit_bytes} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
        percent_encode(recycle_id)
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_global_trash_file_metadata_request(address: &str, recycle_id: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/global-trash/file-metadata?recycleId={} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
        percent_encode(recycle_id)
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
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

pub(crate) fn send_local_root_binding_upsert_request(
    address: &str,
    root_id: &str,
    root_path: &str,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "PUT /v1/local-root-bindings?rootId={}&rootPath={} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
        percent_encode(root_id),
        percent_encode(root_path)
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_local_root_bindings_request(address: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    write!(
        stream,
        "GET /v1/local-root-bindings HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_global_trash_move_request(
    address: &str,
    absolute_paths: &[&Path],
    dry_run: bool,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let absolute_path_query = absolute_paths
        .iter()
        .map(|absolute_path| {
            format!(
                "absolutePath={}",
                percent_encode(&absolute_path.display().to_string())
            )
        })
        .collect::<Vec<_>>()
        .join("&");
    write!(
        stream,
        "POST /v1/global-trash/move?{absolute_path_query}&dryRun={dry_run} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn send_global_trash_restore_request(
    address: &str,
    recycle_ids: &[&str],
    dry_run: bool,
) -> String {
    let mut stream = TcpStream::connect(address).expect("client should connect");
    let recycle_id_query = recycle_ids
        .iter()
        .map(|recycle_id| format!("recycleId={}", percent_encode(recycle_id)))
        .collect::<Vec<_>>()
        .join("&");
    write!(
        stream,
        "POST /v1/global-trash/restore?{recycle_id_query}&dryRun={dry_run} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should be written");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should be readable");
    response
}

pub(crate) fn json_path(path: &Path) -> String {
    path.display().to_string().replace('\\', "\\\\")
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

pub(crate) fn percent_encode(value: &str) -> String {
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

pub(crate) struct Fixture {
    pub(crate) root: PathBuf,
}

impl Fixture {
    pub(crate) fn new(name: &str) -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test-fixtures")
            .join(name);
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("fixture root should be created");
        Self { root }
    }

    pub(crate) fn create_dir(&self, relative_path: &str) {
        fs::create_dir_all(self.root.join(relative_path))
            .expect("fixture directory should be created");
    }

    pub(crate) fn write_file(&self, relative_path: &str, contents: &str) {
        let path = self.root.join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("fixture parent should be created");
        }
        fs::write(path, contents).expect("fixture file should be written");
    }

    pub(crate) fn write_bytes(&self, relative_path: &str, contents: &[u8]) {
        let path = self.root.join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("fixture parent should be created");
        }
        fs::write(path, contents).expect("fixture file should be written");
    }

    pub(crate) fn assert_file(&self, relative_path: &str, contents: &str) {
        let path = self.root.join(relative_path);
        let actual = fs::read_to_string(path).expect("fixture file should exist");
        assert_eq!(actual, contents);
    }

    pub(crate) fn assert_missing(&self, relative_path: &str) {
        assert!(
            !self.root.join(relative_path).exists(),
            "{relative_path} should not exist",
        );
    }
}
