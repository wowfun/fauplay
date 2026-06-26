use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::{
    RemotePublishedRootSyncEntry, RemotePublishedRootSyncRequest, RemotePublishedRootSyncResponse,
    RemoteSharedFavorite, RemoteSharedFavoriteRemoveRequest, RemoteSharedFavoriteRemoveResponse,
    RemoteSharedFavoriteUpsertRequest, RemoteSharedFavoritesResponse, RuntimeError,
};

use super::{GLOBAL_CONFIG_FOLDER_NAME, now_ms, number_value, string_value};

const REMOTE_PUBLISHED_ROOTS_FILENAME: &str = "remote-published-roots.v1.json";
const REMOTE_SHARED_FAVORITES_FILENAME: &str = "remote-shared-favorites.v1.json";
const ROOT_LABEL_FALLBACK: &str = "\u{6839}\u{76ee}\u{5f55}";

pub(crate) fn sync_remote_published_roots(
    runtime_home_path: &Path,
    request: RemotePublishedRootSyncRequest,
) -> Result<RemotePublishedRootSyncResponse, RuntimeError> {
    let published_roots_path = remote_published_roots_path(runtime_home_path);
    let shared_favorites_path = remote_shared_favorites_path(runtime_home_path);
    let previous_roots = read_published_root_records(&published_roots_path)?;
    let previous_by_id = previous_roots
        .iter()
        .map(|record| (record.id.clone(), record.clone()))
        .collect::<HashMap<_, _>>();
    let sync_ms = now_ms();

    let mut next_roots_by_id = HashMap::new();
    let mut favorite_seeds = Vec::new();
    for item in request.items {
        let Some(snapshot) = normalize_published_root_snapshot(&item) else {
            continue;
        };
        let existing = previous_by_id.get(&snapshot.id);
        next_roots_by_id.insert(
            snapshot.id.clone(),
            PublishedRootRecord {
                id: snapshot.id.clone(),
                label: snapshot.label,
                absolute_path: snapshot.absolute_path,
                created_at_ms: existing
                    .map(|record| record.created_at_ms)
                    .unwrap_or(sync_ms),
                last_synced_at_ms: sync_ms,
            },
        );
        for favorite_path in item.favorite_paths {
            favorite_seeds.push(FavoriteRecord {
                root_id: snapshot.id.clone(),
                path: favorite_path,
                favorited_at_ms: sync_ms,
            });
        }
    }

    let removed_root_ids = previous_roots
        .iter()
        .filter_map(|record| {
            (!next_roots_by_id.contains_key(&record.id)).then_some(record.id.clone())
        })
        .collect::<HashSet<_>>();
    let mut next_roots = next_roots_by_id.into_values().collect::<Vec<_>>();
    next_roots.sort_by(|left, right| left.created_at_ms.cmp(&right.created_at_ms));
    write_published_root_records(&published_roots_path, &next_roots)?;

    let mut favorites = read_favorite_records(&shared_favorites_path)?;
    favorites.retain(|record| !removed_root_ids.contains(&record.root_id));
    upsert_favorite_records(&mut favorites, favorite_seeds);
    write_favorite_records(&shared_favorites_path, &favorites)?;

    Ok(RemotePublishedRootSyncResponse {
        published_root_count: next_roots.len(),
    })
}

pub(crate) fn list_remote_shared_favorites(
    runtime_home_path: &Path,
) -> Result<RemoteSharedFavoritesResponse, RuntimeError> {
    let shared_favorites_path = remote_shared_favorites_path(runtime_home_path);
    Ok(RemoteSharedFavoritesResponse {
        items: read_favorite_records(&shared_favorites_path)?
            .into_iter()
            .map(|record| RemoteSharedFavorite {
                root_id: record.root_id,
                path: record.path,
                favorited_at_ms: record.favorited_at_ms,
            })
            .collect(),
    })
}

pub(crate) fn upsert_remote_shared_favorite(
    runtime_home_path: &Path,
    request: RemoteSharedFavoriteUpsertRequest,
) -> Result<RemoteSharedFavorite, RuntimeError> {
    let root_id = normalize_favorite_root_id(&request.root_id)?;
    let Some(path) = normalize_favorite_path(&request.path) else {
        return Err(RuntimeError::runtime_capability(
            "invalid Favorite Folder path",
        ));
    };
    let shared_favorites_path = remote_shared_favorites_path(runtime_home_path);
    let favorited_at_ms = request.favorited_at_ms.unwrap_or_else(now_ms);
    let key = favorite_key(&root_id, &path);
    let mut records = read_favorite_records(&shared_favorites_path)?;
    upsert_favorite_records(
        &mut records,
        vec![FavoriteRecord {
            root_id,
            path,
            favorited_at_ms,
        }],
    );
    write_favorite_records(&shared_favorites_path, &records)?;
    let Some(record) = records
        .into_iter()
        .find(|record| favorite_key(&record.root_id, &record.path) == key)
    else {
        return Err(RuntimeError::runtime_capability(
            "failed to upsert Favorite Folder",
        ));
    };
    Ok(RemoteSharedFavorite {
        root_id: record.root_id,
        path: record.path,
        favorited_at_ms: record.favorited_at_ms,
    })
}

pub(crate) fn remove_remote_shared_favorite(
    runtime_home_path: &Path,
    request: RemoteSharedFavoriteRemoveRequest,
) -> Result<RemoteSharedFavoriteRemoveResponse, RuntimeError> {
    let root_id = normalize_favorite_root_id(&request.root_id)?;
    let Some(path) = normalize_favorite_path(&request.path) else {
        return Err(RuntimeError::runtime_capability(
            "invalid Favorite Folder path",
        ));
    };
    let shared_favorites_path = remote_shared_favorites_path(runtime_home_path);
    let key = favorite_key(&root_id, &path);
    let mut records = read_favorite_records(&shared_favorites_path)?;
    let previous_len = records.len();
    records.retain(|record| favorite_key(&record.root_id, &record.path) != key);
    let removed = records.len() != previous_len;
    if removed {
        write_favorite_records(&shared_favorites_path, &records)?;
    }
    Ok(RemoteSharedFavoriteRemoveResponse { removed })
}

#[derive(Debug, Clone)]
struct PublishedRootRecord {
    id: String,
    label: String,
    absolute_path: String,
    created_at_ms: u64,
    last_synced_at_ms: u64,
}

#[derive(Debug, Clone)]
struct PublishedRootSnapshot {
    id: String,
    label: String,
    absolute_path: String,
}

#[derive(Debug, Clone)]
struct FavoriteRecord {
    root_id: String,
    path: String,
    favorited_at_ms: u64,
}

fn remote_published_roots_path(runtime_home_path: &Path) -> PathBuf {
    runtime_home_path
        .join(GLOBAL_CONFIG_FOLDER_NAME)
        .join(REMOTE_PUBLISHED_ROOTS_FILENAME)
}

fn remote_shared_favorites_path(runtime_home_path: &Path) -> PathBuf {
    runtime_home_path
        .join(GLOBAL_CONFIG_FOLDER_NAME)
        .join(REMOTE_SHARED_FAVORITES_FILENAME)
}

fn normalize_published_root_snapshot(
    item: &RemotePublishedRootSyncEntry,
) -> Option<PublishedRootSnapshot> {
    let absolute_path = normalize_absolute_path(&item.absolute_path)?;
    let label = normalize_display_text(Some(&item.label), 120)
        .or_else(|| root_label_from_path(&absolute_path))
        .unwrap_or_else(|| ROOT_LABEL_FALLBACK.to_owned());
    let id = derive_published_root_id(&absolute_path);

    Some(PublishedRootSnapshot {
        id,
        label,
        absolute_path,
    })
}

fn normalize_absolute_path(path: &Path) -> Option<String> {
    let raw = path.to_string_lossy();
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return None;
    }

    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::Prefix(prefix) => {
                parts.push(prefix.as_os_str().to_string_lossy().replace('\\', "/"));
            }
            std::path::Component::RootDir | std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                parts.pop();
            }
            std::path::Component::Normal(part) => {
                for segment in part
                    .to_string_lossy()
                    .replace('\\', "/")
                    .split('/')
                    .filter(|segment| !segment.is_empty() && *segment != ".")
                {
                    if segment == ".." {
                        parts.pop();
                    } else {
                        parts.push(segment.to_owned());
                    }
                }
            }
        }
    }

    Some(format!("/{}", parts.join("/")))
}

fn normalize_display_text(value: Option<&str>, max_length: usize) -> Option<String> {
    let normalized = value?.split_whitespace().collect::<Vec<_>>().join(" ");
    (!normalized.is_empty()).then(|| normalized.chars().take(max_length).collect())
}

fn root_label_from_path(absolute_path: &str) -> Option<String> {
    absolute_path
        .rsplit('/')
        .find(|segment| !segment.is_empty())
        .map(ToOwned::to_owned)
}

fn derive_published_root_id(absolute_path: &str) -> String {
    let digest = Sha256::digest(absolute_path.as_bytes());
    let mut hex = String::with_capacity(24);
    for byte in digest.iter().take(12) {
        let _ = write!(&mut hex, "{byte:02x}");
    }
    format!("remote-root-{hex}")
}

fn read_published_root_records(path: &Path) -> Result<Vec<PublishedRootRecord>, RuntimeError> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(RuntimeError::read_file(path, error)),
    };
    let value = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|error| RuntimeError::invalid_runtime_home_file(path, &error.to_string()))?;
    let items = value
        .get("items")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| RuntimeError::invalid_runtime_home_file(path, "items must be an array"))?;

    let mut records = Vec::new();
    for item in items {
        let Some(object) = item.as_object() else {
            continue;
        };
        let Some(absolute_path) = string_value(object.get("absolutePath"))
            .and_then(|value| normalize_absolute_path(Path::new(&value)))
        else {
            continue;
        };
        let Some(created_at_ms) = number_value(object.get("createdAtMs")) else {
            continue;
        };
        let Some(last_synced_at_ms) = number_value(object.get("lastSyncedAtMs")) else {
            continue;
        };
        let id = derive_published_root_id(&absolute_path);
        let label = normalize_display_text(string_value(object.get("label")).as_deref(), 120)
            .or_else(|| root_label_from_path(&absolute_path))
            .unwrap_or_else(|| ROOT_LABEL_FALLBACK.to_owned());
        records.push(PublishedRootRecord {
            id,
            label,
            absolute_path,
            created_at_ms,
            last_synced_at_ms,
        });
    }
    records.sort_by(|left, right| left.created_at_ms.cmp(&right.created_at_ms));

    Ok(records)
}

fn write_published_root_records(
    path: &Path,
    records: &[PublishedRootRecord],
) -> Result<(), RuntimeError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| RuntimeError::write_file(parent, source))?;
    }

    let items = records
        .iter()
        .map(|record| {
            serde_json::json!({
                "id": record.id,
                "label": record.label,
                "absolutePath": record.absolute_path,
                "createdAtMs": record.created_at_ms,
                "lastSyncedAtMs": record.last_synced_at_ms,
            })
        })
        .collect::<Vec<_>>();
    let raw = serde_json::to_string_pretty(&serde_json::json!({
        "version": 1,
        "items": items,
    }))
    .map_err(|error| RuntimeError::invalid_runtime_home_file(path, &error.to_string()))?;

    fs::write(path, raw).map_err(|source| RuntimeError::write_file(path, source))
}

fn read_favorite_records(path: &Path) -> Result<Vec<FavoriteRecord>, RuntimeError> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(RuntimeError::read_file(path, error)),
    };
    let value = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|error| RuntimeError::invalid_runtime_home_file(path, &error.to_string()))?;
    let items = value
        .get("items")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| RuntimeError::invalid_runtime_home_file(path, "items must be an array"))?;

    let mut records = Vec::new();
    for item in items {
        let Some(object) = item.as_object() else {
            continue;
        };
        let Some(root_id) = string_value(object.get("rootId")).filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Some(path) =
            string_value(object.get("path")).and_then(|value| normalize_favorite_path(&value))
        else {
            continue;
        };
        let Some(favorited_at_ms) = number_value(object.get("favoritedAtMs")) else {
            continue;
        };
        records.push(FavoriteRecord {
            root_id,
            path,
            favorited_at_ms,
        });
    }
    records.sort_by(|left, right| right.favorited_at_ms.cmp(&left.favorited_at_ms));

    Ok(records)
}

fn upsert_favorite_records(records: &mut Vec<FavoriteRecord>, seeds: Vec<FavoriteRecord>) {
    let mut records_by_key = records
        .drain(..)
        .map(|record| (favorite_key(&record.root_id, &record.path), record))
        .collect::<HashMap<_, _>>();

    for seed in seeds {
        let Some(path) = normalize_favorite_path(&seed.path) else {
            continue;
        };
        if seed.root_id.trim().is_empty() {
            continue;
        }
        let record = FavoriteRecord {
            root_id: seed.root_id.trim().to_owned(),
            path,
            favorited_at_ms: seed.favorited_at_ms,
        };
        records_by_key.insert(favorite_key(&record.root_id, &record.path), record);
    }

    records.extend(records_by_key.into_values());
    records.sort_by(|left, right| {
        right
            .favorited_at_ms
            .cmp(&left.favorited_at_ms)
            .then_with(|| left.root_id.cmp(&right.root_id))
            .then_with(|| left.path.cmp(&right.path))
    });
}

fn write_favorite_records(path: &Path, records: &[FavoriteRecord]) -> Result<(), RuntimeError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| RuntimeError::write_file(parent, source))?;
    }

    let items = records
        .iter()
        .map(|record| {
            serde_json::json!({
                "rootId": record.root_id,
                "path": record.path,
                "favoritedAtMs": record.favorited_at_ms,
            })
        })
        .collect::<Vec<_>>();
    let raw = serde_json::to_string_pretty(&serde_json::json!({
        "version": 1,
        "items": items,
    }))
    .map_err(|error| RuntimeError::invalid_runtime_home_file(path, &error.to_string()))?;

    fs::write(path, raw).map_err(|source| RuntimeError::write_file(path, source))
}

fn normalize_favorite_path(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Some(String::new());
    }

    let replaced = trimmed.replace('\\', "/");
    let mut segments = Vec::new();
    for segment in replaced.split('/').filter(|segment| !segment.is_empty()) {
        if segment == "." || segment == ".." || segment.contains('\0') {
            return None;
        }
        segments.push(segment);
    }
    (!segments.is_empty()).then(|| segments.join("/"))
}

fn normalize_favorite_root_id(value: &str) -> Result<String, RuntimeError> {
    let root_id = value.trim();
    if root_id.is_empty() {
        return Err(RuntimeError::runtime_capability(
            "Favorite Folder rootId is required",
        ));
    }
    Ok(root_id.to_owned())
}

fn favorite_key(root_id: &str, path: &str) -> String {
    format!("{root_id}:{path}")
}
