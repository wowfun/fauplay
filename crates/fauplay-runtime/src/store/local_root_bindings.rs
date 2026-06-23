use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::{
    LocalRootBinding, LocalRootBindingUpsertRequest, LocalRootBindingsResponse, RuntimeError,
};

use super::{GLOBAL_CONFIG_FOLDER_NAME, string_value};

const LOCAL_ROOT_BINDINGS_FILENAME: &str = "local-root-bindings.v1.json";

pub(crate) fn list_local_root_bindings(
    runtime_home_path: &Path,
) -> Result<LocalRootBindingsResponse, RuntimeError> {
    let path = local_root_bindings_path(runtime_home_path);
    let records = read_local_root_binding_records(&path)?;

    Ok(LocalRootBindingsResponse {
        items: records
            .into_iter()
            .map(|record| LocalRootBinding {
                root_id: record.root_id,
                root_path: PathBuf::from(record.root_path),
            })
            .collect(),
    })
}

pub(crate) fn upsert_local_root_binding(
    runtime_home_path: &Path,
    request: LocalRootBindingUpsertRequest,
) -> Result<LocalRootBinding, RuntimeError> {
    let root_id = trim_local_root_binding_field("rootId", &request.root_id)?;
    let root_path =
        trim_local_root_binding_field("rootPath", &request.root_path.display().to_string())?;
    let path = local_root_bindings_path(runtime_home_path);
    let mut records = read_local_root_binding_records(&path)?;

    records.retain(|record| record.root_id != root_id);
    records.push(LocalRootBindingRecord {
        root_id: root_id.clone(),
        root_path: root_path.clone(),
    });
    records.sort_by(|left, right| left.root_id.cmp(&right.root_id));
    write_local_root_binding_records(&path, &records)?;

    Ok(LocalRootBinding {
        root_id,
        root_path: PathBuf::from(root_path),
    })
}

#[derive(Debug, Clone)]
struct LocalRootBindingRecord {
    root_id: String,
    root_path: String,
}

fn local_root_bindings_path(runtime_home_path: &Path) -> PathBuf {
    runtime_home_path
        .join(GLOBAL_CONFIG_FOLDER_NAME)
        .join(LOCAL_ROOT_BINDINGS_FILENAME)
}

fn read_local_root_binding_records(
    path: &Path,
) -> Result<Vec<LocalRootBindingRecord>, RuntimeError> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(RuntimeError::read_file(path, error)),
    };

    let value = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|error| RuntimeError::invalid_runtime_home_file(path, &error.to_string()))?;
    let bindings = value
        .get("bindings")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| {
            RuntimeError::invalid_runtime_home_file(path, "bindings must be an array")
        })?;

    let mut records = Vec::new();
    for item in bindings {
        let Some(object) = item.as_object() else {
            continue;
        };
        let Some(root_id) = string_value(object.get("rootId")).filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Some(root_path) =
            string_value(object.get("rootPath")).filter(|value| !value.is_empty())
        else {
            continue;
        };
        records.push(LocalRootBindingRecord { root_id, root_path });
    }
    records.sort_by(|left, right| left.root_id.cmp(&right.root_id));

    Ok(records)
}

fn write_local_root_binding_records(
    path: &Path,
    records: &[LocalRootBindingRecord],
) -> Result<(), RuntimeError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| RuntimeError::write_file(parent, source))?;
    }

    let bindings = records
        .iter()
        .map(|record| {
            serde_json::json!({
                "rootId": record.root_id,
                "rootPath": record.root_path,
            })
        })
        .collect::<Vec<_>>();
    let raw = serde_json::to_string(&serde_json::json!({
        "version": 1,
        "bindings": bindings,
    }))
    .map_err(|error| RuntimeError::invalid_runtime_home_file(path, &error.to_string()))?;

    fs::write(path, raw).map_err(|source| RuntimeError::write_file(path, source))
}

fn trim_local_root_binding_field(field_name: &str, value: &str) -> Result<String, RuntimeError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(RuntimeError::invalid_local_root_binding(&format!(
            "{field_name} is required"
        )));
    }
    Ok(value.to_owned())
}
