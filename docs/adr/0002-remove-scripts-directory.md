---
name: 0002. Remove Scripts Directory As A Code Location
status: accepted
date: 2026-06-26
---

Note: ADR 0003 supersedes the temporary `tools/legacy-gateway/` migration location described here.

## Context

ADR 0001 moved Fauplay toward a required Rust runtime and said product runtime logic must not live under `scripts/`. The remaining `scripts/` tree still mixed development helpers with the legacy Node gateway. That made the migration boundary ambiguous: future work could keep adding code under `scripts/` even though the target architecture is Rust runtime plus TypeScript Web App.

## Decision

Fauplay will remove `scripts/` as a repository code location.

Development helpers that are still useful move under `tools/dev/`.

The existing Node gateway moves under `tools/legacy-gateway/` while it remains migration source. It is not the target runtime architecture, and new runtime behavior should not be added there.

The target repository layout no longer reserves a top-level `scripts/` directory.

## Consequences

References to the legacy gateway must use `tools/legacy-gateway/`.

References to development helper entrypoints must use `tools/dev/`.

Future cleanup should continue reducing and removing `tools/legacy-gateway/` as Rust runtime capabilities replace it.

This ADR supersedes the `scripts/` target-layout note in ADR 0001.
