use std::fs;
use std::path::{Path, PathBuf};

use fauplay_runtime::{
    FauplayRuntime, GlobalTrashListRequest, GlobalTrashMoveRequest, GlobalTrashRestoreRequest,
};

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

#[test]
fn moves_file_to_global_trash_and_lists_entry() {
    let fixture = Fixture::new("moves_file_to_global_trash_and_lists_entry");
    fixture.write_file("source/original.jpg", "image");
    let source_path = fixture.root.join("source/original.jpg");

    let runtime = FauplayRuntime::with_runtime_home_path(fixture.root.clone());
    let response = runtime
        .move_to_global_trash(GlobalTrashMoveRequest {
            absolute_paths: vec![source_path.clone()],
            dry_run: false,
        })
        .expect("Global Trash move should run");

    assert_eq!(response.total, 1);
    assert_eq!(response.moved, 1);
    assert_eq!(response.failed, 0);
    assert_eq!(response.items[0].absolute_path, source_path);
    assert!(!response.items[0].recycle_id.is_empty());
    let stored_path = response.items[0]
        .next_absolute_path
        .as_ref()
        .expect("Global Trash move should return the stored path");
    assert!(!source_path.exists());
    assert_eq!(
        fs::read_to_string(stored_path).expect("stored file should be readable"),
        "image"
    );

    let listing = runtime
        .list_global_trash(GlobalTrashListRequest {
            entry_limit: None,
            entry_offset: 0,
        })
        .expect("Global Trash Listing should include the moved file");

    assert_eq!(listing.entries.len(), 1);
    assert_eq!(listing.entries[0].absolute_path, *stored_path);
    assert_eq!(listing.entries[0].original_absolute_path, source_path);
    assert_eq!(listing.entries[0].name, "original.jpg");
}

#[test]
fn restores_global_trash_entry_to_original_path_and_updates_metadata() {
    let fixture = Fixture::new("restores_global_trash_entry_to_original_path_and_updates_metadata");
    fixture.write_file("global/recycle/files/item-1.jpg", "image");
    let stored_path = fixture.root.join("global/recycle/files/item-1.jpg");
    let original_path = fixture.root.join("restored/original.jpg");
    fixture.write_file(
        "global/recycle/items.json",
        &format!(
            r#"[{{"recycleId":"item-1","storedAbsolutePath":"{}","originalAbsolutePath":"{}","name":"original.jpg","size":5,"mimeType":"image/jpeg","deletedAt":1700000000000}}]"#,
            json_path(&stored_path),
            json_path(&original_path),
        ),
    );

    let runtime = FauplayRuntime::with_runtime_home_path(fixture.root.clone());
    let response = runtime
        .restore_global_trash(GlobalTrashRestoreRequest {
            recycle_ids: vec!["item-1".to_owned()],
            dry_run: false,
        })
        .expect("Global Trash restore should run");

    assert_eq!(response.total, 1);
    assert_eq!(response.restored, 1);
    assert_eq!(response.failed, 0);
    assert_eq!(response.items[0].recycle_id, "item-1");
    assert_eq!(
        response.items[0].next_absolute_path.as_ref(),
        Some(&original_path)
    );
    assert!(!stored_path.exists());
    assert_eq!(
        fs::read_to_string(&original_path).expect("restored file should be readable"),
        "image"
    );
    assert_eq!(fixture.read_file("global/recycle/items.json"), "[]");
}

#[test]
fn restores_global_trash_entry_to_deduped_path_when_original_exists() {
    let fixture = Fixture::new("restores_global_trash_entry_to_deduped_path_when_original_exists");
    fixture.write_file("global/recycle/files/item-1.jpg", "new image");
    fixture.write_file("restored/original.jpg", "existing image");
    let stored_path = fixture.root.join("global/recycle/files/item-1.jpg");
    let original_path = fixture.root.join("restored/original.jpg");
    let expected_restore_path = fixture.root.join("restored/original (1).jpg");
    fixture.write_file(
        "global/recycle/items.json",
        &format!(
            r#"[{{"recycleId":"item-1","storedAbsolutePath":"{}","originalAbsolutePath":"{}","name":"original.jpg","size":9,"mimeType":"image/jpeg","deletedAt":1700000000000}}]"#,
            json_path(&stored_path),
            json_path(&original_path),
        ),
    );

    let runtime = FauplayRuntime::with_runtime_home_path(fixture.root.clone());
    let response = runtime
        .restore_global_trash(GlobalTrashRestoreRequest {
            recycle_ids: vec!["item-1".to_owned()],
            dry_run: false,
        })
        .expect("Global Trash restore should run");

    assert_eq!(response.restored, 1);
    assert_eq!(
        response.items[0].next_absolute_path.as_ref(),
        Some(&expected_restore_path)
    );
    assert_eq!(fixture.read_file("restored/original.jpg"), "existing image");
    assert_eq!(fixture.read_file("restored/original (1).jpg"), "new image");
    assert_eq!(fixture.read_file("global/recycle/items.json"), "[]");
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

    fn read_file(&self, relative_path: &str) -> String {
        fs::read_to_string(self.root.join(relative_path)).expect("fixture file should be readable")
    }
}
