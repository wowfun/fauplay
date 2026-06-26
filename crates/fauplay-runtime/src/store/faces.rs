use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{
    FaceBoundingBox, FaceDetectAssetRequest, FaceDetectAssetResponse, FaceListAssetFacesRequest,
    FaceListAssetFacesResponse, FaceMediaType, FaceRecord, FaceScope, FaceStatus, RootRelativePath,
    RuntimeError,
};

use super::{
    GLOBAL_CONFIG_FOLDER_NAME, file_annotation_absolute_path, now_ms, root_path_key,
    root_relative_path_key, string_value,
};

const FACES_FILENAME: &str = "faces.v1.json";

#[derive(Debug, Clone)]
struct FaceRecordData {
    root_path: String,
    root_relative_path: String,
    asset_id: String,
    face_id: String,
    bounding_box: FaceBoundingBox,
    score: f64,
    status: FaceStatus,
    media_type: FaceMediaType,
    frame_ts_ms: Option<u64>,
    person_id: Option<String>,
    person_name: Option<String>,
    assigned_by: Option<String>,
    updated_at_ms: u64,
    embedding: Vec<f64>,
}

pub(crate) fn save_detected_faces(
    runtime_home_path: &Path,
    request: FaceDetectAssetRequest,
    inference: Value,
) -> Result<FaceDetectAssetResponse, RuntimeError> {
    let absolute_path =
        file_annotation_absolute_path(&request.root_path, &request.root_relative_path)?;
    let metadata = fs::symlink_metadata(&absolute_path)
        .map_err(|source| RuntimeError::read_file(&absolute_path, source))?;
    if !metadata.is_file() {
        return Err(RuntimeError::invalid_detected_face(
            "target path must be a file",
        ));
    }

    let store_path = faces_path(runtime_home_path);
    let mut records = read_face_records(&store_path)?;
    let root_path = root_path_key(&request.root_path);
    let root_relative_path = root_relative_path_key(&request.root_relative_path);
    let asset_id = asset_id(&root_path, &root_relative_path);
    let updated_at_ms = now_ms();
    let payloads = inference
        .get("faces")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    records.retain(|record| {
        !(record.root_path == root_path && record.root_relative_path == root_relative_path)
    });

    let mut created_records = Vec::new();
    for (index, payload) in payloads.iter().enumerate() {
        let Some(record) = face_record_from_payload(
            payload,
            &root_path,
            &root_relative_path,
            &asset_id,
            updated_at_ms,
            index,
        ) else {
            continue;
        };
        records.push(record.clone());
        created_records.push(record);
    }

    write_face_records(&store_path, &records)?;

    let faces = created_records
        .iter()
        .filter_map(face_record_from_data)
        .collect::<Vec<_>>();

    Ok(FaceDetectAssetResponse {
        asset_id,
        asset_path: request.root_relative_path,
        detected: payloads.len(),
        created: faces.len(),
        updated: 0,
        skipped: payloads.len().saturating_sub(faces.len()),
        faces,
    })
}

pub(crate) fn list_asset_faces(
    runtime_home_path: &Path,
    request: FaceListAssetFacesRequest,
) -> Result<FaceListAssetFacesResponse, RuntimeError> {
    let store_path = faces_path(runtime_home_path);
    let root_path = root_path_key(&request.root_path);
    let root_relative_path = root_relative_path_key(&request.root_relative_path);
    let mut items = read_face_records(&store_path)?
        .into_iter()
        .filter(|record| {
            record.root_path == root_path && record.root_relative_path == root_relative_path
        })
        .filter_map(|record| face_record_from_data(&record))
        .collect::<Vec<_>>();

    items.sort_by(|left, right| {
        left.bounding_box
            .x1
            .partial_cmp(&right.bounding_box.x1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.face_id.cmp(&right.face_id))
    });

    Ok(FaceListAssetFacesResponse {
        scope: FaceScope::Root,
        total: items.len(),
        items,
    })
}

fn faces_path(runtime_home_path: &Path) -> PathBuf {
    runtime_home_path
        .join(GLOBAL_CONFIG_FOLDER_NAME)
        .join(FACES_FILENAME)
}

fn read_face_records(path: &Path) -> Result<Vec<FaceRecordData>, RuntimeError> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(RuntimeError::read_file(path, error)),
    };
    let value = serde_json::from_str::<Value>(&raw)
        .map_err(|error| RuntimeError::invalid_runtime_home_file(path, &error.to_string()))?;
    let faces = value
        .get("faces")
        .and_then(Value::as_array)
        .ok_or_else(|| RuntimeError::invalid_runtime_home_file(path, "faces must be an array"))?;

    Ok(faces
        .iter()
        .filter_map(face_record_data_from_value)
        .collect())
}

fn write_face_records(path: &Path, records: &[FaceRecordData]) -> Result<(), RuntimeError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| RuntimeError::write_file(parent, source))?;
    }

    let faces = records
        .iter()
        .map(|record| {
            serde_json::json!({
                "rootPath": record.root_path,
                "rootRelativePath": record.root_relative_path,
                "assetId": record.asset_id,
                "faceId": record.face_id,
                "boundingBox": {
                    "x1": record.bounding_box.x1,
                    "y1": record.bounding_box.y1,
                    "x2": record.bounding_box.x2,
                    "y2": record.bounding_box.y2,
                },
                "score": record.score,
                "status": face_status_json(record.status),
                "mediaType": face_media_type_json(record.media_type),
                "frameTsMs": record.frame_ts_ms,
                "personId": record.person_id,
                "personName": record.person_name,
                "assignedBy": record.assigned_by,
                "updatedAt": record.updated_at_ms,
                "embedding": record.embedding,
            })
        })
        .collect::<Vec<_>>();
    let raw = serde_json::to_string(&serde_json::json!({
        "version": 1,
        "faces": faces,
    }))
    .map_err(|error| RuntimeError::invalid_runtime_home_file(path, &error.to_string()))?;

    fs::write(path, raw).map_err(|source| RuntimeError::write_file(path, source))
}

fn face_record_from_payload(
    payload: &Value,
    root_path: &str,
    root_relative_path: &str,
    asset_id: &str,
    updated_at_ms: u64,
    index: usize,
) -> Option<FaceRecordData> {
    let object = payload.as_object()?;
    let box_object = object.get("boundingBox")?.as_object()?;
    let bounding_box = FaceBoundingBox {
        x1: finite_number(box_object.get("x1"))?,
        y1: finite_number(box_object.get("y1"))?,
        x2: finite_number(box_object.get("x2"))?,
        y2: finite_number(box_object.get("y2"))?,
    };
    let embedding = object
        .get("embedding")?
        .as_array()?
        .iter()
        .filter_map(|value| value.as_f64().filter(|number| number.is_finite()))
        .collect::<Vec<_>>();
    if embedding.is_empty() {
        return None;
    }

    let media_type = parse_face_media_type(object.get("mediaType").and_then(Value::as_str));
    let frame_ts_ms = match media_type {
        FaceMediaType::Image => None,
        FaceMediaType::Video => {
            finite_number(object.get("frameTsMs")).map(|value| value.max(0.0).round() as u64)
        }
    };

    Some(FaceRecordData {
        root_path: root_path.to_owned(),
        root_relative_path: root_relative_path.to_owned(),
        asset_id: asset_id.to_owned(),
        face_id: format!("{asset_id}-face-{updated_at_ms}-{index}"),
        bounding_box,
        score: finite_number(object.get("score")).unwrap_or(0.0),
        status: FaceStatus::Unassigned,
        media_type,
        frame_ts_ms,
        person_id: None,
        person_name: None,
        assigned_by: None,
        updated_at_ms,
        embedding,
    })
}

fn face_record_data_from_value(value: &Value) -> Option<FaceRecordData> {
    let object = value.as_object()?;
    let root_path = string_value(object.get("rootPath")).filter(|value| !value.is_empty())?;
    let root_relative_path =
        string_value(object.get("rootRelativePath")).filter(|value| !value.is_empty())?;
    let asset_id = string_value(object.get("assetId")).filter(|value| !value.is_empty())?;
    let face_id = string_value(object.get("faceId")).filter(|value| !value.is_empty())?;
    let box_object = object.get("boundingBox")?.as_object()?;
    let bounding_box = FaceBoundingBox {
        x1: finite_number(box_object.get("x1"))?,
        y1: finite_number(box_object.get("y1"))?,
        x2: finite_number(box_object.get("x2"))?,
        y2: finite_number(box_object.get("y2"))?,
    };
    let embedding = object
        .get("embedding")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_f64().filter(|number| number.is_finite()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Some(FaceRecordData {
        root_path,
        root_relative_path,
        asset_id,
        face_id,
        bounding_box,
        score: finite_number(object.get("score")).unwrap_or(0.0),
        status: parse_face_status(object.get("status").and_then(Value::as_str)),
        media_type: parse_face_media_type(object.get("mediaType").and_then(Value::as_str)),
        frame_ts_ms: object.get("frameTsMs").and_then(|value| {
            finite_number(Some(value)).map(|number| number.max(0.0).round() as u64)
        }),
        person_id: optional_string(object.get("personId")),
        person_name: optional_string(object.get("personName")),
        assigned_by: optional_string(object.get("assignedBy")),
        updated_at_ms: object.get("updatedAt").and_then(Value::as_u64).unwrap_or(0),
        embedding,
    })
}

fn face_record_from_data(record: &FaceRecordData) -> Option<FaceRecord> {
    Some(FaceRecord {
        face_id: record.face_id.clone(),
        asset_id: record.asset_id.clone(),
        asset_path: Some(RootRelativePath::try_from(record.root_relative_path.as_str()).ok()?),
        bounding_box: record.bounding_box.clone(),
        score: record.score,
        status: record.status,
        media_type: record.media_type,
        frame_ts_ms: record.frame_ts_ms,
        person_id: record.person_id.clone(),
        person_name: record.person_name.clone(),
        assigned_by: record.assigned_by.clone(),
        updated_at_ms: record.updated_at_ms,
    })
}

fn asset_id(root_path: &str, root_relative_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(root_path.as_bytes());
    hasher.update([0]);
    hasher.update(root_relative_path.as_bytes());
    let digest = hasher.finalize();
    format!("asset-{}", hex_prefix(&digest, 8))
}

fn hex_prefix(bytes: &[u8], take: usize) -> String {
    bytes
        .iter()
        .take(take)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn finite_number(value: Option<&Value>) -> Option<f64> {
    value?.as_f64().filter(|number| number.is_finite())
}

fn optional_string(value: Option<&Value>) -> Option<String> {
    string_value(value).filter(|value| !value.is_empty())
}

fn parse_face_media_type(value: Option<&str>) -> FaceMediaType {
    match value {
        Some("video") => FaceMediaType::Video,
        _ => FaceMediaType::Image,
    }
}

fn parse_face_status(value: Option<&str>) -> FaceStatus {
    match value {
        Some("assigned") => FaceStatus::Assigned,
        Some("deferred") => FaceStatus::Deferred,
        Some("manual_unassigned") => FaceStatus::ManualUnassigned,
        Some("ignored") => FaceStatus::Ignored,
        _ => FaceStatus::Unassigned,
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
