use zigzag::{formats, trace::{TraceOptions, digitize_raster}};

#[test]
fn supported_raster_files_generate_stitches_and_readable_machine_exports() {
    let fixtures: [(&str, &[u8]); 6] = [
        ("transparent PNG", include_bytes!("fixtures/digitizer/artwork.png")),
        ("JPEG", include_bytes!("fixtures/digitizer/artwork.jpg")),
        ("WebP", include_bytes!("fixtures/digitizer/artwork.webp")),
        ("GIF", include_bytes!("fixtures/digitizer/artwork.gif")),
        ("BMP", include_bytes!("fixtures/digitizer/artwork.bmp")),
        ("TIFF", include_bytes!("fixtures/digitizer/artwork.tiff")),
    ];
    for (format, bytes) in fixtures {
        let document = digitize_raster(bytes, format, &TraceOptions::default(), 32, false)
            .unwrap_or_else(|error| panic!("{format}: {error}"));
        let design = document.plan();
        assert!(design.stitch_count() > 100, "{format}: empty or sparse design");
        assert!(design.blocks.len() >= 2, "{format}: distinct artwork colors lost");
        assert!(design.bounds().width() < 850.0, "{format}: width exceeds 85 mm");
        for extension in ["dst", "pes"] {
            let encoded = formats::write_format(&design, extension).unwrap();
            let decoded = formats::read::read_stitch_file(&encoded, extension).unwrap();
            assert!(decoded.blocks.iter().any(|block| block.runs.iter().any(|run| run.len() > 10)),
                "{format}: no stitch runs in {extension} export");
        }
    }
}

#[test]
fn malformed_raster_returns_an_error() {
    assert!(digitize_raster(b"invalid file", "invalid", &TraceOptions::default(), 32, false).is_err());
}

#[test]
fn phone_photo_orientation_matches_the_preview() {
    let bytes = include_bytes!("fixtures/digitizer/phone-rotated.jpg");
    let image = zigzag::trace::Image::decode(bytes).unwrap();
    assert_eq!(image.size(), (76, 96));
    let design = digitize_raster(bytes, "phone photo", &TraceOptions::default(), 32, false)
        .unwrap().plan();
    assert!(design.bounds().height() > design.bounds().width());
}

#[test]
fn vector_artwork_retains_curves_and_exports_a_readable_stitch_run() {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 120 80">
      <path fill="#6945a2" d="M4 40 Q35 0 60 40 T116 40 Q90 76 60 40 Q38 15 4 40Z"/>
      <circle cx="64" cy="59" r="11" fill="#e09143"/>
    </svg>"##;
    let document = zigzag::document::Document::from_svg(svg, "vector", None).unwrap();
    let design = document.plan();
    let encoded = formats::write_format(&design, "pes").unwrap();
    let decoded = formats::read::read_stitch_file(&encoded, "pes").unwrap();
    assert!(decoded.blocks.iter().any(|block| block.runs.iter().any(|run| run.len() > 10)));
}
