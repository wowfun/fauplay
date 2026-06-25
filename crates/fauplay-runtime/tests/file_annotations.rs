use std::fs;
use std::path::{Path, PathBuf};

use fauplay_runtime::{
    AnnotationTagOptionsRequest, FauplayRuntime, FileAnnotationActionSource,
    FileAnnotationMatchMode, FileAnnotationMissingCleanupRequest, FileAnnotationPathMapping,
    FileAnnotationPathRebindRequest, FileAnnotationQueryRequest, FileAnnotationReadRequest,
    FileAnnotationSetValueRequest, FileAnnotationTagBindingRequest, RootRelativePath,
};

#[test]
fn sets_and_reads_file_annotation_value() {
    let fixture = Fixture::new("sets_and_reads_file_annotation_value");
    fixture.write_file("root/albums/photo.jpg", "image");
    let runtime = FauplayRuntime::with_runtime_home_path(fixture.runtime_home());

    let mutation = runtime
        .set_file_annotation_value(FileAnnotationSetValueRequest {
            root_path: fixture.local_root(),
            root_relative_path: root_relative_path("albums/photo.jpg"),
            key: "rating".to_owned(),
            value: "5".to_owned(),
            source: FileAnnotationActionSource::Hotkey,
        })
        .expect("File Annotation should be set");

    assert_eq!(mutation.root_relative_path.to_string(), "albums/photo.jpg");
    assert_eq!(mutation.key, "rating");
    assert_eq!(mutation.value, "5");
    assert_eq!(mutation.source, FileAnnotationActionSource::Hotkey);

    let response = runtime
        .read_file_annotation(FileAnnotationReadRequest {
            root_path: fixture.local_root(),
            root_relative_path: root_relative_path("albums/photo.jpg"),
        })
        .expect("File Annotation should be readable");

    let file = response.file.expect("file should have a File Annotation");
    assert_eq!(file.root_relative_path.to_string(), "albums/photo.jpg");
    assert_eq!(file.tags.len(), 1);
    assert_eq!(file.tags[0].key, "rating");
    assert_eq!(file.tags[0].value, "5");
    assert_eq!(file.tags[0].source, "meta.annotation");
    assert!(file.tags[0].applied_at_ms > 0);
}

#[test]
fn setting_file_annotation_value_replaces_the_same_key() {
    let fixture = Fixture::new("setting_file_annotation_value_replaces_the_same_key");
    fixture.write_file("root/albums/photo.jpg", "image");
    let runtime = FauplayRuntime::with_runtime_home_path(fixture.runtime_home());

    runtime
        .set_file_annotation_value(FileAnnotationSetValueRequest {
            root_path: fixture.local_root(),
            root_relative_path: root_relative_path("albums/photo.jpg"),
            key: "rating".to_owned(),
            value: "3".to_owned(),
            source: FileAnnotationActionSource::Click,
        })
        .expect("first value should be set");
    runtime
        .set_file_annotation_value(FileAnnotationSetValueRequest {
            root_path: fixture.local_root(),
            root_relative_path: root_relative_path("albums/photo.jpg"),
            key: "rating".to_owned(),
            value: "5".to_owned(),
            source: FileAnnotationActionSource::Hotkey,
        })
        .expect("second value should be set");

    let response = runtime
        .read_file_annotation(FileAnnotationReadRequest {
            root_path: fixture.local_root(),
            root_relative_path: root_relative_path("albums/photo.jpg"),
        })
        .expect("File Annotation should be readable");

    let file = response.file.expect("file should have a File Annotation");
    assert_eq!(file.tags.len(), 1);
    assert_eq!(file.tags[0].key, "rating");
    assert_eq!(file.tags[0].value, "5");
}

#[test]
fn binds_and_unbinds_annotation_tags() {
    let fixture = Fixture::new("binds_and_unbinds_annotation_tags");
    fixture.write_file("root/albums/photo.jpg", "image");
    let runtime = FauplayRuntime::with_runtime_home_path(fixture.runtime_home());

    let favorite = FileAnnotationTagBindingRequest {
        root_path: fixture.local_root(),
        root_relative_path: root_relative_path("albums/photo.jpg"),
        key: "status".to_owned(),
        value: "favorite".to_owned(),
    };
    runtime
        .bind_file_annotation_tag(favorite.clone())
        .expect("first Annotation Tag should be bound");
    runtime
        .bind_file_annotation_tag(FileAnnotationTagBindingRequest {
            root_path: fixture.local_root(),
            root_relative_path: root_relative_path("albums/photo.jpg"),
            key: "status".to_owned(),
            value: "reviewed".to_owned(),
        })
        .expect("second Annotation Tag should be bound");
    let unbound = runtime
        .unbind_file_annotation_tag(favorite)
        .expect("first Annotation Tag should be unbound");

    assert_eq!(unbound.key, "status");
    assert_eq!(unbound.value, "favorite");
    assert_eq!(unbound.source, "meta.annotation");

    let response = runtime
        .read_file_annotation(FileAnnotationReadRequest {
            root_path: fixture.local_root(),
            root_relative_path: root_relative_path("albums/photo.jpg"),
        })
        .expect("File Annotation should be readable");

    let file = response.file.expect("file should have a File Annotation");
    assert_eq!(file.tags.len(), 1);
    assert_eq!(file.tags[0].key, "status");
    assert_eq!(file.tags[0].value, "reviewed");
}

#[test]
fn lists_annotation_tag_options_scoped_to_local_root() {
    let fixture = Fixture::new("lists_annotation_tag_options_scoped_to_local_root");
    fixture.write_file("root/albums/first.jpg", "first");
    fixture.write_file("root/albums/second.jpg", "second");
    fixture.write_file("other-root/albums/third.jpg", "third");
    let runtime = FauplayRuntime::with_runtime_home_path(fixture.runtime_home());

    bind_tag(
        &runtime,
        fixture.local_root(),
        "albums/first.jpg",
        "status",
        "favorite",
    );
    bind_tag(
        &runtime,
        fixture.local_root(),
        "albums/second.jpg",
        "status",
        "favorite",
    );
    bind_tag(
        &runtime,
        fixture.local_root(),
        "albums/second.jpg",
        "rating",
        "5",
    );
    bind_tag(
        &runtime,
        fixture.root.join("other-root"),
        "albums/third.jpg",
        "status",
        "favorite",
    );

    let response = runtime
        .list_annotation_tag_options(AnnotationTagOptionsRequest {
            root_path: Some(fixture.local_root()),
        })
        .expect("Annotation Tag Options should be listed");

    assert_eq!(response.items.len(), 2);
    assert_eq!(response.items[0].key, "rating");
    assert_eq!(response.items[0].value, "5");
    assert_eq!(response.items[0].file_count, 1);
    assert_eq!(response.items[1].key, "status");
    assert_eq!(response.items[1].value, "favorite");
    assert_eq!(response.items[1].file_count, 2);
}

#[test]
fn queries_file_annotations_by_tag_inside_local_root() {
    let fixture = Fixture::new("queries_file_annotations_by_tag_inside_local_root");
    fixture.write_file("root/albums/first.jpg", "first");
    fixture.write_file("root/albums/second.jpg", "second");
    fixture.write_file("other-root/albums/third.jpg", "third");
    let runtime = FauplayRuntime::with_runtime_home_path(fixture.runtime_home());

    bind_tag(
        &runtime,
        fixture.local_root(),
        "albums/first.jpg",
        "status",
        "favorite",
    );
    bind_tag(
        &runtime,
        fixture.local_root(),
        "albums/second.jpg",
        "status",
        "reviewed",
    );
    bind_tag(
        &runtime,
        fixture.root.join("other-root"),
        "albums/third.jpg",
        "status",
        "favorite",
    );

    let all_response = runtime
        .query_file_annotations(FileAnnotationQueryRequest {
            root_path: Some(fixture.local_root()),
            include_tag_keys: Vec::new(),
            exclude_tag_keys: Vec::new(),
            include_match_mode: FileAnnotationMatchMode::Or,
            page: 1,
            size: 100,
        })
        .expect("File Annotations should be queried");

    assert_eq!(all_response.total, 2);
    assert_eq!(
        all_response.items[0].root_relative_path.to_string(),
        "albums/first.jpg"
    );
    assert_eq!(
        all_response.items[1].root_relative_path.to_string(),
        "albums/second.jpg"
    );

    let favorite_response = runtime
        .query_file_annotations(FileAnnotationQueryRequest {
            root_path: Some(fixture.local_root()),
            include_tag_keys: vec![tag_key("status", "favorite")],
            exclude_tag_keys: Vec::new(),
            include_match_mode: FileAnnotationMatchMode::Or,
            page: 1,
            size: 100,
        })
        .expect("File Annotations should be filtered");

    assert_eq!(favorite_response.total, 1);
    assert_eq!(
        favorite_response.items[0].root_relative_path.to_string(),
        "albums/first.jpg"
    );
}

#[test]
fn rebinds_file_annotations_after_root_move() {
    let fixture = Fixture::new("rebinds_file_annotations_after_root_move");
    fixture.write_file("root/albums/photo.jpg", "image");
    let runtime = FauplayRuntime::with_runtime_home_path(fixture.runtime_home());
    bind_tag(
        &runtime,
        fixture.local_root(),
        "albums/photo.jpg",
        "status",
        "favorite",
    );
    fs::rename(
        fixture.local_root().join("albums/photo.jpg"),
        fixture.local_root().join("albums/renamed.jpg"),
    )
    .expect("fixture file should move");

    let response = runtime
        .rebind_file_annotation_paths(FileAnnotationPathRebindRequest {
            root_path: fixture.local_root(),
            mappings: vec![FileAnnotationPathMapping {
                from_root_relative_path: root_relative_path("albums/photo.jpg"),
                to_root_relative_path: root_relative_path("albums/renamed.jpg"),
            }],
        })
        .expect("File Annotation paths should be rebound");

    assert_eq!(response.updated, 1);
    assert_eq!(response.failed, 0);

    let old_response = runtime
        .read_file_annotation(FileAnnotationReadRequest {
            root_path: fixture.local_root(),
            root_relative_path: root_relative_path("albums/photo.jpg"),
        })
        .expect("old File Annotation path should be readable");
    assert!(old_response.file.is_none());

    let new_response = runtime
        .read_file_annotation(FileAnnotationReadRequest {
            root_path: fixture.local_root(),
            root_relative_path: root_relative_path("albums/renamed.jpg"),
        })
        .expect("new File Annotation path should be readable");
    let file = new_response
        .file
        .expect("new path should keep Annotation Tags");
    assert_eq!(file.tags.len(), 1);
    assert_eq!(file.tags[0].key, "status");
    assert_eq!(file.tags[0].value, "favorite");
}

#[test]
fn rebinds_file_annotations_by_merging_target_tags() {
    let fixture = Fixture::new("rebinds_file_annotations_by_merging_target_tags");
    fixture.write_file("root/albums/source.jpg", "source");
    fixture.write_file("root/albums/target.jpg", "target");
    let runtime = FauplayRuntime::with_runtime_home_path(fixture.runtime_home());
    bind_tag(
        &runtime,
        fixture.local_root(),
        "albums/source.jpg",
        "status",
        "favorite",
    );
    bind_tag(
        &runtime,
        fixture.local_root(),
        "albums/target.jpg",
        "rating",
        "5",
    );

    let response = runtime
        .rebind_file_annotation_paths(FileAnnotationPathRebindRequest {
            root_path: fixture.local_root(),
            mappings: vec![FileAnnotationPathMapping {
                from_root_relative_path: root_relative_path("albums/source.jpg"),
                to_root_relative_path: root_relative_path("albums/target.jpg"),
            }],
        })
        .expect("File Annotation paths should be rebound");

    assert_eq!(response.updated, 1);
    assert_eq!(response.failed, 0);

    let old_response = runtime
        .read_file_annotation(FileAnnotationReadRequest {
            root_path: fixture.local_root(),
            root_relative_path: root_relative_path("albums/source.jpg"),
        })
        .expect("old File Annotation path should be readable");
    assert!(old_response.file.is_none());

    let new_response = runtime
        .read_file_annotation(FileAnnotationReadRequest {
            root_path: fixture.local_root(),
            root_relative_path: root_relative_path("albums/target.jpg"),
        })
        .expect("target File Annotation should be readable");
    let file = new_response
        .file
        .expect("target path should keep merged Annotation Tags");
    let tags = file
        .tags
        .iter()
        .map(|tag| (tag.key.as_str(), tag.value.as_str()))
        .collect::<Vec<_>>();
    assert_eq!(tags, vec![("rating", "5"), ("status", "favorite")]);
}

#[test]
fn cleans_up_file_annotations_for_missing_files_after_confirmation() {
    let fixture = Fixture::new("cleans_up_file_annotations_for_missing_files_after_confirmation");
    fixture.write_file("root/albums/photo.jpg", "image");
    fixture.write_file("root/albums/kept.jpg", "image");
    let runtime = FauplayRuntime::with_runtime_home_path(fixture.runtime_home());
    bind_tag(
        &runtime,
        fixture.local_root(),
        "albums/photo.jpg",
        "status",
        "missing",
    );
    bind_tag(
        &runtime,
        fixture.local_root(),
        "albums/kept.jpg",
        "status",
        "kept",
    );
    fs::remove_file(fixture.local_root().join("albums/photo.jpg"))
        .expect("fixture file should be removed");

    let dry_run = runtime
        .cleanup_missing_file_annotations(FileAnnotationMissingCleanupRequest {
            root_path: fixture.local_root(),
            confirm: false,
        })
        .expect("Missing File Cleanup should run as a dry-run");

    assert_eq!(dry_run.dry_run, true);
    assert_eq!(
        dry_run.missing_root_relative_paths,
        vec![root_relative_path("albums/photo.jpg")]
    );
    assert_eq!(dry_run.removed, 0);
    fixture.write_file("root/albums/photo.jpg", "image");
    assert!(
        runtime
            .read_file_annotation(FileAnnotationReadRequest {
                root_path: fixture.local_root(),
                root_relative_path: root_relative_path("albums/photo.jpg"),
            })
            .expect("File Annotation should still exist after dry-run")
            .file
            .is_some()
    );
    fs::remove_file(fixture.local_root().join("albums/photo.jpg"))
        .expect("fixture file should be removed again");

    let committed = runtime
        .cleanup_missing_file_annotations(FileAnnotationMissingCleanupRequest {
            root_path: fixture.local_root(),
            confirm: true,
        })
        .expect("Missing File Cleanup should commit");

    assert_eq!(committed.dry_run, false);
    assert_eq!(committed.removed, 1);
    assert!(
        runtime
            .read_file_annotation(FileAnnotationReadRequest {
                root_path: fixture.local_root(),
                root_relative_path: root_relative_path("albums/photo.jpg"),
            })
            .expect("missing File Annotation should be readable")
            .file
            .is_none()
    );
    assert!(
        runtime
            .read_file_annotation(FileAnnotationReadRequest {
                root_path: fixture.local_root(),
                root_relative_path: root_relative_path("albums/kept.jpg"),
            })
            .expect("kept File Annotation should be readable")
            .file
            .is_some()
    );
}

fn bind_tag(
    runtime: &FauplayRuntime,
    root_path: PathBuf,
    relative_path: &str,
    key: &str,
    value: &str,
) {
    runtime
        .bind_file_annotation_tag(FileAnnotationTagBindingRequest {
            root_path,
            root_relative_path: root_relative_path(relative_path),
            key: key.to_owned(),
            value: value.to_owned(),
        })
        .expect("Annotation Tag should be bound");
}

fn tag_key(key: &str, value: &str) -> String {
    format!("{}={}", percent_encode(key), percent_encode(value))
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
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

    fn write_file(&self, relative_path: &str, contents: &str) {
        let path = self.root.join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("fixture parent should be created");
        }
        fs::write(path, contents).expect("fixture file should be written");
    }
}
