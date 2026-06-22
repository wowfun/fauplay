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

**Listing**:
An ordered set of files and directories under a Root-relative Path, expressed using Root-relative Paths.
_Avoid_: file list, directory read

**Flattened Listing**:
A listing of all descendant files under a Root-relative Path, returned as Root-relative Paths without directory grouping. It supports workflows that need to scan or compare a subtree as one file set.
_Avoid_: recursive view, deep list

**Truncated Listing**:
A listing that stopped at a caller-defined entry limit and explicitly reports that more matching entries exist.
_Avoid_: partial error, failed listing

**Listing Page**:
An ordered segment of a Listing that can be followed by another segment when more matching entries exist.
_Avoid_: offset slice, pagination response

**Listing Query**:
A caller's requested view of a Listing before it is split into Listing Pages. It can narrow entries by name or kind and define the Listing order.
_Avoid_: frontend filter, client-side search

**Reserved Folder**:
A folder inside a Local Root that Fauplay owns for runtime data or recovery workflows. Reserved Folders are not user content and should not appear in normal browsing results.
_Avoid_: hidden folder, system folder

**Root Trash**:
A Reserved Folder inside a Local Root that stores user content moved out of normal browsing so it can be restored later.
_Avoid_: recycle bin, deleted folder, soft-delete plugin storage

**Root Trash Entry**:
A file currently stored in Root Trash, identified by its current Root-relative Path and the original Root-relative Path it would restore to.
_Avoid_: recycle item, deleted item

**Runtime Capability**:
A capability owned by the Fauplay Runtime because it depends on privileged local access, shared runtime state, or long-running task coordination.
_Avoid_: backend feature, native feature

**Runtime API**:
The versioned interface used by the Web App and application hosts to call Runtime Capabilities.
_Avoid_: backend API, gateway API

**Text Preview**:
A bounded textual view of a file that reports when content is too large or not text, without requiring the Web App to load the full file.
_Avoid_: full file read, raw file fetch

**File Content**:
A browser-renderable byte stream for a file under a Local Root, addressed by Root-relative Path and served with a MIME type.
_Avoid_: raw file read, blob passthrough

**File Content Range**:
A contiguous byte segment of File Content, reported with its inclusive byte positions and the total file size. It supports media playback and progressive reads without changing the Root-relative Path identity of the file.
_Avoid_: partial blob, sliced file

**Plugin Capability**:
An optional or replaceable capability provided through plugin/MCP integration. Plugin Capabilities may use Runtime Capabilities but do not define the runtime boundary.
_Avoid_: extension feature, external tool

**Tauri Host**:
The future desktop host for Fauplay. The Tauri Host presents the application shell and calls the Fauplay Runtime rather than reimplementing runtime behavior.
_Avoid_: Tauri backend, desktop runtime
