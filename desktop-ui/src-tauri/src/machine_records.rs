//! Inspect the command records emitted by the supported machine encoders.
//! Coordinates are absolute in the file's 0.1 mm units, with positive Y down.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    Stitch,
    Jump,
    TrimJump,
    ColorChange,
    End,
}

impl Command {
    pub fn label(self) -> &'static str {
        match self {
            Self::Stitch => "Stitch",
            Self::Jump => "Jump",
            Self::TrimJump => "Trim-pattern jump",
            Self::ColorChange => "Color change",
            Self::End => "End",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Record {
    pub command: Command,
    pub x: i32,
    pub y: i32,
    pub thread: usize,
}

#[derive(Default, Debug)]
pub struct Inspection {
    pub records: Vec<Record>,
    pub total: usize,
    pub stitches: usize,
    pub jumps: usize,
    pub trim_jumps: usize,
    pub color_changes: usize,
}

pub fn inspect(bytes: &[u8], format: &str, offset: usize, limit: usize) -> Result<Inspection, &'static str> {
    let mut result = Inspection::default();
    let mut position = (0i32, 0i32);
    let mut thread = 1;
    let mut record = |command, dx, dy| {
        position.0 += dx;
        position.1 += dy;
        match command {
            Command::Stitch => result.stitches += 1,
            Command::Jump => result.jumps += 1,
            Command::TrimJump => result.trim_jumps += 1,
            Command::ColorChange => {
                result.color_changes += 1;
                thread += 1;
            }
            Command::End => {}
        }
        if result.total >= offset && result.records.len() < limit {
            result.records.push(Record { command, x: position.0, y: position.1, thread });
        }
        result.total += 1;
    };
    match format {
        "dst" => read_dst(bytes, &mut record)?,
        "pes" => read_pes(bytes, &mut record)?,
        _ => return Err("Machine command preview is available for DST and PES."),
    }
    Ok(result)
}

fn dst_delta(record: &[u8]) -> (i32, i32) {
    let bit = |byte: usize, shift: u32| i32::from((record[byte] >> shift) & 1);
    let x = 81 * (bit(2, 2) - bit(2, 3))
        + 27 * (bit(1, 2) - bit(1, 3))
        + 9 * (bit(0, 2) - bit(0, 3))
        + 3 * (bit(1, 0) - bit(1, 1))
        + bit(0, 0) - bit(0, 1);
    let y = 81 * (bit(2, 4) - bit(2, 5))
        + 27 * (bit(1, 4) - bit(1, 5))
        + 9 * (bit(0, 4) - bit(0, 5))
        + 3 * (bit(1, 6) - bit(1, 7))
        + bit(0, 6) - bit(0, 7);
    (x, y)
}

fn read_dst(bytes: &[u8], record: &mut impl FnMut(Command, i32, i32)) -> Result<(), &'static str> {
    let body = bytes.get(512..).ok_or("DST header is incomplete.")?;
    let mut trim_remaining = 0;
    for (step, raw) in body.chunks_exact(3).enumerate() {
        let (dx, dy) = dst_delta(raw);
        match raw[2] & 0xf3 {
            0xf3 => {
                record(Command::End, 0, 0);
                return Ok(());
            }
            0xc3 => record(Command::ColorChange, dx, dy),
            control if control & 0x80 != 0 => {
                if trim_remaining == 0 && (dx, dy) == (2, 2) {
                    let tail = body.get((step + 1) * 3..(step + 3) * 3);
                    if tail.is_some_and(|records| {
                        records.chunks_exact(3).zip([(-4, -4), (2, 2)]).all(|(next, displacement)| {
                            next[2] & 0xc3 == 0x83 && dst_delta(next) == displacement
                        })
                    }) {
                        trim_remaining = 3;
                    }
                }
                let command = if trim_remaining > 0 {
                    trim_remaining -= 1;
                    Command::TrimJump
                } else {
                    Command::Jump
                };
                record(command, dx, dy);
            }
            _ => record(Command::Stitch, dx, dy),
        }
    }
    Err("DST records are missing their end marker.")
}

fn read_pes(bytes: &[u8], record: &mut impl FnMut(Command, i32, i32)) -> Result<(), &'static str> {
    let pointer = bytes.get(8..12).ok_or("PES header is incomplete.")?;
    let pec = u32::from_le_bytes(pointer.try_into().unwrap()) as usize;
    let block = pec.checked_add(512).and_then(|offset| bytes.get(offset..)).ok_or("PES has no PEC stitch block.")?;
    let size = block.get(2..5).ok_or("PEC stitch header is incomplete.")?;
    let length = usize::from(size[0]) | usize::from(size[1]) << 8 | usize::from(size[2]) << 16;
    let mut data = block.get(16..length).ok_or("PEC stitch records are incomplete.")?;
    while let Some(&first) = data.first() {
        if first == 0xff {
            record(Command::End, 0, 0);
            return Ok(());
        }
        if data.starts_with(&[0xfe, 0xb0]) {
            data = data.get(3..).ok_or("PEC color change record is incomplete.")?;
            record(Command::ColorChange, 0, 0);
            continue;
        }
        let (dx, x_flag, rest) = pec_axis(data)?;
        let (dy, y_flag, rest) = pec_axis(rest)?;
        data = rest;
        let flags = x_flag | y_flag;
        let command = if flags & 0x20 != 0 {
            Command::TrimJump
        } else if flags & 0x10 != 0 {
            Command::Jump
        } else {
            Command::Stitch
        };
        record(command, dx, dy);
    }
    Err("PEC records are missing their end marker.")
}

fn pec_axis(data: &[u8]) -> Result<(i32, u8, &[u8]), &'static str> {
    match data {
        [axis, rest @ ..] if axis & 0x80 == 0 => {
            let signed = (i32::from(*axis) ^ 0x40) - 0x40;
            Ok((signed, 0, rest))
        }
        [high, low, rest @ ..] => {
            let value = i32::from(*high & 0x0f) << 8 | i32::from(*low);
            Ok(((value ^ 0x800) - 0x800, *high & 0x30, rest))
        }
        _ => Err("PEC movement record is incomplete."),
    }
}
