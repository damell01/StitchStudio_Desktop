#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::sync::Mutex;
use zigzag::{design::Design, formats};
#[derive(serde::Serialize)]
struct Preview { name: String, blocks: Vec<PreviewBlock>, stitches: usize, trims: usize }
#[derive(serde::Serialize)]
struct PreviewBlock { color: [u8;3], runs: Vec<Vec<[f64;2]>> }
#[tauri::command]
async fn open_svg(width_mm: f64, colors: u32, remove_background: bool, detail: f64, state: tauri::State<'_, Mutex<Option<Design>>>) -> Result<Option<Preview>, String> {
    let Some(path) = rfd::AsyncFileDialog::new().add_filter("Artwork and embroidery", &["svg","png","jpg","jpeg","webp","gif","bmp","tiff","dst","pes","pec","exp","jef"]).pick_file().await else { return Ok(None); };
    let path = path.path().to_owned();
    let design = tauri::async_runtime::spawn_blocking(move || -> Result<Design,String> {
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
        let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Design");
        if ext == "svg" { return zigzag::design_from_svg(&path).map_err(|e| e.to_string()); }
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        let svg = if zigzag::trace::is_image(&ext) {
            let options = zigzag::trace::TraceOptions { width_mm, colors, remove_background, detail, ..Default::default() };
            zigzag::trace::trace_bytes(&bytes, &options).map_err(|e| e.to_string())?.svg
        } else {
            let file = formats::read::read_stitch_file(&bytes, &ext).map_err(|e| e.to_string())?;
            if file.blocks.is_empty() { return Err("No stitches found".into()); }
            formats::read::to_svg(&file)
        };
        Ok(zigzag::document::Document::from_svg(&svg, name, None).map_err(|e| e.to_string())?.plan())
    }).await.map_err(|e| e.to_string())??;
    if design.blocks.is_empty() { return Err("No stitchable objects found".into()); }
    let preview = Preview { name: design.name.clone(), stitches: design.blocks.iter().flat_map(|b| &b.runs).map(|r| r.pts.len()).sum(), trims: design.blocks.iter().flat_map(|b| &b.runs).filter(|r| r.trim_before).count(), blocks: design.blocks.iter().map(|b| PreviewBlock { color:b.color, runs:b.runs.iter().map(|r| r.pts.iter().map(|p| [p.x/10.0,p.y/10.0]).collect()).collect() }).collect() };
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
