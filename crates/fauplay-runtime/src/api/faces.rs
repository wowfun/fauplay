use std::path::PathBuf;

use super::RootRelativePath;

#[derive(Debug, Clone, PartialEq)]
pub struct FaceDetectAssetRequest {
    pub root_path: PathBuf,
    pub root_relative_path: RootRelativePath,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceDetectAssetResponse {
    pub asset_id: String,
    pub asset_path: RootRelativePath,
    pub detected: usize,
    pub created: usize,
    pub updated: usize,
    pub skipped: usize,
    pub faces: Vec<FaceRecord>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceDetectAssetsRequest {
    pub root_path: PathBuf,
    pub root_relative_paths: Vec<RootRelativePath>,
    pub only_undetected: bool,
    pub run_cluster: bool,
    pub pre_cluster: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceDetectAssetsResponse {
    pub total: usize,
    pub unique: usize,
    pub scanned: usize,
    pub skipped: usize,
    pub failed: usize,
    pub detected_faces: usize,
    pub pre_cluster: Option<FaceClusterPendingResponse>,
    pub post_cluster: Option<FaceClusterPendingResponse>,
    pub items: Vec<FaceDetectAssetsItem>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceDetectAssetsItem {
    pub ok: bool,
    pub status: FaceDetectAssetsItemStatus,
    pub reason_code: Option<String>,
    pub root_relative_path: RootRelativePath,
    pub asset_id: Option<String>,
    pub media_type: Option<FaceMediaType>,
    pub face_count: Option<usize>,
    pub detected: Option<usize>,
    pub inference_detected: Option<usize>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaceDetectAssetsItemStatus {
    Detected,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceDetectAssetsJobSnapshot {
    pub ok: bool,
    pub job_id: String,
    pub status: FaceDetectAssetsJobStatus,
    pub total: usize,
    pub unique: usize,
    pub processed: usize,
    pub scanned: usize,
    pub skipped: usize,
    pub failed: usize,
    pub detected_faces: usize,
    pub current_path: Option<RootRelativePath>,
    pub batch_index: usize,
    pub batch_count: usize,
    pub pre_cluster: Option<FaceClusterPendingResponse>,
    pub post_cluster: Option<FaceClusterPendingResponse>,
    pub error: Option<String>,
    pub created_at_ms: u64,
    pub started_at_ms: Option<u64>,
    pub updated_at_ms: u64,
    pub finished_at_ms: Option<u64>,
    pub recent_items: Vec<FaceDetectAssetsItem>,
    pub failure_summary: Vec<FaceDetectAssetsJobFailure>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceDetectAssetsJobItemsResponse {
    pub job_id: String,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
    pub items: Vec<FaceDetectAssetsItem>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceDetectAssetsJobFailure {
    pub root_relative_path: RootRelativePath,
    pub media_type: Option<FaceMediaType>,
    pub reason_code: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaceDetectAssetsJobStatus {
    Queued,
    Running,
    Canceling,
    Canceled,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceListAssetFacesRequest {
    pub root_path: PathBuf,
    pub root_relative_path: Option<RootRelativePath>,
    pub person_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceListAssetFacesResponse {
    pub scope: FaceScope,
    pub total: usize,
    pub items: Vec<FaceRecord>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceListReviewFacesRequest {
    pub root_path: PathBuf,
    pub bucket: FaceReviewBucket,
    pub page: usize,
    pub size: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceListReviewFacesResponse {
    pub scope: FaceScope,
    pub bucket: FaceReviewBucket,
    pub page: usize,
    pub size: usize,
    pub total: usize,
    pub items: Vec<FaceRecord>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceListPeopleRequest {
    pub root_path: PathBuf,
    pub scope: FaceScope,
    pub query: Option<String>,
    pub page: usize,
    pub size: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceListPeopleResponse {
    pub scope: FaceScope,
    pub page: usize,
    pub size: usize,
    pub total: usize,
    pub items: Vec<PersonSummary>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PersonSummary {
    pub person_id: String,
    pub name: String,
    pub face_count: usize,
    pub global_face_count: usize,
    pub feature_face_id: Option<String>,
    pub feature_asset_path: Option<String>,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceRenamePersonRequest {
    pub root_path: PathBuf,
    pub person_id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceRenamePersonResponse {
    pub person: PersonSummary,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceSuggestPeopleRequest {
    pub root_path: PathBuf,
    pub face_id: String,
    pub candidate_size: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceSuggestPeopleResponse {
    pub face_id: String,
    pub items: Vec<PersonSuggestion>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceClusterPendingRequest {
    pub root_path: PathBuf,
    pub asset_id: Option<String>,
    pub limit: usize,
    pub max_distance: f64,
    pub min_faces: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceClusterPendingResponse {
    pub processed: usize,
    pub assigned: usize,
    pub created_persons: usize,
    pub deferred: usize,
    pub skipped: usize,
    pub failed: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PersonSuggestion {
    pub person_id: String,
    pub name: String,
    pub score: f64,
    pub distance: f64,
    pub supporting_face: PersonSuggestionFace,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PersonSuggestionFace {
    pub face_id: String,
    pub asset_id: String,
    pub asset_path: Option<String>,
    pub media_type: FaceMediaType,
    pub frame_ts_ms: Option<u64>,
    pub bounding_box: FaceBoundingBox,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceMergePeopleRequest {
    pub root_path: PathBuf,
    pub target_person_id: String,
    pub source_person_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceMergePeopleResponse {
    pub target_person_id: String,
    pub merged: usize,
    pub source_person_ids: Vec<String>,
    pub skipped_source_person_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceMutateFacesRequest {
    pub root_path: PathBuf,
    pub action: FaceMutationAction,
    pub face_ids: Vec<String>,
    pub target_person_id: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceMutateFacesResponse {
    pub action: FaceMutationAction,
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub items: Vec<FaceMutationItem>,
    pub target_person_id: Option<String>,
    pub person_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceMutationItem {
    pub face_id: String,
    pub ok: bool,
    pub previous_status: Option<FaceStatus>,
    pub previous_person_id: Option<String>,
    pub next_status: Option<FaceStatus>,
    pub next_person_id: Option<String>,
    pub reason_code: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceRecord {
    pub face_id: String,
    pub asset_id: String,
    pub asset_path: Option<RootRelativePath>,
    pub bounding_box: FaceBoundingBox,
    pub score: f64,
    pub status: FaceStatus,
    pub media_type: FaceMediaType,
    pub frame_ts_ms: Option<u64>,
    pub person_id: Option<String>,
    pub person_name: Option<String>,
    pub assigned_by: Option<String>,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceBoundingBox {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaceMediaType {
    Image,
    Video,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaceStatus {
    Assigned,
    Unassigned,
    Deferred,
    ManualUnassigned,
    Ignored,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaceScope {
    Root,
    Global,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaceReviewBucket {
    Unassigned,
    Ignored,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaceMutationAction {
    AssignFaces,
    CreatePersonFromFaces,
    UnassignFaces,
    IgnoreFaces,
    RestoreIgnoredFaces,
    RequeueFaces,
}
