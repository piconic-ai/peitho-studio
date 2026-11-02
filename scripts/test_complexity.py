import unittest

from complexity import summarize


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


if __name__ == "__main__":
    unittest.main()
