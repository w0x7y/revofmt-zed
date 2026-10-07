# Revo formatter language-server design

## Purpose and eligibility

Replace the metadata-only package with a separate language-server extension.
Extension ID: `revofmt-lsp`; name: `Revo Formatter LSP`; version: `0.2.0`.
Register one formatting language server for `Revo`, LSP language ID `revo`.
Define no languages or grammars: the existing Revo language extension owns syntax
highlighting and file recognition. Follow Zed's language-server-only category.

## Runtime and limits

A Rust WASM launcher pins Zed extension API 0.7.0, uses Zed's Node runtime and
downloads a version-pinned server release into its extension work directory.
Verify known runtime files against embedded SHA-256 digests before execution.
The language server is not bundled in the store extension. The CLI formatter
remains separately installed, resolved through the worktree or explicit options.

The backend uses Node >=20 standard libraries, no runtime npm dependencies.
Run `node server/main.cjs --formatter /absolute/path/to/revofmt`.
Initialization options: `executable`, `indentWidth` 1..8 default 2, `lineWidth`
20..240 default 80, `timeoutMs` 1..60000 default 5000. Use direct spawn with argument
array and explicit stdin; no source disk reads or writes. Whole-document format
returns one UTF-16 edit or [] when unchanged. Source/stdout <=262144 UTF-8 bytes,
stderr <=65536. Reject CR, NUL, unpaired surrogates and invalid UTF-8. Zed's
supported preservation scope stays LF; literals/comments are opaque to the
adapter and validated by the CLI.

## Protocol and lifecycle

Bound Content-Length JSON-RPC framing at 2097152 payload bytes and 8192 header
bytes. Implement initialize/initialized, full document open/change/close sync,
textDocument/formatting, $/cancelRequest, shutdown and exit. Advertise UTF-16,
full sync and formatting only; no save actions or willSaveWaitUntil. Invalid
changes invalidate the document. Unknown requests return MethodNotFound.

Bound 64 open documents and 2097152 aggregate UTF-8 bytes. Bound eight active jobs
globally, one current job per URI. Superseding, changed/closed documents, cancel,
shutdown and EOF abort in-flight children and return no edits. Timeout/cancel
settle once, destroy streams, terminate the direct child and ignore late events,
including inherited pipes. Wrappers own descendants. Signals, nonzero exit,
invalid UTF-8 and overflow never produce edits. Bound outgoing buffering too.

## Distribution and acceptance

Release `revofmt-lsp-0.2.0.tar.gz` with server CommonJS runtime modules and MIT
license. WASM launcher downloads/extracts it into `revofmt-lsp-0.2.0/` and checks
runtime digests. Test real framed subprocesses with the rebuilt CLI and controlled
executables for failure/cancellation cases. Retain CLI preservation fixtures.
Verify exact submission commit in isolated Zed with existing Revo language
extension: unsaved source, idempotence, syntax failure, LF literal bytes and undo.

Keep source, packaging and lifecycle tests here. Main formatter/runtime/vendor
and personal settings remain unchanged. Registry candidate adds one HTTPS Git
submodule and matching sorted version entry. Maintainers decide acceptance.
Registry policy requires human-owned submission and human-written description;
finish reviewable implementation and registry files before that final input.
