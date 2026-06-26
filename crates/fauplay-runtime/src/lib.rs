mod api;
mod fs;
mod mcp;
mod media;
mod server;
mod store;
mod tasks;

pub use api::{
    AnnotationTag, AnnotationTagOption, AnnotationTagOptionsRequest, AnnotationTagOptionsResponse,
    DirectoryEntry, DirectoryEntryKind, DuplicateFile, DuplicateFilesRequest,
    DuplicateFilesResponse, DuplicateSeedSkip, DuplicateSeedSkipReason, DuplicateSet,
    FaceBoundingBox, FaceClusterPendingRequest, FaceClusterPendingResponse, FaceCropRequest,
    FaceCropResponse, FaceDetectAssetRequest, FaceDetectAssetResponse, FaceDetectAssetsItem,
    FaceDetectAssetsItemStatus, FaceDetectAssetsJobFailure, FaceDetectAssetsJobItemsResponse,
    FaceDetectAssetsJobSnapshot, FaceDetectAssetsJobStatus, FaceDetectAssetsRequest,
    FaceDetectAssetsResponse, FaceListAssetFacesRequest, FaceListAssetFacesResponse,
    FaceListPeopleRequest, FaceListPeopleResponse, FaceListReviewFacesRequest,
    FaceListReviewFacesResponse, FaceMediaType, FaceMergePeopleRequest, FaceMergePeopleResponse,
    FaceMutateFacesRequest, FaceMutateFacesResponse, FaceMutationAction, FaceMutationItem,
    FaceRecord, FaceRenamePersonRequest, FaceRenamePersonResponse, FaceReviewBucket, FaceScope,
    FaceStatus, FaceSuggestPeopleRequest, FaceSuggestPeopleResponse, FileAnnotationActionSource,
    FileAnnotationFile, FileAnnotationMatchMode, FileAnnotationMissingCleanupImpact,
    FileAnnotationMissingCleanupRequest, FileAnnotationMissingCleanupResponse,
    FileAnnotationMutationResponse, FileAnnotationPathMapping,
    FileAnnotationPathRebindFailureReason, FileAnnotationPathRebindItem,
    FileAnnotationPathRebindRequest, FileAnnotationPathRebindResponse, FileAnnotationQueryRequest,
    FileAnnotationQueryResponse, FileAnnotationReadRequest, FileAnnotationReadResponse,
    FileAnnotationSetValueRequest, FileAnnotationTagBindingRequest,
    FileAnnotationTagMutationResponse, FileContentRange, FileContentRangeRequest,
    FileContentRequest, FileContentResponse, FileIndexEnsureItem, FileIndexEnsureRequest,
    FileIndexEnsureResponse, FileIndexFailureReason, FileMetadataRequest, FileMetadataResponse,
    GlobalShortcutConfigResponse, GlobalTrashEntry, GlobalTrashFailureReason,
    GlobalTrashFileContentRequest, GlobalTrashFileMetadataRequest, GlobalTrashFileMetadataResponse,
    GlobalTrashListRequest, GlobalTrashListResponse, GlobalTrashMoveItem, GlobalTrashMoveRequest,
    GlobalTrashMoveResponse, GlobalTrashRestoreItem, GlobalTrashRestoreRequest,
    GlobalTrashRestoreResponse, GlobalTrashTextPreviewRequest, ListDirectoryRequest,
    ListDirectoryResponse, ListingEntryFilter, ListingOrder, ListingQuery, ListingSortDirection,
    ListingSortKey, LocalRootBinding, LocalRootBindingUpsertRequest, LocalRootBindingsResponse,
    MissingFileCleanupImpact, MissingFileCleanupRequest, MissingFileCleanupResponse,
    PersonSuggestion, PersonSuggestionFace, PersonSummary, RememberedDeviceAdminEntry,
    RememberedDeviceCreateRequest, RememberedDeviceCredential, RememberedDeviceRevokeRequest,
    RememberedDeviceRevokeResponse, RememberedDeviceRotateRequest, RememberedDevicesAdminResponse,
    RemoteAccessConfigResponse, RemoteAccessConfigSource, RemoteAccessRoot,
    RemoteAccessTokenVerifyRequest, RemotePublishedRoot, RemotePublishedRootSyncEntry,
    RemotePublishedRootSyncRequest, RemotePublishedRootSyncResponse, RemotePublishedRootsResponse,
    RemoteSharedFavorite, RemoteSharedFavoriteRemoveRequest, RemoteSharedFavoriteRemoveResponse,
    RemoteSharedFavoriteUpsertRequest, RemoteSharedFavoritesResponse, RootMoveBatchFailureReason,
    RootMoveBatchItem, RootMoveBatchRequest, RootMoveBatchResponse, RootMoveFailureReason,
    RootMoveRequest, RootMoveResponse, RootMoveRule, RootMoveSearchMode, RootRelativePath,
    RootTrashEntry, RootTrashFailureReason, RootTrashListRequest, RootTrashListResponse,
    RootTrashMutationItem, RootTrashMutationResponse, RootTrashRequest, RuntimeError,
    TextPreviewRequest, TextPreviewResponse, TextPreviewStatus,
};
pub use server::{serve_http, serve_one_http_request};
use std::collections::HashSet;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct FauplayRuntime {
    runtime_home_path: PathBuf,
    mcp_runtime: mcp::McpRuntime,
    face_scan_jobs: tasks::FaceScanJobs,
}

impl FauplayRuntime {
    pub fn new() -> Self {
        Self::with_runtime_home_path(store::resolve_default_runtime_home_path())
    }

    pub fn with_runtime_home_path(runtime_home_path: impl Into<PathBuf>) -> Self {
        let runtime_home_path = runtime_home_path.into();
        Self::with_runtime_home_path_and_mcp_config_path(
            runtime_home_path,
            mcp::resolve_default_mcp_config_path(),
        )
    }

    pub fn with_runtime_home_path_and_mcp_config_path(
        runtime_home_path: impl Into<PathBuf>,
        mcp_config_path: impl Into<PathBuf>,
    ) -> Self {
        let runtime_home_path = runtime_home_path.into();
        Self {
            mcp_runtime: mcp::McpRuntime::new(runtime_home_path.clone(), mcp_config_path.into()),
            face_scan_jobs: tasks::FaceScanJobs::default(),
            runtime_home_path,
        }
    }

    pub fn runtime_home_path(&self) -> &std::path::Path {
        &self.runtime_home_path
    }

    pub(crate) fn handle_mcp_request(
        &self,
        session_id: Option<&str>,
        payload: serde_json::Value,
    ) -> mcp::McpHttpResponse {
        self.mcp_runtime.handle_request(session_id, payload)
    }

    pub fn detect_asset_faces(
        &self,
        request: FaceDetectAssetRequest,
    ) -> Result<FaceDetectAssetResponse, RuntimeError> {
        let root_path = request.root_path.clone();
        let root_relative_path = request.root_relative_path.clone();
        let inference = self.mcp_runtime.call_tool(
            "vision.face",
            serde_json::json!({
                "rootPath": root_path.display().to_string(),
                "operation": "detectAsset",
                "relativePath": root_relative_path.to_string(),
            }),
        )?;
        store::save_detected_faces(&self.runtime_home_path, request, inference)
    }

    pub fn detect_assets_faces(
        &self,
        request: FaceDetectAssetsRequest,
    ) -> Result<FaceDetectAssetsResponse, RuntimeError> {
        if request.root_relative_paths.is_empty() {
            return Err(RuntimeError::invalid_detected_face(
                "relativePaths must contain at least one path",
            ));
        }

        let pre_cluster = if request.run_cluster && request.pre_cluster {
            Some(self.cluster_pending_faces(FaceClusterPendingRequest {
                root_path: request.root_path.clone(),
                asset_id: None,
                limit: 2000,
                max_distance: 0.5,
                min_faces: 3,
            })?)
        } else {
            None
        };

        let total = request.root_relative_paths.len();
        let mut seen_paths = HashSet::<String>::new();
        let mut scanned = 0usize;
        let mut skipped = 0usize;
        let mut failed = 0usize;
        let mut detected_faces = 0usize;
        let mut items = Vec::new();

        for root_relative_path in request.root_relative_paths {
            let path_key = root_relative_path.to_string();
            if !seen_paths.insert(path_key) {
                skipped += 1;
                items.push(face_detect_assets_skipped_item(
                    root_relative_path,
                    "DUPLICATE_PATH",
                    None,
                    None,
                    None,
                ));
                continue;
            }

            let media_type = match face_scan_media_type(&root_relative_path) {
                Some(media_type) => media_type,
                None => {
                    skipped += 1;
                    items.push(face_detect_assets_skipped_item(
                        root_relative_path,
                        "UNSUPPORTED_MEDIA",
                        None,
                        None,
                        None,
                    ));
                    continue;
                }
            };

            if request.only_undetected {
                if let Some(existing) = store::get_asset_face_detection(
                    &self.runtime_home_path,
                    &request.root_path,
                    &root_relative_path,
                )? {
                    skipped += 1;
                    items.push(face_detect_assets_skipped_item(
                        root_relative_path,
                        "ALREADY_DETECTED",
                        Some(existing.asset_id),
                        Some(existing.media_type),
                        Some(existing.face_count),
                    ));
                    continue;
                }
            }

            match self.detect_asset_faces(FaceDetectAssetRequest {
                root_path: request.root_path.clone(),
                root_relative_path: root_relative_path.clone(),
            }) {
                Ok(response) => {
                    scanned += 1;
                    detected_faces += response.created;
                    items.push(FaceDetectAssetsItem {
                        ok: true,
                        status: FaceDetectAssetsItemStatus::Detected,
                        reason_code: None,
                        root_relative_path,
                        asset_id: Some(response.asset_id),
                        media_type: Some(media_type),
                        face_count: None,
                        detected: Some(response.created),
                        inference_detected: Some(response.detected),
                        error: None,
                    });
                }
                Err(error) => {
                    failed += 1;
                    items.push(FaceDetectAssetsItem {
                        ok: false,
                        status: FaceDetectAssetsItemStatus::Failed,
                        reason_code: Some("DETECT_FAILED".to_owned()),
                        root_relative_path,
                        asset_id: None,
                        media_type: Some(media_type),
                        face_count: None,
                        detected: None,
                        inference_detected: None,
                        error: Some(error.to_string()),
                    });
                }
            }
        }

        let post_cluster = if request.run_cluster && detected_faces > 0 {
            Some(self.cluster_pending_faces(FaceClusterPendingRequest {
                root_path: request.root_path,
                asset_id: None,
                limit: detected_faces.max(1),
                max_distance: 0.5,
                min_faces: 3,
            })?)
        } else {
            None
        };

        Ok(FaceDetectAssetsResponse {
            total,
            unique: seen_paths.len(),
            scanned,
            skipped,
            failed,
            detected_faces,
            pre_cluster,
            post_cluster,
            items,
        })
    }

    pub fn start_detect_assets_job(
        &self,
        request: FaceDetectAssetsRequest,
    ) -> Result<FaceDetectAssetsJobSnapshot, RuntimeError> {
        self.face_scan_jobs
            .start_detect_assets_job(self.clone(), request)
    }

    pub fn read_face_crop(
        &self,
        request: FaceCropRequest,
    ) -> Result<FaceCropResponse, RuntimeError> {
        let source = store::resolve_face_crop_source(&self.runtime_home_path, &request)?;
        media::read_face_crop(source, request.size, request.padding)
    }

    pub fn get_detect_assets_job(
        &self,
        job_id: &str,
    ) -> Result<FaceDetectAssetsJobSnapshot, RuntimeError> {
        self.face_scan_jobs.get_detect_assets_job(job_id)
    }

    pub fn cancel_detect_assets_job(
        &self,
        job_id: &str,
    ) -> Result<FaceDetectAssetsJobSnapshot, RuntimeError> {
        self.face_scan_jobs
            .cancel_detect_assets_job(self.clone(), job_id)
    }

    pub fn list_detect_assets_job_items(
        &self,
        job_id: &str,
        offset: usize,
        limit: usize,
    ) -> Result<FaceDetectAssetsJobItemsResponse, RuntimeError> {
        self.face_scan_jobs
            .list_detect_assets_job_items(job_id, offset, limit)
    }

    pub fn list_asset_faces(
        &self,
        request: FaceListAssetFacesRequest,
    ) -> Result<FaceListAssetFacesResponse, RuntimeError> {
        store::list_asset_faces(&self.runtime_home_path, request)
    }

    pub fn list_review_faces(
        &self,
        request: FaceListReviewFacesRequest,
    ) -> Result<FaceListReviewFacesResponse, RuntimeError> {
        store::list_review_faces(&self.runtime_home_path, request)
    }

    pub fn list_people(
        &self,
        request: FaceListPeopleRequest,
    ) -> Result<FaceListPeopleResponse, RuntimeError> {
        store::list_people(&self.runtime_home_path, request)
    }

    pub fn rename_person(
        &self,
        request: FaceRenamePersonRequest,
    ) -> Result<FaceRenamePersonResponse, RuntimeError> {
        store::rename_person(&self.runtime_home_path, request)
    }

    pub fn suggest_people(
        &self,
        request: FaceSuggestPeopleRequest,
    ) -> Result<FaceSuggestPeopleResponse, RuntimeError> {
        store::suggest_people(&self.runtime_home_path, request)
    }

    pub fn cluster_pending_faces(
        &self,
        request: FaceClusterPendingRequest,
    ) -> Result<FaceClusterPendingResponse, RuntimeError> {
        store::cluster_pending_faces(&self.runtime_home_path, request)
    }

    pub fn merge_people(
        &self,
        request: FaceMergePeopleRequest,
    ) -> Result<FaceMergePeopleResponse, RuntimeError> {
        store::merge_people(&self.runtime_home_path, request)
    }

    pub fn mutate_faces(
        &self,
        request: FaceMutateFacesRequest,
    ) -> Result<FaceMutateFacesResponse, RuntimeError> {
        store::mutate_faces(&self.runtime_home_path, request)
    }

    pub fn load_global_shortcut_config(
        &self,
    ) -> Result<GlobalShortcutConfigResponse, RuntimeError> {
        store::load_global_shortcut_config(&self.runtime_home_path)
    }

    pub fn list_local_root_bindings(&self) -> Result<LocalRootBindingsResponse, RuntimeError> {
        store::list_local_root_bindings(&self.runtime_home_path)
    }

    pub fn upsert_local_root_binding(
        &self,
        request: LocalRootBindingUpsertRequest,
    ) -> Result<LocalRootBinding, RuntimeError> {
        store::upsert_local_root_binding(&self.runtime_home_path, request)
    }

    pub fn list_remembered_devices(&self) -> Result<RememberedDevicesAdminResponse, RuntimeError> {
        store::list_remembered_devices(&self.runtime_home_path)
    }

    pub fn create_remembered_device(
        &self,
        request: RememberedDeviceCreateRequest,
    ) -> Result<RememberedDeviceCredential, RuntimeError> {
        store::create_remembered_device(&self.runtime_home_path, request)
    }

    pub fn rotate_remembered_device(
        &self,
        request: RememberedDeviceRotateRequest,
    ) -> Result<Option<RememberedDeviceCredential>, RuntimeError> {
        store::rotate_remembered_device(&self.runtime_home_path, request)
    }

    pub fn revoke_remembered_device_credential(
        &self,
        request: RememberedDeviceRevokeRequest,
    ) -> Result<RememberedDeviceRevokeResponse, RuntimeError> {
        store::revoke_remembered_device_credential(&self.runtime_home_path, request)
    }

    pub fn rename_remembered_device(
        &self,
        device_id: String,
        label: String,
    ) -> Result<bool, RuntimeError> {
        store::rename_remembered_device(&self.runtime_home_path, &device_id, &label)
    }

    pub fn revoke_remembered_device(&self, device_id: String) -> Result<bool, RuntimeError> {
        store::revoke_remembered_device(&self.runtime_home_path, &device_id)
    }

    pub fn revoke_all_remembered_devices(&self) -> Result<(), RuntimeError> {
        store::revoke_all_remembered_devices(&self.runtime_home_path)
    }

    pub fn load_remote_access_config(&self) -> Result<RemoteAccessConfigResponse, RuntimeError> {
        store::load_remote_access_config(&self.runtime_home_path)
    }

    pub fn verify_remote_access_token(
        &self,
        request: RemoteAccessTokenVerifyRequest,
    ) -> Result<bool, RuntimeError> {
        store::verify_remote_access_token(&self.runtime_home_path, request)
    }

    pub fn sync_remote_published_roots(
        &self,
        request: RemotePublishedRootSyncRequest,
    ) -> Result<RemotePublishedRootSyncResponse, RuntimeError> {
        store::sync_remote_published_roots(&self.runtime_home_path, request)
    }

    pub fn list_resolved_remote_published_roots(
        &self,
    ) -> Result<RemotePublishedRootsResponse, RuntimeError> {
        store::list_resolved_remote_published_roots(&self.runtime_home_path)
    }

    pub fn list_remote_shared_favorites(
        &self,
    ) -> Result<RemoteSharedFavoritesResponse, RuntimeError> {
        store::list_remote_shared_favorites(&self.runtime_home_path)
    }

    pub fn upsert_remote_shared_favorite(
        &self,
        request: RemoteSharedFavoriteUpsertRequest,
    ) -> Result<RemoteSharedFavorite, RuntimeError> {
        store::upsert_remote_shared_favorite(&self.runtime_home_path, request)
    }

    pub fn remove_remote_shared_favorite(
        &self,
        request: RemoteSharedFavoriteRemoveRequest,
    ) -> Result<RemoteSharedFavoriteRemoveResponse, RuntimeError> {
        store::remove_remote_shared_favorite(&self.runtime_home_path, request)
    }

    pub fn list_global_trash(
        &self,
        request: GlobalTrashListRequest,
    ) -> Result<GlobalTrashListResponse, RuntimeError> {
        store::list_global_trash(&self.runtime_home_path, request)
    }

    pub fn move_to_global_trash(
        &self,
        request: GlobalTrashMoveRequest,
    ) -> Result<GlobalTrashMoveResponse, RuntimeError> {
        store::move_to_global_trash(&self.runtime_home_path, request)
    }

    pub fn restore_global_trash(
        &self,
        request: GlobalTrashRestoreRequest,
    ) -> Result<GlobalTrashRestoreResponse, RuntimeError> {
        store::restore_global_trash(&self.runtime_home_path, request)
    }

    pub fn list_local_directory(
        &self,
        request: ListDirectoryRequest,
    ) -> Result<ListDirectoryResponse, RuntimeError> {
        fs::list_local_directory(request)
    }

    pub fn read_text_preview(
        &self,
        request: TextPreviewRequest,
    ) -> Result<TextPreviewResponse, RuntimeError> {
        media::read_text_preview(request)
    }

    pub fn read_absolute_text_preview(
        &self,
        file_path: PathBuf,
        size_limit_bytes: u64,
    ) -> Result<TextPreviewResponse, RuntimeError> {
        media::read_text_preview_at_path(file_path, size_limit_bytes)
    }

    pub fn read_file_content(
        &self,
        request: FileContentRequest,
    ) -> Result<FileContentResponse, RuntimeError> {
        media::read_file_content(request)
    }

    pub fn read_absolute_file_content(
        &self,
        file_path: PathBuf,
        range: Option<FileContentRangeRequest>,
    ) -> Result<FileContentResponse, RuntimeError> {
        media::read_file_content_at_path(file_path, range)
    }

    pub fn read_global_trash_file_content(
        &self,
        request: GlobalTrashFileContentRequest,
    ) -> Result<Option<FileContentResponse>, RuntimeError> {
        let Some(file_path) =
            store::global_trash_file_path(&self.runtime_home_path, &request.recycle_id)?
        else {
            return Ok(None);
        };

        media::read_file_content_at_path(file_path, request.range).map(Some)
    }

    pub fn read_global_trash_text_preview(
        &self,
        request: GlobalTrashTextPreviewRequest,
    ) -> Result<Option<TextPreviewResponse>, RuntimeError> {
        let Some(file_path) =
            store::global_trash_file_path(&self.runtime_home_path, &request.recycle_id)?
        else {
            return Ok(None);
        };

        media::read_text_preview_at_path(file_path, request.size_limit_bytes).map(Some)
    }

    pub fn read_global_trash_file_metadata(
        &self,
        request: GlobalTrashFileMetadataRequest,
    ) -> Result<Option<GlobalTrashFileMetadataResponse>, RuntimeError> {
        let recycle_id = request.recycle_id.trim().to_owned();
        let Some(file_path) = store::global_trash_file_path(&self.runtime_home_path, &recycle_id)?
        else {
            return Ok(None);
        };
        let metadata = fs::read_file_metadata_at_path(&file_path)?;

        Ok(Some(GlobalTrashFileMetadataResponse {
            recycle_id,
            size: metadata.size,
            last_modified_ms: metadata.last_modified_ms,
        }))
    }

    pub fn read_file_metadata(
        &self,
        request: FileMetadataRequest,
    ) -> Result<FileMetadataResponse, RuntimeError> {
        fs::read_file_metadata(request)
    }

    pub fn ensure_file_index_entries(
        &self,
        request: FileIndexEnsureRequest,
    ) -> Result<FileIndexEnsureResponse, RuntimeError> {
        store::ensure_file_index_entries(&self.runtime_home_path, request)
    }

    pub fn set_file_annotation_value(
        &self,
        request: FileAnnotationSetValueRequest,
    ) -> Result<FileAnnotationMutationResponse, RuntimeError> {
        store::set_file_annotation_value(&self.runtime_home_path, request)
    }

    pub fn bind_file_annotation_tag(
        &self,
        request: FileAnnotationTagBindingRequest,
    ) -> Result<FileAnnotationTagMutationResponse, RuntimeError> {
        store::bind_file_annotation_tag(&self.runtime_home_path, request)
    }

    pub fn unbind_file_annotation_tag(
        &self,
        request: FileAnnotationTagBindingRequest,
    ) -> Result<FileAnnotationTagMutationResponse, RuntimeError> {
        store::unbind_file_annotation_tag(&self.runtime_home_path, request)
    }

    pub fn read_file_annotation(
        &self,
        request: FileAnnotationReadRequest,
    ) -> Result<FileAnnotationReadResponse, RuntimeError> {
        store::read_file_annotation(&self.runtime_home_path, request)
    }

    pub fn list_annotation_tag_options(
        &self,
        request: AnnotationTagOptionsRequest,
    ) -> Result<AnnotationTagOptionsResponse, RuntimeError> {
        store::list_annotation_tag_options(&self.runtime_home_path, request)
    }

    pub fn query_file_annotations(
        &self,
        request: FileAnnotationQueryRequest,
    ) -> Result<FileAnnotationQueryResponse, RuntimeError> {
        store::query_file_annotations(&self.runtime_home_path, request)
    }

    pub fn rebind_file_annotation_paths(
        &self,
        request: FileAnnotationPathRebindRequest,
    ) -> Result<FileAnnotationPathRebindResponse, RuntimeError> {
        store::rebind_file_annotation_paths(&self.runtime_home_path, request)
    }

    pub fn cleanup_missing_file_annotations(
        &self,
        request: FileAnnotationMissingCleanupRequest,
    ) -> Result<FileAnnotationMissingCleanupResponse, RuntimeError> {
        self.cleanup_missing_files(request)
    }

    pub fn cleanup_missing_files(
        &self,
        request: MissingFileCleanupRequest,
    ) -> Result<MissingFileCleanupResponse, RuntimeError> {
        store::cleanup_missing_files(&self.runtime_home_path, request)
    }

    pub fn find_duplicate_files(
        &self,
        request: DuplicateFilesRequest,
    ) -> Result<DuplicateFilesResponse, RuntimeError> {
        fs::find_duplicate_files(request)
    }

    pub fn move_root_path(
        &self,
        request: RootMoveRequest,
    ) -> Result<RootMoveResponse, RuntimeError> {
        fs::move_root_path(request)
    }

    pub fn move_root_path_batch(
        &self,
        request: RootMoveBatchRequest,
    ) -> Result<RootMoveBatchResponse, RuntimeError> {
        fs::move_root_path_batch(request)
    }

    pub fn move_to_root_trash(
        &self,
        request: RootTrashRequest,
    ) -> Result<RootTrashMutationResponse, RuntimeError> {
        fs::move_to_root_trash(request)
    }

    pub fn restore_from_root_trash(
        &self,
        request: RootTrashRequest,
    ) -> Result<RootTrashMutationResponse, RuntimeError> {
        fs::restore_from_root_trash(request)
    }

    pub fn list_root_trash(
        &self,
        request: RootTrashListRequest,
    ) -> Result<RootTrashListResponse, RuntimeError> {
        fs::list_root_trash(request)
    }
}

impl Default for FauplayRuntime {
    fn default() -> Self {
        Self::new()
    }
}

fn face_detect_assets_skipped_item(
    root_relative_path: RootRelativePath,
    reason_code: &str,
    asset_id: Option<String>,
    media_type: Option<FaceMediaType>,
    face_count: Option<usize>,
) -> FaceDetectAssetsItem {
    FaceDetectAssetsItem {
        ok: true,
        status: FaceDetectAssetsItemStatus::Skipped,
        reason_code: Some(reason_code.to_owned()),
        root_relative_path,
        asset_id,
        media_type,
        face_count,
        detected: None,
        inference_detected: None,
        error: None,
    }
}

fn face_scan_media_type(root_relative_path: &RootRelativePath) -> Option<FaceMediaType> {
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
