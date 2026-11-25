#[path = "../desktop-ui/src-tauri/src/template_assets.rs"]
mod template_assets;

use std::collections::BTreeSet;
use zigzag::{document::Document, formats};

#[test]
fn licensed_catalogue_uses_original_artwork_and_exports_machine_stitches() {
    let entries: Vec<serde_json::Value> = serde_json::from_str(include_str!(
        "../desktop-ui/src/twemoji-templates.json"
    ))
    .unwrap();
    assert!(!entries.is_empty());
    let mut ids = BTreeSet::new();

    for entry in entries {
        let id = entry["id"].as_str().unwrap();
        let asset = entry["asset"].as_str().unwrap();
        assert!(ids.insert(id.to_owned()), "duplicate template ID {id}");
        assert_eq!(entry["license"], "CC BY 4.0", "{id}");
        let source = entry["sourceUrl"].as_str().unwrap();
        assert!(source.ends_with(&format!("/assets/svg/{asset}.svg")), "{id}");
        let original_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("desktop-ui/src/assets/twemoji")
            .join(format!("{asset}.svg"));
        let original = std::fs::read_to_string(original_path).unwrap();

        for width in [50.8, 76.2] {
            let svg = template_assets::twemoji_document(id, width)
                .unwrap_or_else(|| panic!("{id} missing from stitch-engine catalogue"));
            assert!(svg.contains(&original), "{id}: artwork changed before planning");
            let document = Document::from_svg(&svg, id, None).unwrap();
            let design = document.plan();
            let bounds = design.bounds();
            assert!(
                bounds.width() > width * 4.0
                    && bounds.height() > width * 4.0
                    && bounds.width() < width * 10.5
                    && bounds.height() < width * 10.5,
                "{id} at {width} mm: unexpected plan bounds {bounds:?}"
            );
            assert!(design.stitch_count() > 100 && design.stitch_count() < 50_000, "{id}");
            assert!(
                design.blocks.iter().flat_map(|block| &block.runs).flat_map(|run| &run.pts).all(|point| point.x.is_finite() && point.y.is_finite()),
                "{id}: value outside finite stitch coordinates"
            );
            for format in ["dst", "pes"] {
                let encoded = formats::write_format(&design, format).unwrap();
                let decoded = formats::read::read_stitch_file(&encoded, format).unwrap();
                assert!(
                    decoded.blocks.iter().flat_map(|block| &block.runs).any(|run| run.len() > 10),
                    "{id} at {width} mm: no usable stitch run after {format} round trip"
                );
            }
        }
    }
}
