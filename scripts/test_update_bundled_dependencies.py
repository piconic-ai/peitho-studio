import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('updater', Path(__file__).with_name('update-bundled-dependencies.py'))
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)

PIN = 'peitho-core = { git = "https://github.com/mizzy/peitho", tag = "v1.34.0" }\n'


class ReleaseTests(unittest.TestCase):
    def test_stable_release_compares_numbers_and_never_downgrades(self):
        self.assertTrue(updater.newer_release('v1.9.0', 'v1.10.0'))
        self.assertFalse(updater.newer_release('v2.0.0', 'v1.99.0'))
        self.assertFalse(updater.newer_release('v1.0.0', 'v1.0.0'))

    def test_prerelease_or_unsafe_tag_is_rejected(self):
        for tag in ['', '1.2.3', 'v1.2.3-rc.1', 'v01.2.3', 'v1.2.3\n', 'v1.2.3/../../file']:
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                updater.stable_version(tag)

    def test_manifest_changes_only_exact_pin(self):
        manifest = '[package]\nversion = "1.34.0"\n' + PIN
        self.assertEqual(updater.peitho_manifest(manifest, 'v1.48.0'),
                         manifest.replace('tag = "v1.34.0"', 'tag = "v1.48.0"'))
        for invalid in ['', PIN + PIN, PIN.replace('tag =', 'rev =')]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                updater.peitho_manifest(invalid, 'v1.48.0')

    def test_checksums_map_both_architectures(self):
        checksums = '\n'.join(f'{str(index) * 64}  {asset}'
                              for index, asset in enumerate(updater.CRIT_ASSETS.values()))
        self.assertEqual(updater.crit_hashes(checksums), {
            'aarch64-apple-darwin': '0' * 64, 'x86_64-apple-darwin': '1' * 64,
        })
        self.assertEqual(updater.crit_hashes(checksums.replace('  ', ' *')), updater.crit_hashes(checksums))

    def test_missing_duplicate_and_malformed_checksums_fail(self):
        valid = '\n'.join(f'{"a" * 64}  {asset}' for asset in updater.CRIT_ASSETS.values())
        for invalid in ['', valid.splitlines()[0], valid + '\n' + valid.splitlines()[0],
                        valid.replace('a' * 64, 'invalid'), valid + '\ninvalid']:
            with self.subTest(invalid=invalid), self.assertRaises((ValueError, KeyError)):
                updater.crit_hashes(invalid)


class UpdatePlanTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.write('src-tauri/Cargo.toml', PIN.encode())
        self.write('CONTRIBUTING.md', b'Install the matching `peitho` CLI on `PATH` to use Present (currently v1.34.0).\n')
        self.write('src-tauri/crit-release.json', json.dumps({
            'version': '0.21.0', 'repository': 'tomasz-tomczyk/crit',
            'sha256': {target: '0' * 64 for target in updater.CRIT_ASSETS},
        }).encode())
        for filename in ['title-body-code.html', 'base.css']:
            self.write('src-tauri/src/engine/builtin/' + filename, b'old builtin')
        self.write('src-tauri/licenses/crit/LICENSE', b'old license')

    def write(self, filename, content):
        path = self.root / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    def snapshot(self):
        return {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}

    def test_no_update_performs_no_downloads_or_writes(self):
        before = self.snapshot()
        with patch.object(updater, 'latest_release', side_effect=['v1.34.0', 'v0.21.0']), \
                patch.object(updater, 'upstream_file') as download:
            self.assertEqual(updater.prepare_updates(self.root), {})
        download.assert_not_called()
        self.assertEqual(self.snapshot(), before)

    def test_plan_synchronizes_all_upstream_files_without_writing(self):
        before = self.snapshot()
        binary = b'crit binary'
        digest = hashlib.sha256(binary).hexdigest()

        def release_download(*args):
            directory = Path(args[args.index('--dir') + 1])
            for asset in updater.CRIT_ASSETS.values():
                (directory / asset).write_bytes(binary)
            (directory / 'checksums.txt').write_text('\n'.join(
                f'{digest}  {asset}' for asset in updater.CRIT_ASSETS.values()))
            return b''

        with patch.object(updater, 'latest_release', side_effect=['v1.48.0', 'v0.23.2']), \
                patch.object(updater, 'gh', side_effect=release_download), \
                patch.object(updater, 'upstream_file', return_value=b'new upstream file'):
            writes = updater.prepare_updates(self.root)
        self.assertEqual(len(writes), 6)
        self.assertIn(b'tag = "v1.48.0"', writes[self.root / 'src-tauri/Cargo.toml'])
        self.assertIn(b'currently v1.48.0', writes[self.root / 'CONTRIBUTING.md'])
        crit = json.loads(writes[self.root / 'src-tauri/crit-release.json'])
        self.assertEqual(crit['version'], '0.23.2')
        self.assertEqual(crit['sha256'], {target: digest for target in updater.CRIT_ASSETS})
        self.assertEqual(self.snapshot(), before)

    def test_checksum_mismatch_fails_before_any_write(self):
        before = self.snapshot()

        def release_download(*args):
            directory = Path(args[args.index('--dir') + 1])
            for asset in updater.CRIT_ASSETS.values():
                (directory / asset).write_bytes(b'tampered')
            (directory / 'checksums.txt').write_text('\n'.join(
                f'{"0" * 64}  {asset}' for asset in updater.CRIT_ASSETS.values()))
            return b''

        with patch.object(updater, 'latest_release', side_effect=['v1.48.0', 'v0.23.2']), \
                patch.object(updater, 'gh', side_effect=release_download), \
                patch.object(updater, 'upstream_file', return_value=b'new upstream file'), \
                self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
            updater.prepare_updates(self.root)
        self.assertEqual(self.snapshot(), before)


if __name__ == '__main__':
    unittest.main()
