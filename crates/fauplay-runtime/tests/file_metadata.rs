use std::fs;
use std::path::{Path, PathBuf};

use fauplay_runtime::{FauplayRuntime, FileMetadataRequest, RootRelativePath};

#[test]
fn returns_file_metadata_without_reading_file_content() {
    let fixture = Fixture::new("returns_file_metadata_without_reading_file_content");
    fixture.write_bytes("albums/photo.jpg", b"image-bytes");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .read_file_metadata(FileMetadataRequest {
            root_path: fixture.root,
            root_relative_path: root_relative_path("albums/photo.jpg"),
        })
        .expect("File Metadata should be returned");

    assert_eq!(response.root_relative_path.to_string(), "albums/photo.jpg");
    assert_eq!(response.size, 11);
    assert!(
        response.last_modified_ms.is_some(),
        "File Metadata should include a millisecond modification timestamp"
    );
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
        let file_path = self.root.join(relative_path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).expect("fixture parent directory should be created");
        }
        fs::write(file_path, contents).expect("fixture file should be written");
    }
}
