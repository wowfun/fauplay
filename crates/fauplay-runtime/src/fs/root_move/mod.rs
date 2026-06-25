use crate::RootRelativePath;

mod batch;
mod single;

pub(crate) use batch::move_root_path_batch;
pub(crate) use single::move_root_path;

use super::{is_empty_root_relative_path, is_inside_root_trash};

fn is_invalid_root_move_source(root_relative_path: &RootRelativePath) -> bool {
    is_empty_root_relative_path(root_relative_path) || is_inside_root_trash(root_relative_path)
}

fn is_invalid_root_move_target(root_relative_path: &RootRelativePath) -> bool {
    is_empty_root_relative_path(root_relative_path) || is_inside_root_trash(root_relative_path)
}
