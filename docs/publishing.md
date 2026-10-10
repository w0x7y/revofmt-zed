# registry publishing

version 0.3.0 supplies a formatting language server for the existing `Revo`
language. its ID is `revofmt-lsp`. it declares no language or grammar.

this follows Zed's [language-server extension prerequisites](https://zed.dev/docs/extensions/publishing/prerequisites).
the separate [Revo language extension](https://github.com/w0x7y/revo-zed-extension)
owns recognition and highlighting. registry acceptance and publication depend
on maintainer review.

## release the server

the store package contains the Rust WASM launcher. it downloads the formatting
server at runtime from the versioned GitHub release; it never bundles the server
or installs revofmt. Node comes from Zed's extension API.

```sh
REVOFMT_BIN=/absolute/path/to/revofmt scripts/verify
scripts/package-server
cargo build --release --target wasm32-wasip2 --locked
```

the archive contains only `server/*.cjs` and `LICENSE`. `src/server_checksums.rs`
pins every runtime file. the launcher checks the digests on every start and
rejects unexpected files or symlinks. a tampered cache triggers a fresh download.

publish `dist/revofmt-lsp-0.3.0.tar.gz` as the asset on the `v0.3.0` GitHub release.
use a new version, asset URL and digests for every subsequent server change.

## test the submission

install the exact proposed commit in an isolated Zed profile alongside the Revo
language extension. merge the supplied settings and select the formatter path.
check an unsaved buffer, repeated formatting, Unicode and multiline literals,
syntax failure, undo, and that the disk source remains unchanged until saved.
repeat with a fresh extension work directory to verify the public asset download.

the automated server and launcher checks don't establish Zed's native buffer
edits. record the host version, tested commit, results and known limits in the
[verification record](verification.md). the repository owner also needs to test
and understand the exact version submitted.

## submit to the registry

follow the [publishing guide](https://zed.dev/docs/extensions/publishing/publishing-guide).
on a branch based on the current registry `main`, add the HTTPS submodule:

```sh
git submodule add https://github.com/w0x7y/revofmt-zed.git extensions/revofmt-lsp
```

pin it to the tested public commit. add this entry to `extensions.toml`:

```toml
[revofmt-lsp]
submodule = "extensions/revofmt-lsp"
version = "0.3.0"
```

run `pnpm sort-extensions`, validate the matching manifest version and commit
the submodule reference with both sorted registry files. submit one extension
per pull request. publication happens after maintainers merge it.

the registry's [AI policy](https://github.com/zed-industries/extensions/blob/main/AI_POLICY.md)
requires human-owned contributions and forbids autonomous-agent contributions.
the owner must write the PR description and maintainer replies in their own
words, understand the code and verify it. do not submit a generated description
or claim human testing from an automated run.

requirements checked on 2026-10-07. check the current rules before submitting.
