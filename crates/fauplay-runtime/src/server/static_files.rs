use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::media::infer_content_type;

use super::http::{HttpResponse, binary_response, http_response};
use super::request::percent_decode;

pub(in crate::server) fn handle_web_app_request(
    web_dist_path: &Path,
    target: &str,
) -> HttpResponse {
    let Some(route) = parse_web_route(target) else {
        return http_response(404, "Not Found", "{\"error\":\"not found\"}");
    };

    if let Some(file_path) = route.file_path(web_dist_path) {
        if file_path.is_file() {
            return match fs::read(&file_path) {
                Ok(contents) => {
                    binary_response(200, "OK", infer_content_type(&file_path), contents)
                }
                Err(error) => http_response(
                    500,
                    "Internal Server Error",
                    &super::error_json(&format!("failed to read Web App file: {error}")),
                ),
            };
        }

        if route.is_asset_request {
            return http_response(404, "Not Found", "{\"error\":\"not found\"}");
        }
    }

    serve_index_html(web_dist_path)
}

fn serve_index_html(web_dist_path: &Path) -> HttpResponse {
    let index_path = web_dist_path.join("index.html");
    match fs::read(&index_path) {
        Ok(contents) => binary_response(200, "OK", infer_content_type(&index_path), contents),
        Err(error) => http_response(
            500,
            "Internal Server Error",
            &super::error_json(&format!("failed to read Web App index: {error}")),
        ),
    }
}

struct WebRoute {
    relative_path: Option<PathBuf>,
    is_asset_request: bool,
}

impl WebRoute {
    fn file_path(&self, web_dist_path: &Path) -> Option<PathBuf> {
        self.relative_path
            .as_ref()
            .map(|relative_path| web_dist_path.join(relative_path))
    }
}

fn parse_web_route(target: &str) -> Option<WebRoute> {
    let path = target
        .split_once('?')
        .map(|(path, _)| path)
        .unwrap_or(target);
    let decoded_path = percent_decode(path);
    let relative_path = web_relative_path(&decoded_path)?;
    let is_asset_request = relative_path
        .as_ref()
        .is_some_and(|path| path.extension().is_some());

    Some(WebRoute {
        relative_path,
        is_asset_request,
    })
}

fn web_relative_path(decoded_path: &str) -> Option<Option<PathBuf>> {
    if decoded_path.contains('\0') || decoded_path.contains('\\') {
        return None;
    }

    let relative = decoded_path.strip_prefix('/')?;
    if relative.is_empty() {
        return Some(None);
    }
    if relative.starts_with('/') || relative.starts_with('\\') || has_windows_drive_prefix(relative)
    {
        return None;
    }

    let mut path = PathBuf::new();
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(value) => path.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }

    if path.as_os_str().is_empty() {
        Some(None)
    } else {
        Some(Some(path))
    }
}

fn has_windows_drive_prefix(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}
