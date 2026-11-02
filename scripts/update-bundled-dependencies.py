#!/usr/bin/env python3
"""Prepare stable peitho and crit updates. Requires authenticated gh and Cargo."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

CRIT_ASSETS = {
    'aarch64-apple-darwin': 'crit-darwin-arm64',
    'x86_64-apple-darwin': 'crit-darwin-amd64',
}
PEITHO_PIN = re.compile(r'(peitho-core = \{ git = "https://github.com/mizzy/peitho", tag = ")(v\d+\.\d+\.\d+)(" \})')


def stable_version(tag):
    match = re.fullmatch(r'v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', tag)
    if not match:
        raise ValueError(f'Expected stable vMAJOR.MINOR.PATCH release, got {tag!r}')
    return tuple(map(int, match.groups()))


def newer_release(current, latest):
    return stable_version(latest) > stable_version(current)


def peitho_manifest(manifest, tag):
    stable_version(tag)
    if len(PEITHO_PIN.findall(manifest)) != 1:
        raise ValueError('Expected exactly one peitho-core Git tag pin')
    return PEITHO_PIN.sub(lambda match: match[1] + tag + match[3], manifest)


def crit_hashes(checksums):
    hashes = {}
    for line in checksums.splitlines():
        fields = line.split()
        if len(fields) != 2:
            raise ValueError(f'Malformed checksum line: {line!r}')
        digest, filename = fields
        filename = filename.removeprefix('*')
        if not re.fullmatch(r'[0-9a-f]{64}', digest):
            raise ValueError(f'Invalid SHA-256 for {filename}')
        if filename in hashes:
            raise ValueError(f'Duplicate checksum for {filename}')
        hashes[filename] = digest
    return {target: hashes[asset] for target, asset in CRIT_ASSETS.items()}


def gh(*args):
    return subprocess.run(['gh', *args], check=True, stdout=subprocess.PIPE).stdout


def latest_release(repository):
    release = json.loads(gh('api', f'repos/{repository}/releases/latest'))
    if release['draft'] or release['prerelease']:
        raise ValueError(f'{repository}: latest release is not stable')
    stable_version(release['tag_name'])
    return release['tag_name']


def upstream_file(repository, tag, path):
    content = gh('api', f'repos/{repository}/contents/{path}?ref={tag}',
                 '--header', 'Accept: application/vnd.github.raw+json')
    if not content.strip():
        raise ValueError(f'{repository}@{tag}: empty {path}')
    return content


def prepare_updates(root):
    writes = {}
    manifest_path = root / 'src-tauri/Cargo.toml'
    manifest = manifest_path.read_text()
    pins = PEITHO_PIN.findall(manifest)
    if len(pins) != 1:
        raise ValueError('Expected exactly one peitho-core Git tag pin')
    peitho_tag = latest_release('mizzy/peitho')
    if newer_release(pins[0][1], peitho_tag):
        writes[manifest_path] = peitho_manifest(manifest, peitho_tag).encode()
        for source, destination in [
            ('layouts/title-body-code.html', 'title-body-code.html'),
            ('themes/base.css', 'base.css'),
        ]:
            path = root / 'src-tauri/src/engine/builtin' / destination
            writes[path] = upstream_file('mizzy/peitho', peitho_tag, source)
        contributing = root / 'CONTRIBUTING.md'
        text, count = re.subn(r'(matching `peitho` CLI on `PATH` to use Present \(currently )v\d+\.\d+\.\d+(\)\.)',
                             lambda match: match[1] + peitho_tag + match[2], contributing.read_text())
        if count != 1:
            raise ValueError('Expected one matching Peitho CLI version in CONTRIBUTING.md')
        writes[contributing] = text.encode()

    crit_path = root / 'src-tauri/crit-release.json'
    crit = json.loads(crit_path.read_text())
    crit_tag = latest_release(crit['repository'])
    if newer_release('v' + crit['version'], crit_tag):
        with tempfile.TemporaryDirectory(prefix='crit-update-') as directory:
            gh('release', 'download', crit_tag, '--repo', crit['repository'], '--dir', directory,
               '--pattern', 'checksums.txt', '--pattern', 'crit-darwin-*')
            hashes = crit_hashes((Path(directory) / 'checksums.txt').read_text())
            for target, asset in CRIT_ASSETS.items():
                actual = hashlib.sha256((Path(directory) / asset).read_bytes()).hexdigest()
                if actual != hashes[target]:
                    raise ValueError(f'{asset}: SHA-256 mismatch')
        crit['version'] = crit_tag[1:]
        crit['sha256'] = hashes
        writes[crit_path] = (json.dumps(crit, indent=2) + '\n').encode()
        writes[root / 'src-tauri/licenses/crit/LICENSE'] = upstream_file(crit['repository'], crit_tag, 'LICENSE')
    return {path: content for path, content in writes.items() if path.read_bytes() != content}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='Validate upstream assets and print changes without writing')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    writes = prepare_updates(root)
    if not writes:
        print('Bundled dependencies already match the latest stable releases.')
        return
    for path in writes:
        print(path.relative_to(root))
    if args.dry_run:
        return
    for path, content in writes.items():
        path.write_bytes(content)
    if root / 'src-tauri/Cargo.toml' in writes:
        subprocess.run(['cargo', 'update', '--manifest-path', str(root / 'src-tauri/Cargo.toml'),
                        '-p', 'peitho-core'], check=True)


if __name__ == '__main__':
    main()
