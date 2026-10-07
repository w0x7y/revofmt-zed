# Historical standalone Zed extraction plan

This records the initial 0.1.0 extraction. The current implementation is the
[formatting language server](superpowers/specs/2026-10-07-formatting-language-server-design.md).
Its language registration and external-formatter settings have been replaced.

Goal: extract `revo-formatter/editors/zed` into `~/GitRepo/revofmt-zed` with independent installation and verification.

The package retains declarative Revo recognition and native external formatter settings. It uses a separately installed CLI and contains no Rust adapter, grammar or language server. Existing Revo language extensions use only the settings snippet to avoid duplicate language registration.

Source: `revo-formatter` commit `14bafd8ede11829157d0bd15ebd01cc667c4efaa`, directory `editors/zed`.

## Constraints

- Preserve the MIT license and shipped formatter settings.
- Format the whole unsaved buffer using an executable and argument array.
- Keep save formatting opt-in and both native whitespace passes disabled.
- Supported editor preservation is UTF-8 LF source.
- Verification requires Python >=3.11 and a real formatter executable.
- Do not edit personal editor settings or the existing language extension.

## Extraction

- [x] Copy metadata, language recognition, settings, license and tests to the new repository root.
- [x] Adapt the test runner to find an installed formatter and validate the copied license independently.
- [x] Add `scripts/verify` and CI against the pinned formatter release.
- [x] Rewrite installation and development instructions for the standalone layout.
- [x] Run all 15 real CLI and metadata checks, check relative links and whitespace, then create the initial Git commit.

Verification: all 15 checks passed against the local release build and the checksum-verified public `v0.1.0` binary. A copied package also passed from an unrelated directory with spaces in its path and formatter lookup through PATH. Relative README links and the settings example were checked. No native Zed session was tested.
