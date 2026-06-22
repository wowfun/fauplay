use std::fs;
use std::path::{Path, PathBuf};

use fauplay_runtime::{FauplayRuntime, GlobalTrashListRequest};

#[test]
fn loads_global_shortcut_config_from_runtime_home() {
    let fixture = Fixture::new("loads_global_shortcut_config_from_runtime_home");
    fixture.write_file(
        "global/shortcuts.json",
        r#"{"version":1,"keybinds":{"preview_next":["n"]}}"#,
    );

    let runtime = FauplayRuntime::with_runtime_home_path(fixture.root.clone());
    let response = runtime
        .load_global_shortcut_config()
        .expect("global shortcut config should be loaded");

    assert!(response.loaded);
    assert_eq!(
        response.path,
        fixture.root.join("global").join("shortcuts.json")
    );
    assert_eq!(
        response.config_json.as_deref(),
        Some(r#"{"version":1,"keybinds":{"preview_next":["n"]}}"#)
    );
}

#[test]
fn reports_missing_global_shortcut_config_without_error() {
    let fixture = Fixture::new("reports_missing_global_shortcut_config_without_error");

    let runtime = FauplayRuntime::with_runtime_home_path(fixture.root.clone());
    let response = runtime
        .load_global_shortcut_config()
        .expect("missing global shortcut config should be a valid state");

    assert!(!response.loaded);
    assert_eq!(
        response.path,
        fixture.root.join("global").join("shortcuts.json")
    );
    assert_eq!(response.config_json, None);
}

#[test]
fn rejects_invalid_global_shortcut_config_json() {
    let fixture = Fixture::new("rejects_invalid_global_shortcut_config_json");
    fixture.write_file("global/shortcuts.json", r#"{"version":1,"keybinds":"#);

    let runtime = FauplayRuntime::with_runtime_home_path(fixture.root);
    let error = runtime
        .load_global_shortcut_config()
        .expect_err("invalid global shortcut config should fail");

    assert!(
        error.to_string().contains("invalid global shortcut config"),
        "error should name the invalid config: {error}"
    );
}

#[test]
fn lists_global_trash_entries_from_runtime_home() {
    let fixture = Fixture::new("lists_global_trash_entries_from_runtime_home");
    fixture.write_file("global/recycle/files/item-1.jpg", "image");
    let stored_path = fixture.root.join("global/recycle/files/item-1.jpg");
    fixture.write_file(
        "global/recycle/items.json",
        &format!(
            r#"[{{"recycleId":"item-1","storedAbsolutePath":"{}","originalAbsolutePath":"/photos/original.jpg","name":"original.jpg","size":123,"mimeType":"image/jpeg","deletedAt":1700000000000}}]"#,
            json_path(&stored_path),
        ),
    );

    let runtime = FauplayRuntime::with_runtime_home_path(fixture.root.clone());
    let response = runtime
        .list_global_trash(GlobalTrashListRequest {
            entry_limit: None,
            entry_offset: 0,
        })
        .expect("Global Trash Listing should be returned");

    assert_eq!(response.entries.len(), 1);
    let entry = &response.entries[0];
    assert_eq!(entry.name, "original.jpg");
    assert_eq!(entry.absolute_path, stored_path);
    assert_eq!(
        entry.original_absolute_path,
        PathBuf::from("/photos/original.jpg")
    );
    assert_eq!(entry.recycle_id, "item-1");
    assert_eq!(entry.size, 123);
    assert_eq!(entry.mime_type, "image/jpeg");
    assert_eq!(entry.deleted_at_ms, 1_700_000_000_000);
    assert_eq!(response.is_truncated, false);
    assert_eq!(response.next_offset, None);
}

#[test]
fn reports_missing_global_trash_metadata_as_an_empty_listing() {
    let fixture = Fixture::new("reports_missing_global_trash_metadata_as_an_empty_listing");

    let runtime = FauplayRuntime::with_runtime_home_path(fixture.root);
    let response = runtime
        .list_global_trash(GlobalTrashListRequest {
            entry_limit: None,
            entry_offset: 0,
        })
        .expect("missing Global Trash metadata should be a valid empty state");

    assert!(response.entries.is_empty());
    assert_eq!(response.is_truncated, false);
    assert_eq!(response.next_offset, None);
}

fn json_path(path: &Path) -> String {
    path.display().to_string().replace('\\', "\\\\")
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
