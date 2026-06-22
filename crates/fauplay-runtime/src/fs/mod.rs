use std::cmp::Ordering;
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::{
    DirectoryEntry, DirectoryEntryKind, ListDirectoryRequest, ListDirectoryResponse,
    ListingEntryFilter, ListingQuery, ListingSortDirection, ListingSortKey, RootRelativePath,
    RootTrashEntry, RootTrashFailureReason, RootTrashListRequest, RootTrashListResponse,
    RootTrashMutationItem, RootTrashMutationResponse, RootTrashRequest, RuntimeError,
};

const ROOT_TRASH_FOLDER_NAME: &str = ".trash";
const RESERVED_FOLDER_NAMES: &[&str] = &[ROOT_TRASH_FOLDER_NAME];

pub(crate) fn list_local_directory(
    request: ListDirectoryRequest,
) -> Result<ListDirectoryResponse, RuntimeError> {
    let directory_path = request.root_path.join(request.root_relative_path.as_path());
    let mut entries = Vec::new();

    if request.flattened {
        collect_flattened_file_entries(&directory_path, &request.root_relative_path, &mut entries)?;
        entries = apply_listing_query(entries, &request.query);
        sort_entries(&mut entries, &request.query, true);
        return Ok(paged_response(
            entries,
            request.entry_offset,
            request.entry_limit,
        ));
    }

    collect_immediate_entries(&directory_path, &request.root_relative_path, &mut entries)?;
    entries = apply_listing_query(entries, &request.query);
    sort_entries(&mut entries, &request.query, false);

    Ok(paged_response(
        entries,
        request.entry_offset,
        request.entry_limit,
    ))
}

fn paged_response(
    entries: Vec<DirectoryEntry>,
    entry_offset: usize,
    entry_limit: Option<usize>,
) -> ListDirectoryResponse {
    let total_entries = entries.len();
    let start = entry_offset.min(total_entries);
    let end = match entry_limit {
        Some(limit) => start.saturating_add(limit).min(total_entries),
        None => total_entries,
    };
    let is_truncated = end < total_entries;
    let next_offset = is_truncated.then_some(end);

    ListDirectoryResponse {
        entries: entries[start..end].to_vec(),
        is_truncated,
        next_offset,
    }
}

fn apply_listing_query(entries: Vec<DirectoryEntry>, query: &ListingQuery) -> Vec<DirectoryEntry> {
    entries
        .into_iter()
        .filter(|entry| matches_name_query(entry, query.name_contains.as_deref()))
        .filter(|entry| matches_empty_folder_query(entry, query.hide_empty_folders))
        .filter(|entry| matches_entry_filter(entry, query.entry_filter))
        .collect()
}

fn matches_name_query(entry: &DirectoryEntry, name_contains: Option<&str>) -> bool {
    let Some(name_contains) = name_contains
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return true;
    };
    entry
        .name
        .to_lowercase()
        .contains(&name_contains.to_lowercase())
}

fn matches_empty_folder_query(entry: &DirectoryEntry, hide_empty_folders: bool) -> bool {
    if !hide_empty_folders {
        return true;
    }
    !(entry.kind == DirectoryEntryKind::Directory && entry.is_empty == Some(true))
}

fn matches_entry_filter(entry: &DirectoryEntry, entry_filter: ListingEntryFilter) -> bool {
    if entry.kind == DirectoryEntryKind::Directory {
        return true;
    }

    let extension = entry
        .root_relative_path
        .as_path()
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match entry_filter {
        ListingEntryFilter::All => true,
        ListingEntryFilter::Image => is_image_extension(&extension),
        ListingEntryFilter::Video => is_video_extension(&extension),
    }
}

fn is_image_extension(extension: &str) -> bool {
    matches!(
        extension,
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" | "ico"
    )
}

fn is_video_extension(extension: &str) -> bool {
    matches!(extension, "mp4" | "webm" | "mov" | "avi" | "mkv" | "ogg")
}

fn sort_entries(entries: &mut [DirectoryEntry], query: &ListingQuery, flattened: bool) {
    entries.sort_by(|left, right| {
        if !flattened {
            let kind_order =
                directory_entry_kind_rank(left.kind).cmp(&directory_entry_kind_rank(right.kind));
            if kind_order != Ordering::Equal {
                return kind_order;
            }
        }

        let entry_order = compare_listing_entries(left, right, query.order.sort_key, flattened);
        match query.order.direction {
            ListingSortDirection::Asc => entry_order,
            ListingSortDirection::Desc => entry_order.reverse(),
        }
    });
}

fn compare_listing_entries(
    left: &DirectoryEntry,
    right: &DirectoryEntry,
    sort_key: ListingSortKey,
    flattened: bool,
) -> Ordering {
    match sort_key {
        ListingSortKey::Name => compare_listing_names(left, right, flattened),
        ListingSortKey::Date => match (left.last_modified_ms, right.last_modified_ms) {
            (Some(left), Some(right)) => left.cmp(&right),
            _ => compare_listing_names(left, right, flattened),
        },
        ListingSortKey::Size => match (left.size, right.size) {
            (Some(left), Some(right)) => left.cmp(&right),
            _ => compare_listing_names(left, right, flattened),
        },
    }
}

fn compare_listing_names(
    left: &DirectoryEntry,
    right: &DirectoryEntry,
    flattened: bool,
) -> Ordering {
    if flattened {
        return left
            .root_relative_path
            .to_string()
            .cmp(&right.root_relative_path.to_string());
    }

    left.name.cmp(&right.name)
}

fn collect_immediate_entries(
    directory_path: &Path,
    root_relative_path: &RootRelativePath,
    entries: &mut Vec<DirectoryEntry>,
) -> Result<(), RuntimeError> {
    for entry_result in fs::read_dir(&directory_path)
        .map_err(|source| RuntimeError::read_directory(&directory_path, source))?
    {
        let entry = entry_result
            .map_err(|source| RuntimeError::read_directory_entry(&directory_path, source))?;
        let file_type = entry
            .file_type()
            .map_err(|source| RuntimeError::read_directory_entry(&entry.path(), source))?;

        let kind = if file_type.is_dir() {
            DirectoryEntryKind::Directory
        } else if file_type.is_file() {
            DirectoryEntryKind::File
        } else {
            continue;
        };

        let name = entry.file_name().to_string_lossy().into_owned();
        if kind == DirectoryEntryKind::Directory && is_reserved_folder_name(&name) {
            continue;
        }

        let entry_path = entry.path();
        let metadata = entry
            .metadata()
            .map_err(|source| RuntimeError::read_directory_entry(&entry_path, source))?;

        entries.push(DirectoryEntry {
            root_relative_path: root_relative_path.child(&name),
            name,
            kind,
            is_empty: if kind == DirectoryEntryKind::Directory {
                Some(is_directory_empty(&entry_path)?)
            } else {
                None
            },
            size: if kind == DirectoryEntryKind::File {
                Some(metadata.len())
            } else {
                None
            },
            last_modified_ms: modified_timestamp_ms(&metadata),
        });
    }

    Ok(())
}

fn collect_flattened_file_entries(
    directory_path: &Path,
    root_relative_path: &RootRelativePath,
    entries: &mut Vec<DirectoryEntry>,
) -> Result<(), RuntimeError> {
    for entry_result in fs::read_dir(directory_path)
        .map_err(|source| RuntimeError::read_directory(directory_path, source))?
    {
        let entry = entry_result
            .map_err(|source| RuntimeError::read_directory_entry(directory_path, source))?;
        let entry_path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|source| RuntimeError::read_directory_entry(&entry_path, source))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let child_root_relative_path = root_relative_path.child(&name);

        if file_type.is_dir() {
            if is_reserved_folder_name(&name) {
                continue;
            }
            collect_flattened_file_entries(&entry_path, &child_root_relative_path, entries)?;
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|source| RuntimeError::read_directory_entry(&entry_path, source))?;

        entries.push(DirectoryEntry {
            root_relative_path: child_root_relative_path,
            name,
            kind: DirectoryEntryKind::File,
            is_empty: None,
            size: Some(metadata.len()),
            last_modified_ms: modified_timestamp_ms(&metadata),
        });
    }

    Ok(())
}

fn is_reserved_folder_name(name: &str) -> bool {
    RESERVED_FOLDER_NAMES.contains(&name)
}

fn directory_entry_kind_rank(kind: DirectoryEntryKind) -> u8 {
    match kind {
        DirectoryEntryKind::Directory => 0,
        DirectoryEntryKind::File => 1,
    }
}

fn is_directory_empty(path: &Path) -> Result<bool, RuntimeError> {
    let mut entries =
        fs::read_dir(path).map_err(|source| RuntimeError::read_directory(path, source))?;
    Ok(entries
        .next()
        .transpose()
        .map_err(|source| RuntimeError::read_directory_entry(path, source))?
        .is_none())
}

fn modified_timestamp_ms(metadata: &fs::Metadata) -> Option<u64> {
    let duration = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    u64::try_from(duration.as_millis()).ok()
}

pub(crate) fn move_to_root_trash(
    request: RootTrashRequest,
) -> Result<RootTrashMutationResponse, RuntimeError> {
    mutate_root_trash(request, RootTrashOperation::MoveToTrash)
}

pub(crate) fn list_root_trash(
    request: RootTrashListRequest,
) -> Result<RootTrashListResponse, RuntimeError> {
    let trash_root_path = request.root_path.join(ROOT_TRASH_FOLDER_NAME);
    if !trash_root_path.exists() {
        return Ok(root_trash_paged_response(
            Vec::new(),
            request.entry_offset,
            request.entry_limit,
        ));
    }

    let mut entries = Vec::new();
    collect_root_trash_entries(
        &request.root_path,
        &trash_root_path,
        &RootRelativePath::try_from(ROOT_TRASH_FOLDER_NAME)
            .expect("Root Trash folder should be Root-relative"),
        &mut entries,
    )?;
    entries.sort_by(|left, right| {
        left.root_relative_path
            .to_string()
            .cmp(&right.root_relative_path.to_string())
    });

    Ok(root_trash_paged_response(
        entries,
        request.entry_offset,
        request.entry_limit,
    ))
}

pub(crate) fn restore_from_root_trash(
    request: RootTrashRequest,
) -> Result<RootTrashMutationResponse, RuntimeError> {
    mutate_root_trash(request, RootTrashOperation::Restore)
}

#[derive(Debug, Clone, Copy)]
enum RootTrashOperation {
    MoveToTrash,
    Restore,
}

struct RootTrashPlan {
    item: RootTrashMutationItem,
}

fn mutate_root_trash(
    request: RootTrashRequest,
    operation: RootTrashOperation,
) -> Result<RootTrashMutationResponse, RuntimeError> {
    let mut reserved_target_paths = HashSet::new();
    let mut plans = request
        .root_relative_paths
        .into_iter()
        .map(|root_relative_path| {
            build_root_trash_plan(
                &request.root_path,
                root_relative_path,
                operation,
                &mut reserved_target_paths,
            )
        })
        .collect::<Vec<_>>();

    if !request.dry_run {
        commit_root_trash_plans(&mut plans);
    }

    let items = plans.into_iter().map(|plan| plan.item).collect::<Vec<_>>();
    let completed = items.iter().filter(|item| item.ok).count();
    let total = items.len();

    Ok(RootTrashMutationResponse {
        dry_run: request.dry_run,
        total,
        completed,
        failed: total - completed,
        items,
    })
}

fn root_trash_paged_response(
    entries: Vec<RootTrashEntry>,
    entry_offset: usize,
    entry_limit: Option<usize>,
) -> RootTrashListResponse {
    let total_entries = entries.len();
    let start = entry_offset.min(total_entries);
    let end = match entry_limit {
        Some(limit) => start.saturating_add(limit).min(total_entries),
        None => total_entries,
    };
    let is_truncated = end < total_entries;
    let next_offset = is_truncated.then_some(end);

    RootTrashListResponse {
        entries: entries[start..end].to_vec(),
        is_truncated,
        next_offset,
    }
}

fn collect_root_trash_entries(
    root_path: &Path,
    directory_path: &Path,
    root_relative_path: &RootRelativePath,
    entries: &mut Vec<RootTrashEntry>,
) -> Result<(), RuntimeError> {
    for entry_result in fs::read_dir(directory_path)
        .map_err(|source| RuntimeError::read_directory(directory_path, source))?
    {
        let entry = entry_result
            .map_err(|source| RuntimeError::read_directory_entry(directory_path, source))?;
        let entry_path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|source| RuntimeError::read_directory_entry(&entry_path, source))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let child_root_relative_path = root_relative_path.child(&name);

        if file_type.is_dir() {
            collect_root_trash_entries(root_path, &entry_path, &child_root_relative_path, entries)?;
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|source| RuntimeError::read_directory_entry(&entry_path, source))?;
        let Some(original_root_relative_path) = restore_target_path_for(&child_root_relative_path)
        else {
            continue;
        };
        let timestamp_ms = modified_timestamp_ms(&metadata);

        entries.push(RootTrashEntry {
            name,
            absolute_path: entry_path,
            original_absolute_path: root_path.join(original_root_relative_path.as_path()),
            root_relative_path: child_root_relative_path,
            original_root_relative_path,
            size: metadata.len(),
            last_modified_ms: timestamp_ms,
            deleted_at_ms: timestamp_ms,
        });
    }

    Ok(())
}

fn build_root_trash_plan(
    root_path: &Path,
    root_relative_path: RootRelativePath,
    operation: RootTrashOperation,
    reserved_target_paths: &mut HashSet<PathBuf>,
) -> RootTrashPlan {
    match operation {
        RootTrashOperation::MoveToTrash => {
            build_move_to_root_trash_plan(root_path, root_relative_path, reserved_target_paths)
        }
        RootTrashOperation::Restore => {
            build_restore_from_root_trash_plan(root_path, root_relative_path, reserved_target_paths)
        }
    }
}

fn build_move_to_root_trash_plan(
    root_path: &Path,
    root_relative_path: RootRelativePath,
    reserved_target_paths: &mut HashSet<PathBuf>,
) -> RootTrashPlan {
    let source_absolute_path = root_path.join(root_relative_path.as_path());

    if is_empty_root_relative_path(&root_relative_path) || is_inside_root_trash(&root_relative_path)
    {
        return failed_root_trash_plan(
            root_relative_path,
            source_absolute_path,
            RootTrashFailureReason::InvalidSource,
            "Root Trash move source must be user content outside .trash",
        );
    }

    if !is_supported_mutation_source(&source_absolute_path) {
        return missing_or_unsupported_root_trash_plan(root_relative_path, source_absolute_path);
    }

    let candidate_root_relative_path = root_trash_path_for(&root_relative_path);
    let candidate_absolute_path = root_path.join(candidate_root_relative_path.as_path());
    let target_absolute_path = allocate_deduped_path(
        &source_absolute_path,
        &candidate_absolute_path,
        reserved_target_paths,
    );
    let target_root_relative_path =
        root_relative_path_from_absolute(root_path, &target_absolute_path);

    ok_root_trash_plan(
        root_relative_path,
        source_absolute_path,
        target_root_relative_path,
        target_absolute_path,
    )
}

fn build_restore_from_root_trash_plan(
    root_path: &Path,
    root_relative_path: RootRelativePath,
    reserved_target_paths: &mut HashSet<PathBuf>,
) -> RootTrashPlan {
    let source_absolute_path = root_path.join(root_relative_path.as_path());

    let Some(restored_root_relative_path) = restore_target_path_for(&root_relative_path) else {
        return failed_root_trash_plan(
            root_relative_path,
            source_absolute_path,
            RootTrashFailureReason::InvalidSource,
            "Root Trash restore source must be under .trash",
        );
    };

    if !is_supported_mutation_source(&source_absolute_path) {
        return missing_or_unsupported_root_trash_plan(root_relative_path, source_absolute_path);
    }

    let candidate_absolute_path = root_path.join(restored_root_relative_path.as_path());
    let target_absolute_path = allocate_deduped_path(
        &source_absolute_path,
        &candidate_absolute_path,
        reserved_target_paths,
    );
    let target_root_relative_path =
        root_relative_path_from_absolute(root_path, &target_absolute_path);

    ok_root_trash_plan(
        root_relative_path,
        source_absolute_path,
        target_root_relative_path,
        target_absolute_path,
    )
}

fn commit_root_trash_plans(plans: &mut [RootTrashPlan]) {
    for plan in plans {
        if !plan.item.ok {
            continue;
        }
        let Some(target_absolute_path) = plan.item.next_absolute_path.clone() else {
            fail_root_trash_item(
                &mut plan.item,
                RootTrashFailureReason::MutationFailed,
                "Root Trash target path was not planned",
            );
            continue;
        };

        if let Some(parent) = target_absolute_path.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                fail_root_trash_item(
                    &mut plan.item,
                    RootTrashFailureReason::MutationFailed,
                    &format!("failed to create Root Trash target directory: {error}"),
                );
                continue;
            }
        }

        if target_absolute_path.exists() && target_absolute_path != plan.item.absolute_path {
            fail_root_trash_item(
                &mut plan.item,
                RootTrashFailureReason::TargetExists,
                "Root Trash target path already exists",
            );
            continue;
        }

        if let Err(error) = fs::rename(&plan.item.absolute_path, &target_absolute_path) {
            fail_root_trash_item(
                &mut plan.item,
                RootTrashFailureReason::MutationFailed,
                &format!("Root Trash move failed: {error}"),
            );
        }
    }
}

fn ok_root_trash_plan(
    root_relative_path: RootRelativePath,
    absolute_path: PathBuf,
    next_root_relative_path: RootRelativePath,
    next_absolute_path: PathBuf,
) -> RootTrashPlan {
    RootTrashPlan {
        item: RootTrashMutationItem {
            root_relative_path,
            next_root_relative_path: Some(next_root_relative_path),
            absolute_path,
            next_absolute_path: Some(next_absolute_path),
            ok: true,
            reason: None,
            error: None,
        },
    }
}

fn failed_root_trash_plan(
    root_relative_path: RootRelativePath,
    absolute_path: PathBuf,
    reason: RootTrashFailureReason,
    error: &str,
) -> RootTrashPlan {
    RootTrashPlan {
        item: RootTrashMutationItem {
            root_relative_path,
            next_root_relative_path: None,
            absolute_path,
            next_absolute_path: None,
            ok: false,
            reason: Some(reason),
            error: Some(error.to_owned()),
        },
    }
}

fn fail_root_trash_item(
    item: &mut RootTrashMutationItem,
    reason: RootTrashFailureReason,
    error: &str,
) {
    item.ok = false;
    item.reason = Some(reason);
    item.error = Some(error.to_owned());
}

fn missing_or_unsupported_root_trash_plan(
    root_relative_path: RootRelativePath,
    absolute_path: PathBuf,
) -> RootTrashPlan {
    match fs::symlink_metadata(&absolute_path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => failed_root_trash_plan(
            root_relative_path,
            absolute_path,
            RootTrashFailureReason::SourceNotFound,
            "Root Trash source was not found",
        ),
        Err(error) => failed_root_trash_plan(
            root_relative_path,
            absolute_path,
            RootTrashFailureReason::MutationFailed,
            &format!("failed to inspect Root Trash source: {error}"),
        ),
        Ok(_) => failed_root_trash_plan(
            root_relative_path,
            absolute_path,
            RootTrashFailureReason::UnsupportedKind,
            "Root Trash only supports files and directories",
        ),
    }
}

fn is_supported_mutation_source(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    metadata.is_file() || metadata.is_dir()
}

fn allocate_deduped_path(
    source_absolute_path: &Path,
    candidate_absolute_path: &Path,
    reserved_target_paths: &mut HashSet<PathBuf>,
) -> PathBuf {
    let mut attempt_path = candidate_absolute_path.to_path_buf();
    let mut suffix_index = 1;

    while attempt_path != source_absolute_path
        && (reserved_target_paths.contains(&attempt_path) || attempt_path.exists())
    {
        attempt_path = path_with_dedupe_suffix(candidate_absolute_path, suffix_index);
        suffix_index += 1;
    }

    reserved_target_paths.insert(attempt_path.clone());
    attempt_path
}

fn path_with_dedupe_suffix(path: &Path, suffix_index: usize) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("item");
    let extension = path.extension().and_then(|value| value.to_str());
    let name = match extension {
        Some(extension) if !extension.is_empty() => {
            format!("{stem} ({suffix_index}).{extension}")
        }
        _ => format!("{stem} ({suffix_index})"),
    };

    parent.join(name)
}

fn root_trash_path_for(root_relative_path: &RootRelativePath) -> RootRelativePath {
    RootRelativePath::try_from(
        PathBuf::from(ROOT_TRASH_FOLDER_NAME).join(root_relative_path.as_path()),
    )
    .expect("Root Trash target path should stay inside the Local Root")
}

fn restore_target_path_for(root_relative_path: &RootRelativePath) -> Option<RootRelativePath> {
    let restored_path = root_relative_path
        .as_path()
        .strip_prefix(ROOT_TRASH_FOLDER_NAME)
        .ok()?;
    if restored_path.as_os_str().is_empty() {
        return None;
    }
    RootRelativePath::try_from(restored_path.to_path_buf()).ok()
}

fn root_relative_path_from_absolute(root_path: &Path, absolute_path: &Path) -> RootRelativePath {
    let relative_path = absolute_path
        .strip_prefix(root_path)
        .expect("Root Trash target path should stay inside the Local Root");
    RootRelativePath::try_from(relative_path.to_path_buf())
        .expect("Root Trash target path should be Root-relative")
}

fn is_empty_root_relative_path(root_relative_path: &RootRelativePath) -> bool {
    root_relative_path.as_path().as_os_str().is_empty()
}

fn is_inside_root_trash(root_relative_path: &RootRelativePath) -> bool {
    root_relative_path
        .as_path()
        .starts_with(ROOT_TRASH_FOLDER_NAME)
}
