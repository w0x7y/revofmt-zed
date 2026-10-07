# Formatting Language Server Implementation Plan

**Goal:** A separate formatting language server eligible for Zed registry review.
**Architecture:** WASM launcher downloads a pinned Node backend that invokes the
installed revofmt CLI; existing language extension owns Revo registration.
**Spec:** [Design](../specs/2026-10-07-formatting-language-server-design.md)

## Global constraints

- Node >=20, standard libraries only; Zed API exactly 0.7.0; version 0.2.0.
- Extension/server ID revofmt-lsp, language Revo, protocol language ID revo.
- Whole unsaved buffers; successful current CLI results; save formatting opt-in.
- Source/stdout 262144 bytes, stderr 65536; UTF-8 LF with UTF-16 edits.
- Wire payload 2097152 bytes, headers 8192; 64 documents, 2097152 stored bytes.
- Eight jobs globally, one current request per URI; bounded output buffering.
- No main formatter changes or personal setting changes.

## Task 1: Bounded backend

Files: `server/*.cjs`, `tests/*.test.cjs`, `package.json`.
Interface: `node server/main.cjs --formatter /absolute/path/to/revofmt` and
initialization options executable/indentWidth/lineWidth/timeoutMs.

- [x] Write framed-process tests for initialize and formatting `let x=1`.
- [x] Observe failure before implementing the server.
- [x] Implement framing, state, process transport and lifecycle in focused modules.
- [x] Add boundary and failure regressions before their production rejection logic.
- [x] Run all tests against the actual release CLI and record output.

## Task 2: WASM launcher

Files: `Cargo.toml`, `src/*.rs`, `extension.toml`, launcher tests.
Interface: register revofmt-lsp for Revo; download the versioned server and check
file digests. Resolve formatter from worktree or explicit initialization option.

- [x] Write validation and downloaded-file admission tests; observe failures.
- [x] Implement supported Zed API hooks and integrity checks.
- [x] Remove duplicate language registration; keep supported metadata only.
- [x] Compile native tests, WASM release, lint and formatting checks.

## Task 3: Distribution, host and registry

Files: package script, settings, owning guides, CI, verification record.

- [x] Package runtime modules and license and pin their SHA-256 digests.
- [x] Verify exact release in isolated Zed with the existing language extension.
- [x] Check unsaved formatting, fixed point, rejection, literal bytes and undo.
- [x] Update guides and CI; inspect full diff, archive, links and README indentation.
- [x] Publish server release, prepare sorted HTTPS registry branch.
- [ ] Obtain the human-authored description required by registry policy, then submit.
