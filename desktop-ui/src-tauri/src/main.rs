#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod machine_preview;
mod lettering_edit;
mod project_recovery;
mod design_archive;
mod saved_templates;
mod starter_designs;
mod fabric_profiles;
mod specialty;
mod thread_recolor;
use std::sync::Mutex;
#[derive(Default)]
struct Workspace { plan_cache: zigzag::design::PlanCache, digitizer_draft: Option<DigitizerDraft>, next_draft_id: u64, source: Option<zigzag::document::Document>, current: Option<Design>, undo: Vec<(Design,Option<zigzag::document::Document>)>, redo: Vec<(Design,Option<zigzag::document::Document>)> }
impl Workspace { fn checkpoint(&mut self) { if let Some(d)=self.current.clone(){self.undo.push((d,self.source.clone()));if self.undo.len()>20{self.undo.remove(0);}self.redo.clear();} } }
use zigzag::{design::Design, formats};
#[derive(serde::Serialize)]
struct Preview { name: String, blocks: Vec<PreviewBlock>, stitches: usize, trims: usize }
#[derive(serde::Serialize)]
struct PreviewBlock { color: [u8;3], runs: Vec<Vec<[f64;2]>> }
fn preview(design: &Design) -> Preview { Preview { name: design.name.clone(), stitches: design.blocks.iter().flat_map(|b| &b.runs).map(|r| r.pts.len()).sum(), trims: design.blocks.iter().flat_map(|b| &b.runs).filter(|r| r.trim_before).count(), blocks: design.blocks.iter().map(|b| PreviewBlock { color:b.color, runs:b.runs.iter().map(|r| r.pts.iter().map(|p| [p.x/10.0,p.y/10.0]).collect()).collect() }).collect() } }
#[tauri::command]
async fn transform_design(scale: f64, rotation: f64, dx: f64, dy: f64, app: tauri::AppHandle) -> Result<Preview,String> {
    if ![scale,rotation,dx,dy].iter().all(|v| v.is_finite()) || !(0.1..=10.0).contains(&scale) || dx.abs()>500.0 || dy.abs()>500.0 { return Err("Invalid transformation".into()); }
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
    let state=app.state::<Mutex<Workspace>>();
    let mut guard=state.lock().map_err(|e|e.to_string())?;
    // Translation preserves the stitch geometry and sequence; no replanning needed.
    if scale==1.0 && rotation==0.0 {return place_design(&mut guard,[1.0,0.0,0.0,1.0,dx*10.0,dy*10.0]);}
    let (s,c)=rotation.to_radians().sin_cos();
    if let Some(mut doc)=guard.source.clone(){
        let indices:Vec<usize>=(0..doc.shapes.len()).collect();
        doc.transform(&indices,[scale*c,scale*s,-scale*s,scale*c,dx*10.0,dy*10.0]).map_err(|e|e.to_string())?;
        let design=doc.plan();if design.blocks.is_empty(){return Err("Transformation produced no stitches".into())}
        let p=preview(&design);guard.checkpoint();guard.current=Some(design);guard.source=Some(doc);return Ok(p)
    }
    if guard.current.is_none(){return Err("Open artwork first".into())}
    guard.checkpoint();
    let d=guard.current.as_mut().ok_or("Open artwork first")?;
    for p in d.blocks.iter_mut().flat_map(|b| &mut b.runs).flat_map(|r| &mut r.pts) {
        let (x,y)=(p.x,p.y);
        p.x=scale*(x*c-y*s)+dx*10.0;
        p.y=scale*(x*s+y*c)+dy*10.0;
    }
    Ok(preview(d))
    }).await.map_err(|e|e.to_string())?
}
#[derive(serde::Serialize)]
struct StitchAudit {
    short: usize,
    long: usize,
    zero: usize,
    segments: usize,
    sewn_mm: f64,
}

fn measure_stitches(design: &Design) -> StitchAudit {
    let mut audit = StitchAudit { short: 0, long: 0, zero: 0, segments: 0, sewn_mm: 0.0 };
    for run in design.blocks.iter().flat_map(|block| &block.runs) {
        for pair in run.pts.windows(2) {
            let mm = (pair[1].x - pair[0].x).hypot(pair[1].y - pair[0].y) / 10.0;
            audit.segments += 1;
            audit.sewn_mm += mm;
            if mm < 0.05 { audit.zero += 1; }
            else if mm < 0.3 { audit.short += 1; }
            if mm > 12.0 { audit.long += 1; }
        }
    }
    audit
}

#[tauri::command]
fn audit_stitches(state: tauri::State<'_, Mutex<Workspace>>) -> Result<StitchAudit, String> {
    let workspace = state.lock().map_err(|err| err.to_string())?;
    Ok(measure_stitches(workspace.current.as_ref().ok_or("Open artwork first")?))
}
#[tauri::command]
fn repair_stitches(state:tauri::State<'_,Mutex<Workspace>>)->Result<Preview,String>{
 let mut w=state.lock().map_err(|e|e.to_string())?;
 let mut d=w.current.clone().ok_or("Open artwork first")?;
 let mut total=0usize;
 for run in d.blocks.iter_mut().flat_map(|b|&mut b.runs){
   let mut out=Vec::with_capacity(run.pts.len());
   for p in run.pts.iter().copied(){
     if let Some(last)=out.last().copied(){
       let last:zigzag::geom::P=last;
       let distance=(p.x-last.x).hypot(p.y-last.y);
       if distance==0.0{continue}
       let n=(distance/100.0).ceil().max(1.0);
       if !n.is_finite()||n>10000.0{return Err("Invalid stitch geometry".into())}
       for k in 1..n as usize{let t=k as f64/n;out.push(zigzag::geom::P::new(last.x+(p.x-last.x)*t,last.y+(p.y-last.y)*t));}
     }
     out.push(p);
     if out.len()>2000000{return Err("Repair exceeds stitch limit".into())}
   }
   total+=out.len();if total>2000000{return Err("Repair exceeds stitch limit".into())}
   run.pts=out;
 }
 w.checkpoint();w.source=None;let result=preview(&d);w.current=Some(d);Ok(result)
}
fn place_design(workspace: &mut Workspace, matrix: [f64; 6]) -> Result<Preview, String> {
    let [a, b, c, d, tx, ty] = matrix;
    let apply = |point: &mut zigzag::geom::P| {
        *point = zigzag::geom::P::new(a * point.x + c * point.y + tx, b * point.x + d * point.y + ty);
    };
    let mut design = workspace.current.clone().ok_or("Open artwork first")?;
    let mut source = workspace.source.clone();
    if let Some(document) = &mut source {
        let indices: Vec<_> = (0..document.shapes.len()).collect();
        document.transform(&indices, matrix).map_err(|err| err.to_string())?;
    }
    // Centering and mirroring preserve every stitch and command.
    for point in design.blocks.iter_mut().flat_map(|block| &mut block.runs).flat_map(|run| &mut run.pts) {
        apply(point);
    }
    let result = preview(&design);
    workspace.checkpoint();
    workspace.current = Some(design);
    workspace.source = source;
    Ok(result)
}

#[tauri::command]
fn center_design(state: tauri::State<'_, Mutex<Workspace>>) -> Result<Preview, String> {
    let mut workspace = state.lock().map_err(|err| err.to_string())?;
    let bounds = workspace.current.as_ref().ok_or("Open artwork first")?.bounds();
    if bounds.is_empty() { return Err("No stitches to center".into()); }
    let center = bounds.center();
    place_design(&mut workspace, [1.0, 0.0, 0.0, 1.0, -center.x, -center.y])
}

#[tauri::command]
fn mirror_design(horizontal: bool, state: tauri::State<'_, Mutex<Workspace>>) -> Result<Preview, String> {
    let mut workspace = state.lock().map_err(|err| err.to_string())?;
    let (x, y) = if horizontal { (-1.0, 1.0) } else { (1.0, -1.0) };
    place_design(&mut workspace, [x, 0.0, 0.0, y, 0.0, 0.0])
}
#[tauri::command]
async fn recolor_block(index: usize, color: [u8; 3], app: tauri::AppHandle) -> Result<Preview, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let mut workspace = state.lock().map_err(|err| err.to_string())?;
        thread_recolor::apply(&mut workspace, index, color)
    }).await.map_err(|err| err.to_string())?
}
#[tauri::command]
async fn replace_design_color(previous:[u8;3],color:[u8;3],app:tauri::AppHandle)->Result<Preview,String>{
 use tauri::Manager;
 tauri::async_runtime::spawn_blocking(move||{let state=app.state::<Mutex<Workspace>>();let mut w=state.lock().map_err(|e|e.to_string())?;thread_recolor::replace_color(&mut w,previous,color)}).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn center_design_axis(horizontal:bool,state:tauri::State<'_,Mutex<Workspace>>)->Result<Preview,String>{
 let mut w=state.lock().map_err(|e|e.to_string())?;let bounds=w.current.as_ref().ok_or("Open artwork first")?.bounds();if bounds.is_empty(){return Err("No stitches to center".into())}let c=bounds.center();
 place_design(&mut w,[1.0,0.0,0.0,1.0,if horizontal{-c.x}else{0.0},if horizontal{0.0}else{-c.y}])
}
#[tauri::command]
async fn apply_reference_colors(original:Vec<[u8;3]>,colors:Vec<[u8;3]>,app:tauri::AppHandle)->Result<Preview,String>{
 use tauri::Manager;
 tauri::async_runtime::spawn_blocking(move||{let state=app.state::<Mutex<Workspace>>();let mut w=state.lock().map_err(|e|e.to_string())?;thread_recolor::map_blocks(&mut w,&original,&colors)}).await.map_err(|e|e.to_string())?
}
fn load_design_document(
    path: &std::path::Path,
    options: &zigzag::trace::TraceOptions,
) -> Result<zigzag::document::Document, String> {
    if std::fs::metadata(path).map_err(|err| err.to_string())?.len() > 20_000_000 {
        return Err("Design exceeds 20 MB".into());
    }
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Design");
    if ext == "svg" { return zigzag::document::Document::open(path).map_err(|e| e.to_string()); }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if zigzag::trace::is_image(&ext) {
        if !(5.0..=300.0).contains(&options.width_mm) || !(0.0..=100.0).contains(&options.detail) {
            return Err("Choose an artwork width between 5 and 300 mm and detail between 0 and 100".into());
        }
        return zigzag::trace::digitize_raster(&bytes, name, options, 32, false).map_err(|err| err.to_string());
    }
    let file = formats::read::read_stitch_file(&bytes, &ext).map_err(|err| err.to_string())?;
    if file.blocks.is_empty() { return Err("No stitches found".into()); }
    let svg = formats::read::to_svg(&file);
    zigzag::document::Document::from_svg(&svg, name, None).map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_svg(width_mm: f64, colors: u32, remove_background: bool, detail: f64, state: tauri::State<'_, Mutex<Workspace>>) -> Result<Option<Preview>, String> {
    let Some(path) = rfd::AsyncFileDialog::new().add_filter("Artwork and embroidery", &["svg","png","jpg","jpeg","webp","gif","bmp","tiff","tif","dst","pes","pec","exp","jef"]).pick_file().await else { return Ok(None); };
    let path = path.path().to_owned();
    let (source, design) = tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
        let options = zigzag::trace::TraceOptions { width_mm, colors, remove_background, detail, ..Default::default() };
        let source = load_design_document(&path, &options)?;
        let design = source.plan();
        if design.stitch_count() == 0 { return Err("No stitchable objects found".into()); }
        Ok((source, design))
    }).await.map_err(|e| e.to_string())??;
    let preview = preview(&design);
    *state.lock().map_err(|e| e.to_string())? = Workspace {source:Some(source),current:Some(design),..Default::default()};
    Ok(Some(preview))
}
fn validate_export(design: &Design, format: &str, width: f64, height: f64) -> Result<(), String> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err("Invalid hoop dimensions".into());
    }
    if !formats::MACHINE_FORMATS.iter().any(|(ext, _)| *ext == format) {
        return Err("Choose a supported embroidery format".into());
    }
    if design.stitch_count() == 0 { return Err("There are no stitches to export".into()); }
    if matches!(format, "pec" | "pes") && design.blocks.len() > 256 {
        return Err("PES and PEC can store up to 256 color blocks".into());
    }
    if format == "dst" && design.blocks.len() > 1000 {
        return Err("DST can store up to 999 color changes in its header".into());
    }
    let fits = |x: f64, y: f64| x.is_finite() && y.is_finite()
        && x.abs() <= width * 5.0 && y.abs() <= height * 5.0;
    let outside = design.blocks.iter().flat_map(|block| &block.runs).flat_map(|run| &run.pts)
        .any(|point| !fits(point.x, point.y) || !fits(point.x.round(), point.y.round()));
    if outside { return Err("Design exceeds the selected hoop after coordinate rounding".into()); }
    // Validate generated tie stitches and split moves, not just source points.
    let encoded_stream = match format {
        "dst" => Some(formats::dst::stream(design)),
        "pes" | "pec" => Some(formats::pes::stream(design)),
        "exp" | "jef" => Some(formats::commands(design, &formats::StreamOptions { ties: true, max_step: 127.0 })),
        "vp3" => Some(formats::commands(design, &formats::StreamOptions { ties: true, max_step: 255.0 })),
        _ => None,
    };
    if encoded_stream.as_ref().is_some_and(|stream|stream.iter().any(|command|!fits(command.x,command.y))) {
        return Err("Generated machine movements exceed the selected hoop. Move the design away from the edge.".into());
    }
    if format == "dst" {
        let trim_outside = formats::dst::stream(design).into_iter()
            .filter(|command| command.op == formats::Op::Trim)
            .any(|command| !fits(command.x + 2.0, command.y + 2.0)
                || !fits(command.x - 2.0, command.y - 2.0));
        if trim_outside {
            return Err("A DST trim exceeds the selected hoop. Move the design away from the edge.".into());
        }
    }
    Ok(())
}

fn export_escape(s: &str) -> String { s.replace('&',"&amp;").replace('<',"&lt;").replace('>',"&gt;").replace('"',"&quot;").replace('\'',"&#39;") }
fn export_companions(design:&Design,format:&str,width:f64,height:f64,assignments:&std::collections::HashMap<String,String>) -> (String,String) {
    use std::fmt::Write;
    let mut left=f64::INFINITY;let mut top=f64::INFINITY;let mut right=f64::NEG_INFINITY;let mut bottom=f64::NEG_INFINITY;
    for p in design.blocks.iter().flat_map(|b|&b.runs).flat_map(|r|&r.pts) {left=left.min(p.x);top=top.min(p.y);right=right.max(p.x);bottom=bottom.max(p.y);}
    let pad=10.0;let w=(right-left).max(1.0)+2.0*pad;let h=(bottom-top).max(1.0)+2.0*pad;
    let mut svg=format!(r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="{} {} {} {}" width="800" height="600" role="img"><rect x="{}" y="{}" width="{}" height="{}" fill="#f8f5ef"/>"##,left-pad,top-pad,w,h,left-pad,top-pad,w,h);
    let mut rows=String::new();
    for (i,b) in design.blocks.iter().enumerate() {
        let color=format!("#{:02X}{:02X}{:02X}",b.color[0],b.color[1],b.color[2]);
        let count:usize=b.runs.iter().map(|r|r.pts.len()).sum();
        let label=assignments.get(&i.to_string()).map(String::as_str).unwrap_or("Not assigned");
        let _=write!(rows,"<tr><td>{}</td><td><span style='background:{}'></span> {}</td><td>{}</td><td>{}</td></tr>",i+1,color,color,export_escape(label),count);
        for run in &b.runs {
            if run.pts.len()<2 {continue;}
            let _=write!(svg,"<polyline fill='none' stroke='{}' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' points='",color);
            for p in &run.pts {let _=write!(svg,"{:.1},{:.1} ",p.x,p.y);}
            svg.push_str("'/>");
        }
    }
    svg.push_str("</svg>");
    let html=format!("<!doctype html><html lang='en'><meta charset='utf-8'><title>Stitch Studio color sequence</title><style>body{{font:15px system-ui;color:#28213a;margin:28px}}svg{{width:260px;height:195px}}table{{border-collapse:collapse;width:100%}}td,th{{text-align:left;padding:8px;border-bottom:1px solid #ddd}}td span{{display:inline-block;width:20px;height:20px;border:1px solid #555;vertical-align:middle}}@media print{{body{{margin:12mm}}*{{print-color-adjust:exact;-webkit-print-color-adjust:exact}}}}</style><h1>{}</h1><h2>Color sequence &amp; machine setup</h2><p>{} · Hoop {} × {} mm</p>{}<p>{}</p><table><thead><tr><th>Block</th><th>Design color</th><th>Needle / spool</th><th>Planned points</th></tr></thead><tbody>{}</tbody></table><p>Verify actual spool labels, machine stops and placement. Test sew before production.</p></html>",export_escape(&design.name),export_escape(&format.to_uppercase()),width,height,svg,if format.eq_ignore_ascii_case("dst"){"DST stores color-change positions, not exact colors. Assign the listed threads manually on the machine."}else{"Verify machine color assignments against this sequence."},rows);
    (html,svg)
}
#[tauri::command]
async fn export_design(format: String, width: f64, height: f64, companions: Option<bool>, assignments: Option<std::collections::HashMap<String,String>>, sheet_png: Option<Vec<u8>>, preview_png: Option<Vec<u8>>, state: tauri::State<'_, Mutex<Workspace>>) -> Result<bool, String> {
    for png in [&sheet_png,&preview_png].into_iter().flatten() {
        if png.len()>32_000_000 || !png.starts_with(b"\x89PNG\r\n\x1a\n") {return Err("Invalid or oversized companion PNG".into());}
    }
    let design = state.lock().map_err(|err| err.to_string())?.current.clone().ok_or("Open artwork first")?;
    let companion_data=if companions.unwrap_or(false){Some(export_companions(&design,&format,width,height,&assignments.unwrap_or_default()))}else{None};
    let encode_format = format.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        validate_export(&design, &encode_format, width, height)?;
        formats::write_format(&design, &encode_format).map_err(|err| err.to_string())
    }).await.map_err(|err| err.to_string())??;
    let Some(path) = rfd::AsyncFileDialog::new().add_filter("Embroidery", &[format.as_str()])
        .set_file_name(format!("design.{format}")).save_file().await else { return Ok(false); };
    let mut path = path.path().to_owned();
    match path.extension().and_then(|ext| ext.to_str()) {
        None => { path.set_extension(&format); }
        Some(ext) if ext.eq_ignore_ascii_case(&format) => {}
        Some(_) => return Err(format!("Use a .{format} filename for this export")),
    };
    tauri::async_runtime::spawn_blocking(move || -> Result<(),String> {
        let sheet=path.with_extension(format!("{}.colors.html",format));
        let image=path.with_extension(format!("{}.preview.svg",format));
        let sheet_image=path.with_extension(format!("{}.colors.png",format));
        let preview_image=path.with_extension(format!("{}.preview.png",format));
        if (sheet_png.is_some()&&sheet_image.exists())||(preview_png.is_some()&&preview_image.exists()){return Err("Companion PNG files already exist. Choose a new export name.".into());}
        if companion_data.is_some() && (sheet.exists()||image.exists()) {return Err("Companion files already exist. Choose a new export name to avoid overwriting them.".into());}
        std::fs::write(&path,bytes).map_err(|e|e.to_string())?;
        for (target,data) in [(sheet_image,sheet_png),(preview_image,preview_png)] {if let Some(data)=data {use std::io::Write;let mut f=std::fs::OpenOptions::new().write(true).create_new(true).open(target).map_err(|e|format!("Embroidery saved; PNG failed: {e}"))?;f.write_all(&data).map_err(|e|format!("Embroidery saved; PNG failed: {e}"))?;}}
        if let Some((html,svg))=companion_data {
            use std::io::Write;
            let mut f=std::fs::OpenOptions::new().write(true).create_new(true).open(sheet).map_err(|e|format!("Embroidery saved; color sheet failed: {e}"))?;
            f.write_all(html.as_bytes()).map_err(|e|format!("Embroidery saved; color sheet failed: {e}"))?;
            let mut f=std::fs::OpenOptions::new().write(true).create_new(true).open(image).map_err(|e|format!("Embroidery saved; preview failed: {e}"))?;
            f.write_all(svg.as_bytes()).map_err(|e|format!("Embroidery saved; preview failed: {e}"))?;
        }
        Ok(())
    }).await.map_err(|e|e.to_string())??;
    Ok(true)
}

#[tauri::command]
fn current_preview(state:tauri::State<'_,Mutex<Workspace>>) -> Result<Option<Preview>,String> {
 Ok(state.lock().map_err(|e|e.to_string())?.current.as_ref().map(preview))
}
#[tauri::command]
fn history_step(redo:bool,state:tauri::State<'_,Mutex<Workspace>>) -> Result<Preview,String> {
 let mut w=state.lock().map_err(|e|e.to_string())?;
 let next=if redo {w.redo.pop()} else {w.undo.pop()}.ok_or("No more history")?;
 let (design,source)=next;
 let previous_source=std::mem::replace(&mut w.source,source);
 if let Some(old)=w.current.replace(design){if redo {w.undo.push((old,previous_source))}else{w.redo.push((old,previous_source))}}
 Ok(preview(w.current.as_ref().ok_or("No design")?))
}
const MAX_PROJECT_BYTES: u64 = 100_000_000;

#[derive(serde::Serialize, serde::Deserialize)]
struct Project {
    #[serde(default)]
    thread_assignments: std::collections::HashMap<String,String>,
    #[serde(default)]
    source_svg: Option<String>,
    #[serde(default)]
    source_offset: Option<[f64; 2]>,
    version: u32,
    name: String,
    width: f64,
    height: f64,
    format: String,
    blocks: Vec<ProjectBlock>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ProjectBlock {
    color: [u8; 3],
    runs: Vec<ProjectRun>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ProjectRun {
    points: Vec<[f64; 2]>,
    trim_before: bool,
}

#[derive(serde::Serialize)]
struct OpenedProject { plan: Preview, width: f64, height: f64, format: String, thread_assignments: std::collections::HashMap<String,String> }

impl Project {
    fn capture(workspace: &Workspace, width: f64, height: f64, format: String) -> Result<Option<Self>, String> {
        let Some(design) = &workspace.current else { return Ok(None); };
        let source = workspace.source.as_ref();
        Ok(Some(Self {
            thread_assignments: Default::default(),
            source_svg: source.map(|document| document.to_svg()).transpose().map_err(|err| err.to_string())?,
            source_offset: source.map(|document| [document.offset.x, document.offset.y]),
            version: 1,
            name: design.name.clone(),
            width,
            height,
            format,
            blocks: design.blocks.iter().map(|block| ProjectBlock {
                color: block.color,
                runs: block.runs.iter().map(|run| ProjectRun {
                    points: run.pts.iter().map(|point| [point.x, point.y]).collect(),
                    trim_before: run.trim_before,
                }).collect(),
            }).collect(),
        }))
    }

    fn load(path: &std::path::Path) -> Result<Self, String> {
        use std::io::Read;
        let file = std::fs::File::open(path).map_err(|err| err.to_string())?;
        let mut bytes = Vec::new();
        file.take(MAX_PROJECT_BYTES + 1).read_to_end(&mut bytes).map_err(|err| err.to_string())?;
        if bytes.len() as u64 > MAX_PROJECT_BYTES { return Err("Project exceeds size limit".into()); }
        serde_json::from_slice(&bytes).map_err(|err| err.to_string())
    }

    fn validate(&self) -> Result<Option<zigzag::document::Document>, String> {
        if self.version != 1
            || !self.width.is_finite() || !self.height.is_finite()
            || self.width <= 0.0 || self.height <= 0.0
            || !["dst", "pes", "jef", "exp", "vp3", "pec"].contains(&self.format.as_str())
            || self.source_offset.is_some_and(|offset| offset.iter().any(|v| !v.is_finite() || v.abs() > 1_000_000.0))
        {
            return Err("Invalid project settings".into());
        }
        let runs = self.blocks.iter().flat_map(|block| &block.runs);
        let count: usize = runs.clone().map(|run| run.points.len()).sum();
        if !(1..=2_000_000).contains(&count)
            || runs.flat_map(|run| &run.points).flatten().any(|v| !v.is_finite() || v.abs() > 1_000_000.0)
        {
            return Err("Invalid project stitch data".into());
        }
        let source = self.source_svg.as_ref().map(|svg| match self.source_offset {
            Some([x, y]) => zigzag::document::Document::restore_svg(svg, &self.name, zigzag::geom::P::new(x, y)),
            None => zigzag::document::Document::from_svg(svg, &self.name, None),
        }).transpose().map_err(|err| err.to_string())?;
        Ok(source)
    }

    fn restore(self, state: &Mutex<Workspace>) -> Result<OpenedProject, String> {
        let source = self.validate()?;
        let design = Design {
            name: self.name,
            blocks: self.blocks.into_iter().map(|block| zigzag::design::Block {
                color: block.color,
                runs: block.runs.into_iter().map(|run| zigzag::design::Run {
                    pts: run.points.into_iter().map(|[x, y]| zigzag::geom::P::new(x, y)).collect(),
                    trim_before: run.trim_before,
                }).collect(),
            }).collect(),
            ..Default::default()
        };
        let result = OpenedProject { plan: preview(&design), width: self.width, height: self.height, format: self.format, thread_assignments: self.thread_assignments };
        *state.lock().map_err(|err| err.to_string())? = Workspace { source, current: Some(design), ..Default::default() };
        Ok(result)
    }
}

fn write_project(path: &std::path::Path, project: &Project) -> Result<(), String> {
    use std::io::Write;
    let bytes = serde_json::to_vec(project).map_err(|err| err.to_string())?;
    if bytes.len() as u64 > MAX_PROJECT_BYTES { return Err("Project exceeds size limit".into()); }
    let directory = path.parent().ok_or("Project must have a parent directory")?;
    let mut temp = tempfile::NamedTempFile::new_in(directory).map_err(|err| err.to_string())?;
    temp.write_all(&bytes).map_err(|err| err.to_string())?;
    temp.as_file().sync_all().map_err(|err| err.to_string())?;
    temp.persist(path).map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
async fn save_project(width: f64, height: f64, format: String, thread_assignments: Option<std::collections::HashMap<String,String>>, state: tauri::State<'_, Mutex<Workspace>>) -> Result<Option<LibraryEntry>, String> {
    let Some(path) = rfd::AsyncFileDialog::new().add_filter("Stitch Studio project", &["stitchstudio"])
        .set_file_name("design.stitchstudio").save_file().await else { return Ok(None); };
    let path = path.path().to_owned();
    if !path.extension().and_then(|value| value.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("stitchstudio")) {
        return Err("Save the project with the .stitchstudio extension".into());
    }
    let mut project = {
        let workspace = state.lock().map_err(|err| err.to_string())?;
        Project::capture(&workspace, width, height, format)?.ok_or("No design")?
    };
    project.thread_assignments = thread_assignments.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        write_project(&path, &project)?;
        Ok(Some(LibraryEntry { file:path.to_string_lossy().into_owned(), name:project.name, stitches:project.blocks.iter().flat_map(|b|&b.runs).map(|r|r.points.len()).sum(), colors:project.blocks.len(), width:project.width,height:project.height,modified:std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() }))
    }).await.map_err(|err| err.to_string())?
}

#[tauri::command]
async fn open_project(state: tauri::State<'_, Mutex<Workspace>>) -> Result<Option<OpenedProject>, String> {
    let Some(path) = rfd::AsyncFileDialog::new().add_filter("Stitch Studio project", &["stitchstudio"])
        .pick_file().await else { return Ok(None); };
    open_project_path(path.path(), &state).map(Some)
}

fn open_project_path(path: &std::path::Path, state: &Mutex<Workspace>) -> Result<OpenedProject, String> {
    Project::load(path)?.restore(state)
}
mod template_assets;

fn template_svg(id: &str, art: &str, width: f64) -> Result<String, String> {
    if !(5.0..=250.0).contains(&width) { return Err("Invalid template width".into()); }
    if let Some(licensed) = template_assets::twemoji_document(id, width) {
        return Ok(licensed);
    }
    if !["heart","star","leaf","football","bow","mountain","wildflower","sunrise","baseball","anchor","butterfly","laurel","bear","bunny","fox","penguin","dino","whale","ghost","rocket","puppy","mouse","turtle","gingerbread","duck","sailboat","coquette","bluebow","cherrybow","rainbow","cherries","strawberry","unicorn","pumpkin","shell","frame","prairie-flower","spool-mark","pine-patch","sunday-ball"].contains(&id) || art.len() > 4096 || art.contains("href")
        || art.contains("<image") || art.contains("<script")
    {
        return Err("Invalid starter template".into());
    }
    Ok(format!(r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}mm" height="{width}mm" viewBox="0 0 100 100">{art}</svg>"#))
}

#[tauri::command]
async fn preview_template(id: String, art: String, width_mm: f64) -> Result<Preview, String> {
    let svg = template_svg(&id, &art, width_mm)?;
    tauri::async_runtime::spawn_blocking(move || {
        let source = zigzag::document::Document::from_svg(&svg, &id, None).map_err(|err| err.to_string())?;
        let design = source.plan();
        if design.stitch_count() == 0 { return Err("Template contains no stitches".into()); }
        Ok(preview(&design))
    }).await.map_err(|err| err.to_string())?
}

#[tauri::command]
fn load_template(id: String, art: String, state: tauri::State<'_, Mutex<Workspace>>) -> Result<Preview, String> {
    let svg = template_svg(&id, &art, 65.0)?;
    let source = zigzag::document::Document::from_svg(&svg, &id, None).map_err(|err| err.to_string())?;
    let design = source.plan();
    if design.stitch_count() == 0 { return Err("Template contains no stitches".into()); }
    let result = preview(&design);
    let mut workspace = state.lock().map_err(|err| err.to_string())?;
    workspace.checkpoint();
    workspace.current = Some(design);
    workspace.source = Some(source);
    Ok(result)
}

fn personal_design_dir(app:&tauri::AppHandle)->Result<std::path::PathBuf,String>{
 use tauri::Manager;let dir=app.path().app_local_data_dir().map_err(|e|e.to_string())?.join("designs");std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;Ok(dir)
}
#[tauri::command]
fn personal_designs(app:tauri::AppHandle)->Result<Vec<String>,String>{
    let mut names: Vec<_> = std::fs::read_dir(personal_design_dir(&app)?)
        .map_err(|error| error.to_string())?.flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .map(|entry| entry.file_name().to_string_lossy().into_owned()).collect();
    for name in starter_designs::names() {
        if !names.iter().any(|existing| existing.eq_ignore_ascii_case(name)) {
            names.push(name.to_owned());
        }
    }
    names.sort();
    Ok(names)
}
// Read-only library preview: never changes the active workspace.
#[tauri::command]
async fn library_thumbnail(file: String, app: tauri::AppHandle) -> Result<Preview, String> {
    let p = std::path::Path::new(&file);
    if p.components().count()!=1 || !matches!(p.components().next(),Some(std::path::Component::Normal(_))) {
        return Err("Invalid design filename".into());
    }
    let path = personal_design_dir(&app)?.join(p);
    tauri::async_runtime::spawn_blocking(move || {
        let data = if !path.try_exists().map_err(|e|e.to_string())? {
            starter_designs::open(&file).ok_or("Design not found")??
        } else {
            let meta = std::fs::symlink_metadata(&path).map_err(|e|e.to_string())?;
            if !meta.is_file() || meta.len()>20_000_000 { return Err("Invalid design file".into()); }
            let bytes = std::fs::read(&path).map_err(|e|e.to_string())?;
            formats::read::read_stitch_file(&bytes,path.extension().and_then(|v|v.to_str()).unwrap_or("")).map_err(|e|e.to_string())?
        };
        let stitches = data.blocks.iter().flat_map(|b|&b.runs).map(|r|r.len()).sum();
        let blocks = data.blocks.into_iter().map(|b| PreviewBlock {
            color:b.color,
            runs:b.runs.into_iter().map(|r|r.into_iter().map(|p|[p.x/10.0,p.y/10.0]).collect()).collect()
        }).collect();
        Ok(Preview{name:file,blocks,stitches,trims:0})
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
async fn import_design_archive(app: tauri::AppHandle) -> Result<Option<design_archive::Report>, String> {
    let Some(file) = rfd::AsyncFileDialog::new().add_filter("ZIP collection", &["zip"]).pick_file().await else {
        return Ok(None);
    };
    let path = file.path().to_owned();
    let directory = personal_design_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || design_archive::import(&path, &directory, design_archive::Target::Designs))
        .await.map_err(|error| error.to_string())?.map(Some)
}
#[tauri::command]
async fn import_personal_designs(folder:bool,app:tauri::AppHandle)->Result<usize,String>{
 let paths=if folder{let Some(p)=rfd::AsyncFileDialog::new().pick_folder().await else{return Ok(0)};vec![p.path().to_owned()]}else{let Some(p)=rfd::AsyncFileDialog::new().add_filter("Embroidery",&["dst","pes","pec","exp","jef"]).pick_files().await else{return Ok(0)};p.into_iter().map(|p|p.path().to_owned()).collect()};
 let dir=personal_design_dir(&app)?;
 tauri::async_runtime::spawn_blocking(move||->Result<usize,String>{
 let mut stack=paths;let mut count=0;let mut visited=0;
 while let Some(p)=stack.pop(){visited+=1;if visited>50000||count>=2000{break}
 let Ok(meta)=std::fs::symlink_metadata(&p) else{continue};if meta.file_type().is_symlink(){continue}
 if meta.is_dir(){if let Ok(entries)=std::fs::read_dir(&p){stack.extend(entries.flatten().map(|e|e.path()))}continue}
 let ext=p.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase();
 if !meta.is_file()||meta.len()>20_000_000||!["dst","pes","pec","exp","jef"].contains(&ext.as_str()){continue}
 let Ok(bytes)=std::fs::read(&p) else{continue};if formats::read::read_stitch_file(&bytes,&ext).map(|f|f.blocks.is_empty()).unwrap_or(true){continue}
 let stem=p.file_stem().unwrap_or_default().to_string_lossy();
 for n in 0..1000{let name=if n==0{format!("{stem}.{ext}")}else{format!("{stem} ({n}).{ext}")};let dest=dir.join(name);
 match std::fs::OpenOptions::new().write(true).create_new(true).open(&dest){Ok(mut f)=>{use std::io::Write;if let Err(e)=f.write_all(&bytes){let _=std::fs::remove_file(&dest);return Err(e.to_string())}count+=1;break},Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists=>{if std::fs::read(&dest).ok().as_deref()==Some(bytes.as_slice()){break}},Err(e)=>return Err(e.to_string())}
 }}Ok(count)
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn insert_embroidery(x_mm:f64,y_mm:f64,file:Option<String>,app:tauri::AppHandle,state:tauri::State<'_,Mutex<Workspace>>)->Result<Option<Preview>,String>{
 if ![x_mm,y_mm].iter().all(|v|v.is_finite()&&v.abs()<=500.0){return Err("Invalid placement".into())}
 let from_library = file.is_some();
 let path=if let Some(name)=file{let p=std::path::Path::new(&name);if p.components().count()!=1||!matches!(p.components().next(),Some(std::path::Component::Normal(_))){return Err("Invalid design filename".into())}personal_design_dir(&app)?.join(p)}else{let Some(path)=rfd::AsyncFileDialog::new().add_filter("Embroidery designs",&["dst","pes","pec","exp","jef"]).pick_file().await else{return Ok(None)};path.path().to_owned()};
 let (name, svg) = tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
     let bundled = if from_library && !path.try_exists().map_err(|error| error.to_string())? {
         path.file_name().and_then(|name| name.to_str()).and_then(starter_designs::open)
     } else { None };
     let file = if let Some(result) = bundled {
         result?
     } else {
         if std::fs::metadata(&path).map_err(|err| err.to_string())?.len() > 20_000_000 {
             return Err("Design exceeds 20 MB".into());
         }
         let bytes = std::fs::read(&path).map_err(|err| err.to_string())?;
         let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
         formats::read::read_stitch_file(&bytes, ext).map_err(|err| err.to_string())?
     };
     if file.blocks.is_empty() { return Err("No stitches found".into()); }
     let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Imported design").to_owned();
     Ok((name, formats::read::to_svg(&file)))
 }).await.map_err(|err| err.to_string())??;
 let mut workspace = state.lock().map_err(|err| err.to_string())?;
 insert_editable_artwork(&mut workspace, &svg, &name, x_mm, y_mm, false).map(Some)
}

fn editable_base(workspace: &Workspace, name: &str) -> Result<zigzag::document::Document, String> {
    use zigzag::document::Document;
    if let Some(source) = &workspace.source { return Ok(source.clone()); }
    let Some(design) = &workspace.current else {
        let mut document = Document::empty();
        document.name = name.to_string();
        return Ok(document);
    };
    // Earlier native projects may have only a stitch stream. Attach editable
    // artwork only after the recovered manual paths reproduce its commands.
    let file = formats::read::StitchFile {
        name: design.name.clone(),
        blocks: design.blocks.iter().map(|b| formats::read::StitchBlock {
            color: b.color, runs: b.runs.iter().map(|r| r.pts.clone()).collect(),
        }).collect(),
    };
    let mut document = Document::from_svg(&formats::read::to_svg(&file), &design.name, None).map_err(|err| err.to_string())?;
    let placement = design.bounds().min - document.plan().bounds().min;
    let indices: Vec<_> = (0..document.shapes.len()).collect();
    document.transform(&indices, [1.0, 0.0, 0.0, 1.0, placement.x, placement.y]).map_err(|err| err.to_string())?;
    let recovered = document.plan();
    let same_threads = design.blocks.iter().map(|b| b.color).eq(recovered.blocks.iter().map(|b| b.color));
    if !same_threads || formats::dst::write_dst(design) != formats::dst::write_dst(&recovered) {
        return Err("The saved stitches in this older project cannot be reconstructed exactly. Open the original artwork or insert this project’s exported machine file into a new design.".into());
    }
    Ok(document)
}

fn insert_editable_artwork(
    workspace: &mut Workspace, xml: &str, name: &str, x: f64, y: f64, classify: bool,
) -> Result<Preview, String> {
    let mut document = editable_base(workspace, name)?;
    let indices = document.add_svg(xml, zigzag::document::Placement {
        center_mm: Some((x, y)), ..Default::default()
    }).map_err(|err| err.to_string())?;
    if indices.is_empty() { return Err("Artwork contains no editable objects".into()); }
    if classify {
        for index in indices {
            zigzag::design::auto_stitch_types(std::slice::from_mut(&mut document.shapes[index]));
        }
    }
    let design = document.plan();
    if design.stitch_count() == 0 { return Err("Artwork contains no stitches".into()); }
    let result = preview(&design);
    workspace.checkpoint();
    workspace.current = Some(design);
    workspace.source = Some(document);
    Ok(result)
}

#[tauri::command]
fn insert_template(id:String,art:String,width_mm:f64,x_mm:f64,y_mm:f64,state:tauri::State<'_,Mutex<Workspace>>)->Result<Preview,String>{
 if ![x_mm, y_mm].into_iter().all(|value| value.is_finite() && value.abs() <= 500.0) {
     return Err("Invalid template placement".into());
 }
 let svg = template_svg(&id, &art, width_mm)?;
 let mut w=state.lock().map_err(|e|e.to_string())?;
 insert_editable_artwork(&mut w, &svg, &id, x_mm, y_mm, false)
}
#[tauri::command]
fn apply_stitch_properties(uid:Option<usize>,fabric:String,spacing:f64,length:f64,angle:f64,pull:f64,underlay:bool,state:tauri::State<'_,Mutex<Workspace>>) -> Result<Preview,String>{
 if zigzag::params::Fabric::by_id(&fabric).is_none() || ![spacing,length,angle,pull].iter().all(|v|v.is_finite()) || !(0.15..=2.0).contains(&spacing) || !(0.5..=7.0).contains(&length) || !(0.0..=1.0).contains(&pull){return Err("Invalid stitch properties".into())}
 let mut w=state.lock().map_err(|e|e.to_string())?;
 let mut doc=w.source.clone().ok_or("Reimport original artwork to regenerate stitches after stitch-level edits")?;
 if uid.is_none(){doc.settings.fabric=fabric;}
 if let Some(id)=uid{if !doc.shapes.iter().any(|s|s.uid==id){return Err("Object not found".into())}}
 for shape in &mut doc.shapes {if uid.is_some_and(|id|id!=shape.uid){continue}if shape.params.kind==Some(zigzag::params::Kind::Manual){continue}shape.params.spacing=Some(spacing);shape.params.len=Some(length);shape.params.angle=Some(angle);shape.params.pull=Some(pull);shape.params.underlay=Some(underlay);}
 let d=doc.plan();if d.blocks.is_empty(){return Err("No stitches generated".into())}
 let p=preview(&d);w.checkpoint();w.current=Some(d);w.source=Some(doc);Ok(p)
}
#[derive(serde::Serialize)]
struct EditableObject {
    uid: usize,
    groups: Vec<String>,
    label: String,
    color: [u8; 3],
    kind: String,
    bounds: [f64; 4],
    path: String,
    fill_rule: Option<&'static str>,
    stroke_width: f64,
}

fn editable_object(shape: &zigzag::svg::Shape) -> Option<EditableObject> {
    use std::fmt::Write;
    use zigzag::{geom::FillRule, svg::Geometry};

    let bounds = zigzag::svg::shapes_bounds(std::slice::from_ref(shape));
    if bounds.is_empty() { return None; }
    let mut path = String::new();
    let mut append = |points: &[zigzag::geom::P], closed| {
        let Some((first, rest)) = points.split_first() else { return };
        let _ = write!(path, "M{:.3} {:.3}", first.x / 10.0, first.y / 10.0);
        for point in rest {
            let _ = write!(path, "L{:.3} {:.3}", point.x / 10.0, point.y / 10.0);
        }
        if closed { path.push('Z'); }
    };
    let (fill_rule, stroke_width) = match &shape.geometry {
        Geometry::Fill { rings, rule } => {
            for ring in rings { append(ring, true); }
            (Some(if *rule == FillRule::EvenOdd { "evenodd" } else { "nonzero" }), 0.0)
        }
        Geometry::Stroke { lines, width } => {
            for (line, closed) in lines { append(line, *closed); }
            (None, (*width / 10.0).max(0.35))
        }
    };
    Some(EditableObject {
        uid: shape.uid,
        groups: shape.groups.clone(),
        label: if shape.params.kind == Some(zigzag::params::Kind::Manual) {
            let mut parts = shape.id.split('_');
            if parts.next() == Some("stitches") {
                match (parts.next().and_then(|n| n.parse::<usize>().ok()), parts.next().and_then(|n| n.parse::<usize>().ok())) {
                    (Some(thread), Some(run)) => format!("Thread {thread} · Run {run}"),
                    _ => format!("Stitch path {}", shape.uid + 1),
                }
            } else if shape.label.is_empty() {
                format!("Stitch path {}", shape.uid + 1)
            } else {
                shape.label.clone()
            }
        } else {
            shape.label.clone()
        },
        color: shape.color,
        kind: shape.params.kind.map(|kind| kind.name()).unwrap_or("auto").into(),
        bounds: [bounds.min.x / 10.0, bounds.min.y / 10.0, bounds.width() / 10.0, bounds.height() / 10.0],
        path,
        fill_rule,
        stroke_width,
    })
}

#[tauri::command]
fn editable_objects(state: tauri::State<'_, Mutex<Workspace>>) -> Result<Vec<EditableObject>, String> {
    let workspace = state.lock().map_err(|error| error.to_string())?;
    Ok(workspace.source.iter().flat_map(|document| &document.shapes).filter_map(editable_object).collect())
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum ObjectEdit {
    Move { dx: f64, dy: f64 },
    Scale { factor: f64 },
    Resize { sx: f64, sy: f64, x: f64, y: f64 },
    Rotate,
    Duplicate,
    Delete,
}

fn apply_object_edit(workspace: &mut Workspace, uid: usize, operation: ObjectEdit) -> Result<Preview, String> {
    let mut document = workspace.source.clone().ok_or("No editable artwork")?;
    let index = document.shapes.iter().position(|shape| shape.uid == uid).ok_or("Object not found")?;
    let bounds = zigzag::svg::shapes_bounds(&document.shapes[index..=index]);
    let center = bounds.center();
    let result = match operation {
        ObjectEdit::Move { dx, dy } => {
            if ![dx, dy].iter().all(|value| value.is_finite() && value.abs() <= 500.0) {
                return Err("Invalid movement".into());
            }
            document.transform(&[index], [1.0, 0.0, 0.0, 1.0, dx * 10.0, dy * 10.0])
        }
        ObjectEdit::Scale { factor } => {
            if !(0.1..=10.0).contains(&factor) { return Err("Scale must be from 10% to 1000%".into()); }
            document.transform(&[index], [factor, 0.0, 0.0, factor, center.x * (1.0 - factor), center.y * (1.0 - factor)])
        }
        ObjectEdit::Resize { sx, sy, x, y } => {
            if ![sx, sy].iter().all(|factor| (0.1..=10.0).contains(factor))
                || ![x, y].iter().all(|coord| coord.is_finite() && coord.abs() <= 100_000.0)
            {
                return Err("Invalid object resize".into());
            }
            if document.shapes[index].params.kind == Some(zigzag::params::Kind::Manual) {
                return Err("Resize editable artwork with the handles. Use the Size inspector for fixed stitch paths.".into());
            }
            document.transform(&[index], [sx, 0.0, 0.0, sy, x * 10.0 * (1.0 - sx), y * 10.0 * (1.0 - sy)])
        }
        ObjectEdit::Rotate => document.transform(&[index], [0.0, 1.0, -1.0, 0.0, center.x + center.y, center.y - center.x]),
        ObjectEdit::Duplicate => document.duplicate(&[index], zigzag::geom::P::new(50.0, 50.0)).map(|_| ()),
        ObjectEdit::Delete => {
            if document.shapes.len() <= 1 { return Err("Add another object before deleting the last one".into()); }
            document.delete(index)
        }
    };
    result.map_err(|error| error.to_string())?;
    let design = document.plan_cached(&mut workspace.plan_cache);
    if design.stitch_count() == 0 { return Err("The edit would leave no stitchable objects".into()); }
    let result = preview(&design);
    workspace.checkpoint();
    workspace.current = Some(design);
    workspace.source = Some(document);
    Ok(result)
}

// Batch alignment is one undoable transaction; indices are resolved from stable UIDs.
fn align_objects(workspace:&mut Workspace,uids:&[usize],mode:&str)->Result<Preview,String>{
 let mut doc=workspace.source.clone().ok_or("No editable artwork")?;
 let mut indices:Vec<usize>=doc.shapes.iter().enumerate().filter(|(_,s)|uids.contains(&s.uid)).map(|(i,_)|i).collect();
 if indices.len()<2{return Err("Select at least two objects".into())}
 let bounds:Vec<_>=indices.iter().map(|&i|zigzag::svg::shapes_bounds(&doc.shapes[i..=i])).collect();
 if bounds.iter().any(|b|b.is_empty()){return Err("Selection contains empty geometry".into())}
 let horizontal=matches!(mode,"center_x"|"distribute_x");let vertical=matches!(mode,"center_y"|"distribute_y");
 if !horizontal&&!vertical{return Err("Unknown alignment".into())}
 let coordinate=|i:usize|{let b=zigzag::svg::shapes_bounds(&doc.shapes[i..=i]);if horizontal{b.center().x}else{b.center().y}};
 indices.sort_by(|&a,&b|coordinate(a).total_cmp(&coordinate(b)));
 let values:Vec<_>=indices.iter().map(|&i|coordinate(i)).collect();
 let first=values[0];let last=*values.last().unwrap();
 let distribute=mode.starts_with("distribute");
 if distribute&&indices.len()<3{return Err("Select at least three objects to distribute".into())}
 let count=indices.len();
 for (n,(&i,&value)) in indices.iter().zip(&values).enumerate(){
 let target=if distribute{first+(last-first)*n as f64/(count-1) as f64}else{(first+last)*0.5};
 let delta=target-value;
 doc.transform(&[i],[1.0,0.0,0.0,1.0,if horizontal{delta}else{0.0},if vertical{delta}else{0.0}]).map_err(|e|e.to_string())?;
 }
 let design=doc.plan_cached(&mut workspace.plan_cache);if design.stitch_count()==0{return Err("Alignment produced no stitches".into())}
 let result=preview(&design);workspace.checkpoint();workspace.source=Some(doc);workspace.current=Some(design);Ok(result)
}
#[tauri::command]
async fn delete_artwork_objects(uids:Vec<usize>,all:bool,app:tauri::AppHandle)->Result<Preview,String>{
 use tauri::Manager;
 tauri::async_runtime::spawn_blocking(move||{
 let state=app.state::<Mutex<Workspace>>();let mut w=state.lock().map_err(|e|e.to_string())?;
 if w.current.is_none(){return Err("No design open".into())}
 let mut doc=if all{Document::empty()}else{w.source.clone().ok_or("No editable artwork")?};
 if !all{
 let selected:std::collections::HashSet<_>=uids.into_iter().collect();
 let indices:Vec<_>=doc.shapes.iter().enumerate().filter(|(_,s)|selected.contains(&s.uid)).map(|(i,_)|i).collect();
 if indices.is_empty()||indices.len()!=selected.len(){return Err("Selection changed; select the design again".into())}
 if indices.len()==doc.shapes.len(){doc=Document::empty()}else{doc.delete_many(&indices).map_err(|e|e.to_string())?;}
 }
 let design=doc.plan_cached(&mut w.plan_cache);
 let result=preview(&design);w.checkpoint();w.source=Some(doc);w.current=Some(design);Ok(result)
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn move_artwork_objects(uids:Vec<usize>,dx:f64,dy:f64,app:tauri::AppHandle)->Result<Preview,String>{
 use tauri::Manager;
 if ![dx,dy].iter().all(|v|v.is_finite()&&v.abs()<=500.0){return Err("Invalid movement".into())}
 tauri::async_runtime::spawn_blocking(move||{
 let state=app.state::<Mutex<Workspace>>();let mut w=state.lock().map_err(|e|e.to_string())?;
 let mut doc=w.source.clone().ok_or("No editable artwork")?;
 let indices:Vec<_>=doc.shapes.iter().enumerate().filter(|(_,s)|uids.contains(&s.uid)).map(|(i,_)|i).collect();
 if indices.is_empty(){return Err("No objects selected".into())}
 if indices.len()==doc.shapes.len(){return place_design(&mut w,[1.0,0.0,0.0,1.0,dx*10.0,dy*10.0])}
 doc.transform(&indices,[1.0,0.0,0.0,1.0,dx*10.0,dy*10.0]).map_err(|e|e.to_string())?;
 let design=doc.plan_cached(&mut w.plan_cache);if design.stitch_count()==0{return Err("Movement produced no stitches".into())}
 let result=preview(&design);w.checkpoint();w.source=Some(doc);w.current=Some(design);Ok(result)
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn transform_artwork_group(uids:Vec<usize>,scale:f64,rotation:f64,app:tauri::AppHandle)->Result<Preview,String>{
 use tauri::Manager;
 if !scale.is_finite()||!(0.1..=10.0).contains(&scale)||!rotation.is_finite()||rotation.abs()>360.0{return Err("Invalid group transformation".into())}
 tauri::async_runtime::spawn_blocking(move||{
 let state=app.state::<Mutex<Workspace>>();let mut w=state.lock().map_err(|e|e.to_string())?;
 let mut doc=w.source.clone().ok_or("No editable artwork")?;
 let indices:Vec<_>=doc.shapes.iter().enumerate().filter(|(_,s)|uids.contains(&s.uid)).map(|(i,_)|i).collect();
 if indices.is_empty()||indices.len()!=uids.len(){return Err("Selection changed. Select the design again.".into())}
 let shapes:Vec<_>=indices.iter().map(|&i|doc.shapes[i].clone()).collect();
 let center=zigzag::svg::shapes_bounds(&shapes).center();
 let (s,c)=rotation.to_radians().sin_cos();let a=scale*c;let b=scale*s;
 doc.transform(&indices,[a,b,-b,a,center.x-a*center.x+b*center.y,center.y-b*center.x-a*center.y]).map_err(|e|e.to_string())?;
 let design=doc.plan_cached(&mut w.plan_cache);if design.stitch_count()==0{return Err("Transformation produced no stitches".into())}
 let result=preview(&design);w.checkpoint();w.source=Some(doc);w.current=Some(design);Ok(result)
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn recolor_artwork_group(uids:Vec<usize>,previous:[u8;3],color:[u8;3],app:tauri::AppHandle)->Result<Preview,String>{
 use tauri::Manager;
 tauri::async_runtime::spawn_blocking(move||{
 let state=app.state::<Mutex<Workspace>>();let mut w=state.lock().map_err(|e|e.to_string())?;
 let mut doc=w.source.clone().ok_or("No editable artwork")?;
 let mut found=false;
 for shape in &mut doc.shapes{
 if !uids.contains(&shape.uid)||shape.color!=previous{continue}
 if shape.params.kind==Some(zigzag::params::Kind::Tartan)||shape.params.colors.is_some(){return Err("Edit special pattern colors individually".into())}
 if shape.groups.iter().any(|g|g.starts_with("tl-lettering-")){return Err("Edit lettering colors using the text inspector".into())}
 shape.color=color;found=true;
 }
 if !found{return Err("No matching objects in this group".into())}
 let design=doc.plan_cached(&mut w.plan_cache);if design.stitch_count()==0{return Err("No stitches generated".into())}
 let result=preview(&design);w.checkpoint();w.source=Some(doc);w.current=Some(design);Ok(result)
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn set_artwork_group(uids:Vec<usize>,group:bool,state:tauri::State<'_,Mutex<Workspace>>)->Result<Preview,String>{
 let mut w=state.lock().map_err(|e|e.to_string())?;
 let mut doc=w.source.clone().ok_or("No editable artwork")?;
 let selected:std::collections::HashSet<_>=uids.iter().copied().collect();
 if selected.is_empty()||(group&&selected.len()<2)||doc.shapes.iter().filter(|s|selected.contains(&s.uid)).count()!=selected.len(){return Err("Select valid artwork objects first".into())}
 let mut n=0usize;
 let key=loop{let key=format!("tl-custom-group-{n}");if !doc.shapes.iter().any(|s|s.groups.contains(&key)){break key}n+=1;};
 for shape in &mut doc.shapes{if selected.contains(&shape.uid){shape.groups.retain(|g|!g.starts_with("tl-custom-group-")&&!g.starts_with("tl-independent-"));shape.groups.push(if group{key.clone()}else{format!("tl-independent-{}",shape.uid)});}}
 let result=preview(w.current.as_ref().ok_or("Open a design first")?);
 w.checkpoint();w.source=Some(doc);Ok(result)
}
#[tauri::command]
async fn align_artwork_objects(uids:Vec<usize>,mode:String,app:tauri::AppHandle)->Result<Preview,String>{
 use tauri::Manager;
 tauri::async_runtime::spawn_blocking(move||{let state=app.state::<Mutex<Workspace>>();let mut w=state.lock().map_err(|e|e.to_string())?;align_objects(&mut w,&uids,&mode)}).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn edit_artwork_object(uid: usize, operation: ObjectEdit, app: tauri::AppHandle) -> Result<Preview, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let state=app.state::<Mutex<Workspace>>();
        let mut workspace=state.lock().map_err(|error| error.to_string())?;
        apply_object_edit(&mut workspace,uid,operation)
    }).await.map_err(|error|error.to_string())?
}
#[tauri::command]
fn set_object_kind(uid:usize,kind:String,state:tauri::State<'_,Mutex<Workspace>>) -> Result<Preview,String>{
 let kind=if kind=="auto"{None}else{Some(zigzag::params::Kind::parse(&kind).ok_or("Unknown stitch type")?)};
 let mut w=state.lock().map_err(|e|e.to_string())?;
 let mut doc=w.source.clone().ok_or("No editable artwork")?;
 let shape=doc.shapes.iter_mut().find(|s|s.uid==uid).ok_or("Object not found")?;
 if shape.params.kind==Some(zigzag::params::Kind::Manual){return Err("Manual stitches cannot be converted directly".into())}
 shape.params.kind=kind;
 let d=doc.plan();if d.blocks.is_empty(){return Err("No stitches generated".into())}
 let p=preview(&d);w.checkpoint();w.current=Some(d);w.source=Some(doc);Ok(p)
}
// Read-only preview uses the same planner as the final specialty design.
#[tauri::command]
async fn preview_specialty(shape:String,style:String,width:f64) -> Result<Preview,String> {
    tauri::async_runtime::spawn_blocking(move || {
        let doc = specialty::build_document(&shape, &style, width)?;
        let design = doc.plan();
        if design.blocks.is_empty() { return Err("No stitches generated".into()); }
        Ok(preview(&design))
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn create_specialty(shape:String,style:String,width:f64,state:tauri::State<'_,Mutex<Workspace>>) -> Result<Preview,String>{
 let doc = specialty::build_document(&shape, &style, width)?;
 let d=doc.plan();if d.blocks.is_empty(){return Err("No stitches generated".into())}
 let p=preview(&d);let mut w=state.lock().map_err(|e|e.to_string())?;w.checkpoint();w.current=Some(d);w.source=Some(doc);Ok(p)
}
#[tauri::command]
fn recovery_save(app: tauri::AppHandle, width: f64, height: f64, format: String, thread_assignments: Option<std::collections::HashMap<String,String>>, state: tauri::State<'_, Mutex<Workspace>>) -> Result<(), String> {
    use tauri::Manager;
    // Keep recovery writes in order if more than one caller requests a snapshot.
    static RECOVERY_WRITE: Mutex<()> = Mutex::new(());
    let _write = RECOVERY_WRITE.lock().map_err(|err| err.to_string())?;
    let project = {
        let workspace = state.lock().map_err(|err| err.to_string())?;
        Project::capture(&workspace, width, height, format)?
    };
    let Some(mut project) = project else { return Ok(()); };
    project.thread_assignments = thread_assignments.unwrap_or_default();
    let dir = app.path().app_local_data_dir().map_err(|err| err.to_string())?;
    project_recovery::save(&dir, &project)
}

#[tauri::command]
fn recovery_open(app: tauri::AppHandle, state: tauri::State<'_, Mutex<Workspace>>) -> Result<Option<OpenedProject>, String> {
    use tauri::Manager;
    let dir = app.path().app_local_data_dir().map_err(|err| err.to_string())?;
    project_recovery::open(&dir, &state)
}
#[tauri::command]
fn lettering_fonts()->Vec<String>{zigzag::document::font_families()}
#[tauri::command]
async fn create_lettering(
    text: String, font: String, size: f64, spacing: f64, arc: f64, bold: bool,
    italic: bool, color: [u8; 3], align: String, placement: Option<[f64; 2]>, app: tauri::AppHandle,
) -> Result<Preview, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let settings = lettering_edit::LetteringSettings { text, font, size, spacing, arc, bold, italic, color, align, h_scale:None,v_scale:None,kern:None,path:None,path_offset:None,path_flip:None };
        let spec = settings.spec()?;
        let state = app.state::<Mutex<Workspace>>();
        let mut workspace = state.lock().map_err(|err| err.to_string())?;
        lettering_edit::apply(&mut workspace, &spec, placement)
    }).await.map_err(|err| err.to_string())?
}
#[derive(serde::Serialize)]
struct FontAsset {name:String,file:String,format:String,bytes:u64}
fn font_dir(app:&tauri::AppHandle)->Result<std::path::PathBuf,String>{
 use tauri::Manager;
 let dir=app.path().app_local_data_dir().map_err(|e|e.to_string())?.join("fonts");
 std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;Ok(dir)
}
#[tauri::command]
fn font_assets(app:tauri::AppHandle)->Result<Vec<FontAsset>,String>{
 let mut out=Vec::new();
 for e in std::fs::read_dir(font_dir(&app)?).map_err(|e|e.to_string())?{
 let e=e.map_err(|e|e.to_string())?;if !e.file_type().map_err(|e|e.to_string())?.is_file(){continue}
 let p=e.path();let ext=p.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase();
 if !["bx","ttf","otf"].contains(&ext.as_str()){continue}
 out.push(FontAsset{name:p.file_stem().unwrap_or_default().to_string_lossy().into_owned(),file:e.file_name().to_string_lossy().into_owned(),format:ext,bytes:e.metadata().map_err(|e|e.to_string())?.len()});
 }out.sort_by_key(|f|f.name.to_lowercase());Ok(out)
}
#[derive(serde::Serialize,Default)]
struct FontImport {imported:usize,duplicates:usize,skipped:usize,errors:Vec<String>}
#[tauri::command]
async fn import_fonts(folder:bool,app:tauri::AppHandle)->Result<Option<FontImport>,String>{
 let paths=if folder{let Some(p)=rfd::AsyncFileDialog::new().pick_folder().await else{return Ok(None)};vec![p.path().to_owned()]}else{let Some(p)=rfd::AsyncFileDialog::new().add_filter("Font files",&["bx","ttf","otf"]).pick_files().await else{return Ok(None)};p.into_iter().map(|p|p.path().to_owned()).collect()};
 let dir=font_dir(&app)?;
 tauri::async_runtime::spawn_blocking(move||{
 let mut result=FontImport::default();let mut stack=paths;let mut visited=0;
 while let Some(p)=stack.pop(){visited+=1;if visited>100000{result.errors.push("Scan limit reached".into());break}
 let meta=match std::fs::symlink_metadata(&p){Ok(m)=>m,Err(e)=>{result.errors.push(format!("{}: {e}",p.display()));continue}};
 if meta.file_type().is_symlink(){result.skipped+=1;continue}
 if meta.is_dir(){match std::fs::read_dir(&p){Ok(entries)=>for e in entries{match e{Ok(e)=>stack.push(e.path()),Err(e)=>result.errors.push(e.to_string())}},Err(e)=>result.errors.push(e.to_string())}continue}
 let ext=p.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase();
 if !meta.is_file()||!["bx","ttf","otf"].contains(&ext.as_str())||meta.len()>50_000_000||meta.len()==0{result.skipped+=1;continue}
 let bytes=match std::fs::read(&p){Ok(b)=>b,Err(e)=>{result.errors.push(e.to_string());continue}};
 let stem=p.file_stem().unwrap_or_default().to_string_lossy();
 let mut n=0;loop{let name=if n==0{format!("{stem}.{ext}")}else{format!("{stem} ({n}).{ext}")};let dest=dir.join(name);
 match std::fs::OpenOptions::new().write(true).create_new(true).open(&dest){
 Ok(mut f)=>{use std::io::Write;if let Err(e)=f.write_all(&bytes){let _=std::fs::remove_file(&dest);result.errors.push(e.to_string())}else{result.imported+=1}break},
 Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists=>{if std::fs::read(&dest).ok().as_deref()==Some(bytes.as_slice()){result.duplicates+=1;break}n+=1;if n>10000{result.errors.push("Too many filename conflicts".into());break}},
 Err(e)=>{result.errors.push(e.to_string());break}
 }}
 }Some(result)
 }).await.map_err(|e|e.to_string())
}
#[tauri::command]
fn remove_font_asset(app:tauri::AppHandle,file:String)->Result<(),String>{
 let p=std::path::Path::new(&file);
 if p.components().count()!=1||!matches!(p.components().next(),Some(std::path::Component::Normal(_)))||!["bx","ttf","otf"].contains(&p.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase().as_str()){return Err("Invalid font filename".into())}
 let target=font_dir(&app)?.join(p);
 if !std::fs::symlink_metadata(&target).map_err(|e|e.to_string())?.file_type().is_file(){return Err("Not a regular font file".into())}
 std::fs::remove_file(target).map_err(|e|e.to_string())
}
#[derive(serde::Serialize)]
struct ArtworkInput{name:String,mime:String,bytes:Vec<u8>}
#[tauri::command]
async fn choose_artwork() -> Result<Option<ArtworkInput>, String> {
    use std::io::Read;

    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("Open image or PDF")
        .add_filter("Images and PDF", &["jpg", "jpeg", "jfif", "jpe", "png", "webp", "gif", "bmp", "tif", "tiff", "svg", "pdf"])
        .add_filter("Photos and images", &["jpg", "jpeg", "jfif", "jpe", "png", "webp", "gif", "bmp", "tif", "tiff"])
        .add_filter("SVG and PDF", &["svg", "pdf"])
        .add_filter("All files", &["*"])
        .pick_file().await else { return Ok(None); };
    let path = file.path().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
        let mime = match extension.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" | "jfif" | "jpe" => "image/jpeg",
            "webp" => "image/webp",
            "gif" => "image/gif",
            "bmp" => "image/bmp",
            "tif" | "tiff" => "image/tiff",
            "svg" => "image/svg+xml",
            "pdf" => "application/pdf",
            _ => return Err("Choose a JPG, PNG, WebP, GIF, BMP, TIFF, SVG, or PDF. Convert other formats to PNG first.".into()),
        };
        let mut bytes = Vec::new();
        std::fs::File::open(&path).map_err(|error| error.to_string())?
            .take(20_000_001).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
        if bytes.is_empty() || bytes.len() > 20_000_000 {
            return Err("An image or PDF must be between 1 byte and 20 MB".into());
        }
        let name = path.file_stem().unwrap_or_default().to_string_lossy().into_owned();
        Ok(Some(ArtworkInput { name, mime: mime.into(), bytes }))
    }).await.map_err(|error| error.to_string())?
}

struct DigitizerDraft {
    id: u64,
    document: zigzag::document::Document,
    design: Design,
}

#[derive(serde::Serialize)]
struct DigitizerReview {
    id: u64,
    plan: Preview,
    quality: StitchAudit,
    warnings: Vec<String>,
    density: Vec<[i32; 3]>,
    jumps: usize,
    dst_stitches: usize,
    color_changes: usize,
    optimization: Option<[usize;2]>,
}

#[tauri::command]
async fn digitize_artwork(
    bytes: Vec<u8>, name: String, mime: String, width_mm: f64, colors: u32,
    remove_background: bool, detail: f64, fabric: String, cleanup: bool,
    tolerance: u8, thin_lines: bool, thread_palette: Option<Vec<[u8; 3]>>, state: tauri::State<'_, Mutex<Workspace>>,
) -> Result<DigitizerReview, String> {
    if bytes.is_empty() || bytes.len() > 20_000_000 || !(5.0..=300.0).contains(&width_mm)
        || !(0.0..=100.0).contains(&detail) || !(colors == 0 || (2..=10).contains(&colors))
        || zigzag::params::Fabric::by_id(&fabric).is_none()
    {
        return Err("Invalid artwork settings or file size".into());
    }
    static NEXT_DRAFT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let id = {
        let mut workspace = state.lock().map_err(|err| err.to_string())?;
        workspace.next_draft_id = NEXT_DRAFT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        workspace.digitizer_draft = None;
        workspace.next_draft_id
    };
    let (document, design, review) = tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
        let options = zigzag::trace::TraceOptions {
            width_mm, colors, remove_background, detail, lines: thin_lines, threads: thread_palette.unwrap_or_default().into_iter().take(1024).collect(), ..Default::default()
        };
        let mut document = if mime == "image/svg+xml" {
            let svg = std::str::from_utf8(&bytes).map_err(|err| err.to_string())?;
            zigzag::document::Document::from_svg(svg, &name, None).map_err(|err| err.to_string())?
        } else {
            zigzag::trace::digitize_raster(&bytes, &name, &options, tolerance, cleanup)
                .map_err(|err| err.to_string())?
        };
        document.settings.fabric = fabric.clone();
        let artwork_bounds = zigzag::svg::shapes_bounds(&document.shapes);
        if artwork_bounds.width() > 10_000.0 || artwork_bounds.height() > 10_000.0 {
            return Err("Artwork is larger than 1 meter. Reduce the artwork dimensions before digitizing.".into());
        }
        let mut design = document.plan();
        // Compare a second automatic trace only for raster imports with
        // automatic colors. Keep the original unless the alternate retains
        // the palette and approximate extent while reducing sewing complexity.
        if mime != "image/svg+xml" && colors == 0 && !thin_lines && design.stitch_count() <= 100_000 {
            let mut alternate_options = options.clone();
            alternate_options.lines = true;
            if let Ok(mut alternate) = zigzag::trace::digitize_raster(&bytes, &name, &alternate_options, tolerance, cleanup) {
                alternate.settings.fabric = fabric.clone();
                let bounds = zigzag::svg::shapes_bounds(&alternate.shapes);
                let similar_extent = (bounds.width() - artwork_bounds.width()).abs() <= 10.0
                    && (bounds.height() - artwork_bounds.height()).abs() <= 10.0;
                if similar_extent {
                    let candidate = alternate.plan();
                    let palette = |d: &Design| d.blocks.iter().map(|b| b.color).collect::<std::collections::HashSet<_>>();
                    let score = |d: &Design| {
                        let audit = measure_stitches(d);
                        let commands = formats::dst::stream(d);
                        let changes = commands.iter().filter(|c| matches!(c.op, formats::Op::ColorChange)).count();
                        let jumps = commands.iter().filter(|c| matches!(c.op, formats::Op::Jump)).count();
                        d.stitch_count() as f64 + changes as f64 * 180.0 + jumps as f64 * 12.0
                            + audit.long as f64 * 100.0 + audit.zero as f64 * 4.0
                    };
                    let n = candidate.stitch_count();
                    let base = design.stitch_count();
                    if n > 0 && n <= 100_000 && n >= base / 2
                        && palette(&candidate) == palette(&design)
                        && score(&candidate) < score(&design) * 0.90 {
                        document = alternate;
                        design = candidate;
                    }
                }
            }
        }
        // Conservative automatic density optimization for generated raster
        // artwork only. Keep explicit stitch settings, small details, satin,
        // specialty stitches and manually imported needle paths unchanged.
        let mut optimization = None;
        if mime != "image/svg+xml" && fabric == "standard" && design.stitch_count() <= 100_000 {
            let mut alternate = document.clone();
            let mut changed = 0usize;
            for shape in &mut alternate.shapes {
                use zigzag::params::Kind;
                if shape.params.kind.unwrap_or(Kind::Fill)!=Kind::Fill || shape.params.spacing.is_some(){continue}
                if let zigzag::svg::Geometry::Fill{rings,rule}=&shape.geometry {
                    let comps=zigzag::stitch::satin::components(rings,*rule);
                    if comps.len()!=1 || comps[0].len()!=1 {continue}
                    let area=zigzag::boolean::ring_area(&comps[0][0]).abs();
                    let bounds=zigzag::svg::shapes_bounds(std::slice::from_ref(shape));
                    if area<20_000.0 || bounds.width().min(bounds.height())<80.0 {continue}
                    let spacing=shape.params.fill_spacing(zigzag::params::Fabric::standard()).max(0.38);
                    shape.params.spacing=Some((spacing+0.02).min(0.40).max(spacing));
                    changed+=1;
                }
            }
            if changed>0 {
                let candidate=alternate.plan();
                let before=measure_stitches(&design);
                let after=measure_stitches(&candidate);
                let old_bounds=design.bounds();let new_bounds=candidate.bounds();
                let same_extent=(old_bounds.min.dist(new_bounds.min)<=5.0)&&(old_bounds.max.dist(new_bounds.max)<=5.0);
                let same_colors=design.blocks.iter().map(|b|b.color).eq(candidate.blocks.iter().map(|b|b.color));
                let all_preserved=design.per_shape.iter().zip(&candidate.per_shape).all(|(&a,&b)|a==0||b>0);
                if same_extent && same_colors && all_preserved
                    && candidate.stitch_count()>=design.stitch_count()*9/10
                    && candidate.stitch_count()<design.stitch_count()
                    && candidate.trim_count()<=design.trim_count()
                    && after.long<=before.long && after.zero<=before.zero
                    && after.short<=before.short {
                    optimization=Some([design.stitch_count(),candidate.stitch_count()]);
                    document=alternate;design=candidate;
                }
            }
        }
        let count = design.stitch_count();
        if count == 0 { return Err("No stitchable artwork found".into()); }
        if count > 2_000_000 { return Err("Design exceeds the two million stitch limit".into()); }
        if design.blocks.iter().flat_map(|block| &block.runs).flat_map(|run| &run.pts)
            .any(|point| !point.x.is_finite() || !point.y.is_finite() || point.x.abs() > 10_000.0 || point.y.abs() > 10_000.0)
        {
            return Err("Artwork exceeds the digitizer coordinate limits".into());
        }
        let mut density = std::collections::HashMap::new();
        let commands = formats::dst::stream(&design);
        let mut jumps = 0;
        let mut dst_stitches = 0;
        let mut color_changes = 0;
        for command in &commands {
            match command.op {
                formats::Op::Stitch => {
                    dst_stitches += 1;
                    let cell = [(command.x / 10.0).floor() as i32, (command.y / 10.0).floor() as i32];
                    *density.entry(cell).or_insert(0) += 1;
                }
                formats::Op::Jump => jumps += 1,
                formats::Op::ColorChange => color_changes += 1,
                _ => {}
            }
        }
        let mut density: Vec<_> = density.into_iter().map(|([x, y], count)| [x, y, count]).collect();
        density.sort_unstable_by_key(|&[x, y, count]| (std::cmp::Reverse(count), y, x));
        density.truncate(512);
        let mut issues = zigzag::checks::check(&document.shapes, &design, &document.plan_options(), None);
        issues.sort_by_key(|issue| std::cmp::Reverse(issue.level));
        let mut warnings: Vec<_> = issues.into_iter().filter(|issue| issue.level != zigzag::checks::Level::Info)
            .map(|issue| match issue.shape {
                Some(index) => format!("Object {}: {}", index + 1, issue.message),
                None => issue.message,
            }).collect();
        warnings.extend(design.notes.iter().map(|(index, message)| format!("Object {}: {message}", index + 1)));
        let mut seen = std::collections::HashSet::new();
        warnings.retain(|message| seen.insert(message.clone()));
        warnings.truncate(12);
        let review = DigitizerReview {
            id,
            plan: preview(&design),
            quality: measure_stitches(&design),
            warnings,
            density,
            jumps,
            dst_stitches,
            color_changes,
            optimization,
        };
        Ok((document, design, review))
    }).await.map_err(|err| err.to_string())??;
    let mut workspace = state.lock().map_err(|err| err.to_string())?;
    if workspace.next_draft_id != id { return Err("A newer digitizing request replaced this draft".into()); }
    workspace.digitizer_draft = Some(DigitizerDraft { id, document, design });
    Ok(review)
}

#[tauri::command]
fn apply_digitizer_draft(id: u64, state: tauri::State<'_, Mutex<Workspace>>) -> Result<(), String> {
    let mut workspace = state.lock().map_err(|err| err.to_string())?;
    if workspace.digitizer_draft.as_ref().is_none_or(|draft| draft.id != id) {
        return Err("This draft expired. Regenerate stitches before opening it.".into());
    }
    let draft = workspace.digitizer_draft.take().ok_or("No digitizing draft")?;
    workspace.checkpoint();
    workspace.current = Some(draft.design);
    workspace.source = Some(draft.document);
    Ok(())
}
#[derive(serde::Serialize)]
struct LibraryEntry {file:String,name:String,stitches:usize,colors:usize,width:f64,height:f64,modified:u64}
#[tauri::command]
async fn import_project_files()->Result<Option<Vec<LibraryEntry>>,String>{
 let Some(files)=rfd::AsyncFileDialog::new().add_filter("Stitch Studio projects",&["stitchstudio"]).pick_files().await else{return Ok(None)};
 let paths:Vec<_>=files.into_iter().map(|f|f.path().to_owned()).collect();
 tauri::async_runtime::spawn_blocking(move||{
 let mut out=Vec::new();
 for path in paths.into_iter().take(2000){
 let Ok(meta)=std::fs::symlink_metadata(&path) else{continue};
 if !meta.is_file()||meta.len()>100_000_000||!path.extension().and_then(|s|s.to_str()).is_some_and(|s|s.eq_ignore_ascii_case("stitchstudio")){continue}
 let Ok(p)=Project::load(&path) else{continue};if p.version!=1{continue}
 out.push(LibraryEntry{file:path.to_string_lossy().into_owned(),name:p.name,stitches:p.blocks.iter().flat_map(|b|&b.runs).map(|r|r.points.len()).sum(),colors:p.blocks.len(),width:p.width,height:p.height,modified:meta.modified().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_secs()).unwrap_or(0)});
 }Some(out)
 }).await.map_err(|e|e.to_string())
}
#[tauri::command]
async fn import_artwork_files()->Result<Option<usize>,String>{
 let Some(files)=rfd::AsyncFileDialog::new().add_filter("Artwork",&["png","jpg","jpeg","webp"]).pick_files().await else{return Ok(None)};
 let paths:Vec<_>=files.into_iter().map(|f|f.path().to_owned()).collect();
 tauri::async_runtime::spawn_blocking(move||->Result<Option<usize>,String>{
 let root=character_root()?;std::fs::create_dir_all(&root).map_err(|e|e.to_string())?;
 let dir=root.join("My imported artwork");std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
 if !std::fs::symlink_metadata(&dir).map_err(|e|e.to_string())?.file_type().is_dir(){return Err("Invalid artwork folder".into())}
 let mut count=0;
 for path in paths.into_iter().take(1000){
 let Ok(meta)=std::fs::symlink_metadata(&path) else{continue};if !meta.is_file()||meta.len()>20_000_000{continue}
 let ext=path.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase();if !matches!(ext.as_str(),"png"|"jpg"|"jpeg"|"webp"){continue}
 let Ok(bytes)=std::fs::read(&path) else{continue};
 let stem=path.file_stem().unwrap_or_default().to_string_lossy();
 for n in 0..1000{let name=if n==0{format!("{stem}.{ext}")}else{format!("{stem} ({n}).{ext}")};let dest=dir.join(name);
 match std::fs::OpenOptions::new().write(true).create_new(true).open(&dest){Ok(mut f)=>{use std::io::Write;if let Err(e)=f.write_all(&bytes){let _=std::fs::remove_file(&dest);return Err(e.to_string())}count+=1;break},Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists=>{if std::fs::read(&dest).ok().as_deref()==Some(bytes.as_slice()){break}},Err(e)=>return Err(e.to_string())}
 }}Ok(Some(count))
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn scan_projects()->Result<Option<Vec<LibraryEntry>>,String>{
 let Some(folder)=rfd::AsyncFileDialog::new().pick_folder().await else{return Ok(None)};
 let root=folder.path().to_owned();
 tauri::async_runtime::spawn_blocking(move||{
 let mut stack=vec![root];let mut out=Vec::new();let mut visited=0;
 while let Some(path)=stack.pop(){visited+=1;if visited>50000||out.len()>=2000{break}
 let Ok(meta)=std::fs::symlink_metadata(&path) else{continue};
 if meta.file_type().is_symlink(){continue}
 if meta.is_dir(){if let Ok(entries)=std::fs::read_dir(&path){stack.extend(entries.flatten().map(|e|e.path()))}continue}
 if !meta.is_file()||meta.len()>100_000_000||!path.extension().and_then(|s|s.to_str()).is_some_and(|s|s.eq_ignore_ascii_case("stitchstudio")){continue}
 let Ok(bytes)=std::fs::read(&path) else{continue};let Ok(p)=serde_json::from_slice::<Project>(&bytes) else{continue};if p.version!=1{continue}
 out.push(LibraryEntry{file:path.to_string_lossy().into_owned(),name:p.name,stitches:p.blocks.iter().flat_map(|b|&b.runs).map(|r|r.points.len()).sum(),colors:p.blocks.len(),width:p.width,height:p.height,modified:meta.modified().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_secs()).unwrap_or(0)});
 }out.sort_by(|a,b|b.modified.cmp(&a.modified));Some(out)
 }).await.map_err(|e|e.to_string())
}
// Preview saved stitch data without opening or modifying the workspace.
#[tauri::command]
async fn project_thumbnail(file: String) -> Result<Preview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = std::path::Path::new(&file);
        if !path.extension().and_then(|s|s.to_str()).is_some_and(|s|s.eq_ignore_ascii_case("stitchstudio")) {
            return Err("Select a Stitch Studio project".into());
        }
        let p = Project::load(path)?;
        if p.version != 1 { return Err("Unsupported project version".into()); }
        let stitches: usize = p.blocks.iter().flat_map(|b|&b.runs).map(|r|r.points.len()).sum();
        if stitches == 0 || stitches > 2_000_000 { return Err("Invalid stitch count".into()); }
        let trims = p.blocks.iter().flat_map(|b|&b.runs).filter(|r|r.trim_before).count();
        let blocks = p.blocks.into_iter().map(|b|PreviewBlock {
            color:b.color,
            runs:b.runs.into_iter().map(|r|r.points.into_iter().map(|[x,y]|[x/10.0,y/10.0]).collect()).collect()
        }).collect();
        Ok(Preview{name:p.name,blocks,stitches,trims})
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn library_open(file:String,state:tauri::State<'_,Mutex<Workspace>>)->Result<OpenedProject,String>{
 let p=std::path::Path::new(&file);
 if !p.extension().and_then(|s|s.to_str()).is_some_and(|s|s.eq_ignore_ascii_case("stitchstudio")){return Err("Select a Stitch Studio project".into())}
 open_project_path(p,&state)
}
#[derive(serde::Serialize)]
struct PreparedArtwork {width:u32,height:u32,rgba:Vec<u8>}
#[tauri::command]
async fn preview_cleanup(bytes:Vec<u8>,remove_background:bool,tolerance:u8,cleanup:bool)->Result<PreparedArtwork,String>{
 if bytes.is_empty()||bytes.len()>20_000_000{return Err("Invalid artwork size".into())}
 tauri::async_runtime::spawn_blocking(move||{
 let (width,height,rgba)=zigzag::trace::prepared_pixels(&bytes,remove_background,tolerance,cleanup).map_err(|e|e.to_string())?;
 Ok(PreparedArtwork{width,height,rgba})
 }).await.map_err(|e|e.to_string())?
}

#[derive(serde::Serialize)]
struct CharacterEntry {group:String,name:String,file:String}
fn character_root()->Result<std::path::PathBuf,String>{
 let home=std::env::var_os("USERPROFILE").or_else(||std::env::var_os("HOME")).ok_or("Home folder unavailable")?;
 Ok(std::path::PathBuf::from(home).join("StitchStudio Artwork"))
}
fn character_component(s:&str)->bool{let mut c=std::path::Path::new(s).components();matches!(c.next(),Some(std::path::Component::Normal(_)))&&c.next().is_none()}
#[tauri::command]
fn character_list()->Result<Vec<CharacterEntry>,String>{
 let mut out = vec![
     CharacterEntry {group:"Classic animation (1928)".into(),name:"Mickey Mouse at the wheel".into(),file:"mickey-1928.jpg".into()},
     CharacterEntry {group:"Classic animation (1928)".into(),name:"Minnie Mouse running".into(),file:"minnie-1928.png".into()},
 ];
 let Ok(root) = character_root() else { return Ok(out); };
 if !root.exists(){return Ok(out)}
 for group in std::fs::read_dir(root).map_err(|e|e.to_string())?.flatten(){
 if !group.file_type().is_ok_and(|t|t.is_dir()){continue}
 let Ok(files)=std::fs::read_dir(group.path()) else{continue};
 for f in files.flatten(){if out.len()>=1000{break}
 if !f.file_type().is_ok_and(|t|t.is_file()){continue}
 let path=f.path();let ext=path.extension().and_then(|s|s.to_str()).unwrap_or("").to_lowercase();
 if !matches!(ext.as_str(),"png"|"webp"|"jpg"|"jpeg"){continue}
 if !f.metadata().is_ok_and(|m|m.len()<=20_000_000){continue}
 out.push(CharacterEntry{group:group.file_name().to_string_lossy().into_owned(),name:path.file_stem().unwrap_or_default().to_string_lossy().into_owned(),file:f.file_name().to_string_lossy().into_owned()});
 }}
 out.sort_by(|a,b|(&a.group,&a.name).cmp(&(&b.group,&b.name)));Ok(out)
}
#[tauri::command]
async fn character_image(group:String,file:String)->Result<Vec<u8>,String>{
 if group == "Classic animation (1928)" {
     match file.as_str() {
         "mickey-1928.jpg" => return Ok(include_bytes!("../assets/classic-art/mickey-1928.jpg").to_vec()),
         "minnie-1928.png" => return Ok(include_bytes!("../assets/classic-art/minnie-1928.png").to_vec()),
         _ => (),
     }
 }
 if !character_component(&group)||!character_component(&file){return Err("Invalid artwork name".into())}
 let dir=character_root()?.join(group);let path=dir.join(file);
 if !std::fs::symlink_metadata(&dir).is_ok_and(|m|m.file_type().is_dir())||!std::fs::symlink_metadata(&path).is_ok_and(|m|m.file_type().is_file()&&m.len()<=20_000_000){return Err("Artwork unavailable".into())}
 let ext=path.extension().and_then(|s|s.to_str()).unwrap_or("").to_lowercase();
 if !matches!(ext.as_str(),"png"|"webp"|"jpg"|"jpeg"){return Err("Unsupported artwork".into())}
 tauri::async_runtime::spawn_blocking(move||std::fs::read(path).map_err(|e|e.to_string())).await.map_err(|e|e.to_string())?
}


#[tauri::command]
async fn insert_character(bytes:Vec<u8>,name:String,width_mm:f64,x_mm:f64,y_mm:f64,state:tauri::State<'_,Mutex<Workspace>>)->Result<Preview,String>{
 if bytes.is_empty()||bytes.len()>20_000_000||![width_mm,x_mm,y_mm].iter().all(|v|v.is_finite())||!(5.0..=250.0).contains(&width_mm)||x_mm.abs()>500.0||y_mm.abs()>500.0{return Err("Invalid artwork or dimensions".into())}
 let svg = tauri::async_runtime::spawn_blocking(move || {
     let options = zigzag::trace::TraceOptions { width_mm, ..Default::default() };
     zigzag::trace::trace_prepared_bytes(&bytes, &options, 32, false)
         .map(|trace| trace.svg).map_err(|err| err.to_string())
 }).await.map_err(|err| err.to_string())??;
 let mut w = state.lock().map_err(|err| err.to_string())?;
 insert_editable_artwork(&mut w, &svg, &name, x_mm, y_mm, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_rejects_rounding_outside_hoop_and_excess_color_blocks() {
        let run = zigzag::design::Run { pts: vec![zigzag::geom::P::new(100.6, 0.0)], trim_before: false };
        let block = zigzag::design::Block { color: [20, 40, 60], runs: vec![run] };
        let mut design = Design { blocks: vec![block.clone()], ..Default::default() };
        assert!(validate_export(&design, "dst", 20.14, 20.0).is_err());
        assert!(validate_export(&design, "dst", 22.0, 20.0).is_ok());
        design.blocks = vec![block; 257];
        assert!(validate_export(&design, "pes", 22.0, 20.0).is_err());
        assert!(validate_export(&design, "pec", 22.0, 20.0).is_err());
    }

    #[test]
    fn project_round_trip_preserves_hoop_position_and_source() {
        let art = r#"<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="30mm" viewBox="0 0 40 30"><rect id="art" x="10" y="5" width="20" height="15" fill="purple"/></svg>"#;
        let mut source = zigzag::document::Document::from_svg(art, "placed", None).unwrap();
        source.transform(&[0], [1.0, 0.0, 0.0, 1.0, 125.0, 50.0]).unwrap();
        let design = source.plan();
        let expected = formats::write_format(&design, "dst").unwrap();
        let original = Workspace { current: Some(design), source: Some(source), ..Default::default() };
        let project = Project::capture(&original, 100.0, 100.0, "dst".into()).unwrap().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("placed.stitchstudio");
        write_project(&path, &project).unwrap();
        write_project(&path, &project).unwrap();
        let restored = Mutex::new(Workspace::default());
        open_project_path(&path, &restored).unwrap();
        let workspace = restored.into_inner().unwrap();
        assert_eq!(formats::write_format(&workspace.current.unwrap(), "dst").unwrap(), expected);
        assert_eq!(formats::write_format(&workspace.source.unwrap().plan(), "dst").unwrap(), expected);
    }

    #[test]
    fn inserting_vector_artwork_keeps_existing_source_objects() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20"><rect id="square" x="5" y="5" width="10" height="10" fill="purple"/></svg>"#;
        let mut workspace = Workspace::default();
        insert_editable_artwork(&mut workspace, svg, "first", -15.0, 0.0, false).unwrap();
        insert_editable_artwork(&mut workspace, svg, "second", 15.0, 0.0, false).unwrap();
        assert_eq!(workspace.source.as_ref().unwrap().shapes.len(), 2);
        assert_eq!(workspace.undo.last().unwrap().1.as_ref().unwrap().shapes.len(), 1);
    }

    #[test]
    fn object_edits_regenerate_only_the_selected_geometry_and_checkpoint_the_project() {
        let xml = r#"<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm"><rect id="a" x="2" y="2" width="25" height="15" fill="red"/><rect id="b" x="65" y="2" width="20" height="15" fill="blue"/></svg>"#;
        let mut workspace = Workspace::default();
        insert_editable_artwork(&mut workspace, xml, "pair", 0.0, 0.0, false).unwrap();
        let shapes = &workspace.source.as_ref().unwrap().shapes;
        let first = editable_object(&shapes[0]).unwrap();
        let other = editable_object(&shapes[1]).unwrap();
        let original = formats::dst::write_dst(workspace.current.as_ref().unwrap());
        apply_object_edit(&mut workspace, first.uid, ObjectEdit::Move { dx: 8.0, dy: -4.0 }).unwrap();
        let edited = &workspace.source.as_ref().unwrap().shapes;
        let after = editable_object(&edited[0]).unwrap();
        assert!((after.bounds[0] - first.bounds[0] - 8.0).abs() < 0.01);
        assert!((after.bounds[1] - first.bounds[1] + 4.0).abs() < 0.01);
        assert_eq!(other.path, editable_object(&edited[1]).unwrap().path);
        assert_eq!(formats::dst::write_dst(&workspace.undo.last().unwrap().0), original);
        let before_resize = workspace.current.as_ref().unwrap().stitch_count();
        apply_object_edit(&mut workspace, first.uid, ObjectEdit::Scale { factor: 1.8 }).unwrap();
        assert_ne!(workspace.current.as_ref().unwrap().stitch_count(), before_resize);
        let resized = editable_object(&workspace.source.as_ref().unwrap().shapes[0]).unwrap();
        let [left, top, width, height] = resized.bounds;
        apply_object_edit(&mut workspace, first.uid, ObjectEdit::Resize {
            sx: 1.2, sy: 0.8, x: left, y: top,
        }).unwrap();
        let [x, y, w, h] = editable_object(&workspace.source.as_ref().unwrap().shapes[0]).unwrap().bounds;
        assert!((x - left).abs() < 0.01 && (y - top).abs() < 0.01);
        assert!((w - width * 1.2).abs() < 0.01 && (h - height * 0.8).abs() < 0.01);
        apply_object_edit(&mut workspace, first.uid, ObjectEdit::Duplicate).unwrap();
        assert_eq!(workspace.source.as_ref().unwrap().shapes.len(), 3);
        apply_object_edit(&mut workspace, first.uid, ObjectEdit::Delete).unwrap();
        assert_eq!(workspace.source.as_ref().unwrap().shapes.len(), 2);
    }

    #[test]
    fn inserting_machine_runs_preserves_the_artwork_through_save_and_reopen() {
        use zigzag::formats::read::{StitchBlock, StitchFile};
        use zigzag::geom::P;
        let xml = r#"<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm"><circle id="dot" cx="20" cy="20" r="10" fill="purple"/></svg>"#;
        let mut workspace = Workspace::default();
        insert_editable_artwork(&mut workspace, xml, "mixed", -12.0, 0.0, false).unwrap();
        let first = editable_object(&workspace.source.as_ref().unwrap().shapes[0]).unwrap();
        let color = [40, 90, 130];
        let file = StitchFile { name: "stitches".into(), blocks: vec![
            StitchBlock { color, runs: vec![
                vec![P::new(0.0, 0.0), P::new(20.0, 30.0)],
                vec![P::new(21.0, 30.0), P::new(46.0, 4.0)],
            ] },
            StitchBlock { color, runs: vec![vec![P::new(40.0, 20.0), P::new(40.0, 40.0)]] },
        ] };
        insert_editable_artwork(&mut workspace, &formats::read::to_svg(&file), "stitches", 14.0, 5.0, false).unwrap();
        let source = workspace.source.as_ref().unwrap();
        assert_eq!(first.path, editable_object(&source.shapes[0]).unwrap().path);
        assert_eq!(source.shapes.iter().filter(|shape| shape.params.kind == Some(zigzag::params::Kind::Manual)).count(), 3);
        let design = workspace.current.as_ref().unwrap();
        assert_eq!(design.blocks.len(), 3);
        assert!(design.blocks[1].runs[1].trim_before);
        let expected = formats::dst::write_dst(design);
        let project = Project::capture(&workspace, 100.0, 100.0, "dst".into()).unwrap().unwrap();
        let restored = Mutex::new(Workspace::default());
        project.restore(&restored).unwrap();
        let restored = restored.into_inner().unwrap();
        assert_eq!(formats::dst::write_dst(&restored.source.unwrap().plan()), expected);
    }
}

#[tauri::command]
fn set_canvas_fullscreen(window: tauri::WebviewWindow, fullscreen: bool) -> Result<(), String> {
    window.set_fullscreen(fullscreen).map_err(|error| error.to_string())
}

#[tauri::command]
async fn check_beta_update(app:tauri::AppHandle)->Result<Option<String>,String>{
 use tauri_plugin_updater::UpdaterExt;
 let update=app.updater().map_err(|e|e.to_string())?.check().await.map_err(|e|e.to_string())?;
 Ok(update.map(|u|u.version))
}
fn main(){tauri::Builder::default().plugin(tauri_plugin_updater::Builder::new().build()).manage(Mutex::new(Workspace::default())).invoke_handler(tauri::generate_handler![delete_artwork_objects,check_beta_update,recolor_artwork_group,set_artwork_group,transform_artwork_group,apply_reference_colors,move_artwork_objects,align_artwork_objects,lettering_edit::insert_lettering_settings,replace_design_color,center_design_axis,lettering_edit::lettering_settings,lettering_edit::update_lettering,import_project_files,import_artwork_files,saved_templates::insert_saved_template,saved_templates::import_template_archive,saved_templates::saved_templates,saved_templates::open_saved_template,saved_templates::preview_saved_template,fabric_profiles::fabric_catalog,fabric_profiles::current_fabric,fabric_profiles::apply_fabric_profile,machine_preview::preview_machine_commands,specialty::export_applique_cut_svg,set_canvas_fullscreen,insert_character,character_list,character_image,open_svg,export_design,transform_design,mirror_design,center_design,audit_stitches,repair_stitches,recolor_block,history_step,current_preview,save_project,open_project,load_template,preview_template,insert_template,insert_embroidery,personal_designs,library_thumbnail,import_personal_designs,import_design_archive,apply_stitch_properties,editable_objects,edit_artwork_object,set_object_kind,create_specialty,preview_specialty,recovery_save,recovery_open,lettering_fonts,create_lettering,lettering_edit::preview_lettering,font_assets,import_fonts,remove_font_asset,choose_artwork,preview_cleanup,digitize_artwork,apply_digitizer_draft,scan_projects,project_thumbnail,library_open]).run(tauri::generate_context!()).expect("Stitch Studio failed to launch");}
