use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::Path;

use crate::{
    DuplicateFile, DuplicateFilesRequest, DuplicateFilesResponse, DuplicateSeedSkip,
    DuplicateSeedSkipReason, DuplicateSet, RootRelativePath, RuntimeError,
};

use super::collect_flattened_file_entries;

const DUPLICATE_HASH_CHUNK_SIZE: usize = 64 * 1024;
const FNV_OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

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
