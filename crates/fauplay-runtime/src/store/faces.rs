use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{
    FaceBoundingBox, FaceClusterPendingRequest, FaceClusterPendingResponse, FaceCropRequest,
    FaceDetectAssetRequest, FaceDetectAssetResponse, FaceListAssetFacesRequest,
    FaceListAssetFacesResponse, FaceListPeopleRequest, FaceListPeopleResponse,
    FaceListReviewFacesRequest, FaceListReviewFacesResponse, FaceMediaType, FaceMergePeopleRequest,
    FaceMergePeopleResponse, FaceMutateFacesRequest, FaceMutateFacesResponse, FaceMutationAction,
    FaceMutationItem, FaceRecord, FaceRenamePersonRequest, FaceRenamePersonResponse,
    FaceReviewBucket, FaceScope, FaceStatus, FaceSuggestPeopleRequest, FaceSuggestPeopleResponse,
    PersonSuggestion, PersonSuggestionFace, PersonSummary, RootRelativePath, RuntimeError,
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

#[derive(Debug, Clone, Default)]
struct FaceStoreData {
    faces: Vec<FaceRecordData>,
    asset_detections: Vec<FaceAssetDetectionData>,
}

#[derive(Debug, Clone)]
pub(crate) struct FaceAssetDetection {
    pub asset_id: String,
    pub media_type: FaceMediaType,
    pub face_count: usize,
}

#[derive(Debug, Clone)]
pub(crate) struct FaceCropSource {
    pub absolute_path: PathBuf,
    pub bounding_box: FaceBoundingBox,
    pub media_type: FaceMediaType,
    pub frame_ts_ms: Option<u64>,
}

#[derive(Debug, Clone)]
struct FaceAssetDetectionData {
    root_path: String,
    root_relative_path: String,
    asset_id: String,
    media_type: FaceMediaType,
    status: String,
    face_count: usize,
    updated_at_ms: u64,
}

#[derive(Debug, Clone)]
struct PersonSummaryAccumulator {
    person_id: String,
    name: String,
    face_count: usize,
    global_face_count: usize,
    feature_face_id: Option<String>,
    feature_asset_path: Option<String>,
    updated_at_ms: u64,
    scoped_feature_face_id: Option<String>,
    scoped_feature_asset_path: Option<String>,
    scoped_updated_at_ms: u64,
}

#[derive(Debug, Clone)]
struct FaceEmbeddingIndexEntry {
    face_id: String,
    embedding: Vec<f64>,
    person_id: Option<String>,
}

#[derive(Debug, Clone)]
struct FaceClusterMatch {
    match_count: usize,
    matched_person_id: Option<String>,
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
    let mut store = read_face_store(&store_path)?;
    let root_path = root_path_key(&request.root_path);
    let root_relative_path = root_relative_path_key(&request.root_relative_path);
    let asset_id = asset_id(&root_path, &root_relative_path);
    let updated_at_ms = now_ms();
    let payloads = inference
        .get("faces")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    store.faces.retain(|record| {
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
        store.faces.push(record.clone());
        created_records.push(record);
    }

    let faces = created_records
        .iter()
        .filter_map(face_record_from_data)
        .collect::<Vec<_>>();
    let media_type = created_records
        .first()
        .map(|record| record.media_type)
        .or_else(|| face_media_type_from_root_relative_path(&request.root_relative_path))
        .unwrap_or(FaceMediaType::Image);

    store.asset_detections.retain(|record| {
        !(record.root_path == root_path && record.root_relative_path == root_relative_path)
    });
    store.asset_detections.push(FaceAssetDetectionData {
        root_path,
        root_relative_path,
        asset_id: asset_id.clone(),
        media_type,
        status: "success".to_owned(),
        face_count: faces.len(),
        updated_at_ms,
    });

    write_face_store(&store_path, &store)?;

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

pub(crate) fn get_asset_face_detection(
    runtime_home_path: &Path,
    root_path: &Path,
    root_relative_path: &RootRelativePath,
) -> Result<Option<FaceAssetDetection>, RuntimeError> {
    let store_path = faces_path(runtime_home_path);
    let store = read_face_store(&store_path)?;
    let root_path = root_path_key(root_path);
    let root_relative_path = root_relative_path_key(root_relative_path);

    if let Some(record) = store.asset_detections.iter().find(|record| {
        record.root_path == root_path
            && record.root_relative_path == root_relative_path
            && record.status == "success"
    }) {
        return Ok(Some(FaceAssetDetection {
            asset_id: record.asset_id.clone(),
            media_type: record.media_type,
            face_count: record.face_count,
        }));
    }

    let mut matching_faces = store.faces.iter().filter(|record| {
        record.root_path == root_path && record.root_relative_path == root_relative_path
    });
    let Some(first_face) = matching_faces.next() else {
        return Ok(None);
    };
    let face_count = 1 + matching_faces.count();
    Ok(Some(FaceAssetDetection {
        asset_id: first_face.asset_id.clone(),
        media_type: first_face.media_type,
        face_count,
    }))
}

pub(crate) fn resolve_face_crop_source(
    runtime_home_path: &Path,
    request: &FaceCropRequest,
) -> Result<FaceCropSource, RuntimeError> {
    let face_id = request.face_id.trim();
    if face_id.is_empty() {
        return Err(RuntimeError::invalid_detected_face("faceId is required"));
    }

    let scoped_root_path = request.root_path.as_deref().map(root_path_key);
    let store_path = faces_path(runtime_home_path);
    let record = read_face_records(&store_path)?
        .into_iter()
        .find(|record| {
            record.face_id == face_id
                && scoped_root_path
                    .as_ref()
                    .is_none_or(|root_path| record.root_path == *root_path)
        })
        .ok_or_else(|| RuntimeError::runtime_capability(format!("face not found: {face_id}")))?;
    let root_relative_path = RootRelativePath::try_from(record.root_relative_path.as_str())?;
    let absolute_path =
        file_annotation_absolute_path(Path::new(&record.root_path), &root_relative_path)?;

    let metadata = fs::symlink_metadata(&absolute_path)
        .map_err(|source| RuntimeError::read_file(&absolute_path, source))?;
    if !metadata.is_file() {
        return Err(RuntimeError::runtime_capability(format!(
            "Face Crop source is not a file: {}",
            absolute_path.display()
        )));
    }

    Ok(FaceCropSource {
        absolute_path,
        bounding_box: record.bounding_box,
        media_type: record.media_type,
        frame_ts_ms: record.frame_ts_ms,
    })
}

pub(crate) fn list_asset_faces(
    runtime_home_path: &Path,
    request: FaceListAssetFacesRequest,
) -> Result<FaceListAssetFacesResponse, RuntimeError> {
    let store_path = faces_path(runtime_home_path);
    let root_path = root_path_key(&request.root_path);
    let root_relative_path = request
        .root_relative_path
        .as_ref()
        .map(root_relative_path_key);
    let person_id = request
        .person_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    if root_relative_path.is_none() && person_id.is_none() {
        return Err(RuntimeError::invalid_detected_face(
            "relativePath or personId is required",
        ));
    }
    let mut items = read_face_records(&store_path)?
        .into_iter()
        .filter(|record| record.root_path == root_path)
        .filter(|record| {
            root_relative_path
                .as_ref()
                .is_none_or(|path| record.root_relative_path == *path)
        })
        .filter(|record| {
            person_id
                .as_ref()
                .is_none_or(|person_id| record.person_id.as_ref() == Some(person_id))
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

pub(crate) fn list_review_faces(
    runtime_home_path: &Path,
    request: FaceListReviewFacesRequest,
) -> Result<FaceListReviewFacesResponse, RuntimeError> {
    let store_path = faces_path(runtime_home_path);
    let root_path = root_path_key(&request.root_path);
    let page = request.page.max(1);
    let size = request.size.clamp(1, 500);
    let offset = page.saturating_sub(1).saturating_mul(size);
    let mut matching = read_face_records(&store_path)?
        .into_iter()
        .filter(|record| record.root_path == root_path)
        .filter(|record| face_status_matches_review_bucket(record.status, request.bucket))
        .filter_map(|record| face_record_from_data(&record))
        .collect::<Vec<_>>();

    matching.sort_by(|left, right| {
        face_review_status_order(left.status)
            .cmp(&face_review_status_order(right.status))
            .then_with(|| right.updated_at_ms.cmp(&left.updated_at_ms))
            .then_with(|| left.face_id.cmp(&right.face_id))
    });

    let total = matching.len();
    let items = matching.into_iter().skip(offset).take(size).collect();

    Ok(FaceListReviewFacesResponse {
        scope: FaceScope::Root,
        bucket: request.bucket,
        page,
        size,
        total,
        items,
    })
}

pub(crate) fn list_people(
    runtime_home_path: &Path,
    request: FaceListPeopleRequest,
) -> Result<FaceListPeopleResponse, RuntimeError> {
    let store_path = faces_path(runtime_home_path);
    let root_path = root_path_key(&request.root_path);
    let scope = request.scope;
    let page = request.page.max(1);
    let size = request.size.clamp(1, 500);
    let offset = page.saturating_sub(1).saturating_mul(size);
    let query = request
        .query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase());
    let mut people = BTreeMap::<String, PersonSummaryAccumulator>::new();

    for record in read_face_records(&store_path)? {
        let Some(person_id) = record
            .person_id
            .as_deref()
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if RootRelativePath::try_from(record.root_relative_path.as_str()).is_err() {
            continue;
        }
        let in_scope = scope == FaceScope::Global || record.root_path == root_path;
        let display_path = face_record_display_path(&root_path, &record);
        let entry =
            people
                .entry(person_id.to_owned())
                .or_insert_with(|| PersonSummaryAccumulator {
                    person_id: person_id.to_owned(),
                    name: record.person_name.clone().unwrap_or_default(),
                    face_count: 0,
                    global_face_count: 0,
                    feature_face_id: None,
                    feature_asset_path: None,
                    updated_at_ms: 0,
                    scoped_feature_face_id: None,
                    scoped_feature_asset_path: None,
                    scoped_updated_at_ms: 0,
                });

        entry.global_face_count += 1;
        if entry.name.is_empty() {
            entry.name = record.person_name.clone().unwrap_or_default();
        }
        if record.updated_at_ms > entry.updated_at_ms
            || (record.updated_at_ms == entry.updated_at_ms
                && entry
                    .feature_face_id
                    .as_ref()
                    .is_none_or(|face_id| record.face_id < *face_id))
        {
            entry.feature_face_id = Some(record.face_id.clone());
            entry.feature_asset_path = Some(display_path.clone());
            entry.updated_at_ms = record.updated_at_ms;
        }
        if in_scope {
            entry.face_count += 1;
            if record.updated_at_ms > entry.scoped_updated_at_ms
                || (record.updated_at_ms == entry.scoped_updated_at_ms
                    && entry
                        .scoped_feature_face_id
                        .as_ref()
                        .is_none_or(|face_id| record.face_id < *face_id))
            {
                entry.scoped_feature_face_id = Some(record.face_id.clone());
                entry.scoped_feature_asset_path = Some(display_path);
                entry.scoped_updated_at_ms = record.updated_at_ms;
            }
        }
    }

    let mut items = people
        .into_values()
        .filter(|person| person.face_count > 0)
        .filter(|person| {
            query
                .as_ref()
                .is_none_or(|query| person_summary_matches_query(person, query))
        })
        .map(|person| PersonSummary {
            person_id: person.person_id,
            name: person.name,
            face_count: person.face_count,
            global_face_count: person.global_face_count,
            feature_face_id: match scope {
                FaceScope::Root => person.scoped_feature_face_id,
                FaceScope::Global => person.feature_face_id,
            },
            feature_asset_path: match scope {
                FaceScope::Root => person.scoped_feature_asset_path,
                FaceScope::Global => person.feature_asset_path,
            },
            updated_at_ms: match scope {
                FaceScope::Root => person.scoped_updated_at_ms,
                FaceScope::Global => person.updated_at_ms,
            },
        })
        .collect::<Vec<_>>();

    items.sort_by(|left, right| {
        right
            .face_count
            .cmp(&left.face_count)
            .then_with(|| right.global_face_count.cmp(&left.global_face_count))
            .then_with(|| right.updated_at_ms.cmp(&left.updated_at_ms))
            .then_with(|| left.person_id.cmp(&right.person_id))
    });

    let total = items.len();
    let items = items.into_iter().skip(offset).take(size).collect();

    Ok(FaceListPeopleResponse {
        scope,
        page,
        size,
        total,
        items,
    })
}

pub(crate) fn rename_person(
    runtime_home_path: &Path,
    request: FaceRenamePersonRequest,
) -> Result<FaceRenamePersonResponse, RuntimeError> {
    let store_path = faces_path(runtime_home_path);
    let person_id = request.person_id.trim().to_owned();
    if person_id.is_empty() {
        return Err(RuntimeError::invalid_detected_face("personId is required"));
    }
    let mut records = read_face_records(&store_path)?;
    let mut found = false;
    for record in &mut records {
        if record.person_id.as_deref() == Some(person_id.as_str()) {
            record.person_name = Some(request.name.trim().to_owned());
            found = true;
        }
    }
    if !found {
        return Err(RuntimeError::runtime_capability(format!(
            "person not found: {person_id}"
        )));
    }
    write_face_records(&store_path, &records)?;

    let person = list_people(
        runtime_home_path,
        FaceListPeopleRequest {
            root_path: request.root_path,
            scope: FaceScope::Root,
            query: Some(person_id.clone()),
            page: 1,
            size: 500,
        },
    )?
    .items
    .into_iter()
    .find(|person| person.person_id == person_id)
    .ok_or_else(|| RuntimeError::runtime_capability(format!("person not found: {person_id}")))?;

    Ok(FaceRenamePersonResponse { person })
}

pub(crate) fn suggest_people(
    runtime_home_path: &Path,
    request: FaceSuggestPeopleRequest,
) -> Result<FaceSuggestPeopleResponse, RuntimeError> {
    let store_path = faces_path(runtime_home_path);
    let root_path = root_path_key(&request.root_path);
    let face_id = request.face_id.trim().to_owned();
    if face_id.is_empty() {
        return Err(RuntimeError::invalid_detected_face("faceId is required"));
    }

    let records = read_face_records(&store_path)?;
    let Some(source) = records
        .iter()
        .find(|record| record.root_path == root_path && record.face_id == face_id)
    else {
        return Err(RuntimeError::runtime_capability(format!(
            "face not found: {face_id}"
        )));
    };
    if source.embedding.is_empty() {
        return Err(RuntimeError::runtime_capability(format!(
            "face embedding not found: {face_id}"
        )));
    }

    let candidate_size = request.candidate_size.clamp(1, 20);
    let mut candidates = BTreeMap::<String, PersonSuggestion>::new();

    for record in &records {
        let Some(person_id) = record
            .person_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if record.face_id == face_id
            || record.embedding.is_empty()
            || RootRelativePath::try_from(record.root_relative_path.as_str()).is_err()
        {
            continue;
        }

        let distance = cosine_distance(&source.embedding, &record.embedding);
        let suggestion = PersonSuggestion {
            person_id: person_id.to_owned(),
            name: record.person_name.clone().unwrap_or_default(),
            score: (1.0 - distance).max(0.0),
            distance,
            supporting_face: PersonSuggestionFace {
                face_id: record.face_id.clone(),
                asset_id: record.asset_id.clone(),
                asset_path: Some(face_record_display_path(&root_path, record)),
                media_type: record.media_type,
                frame_ts_ms: record.frame_ts_ms,
                bounding_box: record.bounding_box.clone(),
            },
        };

        let should_replace = candidates
            .get(person_id)
            .is_none_or(|existing| person_suggestion_is_better(&suggestion, existing));
        if should_replace {
            candidates.insert(person_id.to_owned(), suggestion);
        }
    }

    let mut items = candidates.into_values().collect::<Vec<_>>();
    items.sort_by(|left, right| {
        left.distance
            .partial_cmp(&right.distance)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.person_id.cmp(&right.person_id))
            .then_with(|| {
                left.supporting_face
                    .face_id
                    .cmp(&right.supporting_face.face_id)
            })
    });
    items.truncate(candidate_size);

    Ok(FaceSuggestPeopleResponse { face_id, items })
}

pub(crate) fn cluster_pending_faces(
    runtime_home_path: &Path,
    request: FaceClusterPendingRequest,
) -> Result<FaceClusterPendingResponse, RuntimeError> {
    let store_path = faces_path(runtime_home_path);
    let root_path = root_path_key(&request.root_path);
    let asset_id = request
        .asset_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let limit = request.limit.clamp(1, 2000);
    let max_distance = if request.max_distance.is_finite() {
        request.max_distance.max(0.0)
    } else {
        0.5
    };
    let min_faces = request.min_faces.max(1);
    let mut records = read_face_records(&store_path)?;
    let mut pending_indices = records
        .iter()
        .enumerate()
        .filter(|(_, record)| record.root_path == root_path)
        .filter(|(_, record)| {
            asset_id
                .as_ref()
                .is_none_or(|asset_id| record.asset_id == *asset_id)
        })
        .filter(|(_, record)| {
            matches!(record.status, FaceStatus::Unassigned | FaceStatus::Deferred)
        })
        .filter(|(_, record)| !record.embedding.is_empty())
        .map(|(index, _)| index)
        .collect::<Vec<_>>();

    pending_indices.sort_by(|left, right| {
        records[*left]
            .updated_at_ms
            .cmp(&records[*right].updated_at_ms)
            .then_with(|| records[*left].face_id.cmp(&records[*right].face_id))
    });
    pending_indices.truncate(limit);

    if pending_indices.is_empty() {
        return Ok(FaceClusterPendingResponse {
            processed: 0,
            assigned: 0,
            created_persons: 0,
            deferred: 0,
            skipped: 0,
            failed: 0,
        });
    }

    let mut embedding_index = records
        .iter()
        .filter(|record| record.root_path == root_path)
        .filter(|record| !record.embedding.is_empty())
        .map(|record| FaceEmbeddingIndexEntry {
            face_id: record.face_id.clone(),
            embedding: record.embedding.clone(),
            person_id: record.person_id.clone(),
        })
        .collect::<Vec<_>>();

    let mut processed = 0usize;
    let mut assigned = 0usize;
    let mut created_persons = 0usize;
    let mut deferred = 0usize;
    let skipped = 0usize;
    let failed = 0usize;
    let mut changed = false;

    for index in pending_indices {
        processed += 1;
        let current = records[index].clone();
        let cluster_match = choose_person_for_face(
            &current.face_id,
            &current.embedding,
            &embedding_index,
            max_distance,
        );
        let mut person_id = cluster_match.matched_person_id;

        if person_id.is_none() && cluster_match.match_count >= min_faces {
            let created_person_id = create_person_id(&records, now_ms());
            person_id = Some(created_person_id);
            created_persons += 1;
        }

        if let Some(person_id) = person_id {
            let person_name = person_name_for_id(&records, &person_id).unwrap_or_default();
            let updated_at_ms = now_ms();
            assign_face_record(
                &mut records[index],
                &person_id,
                &person_name,
                "auto",
                updated_at_ms,
            );
            update_embedding_index_person(&mut embedding_index, &current.face_id, Some(&person_id));
            assigned += 1;
            changed = true;
        } else {
            records[index].status = FaceStatus::Deferred;
            records[index].updated_at_ms = now_ms();
            clear_face_assignment(&mut records[index]);
            update_embedding_index_person(&mut embedding_index, &current.face_id, None);
            deferred += 1;
            changed = true;
        }
    }

    if changed {
        write_face_records(&store_path, &records)?;
    }

    Ok(FaceClusterPendingResponse {
        processed,
        assigned,
        created_persons,
        deferred,
        skipped,
        failed,
    })
}

pub(crate) fn merge_people(
    runtime_home_path: &Path,
    request: FaceMergePeopleRequest,
) -> Result<FaceMergePeopleResponse, RuntimeError> {
    let store_path = faces_path(runtime_home_path);
    let mut records = read_face_records(&store_path)?;
    let target_person_id = request.target_person_id.trim().to_owned();
    if target_person_id.is_empty() {
        return Err(RuntimeError::invalid_detected_face(
            "targetPersonId is required",
        ));
    }
    let source_person_ids =
        normalize_source_person_ids(&request.source_person_ids, &target_person_id);
    if source_person_ids.is_empty() {
        return Err(RuntimeError::invalid_detected_face(
            "sourcePersonIds must contain at least one non-target personId",
        ));
    }
    if !person_exists(&records, &target_person_id) {
        return Err(RuntimeError::runtime_capability(format!(
            "target person not found: {target_person_id}"
        )));
    }

    let target_person_name = person_name_for_id(&records, &target_person_id).unwrap_or_default();
    let updated_at_ms = now_ms();
    let mut merged = Vec::new();
    let mut skipped = Vec::new();

    for source_person_id in source_person_ids {
        if !person_exists(&records, &source_person_id) {
            skipped.push(source_person_id);
            continue;
        }

        for record in &mut records {
            if record.person_id.as_deref() == Some(source_person_id.as_str()) {
                record.person_id = Some(target_person_id.clone());
                record.person_name = Some(target_person_name.clone());
                record.assigned_by = Some("merge".to_owned());
                record.status = FaceStatus::Assigned;
                record.updated_at_ms = updated_at_ms;
            }
        }
        merged.push(source_person_id);
    }

    if !merged.is_empty() {
        write_face_records(&store_path, &records)?;
    }

    let merged_count = merged.len();
    Ok(FaceMergePeopleResponse {
        target_person_id,
        merged: merged_count,
        source_person_ids: merged,
        skipped_source_person_ids: skipped,
    })
}

pub(crate) fn mutate_faces(
    runtime_home_path: &Path,
    request: FaceMutateFacesRequest,
) -> Result<FaceMutateFacesResponse, RuntimeError> {
    let face_ids = normalize_face_ids(&request.face_ids)?;
    let root_path = root_path_key(&request.root_path);
    let store_path = faces_path(runtime_home_path);
    let mut records = read_face_records(&store_path)?;
    let mut items = Vec::new();
    let updated_at_ms = now_ms();
    let mut created_person_id = None;

    let target_person = request
        .target_person_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let target_person_name = target_person
        .as_deref()
        .and_then(|person_id| person_name_for_id(&records, person_id));

    if request.action == FaceMutationAction::AssignFaces && target_person.is_none() {
        return Err(RuntimeError::invalid_detected_face(
            "targetPersonId is required",
        ));
    }

    if request.action == FaceMutationAction::AssignFaces
        && !person_exists(&records, target_person.as_deref().unwrap_or_default())
    {
        let person_id = target_person.clone().unwrap_or_default();
        return Ok(summarize_face_mutation(
            request.action,
            face_ids
                .into_iter()
                .map(|face_id| {
                    face_mutation_failure(
                        &face_id,
                        None,
                        "PERSON_NOT_FOUND",
                        &format!("person not found: {person_id}"),
                    )
                })
                .collect(),
            target_person,
            None,
        ));
    }

    for face_id in face_ids {
        let Some(index) = find_root_scoped_face_index(&records, &root_path, &face_id) else {
            items.push(face_mutation_failure(
                &face_id,
                None,
                "FACE_NOT_FOUND",
                &format!("face not found: {face_id}"),
            ));
            continue;
        };

        let previous = records[index].clone();
        match request.action {
            FaceMutationAction::AssignFaces => {
                let target_person_id = target_person.as_deref().unwrap_or_default();
                if previous.status == FaceStatus::Ignored {
                    items.push(face_mutation_failure(
                        &face_id,
                        Some(&previous),
                        "FACE_STATE_CONFLICT",
                        "ignored face must be restored before assignment",
                    ));
                    continue;
                }
                if previous.person_id.as_deref() == Some(target_person_id) {
                    items.push(face_mutation_failure(
                        &face_id,
                        Some(&previous),
                        "FACE_ALREADY_ASSIGNED_TO_TARGET",
                        "face is already assigned to target person",
                    ));
                    continue;
                }

                assign_face_record(
                    &mut records[index],
                    target_person_id,
                    target_person_name.as_deref().unwrap_or_default(),
                    "manual",
                    updated_at_ms,
                );
                items.push(face_mutation_success(
                    &face_id,
                    &previous,
                    FaceStatus::Assigned,
                    Some(target_person_id.to_owned()),
                ));
            }
            FaceMutationAction::CreatePersonFromFaces => {
                if previous.status == FaceStatus::Ignored {
                    items.push(face_mutation_failure(
                        &face_id,
                        Some(&previous),
                        "FACE_STATE_CONFLICT",
                        "ignored face must be restored before assignment",
                    ));
                    continue;
                }
                let person_id = created_person_id
                    .get_or_insert_with(|| create_person_id(&records, updated_at_ms))
                    .clone();
                let person_name = request.name.as_deref().map(str::trim).unwrap_or_default();
                assign_face_record(
                    &mut records[index],
                    &person_id,
                    person_name,
                    "manual",
                    updated_at_ms,
                );
                items.push(face_mutation_success(
                    &face_id,
                    &previous,
                    FaceStatus::Assigned,
                    Some(person_id),
                ));
            }
            FaceMutationAction::UnassignFaces => {
                if previous.status == FaceStatus::Ignored {
                    items.push(face_mutation_failure(
                        &face_id,
                        Some(&previous),
                        "FACE_STATE_CONFLICT",
                        "ignored face cannot be manually unassigned",
                    ));
                    continue;
                }
                if previous.status == FaceStatus::ManualUnassigned && previous.person_id.is_none() {
                    items.push(face_mutation_failure(
                        &face_id,
                        Some(&previous),
                        "FACE_STATE_CONFLICT",
                        "face is already manual_unassigned",
                    ));
                    continue;
                }

                clear_face_assignment(&mut records[index]);
                records[index].status = FaceStatus::ManualUnassigned;
                records[index].updated_at_ms = updated_at_ms;
                items.push(face_mutation_success(
                    &face_id,
                    &previous,
                    FaceStatus::ManualUnassigned,
                    None,
                ));
            }
            FaceMutationAction::IgnoreFaces => {
                if previous.status == FaceStatus::Ignored {
                    items.push(face_mutation_failure(
                        &face_id,
                        Some(&previous),
                        "FACE_ALREADY_IGNORED",
                        "face is already ignored",
                    ));
                    continue;
                }

                clear_face_assignment(&mut records[index]);
                records[index].status = FaceStatus::Ignored;
                records[index].updated_at_ms = updated_at_ms;
                items.push(face_mutation_success(
                    &face_id,
                    &previous,
                    FaceStatus::Ignored,
                    None,
                ));
            }
            FaceMutationAction::RestoreIgnoredFaces => {
                if previous.status != FaceStatus::Ignored {
                    items.push(face_mutation_failure(
                        &face_id,
                        Some(&previous),
                        "FACE_STATE_CONFLICT",
                        "only ignored faces can be restored",
                    ));
                    continue;
                }

                clear_face_assignment(&mut records[index]);
                records[index].status = FaceStatus::ManualUnassigned;
                records[index].updated_at_ms = updated_at_ms;
                items.push(face_mutation_success(
                    &face_id,
                    &previous,
                    FaceStatus::ManualUnassigned,
                    None,
                ));
            }
            FaceMutationAction::RequeueFaces => {
                if previous.status != FaceStatus::ManualUnassigned {
                    items.push(face_mutation_failure(
                        &face_id,
                        Some(&previous),
                        "FACE_STATE_CONFLICT",
                        "only manual_unassigned faces can be requeued",
                    ));
                    continue;
                }

                clear_face_assignment(&mut records[index]);
                records[index].status = FaceStatus::Deferred;
                records[index].updated_at_ms = updated_at_ms;
                items.push(face_mutation_success(
                    &face_id,
                    &previous,
                    FaceStatus::Deferred,
                    None,
                ));
            }
        }
    }

    if items.iter().any(|item| item.ok) {
        write_face_records(&store_path, &records)?;
    }

    Ok(summarize_face_mutation(
        request.action,
        items,
        target_person,
        created_person_id,
    ))
}

fn faces_path(runtime_home_path: &Path) -> PathBuf {
    runtime_home_path
        .join(GLOBAL_CONFIG_FOLDER_NAME)
        .join(FACES_FILENAME)
}

fn read_face_records(path: &Path) -> Result<Vec<FaceRecordData>, RuntimeError> {
    Ok(read_face_store(path)?.faces)
}

fn read_face_store(path: &Path) -> Result<FaceStoreData, RuntimeError> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(FaceStoreData::default());
        }
        Err(error) => return Err(RuntimeError::read_file(path, error)),
    };
    let value = serde_json::from_str::<Value>(&raw)
        .map_err(|error| RuntimeError::invalid_runtime_home_file(path, &error.to_string()))?;
    let faces = value
        .get("faces")
        .and_then(Value::as_array)
        .ok_or_else(|| RuntimeError::invalid_runtime_home_file(path, "faces must be an array"))?;

    let asset_detections = match value.get("assetDetections") {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(face_asset_detection_data_from_value)
            .collect(),
        Some(_) => {
            return Err(RuntimeError::invalid_runtime_home_file(
                path,
                "assetDetections must be an array",
            ));
        }
        None => Vec::new(),
    };

    Ok(FaceStoreData {
        faces: faces
            .iter()
            .filter_map(face_record_data_from_value)
            .collect(),
        asset_detections,
    })
}

fn write_face_records(path: &Path, records: &[FaceRecordData]) -> Result<(), RuntimeError> {
    let mut store = read_face_store(path)?;
    store.faces = records.to_vec();
    write_face_store(path, &store)
}

fn write_face_store(path: &Path, store: &FaceStoreData) -> Result<(), RuntimeError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| RuntimeError::write_file(parent, source))?;
    }

    let faces = store
        .faces
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
    let asset_detections = store
        .asset_detections
        .iter()
        .map(|record| {
            serde_json::json!({
                "rootPath": record.root_path,
                "rootRelativePath": record.root_relative_path,
                "assetId": record.asset_id,
                "mediaType": face_media_type_json(record.media_type),
                "status": record.status,
                "faceCount": record.face_count,
                "updatedAt": record.updated_at_ms,
            })
        })
        .collect::<Vec<_>>();
    let raw = serde_json::to_string(&serde_json::json!({
        "version": 1,
        "faces": faces,
        "assetDetections": asset_detections,
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

fn face_asset_detection_data_from_value(value: &Value) -> Option<FaceAssetDetectionData> {
    let object = value.as_object()?;
    Some(FaceAssetDetectionData {
        root_path: string_value(object.get("rootPath")).filter(|value| !value.is_empty())?,
        root_relative_path: string_value(object.get("rootRelativePath"))
            .filter(|value| !value.is_empty())?,
        asset_id: string_value(object.get("assetId")).filter(|value| !value.is_empty())?,
        media_type: parse_face_media_type(object.get("mediaType").and_then(Value::as_str)),
        status: string_value(object.get("status"))
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "success".to_owned()),
        face_count: object.get("faceCount").and_then(Value::as_u64).unwrap_or(0) as usize,
        updated_at_ms: object.get("updatedAt").and_then(Value::as_u64).unwrap_or(0),
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

fn face_media_type_from_root_relative_path(
    root_relative_path: &RootRelativePath,
) -> Option<FaceMediaType> {
    let path = root_relative_path.to_string();
    let extension = path.rsplit_once('.')?.1.to_ascii_lowercase();
    if matches!(
        extension.as_str(),
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "ico"
    ) {
        return Some(FaceMediaType::Image);
    }
    if matches!(
        extension.as_str(),
        "avi"
            | "flv"
            | "m4v"
            | "mkv"
            | "mov"
            | "mp4"
            | "mpeg"
            | "mpg"
            | "ogg"
            | "ts"
            | "webm"
            | "wmv"
    ) {
        return Some(FaceMediaType::Video);
    }

    None
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

fn face_status_matches_review_bucket(status: FaceStatus, bucket: FaceReviewBucket) -> bool {
    match bucket {
        FaceReviewBucket::Unassigned => matches!(
            status,
            FaceStatus::ManualUnassigned | FaceStatus::Deferred | FaceStatus::Unassigned
        ),
        FaceReviewBucket::Ignored => status == FaceStatus::Ignored,
    }
}

fn face_review_status_order(status: FaceStatus) -> u8 {
    match status {
        FaceStatus::ManualUnassigned => 0,
        FaceStatus::Deferred => 1,
        FaceStatus::Unassigned => 2,
        FaceStatus::Ignored => 3,
        FaceStatus::Assigned => 4,
    }
}

fn face_record_display_path(display_root_path: &str, record: &FaceRecordData) -> String {
    if record.root_path == display_root_path {
        return record.root_relative_path.clone();
    }

    PathBuf::from(&record.root_path)
        .join(&record.root_relative_path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn cosine_distance(left: &[f64], right: &[f64]) -> f64 {
    let mut dot = 0.0;
    let mut left_norm = 0.0;
    let mut right_norm = 0.0;
    for (left, right) in left.iter().zip(right.iter()) {
        dot += left * right;
        left_norm += left * left;
        right_norm += right * right;
    }

    if left_norm > 0.0 && right_norm > 0.0 {
        1.0 - (dot / (left_norm.sqrt() * right_norm.sqrt())).clamp(-1.0, 1.0)
    } else {
        1.0
    }
}

fn choose_person_for_face(
    current_face_id: &str,
    current_embedding: &[f64],
    embedding_index: &[FaceEmbeddingIndexEntry],
    max_distance: f64,
) -> FaceClusterMatch {
    let mut matches = embedding_index
        .iter()
        .filter_map(|candidate| {
            let distance = cosine_distance(current_embedding, &candidate.embedding);
            (distance <= max_distance).then_some((candidate, distance))
        })
        .collect::<Vec<_>>();
    matches.sort_by(|(left, left_distance), (right, right_distance)| {
        left_distance
            .partial_cmp(right_distance)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.face_id.cmp(&right.face_id))
    });

    let matched_person_id = matches.iter().find_map(|(candidate, _)| {
        if candidate.face_id == current_face_id {
            return None;
        }
        candidate
            .person_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    });

    FaceClusterMatch {
        match_count: matches.len(),
        matched_person_id,
    }
}

fn update_embedding_index_person(
    embedding_index: &mut [FaceEmbeddingIndexEntry],
    face_id: &str,
    person_id: Option<&str>,
) {
    if let Some(item) = embedding_index
        .iter_mut()
        .find(|item| item.face_id == face_id)
    {
        item.person_id = person_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
    }
}

fn person_suggestion_is_better(candidate: &PersonSuggestion, existing: &PersonSuggestion) -> bool {
    candidate
        .distance
        .partial_cmp(&existing.distance)
        .unwrap_or(Ordering::Equal)
        .then_with(|| {
            candidate
                .supporting_face
                .face_id
                .cmp(&existing.supporting_face.face_id)
        })
        == Ordering::Less
}

fn normalize_face_ids(face_ids: &[String]) -> Result<Vec<String>, RuntimeError> {
    let mut normalized = Vec::new();
    for face_id in face_ids {
        let face_id = face_id.trim();
        if face_id.is_empty() || normalized.iter().any(|item| item == face_id) {
            continue;
        }
        normalized.push(face_id.to_owned());
    }

    if normalized.is_empty() {
        return Err(RuntimeError::invalid_detected_face(
            "faceIds must contain at least one faceId",
        ));
    }

    Ok(normalized)
}

fn normalize_source_person_ids(
    source_person_ids: &[String],
    target_person_id: &str,
) -> Vec<String> {
    let mut normalized = Vec::new();
    for person_id in source_person_ids {
        let person_id = person_id.trim();
        if person_id.is_empty()
            || person_id == target_person_id
            || normalized.iter().any(|item| item == person_id)
        {
            continue;
        }
        normalized.push(person_id.to_owned());
    }
    normalized
}

fn find_root_scoped_face_index(
    records: &[FaceRecordData],
    root_path: &str,
    face_id: &str,
) -> Option<usize> {
    records
        .iter()
        .position(|record| record.root_path == root_path && record.face_id == face_id)
}

fn person_exists(records: &[FaceRecordData], person_id: &str) -> bool {
    records
        .iter()
        .any(|record| record.person_id.as_deref() == Some(person_id))
}

fn person_name_for_id(records: &[FaceRecordData], person_id: &str) -> Option<String> {
    records
        .iter()
        .filter(|record| record.person_id.as_deref() == Some(person_id))
        .find_map(|record| {
            record
                .person_name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(ToOwned::to_owned)
        })
}

fn create_person_id(records: &[FaceRecordData], updated_at_ms: u64) -> String {
    let mut candidate = format!("person-{updated_at_ms}");
    let mut suffix = 1usize;
    while person_exists(records, &candidate) {
        suffix += 1;
        candidate = format!("person-{updated_at_ms}-{suffix}");
    }
    candidate
}

fn assign_face_record(
    record: &mut FaceRecordData,
    person_id: &str,
    person_name: &str,
    assigned_by: &str,
    updated_at_ms: u64,
) {
    record.person_id = Some(person_id.to_owned());
    record.person_name = Some(person_name.to_owned());
    record.assigned_by = Some(assigned_by.to_owned());
    record.status = FaceStatus::Assigned;
    record.updated_at_ms = updated_at_ms;
}

fn clear_face_assignment(record: &mut FaceRecordData) {
    record.person_id = None;
    record.person_name = None;
    record.assigned_by = None;
}

fn face_mutation_failure(
    face_id: &str,
    previous: Option<&FaceRecordData>,
    reason_code: &str,
    error: &str,
) -> FaceMutationItem {
    FaceMutationItem {
        face_id: face_id.to_owned(),
        ok: false,
        previous_status: previous.map(|record| record.status),
        previous_person_id: previous.and_then(|record| record.person_id.clone()),
        next_status: previous.map(|record| record.status),
        next_person_id: previous.and_then(|record| record.person_id.clone()),
        reason_code: Some(reason_code.to_owned()),
        error: Some(error.to_owned()),
    }
}

fn face_mutation_success(
    face_id: &str,
    previous: &FaceRecordData,
    next_status: FaceStatus,
    next_person_id: Option<String>,
) -> FaceMutationItem {
    FaceMutationItem {
        face_id: face_id.to_owned(),
        ok: true,
        previous_status: Some(previous.status),
        previous_person_id: previous.person_id.clone(),
        next_status: Some(next_status),
        next_person_id,
        reason_code: None,
        error: None,
    }
}

fn summarize_face_mutation(
    action: FaceMutationAction,
    items: Vec<FaceMutationItem>,
    target_person_id: Option<String>,
    person_id: Option<String>,
) -> FaceMutateFacesResponse {
    let succeeded = items.iter().filter(|item| item.ok).count();
    let failed = items.len().saturating_sub(succeeded);
    FaceMutateFacesResponse {
        action,
        total: items.len(),
        succeeded,
        failed,
        items,
        target_person_id,
        person_id,
    }
}

fn person_summary_matches_query(person: &PersonSummaryAccumulator, query: &str) -> bool {
    person.person_id.to_lowercase().contains(query) || person.name.to_lowercase().contains(query)
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
