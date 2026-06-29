# Fauplay

Fauplay is a local-first file browsing and media workflow application.

The project is being rebuilt around a TypeScript Web App backed by a required Rust runtime. The Web App owns interaction, layout, and presentation state. The Fauplay Runtime owns privileged local capabilities such as filesystem access, listings, file content, thumbnails, metadata, persistence, background tasks, Remote Access, and plugin/MCP coordination.

## Status

This repository is in an active rebuild. The current baseline is:

- TypeScript remains the primary language for the Web App.
- Rust is the core runtime implementation through the `fauplay-runtime` crate.
- The initial Web App to Runtime boundary is a local HTTP API.
- Future Tauri work must reuse `fauplay-runtime` library code instead of reimplementing product logic in host commands.
- WebAssembly may be added later for frontend acceleration, but it is not part of the baseline.
- Optional and specialized capabilities stay behind plugin/MCP integration.

## Requirements

- Node.js and pnpm. The repository declares `pnpm@11.8.0` in `package.json`.
- A Rust toolchain with Edition 2024 support.
- Optional tool-specific dependencies for some MCP servers, such as Python packages or local search utilities.

## Install

```bash
pnpm install
```

## Run Locally

Build the Web App:

```bash
pnpm run build
```

Start Fauplay:

```bash
pnpm run start
```

After building the binary, the product CLI can also be run directly:

```bash
fauplay
```

Fauplay listens on `http://127.0.0.1:3211` by default and prints an `open` URL when it is ready. The same service serves the Web App and `/v1` Runtime API.

## Validate

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
cargo test -p fauplay-runtime
```

For documentation-only changes, `git diff --check` is usually enough.

## Repository Layout

```txt
src/                         # TypeScript Web App
crates/fauplay-runtime/      # Required Rust local runtime
tools/mcp/                   # Plugin/MCP capability implementations
docs/adr/                    # Architecture decision records
tests/                       # Node test suites for Web App and Runtime API boundaries
```

Runtime backend and product logic should live in `crates/fauplay-runtime/`, not in helper-tooling locations.

## Architecture Notes

`server` is an adapter inside `fauplay-runtime`; it is not the runtime identity. Product logic should stay in runtime modules that can be reused by future hosts.

Plugin/MCP tools may call Runtime Capabilities, but they do not define the runtime boundary. When a capability needs privileged local access, shared runtime state, or coordinated long-running tasks, it belongs in the Fauplay Runtime.
