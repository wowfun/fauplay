mod mutation;
mod query;
mod read;
mod rebind;
mod serialization;

use super::json_string_field;

pub(in crate::server) use mutation::{
    handle_bind_file_annotation_tag_json, handle_set_file_annotation_json,
    handle_unbind_file_annotation_tag_json,
};
pub(in crate::server) use query::{
    handle_list_annotation_tag_options_json, handle_query_file_annotations_json,
};
pub(in crate::server) use read::handle_read_file_annotation_json;
pub(in crate::server) use rebind::handle_rebind_file_annotation_paths_json;

fn json_file_annotation_relative_path(payload: &serde_json::Value) -> Option<&str> {
    json_string_field(payload, "relativePath")
        .or_else(|| json_string_field(payload, "rootRelativePath"))
}
