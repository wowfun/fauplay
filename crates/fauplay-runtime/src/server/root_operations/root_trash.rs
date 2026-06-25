use std::collections::HashMap;
use std::path::PathBuf;

use crate::{
    FauplayRuntime, RootRelativePath, RootTrashFailureReason, RootTrashListRequest,
    RootTrashListResponse, RootTrashMutationResponse, RootTrashRequest,
};

use super::super::{
    HttpResponse, error_json, escape_json_string, first_query_value, http_response,
    optional_path_json, optional_string_json, optional_usize_json, parse_entry_limit,
    parse_entry_offset, query_values,
};

pub(in crate::server) fn handle_list_root_trash(
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

pub(in crate::server) fn handle_move_to_root_trash(
    runtime: &FauplayRuntime,
    query: &[(String, String)],
) -> HttpResponse {
    handle_root_trash_mutation(runtime, query, RootTrashMutationKind::Move)
}

pub(in crate::server) fn handle_restore_from_root_trash(
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

fn optional_root_relative_path_json(value: Option<&RootRelativePath>) -> String {
    match value {
        Some(value) => format!("\"{}\"", escape_json_string(&value.to_string())),
        None => "null".to_owned(),
    }
}

fn optional_root_trash_failure_reason_json(value: Option<RootTrashFailureReason>) -> String {
    match value {
        Some(value) => format!("\"{}\"", root_trash_failure_reason_json(value)),
        None => "null".to_owned(),
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
