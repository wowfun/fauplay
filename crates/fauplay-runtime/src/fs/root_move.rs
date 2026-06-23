use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use regex::{Regex, RegexBuilder};

use crate::{
    RootMoveBatchFailureReason, RootMoveBatchItem, RootMoveBatchRequest, RootMoveBatchResponse,
    RootMoveFailureReason, RootMoveRequest, RootMoveResponse, RootMoveRule, RootMoveSearchMode,
    RootRelativePath, RuntimeError,
};

use super::{is_empty_root_relative_path, is_inside_root_trash, is_supported_mutation_source};

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
