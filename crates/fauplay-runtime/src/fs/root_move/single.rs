use std::fs;
use std::io;
use std::path::Path;

use crate::{RootMoveFailureReason, RootMoveRequest, RootMoveResponse, RuntimeError};

use super::{is_invalid_root_move_source, is_invalid_root_move_target};
use crate::fs::is_supported_mutation_source;

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
