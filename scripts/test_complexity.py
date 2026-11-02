import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from complexity import baseline_for, compare_baseline, refreshed_baseline, summarize


def report(nodes, **summary):
    return {"files": [{"path": "example.ts", "functions": nodes}],
            "summary": {"file_count": 1, "function_count": len(nodes),
                        "parse_error_count": 0, **summary}}


def function(name, cognitive, cyclomatic, **extra):
    return {"name": name, "line": 1, "cognitive": cognitive, "cyclomatic": cyclomatic, **extra}


class ComplexityTests(unittest.TestCase):
    def test_spec_counts_each_nested_function_once_and_unions_thresholds(self):
        nested = function("child", 16, 11)
        data = report([function("parent", 0, 11, children=[nested]), function("other", 16, 1)],
                      function_count=3)
        text = summarize(data)
        self.assertIn("Cognitive > 15: 2 functions.", text)
        self.assertIn("Cyclomatic > 10: 2 functions.", text)
        self.assertIn("Either threshold: 3 functions in 1 files.", text)
        self.assertIn("`parent / child`", text)

    def test_adversarial_values_at_threshold_are_not_exceedances(self):
        text = summarize(report([function("boundary", 15, 10)]))
        self.assertIn("Either threshold: 0 functions", text)
        self.assertNotIn("`boundary`", text)

    def test_adversarial_partial_or_empty_measurements_fail(self):
        for data in [report([], file_count=0), report([], parse_error_count=1),
                     report([], function_count=1)]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                summarize(data)

    def test_adversarial_missing_summary_is_not_success(self):
        with self.assertRaises(KeyError):
            summarize({"files": []})


class BaselineTests(unittest.TestCase):
    def setUp(self):
        self.original = report([function("existing", 20, 12)])
        self.baseline = baseline_for(self.original)

    def test_line_movement_and_path_prefix_do_not_change_identity(self):
        moved = report([function("existing", 20, 12, line=200)])
        moved["files"][0]["path"] = "./example.ts"
        self.assertEqual(compare_baseline(moved, self.baseline)["regressions"], [])

    def test_existing_debt_is_allowed_and_new_exceedance_is_rejected(self):
        self.assertEqual(compare_baseline(self.original, self.baseline)["regressions"], [])
        added = report([function("existing", 20, 12), function("new", 16, 1)])
        self.assertIn("New exceedance", compare_baseline(added, self.baseline)["regressions"][0])
        with self.assertRaisesRegex(ValueError, "Cannot increase"):
            refreshed_baseline(added, self.baseline)

    def test_either_metric_cannot_increase_even_if_the_other_improves(self):
        for cognitive, cyclomatic in [(21, 11), (19, 13)]:
            data = report([function("existing", cognitive, cyclomatic)])
            with self.subTest(cognitive=cognitive):
                self.assertIn("Increased complexity", compare_baseline(data, self.baseline)["regressions"][0])
                with self.assertRaisesRegex(ValueError, "Cannot increase"):
                    refreshed_baseline(data, self.baseline)

    def test_refresh_lowers_allowances_and_removes_resolved_functions(self):
        improved = report([function("existing", 17, 11)])
        comparison = compare_baseline(improved, self.baseline)
        self.assertEqual((comparison["improved"], comparison["resolved"]), (1, 0))
        updated = refreshed_baseline(improved, self.baseline)
        self.assertEqual(updated["functions"][0]["cognitive"], 17)
        self.assertTrue(compare_baseline(self.original, updated)["regressions"])
        resolved = report([function("existing", 15, 10)])
        self.assertEqual(compare_baseline(resolved, self.baseline)["resolved"], 1)
        self.assertEqual(refreshed_baseline(resolved, self.baseline)["functions"], [])
        self.assertEqual(self.baseline["functions"][0]["cognitive"], 20)

    def test_identical_qualified_names_have_distinct_occurrences(self):
        data = report([function("<anonymous>", 0, 1), function("<anonymous>", 16, 11),
                       function("<anonymous>", 17, 12)])
        baseline = baseline_for(data)
        self.assertEqual([node["occurrence"] for node in baseline["functions"]], [2, 3])
        data["files"][0]["functions"][2]["cyclomatic"] = 13
        regressions = compare_baseline(data, baseline)["regressions"]
        self.assertEqual(len(regressions), 1)
        self.assertIn("#3", regressions[0])

    def test_baseline_metadata_is_not_aliased_to_other_snapshots(self):
        altered = baseline_for(self.original)
        altered["thresholds"]["cognitive"] = 100
        self.assertEqual(baseline_for(self.original)["thresholds"]["cognitive"], 15)
        with self.assertRaisesRegex(ValueError, "thresholds"):
            compare_baseline(self.original, altered)

    def test_malformed_duplicate_or_mismatched_baselines_fail(self):
        invalid = [None, {}, dict(self.baseline, schema_version=2), dict(self.baseline, schema_version=True),
                   dict(self.baseline, cccc_version="cccc 0.0.0"),
                   dict(self.baseline, thresholds={"cognitive": 100, "cyclomatic": 100}),
                   dict(self.baseline, functions={}),
                   dict(self.baseline, functions=self.baseline["functions"] * 2)]
        for field, value in [("path", "./example.ts"), ("path", "../example.ts"), ("name", ""), ("line", 0),
                             ("occurrence", True), ("cognitive", "20")]:
            bad = copy.deepcopy(self.baseline)
            bad["functions"][0][field] = value
            invalid.append(bad)
        for baseline in invalid:
            with self.subTest(baseline=baseline), self.assertRaises(ValueError):
                compare_baseline(self.original, baseline)


class CommandTests(unittest.TestCase):
    def test_regression_writes_reports_but_cannot_refresh_baseline(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "scripts").mkdir()
            (root / "scripts/complexity.py").write_bytes(Path(__file__).with_name("complexity.py").read_bytes())
            (root / "cccc.toml").write_text("")
            original = report([function("existing", 20, 12)])
            baseline_path = root / "complexity-baseline.json"
            baseline_path.write_text(json.dumps(baseline_for(original)))
            before = baseline_path.read_bytes()
            changed = report([function("existing", 21, 12)])
            executable = root / "cccc"
            executable.write_text("#!/usr/bin/env python3\nimport json,sys\n"
                                  "print('cccc 1.8.5') if '--version' in sys.argv else "
                                  + "print(" + repr(json.dumps(changed)) + ")\n")
            executable.chmod(0o755)
            result = subprocess.run(["python3", "scripts/complexity.py", "--update-baseline"],
                                    cwd=root, env={**os.environ, "PATH": str(root) + os.pathsep + os.environ["PATH"]},
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertIn("Increased complexity", (root / "complexity-results/summary.md").read_text())
            self.assertEqual(json.loads((root / "complexity-results/report.json").read_text()), changed)
            self.assertEqual(baseline_path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
