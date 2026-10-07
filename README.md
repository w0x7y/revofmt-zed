# revofmt for Zed

Format the whole unsaved Revo buffer with [revofmt](https://github.com/w0x7y/revo-formatter).
This standalone package recognizes `.rv` and `.revo` and supplies Zed's native
external formatter settings. Format-on-save is off until you enable it.

## Install

Install `revofmt` from its [releases](https://github.com/w0x7y/revo-formatter/releases)
or [build it from source](https://github.com/w0x7y/revo-formatter#build-from-source).
The prebuilt formatter is verified on native Linux x86_64 GNU, with glibc >=2.34
and `libgcc_s`. This package does not download the executable.

If you already use [revo-zed-extension](https://github.com/w0x7y/revo-zed-extension)
or another extension that provides `Revo`, keep it and merge only the settings
below. Confirm it recognizes both suffixes. Installing another definition of the
same language can displace its grammar or language server.

Otherwise, run `zed: install dev extension` in Zed's command palette and select
this repository's root directory, the one containing [extension.toml](extension.toml).
This is a local development extension. It supplies file recognition without a
grammar, language server or completion provider. See Zed's
[development extension instructions](https://zed.dev/docs/extensions/developing-extensions).

Open `zed: open settings file`, or the project's `.zed/settings.json`, and merge
this snippet. Keep unrelated settings. Installing the extension does not load
[settings.json](settings.json) automatically.

```json
{
  "languages": {
    "Revo": {
      "formatter": {
        "external": {
          "command": "revofmt",
          "arguments": ["--indent-width", "2", "--line-width", "80", "-"]
        }
      },
      "format_on_save": "off",
      "remove_trailing_whitespace_on_save": false,
      "ensure_final_newline_on_save": false
    }
  }
}
```

Open an LF `.rv` or `.revo` file, confirm the status bar says `Revo`, and run
`editor: format`. For an unnamed buffer, select `Revo` manually first.

## Settings

Set `formatter.external.command` to an absolute executable path if `revofmt`
is not on Zed's PATH. Paths with spaces belong in `command`; keep arguments in
the array. Zed starts the executable directly. Shell expansions such as `~`,
pipes and command substitutions are not supported.

Indentation accepts `1` through `8`; line width accepts `20` through `240` and
is a soft target. For four spaces and a 100-column target, use
`["--indent-width", "4", "--line-width", "100", "-"]`. Keep the final `-` to
read the current unsaved buffer. The formatter never writes a saved file here.
See Zed's [formatter setting](https://zed.dev/docs/reference/all-settings#formatter).

To format on save, change `languages.Revo.format_on_save` to `"on"`. Keep both
native whitespace settings `false`: Zed also runs those passes during manual
formatting, and they can change spaces inside multiline literals or change
source before the CLI rejects it. Avoid Revo formatter chains and inherited
format code actions when relying on the preservation contract.

## Preservation and limits

Use UTF-8 LF source. Zed normalizes line endings in its native buffer and diff
pipeline, including endings inside literals and comments. This integration
cannot guarantee raw CRLF or mixed-ending file preservation. Use the CLI
directly when those original bytes matter.

The CLI validates token and comment bytes, syntax equivalence modulo source
coordinates, and idempotence. Empty source stays empty. Syntax or validation
failures produce exit code 2, diagnostics and no formatted output. The CLI's
[input limits](https://github.com/w0x7y/revo-formatter/blob/main/docs/verification/input-limits.md)
include 262,144 source bytes; this package adds no separate byte limits.

Zed owns execution and edit application. This declarative package supplies no
custom cancellation, deadline or workspace trust guard. The original
[source review](https://github.com/w0x7y/revo-formatter/blob/main/docs/verification/2026-10-06-editor-integrations.md)
records native host behavior assessed on 2026-10-06. The tests below exercise
metadata and the real CLI, not a running Zed session.

## Development

You need Python >=3.11 and an installed formatter. No Python packages, Rust,
Zig or neighboring repository are needed to run these checks.

```sh
scripts/verify                          # revofmt on PATH
REVOFMT_BIN=/absolute/path/to/revofmt scripts/verify
python3 tests/run.py MetadataTests      # metadata only
```

`REVOFMT_BIN` must be an absolute executable path. The 15 checks cover language
recognition, shipped settings, the license, LF layout, Unicode, opaque literal
whitespace, CRLF and mixed-ending CLI bytes, empty input, idempotence, syntax
and option failures, resource admission, and stdin formatting without writes.
Successful subprocess calls exercise the CLI's built-in preservation checks.
The raw CRLF checks establish CLI behavior only, not Zed buffer preservation.

The [CI workflow](.github/workflows/test.yml) runs these checks on Linux with
Python 3.11 and formatter release `v0.1.0`, verified against SHA-256
`37c4dc23857299aca5d4f1b98f838f5f1f7c8ac75e118bcf24390a5b99a654a1`.
Update the version and checksum together after verifying a new release.

For a manual host check, open an LF file with `let x=1`, make an unsaved edit,
and run `editor: format`. Confirm only the buffer changes, format twice, then
undo. Confirm malformed source reports an error without changing the buffer,
an empty buffer stays empty, both suffixes select `Revo`, and save formatting
remains off until enabled.

## Credits

[MIT](LICENSE). Extracted from `revo-formatter/editors/zed` at commit
`14bafd8ede11829157d0bd15ebd01cc667c4efaa`. The manifest retains the upstream
source repository URL until this standalone repository is published.
[Implementation notes](docs/implementation.md) record the extraction scope.
The formatter uses [Revo](https://github.com/if-not-nil/revo), also MIT; this
package contains neither the parser nor formatter binary.
