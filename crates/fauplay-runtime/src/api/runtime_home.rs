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
