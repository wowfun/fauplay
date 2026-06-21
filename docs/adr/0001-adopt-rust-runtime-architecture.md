---
name: 0001. Adopt Fauplay Rust Runtime Architecture
status: accepted
date: 2026-06-22
---

## Context

Fauplay is being rebuilt around large local file browsing and media workflows. The old baseline treated the web app as the core product and the local gateway as an optional enhancement. That model no longer fits the direction of the project.

Large folders need controlled filesystem traversal, indexing, metadata storage, thumbnail derivation, background tasks, and a stable extension boundary. Keeping these responsibilities in browser code or Node scripts puts too much runtime behavior in places that are hard to reuse across desktop, local service, and future multi-device surfaces.

The frontend should remain TypeScript-first because UI state, interaction, layout, and view composition are still frontend concerns. Rust should own the local runtime because the runtime needs predictable filesystem access, concurrency control, persistent local data, and a path into Tauri without rewriting product logic.

The existing Node gateway under `scripts/` is migration source, not the target architecture.

## Decision

Fauplay will adopt a required Rust local runtime named `fauplay-runtime`.

`fauplay-runtime` is the core runtime boundary for local filesystem access, indexing, thumbnail derivation, persistence, task orchestration, and plugin/MCP coordination. It is not an optional sidecar.

The TypeScript frontend remains the primary UI layer. It consumes runtime capabilities through a versioned application boundary. The initial boundary is a local HTTP API so browser-based development and the future remote-readonly surface can keep working during the rebuild.

Future Tauri integration must reuse `fauplay-runtime` library code. Tauri commands may act as host adapters, but they must not reimplement runtime product logic.

The Rust implementation starts as one crate, `fauplay-runtime`. The project will use modules before adding more crates. New crates require a concrete boundary that one crate cannot express cleanly.

Future WebAssembly support is allowed as a frontend acceleration path, but Wasm is not part of this architecture baseline.

Plugin/MCP integration remains the extension model for optional, replaceable, or externally provided capabilities. The runtime owns shared primitives and the local execution boundary. Plugins own specialized capabilities.

Runtime backend and product logic must not live under `scripts/`. The `scripts/` directory is reserved for development and maintenance helpers.

## Target Repository Layout

```txt
apps/
  web/
  desktop/          # reserved for future Tauri host

crates/
  fauplay-runtime/

docs/
  adr/
    0001-adopt-rust-runtime-architecture.md

scripts/
  # development and maintenance helpers only
```

Inside `fauplay-runtime`, use modules before new crates:

```txt
src/
  api/
  fs/
  media/
  store/
  tasks/
  mcp/
  server/
  lib.rs
  main.rs
```

`server` is an adapter inside the runtime. It is not the architectural identity of the Rust implementation.

## Consequences

The old Pure Web plus Optional Gateway baseline is superseded. Core browsing, indexing, metadata, thumbnails, and privileged local operations should move toward the Rust runtime.

The frontend can still run as a TypeScript application, but production-grade local browsing assumes that `fauplay-runtime` is available.

The Node gateway can remain temporarily as migration source. New runtime behavior should be implemented in Rust.

The project accepts a local runtime requirement in exchange for better filesystem performance, a clearer security boundary, shared runtime code for Tauri, and less product logic in scripts.

## Non-goals

This ADR does not define the runtime API schema.

This ADR does not introduce Tauri immediately.

This ADR does not split Rust functionality into multiple crates.

This ADR does not require Wasm.
