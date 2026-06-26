use std::fmt::Write as _;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use rand::{RngCore, rngs::OsRng};
use sha2::{Digest, Sha256};

use crate::{
    RememberedDeviceAdminEntry, RememberedDeviceCreateRequest, RememberedDeviceCredential,
    RememberedDeviceRevokeRequest, RememberedDeviceRevokeResponse, RememberedDeviceRotateRequest,
    RememberedDevicesAdminResponse, RuntimeError,
};

use super::{GLOBAL_CONFIG_FOLDER_NAME, now_ms, number_value, string_value};

const REMEMBERED_DEVICES_FILENAME: &str = "remote-remembered-devices.v1.json";
const LEGACY_AUTO_LABEL: &str = "\u{65e7}\u{7248}\u{5df2}\u{8bb0}\u{4f4f}\u{8bbe}\u{5907}";
const DEFAULT_AUTO_LABEL: &str = "\u{5f53}\u{524d}\u{8bbe}\u{5907}";
const REMEMBERED_DEVICE_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1000;

pub(crate) fn create_remembered_device(
    runtime_home_path: &Path,
    request: RememberedDeviceCreateRequest,
) -> Result<RememberedDeviceCredential, RuntimeError> {
    let path = remembered_devices_path(runtime_home_path);
    let mut records = read_remembered_device_records(&path)?;
    let now_ms = now_ms();
    records.retain(|record| record.expires_at_ms > now_ms);

    let id = format!("remembered-device-{}", random_hex(16));
    let secret = random_hex(32);
    let summary = build_remembered_device_summary(&request.user_agent);
    let label = normalize_display_text(Some(&request.label), 80);
    let expires_at_ms = now_ms.saturating_add(REMEMBERED_DEVICE_TTL_MS);

    records.push(RememberedDeviceRecord {
        id: id.clone(),
        token_hash: hash_remembered_device_secret(&secret),
        label: label.clone(),
        auto_label: summary.auto_label.clone(),
        user_agent_summary: summary.user_agent_summary.clone(),
        created_at_ms: now_ms,
        last_used_at_ms: now_ms,
        expires_at_ms,
    });
    write_remembered_device_records(&path, &records)?;

    Ok(RememberedDeviceCredential {
        cookie_value: create_remembered_device_cookie_value(&id, &secret),
        id,
        label,
        auto_label: summary.auto_label,
        user_agent_summary: summary.user_agent_summary,
        expires_at_ms,
    })
}

pub(crate) fn rotate_remembered_device(
    runtime_home_path: &Path,
    request: RememberedDeviceRotateRequest,
) -> Result<Option<RememberedDeviceCredential>, RuntimeError> {
    let path = remembered_devices_path(runtime_home_path);
    let mut records = read_remembered_device_records(&path)?;
    let now_ms = now_ms();
    let pruned = retain_unexpired_records(&mut records, now_ms);
    let Some(parsed) = parse_remembered_device_cookie_value(&request.cookie_value) else {
        persist_if_pruned(&path, &records, pruned)?;
        return Ok(None);
    };
    let Some(record_index) = matching_remembered_device_index(&records, &parsed) else {
        persist_if_pruned(&path, &records, pruned)?;
        return Ok(None);
    };

    let next_secret = random_hex(32);
    let record = &mut records[record_index];
    record.token_hash = hash_remembered_device_secret(&next_secret);
    record.last_used_at_ms = now_ms;
    let credential = RememberedDeviceCredential {
        id: record.id.clone(),
        cookie_value: create_remembered_device_cookie_value(&record.id, &next_secret),
        label: record.label.clone(),
        auto_label: record.auto_label.clone(),
        user_agent_summary: record.user_agent_summary.clone(),
        expires_at_ms: record.expires_at_ms,
    };
    write_remembered_device_records(&path, &records)?;
    Ok(Some(credential))
}

pub(crate) fn revoke_remembered_device_credential(
    runtime_home_path: &Path,
    request: RememberedDeviceRevokeRequest,
) -> Result<RememberedDeviceRevokeResponse, RuntimeError> {
    let path = remembered_devices_path(runtime_home_path);
    let mut records = read_remembered_device_records(&path)?;
    let now_ms = now_ms();
    let pruned = retain_unexpired_records(&mut records, now_ms);
    let Some(parsed) = parse_remembered_device_cookie_value(&request.cookie_value) else {
        persist_if_pruned(&path, &records, pruned)?;
        return Ok(RememberedDeviceRevokeResponse {
            revoked_device_ids: Vec::new(),
        });
    };
    let Some(record_index) = matching_remembered_device_index(&records, &parsed) else {
        persist_if_pruned(&path, &records, pruned)?;
        return Ok(RememberedDeviceRevokeResponse {
            revoked_device_ids: Vec::new(),
        });
    };

    let revoked_device_id = records.remove(record_index).id;
    write_remembered_device_records(&path, &records)?;
    Ok(RememberedDeviceRevokeResponse {
        revoked_device_ids: vec![revoked_device_id],
    })
}

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

struct RememberedDeviceSummary {
    auto_label: String,
    user_agent_summary: String,
}

struct ParsedRememberedDeviceCookie {
    id: String,
    secret: String,
}

fn remembered_devices_path(runtime_home_path: &Path) -> PathBuf {
    runtime_home_path
        .join(GLOBAL_CONFIG_FOLDER_NAME)
        .join(REMEMBERED_DEVICES_FILENAME)
}

fn create_remembered_device_cookie_value(id: &str, secret: &str) -> String {
    format!("{id}.{secret}")
}

fn parse_remembered_device_cookie_value(value: &str) -> Option<ParsedRememberedDeviceCookie> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let (id, secret) = value.split_once('.')?;
    let id = id.trim();
    let secret = secret.trim();
    if id.is_empty() || secret.is_empty() {
        return None;
    }
    Some(ParsedRememberedDeviceCookie {
        id: id.to_owned(),
        secret: secret.to_owned(),
    })
}

fn matching_remembered_device_index(
    records: &[RememberedDeviceRecord],
    parsed: &ParsedRememberedDeviceCookie,
) -> Option<usize> {
    let received_hash = hash_remembered_device_secret(&parsed.secret);
    records.iter().position(|record| {
        record.id == parsed.id
            && is_remembered_device_hash_match(&record.token_hash, &received_hash)
    })
}

fn is_remembered_device_hash_match(expected_hash: &str, actual_hash: &str) -> bool {
    if expected_hash.is_empty()
        || actual_hash.is_empty()
        || expected_hash.len() != actual_hash.len()
    {
        return false;
    }
    expected_hash
        .bytes()
        .zip(actual_hash.bytes())
        .fold(0u8, |diff, (left, right)| diff | (left ^ right))
        == 0
}

fn hash_remembered_device_secret(secret: &str) -> String {
    let digest = Sha256::digest(secret.as_bytes());
    digest_hex(&digest)
}

fn random_hex(byte_count: usize) -> String {
    let mut bytes = vec![0u8; byte_count];
    OsRng.fill_bytes(&mut bytes);
    digest_hex(&bytes)
}

fn digest_hex(bytes: &[u8]) -> String {
    let mut hex = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(&mut hex, "{byte:02x}");
    }
    hex
}

fn build_remembered_device_summary(user_agent: &str) -> RememberedDeviceSummary {
    let browser = detect_user_agent_browser(user_agent);
    let platform = detect_user_agent_platform(user_agent);
    let auto_label = join_summary_parts(&[browser.as_deref(), platform.as_deref()])
        .unwrap_or_else(|| DEFAULT_AUTO_LABEL.to_owned());
    let user_agent_summary =
        join_summary_parts(&[platform.as_deref(), browser.as_deref()]).unwrap_or_default();

    RememberedDeviceSummary {
        auto_label,
        user_agent_summary,
    }
}

fn detect_user_agent_browser(user_agent: &str) -> Option<String> {
    let source = user_agent.to_ascii_lowercase();
    if source.is_empty() {
        return None;
    }
    if source.contains("edg/") || source.contains("edge/") || source.contains("edgios/") {
        return Some("Edge".to_owned());
    }
    if source.contains("samsungbrowser/") {
        return Some("Samsung Internet".to_owned());
    }
    if source.contains("opr/") || source.contains("opera/") {
        return Some("Opera".to_owned());
    }
    if source.contains("firefox/") || source.contains("fxios/") {
        return Some("Firefox".to_owned());
    }
    if source.contains("chrome/") || source.contains("crios/") {
        return Some("Chrome".to_owned());
    }
    if source.contains("safari/") && !source.contains("chrome/") && !source.contains("crios/") {
        return Some("Safari".to_owned());
    }
    None
}

fn detect_user_agent_platform(user_agent: &str) -> Option<String> {
    let source = user_agent.to_ascii_lowercase();
    if source.is_empty() {
        return None;
    }
    if source.contains("iphone") {
        return Some("iPhone".to_owned());
    }
    if source.contains("ipad") {
        return Some("iPad".to_owned());
    }
    if source.contains("android") {
        return Some("Android".to_owned());
    }
    if source.contains("windows") {
        return Some("Windows".to_owned());
    }
    if source.contains("macintosh") || source.contains("mac os x") {
        return Some("macOS".to_owned());
    }
    if source.contains("linux") {
        return Some("Linux".to_owned());
    }
    None
}

fn join_summary_parts(parts: &[Option<&str>]) -> Option<String> {
    let parts = parts
        .iter()
        .filter_map(|part| part.map(str::trim).filter(|part| !part.is_empty()))
        .collect::<Vec<_>>();
    (!parts.is_empty()).then(|| parts.join(" \u{00b7} "))
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

fn retain_unexpired_records(records: &mut Vec<RememberedDeviceRecord>, now_ms: u64) -> bool {
    let original_len = records.len();
    records.retain(|record| record.expires_at_ms > now_ms);
    records.len() != original_len
}

fn persist_if_pruned(
    path: &Path,
    records: &[RememberedDeviceRecord],
    pruned: bool,
) -> Result<(), RuntimeError> {
    if pruned {
        write_remembered_device_records(path, records)?;
    }
    Ok(())
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
