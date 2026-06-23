use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;

use crate::{
    AnnotationTagOptionsRequest, AnnotationTagOptionsResponse, DirectoryEntryKind,
    DuplicateFilesRequest, DuplicateFilesResponse, DuplicateSeedSkipReason, FauplayRuntime,
    FileAnnotationActionSource, FileAnnotationMatchMode, FileAnnotationMissingCleanupRequest,
    FileAnnotationMissingCleanupResponse, FileAnnotationMutationResponse,
    FileAnnotationPathMapping, FileAnnotationPathRebindFailureReason,
    FileAnnotationPathRebindRequest, FileAnnotationPathRebindResponse, FileAnnotationQueryRequest,
    FileAnnotationQueryResponse, FileAnnotationReadRequest, FileAnnotationReadResponse,
    FileAnnotationSetValueRequest, FileAnnotationTagBindingRequest,
    FileAnnotationTagMutationResponse, FileContentRangeRequest, FileContentRequest,
    FileContentResponse, FileIndexEnsureRequest, FileIndexEnsureResponse, FileIndexFailureReason,
    FileMetadataRequest, FileMetadataResponse, GlobalShortcutConfigResponse,
    GlobalTrashFailureReason, GlobalTrashFileContentRequest, GlobalTrashFileMetadataRequest,
    GlobalTrashFileMetadataResponse, GlobalTrashListRequest, GlobalTrashListResponse,
    GlobalTrashMoveRequest, GlobalTrashMoveResponse, GlobalTrashRestoreRequest,
    GlobalTrashRestoreResponse, GlobalTrashTextPreviewRequest, ListDirectoryRequest,
    ListingEntryFilter, ListingOrder, ListingQuery, ListingSortDirection, ListingSortKey,
    RootMoveBatchFailureReason, RootMoveBatchRequest, RootMoveBatchResponse, RootMoveFailureReason,
    RootMoveRequest, RootMoveResponse, RootMoveRule, RootMoveSearchMode, RootRelativePath,
    RootTrashFailureReason, RootTrashListRequest, RootTrashListResponse, RootTrashMutationResponse,
    RootTrashRequest, RuntimeError, TextPreviewRequest, TextPreviewStatus,
};

const REQUEST_CHUNK_SIZE: usize = 1024;

pub fn serve_one_http_request(
    listener: TcpListener,
    runtime: FauplayRuntime,
) -> Result<(), RuntimeError> {
    let (mut stream, _) = listener
        .accept()
        .map_err(|source| RuntimeError::network("failed to accept Runtime API request", source))?;

    serve_http_stream(&runtime, &mut stream)
}

pub fn serve_http(listener: TcpListener, runtime: FauplayRuntime) -> Result<(), RuntimeError> {
    for stream_result in listener.incoming() {
        let mut stream = stream_result.map_err(|source| {
            RuntimeError::network("failed to accept Runtime API request", source)
        })?;
        serve_http_stream(&runtime, &mut stream)?;
    }

    Ok(())
}

fn serve_http_stream(runtime: &FauplayRuntime, stream: &mut TcpStream) -> Result<(), RuntimeError> {
    let request = read_http_request(&mut *stream)?;
    let response = handle_http_request(runtime, &request);
    let response_bytes = response.into_bytes();

    stream
        .write_all(&response_bytes)
        .map_err(|source| RuntimeError::network("failed to write Runtime API response", source))?;

    Ok(())
}

fn read_http_request(stream: &mut impl Read) -> Result<String, RuntimeError> {
    let mut request = Vec::new();
    let mut buffer = [0_u8; REQUEST_CHUNK_SIZE];
    let mut expected_request_length = None;

    loop {
        let byte_count = stream.read(&mut buffer).map_err(|source| {
            RuntimeError::network("failed to read Runtime API request", source)
        })?;
        if byte_count == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..byte_count]);
        if expected_request_length.is_none() {
            if let Some(header_end) = find_http_header_end(&request) {
                let header_text = String::from_utf8_lossy(&request[..header_end]).into_owned();
                let content_length = parse_header_value(&header_text, "content-length")
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                expected_request_length = Some(header_end + content_length);
            }
        }
        if expected_request_length.is_some_and(|expected| request.len() >= expected) {
            break;
        }
    }

    Ok(String::from_utf8_lossy(&request).into_owned())
}

fn find_http_header_end(request: &[u8]) -> Option<usize> {
    request
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
}

fn handle_http_request(runtime: &FauplayRuntime, request: &str) -> HttpResponse {
    match parse_http_request_line(request) {
        Some(("GET", "/v1/health")) => http_response(
            200,
            "OK",
            "{\"status\":\"ok\",\"runtime\":\"fauplay-runtime\"}",
        ),
        Some(("GET", "/v1/config/shortcuts")) => handle_global_shortcut_config(runtime),
        Some(("OPTIONS", target)) if is_preflight_target(target) => {
            http_response(204, "No Content", "")
        }
        Some(("GET", target))
            if target == "/v1/global-trash" || target.starts_with("/v1/global-trash?") =>
        {
            let query = target
                .strip_prefix("/v1/global-trash?")
                .map(parse_query_string)
                .unwrap_or_default();
            handle_list_global_trash(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/global-trash/file-content?") => {
            let query = parse_query_string(&target["/v1/global-trash/file-content?".len()..]);
            handle_global_trash_file_content(runtime, &query, parse_header_value(request, "range"))
        }
        Some(("GET", target)) if target.starts_with("/v1/global-trash/text-preview?") => {
            let query = parse_query_string(&target["/v1/global-trash/text-preview?".len()..]);
            handle_global_trash_text_preview(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/global-trash/file-metadata?") => {
            let query = parse_query_string(&target["/v1/global-trash/file-metadata?".len()..]);
            handle_global_trash_file_metadata(runtime, &query)
        }
        Some(("POST", target))
            if target == "/v1/global-trash/move"
                || target.starts_with("/v1/global-trash/move?") =>
        {
            let query = target
                .strip_prefix("/v1/global-trash/move?")
                .map(parse_query_pairs)
                .unwrap_or_default();
            handle_move_to_global_trash(runtime, &query)
        }
        Some(("POST", target))
            if target == "/v1/global-trash/restore"
                || target.starts_with("/v1/global-trash/restore?") =>
        {
            let query = target
                .strip_prefix("/v1/global-trash/restore?")
                .map(parse_query_pairs)
                .unwrap_or_default();
            handle_restore_global_trash(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/local-directory?") => {
            let query = parse_query_string(&target["/v1/local-directory?".len()..]);
            handle_list_local_directory(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/text-preview?") => {
            let query = parse_query_string(&target["/v1/text-preview?".len()..]);
            handle_text_preview(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/file-content?") => {
            let query = parse_query_string(&target["/v1/file-content?".len()..]);
            handle_file_content(runtime, &query, parse_header_value(request, "range"))
        }
        Some(("GET", target)) if target.starts_with("/v1/file-metadata?") => {
            let query = parse_query_string(&target["/v1/file-metadata?".len()..]);
            handle_file_metadata(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/duplicate-files?") => {
            let query = parse_query_pairs(&target["/v1/duplicate-files?".len()..]);
            handle_find_duplicate_files(runtime, &query)
        }
        Some(("POST", "/v1/duplicate-files")) => handle_find_duplicate_files_json(runtime, request),
        Some(("PUT", "/v1/file-annotations")) => handle_set_file_annotation_json(runtime, request),
        Some(("POST", "/v1/file-annotations/tags/bind")) => {
            handle_bind_file_annotation_tag_json(runtime, request)
        }
        Some(("POST", "/v1/file-annotations/tags/unbind")) => {
            handle_unbind_file_annotation_tag_json(runtime, request)
        }
        Some(("PATCH", "/v1/files/relative-paths")) => {
            handle_rebind_file_annotation_paths_json(runtime, request)
        }
        Some(("POST", "/v1/files/missing/cleanups")) => {
            handle_cleanup_missing_file_annotations_json(runtime, request)
        }
        Some(("POST", "/v1/files/indexes")) => {
            handle_ensure_file_index_entries_json(runtime, request)
        }
        Some(("POST", "/v1/data/tags/file")) => handle_read_file_annotation_json(runtime, request),
        Some(("POST", "/v1/data/tags/options")) => {
            handle_list_annotation_tag_options_json(runtime, request)
        }
        Some(("POST", "/v1/data/tags/query")) => {
            handle_query_file_annotations_json(runtime, request)
        }
        Some(("POST", "/v1/root-move/batch")) => handle_root_move_batch_json(runtime, request),
        Some(("POST", target))
            if target == "/v1/root-move" || target.starts_with("/v1/root-move?") =>
        {
            let query = target
                .strip_prefix("/v1/root-move?")
                .map(parse_query_string)
                .unwrap_or_default();
            handle_root_move(runtime, &query)
        }
        Some(("GET", target)) if target.starts_with("/v1/root-trash?") => {
            let query = parse_query_string(&target["/v1/root-trash?".len()..]);
            handle_list_root_trash(runtime, &query)
        }
        Some(("POST", target)) if target.starts_with("/v1/root-trash/move?") => {
            let query = parse_query_pairs(&target["/v1/root-trash/move?".len()..]);
            handle_move_to_root_trash(runtime, &query)
        }
        Some(("POST", target)) if target.starts_with("/v1/root-trash/restore?") => {
            let query = parse_query_pairs(&target["/v1/root-trash/restore?".len()..]);
            handle_restore_from_root_trash(runtime, &query)
        }
        _ => http_response(404, "Not Found", "{\"error\":\"not found\"}"),
    }
}

fn is_preflight_target(target: &str) -> bool {
    matches!(
        target,
        "/v1/local-directory"
            | "/v1/config/shortcuts"
            | "/v1/global-trash"
            | "/v1/global-trash/file-content"
            | "/v1/global-trash/text-preview"
            | "/v1/global-trash/file-metadata"
            | "/v1/global-trash/move"
            | "/v1/global-trash/restore"
            | "/v1/text-preview"
            | "/v1/file-content"
            | "/v1/file-metadata"
            | "/v1/duplicate-files"
            | "/v1/file-annotations"
            | "/v1/file-annotations/tags/bind"
            | "/v1/file-annotations/tags/unbind"
            | "/v1/files/relative-paths"
            | "/v1/files/missing/cleanups"
            | "/v1/files/indexes"
            | "/v1/data/tags/file"
            | "/v1/data/tags/options"
            | "/v1/data/tags/query"
            | "/v1/root-move"
            | "/v1/root-move/batch"
            | "/v1/root-trash"
            | "/v1/root-trash/move"
            | "/v1/root-trash/restore"
    )
}

fn handle_global_shortcut_config(runtime: &FauplayRuntime) -> HttpResponse {
    match runtime.load_global_shortcut_config() {
        Ok(response) => http_response(200, "OK", &global_shortcut_config_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_list_global_trash(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
) -> HttpResponse {
    match runtime.list_global_trash(GlobalTrashListRequest {
        entry_limit: parse_entry_limit(query.get("limit").map(String::as_str)),
        entry_offset: parse_entry_offset(query.get("offset").map(String::as_str)),
    }) {
        Ok(response) => http_response(200, "OK", &global_trash_list_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_global_trash_file_content(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
    range_header: Option<&str>,
) -> HttpResponse {
    let Some(recycle_id) = query.get("recycleId").map(String::as_str) else {
        return http_response(400, "Bad Request", "{\"error\":\"recycleId is required\"}");
    };

    match runtime.read_global_trash_file_content(GlobalTrashFileContentRequest {
        recycle_id: recycle_id.to_owned(),
        range: range_header.and_then(parse_file_content_range),
    }) {
        Ok(Some(response)) => file_content_response(response),
        Ok(None) => http_response(
            404,
            "Not Found",
            "{\"error\":\"Global Trash Entry was not found\"}",
        ),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_global_trash_text_preview(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
) -> HttpResponse {
    let Some(recycle_id) = query.get("recycleId").map(String::as_str) else {
        return http_response(400, "Bad Request", "{\"error\":\"recycleId is required\"}");
    };
    let size_limit_bytes = query
        .get("sizeLimitBytes")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(64 * 1024);

    match runtime.read_global_trash_text_preview(GlobalTrashTextPreviewRequest {
        recycle_id: recycle_id.to_owned(),
        size_limit_bytes,
    }) {
        Ok(Some(response)) => http_response(200, "OK", &text_preview_response_json(response)),
        Ok(None) => http_response(
            404,
            "Not Found",
            "{\"error\":\"Global Trash Entry was not found\"}",
        ),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_global_trash_file_metadata(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
) -> HttpResponse {
    let Some(recycle_id) = query.get("recycleId").map(String::as_str) else {
        return http_response(400, "Bad Request", "{\"error\":\"recycleId is required\"}");
    };

    match runtime.read_global_trash_file_metadata(GlobalTrashFileMetadataRequest {
        recycle_id: recycle_id.to_owned(),
    }) {
        Ok(Some(response)) => http_response(
            200,
            "OK",
            &global_trash_file_metadata_response_json(response),
        ),
        Ok(None) => http_response(
            404,
            "Not Found",
            "{\"error\":\"Global Trash Entry was not found\"}",
        ),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_move_to_global_trash(
    runtime: &FauplayRuntime,
    query: &[(String, String)],
) -> HttpResponse {
    let absolute_paths = query_values(query, "absolutePath")
        .into_iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    if absolute_paths.is_empty() {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"absolutePath is required\"}",
        );
    }

    match runtime.move_to_global_trash(GlobalTrashMoveRequest {
        absolute_paths,
        dry_run: first_query_value(query, "dryRun").is_some_and(|value| value == "true"),
    }) {
        Ok(response) => http_response(200, "OK", &global_trash_move_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_restore_global_trash(
    runtime: &FauplayRuntime,
    query: &[(String, String)],
) -> HttpResponse {
    let recycle_ids = query_values(query, "recycleId")
        .into_iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    if recycle_ids.is_empty() {
        return http_response(400, "Bad Request", "{\"error\":\"recycleId is required\"}");
    }

    match runtime.restore_global_trash(GlobalTrashRestoreRequest {
        recycle_ids,
        dry_run: first_query_value(query, "dryRun").is_some_and(|value| value == "true"),
    }) {
        Ok(response) => http_response(200, "OK", &global_trash_restore_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_list_local_directory(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
) -> HttpResponse {
    let Some(root_path) = query.get("rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_path = query
        .get("rootRelativePath")
        .map(String::as_str)
        .unwrap_or("");

    let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };

    match runtime.list_local_directory(ListDirectoryRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
        flattened: query.get("flattened").is_some_and(|value| value == "true"),
        entry_limit: parse_entry_limit(query.get("limit").map(String::as_str)),
        entry_offset: parse_entry_offset(query.get("offset").map(String::as_str)),
        query: parse_listing_query(query),
    }) {
        Ok(response) => http_response(200, "OK", &list_directory_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn parse_entry_limit(value: Option<&str>) -> Option<usize> {
    let limit = value?.parse::<usize>().ok()?;
    (limit > 0).then_some(limit)
}

fn parse_entry_offset(value: Option<&str>) -> usize {
    value
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0)
}

fn parse_listing_query(query: &HashMap<String, String>) -> ListingQuery {
    ListingQuery {
        name_contains: query
            .get("nameContains")
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty()),
        entry_filter: parse_listing_entry_filter(query.get("entryFilter").map(String::as_str)),
        order: ListingOrder {
            sort_key: parse_listing_sort_key(query.get("sortBy").map(String::as_str)),
            direction: parse_listing_sort_direction(query.get("sortOrder").map(String::as_str)),
        },
        hide_empty_folders: query
            .get("hideEmptyFolders")
            .is_some_and(|value| value == "true"),
    }
}

fn parse_listing_entry_filter(value: Option<&str>) -> ListingEntryFilter {
    match value {
        Some("image") => ListingEntryFilter::Image,
        Some("video") => ListingEntryFilter::Video,
        _ => ListingEntryFilter::All,
    }
}

fn parse_listing_sort_key(value: Option<&str>) -> ListingSortKey {
    match value {
        Some("date") => ListingSortKey::Date,
        Some("size") => ListingSortKey::Size,
        _ => ListingSortKey::Name,
    }
}

fn parse_listing_sort_direction(value: Option<&str>) -> ListingSortDirection {
    match value {
        Some("desc") => ListingSortDirection::Desc,
        _ => ListingSortDirection::Asc,
    }
}

fn handle_text_preview(runtime: &FauplayRuntime, query: &HashMap<String, String>) -> HttpResponse {
    let Some(root_path) = query.get("rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_path = query
        .get("rootRelativePath")
        .map(String::as_str)
        .unwrap_or("");
    let size_limit_bytes = query
        .get("sizeLimitBytes")
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(1024 * 1024);

    let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };

    match runtime.read_text_preview(TextPreviewRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
        size_limit_bytes,
    }) {
        Ok(response) => http_response(200, "OK", &text_preview_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_file_content(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
    range_header: Option<&str>,
) -> HttpResponse {
    let Some(root_path) = query.get("rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_path = query
        .get("rootRelativePath")
        .map(String::as_str)
        .unwrap_or("");

    let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };

    match runtime.read_file_content(FileContentRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
        range: range_header.and_then(parse_file_content_range),
    }) {
        Ok(response) => file_content_response(response),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_file_metadata(runtime: &FauplayRuntime, query: &HashMap<String, String>) -> HttpResponse {
    let Some(root_path) = query.get("rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_path = query
        .get("rootRelativePath")
        .map(String::as_str)
        .unwrap_or("");

    let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };

    match runtime.read_file_metadata(FileMetadataRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
    }) {
        Ok(response) => http_response(200, "OK", &file_metadata_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_find_duplicate_files(
    runtime: &FauplayRuntime,
    query: &[(String, String)],
) -> HttpResponse {
    let Some(root_path) = first_query_value(query, "rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_paths = query_values(query, "rootRelativePath");
    if root_relative_paths.is_empty() {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"rootRelativePath is required\"}",
        );
    }

    let mut seed_root_relative_paths = Vec::new();
    for root_relative_path in root_relative_paths {
        let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
            Ok(path) => path,
            Err(error) => {
                return http_response(400, "Bad Request", &error_json(&error.to_string()));
            }
        };
        seed_root_relative_paths.push(root_relative_path);
    }

    match runtime.find_duplicate_files(DuplicateFilesRequest {
        root_path: PathBuf::from(root_path),
        seed_root_relative_paths,
    }) {
        Ok(response) => http_response(200, "OK", &duplicate_files_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_find_duplicate_files_json(runtime: &FauplayRuntime, request: &str) -> HttpResponse {
    let body = http_request_body(request).trim();
    if body.is_empty() {
        return http_response(400, "Bad Request", "{\"error\":\"JSON body is required\"}");
    }

    let payload = match serde_json::from_str::<serde_json::Value>(body) {
        Ok(payload) => payload,
        Err(error) => {
            return http_response(
                400,
                "Bad Request",
                &error_json(&format!("invalid JSON body: {error}")),
            );
        }
    };
    let Some(root_path) = json_string_field(&payload, "rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_paths = json_root_relative_path_values(&payload);
    if root_relative_paths.is_empty() {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"rootRelativePath is required\"}",
        );
    }

    let mut seed_root_relative_paths = Vec::new();
    for root_relative_path in root_relative_paths {
        let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
            Ok(path) => path,
            Err(error) => {
                return http_response(400, "Bad Request", &error_json(&error.to_string()));
            }
        };
        seed_root_relative_paths.push(root_relative_path);
    }

    match runtime.find_duplicate_files(DuplicateFilesRequest {
        root_path: PathBuf::from(root_path),
        seed_root_relative_paths,
    }) {
        Ok(response) => http_response(200, "OK", &duplicate_files_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_set_file_annotation_json(runtime: &FauplayRuntime, request: &str) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let Some(root_path) = json_string_field(&payload, "rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let Some(root_relative_path) = json_file_annotation_relative_path(&payload) else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"relativePath is required\"}",
        );
    };
    let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };
    let Some(key) =
        json_string_field(&payload, "fieldKey").or_else(|| json_string_field(&payload, "key"))
    else {
        return http_response(400, "Bad Request", "{\"error\":\"fieldKey is required\"}");
    };
    let Some(value) = json_string_field(&payload, "value") else {
        return http_response(400, "Bad Request", "{\"error\":\"value is required\"}");
    };

    match runtime.set_file_annotation_value(FileAnnotationSetValueRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
        key: key.to_owned(),
        value: value.to_owned(),
        source: parse_file_annotation_action_source(json_string_field(&payload, "source")),
    }) {
        Ok(response) => http_response(200, "OK", &file_annotation_set_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

fn handle_bind_file_annotation_tag_json(runtime: &FauplayRuntime, request: &str) -> HttpResponse {
    handle_file_annotation_tag_binding_json(runtime, request, FileAnnotationTagBindingKind::Bind)
}

fn handle_unbind_file_annotation_tag_json(runtime: &FauplayRuntime, request: &str) -> HttpResponse {
    handle_file_annotation_tag_binding_json(runtime, request, FileAnnotationTagBindingKind::Unbind)
}

#[derive(Debug, Clone, Copy)]
enum FileAnnotationTagBindingKind {
    Bind,
    Unbind,
}

fn handle_file_annotation_tag_binding_json(
    runtime: &FauplayRuntime,
    request: &str,
    kind: FileAnnotationTagBindingKind,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let Some(root_path) = json_string_field(&payload, "rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let Some(root_relative_path) = json_file_annotation_relative_path(&payload) else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"relativePath is required\"}",
        );
    };
    let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };
    let Some(key) = json_string_field(&payload, "key") else {
        return http_response(400, "Bad Request", "{\"error\":\"key is required\"}");
    };
    let Some(value) = json_string_field(&payload, "value") else {
        return http_response(400, "Bad Request", "{\"error\":\"value is required\"}");
    };
    let request = FileAnnotationTagBindingRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
        key: key.to_owned(),
        value: value.to_owned(),
    };
    let result = match kind {
        FileAnnotationTagBindingKind::Bind => runtime.bind_file_annotation_tag(request),
        FileAnnotationTagBindingKind::Unbind => runtime.unbind_file_annotation_tag(request),
    };

    match result {
        Ok(response) => http_response(200, "OK", &file_annotation_tag_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

fn handle_read_file_annotation_json(runtime: &FauplayRuntime, request: &str) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let Some(root_path) = json_string_field(&payload, "rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let Some(root_relative_path) = json_file_annotation_relative_path(&payload) else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"relativePath is required\"}",
        );
    };
    let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
        Ok(path) => path,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };

    match runtime.read_file_annotation(FileAnnotationReadRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
    }) {
        Ok(response) => http_response(200, "OK", &file_annotation_read_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

fn handle_list_annotation_tag_options_json(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    match runtime.list_annotation_tag_options(AnnotationTagOptionsRequest {
        root_path: json_string_field(&payload, "rootPath").map(PathBuf::from),
    }) {
        Ok(response) => http_response(200, "OK", &annotation_tag_options_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

fn handle_query_file_annotations_json(runtime: &FauplayRuntime, request: &str) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let page = json_usize_or_default(&payload, "page", 1)
        .unwrap_or(1)
        .max(1);
    let size = json_usize_or_default(&payload, "size", 500)
        .unwrap_or(500)
        .clamp(1, 5000);
    let include_match_mode =
        match json_string_or_default(&payload, "includeMatchMode", "or").as_str() {
            "and" => FileAnnotationMatchMode::And,
            _ => FileAnnotationMatchMode::Or,
        };

    match runtime.query_file_annotations(FileAnnotationQueryRequest {
        root_path: json_string_field(&payload, "rootPath").map(PathBuf::from),
        include_tag_keys: json_string_array_field(&payload, "includeTagKeys"),
        exclude_tag_keys: json_string_array_field(&payload, "excludeTagKeys"),
        include_match_mode,
        page,
        size,
    }) {
        Ok(response) => http_response(200, "OK", &file_annotation_query_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

fn handle_rebind_file_annotation_paths_json(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let Some(root_path) = json_string_field(&payload, "rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let Some(mappings) = payload
        .get("mappings")
        .and_then(serde_json::Value::as_array)
    else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"mappings must be an array\"}",
        );
    };
    let mut parsed_mappings = Vec::with_capacity(mappings.len());
    for mapping in mappings {
        let Some(from_root_relative_path) =
            json_mapping_path_field(mapping, "fromRelativePath", Some("relativePath"))
        else {
            return http_response(
                400,
                "Bad Request",
                "{\"error\":\"fromRelativePath is required\"}",
            );
        };
        let Some(to_root_relative_path) =
            json_mapping_path_field(mapping, "toRelativePath", Some("nextRelativePath"))
        else {
            return http_response(
                400,
                "Bad Request",
                "{\"error\":\"toRelativePath is required\"}",
            );
        };
        let from_root_relative_path = match RootRelativePath::try_from(from_root_relative_path) {
            Ok(path) => path,
            Err(error) => {
                return http_response(400, "Bad Request", &error_json(&error.to_string()));
            }
        };
        let to_root_relative_path = match RootRelativePath::try_from(to_root_relative_path) {
            Ok(path) => path,
            Err(error) => {
                return http_response(400, "Bad Request", &error_json(&error.to_string()));
            }
        };
        parsed_mappings.push(FileAnnotationPathMapping {
            from_root_relative_path,
            to_root_relative_path,
        });
    }

    match runtime.rebind_file_annotation_paths(FileAnnotationPathRebindRequest {
        root_path: PathBuf::from(root_path),
        mappings: parsed_mappings,
    }) {
        Ok(response) => http_response(200, "OK", &file_annotation_rebind_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

fn handle_cleanup_missing_file_annotations_json(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let Some(root_path) = json_string_field(&payload, "rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };

    match runtime.cleanup_missing_file_annotations(FileAnnotationMissingCleanupRequest {
        root_path: PathBuf::from(root_path),
        confirm: json_bool_field(&payload, "confirm"),
    }) {
        Ok(response) => http_response(
            200,
            "OK",
            &file_annotation_missing_cleanup_response_json(response),
        ),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

fn handle_ensure_file_index_entries_json(runtime: &FauplayRuntime, request: &str) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let Some(root_path) = json_string_field(&payload, "rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_paths = json_root_relative_path_values(&payload);
    if root_relative_paths.is_empty() {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"relativePaths is required\"}",
        );
    }

    let mut parsed_root_relative_paths = Vec::with_capacity(root_relative_paths.len());
    for root_relative_path in root_relative_paths {
        let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
            Ok(path) => path,
            Err(error) => {
                return http_response(400, "Bad Request", &error_json(&error.to_string()));
            }
        };
        parsed_root_relative_paths.push(root_relative_path);
    }

    match runtime.ensure_file_index_entries(FileIndexEnsureRequest {
        root_path: PathBuf::from(root_path),
        root_relative_paths: parsed_root_relative_paths,
    }) {
        Ok(response) => http_response(200, "OK", &file_index_ensure_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

fn parse_json_body(request: &str) -> Result<serde_json::Value, HttpResponse> {
    let body = http_request_body(request).trim();
    if body.is_empty() {
        return Err(http_response(
            400,
            "Bad Request",
            "{\"error\":\"JSON body is required\"}",
        ));
    }
    serde_json::from_str::<serde_json::Value>(body).map_err(|error| {
        http_response(
            400,
            "Bad Request",
            &error_json(&format!("invalid JSON body: {error}")),
        )
    })
}

fn http_request_body(request: &str) -> &str {
    request
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or("")
}

fn json_string_field<'a>(payload: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    payload
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn json_file_annotation_relative_path(payload: &serde_json::Value) -> Option<&str> {
    json_string_field(payload, "relativePath")
        .or_else(|| json_string_field(payload, "rootRelativePath"))
}

fn json_string_array_field(payload: &serde_json::Value, key: &str) -> Vec<String> {
    match payload.get(key) {
        Some(serde_json::Value::Array(values)) => values
            .iter()
            .filter_map(|value| {
                value
                    .as_str()
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
                    .map(ToOwned::to_owned)
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn json_mapping_path_field<'a>(
    mapping: &'a serde_json::Value,
    key: &str,
    fallback_key: Option<&str>,
) -> Option<&'a str> {
    json_string_field(mapping, key)
        .or_else(|| fallback_key.and_then(|fallback_key| json_string_field(mapping, fallback_key)))
}

fn parse_file_annotation_action_source(value: Option<&str>) -> FileAnnotationActionSource {
    match value {
        Some("hotkey") => FileAnnotationActionSource::Hotkey,
        _ => FileAnnotationActionSource::Click,
    }
}

fn json_root_relative_path_values(payload: &serde_json::Value) -> Vec<&str> {
    let value = payload
        .get("rootRelativePath")
        .or_else(|| payload.get("rootRelativePaths"))
        .or_else(|| payload.get("relativePath"))
        .or_else(|| payload.get("relativePaths"));

    match value {
        Some(serde_json::Value::String(value)) if !value.trim().is_empty() => vec![value.trim()],
        Some(serde_json::Value::Array(values)) => values
            .iter()
            .filter_map(|value| {
                value
                    .as_str()
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn json_root_move_batch_path_values(payload: &serde_json::Value) -> Vec<&str> {
    let value = payload
        .get("rootRelativePaths")
        .or_else(|| payload.get("rootRelativePath"))
        .or_else(|| payload.get("sourceRootRelativePaths"))
        .or_else(|| payload.get("sourceRootRelativePath"));

    match value {
        Some(serde_json::Value::String(value)) if !value.trim().is_empty() => vec![value.trim()],
        Some(serde_json::Value::Array(values)) => values
            .iter()
            .filter_map(|value| {
                value
                    .as_str()
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn json_bool_field(payload: &serde_json::Value, key: &str) -> bool {
    payload.get(key).and_then(serde_json::Value::as_bool) == Some(true)
}

fn json_string_or_default(payload: &serde_json::Value, key: &str, default_value: &str) -> String {
    payload
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| default_value.to_owned())
}

fn json_i64_or_default(payload: &serde_json::Value, key: &str, default_value: i64) -> Option<i64> {
    match payload.get(key) {
        Some(serde_json::Value::Number(value)) => value.as_i64(),
        Some(serde_json::Value::String(value)) if value.trim().is_empty() => Some(default_value),
        Some(serde_json::Value::String(value)) => value.trim().parse::<i64>().ok(),
        None => Some(default_value),
        _ => None,
    }
}

fn json_usize_or_default(
    payload: &serde_json::Value,
    key: &str,
    default_value: usize,
) -> Option<usize> {
    match payload.get(key) {
        Some(serde_json::Value::Number(value)) => {
            value.as_u64().and_then(|value| value.try_into().ok())
        }
        Some(serde_json::Value::String(value)) if value.trim().is_empty() => Some(default_value),
        Some(serde_json::Value::String(value)) => value.trim().parse::<usize>().ok(),
        None => Some(default_value),
        _ => None,
    }
}

fn handle_root_move(runtime: &FauplayRuntime, query: &HashMap<String, String>) -> HttpResponse {
    let Some(root_path) = query.get("rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let Some(source_root_relative_path) = query.get("sourceRootRelativePath") else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"sourceRootRelativePath is required\"}",
        );
    };
    let Some(target_root_relative_path) = query.get("targetRootRelativePath") else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"targetRootRelativePath is required\"}",
        );
    };

    let source_root_relative_path =
        match RootRelativePath::try_from(source_root_relative_path.as_str()) {
            Ok(path) => path,
            Err(error) => {
                return http_response(400, "Bad Request", &error_json(&error.to_string()));
            }
        };
    let target_root_relative_path =
        match RootRelativePath::try_from(target_root_relative_path.as_str()) {
            Ok(path) => path,
            Err(error) => {
                return http_response(400, "Bad Request", &error_json(&error.to_string()));
            }
        };

    match runtime.move_root_path(RootMoveRequest {
        root_path: PathBuf::from(root_path),
        source_root_relative_path,
        target_root_relative_path,
        dry_run: query.get("dryRun").is_some_and(|value| value == "true"),
    }) {
        Ok(response) => http_response(200, "OK", &root_move_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_root_move_batch_json(runtime: &FauplayRuntime, request: &str) -> HttpResponse {
    let payload = match serde_json::from_str::<serde_json::Value>(http_request_body(request)) {
        Ok(payload) => payload,
        Err(error) => return http_response(400, "Bad Request", &error_json(&error.to_string())),
    };
    let Some(root_path) = json_string_field(&payload, "rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_paths = json_root_move_batch_path_values(&payload);
    if root_relative_paths.is_empty() {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"rootRelativePaths is required\"}",
        );
    }

    let mut source_root_relative_paths = Vec::with_capacity(root_relative_paths.len());
    for root_relative_path in root_relative_paths {
        let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
            Ok(path) => path,
            Err(error) => {
                return http_response(400, "Bad Request", &error_json(&error.to_string()));
            }
        };
        source_root_relative_paths.push(root_relative_path);
    }

    let search_mode = match json_string_or_default(&payload, "searchMode", "plain").as_str() {
        "plain" => RootMoveSearchMode::Plain,
        "regex" => RootMoveSearchMode::Regex,
        _ => {
            return http_response(
                400,
                "Bad Request",
                "{\"error\":\"searchMode must be plain or regex\"}",
            );
        }
    };
    let Some(counter_start) = json_i64_or_default(&payload, "counterStart", 1) else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"counterStart must be an integer\"}",
        );
    };
    let Some(counter_step) = json_i64_or_default(&payload, "counterStep", 1) else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"counterStep must be an integer\"}",
        );
    };
    let Some(counter_pad) = json_usize_or_default(&payload, "counterPad", 0) else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"counterPad must be a non-negative integer\"}",
        );
    };

    match runtime.move_root_path_batch(RootMoveBatchRequest {
        root_path: PathBuf::from(root_path),
        source_root_relative_paths,
        rule: RootMoveRule {
            name_mask: json_string_or_default(&payload, "nameMask", "[N]"),
            find_text: json_string_or_default(&payload, "findText", ""),
            replace_text: json_string_or_default(&payload, "replaceText", ""),
            search_mode,
            regex_flags: json_string_or_default(&payload, "regexFlags", "g"),
            counter_start,
            counter_step,
            counter_pad,
        },
        dry_run: json_bool_field(&payload, "dryRun"),
    }) {
        Ok(response) => http_response(200, "OK", &root_move_batch_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

fn handle_list_root_trash(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
) -> HttpResponse {
    let Some(root_path) = query.get("rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };

    match runtime.list_root_trash(RootTrashListRequest {
        root_path: PathBuf::from(root_path),
        entry_limit: parse_entry_limit(query.get("limit").map(String::as_str)),
        entry_offset: parse_entry_offset(query.get("offset").map(String::as_str)),
    }) {
        Ok(response) => http_response(200, "OK", &root_trash_list_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn handle_move_to_root_trash(runtime: &FauplayRuntime, query: &[(String, String)]) -> HttpResponse {
    handle_root_trash_mutation(runtime, query, RootTrashMutationKind::Move)
}

fn handle_restore_from_root_trash(
    runtime: &FauplayRuntime,
    query: &[(String, String)],
) -> HttpResponse {
    handle_root_trash_mutation(runtime, query, RootTrashMutationKind::Restore)
}

#[derive(Debug, Clone, Copy)]
enum RootTrashMutationKind {
    Move,
    Restore,
}

fn handle_root_trash_mutation(
    runtime: &FauplayRuntime,
    query: &[(String, String)],
    kind: RootTrashMutationKind,
) -> HttpResponse {
    let Some(root_path) = first_query_value(query, "rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };
    let root_relative_paths = query_values(query, "rootRelativePath");
    if root_relative_paths.is_empty() {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"rootRelativePath is required\"}",
        );
    };
    let mut parsed_root_relative_paths = Vec::with_capacity(root_relative_paths.len());
    for root_relative_path in root_relative_paths {
        let root_relative_path = match RootRelativePath::try_from(root_relative_path) {
            Ok(path) => path,
            Err(error) => {
                return http_response(400, "Bad Request", &error_json(&error.to_string()));
            }
        };
        parsed_root_relative_paths.push(root_relative_path);
    }
    let request = RootTrashRequest {
        root_path: PathBuf::from(root_path),
        root_relative_paths: parsed_root_relative_paths,
        dry_run: first_query_value(query, "dryRun").is_some_and(|value| value == "true"),
    };
    let result = match kind {
        RootTrashMutationKind::Move => runtime.move_to_root_trash(request),
        RootTrashMutationKind::Restore => runtime.restore_from_root_trash(request),
    };

    match result {
        Ok(response) => http_response(200, "OK", &root_trash_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

fn parse_header_value<'a>(request: &'a str, header_name: &str) -> Option<&'a str> {
    for line in request.lines().skip(1) {
        if line.is_empty() {
            break;
        }
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case(header_name) {
            return Some(value.trim());
        }
    }

    None
}

fn parse_http_request_line(request: &str) -> Option<(&str, &str)> {
    let line = request.lines().next()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?;
    let target = parts.next()?;
    Some((method, target))
}

fn parse_query_string(query: &str) -> HashMap<String, String> {
    let mut values = HashMap::new();

    for (key, value) in parse_query_pairs(query) {
        values.insert(key, value);
    }

    values
}

fn parse_query_pairs(query: &str) -> Vec<(String, String)> {
    let mut values = Vec::new();

    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or_default();
        let value = parts.next().unwrap_or_default();
        values.push((percent_decode(key), percent_decode(value)));
    }

    values
}

fn first_query_value<'a>(query: &'a [(String, String)], key: &str) -> Option<&'a str> {
    query
        .iter()
        .find(|(candidate_key, _)| candidate_key == key)
        .map(|(_, value)| value.as_str())
}

fn query_values<'a>(query: &'a [(String, String)], key: &str) -> Vec<&'a str> {
    query
        .iter()
        .filter_map(|(candidate_key, value)| (candidate_key == key).then_some(value.as_str()))
        .collect()
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Some(byte) = decode_hex_byte(bytes[index + 1], bytes[index + 2]) {
                decoded.push(byte);
                index += 3;
                continue;
            }
        }

        if bytes[index] == b'+' {
            decoded.push(b' ');
        } else {
            decoded.push(bytes[index]);
        }
        index += 1;
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

fn decode_hex_byte(high: u8, low: u8) -> Option<u8> {
    Some(decode_hex_digit(high)? * 16 + decode_hex_digit(low)?)
}

fn decode_hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn list_directory_response_json(response: crate::ListDirectoryResponse) -> String {
    let entries = response
        .entries
        .into_iter()
        .map(|entry| {
            let mut json = format!(
                "{{\"name\":\"{}\",\"rootRelativePath\":\"{}\",\"kind\":\"{}\"",
                escape_json_string(&entry.name),
                escape_json_string(&entry.root_relative_path.to_string()),
                directory_entry_kind_json(entry.kind),
            );

            if let Some(is_empty) = entry.is_empty {
                json.push_str(&format!(",\"isEmpty\":{is_empty}"));
            }
            if let Some(entry_count) = entry.entry_count {
                json.push_str(&format!(",\"entryCount\":{entry_count}"));
            }
            if let Some(size) = entry.size {
                json.push_str(&format!(",\"size\":{size}"));
            }
            if let Some(last_modified_ms) = entry.last_modified_ms {
                json.push_str(&format!(",\"lastModifiedMs\":{last_modified_ms}"));
            }

            json.push('}');
            json
        })
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"entries\":[{entries}],\"isTruncated\":{},\"nextOffset\":{}}}",
        response.is_truncated,
        optional_usize_json(response.next_offset)
    )
}

fn optional_usize_json(value: Option<usize>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_owned())
}

fn optional_u64_json(value: Option<u64>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_owned())
}

fn text_preview_response_json(response: crate::TextPreviewResponse) -> String {
    format!(
        "{{\"status\":\"{}\",\"content\":{},\"fileSizeBytes\":{},\"sizeLimitBytes\":{},\"error\":{}}}",
        text_preview_status_json(response.status),
        optional_string_json(response.content.as_deref()),
        response.file_size_bytes,
        response.size_limit_bytes,
        optional_string_json(response.error.as_deref()),
    )
}

fn file_metadata_response_json(response: FileMetadataResponse) -> String {
    let mut json = format!(
        "{{\"rootRelativePath\":\"{}\",\"size\":{}",
        escape_json_string(&response.root_relative_path.to_string()),
        response.size,
    );
    if let Some(last_modified_ms) = response.last_modified_ms {
        json.push_str(&format!(",\"lastModifiedMs\":{last_modified_ms}"));
    }
    json.push('}');
    json
}

fn global_trash_file_metadata_response_json(response: GlobalTrashFileMetadataResponse) -> String {
    let mut json = format!(
        "{{\"recycleId\":\"{}\",\"size\":{}",
        escape_json_string(&response.recycle_id),
        response.size,
    );
    if let Some(last_modified_ms) = response.last_modified_ms {
        json.push_str(&format!(",\"lastModifiedMs\":{last_modified_ms}"));
    }
    json.push('}');
    json
}

fn file_annotation_set_response_json(response: FileAnnotationMutationResponse) -> String {
    let root_relative_path = response.root_relative_path.to_string();
    format!(
        "{{\"ok\":true,\"absolutePath\":\"{}\",\"relativePath\":\"{}\",\"rootRelativePath\":\"{}\",\"fieldKey\":\"{}\",\"key\":\"{}\",\"value\":\"{}\",\"source\":\"{}\"}}",
        escape_json_string(&response.absolute_path.display().to_string()),
        escape_json_string(&root_relative_path),
        escape_json_string(&root_relative_path),
        escape_json_string(&response.key),
        escape_json_string(&response.key),
        escape_json_string(&response.value),
        file_annotation_action_source_json(response.source),
    )
}

fn file_annotation_tag_response_json(response: FileAnnotationTagMutationResponse) -> String {
    let root_relative_path = response.root_relative_path.to_string();
    format!(
        "{{\"ok\":true,\"absolutePath\":\"{}\",\"relativePath\":\"{}\",\"rootRelativePath\":\"{}\",\"key\":\"{}\",\"value\":\"{}\",\"source\":\"{}\"}}",
        escape_json_string(&response.absolute_path.display().to_string()),
        escape_json_string(&root_relative_path),
        escape_json_string(&root_relative_path),
        escape_json_string(&response.key),
        escape_json_string(&response.value),
        escape_json_string(&response.source),
    )
}

fn file_annotation_read_response_json(response: FileAnnotationReadResponse) -> String {
    match response.file {
        Some(file) => format!(
            "{{\"ok\":true,\"file\":{}}}",
            file_annotation_file_json(file)
        ),
        None => "{\"ok\":true,\"file\":null}".to_owned(),
    }
}

fn annotation_tag_options_response_json(response: AnnotationTagOptionsResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(|item| {
            format!(
                "{{\"tagKey\":\"{}\",\"key\":\"{}\",\"value\":\"{}\",\"source\":\"{}\",\"fileCount\":{}}}",
                escape_json_string(&item.tag_key),
                escape_json_string(&item.key),
                escape_json_string(&item.value),
                escape_json_string(&item.source),
                item.file_count,
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!("{{\"ok\":true,\"items\":[{items}]}}")
}

fn file_annotation_query_response_json(response: FileAnnotationQueryResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(file_annotation_file_json)
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"ok\":true,\"page\":{},\"size\":{},\"total\":{},\"items\":[{items}]}}",
        response.page, response.size, response.total,
    )
}

fn file_annotation_rebind_response_json(response: FileAnnotationPathRebindResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(|item| {
            let reason_code = item
                .reason
                .map(file_annotation_rebind_failure_reason_code);
            format!(
                "{{\"fromRelativePath\":\"{}\",\"toRelativePath\":\"{}\",\"ok\":{},\"skipped\":{},\"reasonCode\":{},\"reason\":{},\"error\":{}}}",
                escape_json_string(&item.from_root_relative_path.to_string()),
                escape_json_string(&item.to_root_relative_path.to_string()),
                item.ok,
                item.skipped,
                optional_string_json(reason_code),
                optional_string_json(reason_code),
                optional_string_json(item.error.as_deref()),
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"ok\":true,\"total\":{},\"updated\":{},\"skipped\":{},\"failed\":{},\"items\":[{items}]}}",
        response.total, response.updated, response.skipped, response.failed,
    )
}

fn file_annotation_missing_cleanup_response_json(
    response: FileAnnotationMissingCleanupResponse,
) -> String {
    let missing_root_relative_paths = response
        .missing_root_relative_paths
        .iter()
        .map(|path| format!("\"{}\"", escape_json_string(&path.to_string())))
        .collect::<Vec<_>>()
        .join(",");
    let missing_absolute_paths = response
        .missing_absolute_paths
        .iter()
        .map(|path| format!("\"{}\"", escape_json_string(&path.display().to_string())))
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"ok\":true,\"dryRun\":{},\"missingRootRelativePaths\":[{missing_root_relative_paths}],\"missingAbsolutePaths\":[{missing_absolute_paths}],\"impact\":{{\"fileAnnotation\":{},\"annotationTag\":{},\"fileIndexEntry\":{}}},\"removed\":{}}}",
        response.dry_run,
        response.impact.file_annotations,
        response.impact.annotation_tags,
        response.impact.file_index_entries,
        response.removed,
    )
}

fn file_index_ensure_response_json(response: FileIndexEnsureResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(|item| {
            let root_relative_path = item.root_relative_path.to_string();
            let reason_code = item.reason.map(file_index_failure_reason_code);
            format!(
                "{{\"relativePath\":\"{}\",\"rootRelativePath\":\"{}\",\"ok\":{},\"skipped\":{},\"assetId\":null,\"absolutePath\":{},\"fileMtimeMs\":{},\"lastModifiedMs\":{},\"size\":{},\"reasonCode\":{},\"reason\":{},\"error\":{}}}",
                escape_json_string(&root_relative_path),
                escape_json_string(&root_relative_path),
                item.ok,
                item.skipped,
                optional_path_json(item.absolute_path.as_ref()),
                optional_u64_json(item.last_modified_ms),
                optional_u64_json(item.last_modified_ms),
                optional_u64_json(item.size),
                optional_string_json(reason_code),
                optional_string_json(reason_code),
                optional_string_json(item.error.as_deref()),
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"ok\":true,\"total\":{},\"indexed\":{},\"skipped\":{},\"failed\":{},\"items\":[{items}]}}",
        response.total, response.indexed, response.skipped, response.failed,
    )
}

fn file_annotation_file_json(file: crate::FileAnnotationFile) -> String {
    let root_relative_path = file.root_relative_path.to_string();
    let tags = file
        .tags
        .into_iter()
        .map(|tag| {
            format!(
                "{{\"key\":\"{}\",\"value\":\"{}\",\"source\":\"{}\",\"appliedAt\":{},\"updatedAt\":{}}}",
                escape_json_string(&tag.key),
                escape_json_string(&tag.value),
                escape_json_string(&tag.source),
                tag.applied_at_ms,
                tag.applied_at_ms,
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"absolutePath\":\"{}\",\"relativePath\":\"{}\",\"rootRelativePath\":\"{}\",\"tags\":[{tags}]}}",
        escape_json_string(&file.absolute_path.display().to_string()),
        escape_json_string(&root_relative_path),
        escape_json_string(&root_relative_path),
    )
}

fn duplicate_files_response_json(response: DuplicateFilesResponse) -> String {
    let skipped_seeds = response
        .skipped_seeds
        .into_iter()
        .map(|skip| {
            format!(
                "{{\"rootRelativePath\":\"{}\",\"reason\":\"{}\"}}",
                escape_json_string(&skip.root_relative_path.to_string()),
                duplicate_seed_skip_reason_json(skip.reason),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let duplicate_set_count = response.duplicate_sets.len();
    let duplicate_sets = response
        .duplicate_sets
        .into_iter()
        .map(|duplicate_set| {
            let seed_paths = duplicate_set
                .seed_root_relative_paths
                .iter()
                .map(|path| format!("\"{}\"", escape_json_string(&path.to_string())))
                .collect::<Vec<_>>()
                .join(",");
            let files = duplicate_set
                .files
                .into_iter()
                .map(|file| {
                    let mut json = format!(
                        "{{\"name\":\"{}\",\"rootRelativePath\":\"{}\",\"absolutePath\":\"{}\",\"size\":{}",
                        escape_json_string(&file.name),
                        escape_json_string(&file.root_relative_path.to_string()),
                        escape_json_string(&file.absolute_path.display().to_string()),
                        file.size,
                    );
                    if let Some(last_modified_ms) = file.last_modified_ms {
                        json.push_str(&format!(",\"lastModifiedMs\":{last_modified_ms}"));
                    }
                    json.push('}');
                    json
                })
                .collect::<Vec<_>>()
                .join(",");
            format!(
                "{{\"setId\":\"{}\",\"seedRootRelativePaths\":[{seed_paths}],\"files\":[{files}]}}",
                escape_json_string(&duplicate_set.set_id),
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"ok\":true,\"seedCount\":{},\"skippedSeeds\":[{skipped_seeds}],\"duplicateSetCount\":{duplicate_set_count},\"duplicateSets\":[{duplicate_sets}]}}",
        response.seed_count,
    )
}

fn root_move_response_json(response: RootMoveResponse) -> String {
    format!(
        "{{\"dryRun\":{},\"sourceRootRelativePath\":\"{}\",\"targetRootRelativePath\":\"{}\",\"absolutePath\":\"{}\",\"targetAbsolutePath\":\"{}\",\"ok\":{},\"reason\":{},\"error\":{}}}",
        response.dry_run,
        escape_json_string(&response.source_root_relative_path.to_string()),
        escape_json_string(&response.target_root_relative_path.to_string()),
        escape_json_string(&response.absolute_path.display().to_string()),
        escape_json_string(&response.target_absolute_path.display().to_string()),
        response.ok,
        optional_root_move_failure_reason_json(response.reason),
        optional_string_json(response.error.as_deref()),
    )
}

fn root_move_batch_response_json(response: RootMoveBatchResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(|item| {
            format!(
                "{{\"rootRelativePath\":\"{}\",\"nextRootRelativePath\":{},\"absolutePath\":\"{}\",\"nextAbsolutePath\":{},\"ok\":{},\"skipped\":{},\"reason\":{},\"error\":{}}}",
                escape_json_string(&item.root_relative_path.to_string()),
                optional_root_relative_path_json(item.next_root_relative_path.as_ref()),
                escape_json_string(&item.absolute_path.display().to_string()),
                optional_path_json(item.next_absolute_path.as_ref()),
                item.ok,
                item.skipped,
                optional_root_move_batch_failure_reason_json(item.reason),
                optional_string_json(item.error.as_deref()),
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"dryRun\":{},\"total\":{},\"moved\":{},\"skipped\":{},\"failed\":{},\"items\":[{items}]}}",
        response.dry_run, response.total, response.moved, response.skipped, response.failed,
    )
}

fn root_trash_response_json(response: RootTrashMutationResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(|item| {
            format!(
                "{{\"rootRelativePath\":\"{}\",\"nextRootRelativePath\":{},\"absolutePath\":\"{}\",\"nextAbsolutePath\":{},\"ok\":{},\"reason\":{},\"error\":{}}}",
                escape_json_string(&item.root_relative_path.to_string()),
                optional_root_relative_path_json(item.next_root_relative_path.as_ref()),
                escape_json_string(&item.absolute_path.display().to_string()),
                optional_path_json(item.next_absolute_path.as_ref()),
                item.ok,
                optional_root_trash_failure_reason_json(item.reason),
                optional_string_json(item.error.as_deref()),
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"dryRun\":{},\"total\":{},\"completed\":{},\"failed\":{},\"items\":[{items}]}}",
        response.dry_run, response.total, response.completed, response.failed,
    )
}

fn root_trash_list_response_json(response: RootTrashListResponse) -> String {
    let entries = response
        .entries
        .into_iter()
        .map(|entry| {
            let mut json = format!(
                "{{\"name\":\"{}\",\"rootRelativePath\":\"{}\",\"originalRootRelativePath\":\"{}\",\"absolutePath\":\"{}\",\"originalAbsolutePath\":\"{}\",\"size\":{}",
                escape_json_string(&entry.name),
                escape_json_string(&entry.root_relative_path.to_string()),
                escape_json_string(&entry.original_root_relative_path.to_string()),
                escape_json_string(&entry.absolute_path.display().to_string()),
                escape_json_string(&entry.original_absolute_path.display().to_string()),
                entry.size,
            );
            if let Some(last_modified_ms) = entry.last_modified_ms {
                json.push_str(&format!(",\"lastModifiedMs\":{last_modified_ms}"));
            }
            if let Some(deleted_at_ms) = entry.deleted_at_ms {
                json.push_str(&format!(",\"deletedAtMs\":{deleted_at_ms}"));
            }
            json.push('}');
            json
        })
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"entries\":[{entries}],\"isTruncated\":{},\"nextOffset\":{}}}",
        response.is_truncated,
        optional_usize_json(response.next_offset)
    )
}

fn global_trash_list_response_json(response: GlobalTrashListResponse) -> String {
    let entries = response
        .entries
        .into_iter()
        .map(|entry| {
            let absolute_path = entry.absolute_path.display().to_string();
            let original_absolute_path = entry.original_absolute_path.display().to_string();
            let mut json = format!(
                "{{\"path\":\"{}\",\"absolutePath\":\"{}\",\"name\":\"{}\",\"kind\":\"file\",\"size\":{},\"mimeType\":\"{}\",\"previewKind\":\"{}\",\"displayPath\":\"{}\",\"deletedAt\":{},\"sourceType\":\"global_recycle\",\"recycleId\":\"{}\",\"originalAbsolutePath\":\"{}\"",
                escape_json_string(&absolute_path),
                escape_json_string(&absolute_path),
                escape_json_string(&entry.name),
                entry.size,
                escape_json_string(&entry.mime_type),
                escape_json_string(&entry.preview_kind),
                escape_json_string(&entry.display_path),
                entry.deleted_at_ms,
                escape_json_string(&entry.recycle_id),
                escape_json_string(&original_absolute_path),
            );
            if let Some(last_modified_ms) = entry.last_modified_ms {
                json.push_str(&format!(",\"lastModifiedMs\":{last_modified_ms}"));
            }
            json.push('}');
            json
        })
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"entries\":[{entries}],\"isTruncated\":{},\"nextOffset\":{}}}",
        response.is_truncated,
        optional_usize_json(response.next_offset)
    )
}

fn global_trash_move_response_json(response: GlobalTrashMoveResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(|item| {
            let mut json = format!(
                "{{\"sourceType\":\"global_recycle\",\"recycleId\":\"{}\",\"absolutePath\":\"{}\",\"nextAbsolutePath\":{},\"ok\":{},\"reason\":{},\"error\":{}",
                escape_json_string(&item.recycle_id),
                escape_json_string(&item.absolute_path.display().to_string()),
                optional_path_json(item.next_absolute_path.as_ref()),
                item.ok,
                optional_global_trash_failure_reason_json(item.reason),
                optional_string_json(item.error.as_deref()),
            );
            if let Some(deleted_at_ms) = item.deleted_at_ms {
                json.push_str(&format!(",\"deletedAt\":{deleted_at_ms}"));
            }
            json.push('}');
            json
        })
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"dryRun\":{},\"total\":{},\"moved\":{},\"failed\":{},\"items\":[{items}]}}",
        response.dry_run, response.total, response.moved, response.failed,
    )
}

fn global_trash_restore_response_json(response: GlobalTrashRestoreResponse) -> String {
    let items = response
        .items
        .into_iter()
        .map(|item| {
            format!(
                "{{\"sourceType\":\"global_recycle\",\"recycleId\":\"{}\",\"absolutePath\":\"{}\",\"originalAbsolutePath\":\"{}\",\"nextAbsolutePath\":{},\"ok\":{},\"reason\":{},\"error\":{}}}",
                escape_json_string(&item.recycle_id),
                escape_json_string(&item.absolute_path.display().to_string()),
                escape_json_string(&item.original_absolute_path.display().to_string()),
                optional_path_json(item.next_absolute_path.as_ref()),
                item.ok,
                optional_global_trash_failure_reason_json(item.reason),
                optional_string_json(item.error.as_deref()),
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "{{\"dryRun\":{},\"total\":{},\"restored\":{},\"failed\":{},\"items\":[{items}]}}",
        response.dry_run, response.total, response.restored, response.failed,
    )
}

fn global_shortcut_config_response_json(response: GlobalShortcutConfigResponse) -> String {
    let mut json = format!(
        "{{\"ok\":true,\"loaded\":{},\"path\":\"{}\"",
        response.loaded,
        escape_json_string(&response.path.display().to_string()),
    );
    if response.loaded {
        let config_json = response
            .config_json
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("null");
        json.push_str(&format!(",\"config\":{config_json}"));
    }
    json.push('}');
    json
}

fn optional_root_relative_path_json(value: Option<&RootRelativePath>) -> String {
    match value {
        Some(value) => format!("\"{}\"", escape_json_string(&value.to_string())),
        None => "null".to_owned(),
    }
}

fn optional_path_json(value: Option<&PathBuf>) -> String {
    match value {
        Some(value) => format!("\"{}\"", escape_json_string(&value.display().to_string())),
        None => "null".to_owned(),
    }
}

fn optional_root_trash_failure_reason_json(value: Option<RootTrashFailureReason>) -> String {
    match value {
        Some(value) => format!("\"{}\"", root_trash_failure_reason_json(value)),
        None => "null".to_owned(),
    }
}

fn optional_global_trash_failure_reason_json(value: Option<GlobalTrashFailureReason>) -> String {
    match value {
        Some(value) => format!("\"{}\"", global_trash_failure_reason_json(value)),
        None => "null".to_owned(),
    }
}

fn optional_root_move_failure_reason_json(value: Option<RootMoveFailureReason>) -> String {
    match value {
        Some(value) => format!("\"{}\"", root_move_failure_reason_json(value)),
        None => "null".to_owned(),
    }
}

fn optional_root_move_batch_failure_reason_json(
    value: Option<RootMoveBatchFailureReason>,
) -> String {
    match value {
        Some(value) => format!("\"{}\"", root_move_batch_failure_reason_json(value)),
        None => "null".to_owned(),
    }
}

fn file_annotation_action_source_json(value: FileAnnotationActionSource) -> &'static str {
    match value {
        FileAnnotationActionSource::Click => "click",
        FileAnnotationActionSource::Hotkey => "hotkey",
    }
}

fn file_annotation_rebind_failure_reason_code(
    value: FileAnnotationPathRebindFailureReason,
) -> &'static str {
    match value {
        FileAnnotationPathRebindFailureReason::SourceNotFound => "SOURCE_NOT_FOUND",
        FileAnnotationPathRebindFailureReason::TargetNotFound => "TARGET_NOT_FOUND",
        FileAnnotationPathRebindFailureReason::NoChange => "NO_CHANGE",
    }
}

fn file_index_failure_reason_code(value: FileIndexFailureReason) -> &'static str {
    match value {
        FileIndexFailureReason::IndexFresh => "INDEX_FRESH",
        FileIndexFailureReason::SourceNotFound => "SOURCE_NOT_FOUND",
        FileIndexFailureReason::NotFile => "NOT_FILE",
        FileIndexFailureReason::IndexFailed => "INDEX_FAILED",
    }
}

fn root_move_failure_reason_json(value: RootMoveFailureReason) -> &'static str {
    match value {
        RootMoveFailureReason::InvalidSource => "invalid_source",
        RootMoveFailureReason::InvalidTarget => "invalid_target",
        RootMoveFailureReason::SourceNotFound => "source_not_found",
        RootMoveFailureReason::UnsupportedKind => "unsupported_kind",
        RootMoveFailureReason::TargetExists => "target_exists",
        RootMoveFailureReason::MutationFailed => "mutation_failed",
    }
}

fn root_move_batch_failure_reason_json(value: RootMoveBatchFailureReason) -> &'static str {
    match value {
        RootMoveBatchFailureReason::InvalidPath => "invalid_path",
        RootMoveBatchFailureReason::InvalidRule => "invalid_rule",
        RootMoveBatchFailureReason::InvalidTarget => "invalid_target",
        RootMoveBatchFailureReason::SourceNotFound => "source_not_found",
        RootMoveBatchFailureReason::UnsupportedKind => "unsupported_kind",
        RootMoveBatchFailureReason::TargetExists => "target_exists",
        RootMoveBatchFailureReason::NoChange => "no_change",
        RootMoveBatchFailureReason::MutationFailed => "mutation_failed",
    }
}

fn duplicate_seed_skip_reason_json(value: DuplicateSeedSkipReason) -> &'static str {
    match value {
        DuplicateSeedSkipReason::SourceNotFound => "source_not_found",
        DuplicateSeedSkipReason::NotFile => "not_file",
    }
}

fn root_trash_failure_reason_json(value: RootTrashFailureReason) -> &'static str {
    match value {
        RootTrashFailureReason::InvalidSource => "invalid_source",
        RootTrashFailureReason::SourceNotFound => "source_not_found",
        RootTrashFailureReason::UnsupportedKind => "unsupported_kind",
        RootTrashFailureReason::TargetExists => "target_exists",
        RootTrashFailureReason::MutationFailed => "mutation_failed",
    }
}

fn global_trash_failure_reason_json(value: GlobalTrashFailureReason) -> &'static str {
    match value {
        GlobalTrashFailureReason::RecycleItemNotFound => "recycle_item_not_found",
        GlobalTrashFailureReason::SourceNotFound => "source_not_found",
        GlobalTrashFailureReason::UnsupportedKind => "unsupported_kind",
        GlobalTrashFailureReason::TargetExists => "target_exists",
        GlobalTrashFailureReason::MutationFailed => "mutation_failed",
    }
}

fn text_preview_status_json(status: TextPreviewStatus) -> &'static str {
    match status {
        TextPreviewStatus::Ready => "ready",
        TextPreviewStatus::TooLarge => "too_large",
        TextPreviewStatus::Binary => "binary",
    }
}

fn optional_string_json(value: Option<&str>) -> String {
    match value {
        Some(value) => format!("\"{}\"", escape_json_string(value)),
        None => "null".to_owned(),
    }
}

fn directory_entry_kind_json(kind: DirectoryEntryKind) -> &'static str {
    match kind {
        DirectoryEntryKind::Directory => "directory",
        DirectoryEntryKind::File => "file",
    }
}

fn error_json(message: &str) -> String {
    format!("{{\"error\":\"{}\"}}", escape_json_string(message))
}

fn escape_json_string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

fn file_content_response(response: FileContentResponse) -> HttpResponse {
    if let Some(range) = response.range {
        return binary_response_with_headers(
            206,
            "Partial Content",
            &response.content_type,
            response.bytes,
            vec![
                ("Accept-Ranges".to_owned(), "bytes".to_owned()),
                (
                    "Content-Range".to_owned(),
                    format!(
                        "bytes {}-{}/{}",
                        range.start, range.end_inclusive, response.total_size
                    ),
                ),
            ],
        );
    }

    binary_response_with_headers(
        200,
        "OK",
        &response.content_type,
        response.bytes,
        vec![("Accept-Ranges".to_owned(), "bytes".to_owned())],
    )
}

fn parse_file_content_range(value: &str) -> Option<FileContentRangeRequest> {
    let range_spec = value.trim().strip_prefix("bytes=")?;
    if range_spec.contains(',') {
        return None;
    }
    let (start_raw, end_raw) = range_spec.split_once('-')?;

    if start_raw.is_empty() {
        return Some(FileContentRangeRequest::Suffix {
            length: end_raw.parse::<u64>().ok()?,
        });
    }

    let start = start_raw.parse::<u64>().ok()?;
    if end_raw.is_empty() {
        return Some(FileContentRangeRequest::From { start });
    }

    Some(FileContentRangeRequest::Exact {
        start,
        end_inclusive: end_raw.parse::<u64>().ok()?,
    })
}

struct HttpResponse {
    status_code: u16,
    reason: &'static str,
    content_type: String,
    extra_headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl HttpResponse {
    fn into_bytes(self) -> Vec<u8> {
        let mut response = format!(
            "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, PUT, PATCH, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Range\r\n",
            self.status_code,
            self.reason,
            self.content_type
        )
        .into_bytes();
        for (name, value) in self.extra_headers {
            response.extend_from_slice(format!("{name}: {value}\r\n").as_bytes());
        }
        response.extend_from_slice(
            format!(
                "Content-Length: {}\r\nConnection: close\r\n\r\n",
                self.body.len()
            )
            .as_bytes(),
        );
        response.extend_from_slice(&self.body);
        response
    }
}

fn http_response(status_code: u16, reason: &'static str, body: &str) -> HttpResponse {
    binary_response(
        status_code,
        reason,
        "application/json",
        body.as_bytes().to_vec(),
    )
}

fn binary_response(
    status_code: u16,
    reason: &'static str,
    content_type: &str,
    body: Vec<u8>,
) -> HttpResponse {
    binary_response_with_headers(status_code, reason, content_type, body, Vec::new())
}

fn binary_response_with_headers(
    status_code: u16,
    reason: &'static str,
    content_type: &str,
    body: Vec<u8>,
    extra_headers: Vec<(String, String)>,
) -> HttpResponse {
    HttpResponse {
        status_code,
        reason,
        content_type: content_type.to_owned(),
        extra_headers,
        body,
    }
}
