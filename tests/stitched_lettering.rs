//! Lettering in an already-stitched machine file (DST) can be read and replaced
//! with new editable lettering, as the editor's click-a-word flow does.
#![cfg(feature = "ocr")]
use zigzag::{document::{Document, TextSpec}, formats, ocr};

fn stitched_word(text: &str) -> Document {
    let mut source = Document::empty();
    let font = zigzag::document::font_families().into_iter().find(|f| f == "DejaVu Sans" || f == "Arial" || f == "Inter").expect("a common font");
    source.add_lettering(&TextSpec { text: text.into(), font, size_mm: 15.0, spacing_mm: 1.0, bold: true, ..Default::default() }, (0.0, 0.0)).unwrap();
    let dst = formats::dst::write_dst(&source.plan());
    let file = formats::read::read_stitch_file(&dst, "dst").unwrap();
    Document::from_svg(&formats::read::to_svg(&file), "stitched", None).unwrap()
}

#[test]
fn stitched_lettering_is_recognized_and_replaced_with_editable_text() {
    let mut doc = stitched_word("MIA");
    assert!(doc.shapes.iter().all(|s| s.params.kind == Some(zigzag::params::Kind::Manual)), "a machine file opens as fixed stitches");
    let mut bounds = zigzag::geom::Bounds::empty();
    for s in &doc.shapes { let b = zigzag::svg::shapes_bounds(std::slice::from_ref(s)); bounds.add(b.min); bounds.add(b.max); }
    // Rasterize as recognize_selected_lettering does: about 144 px per line height.
    let scale = 144.0 / bounds.height();
    let (w, h) = ((bounds.width() * scale).ceil() as usize + 24, (bounds.height() * scale).ceil() as usize + 24);
    let mut padded = bounds; padded.min.x -= 12.0 / scale; padded.min.y -= 12.0 / scale;
    padded.max.x = padded.min.x + w as f64 / scale; padded.max.y = padded.min.y + h as f64 / scale;
    let shapes: Vec<_> = doc.shapes.iter().collect();
    let ink = ocr::ink_raster(&shapes, padded, w, h);
    let mut rgba = vec![255u8; w * h * 4];
    for (k, v) in ink.iter().enumerate() { if *v { rgba[k * 4..k * 4 + 3].fill(0); } }
    let lines = ocr::recognize_rgba(w as u32, h as u32, &rgba).unwrap();
    let text: String = lines.iter().map(|l| l.text.clone()).collect::<Vec<_>>().join(" ");
    println!("recognized {text:?}");
    assert!(text.to_uppercase().replace(' ', "").contains("MIA"), "read {text:?}");

    // Replace the stitched letters in place, as preview_selected_lettering does.
    let font = zigzag::document::font_families().into_iter().find(|f| f == "DejaVu Sans" || f == "Arial" || f == "Inter").unwrap();
    let line = ocr::RecognizedLine { text: "MIA".into(), font, confidence: -1.0, enabled: true,
        rect: [bounds.min.x + doc.offset.x, bounds.min.y + doc.offset.y, bounds.max.x + doc.offset.x, bounds.max.y + doc.offset.y] };
    let before = doc.shapes.len();
    ocr::replace_lettering(&mut doc, &[line], 0.1).unwrap();
    let lettering: Vec<_> = (0..doc.shapes.len()).filter(|&i| doc.lettering(i).is_some()).collect();
    assert!(!lettering.is_empty(), "editable lettering added");
    assert!(doc.shapes.len() < before + 1 || doc.shapes.iter().all(|s| s.params.kind != Some(zigzag::params::Kind::Manual)), "stitched letters removed");
    let mut spec = doc.lettering(lettering[0]).unwrap();
    spec.text = "AVA".into();
    doc.set_lettering(lettering[0], &spec).unwrap();
    let plan = doc.plan();
    assert!(plan.stitch_count() > 100, "new word restitched: {}", plan.stitch_count());
    // The edit survives a read back and stays where the stitched word was.
    let i = (0..doc.shapes.len()).find(|&i| doc.lettering(i).is_some()).unwrap();
    assert_eq!(doc.lettering(i).unwrap().text, "AVA");
    let b = plan.bounds();
    assert!((b.center().x - bounds.center().x).abs() < 30.0 && (b.center().y - bounds.center().y).abs() < 30.0,
        "moved: {:?} vs {:?}", b.center(), bounds.center());
}
