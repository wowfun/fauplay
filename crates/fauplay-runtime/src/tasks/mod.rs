//! Long-running runtime task coordination.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{
    FaceClusterPendingRequest, FaceClusterPendingResponse, FaceDetectAssetsItem,
    FaceDetectAssetsItemStatus, FaceDetectAssetsJobFailure, FaceDetectAssetsJobItemsResponse,
    FaceDetectAssetsJobSnapshot, FaceDetectAssetsJobStatus, FaceDetectAssetsRequest,
    FauplayRuntime, RootRelativePath, RuntimeError,
};

const FACE_SCAN_CLUSTER_LIMIT: usize = 2000;
const FACE_SCAN_CLUSTER_MIN_FACES: usize = 3;
const FACE_SCAN_BATCH_WEIGHT_BUDGET: usize = 50;
const FACE_SCAN_IMAGE_WEIGHT: usize = 1;
const FACE_SCAN_VIDEO_WEIGHT: usize = 10;
const FACE_SCAN_JOB_RECENT_ITEM_LIMIT: usize = 20;
const FACE_SCAN_JOB_FAILURE_SUMMARY_LIMIT: usize = 20;
const FACE_SCAN_JOB_ITEMS_MAX_LIMIT: usize = 500;
const FACE_SCAN_JOB_COMPLETED_RETAIN_LIMIT: usize = 20;

#[derive(Debug, Clone, Default)]
pub(crate) struct FaceScanJobs {
    inner: Arc<Mutex<FaceScanJobStore>>,
}

#[derive(Debug, Default)]
struct FaceScanJobStore {
    next_job_number: u64,
    active_job_id: Option<String>,
    queued_job_ids: VecDeque<String>,
    jobs: HashMap<String, FaceScanJobState>,
}

#[derive(Debug, Clone)]
struct FaceScanJobState {
    id: String,
    root_path: std::path::PathBuf,
    root_relative_paths: Vec<RootRelativePath>,
    only_undetected: bool,
    run_cluster: bool,
    pre_cluster_enabled: bool,
    status: FaceDetectAssetsJobStatus,
    total: usize,
    unique: usize,
    processed: usize,
    scanned: usize,
    skipped: usize,
    failed: usize,
    detected_faces: usize,
    current_path: Option<RootRelativePath>,
    batch_index: usize,
    batch_count: usize,
    pre_cluster: Option<FaceClusterPendingResponse>,
    post_cluster: Option<FaceClusterPendingResponse>,
    error: Option<String>,
    cancel_requested: bool,
    items: Vec<FaceDetectAssetsItem>,
    created_at_ms: u64,
    started_at_ms: Option<u64>,
    updated_at_ms: u64,
    finished_at_ms: Option<u64>,
}

impl FaceScanJobs {
    pub(crate) fn start_detect_assets_job(
        &self,
        runtime: FauplayRuntime,
        request: FaceDetectAssetsRequest,
    ) -> Result<FaceDetectAssetsJobSnapshot, RuntimeError> {
        if request.root_relative_paths.is_empty() {
            return Err(RuntimeError::invalid_detected_face(
                "relativePaths must contain at least one path",
            ));
        }

        let job = {
            let mut store = self.inner.lock().expect("face scan job store should lock");
            store.prune_completed_jobs();
            let now = now_ms();
            store.next_job_number += 1;
            let id = format!("face-scan-{}-{}", now, store.next_job_number);
            let job = FaceScanJobState::new(id, request, now);
            let snapshot = job.snapshot(true);
            store.queued_job_ids.push_back(job.id.clone());
            store.jobs.insert(job.id.clone(), job);
            snapshot
        };

        self.pump(runtime);
        Ok(job)
    }

    pub(crate) fn get_detect_assets_job(
        &self,
        job_id: &str,
    ) -> Result<FaceDetectAssetsJobSnapshot, RuntimeError> {
        let store = self.inner.lock().expect("face scan job store should lock");
        let job = store.job(job_id)?;
        Ok(job.snapshot(false))
    }

    pub(crate) fn cancel_detect_assets_job(
        &self,
        runtime: FauplayRuntime,
        job_id: &str,
    ) -> Result<FaceDetectAssetsJobSnapshot, RuntimeError> {
        let snapshot = {
            let mut store = self.inner.lock().expect("face scan job store should lock");
            let was_queued = {
                let job = store.job_mut(job_id)?;
                if job.is_terminal() {
                    return Ok(job.snapshot(false));
                }

                job.cancel_requested = true;
                let was_queued = job.status == FaceDetectAssetsJobStatus::Queued;
                if was_queued {
                    job.status = FaceDetectAssetsJobStatus::Canceled;
                    job.finished_at_ms = Some(now_ms());
                } else {
                    job.status = FaceDetectAssetsJobStatus::Canceling;
                }
                job.touch();
                was_queued
            };
            if was_queued {
                store.queued_job_ids.retain(|queued_id| queued_id != job_id);
            }
            store.job(job_id)?.snapshot(false)
        };

        self.pump(runtime);
        Ok(snapshot)
    }

    pub(crate) fn list_detect_assets_job_items(
        &self,
        job_id: &str,
        offset: usize,
        limit: usize,
    ) -> Result<FaceDetectAssetsJobItemsResponse, RuntimeError> {
        let store = self.inner.lock().expect("face scan job store should lock");
        let job = store.job(job_id)?;
        let offset = offset.min(job.items.len());
        let limit = limit.clamp(1, FACE_SCAN_JOB_ITEMS_MAX_LIMIT);
        Ok(FaceDetectAssetsJobItemsResponse {
            job_id: job.id.clone(),
            total: job.items.len(),
            offset,
            limit,
            items: job.items.iter().skip(offset).take(limit).cloned().collect(),
        })
    }

    fn pump(&self, runtime: FauplayRuntime) {
        let next_job_id = {
            let mut store = self.inner.lock().expect("face scan job store should lock");
            if store.active_job_id.is_some() {
                return;
            }

            let mut next_job_id = None;
            while let Some(job_id) = store.queued_job_ids.pop_front() {
                let Some(job) = store.jobs.get(&job_id) else {
                    continue;
                };
                if job.status == FaceDetectAssetsJobStatus::Queued {
                    store.active_job_id = Some(job_id.clone());
                    next_job_id = Some(job_id);
                    break;
                }
            }
            next_job_id
        };

        let Some(job_id) = next_job_id else {
            return;
        };

        let jobs = self.clone();
        thread::spawn(move || {
            jobs.run_job(runtime.clone(), &job_id);
            {
                let mut store = jobs.inner.lock().expect("face scan job store should lock");
                if store.active_job_id.as_deref() == Some(job_id.as_str()) {
                    store.active_job_id = None;
                }
                store.prune_completed_jobs();
            }
            jobs.pump(runtime);
        });
    }

    fn run_job(&self, runtime: FauplayRuntime, job_id: &str) {
        let Some(job_request) = self.start_running_job(job_id) else {
            return;
        };

        if self.finish_canceled_job_if_requested(job_id) {
            return;
        }

        if job_request.pre_cluster_enabled {
            match runtime.cluster_pending_faces(FaceClusterPendingRequest {
                root_path: job_request.root_path.clone(),
                asset_id: None,
                limit: FACE_SCAN_CLUSTER_LIMIT,
                max_distance: 0.5,
                min_faces: FACE_SCAN_CLUSTER_MIN_FACES,
            }) {
                Ok(response) => {
                    self.update_job(job_id, |job| {
                        job.pre_cluster = Some(response);
                        job.touch();
                    });
                }
                Err(error) => {
                    self.fail_job(job_id, error.to_string());
                    return;
                }
            }
        }

        if self.finish_canceled_job_if_requested(job_id) {
            return;
        }

        self.update_job(job_id, |job| {
            job.batch_index = usize::from(job.batch_count > 0);
            job.touch();
        });

        let response = runtime.detect_assets_faces(FaceDetectAssetsRequest {
            root_path: job_request.root_path.clone(),
            root_relative_paths: job_request.root_relative_paths.clone(),
            only_undetected: job_request.only_undetected,
            run_cluster: false,
            pre_cluster: false,
        });

        match response {
            Ok(response) => {
                self.update_job(job_id, |job| {
                    job.items = response.items;
                    job.processed = response.total;
                    job.scanned = response.scanned;
                    job.skipped = response.skipped;
                    job.failed = response.failed;
                    job.detected_faces = response.detected_faces;
                    job.current_path = None;
                    job.touch();
                });
            }
            Err(error) => {
                self.fail_job(job_id, error.to_string());
                return;
            }
        }

        if self.finish_canceled_job_if_requested(job_id) {
            return;
        }

        if job_request.run_cluster {
            let detected_faces = self
                .with_job(job_id, |job| job.detected_faces)
                .unwrap_or_default();
            if detected_faces > 0 {
                match runtime.cluster_pending_faces(FaceClusterPendingRequest {
                    root_path: job_request.root_path,
                    asset_id: None,
                    limit: detected_faces.max(1),
                    max_distance: 0.5,
                    min_faces: FACE_SCAN_CLUSTER_MIN_FACES,
                }) {
                    Ok(response) => {
                        self.update_job(job_id, |job| {
                            job.post_cluster = Some(response);
                            job.touch();
                        });
                    }
                    Err(error) => {
                        self.fail_job(job_id, error.to_string());
                        return;
                    }
                }
            }
        }

        self.update_job(job_id, |job| {
            job.status = FaceDetectAssetsJobStatus::Succeeded;
            job.finished_at_ms = Some(now_ms());
            job.touch();
        });
    }

    fn start_running_job(&self, job_id: &str) -> Option<FaceScanJobRunRequest> {
        let mut store = self.inner.lock().expect("face scan job store should lock");
        let job = store.jobs.get_mut(job_id)?;
        if job.cancel_requested {
            job.status = FaceDetectAssetsJobStatus::Canceled;
            job.finished_at_ms = Some(now_ms());
            job.touch();
            return None;
        }
        job.status = FaceDetectAssetsJobStatus::Running;
        job.started_at_ms = Some(now_ms());
        job.touch();
        Some(FaceScanJobRunRequest {
            root_path: job.root_path.clone(),
            root_relative_paths: job.root_relative_paths.clone(),
            only_undetected: job.only_undetected,
            run_cluster: job.run_cluster,
            pre_cluster_enabled: job.pre_cluster_enabled,
        })
    }

    fn finish_canceled_job_if_requested(&self, job_id: &str) -> bool {
        let mut store = self.inner.lock().expect("face scan job store should lock");
        let Some(job) = store.jobs.get_mut(job_id) else {
            return true;
        };
        if !job.cancel_requested {
            return false;
        }
        job.status = FaceDetectAssetsJobStatus::Canceled;
        job.current_path = None;
        job.finished_at_ms = Some(now_ms());
        job.touch();
        true
    }

    fn fail_job(&self, job_id: &str, error: String) {
        self.update_job(job_id, |job| {
            job.status = FaceDetectAssetsJobStatus::Failed;
            job.current_path = None;
            job.error = Some(error);
            job.finished_at_ms = Some(now_ms());
            job.touch();
        });
    }

    fn update_job(&self, job_id: &str, update: impl FnOnce(&mut FaceScanJobState)) {
        let mut store = self.inner.lock().expect("face scan job store should lock");
        if let Some(job) = store.jobs.get_mut(job_id) {
            update(job);
        }
    }

    fn with_job<T>(&self, job_id: &str, read: impl FnOnce(&FaceScanJobState) -> T) -> Option<T> {
        let store = self.inner.lock().expect("face scan job store should lock");
        store.jobs.get(job_id).map(read)
    }
}

#[derive(Debug, Clone)]
struct FaceScanJobRunRequest {
    root_path: std::path::PathBuf,
    root_relative_paths: Vec<RootRelativePath>,
    only_undetected: bool,
    run_cluster: bool,
    pre_cluster_enabled: bool,
}

impl FaceScanJobStore {
    fn job(&self, job_id: &str) -> Result<&FaceScanJobState, RuntimeError> {
        self.jobs
            .get(job_id.trim())
            .ok_or_else(|| RuntimeError::runtime_capability("Face scan job not found"))
    }

    fn job_mut(&mut self, job_id: &str) -> Result<&mut FaceScanJobState, RuntimeError> {
        self.jobs
            .get_mut(job_id.trim())
            .ok_or_else(|| RuntimeError::runtime_capability("Face scan job not found"))
    }

    fn prune_completed_jobs(&mut self) {
        let mut completed = self
            .jobs
            .values()
            .filter(|job| job.is_terminal())
            .map(|job| {
                (
                    job.id.clone(),
                    job.finished_at_ms.unwrap_or(job.updated_at_ms),
                )
            })
            .collect::<Vec<_>>();
        completed.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
        for (job_id, _) in completed
            .into_iter()
            .skip(FACE_SCAN_JOB_COMPLETED_RETAIN_LIMIT)
        {
            self.jobs.remove(&job_id);
        }
    }
}

impl FaceScanJobState {
    fn new(id: String, request: FaceDetectAssetsRequest, now: u64) -> Self {
        let batch_count = face_scan_weighted_batch_count(&request.root_relative_paths);
        let unique = request
            .root_relative_paths
            .iter()
            .map(ToString::to_string)
            .collect::<HashSet<_>>()
            .len();
        Self {
            id,
            root_path: request.root_path,
            total: request.root_relative_paths.len(),
            unique,
            root_relative_paths: request.root_relative_paths,
            only_undetected: request.only_undetected,
            run_cluster: request.run_cluster,
            pre_cluster_enabled: request.run_cluster && request.pre_cluster,
            status: FaceDetectAssetsJobStatus::Queued,
            processed: 0,
            scanned: 0,
            skipped: 0,
            failed: 0,
            detected_faces: 0,
            current_path: None,
            batch_index: 0,
            batch_count,
            pre_cluster: None,
            post_cluster: None,
            error: None,
            cancel_requested: false,
            items: Vec::new(),
            created_at_ms: now,
            started_at_ms: None,
            updated_at_ms: now,
            finished_at_ms: None,
        }
    }

    fn snapshot(&self, hide_recent_items: bool) -> FaceDetectAssetsJobSnapshot {
        let recent_items = if hide_recent_items {
            Vec::new()
        } else {
            self.items
                .iter()
                .skip(
                    self.items
                        .len()
                        .saturating_sub(FACE_SCAN_JOB_RECENT_ITEM_LIMIT),
                )
                .cloned()
                .collect()
        };
        FaceDetectAssetsJobSnapshot {
            ok: self.status != FaceDetectAssetsJobStatus::Failed,
            job_id: self.id.clone(),
            status: self.status,
            total: self.total,
            unique: self.unique,
            processed: self.processed,
            scanned: self.scanned,
            skipped: self.skipped,
            failed: self.failed,
            detected_faces: self.detected_faces,
            current_path: self.current_path.clone(),
            batch_index: self.batch_index,
            batch_count: self.batch_count,
            pre_cluster: self.pre_cluster.clone(),
            post_cluster: self.post_cluster.clone(),
            error: self.error.clone(),
            created_at_ms: self.created_at_ms,
            started_at_ms: self.started_at_ms,
            updated_at_ms: self.updated_at_ms,
            finished_at_ms: self.finished_at_ms,
            recent_items,
            failure_summary: self.failure_summary(),
        }
    }

    fn failure_summary(&self) -> Vec<FaceDetectAssetsJobFailure> {
        self.items
            .iter()
            .filter(|item| item.status == FaceDetectAssetsItemStatus::Failed || !item.ok)
            .skip(
                self.items
                    .iter()
                    .filter(|item| item.status == FaceDetectAssetsItemStatus::Failed || !item.ok)
                    .count()
                    .saturating_sub(FACE_SCAN_JOB_FAILURE_SUMMARY_LIMIT),
            )
            .map(|item| FaceDetectAssetsJobFailure {
                root_relative_path: item.root_relative_path.clone(),
                media_type: item.media_type,
                reason_code: item
                    .reason_code
                    .clone()
                    .unwrap_or_else(|| "DETECT_FAILED".to_owned()),
                error: item.error.clone(),
            })
            .collect()
    }

    fn is_terminal(&self) -> bool {
        matches!(
            self.status,
            FaceDetectAssetsJobStatus::Canceled
                | FaceDetectAssetsJobStatus::Succeeded
                | FaceDetectAssetsJobStatus::Failed
        )
    }

    fn touch(&mut self) {
        self.updated_at_ms = now_ms();
    }
}

fn face_scan_weighted_batch_count(paths: &[RootRelativePath]) -> usize {
    let mut batch_count = 0usize;
    let mut weight_used = 0usize;
    for path in paths {
        let item_weight = face_scan_item_weight(path).min(FACE_SCAN_BATCH_WEIGHT_BUDGET);
        if weight_used > 0 && weight_used + item_weight > FACE_SCAN_BATCH_WEIGHT_BUDGET {
            batch_count += 1;
            weight_used = 0;
        }
        weight_used += item_weight;
    }
    if weight_used > 0 {
        batch_count += 1;
    }
    batch_count
}

fn face_scan_item_weight(path: &RootRelativePath) -> usize {
    let path = path.to_string();
    let extension = path
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase());
    match extension.as_deref() {
        Some(
            "avi" | "flv" | "m4v" | "mkv" | "mov" | "mp4" | "mpeg" | "mpg" | "ogg" | "ts" | "webm"
            | "wmv",
        ) => FACE_SCAN_VIDEO_WEIGHT,
        _ => FACE_SCAN_IMAGE_WEIGHT,
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
