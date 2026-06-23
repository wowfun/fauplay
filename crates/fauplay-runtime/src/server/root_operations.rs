use std::collections::HashMap;
use std::path::PathBuf;

use crate::{
    FauplayRuntime, RootMoveBatchFailureReason, RootMoveBatchRequest, RootMoveBatchResponse,
    RootMoveFailureReason, RootMoveRequest, RootMoveResponse, RootMoveRule, RootMoveSearchMode,
    RootRelativePath, RootTrashFailureReason, RootTrashListRequest, RootTrashListResponse,
    RootTrashMutationResponse, RootTrashRequest,
};

use super::{
    HttpResponse, error_json, escape_json_string, first_query_value, http_response,
    json_bool_field, json_i64_or_default, json_string_field, json_string_or_default,
    json_usize_or_default, optional_path_json, optional_string_json, parse_entry_limit,
    parse_entry_offset, query_values,
};

pub(super) fn handle_root_move(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
) -> HttpResponse {
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

pub(super) fn handle_root_move_batch_json(runtime: &FauplayRuntime, request: &str) -> HttpResponse {
    let payload = match serde_json::from_str::<serde_json::Value>(super::http_request_body(request))
    {
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

pub(super) fn handle_list_root_trash(
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

pub(super) fn handle_move_to_root_trash(
    runtime: &FauplayRuntime,
    query: &[(String, String)],
) -> HttpResponse {
    handle_root_trash_mutation(runtime, query, RootTrashMutationKind::Move)
}

pub(super) fn handle_restore_from_root_trash(
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
        super::optional_usize_json(response.next_offset)
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

fn root_trash_failure_reason_json(value: RootTrashFailureReason) -> &'static str {
    match value {
        RootTrashFailureReason::InvalidSource => "invalid_source",
        RootTrashFailureReason::SourceNotFound => "source_not_found",
        RootTrashFailureReason::UnsupportedKind => "unsupported_kind",
        RootTrashFailureReason::TargetExists => "target_exists",
        RootTrashFailureReason::MutationFailed => "mutation_failed",
    }
}
