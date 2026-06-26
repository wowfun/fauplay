use std::fs;
#[cfg(unix)]
use std::os::unix::fs as unix_fs;

use fauplay_runtime::FauplayRuntime;

use super::support::*;

#[test]
fn runtime_api_lists_a_local_root_directory() {
    let fixture = Fixture::new("runtime_api_lists_a_local_root_directory");
    fixture.create_dir("albums");
    fixture.write_file("photo.jpg", "image");

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_list_request(&address, &fixture.root);
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"albums\""),
        "response should include the directory entry: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"photo.jpg\""),
        "response should include the file entry: {response}"
    );
}

#[test]
fn runtime_api_decodes_query_values_before_listing() {
    let fixture = Fixture::new("runtime api decodes query values");
    fixture.create_dir("albums/2024 photos");
    fixture.write_file("albums/2024 photos/photo one.jpg", "image");

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_list_request_with_root_relative_path(
        &address,
        &percent_encode(&fixture.root.to_string_lossy()),
        &percent_encode("albums/2024 photos"),
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"albums/2024 photos/photo one.jpg\""),
        "response should include the decoded child entry: {response}"
    );
}

#[test]
fn runtime_api_decodes_url_search_params_space_encoding() {
    let fixture = Fixture::new("runtime api decodes url search params space encoding");
    fixture.create_dir("albums/2024 photos");
    fixture.write_file("albums/2024 photos/photo one.jpg", "image");

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_list_request_with_root_relative_path(
        &address,
        &percent_encode(&fixture.root.to_string_lossy()),
        "albums/2024+photos",
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"albums/2024 photos/photo one.jpg\""),
        "response should decode + as a query-space encoding: {response}"
    );
}

#[test]
fn runtime_api_exposes_file_metadata_in_listings() {
    let fixture = Fixture::new("runtime_api_exposes_file_metadata");
    fixture.write_file("photo.jpg", "image");

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_list_request(&address, &fixture.root);
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"size\":5"),
        "response should include file size metadata: {response}"
    );
    assert!(
        response.contains("\"lastModifiedMs\":"),
        "response should include file modification metadata: {response}"
    );
}

#[test]
fn runtime_api_exposes_directory_emptiness_metadata() {
    let fixture = Fixture::new("runtime_api_exposes_directory_emptiness_metadata");
    fixture.create_dir("empty-album");
    fixture.create_dir("filled-album");
    fixture.write_file("filled-album/photo.jpg", "image");

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_list_request(&address, &fixture.root);
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains(
            "\"rootRelativePath\":\"empty-album\",\"kind\":\"directory\",\"isEmpty\":true"
        ),
        "response should include empty directory metadata: {response}"
    );
    assert!(
        response.contains(
            "\"rootRelativePath\":\"filled-album\",\"kind\":\"directory\",\"isEmpty\":false"
        ),
        "response should include non-empty directory metadata: {response}"
    );
}

#[test]
fn runtime_api_exposes_directory_entry_count_metadata() {
    let fixture = Fixture::new("runtime_api_exposes_directory_entry_count_metadata");
    fixture.create_dir("album/.trash");
    fixture.create_dir("album/nested");
    fixture.write_file("album/photo.jpg", "image");
    fixture.write_file("album/.trash/deleted.jpg", "deleted");

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_list_request(&address, &fixture.root);
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"album\",\"kind\":\"directory\",\"isEmpty\":false,\"entryCount\":2"),
        "response should include Directory Entry Count metadata: {response}"
    );
}

#[test]
fn runtime_api_lists_flattened_descendant_files() {
    let fixture = Fixture::new("runtime_api_lists_flattened_descendant_files");
    fixture.write_file("cover.jpg", "cover");
    fixture.create_dir("albums/2024");
    fixture.write_file("albums/2024/photo.jpg", "image");
    fixture.create_dir("albums/empty");

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_list_request_with_options(
        &address,
        &fixture.root.display().to_string(),
        "albums",
        &[("flattened", "true")],
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"albums/2024/photo.jpg\""),
        "response should include nested file entry: {response}"
    );
    assert!(
        !response.contains("\"rootRelativePath\":\"albums/2024\",\"kind\":\"directory\""),
        "Flattened Listing should not include directory entries: {response}"
    );
    assert!(
        !response.contains("\"rootRelativePath\":\"cover.jpg\""),
        "Flattened Listing should stay under the requested Root-relative Path: {response}"
    );
}

#[test]
fn runtime_api_marks_limited_listings_truncated() {
    let fixture = Fixture::new("runtime_api_marks_limited_listings_truncated");
    fixture.write_file("a.jpg", "image");
    fixture.write_file("b.jpg", "image");

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_list_request_with_options(
        &address,
        &fixture.root.display().to_string(),
        "",
        &[("limit", "1")],
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"isTruncated\":true"),
        "response should report a Truncated Listing: {response}"
    );
    assert_eq!(
        response.matches("\"kind\":\"file\"").count(),
        1,
        "response should only include the requested number of entries: {response}"
    );
}

#[test]
fn runtime_api_returns_next_offset_for_listing_pages() {
    let fixture = Fixture::new("runtime_api_returns_next_offset_for_listing_pages");
    fixture.write_file("a.jpg", "image");
    fixture.write_file("b.jpg", "image");
    fixture.write_file("c.jpg", "image");

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_list_request_with_options(
        &address,
        &fixture.root.display().to_string(),
        "",
        &[("limit", "1"), ("offset", "1")],
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"b.jpg\""),
        "response should return the requested Listing Page: {response}"
    );
    assert!(
        response.contains("\"nextOffset\":2"),
        "response should include the next Listing Page offset: {response}"
    );
}

#[test]
fn runtime_api_applies_listing_query_parameters() {
    let fixture = Fixture::new("runtime_api_applies_listing_query_parameters");
    fixture.write_file("a-small.jpg", "1");
    fixture.write_file("z-large.jpg", "12345");
    fixture.write_file("notes.txt", "notes");

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_list_request_with_options(
        &address,
        &fixture.root.display().to_string(),
        "",
        &[
            ("nameContains", "jpg"),
            ("entryFilter", "image"),
            ("sortBy", "size"),
            ("sortOrder", "desc"),
            ("limit", "1"),
        ],
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 200 OK\r\n"),
        "response should be OK: {response}"
    );
    assert!(
        response.contains("\"rootRelativePath\":\"z-large.jpg\""),
        "response should return the queried first Listing Page: {response}"
    );
    assert!(
        !response.contains("\"rootRelativePath\":\"notes.txt\""),
        "response should omit non-matching entries: {response}"
    );
    assert!(
        response.contains("\"nextOffset\":1"),
        "response should page the queried Listing: {response}"
    );
}

#[test]
fn runtime_api_rejects_root_relative_path_escape() {
    let fixture = Fixture::new("runtime_api_rejects_root_relative_path_escape");

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_list_request_with_root_relative_path(
        &address,
        &fixture.root.display().to_string(),
        "..",
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 400 Bad Request\r\n"),
        "response should reject invalid Root-relative Path: {response}"
    );
    assert!(
        response.contains("Root-relative Path"),
        "response should name the invalid domain term: {response}"
    );
}

#[cfg(unix)]
#[test]
fn runtime_api_rejects_listing_symlink_escape() {
    let fixture = Fixture::new("runtime_api_rejects_listing_symlink_escape");
    let outside_root = fixture
        .root
        .parent()
        .expect("fixture root should have a parent")
        .join("runtime_api_rejects_listing_symlink_escape_outside");
    let _ = fs::remove_dir_all(&outside_root);
    fs::create_dir_all(&outside_root).expect("outside fixture directory should be created");
    fs::write(outside_root.join("secret.txt"), "secret")
        .expect("outside fixture file should be written");
    unix_fs::symlink(&outside_root, fixture.root.join("linked"))
        .expect("fixture symlink should be created");

    let (address, server) = serve_runtime_once(FauplayRuntime::new());

    let response = send_list_request_with_root_relative_path(
        &address,
        &fixture.root.display().to_string(),
        "linked",
    );
    server.join().expect("server thread should finish");

    assert!(
        response.starts_with("HTTP/1.1 400 Bad Request\r\n"),
        "response should reject a symlink escape: {response}"
    );
    assert!(
        !response.contains("secret.txt"),
        "response should not list files outside the Local Root: {response}"
    );
    assert!(
        response.contains("Root-relative Path"),
        "response should name the invalid domain term: {response}"
    );
}
