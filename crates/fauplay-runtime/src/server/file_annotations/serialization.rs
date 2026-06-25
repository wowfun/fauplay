use crate::FileAnnotationFile;

use super::super::escape_json_string;

pub(super) fn file_annotation_file_json(file: FileAnnotationFile) -> String {
    let root_relative_path = file.root_relative_path.to_string();
    let tags = file
        .tags
        .into_iter()
        .map(|tag| {
            format!(
                "{{\"key\":\"{}\",\"value\":\"{}\",\"source\":\"{}\",\"appliedAt\":{},\"updatedAt\":{}}}",
                escape_json_string(&tag.key),
                escape_json_string(&tag.value),
                escape_json_string(&tag.source),
                tag.applied_at_ms,
                tag.applied_at_ms,
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"absolutePath\":\"{}\",\"relativePath\":\"{}\",\"rootRelativePath\":\"{}\",\"tags\":[{tags}]}}",
        escape_json_string(&file.absolute_path.display().to_string()),
        escape_json_string(&root_relative_path),
        escape_json_string(&root_relative_path),
    )
}
