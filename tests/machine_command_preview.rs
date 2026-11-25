#[path = "../desktop-ui/src-tauri/src/machine_records.rs"]
mod records;

use records::{Command, Record, inspect};
use zigzag::formats::{Cmd, Op, dst, pes};

fn at(x: f64, y: f64, op: Op) -> Cmd {
    Cmd { x, y, op }
}

#[test]
fn dst_tracks_encoded_trim_pattern_and_thread_changes() {
    let bytes = dst::dst_from_stream("preview", &[
        at(10.0, -3.0, Op::Stitch),
        at(10.0, -3.0, Op::Trim),
        at(37.0, 24.0, Op::Jump),
        at(37.0, 24.0, Op::ColorChange),
        at(37.0, 24.0, Op::End),
    ]);
    let reviewed = inspect(&bytes, "dst", 0, 48).unwrap();
    assert_eq!((reviewed.stitches, reviewed.jumps, reviewed.trim_jumps, reviewed.color_changes), (1, 1, 3, 1));
    assert_eq!(reviewed.records, [
        Record { command: Command::Stitch, x: 10, y: -3, thread: 1 },
        Record { command: Command::TrimJump, x: 12, y: -1, thread: 1 },
        Record { command: Command::TrimJump, x: 8, y: -5, thread: 1 },
        Record { command: Command::TrimJump, x: 10, y: -3, thread: 1 },
        Record { command: Command::Jump, x: 37, y: 24, thread: 1 },
        Record { command: Command::ColorChange, x: 37, y: 24, thread: 2 },
        Record { command: Command::End, x: 37, y: 24, thread: 2 },
    ]);
    let page = inspect(&bytes, "dst", 4, 2).unwrap();
    assert_eq!(page.total, 7);
    assert_eq!(page.records, reviewed.records[4..6]);
}

#[test]
fn pes_reads_embedded_pec_flags_and_extra_needled_point() {
    let bytes = pes::pes_from_stream("preview", &[
        at(400.0, -35.0, Op::Jump),
        at(412.0, -28.0, Op::Stitch),
        at(412.0, -28.0, Op::Trim),
        at(271.0, -170.0, Op::Jump),
        at(271.0, -170.0, Op::ColorChange),
        at(271.0, -170.0, Op::End),
    ], &[[0, 0, 0], [255, 255, 255]]);
    let reviewed = inspect(&bytes, "pes", 0, 48).unwrap();
    assert_eq!((reviewed.stitches, reviewed.jumps, reviewed.trim_jumps, reviewed.color_changes), (3, 1, 1, 1));
    assert_eq!(reviewed.records, [
        Record { command: Command::Jump, x: 400, y: -35, thread: 1 },
        Record { command: Command::Stitch, x: 400, y: -35, thread: 1 },
        Record { command: Command::Stitch, x: 412, y: -28, thread: 1 },
        Record { command: Command::TrimJump, x: 271, y: -170, thread: 1 },
        Record { command: Command::Stitch, x: 271, y: -170, thread: 1 },
        Record { command: Command::ColorChange, x: 271, y: -170, thread: 2 },
        Record { command: Command::End, x: 271, y: -170, thread: 2 },
    ]);
    assert_eq!(Command::TrimJump.label(), "Trim-pattern jump");
}

#[test]
fn truncated_files_and_unsupported_formats_fail_without_panicking() {
    assert!(inspect(&[], "dst", 0, 48).is_err());
    assert!(inspect(&[0; 512], "dst", 0, 48).is_err());
    assert!(inspect(&[], "pes", 0, 48).is_err());
    assert!(inspect(&[], "jef", 0, 48).is_err());
}
