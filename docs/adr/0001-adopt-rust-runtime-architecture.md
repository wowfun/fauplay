---
name: 0001. Adopt Fauplay Rust Runtime Architecture
status: accepted
date: 2026-06-22
---

## Context

Fauplay is being rebuilt around large local file browsing and media workflows. The old baseline treated the web app as the core product and the local gateway as an optional enhancement. That model no longer fits the direction of the project.

Large folders need controlled filesystem traversal, indexing, metadata storage, thumbnail derivation, background tasks, and a stable extension boundary. Keeping these responsibilities in browser code or Node scripts puts too much runtime behavior in places that are hard to reuse across desktop, local service, and future multi-device surfaces.

The frontend should remain TypeScript-first because UI state, interaction, layout, and view composition are still frontend concerns. Rust should own the local runtime because the runtime needs predictable filesystem access, concurrency control, persistent local data, and a path into Tauri without rewriting product logic.

The old Node gateway and the old `scripts/` code location were migration artifacts. They are not part of the target architecture.

## Decision

Fauplay will adopt a required Rust local runtime named `fauplay-runtime`.

`fauplay-runtime` is the core runtime boundary for local filesystem access, indexing, thumbnail derivation, persistence, task orchestration, and plugin/MCP coordination. It is not an optional sidecar.

The TypeScript frontend remains the primary UI layer. It consumes runtime capabilities through a versioned application boundary. The initial boundary is a same-origin local HTTP API so the product can run as one local service.

The Rust runtime owns the local Fauplay app service: the `fauplay` product CLI serves the built Web App from `dist/`, the local Runtime API under `/v1`, and the Remote Access HTTP surface. Build and startup remain separate actions, but startup does not depend on a frontend development server or proxy wrapper.

Future Tauri integration must reuse `fauplay-runtime` library code. Tauri commands may act as host adapters, but they must not reimplement runtime product logic.

The Rust implementation starts as one crate, `fauplay-runtime`. The project will use modules before adding more crates. New crates require a concrete boundary that one crate cannot express cleanly.

Future WebAssembly support is allowed as a frontend acceleration path, but Wasm is not part of this architecture baseline.

Plugin/MCP integration remains the extension model for optional, replaceable, or externally provided capabilities. The runtime owns shared primitives and the local execution boundary. Plugins own specialized capabilities.

Runtime backend and product logic must not live under `scripts/` or any other helper-tooling location.

Fauplay will not reserve a top-level `scripts/` directory as a code location. Plugin/MCP implementations live under `tools/mcp/` unless they later graduate into runtime-owned modules. Helper tooling must not define the product startup model.

The Node legacy gateway is retired from the runtime path and repository command surface. It must not remain as a thin Remote Access proxy, because that would preserve an obsolete runtime identity and make future Tauri integration easier to drift away from the Rust runtime library.

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

tools/
  mcp/              # plugin/MCP capability implementations
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

New runtime behavior should be implemented in Rust. The retired Node gateway may be used only as historical migration reference from archived files or old commits, not as a maintained adapter.

The project accepts a local runtime requirement in exchange for better filesystem performance, a clearer security boundary, shared runtime code for Tauri, and no product logic in helper-tooling locations.

Repository command surfaces and tests should not keep legacy gateway entrypoints alive. Runtime interface coverage belongs at the `fauplay-runtime` boundary.

## Non-goals

This ADR does not define the runtime API schema.

This ADR does not introduce Tauri immediately.

This ADR does not split Rust functionality into multiple crates.

This ADR does not require Wasm.
