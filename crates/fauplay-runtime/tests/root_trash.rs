use std::fs;
use std::path::{Path, PathBuf};

use fauplay_runtime::{
    FauplayRuntime, RootRelativePath, RootTrashFailureReason, RootTrashListRequest,
    RootTrashRequest,
};

#[test]
fn moves_root_relative_paths_to_root_trash() {
    let fixture = Fixture::new("moves_root_relative_paths_to_root_trash");
    fixture.write_file("photo.jpg", "image");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .move_to_root_trash(RootTrashRequest {
            root_path: fixture.root.clone(),
            root_relative_paths: vec![root_relative_path("photo.jpg")],
            dry_run: false,
        })
        .expect("Root Trash move should run");

    assert_eq!(response.dry_run, false);
    assert_eq!(response.total, 1);
    assert_eq!(response.completed, 1);
    assert_eq!(response.failed, 0);
    assert_eq!(
        response.items[0].root_relative_path.to_string(),
        "photo.jpg"
    );
    assert_eq!(
        response.items[0]
            .next_root_relative_path
            .as_ref()
            .map(ToString::to_string),
        Some(".trash/photo.jpg".to_owned()),
    );
    assert!(response.items[0].ok);
    fixture.assert_missing("photo.jpg");
    fixture.assert_file(".trash/photo.jpg", "image");
}

#[test]
fn plans_root_trash_move_without_mutating_when_dry_run() {
    let fixture = Fixture::new("plans_root_trash_move_without_mutating_when_dry_run");
    fixture.write_file("photo.jpg", "image");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .move_to_root_trash(RootTrashRequest {
            root_path: fixture.root.clone(),
            root_relative_paths: vec![root_relative_path("photo.jpg")],
            dry_run: true,
        })
        .expect("Root Trash dry run should run");

    assert_eq!(response.dry_run, true);
    assert_eq!(response.completed, 1);
    assert_eq!(
        response.items[0]
            .next_root_relative_path
            .as_ref()
            .map(ToString::to_string),
        Some(".trash/photo.jpg".to_owned()),
    );
    fixture.assert_file("photo.jpg", "image");
    fixture.assert_missing(".trash/photo.jpg");
}

#[test]
fn allocates_deduped_root_trash_path_when_target_exists() {
    let fixture = Fixture::new("allocates_deduped_root_trash_path_when_target_exists");
    fixture.write_file("photo.jpg", "new image");
    fixture.write_file(".trash/photo.jpg", "old image");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .move_to_root_trash(RootTrashRequest {
            root_path: fixture.root.clone(),
            root_relative_paths: vec![root_relative_path("photo.jpg")],
            dry_run: false,
        })
        .expect("Root Trash move should run");

    assert_eq!(
        response.items[0]
            .next_root_relative_path
            .as_ref()
            .map(ToString::to_string),
        Some(".trash/photo (1).jpg".to_owned()),
    );
    fixture.assert_file(".trash/photo.jpg", "old image");
    fixture.assert_file(".trash/photo (1).jpg", "new image");
}

#[test]
fn restores_root_trash_items_to_their_original_paths() {
    let fixture = Fixture::new("restores_root_trash_items_to_their_original_paths");
    fixture.write_file(".trash/albums/photo.jpg", "image");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .restore_from_root_trash(RootTrashRequest {
            root_path: fixture.root.clone(),
            root_relative_paths: vec![root_relative_path(".trash/albums/photo.jpg")],
            dry_run: false,
        })
        .expect("Root Trash restore should run");

    assert_eq!(response.completed, 1);
    assert_eq!(
        response.items[0]
            .next_root_relative_path
            .as_ref()
            .map(ToString::to_string),
        Some("albums/photo.jpg".to_owned()),
    );
    fixture.assert_missing(".trash/albums/photo.jpg");
    fixture.assert_file("albums/photo.jpg", "image");
}

#[test]
fn plans_root_trash_restore_without_mutating_when_dry_run() {
    let fixture = Fixture::new("plans_root_trash_restore_without_mutating_when_dry_run");
    fixture.write_file(".trash/albums/photo.jpg", "image");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .restore_from_root_trash(RootTrashRequest {
            root_path: fixture.root.clone(),
            root_relative_paths: vec![root_relative_path(".trash/albums/photo.jpg")],
            dry_run: true,
        })
        .expect("Root Trash restore dry run should run");

    assert_eq!(response.dry_run, true);
    assert_eq!(response.completed, 1);
    assert_eq!(response.failed, 0);
    assert_eq!(
        response.items[0]
            .next_root_relative_path
            .as_ref()
            .map(ToString::to_string),
        Some("albums/photo.jpg".to_owned()),
    );
    fixture.assert_file(".trash/albums/photo.jpg", "image");
    fixture.assert_missing("albums/photo.jpg");
}

#[test]
fn allocates_deduped_restore_path_when_original_path_exists() {
    let fixture = Fixture::new("allocates_deduped_restore_path_when_original_path_exists");
    fixture.write_file("photo.jpg", "current image");
    fixture.write_file(".trash/photo.jpg", "deleted image");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .restore_from_root_trash(RootTrashRequest {
            root_path: fixture.root.clone(),
            root_relative_paths: vec![root_relative_path(".trash/photo.jpg")],
            dry_run: false,
        })
        .expect("Root Trash restore should run");

    assert_eq!(
        response.items[0]
            .next_root_relative_path
            .as_ref()
            .map(ToString::to_string),
        Some("photo (1).jpg".to_owned()),
    );
    fixture.assert_file("photo.jpg", "current image");
    fixture.assert_file("photo (1).jpg", "deleted image");
}

#[test]
fn rejects_restore_sources_outside_root_trash() {
    let fixture = Fixture::new("rejects_restore_sources_outside_root_trash");
    fixture.write_file("photo.jpg", "image");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .restore_from_root_trash(RootTrashRequest {
            root_path: fixture.root.clone(),
            root_relative_paths: vec![root_relative_path("photo.jpg")],
            dry_run: false,
        })
        .expect("Root Trash restore should report item failures");

    assert_eq!(response.completed, 0);
    assert_eq!(response.failed, 1);
    assert_eq!(
        response.items[0].reason,
        Some(RootTrashFailureReason::InvalidSource),
    );
    fixture.assert_file("photo.jpg", "image");
}

#[test]
fn lists_files_currently_in_root_trash() {
    let fixture = Fixture::new("lists_files_currently_in_root_trash");
    fixture.write_file(".trash/albums/photo.jpg", "image");
    fixture.write_file(".trash/notes.txt", "notes");
    fixture.create_dir(".trash/empty-folder");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .list_root_trash(RootTrashListRequest {
            root_path: fixture.root.clone(),
            entry_limit: None,
            entry_offset: 0,
        })
        .expect("Root Trash Listing should be returned");

    let summaries = response
        .entries
        .iter()
        .map(|entry| {
            (
                entry.name.as_str(),
                entry.root_relative_path.to_string(),
                entry.original_root_relative_path.to_string(),
                entry.size,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        summaries,
        vec![
            (
                "photo.jpg",
                ".trash/albums/photo.jpg".to_owned(),
                "albums/photo.jpg".to_owned(),
                5,
            ),
            (
                "notes.txt",
                ".trash/notes.txt".to_owned(),
                "notes.txt".to_owned(),
                5,
            ),
        ]
    );
    assert_eq!(response.is_truncated, false);
    assert_eq!(response.next_offset, None);
    assert!(
        response
            .entries
            .iter()
            .all(|entry| entry.deleted_at_ms.is_some()),
        "Root Trash Entries should expose deletion timestamps"
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

    fn write_file(&self, relative_path: &str, contents: &str) {
        let path = self.root.join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("fixture parent should be created");
        }
        fs::write(path, contents).expect("fixture file should be written");
    }

    fn create_dir(&self, relative_path: &str) {
        fs::create_dir_all(self.root.join(relative_path))
            .expect("fixture directory should be created");
    }

    fn assert_file(&self, relative_path: &str, contents: &str) {
        let path = self.root.join(relative_path);
        let actual = fs::read_to_string(path).expect("fixture file should exist");
        assert_eq!(actual, contents);
    }

    fn assert_missing(&self, relative_path: &str) {
        assert!(
            !self.root.join(relative_path).exists(),
            "{relative_path} should not exist",
        );
    }
}
