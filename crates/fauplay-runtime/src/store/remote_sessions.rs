use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::path::Path;
use std::sync::{Arc, Mutex};

use rand::{RngCore, rngs::OsRng};

use crate::{
    RememberedDeviceCreateRequest, RememberedDeviceRevokeRequest, RememberedDeviceRotateRequest,
    RemoteAccessSessionAuthorizeRequest, RemoteAccessSessionLoginRequest,
    RemoteAccessSessionLogoutRequest, RemoteAccessSessionResponse, RemoteAccessTokenVerifyRequest,
    RuntimeError,
};

use super::{
    create_remembered_device, load_remote_access_config, now_ms, revoke_all_remembered_devices,
    revoke_remembered_device_credential, rotate_remembered_device, verify_remote_access_token,
};

const REMOTE_SESSION_COOKIE_NAME: &str = "__Host-fauplay-remote-session";
const REMOTE_REMEMBER_DEVICE_COOKIE_NAME: &str = "__Host-fauplay-remote-remember-device";
const REMOTE_SESSION_ABSOLUTE_TTL_MS: u64 = 12 * 60 * 60 * 1000;
const REMOTE_SESSION_IDLE_TTL_MS: u64 = 30 * 60 * 1000;
const REMOTE_LOGIN_FAILURE_WINDOW_MS: u64 = 10 * 60 * 1000;
const REMOTE_LOGIN_MAX_FAILURES: usize = 8;
const REMOTE_LOGIN_BLOCK_DURATION_MS: u64 = 10 * 60 * 1000;

#[derive(Debug, Clone, Default)]
pub(crate) struct RemoteAccessSessions {
    inner: Arc<Mutex<RemoteAccessSessionStore>>,
}

#[derive(Debug, Default)]
struct RemoteAccessSessionStore {
    config_fingerprint: Option<String>,
    sessions: HashMap<String, RemoteAccessSessionRecord>,
    login_attempts: HashMap<String, RemoteAccessLoginAttemptState>,
}

#[derive(Debug, Clone)]
struct RemoteAccessSessionRecord {
    created_at_ms: u64,
    last_seen_at_ms: u64,
    remembered_device_id: Option<String>,
}

#[derive(Debug, Default)]
struct RemoteAccessLoginAttemptState {
    failures: Vec<u64>,
    blocked_until_ms: u64,
}

impl RemoteAccessSessions {
    pub(crate) fn login(
        &self,
        runtime_home_path: &Path,
        request: RemoteAccessSessionLoginRequest,
    ) -> Result<RemoteAccessSessionResponse, RuntimeError> {
        let config = self.refresh_config(runtime_home_path)?;
        if config.enabled != true || config.auth_configured != true {
            return Ok(unauthorized_with_session_expiry());
        }

        let now_ms = now_ms();
        if !self.login_allowed(&request.client_id, now_ms) {
            return Ok(unauthorized_with_session_expiry());
        }

        let authorized = verify_remote_access_token(
            runtime_home_path,
            RemoteAccessTokenVerifyRequest {
                bearer_token: request.bearer_token,
            },
        )?;
        if !authorized {
            self.register_login_failure(&request.client_id, now_ms);
            return Ok(unauthorized_with_session_expiry());
        }

        self.clear_login_failures(&request.client_id);

        let mut set_cookies = Vec::new();
        let mut remembered_device_id = None;
        if request.remember_device {
            if !request.remembered_device_cookie.trim().is_empty() {
                let revoked = revoke_remembered_device_credential(
                    runtime_home_path,
                    RememberedDeviceRevokeRequest {
                        cookie_value: request.remembered_device_cookie.clone(),
                    },
                )?;
                self.clear_sessions_by_remembered_device_ids(&revoked.revoked_device_ids);
            }
            let remembered_device = create_remembered_device(
                runtime_home_path,
                RememberedDeviceCreateRequest {
                    label: normalize_remembered_device_label(&request.remember_device_label),
                    user_agent: request.user_agent,
                },
            )?;
            remembered_device_id = Some(remembered_device.id);
            set_cookies.push(create_remote_remember_device_cookie(
                &remembered_device.cookie_value,
                remembered_device.expires_at_ms,
                now_ms,
            ));
        } else if !request.remembered_device_cookie.trim().is_empty() {
            let revoked = revoke_remembered_device_credential(
                runtime_home_path,
                RememberedDeviceRevokeRequest {
                    cookie_value: request.remembered_device_cookie,
                },
            )?;
            self.clear_sessions_by_remembered_device_ids(&revoked.revoked_device_ids);
            set_cookies.push(expired_remote_remember_device_cookie());
        }

        let session_id = self.issue_session(now_ms, remembered_device_id);
        set_cookies.push(create_remote_session_cookie(&session_id));

        Ok(RemoteAccessSessionResponse {
            authorized: true,
            set_cookies,
        })
    }

    pub(crate) fn authorize(
        &self,
        runtime_home_path: &Path,
        request: RemoteAccessSessionAuthorizeRequest,
    ) -> Result<RemoteAccessSessionResponse, RuntimeError> {
        let config = self.refresh_config(runtime_home_path)?;
        if config.enabled != true || config.auth_configured != true {
            return self.reject_authorize(runtime_home_path, request.remembered_device_cookie);
        }

        let now_ms = now_ms();
        self.cleanup_expired_sessions(now_ms);
        let session_cookie = request.session_cookie.trim();
        if !session_cookie.is_empty() && self.touch_session(session_cookie, now_ms) {
            return Ok(RemoteAccessSessionResponse {
                authorized: true,
                set_cookies: Vec::new(),
            });
        }

        let remembered_device_cookie = request.remembered_device_cookie.trim();
        if remembered_device_cookie.is_empty() {
            return self.reject_authorize(runtime_home_path, request.remembered_device_cookie);
        }

        let Some(rotated_device) = rotate_remembered_device(
            runtime_home_path,
            RememberedDeviceRotateRequest {
                cookie_value: remembered_device_cookie.to_owned(),
            },
        )?
        else {
            return self.reject_authorize(runtime_home_path, request.remembered_device_cookie);
        };

        let session_id = self.issue_session(now_ms, Some(rotated_device.id));
        Ok(RemoteAccessSessionResponse {
            authorized: true,
            set_cookies: vec![
                create_remote_remember_device_cookie(
                    &rotated_device.cookie_value,
                    rotated_device.expires_at_ms,
                    now_ms,
                ),
                create_remote_session_cookie(&session_id),
            ],
        })
    }

    pub(crate) fn logout(
        &self,
        runtime_home_path: &Path,
        request: RemoteAccessSessionLogoutRequest,
    ) -> Result<RemoteAccessSessionResponse, RuntimeError> {
        self.delete_session(&request.session_cookie);
        let mut set_cookies = vec![expired_remote_session_cookie()];

        if request.forget_device {
            let revoked = revoke_remembered_device_credential(
                runtime_home_path,
                RememberedDeviceRevokeRequest {
                    cookie_value: request.remembered_device_cookie,
                },
            )?;
            self.clear_sessions_by_remembered_device_ids(&revoked.revoked_device_ids);
            set_cookies.push(expired_remote_remember_device_cookie());
        }

        Ok(RemoteAccessSessionResponse {
            authorized: true,
            set_cookies,
        })
    }

    fn refresh_config(
        &self,
        runtime_home_path: &Path,
    ) -> Result<crate::RemoteAccessConfigResponse, RuntimeError> {
        let config = load_remote_access_config(runtime_home_path)?;
        let mut should_revoke_remembered_devices = false;
        {
            let mut store = self
                .inner
                .lock()
                .expect("Remote Access session store should lock");
            match store.config_fingerprint.as_deref() {
                Some(previous) if previous != config.fingerprint => {
                    store.sessions.clear();
                    store.login_attempts.clear();
                    store.config_fingerprint = Some(config.fingerprint.clone());
                    should_revoke_remembered_devices = true;
                }
                None => {
                    store.config_fingerprint = Some(config.fingerprint.clone());
                }
                _ => {}
            }
        }

        if should_revoke_remembered_devices {
            revoke_all_remembered_devices(runtime_home_path)?;
        }

        Ok(config)
    }

    fn login_allowed(&self, client_id: &str, now_ms: u64) -> bool {
        let mut store = self
            .inner
            .lock()
            .expect("Remote Access session store should lock");
        let state = store
            .login_attempts
            .entry(client_id.to_owned())
            .or_default();
        prune_login_failures(state, now_ms);
        if state.blocked_until_ms > now_ms {
            return false;
        }
        if state.failures.is_empty() && state.blocked_until_ms == 0 {
            store.login_attempts.remove(client_id);
        }
        true
    }

    fn register_login_failure(&self, client_id: &str, now_ms: u64) {
        let mut store = self
            .inner
            .lock()
            .expect("Remote Access session store should lock");
        let state = store
            .login_attempts
            .entry(client_id.to_owned())
            .or_default();
        prune_login_failures(state, now_ms);
        state.failures.push(now_ms);
        if state.failures.len() >= REMOTE_LOGIN_MAX_FAILURES {
            state.blocked_until_ms = now_ms.saturating_add(REMOTE_LOGIN_BLOCK_DURATION_MS);
        }
    }

    fn clear_login_failures(&self, client_id: &str) {
        let mut store = self
            .inner
            .lock()
            .expect("Remote Access session store should lock");
        store.login_attempts.remove(client_id);
    }

    fn issue_session(&self, now_ms: u64, remembered_device_id: Option<String>) -> String {
        self.cleanup_expired_sessions(now_ms);
        let session_id = format!("remote-session-{}", random_hex(32));
        let mut store = self
            .inner
            .lock()
            .expect("Remote Access session store should lock");
        store.sessions.insert(
            session_id.clone(),
            RemoteAccessSessionRecord {
                created_at_ms: now_ms,
                last_seen_at_ms: now_ms,
                remembered_device_id,
            },
        );
        session_id
    }

    fn touch_session(&self, session_id: &str, now_ms: u64) -> bool {
        let mut store = self
            .inner
            .lock()
            .expect("Remote Access session store should lock");
        let Some(session) = store.sessions.get_mut(session_id) else {
            return false;
        };
        session.last_seen_at_ms = now_ms;
        true
    }

    fn delete_session(&self, session_id: &str) {
        if session_id.trim().is_empty() {
            return;
        }
        let mut store = self
            .inner
            .lock()
            .expect("Remote Access session store should lock");
        store.sessions.remove(session_id.trim());
    }

    fn cleanup_expired_sessions(&self, now_ms: u64) {
        let mut store = self
            .inner
            .lock()
            .expect("Remote Access session store should lock");
        store.sessions.retain(|_, session| {
            now_ms.saturating_sub(session.created_at_ms) <= remote_session_absolute_ttl_ms()
                && now_ms.saturating_sub(session.last_seen_at_ms) <= remote_session_idle_ttl_ms()
        });
    }

    fn clear_sessions_by_remembered_device_ids(&self, remembered_device_ids: &[String]) {
        if remembered_device_ids.is_empty() {
            return;
        }
        let target_ids = remembered_device_ids
            .iter()
            .map(|item| item.trim())
            .filter(|item| !item.is_empty())
            .collect::<HashSet<_>>();
        if target_ids.is_empty() {
            return;
        }

        let mut store = self
            .inner
            .lock()
            .expect("Remote Access session store should lock");
        store.sessions.retain(|_, session| {
            !session
                .remembered_device_id
                .as_deref()
                .is_some_and(|id| target_ids.contains(id))
        });
    }

    fn reject_authorize(
        &self,
        runtime_home_path: &Path,
        remembered_device_cookie: String,
    ) -> Result<RemoteAccessSessionResponse, RuntimeError> {
        let mut set_cookies = vec![expired_remote_session_cookie()];
        if !remembered_device_cookie.trim().is_empty() {
            let revoked = revoke_remembered_device_credential(
                runtime_home_path,
                RememberedDeviceRevokeRequest {
                    cookie_value: remembered_device_cookie,
                },
            )?;
            self.clear_sessions_by_remembered_device_ids(&revoked.revoked_device_ids);
            set_cookies.push(expired_remote_remember_device_cookie());
        }
        Ok(RemoteAccessSessionResponse {
            authorized: false,
            set_cookies,
        })
    }
}

fn prune_login_failures(state: &mut RemoteAccessLoginAttemptState, now_ms: u64) {
    state.failures.retain(|failed_at_ms| {
        now_ms.saturating_sub(*failed_at_ms) <= remote_login_failure_window_ms()
    });
    if state.blocked_until_ms <= now_ms {
        state.blocked_until_ms = 0;
    }
}

fn unauthorized_with_session_expiry() -> RemoteAccessSessionResponse {
    RemoteAccessSessionResponse {
        authorized: false,
        set_cookies: vec![expired_remote_session_cookie()],
    }
}

fn create_remote_session_cookie(session_id: &str) -> String {
    let max_age_seconds = remote_session_absolute_ttl_ms().div_ceil(1000).max(1);
    format!(
        "{REMOTE_SESSION_COOKIE_NAME}={session_id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age={max_age_seconds}"
    )
}

fn create_remote_remember_device_cookie(
    cookie_value: &str,
    expires_at_ms: u64,
    now_ms: u64,
) -> String {
    let max_age_ms = expires_at_ms.saturating_sub(now_ms);
    let max_age_seconds = max_age_ms.div_ceil(1000).max(1);
    format!(
        "{REMOTE_REMEMBER_DEVICE_COOKIE_NAME}={cookie_value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age={max_age_seconds}"
    )
}

fn expired_remote_session_cookie() -> String {
    format!(
        "{REMOTE_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0"
    )
}

fn expired_remote_remember_device_cookie() -> String {
    format!(
        "{REMOTE_REMEMBER_DEVICE_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0"
    )
}

fn normalize_remembered_device_label(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn remote_session_absolute_ttl_ms() -> u64 {
    read_positive_integer_env(
        "FAUPLAY_REMOTE_SESSION_ABSOLUTE_TTL_MS",
        REMOTE_SESSION_ABSOLUTE_TTL_MS,
    )
}

fn remote_session_idle_ttl_ms() -> u64 {
    read_positive_integer_env(
        "FAUPLAY_REMOTE_SESSION_IDLE_TTL_MS",
        REMOTE_SESSION_IDLE_TTL_MS,
    )
}

fn remote_login_failure_window_ms() -> u64 {
    read_positive_integer_env(
        "FAUPLAY_REMOTE_LOGIN_FAILURE_WINDOW_MS",
        REMOTE_LOGIN_FAILURE_WINDOW_MS,
    )
}

fn read_positive_integer_env(name: &str, fallback: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback)
}

fn random_hex(byte_count: usize) -> String {
    let mut bytes = vec![0_u8; byte_count];
    OsRng.fill_bytes(&mut bytes);
    let mut encoded = String::with_capacity(byte_count * 2);
    for byte in bytes {
        write!(&mut encoded, "{byte:02x}").expect("hex encoding should write to String");
    }
    encoded
}
