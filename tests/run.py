#!/usr/bin/env python3
"""Check language-server metadata and its real formatter CLI contract."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import tomllib
import unittest


PACKAGE = Path(__file__).resolve().parents[1]


class MetadataTests(unittest.TestCase):
    def read_toml(self, relative):
        path = PACKAGE / relative
        self.assertTrue(path.is_file(), f"missing Zed metadata: {relative}")
        return tomllib.loads(path.read_text(encoding="utf-8"))

    def revo_settings(self):
        path = PACKAGE / "settings.json"
        self.assertTrue(path.is_file(), "missing language-server formatter settings")
        settings = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(set(settings), {"languages", "lsp"})
        self.assertEqual(set(settings["languages"]), {"Revo"})
        return settings["languages"]["Revo"]

    def test_manifest_registers_only_a_formatting_server(self):
        manifest = self.read_toml("extension.toml")
        self.assertEqual(manifest["id"], "revofmt-lsp")
        self.assertEqual(manifest["schema_version"], 1)
        self.assertEqual(manifest["version"], "0.3.0")
        self.assertEqual(manifest["lib"]["version"], "0.7.0")
        self.assertEqual(set(manifest["language_servers"]), {"revofmt-lsp"})
        self.assertEqual(manifest["language_servers"]["revofmt-lsp"]["languages"], ["Revo"])
        self.assertNotIn("grammars", manifest)
        self.assertNotIn("languages", manifest)

    def test_language_registration_belongs_to_the_language_extension(self):
        self.assertFalse((PACKAGE / "languages").exists())
        self.assertEqual(self.revo_settings()["language_servers"], ["revofmt-lsp", "..."])

    def test_settings_select_the_formatting_server_with_explicit_layout(self):
        self.assertEqual(self.revo_settings()["formatter"], {
            "language_server": {"name": "revofmt-lsp"}
        })
        settings = json.loads((PACKAGE / "settings.json").read_text(encoding="utf-8"))
        self.assertEqual(settings["lsp"]["revofmt-lsp"]["initialization_options"], {
            "indentWidth": 2, "lineWidth": 80, "indentStyle": "space",
            "maxBlankLines": 1, "timeoutMs": 5000
        })

    def test_save_is_opt_in_and_cli_owns_whitespace(self):
        settings = self.revo_settings()
        self.assertEqual(settings["format_on_save"], "off")
        self.assertIs(settings["remove_trailing_whitespace_on_save"], False)
        self.assertIs(settings["ensure_final_newline_on_save"], False)

    def test_package_includes_the_complete_project_license(self):
        path = PACKAGE / "LICENSE"
        self.assertTrue(path.is_file(), "missing standalone package license")
        # Pin the complete upstream notice without requiring its checkout.
        self.assertEqual(
            hashlib.sha256(path.read_bytes()).hexdigest(),
            "c13416af96b5251d69ae0c5aaccca5df97a1cc44b21577c7f1f8103ef0f7652a",
        )


class CommandTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        settings = json.loads((PACKAGE / "settings.json").read_text(encoding="utf-8"))
        options = settings["lsp"]["revofmt-lsp"]["initialization_options"]
        # Exercise the CLI layout options shipped for the server.
        executable = os.environ.get("REVOFMT_BIN") or shutil.which("revofmt")
        if not executable:
            raise ValueError("install revofmt on PATH or set REVOFMT_BIN to its absolute path")
        cls.executable = Path(executable)
        if not cls.executable.is_absolute():
            raise ValueError("REVOFMT_BIN must be an absolute executable path")
        if not cls.executable.is_file() or not os.access(cls.executable, os.X_OK):
            raise ValueError(f"REVOFMT_BIN must select an existing executable: {cls.executable}")
        cls.options = options
        cls.command = cls.command_for()

    @classmethod
    def command_for(cls, stdin_filepath=None):
        # Same argument order as the language server: discovery first, layout last.
        command = [str(cls.executable), "--prefer-config"]
        if stdin_filepath is not None:
            command += ["--stdin-filepath", str(stdin_filepath)]
        return command + [
            "--indent-width", str(cls.options["indentWidth"]),
            "--line-width", str(cls.options["lineWidth"]),
            "--indent-style", cls.options["indentStyle"],
            "--max-blank-lines", str(cls.options["maxBlankLines"]), "-",
        ]

    def invoke(self, source, command=None, cwd=None):
        # Bytes avoid Python's universal-newline decoding. No shell or disk input.
        return subprocess.run(
            self.command if command is None else command,
            input=source, capture_output=True, timeout=10, cwd=cwd,
        )

    def assert_format(self, source, expected):
        first = self.invoke(source)
        self.assertEqual(first.returncode, 0, first.stderr.decode("utf-8", "replace"))
        self.assertEqual(first.stderr, b"")
        self.assertEqual(first.stdout, expected)
        second = self.invoke(first.stdout)
        self.assertEqual(second.returncode, 0, second.stderr.decode("utf-8", "replace"))
        self.assertEqual(second.stderr, b"")
        self.assertEqual(second.stdout, expected, "CLI output must be idempotent")

    def test_empty_stdin_stays_empty(self):
        self.assert_format(b"", b"")

    def test_lf_source_uses_configured_indentation(self):
        self.assert_format(
            b"fn f() do\nlet x=1\nx\nend",
            b"fn f() do\n  let x = 1\n  x\nend\n",
        )

    def test_configured_line_width_wraps_a_long_call(self):
        self.assert_format(
            b"print(first_argument_abcdefghijklmnop, second_argument_abcdefghijklmnop, third_argument)",
            b"print(\n  first_argument_abcdefghijklmnop,\n  second_argument_abcdefghijklmnop,\n  third_argument\n)\n",
        )

    def test_lf_literals_keep_unicode_and_trailing_spaces(self):
        self.assert_format(
            "let x='first  \n  שלום'\nlet y=1".encode("utf-8"),
            "let x = 'first  \n  שלום'\nlet y = 1\n".encode("utf-8"),
        )

    def test_raw_cli_preserves_crlf_layout_and_literal_bytes(self):
        self.assert_format(
            b"let x='first  \r\nsecond'\r\nlet y=1\r\n",
            b"let x = 'first  \r\nsecond'\r\nlet y = 1\r\n",
        )

    def test_raw_cli_preserves_mixed_literal_and_layout_endings(self):
        self.assert_format(
            b"let x='first\r\nsecond'\nlet y=1\n",
            b"let x = 'first\r\nsecond'\nlet y = 1\n",
        )

    def test_syntax_failure_returns_stderr_without_formatted_output(self):
        result = self.invoke(b"let x=")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, b"")
        self.assertIn(b"stdin", result.stderr.lower())
        self.assertIn(b"unexpected token", result.stderr.lower())

    def test_invalid_layout_fails_without_formatted_output(self):
        command = [str(self.executable), "--indent-width", "0", "--line-width", "80", "-"]
        result = self.invoke(b"let x=1", command=command)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, b"")
        self.assertIn(b"indent", result.stderr.lower())

    def test_oversized_stdin_fails_without_formatted_output(self):
        result = self.invoke(b" " * 262145)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, b"")
        self.assertTrue(result.stderr)

    def test_project_config_with_stdin_path_selects_tabs_for_a_missing_file(self):
        with tempfile.TemporaryDirectory(prefix="revofmt-zed-") as directory:
            (Path(directory) / "revofmt.toml").write_text('indent_style = "tab"\n', encoding="utf-8")
            missing = Path(directory) / "unsaved.rv"
            result = self.invoke(b"fn f() do\nlet x=1\nend", command=self.command_for(missing))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stderr, b"")
            self.assertEqual(result.stdout, b"fn f() do\n\tlet x = 1\nend\n")
            self.assertFalse(missing.exists())
            self.assertEqual([path.name for path in Path(directory).iterdir()], ["revofmt.toml"])

    def test_project_config_beats_every_layout_argument_and_resets_omitted_keys(self):
        with tempfile.TemporaryDirectory(prefix="revofmt-zed-") as directory:
            (Path(directory) / "revofmt.toml").write_text("max_blank_lines = 0\n", encoding="utf-8")
            command = self.command_for(Path(directory) / "a.rv")
            command[command.index("--indent-width") + 1] = "4"
            command[command.index("--indent-style") + 1] = "tab"
            result = self.invoke(b"fn f() do\nlet x=1\n\n\nlet y=2\nend", command=command)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, b"fn f() do\n  let x = 1\n  let y = 2\nend\n")

    def test_without_a_stdin_path_the_working_directory_config_is_ignored(self):
        with tempfile.TemporaryDirectory(prefix="revofmt-zed-") as directory:
            (Path(directory) / "revofmt.toml").write_text('indent_style = "tab"\n', encoding="utf-8")
            result = self.invoke(b"fn f() do\nlet x=1\nend", cwd=directory)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, b"fn f() do\n  let x = 1\nend\n")

    def test_malformed_project_config_fails_with_a_diagnostic_naming_the_file(self):
        with tempfile.TemporaryDirectory(prefix="revofmt-zed-") as directory:
            (Path(directory) / "revofmt.toml").write_text('indent_style = "tabs"\n', encoding="utf-8")
            result = self.invoke(b"let x=1", command=self.command_for(Path(directory) / "a.rv"))
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout, b"")
            self.assertIn(b"revofmt.toml", result.stderr)

    def test_print_mode_formats_stdin_without_writing_files(self):
        with tempfile.TemporaryDirectory(prefix="revofmt-zed-") as directory:
            disk_source = Path(directory) / "same.revo"
            disk_source.write_bytes(b"let disk=2")
            result = self.invoke(b"let unsaved=1", cwd=directory)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, b"let unsaved = 1\n")
            self.assertEqual(disk_source.read_bytes(), b"let disk=2")
            self.assertEqual(list(Path(directory).iterdir()), [disk_source])


if __name__ == "__main__":
    unittest.main(verbosity=2)
