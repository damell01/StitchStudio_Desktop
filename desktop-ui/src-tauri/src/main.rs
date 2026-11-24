#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::sync::Mutex;
#[derive(Default)]
struct Workspace { source: Option<zigzag::document::Document>, current: Option<Design>, undo: Vec<(Design,Option<zigzag::document::Document>)>, redo: Vec<(Design,Option<zigzag::document::Document>)> }
impl Workspace { fn checkpoint(&mut self) { if let Some(d)=self.current.clone(){self.undo.push((d,self.source.clone()));if self.undo.len()>20{self.undo.remove(0);}self.redo.clear();} } }
use zigzag::{design::Design, formats};
#[derive(serde::Serialize)]
struct Preview { name: String, blocks: Vec<PreviewBlock>, stitches: usize, trims: usize }
#[derive(serde::Serialize)]
struct PreviewBlock { color: [u8;3], runs: Vec<Vec<[f64;2]>> }
fn preview(design: &Design) -> Preview { Preview { name: design.name.clone(), stitches: design.blocks.iter().flat_map(|b| &b.runs).map(|r| r.pts.len()).sum(), trims: design.blocks.iter().flat_map(|b| &b.runs).filter(|r| r.trim_before).count(), blocks: design.blocks.iter().map(|b| PreviewBlock { color:b.color, runs:b.runs.iter().map(|r| r.pts.iter().map(|p| [p.x/10.0,p.y/10.0]).collect()).collect() }).collect() } }
#[tauri::command]
fn transform_design(scale: f64, rotation: f64, dx: f64, dy: f64, state: tauri::State<'_, Mutex<Workspace>>) -> Result<Preview,String> {
    if ![scale,rotation,dx,dy].iter().all(|v| v.is_finite()) || !(0.1..=10.0).contains(&scale) || dx.abs()>500.0 || dy.abs()>500.0 { return Err("Invalid transformation".into()); }
    let mut guard=state.lock().map_err(|e|e.to_string())?;
    guard.checkpoint();
    guard.source=None;
    let d=guard.current.as_mut().ok_or("Open artwork first")?;
    let (s,c)=rotation.to_radians().sin_cos();
    for p in d.blocks.iter_mut().flat_map(|b| &mut b.runs).flat_map(|r| &mut r.pts) {
        let (x,y)=(p.x,p.y);
        p.x=scale*(x*c-y*s)+dx*10.0;
        p.y=scale*(x*s+y*c)+dy*10.0;
    }
    Ok(preview(d))
}
#[tauri::command]
fn recolor_block(index: usize, color: [u8;3], state: tauri::State<'_, Mutex<Workspace>>) -> Result<Preview,String> {
    let mut guard=state.lock().map_err(|e|e.to_string())?;
    guard.checkpoint();
    guard.source=None;
    let d=guard.current.as_mut().ok_or("Open artwork first")?;
    d.blocks.get_mut(index).ok_or("Invalid thread block")?.color=color;
    Ok(preview(d))
}
#[tauri::command]
async fn open_svg(width_mm: f64, colors: u32, remove_background: bool, detail: f64, state: tauri::State<'_, Mutex<Workspace>>) -> Result<Option<Preview>, String> {
    let Some(path) = rfd::AsyncFileDialog::new().add_filter("Artwork and embroidery", &["svg","png","jpg","jpeg","webp","gif","bmp","tiff","dst","pes","pec","exp","jef"]).pick_file().await else { return Ok(None); };
    let path = path.path().to_owned();
    let source = tauri::async_runtime::spawn_blocking(move || -> Result<zigzag::document::Document,String> {
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
        let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Design");
        if ext == "svg" { return zigzag::document::Document::open(&path).map_err(|e| e.to_string()); }
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        let svg = if zigzag::trace::is_image(&ext) {
            let options = zigzag::trace::TraceOptions { width_mm, colors, remove_background, detail, ..Default::default() };
            zigzag::trace::trace_bytes(&bytes, &options).map_err(|e| e.to_string())?.svg
        } else {
            let file = formats::read::read_stitch_file(&bytes, &ext).map_err(|e| e.to_string())?;
            if file.blocks.is_empty() { return Err("No stitches found".into()); }
            formats::read::to_svg(&file)
        };
        zigzag::document::Document::from_svg(&svg, name, None).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())??;
    let design=source.plan();
    if design.blocks.is_empty() { return Err("No stitchable objects found".into()); }
    let preview = preview(&design);
    *state.lock().map_err(|e| e.to_string())? = Workspace {source:Some(source),current:Some(design),..Default::default()};
    Ok(Some(preview))
}
#[tauri::command]
async fn export_design(format: String, width: f64, height: f64, state: tauri::State<'_, Mutex<Workspace>>) -> Result<bool,String> {
    if !width.is_finite() || !height.is_finite() || width<=0.0 || height<=0.0 {return Err("Invalid hoop dimensions".into());}
    let bytes = { let guard = state.lock().map_err(|e| e.to_string())?; let d = guard.current.as_ref().ok_or("Open artwork first")?; if d.blocks.iter().flat_map(|b| &b.runs).flat_map(|r| &r.pts).any(|p| !p.x.is_finite() || !p.y.is_finite() || p.x.abs()>width*5.0 || p.y.abs()>height*5.0) {return Err("Design exceeds selected hoop".into());} formats::write_format(d,&format).map_err(|e|e.to_string())? };
    let Some(path) = rfd::AsyncFileDialog::new().add_filter("Embroidery", &[format.as_str()]).set_file_name(format!("design.{format}")).save_file().await else {return Ok(false)};
    std::fs::write(path.path(),bytes).map_err(|e|e.to_string())?;
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
#[derive(serde::Serialize,serde::Deserialize)]
struct Project { #[serde(default)] source_svg:Option<String>, version:u32,name:String,width:f64,height:f64,format:String,blocks:Vec<ProjectBlock> }
#[derive(serde::Serialize,serde::Deserialize)]
struct ProjectBlock {color:[u8;3],runs:Vec<ProjectRun>}
#[derive(serde::Serialize,serde::Deserialize)]
struct ProjectRun {points:Vec<[f64;2]>,trim_before:bool}
#[derive(serde::Serialize)]
struct OpenedProject {plan:Preview,width:f64,height:f64,format:String}
#[tauri::command]
async fn save_project(width:f64,height:f64,format:String,state:tauri::State<'_,Mutex<Workspace>>) -> Result<bool,String> {
 let project={let w=state.lock().map_err(|e|e.to_string())?;let d=w.current.as_ref().ok_or("No design")?;
 Project{source_svg:w.source.as_ref().map(|s|s.to_svg()).transpose().map_err(|e|e.to_string())?,version:1,name:d.name.clone(),width,height,format,blocks:d.blocks.iter().map(|b|ProjectBlock{color:b.color,runs:b.runs.iter().map(|r|ProjectRun{points:r.pts.iter().map(|p|[p.x,p.y]).collect(),trim_before:r.trim_before}).collect()}).collect()}};
 let bytes=serde_json::to_vec(&project).map_err(|e|e.to_string())?;
 let Some(path)=rfd::AsyncFileDialog::new().add_filter("Stitch Studio project",&["stitchstudio"]).set_file_name("design.stitchstudio").save_file().await else{return Ok(false)};
 std::fs::write(path.path(),bytes).map_err(|e|e.to_string())?;Ok(true)
}
#[tauri::command]
async fn open_project(state:tauri::State<'_,Mutex<Workspace>>) -> Result<Option<OpenedProject>,String> {
 let Some(path)=rfd::AsyncFileDialog::new().add_filter("Stitch Studio project",&["stitchstudio"]).pick_file().await else{return Ok(None)};
 if std::fs::metadata(path.path()).map_err(|e|e.to_string())?.len()>100_000_000{return Err("Project exceeds size limit".into())}
 let p:Project=serde_json::from_slice(&std::fs::read(path.path()).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
 if p.version!=1 || !p.width.is_finite() || !p.height.is_finite() || p.width<=0.0 || p.height<=0.0 || !["dst","pes","jef","exp","vp3","pec"].contains(&p.format.as_str()) || p.blocks.iter().flat_map(|b|&b.runs).flat_map(|r|&r.points).flatten().any(|v|!v.is_finite()||v.abs()>1000000.0){return Err("Invalid project".into())}
 let source=p.source_svg.as_ref().map(|svg|zigzag::document::Document::from_svg(svg,&p.name,None)).transpose().map_err(|e|e.to_string())?;
 let d=Design{name:p.name,blocks:p.blocks.into_iter().map(|b|zigzag::design::Block{color:b.color,runs:b.runs.into_iter().map(|r|zigzag::design::Run{pts:r.points.into_iter().map(|v|zigzag::geom::P::new(v[0],v[1])).collect(),trim_before:r.trim_before}).collect()}).collect(),..Default::default()};
 let result=OpenedProject{plan:preview(&d),width:p.width,height:p.height,format:p.format};
 *state.lock().map_err(|e|e.to_string())?=Workspace{source,current:Some(d),..Default::default()};Ok(Some(result))
}
#[tauri::command]
fn load_template(id:String,art:String,state:tauri::State<'_,Mutex<Workspace>>) -> Result<Preview,String>{
 if !["heart","star","leaf","football","bow","mountain"].contains(&id.as_str()) || art.len()>4096 || art.contains("href") || art.contains("<image") || art.contains("<script"){return Err("Invalid starter template".into())}
 let svg=format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"65mm\" height=\"65mm\" viewBox=\"0 0 100 100\">{art}</svg>");
 let source=zigzag::document::Document::from_svg(&svg,&id,None).map_err(|e|e.to_string())?;let d=source.plan();
 if d.blocks.is_empty(){return Err("Template contains no stitches".into())}
 let p=preview(&d);let mut w=state.lock().map_err(|e|e.to_string())?;w.checkpoint();w.current=Some(d);w.source=Some(source);Ok(p)
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
struct EditableObject {uid:usize,label:String,color:[u8;3],kind:String}
#[tauri::command]
fn editable_objects(state:tauri::State<'_,Mutex<Workspace>>) -> Result<Vec<EditableObject>,String>{
 let w=state.lock().map_err(|e|e.to_string())?;
 Ok(w.source.as_ref().map(|d|d.shapes.iter().map(|s|EditableObject{uid:s.uid,label:s.label.clone(),color:s.color,kind:s.params.kind.map(|k|k.name()).unwrap_or("auto").into()}).collect()).unwrap_or_default())
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
#[tauri::command]
fn create_specialty(shape:String,style:String,width:f64,state:tauri::State<'_,Mutex<Workspace>>) -> Result<Preview,String>{
 if !width.is_finite() || !(20.0..=200.0).contains(&width){return Err("Choose a width between 20 and 200 mm".into())}
 let path=match shape.as_str(){"circle"=>"M50 5 A45 45 0 1 1 49.99 5 Z","shield"=>"M10 10 H90 V48 Q90 75 50 95 Q10 75 10 48 Z","heart"=>"M50 90 C-20 45 10 -10 50 25 C90 -10 120 45 50 90 Z","rounded"=>"M15 5 H85 Q95 5 95 15 V85 Q95 95 85 95 H15 Q5 95 5 85 V15 Q5 5 15 5 Z",_=>return Err("Unknown shape".into())};
 let kind=match style.as_str(){"applique"=>zigzag::params::Kind::parse("applique"),"patch"=>zigzag::params::Kind::parse("fill"),_=>return Err("Unknown workflow".into())};
 let art=if style=="patch"{format!("<path id=\"body\" d=\"{path}\" fill=\"#73977b\"/><path id=\"border\" d=\"{path}\" fill=\"none\" stroke=\"#234536\" stroke-width=\"4\"/>")}else{format!("<path id=\"fabric\" d=\"{path}\" fill=\"#73977b\"/>")};
 let svg=format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}mm\" height=\"{width}mm\" viewBox=\"0 0 100 100\">{art}</svg>");
 let mut doc=zigzag::document::Document::from_svg(&svg,&style,None).map_err(|e|e.to_string())?;
 for s in &mut doc.shapes{s.params.kind=if s.id=="border"{zigzag::params::Kind::parse("satin")}else{kind};}
 let d=doc.plan();if d.blocks.is_empty(){return Err("No stitches generated".into())}
 let p=preview(&d);let mut w=state.lock().map_err(|e|e.to_string())?;w.checkpoint();w.current=Some(d);w.source=Some(doc);Ok(p)
}
#[tauri::command]
fn recovery_save(app:tauri::AppHandle,width:f64,height:f64,format:String,state:tauri::State<'_,Mutex<Workspace>>) -> Result<(),String>{
 use tauri::Manager;
 let project={let w=state.lock().map_err(|e|e.to_string())?;let Some(d)=w.current.as_ref() else{return Ok(())};
 Project{source_svg:w.source.as_ref().map(|s|s.to_svg()).transpose().map_err(|e|e.to_string())?,version:1,name:d.name.clone(),width,height,format,blocks:d.blocks.iter().map(|b|ProjectBlock{color:b.color,runs:b.runs.iter().map(|r|ProjectRun{points:r.pts.iter().map(|p|[p.x,p.y]).collect(),trim_before:r.trim_before}).collect()}).collect()}};
 let dir=app.path().app_local_data_dir().map_err(|e|e.to_string())?;
 std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
 let bytes=serde_json::to_vec(&project).map_err(|e|e.to_string())?;
 if bytes.len()>100_000_000{return Err("Recovery file exceeds size limit".into())}
 let tmp=dir.join("recovery.tmp");let target=dir.join("recovery.stitchstudio");let backup=dir.join("recovery.previous");
 std::fs::write(&tmp,bytes).map_err(|e|e.to_string())?;
 if target.exists(){if backup.exists(){std::fs::remove_file(&backup).map_err(|e|e.to_string())?;}std::fs::rename(&target,&backup).map_err(|e|e.to_string())?;}
 std::fs::rename(tmp,target).map_err(|e|e.to_string())?;Ok(())
}
#[tauri::command]
fn recovery_open(app:tauri::AppHandle,state:tauri::State<'_,Mutex<Workspace>>) -> Result<Option<OpenedProject>,String>{
 use tauri::Manager;
 let dir=app.path().app_local_data_dir().map_err(|e|e.to_string())?;
 let mut found=None;
 for name in ["recovery.stitchstudio","recovery.previous"]{let path=dir.join(name);if let Ok(meta)=std::fs::metadata(&path){if meta.len()<=100_000_000{if let Ok(bytes)=std::fs::read(path){if let Ok(p)=serde_json::from_slice::<Project>(&bytes){found=Some(p);break}}}}}
 let Some(p)=found else{return Ok(None)};
 if p.version!=1||!p.width.is_finite()||!p.height.is_finite()||p.width<=0.0||p.height<=0.0||!["dst","pes","jef","exp","vp3","pec"].contains(&p.format.as_str())||p.blocks.iter().flat_map(|b|&b.runs).flat_map(|r|&r.points).flatten().any(|v|!v.is_finite()||v.abs()>1000000.0){return Err("Invalid recovery project".into())}
 let source=p.source_svg.as_ref().map(|svg|zigzag::document::Document::from_svg(svg,&p.name,None)).transpose().map_err(|e|e.to_string())?;
 let d=Design{name:p.name,blocks:p.blocks.into_iter().map(|b|zigzag::design::Block{color:b.color,runs:b.runs.into_iter().map(|r|zigzag::design::Run{pts:r.points.into_iter().map(|v|zigzag::geom::P::new(v[0],v[1])).collect(),trim_before:r.trim_before}).collect()}).collect(),..Default::default()};
 let result=OpenedProject{plan:preview(&d),width:p.width,height:p.height,format:p.format};
 *state.lock().map_err(|e|e.to_string())?=Workspace{source,current:Some(d),..Default::default()};Ok(Some(result))
}
#[tauri::command]
fn lettering_fonts()->Vec<String>{zigzag::document::font_families()}
#[tauri::command]
fn create_lettering(text:String,font:String,size:f64,spacing:f64,arc:f64,bold:bool,italic:bool,color:[u8;3],align:String,state:tauri::State<'_,Mutex<Workspace>>) -> Result<Preview,String>{
 if text.trim().is_empty()||text.chars().count()>120||![size,spacing,arc].iter().all(|v|v.is_finite())||!(3.0..=80.0).contains(&size)||!(0.0..=5.0).contains(&spacing)||arc.abs()>300.0{return Err("Invalid lettering settings".into())}
 if !zigzag::document::font_families().contains(&font){return Err("Select an installed font".into())}
 let spec=zigzag::document::TextSpec{text,font,size_mm:size,spacing_mm:spacing,arc_mm:arc,bold,italic,color,align:zigzag::document::Align::parse(&align).unwrap_or_default(),..Default::default()};
 let mut doc=zigzag::document::Document::empty();
 doc.add_lettering(&spec,(0.0,0.0)).map_err(|e|e.to_string())?;
 let d=doc.plan();if d.blocks.is_empty(){return Err("Font produced no stitches".into())}
 let p=preview(&d);let mut w=state.lock().map_err(|e|e.to_string())?;w.checkpoint();w.current=Some(d);w.source=Some(doc);Ok(p)
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
async fn choose_artwork()->Result<Option<ArtworkInput>,String>{
 let Some(p)=rfd::AsyncFileDialog::new().add_filter("Raster artwork",&["png","jpg","jpeg","webp"]).pick_file().await else{return Ok(None)};
 let path=p.path().to_owned();
 tauri::async_runtime::spawn_blocking(move||{
 let ext=path.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase();
 let mime=match ext.as_str(){"png"=>"image/png","jpg"|"jpeg"=>"image/jpeg","webp"=>"image/webp",_=>return Err("Unsupported image".into())};
 if std::fs::metadata(&path).map_err(|e|e.to_string())?.len()>20_000_000{return Err("Image exceeds 20 MB limit".into())}
 Ok(Some(ArtworkInput{name:path.file_stem().unwrap_or_default().to_string_lossy().into_owned(),mime:mime.into(),bytes:std::fs::read(path).map_err(|e|e.to_string())?}))
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn digitize_artwork(bytes:Vec<u8>,name:String,width_mm:f64,colors:u32,remove_background:bool,detail:f64,fabric:String,state:tauri::State<'_,Mutex<Workspace>>)->Result<Preview,String>{
 if bytes.is_empty()||bytes.len()>20_000_000||!width_mm.is_finite()||!(5.0..=300.0).contains(&width_mm)||!detail.is_finite()||!(0.0..=100.0).contains(&detail)||!(colors==0||(2..=10).contains(&colors))||zigzag::params::Fabric::by_id(&fabric).is_none(){return Err("Invalid artwork settings".into())}
 let (doc,d)=tauri::async_runtime::spawn_blocking(move||->Result<_,String>{
 let options=zigzag::trace::TraceOptions{width_mm,colors,remove_background,detail,..Default::default()};
 let traced=zigzag::trace::trace_bytes(&bytes,&options).map_err(|e|e.to_string())?;
 let mut doc=zigzag::document::Document::from_svg(&traced.svg,&name,None).map_err(|e|e.to_string())?;
 doc.settings.fabric=fabric;let d=doc.plan();if d.blocks.is_empty(){return Err("No stitchable artwork found".into())}Ok((doc,d))
 }).await.map_err(|e|e.to_string())??;
 let p=preview(&d);let mut w=state.lock().map_err(|e|e.to_string())?;w.checkpoint();w.current=Some(d);w.source=Some(doc);Ok(p)
}
fn main(){tauri::Builder::default().manage(Mutex::new(Workspace::default())).invoke_handler(tauri::generate_handler![open_svg,export_design,transform_design,recolor_block,history_step,current_preview,save_project,open_project,load_template,apply_stitch_properties,editable_objects,set_object_kind,create_specialty,recovery_save,recovery_open,lettering_fonts,create_lettering,font_assets,import_fonts,remove_font_asset,choose_artwork,digitize_artwork]).run(tauri::generate_context!()).expect("Stitch Studio failed to launch");}
