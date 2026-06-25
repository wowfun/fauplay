use std::path::PathBuf;

use crate::{
    FauplayRuntime, FileAnnotationActionSource, FileAnnotationMutationResponse,
    FileAnnotationSetValueRequest, FileAnnotationTagBindingRequest,
    FileAnnotationTagMutationResponse, RootRelativePath,
};

use super::super::{
    HttpResponse, error_json, escape_json_string, http_response, json_string_field, parse_json_body,
};
use super::json_file_annotation_relative_path;

pub(in crate::server) fn handle_set_file_annotation_json(
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

pub(in crate::server) fn handle_bind_file_annotation_tag_json(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
    handle_file_annotation_tag_binding_json(runtime, request, FileAnnotationTagBindingKind::Bind)
}

pub(in crate::server) fn handle_unbind_file_annotation_tag_json(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
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

fn parse_file_annotation_action_source(value: Option<&str>) -> FileAnnotationActionSource {
    match value {
        Some("hotkey") => FileAnnotationActionSource::Hotkey,
        _ => FileAnnotationActionSource::Click,
    }
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

fn file_annotation_action_source_json(value: FileAnnotationActionSource) -> &'static str {
    match value {
        FileAnnotationActionSource::Click => "click",
        FileAnnotationActionSource::Hotkey => "hotkey",
    }
}
