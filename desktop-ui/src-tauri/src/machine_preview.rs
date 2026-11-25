#[path = "machine_records.rs"]
mod machine_records;

use crate::{Workspace, validate_export};
use std::sync::Mutex;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MachinePreview {
    total: usize,
    stitches: usize,
    jumps: usize,
    trim_jumps: usize,
    color_changes: usize,
    records: Vec<MachineRecord>,
}

#[derive(serde::Serialize)]
struct MachineRecord {
    command: &'static str,
    x: f64,
    y: f64,
    thread: usize,
}

#[tauri::command]
pub(crate) async fn preview_machine_commands(
    format: String,
    width: f64,
    height: f64,
    offset: usize,
    state: tauri::State<'_, Mutex<Workspace>>,
) -> Result<MachinePreview, String> {
    if !matches!(format.as_str(), "dst" | "pes") {
        return Err("Machine command preview is available for DST and PES.".into());
    }
    let design = state.lock().map_err(|err| err.to_string())?.current.clone().ok_or("Open artwork first")?;
    tauri::async_runtime::spawn_blocking(move || {
        validate_export(&design, &format, width, height)?;
        let bytes = zigzag::formats::write_format(&design, &format).map_err(|err| err.to_string())?;
        let inspected = machine_records::inspect(&bytes, &format, offset, 10).map_err(str::to_owned)?;
        Ok(MachinePreview {
            total: inspected.total,
            stitches: inspected.stitches,
            jumps: inspected.jumps,
            trim_jumps: inspected.trim_jumps,
            color_changes: inspected.color_changes,
            records: inspected.records.into_iter().map(|record| MachineRecord {
                command: if format == "pes" && record.command == machine_records::Command::TrimJump {
                    "Trim-flag jump"
                } else {
                    record.command.label()
                },
                x: f64::from(record.x) / 10.0,
                y: f64::from(record.y) / 10.0,
                thread: record.thread,
            }).collect(),
        })
    }).await.map_err(|err| err.to_string())?
}
