use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use fauplay_runtime::{
    DirectoryEntry, DirectoryEntryKind, FauplayRuntime, ListDirectoryRequest, RootRelativePath,
};

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
            flattened: false,
            entry_limit: None,
            entry_offset: 0,
        })
        .expect("local root should be listed");

    assert_eq!(
        entry_summaries(&response.entries),
        vec![
            entry_summary("albums", "albums", DirectoryEntryKind::Directory, None),
            entry_summary("photo.jpg", "photo.jpg", DirectoryEntryKind::File, Some(5)),
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
fn includes_file_metadata_for_frontend_sorting() {
    let fixture = Fixture::new("includes_file_metadata_for_frontend_sorting");
    fixture.write_file("photo.jpg", "image");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .list_local_directory(ListDirectoryRequest {
            root_path: fixture.root,
            root_relative_path: RootRelativePath::root(),
            flattened: false,
            entry_limit: None,
            entry_offset: 0,
        })
        .expect("local root should be listed");

    let entry = response
        .entries
        .into_iter()
        .find(|entry| entry.name == "photo.jpg")
        .expect("file entry should be listed");

    assert_eq!(entry.size, Some(5));
    assert!(
        entry.last_modified_ms.is_some(),
        "file entry should include a millisecond modification timestamp"
    );
}

#[test]
fn includes_directory_metadata_for_frontend_filtering() {
    let fixture = Fixture::new("includes_directory_metadata_for_frontend_filtering");
    fixture.create_dir("empty-album");
    fixture.create_dir("filled-album");
    fixture.write_file("filled-album/photo.jpg", "image");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .list_local_directory(ListDirectoryRequest {
            root_path: fixture.root,
            root_relative_path: RootRelativePath::root(),
            flattened: false,
            entry_limit: None,
            entry_offset: 0,
        })
        .expect("local root should be listed");

    let empty_album = response
        .entries
        .iter()
        .find(|entry| entry.name == "empty-album")
        .expect("empty directory should be listed");
    let filled_album = response
        .entries
        .iter()
        .find(|entry| entry.name == "filled-album")
        .expect("non-empty directory should be listed");

    assert_eq!(empty_album.kind, DirectoryEntryKind::Directory);
    assert_eq!(empty_album.size, None);
    assert_eq!(empty_album.is_empty, Some(true));
    assert_eq!(filled_album.kind, DirectoryEntryKind::Directory);
    assert_eq!(filled_album.size, None);
    assert_eq!(filled_album.is_empty, Some(false));
}

#[test]
fn lists_flattened_descendant_files_under_a_root_relative_path() {
    let fixture = Fixture::new("lists_flattened_descendant_files_under_a_root_relative_path");
    fixture.write_file("cover.jpg", "cover");
    fixture.create_dir("albums/2024");
    fixture.write_file("albums/2024/photo.jpg", "image");
    fixture.write_file("albums/2024/notes.txt", "notes");
    fixture.create_dir("albums/empty");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .list_local_directory(ListDirectoryRequest {
            root_path: fixture.root,
            root_relative_path: root_relative_path("albums"),
            flattened: true,
            entry_limit: None,
            entry_offset: 0,
        })
        .expect("Flattened Listing should be returned");

    assert_eq!(
        entry_summaries(&response.entries),
        vec![
            entry_summary(
                "notes.txt",
                "albums/2024/notes.txt",
                DirectoryEntryKind::File,
                Some(5),
            ),
            entry_summary(
                "photo.jpg",
                "albums/2024/photo.jpg",
                DirectoryEntryKind::File,
                Some(5),
            ),
        ],
    );
}

#[test]
fn marks_listings_truncated_when_an_entry_limit_is_reached() {
    let fixture = Fixture::new("marks_listings_truncated_when_an_entry_limit_is_reached");
    fixture.create_dir("albums");
    fixture.write_file("a.jpg", "image");
    fixture.write_file("b.jpg", "image");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .list_local_directory(ListDirectoryRequest {
            root_path: fixture.root,
            root_relative_path: RootRelativePath::root(),
            flattened: false,
            entry_limit: Some(2),
            entry_offset: 0,
        })
        .expect("Truncated Listing should be returned");

    assert_eq!(
        entry_summaries(&response.entries),
        vec![
            entry_summary("albums", "albums", DirectoryEntryKind::Directory, None),
            entry_summary("a.jpg", "a.jpg", DirectoryEntryKind::File, Some(5)),
        ],
    );
    assert!(
        response.is_truncated,
        "listing should report that more matching entries exist"
    );
}

#[test]
fn returns_next_offset_for_listing_pages() {
    let fixture = Fixture::new("returns_next_offset_for_listing_pages");
    fixture.create_dir("albums");
    fixture.write_file("a.jpg", "image");
    fixture.write_file("b.jpg", "image");

    let runtime = FauplayRuntime::new();
    let first_page = runtime
        .list_local_directory(ListDirectoryRequest {
            root_path: fixture.root.clone(),
            root_relative_path: RootRelativePath::root(),
            flattened: false,
            entry_limit: Some(2),
            entry_offset: 0,
        })
        .expect("first Listing Page should be returned");

    assert_eq!(
        entry_summaries(&first_page.entries),
        vec![
            entry_summary("albums", "albums", DirectoryEntryKind::Directory, None),
            entry_summary("a.jpg", "a.jpg", DirectoryEntryKind::File, Some(5)),
        ],
    );
    assert_eq!(first_page.next_offset, Some(2));

    let second_page = runtime
        .list_local_directory(ListDirectoryRequest {
            root_path: fixture.root,
            root_relative_path: RootRelativePath::root(),
            flattened: false,
            entry_limit: Some(2),
            entry_offset: first_page.next_offset.expect("first page should continue"),
        })
        .expect("second Listing Page should be returned");

    assert_eq!(
        entry_summaries(&second_page.entries),
        vec![entry_summary(
            "b.jpg",
            "b.jpg",
            DirectoryEntryKind::File,
            Some(5),
        )],
    );
    assert_eq!(second_page.next_offset, None);
    assert!(!second_page.is_truncated);
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
            flattened: false,
            entry_limit: None,
            entry_offset: 0,
        })
        .expect("Root-relative Path should be normalized before listing");

    assert_eq!(
        entry_summaries(&response.entries),
        vec![entry_summary(
            "photo.jpg",
            "albums/2024/photo.jpg",
            DirectoryEntryKind::File,
            Some(5),
        )],
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
            flattened: false,
            entry_limit: None,
            entry_offset: 0,
        })
        .expect("local root should be listed");

    assert_eq!(
        entry_summaries(&response.entries),
        vec![entry_summary(
            "photo.jpg",
            "photo.jpg",
            DirectoryEntryKind::File,
            Some(5),
        )],
    );
}

fn entry_summaries(
    entries: &[DirectoryEntry],
) -> Vec<(String, String, DirectoryEntryKind, Option<u64>)> {
    entries
        .iter()
        .map(|entry| {
            (
                entry.name.clone(),
                entry.root_relative_path.to_string(),
                entry.kind,
                entry.size,
            )
        })
        .collect()
}

fn entry_summary(
    name: &str,
    root_relative_path: &str,
    kind: DirectoryEntryKind,
    size: Option<u64>,
) -> (String, String, DirectoryEntryKind, Option<u64>) {
    (name.to_owned(), root_relative_path.to_owned(), kind, size)
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
