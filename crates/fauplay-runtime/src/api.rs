use std::fmt;
use std::io;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListDirectoryRequest {
    pub root_path: PathBuf,
    pub root_relative_path: RootRelativePath,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListDirectoryResponse {
    pub entries: Vec<DirectoryEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectoryEntry {
    pub name: String,
    pub root_relative_path: RootRelativePath,
    pub kind: DirectoryEntryKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirectoryEntryKind {
    Directory,
    File,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RootRelativePath {
    path: PathBuf,
}

impl RootRelativePath {
    pub fn root() -> Self {
        Self {
            path: PathBuf::new(),
        }
    }

    pub fn as_path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn child(&self, name: &str) -> Self {
        let mut path = self.path.clone();
        path.push(name);
        Self { path }
    }
}

impl TryFrom<PathBuf> for RootRelativePath {
    type Error = RuntimeError;

    fn try_from(path: PathBuf) -> Result<Self, Self::Error> {
        let mut normalized = PathBuf::new();

        for component in path.components() {
            match component {
                Component::Normal(part) => normalized.push(part),
                Component::CurDir => {}
                Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                    return Err(RuntimeError::invalid_root_relative_path(&path));
                }
            }
        }

        Ok(Self { path: normalized })
    }
}

impl TryFrom<&str> for RootRelativePath {
    type Error = RuntimeError;

    fn try_from(path: &str) -> Result<Self, Self::Error> {
        PathBuf::from(path).try_into()
    }
}

impl fmt::Display for RootRelativePath {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.path.display())
    }
}

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

    pub(crate) fn network(message: &str, source: io::Error) -> Self {
        Self {
            message: format!("{message}: {source}"),
        }
    }

    fn invalid_root_relative_path(path: &Path) -> Self {
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
