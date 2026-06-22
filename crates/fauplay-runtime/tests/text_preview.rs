use std::fs;
use std::path::{Path, PathBuf};

use fauplay_runtime::{FauplayRuntime, RootRelativePath, TextPreviewRequest, TextPreviewStatus};

#[test]
fn returns_text_preview_for_small_utf8_files() {
    let fixture = Fixture::new("returns_text_preview_for_small_utf8_files");
    fixture.write_file("notes.txt", "hello runtime");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .read_text_preview(TextPreviewRequest {
            root_path: fixture.root,
            root_relative_path: root_relative_path("notes.txt"),
            size_limit_bytes: 1024,
        })
        .expect("Text Preview should be returned");

    assert_eq!(response.status, TextPreviewStatus::Ready);
    assert_eq!(response.content.as_deref(), Some("hello runtime"));
    assert_eq!(response.file_size_bytes, 13);
    assert_eq!(response.size_limit_bytes, 1024);
}

#[test]
fn reports_text_preview_too_large_without_content() {
    let fixture = Fixture::new("reports_text_preview_too_large_without_content");
    fixture.write_file("notes.txt", "hello runtime");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .read_text_preview(TextPreviewRequest {
            root_path: fixture.root,
            root_relative_path: root_relative_path("notes.txt"),
            size_limit_bytes: 5,
        })
        .expect("Text Preview size should be checked");

    assert_eq!(response.status, TextPreviewStatus::TooLarge);
    assert_eq!(response.content, None);
    assert_eq!(response.file_size_bytes, 13);
    assert_eq!(response.size_limit_bytes, 5);
}

#[test]
fn reports_binary_text_preview_without_content() {
    let fixture = Fixture::new("reports_binary_text_preview_without_content");
    fixture.write_bytes("photo.bin", &[0, 159, 146, 150]);

    let runtime = FauplayRuntime::new();
    let response = runtime
        .read_text_preview(TextPreviewRequest {
            root_path: fixture.root,
            root_relative_path: root_relative_path("photo.bin"),
            size_limit_bytes: 1024,
        })
        .expect("Text Preview should detect binary files");

    assert_eq!(response.status, TextPreviewStatus::Binary);
    assert_eq!(response.content, None);
    assert_eq!(response.file_size_bytes, 4);
}

fn root_relative_path(path: &str) -> RootRelativePath {
    RootRelativePath::try_from(path).expect("test path should be a Root-relative Path")
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

    fn write_file(&self, relative_path: &str, contents: &str) {
        fs::write(self.root.join(relative_path), contents).expect("fixture file should be written");
    }

    fn write_bytes(&self, relative_path: &str, contents: &[u8]) {
        fs::write(self.root.join(relative_path), contents).expect("fixture file should be written");
    }
}
