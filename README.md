# `revofmt-zed`, revo formatting in zed

open a `.rv` or `.revo` file, run `editor: format`, get formatted code.
it works on your unsaved buffer. format-on-save is off until you turn it on.

[get started](#get-started) | [settings](#settings) | [limits](#limits) | [develop](#develop)

## get started

you need zed and [revofmt](https://github.com/w0x7y/revo-formatter).
[download the formatter](https://github.com/w0x7y/revo-formatter#get)
or [build it](https://github.com/w0x7y/revo-formatter#build-from-source).
the download is for linux x86_64 GNU, with glibc >=2.34 and `libgcc_s`.
this extension doesn't install the formatter for you.
this separate package isn't in the official registry; see [publishing](docs/publishing.md).

check that it's on your PATH:

```sh
revofmt --version
```

already using [revo-zed-extension](https://github.com/w0x7y/revo-zed-extension)
or another extension for revo? keep it and go straight to
`zed: open settings file` below.
don't install two extensions that both define the `Revo` language.

otherwise, clone this one:

```sh
git clone https://github.com/w0x7y/revofmt-zed.git
```

in zed's command palette, run `zed: install dev extension` and select the cloned
`revofmt-zed` folder. it adds file recognition; use the language extension above
for highlighting and the language server.

run `zed: open settings file` and merge this into your existing settings.
you can use the project's `.zed/settings.json` instead.
installing the extension doesn't apply these settings automatically.

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

open a `.rv` or `.revo` file with LF line endings. the status bar should say
`Revo`. run `editor: format` on this:

```revo
let x=1
```

and you get:

```revo
let x = 1
```

for an unnamed buffer, select `Revo` as the language first.

## settings

if zed can't find the formatter, replace `"command": "revofmt"` with its absolute
path. keep arguments in the array. paths are literal; `~` and shell commands
aren't expanded.

indentation accepts `1` to `8` spaces. width accepts `20` to `240` columns and
is a soft target. for four spaces and 100 columns, change `arguments` to:

```json
["--indent-width", "4", "--line-width", "100", "-"]
```

keep the final `-`. it tells revofmt to read your unsaved buffer.

to format on save, change `"format_on_save": "off"` to `"format_on_save": "on"`.
keep both whitespace settings `false`, even for manual formatting. zed's
whitespace cleanup can change spaces inside multiline strings before revofmt runs.
avoid formatter chains and format code actions that could change them too.

## limits

use UTF-8 files with LF line endings. zed normalizes CRLF and mixed endings,
including those inside strings and comments. use the CLI directly if you need
to preserve the original bytes.

revofmt checks syntax, literal and comment bytes, and that formatting twice
gives the same result. it accepts up to 262,144 source bytes, with further
[input limits](https://github.com/w0x7y/revo-formatter/blob/main/docs/verification/input-limits.md).
zed runs the command and applies its output; this extension adds no timeout or
cancellation handling of its own.

## develop

with python >=3.11 and an installed formatter, from this repository's root:

```sh
scripts/verify                          # revofmt on PATH
REVOFMT_BIN=/absolute/path/to/revofmt scripts/verify
python3 tests/run.py MetadataTests      # metadata only
```

the 15 checks cover the settings and real CLI formatting, including byte
preservation, idempotence and failures. they don't automate zed's buffer edits
or undo. the [CI workflow](.github/workflows/test.yml) downloads a pinned,
checksum-verified formatter and runs the same checks.

## credits

[MIT](LICENSE). started in `revo-formatter/editors/zed` at commit
`14bafd8ede11829157d0bd15ebd01cc667c4efaa`.
the formatter uses [revo](https://github.com/if-not-nil/revo), also MIT.
