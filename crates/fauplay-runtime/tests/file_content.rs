use std::fs;
use std::path::{Path, PathBuf};

use fauplay_runtime::{
    FauplayRuntime, FileContentRange, FileContentRangeRequest, FileContentRequest, RootRelativePath,
};

#[test]
fn returns_full_file_content_without_a_range() {
    let fixture = Fixture::new("returns_full_file_content_without_a_range");
    fixture.write_bytes("diagram.svg", b"<svg>runtime</svg>");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .read_file_content(FileContentRequest {
            root_path: fixture.root,
            root_relative_path: root_relative_path("diagram.svg"),
            range: None,
        })
        .expect("File Content should be returned");

    assert_eq!(response.content_type, "image/svg+xml");
    assert_eq!(response.total_size, 18);
    assert_eq!(response.range, None);
    assert_eq!(response.bytes, b"<svg>runtime</svg>");
}

#[test]
fn returns_requested_file_content_range() {
    let fixture = Fixture::new("returns_requested_file_content_range");
    fixture.write_bytes("clip.mp4", b"0123456789");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .read_file_content(FileContentRequest {
            root_path: fixture.root,
            root_relative_path: root_relative_path("clip.mp4"),
            range: Some(FileContentRangeRequest::Exact {
                start: 2,
                end_inclusive: 5,
            }),
        })
        .expect("File Content Range should be returned");

    assert_eq!(response.content_type, "video/mp4");
    assert_eq!(response.total_size, 10);
    assert_eq!(
        response.range,
        Some(FileContentRange {
            start: 2,
            end_inclusive: 5,
        })
    );
    assert_eq!(response.bytes, b"2345");
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

    fn write_bytes(&self, relative_path: &str, contents: &[u8]) {
        fs::write(self.root.join(relative_path), contents).expect("fixture file should be written");
    }
}
