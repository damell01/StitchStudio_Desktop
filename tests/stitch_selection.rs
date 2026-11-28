//! Automatic stitch selection: thin detail sews as running stitches, narrow
//! columns as satin, broad areas as fill, and one object can mix them.
use zigzag::{document::Document, params::Kind, svg::Geometry};

fn doc(paths: &str) -> Document {
    Document::from_svg(&format!(r##"<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">{paths}</svg>"##), "t", None).unwrap()
}
fn classify(d: &mut Document) { for s in &mut d.shapes { s.params.kind = None; } zigzag::design::auto_stitch_types(&mut d.shapes); }
fn hatch(n: usize, x0: f64) -> String { (0..n).map(|k| format!("M{} 10h0.5v30h-0.5z", x0 + k as f64 * 3.0)).collect() }

#[test]
fn engraved_hatching_becomes_centerline_running_stitches() {
    let mut d = doc(&format!(r##"<path id="hatch" fill="#333" d="{}"/>"##, hatch(8, 10.0)));
    classify(&mut d);
    let s = &d.shapes[0];
    assert_eq!((s.params.kind, s.params.border), (Some(Kind::Run), Some(false)), "0.5 mm lines are not filled");
    let plan = d.plan();
    // One running line per hatch stroke, each about 30 mm long, not rows of fill.
    let runs: usize = plan.blocks.iter().map(|b| b.runs.len()).sum();
    assert!(plan.stitch_count() > 8 * 10 && plan.stitch_count() < 8 * 30, "{} stitches", plan.stitch_count());
    assert!(runs <= 8, "{runs} runs");
}

#[test]
fn a_mixed_object_fills_its_broad_part_and_runs_its_thin_detail() {
    // A 30 mm square plus six 0.5 mm stems in the same path (one color, one object).
    let mut d = doc(&format!(r##"<path id="leaf" fill="#3a6" d="M50 50h30v30h-30z{}"/>"##, hatch(6, 10.0)));
    classify(&mut d);
    assert_eq!(d.shapes[0].params.kind, None, "left on automatic so the planner mixes types");
    let (filled, thin) = match &d.shapes[0].geometry {
        Geometry::Fill { rings, rule } => zigzag::design::split_thin_detail(rings, *rule),
        _ => panic!(),
    };
    assert_eq!((filled.len(), thin.len()), (1, 6));
    let plan = d.plan();
    let lines = plan.blocks.iter().flat_map(|b| &b.runs).filter(|r| r.pts.iter().all(|p| p.x < 300.0)).count();
    assert!(lines >= 1, "thin stems are sewn");
    assert!(plan.stitch_count() > 500, "the square is filled: {}", plan.stitch_count());
}

#[test]
fn an_explicit_fill_keeps_every_part_filled() {
    let mut d = doc(&format!(r##"<path id="hatch" fill="#333" d="{}"/>"##, hatch(4, 10.0)));
    d.shapes[0].params.kind = Some(Kind::Fill);
    let (filled, _) = match &d.shapes[0].geometry { Geometry::Fill { rings, rule } => zigzag::design::split_thin_detail(rings, *rule), _ => panic!() };
    assert_eq!(filled.len(), 0);
    assert_eq!(d.shapes[0].params.kind, Some(Kind::Fill));
    assert!(d.plan().stitch_count() > 0);
}

#[test]
fn narrow_columns_are_satin_and_broad_areas_fill() {
    let mut d = doc(r##"<path id="column" fill="#a33" d="M10 10h3v40h-3z"/><path id="block" fill="#33a" d="M40 10h40v40h-40z"/>"##);
    classify(&mut d);
    assert_eq!(d.shapes[0].params.kind, Some(Kind::Satin), "3 mm column");
    assert_eq!(d.shapes[1].params.kind, None, "40 mm square stays automatic fill");
}
