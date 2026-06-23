use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use regex::{Regex, RegexBuilder};

use crate::{
    DirectoryEntry, DirectoryEntryKind, DuplicateFile, DuplicateFilesRequest,
    DuplicateFilesResponse, DuplicateSeedSkip, DuplicateSeedSkipReason, DuplicateSet,
    FileMetadataRequest, FileMetadataResponse, ListDirectoryRequest, ListDirectoryResponse,
    ListingEntryFilter, ListingQuery, ListingSortDirection, ListingSortKey,
    RootMoveBatchFailureReason, RootMoveBatchItem, RootMoveBatchRequest, RootMoveBatchResponse,
    RootMoveFailureReason, RootMoveRequest, RootMoveResponse, RootMoveRule, RootMoveSearchMode,
    RootRelativePath, RootTrashEntry, RootTrashFailureReason, RootTrashListRequest,
    RootTrashListResponse, RootTrashMutationItem, RootTrashMutationResponse, RootTrashRequest,
    RuntimeError,
};

const ROOT_TRASH_FOLDER_NAME: &str = ".trash";
const RESERVED_FOLDER_NAMES: &[&str] = &[ROOT_TRASH_FOLDER_NAME];
const DIRECTORY_ENTRY_COUNT_LIMIT: usize = 100;
const DUPLICATE_HASH_CHUNK_SIZE: usize = 64 * 1024;
const FNV_OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

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

pub(crate) fn read_file_metadata(
    request: FileMetadataRequest,
) -> Result<FileMetadataResponse, RuntimeError> {
    let file_path = request.root_path.join(request.root_relative_path.as_path());
    let metadata =
        fs::metadata(&file_path).map_err(|source| RuntimeError::read_file(&file_path, source))?;

    Ok(FileMetadataResponse {
        root_relative_path: request.root_relative_path,
        size: metadata.len(),
        last_modified_ms: modified_timestamp_ms(&metadata),
    })
}

pub(crate) fn find_duplicate_files(
    request: DuplicateFilesRequest,
) -> Result<DuplicateFilesResponse, RuntimeError> {
    let seed_root_relative_paths = dedupe_root_relative_paths(request.seed_root_relative_paths);
    let seed_count = seed_root_relative_paths.len();
    let files = collect_duplicate_files(&request.root_path)?;
    let file_by_root_relative_path = files
        .iter()
        .map(|file| (file.root_relative_path.clone(), file.clone()))
        .collect::<HashMap<_, _>>();
    let duplicate_files_by_fingerprint = duplicate_files_by_fingerprint(files)?;

    let mut duplicate_sets_by_fingerprint: HashMap<(u64, u64), DuplicateSet> = HashMap::new();
    let mut duplicate_set_order = Vec::new();
    let mut skipped_seeds = Vec::new();

    for seed_root_relative_path in seed_root_relative_paths {
        let Some(seed_file) = file_by_root_relative_path.get(&seed_root_relative_path) else {
            skipped_seeds.push(DuplicateSeedSkip {
                reason: duplicate_seed_skip_reason(&request.root_path, &seed_root_relative_path),
                root_relative_path: seed_root_relative_path,
            });
            continue;
        };
        let seed_fingerprint = file_content_fingerprint(&seed_file.absolute_path)?;
        let fingerprint = (seed_file.size, seed_fingerprint);
        let Some(duplicate_files) = duplicate_files_by_fingerprint.get(&fingerprint) else {
            continue;
        };
        if duplicate_files.len() <= 1 {
            continue;
        }

        if let Some(duplicate_set) = duplicate_sets_by_fingerprint.get_mut(&fingerprint) {
            duplicate_set
                .seed_root_relative_paths
                .push(seed_root_relative_path);
            continue;
        }

        duplicate_set_order.push(fingerprint);
        duplicate_sets_by_fingerprint.insert(
            fingerprint,
            DuplicateSet {
                set_id: format!("content:{}:{:016x}", fingerprint.0, fingerprint.1),
                seed_root_relative_paths: vec![seed_root_relative_path],
                files: duplicate_files.clone(),
            },
        );
    }

    let duplicate_sets = duplicate_set_order
        .into_iter()
        .filter_map(|fingerprint| duplicate_sets_by_fingerprint.remove(&fingerprint))
        .collect();

    Ok(DuplicateFilesResponse {
        seed_count,
        skipped_seeds,
        duplicate_sets,
    })
}

fn dedupe_root_relative_paths(paths: Vec<RootRelativePath>) -> Vec<RootRelativePath> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();
    for path in paths {
        if seen.insert(path.clone()) {
            deduped.push(path);
        }
    }
    deduped
}

fn collect_duplicate_files(root_path: &Path) -> Result<Vec<DuplicateFile>, RuntimeError> {
    let mut entries = Vec::new();
    collect_flattened_file_entries(root_path, &RootRelativePath::root(), &mut entries)?;

    let mut files = entries
        .into_iter()
        .map(|entry| DuplicateFile {
            name: entry.name,
            absolute_path: root_path.join(entry.root_relative_path.as_path()),
            root_relative_path: entry.root_relative_path,
            size: entry.size.unwrap_or(0),
            last_modified_ms: entry.last_modified_ms,
        })
        .collect::<Vec<_>>();
    files.sort_by(|left, right| {
        left.root_relative_path
            .to_string()
            .cmp(&right.root_relative_path.to_string())
    });

    Ok(files)
}

fn duplicate_files_by_fingerprint(
    files: Vec<DuplicateFile>,
) -> Result<HashMap<(u64, u64), Vec<DuplicateFile>>, RuntimeError> {
    let mut files_by_size: HashMap<u64, Vec<DuplicateFile>> = HashMap::new();
    for file in files {
        files_by_size.entry(file.size).or_default().push(file);
    }

    let mut files_by_fingerprint: HashMap<(u64, u64), Vec<DuplicateFile>> = HashMap::new();
    for (size, size_matches) in files_by_size {
        if size_matches.len() <= 1 {
            continue;
        }
        for file in size_matches {
            let fingerprint = file_content_fingerprint(&file.absolute_path)?;
            files_by_fingerprint
                .entry((size, fingerprint))
                .or_default()
                .push(file);
        }
    }

    files_by_fingerprint.retain(|_, files| files.len() > 1);
    for files in files_by_fingerprint.values_mut() {
        files.sort_by(|left, right| {
            left.root_relative_path
                .to_string()
                .cmp(&right.root_relative_path.to_string())
        });
    }

    Ok(files_by_fingerprint)
}

fn file_content_fingerprint(path: &Path) -> Result<u64, RuntimeError> {
    let mut file = fs::File::open(path).map_err(|source| RuntimeError::read_file(path, source))?;
    let mut buffer = [0_u8; DUPLICATE_HASH_CHUNK_SIZE];
    let mut fingerprint = FNV_OFFSET_BASIS;

    loop {
        let bytes_read = file
            .read(&mut buffer)
            .map_err(|source| RuntimeError::read_file(path, source))?;
        if bytes_read == 0 {
            return Ok(fingerprint);
        }
        for byte in &buffer[..bytes_read] {
            fingerprint ^= u64::from(*byte);
            fingerprint = fingerprint.wrapping_mul(FNV_PRIME);
        }
    }
}

fn duplicate_seed_skip_reason(
    root_path: &Path,
    root_relative_path: &RootRelativePath,
) -> DuplicateSeedSkipReason {
    let absolute_path = root_path.join(root_relative_path.as_path());
    match fs::symlink_metadata(absolute_path) {
        Ok(metadata) if metadata.is_file() => DuplicateSeedSkipReason::NotFile,
        Ok(_) => DuplicateSeedSkipReason::NotFile,
        Err(_) => DuplicateSeedSkipReason::SourceNotFound,
    }
}

pub(crate) fn move_root_path(request: RootMoveRequest) -> Result<RootMoveResponse, RuntimeError> {
    let source_absolute_path = request
        .root_path
        .join(request.source_root_relative_path.as_path());
    let target_absolute_path = request
        .root_path
        .join(request.target_root_relative_path.as_path());
    let mut response = RootMoveResponse {
        dry_run: request.dry_run,
        source_root_relative_path: request.source_root_relative_path,
        target_root_relative_path: request.target_root_relative_path,
        absolute_path: source_absolute_path,
        target_absolute_path,
        ok: true,
        reason: None,
        error: None,
    };

    if is_invalid_root_move_source(&response.source_root_relative_path) {
        fail_root_move_response(
            &mut response,
            RootMoveFailureReason::InvalidSource,
            "Root Move source must be user content outside .trash",
        );
        return Ok(response);
    }

    if is_invalid_root_move_target(&response.target_root_relative_path) {
        fail_root_move_response(
            &mut response,
            RootMoveFailureReason::InvalidTarget,
            "Root Move target must be user content outside .trash",
        );
        return Ok(response);
    }

    if response
        .target_absolute_path
        .starts_with(&response.absolute_path)
        && response.target_absolute_path != response.absolute_path
    {
        fail_root_move_response(
            &mut response,
            RootMoveFailureReason::InvalidTarget,
            "Root Move target must not be inside the source path",
        );
        return Ok(response);
    }

    if !is_supported_mutation_source(&response.absolute_path) {
        fail_missing_or_unsupported_root_move_response(&mut response);
        return Ok(response);
    }

    if response.target_absolute_path == response.absolute_path {
        return Ok(response);
    }

    if !root_move_target_parent_exists(&response.target_absolute_path) {
        fail_root_move_response(
            &mut response,
            RootMoveFailureReason::InvalidTarget,
            "Root Move target parent does not exist",
        );
        return Ok(response);
    }

    if response.target_absolute_path.exists() {
        fail_root_move_response(
            &mut response,
            RootMoveFailureReason::TargetExists,
            "Root Move target already exists",
        );
        return Ok(response);
    }

    if !request.dry_run {
        if let Err(error) = fs::rename(&response.absolute_path, &response.target_absolute_path) {
            fail_root_move_response(
                &mut response,
                RootMoveFailureReason::MutationFailed,
                &format!("Root Move failed: {error}"),
            );
        }
    }

    Ok(response)
}

pub(crate) fn move_root_path_batch(
    request: RootMoveBatchRequest,
) -> Result<RootMoveBatchResponse, RuntimeError> {
    let compiled_rule = CompiledRootMoveRule::new(&request.rule)?;
    let root_base_name = root_base_name(&request.root_path);
    let mut reserved_target_paths = HashSet::new();
    let mut counter_value = request.rule.counter_start;
    let mut items = Vec::new();

    for root_relative_path in request.source_root_relative_paths {
        let (item, next_counter_value) = build_root_move_batch_item(
            &request.root_path,
            root_relative_path,
            &compiled_rule,
            counter_value,
            &root_base_name,
            &mut reserved_target_paths,
        );
        counter_value = next_counter_value;
        items.push(item);
    }

    if !request.dry_run {
        commit_root_move_batch_items(&mut items);
    }

    let total = items.len();
    let moved = items.iter().filter(|item| item.ok && !item.skipped).count();
    let skipped = items.iter().filter(|item| item.skipped).count();
    let failed = total - moved - skipped;

    Ok(RootMoveBatchResponse {
        dry_run: request.dry_run,
        total,
        moved,
        skipped,
        failed,
        items,
    })
}

struct CompiledRootMoveRule {
    name_mask: String,
    find_text: String,
    replace_text: String,
    search_mode: RootMoveSearchMode,
    search_regex: Option<Regex>,
    counter_step: i64,
    counter_pad: usize,
}

impl CompiledRootMoveRule {
    fn new(rule: &RootMoveRule) -> Result<Self, RuntimeError> {
        if rule.name_mask.is_empty() {
            return Err(RuntimeError::invalid_root_move_rule(
                "name mask must be non-empty",
            ));
        }
        if rule.name_mask == "[N]" && rule.find_text.is_empty() {
            return Err(RuntimeError::invalid_root_move_rule(
                "at least one Root Move rule is required",
            ));
        }
        if rule.counter_start < 1 {
            return Err(RuntimeError::invalid_root_move_rule(
                "counter start must be >= 1",
            ));
        }
        if rule.counter_step < 1 {
            return Err(RuntimeError::invalid_root_move_rule(
                "counter step must be >= 1",
            ));
        }

        let search_regex = match rule.search_mode {
            RootMoveSearchMode::Plain => None,
            RootMoveSearchMode::Regex if rule.find_text.is_empty() => None,
            RootMoveSearchMode::Regex => {
                Some(build_root_move_regex(&rule.find_text, &rule.regex_flags)?)
            }
        };

        Ok(Self {
            name_mask: rule.name_mask.clone(),
            find_text: rule.find_text.clone(),
            replace_text: rule.replace_text.clone(),
            search_mode: rule.search_mode,
            search_regex,
            counter_step: rule.counter_step,
            counter_pad: rule.counter_pad,
        })
    }
}

fn build_root_move_regex(find_text: &str, flags: &str) -> Result<Regex, RuntimeError> {
    let flags = if flags.trim().is_empty() {
        "g"
    } else {
        flags.trim()
    };
    let mut builder = RegexBuilder::new(find_text);

    for flag in flags.chars() {
        match flag {
            'g' | 'u' => {}
            'i' => {
                builder.case_insensitive(true);
            }
            'm' => {
                builder.multi_line(true);
            }
            's' => {
                builder.dot_matches_new_line(true);
            }
            _ => {
                return Err(RuntimeError::invalid_root_move_rule(
                    "regex flags must use g, i, m, s, or u",
                ));
            }
        }
    }

    builder
        .build()
        .map_err(|source| RuntimeError::invalid_root_move_rule(&source.to_string()))
}

fn build_root_move_batch_item(
    root_path: &Path,
    root_relative_path: RootRelativePath,
    rule: &CompiledRootMoveRule,
    counter_value: i64,
    root_base_name: &str,
    reserved_target_paths: &mut HashSet<PathBuf>,
) -> (RootMoveBatchItem, i64) {
    let absolute_path = root_path.join(root_relative_path.as_path());
    let mut item = RootMoveBatchItem {
        root_relative_path,
        next_root_relative_path: None,
        absolute_path,
        next_absolute_path: None,
        ok: true,
        skipped: false,
        reason: None,
        error: None,
    };

    if is_invalid_root_move_source(&item.root_relative_path) {
        fail_root_move_batch_item(
            &mut item,
            RootMoveBatchFailureReason::InvalidPath,
            "Root Move Batch source must be user content outside .trash",
        );
        return (item, counter_value);
    }

    let metadata = match fs::symlink_metadata(&item.absolute_path) {
        Ok(metadata) if metadata.is_file() => metadata,
        Ok(_) => {
            fail_root_move_batch_item(
                &mut item,
                RootMoveBatchFailureReason::UnsupportedKind,
                "Root Move Batch only supports files",
            );
            return (item, counter_value);
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fail_root_move_batch_item(
                &mut item,
                RootMoveBatchFailureReason::SourceNotFound,
                "Root Move Batch source was not found",
            );
            return (item, counter_value);
        }
        Err(error) => {
            fail_root_move_batch_item(
                &mut item,
                RootMoveBatchFailureReason::MutationFailed,
                &format!("failed to inspect Root Move Batch source: {error}"),
            );
            return (item, counter_value);
        }
    };

    if metadata.is_dir() {
        fail_root_move_batch_item(
            &mut item,
            RootMoveBatchFailureReason::UnsupportedKind,
            "Root Move Batch only supports files",
        );
        return (item, counter_value);
    }

    let Some(source_name) = item
        .absolute_path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
    else {
        fail_root_move_batch_item(
            &mut item,
            RootMoveBatchFailureReason::InvalidPath,
            "Root Move Batch source name is invalid",
        );
        return (item, counter_value);
    };

    let target_name = match render_root_move_target_name(
        &source_name,
        &item.root_relative_path,
        rule,
        counter_value,
        root_base_name,
    ) {
        Ok(target_name) => target_name,
        Err(error) => {
            fail_root_move_batch_item(&mut item, RootMoveBatchFailureReason::InvalidTarget, &error);
            return (item, counter_value);
        }
    };
    let next_counter_value = counter_value.saturating_add(rule.counter_step);

    let Some(parent_path) = item.absolute_path.parent() else {
        fail_root_move_batch_item(
            &mut item,
            RootMoveBatchFailureReason::InvalidPath,
            "Root Move Batch source parent is invalid",
        );
        return (item, next_counter_value);
    };
    let candidate_absolute_path = parent_path.join(target_name);
    let target_absolute_path = allocate_deduped_root_move_target_path(
        &item.absolute_path,
        &candidate_absolute_path,
        reserved_target_paths,
    );

    let next_root_relative_path =
        match try_root_relative_path_from_absolute(root_path, &target_absolute_path) {
            Some(path) => path,
            None => {
                fail_root_move_batch_item(
                    &mut item,
                    RootMoveBatchFailureReason::InvalidTarget,
                    "Root Move Batch target escapes the Local Root",
                );
                return (item, next_counter_value);
            }
        };

    item.next_root_relative_path = Some(next_root_relative_path);
    item.next_absolute_path = Some(target_absolute_path.clone());
    if target_absolute_path == item.absolute_path {
        item.skipped = true;
        item.reason = Some(RootMoveBatchFailureReason::NoChange);
    }
    reserved_target_paths.insert(target_absolute_path);

    (item, next_counter_value)
}

fn render_root_move_target_name(
    source_name: &str,
    root_relative_path: &RootRelativePath,
    rule: &CompiledRootMoveRule,
    counter_value: i64,
    root_base_name: &str,
) -> Result<String, String> {
    let source_path = Path::new(source_name);
    let source_base_name = source_path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| source_name.to_owned());
    let extension = source_path
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    let segments = root_relative_path
        .as_path()
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>();
    let parent_name = if segments.len() >= 2 {
        segments[segments.len() - 2].clone()
    } else {
        root_base_name.to_owned()
    };
    let grandparent_name = if segments.len() >= 3 {
        segments[segments.len() - 3].clone()
    } else {
        String::new()
    };

    let mut next_base_name = rule
        .name_mask
        .replace("[N]", &source_base_name)
        .replace("[P]", &parent_name)
        .replace("[G]", &grandparent_name)
        .replace(
            "[C]",
            &format_counter_value(counter_value, rule.counter_pad),
        );

    next_base_name = match rule.search_mode {
        RootMoveSearchMode::Plain => {
            if rule.find_text.is_empty() {
                next_base_name
            } else {
                next_base_name.replace(&rule.find_text, &rule.replace_text)
            }
        }
        RootMoveSearchMode::Regex => match rule.search_regex.as_ref() {
            Some(search_regex) => search_regex
                .replace_all(&next_base_name, rule.replace_text.as_str())
                .into_owned(),
            None => next_base_name,
        },
    };

    if next_base_name.is_empty() {
        return Err("Root Move Batch target basename is empty".to_owned());
    }
    if next_base_name.contains('/') || next_base_name.contains('\\') {
        return Err("Root Move Batch target basename contains path separators".to_owned());
    }

    Ok(format!("{next_base_name}{extension}"))
}

fn format_counter_value(counter_value: i64, counter_pad: usize) -> String {
    let raw = counter_value.to_string();
    if counter_pad == 0 {
        return raw;
    }
    format!("{raw:0>counter_pad$}")
}

fn root_base_name(root_path: &Path) -> String {
    root_path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| root_path.display().to_string())
}

fn allocate_deduped_root_move_target_path(
    source_absolute_path: &Path,
    candidate_absolute_path: &Path,
    reserved_target_paths: &HashSet<PathBuf>,
) -> PathBuf {
    let Some(parent) = candidate_absolute_path.parent() else {
        return candidate_absolute_path.to_path_buf();
    };
    let stem = candidate_absolute_path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let extension = candidate_absolute_path
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    let mut attempt_path = candidate_absolute_path.to_path_buf();
    let mut suffix_index = 1;

    loop {
        if attempt_path == source_absolute_path {
            return attempt_path;
        }
        if !reserved_target_paths.contains(&attempt_path) && !attempt_path.exists() {
            return attempt_path;
        }

        attempt_path = parent.join(format!("{stem} ({suffix_index}){extension}"));
        suffix_index += 1;
    }
}

fn try_root_relative_path_from_absolute(
    root_path: &Path,
    absolute_path: &Path,
) -> Option<RootRelativePath> {
    let relative_path = absolute_path.strip_prefix(root_path).ok()?.to_path_buf();
    RootRelativePath::try_from(relative_path).ok()
}

fn commit_root_move_batch_items(items: &mut [RootMoveBatchItem]) {
    for item in items {
        if !item.ok || item.skipped {
            continue;
        }
        let Some(target_absolute_path) = item.next_absolute_path.as_ref() else {
            fail_root_move_batch_item(
                item,
                RootMoveBatchFailureReason::InvalidTarget,
                "Root Move Batch target was not planned",
            );
            continue;
        };
        if target_absolute_path.exists() {
            fail_root_move_batch_item(
                item,
                RootMoveBatchFailureReason::TargetExists,
                "Root Move Batch target already exists",
            );
            continue;
        }
        if let Err(error) = fs::rename(&item.absolute_path, target_absolute_path) {
            fail_root_move_batch_item(
                item,
                RootMoveBatchFailureReason::MutationFailed,
                &format!("Root Move Batch failed: {error}"),
            );
        }
    }
}

fn fail_root_move_batch_item(
    item: &mut RootMoveBatchItem,
    reason: RootMoveBatchFailureReason,
    error: &str,
) {
    item.ok = false;
    item.skipped = false;
    item.reason = Some(reason);
    item.error = Some(error.to_owned());
}

fn is_invalid_root_move_source(root_relative_path: &RootRelativePath) -> bool {
    is_empty_root_relative_path(root_relative_path) || is_inside_root_trash(root_relative_path)
}

fn is_invalid_root_move_target(root_relative_path: &RootRelativePath) -> bool {
    is_empty_root_relative_path(root_relative_path) || is_inside_root_trash(root_relative_path)
}

fn root_move_target_parent_exists(target_absolute_path: &Path) -> bool {
    target_absolute_path
        .parent()
        .is_some_and(|parent| parent.is_dir())
}

fn fail_missing_or_unsupported_root_move_response(response: &mut RootMoveResponse) {
    match fs::symlink_metadata(&response.absolute_path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => fail_root_move_response(
            response,
            RootMoveFailureReason::SourceNotFound,
            "Root Move source was not found",
        ),
        Err(error) => fail_root_move_response(
            response,
            RootMoveFailureReason::MutationFailed,
            &format!("failed to inspect Root Move source: {error}"),
        ),
        Ok(_) => fail_root_move_response(
            response,
            RootMoveFailureReason::UnsupportedKind,
            "Root Move only supports files and directories",
        ),
    }
}

fn fail_root_move_response(
    response: &mut RootMoveResponse,
    reason: RootMoveFailureReason,
    error: &str,
) {
    response.ok = false;
    response.reason = Some(reason);
    response.error = Some(error.to_owned());
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
        let entry_count = if kind == DirectoryEntryKind::Directory {
            Some(directory_entry_count(&entry_path)?)
        } else {
            None
        };

        entries.push(DirectoryEntry {
            root_relative_path: root_relative_path.child(&name),
            name,
            kind,
            is_empty: entry_count.map(|count| count == 0),
            entry_count,
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
            entry_count: None,
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

fn directory_entry_count(path: &Path) -> Result<usize, RuntimeError> {
    let mut count = 0;
    for entry_result in
        fs::read_dir(path).map_err(|source| RuntimeError::read_directory(path, source))?
    {
        let entry =
            entry_result.map_err(|source| RuntimeError::read_directory_entry(path, source))?;
        let file_type = entry
            .file_type()
            .map_err(|source| RuntimeError::read_directory_entry(&entry.path(), source))?;
        if !(file_type.is_dir() || file_type.is_file()) {
            continue;
        }
        if file_type.is_dir() && is_reserved_folder_name(&entry.file_name().to_string_lossy()) {
            continue;
        }

        count += 1;
        if count >= DIRECTORY_ENTRY_COUNT_LIMIT {
            return Ok(count);
        }
    }

    Ok(count)
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
