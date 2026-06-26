use std::collections::HashMap;

use super::{HttpResponse, error_json, http_response};

pub(super) fn parse_json_body(request: &str) -> Result<serde_json::Value, HttpResponse> {
    let body = http_request_body(request).trim();
    if body.is_empty() {
        return Err(http_response(
            400,
            "Bad Request",
            "{\"error\":\"JSON body is required\"}",
        ));
    }
    serde_json::from_str::<serde_json::Value>(body).map_err(|error| {
        http_response(
            400,
            "Bad Request",
            &error_json(&format!("invalid JSON body: {error}")),
        )
    })
}

pub(super) fn http_request_body(request: &str) -> &str {
    request
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or("")
}

pub(super) fn json_string_field<'a>(payload: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    payload
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub(super) fn json_string_array_field(payload: &serde_json::Value, key: &str) -> Vec<String> {
    match payload.get(key) {
        Some(serde_json::Value::Array(values)) => values
            .iter()
            .filter_map(|value| {
                value
                    .as_str()
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
                    .map(ToOwned::to_owned)
            })
            .collect(),
        _ => Vec::new(),
    }
}

pub(super) fn json_mapping_path_field<'a>(
    mapping: &'a serde_json::Value,
    key: &str,
    fallback_key: Option<&str>,
) -> Option<&'a str> {
    json_string_field(mapping, key)
        .or_else(|| fallback_key.and_then(|fallback_key| json_string_field(mapping, fallback_key)))
}

pub(super) fn json_root_relative_path_values(payload: &serde_json::Value) -> Vec<&str> {
    let value = payload
        .get("rootRelativePath")
        .or_else(|| payload.get("rootRelativePaths"))
        .or_else(|| payload.get("relativePath"))
        .or_else(|| payload.get("relativePaths"));

    match value {
        Some(serde_json::Value::String(value)) if !value.trim().is_empty() => vec![value.trim()],
        Some(serde_json::Value::Array(values)) => values
            .iter()
            .filter_map(|value| {
                value
                    .as_str()
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
            })
            .collect(),
        _ => Vec::new(),
    }
}

pub(super) fn json_bool_field(payload: &serde_json::Value, key: &str) -> bool {
    payload.get(key).and_then(serde_json::Value::as_bool) == Some(true)
}

pub(super) fn json_string_or_default(
    payload: &serde_json::Value,
    key: &str,
    default_value: &str,
) -> String {
    payload
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| default_value.to_owned())
}

pub(super) fn json_i64_or_default(
    payload: &serde_json::Value,
    key: &str,
    default_value: i64,
) -> Option<i64> {
    match payload.get(key) {
        Some(serde_json::Value::Number(value)) => value.as_i64(),
        Some(serde_json::Value::String(value)) if value.trim().is_empty() => Some(default_value),
        Some(serde_json::Value::String(value)) => value.trim().parse::<i64>().ok(),
        None => Some(default_value),
        _ => None,
    }
}

pub(super) fn json_usize_or_default(
    payload: &serde_json::Value,
    key: &str,
    default_value: usize,
) -> Option<usize> {
    match payload.get(key) {
        Some(serde_json::Value::Number(value)) => {
            value.as_u64().and_then(|value| value.try_into().ok())
        }
        Some(serde_json::Value::String(value)) if value.trim().is_empty() => Some(default_value),
        Some(serde_json::Value::String(value)) => value.trim().parse::<usize>().ok(),
        None => Some(default_value),
        _ => None,
    }
}

pub(super) fn parse_query_string(query: &str) -> HashMap<String, String> {
    let mut values = HashMap::new();

    for (key, value) in parse_query_pairs(query) {
        values.insert(key, value);
    }

    values
}

pub(super) fn parse_query_pairs(query: &str) -> Vec<(String, String)> {
    let mut values = Vec::new();

    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or_default();
        let value = parts.next().unwrap_or_default();
        values.push((percent_decode(key), percent_decode(value)));
    }

    values
}

pub(super) fn first_query_value<'a>(query: &'a [(String, String)], key: &str) -> Option<&'a str> {
    query
        .iter()
        .find(|(candidate_key, _)| candidate_key == key)
        .map(|(_, value)| value.as_str())
}

pub(super) fn query_values<'a>(query: &'a [(String, String)], key: &str) -> Vec<&'a str> {
    query
        .iter()
        .filter_map(|(candidate_key, value)| (candidate_key == key).then_some(value.as_str()))
        .collect()
}

pub(super) fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Some(byte) = decode_hex_byte(bytes[index + 1], bytes[index + 2]) {
                decoded.push(byte);
                index += 3;
                continue;
            }
        }

        if bytes[index] == b'+' {
            decoded.push(b' ');
        } else {
            decoded.push(bytes[index]);
        }
        index += 1;
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

fn decode_hex_byte(high: u8, low: u8) -> Option<u8> {
    Some(decode_hex_digit(high)? * 16 + decode_hex_digit(low)?)
}

fn decode_hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}
