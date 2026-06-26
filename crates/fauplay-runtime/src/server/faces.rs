use std::path::PathBuf;

use crate::{
    FaceDetectAssetRequest, FaceDetectAssetResponse, FaceListAssetFacesRequest,
    FaceListAssetFacesResponse, FaceMediaType, FaceRecord, FaceScope, FaceStatus, FauplayRuntime,
    RootRelativePath,
};

use super::{
    HttpResponse, error_json, escape_json_string, http_response, json_string_field, parse_json_body,
};

pub(in crate::server) fn handle_detect_asset_faces_json(
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
    let Some(root_relative_path) = face_root_relative_path(&payload) else {
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

    match runtime.detect_asset_faces(FaceDetectAssetRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
    }) {
        Ok(response) => http_response(200, "OK", &face_detect_asset_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

pub(in crate::server) fn handle_list_asset_faces_json(
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
    let root_relative_path = match face_root_relative_path(&payload) {
        Some(root_relative_path) => match RootRelativePath::try_from(root_relative_path) {
            Ok(path) => Some(path),
            Err(error) => {
                return http_response(400, "Bad Request", &error_json(&error.to_string()));
            }
        },
        None => None,
    };
    let person_id = json_string_field(&payload, "personId").map(ToOwned::to_owned);
    if root_relative_path.is_none() && person_id.is_none() {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"relativePath or personId is required\"}",
        );
    }

    match runtime.list_asset_faces(FaceListAssetFacesRequest {
        root_path: PathBuf::from(root_path),
        root_relative_path,
        person_id,
    }) {
        Ok(response) => http_response(200, "OK", &face_list_asset_faces_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

fn face_root_relative_path(payload: &serde_json::Value) -> Option<&str> {
    json_string_field(payload, "relativePath")
        .or_else(|| json_string_field(payload, "rootRelativePath"))
}

fn face_detect_asset_response_json(response: FaceDetectAssetResponse) -> String {
    format!(
        "{{\"ok\":true,\"assetId\":\"{}\",\"assetPath\":\"{}\",\"detected\":{},\"created\":{},\"updated\":{},\"skipped\":{},\"faces\":[{}]}}",
        escape_json_string(&response.asset_id),
        escape_json_string(&response.asset_path.to_string()),
        response.detected,
        response.created,
        response.updated,
        response.skipped,
        face_records_json(response.faces),
    )
}

fn face_list_asset_faces_response_json(response: FaceListAssetFacesResponse) -> String {
    format!(
        "{{\"ok\":true,\"scope\":\"{}\",\"total\":{},\"items\":[{}]}}",
        face_scope_json(response.scope),
        response.total,
        face_records_json(response.items),
    )
}

fn face_records_json(records: Vec<FaceRecord>) -> String {
    records
        .into_iter()
        .map(face_record_json)
        .collect::<Vec<_>>()
        .join(",")
}

fn face_record_json(record: FaceRecord) -> String {
    format!(
        "{{\"faceId\":\"{}\",\"assetId\":\"{}\",\"assetPath\":{},\"boundingBox\":{{\"x1\":{},\"y1\":{},\"x2\":{},\"y2\":{}}},\"score\":{},\"status\":\"{}\",\"mediaType\":\"{}\",\"frameTsMs\":{},\"personId\":{},\"personName\":{},\"assignedBy\":{},\"updatedAt\":{}}}",
        escape_json_string(&record.face_id),
        escape_json_string(&record.asset_id),
        optional_root_relative_path_json(record.asset_path),
        record.bounding_box.x1,
        record.bounding_box.y1,
        record.bounding_box.x2,
        record.bounding_box.y2,
        record.score,
        face_status_json(record.status),
        face_media_type_json(record.media_type),
        optional_u64_json(record.frame_ts_ms),
        optional_string_json(record.person_id.as_deref()),
        optional_string_json(record.person_name.as_deref()),
        optional_string_json(record.assigned_by.as_deref()),
        record.updated_at_ms,
    )
}

fn optional_root_relative_path_json(value: Option<RootRelativePath>) -> String {
    value
        .map(|value| format!("\"{}\"", escape_json_string(&value.to_string())))
        .unwrap_or_else(|| "null".to_owned())
}

fn optional_string_json(value: Option<&str>) -> String {
    value
        .map(|value| format!("\"{}\"", escape_json_string(value)))
        .unwrap_or_else(|| "null".to_owned())
}

fn optional_u64_json(value: Option<u64>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_owned())
}

fn face_scope_json(value: FaceScope) -> &'static str {
    match value {
        FaceScope::Root => "root",
    }
}

fn face_media_type_json(value: FaceMediaType) -> &'static str {
    match value {
        FaceMediaType::Image => "image",
        FaceMediaType::Video => "video",
    }
}

fn face_status_json(value: FaceStatus) -> &'static str {
    match value {
        FaceStatus::Assigned => "assigned",
        FaceStatus::Unassigned => "unassigned",
        FaceStatus::Deferred => "deferred",
        FaceStatus::ManualUnassigned => "manual_unassigned",
        FaceStatus::Ignored => "ignored",
    }
}
