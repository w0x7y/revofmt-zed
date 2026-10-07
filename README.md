# `revofmt-zed`, revo formatting in zed

revo formatting in zed. run `editor: format` on an unsaved buffer.

this extension adds `revofmt-lsp`, a small formatting language server.
[revo-zed-extension](https://github.com/w0x7y/revo-zed-extension) handles file
recognition, highlighting and the Revolt language server.

## get started

you need zed, the Revo language extension and
[revofmt](https://github.com/w0x7y/revo-formatter#get) on your PATH.
the formatter's published binary supports linux x86_64 GNU. this extension
doesn't install it. zed supplies Node for the formatting server.

```sh
revofmt --version
git clone https://github.com/w0x7y/revofmt-zed.git
```

until the registry submission is merged, install from source. with Rust and
its `wasm32-wasip1` target installed, run `zed: install dev extension` and select
the cloned folder. see [development](#develop) for build checks.

run `zed: open settings file` and merge [settings.json](settings.json) into your
existing settings. you can also use the project's `.zed/settings.json`.
installing the extension doesn't apply these settings automatically.

```json
{
  "languages": {
    "Revo": {
      "language_servers": ["revofmt-lsp", "..."],
      "formatter": { "language_server": { "name": "revofmt-lsp" } },
      "format_on_save": "off",
      "remove_trailing_whitespace_on_save": false,
      "ensure_final_newline_on_save": false
    }
  },
  "lsp": {
    "revofmt-lsp": {
      "initialization_options": {
        "indentWidth": 2,
        "lineWidth": 80,
        "timeoutMs": 5000
      }
    }
  }
}
```

open a `.rv` or `.revo` file with LF line endings. the status bar should say
`Revo`. run `editor: format` on this:

```revo
fn hello() do
print('hello')
end
```

and you get:

```revo
fn hello() do
  print('hello')
end
```

for an unnamed buffer, select `Revo` as the language first.

## settings

if zed can't find revofmt, add `"executable": "/absolute/path/to/revofmt"` to
`initialization_options`. paths are literal; `~` and shell commands aren't expanded.

`indentWidth` accepts 1 to 8 spaces. `lineWidth` accepts 20 to 240 columns and
is a soft target. `timeoutMs` accepts 1 to 60,000 milliseconds.
restart the language server after changing these options.

to format on save, change `"format_on_save": "off"` to `"format_on_save": "on"`.
keep both whitespace settings `false`, including for manual formatting. zed's
whitespace cleanup can change spaces inside multiline strings before formatting.
avoid formatter chains and format code actions that change them too.

## limits

use UTF-8 files with LF line endings. zed normalizes CRLF and mixed endings,
including those inside strings and comments. use the CLI directly to preserve
those original bytes.

the server sends the whole unsaved document to revofmt through stdin. it only
returns an edit after a successful process exit with valid UTF-8 LF output.
syntax errors, timeouts, cancellation and edits made during formatting produce
no replacement. it accepts up to 262,144 source bytes, with further formatter
[input limits](https://github.com/w0x7y/revo-formatter/blob/main/docs/verification/input-limits.md).

## develop

you need Node >=20, Python >=3.11, Rust and an installed formatter.
from the repository root:

```sh
REVOFMT_BIN=/absolute/path/to/revofmt scripts/verify
rustup target add wasm32-wasip1
cargo build --release --target wasm32-wasip1 --locked
```

the checks cover framed LSP requests, real CLI formatting, process failures,
resource limits, stale edits and the launcher's downloaded-file checks.
[the implementation plan](docs/superpowers/plans/2026-10-07-formatting-language-server.md)
describes the protocol. [publishing](docs/publishing.md) describes the server
release and registry submission.

when server code changes, regenerate the pinned digests and release archive:

```sh
scripts/package-server --update-checksums
```

change the version and download URL for a new release. don't replace an already
published server asset under the same version.

## credits

[MIT](LICENSE). started in `revo-formatter/editors/zed` at commit
`14bafd8ede11829157d0bd15ebd01cc667c4efaa`.
the formatter uses [revo](https://github.com/if-not-nil/revo), also MIT.
