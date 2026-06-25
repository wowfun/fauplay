mod listing;
mod mutation;
mod paths;

pub(super) const ROOT_TRASH_FOLDER_NAME: &str = ".trash";

pub(crate) use listing::list_root_trash;
pub(crate) use mutation::{move_to_root_trash, restore_from_root_trash};
