use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use fauplay_runtime::{DirectoryEntryKind, FauplayRuntime, ListDirectoryRequest, RootRelativePath};

#[test]
fn lists_immediate_entries_in_a_local_root() {
    let fixture = Fixture::new("lists_immediate_entries_in_a_local_root");
    fixture.write_file("photo.jpg", "image");
    fixture.create_dir("albums");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .list_local_directory(ListDirectoryRequest {
            root_path: fixture.root.clone(),
            root_relative_path: RootRelativePath::root(),
        })
        .expect("local root should be listed");

    assert_eq!(
        response.entries,
        vec![
            entry("albums", DirectoryEntryKind::Directory),
            entry("photo.jpg", DirectoryEntryKind::File),
        ],
    );
}

#[test]
fn binary_lists_immediate_entries_in_a_local_root() {
    let fixture = Fixture::new("binary_lists_immediate_entries_in_a_local_root");
    fixture.write_file("photo.jpg", "image");
    fixture.create_dir("albums");

    let output = Command::new(env!("CARGO_BIN_EXE_fauplay-runtime"))
        .arg("list")
        .arg(&fixture.root)
        .output()
        .expect("runtime binary should run");

    assert!(
        output.status.success(),
        "runtime binary should succeed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        "directory\talbums\nfile\tphoto.jpg\n"
    );
}

#[test]
fn rejects_root_relative_paths_that_escape_the_local_root() {
    let error = RootRelativePath::try_from(PathBuf::from(".."))
        .expect_err("Root-relative Path should not escape Local Root");

    assert!(
        error.to_string().contains("Root-relative Path"),
        "error should name the invalid domain term: {error}"
    );
}

#[test]
fn rejects_absolute_root_relative_paths() {
    let fixture = Fixture::new("rejects_absolute_root_relative_paths");
    let error = RootRelativePath::try_from(fixture.root)
        .expect_err("Root-relative Path should not be absolute");

    assert!(
        error.to_string().contains("Root-relative Path"),
        "error should name the invalid domain term: {error}"
    );
}

#[test]
fn normalizes_root_relative_paths_for_display() {
    let fixture = Fixture::new("normalizes_root_relative_paths_for_display");
    fixture.create_dir("albums/2024");
    fixture.write_file("albums/2024/photo.jpg", "image");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .list_local_directory(ListDirectoryRequest {
            root_path: fixture.root,
            root_relative_path: root_relative_path("./albums/./2024"),
        })
        .expect("Root-relative Path should be normalized before listing");

    assert_eq!(
        response.entries,
        vec![fauplay_runtime::DirectoryEntry {
            name: "photo.jpg".to_owned(),
            root_relative_path: root_relative_path("albums/2024/photo.jpg"),
            kind: DirectoryEntryKind::File,
        }],
    );
}

#[test]
fn hides_reserved_folders_from_local_root_listing() {
    let fixture = Fixture::new("hides_reserved_folders_from_local_root_listing");
    fixture.create_dir(".trash");
    fixture.write_file(".trash/deleted.jpg", "deleted");
    fixture.write_file("photo.jpg", "image");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .list_local_directory(ListDirectoryRequest {
            root_path: fixture.root,
            root_relative_path: RootRelativePath::root(),
        })
        .expect("local root should be listed");

    assert_eq!(
        response.entries,
        vec![fauplay_runtime::DirectoryEntry {
            name: "photo.jpg".to_owned(),
            root_relative_path: root_relative_path("photo.jpg"),
            kind: DirectoryEntryKind::File,
        }],
    );
}

fn entry(name: &str, kind: DirectoryEntryKind) -> fauplay_runtime::DirectoryEntry {
    fauplay_runtime::DirectoryEntry {
        name: name.to_owned(),
        root_relative_path: root_relative_path(name),
        kind,
    }
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

    fn create_dir(&self, relative_path: &str) {
        fs::create_dir_all(self.root.join(relative_path))
            .expect("fixture directory should be created");
    }

    fn write_file(&self, relative_path: &str, contents: &str) {
        fs::write(self.root.join(relative_path), contents).expect("fixture file should be written");
    }
}
