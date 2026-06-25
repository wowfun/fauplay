use crate::{FauplayRuntime, GlobalShortcutConfigResponse};

use super::{HttpResponse, error_json, escape_json_string, http_response};

pub(in crate::server) fn handle_global_shortcut_config(runtime: &FauplayRuntime) -> HttpResponse {
    match runtime.load_global_shortcut_config() {
        Ok(response) => http_response(200, "OK", &global_shortcut_config_response_json(response)),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &error_json(&error.to_string()),
        ),
    }
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
