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
pub struct FaceListAssetFacesRequest {
    pub root_path: PathBuf,
    pub root_relative_path: RootRelativePath,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaceListAssetFacesResponse {
    pub scope: FaceScope,
    pub total: usize,
    pub items: Vec<FaceRecord>,
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
}
