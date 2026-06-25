use std::path::PathBuf;

use crate::{
    FauplayRuntime, GlobalTrashFailureReason, GlobalTrashMoveRequest, GlobalTrashMoveResponse,
    GlobalTrashRestoreRequest, GlobalTrashRestoreResponse,
};

use super::super::{
    HttpResponse, error_json, escape_json_string, first_query_value, http_response,
    optional_path_json, optional_string_json, query_values,
};

pub(in crate::server) fn handle_move_to_global_trash(
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

pub(in crate::server) fn handle_restore_global_trash(
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

fn optional_global_trash_failure_reason_json(value: Option<GlobalTrashFailureReason>) -> String {
    match value {
        Some(value) => format!("\"{}\"", global_trash_failure_reason_json(value)),
        None => "null".to_owned(),
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
