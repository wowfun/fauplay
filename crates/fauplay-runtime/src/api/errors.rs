use std::fmt;
use std::io;
use std::path::Path;

#[derive(Debug)]
pub struct RuntimeError {
    message: String,
}

impl RuntimeError {
    pub(crate) fn read_directory(path: &Path, source: io::Error) -> Self {
        Self {
            message: format!("failed to read directory {}: {source}", path.display()),
        }
    }

    pub(crate) fn read_directory_entry(path: &Path, source: io::Error) -> Self {
        Self {
            message: format!(
                "failed to read directory entry {}: {source}",
                path.display()
            ),
        }
    }

    pub(crate) fn read_file(path: &Path, source: io::Error) -> Self {
        Self {
            message: format!("failed to read file {}: {source}", path.display()),
        }
    }

    pub(crate) fn write_file(path: &Path, source: io::Error) -> Self {
        Self {
            message: format!("failed to write file {}: {source}", path.display()),
        }
    }

    pub(crate) fn invalid_config(path: &Path, message: &str) -> Self {
        Self {
            message: format!(
                "invalid global shortcut config {}: {message}",
                path.display()
            ),
        }
    }

    pub(crate) fn invalid_runtime_home_file(path: &Path, message: &str) -> Self {
        Self {
            message: format!("invalid Runtime Home file {}: {message}", path.display()),
        }
    }

    pub(crate) fn invalid_root_move_rule(message: &str) -> Self {
        Self {
            message: format!("invalid Root Move rule: {message}"),
        }
    }

    pub(crate) fn invalid_file_annotation(message: &str) -> Self {
        Self {
            message: format!("invalid File Annotation: {message}"),
        }
    }

    pub(crate) fn invalid_detected_face(message: &str) -> Self {
        Self {
            message: format!("invalid Detected Face: {message}"),
        }
    }

    pub(crate) fn runtime_capability(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    pub(crate) fn invalid_local_root_binding(message: &str) -> Self {
        Self {
            message: format!("invalid Local Root Binding: {message}"),
        }
    }

    pub(crate) fn network(message: &str, source: io::Error) -> Self {
        Self {
            message: format!("{message}: {source}"),
        }
    }

    pub(crate) fn invalid_root_relative_path(path: &Path) -> Self {
        Self {
            message: format!(
                "invalid Root-relative Path {}: path must stay within the Local Root",
                path.display()
            ),
        }
    }
}

impl fmt::Display for RuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for RuntimeError {}
