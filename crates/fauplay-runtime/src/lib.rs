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
    FaceBoundingBox, FaceDetectAssetRequest, FaceDetectAssetResponse, FaceListAssetFacesRequest,
    FaceListAssetFacesResponse, FaceListPeopleRequest, FaceListPeopleResponse,
    FaceListReviewFacesRequest, FaceListReviewFacesResponse, FaceMediaType, FaceRecord,
    FaceRenamePersonRequest, FaceRenamePersonResponse, FaceReviewBucket, FaceScope, FaceStatus,
    FileAnnotationActionSource, FileAnnotationFile, FileAnnotationMatchMode,
    FileAnnotationMissingCleanupImpact, FileAnnotationMissingCleanupRequest,
    FileAnnotationMissingCleanupResponse, FileAnnotationMutationResponse,
    FileAnnotationPathMapping, FileAnnotationPathRebindFailureReason, FileAnnotationPathRebindItem,
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
    MissingFileCleanupImpact, MissingFileCleanupRequest, MissingFileCleanupResponse, PersonSummary,
    RememberedDeviceAdminEntry, RememberedDevicesAdminResponse, RemotePublishedRootSyncEntry,
    RemotePublishedRootSyncRequest, RemotePublishedRootSyncResponse, RootMoveBatchFailureReason,
    RootMoveBatchItem, RootMoveBatchRequest, RootMoveBatchResponse, RootMoveFailureReason,
    RootMoveRequest, RootMoveResponse, RootMoveRule, RootMoveSearchMode, RootRelativePath,
    RootTrashEntry, RootTrashFailureReason, RootTrashListRequest, RootTrashListResponse,
    RootTrashMutationItem, RootTrashMutationResponse, RootTrashRequest, RuntimeError,
    TextPreviewRequest, TextPreviewResponse, TextPreviewStatus,
};
pub use server::{serve_http, serve_one_http_request};
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct FauplayRuntime {
    runtime_home_path: PathBuf,
    mcp_runtime: mcp::McpRuntime,
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

    pub fn sync_remote_published_roots(
        &self,
        request: RemotePublishedRootSyncRequest,
    ) -> Result<RemotePublishedRootSyncResponse, RuntimeError> {
        store::sync_remote_published_roots(&self.runtime_home_path, request)
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
