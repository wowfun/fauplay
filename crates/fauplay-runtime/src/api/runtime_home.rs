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
