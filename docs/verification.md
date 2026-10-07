# 0.2.0 verification

Checked on 2026-10-07 on Linux x86_64 GNU.

- 77 framed-process and fixture tests pass on Node 20.20.2 and 26.10.0.
- 15 metadata and real CLI checks pass against the rebuilt formatter.
- The same checks pass against the checksum-verified public formatter binary.
- Cargo audit reports no vulnerabilities or warnings in the locked dependencies.
- Nine native launcher tests pass, including literal path resolution and
  downloaded-file admission. Formatting and Clippy pass.
- The registry's exact packaging CLI, revision
  `9ee3c503a4bbbc6b4a0f8a789acca4871d773223`, builds with Rust 1.90.0.
  Its archive contains only `extension.toml` and `extension.wasm`; its manifest
  reports API 0.7.0 and only `language-servers` functionality.
- Runtime digests match the four shipped server modules. The server archive
  includes those modules and the original MIT notice, with no npm dependencies.
  Repeated packaging produces identical bytes.
- README settings match `settings.json`; relative links and whitespace pass.

The server asset `revofmt-lsp-0.2.0.tar.gz` has SHA-256:

```text
94ecada9c0e24e484f779b5c4cc81f1926dc4a3866c4860a98366650634374d9
```

## Zed host

Zed 1.22.0 loaded the registry-built WASM alongside the Revo language extension
in a temporary user-data directory. Desktop keyboard automation exercised
`editor: format` on an unsaved Revo buffer and copied the resulting buffer for
literal comparison. The disk file retained its original contents.

Formatting preserved Unicode, an astral character and trailing spaces inside a
multiline literal. Formatting twice returned the same buffer, one undo restored
the unformatted source, and invalid syntax left the source unchanged. The host
log confirmed Node was supplied by Zed and the explicit formatter path reached
the downloaded-server command. Personal editor settings were unchanged.

A second run started with an empty extension work directory. Zed downloaded
the public v0.2.0 release asset, admitted all four runtime files and the license,
and repeated the same formatting, literal preservation, failure and undo checks.

These are automated editor checks; the registry owner still needs to test the
exact submission and write the PR description in their own words.

## review

Independent backend and launcher reviews covered protocol boundaries, process
lifecycle, stale requests, byte limits and runtime integrity. The launcher review
found that Rust 1.90 WASI does not support filesystem canonicalization. Startup
now resolves the verified entrypoint relative to the extension work directory;
its regression test and the registry-built native Zed run pass.

A test fixture also wrote a PID file when ordinary source happened to contain a
space. It now writes markers only for explicit test modes and absolute temporary
paths; a subprocess regression confirms ordinary source creates no files.

The prepared registry branch also passes its build, 152 tests, sorted-table
checks, HTTPS submodule validation and matching version/license validation.
