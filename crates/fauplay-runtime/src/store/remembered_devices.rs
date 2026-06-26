use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::{RememberedDeviceAdminEntry, RememberedDevicesAdminResponse, RuntimeError};

use super::{GLOBAL_CONFIG_FOLDER_NAME, now_ms, number_value, string_value};

const REMEMBERED_DEVICES_FILENAME: &str = "remote-remembered-devices.v1.json";
const LEGACY_AUTO_LABEL: &str = "\u{65e7}\u{7248}\u{5df2}\u{8bb0}\u{4f4f}\u{8bbe}\u{5907}";

pub(crate) fn list_remembered_devices(
    runtime_home_path: &Path,
) -> Result<RememberedDevicesAdminResponse, RuntimeError> {
    let path = remembered_devices_path(runtime_home_path);
    let mut records = read_remembered_device_records(&path)?;
    let now_ms = now_ms();

    records.retain(|record| record.expires_at_ms > now_ms);
    records.sort_by(|left, right| {
        right
            .last_used_at_ms
            .cmp(&left.last_used_at_ms)
            .then_with(|| right.created_at_ms.cmp(&left.created_at_ms))
    });

    Ok(RememberedDevicesAdminResponse {
        items: records
            .into_iter()
            .map(|record| RememberedDeviceAdminEntry {
                id: record.id,
                label: record.label,
                auto_label: record.auto_label,
                user_agent_summary: record.user_agent_summary,
                created_at_ms: record.created_at_ms,
                last_used_at_ms: record.last_used_at_ms,
                expires_at_ms: record.expires_at_ms,
            })
            .collect(),
    })
}

pub(crate) fn rename_remembered_device(
    runtime_home_path: &Path,
    device_id: &str,
    label: &str,
) -> Result<bool, RuntimeError> {
    let path = remembered_devices_path(runtime_home_path);
    let mut records = read_remembered_device_records(&path)?;
    let now_ms = now_ms();
    records.retain(|record| record.expires_at_ms > now_ms);

    let normalized_device_id = device_id.trim();
    let mut renamed = false;
    for record in &mut records {
        if record.id == normalized_device_id {
            record.label = normalize_display_text(Some(label), 80);
            renamed = true;
            break;
        }
    }

    if renamed {
        write_remembered_device_records(&path, &records)?;
    }

    Ok(renamed)
}

pub(crate) fn revoke_remembered_device(
    runtime_home_path: &Path,
    device_id: &str,
) -> Result<bool, RuntimeError> {
    let path = remembered_devices_path(runtime_home_path);
    let mut records = read_remembered_device_records(&path)?;
    let now_ms = now_ms();
    records.retain(|record| record.expires_at_ms > now_ms);

    let normalized_device_id = device_id.trim();
    let original_len = records.len();
    records.retain(|record| record.id != normalized_device_id);
    let revoked = records.len() != original_len;

    if revoked {
        write_remembered_device_records(&path, &records)?;
    }

    Ok(revoked)
}

pub(crate) fn revoke_all_remembered_devices(runtime_home_path: &Path) -> Result<(), RuntimeError> {
    let path = remembered_devices_path(runtime_home_path);
    write_remembered_device_records(&path, &[])
}

#[derive(Debug, Clone)]
struct RememberedDeviceRecord {
    id: String,
    token_hash: String,
    label: String,
    auto_label: String,
    user_agent_summary: String,
    created_at_ms: u64,
    last_used_at_ms: u64,
    expires_at_ms: u64,
}

fn remembered_devices_path(runtime_home_path: &Path) -> PathBuf {
    runtime_home_path
        .join(GLOBAL_CONFIG_FOLDER_NAME)
        .join(REMEMBERED_DEVICES_FILENAME)
}

fn read_remembered_device_records(
    path: &Path,
) -> Result<Vec<RememberedDeviceRecord>, RuntimeError> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(RuntimeError::read_file(path, error)),
    };

    let value = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|error| RuntimeError::invalid_runtime_home_file(path, &error.to_string()))?;
    let devices = value
        .get("devices")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| RuntimeError::invalid_runtime_home_file(path, "devices must be an array"))?;

    let mut records = Vec::new();
    for item in devices {
        let Some(object) = item.as_object() else {
            continue;
        };
        let Some(id) = string_value(object.get("id")).filter(|value| !value.is_empty()) else {
            continue;
        };
        let Some(token_hash) =
            string_value(object.get("tokenHash")).filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Some(created_at_ms) = number_value(object.get("createdAtMs")) else {
            continue;
        };
        let Some(last_used_at_ms) = number_value(object.get("lastUsedAtMs")) else {
            continue;
        };
        let Some(expires_at_ms) = number_value(object.get("expiresAtMs")) else {
            continue;
        };

        let auto_label =
            normalize_display_text(string_value(object.get("autoLabel")).as_deref(), 120);
        let auto_label = if auto_label.is_empty() {
            LEGACY_AUTO_LABEL.to_owned()
        } else {
            auto_label
        };

        records.push(RememberedDeviceRecord {
            id,
            token_hash,
            label: normalize_display_text(string_value(object.get("label")).as_deref(), 80),
            auto_label,
            user_agent_summary: normalize_display_text(
                string_value(object.get("userAgentSummary")).as_deref(),
                160,
            ),
            created_at_ms,
            last_used_at_ms,
            expires_at_ms,
        });
    }

    Ok(records)
}

fn write_remembered_device_records(
    path: &Path,
    records: &[RememberedDeviceRecord],
) -> Result<(), RuntimeError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| RuntimeError::write_file(parent, source))?;
    }

    let mut records = records.to_vec();
    records.sort_by(|left, right| left.created_at_ms.cmp(&right.created_at_ms));
    let devices = records
        .iter()
        .map(|record| {
            serde_json::json!({
                "id": record.id,
                "tokenHash": record.token_hash,
                "label": record.label,
                "autoLabel": record.auto_label,
                "userAgentSummary": record.user_agent_summary,
                "createdAtMs": record.created_at_ms,
                "lastUsedAtMs": record.last_used_at_ms,
                "expiresAtMs": record.expires_at_ms,
            })
        })
        .collect::<Vec<_>>();
    let raw = serde_json::to_string_pretty(&serde_json::json!({
        "version": 1,
        "devices": devices,
    }))
    .map_err(|error| RuntimeError::invalid_runtime_home_file(path, &error.to_string()))?;

    fs::write(path, raw).map_err(|source| RuntimeError::write_file(path, source))
}

fn normalize_display_text(value: Option<&str>, max_length: usize) -> String {
    let Some(value) = value else {
        return String::new();
    };
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    normalized.chars().take(max_length).collect()
}
