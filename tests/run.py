#!/usr/bin/env python3
"""Check declarative Zed metadata and the configured CLI, not a running editor."""

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
        self.assertTrue(path.is_file(), "missing native external formatter settings")
        settings = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(set(settings), {"languages"})
        self.assertEqual(set(settings["languages"]), {"Revo"})
        return settings["languages"]["Revo"]

    def test_manifest_registers_a_declarative_extension(self):
        manifest = self.read_toml("extension.toml")
        self.assertEqual(manifest["id"], "revofmt")
        self.assertEqual(manifest["schema_version"], 1)
        self.assertTrue(manifest["name"])
        self.assertTrue(manifest["version"])
        self.assertTrue(manifest["authors"])
        for procedural_feature in ("lib", "grammars", "language_servers"):
            self.assertNotIn(procedural_feature, manifest)
        self.assertFalse((PACKAGE / "Cargo.toml").exists())

    def test_recognizes_both_revo_suffixes_without_a_grammar(self):
        config = self.read_toml("languages/revo/config.toml")
        self.assertEqual(config["name"], "Revo")
        self.assertEqual(set(config["path_suffixes"]), {"rv", "revo"})
        self.assertNotIn("grammar", config)

    def test_external_formatter_reads_stdin_with_explicit_layout(self):
        settings = self.revo_settings()
        self.assertEqual(settings["formatter"], {
            "external": {
                "command": "revofmt",
                "arguments": ["--indent-width", "2", "--line-width", "80", "-"],
            }
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
        external = settings["languages"]["Revo"]["formatter"]["external"]
        # Override only the executable. Every test consumes the shipped arguments.
        executable = os.environ.get("REVOFMT_BIN") or shutil.which(external["command"])
        if not executable:
            raise ValueError("install revofmt on PATH or set REVOFMT_BIN to its absolute path")
        cls.executable = Path(executable)
        if not cls.executable.is_absolute():
            raise ValueError("REVOFMT_BIN must be an absolute executable path")
        if not cls.executable.is_file() or not os.access(cls.executable, os.X_OK):
            raise ValueError(f"REVOFMT_BIN must select an existing executable: {cls.executable}")
        cls.command = [str(cls.executable), *external["arguments"]]

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
