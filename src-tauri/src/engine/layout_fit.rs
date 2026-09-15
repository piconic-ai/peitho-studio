//! Whether one slide's content fits each layout available to its deck,
//! decided without rendering anything — for the "Change Layout" picker, so
//! a layout the slide can't be pinned to shows as such before it's chosen.
//!
//! peitho-core has no dedicated "does this slide fit that layout" entry
//! point, but `explain_dispatch` already answers it per candidate: on its
//! structural-match path (a slide with no explicit layout, two or more
//! layouts) it maps the slide onto every layout *and* runs the same slot
//! check `check_deck` would, recording each candidate as matched or
//! rejected with peitho-core's own reason. That is exactly what pinning the
//! slide to that layout and building would decide, so this probes with the
//! slide's own pin removed. The other two paths don't run the check
//! (an explicit pin and a single layout only map, leaving the check to
//! `check_deck`), which is why a single-layout deck gets a throwaway twin
//! of its one layout to force the structural path.

use std::path::Path;

use peitho_core::phase::ParsedSlide;
use peitho_core::{explain_dispatch, parse_layout, CandidateOutcome, DispatchTrace, Layouts};
use serde::Serialize;

use super::pipeline;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum LayoutFit {
    Fits,
    /// `reason` is peitho-core's own build-error message for the mismatch,
    /// e.g. "unassigned content remains for missing 'body' slot".
    Mismatch { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LayoutVerdict {
    pub layout: String,
    pub fit: LayoutFit,
}

/// Suffix for the single-layout twin `probe_layouts` adds. Contains a
/// character a layout file stem can't carry, so it can never collide with
/// a real layout name.
const PROBE_TWIN_SUFFIX: &str = "/peitho-studio-probe";

/// A verdict for every layout available to `deck_path`'s deck, in the
/// deck's own layout order, for the slide at `slide_index` — its position
/// among every slide in `source`, drafts included (the same position
/// `domain/slides.ts`'s `splitSlides` gives it). `Ok(None)` when there is no
/// such slide to judge: the index is out of range, or the slide is a draft,
/// which peitho-core drops before dispatch ever sees it.
pub fn check_slide_layouts(deck_path: &Path, source: &str, slide_index: usize) -> Result<Option<Vec<LayoutVerdict>>, String> {
    let parsed = pipeline::parse_source(deck_path, source)?;
    let Some(slide) = parsed.deck.parsed_slides().iter().find(|slide| slide.source_index == slide_index) else {
        return Ok(None);
    };
    verdicts_for(slide, &parsed.assets.layouts).map(Some)
}

fn verdicts_for(slide: &ParsedSlide, layouts: &Layouts) -> Result<Vec<LayoutVerdict>, String> {
    let probe = probe_layouts(layouts)?;
    let DispatchTrace::StructuralMatch { candidates, .. } = explain_dispatch(&unpinned(slide), &probe) else {
        return Err("peitho-core didn't probe the slide against each layout".to_string());
    };
    layouts
        .names()
        .into_iter()
        .map(|name| {
            let candidate = candidates
                .iter()
                .find(|candidate| candidate.layout == name)
                .ok_or_else(|| format!("peitho-core returned no verdict for layout '{name}'"))?;
            Ok(LayoutVerdict { layout: name.to_string(), fit: fit_of(&candidate.outcome) })
        })
        .collect()
}

/// `slide` with its own `{"layout": ...}` pin removed, so dispatch probes
/// every layout instead of only mapping onto the pinned one.
fn unpinned(slide: &ParsedSlide) -> ParsedSlide {
    ParsedSlide { layout_request: None, ..slide.clone() }
}

/// `layouts` itself when it already has two or more, otherwise its one
/// layout plus a renamed twin of it (see the module doc for why).
fn probe_layouts(layouts: &Layouts) -> Result<Layouts, String> {
    if layouts.len() >= 2 {
        return Ok(layouts.clone());
    }
    let only = layouts.iter().next().ok_or_else(|| "the deck has no layouts".to_string())?;
    let twin = parse_layout(format!("{}{PROBE_TWIN_SUFFIX}", only.name()), only.html()).map_err(|err| err.to_string())?;
    Layouts::new(vec![only.clone(), twin]).map_err(|err| err.to_string())
}

fn fit_of(outcome: &CandidateOutcome) -> LayoutFit {
    match outcome {
        CandidateOutcome::Matched => LayoutFit::Fits,
        CandidateOutcome::Rejected { reason } => LayoutFit::Mismatch { reason: reason.clone() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{builtin, fixtures, pipeline::render_source};

    fn fits(layout: &str) -> LayoutVerdict {
        LayoutVerdict { layout: layout.to_string(), fit: LayoutFit::Fits }
    }

    fn mismatch_reason<'a>(verdicts: &'a [LayoutVerdict], layout: &str) -> Option<&'a str> {
        match &verdicts.iter().find(|verdict| verdict.layout == layout)?.fit {
            LayoutFit::Fits => None,
            LayoutFit::Mismatch { reason } => Some(reason),
        }
    }

    fn write_deck(dir: &Path, layouts: &[(&str, &str)], source: &str) -> std::path::PathBuf {
        if !layouts.is_empty() {
            let layouts_dir = dir.join("layouts");
            std::fs::create_dir_all(&layouts_dir).unwrap();
            for (name, html) in layouts {
                std::fs::write(layouts_dir.join(format!("{name}.html")), html).unwrap();
            }
        }
        let deck_path = dir.join("deck.md");
        std::fs::write(&deck_path, source).unwrap();
        deck_path
    }

    const COVER: &str = "<section><h1><slot name=\"title\" accepts=\"inline\" arity=\"1\"></slot></h1></section>";
    const STATEMENT: &str = "<section><h1><slot name=\"title\" accepts=\"inline\" arity=\"1\"></slot></h1><div><slot name=\"body\" accepts=\"blocks\" arity=\"1..*\"></slot></div></section>";

    #[test]
    fn check_slide_layouts_spec_a_title_and_body_slide_fits_statement_but_not_cover() {
        let deck_path = fixtures::example_deck("keynote");
        let source = std::fs::read_to_string(&deck_path).unwrap();

        // Slide 2 ('what') is a heading plus a paragraph.
        let verdicts = check_slide_layouts(&deck_path, &source, 1).unwrap().expect("slide 2 exists");

        assert_eq!(verdicts.iter().map(|v| v.layout.as_str()).collect::<Vec<_>>(), vec!["cover", "statement"]);
        assert_eq!(verdicts[1], fits("statement"));
        let reason = mismatch_reason(&verdicts, "cover").expect("a body can't go on a title-only layout");
        assert!(reason.contains("'body'"), "unexpected reason: {reason}");
    }

    #[test]
    fn check_slide_layouts_spec_a_title_only_slide_fits_cover_but_not_statement() {
        let deck_path = fixtures::example_deck("keynote");
        let source = std::fs::read_to_string(&deck_path).unwrap();

        let verdicts = check_slide_layouts(&deck_path, &source, 0).unwrap().expect("slide 1 exists");

        assert_eq!(verdicts[0], fits("cover"));
        // An arity failure — only the check step catches it, not mapping.
        let reason = mismatch_reason(&verdicts, "statement").expect("statement needs at least one body block");
        assert!(reason.contains("got 0 item(s)"), "unexpected reason: {reason}");
    }

    #[test]
    fn check_slide_layouts_spec_ignores_the_slides_own_pin() {
        // layout-pin's two layouts accept the same shape, and every slide
        // pins one — a slide pinned to `spotlight` still fits `statement`.
        let deck_path = fixtures::example_deck("layout-pin");
        let source = std::fs::read_to_string(&deck_path).unwrap();

        let verdicts = check_slide_layouts(&deck_path, &source, 0).unwrap().expect("slide 1 exists");

        assert_eq!(verdicts, vec![fits("spotlight"), fits("statement")]);
    }

    #[test]
    fn check_slide_layouts_spec_a_single_layout_deck_still_runs_the_slot_check() {
        // Without the twin in `probe_layouts`, peitho-core's single-layout
        // path would only map the slide and report this arity violation
        // (a second code block on a `0..1` code slot) as a fit.
        let dir = tempfile::tempdir().unwrap();
        let source = "# Two snippets\n\n```sh\necho one\n```\n\n```sh\necho two\n```\n";
        let deck_path = write_deck(dir.path(), &[], source);
        assert!(render_source(&deck_path, source).is_err(), "fixture should violate the built-in layout");

        let verdicts = check_slide_layouts(&deck_path, source, 0).unwrap().expect("slide 1 exists");

        assert_eq!(verdicts.len(), 1, "the probe twin must not leak into the result");
        assert_eq!(verdicts[0].layout, "title-body-code");
        let reason = mismatch_reason(&verdicts, "title-body-code").expect("two code blocks exceed the code slot");
        assert!(reason.contains("'code'"), "unexpected reason: {reason}");
    }

    #[test]
    fn check_slide_layouts_spec_a_single_layout_deck_reports_a_fit() {
        let deck_path = fixtures::example_deck("minimal");
        let source = std::fs::read_to_string(&deck_path).unwrap();

        let verdicts = check_slide_layouts(&deck_path, &source, 0).unwrap().expect("slide 1 exists");

        assert_eq!(verdicts, vec![fits("title-body-code")]);
    }

    #[test]
    fn check_slide_layouts_spec_judges_one_slide_even_when_another_slide_is_broken() {
        // Slide 2 fits neither layout (the whole deck fails to build), but
        // slide 1's own verdicts don't depend on it.
        let dir = tempfile::tempdir().unwrap();
        let source = "<!-- {\"key\":\"a\",\"layout\":\"cover\"} -->\n# Title only\n\n---\n\n<!-- {\"key\":\"b\",\"layout\":\"cover\"} -->\n# With body\n\nA paragraph.\n";
        let deck_path = write_deck(dir.path(), &[("cover", COVER), ("statement", STATEMENT)], source);
        assert!(render_source(&deck_path, source).is_err());

        let verdicts = check_slide_layouts(&deck_path, source, 0).unwrap().expect("slide 1 exists");

        assert_eq!(verdicts[0], fits("cover"));
        assert!(mismatch_reason(&verdicts, "statement").is_some());
    }

    /// Pins slide `slide_index` (counting every `<!-- {...} -->` page
    /// settings comment at a line start) to `layout`, the way the app's own
    /// `updatePageComment` does.
    fn pin_layout(source: &str, slide_index: usize, layout: &str) -> String {
        let mut seen = 0;
        let mut out = Vec::new();
        for line in source.split('\n') {
            if let Some(json) = line.strip_prefix("<!-- ").and_then(|rest| rest.strip_suffix(" -->")).filter(|json| json.starts_with('{')) {
                if seen == slide_index {
                    let mut config: serde_json::Map<String, serde_json::Value> = serde_json::from_str(json).unwrap();
                    config.insert("layout".to_string(), serde_json::Value::String(layout.to_string()));
                    out.push(format!("<!-- {} -->", serde_json::Value::Object(config)));
                    seen += 1;
                    continue;
                }
                seen += 1;
            }
            out.push(line.to_string());
        }
        out.join("\n")
    }

    #[test]
    fn check_slide_layouts_spec_every_verdict_agrees_with_actually_building_the_pinned_deck() {
        // The ground truth this module stands in for: pin the slide to the
        // layout and run the real pipeline. Guards against peitho-core's
        // dispatch/check drifting apart from what `explain_dispatch` reports.
        for deck in ["keynote", "layout-pin"] {
            let deck_path = fixtures::example_deck(deck);
            let source = std::fs::read_to_string(&deck_path).unwrap();
            let slide_count = source.matches("\n<!-- {").count() + usize::from(source.starts_with("<!-- {"));
            for slide_index in 0..slide_count {
                let verdicts = check_slide_layouts(&deck_path, &source, slide_index).unwrap().expect("slide exists");
                for verdict in verdicts {
                    let pinned = pin_layout(&source, slide_index, &verdict.layout);
                    let built = render_source(&deck_path, &pinned);
                    assert_eq!(
                        verdict.fit == LayoutFit::Fits,
                        built.is_ok(),
                        "{deck} slide {slide_index} -> {}: verdict {:?}, build {:?}",
                        verdict.layout,
                        verdict.fit,
                        built.err()
                    );
                }
            }
        }
    }

    #[test]
    fn check_slide_layouts_adversarial_an_out_of_range_index_has_no_verdicts() {
        let deck_path = fixtures::example_deck("keynote");
        let source = std::fs::read_to_string(&deck_path).unwrap();

        assert_eq!(check_slide_layouts(&deck_path, &source, 6).unwrap(), None);
        assert_eq!(check_slide_layouts(&deck_path, &source, usize::MAX).unwrap(), None);
    }

    #[test]
    fn check_slide_layouts_adversarial_a_draft_slide_has_no_verdicts() {
        // Drafts never reach dispatch, but they still count toward every
        // later slide's position.
        let dir = tempfile::tempdir().unwrap();
        let source = "<!-- {\"key\":\"a\",\"draft\":true} -->\n# Draft\n\nBody.\n\n---\n\n<!-- {\"key\":\"b\"} -->\n# Kept\n\nBody.\n";
        let deck_path = write_deck(dir.path(), &[("cover", COVER), ("statement", STATEMENT)], source);

        assert_eq!(check_slide_layouts(&deck_path, source, 0).unwrap(), None);
        let kept = check_slide_layouts(&deck_path, source, 1).unwrap().expect("slide 2 is not a draft");
        assert_eq!(kept[1], fits("statement"));
    }

    #[test]
    fn check_slide_layouts_adversarial_an_unparsable_deck_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let deck_path = dir.path().join("deck.md");

        // `section` without `time` is rejected while parsing, before any
        // slide could be judged.
        assert!(check_slide_layouts(&deck_path, "<!-- {\"section\":\"Intro\"} -->\n# One\n", 0).is_err());
        assert!(check_slide_layouts(&deck_path, "---\nunknown_field: 1\n---\n# One\n", 0).is_err());
    }

    #[test]
    fn check_slide_layouts_adversarial_an_empty_source_is_an_error_not_a_panic() {
        let dir = tempfile::tempdir().unwrap();
        let deck_path = dir.path().join("deck.md");

        assert!(check_slide_layouts(&deck_path, "", 0).is_err());
        assert!(check_slide_layouts(&deck_path, "\n\n---\n\n", 0).is_err());
    }

    #[test]
    fn probe_layouts_adversarial_the_twin_never_collides_with_the_real_name() {
        let only = parse_layout("title-body-code", builtin::LAYOUT_HTML).unwrap();
        let probe = probe_layouts(&Layouts::single(only)).unwrap();

        assert_eq!(probe.names(), vec!["title-body-code", "title-body-code/peitho-studio-probe"]);
    }

    #[test]
    fn serializes_as_the_frontends_tagged_union() {
        let json = serde_json::to_value(vec![
            fits("cover"),
            LayoutVerdict { layout: "statement".to_string(), fit: LayoutFit::Mismatch { reason: "why".to_string() } },
        ])
        .unwrap();

        assert_eq!(
            json,
            serde_json::json!([
                { "layout": "cover", "fit": { "kind": "fits" } },
                { "layout": "statement", "fit": { "kind": "mismatch", "reason": "why" } },
            ])
        );
    }
}
