use std::fs;
use std::path::{Path, PathBuf};

use fauplay_runtime::{FauplayRuntime, RootMoveFailureReason, RootMoveRequest, RootRelativePath};

#[test]
fn moves_root_relative_file_within_local_root() {
    let fixture = Fixture::new("moves_root_relative_file_within_local_root");
    fixture.write_file("albums/photo.jpg", "image");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .move_root_path(RootMoveRequest {
            root_path: fixture.root.clone(),
            source_root_relative_path: root_relative_path("albums/photo.jpg"),
            target_root_relative_path: root_relative_path("albums/renamed.jpg"),
            dry_run: false,
        })
        .expect("Root Move should run");

    assert_eq!(response.dry_run, false);
    assert!(response.ok);
    assert_eq!(
        response.source_root_relative_path.to_string(),
        "albums/photo.jpg"
    );
    assert_eq!(
        response.target_root_relative_path.to_string(),
        "albums/renamed.jpg"
    );
    assert_eq!(response.reason, None);
    assert_eq!(response.error, None);
    fixture.assert_missing("albums/photo.jpg");
    fixture.assert_file("albums/renamed.jpg", "image");
}

#[test]
fn plans_root_move_without_mutating_when_dry_run() {
    let fixture = Fixture::new("plans_root_move_without_mutating_when_dry_run");
    fixture.write_file("albums/photo.jpg", "image");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .move_root_path(RootMoveRequest {
            root_path: fixture.root.clone(),
            source_root_relative_path: root_relative_path("albums/photo.jpg"),
            target_root_relative_path: root_relative_path("albums/renamed.jpg"),
            dry_run: true,
        })
        .expect("Root Move dry run should run");

    assert_eq!(response.dry_run, true);
    assert!(response.ok);
    assert_eq!(
        response.target_root_relative_path.to_string(),
        "albums/renamed.jpg"
    );
    fixture.assert_file("albums/photo.jpg", "image");
    fixture.assert_missing("albums/renamed.jpg");
}

#[test]
fn reports_target_exists_without_overwriting() {
    let fixture = Fixture::new("reports_target_exists_without_overwriting");
    fixture.write_file("albums/photo.jpg", "new image");
    fixture.write_file("albums/renamed.jpg", "existing image");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .move_root_path(RootMoveRequest {
            root_path: fixture.root.clone(),
            source_root_relative_path: root_relative_path("albums/photo.jpg"),
            target_root_relative_path: root_relative_path("albums/renamed.jpg"),
            dry_run: false,
        })
        .expect("Root Move conflict should be reported");

    assert!(!response.ok);
    assert_eq!(response.reason, Some(RootMoveFailureReason::TargetExists));
    fixture.assert_file("albums/photo.jpg", "new image");
    fixture.assert_file("albums/renamed.jpg", "existing image");
}

#[test]
fn rejects_moving_directory_inside_itself() {
    let fixture = Fixture::new("rejects_moving_directory_inside_itself");
    fixture.write_file("albums/photo.jpg", "image");

    let runtime = FauplayRuntime::new();
    let response = runtime
        .move_root_path(RootMoveRequest {
            root_path: fixture.root.clone(),
            source_root_relative_path: root_relative_path("albums"),
            target_root_relative_path: root_relative_path("albums/nested"),
            dry_run: false,
        })
        .expect("Root Move should reject recursive directory moves");

    assert!(!response.ok);
    assert_eq!(response.reason, Some(RootMoveFailureReason::InvalidTarget));
    fixture.assert_file("albums/photo.jpg", "image");
    fixture.assert_missing("albums/nested");
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
