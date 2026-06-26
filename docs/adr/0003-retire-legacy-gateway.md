---
name: 0003. Retire The Legacy Gateway
status: accepted
date: 2026-06-27
---

# Retire The Legacy Gateway

Fauplay will remove the Node legacy gateway from the runtime path and repository command surface. The Rust `fauplay-runtime` now owns the local Runtime API and the Remote Access HTTP surface, so the Web App development proxy should send both `/v1` and `/v1/remote` requests to `fauplay-runtime` instead of keeping a Node proxy adapter alive.

The rejected alternative was to keep `tools/legacy-gateway/` as a thin Remote Access proxy. That would preserve an obsolete runtime identity, keep testing an adapter whose behavior is already covered at the runtime interface, and make future Tauri integration easier to drift away from the Rust runtime library.
