use std::fs;
use std::path::{Path, PathBuf};

pub(crate) struct Fixture {
    pub(crate) root: PathBuf,
}

impl Fixture {
    pub(crate) fn new(name: &str) -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test-fixtures")
            .join(name);
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("fixture root should be created");
        Self { root }
    }

    pub(crate) fn create_dir(&self, relative_path: &str) {
        fs::create_dir_all(self.root.join(relative_path))
            .expect("fixture directory should be created");
    }

    pub(crate) fn write_file(&self, relative_path: &str, contents: &str) {
        let path = self.root.join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("fixture parent should be created");
        }
        fs::write(path, contents).expect("fixture file should be written");
    }

    pub(crate) fn write_bytes(&self, relative_path: &str, contents: &[u8]) {
        let path = self.root.join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("fixture parent should be created");
        }
        fs::write(path, contents).expect("fixture file should be written");
    }

    pub(crate) fn assert_file(&self, relative_path: &str, contents: &str) {
        let path = self.root.join(relative_path);
        let actual = fs::read_to_string(path).expect("fixture file should exist");
        assert_eq!(actual, contents);
    }

    pub(crate) fn assert_missing(&self, relative_path: &str) {
        assert!(
            !self.root.join(relative_path).exists(),
            "{relative_path} should not exist",
        );
    }
}
