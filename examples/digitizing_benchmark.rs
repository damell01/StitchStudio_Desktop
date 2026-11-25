//! Repeatable, original raster fixtures for the automatic digitizer.
use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;
use zigzag::design::auto_stitch_types;
use zigzag::document::Document;
use zigzag::formats::{self, Op, StreamOptions};
use zigzag::trace::{TraceOptions, trace_prepared_bytes};

const SIDE: u32 = 128;

fn bmp(mut pixel: impl FnMut(u32, u32) -> [u8; 3]) -> Vec<u8> {
    let payload = SIDE * SIDE * 3;
    let mut bytes = b"BM".to_vec();
    for n in [payload + 54, 0, 54, 40, SIDE, SIDE] {
        bytes.extend(n.to_le_bytes());
    }
    bytes.extend([1, 0, 24, 0]);
    for n in [0, payload, 0, 0, 0, 0] {
        bytes.extend(n.to_le_bytes());
    }
    for y in (0..SIDE).rev() {
        for x in 0..SIDE {
            let [r, g, b] = pixel(x, y);
            bytes.extend([b, g, r]);
        }
    }
    bytes
}

fn main() -> anyhow::Result<()> {
    let fixtures = [
        ("badge", bmp(|x, y| {
            let radius = (f64::from(x) - 64.0).hypot(f64::from(y) - 64.0);
            if radius > 52.0 || radius < 17.0 { [255; 3] }
            else if (27..33).contains(&x) || (93..99).contains(&x) { [224, 163, 60] }
            else if radius > 46.0 { [30, 35, 66] }
            else { [99, 58, 150] }
        }), false, 32),
        ("edge-line", bmp(|x, y| {
            if x.abs_diff(y / 2 + 25) < 3 { [24, 40, 110] }
            else if (72..99).contains(&x) && (22..97).contains(&y) { [151, 29, 47] }
            else { [15, 31, 47] }
        }), false, 0),
        ("textured-oval", bmp(|x, y| {
            let noise = ((x * 37 + y * 13) % 17) as u8;
            let d = ((x as f64 - 64.0) / 47.0).hypot((y as f64 - 64.0) / 32.0);
            if d < 0.88 { [180 + noise, 45 + noise, 66 + noise] }
            else if d < 1.0 { [62, 24, 48] }
            else { [210 + noise, 194 + noise, 167 + noise] }
        }), true, 32),
    ];
    println!("fixture,ms,shapes,stitches,colors,blocks,trims,jumps,travel_mm,short_segments,long_segments,peak_penetrations_per_mm2,round_trip_formats");
    for (name, bytes, cleanup, tolerance) in fixtures {
        let started = Instant::now();
        let trace = trace_prepared_bytes(&bytes, &TraceOptions::default(), tolerance, cleanup)?;
        let mut document = Document::from_svg(&trace.svg, name, None)?;
        auto_stitch_types(&mut document.shapes);
        document.settings.hat_order = document.shapes.len() <= 1000;
        let design = document.plan();
        let elapsed_ms = started.elapsed().as_millis();
        anyhow::ensure!(design.stitch_count() > 0, "{name} produced an empty stitch plan");
        let commands = formats::commands(&design, &StreamOptions { ties: true, max_step: 121.0 });
        let mut occupancy = BTreeMap::new();
        let (mut jumps, mut travel, mut short, mut long) = (0, 0.0, 0, 0);
        for pair in commands.windows(2) {
            let point = pair[1];
            let mm = (point.x - pair[0].x).hypot(point.y - pair[0].y) / 10.0;
            match point.op {
                Op::Jump => { jumps += 1; travel += mm; }
                Op::Stitch => {
                    *occupancy.entry(((point.x / 10.0).floor() as i32, (point.y / 10.0).floor() as i32)).or_insert(0) += 1;
                    short += usize::from(mm < 0.3);
                    long += usize::from(mm > 12.0);
                }
                _ => {}
            }
        }
        let mut decoded = Vec::new();
        for ext in formats::READABLE_FORMATS {
            let encoded = formats::write_format(&design, ext)?;
            let imported = formats::read::read_stitch_file(&encoded, ext)?;
            anyhow::ensure!(!imported.blocks.is_empty(), "{name} produced an empty {ext} round trip");
            decoded.push(ext);
        }
        let colors: BTreeSet<_> = design.blocks.iter().map(|block| block.color).collect();
        println!("{name},{elapsed_ms},{},{},{},{},{},{jumps},{travel:.2},{short},{long},{},{}",
            document.shapes.len(), design.stitch_count(), colors.len(), design.blocks.len(),
            design.trim_count(), occupancy.values().max().unwrap_or(&0), decoded.join("|"));
    }
    Ok(())
}
