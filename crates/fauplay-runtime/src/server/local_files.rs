use std::collections::HashMap;
use std::path::PathBuf;

use crate::{
    DirectoryEntryKind, DuplicateFilesRequest, DuplicateFilesResponse, DuplicateSeedSkipReason,
    FauplayRuntime, FileContentRequest, FileMetadataRequest, FileMetadataResponse,
    ListDirectoryRequest, ListingEntryFilter, ListingOrder, ListingQuery, ListingSortDirection,
    ListingSortKey, RootRelativePath, TextPreviewRequest,
};

use super::{
    HttpResponse, error_json, escape_json_string, file_content_response, first_query_value,
    http_request_body, http_response, json_root_relative_path_values, json_string_field,
    optional_usize_json, parse_entry_limit, parse_entry_offset, parse_file_content_range,
    query_values, text_preview_response_json,
};

pub(super) fn handle_list_local_directory(
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

pub(super) fn handle_text_preview(
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

pub(super) fn handle_file_content(
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

pub(super) fn handle_file_metadata(
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

pub(super) fn handle_find_duplicate_files(
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

pub(super) fn handle_find_duplicate_files_json(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
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

fn duplicate_seed_skip_reason_json(value: DuplicateSeedSkipReason) -> &'static str {
    match value {
        DuplicateSeedSkipReason::SourceNotFound => "source_not_found",
        DuplicateSeedSkipReason::NotFile => "not_file",
    }
}

fn directory_entry_kind_json(kind: DirectoryEntryKind) -> &'static str {
    match kind {
        DirectoryEntryKind::Directory => "directory",
        DirectoryEntryKind::File => "file",
    }
}
