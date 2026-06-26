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
pub struct RememberedDeviceCredential {
    pub id: String,
    pub cookie_value: String,
    pub label: String,
    pub auto_label: String,
    pub user_agent_summary: String,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RememberedDeviceCreateRequest {
    pub label: String,
    pub user_agent: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RememberedDeviceRotateRequest {
    pub cookie_value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RememberedDeviceRevokeRequest {
    pub cookie_value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RememberedDeviceRevokeResponse {
    pub revoked_device_ids: Vec<String>,
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
pub struct RemotePublishedRoot {
    pub id: String,
    pub label: String,
    pub absolute_path: PathBuf,
    pub real_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemotePublishedRootsResponse {
    pub items: Vec<RemotePublishedRoot>,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteAccessConfigSource {
    pub label: String,
    pub path: PathBuf,
    pub loaded: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteAccessRoot {
    pub id: String,
    pub label: String,
    pub path: PathBuf,
    pub real_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteAccessConfigResponse {
    pub enabled: bool,
    pub configured: bool,
    pub auth_configured: bool,
    pub root_source: String,
    pub roots: Vec<RemoteAccessRoot>,
    pub config_sources: Vec<RemoteAccessConfigSource>,
    pub fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteAccessTokenVerifyRequest {
    pub bearer_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteAccessSessionLoginRequest {
    pub bearer_token: String,
    pub remember_device: bool,
    pub remember_device_label: String,
    pub remembered_device_cookie: String,
    pub user_agent: String,
    pub client_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteAccessSessionAuthorizeRequest {
    pub session_cookie: String,
    pub remembered_device_cookie: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteAccessSessionLogoutRequest {
    pub session_cookie: String,
    pub remembered_device_cookie: String,
    pub forget_device: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteAccessSessionResponse {
    pub authorized: bool,
    pub set_cookies: Vec<String>,
}
