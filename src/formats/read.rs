//! Reading machine files (PES, PEC, DST, EXP, JEF, VP3) into stitch blocks, and
//! turning them into an editable SVG of manual-stitch paths.
//! Decoding follows pyembroidery (MIT License, Copyright (c) 2018 Tatarize).

use super::jef_data::JEF_PALETTE;
use super::pec_data::PEC_PALETTE;
use crate::geom::{P, Polyline};
use anyhow::{Result, bail};
use std::fmt::Write;

/// One thread color's worth of stitching: runs separated by jumps/trims.
#[derive(Clone, Debug, Default)]
pub struct StitchBlock {
    pub color: [u8; 3],
    pub runs: Vec<Polyline>,
}

#[derive(Clone, Debug, Default)]
pub struct StitchFile {
    pub name: String,
    pub blocks: Vec<StitchBlock>,
}

/// Builder that tracks position and splits runs/blocks.
struct Builder {
    blocks: Vec<StitchBlock>,
    pos: P,
    jumped: bool,
}

impl Builder {
    fn new() -> Self {
        Builder {
            blocks: vec![StitchBlock::default()],
            pos: P::default(),
            jumped: true,
        }
    }
    fn stitch(&mut self, dx: f64, dy: f64) {
        let from = self.pos;
        self.pos = self.pos + P::new(dx, dy);
        let blk = self.blocks.last_mut().unwrap();
        if self.jumped || blk.runs.is_empty() {
            blk.runs.push(vec![from]);
            self.jumped = false;
        }
        blk.runs.last_mut().unwrap().push(self.pos);
    }
    fn jump(&mut self, dx: f64, dy: f64) {
        self.pos = self.pos + P::new(dx, dy);
        self.jumped = true;
    }
    fn color_change(&mut self) {
        self.blocks.push(StitchBlock::default());
        self.jumped = true;
    }
    fn finish(mut self, colors: &[[u8; 3]]) -> Vec<StitchBlock> {
        for (i, b) in self.blocks.iter_mut().enumerate() {
            b.color = colors
                .get(i)
                .copied()
                .unwrap_or(DEFAULT_COLORS[i % DEFAULT_COLORS.len()]);
            // Drop the single-point runs left by jumps.
            b.runs.retain(|r| r.len() >= 2);
        }
        self.blocks.retain(|b| !b.runs.is_empty());
        self.blocks
    }
}

/// Distinct colors for formats that don't store any (DST, EXP).
const DEFAULT_COLORS: [[u8; 3]; 8] = [
    [30, 30, 30],
    [200, 40, 40],
    [30, 90, 170],
    [240, 180, 30],
    [40, 140, 70],
    [130, 60, 150],
    [230, 120, 30],
    [90, 90, 90],
];

fn signed7(b: u8) -> i32 {
    if b > 63 { b as i32 - 128 } else { b as i32 }
}

fn signed12(v: u16) -> i32 {
    let v = (v & 0xFFF) as i32;
    if v > 0x7FF { v - 0x1000 } else { v }
}

fn i32le(d: &[u8], at: usize) -> Option<i32> {
    Some(i32::from_le_bytes(d.get(at..at + 4)?.try_into().ok()?))
}

/// Decode a PEC block starting at `start` (just after any "#PEC0001").
fn read_pec(d: &[u8], start: usize) -> Result<StitchFile> {
    let label_at = start + 3;
    let name = String::from_utf8_lossy(d.get(label_at..label_at + 16).unwrap_or_default())
        .trim()
        .to_string();
    let cc_at = label_at + 16 + 0xF + 2 + 0xC;
    let Some(&cc) = d.get(cc_at) else {
        bail!("PEC header is truncated")
    };
    let ncolors = cc as usize + 1;
    let palette: Vec<[u8; 3]> = (0..ncolors)
        .map(|i| {
            let idx = d.get(cc_at + 1 + i).copied().unwrap_or(0) as usize % PEC_PALETTE.len();
            let (r, g, b, _) = PEC_PALETTE[idx];
            [r, g, b]
        })
        .collect();
    let mut i = cc_at + 1 + ncolors + (0x1D0 - cc as usize);
    i += 3; // stitch block length (u24)
    i += 0x0B;
    let mut bld = Builder::new();
    while let (Some(&v1), Some(&v2)) = (d.get(i), d.get(i + 1)) {
        if v1 == 0xFF && v2 == 0x00 {
            break;
        }
        if v1 == 0xFE && v2 == 0xB0 {
            i += 3;
            bld.color_change();
            continue;
        }
        let (mut jump, mut trim) = (false, false);
        let x;
        let mut v2 = v2;
        if v1 & 0x80 != 0 {
            trim |= v1 & 0x20 != 0;
            jump |= v1 & 0x10 != 0;
            x = signed12(((v1 as u16) << 8) | v2 as u16);
            i += 2;
            let Some(&n) = d.get(i) else { break };
            v2 = n;
        } else {
            x = signed7(v1);
            i += 1;
        }
        let y;
        if v2 & 0x80 != 0 {
            trim |= v2 & 0x20 != 0;
            jump |= v2 & 0x10 != 0;
            let Some(&v3) = d.get(i + 1) else { break };
            y = signed12(((v2 as u16) << 8) | v3 as u16);
            i += 2;
        } else {
            y = signed7(v2);
            i += 1;
        }
        if jump || trim {
            bld.jump(x as f64, y as f64);
        } else {
            bld.stitch(x as f64, y as f64);
        }
    }
    Ok(StitchFile {
        name,
        blocks: bld.finish(&palette),
    })
}

fn read_dst(d: &[u8]) -> Result<StitchFile> {
    if d.len() < 512 {
        bail!("DST file is too short");
    }
    if !d.starts_with(b"LA:") {
        bail!("Not a DST file");
    }
    let header = String::from_utf8_lossy(&d[..512]);
    let mut name = String::new();
    let mut colors = Vec::new();
    for line in header.split(['\r', '\n']) {
        if let Some(v) = line.strip_prefix("LA:") {
            name = v.trim().to_string();
        }
        if let Some(v) = line.strip_prefix("TC:")
            && let Some(c) = crate::params::parse_hex(v.split(',').next().unwrap_or("").trim())
        {
            colors.push(c);
        }
    }
    let bit = |b: u8, p: u8| ((b >> p) & 1) as i32;
    let mut bld = Builder::new();
    for r in d[512..].chunks_exact(3) {
        let (b0, b1, b2) = (r[0], r[1], r[2]);
        let dx = bit(b2, 2) * 81 - bit(b2, 3) * 81 + bit(b1, 2) * 27 - bit(b1, 3) * 27
            + bit(b0, 2) * 9
            - bit(b0, 3) * 9
            + bit(b1, 0) * 3
            - bit(b1, 1) * 3
            + bit(b0, 0)
            - bit(b0, 1);
        let dy = -(bit(b2, 5) * 81 - bit(b2, 4) * 81 + bit(b1, 5) * 27 - bit(b1, 4) * 27
            + bit(b0, 5) * 9
            - bit(b0, 4) * 9
            + bit(b1, 7) * 3
            - bit(b1, 6) * 3
            + bit(b0, 7)
            - bit(b0, 6));
        if b2 & 0b1111_0011 == 0b1111_0011 {
            break;
        } else if b2 & 0b1100_0011 == 0b1100_0011 {
            bld.color_change();
            bld.jump(dx as f64, dy as f64);
        } else if b2 & 0b1000_0011 == 0b1000_0011 {
            bld.jump(dx as f64, dy as f64);
        } else {
            bld.stitch(dx as f64, dy as f64);
        }
    }
    Ok(StitchFile {
        name,
        blocks: bld.finish(&colors),
    })
}

/// EXP and JEF share the stitch encoding; `jump_code` differs (EXP 0x04, JEF 0x02).
fn read_exp_like(d: &[u8], jump_code: u8, colors: &[[u8; 3]]) -> Vec<StitchBlock> {
    let s8 = |b: u8| b as i8 as f64;
    let mut bld = Builder::new();
    let mut i = 0;
    while i + 1 < d.len() {
        let (b0, b1) = (d[i], d[i + 1]);
        i += 2;
        if b0 != 0x80 {
            bld.stitch(s8(b0), -s8(b1));
            continue;
        }
        let ctrl = b1;
        if ctrl == 0x10 {
            break;
        }
        if i + 1 >= d.len() {
            break;
        }
        let (x, y) = (s8(d[i]), -s8(d[i + 1]));
        i += 2;
        match ctrl {
            0x80 => bld.jumped = true,
            0x01 => {
                bld.color_change();
                if x != 0.0 || y != 0.0 {
                    bld.jump(x, y);
                }
            }
            0x02 if jump_code == 0x02 => bld.jump(x, y),
            0x02 => bld.stitch(x, y),
            0x04 => bld.jump(x, y),
            _ => break,
        }
    }
    bld.finish(colors)
}

fn read_jef(d: &[u8]) -> Result<StitchFile> {
    let Some(offset) = i32le(d, 0) else {
        bail!("JEF file is too short")
    };
    let ncolors = i32le(d, 24).unwrap_or(0).max(0) as usize;
    let colors: Vec<[u8; 3]> = (0..ncolors.min(256))
        .filter_map(|k| i32le(d, 116 + k * 4))
        .map(|idx| {
            let (r, g, b, _, _) = JEF_PALETTE[idx.unsigned_abs() as usize % JEF_PALETTE.len()];
            [r, g, b]
        })
        .collect();
    let body = d.get(offset as usize..).unwrap_or_default();
    Ok(StitchFile {
        name: String::new(),
        blocks: read_exp_like(body, 0x02, &colors),
    })
}

// VP3 block layout and stitch commands follow pyembroidery's Vp3Reader (MIT).
// Read within the declared block lengths so adjacent threads cannot consume each other.
struct Vp3<'a>(&'a [u8]);

impl<'a> Vp3<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8]> {
        let (head, tail) = self.0.split_at_checked(count)
            .ok_or_else(|| anyhow::anyhow!("VP3 block is truncated"))?;
        self.0 = tail;
        Ok(head)
    }

    fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_be_bytes(self.take(2)?.try_into()?))
    }

    fn i32(&mut self) -> Result<i32> {
        Ok(i32::from_be_bytes(self.take(4)?.try_into()?))
    }

    fn skip_string(&mut self) -> Result<()> {
        let size = self.u16()? as usize;
        self.take(size)?;
        Ok(())
    }

    fn block(&mut self, kind: u8) -> Result<Self> {
        if self.take(3)? != [0, kind, 0] {
            bail!("Unexpected VP3 block type");
        }
        let size = u32::from_be_bytes(self.take(4)?.try_into()?) as usize;
        Ok(Self(self.take(size)?))
    }

    fn position(&mut self) -> Result<P> {
        Ok(P::new(f64::from(self.i32()?) / 100.0, -f64::from(self.i32()?) / 100.0))
    }
}

fn read_vp3(data: &[u8]) -> Result<StitchFile> {
    let mut input = Vp3(data);
    if input.take(6)? != b"%vsm%\0" {
        bail!("Not a VP3 file");
    }
    input.skip_string()?;
    let mut file = input.block(2)?;
    file.skip_string()?;
    file.take(23)?;
    let design_count = file.u16()?;
    if design_count == 0 || design_count > 256 {
        bail!("Invalid VP3 design count");
    }
    let mut builder = Builder::new();
    let mut colors = Vec::new();
    for _ in 0..design_count {
        let mut design = file.block(3)?;
        let center = design.position()?;
        design.take(27)?;
        design.skip_string()?;
        design.take(24)?;
        design.skip_string()?;
        let color_count = design.u16()?;
        if color_count == 0 || usize::from(color_count) + colors.len() > 4096 {
            bail!("Invalid VP3 color count");
        }
        for _ in 0..color_count {
            let mut color_block = design.block(5)?;
            let start = center + color_block.position()?;
            let count = color_block.take(2)?[0];
            if count == 0 { bail!("VP3 thread has no color"); }
            let mut color = [0; 3];
            for _ in 0..count {
                color.copy_from_slice(&color_block.take(6)?[..3]);
            }
            color_block.take(2)?;
            for _ in 0..3 { color_block.skip_string()?; }
            color_block.take(8)?;
            let mut stitches = color_block.block(1)?;
            if stitches.take(3)? != [0x0a, 0xf6, 0] {
                bail!("Invalid VP3 stitch header");
            }
            if !colors.is_empty() { builder.color_change(); }
            builder.pos = start;
            colors.push(color);
            while !stitches.0.is_empty() {
                let record = stitches.take(2)?;
                match (record[0], record[1]) {
                    (0x80, 1) => {
                        let dx = stitches.u16()? as i16;
                        let dy = stitches.u16()? as i16;
                        if stitches.take(2)? != [0x80, 2] { bail!("Invalid VP3 long stitch"); }
                        builder.stitch(f64::from(dx), f64::from(dy));
                    }
                    (0x80, 2) => {}
                    (0x80, 3) => builder.jumped = true,
                    (0x80, _) => bail!("Unsupported VP3 stitch command"),
                    (dx, dy) => builder.stitch(f64::from(dx as i8), f64::from(dy as i8)),
                }
            }
        }
    }
    Ok(StitchFile { name: String::new(), blocks: builder.finish(&colors) })
}

/// Read a machine file by extension.
pub fn read_stitch_file(data: &[u8], ext: &str) -> Result<StitchFile> {
    let file = match ext.to_ascii_lowercase().as_str() {
        "pes" => {
            if !data.starts_with(b"#PES") {
                bail!("not a PES file");
            }
            let Some(off) = i32le(data, 8) else {
                bail!("PES header is truncated")
            };
            let Ok(off) = usize::try_from(off) else {
                bail!("PES header points before the start of the file")
            };
            read_pec(data, off)
        }
        "pec" => {
            if !data.starts_with(b"#PEC0001") { bail!("Not a PEC file"); }
            read_pec(data, 8)
        }
        "dst" => read_dst(data),
        "exp" => Ok(StitchFile {
            name: String::new(),
            blocks: read_exp_like(data, 0x04, &[]),
        }),
        "jef" => read_jef(data),
        "vp3" => read_vp3(data),
        other => bail!("Cannot open .{other}. Import formats: {}", super::READABLE_FORMATS.join(", ")),
    }?;
    if file.blocks.is_empty() { bail!("No embroidery stitches found"); }
    Ok(file)
}

/// An SVG (mm units, origin at the design's center) with one manual-stitch
/// path per run, so the design can be moved, scaled and recolored as objects.
pub fn to_svg(f: &StitchFile) -> String {
    let mut b = crate::geom::Bounds::empty();
    for p in f.blocks.iter().flat_map(|b| b.runs.iter().flatten()) {
        b.add(*p);
    }
    // Stitches sit on whole 0.1 mm units: so does the center, or every
    // coordinate would be written (rounded) half a unit off.
    let c = b.center();
    let c = P::new(c.x.round(), c.y.round());
    let (w, h) = ((b.width() / 10.0).max(1.0), (b.height() / 10.0).max(1.0));
    let mut s = String::new();
    let _ = writeln!(
        s,
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{w:.2}mm" height="{h:.2}mm" viewBox="{:.2} {:.2} {w:.2} {h:.2}">"#,
        (b.min.x - c.x) / 10.0,
        (b.min.y - c.y) / 10.0
    );
    for (bi, blk) in f.blocks.iter().enumerate() {
        let col = format!(
            "#{:02x}{:02x}{:02x}",
            blk.color[0], blk.color[1], blk.color[2]
        );
        let _ = writeln!(s, r#"  <g id="color_{}">"#, bi + 1);
        for (ri, run) in blk.runs.iter().enumerate() {
            let mut d = String::new();
            for (k, p) in run.iter().enumerate() {
                let q = *p - c;
                let _ = write!(
                    d,
                    "{}{:.1},{:.1} ",
                    if k == 0 { "M" } else { "L" },
                    q.x / 10.0,
                    q.y / 10.0
                );
            }
            // Keep decoded run breaks separate even when the planner could
            // connect two nearby points. Repeated colors can encode a stop.
            let boundary = if ri + 1 < blk.runs.len() {
                "_trim"
            } else if f.blocks.get(bi + 1).is_some_and(|next| next.color == blk.color) {
                "_stop"
            } else {
                ""
            };
            let _ = writeln!(
                s,
                r#"    <path id="stitches_{}_{}_manual{boundary}" d="{}" fill="none" stroke="{col}" stroke-width="0.4"/>"#,
                bi + 1,
                ri + 1,
                d.trim_end()
            );
        }
        s.push_str("  </g>\n");
    }
    s.push_str("</svg>\n");
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::{Block, Design, Run};
    use crate::formats::{dst, more, pes};

    fn sample() -> Design {
        let run = |pts: &[(f64, f64)]| Run {
            pts: pts.iter().map(|&(x, y)| P::new(x, y)).collect(),
            trim_before: true,
        };
        Design {
            name: "t".into(),
            blocks: vec![
                Block {
                    color: [237, 23, 31],
                    runs: vec![
                        run(&[(-200.0, 0.0), (-150.0, 30.0), (-100.0, 0.0)]),
                        run(&[(50.0, 50.0), (80.0, 50.0)]),
                    ],
                },
                Block {
                    color: [10, 85, 163],
                    runs: vec![run(&[(0.0, -300.0), (40.0, -260.0), (300.0, -300.0)])],
                },
            ],
            ..Design::default()
        }
    }

    /// Every writer's output reads back to the same stitch positions.
    #[test]
    fn writers_round_trip_through_readers() {
        let d = sample();
        for (ext, bytes) in [
            ("pes", pes::write_pes(&d)),
            ("dst", dst::write_dst(&d)),
            ("exp", more::write_exp(&d)),
            ("jef", more::write_jef(&d)),
            ("pec", pes::write_pec_file(&d)),
            ("vp3", more::write_vp3(&d)),
        ] {
            let f = read_stitch_file(&bytes, ext).unwrap_or_else(|e| panic!("{ext}: {e}"));
            assert_eq!(f.blocks.len(), 2, "{ext}: two colors");
            let pts: Vec<P> = f
                .blocks
                .iter()
                .flat_map(|b| b.runs.iter().flatten().copied())
                .collect();
            for want in [
                P::new(-150.0, 30.0),
                P::new(80.0, 50.0),
                P::new(40.0, -260.0),
                P::new(300.0, -300.0),
            ] {
                assert!(
                    pts.iter().any(|p| p.dist(want) < 0.6),
                    "{ext}: missing {want:?}"
                );
            }
            if ext == "vp3" {
                assert_eq!(f.blocks.iter().map(|block| block.color).collect::<Vec<_>>(),
                    d.blocks.iter().map(|block| block.color).collect::<Vec<_>>());
            }
            if ext == "pes" || ext == "jef" {
                assert_ne!(f.blocks[0].color, f.blocks[1].color, "{ext}: colors kept");
            }
        }
    }

    #[test]
    fn reopening_and_exporting_a_file_keeps_every_stitch_in_place() {
        let mut d = sample();
        // An odd width: the artwork's center falls on a half unit.
        d.blocks[1].runs[0].pts.push(P::new(301.0, -297.0));
        let f = read_stitch_file(&dst::write_dst(&d), "dst").unwrap();
        let doc = crate::document::Document::from_svg(&to_svg(&f), "t", None).unwrap();
        let g = read_stitch_file(&dst::write_dst(&doc.plan()), "dst").unwrap();
        let pts = |f: &StitchFile| -> Vec<P> {
            f.blocks
                .iter()
                .flat_map(|b| b.runs.iter().flatten().copied())
                .collect()
        };
        let (a, b) = (pts(&f), pts(&g));
        let bounds = |v: &[P]| {
            let mut b = crate::geom::Bounds::empty();
            v.iter().for_each(|p| b.add(*p));
            b
        };
        let shift = bounds(&b).min - bounds(&a).min;
        for p in &a {
            assert!(
                b.iter().any(|q| (*q - shift).dist(*p) < 1e-6),
                "{p:?} moved (shift {shift:?})"
            );
        }
    }

    #[test]
    fn a_negative_pec_offset_is_an_error_not_a_crash() {
        let mut f = b"#PES0001".to_vec();
        f.extend_from_slice(&(-8i32).to_le_bytes());
        f.extend_from_slice(&[0; 32]);
        assert!(read_stitch_file(&f, "pes").is_err());
    }

    #[test]
    fn imported_file_becomes_editable_document() {
        let bytes = pes::write_pes(&sample());
        let f = read_stitch_file(&bytes, "pes").unwrap();
        let svg = to_svg(&f);
        let doc = crate::document::Document::from_svg(&svg, "t", None).unwrap();
        assert!(
            doc.shapes
                .iter()
                .all(|s| s.params.kind == Some(crate::params::Kind::Manual))
        );
        let d = doc.plan();
        assert!(d.stitch_count() >= 8);
        assert_eq!(d.blocks.len(), 2);
    }
}
