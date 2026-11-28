use std::{collections::HashMap, sync::OnceLock};

#[derive(serde::Deserialize)]
struct StudioTemplate {
    id: String,
    art: String,
}

const STUDIO_TEMPLATES: &str = include_str!("../../src/studio-templates.json");

/// Use the same authored SVG fragments that the desktop gallery displays.
pub fn studio_document(id: &str, width_mm: f64) -> Option<String> {
    static CATALOGUE: OnceLock<HashMap<String, String>> = OnceLock::new();
    let catalogue = CATALOGUE.get_or_init(|| {
        serde_json::from_str::<Vec<StudioTemplate>>(STUDIO_TEMPLATES)
            .expect("the bundled studio template catalog must be valid JSON")
            .into_iter()
            .map(|entry| (entry.id, entry.art))
            .collect()
    });
    let artwork = catalogue.get(id)?;
    Some(format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width_mm}mm" height="{width_mm}mm" viewBox="0 0 100 100">{artwork}</svg>"#,
    ))
}

/// A licensed built-in template uses the exact vendored SVG for stitch generation.
pub fn twemoji_document(id: &str, width_mm: f64) -> Option<String> {
    let artwork = match id {
        "twemoji-dragon" => include_str!("../../src/assets/twemoji/1f409.svg"),
        "twemoji-robot" => include_str!("../../src/assets/twemoji/1f916.svg"),
        "twemoji-ghost" => include_str!("../../src/assets/twemoji/1f47b.svg"),
        "twemoji-cat" => include_str!("../../src/assets/twemoji/1f431.svg"),
        "twemoji-fox" => include_str!("../../src/assets/twemoji/1f98a.svg"),
        "twemoji-rabbit" => include_str!("../../src/assets/twemoji/1f430.svg"),
        "twemoji-otter" => include_str!("../../src/assets/twemoji/1f9a6.svg"),
        "twemoji-unicorn" => include_str!("../../src/assets/twemoji/1f984.svg"),
        "twemoji-birthday-cake" => include_str!("../../src/assets/twemoji/1f382.svg"),
        "twemoji-jack-o-lantern" => include_str!("../../src/assets/twemoji/1f383.svg"),
        "twemoji-christmas-tree" => include_str!("../../src/assets/twemoji/1f384.svg"),
        "twemoji-bouquet" => include_str!("../../src/assets/twemoji/1f490.svg"),
        "twemoji-wrapped-gift" => include_str!("../../src/assets/twemoji/1f381.svg"),
        "twemoji-ribbon" => include_str!("../../src/assets/twemoji/1f380.svg"),
        "twemoji-butterfly" => include_str!("../../src/assets/twemoji/1f98b.svg"),
        _ => return None,
    };
    Some(format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width_mm}mm" height="{width_mm}mm" viewBox="0 0 100 100">{artwork}</svg>"#,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn studio_catalogue_opens_and_round_trips_as_machine_files() {
        use zigzag::{document::Document, formats::{dst::write_dst, pes::write_pes, read::read_stitch_file}};

        let entries = serde_json::from_str::<Vec<StudioTemplate>>(STUDIO_TEMPLATES).unwrap();
        let mut ids = std::collections::HashSet::new();
        assert!(!entries.is_empty());
        for entry in &entries {
            let id = entry.id.as_str();
            assert!(ids.insert(id), "duplicate template ID {id}");
            let boutique = matches!(id, "studio-heirloom-goose-crest" | "studio-heirloom-rocking-horse" | "studio-vintage-game-day-trio");
            let widths: &[f64] = if boutique { &[55.0, 80.0] } else { &[65.0] };
            for &width in widths {
                let svg = studio_document(id, width).unwrap();
                let document = Document::from_svg(&svg, id, None).unwrap();
                let design = document.plan();
                assert!(design.stitch_count() > 0, "{id} at {width} mm");
                if boutique {
                    assert!(document.shapes.iter().any(|shape| !shape.groups.is_empty()), "{id} should keep editable groups");
                }
                for (format, bytes) in [("dst", write_dst(&design)), ("pes", write_pes(&design))] {
                    let reopened = read_stitch_file(&bytes, format).unwrap();
                    assert!(reopened.blocks.iter().any(|block| !block.runs.is_empty()), "{id} {format}");
                }
            }
        }
        assert!(studio_document("unknown-template", 55.0).is_none());
    }
}
