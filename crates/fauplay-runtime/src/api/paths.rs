use std::fmt;
use std::path::{Component, Path, PathBuf};

use super::RuntimeError;

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
