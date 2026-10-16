"""Regression checks for the archive boundary between native builds and fnpack."""

import importlib.util
import io
import os
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("fnos_staging", Path(__file__).with_name("extract-fnos-staging.py"))
staging = importlib.util.module_from_spec(spec)
spec.loader.exec_module(staging)


class StagingChecks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="terma-fnos-staging-")
        self.base = Path(self.temporary.name)
        self.archive = self.base / "native.tar.gz"
        self.output = self.base / "output"
        self.output.mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, entries):
        with tarfile.open(self.archive, "w:gz") as archive:
            for name, kind, value in entries:
                item = tarfile.TarInfo(name)
                item.type = kind
                item.mode = 0o755
                if kind == tarfile.REGTYPE:
                    item.size = len(value)
                    archive.addfile(item, io.BytesIO(value))
                else:
                    item.linkname = value
                    archive.addfile(item)

    def reject(self, entries):
        self.write(entries)
        with self.assertRaises((ValueError, OSError, RuntimeError)):
            staging.extract_staging(self.archive, self.output)
        self.assertFalse((self.base / "escaped").exists())

    def test_native_executable_and_unicode_paths(self):
        self.write([("terma/app/server/native helper", tarfile.REGTYPE, b"native"),
                    ("terma/poster/终端.jpg", tarfile.REGTYPE, b"image")])
        staging.extract_staging(self.archive, self.output)
        self.assertEqual((self.output / "terma/poster/终端.jpg").read_bytes(), b"image")
        if os.name != "nt":
            self.assertEqual((self.output / "terma/app/server/native helper").stat().st_mode & 0o777, 0o755)

    def test_rejects_path_traversal(self):
        self.reject([("terma/../../escaped", tarfile.REGTYPE, b"escape")])

    def test_rejects_absolute_path(self):
        self.reject([("/terma/escaped", tarfile.REGTYPE, b"escape")])

    def test_rejects_windows_drive(self):
        self.reject([("terma/C:/escaped", tarfile.REGTYPE, b"escape")])

    def test_rejects_duplicate_members(self):
        self.reject([("terma/file", tarfile.REGTYPE, b"one"), ("terma/file", tarfile.REGTYPE, b"two")])

    def test_rejects_root_link(self):
        self.reject([("terma", tarfile.SYMTYPE, "../escaped")])

    def test_rejects_hardlinks_and_special_files(self):
        for kind in [tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE]:
            self.reject([("terma/file", kind, "../../escaped")])

    def test_rejects_oversized_member_before_reading_contents(self):
        with tarfile.open(self.archive, "w:gz") as archive:
            member = tarfile.TarInfo("terma/large")
            member.size = 256 * 1024 ** 2 + 1
            archive.addfile(member)
        with self.assertRaisesRegex(ValueError, "size limits"):
            staging.extract_staging(self.archive, self.output)

    @unittest.skipIf(os.name == "nt", "Native staging is extracted on Linux")
    def test_keeps_internal_npm_symlink(self):
        self.write([("terma/node_modules/tool/bin.js", tarfile.REGTYPE, b"tool"),
                    ("terma/node_modules/.bin/tool", tarfile.SYMTYPE, "../tool/bin.js")])
        staging.extract_staging(self.archive, self.output)
        self.assertEqual((self.output / "terma/node_modules/.bin/tool").read_bytes(), b"tool")

    @unittest.skipIf(os.name == "nt", "Native staging is extracted on Linux")
    def test_rejects_external_symlink(self):
        self.reject([("terma/link", tarfile.SYMTYPE, "../../escaped")])

    @unittest.skipIf(os.name == "nt", "Native staging is extracted on Linux")
    def test_does_not_write_through_symlink_parent(self):
        self.reject([("terma/link", tarfile.SYMTYPE, "../../escaped"),
                     ("terma/link/child", tarfile.SYMTYPE, "../target")])

    def test_refuses_nonempty_workspace(self):
        self.write([("terma/file", tarfile.REGTYPE, b"file")])
        (self.output / "existing").write_text("keep")
        with self.assertRaisesRegex(ValueError, "empty"):
            staging.extract_staging(self.archive, self.output)
        self.assertEqual((self.output / "existing").read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
