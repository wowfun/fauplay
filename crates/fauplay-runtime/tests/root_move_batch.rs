use std::fs;
use std::path::{Path, PathBuf};

use fauplay_runtime::{
    FauplayRuntime, RootMoveBatchFailureReason, RootMoveBatchRequest, RootMoveRule,
    RootMoveSearchMode, RootRelativePath,
};

#[test]
fn plans_root_move_batch_without_mutating() {
    let fixture = Fixture::new("plans_root_move_batch_without_mutating");
    fixture.write_file("albums/a.jpg", "a");
    fixture.write_file("albums/b.jpg", "b");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .move_root_path_batch(RootMoveBatchRequest {
            root_path: fixture.root.clone(),
            source_root_relative_paths: vec![
                root_relative_path("albums/a.jpg"),
                root_relative_path("albums/b.jpg"),
            ],
            rule: RootMoveRule {
                name_mask: "[P]-[C]-[N]".to_owned(),
                find_text: String::new(),
                replace_text: String::new(),
                search_mode: RootMoveSearchMode::Plain,
                regex_flags: "g".to_owned(),
                counter_start: 3,
                counter_step: 1,
                counter_pad: 2,
            },
            dry_run: true,
        })
        .expect("Root Move Batch should run");

    assert_eq!(response.dry_run, true);
    assert_eq!(response.total, 2);
    assert_eq!(response.moved, 2);
    assert_eq!(response.skipped, 0);
    assert_eq!(response.failed, 0);
    assert_eq!(
        response.items[0].root_relative_path.to_string(),
        "albums/a.jpg"
    );
    assert_eq!(
        response.items[0]
            .next_root_relative_path
            .as_ref()
            .map(ToString::to_string),
        Some("albums/albums-03-a.jpg".to_owned())
    );
    assert_eq!(
        response.items[1]
            .next_root_relative_path
            .as_ref()
            .map(ToString::to_string),
        Some("albums/albums-04-b.jpg".to_owned())
    );
    fixture.assert_file("albums/a.jpg", "a");
    fixture.assert_file("albums/b.jpg", "b");
    fixture.assert_missing("albums/albums-03-a.jpg");
}

#[test]
fn applies_root_move_batch_with_deduped_targets() {
    let fixture = Fixture::new("applies_root_move_batch_with_deduped_targets");
    fixture.write_file("albums/photo.jpg", "photo");
    fixture.write_file("albums/clip.jpg", "clip");
    fixture.write_file("albums/renamed.jpg", "existing");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .move_root_path_batch(RootMoveBatchRequest {
            root_path: fixture.root.clone(),
            source_root_relative_paths: vec![
                root_relative_path("albums/photo.jpg"),
                root_relative_path("albums/clip.jpg"),
            ],
            rule: RootMoveRule {
                name_mask: "renamed".to_owned(),
                find_text: String::new(),
                replace_text: String::new(),
                search_mode: RootMoveSearchMode::Plain,
                regex_flags: "g".to_owned(),
                counter_start: 1,
                counter_step: 1,
                counter_pad: 0,
            },
            dry_run: false,
        })
        .expect("Root Move Batch should run");

    assert_eq!(response.dry_run, false);
    assert_eq!(response.total, 2);
    assert_eq!(response.moved, 2);
    assert_eq!(
        response.items[0]
            .next_root_relative_path
            .as_ref()
            .map(ToString::to_string),
        Some("albums/renamed (1).jpg".to_owned())
    );
    assert_eq!(
        response.items[1]
            .next_root_relative_path
            .as_ref()
            .map(ToString::to_string),
        Some("albums/renamed (2).jpg".to_owned())
    );
    fixture.assert_missing("albums/photo.jpg");
    fixture.assert_missing("albums/clip.jpg");
    fixture.assert_file("albums/renamed.jpg", "existing");
    fixture.assert_file("albums/renamed (1).jpg", "photo");
    fixture.assert_file("albums/renamed (2).jpg", "clip");
}

#[test]
fn applies_root_move_batch_regex_search_replace() {
    let fixture = Fixture::new("applies_root_move_batch_regex_search_replace");
    fixture.write_file("albums/IMG_001.jpg", "image");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .move_root_path_batch(RootMoveBatchRequest {
            root_path: fixture.root.clone(),
            source_root_relative_paths: vec![root_relative_path("albums/IMG_001.jpg")],
            rule: RootMoveRule {
                name_mask: "[N]".to_owned(),
                find_text: "^IMG_(\\d+)$".to_owned(),
                replace_text: "photo-$1".to_owned(),
                search_mode: RootMoveSearchMode::Regex,
                regex_flags: "g".to_owned(),
                counter_start: 1,
                counter_step: 1,
                counter_pad: 0,
            },
            dry_run: false,
        })
        .expect("Root Move Batch should run");

    assert_eq!(response.moved, 1);
    assert_eq!(
        response.items[0]
            .next_root_relative_path
            .as_ref()
            .map(ToString::to_string),
        Some("albums/photo-001.jpg".to_owned())
    );
    fixture.assert_missing("albums/IMG_001.jpg");
    fixture.assert_file("albums/photo-001.jpg", "image");
}

#[test]
fn skips_root_move_batch_items_that_keep_the_same_path() {
    let fixture = Fixture::new("skips_root_move_batch_items_that_keep_the_same_path");
    fixture.write_file("albums/photo.jpg", "image");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .move_root_path_batch(RootMoveBatchRequest {
            root_path: fixture.root.clone(),
            source_root_relative_paths: vec![root_relative_path("albums/photo.jpg")],
            rule: RootMoveRule {
                name_mask: "[N]".to_owned(),
                find_text: "photo".to_owned(),
                replace_text: "photo".to_owned(),
                search_mode: RootMoveSearchMode::Plain,
                regex_flags: "g".to_owned(),
                counter_start: 1,
                counter_step: 1,
                counter_pad: 0,
            },
            dry_run: false,
        })
        .expect("Root Move Batch should run");

    assert_eq!(response.total, 1);
    assert_eq!(response.moved, 0);
    assert_eq!(response.skipped, 1);
    assert_eq!(response.failed, 0);
    assert!(response.items[0].ok);
    assert!(response.items[0].skipped);
    assert_eq!(
        response.items[0].reason,
        Some(RootMoveBatchFailureReason::NoChange)
    );
    assert_eq!(
        response.items[0]
            .next_root_relative_path
            .as_ref()
            .map(ToString::to_string),
        Some("albums/photo.jpg".to_owned())
    );
    fixture.assert_file("albums/photo.jpg", "image");
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

    fn assert_file(&self, relative_path: &str, contents: &str) {
        let path = self.root.join(relative_path);
        let actual = fs::read_to_string(path).expect("fixture file should exist");
        assert_eq!(actual, contents);
    }

    fn assert_missing(&self, relative_path: &str) {
        assert!(
            !self.root.join(relative_path).exists(),
            "expected {relative_path} to be missing"
        );
    }
}
