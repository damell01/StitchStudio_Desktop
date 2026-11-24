#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::sync::Mutex;
use zigzag::{design::Design, formats};
#[derive(serde::Serialize)]
struct Preview { name: String, blocks: Vec<PreviewBlock>, stitches: usize, trims: usize }
#[derive(serde::Serialize)]
struct PreviewBlock { color: [u8;3], runs: Vec<Vec<[f64;2]>> }
#[tauri::command]
async fn open_svg(state: tauri::State<'_, Mutex<Option<Design>>>) -> Result<Option<Preview>, String> {
    let Some(path) = rfd::AsyncFileDialog::new().add_filter("SVG artwork", &["svg"]).pick_file().await else { return Ok(None); };
    let design = zigzag::design_from_svg(path.path()).map_err(|e| e.to_string())?;
    let preview = Preview { name: design.name.clone(), stitches: design.stitch_count(), trims: design.trim_count(), blocks: design.blocks.iter().map(|b| PreviewBlock { color:b.color, runs:b.runs.iter().map(|r| r.pts.iter().map(|p| [p.x/10.0,p.y/10.0]).collect()).collect() }).collect() };
    *state.lock().map_err(|e| e.to_string())? = Some(design);
    Ok(Some(preview))
}
#[tauri::command]
async fn export_design(format: String, state: tauri::State<'_, Mutex<Option<Design>>>) -> Result<bool,String> {
    let bytes = { let guard = state.lock().map_err(|e| e.to_string())?; let d = guard.as_ref().ok_or("Open artwork first")?; formats::write_format(d,&format).map_err(|e|e.to_string())? };
    let Some(path) = rfd::AsyncFileDialog::new().add_filter("Embroidery", &[format.as_str()]).set_file_name(format!("design.{format}")).save_file().await else {return Ok(false)};
    std::fs::write(path.path(),bytes).map_err(|e|e.to_string())?;
    Ok(true)
}
fn main(){tauri::Builder::default().manage(Mutex::new(None::<Design>)).invoke_handler(tauri::generate_handler![open_svg,export_design]).run(tauri::generate_context!()).expect("Stitch Studio failed to launch");}
