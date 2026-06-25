use std::path::Path;

use regex::{Regex, RegexBuilder};

use crate::{RootMoveRule, RootMoveSearchMode, RootRelativePath, RuntimeError};

pub(super) struct CompiledRootMoveRule {
    name_mask: String,
    find_text: String,
    replace_text: String,
    search_mode: RootMoveSearchMode,
    search_regex: Option<Regex>,
    counter_step: i64,
    counter_pad: usize,
}

impl CompiledRootMoveRule {
    pub(super) fn new(rule: &RootMoveRule) -> Result<Self, RuntimeError> {
        if rule.name_mask.is_empty() {
            return Err(RuntimeError::invalid_root_move_rule(
                "name mask must be non-empty",
            ));
        }
        if rule.name_mask == "[N]" && rule.find_text.is_empty() {
            return Err(RuntimeError::invalid_root_move_rule(
                "at least one Root Move rule is required",
            ));
        }
        if rule.counter_start < 1 {
            return Err(RuntimeError::invalid_root_move_rule(
                "counter start must be >= 1",
            ));
        }
        if rule.counter_step < 1 {
            return Err(RuntimeError::invalid_root_move_rule(
                "counter step must be >= 1",
            ));
        }

        let search_regex = match rule.search_mode {
            RootMoveSearchMode::Plain => None,
            RootMoveSearchMode::Regex if rule.find_text.is_empty() => None,
            RootMoveSearchMode::Regex => {
                Some(build_root_move_regex(&rule.find_text, &rule.regex_flags)?)
            }
        };

        Ok(Self {
            name_mask: rule.name_mask.clone(),
            find_text: rule.find_text.clone(),
            replace_text: rule.replace_text.clone(),
            search_mode: rule.search_mode,
            search_regex,
            counter_step: rule.counter_step,
            counter_pad: rule.counter_pad,
        })
    }

    pub(super) fn counter_step(&self) -> i64 {
        self.counter_step
    }

    pub(super) fn render_target_name(
        &self,
        source_name: &str,
        root_relative_path: &RootRelativePath,
        counter_value: i64,
        root_base_name: &str,
    ) -> Result<String, String> {
        let source_path = Path::new(source_name);
        let source_base_name = source_path
            .file_stem()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| source_name.to_owned());
        let extension = source_path
            .extension()
            .map(|value| format!(".{}", value.to_string_lossy()))
            .unwrap_or_default();
        let segments = root_relative_path
            .as_path()
            .components()
            .filter_map(|component| match component {
                std::path::Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
                _ => None,
            })
            .collect::<Vec<_>>();
        let parent_name = if segments.len() >= 2 {
            segments[segments.len() - 2].clone()
        } else {
            root_base_name.to_owned()
        };
        let grandparent_name = if segments.len() >= 3 {
            segments[segments.len() - 3].clone()
        } else {
            String::new()
        };

        let mut next_base_name = self
            .name_mask
            .replace("[N]", &source_base_name)
            .replace("[P]", &parent_name)
            .replace("[G]", &grandparent_name)
            .replace(
                "[C]",
                &format_counter_value(counter_value, self.counter_pad),
            );

        next_base_name = match self.search_mode {
            RootMoveSearchMode::Plain => {
                if self.find_text.is_empty() {
                    next_base_name
                } else {
                    next_base_name.replace(&self.find_text, &self.replace_text)
                }
            }
            RootMoveSearchMode::Regex => match self.search_regex.as_ref() {
                Some(search_regex) => search_regex
                    .replace_all(&next_base_name, self.replace_text.as_str())
                    .into_owned(),
                None => next_base_name,
            },
        };

        if next_base_name.is_empty() {
            return Err("Root Move Batch target basename is empty".to_owned());
        }
        if next_base_name.contains('/') || next_base_name.contains('\\') {
            return Err("Root Move Batch target basename contains path separators".to_owned());
        }

        Ok(format!("{next_base_name}{extension}"))
    }
}

fn build_root_move_regex(find_text: &str, flags: &str) -> Result<Regex, RuntimeError> {
    let flags = if flags.trim().is_empty() {
        "g"
    } else {
        flags.trim()
    };
    let mut builder = RegexBuilder::new(find_text);

    for flag in flags.chars() {
        match flag {
            'g' | 'u' => {}
            'i' => {
                builder.case_insensitive(true);
            }
            'm' => {
                builder.multi_line(true);
            }
            's' => {
                builder.dot_matches_new_line(true);
            }
            _ => {
                return Err(RuntimeError::invalid_root_move_rule(
                    "regex flags must use g, i, m, s, or u",
                ));
            }
        }
    }

    builder
        .build()
        .map_err(|source| RuntimeError::invalid_root_move_rule(&source.to_string()))
}

fn format_counter_value(counter_value: i64, counter_pad: usize) -> String {
    let raw = counter_value.to_string();
    if counter_pad == 0 {
        return raw;
    }
    format!("{raw:0>counter_pad$}")
}
