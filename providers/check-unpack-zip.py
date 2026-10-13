import importlib.util
import pathlib
import stat
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("native_zip", pathlib.Path(__file__).with_name("unpack-zip.py"))
native_zip = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native_zip)


class NativeZipChecks(unittest.TestCase):
    def make_zip(self, filename, entries):
        with zipfile.ZipFile(filename, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, content, mode in entries:
                info = zipfile.ZipInfo(name)
                info.create_system = 3
                info.external_attr = mode << 16
                archive.writestr(info, content)

    def test_dependency_symlink_and_executable_survive(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            archive = root / "app.zip"
            self.make_zip(archive, [
                ("node_modules/pdfkit", ".pnpm/pdfkit@1/node_modules/pdfkit", stat.S_IFLNK | 0o777),
                ("node_modules/.pnpm/pdfkit@1/node_modules/pdfkit/data/Helvetica.afm", b"native font asset", stat.S_IFREG | 0o644),
                ("bin/start", b"#!/bin/sh\nexit 0\n", stat.S_IFREG | 0o755),
            ])
            native_zip.unpack_zip(archive, root / "output")
            self.assertTrue((root / "output/node_modules/pdfkit").is_symlink())
            self.assertEqual((root / "output/node_modules/pdfkit/data/Helvetica.afm").read_bytes(), b"native font asset")
            self.assertEqual(stat.S_IMODE((root / "output/bin/start").stat().st_mode), 0o755)

    def test_escaping_and_absolute_paths_are_rejected(self):
        for name, target, mode in [
            ("../outside", b"bad", stat.S_IFREG | 0o644),
            ("/absolute", b"bad", stat.S_IFREG | 0o644),
            ("link", "../outside", stat.S_IFLNK | 0o777),
            ("link", "/absolute", stat.S_IFLNK | 0o777),
        ]:
            with self.subTest(name=name, target=target), tempfile.TemporaryDirectory() as temporary:
                root = pathlib.Path(temporary)
                archive = root / "app.zip"
                self.make_zip(archive, [(name, target, mode)])
                with self.assertRaises(ValueError):
                    native_zip.unpack_zip(archive, root / "output")
                self.assertFalse((root / "outside").exists())

    def test_preexisting_escape_cannot_receive_file_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            outside, output = root / "outside", root / "output"
            outside.mkdir()
            output.mkdir()
            (output / "link").symlink_to(outside)
            archive = root / "app.zip"
            self.make_zip(archive, [("link/file", b"bad", stat.S_IFREG | 0o644)])
            with self.assertRaises(ValueError):
                native_zip.unpack_zip(archive, output)
            self.assertFalse((outside / "file").exists())


if __name__ == "__main__":
    unittest.main()
