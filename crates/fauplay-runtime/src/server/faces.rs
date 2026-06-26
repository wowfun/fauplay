use std::path::PathBuf;

use crate::{
    FaceDetectAssetRequest, FaceDetectAssetResponse, FaceListAssetFacesRequest,
    FaceListAssetFacesResponse, FaceListPeopleRequest, FaceListPeopleResponse,
    FaceListReviewFacesRequest, FaceListReviewFacesResponse, FaceMediaType, FaceRecord,
    FaceRenamePersonRequest, FaceRenamePersonResponse, FaceReviewBucket, FaceScope, FaceStatus,
    FauplayRuntime, PersonSummary, RootRelativePath,
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

pub(in crate::server) fn handle_list_review_faces_json(
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
    let Some(bucket) = parse_face_review_bucket(json_string_field(&payload, "bucket")) else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"bucket must be \\\"unassigned\\\" or \\\"ignored\\\"\"}",
        );
    };
    let page = json_usize_field(&payload, "page").unwrap_or(1).max(1);
    let size = json_usize_field(&payload, "size")
        .unwrap_or(100)
        .clamp(1, 500);

    match runtime.list_review_faces(FaceListReviewFacesRequest {
        root_path: PathBuf::from(root_path),
        bucket,
        page,
        size,
    }) {
        Ok(response) => http_response(200, "OK", &face_list_review_faces_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

pub(in crate::server) fn handle_list_people_json(
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
    let page = json_usize_field(&payload, "page").unwrap_or(1).max(1);
    let size = json_usize_field(&payload, "size")
        .unwrap_or(100)
        .clamp(1, 500);
    let Some(scope) = parse_face_scope(json_string_field(&payload, "scope")) else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"scope must be \\\"root\\\" or \\\"global\\\"\"}",
        );
    };

    match runtime.list_people(FaceListPeopleRequest {
        root_path: PathBuf::from(root_path),
        scope,
        query: json_string_field(&payload, "query").map(ToOwned::to_owned),
        page,
        size,
    }) {
        Ok(response) => http_response(200, "OK", &face_list_people_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

pub(in crate::server) fn handle_rename_person_json(
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
    let Some(person_id) = json_string_field(&payload, "personId") else {
        return http_response(400, "Bad Request", "{\"error\":\"personId is required\"}");
    };
    let name = json_string_field(&payload, "name").unwrap_or_default();

    match runtime.rename_person(FaceRenamePersonRequest {
        root_path: PathBuf::from(root_path),
        person_id: person_id.to_owned(),
        name: name.to_owned(),
    }) {
        Ok(response) => http_response(200, "OK", &face_rename_person_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

fn face_root_relative_path(payload: &serde_json::Value) -> Option<&str> {
    json_string_field(payload, "relativePath")
        .or_else(|| json_string_field(payload, "rootRelativePath"))
}

fn json_usize_field(payload: &serde_json::Value, key: &str) -> Option<usize> {
    match payload.get(key) {
        Some(serde_json::Value::Number(value)) => {
            value.as_u64().and_then(|value| usize::try_from(value).ok())
        }
        Some(serde_json::Value::String(value)) => value.trim().parse::<usize>().ok(),
        _ => None,
    }
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

fn face_list_review_faces_response_json(response: FaceListReviewFacesResponse) -> String {
    format!(
        "{{\"ok\":true,\"scope\":\"{}\",\"bucket\":\"{}\",\"page\":{},\"size\":{},\"total\":{},\"items\":[{}]}}",
        face_scope_json(response.scope),
        face_review_bucket_json(response.bucket),
        response.page,
        response.size,
        response.total,
        face_records_json(response.items),
    )
}

fn face_list_people_response_json(response: FaceListPeopleResponse) -> String {
    format!(
        "{{\"ok\":true,\"scope\":\"{}\",\"page\":{},\"size\":{},\"total\":{},\"items\":[{}]}}",
        face_scope_json(response.scope),
        response.page,
        response.size,
        response.total,
        person_summaries_json(response.items),
    )
}

fn face_rename_person_response_json(response: FaceRenamePersonResponse) -> String {
    format!(
        "{{\"ok\":true,\"person\":{}}}",
        person_summary_json(response.person),
    )
}

fn face_records_json(records: Vec<FaceRecord>) -> String {
    records
        .into_iter()
        .map(face_record_json)
        .collect::<Vec<_>>()
        .join(",")
}

fn person_summaries_json(items: Vec<PersonSummary>) -> String {
    items
        .into_iter()
        .map(person_summary_json)
        .collect::<Vec<_>>()
        .join(",")
}

fn person_summary_json(person: PersonSummary) -> String {
    format!(
        "{{\"personId\":\"{}\",\"name\":\"{}\",\"faceCount\":{},\"globalFaceCount\":{},\"featureFaceId\":{},\"featureAssetPath\":{},\"updatedAt\":{}}}",
        escape_json_string(&person.person_id),
        escape_json_string(&person.name),
        person.face_count,
        person.global_face_count,
        optional_string_json(person.feature_face_id.as_deref()),
        optional_string_json(person.feature_asset_path.as_deref()),
        person.updated_at_ms,
    )
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
        FaceScope::Global => "global",
    }
}

fn parse_face_scope(value: Option<&str>) -> Option<FaceScope> {
    match value.unwrap_or("global") {
        "root" => Some(FaceScope::Root),
        "global" => Some(FaceScope::Global),
        _ => None,
    }
}

fn parse_face_review_bucket(value: Option<&str>) -> Option<FaceReviewBucket> {
    match value {
        Some("unassigned") => Some(FaceReviewBucket::Unassigned),
        Some("ignored") => Some(FaceReviewBucket::Ignored),
        _ => None,
    }
}

fn face_review_bucket_json(value: FaceReviewBucket) -> &'static str {
    match value {
        FaceReviewBucket::Unassigned => "unassigned",
        FaceReviewBucket::Ignored => "ignored",
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
