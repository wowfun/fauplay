use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalShortcutConfigResponse {
    pub loaded: bool,
    pub path: PathBuf,
    pub config_json: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalRootBinding {
    pub root_id: String,
    pub root_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalRootBindingsResponse {
    pub items: Vec<LocalRootBinding>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalRootBindingUpsertRequest {
    pub root_id: String,
    pub root_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RememberedDeviceAdminEntry {
    pub id: String,
    pub label: String,
    pub auto_label: String,
    pub user_agent_summary: String,
    pub created_at_ms: u64,
    pub last_used_at_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RememberedDevicesAdminResponse {
    pub items: Vec<RememberedDeviceAdminEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemotePublishedRootSyncEntry {
    pub label: String,
    pub absolute_path: PathBuf,
    pub favorite_paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemotePublishedRootSyncRequest {
    pub items: Vec<RemotePublishedRootSyncEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemotePublishedRootSyncResponse {
    pub published_root_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteSharedFavorite {
    pub root_id: String,
    pub path: String,
    pub favorited_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteSharedFavoritesResponse {
    pub items: Vec<RemoteSharedFavorite>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteSharedFavoriteUpsertRequest {
    pub root_id: String,
    pub path: String,
    pub favorited_at_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteSharedFavoriteRemoveRequest {
    pub root_id: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteSharedFavoriteRemoveResponse {
    pub removed: bool,
}
