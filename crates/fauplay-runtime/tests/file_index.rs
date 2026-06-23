use std::fs;
use std::path::{Path, PathBuf};

use fauplay_runtime::{
    FauplayRuntime, FileIndexEnsureRequest, FileIndexFailureReason, MissingFileCleanupRequest,
    RootRelativePath,
};

#[test]
fn ensures_file_index_entries_and_skips_fresh_entries() {
    let fixture = Fixture::new("ensures_file_index_entries_and_skips_fresh_entries");
    fixture.write_file("root/albums/photo.jpg", "image");
    let runtime = FauplayRuntime::with_runtime_home_path(fixture.runtime_home());

    let indexed = runtime
        .ensure_file_index_entries(FileIndexEnsureRequest {
            root_path: fixture.local_root(),
            root_relative_paths: vec![root_relative_path("albums/photo.jpg")],
        })
        .expect("File Index entries should be ensured");

    assert_eq!(indexed.total, 1);
    assert_eq!(indexed.indexed, 1);
    assert_eq!(indexed.skipped, 0);
    assert_eq!(indexed.failed, 0);
    assert_eq!(indexed.items[0].ok, true);
    assert_eq!(indexed.items[0].skipped, false);
    assert_eq!(
        indexed.items[0].root_relative_path.to_string(),
        "albums/photo.jpg"
    );
    assert_eq!(indexed.items[0].size, Some(5));

    let fresh = runtime
        .ensure_file_index_entries(FileIndexEnsureRequest {
            root_path: fixture.local_root(),
            root_relative_paths: vec![root_relative_path("albums/photo.jpg")],
        })
        .expect("fresh File Index entries should be skipped");

    assert_eq!(fresh.total, 1);
    assert_eq!(fresh.indexed, 0);
    assert_eq!(fresh.skipped, 1);
    assert_eq!(fresh.failed, 0);
    assert_eq!(fresh.items[0].ok, true);
    assert_eq!(fresh.items[0].skipped, true);
    assert_eq!(
        fresh.items[0].reason,
        Some(FileIndexFailureReason::IndexFresh)
    );
}

#[test]
fn reports_file_index_failures_without_stopping_the_batch() {
    let fixture = Fixture::new("reports_file_index_failures_without_stopping_the_batch");
    fixture.create_dir("root/albums");
    let runtime = FauplayRuntime::with_runtime_home_path(fixture.runtime_home());

    let response = runtime
        .ensure_file_index_entries(FileIndexEnsureRequest {
            root_path: fixture.local_root(),
            root_relative_paths: vec![
                root_relative_path("albums"),
                root_relative_path("missing.jpg"),
            ],
        })
        .expect("File Index batch should report item failures");

    assert_eq!(response.total, 2);
    assert_eq!(response.indexed, 0);
    assert_eq!(response.skipped, 0);
    assert_eq!(response.failed, 2);
    assert_eq!(
        response.items[0].reason,
        Some(FileIndexFailureReason::NotFile)
    );
    assert_eq!(
        response.items[1].reason,
        Some(FileIndexFailureReason::SourceNotFound)
    );
}

#[test]
fn missing_file_cleanup_removes_stale_file_index_entries() {
    let fixture = Fixture::new("missing_file_cleanup_removes_stale_file_index_entries");
    fixture.write_file("root/albums/photo.jpg", "image");
    let runtime = FauplayRuntime::with_runtime_home_path(fixture.runtime_home());

    runtime
        .ensure_file_index_entries(FileIndexEnsureRequest {
            root_path: fixture.local_root(),
            root_relative_paths: vec![root_relative_path("albums/photo.jpg")],
        })
        .expect("File Index entry should be ensured");
    fs::remove_file(fixture.local_root().join("albums/photo.jpg"))
        .expect("fixture file should be removed");

    let dry_run = runtime
        .cleanup_missing_files(MissingFileCleanupRequest {
            root_path: fixture.local_root(),
            confirm: false,
        })
        .expect("Missing File Cleanup should dry-run");

    assert_eq!(dry_run.dry_run, true);
    assert_eq!(dry_run.removed, 0);
    assert_eq!(dry_run.impact.file_index_entries, 1);
    assert_eq!(
        dry_run.missing_root_relative_paths,
        vec![root_relative_path("albums/photo.jpg")]
    );

    let committed = runtime
        .cleanup_missing_files(MissingFileCleanupRequest {
            root_path: fixture.local_root(),
            confirm: true,
        })
        .expect("Missing File Cleanup should commit");

    assert_eq!(committed.dry_run, false);
    assert_eq!(committed.removed, 1);
    assert_eq!(committed.impact.file_index_entries, 1);

    let after = runtime
        .cleanup_missing_files(MissingFileCleanupRequest {
            root_path: fixture.local_root(),
            confirm: false,
        })
        .expect("Missing File Cleanup should find no remaining stale entries");

    assert_eq!(after.missing_root_relative_paths.len(), 0);
    assert_eq!(after.impact.file_index_entries, 0);
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

    fn local_root(&self) -> PathBuf {
        self.root.join("root")
    }

    fn runtime_home(&self) -> PathBuf {
        self.root.join("runtime-home")
    }

    fn create_dir(&self, relative_path: &str) {
        fs::create_dir_all(self.root.join(relative_path))
            .expect("fixture directory should be created");
    }

    fn write_file(&self, relative_path: &str, contents: &str) {
        let path = self.root.join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("fixture parent should be created");
        }
        fs::write(path, contents).expect("fixture file should be written");
    }
}
