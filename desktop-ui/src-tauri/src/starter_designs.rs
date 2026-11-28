use zigzag::formats::read::{StitchFile, read_stitch_file};

struct Sample {
    name: &'static str,
    dst: &'static [u8],
    colors: &'static [[u8; 3]],
}

const SAMPLES: &[Sample] = &[
    Sample {
        name: "Stitch Studio - Three Pines Patch.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Three Pines Patch.dst"),
        colors: &[[236, 217, 170], [48, 76, 72], [82, 115, 90], [49, 86, 75]],
    },
    Sample {
        name: "Stitch Studio - Prairie Coneflower.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Prairie Coneflower.dst"),
        colors: &[[85, 122, 88], [122, 154, 102], [180, 88, 120], [131, 80, 50]],
    },
    Sample {
        name: "Stitch Studio - Thread Spool.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Thread Spool.dst"),
        colors: &[[105, 69, 162], [206, 173, 221], [132, 99, 163], [68, 51, 88]],
    },
    Sample {
        name: "Stitch Studio - Sunday Football.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Sunday Football.dst"),
        colors: &[[233, 220, 186], [50, 71, 80], [153, 93, 58], [255, 241, 213]],
    },
    Sample {
        name: "Stitch Studio - Orbit Badge.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Orbit Badge.dst"),
        colors: &[[56, 39, 80], [184, 87, 105]],
    },
    Sample {
        name: "Stitch Studio - Classic heart.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Classic heart.dst"),
        colors: &[[184, 77, 101]],
    },
    Sample {
        name: "Stitch Studio - Five-point star.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Five-point star.dst"),
        colors: &[[193, 139, 50]],
    },
    Sample {
        name: "Stitch Studio - Botanical leaf.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Botanical leaf.dst"),
        colors: &[[115, 151, 123], [35, 69, 54]],
    },
    Sample {
        name: "Stitch Studio - Ribbon bow.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Ribbon bow.dst"),
        colors: &[[184, 110, 131], [141, 69, 93]],
    },
    Sample {
        name: "Stitch Studio - Mountain badge.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Mountain badge.dst"),
        colors: &[[229, 237, 230], [49, 91, 71], [255, 253, 245]],
    },
    Sample {
        name: "Stitch Studio - Wildflower sprig.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Wildflower sprig.dst"),
        colors: &[[71, 119, 91], [119, 155, 105], [214, 138, 158], [215, 168, 76]],
    },
    Sample {
        name: "Stitch Studio - Sunrise adventure patch.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Sunrise adventure patch.dst"),
        colors: &[[35, 60, 88], [229, 163, 77], [101, 141, 154], [245, 238, 224], [217, 199, 164]],
    },
    Sample {
        name: "Stitch Studio - Baseball diamond.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Baseball diamond.dst"),
        colors: &[[40, 76, 109], [246, 238, 224], [184, 60, 70]],
    },
    Sample {
        name: "Stitch Studio - Coastal anchor.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Coastal anchor.dst"),
        colors: &[[35, 75, 112], [196, 154, 96]],
    },
    Sample {
        name: "Stitch Studio - Garden butterfly.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Garden butterfly.dst"),
        colors: &[[118, 154, 196], [231, 179, 107], [38, 60, 86]],
    },
    Sample {
        name: "Stitch Studio - Honey bear.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Honey bear.dst"),
        colors: &[[170, 117, 77], [233, 195, 154], [41, 43, 53], [230, 160, 160], [80, 56, 44], [83, 126, 155]],
    },
    Sample {
        name: "Stitch Studio - Space explorer.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Space explorer.dst"),
        colors: &[[185, 91, 82], [230, 229, 223], [70, 101, 132], [185, 91, 82], [70, 101, 132], [155, 204, 228], [229, 165, 74], [185, 91, 82]],
    },
    Sample {
        name: "Stitch Studio - Pastel rainbow.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Pastel rainbow.dst"),
        colors: &[[217, 143, 165], [232, 181, 124], [166, 189, 155], [142, 181, 210]],
    },
    Sample {
        name: "Stitch Studio - Sweet pumpkin.dst",
        dst: include_bytes!("../assets/starter-designs/Stitch Studio - Sweet pumpkin.dst"),
        colors: &[[223, 150, 84], [184, 117, 61], [223, 150, 84], [184, 117, 61], [223, 150, 84], [184, 117, 61], [104, 133, 90], [73, 58, 55]],
    },
];

pub(super) fn names() -> impl Iterator<Item = &'static str> {
    // Retain legacy sample lookup for compatibility, but do not advertise the
    // retired starter collection in the personal embroidery library.
    std::iter::empty::<&'static str>()
}

pub(super) fn open(name: &str) -> Option<Result<StitchFile, String>> {
    let sample = SAMPLES.iter().find(|sample| sample.name == name)?;
    Some(read_stitch_file(sample.dst, "dst").map_err(|err| err.to_string()).and_then(|mut design| {
        if design.blocks.len() != sample.colors.len() {
            return Err("The bundled design and its thread chart are out of sync".into());
        }
        for (block, color) in design.blocks.iter_mut().zip(sample.colors) {
            block.color = *color;
        }
        Ok(design)
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retired_samples_are_not_listed() {
        assert_eq!(names().count(), 0);
    }

    #[test]
    fn starter_dst_files_have_real_stitches_and_match_their_thread_charts() {
        for sample in SAMPLES {
            let design = open(sample.name).unwrap().unwrap();
            let stitches: usize = design.blocks.iter().flat_map(|block| &block.runs).map(Vec::len).sum();
            assert!(stitches > 100, "{}", sample.name);
            assert_eq!(design.blocks.iter().map(|block| block.color).collect::<Vec<_>>(), sample.colors);
            for point in design.blocks.iter().flat_map(|block| &block.runs).flatten() {
                assert!(point.x.abs() < 500.0 && point.y.abs() < 500.0, "{}", sample.name);
            }
        }
    }
}
