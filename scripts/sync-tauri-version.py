"""Synchronize the app's version without touching dependency versions."""
import argparse
import json
import os
from pathlib import Path
import re
import tomllib


def sync(root: Path, proposed: str | None, check: bool = False) -> None:
    cargo_path = root / "src-tauri/Cargo.toml"
    config_path = root / "src-tauri/tauri.conf.json"
    lock_path = root / "src-tauri/Cargo.lock"
    cargo = cargo_path.read_text()
    config = config_path.read_text()
    lock = lock_path.read_text()
    package = tomllib.loads(cargo)["package"]
    version = proposed.removeprefix("v") if proposed is not None else package["version"]
    number = r"(?:0|[1-9][0-9]*)"
    identifier = r"(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)"
    if not re.fullmatch(rf"{number}\.{number}\.{number}(?:-{identifier}(?:\.{identifier})*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?", version):
        raise ValueError(f"Invalid release version: {version!r}")
    app_entries = [p for p in tomllib.loads(lock)["package"] if p["name"] == package["name"]]
    if len(app_entries) != 1:
        raise ValueError("Expected exactly one app package in Cargo.lock")
    if check:
        versions = [package["version"], json.loads(config)["version"], app_entries[0]["version"]]
        if versions != [version] * 3:
            raise ValueError(f"Expected {version}; Cargo.toml, tauri.conf.json, Cargo.lock contain {versions}")
        return

    def update_section(text: str, section: str, name: str | None = None) -> str:
        blocks = re.split(r"(?=^\[)", text, flags=re.M)
        matches = 0
        for i, block in enumerate(blocks):
            if block.splitlines()[:1] != [section]:
                continue
            if name is not None and not re.search(rf'^name = "{re.escape(name)}"$', block, re.M):
                continue
            blocks[i], count = re.subn(r'^version = "[^"]+"$', f'version = "{version}"', block, flags=re.M)
            matches += count
        if matches != 1:
            raise ValueError(f"Expected one version in {section}")
        return "".join(blocks)

    updated_cargo = update_section(cargo, "[package]")
    updated_lock = update_section(lock, "[[package]]", package["name"])
    config_data = json.loads(config)
    config_data["version"] = version
    cargo_path.write_text(updated_cargo)
    lock_path.write_text(updated_lock)
    config_path.write_text(json.dumps(config_data, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    sync(Path(__file__).resolve().parent.parent, os.environ.get("TAGPR_NEXT_VERSION"), args.check)
