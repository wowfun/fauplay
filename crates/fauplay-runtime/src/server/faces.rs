use std::path::PathBuf;

use crate::{
    FaceClusterPendingRequest, FaceClusterPendingResponse, FaceDetectAssetRequest,
    FaceDetectAssetResponse, FaceListAssetFacesRequest, FaceListAssetFacesResponse,
    FaceListPeopleRequest, FaceListPeopleResponse, FaceListReviewFacesRequest,
    FaceListReviewFacesResponse, FaceMediaType, FaceMergePeopleRequest, FaceMergePeopleResponse,
    FaceMutateFacesRequest, FaceMutateFacesResponse, FaceMutationAction, FaceMutationItem,
    FaceRecord, FaceRenamePersonRequest, FaceRenamePersonResponse, FaceReviewBucket, FaceScope,
    FaceStatus, FaceSuggestPeopleRequest, FaceSuggestPeopleResponse, FauplayRuntime,
    PersonSuggestion, PersonSuggestionFace, PersonSummary, RootRelativePath,
};

use super::{
    HttpResponse, error_json, escape_json_string, http_response, json_string_array_field,
    json_string_field, parse_json_body,
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

pub(in crate::server) fn handle_suggest_people_json(
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
    let Some(face_id) = json_string_field(&payload, "faceId") else {
        return http_response(400, "Bad Request", "{\"error\":\"faceId is required\"}");
    };

    match runtime.suggest_people(FaceSuggestPeopleRequest {
        root_path: PathBuf::from(root_path),
        face_id: face_id.to_owned(),
        candidate_size: json_usize_field(&payload, "candidateSize").unwrap_or(6),
    }) {
        Ok(response) => http_response(200, "OK", &face_suggest_people_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

pub(in crate::server) fn handle_cluster_pending_faces_json(
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

    match runtime.cluster_pending_faces(FaceClusterPendingRequest {
        root_path: PathBuf::from(root_path),
        asset_id: json_string_field(&payload, "assetId").map(ToOwned::to_owned),
        limit: json_usize_field(&payload, "limit").unwrap_or(100),
        max_distance: json_f64_field(&payload, "maxDistance").unwrap_or(0.5),
        min_faces: json_usize_field(&payload, "minFaces").unwrap_or(3),
    }) {
        Ok(response) => http_response(200, "OK", &face_cluster_pending_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

pub(in crate::server) fn handle_merge_people_json(
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
    let Some(target_person_id) = json_string_field(&payload, "targetPersonId") else {
        return http_response(
            400,
            "Bad Request",
            "{\"error\":\"targetPersonId is required\"}",
        );
    };

    match runtime.merge_people(FaceMergePeopleRequest {
        root_path: PathBuf::from(root_path),
        target_person_id: target_person_id.to_owned(),
        source_person_ids: json_string_array_field(&payload, "sourcePersonIds"),
    }) {
        Ok(response) => http_response(200, "OK", &face_merge_people_response_json(response)),
        Err(error) => http_response(400, "Bad Request", &error_json(&error.to_string())),
    }
}

pub(in crate::server) fn handle_mutate_faces_json(
    runtime: &FauplayRuntime,
    request: &str,
    action: FaceMutationAction,
) -> HttpResponse {
    let payload = match parse_json_body(request) {
        Ok(payload) => payload,
        Err(response) => return response,
    };
    let Some(root_path) = json_string_field(&payload, "rootPath") else {
        return http_response(400, "Bad Request", "{\"error\":\"rootPath is required\"}");
    };

    match runtime.mutate_faces(FaceMutateFacesRequest {
        root_path: PathBuf::from(root_path),
        action,
        face_ids: json_string_array_field(&payload, "faceIds"),
        target_person_id: json_string_field(&payload, "targetPersonId").map(ToOwned::to_owned),
        name: json_string_field(&payload, "name").map(ToOwned::to_owned),
    }) {
        Ok(response) => http_response(200, "OK", &face_mutate_faces_response_json(response)),
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

fn json_f64_field(payload: &serde_json::Value, key: &str) -> Option<f64> {
    match payload.get(key) {
        Some(serde_json::Value::Number(value)) => value.as_f64().filter(|value| value.is_finite()),
        Some(serde_json::Value::String(value)) => value
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|value| value.is_finite()),
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

fn face_suggest_people_response_json(response: FaceSuggestPeopleResponse) -> String {
    format!(
        "{{\"ok\":true,\"faceId\":\"{}\",\"items\":[{}]}}",
        escape_json_string(&response.face_id),
        person_suggestions_json(response.items),
    )
}

fn face_cluster_pending_response_json(response: FaceClusterPendingResponse) -> String {
    format!(
        "{{\"ok\":true,\"processed\":{},\"assigned\":{},\"createdPersons\":{},\"deferred\":{},\"skipped\":{},\"failed\":{}}}",
        response.processed,
        response.assigned,
        response.created_persons,
        response.deferred,
        response.skipped,
        response.failed,
    )
}

fn face_merge_people_response_json(response: FaceMergePeopleResponse) -> String {
    format!(
        "{{\"ok\":true,\"targetPersonId\":\"{}\",\"merged\":{},\"sourcePersonIds\":{},\"skippedSourcePersonIds\":{}}}",
        escape_json_string(&response.target_person_id),
        response.merged,
        string_array_json(response.source_person_ids),
        string_array_json(response.skipped_source_person_ids),
    )
}

fn face_mutate_faces_response_json(response: FaceMutateFacesResponse) -> String {
    format!(
        "{{\"ok\":true,\"action\":\"{}\",\"total\":{},\"succeeded\":{},\"failed\":{},\"items\":[{}],\"targetPersonId\":{},\"personId\":{}}}",
        face_mutation_action_json(response.action),
        response.total,
        response.succeeded,
        response.failed,
        face_mutation_items_json(response.items),
        optional_string_json(response.target_person_id.as_deref()),
        optional_string_json(response.person_id.as_deref()),
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

fn person_suggestions_json(items: Vec<PersonSuggestion>) -> String {
    items
        .into_iter()
        .map(person_suggestion_json)
        .collect::<Vec<_>>()
        .join(",")
}

fn person_suggestion_json(item: PersonSuggestion) -> String {
    format!(
        "{{\"personId\":\"{}\",\"name\":\"{}\",\"score\":{},\"distance\":{},\"supportingFace\":{}}}",
        escape_json_string(&item.person_id),
        escape_json_string(&item.name),
        item.score,
        item.distance,
        person_suggestion_face_json(item.supporting_face),
    )
}

fn person_suggestion_face_json(face: PersonSuggestionFace) -> String {
    format!(
        "{{\"faceId\":\"{}\",\"assetId\":\"{}\",\"assetPath\":{},\"mediaType\":\"{}\",\"frameTsMs\":{},\"boundingBox\":{{\"x1\":{},\"y1\":{},\"x2\":{},\"y2\":{}}}}}",
        escape_json_string(&face.face_id),
        escape_json_string(&face.asset_id),
        optional_string_json(face.asset_path.as_deref()),
        face_media_type_json(face.media_type),
        optional_u64_json(face.frame_ts_ms),
        face.bounding_box.x1,
        face.bounding_box.y1,
        face.bounding_box.x2,
        face.bounding_box.y2,
    )
}

fn string_array_json(items: Vec<String>) -> String {
    format!(
        "[{}]",
        items
            .into_iter()
            .map(|item| format!("\"{}\"", escape_json_string(&item)))
            .collect::<Vec<_>>()
            .join(",")
    )
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

fn face_mutation_items_json(items: Vec<FaceMutationItem>) -> String {
    items
        .into_iter()
        .map(face_mutation_item_json)
        .collect::<Vec<_>>()
        .join(",")
}

fn face_mutation_item_json(item: FaceMutationItem) -> String {
    format!(
        "{{\"faceId\":\"{}\",\"ok\":{},\"previousStatus\":{},\"previousPersonId\":{},\"nextStatus\":{},\"nextPersonId\":{},\"reasonCode\":{},\"error\":{}}}",
        escape_json_string(&item.face_id),
        if item.ok { "true" } else { "false" },
        optional_face_status_json(item.previous_status),
        optional_string_json(item.previous_person_id.as_deref()),
        optional_face_status_json(item.next_status),
        optional_string_json(item.next_person_id.as_deref()),
        optional_string_json(item.reason_code.as_deref()),
        optional_string_json(item.error.as_deref()),
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

fn optional_face_status_json(value: Option<FaceStatus>) -> String {
    value
        .map(|value| format!("\"{}\"", face_status_json(value)))
        .unwrap_or_else(|| "null".to_owned())
}

fn face_mutation_action_json(value: FaceMutationAction) -> &'static str {
    match value {
        FaceMutationAction::AssignFaces => "assignFaces",
        FaceMutationAction::CreatePersonFromFaces => "createPersonFromFaces",
        FaceMutationAction::UnassignFaces => "unassignFaces",
        FaceMutationAction::IgnoreFaces => "ignoreFaces",
        FaceMutationAction::RestoreIgnoredFaces => "restoreIgnoredFaces",
        FaceMutationAction::RequeueFaces => "requeueFaces",
    }
}
