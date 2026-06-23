use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use fauplay_runtime::{DuplicateFilesRequest, FauplayRuntime, RootRelativePath};

#[test]
fn finds_duplicate_files_inside_local_root() {
    let fixture = Fixture::new("finds_duplicate_files_inside_local_root");
    fixture.write_file("albums/current.jpg", "same image");
    fixture.write_file("albums/copy.jpg", "same image");
    fixture.write_file("albums/other.jpg", "different image");
    fixture.write_file(".trash/current.jpg", "same image");

    let response = FauplayRuntime::new()
        .find_duplicate_files(DuplicateFilesRequest {
            root_path: fixture.root.clone(),
            seed_root_relative_paths: vec![root_relative_path("albums/current.jpg")],
        })
        .expect("Duplicate File Query should run");

    assert_eq!(response.seed_count, 1);
    assert!(response.skipped_seeds.is_empty());
    assert_eq!(response.duplicate_sets.len(), 1);

    let duplicate_set = &response.duplicate_sets[0];
    assert_eq!(
        duplicate_set.seed_root_relative_paths,
        vec![root_relative_path("albums/current.jpg")]
    );
    assert_eq!(
        duplicate_set
            .files
            .iter()
            .map(|file| file.root_relative_path.to_string())
            .collect::<HashSet<_>>(),
        HashSet::from([
            "albums/current.jpg".to_owned(),
            "albums/copy.jpg".to_owned(),
        ])
    );
}

#[test]
fn groups_multiple_seed_paths_into_one_duplicate_set() {
    let fixture = Fixture::new("groups_multiple_seed_paths_into_one_duplicate_set");
    fixture.write_file("albums/a.jpg", "same image");
    fixture.write_file("albums/b.jpg", "same image");
    fixture.write_file("albums/c.jpg", "same image");

    let response = FauplayRuntime::new()
        .find_duplicate_files(DuplicateFilesRequest {
            root_path: fixture.root.clone(),
            seed_root_relative_paths: vec![
                root_relative_path("albums/a.jpg"),
                root_relative_path("albums/b.jpg"),
            ],
        })
        .expect("Duplicate File Query should run");

    assert_eq!(response.seed_count, 2);
    assert_eq!(response.duplicate_sets.len(), 1);
    assert_eq!(
        response.duplicate_sets[0].seed_root_relative_paths,
        vec![
            root_relative_path("albums/a.jpg"),
            root_relative_path("albums/b.jpg"),
        ]
    );
    assert_eq!(response.duplicate_sets[0].files.len(), 3);
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
}
