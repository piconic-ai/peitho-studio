#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
import subprocess


MAX_COGNITIVE = 15
MAX_CYCLOMATIC = 10
CCCC_VERSION = "cccc 1.8.5"


def functions(nodes, path, parent=""):
    for node in nodes:
        name = f"{parent} / {node['name']}" if parent else node['name']
        yield dict(node, path=path, name=name)
        yield from functions(node.get("children", []), path, name)


def exceeds_threshold(node):
    return node["cognitive"] > MAX_COGNITIVE or node["cyclomatic"] > MAX_CYCLOMATIC


def measured_functions(report):
    summary = report["summary"]
    if summary["parse_error_count"]:
        raise ValueError(f"cccc parse errors in {summary.get('parse_error_files', [])}")
    if summary["file_count"] == 0 or summary["function_count"] == 0:
        raise ValueError("cccc did not measure any files or functions")
    measured = [node for file in report["files"]
                for node in functions(file["functions"], file["path"])]
    if len(measured) != summary["function_count"]:
        raise ValueError("cccc function count does not match its full report")
    return measured


def summarize(report):
    summary = report["summary"]
    measured = measured_functions(report)
    cognitive = [node for node in measured if node["cognitive"] > MAX_COGNITIVE]
    cyclomatic = [node for node in measured if node["cyclomatic"] > MAX_CYCLOMATIC]
    exceeding = list(filter(exceeds_threshold, measured))
    exceeding.sort(key=lambda node: (-node["cognitive"], -node["cyclomatic"], node["path"], node["line"]))
    lines = ["# Code complexity", "",
             f"Measured {summary['file_count']} files and {len(measured)} functions. Parse errors: 0.", "",
             f"Cognitive > {MAX_COGNITIVE}: {len(cognitive)} functions. "
             f"Cyclomatic > {MAX_CYCLOMATIC}: {len(cyclomatic)} functions. "
             f"Either threshold: {len(exceeding)} functions in {len({node['path'] for node in exceeding})} files.", "",
             "Existing complexity is informational while the remediation plan is reviewed.", "",
             "| File | Function | Cognitive | Cyclomatic |",
             "| --- | --- | ---: | ---: |"]
    for node in exceeding:
        name = node["name"].replace("|", "\\|")
        lines.append(f"| {node['path']}:{node['line']} | `{name}` | {node['cognitive']} | {node['cyclomatic']} |")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description="Measure cccc complexity without failing on existing debt")
    parser.add_argument("--output-dir", type=Path, default=Path("complexity-results"))
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    version = subprocess.run(["cccc", "--version"], stdout=subprocess.PIPE, text=True, check=True)
    if version.stdout.strip() != CCCC_VERSION:
        raise SystemExit(f"Install {CCCC_VERSION}; found {version.stdout.strip()}")
    result = subprocess.run(["cccc", "--config", str(root / "cccc.toml"), "."],
                            cwd=root, stdout=subprocess.PIPE, text=True, check=True)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "report.json").write_text(result.stdout)
    markdown = summarize(json.loads(result.stdout))
    (args.output_dir / "summary.md").write_text(markdown)
    print(markdown, end="")


if __name__ == "__main__":
    main()
