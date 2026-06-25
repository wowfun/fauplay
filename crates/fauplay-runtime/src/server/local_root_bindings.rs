use std::collections::HashMap;
use std::path::PathBuf;

use crate::{
    FauplayRuntime, LocalRootBinding, LocalRootBindingUpsertRequest, LocalRootBindingsResponse,
};

use super::{HttpResponse, error_json, escape_json_string, http_response};

pub(in crate::server) fn handle_list_local_root_bindings(runtime: &FauplayRuntime) -> HttpResponse {
    match runtime.list_local_root_bindings() {
        Ok(response) => http_response(200, "OK", &local_root_bindings_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
}

pub(in crate::server) fn handle_upsert_local_root_binding(
    runtime: &FauplayRuntime,
    query: &HashMap<String, String>,
) -> HttpResponse {
    let Some(root_id) = query.get("rootId").map(String::as_str) else {
        return http_response(400, "Bad Request", "{\"error\":\"rootId is required\"}");
    };
    let Some(root_path) = query.get("rootPath").map(String::as_str) else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };

    match runtime.upsert_local_root_binding(LocalRootBindingUpsertRequest {
        root_id: root_id.to_owned(),
        root_path: PathBuf::from(root_path),
    }) {
        Ok(response) => http_response(200, "OK", &local_root_binding_json(&response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

fn local_root_bindings_response_json(response: LocalRootBindingsResponse) -> String {
    let items = response
        .items
        .iter()
        .map(local_root_binding_json)
        .collect::<Vec<_>>()
        .join(",");

    format!("{{\"items\":[{items}]}}")
}

fn local_root_binding_json(binding: &LocalRootBinding) -> String {
    format!(
        "{{\"rootId\":\"{}\",\"rootPath\":\"{}\"}}",
        escape_json_string(&binding.root_id),
        escape_json_string(&binding.root_path.display().to_string()),
    )
}
