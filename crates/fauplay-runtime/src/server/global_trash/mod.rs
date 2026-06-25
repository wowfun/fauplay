mod file_access;
mod listing;
mod mutation;

pub(in crate::server) use file_access::{
    handle_global_trash_file_content, handle_global_trash_file_metadata,
    handle_global_trash_text_preview,
};
pub(in crate::server) use listing::handle_list_global_trash;
pub(in crate::server) use mutation::{handle_move_to_global_trash, handle_restore_global_trash};
