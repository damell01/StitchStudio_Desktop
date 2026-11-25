use zigzag::{document::Document, formats, geom::P};

#[test]
fn files_from_an_independent_encoder_import_into_the_editor() {
    let fixtures: [(&str, &[u8]); 6] = [
        ("dst", include_bytes!("fixtures/machine-import/two-color-path.dst")),
        ("pes", include_bytes!("fixtures/machine-import/two-color-path.pes")),
        ("pec", include_bytes!("fixtures/machine-import/two-color-path.pec")),
        ("exp", include_bytes!("fixtures/machine-import/two-color-path.exp")),
        ("jef", include_bytes!("fixtures/machine-import/two-color-path.jef")),
        ("vp3", include_bytes!("fixtures/machine-import/two-color-path.vp3")),
    ];
    assert_eq!(fixtures.map(|(format, _)| format), formats::READABLE_FORMATS);

    for (format, bytes) in fixtures {
        let imported = formats::read::read_stitch_file(bytes, &format.to_uppercase())
            .unwrap_or_else(|error| panic!("{format}: {error:#}"));
        assert_eq!(imported.blocks.len(), 2, "{format} color blocks");
        assert!(imported.blocks[0].runs.len() > 1, "{format} lost a travel break");
        let stitches: Vec<_> = imported.blocks.iter()
            .flat_map(|block| block.runs.iter().flatten().copied()).collect();
        for (x,y) in [(-75.0,10.0), (30.0,30.0), (15.0,-30.0), (45.0,-39.0)] {
            assert!(stitches.iter().any(|point| point.dist(P::new(x,y)) < 1.1),
                "{format} missing ({x}, {y}): {stitches:?}");
        }
        if format == "vp3" {
            assert_eq!(imported.blocks[0].color, [237,23,31]);
            assert_eq!(imported.blocks[1].color, [10,85,163]);
            assert!(formats::read::read_stitch_file(&bytes[..bytes.len()-4], format).is_err());
        }
        let document = Document::from_svg(&formats::read::to_svg(&imported), "machine import", None)
            .unwrap_or_else(|error| panic!("{format}: {error:#}"));
        let design = document.plan();
        assert_eq!(design.blocks.len(), 2, "{format} lost a block during editing");
        assert!((design.bounds().width() - 135.0).abs() < 2.0, "{format} lost physical width");
        let dst = formats::write_format(&design, "dst").unwrap();
        assert_eq!(formats::read::read_stitch_file(&dst, "dst").unwrap().blocks.len(), 2);
    }
}

#[test]
fn rejects_missing_or_unrelated_data_for_machine_import() {
    for format in formats::READABLE_FORMATS {
        assert!(formats::read::read_stitch_file(&[], format).is_err(), "{format}");
    }
    for format in ["dst", "pec"] {
        assert!(formats::read::read_stitch_file(&[0; 530], format).is_err(), "{format}");
    }
}
