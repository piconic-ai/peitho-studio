//! Preserve editable slot locations, including empty slots, in Studio's
//! rendered HTML. The files used by peitho itself remain untouched.
use lol_html::{element, html_content::ContentType, rewrite_str, RewriteStrSettings};
use peitho_core::{parse_layout, Layouts};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

fn canvas_object(slot: &str, style: &str) -> String {
    if slot.starts_with("studio-text-") {
        format!("<div class=\"studio-free-text\" data-studio-text=\"{slot}\" style=\"{style}\"><slot name=\"{slot}\" accepts=\"blocks\" arity=\"0..*\"></slot></div>")
    } else {
        format!("<figure class=\"studio-free-image\" data-studio-image=\"{slot}\" style=\"{style}\"><slot name=\"{slot}\" accepts=\"image\" arity=\"1\"></slot></figure>")
    }
}

const IMAGE_STYLES: &str = "<style data-studio-image-styles>.studio-free-image > div,.studio-free-image [class^=slot-] {width:100%;height:100%;} .studio-free-image img {width:100%;height:100%;object-fit:contain;}</style>";

/// Carry slide-owned image objects onto a new base template, for both the
/// picker fit check and the actual saved layout. Ordinary slots still fit
/// according to peitho-core's normal contracts.
pub fn with_canvas_images(base: &peitho_core::Layout, from: &peitho_core::Layout) -> Result<peitho_core::Layout, String> {
    let mut figures = String::new();
    rewrite_str(from.html(), RewriteStrSettings {
        element_content_handlers: vec![element!("[data-studio-image], [data-studio-text]", |el| {
            let slot = el.get_attribute("data-studio-image").or_else(|| el.get_attribute("data-studio-text")).unwrap_or_default();
            if (slot.starts_with("studio-image-") || slot.starts_with("studio-text-")) && from.slot(&slot).is_some() && base.slot(&slot).is_none() {
                let style = el.get_attribute("style").unwrap_or_default().replace('&', "&amp;").replace('"', "&quot;");
                figures.push_str(&canvas_object(&slot, &style));
            }
            Ok(())
        })],
        ..RewriteStrSettings::default()
    }).map_err(|err| err.to_string())?;
    if figures.is_empty() { return Ok(base.clone()) }
    let html = rewrite_str(base.html(), RewriteStrSettings {
        element_content_handlers: vec![element!("section", |el| {
            el.append(&format!("{IMAGE_STYLES}{figures}"), ContentType::Html);
            Ok(())
        })],
        ..RewriteStrSettings::default()
    }).map_err(|err| err.to_string())?;
    parse_layout(base.name(), &html).map_err(|err| err.to_string())
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImagePlacement {
    pub slot: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Serialize)]
pub struct ImageCanvas {
    pub layout: String,
    pub slots: Vec<String>,
}

fn placement_style(rect: &ImagePlacement) -> Result<String, String> {
    let values = [rect.x, rect.y, rect.width, rect.height];
    if values.iter().any(|value| !value.is_finite() || *value < 0.0 || *value > 1.0) || rect.width < 0.01 || rect.height < 0.01 || rect.x + rect.width > 1.001 || rect.y + rect.height > 1.001 {
        return Err("image position must fit inside the slide".into());
    }
    Ok(format!("position:absolute;left:{:.4}%;top:{:.4}%;width:{:.4}%;height:{:.4}%;margin:0;overflow:hidden;", rect.x * 100.0, rect.y * 100.0, rect.width * 100.0, rect.height * 100.0))
}

/// Immutable per-slide layout variants make image moves/resizes ordinary
/// layout config changes: Undo can restore the previous geometry without
/// rewriting a shared template. These files are also usable by peitho CLI.
#[cfg(test)]
fn image_canvas(deck_path: &std::path::Path, content: &str, base: &str, count: usize, placements: &[ImagePlacement]) -> Result<ImageCanvas, String> {
    image_canvas_change(deck_path, content, base, count, placements, &[])
}

pub fn image_canvas_change(deck_path: &std::path::Path, content: &str, base: &str, count: usize, placements: &[ImagePlacement], removed: &[String]) -> Result<ImageCanvas, String> {
    image_canvas_edit(deck_path, content, base, count, placements, removed, None, None, 0)
}

pub fn rebase_image_canvas(deck_path: &std::path::Path, content: &str, from: &str, base: &str) -> Result<ImageCanvas, String> {
    image_canvas_edit(deck_path, content, base, 0, &[], &[], Some(from), None, 0)
}

pub fn order_image_canvas(deck_path: &std::path::Path, content: &str, base: &str, order: &[String]) -> Result<ImageCanvas, String> {
    image_canvas_edit(deck_path, content, base, 0, &[], &[], None, Some(order), 0)
}

pub fn text_canvas(deck_path: &std::path::Path, content: &str, base: &str) -> Result<ImageCanvas, String> {
    image_canvas_edit(deck_path, content, base, 0, &[], &[], None, None, 1)
}

fn image_canvas_edit(deck_path: &std::path::Path, content: &str, base: &str, count: usize, placements: &[ImagePlacement], removed: &[String], from: Option<&str>, order: Option<&[String]>, text_count: usize) -> Result<ImageCanvas, String> {
    if count > 32 { return Err("add at most 32 images at a time".into()) }
    let assets = super::pipeline::parse_source(deck_path, content)?.assets;
    let layout = assets.layouts.get(base).ok_or_else(|| format!("layout '{base}' was not found"))?;
    let carried = from.map(|name| {
        let from = assets.layouts.get(name).ok_or_else(|| format!("layout '{name}' was not found"))?;
        with_canvas_images(layout, from)
    }).transpose()?;
    let layout = carried.as_ref().unwrap_or(layout);
    for rect in placements {
        if !(rect.slot.starts_with("studio-image-") || rect.slot.starts_with("studio-text-")) || layout.slot(&rect.slot).is_none() { return Err("this image is not freely positioned".into()) }
        placement_style(rect)?;
    }
    for slot in removed {
        if !(slot.starts_with("studio-image-") || slot.starts_with("studio-text-")) || layout.slot(slot).is_none() { return Err("this image is not freely positioned".into()) }
    }
    let mut ordered_figures = std::collections::HashMap::new();
    let mut image_count = 0;
    let mut front_layer = 0;
    let html = rewrite_str(layout.html(), RewriteStrSettings {
        element_content_handlers: vec![
            element!("section", |el| {
                let existing = el.get_attribute("style").unwrap_or_default();
                if !existing.contains("isolation:isolate") { el.set_attribute("style", &format!("{existing};position:relative;isolation:isolate;"))?; }
                Ok(())
            }),
            element!("[data-studio-image], [data-studio-text]", |el| {
                let slot = el.get_attribute("data-studio-image").or_else(|| el.get_attribute("data-studio-text")).unwrap_or_default();
                image_count += 1;
                let existing_style = el.get_attribute("style").unwrap_or_default();
                let layer = existing_style.split(';').find_map(|part| part.trim().strip_prefix("z-index:").and_then(|value| value.trim().parse::<isize>().ok())).unwrap_or(0);
                front_layer = front_layer.max(layer).max(image_count);
                if order.is_some() {
                    if !(slot.starts_with("studio-image-") || slot.starts_with("studio-text-")) || layout.slot(&slot).is_none() { return Err("invalid canvas image".into()) }
                    let style = el.get_attribute("style").unwrap_or_default().replace('&', "&amp;").replace('"', "&quot;");
                    ordered_figures.insert(slot.clone(), canvas_object(&slot, &style));
                    el.remove(); return Ok(())
                }
                if removed.contains(&slot) { el.remove(); return Ok(()) }
                if let Some(rect) = placements.iter().find(|rect| rect.slot == slot) {
                    let previous = el.get_attribute("style").unwrap_or_default();
                    let layer = previous.split(';').find(|part| part.trim().starts_with("z-index:")).unwrap_or("");
                    let style = if el.get_attribute("data-studio-text").is_some() {
                        format!("position:absolute;left:{}%;top:{}%;width:{}%;height:auto;margin:0;overflow:visible;", rect.x * 100., rect.y * 100., rect.width * 100.)
                    } else { placement_style(rect).expect("validated placement") };
                    el.set_attribute("style", &format!("{style}{layer};"))?;
                }
                Ok(())
            }),
        ],
        ..RewriteStrSettings::default()
    }).map_err(|err| err.to_string())?;
    let mut figures = String::new();
    if let Some(order) = order {
        let has_content = order.iter().filter(|slot| slot.as_str() == "studio-content").count();
        if has_content > 1 || order.len() != ordered_figures.len() + has_content { return Err("image order must include every canvas image exactly once".into()) }
        let content_index = order.iter().position(|slot| slot == "studio-content").map(|index| index as isize).unwrap_or(-1);
        for (index, slot) in order.iter().enumerate() {
            if slot == "studio-content" { continue }
            let figure = ordered_figures.remove(slot).ok_or("image order must include every canvas image exactly once")?;
            let figure = rewrite_str(&figure, RewriteStrSettings {
                element_content_handlers: vec![element!("[data-studio-image], [data-studio-text]", |el| {
                    let previous = el.get_attribute("style").unwrap_or_default();
                    let style = previous.split(';').filter(|part| !part.trim().starts_with("z-index:")).collect::<Vec<_>>().join(";");
                    el.set_attribute("style", &format!("{style};z-index:{};", index as isize - content_index))?;
                    Ok(())
                })], ..RewriteStrSettings::default()
            }).map_err(|err| err.to_string())?;
            figures.push_str(&figure);
        }
    }
    let mut slots = Vec::new();
    let mut next = 1;
    for i in 0..count {
        while layout.slot(&format!("studio-image-{next}")).is_some() { next += 1 }
        let slot = format!("studio-image-{next}"); next += 1;
        let rect = ImagePlacement { slot: slot.clone(), x: 0.15 + (i % 4) as f64 * 0.035, y: 0.25 + (i % 4) as f64 * 0.035, width: 0.55, height: 0.55 };
        figures.push_str(&format!("<figure class=\"studio-free-image\" data-studio-image=\"{slot}\" style=\"{}z-index:{};\"><slot name=\"{slot}\" accepts=\"image\" arity=\"1\"></slot></figure>", placement_style(&rect)?, front_layer + i as isize + 1));
        slots.push(slot);
    }
    if text_count > 0 {
        let mut next_text = 1;
        while layout.slot(&format!("studio-text-{next_text}")).is_some() { next_text += 1 }
        let slot = format!("studio-text-{next_text}");
        figures.push_str(&canvas_object(&slot, &format!("position:absolute;left:20%;top:30%;width:55%;margin:0;z-index:{};", front_layer + 1)));
        slots.push(slot);
    }
    let styles = if count > 0 && !html.contains("data-studio-image-styles") {
        IMAGE_STYLES
    } else { "" };
    let html = rewrite_str(&html, RewriteStrSettings {
        element_content_handlers: vec![element!("section", |el| { el.append(&format!("{styles}{figures}"), ContentType::Html); Ok(()) })],
        ..RewriteStrSettings::default()
    }).map_err(|err| err.to_string())?;
    let hash = Sha256::digest(html.as_bytes());
    let name = format!("studio-canvas-{:x}", &hash[..8].iter().fold(0u64, |n, byte| (n << 8) | u64::from(*byte)));
    let source = super::layout_files::LayoutSource { html, css: None };
    let existing = super::pipeline::deck_dir_of(deck_path).join(format!("layouts/{name}.html"));
    if existing.is_file() {
        if std::fs::read_to_string(existing).map_err(|err| err.to_string())? != source.html { return Err("image layout name is already in use".into()) }
    } else {
        super::layout_files::add_layout(deck_path, content, &name, &source, "placing an image on the slide")?;
    }
    Ok(ImageCanvas { layout: name, slots })
}

pub fn editable_layouts(layouts: &Layouts) -> Result<Layouts, String> {
    let mut edited = Vec::new();
    for layout in layouts.iter() {
        let html = rewrite_str(layout.html(), RewriteStrSettings {
            element_content_handlers: vec![element!("slot", |el| {
                let name = el.get_attribute("name").unwrap_or_default();
                let accepts = el.get_attribute("accepts").unwrap_or_default();
                // Slot contracts have already validated these values.
                let tag = if accepts == "inline" { "span" } else { "div" };
                el.before(&format!("<{tag} data-studio-slot=\"{name}\" data-studio-accepts=\"{accepts}\" style=\"display:contents\">"), ContentType::Html);
                el.after(&format!("</{tag}>"), ContentType::Html);
                Ok(())
            })],
            ..RewriteStrSettings::default()
        }).map_err(|err| err.to_string())?;
        edited.push(parse_layout(layout.name(), &html).map_err(|err| err.to_string())?);
    }
    Layouts::new(edited).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::builtin;

    #[test]
    fn slot_contracts_and_original_layouts_survive_edit_instrumentation() {
        for layout in builtin::STANDARD_LAYOUTS {
            let original = parse_layout(layout.name, layout.html).unwrap();
            let edited = editable_layouts(&Layouts::single(original.clone())).unwrap();
            assert_eq!(edited.get(layout.name).unwrap().slots(), original.slots());
            assert_eq!(original.html(), layout.html);
        }
    }

    fn deck() -> (tempfile::TempDir, std::path::PathBuf, String) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("layouts")).unwrap();
        std::fs::create_dir(dir.path().join("css")).unwrap();
        for layout in builtin::STANDARD_LAYOUTS {
            std::fs::write(dir.path().join(layout.html_path), layout.html).unwrap();
            std::fs::write(dir.path().join(layout.css_path), layout.css).unwrap();
        }
        std::fs::write(dir.path().join("css/base.css"), builtin::BASE_CSS).unwrap();
        std::fs::create_dir(dir.path().join("img")).unwrap();
        std::fs::write(dir.path().join("img/photo.png"), b"\x89PNG\r\n\x1a\nexample").unwrap();
        let path = dir.path().join("deck.md");
        let source = "<!-- {\"key\":\"slide\",\"layout\":\"two-column\"} -->\n# Title\n".to_string();
        (dir, path, source)
    }

    #[test]
    fn two_column_empty_slots_remain_clickable_and_explicit_column_text_builds() {
        let (_dir, path, source) = deck();
        let output = super::super::pipeline::render_source(&path, &source).unwrap();
        assert!(output.fragments["slide"].contains("data-studio-slot=\"left\""));
        let source = format!("{source}\n::: {{slot=left}}\n\n左の文章\n\n:::\n\n::: {{slot=right}}\n\n- 項目\n\n:::\n");
        let output = super::super::pipeline::render_source(&path, &source).unwrap();
        assert!(output.fragments["slide"].contains("左の文章"));
        assert!(output.fragments["slide"].contains("項目"));
    }

    #[test]
    fn pasted_text_objects_accept_formatted_paragraphs_and_headings_without_body_capacity_errors() {
        let (_dir, path, source) = deck();
        for content in ["Keep **formatting**", "# Title"] {
            let mut canvas = text_canvas(&path, &source, "title-slide").unwrap();
            let placed = image_canvas_change(&path, &source, &canvas.layout, 0, &[ImagePlacement { slot: canvas.slots[0].clone(), x: 0.2, y: 0.3, width: 0.55, height: 0.04 }], &[]).unwrap();
            let html = std::fs::read_to_string(path.parent().unwrap().join(format!("layouts/{}.html", placed.layout))).unwrap();
            assert!(html.contains("height:auto;margin:0;overflow:visible;"));
            assert!(!html.contains("overflow:hidden"));
            canvas.layout = placed.layout;
            let source = source.replace("\"two-column\"", &format!("\"{}\"", canvas.layout));
            let source = format!("{source}\n::: {{slot={}}}\n\n{content}\n\n:::\n", canvas.slots[0]);
            let output = super::super::pipeline::render_source(&path, &source).unwrap();
            assert!(output.fragments["slide"].contains("data-studio-text=\"studio-text-1\""));
            let verdicts = super::super::layout_fit::check_slide_layouts(&path, &source, 0).unwrap().unwrap();
            assert_eq!(verdicts.iter().find(|verdict| verdict.layout == "two-column").unwrap().fit, super::super::layout_fit::LayoutFit::Fits);
            let rebased = rebase_image_canvas(&path, &source, &canvas.layout, "two-column").unwrap();
            let source = source.replace(&canvas.layout, &rebased.layout);
            assert!(super::super::pipeline::render_source(&path, &source).is_ok());
        }
    }

    #[test]
    fn removed_text_content_does_not_leave_rendered_text_behind() {
        let (_dir, fixture_path, fixture_source) = deck();
        let path = if let Ok(path) = std::env::var("PEITHO_REPRO_DECK") { std::path::PathBuf::from(path) } else {
            let canvas = text_canvas(&fixture_path, &fixture_source, "title-slide").unwrap();
            let source = fixture_source.replace("\"slide\"", "\"cover\"").replace("\"two-column\"", &format!("\"{}\"", canvas.layout));
            std::fs::write(&fixture_path, format!("{source}\n::: {{slot=studio-text-1}}\n\nあああああ\n\n:::\n")).unwrap();
            fixture_path
        };
        let source = std::fs::read_to_string(&path).unwrap();
        let original = super::super::pipeline::render_source(&path, &source).unwrap();
        assert!(original.fragments["cover"].contains("あああああ"));
        let from = source.find("::: {slot=studio-text-1}").unwrap();
        let end = from + source[from..].find("\n:::").unwrap() + 4;
        let removed = format!("{}{}", &source[..from], &source[end..]);
        let output = super::super::pipeline::render_source(&path, &removed).unwrap();
        assert!(!output.fragments["cover"].contains("あああああ"));
        let empty = source.replace("あああああ", "\u{00a0}");
        assert!(super::super::pipeline::render_source(&path, &empty).is_ok());
    }

    #[test]
    fn image_order_is_exported_and_survives_moves_and_template_changes() {
        let (dir, path, source) = deck();
        let canvas = image_canvas(&path, &source, "two-column", 3, &[]).unwrap();
        let source = source.replace("\"two-column\"", &format!("\"{}\"", canvas.layout));
        let source = format!("{source}{}", canvas.slots.iter().map(|slot| format!("\n::: {{slot={slot}}}\n\n![](img/photo.png)\n\n:::\n")).collect::<String>());
        let order = vec!["studio-image-3".to_string(), "studio-image-1".to_string(), "studio-image-2".to_string()];
        let ordered = order_image_canvas(&path, &source, &canvas.layout, &order).unwrap();
        let changed = source.replace(&canvas.layout, &ordered.layout);
        let output = super::super::pipeline::render_source(&path, &changed).unwrap();
        let assert_order = |html: &str| {
            let positions: Vec<_> = order.iter().map(|slot| html.find(&format!("data-studio-image=\"{slot}\"")).unwrap()).collect();
            assert!(positions.windows(2).all(|pair| pair[0] < pair[1]), "{html}");
        };
        assert_order(&output.fragments["slide"]);
        let rect = ImagePlacement { slot: "studio-image-3".into(), x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
        let moved = image_canvas(&path, &changed, &ordered.layout, 0, &[rect]).unwrap();
        assert_order(&std::fs::read_to_string(dir.path().join(format!("layouts/{}.html", moved.layout))).unwrap());
        let rebased = rebase_image_canvas(&path, &changed, &ordered.layout, "title-only").unwrap();
        assert_order(&std::fs::read_to_string(dir.path().join(format!("layouts/{}.html", rebased.layout))).unwrap());
        let behind = order_image_canvas(&path, &changed, &ordered.layout, &["studio-image-3".into(), "studio-content".into(), "studio-image-1".into(), "studio-image-2".into()]).unwrap();
        let html = std::fs::read_to_string(dir.path().join(format!("layouts/{}.html", behind.layout))).unwrap();
        assert!(html.contains("isolation:isolate"));
        assert!(html.contains("z-index:-1;"));
        let rect = ImagePlacement { slot: "studio-image-3".into(), x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
        let moved = image_canvas(&path, &changed, &behind.layout, 0, &[rect]).unwrap();
        assert!(std::fs::read_to_string(dir.path().join(format!("layouts/{}.html", moved.layout))).unwrap().contains("z-index:-1;"));
        assert!(order_image_canvas(&path, &changed, &ordered.layout, &order[..2]).is_err());
        assert!(order_image_canvas(&path, &changed, &ordered.layout, &[order[0].clone(), order[0].clone(), order[2].clone()]).is_err());
        assert!(super::super::pipeline::render_source(&path, &source).is_ok());
    }

    #[test]
    fn free_images_keep_columns_and_exportable_geometry_without_changing_the_original_layout() {
        let (dir, path, source) = deck();
        let canvas = image_canvas(&path, &source, "two-column", 2, &[]).unwrap();
        assert_eq!(canvas.slots, ["studio-image-1", "studio-image-2"]);
        let source = source.replace("\"two-column\"", &format!("\"{}\"", canvas.layout));
        let source = format!("{source}\n::: {{slot=left}}\n\nKeep this text\n\n:::\n\n::: {{slot=studio-image-1}}\n\n![](img/photo.png)\n\n:::\n\n::: {{slot=studio-image-2}}\n\n![](img/photo.png)\n\n:::\n");
        let output = super::super::pipeline::render_source(&path, &source).unwrap();
        assert!(output.fragments["slide"].contains("Keep this text"));
        assert!(output.fragments["slide"].contains("data-studio-image=\"studio-image-1\""));
        let rect = ImagePlacement { slot: "studio-image-1".into(), x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
        let moved = image_canvas(&path, &source, &canvas.layout, 0, &[rect]).unwrap();
        let html = std::fs::read_to_string(dir.path().join(format!("layouts/{}.html", moved.layout))).unwrap();
        assert!(html.contains("left:10.0000%;top:20.0000%;width:30.0000%;height:40.0000%"));
        let exported = parse_layout(&moved.layout, &html).unwrap();
        assert!(exported.slot("left").is_some());
        assert!(exported.slot("studio-image-2").is_some());
        assert_eq!(std::fs::read_to_string(dir.path().join("layouts/two-column.html")).unwrap(), builtin::STANDARD_LAYOUTS.iter().find(|layout| layout.name == "two-column").unwrap().html);
        // The previous layout file remains, so config Undo restores it.
        assert!(super::super::pipeline::render_source(&path, &source).is_ok());
        let removed = image_canvas_change(&path, &source, &canvas.layout, 0, &[], &["studio-image-1".into()]).unwrap();
        let html = std::fs::read_to_string(dir.path().join(format!("layouts/{}.html", removed.layout))).unwrap();
        assert!(parse_layout(&removed.layout, &html).unwrap().slot("studio-image-1").is_none());
        assert!(parse_layout(&removed.layout, &html).unwrap().slot("studio-image-2").is_some());
    }

    #[test]
    fn invalid_geometry_is_rejected_before_writing_a_variant() {
        assert!(placement_style(&ImagePlacement { slot: "studio-image-1".into(), x: f64::NAN, y: 0.0, width: 0.5, height: 0.5 }).is_err());
        assert!(placement_style(&ImagePlacement { slot: "studio-image-1".into(), x: 0.8, y: 0.0, width: 0.5, height: 0.5 }).is_err());
    }

    #[test]
    fn changing_base_layout_carries_images_and_the_picker_judges_only_ordinary_content() {
        let (_dir, path, source) = deck();
        let canvas = image_canvas(&path, &source, "two-column", 1, &[]).unwrap();
        let source = source.replace("\"two-column\"", &format!("\"{}\"", canvas.layout));
        let source = format!("{source}\n::: {{slot=studio-image-1}}\n\n![](img/photo.png)\n\n:::\n");
        let verdicts = super::super::layout_fit::check_slide_layouts(&path, &source, 0).unwrap().unwrap();
        assert_eq!(verdicts.iter().find(|verdict| verdict.layout == "title-body").unwrap().fit, super::super::layout_fit::LayoutFit::Fits);
        let rebased = rebase_image_canvas(&path, &source, &canvas.layout, "title-body").unwrap();
        let source = source.replace(&canvas.layout, &rebased.layout);
        let output = super::super::pipeline::render_source(&path, &source).unwrap();
        assert!(output.fragments["slide"].contains("layout-title-body"));
        assert!(output.fragments["slide"].contains("data-studio-image=\"studio-image-1\""));
        // A real incompatibility, such as left-column prose on title-only,
        // must still disable that choice even with freely placed images.
        let source = format!("{source}\n::: {{slot=body}}\n\nSome text\n\n:::\n");
        let verdicts = super::super::layout_fit::check_slide_layouts(&path, &source, 0).unwrap().unwrap();
        assert!(matches!(verdicts.iter().find(|verdict| verdict.layout == "title-only").unwrap().fit, super::super::layout_fit::LayoutFit::Mismatch { .. }));
    }
}
