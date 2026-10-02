import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('sync_version', Path(__file__).with_name('sync-tauri-version.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class VersionSyncTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / 'src-tauri'
        self.app.mkdir()
        (self.app / 'Cargo.toml').write_text('[package]\nname = "peitho-studio"\nversion = "0.1.0-rc.7"\n\n[dependencies]\nexample = "0.1.0-rc.7"\n')
        (self.app / 'Cargo.lock').write_text('version = 4\n\n[[package]]\nname = "example"\nversion = "0.1.0-rc.7"\n\n[[package]]\nname = "peitho-studio"\nversion = "0.1.0-rc.7"\n')
        (self.app / 'tauri.conf.json').write_text('{"version":"0.1.0-rc.7", "productName":"Peitho Studio"}\n')

    def snapshot(self):
        return {p.name: p.read_text() for p in self.app.iterdir()}

    def test_rc_to_stable_uses_proposed_version_and_preserves_dependencies(self):
        module.sync(self.root, 'v0.1.0')
        module.sync(self.root, 'v0.1.0', check=True)
        files = self.snapshot()
        self.assertIn('example = "0.1.0-rc.7"', files['Cargo.toml'])
        self.assertIn('name = "example"\nversion = "0.1.0-rc.7"', files['Cargo.lock'])
        self.assertEqual(json.loads(files['tauri.conf.json'])['productName'], 'Peitho Studio')
        module.sync(self.root, 'v0.1.0')
        self.assertEqual(self.snapshot(), files)

    def test_next_patch_and_rc(self):
        for version in ('v0.1.1', 'v0.2.0-rc.1'):
            module.sync(self.root, version)
            module.sync(self.root, version, check=True)

    def test_manual_sync_reads_cargo(self):
        (self.app / 'tauri.conf.json').write_text('{"version":"0.0.0"}')
        module.sync(self.root, None)
        module.sync(self.root, 'v0.1.0-rc.7', check=True)

    def test_check_rejects_stale_rc_without_writing(self):
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'Expected 0.1.0'):
            module.sync(self.root, 'v0.1.0', check=True)
        self.assertEqual(self.snapshot(), before)

    def test_invalid_version_does_not_write(self):
        before = self.snapshot()
        for version in ('', 'v1', 'v01.0.0', 'v1.0.0-01', '1.0.0\n', '../1.0.0'):
            with self.assertRaises(ValueError):
                module.sync(self.root, version)
            self.assertEqual(self.snapshot(), before)

    def test_missing_app_lock_entry_does_not_write(self):
        (self.app / 'Cargo.lock').write_text('[[package]]\nname = "example"\nversion = "0.1.0"\n')
        before = self.snapshot()
        with self.assertRaises(ValueError):
            module.sync(self.root, 'v0.1.0')
        self.assertEqual(self.snapshot(), before)


if __name__ == '__main__':
    unittest.main()
