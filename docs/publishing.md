# registry publishing

This separate formatter package is distributed through its Git repository and
manual Zed settings. Version `0.1.0` has not been submitted to the official
registry. It does not currently meet the registry's language-extension rules.

## what blocks submission

The package declares the `Revo` language for file recognition but includes no
grammar. Zed's [publishing prerequisites](https://zed.dev/docs/extensions/publishing/prerequisites)
require a grammar for every language a language extension provides. Installing
this package also does not apply its `settings.json`; users configure the native
external formatter themselves.

A second language registration would overlap with a Revo language extension.
The registry asks contributors to provide distinct functionality and contribute
to an existing extension when functionality overlaps. Adding a duplicate grammar
only to pass the submission check would not resolve that overlap.

The independent formatter repository remains useful with the existing language
extension: use only its formatter settings as described in the [README](../README.md#get-started).
The [Revo language extension](https://github.com/w0x7y/revo-zed-extension) has a
[separate registry submission](https://github.com/zed-industries/extensions/pull/7900).
That submission does not publish this formatter package.

## before a future submission

A separate store submission needs a distinct supported extension capability that
satisfies the registry rules. That would change this package's implementation;
no such change or new registry pull request was made during this preparation.

Test the exact proposed commit manually in Zed, including formatting and undo.
The current 15 metadata and CLI checks do not establish native buffer edits.
Keep the MIT license and public repository URL with the submission.

The [publishing guide](https://zed.dev/docs/extensions/publishing/publishing-guide)
describes the HTTPS submodule, matching version entry and sorted registry files.
Publication happens after maintainers merge the submission. The registry's
[AI policy](https://github.com/zed-industries/extensions/blob/main/AI_POLICY.md)
requires human-owned submissions and maintainer communication; the owner must
understand the extension and write the submission in their own words.

These requirements were checked on 2026-10-07. Check the current rules again
before submitting.
