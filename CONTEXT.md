# Fauplay

Fauplay is a local-first file browsing and media workflow application. This context defines the project language used by the frontend, the Rust runtime, and extension points.

## Language

**Fauplay Runtime**:
The required local runtime that owns privileged local capabilities for Fauplay. It is the canonical term for the Rust runtime layer.
_Avoid_: gateway, server, sidecar

**Web App**:
The TypeScript user interface for Fauplay. It owns interaction, layout, and presentation state.
_Avoid_: frontend client, browser app

**Local Root**:
A user-selected folder that Fauplay can browse as a file workspace. All displayed relative paths are interpreted within a Local Root unless a capability states otherwise.
_Avoid_: root folder, mounted folder, source directory

**Root-relative Path**:
A path interpreted inside a Local Root. A Root-relative Path must stay within its Local Root and have one stable display form.
_Avoid_: relative path, file path

**Reserved Folder**:
A folder inside a Local Root that Fauplay owns for runtime data or recovery workflows. Reserved Folders are not user content and should not appear in normal browsing results.
_Avoid_: hidden folder, system folder

**Runtime Capability**:
A capability owned by the Fauplay Runtime because it depends on privileged local access, shared runtime state, or long-running task coordination.
_Avoid_: backend feature, native feature

**Runtime API**:
The versioned interface used by the Web App and application hosts to call Runtime Capabilities.
_Avoid_: backend API, gateway API

**Plugin Capability**:
An optional or replaceable capability provided through plugin/MCP integration. Plugin Capabilities may use Runtime Capabilities but do not define the runtime boundary.
_Avoid_: extension feature, external tool

**Tauri Host**:
The future desktop host for Fauplay. The Tauri Host presents the application shell and calls the Fauplay Runtime rather than reimplementing runtime behavior.
_Avoid_: Tauri backend, desktop runtime
