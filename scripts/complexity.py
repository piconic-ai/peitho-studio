#!/usr/bin/env python3
import argparse
from collections import Counter
import json
from pathlib import Path
import subprocess


MAX_COGNITIVE = 15
MAX_CYCLOMATIC = 10
CCCC_VERSION = "cccc 1.8.5"
BASELINE_METADATA = {"schema_version": 1, "cccc_version": CCCC_VERSION,
                     "thresholds": {"cognitive": MAX_COGNITIVE, "cyclomatic": MAX_CYCLOMATIC}}


def functions(nodes, path, parent=""):
    for node in nodes:
        name = f"{parent} / {node['name']}" if parent else node['name']
        yield dict(node, path=path, name=name)
        yield from functions(node.get("children", []), path, name)


def exceeds_threshold(node):
    return node["cognitive"] > MAX_COGNITIVE


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
    occurrences = Counter()
    for node in measured:
        node["path"] = Path(node["path"]).as_posix().removeprefix("./")
        key = (node["path"], node["name"])
        occurrences[key] += 1
        node["occurrence"] = occurrences[key]
    return measured


def summarize(report):
    summary = report["summary"]
    measured = measured_functions(report)
    cyclomatic = [node for node in measured if node["cyclomatic"] > MAX_CYCLOMATIC]
    exceeding = list(filter(exceeds_threshold, measured))
    exceeding.sort(key=lambda node: (-node["cognitive"], -node["cyclomatic"], node["path"], node["line"]))
    lines = ["# Code complexity", "",
             f"Measured {summary['file_count']} files and {len(measured)} functions. Parse errors: 0.", "",
             f"Cognitive > {MAX_COGNITIVE}: {len(exceeding)} functions in {len({node['path'] for node in exceeding})} files. "
             f"Cyclomatic > {MAX_CYCLOMATIC} (informational): {len(cyclomatic)} functions.", "",
             "Existing cognitive baseline entries are allowed; only new or increased cognitive complexity fails CI.", "",
             "| File | Function | Cognitive | Cyclomatic |",
             "| --- | --- | ---: | ---: |"]
    for node in exceeding:
        name = node["name"].replace("|", "\\|")
        lines.append(f"| {node['path']}:{node['line']} | `{name}` | {node['cognitive']} | {node['cyclomatic']} |")
    return "\n".join(lines) + "\n"


def identity(node):
    return (node["path"], node["name"], node["occurrence"])


def baseline_for(report):
    entries = [{key: node[key] for key in ("path", "name", "occurrence", "line", "cognitive", "cyclomatic")}
               for node in measured_functions(report) if exceeds_threshold(node)]
    return {**BASELINE_METADATA, "thresholds": dict(BASELINE_METADATA["thresholds"]),
            "functions": sorted(entries, key=identity)}


def validate_entry(node):
    if not isinstance(node, dict):
        raise ValueError("Baseline function must be an object")
    for key in ("path", "name"):
        if not isinstance(node.get(key), str) or not node[key]:
            raise ValueError(f"Baseline function requires {key}")
    if node["path"] != Path(node["path"]).as_posix() or node["path"].startswith(("./", "/")) or ".." in Path(node["path"]).parts:
        raise ValueError("Baseline paths must be normalized and repository-relative")
    validate_scores(node)
    if not exceeds_threshold(node) and node["cyclomatic"] <= MAX_CYCLOMATIC:
        raise ValueError("Baseline contains a function within both thresholds")


def validate_scores(node):
    for key in ("occurrence", "line", "cognitive", "cyclomatic"):
        if type(node.get(key)) is not int or node[key] < (1 if key in ("occurrence", "line") else 0):
            raise ValueError(f"Invalid baseline {key}")


def baseline_entries(baseline):
    if not isinstance(baseline, dict):
        raise ValueError("Baseline must be an object")
    for key, expected in BASELINE_METADATA.items():
        if type(baseline.get(key)) is not type(expected) or baseline[key] != expected:
            raise ValueError(f"Baseline {key} does not match the measurement configuration")
    if not isinstance(baseline.get("functions"), list):
        raise ValueError("Baseline functions must be an array")
    entries = {}
    for node in baseline["functions"]:
        validate_entry(node)
        key = identity(node)
        if key in entries:
            raise ValueError(f"Duplicate baseline function: {key}")
        entries[key] = node
    return {key: node for key, node in entries.items() if exceeds_threshold(node)}


def compare_baseline(report, baseline):
    previous = baseline_entries(baseline)
    current = {identity(node): node for node in baseline_for(report)["functions"]}
    regressions = []
    improved = 0
    for key, node in current.items():
        old = previous.get(key)
        if old is None:
            regressions.append(f"New exceedance: {node['path']}:{node['line']} {node['name']} #{node['occurrence']}")
        elif node["cognitive"] > old["cognitive"]:
            regressions.append(f"Increased complexity: {node['path']}:{node['line']} {node['name']} #{node['occurrence']} "
                               f"({old['cognitive']} -> {node['cognitive']})")
        elif node["cognitive"] < old["cognitive"]:
            improved += 1
    return {"regressions": regressions, "resolved": len(previous.keys() - current.keys()),
            "improved": improved, "remaining": len(current)}


def refreshed_baseline(report, baseline):
    comparison = compare_baseline(report, baseline)
    if comparison["regressions"]:
        raise ValueError("Cannot increase the baseline allowances: " + "; ".join(comparison["regressions"]))
    return baseline_for(report)


def comparison_summary(comparison):
    lines = ["", "## Baseline comparison", "",
             f"Remaining: {comparison['remaining']}. Resolved: {comparison['resolved']}. "
             f"Improved: {comparison['improved']}. Regressions: {len(comparison['regressions'])}."]
    lines.extend(f"- {message}" for message in comparison["regressions"])
    return "\n".join(lines) + "\n"


def measure(root):
    version = subprocess.run(["cccc", "--version"], stdout=subprocess.PIPE, text=True, check=True)
    if version.stdout.strip() != CCCC_VERSION:
        raise SystemExit(f"Install {CCCC_VERSION}; found {version.stdout.strip()}")
    result = subprocess.run(["cccc", "--config", str(root / "cccc.toml"), "."],
                            cwd=root, stdout=subprocess.PIPE, text=True, check=True)
    return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser(description="Measure complexity and reject new or increased cognitive baseline debt")
    parser.add_argument("--output-dir", type=Path, default=Path("complexity-results"))
    parser.add_argument("--update-baseline", action="store_true", help="Remove resolved entries and lower improved allowances")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    report = measure(root)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "report.json").write_text(json.dumps(report) + "\n")
    markdown = summarize(report)
    (args.output_dir / "summary.md").write_text(markdown)
    baseline_path = root / "complexity-baseline.json"
    baseline = json.loads(baseline_path.read_text())
    comparison = compare_baseline(report, baseline)
    markdown += comparison_summary(comparison)
    (args.output_dir / "summary.md").write_text(markdown)
    print(markdown, end="")
    if comparison["regressions"]:
        raise SystemExit(1)
    if args.update_baseline:
        baseline_path.write_text(json.dumps(refreshed_baseline(report, baseline), indent=2) + "\n")


if __name__ == "__main__":
    main()
