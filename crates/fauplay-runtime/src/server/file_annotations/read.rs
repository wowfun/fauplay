use std::path::PathBuf;

use crate::{
    FauplayRuntime, FileAnnotationReadRequest, FileAnnotationReadResponse, RootRelativePath,
};

use super::super::{HttpResponse, error_json, http_response, json_string_field, parse_json_body};
use super::json_file_annotation_relative_path;
use super::serialization::file_annotation_file_json;

pub(in crate::server) fn handle_read_file_annotation_json(
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

    match runtime.read_file_annotation(FileAnnotationReadRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
    }) {
        Ok(response) => http_response(200, "OK", &file_annotation_read_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
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
