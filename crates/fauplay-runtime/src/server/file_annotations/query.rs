use std::path::PathBuf;

use crate::{
    AnnotationTagOptionsRequest, AnnotationTagOptionsResponse, FauplayRuntime,
    FileAnnotationMatchMode, FileAnnotationQueryRequest, FileAnnotationQueryResponse,
};

use super::super::{
    HttpResponse, error_json, escape_json_string, http_response, json_string_array_field,
    json_string_field, json_string_or_default, json_usize_or_default, parse_json_body,
};
use super::serialization::file_annotation_file_json;

pub(in crate::server) fn handle_list_annotation_tag_options_json(
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

pub(in crate::server) fn handle_query_file_annotations_json(
    runtime: &FauplayRuntime,
    request: &str,
) -> HttpResponse {
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
