#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod density_repair;
mod machine_preview;
mod lettering_edit;
mod path_edit;
mod project_recovery;
mod design_archive;
mod saved_templates;
mod starter_designs;
mod fabric_profiles;
mod specialty;
mod thread_recolor;
mod stitch_tools;
mod agent_bridge;
mod assistant_motif;
mod assistant_composition;
mod canvas_drawing;
mod editor_parity;
mod desktop_home;
mod workspace_tabs;
mod advanced_stitches;
use std::sync::Mutex;
#[derive(Default)]
struct Workspace { density_draft: Option<density_repair::DensityDraft>, cancelled_simplify_request: u64, simplify_job: Option<(u64, SimplifyBudget)>, simplify_draft: Option<SimplifyDraft>, plan_cache: zigzag::design::PlanCache, digitizer_draft: Option<DigitizerDraft>, next_draft_id: u64, source: Option<zigzag::document::Document>, current: Option<Design>, undo: Vec<(Design,Option<zigzag::document::Document>)>, redo: Vec<(Design,Option<zigzag::document::Document>)>, undo_labels: Vec<String>, redo_labels: Vec<String> }
impl Workspace {
 fn checkpoint(&mut self){self.checkpoint_named("Edit design");}
 fn checkpoint_named(&mut self,label:&str){
  if let Some(d)=self.current.clone(){self.undo.push((d,self.source.clone()));self.undo_labels.push(label.to_owned());if self.undo.len()>20{self.undo.remove(0);self.undo_labels.remove(0);}self.redo.clear();self.redo_labels.clear();}
 }
}
use zigzag::{design::Design, formats};
#[derive(serde::Serialize)]
struct Preview { name: String, blocks: Vec<PreviewBlock>, stitches: usize, trims: usize }
#[derive(serde::Serialize)]
struct PreviewBlock { color: [u8;3], runs: Vec<Vec<[f64;2]>> }
fn preview(design: &Design) -> Preview { Preview { name: design.name.clone(), stitches: design.blocks.iter().flat_map(|b| &b.runs).map(|r| r.pts.len()).sum(), trims: design.blocks.iter().flat_map(|b| &b.runs).filter(|r| r.trim_before).count(), blocks: design.blocks.iter().map(|b| PreviewBlock { color:b.color, runs:b.runs.iter().map(|r| r.pts.iter().map(|p| [p.x/10.0,p.y/10.0]).collect()).collect() }).collect() } }
#[tauri::command]
async fn transform_design(scale: f64, rotation: f64, dx: f64, dy: f64, app: tauri::AppHandle) -> Result<Preview, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let mut workspace = state.lock().map_err(|error| error.to_string())?;
        apply_design_transform(&mut workspace, scale, rotation, dx, dy)
    }).await.map_err(|error| error.to_string())?
}

fn apply_design_transform(workspace: &mut Workspace, scale: f64, rotation: f64, dx: f64, dy: f64) -> Result<Preview, String> {
    if ![scale, rotation, dx, dy].iter().all(|v| v.is_finite())
        || !(0.1..=10.0).contains(&scale) || dx.abs() > 500.0 || dy.abs() > 500.0
    {
        return Err("Invalid transformation".into());
    }
    let (s, c) = rotation.to_radians().sin_cos();
    let matrix = [scale * c, scale * s, -scale * s, scale * c, dx * 10.0, dy * 10.0];
    if matrix == zigzag::geom::IDENTITY {
        return workspace.current.as_ref().map(preview).ok_or_else(|| "Open a design first".into());
    }
    let fixed_only = workspace.source.as_ref().is_none_or(|document| {
        document.shapes.iter().all(|shape| shape.params.kind == Some(zigzag::params::Kind::Manual))
    });
    // Rigid placement of fixed paths preserves every penetration and command.
    if scale == 1.0 && (rotation == 0.0 || fixed_only) {
        return place_design(workspace, matrix);
    }
    let source = workspace.source.clone();
    let (design, source) = if let Some(mut document) = source {
        let indices: Vec<_> = (0..document.shapes.len()).collect();
        transform_for_resize(&mut document, &indices, matrix, scale, scale)?;
        let design = document.plan_cached(&mut workspace.plan_cache);
        (design, Some(document))
    } else {
        let mut design = workspace.current.clone().ok_or("Open a design first")?;
        let mut remaining = MAX_RESIZED_STITCHES;
        for run in design.blocks.iter_mut().flat_map(|block| &mut block.runs) {
            for point in &mut run.pts {
                *point = zigzag::geom::affine_apply(matrix, *point);
            }
            let rebuilt = regenerate_mixed_run(&run.pts, scale, scale);
            run.pts = resize_fixed_run(&rebuilt, scale < 1.0, &mut remaining)?;
        }
        (design, None)
    };
    validate_resized_design(&design)?;
    let result = preview(&design);
    workspace.checkpoint_named("Transform design");
    workspace.current = Some(design);
    workspace.source = source;
    Ok(result)
}
// Resize editable outlines rather than stretching the old needle positions.
// Fixed stitch artwork is deliberately excluded from this regeneration path.
fn smart_resize(workspace:&mut Workspace,width_mm:f64,height_mm:f64)->Result<Preview,String>{
    if ![width_mm,height_mm].iter().all(|v|v.is_finite()&& (1.0..=1000.0).contains(v)){return Err("Choose dimensions between 1 and 1000 mm.".into())}
    let mut doc=workspace.source.clone().ok_or("Smart Resize requires editable artwork. Reopen the original project or digitize the source image.")?;
    if doc.shapes.iter().any(|s|s.params.kind==Some(zigzag::params::Kind::Manual)){
        return Err("This design contains fixed stitch paths. Smart Resize cannot reconstruct their original stitch types; resize the original artwork instead.".into())
    }
    let bounds=zigzag::svg::shapes_bounds(&doc.shapes);
    if bounds.is_empty()||bounds.width()<=0.0||bounds.height()<=0.0{return Err("Artwork has no resizable area.".into())}
    let sx=width_mm*10.0/bounds.width();let sy=height_mm*10.0/bounds.height();
    if ![sx,sy].iter().all(|v|(0.1..=10.0).contains(v)){return Err("Resize between 10% and 1000% of the current artwork size.".into())}
    let c=bounds.center();let ids:Vec<_>=(0..doc.shapes.len()).collect();
    doc.transform(&ids,[sx,0.0,0.0,sy,c.x*(1.0-sx),c.y*(1.0-sy)]).map_err(|e|e.to_string())?;
    let mut design=doc.plan_cached(&mut workspace.plan_cache);
    validate_resized_design(&design)?;
    if let Some((next,optimized))=optimized_density(&doc,&design){
        if validate_resized_design(&optimized).is_ok() { doc=next;design=optimized; }
    }
    let result=preview(&design);workspace.checkpoint_named("Smart resize and regenerate");workspace.source=Some(doc);workspace.current=Some(design);Ok(result)
}
#[tauri::command]
async fn smart_resize_design(width_mm:f64,height_mm:f64,app:tauri::AppHandle)->Result<Preview,String>{
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move||{
        let state=app.state::<Mutex<Workspace>>();
        let mut w=state.lock().map_err(|e|e.to_string())?;
        smart_resize(&mut w,width_mm,height_mm)
    }).await.map_err(|e|e.to_string())?
}

// Fixed stitch files lack original fill/satin geometry. Keep their ordered
// paths and run boundaries; correct overlong segments and redundant short
// collinear penetrations without guessing at missing fill rows.
const MAX_RESIZED_STITCHES: usize = 2_000_000;

fn resize_fixed_run(points: &[zigzag::geom::P], shrink: bool, remaining: &mut usize) -> Result<Vec<zigzag::geom::P>, String> {
    use zigzag::geom::P;
    if !points.iter().all(|p| p.x.is_finite() && p.y.is_finite()) {
        return Err("Invalid stitch coordinates".into());
    }
    let mut kept:Vec<P>=Vec::with_capacity(points.len());
    for (i,&p) in points.iter().enumerate(){
        if shrink && i>2 && i+3<points.len() {
            if let Some(&a)=kept.last(){
                let b=points[i+1];let ab=b-a;let ap=p-a;
                let len=ab.len();
                // Do not remove ties, direction reversals, or sharp turns.
                if a.dist(p)>0.001 && a.dist(p)<2.0 && p.dist(b)>0.001 && len>0.001 && len<=35.0 &&
                    ap.dot(b-p)>0.96*ap.len()*p.dist(b) && zigzag::geom::cross(ap,ab).abs()/len<0.5 {continue}
            }
        }
        kept.push(p);
    }
    let mut out:Vec<P>=Vec::with_capacity(kept.len().min(*remaining));
    for p in kept {
        let pieces = out.last().map_or(1, |a| (a.dist(p) / 100.0).ceil().max(1.0) as usize);
        *remaining = remaining.checked_sub(pieces).ok_or("Resized stitch paths exceed the safety limit.")?;
        if let Some(&a) = out.last() {
            for j in 1..pieces {
                out.push(a.lerp(p, j as f64 / pieces as f64));
            }
        }
        out.push(p);
    }
    Ok(out)
}
// Rebuild a confidently identified alternating satin section using the
// original along-column pitch. Coordinates here are already transformed.
fn regenerate_satin_run(p:&[zigzag::geom::P],sx:f64,sy:f64)->Option<Vec<zigzag::geom::P>>{
    use zigzag::geom::P;
    if p.len()<12||p.len()>100_000||p.len()%2!=0{return None}
    let original=|v:P|P::new(v.x/sx,v.y/sy);
    let pairs:Vec<(P,P)>=p.chunks_exact(2).map(|q|(q[0],q[1])).collect();
    let mid:Vec<P>=pairs.iter().map(|(a,b)|a.lerp(*b,0.5)).collect();
    let mut pitches=Vec::new();let mut widths=Vec::new();
    for (a,b) in &pairs{widths.push(original(*b-*a).len());}
    for q in mid.windows(2){pitches.push(original(q[1]-q[0]).len());}
    let median=|v:&[f64]|{let mut v=v.to_vec();v.sort_by(f64::total_cmp);v[v.len()/2]};
    let pitch=median(&pitches);let width=median(&widths);
    if !(1.5..=12.0).contains(&pitch)||width<8.0||width<pitch*1.8||width>100.0{return None}
    // Reject irregular, intersecting, retracing and underlay-like runs.
    for i in 0..pairs.len()-1 {
        let (a,b)=pairs[i];let(c,d)=pairs[i+1];
        let va=original(b-a);let vb=original(d-c);
        let step=original(mid[i+1]-mid[i]);let l=step.len();
        if l<pitch*0.35||l>pitch*2.3||va.len()<width*0.45||va.len()>width*1.8
            ||va.dot(vb)<0.65*va.len()*vb.len()
            ||va.dot(step).abs()>0.65*va.len()*l
            ||original(c-b).len()<width*0.45{return None}
        if i>0{let prev=original(mid[i]-mid[i-1]);if prev.dot(step)<0.0{return None}}
    }
    let mut lengths=vec![0.0];
    for q in mid.windows(2){lengths.push(lengths.last().copied().unwrap_or(0.0)+q[0].dist(q[1]));}
    let length=*lengths.last()?;
    // Curved columns need enough stitches on the outer rail, without
    // crowding the inner rail. Accumulate local effective advance and
    // use its arc length to interpolate paired edges.
    let mut advance=vec![0.0];
    for i in 0..pairs.len()-1{
        let outer=pairs[i].0.dist(pairs[i+1].0).max(pairs[i].1.dist(pairs[i+1].1));
        let center=mid[i].dist(mid[i+1]);
        let effective=center.max(outer*0.8);
        advance.push(advance.last().copied().unwrap_or(0.0)+effective);
    }
    let effective=*advance.last()?;
    let count=(effective/pitch).round().max(1.0) as usize;
    if count>100_000||length<=0.0{return None}
    let mut out=Vec::with_capacity((count+1)*2);let mut k=0;
    for i in 0..=count{
        let target=effective*i as f64/count as f64;
        while k+1<advance.len()-1&&advance[k+1]<target{k+=1;}
        let t=((target-advance[k])/(advance[k+1]-advance[k]).max(1e-9)).clamp(0.0,1.0);
        let a=pairs[k].0.lerp(pairs[k+1].0,t);
        let b=pairs[k].1.lerp(pairs[k+1].1,t);
        out.extend([a,b]);
    }
    // Preserve run endpoints and existing sewing order.
    Some(out)
}
// Detect simple serpentine fills: long straight passes, alternating
// direction, joined by short perpendicular advances. Rebuild the rows
// between their existing endpoints rather than drawing across holes.
fn regenerate_fill_run(p:&[zigzag::geom::P],sx:f64,sy:f64)->Option<Vec<zigzag::geom::P>>{
    use zigzag::geom::P;
    if p.len()<24||p.len()>100_000{return None}
    let original=|v:P|P::new(v.x/sx,v.y/sy);
    let longest=p.windows(2).map(|q|original(q[1]-q[0])).max_by(|a,b|a.len().total_cmp(&b.len()))?;
    if longest.len()<12.0{return None}
    let axis=longest*(1.0/longest.len());let normal=P::new(-axis.y,axis.x);
    let mut rows:Vec<(usize,usize,i32)>=Vec::new();
    let mut start=0;let mut end=0;let mut sign=0;
    for i in 0..p.len()-1{
        let d=original(p[i+1]-p[i]);let along=d.dot(axis);
        let is_row=d.len()>=4.0&&along.abs()>=0.96*d.len();
        if is_row{
            let dir=if along>0.0{1}else{-1};
            if sign==dir&&end==i{end=i+1;}
            else{
                if sign!=0{rows.push((start,end,sign));}
                start=i;end=i+1;sign=dir;
            }
        }else if sign!=0{rows.push((start,end,sign));sign=0;}
    }
    if sign!=0{rows.push((start,end,sign));}
    if rows.len()<6||rows.first()?.0!=0||rows.last()?.1!=p.len()-1{return None}
    let mut edges:Vec<(P,P)>=Vec::new();let mut pitch=Vec::new();let mut width=Vec::new();
    let mut row_segments=0usize;
    for (i,&(a,b,dir)) in rows.iter().enumerate(){
        if b-a<2{return None}
        row_segments+=b-a;
        let (l,r)=if dir>0{(p[a],p[b])}else{(p[b],p[a])};
        width.push(original(r-l).len());edges.push((l,r));
        if i>0{
            let (_,prev_end,prev_dir)=rows[i-1];
            if dir==prev_dir||a<prev_end||a-prev_end>2{return None}
            let bridge=original(p[a]-p[prev_end]);
            if bridge.len()>15.0{return None}
            let prev=edges[i-1];
            pitch.push(original(l.lerp(r,0.5)-prev.0.lerp(prev.1,0.5)).dot(normal));
        }
    }
    if row_segments*10<(p.len()-1)*7{return None}
    let mut sorted:Vec<f64>=pitch.iter().map(|v|v.abs()).collect();sorted.sort_by(f64::total_cmp);
    let spacing=sorted[sorted.len()/2];
    if !(2.0..=8.0).contains(&spacing)||pitch.iter().any(|v|v.signum()!=pitch[0].signum()||v.abs()<spacing*0.55||v.abs()>spacing*1.6){return None}
    let min_width=width.iter().copied().fold(f64::INFINITY,f64::min);
    let max_width=width.iter().copied().fold(0.0,f64::max);
    if min_width<30.0||max_width>min_width*4.0{return None}
    // Reject abrupt edge changes so a hole or a split fill cannot be
    // mistaken for a single solid panel.
    for q in edges.windows(2){
        if original(q[1].0-q[0].0).dot(axis).abs()>spacing*2.0||original(q[1].1-q[0].1).dot(axis).abs()>spacing*2.0{return None}
    }
    let mids:Vec<P>=edges.iter().map(|(l,r)|l.lerp(*r,0.5)).collect();
    let mut lengths=vec![0.0];for q in mids.windows(2){lengths.push(lengths.last().copied().unwrap_or(0.0)+q[0].dist(q[1]));}
    let length=*lengths.last()?;
    let mut n=(length/spacing).round().max(1.0) as usize;
    // Keep row parity so the original first and last side remain intact.
    if n%2!=(rows.len()-1)%2{n+=1;}
    if n>20_000{return None}
    let mut result=Vec::new();let mut k=0;
    for i in 0..=n{
        let target=length*i as f64/n as f64;
        while k+1<lengths.len()-1&&lengths[k+1]<target{k+=1;}
        let t=((target-lengths[k])/(lengths[k+1]-lengths[k]).max(1e-9)).clamp(0.0,1.0);
        let l=edges[k].0.lerp(edges[k+1].0,t);let r=edges[k].1.lerp(edges[k+1].1,t);
        let (a,b)=if (i%2==0)==(rows[0].2>0){(l,r)}else{(r,l)};
        // Stagger interior needle penetrations in adjacent rows rather than
        // lining up all punctures into visible perforation columns.
        let distance=a.dist(b);
        let phase=if i%2==0{0.0}else{15.0};
        let mut step=30.0-phase;
        result.push(a);
        while step<distance-8.0{
            if result.len()>=2_000_000{return None}
            result.push(a.lerp(b,step/distance));step+=30.0;
        }
        result.push(b);
        if result.len()>2_000_000{return None}
    }
    Some(result)
}
// Check inferred reconstruction against its transformed original footprint.
 // A spatial grid avoids quadratic comparisons on large embroidery runs.
fn reconstruction_ok(original:&[zigzag::geom::P],candidate:&[zigzag::geom::P])->bool{
    use zigzag::geom::{Bounds,P};
    use std::collections::HashSet;
    if original.len()<2||candidate.len()<2||candidate.len()>original.len().saturating_mul(12)||candidate.len()>200_000{return false}
    if original[0].dist(candidate[0])>0.1||original.last().unwrap().dist(*candidate.last().unwrap())>0.1{return false}
    let bounds=|p:&[P]|{let mut b=Bounds::empty();for &q in p{b.add(q)}b};
    let a=bounds(original);let b=bounds(candidate);
    if a.min.dist(b.min)>10.0||a.max.dist(b.max)>10.0{return false}
    // Rasterize actual sewn segments (not just needle points). The tolerance
    // accommodates changed row spacing while rejecting large uncovered excursions.
    let grid=|p:&[P]|->Option<HashSet<(i32,i32)>>{
        let mut cells=HashSet::new();let mut samples=0usize;
        for q in p.windows(2){
            let count=(q[0].dist(q[1])/5.0).ceil().max(1.0) as usize;
            samples=samples.saturating_add(count+1);if samples>1_000_000{return None}
            for k in 0..=count{let v=q[0].lerp(q[1],k as f64/count as f64);cells.insert(((v.x/10.0).floor() as i32,(v.y/10.0).floor() as i32));}
        }Some(cells)
    };
    let Some(a)=grid(original)else{return false};let Some(b)=grid(candidate)else{return false};
    let covered=|from:&HashSet<(i32,i32)>,to:&HashSet<(i32,i32)>|->bool{
        if from.is_empty(){return false}
        let missed=from.iter().filter(|&&(x,y)|!( -1..=1).any(|dx|(-1..=1).any(|dy|to.contains(&(x+dx,y+dy))))).count();
        missed*100<=from.len()*3
    };
    covered(&a,&b)&&covered(&b,&a)
}
// Recover a consistent running-stitch pitch without cutting corners or
// deleting repeated penetrations. Only monotonic, nearly straight portions
// are resampled; decorative zigzags and ambiguous underlay remain untouched.
fn regenerate_running_run(p:&[zigzag::geom::P],sx:f64,sy:f64)->Option<Vec<zigzag::geom::P>>{
    use zigzag::geom::P;
    if p.len()<6||p.len()>100_000{return None}
    let original=|v:P|P::new(v.x/sx,v.y/sy);
    let mut steps:Vec<f64>=p.windows(2).map(|q|original(q[1]-q[0]).len()).collect();
    steps.sort_by(f64::total_cmp);let pitch=steps[steps.len()/2];
    if !(10.0..=45.0).contains(&pitch)||steps.iter().any(|&v|v<pitch*0.5||v>pitch*1.8){return None}
    for q in p.windows(3){
        let a=original(q[1]-q[0]);let b=original(q[2]-q[1]);
        if a.dot(b)<0.96*a.len()*b.len(){return None}
    }
    let mut length=vec![0.0];
    for q in p.windows(2){length.push(length.last().copied().unwrap_or(0.0)+q[0].dist(q[1]));}
    let total=*length.last()?;let n=(total/pitch).round().max(1.0) as usize;
    if n>100_000{return None}
    let mut out=Vec::with_capacity(n+1);let mut k=0;
    for i in 0..=n{
        let target=total*i as f64/n as f64;
        while k+1<length.len()-1&&length[k+1]<target{k+=1;}
        let t=((target-length[k])/(length[k+1]-length[k]).max(1e-9)).clamp(0.0,1.0);
        out.push(p[k].lerp(p[k+1],t));
    }
    Some(out)
}
fn regenerate_recognized_run(p:&[zigzag::geom::P],sx:f64,sy:f64)->Option<Vec<zigzag::geom::P>>{
    regenerate_satin_run(p,sx,sy).or_else(||regenerate_fill_run(p,sx,sy)).or_else(||regenerate_running_run(p,sx,sy)).filter(|q|reconstruction_ok(p,q))
}
// Preserve ambiguous portions (ties, travel, underlay and irregular fills).
// Search bounded windows for coherent top-stitch sections inside mixed runs.
fn regenerate_mixed_run(p:&[zigzag::geom::P],sx:f64,sy:f64)->Vec<zigzag::geom::P>{
    if let Some(q)=regenerate_recognized_run(p,sx,sy){return q}
    if p.len()<32||p.len()>100_000{return p.to_vec()}
    let mut out=Vec::with_capacity(p.len());let mut i=0;let mut attempts=0;
    while i<p.len(){
        let remaining=p.len()-i;
        let mut matched=None;
        if remaining>=16&&attempts<2048{
            for n in [256,128,64,32,16]{
                if n>remaining{continue}
                attempts+=1;
                if let Some(q)=regenerate_recognized_run(&p[i..i+n],sx,sy){matched=Some((n,q));break}
                if attempts>=2048{break}
            }
        }
        if let Some((n,q))=matched{out.extend(q);i+=n;}
        else{out.push(p[i]);i+=1;}
        if out.len()>200_000{return p.to_vec()}
    }
    if reconstruction_ok(p,&out){out}else{p.to_vec()}
}
fn transform_for_resize(
    document: &mut zigzag::document::Document,
    indices: &[usize],
    matrix: zigzag::geom::Affine,
    sx: f64,
    sy: f64,
) -> Result<(), String> {
    use std::collections::HashSet;
    use zigzag::{bezier::{Anchor, SubPath}, params::Kind, svg::Geometry};

    let fixed: HashSet<_> = indices.iter().filter_map(|&index| {
        let shape = &document.shapes[index];
        (shape.params.kind == Some(Kind::Manual)).then_some(shape.uid)
    }).collect();
    document.transform(indices, matrix).map_err(|error| error.to_string())?;
    if fixed.is_empty() || (sx == 1.0 && sy == 1.0) {
        return Ok(());
    }

    let mut edits = Vec::new();
    let mut remaining = MAX_RESIZED_STITCHES;
    for (index, shape) in document.shapes.iter().enumerate() {
        if !fixed.contains(&shape.uid) { continue; }
        if let Geometry::Stroke { lines, .. } = &shape.geometry {
            let mut paths = Vec::new();
            let mut changed = false;
            for (line, closed) in lines {
                // Closed artwork can contain a deliberate closure stitch.
                let points = if *closed {
                    remaining = remaining.checked_sub(line.len()).ok_or("Resized stitch paths exceed the safety limit.")?;
                    line.clone()
                } else {
                    let rebuilt = regenerate_mixed_run(line, sx, sy);
                    resize_fixed_run(&rebuilt, sx < 1.0 || sy < 1.0, &mut remaining)?
                };
                changed |= points != *line;
                paths.push(SubPath { anchors: points.into_iter().map(Anchor::corner).collect(), closed: *closed });
            }
            if changed { edits.push((index, paths)); }
        }
    }
    document.set_paths(&edits).map_err(|error| error.to_string())
}

fn validate_resized_design(design: &Design) -> Result<(), String> {
    if !(1..=MAX_RESIZED_STITCHES).contains(&design.stitch_count()) {
        return Err("Resize produced an empty or excessively large stitch plan.".into());
    }
    if design.blocks.iter().flat_map(|b| &b.runs).flat_map(|r| &r.pts).any(|p| !p.x.is_finite() || !p.y.is_finite()) {
        return Err("Resize produced invalid stitch coordinates.".into());
    }
    Ok(())
}
#[tauri::command]
async fn resize_artwork_selection(uids:Vec<usize>,sx:f64,sy:f64,x:f64,y:f64,app:tauri::AppHandle)->Result<Preview,String>{
    use tauri::Manager;
    if ![sx,sy].iter().all(|v|(0.1..=10.0).contains(v)) || ![x,y].iter().all(|v|v.is_finite()&&v.abs()<=1000.0){return Err("Invalid resize".into())}
    tauri::async_runtime::spawn_blocking(move||{
        let state=app.state::<Mutex<Workspace>>();
        let mut w=state.lock().map_err(|e|e.to_string())?;
        let mut doc=w.source.clone().ok_or("Open editable artwork to regenerate stitches.")?;
        let indices:Vec<_>=doc.shapes.iter().enumerate().filter(|(_,s)|uids.contains(&s.uid)).map(|(i,_)|i).collect();
        if indices.is_empty()||indices.len()!=uids.len(){return Err("Selection changed; select the artwork again.".into())}
        transform_for_resize(&mut doc, &indices, [sx, 0.0, 0.0, sy, x * 10.0 * (1.0 - sx), y * 10.0 * (1.0 - sy)], sx, sy)?;
        let design=doc.plan_cached(&mut w.plan_cache);
        validate_resized_design(&design)?;
        let result=preview(&design);w.checkpoint_named("Resize and regenerate stitches");w.source=Some(doc);w.current=Some(design);Ok(result)
    }).await.map_err(|e|e.to_string())?
}

// Fit the sewn design, not its current distance from the hoop origin.
#[tauri::command]
async fn maximize_in_hoop(
    width_mm: f64, height_mm: f64, margin_mm: f64, stretch: bool, app: tauri::AppHandle,
) -> Result<Preview, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let mut workspace = state.lock().map_err(|error| error.to_string())?;
        fit_workspace_in_hoop(&mut workspace, width_mm, height_mm, margin_mm, stretch)
    }).await.map_err(|error| error.to_string())?
}

fn fit_workspace_in_hoop(
    workspace: &mut Workspace, width_mm: f64, height_mm: f64, margin_mm: f64, stretch: bool,
) -> Result<Preview, String> {
    const EDGE_TOLERANCE: f64 = 0.1; // 0.01 mm in design units.
    if ![width_mm, height_mm, margin_mm].iter().all(|v| v.is_finite())
        || margin_mm < 0.0 || width_mm <= 2.0 * margin_mm || height_mm <= 2.0 * margin_mm
        || width_mm > 1000.0 || height_mm > 1000.0
    {
        return Err("Invalid hoop or margin".into());
    }
    let original = workspace.current.as_ref().ok_or("Open a design first")?;
    let bounds = original.bounds();
    if bounds.is_empty() || bounds.width() <= 0.01 || bounds.height() <= 0.01 {
        return Err("Design needs nonzero width and height".into());
    }
    let target_width = (width_mm - 2.0 * margin_mm) * 10.0;
    let target_height = (height_mm - 2.0 * margin_mm) * 10.0;
    let mut sx = target_width / bounds.width();
    let mut sy = target_height / bounds.height();
    if !stretch {
        sx = sx.min(sy);
        sy = sx;
    }
    if ![sx, sy].iter().all(|v| (0.1..=10.0).contains(v)) {
        return Err("Fit requires a resize outside the supported 10–1000% range.".into());
    }

    let already_sized = ((sx - 1.0) * bounds.width()).abs() <= EDGE_TOLERANCE
        && ((sy - 1.0) * bounds.height()).abs() <= EDGE_TOLERANCE;
    let (mut design, mut source) = if already_sized {
        if bounds.center().len() <= EDGE_TOLERANCE / 2.0 {
            return Ok(preview(original));
        }
        (original.clone(), workspace.source.clone())
    } else {
        let mut document = editable_base(workspace, "Hoop fit")?;
        let indices: Vec<_> = (0..document.shapes.len()).collect();
        let center = bounds.center();
        transform_for_resize(&mut document, &indices, [
            sx, 0.0, 0.0, sy, -center.x * sx, -center.y * sy,
        ], sx, sy)?;
        let mut design = document.plan_cached(&mut workspace.plan_cache);
        // Compensation and row spacing can change the sewn span. Only run
        // the stitch planner again when the sewn span actually needs shrinking.
        for _ in 0..3 {
            validate_resized_design(&design)?;
            let bounds = design.bounds();
            if bounds.width() <= target_width + EDGE_TOLERANCE
                && bounds.height() <= target_height + EDGE_TOLERANCE
            {
                break;
            }
            let correction = (target_width / bounds.width().max(0.01))
                .min(target_height / bounds.height().max(0.01));
            let center = bounds.center();
            transform_for_resize(&mut document, &indices, [
                correction, 0.0, 0.0, correction, -center.x * correction, -center.y * correction,
            ], correction, correction)?;
            design = document.plan_cached(&mut workspace.plan_cache);
        }
        (design, Some(document))
    };

    validate_resized_design(&design)?;
    let bounds = design.bounds();
    if bounds.width() > target_width + EDGE_TOLERANCE
        || bounds.height() > target_height + EDGE_TOLERANCE
    {
        return Err("Regenerated stitches could not fit the requested margin. Original retained.".into());
    }
    let shift = -bounds.center();
    if shift.x != 0.0 || shift.y != 0.0 {
        if let Some(document) = &mut source {
            document.translate_all(shift);
        }
        for point in design.blocks.iter_mut().flat_map(|block| &mut block.runs).flat_map(|run| &mut run.pts) {
            *point = *point + shift;
        }
    }
    let result = preview(&design);
    workspace.checkpoint_named(if stretch { "Stretch to hoop" } else { "Maximize in hoop" });
    workspace.source = source;
    workspace.current = Some(design);
    Ok(result)
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
// Replan the editable document, never flatten the artwork. Keep the same
// layer order and explicit stitch settings; optimize only eligible solid fills.
fn optimized_density(source:&zigzag::document::Document, original:&Design)->Option<(zigzag::document::Document,Design)>{
 if source.settings.fabric!="standard" || original.stitch_count()==0 || original.stitch_count()>100_000{return None}
 let mut next=source.clone();let mut changed=false;
 let protected: std::collections::HashSet<_> = source.shapes.iter().enumerate().filter(|(i,s)| source.records_text(*i) || s.groups.iter().any(|g|g.starts_with("tl-lettering-")||g=="tl-small-ink-detail") || source.layer_properties(&s.id).is_some_and(|l| l.locked || l.hidden) || s.params.stop == Some(true) || s.params.trim == Some(true)).map(|(_,s)| s.uid).collect();
 for shape in &mut next.shapes {
  if protected.contains(&shape.uid) { continue; }
  use zigzag::params::Kind;
  if shape.params.kind.unwrap_or(Kind::Fill)!=Kind::Fill || shape.params.spacing.is_some(){continue}
  if let zigzag::svg::Geometry::Fill{rings,rule}=&shape.geometry{
   let comps=zigzag::stitch::satin::components(rings,*rule);
   if comps.len()!=1||comps[0].len()!=1{continue}
   let area=zigzag::boolean::ring_area(&comps[0][0]).abs();
   let bounds=zigzag::svg::shapes_bounds(std::slice::from_ref(shape));
   if area<20_000.0||bounds.width().min(bounds.height())<80.0{continue}
   let spacing=shape.params.fill_spacing(zigzag::params::Fabric::standard()).max(0.38);
   if spacing>=0.40{continue}
   shape.params.spacing=Some((spacing+0.02).min(0.40));changed=true;
  }
 }
 if !changed{return None}
 next.sync().ok()?;
 let candidate=next.plan();let before=measure_stitches(original);let after=measure_stitches(&candidate);
 let a=original.bounds();let b=candidate.bounds();
 if candidate.stitch_count()>=original.stitch_count() || candidate.stitch_count()<original.stitch_count()*9/10
 || candidate.trim_count()>original.trim_count() || after.short>before.short || after.long>before.long || after.zero>before.zero
 || a.min.dist(b.min)>5.0 || a.max.dist(b.max)>5.0
 || !original.blocks.iter().map(|b|b.color).eq(candidate.blocks.iter().map(|b|b.color))
 || original.per_shape.len()!=candidate.per_shape.len()
 || !original.per_shape.iter().zip(&candidate.per_shape).all(|(&a,&b)|a==0||b>0)
 || optimization_quality(original,&candidate,800.,3.).coverage < 95.0
 {return None}
 Some((next,candidate))
}
// Simplification keeps original outlines, lettering and underlay. Test several
// density levels, and accept only a measurable improvement with intact coverage.
// Remove redundant penetrations on an existing run without changing its
// direction reversals, ties, or visible path beyond a small tolerance.
fn simplify_needle_path(points:&[zigzag::geom::P],max_length:f64,tolerance:f64)->Vec<zigzag::geom::P>{
    use zigzag::geom::{P,cross};
    if points.len()<8{return points.to_vec()}
    let mut out:Vec<P>=points[..3].to_vec();
    let mut anchor=2usize;
    while anchor<points.len()-4{
        let mut best=anchor+1;
        for end in anchor+2..=(anchor+12).min(points.len()-4){
            let a=points[anchor];let b=points[end];let ab=b-a;let len=ab.len();
            if len>max_length||len<0.001{break}
            let mut last=0.0;let mut valid=true;
            for k in anchor+1..=end{
                let d=points[k]-points[k-1];let ap=points[k]-a;
                let t=ap.dot(ab)/len;
                if d.len()<0.5||t<=last||cross(ap,ab).abs()/len>tolerance{valid=false;break}
                last=t;
            }
            if !valid{break}
            best=end;
        }
        out.push(points[best]);anchor=best;
    }
    out.extend_from_slice(&points[anchor+1..]);out
}
fn simplify_design_candidate(source:&zigzag::document::Document,original:&Design,strength:u8,uids:Option<&[usize]>,remove_detail:bool)->Option<(zigzag::document::Document,Design)>{
    use zigzag::{params::Kind,svg::Geometry,bezier::{Anchor,SubPath}};
    if original.stitch_count()==0||original.stitch_count()>200_000{return None}
    let protected: std::collections::HashSet<_> = source.shapes.iter().enumerate().filter(|(i,s)| source.records_text(*i) || s.groups.iter().any(|g|g.starts_with("tl-lettering-")||g=="tl-small-ink-detail") || source.layer_properties(&s.id).is_some_and(|l| l.locked || l.hidden) || s.params.stop == Some(true) || s.params.trim == Some(true) || s.params.kind == Some(Kind::Applique)).map(|(_,s)| s.uid).collect();
    let selected=|uid:usize|uids.is_none_or(|ids|ids.contains(&uid)) && !protected.contains(&uid);
    let mut best=None;let cost=|d:&Design|d.stitch_count().saturating_add(d.trim_count().saturating_mul(40));
    let before=measure_stitches(original);let original_bounds=original.bounds();
    let factors:&[f64]=match strength{1=>&[1.05,1.10],2=>&[1.10,1.18,1.25],_=>&[1.18,1.25,1.35,1.45]};
    for &factor in factors{
        let mut next=source.clone();let fabric=next.plan_options().fabric;let mut changed=false;
        let mut paths=Vec::new();let mut remove=Vec::new();
        for (i,shape) in next.shapes.iter_mut().enumerate(){
            if !selected(shape.uid)||shape.groups.iter().any(|g|g.starts_with("tl-lettering-")){continue}
            let b=zigzag::svg::shapes_bounds(std::slice::from_ref(shape));
            let kind=shape.params.kind.unwrap_or(Kind::Fill);
            if kind==Kind::Manual{
                if let Geometry::Stroke{lines,..}=&shape.geometry{
                    let mut edited=false;let mut subpaths=Vec::new();
                    for (line,closed) in lines{
                        let pts=if *closed{line.clone()}else{simplify_needle_path(line,if strength>=3{35.0}else{25.0},if strength>=3{0.6}else{0.3})};
                        edited|=pts.len()<line.len();
                        subpaths.push(SubPath{anchors:pts.into_iter().map(Anchor::corner).collect(),closed:*closed});
                    }
                    if edited{paths.push((i,subpaths));changed=true;}
                }
                continue
            }
            if remove_detail&&strength>=2&&kind!=Kind::Skip&&!b.is_empty()&&b.width().max(b.height())<if strength==3{12.0}else{7.0}{
                // Only remove isolated tiny elements, never a fill/stroke part
                // of a larger element or a recorded lettering object.
                remove.push(i);continue
            }
            if kind==Kind::Fill&&matches!(shape.geometry,Geometry::Fill{..})&&b.width().min(b.height())>=60.0{
                let spacing=shape.params.fill_spacing(&fabric);let target=(spacing*factor).min(0.48);
                if target>spacing+0.005{shape.params.spacing=Some(target);changed=true;}
            }
            // Reduce penetrations along already covered paths, not just
            // between fill rows. Preserve explicit specialty stitch types.
            if kind==Kind::Fill&&matches!(shape.geometry,Geometry::Fill{..})&&b.width().min(b.height())>=60.0{
                let len=shape.params.fill_len(&fabric);
                let target=(len*factor).min(if strength>=3{4.0}else{3.5});
                if target>len+0.05{shape.params.len=Some(target);changed=true;}
            }
            if kind==Kind::Run&&matches!(shape.geometry,Geometry::Stroke{..})&&b.width().max(b.height())>=50.0{
                let len=shape.params.run_len(&fabric);
                let target=(len*factor).min(if strength>=3{3.5}else{3.0});
                if target>len+0.05{shape.params.len=Some(target);changed=true;}
            }
            if kind==Kind::Satin&&b.width().min(b.height())>=25.0{
                let spacing=shape.params.satin_spacing(&fabric);let target=(spacing*factor).min(0.45);
                if target>spacing+0.005{shape.params.spacing=Some(target);changed=true;}
            }
        }
        // Protect recorded text and any element with an unselected or larger part.
        remove.retain(|&i|{
            let shape=&next.shapes[i];
            !next.records_text(i)&&next.shapes.iter().enumerate().all(|(j,s)|s.id!=shape.id||j==i||(selected(s.uid)&&{
                let b=zigzag::svg::shapes_bounds(std::slice::from_ref(s));b.width().max(b.height())<if strength==3{12.0}else{7.0}
            }))
        });
        if !paths.is_empty()&&next.set_paths(&paths).is_err(){continue}
        if !remove.is_empty(){
            // Path rewrites preserve UIDs; resolve the original identities again.
            let ids:Vec<_>=remove.iter().map(|&i|source.shapes[i].uid).collect();
            let indices:Vec<_>=next.shapes.iter().enumerate().filter(|(_,s)|ids.contains(&s.uid)).map(|(i,_)|i).collect();
            if indices.len()>=next.shapes.len()||next.delete_many(&indices).is_err(){continue}
            changed=true;
        }
        if !changed{continue}
        if next.sync().is_err(){continue}
        let d=next.plan();let after=measure_stitches(&d);let b=d.bounds();
        if d.stitch_count()==0||cost(&d)>=cost(original)||d.stitch_count()<original.stitch_count()*65/100
            ||d.trim_count()>original.trim_count()||after.long>before.long||after.zero>before.zero
            ||after.short>before.short.saturating_add(5)
            ||original_bounds.min.dist(b.min)>5.0||original_bounds.max.dist(b.max)>5.0
            ||!original.blocks.iter().map(|b|b.color).eq(d.blocks.iter().map(|b|b.color)){continue}
        if remove.is_empty()&&(original.per_shape.len()!=d.per_shape.len()||!original.per_shape.iter().zip(&d.per_shape).all(|(&a,&b)|a==0||b>0)){continue}
        if optimization_quality(original,&d,800.,3.).coverage < if remove_detail{85.0}else{90.0}{continue}
        if best.as_ref().is_none_or(|(_,old):&(zigzag::document::Document,Design)|cost(&d)<cost(old)){best=Some((next,d));}
    }
    best
}
#[derive(Clone)]
struct SimplifyBudget {
    cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>,
    deadline: std::time::Instant,
}

impl SimplifyBudget {
    fn new(duration: std::time::Duration) -> Self {
        Self { cancelled: Default::default(), deadline: std::time::Instant::now() + duration }
    }

    fn cancel(&self) {
        self.cancelled.store(true, std::sync::atomic::Ordering::Relaxed);
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(std::sync::atomic::Ordering::Relaxed)
    }

    fn exhausted(&self) -> bool {
        self.is_cancelled() || std::time::Instant::now() >= self.deadline
    }
}

#[derive(Clone,Default,serde::Deserialize)]
#[serde(rename_all="camelCase",default)]
struct SimplifyOptions {
    solid:bool, merge:bool, auto_types:bool, lighter_underlay:bool,
    target_minutes:Option<f64>, target_stitches:Option<usize>, speed:Option<f64>, trim_seconds:Option<f64>, quick:bool,
    solid_only: bool,
    goal_search: bool,
    texture_reduction: bool,
    appearance_floor: Option<f64>,
    solid_color: Option<[u8; 3]>,
    #[serde(skip)]
    budget: Option<SimplifyBudget>,
}
impl SimplifyOptions {
    fn exhausted(&self) -> bool {
        self.budget.as_ref().is_some_and(SimplifyBudget::exhausted)
    }
}
fn optimize_geometry(doc:&mut zigzag::document::Document, options:&SimplifyOptions,uids:Option<&[usize]>,texture_radius:f64)->Result<(),String>{
    let stable_woven=doc.settings.fabric=="standard";
    use zigzag::{params::Kind,svg::Geometry,boolean::{self,PathOp},geom::FillRule};
    let selected=|uid|uids.is_none_or(|ids|ids.contains(&uid));
    let eligible=|d:&zigzag::document::Document,i:usize| {
        let s=&d.shapes[i];
        selected(s.uid)&&!d.records_text(i)&&!d.layer_properties(&s.id).is_some_and(|l|l.hidden||l.locked)&&!s.groups.iter().any(|g|g.starts_with("tl-lettering-")||g=="tl-small-ink-detail")
        && d.shapes.iter().filter(|q|q.id==s.id).count()==1
    };
    if options.solid{
        // Close only narrow texture gaps, keeping large negative spaces and
        // disconnected components intact. Never change recorded text.
        let mut edits=Vec::new();
        for (i,s) in doc.shapes.iter().enumerate(){
            if options.exhausted(){return Err("Optimization search ended".into())}
            if !eligible(doc,i)||s.params.kind.unwrap_or(Kind::Fill)!=Kind::Fill{continue}
            if let Geometry::Fill{rings,rule}=&s.geometry{
                let grown=boolean::offset(rings,*rule,texture_radius);
                let closed=boolean::offset(&grown,FillRule::EvenOdd,-texture_radius);
                let before=zigzag::stitch::satin::components(rings,*rule);
                let after=zigzag::stitch::satin::components(&closed,FillRule::EvenOdd);
                if before.len()!=after.len()||closed.is_empty(){continue}
                let large_holes=|c:&Vec<Vec<zigzag::geom::Polyline>>|c.iter().flat_map(|r|r.iter().skip(1)).filter(|r|boolean::ring_area(r)>100.0).count();
                if large_holes(&before)!=large_holes(&after){continue}
                let path=zigzag::bezier::from_rings(&closed,0.2);
                if !path.is_empty(){edits.push((i,path));}
            }
        }
        doc.set_paths(&edits).map_err(|e|e.to_string())?;
    }
    // Eliminate duplicate sewing in overlapping adjacent identical fills
    // without expanding their union or crossing intervening color layers.
    if options.merge {
        let mut i=0;let mut budget=128;
        while i+1<doc.shapes.len() && budget>0{
            if options.exhausted(){return Err("Optimization search ended".into())}
            budget-=1;
            let a=&doc.shapes[i];let b=&doc.shapes[i+1];
            let compatible=eligible(doc,i)&&eligible(doc,i+1)&&a.color==b.color&&a.params==b.params
                &&a.groups==b.groups&&a.params.kind.unwrap_or(Kind::Fill)==Kind::Fill
                &&a.params.start.is_none()&&a.params.end.is_none()&&a.params.stop!=Some(true)&&a.params.trim!=Some(true);
            let joined=if compatible{match (&a.geometry,&b.geometry){
                (Geometry::Fill{rings:r,rule:f},Geometry::Fill{rings:s,rule:g})=>{
                    let overlap=boolean::pathfinder(&[(r.clone(),*f),(s.clone(),*g)],PathOp::Intersect);
                    if overlap.is_empty(){None}else{
                        let union=boolean::pathfinder(&[(r.clone(),*f),(s.clone(),*g)],PathOp::Unite);
                        let path=zigzag::bezier::from_rings(&union,0.2);
                        if path.is_empty(){None}else{Some(path)}
                    }
                },_=>None
            }}else{None};
            if let Some(path)=joined {
                let uid=doc.shapes[i+1].uid;
                doc.set_path(i,&path).map_err(|e|e.to_string())?;
                let j=doc.shapes.iter().position(|s|s.uid==uid).ok_or("Fill identity changed")?;
                doc.delete_many(&[j]).map_err(|e|e.to_string())?;
            }else{i+=1;}
        }
    }
    // Collect consecutive small same-color hatch fragments as a region.
    // A collective closing can join a group that pairwise closing cannot.
    // Restrict to unbranched narrow marks, identical settings, and explicit
    // solid mode; protect significant holes and reject large area expansion.
    if options.solid && options.merge && texture_radius>=4.0{
        let mut i=0;let mut budget=64usize;
        while i+2<doc.shapes.len()&&budget>0{
            if options.exhausted(){return Err("Optimization search ended".into())}
            let first=&doc.shapes[i];
            let mut parts=Vec::new();
            let mut ids=Vec::new();
            for j in i..(i+12).min(doc.shapes.len()){
                let q=&doc.shapes[j];
                if !eligible(doc,j)||q.color!=first.color||q.params!=first.params||q.groups!=first.groups
                    ||q.params.kind.unwrap_or(Kind::Fill)!=Kind::Fill||q.params.stop==Some(true)||q.params.trim==Some(true)
                    ||q.params.start.is_some()||q.params.end.is_some(){break}
                if let Geometry::Fill{rings,rule}=&q.geometry{
                    if zigzag::design::thin_centerline(rings,*rule).is_none(){break}
                    parts.push((rings.clone(),*rule));ids.push(q.uid);
                }else{break}
            }
            if parts.len()<3{i+=1;continue}
            budget-=1;
            let united=boolean::pathfinder(&parts,PathOp::Unite);
            let grown=boolean::offset(&united,FillRule::EvenOdd,texture_radius);
            let closed=boolean::offset(&grown,FillRule::EvenOdd,-texture_radius);
            let before=zigzag::stitch::satin::components(&united,FillRule::EvenOdd);
            let after=zigzag::stitch::satin::components(&closed,FillRule::EvenOdd);
            let area=|c:&Vec<Vec<zigzag::geom::Polyline>>|c.iter().map(|r|r.first().map(|p|boolean::ring_area(p)).unwrap_or(0.0)-r.iter().skip(1).map(|p|boolean::ring_area(p)).sum::<f64>()).sum::<f64>();
            let holes=|c:&Vec<Vec<zigzag::geom::Polyline>>|c.iter().flat_map(|r|r.iter().skip(1)).filter(|r|boolean::ring_area(r)>100.0).count();
            let old=area(&before);let new=area(&after);
            if after.is_empty()||after.len()>=before.len()||old<=0.0||new<old*0.95||new>old*1.35||holes(&before)!=holes(&after){i+=1;continue}
            let path=zigzag::bezier::from_rings(&closed,0.2);
            if path.is_empty(){i+=1;continue}
            doc.set_path(i,&path).map_err(|e|e.to_string())?;
            let gone:Vec<_>=doc.shapes.iter().enumerate().filter(|(_,q)|ids[1..].contains(&q.uid)).map(|(j,_)|j).collect();
            if gone.len()!=ids.len()-1{return Err("Shading fragment identity changed".into())}
            doc.delete_many(&gone).map_err(|e|e.to_string())?;
            i+=1;
        }
    }
    // Solid mode can join narrow hatch gaps between neighboring fragments,
    // not just holes within a single outline. Work on adjacent same-color
    // entries only, and do not touch lettering or special machine stops.
    if options.solid && options.merge {
        let mut i=0;let mut attempts=0;
        while i+1<doc.shapes.len()&&attempts<128{
            let a=&doc.shapes[i];let b=&doc.shapes[i+1];
            let compatible=eligible(doc,i)&&eligible(doc,i+1)&&a.color==b.color&&a.groups==b.groups
                &&a.params==b.params&&a.params.kind.unwrap_or(Kind::Fill)==Kind::Fill
                &&a.params.trim!=Some(true)&&b.params.trim!=Some(true)
                &&a.params.stop!=Some(true)&&b.params.stop!=Some(true);
            let joined=if compatible{match (&a.geometry,&b.geometry){
                (Geometry::Fill{rings:r,rule:f},Geometry::Fill{rings:s,rule:g})=>{
                    let united=boolean::pathfinder(&[(r.clone(),*f),(s.clone(),*g)],PathOp::Unite);
                    let components=zigzag::stitch::satin::components(&united,FillRule::EvenOdd);
                    if components.len()!=2{None}else{
                        let grown=boolean::offset(&united,FillRule::EvenOdd,texture_radius);
                        let closed=boolean::offset(&grown,FillRule::EvenOdd,-texture_radius);
                        let result=zigzag::stitch::satin::components(&closed,FillRule::EvenOdd);
                        let area=|c:&Vec<Vec<zigzag::geom::Polyline>>|c.iter().map(|r|r.first().map(|p|boolean::ring_area(p)).unwrap_or(0.0)-r.iter().skip(1).map(|p|boolean::ring_area(p)).sum::<f64>()).sum::<f64>();
                        let old=area(&components);let new=area(&result);
                        let holes=|c:&Vec<Vec<zigzag::geom::Polyline>>|c.iter().flat_map(|r|r.iter().skip(1)).filter(|r|boolean::ring_area(r)>100.0).count();
                        if result.len()==1&&old>0.0&&new>=old*0.95&&new<=old*1.20&&holes(&components)==holes(&result){Some(zigzag::bezier::from_rings(&closed,0.2))}else{None}
                    }
                },_=>None
            }}else{None};
            if let Some(path)=joined{
                if path.is_empty(){i+=1;continue}
                let second=doc.shapes[i+1].uid;
                doc.set_path(i,&path).map_err(|e|e.to_string())?;
                let j=doc.shapes.iter().position(|s|s.uid==second).ok_or("Shape changed while simplifying")?;
                doc.delete_many(&[j]).map_err(|e|e.to_string())?;
                attempts+=1;
            }else{i+=1;}
        }
    }
    for i in 0..doc.shapes.len(){
        if !eligible(doc,i){continue}
        let s=&mut doc.shapes[i];let kind=s.params.kind.unwrap_or(Kind::Fill);
        if options.solid&&options.auto_types&&kind==Kind::Fill&&s.params.start.is_none()&&s.params.end.is_none()&&s.params.colors.is_none()&&s.params.trim!=Some(true)&&s.params.stop!=Some(true){
            if let Geometry::Fill{rings,rule}=&s.geometry{
                if zigzag::design::thin_centerline(rings,*rule).is_some(){
                    s.params.kind=Some(Kind::Run);s.params.border=Some(false);s.params.repeats=Some(1);s.params.len=Some(2.0);continue;
                }
            }
        }
        if options.auto_types&&matches!(kind,Kind::Fill|Kind::Satin|Kind::Run){
            let mut trial=s.clone();trial.params.kind=None;
            zigzag::design::auto_stitch_types(std::slice::from_mut(&mut trial));
            // Keep source geometry consistent with SVG; do not apply a
            // geometry-changing conversion that cannot persist on reload.
            if let Some(k)=trial.params.kind{if matches!((&s.geometry,k),(Geometry::Stroke{..},Kind::Run|Kind::Satin)|(Geometry::Fill{..},Kind::Satin)){s.params.kind=Some(k);}}
        }
        if options.lighter_underlay&&kind==Kind::Satin&&s.params.satin_underlay.is_some()
            &&s.params.stop!=Some(true)&&s.params.trim!=Some(true)&&s.params.underlay!=Some(false)
            &&s.params.colors.is_none() {
            // Only reduce an explicitly layered foundation on stable woven
            // fabric. Keep the contour and center walk on broad satin.
            let old=s.params.satin_underlay.unwrap_or(0);
            let b=zigzag::svg::shapes_bounds(std::slice::from_ref(s));
            if stable_woven && !b.is_empty() && b.width().min(b.height())>=30.0
                &&old & zigzag::params::underlay::CENTER !=0
                &&old & zigzag::params::underlay::CONTOUR !=0 {
                s.params.satin_underlay=Some(old & !zigzag::params::underlay::ZIGZAG);
            }
        }
    }
    doc.sync().map_err(|e|e.to_string())
}
// Rebuild distressed ink as opaque, smooth shapes. Work on editable fills
// rather than altering the machine points; large counters remain negative.
fn rebuild_solid_artwork(source:&zigzag::document::Document,uids:Option<&[usize]>,radius:f64,options:&SimplifyOptions)->Option<zigzag::document::Document>{
    use zigzag::{boolean,geom::FillRule,params::Kind,svg::Geometry,stitch::satin};
    let mut doc=source.clone();
    let mut edits=Vec::new();
    for (i,s) in source.shapes.iter().enumerate(){
        if options.exhausted(){return None}
        if !uids.is_none_or(|ids|ids.contains(&s.uid))||source.records_text(i)
            ||source.layer_properties(&s.id).is_some_and(|layer| layer.hidden || layer.locked)
            ||s.groups.iter().any(|g|g.starts_with("tl-lettering-")||g=="tl-small-ink-detail")
            ||s.params.kind.unwrap_or(Kind::Fill)!=Kind::Fill||s.params.stop==Some(true)||s.params.trim==Some(true)
            ||source.shapes.iter().filter(|q|q.id==s.id).count()!=1{continue}
        let Geometry::Fill{rings,rule}=&s.geometry else{continue};
        let comps=satin::components(rings,*rule);
        let mut cleaned=Vec::new();let mut changed=false;
        for comp in comps{
            let Some(outer)=comp.first() else{continue};
            let area=boolean::ring_area(outer);
            if area<80.0{cleaned.extend(comp);continue}
            cleaned.push(outer.clone());
            for hole in comp.iter().skip(1){
                let h=boolean::ring_area(hole);
                // Keep letter counters, bow openings and other meaningful
                // voids. Remove pinholes and thin scratches only.
                let perimeter=hole.iter().zip(hole.iter().cycle().skip(1)).take(hole.len()).map(|(a,b)|a.dist(*b)).sum::<f64>();
                let thin=perimeter>0.0&&2.0*h/perimeter<radius*0.55;
                if h<area*0.12&&h<radius*radius*5.0&&thin{changed=true}else{cleaned.push(hole.clone());}
            }
        }
        if cleaned.is_empty(){continue}
        let grow=boolean::offset(&cleaned,FillRule::EvenOdd,radius);
        let closed=boolean::offset(&grow,FillRule::EvenOdd,-radius);
        let prior=satin::components(&cleaned,FillRule::EvenOdd);
        let next=satin::components(&closed,FillRule::EvenOdd);
        if next.is_empty()||next.len()!=prior.len(){continue}
        let holes=|c:&Vec<Vec<zigzag::geom::Polyline>>|c.iter().flat_map(|r|r.iter().skip(1)).filter(|r|boolean::ring_area(r)>radius*radius*5.0).count();
        if holes(&prior)!=holes(&next){continue}
        let area=|c:&Vec<Vec<zigzag::geom::Polyline>>|c.iter().map(|r|r.first().map(|p|boolean::ring_area(p)).unwrap_or(0.0)-r.iter().skip(1).map(|p|boolean::ring_area(p)).sum::<f64>()).sum::<f64>();
        let old=area(&prior);let new=area(&next);
        if old<=0.0||new<old*0.95||new>old*1.25{continue}
        if !changed && (new-old).abs()<old*0.015{continue}
        let path=zigzag::bezier::from_rings(&closed,0.6);
        if !path.is_empty(){edits.push((i,path));}
    }
    if edits.is_empty(){return None}
    let ids:Vec<_>=edits.iter().map(|(i,_)|source.shapes[*i].uid).collect();
    doc.set_paths(&edits).ok()?;
    let fabric=doc.plan_options().fabric;
    for s in &mut doc.shapes{
        if !ids.contains(&s.uid){continue}
        s.params.spacing=Some((s.params.fill_spacing(&fabric)*1.18).min(0.50));
        s.params.len=Some((s.params.fill_len(&fabric)*1.2).min(4.0));
    }
    doc.sync().ok()?;Some(doc)
}
// Optimize costly ordinary fills using their actual needle contribution.
// Preserve lettering and special stitch objects; test spacing, angle and
// length jointly so a new solid silhouette need not become more expensive.
fn economical_fill_candidate(source:&zigzag::document::Document,base:&Design,uids:Option<&[usize]>,level:u8,angle_offset:f64)->Option<(zigzag::document::Document,Design)>{
    use zigzag::{params::Kind,svg::Geometry};
    let mut doc=source.clone();let fabric=doc.plan_options().fabric;
    let mut changed=false;
    let mut longer_fill=false;
    for i in 0..doc.shapes.len(){
        if doc.records_text(i){continue}
        if doc.layer_properties(&doc.shapes[i].id).is_some_and(|l|l.hidden||l.locked){continue}
        let shape=&mut doc.shapes[i];
        if !uids.is_none_or(|ids|ids.contains(&shape.uid))||shape.groups.iter().any(|g|g.starts_with("tl-lettering-")||g=="tl-small-ink-detail")
            ||shape.params.kind.unwrap_or(Kind::Fill)!=Kind::Fill||shape.params.stop==Some(true)||shape.params.trim==Some(true)
            ||!matches!(shape.geometry,Geometry::Fill{..}){continue}
        let b=zigzag::svg::shapes_bounds(std::slice::from_ref(shape));
        if b.is_empty()||b.width().min(b.height())<25.0||base.per_shape.get(i).copied().unwrap_or(0)<80{continue}
        let spacing=shape.params.fill_spacing(&fabric);
        let len=shape.params.fill_len(&fabric);
        // A second maximum candidate keeps the row density but uses longer
        // penetrations along broad fills. Small details keep the usual cap.
        let broad_fill = level >= 4 && b.width().min(b.height()) >= 100.0
            && base.per_shape.get(i).copied().unwrap_or(0) >= 250;
        let target = if broad_fill && level == 5 {
            // The explicit Fast Stitch preview can trade some broad-fill
            // density for speed after the footprint and command checks.
            (spacing * 1.55).min(0.58)
        } else if level >= 3 {
            (spacing * 1.38).min(0.55)
        } else {
            (spacing * 1.18).min(0.48)
        };
        let length=if broad_fill {(len*1.55).min(5.0)}else{(len*1.3).min(4.5)};
        longer_fill |= broad_fill && (length > (len * 1.3).min(4.5) + 0.05
            || (level == 5 && target > (spacing * 1.38).min(0.55) + 0.005));
        if target>spacing+0.005{shape.params.spacing=Some(target);changed=true;}
        if length>len+0.05{shape.params.len=Some(length);changed=true;}
        if shape.params.start.is_none()&&shape.params.end.is_none()&&shape.params.angle.is_none(){
            let angle=shape.params.angle.unwrap_or(0.0);
            if angle_offset!=0.0{shape.params.angle=Some((angle+angle_offset).rem_euclid(180.0));changed=true;}
        }
    }
    if !changed || (level>=4 && !longer_fill && angle_offset==0.0) {return None}
    doc.sync().ok()?;let plan=doc.plan();
    Some((doc,plan))
}
// Keep the existing fill rows and outlines. Length-only replanning offers a
// fallback for narrower traced strips and for fills with good existing coverage.
fn length_only_candidate(source: &zigzag::document::Document, base: &Design, uids: Option<&[usize]>, level: u8) -> Option<(zigzag::document::Document, Design)> {
    use zigzag::{params::Kind, svg::Geometry};
    let mut doc = source.clone();
    let fabric = doc.plan_options().fabric;
    let mut changed = false;
    for i in 0..doc.shapes.len() {
        let shape = &doc.shapes[i];
        if !uids.is_none_or(|ids| ids.contains(&shape.uid))
            || doc.records_text(i)
            || doc.layer_properties(&shape.id).is_some_and(|layer| layer.hidden || layer.locked)
            || shape.groups.iter().any(|g| g.starts_with("tl-lettering-") || g == "tl-small-ink-detail")
            || shape.params.kind.unwrap_or(Kind::Fill) != Kind::Fill
            || !matches!(shape.geometry, Geometry::Fill { .. })
            || shape.params.stop == Some(true) || shape.params.trim == Some(true)
            || base.per_shape.get(i).copied().unwrap_or(0) < 24
        {
            continue;
        }
        let bounds = zigzag::svg::shapes_bounds(std::slice::from_ref(shape));
        if bounds.width().min(bounds.height()) < 15.0 { continue; }
        let length = shape.params.fill_len(&fabric);
        let target = if level >= 3 { (length * 1.5).min(4.5) } else { (length * 1.25).min(3.8) };
        if target > length + 0.05 {
            doc.shapes[i].params.len = Some(target);
            changed = true;
        }
    }
    if !changed { return None; }
    doc.sync().ok()?;
    let plan = doc.plan();
    if base.per_shape.len() != plan.per_shape.len()
        || base.per_shape.iter().zip(&plan.per_shape).any(|(before, after)| *before > 0 && *after == 0)
    {
        return None;
    }
    Some((doc, plan))
}

// An explicitly visual alternative: restore solid ink even when it costs
// more stitches. Keep counters and meaningful holes, and never replace
// specialty stitches, recorded lettering or unselected shapes.
// Compare spatial occupancy of actual needle paths, not just bounding boxes.
#[derive(serde::Serialize)]
struct OptimizationQuality{coverage:f64,density_peak:usize,seconds:f64}
fn optimization_seconds(d:&Design,speed:f64,trim:f64)->f64{
    let speed=if speed.is_finite(){speed.clamp(100.,1500.)}else{800.};
    let trim=if trim.is_finite(){trim.clamp(0.,30.)}else{3.};
    // Include travel between color blocks and skip empty runs.
    let mut previous: Option<zigzag::geom::P> = None;
    let mut travel = 0.0;
    for run in d.blocks.iter().flat_map(|b| &b.runs) {
        if let (Some(first), Some(last)) = (run.pts.first(), run.pts.last()) {
            if let Some(end) = previous { travel += end.dist(*first); }
            previous = Some(*last);
        }
    }
    // Needle penetrations, trim overhead, color changes and estimated jump travel.
    d.stitch_count() as f64/speed*60.+d.trim_count() as f64*trim+d.blocks.len().saturating_sub(1) as f64*8.+travel/10./100.
}
// Count concentrated needle penetrations, not just total stitch count.
fn production_hotspots(design:&Design)->(usize,usize){
    let mut cells=std::collections::HashMap::<(i32,i32),usize>::new();
    for p in design.blocks.iter().flat_map(|b|&b.runs).flat_map(|r|&r.pts){
        *cells.entry(((p.x/10.).floor() as i32,(p.y/10.).floor() as i32)).or_default()+=1;
    }
    (cells.values().copied().max().unwrap_or(0),cells.values().filter(|&&n|n>=24).count())
}
// Preserve local sewn coverage inside each previously occupied neighborhood.
 // A global footprint score alone can hide missing strokes in small lettering.
fn local_coverage_preserved(original:&Design,candidate:&Design)->bool{
    use std::collections::{HashSet,HashMap};
    let sample=|d:&Design|{
        let mut cells=HashSet::new();
        for b in &d.blocks{for r in &b.runs{
            for p in &r.pts{cells.insert((b.color,(p.x/5.).floor() as i32,(p.y/5.).floor() as i32));}
            for pair in r.pts.windows(2){
                let n=(pair[0].dist(pair[1])/2.5).ceil().clamp(1.,100.) as usize;
                for k in 0..=n{let p=pair[0].lerp(pair[1],k as f64/n as f64);cells.insert((b.color,(p.x/5.).floor() as i32,(p.y/5.).floor() as i32));}
            }
        }}
        cells
    };
    let before=sample(original);let after=sample(candidate);
    let mut regions=HashMap::<([u8;3],i32,i32),(usize,usize)>::new();
    for &(color,x,y) in &before{
        let entry=regions.entry((color,x.div_euclid(8),y.div_euclid(8))).or_default();
        entry.0+=1;
        if after.contains(&(color,x,y)){entry.1+=1;}
    }
    regions.values().all(|&(total,covered)|total<8||covered*100>=total*85)
}
fn production_not_worse(original:&Design,candidate:&Design)->bool{
    let (peak,hot)=production_hotspots(original);
    let (next_peak,next_hot)=production_hotspots(candidate);
    let a=measure_stitches(original);let b=measure_stitches(candidate);
    next_peak<=peak.max(24)&&next_hot<=hot
        &&b.long<=a.long&&b.zero<=a.zero&&b.short<=a.short.saturating_add(5)
}
fn optimization_quality(original:&Design,plan:&Design,speed:f64,trim:f64)->OptimizationQuality{
    use std::collections::{HashSet,HashMap};
    let sample=|d:&Design|{
        let mut cells=HashSet::new();let mut density=HashMap::<(i32,i32),usize>::new();
        for block in &d.blocks { for run in &block.runs{
            for p in &run.pts {
                let cell = ((p.x/10.).floor() as i32, (p.y/10.).floor() as i32);
                *density.entry(cell).or_default() += 1;
                // Single-point runs and isolated needle penetrations are also artwork.
                cells.insert((block.color, cell.0, cell.1));
            }
            for pair in run.pts.windows(2){
                let n=(pair[0].dist(pair[1])/5.).ceil().clamp(1.,100.) as usize;
                for k in 0..=n{let p=pair[0].lerp(pair[1],k as f64/n as f64);cells.insert((block.color,(p.x/10.).floor() as i32,(p.y/10.).floor() as i32));}
            }
        }
        }
        (cells,density.values().copied().max().unwrap_or(0))
    };
    let (a,_)=sample(original);let (b,peak)=sample(plan);
    let overlap=a.intersection(&b).count() as f64/a.union(&b).count().max(1) as f64;
    // A small contrasting detail should not disappear inside a large fill.
    let mut totals=HashMap::<[u8;3],(usize,usize)>::new();
    for cell in a.union(&b){let t=totals.entry(cell.0).or_default();t.0+=1;if a.contains(cell)&&b.contains(cell){t.1+=1;}}
    let weakest=totals.values().map(|(n,k)|*k as f64/(*n).max(1) as f64).fold(1.0_f64,f64::min);
    // A disconnected same-thread detail can be lost even when the overall
    // color footprint is almost unchanged. Preserve isolated cells, with
    // one millimetre of tolerance for harmless needle-position changes.
    let isolated_lost=a.difference(&b).any(|&(color,x,y)|{
        let has_original_neighbor=(-2i32..=2).any(|dx|(-2i32..=2).any(|dy|(dx!=0||dy!=0)&&a.contains(&(color,x+dx,y+dy))));
        !has_original_neighbor && !(-1i32..=1).any(|dx|(-1i32..=1).any(|dy|b.contains(&(color,x+dx,y+dy))))
    });
    let overlap=if isolated_lost {0.0} else {overlap.min(weakest)};
    OptimizationQuality{coverage:overlap*100.,density_peak:peak,seconds:optimization_seconds(plan,speed,trim)}
}
// Combine stitch economy with dependency-aware travel ordering. Unlike
// individual trials this can reduce both needle count and trim overhead.
fn combined_economy_candidate(source:&zigzag::document::Document,original:&Design,uids:Option<&[usize]>,options:&SimplifyOptions,level:u8)->Option<(zigzag::document::Document,Design)>{
    if uids.is_some()||options.exhausted(){return None}
    use zigzag::params::Kind;
    if source.shapes.iter().any(|s|s.params.stop==Some(true)||s.params.trim==Some(true)
        ||matches!(s.params.kind,Some(Kind::Manual|Kind::Applique))
        ||source.layer_properties(&s.id).is_some_and(|l|l.locked||l.hidden)){return None}
    let (mut doc,_) = economical_fill_candidate(source,original,None,level,0.)
        .or_else(||economical_fill_candidate(source,original,None,3,0.))
        .unwrap_or_else(||(source.clone(),original.clone()));
    if options.exhausted(){return None}
    doc.settings.hat_order=true;
    doc.sync().ok()?;
    let plan=doc.plan();
    Some((doc,plan))
}
// Explicit appearance-changing preview; never used by conservative optimization.
// Remove repeated narrow interior hatch marks only when a larger same-color
// outline encloses them. Preserve recorded lettering and explicit commands.
fn remove_interior_hatching(source:&zigzag::document::Document,uids:Option<&[usize]>,options:&SimplifyOptions)->Option<zigzag::document::Document>{
 use zigzag::{svg::Geometry,params::Kind};
 let mut doc=source.clone();
 let bounds:Vec<_>=source.shapes.iter().map(|s|zigzag::svg::shapes_bounds(std::slice::from_ref(s))).collect();
 let mut remove=Vec::new();
 for (i,s) in source.shapes.iter().enumerate(){
  if options.exhausted(){return None}
  if !uids.is_none_or(|ids|ids.contains(&s.uid))||source.records_text(i)||source.layer_properties(&s.id).is_some_and(|l|l.hidden||l.locked)||!s.groups.is_empty()||s.params.stop==Some(true)||s.params.trim==Some(true)||s.params.start.is_some()||s.params.end.is_some()||!matches!(s.params.kind,None|Some(Kind::Fill)){continue}
  let Geometry::Fill{rings,rule}=&s.geometry else{continue};
  if zigzag::design::thin_centerline(rings,*rule).is_none(){continue}
  let b=&bounds[i];if b.is_empty()||b.width().max(b.height())<b.width().min(b.height())*3.0{continue}
  let enclosed=source.shapes.iter().enumerate().any(|(j,q)|{
   if i==j||q.color!=s.color||source.records_text(j){return false}
   let a=&bounds[j];
   if a.is_empty()||a.width()<=b.width()*1.5||a.height()<=b.height()*1.5||b.min.x<=a.min.x+5.0||b.max.x>=a.max.x-5.0||b.min.y<=a.min.y+5.0||b.max.y>=a.max.y-5.0{return false}
   // Test the actual enclosing silhouette, not merely its bounding rectangle.
   // The outer ring alone is used so engraved holes do not defeat containment.
   let Geometry::Fill{rings,..}=&q.geometry else{return false};
   let samples=[b.min,b.max,zigzag::geom::P::new(b.min.x,b.max.y),zigzag::geom::P::new(b.max.x,b.min.y),zigzag::geom::P::new((b.min.x+b.max.x)*0.5,(b.min.y+b.max.y)*0.5)];
   rings.iter().any(|ring|samples.iter().all(|&p|zigzag::geom::point_inside(std::slice::from_ref(ring),zigzag::geom::FillRule::EvenOdd,p)))
  });
  if enclosed{
   // Require a repeated local texture, not an isolated stroke or glyph.
   let horizontal=b.width()>b.height();
   let length=b.width().max(b.height());
   let width=b.width().min(b.height()).max(0.1);
   let neighbors=source.shapes.iter().enumerate().filter(|(j,q)|{
    if *j==i||q.color!=s.color||source.records_text(*j)||!q.groups.is_empty(){return false}
    let a=&bounds[*j];if a.is_empty()||(a.width()>a.height())!=horizontal{return false}
    let l=a.width().max(a.height());let w=a.width().min(a.height());
    if l<length*0.55||l>length*1.8||w<width*0.4||w>width*2.0{return false}
    let dx=((a.min.x+a.max.x)-(b.min.x+b.max.x)).abs()*0.5;
    let dy=((a.min.y+a.max.y)-(b.min.y+b.max.y)).abs()*0.5;
    let (along,across)=if horizontal{(dx,dy)}else{(dy,dx)};
    along<length*0.35&&across>width*0.5&&across<width*12.0
     &&matches!(&q.geometry,Geometry::Fill{rings,rule} if zigzag::design::thin_centerline(rings,*rule).is_some())
   }).take(3).count();
   if neighbors>=3{remove.push(i);}
  }
 }
 if remove.len()<4{return None}
 doc.delete_many(&remove).ok()?;doc.sync().ok()?;Some(doc)
}
// Rasterize a bounded editable silhouette for offline lettering protection.
fn simplify_lettering_regions(source:&zigzag::document::Document,options:&SimplifyOptions)->Vec<usize>{
    use zigzag::{geom::{P,point_inside},svg::{Geometry,shapes_bounds}};
    if source.shapes.len()>350||options.exhausted(){return Vec::new()}
    let bounds=shapes_bounds(&source.shapes);
    if bounds.is_empty()||bounds.width()<=0.||bounds.height()<=0.{return Vec::new()}
    let scale=900.0/bounds.width().max(bounds.height());
    let w=(bounds.width()*scale).ceil() as u32+16;
    let h=(bounds.height()*scale).ceil() as u32+16;
    let mut rgba=vec![255u8;w as usize*h as usize*4];
    let boxes:Vec<_>=source.shapes.iter().map(|s|shapes_bounds(std::slice::from_ref(s))).collect();
    for (s,b) in source.shapes.iter().zip(&boxes){
        if options.exhausted(){return Vec::new()}
        let Geometry::Fill{rings,rule}=&s.geometry else{continue};
        if b.is_empty(){continue}
        let x0=((b.min.x-bounds.min.x)*scale+8.).floor().max(0.) as u32;
        let y0=((b.min.y-bounds.min.y)*scale+8.).floor().max(0.) as u32;
        let x1=(((b.max.x-bounds.min.x)*scale+8.).ceil() as u32).min(w-1);
        let y1=(((b.max.y-bounds.min.y)*scale+8.).ceil() as u32).min(h-1);
        for y in y0..=y1{if options.exhausted(){return Vec::new()} for x in x0..=x1{
            let p=P::new(bounds.min.x+(x as f64-8.)/scale,bounds.min.y+(y as f64-8.)/scale);
            if point_inside(rings,*rule,p){let k=(y as usize*w as usize+x as usize)*4;rgba[k..k+3].fill(0);}
        }}
    }
    let Ok(lines)=zigzag::ocr::recognize_rgba(w,h,&rgba) else{return Vec::new()};
    source.shapes.iter().zip(&boxes).filter(|(_,b)|!b.is_empty()&&lines.iter().any(|l|{
        let [x0,y0,x1,y1]=l.rect;
        let pad=(y1-y0)*0.12;
        let x=(b.min.x-bounds.min.x)*scale+8.;
        let y=(b.min.y-bounds.min.y)*scale+8.;
        x>=x0-pad&&y>=y0-pad&&(b.max.x-bounds.min.x)*scale+8.<=x1+pad&&(b.max.y-bounds.min.y)*scale+8.<=y1+pad
    })).map(|(s,_)|s.uid).collect()
}
fn choose_texture_reduction(source:&zigzag::document::Document,original:&Design,uids:Option<&[usize]>,options:&SimplifyOptions)->Result<(zigzag::document::Document,Design),String>{
    let protected_letters=simplify_lettering_regions(source,options);
    let allowed:Vec<_>=source.shapes.iter().filter(|s|uids.is_none_or(|ids|ids.contains(&s.uid))&&!protected_letters.contains(&s.uid)).map(|s|s.uid).collect();
    let uids=if protected_letters.is_empty(){uids}else{Some(allowed.as_slice())};
    if uids.is_some_and(|ids|ids.is_empty()){return Err("No unprotected artwork to simplify".into())}
    let mut mode=options.clone();
    mode.solid=true;mode.merge=true;mode.auto_types=true; // Preserve the foundation unless explicitly requested.
    mode.lighter_underlay=options.lighter_underlay;
    let speed=mode.speed.unwrap_or(800.).clamp(100.,1500.);
    let trim=mode.trim_seconds.unwrap_or(3.).clamp(0.,30.);
    let audit=measure_stitches(original);
    let bounds=original.bounds();
    let eligible=|d:&Design|{
        let q=measure_stitches(d);let b=d.bounds();
        d.stitch_count()>0&&d.stitch_count()<original.stitch_count()
        &&d.trim_count()<=original.trim_count()
        &&optimization_seconds(d,speed,trim)<optimization_seconds(original,speed,trim)
        &&q.long<=audit.long&&q.zero<=audit.zero&&q.short<=audit.short.saturating_add(5)
        &&production_not_worse(original,d)
        &&bounds.min.dist(b.min)<=10.&&bounds.max.dist(b.max)<=10.
        &&optimization_quality(original,d,speed,trim).coverage>=mode.appearance_floor.filter(|v|v.is_finite()).unwrap_or(65.).clamp(65.,100.)
        &&original.blocks.iter().map(|b|b.color).collect::<std::collections::BTreeSet<_>>()
          ==d.blocks.iter().map(|b|b.color).collect::<std::collections::BTreeSet<_>>()
    };
    let mut best=None;
    let hatch=remove_interior_hatching(source,uids,&mode);
    // Compare against the intentionally simplified artwork as well as the
    // original. Decorative marks removed by the hatch detector should not
    // count as missing structural coverage.
    let structural_reference=hatch.as_ref().map(|doc|doc.plan());
    let structural_ok=|d:&Design|structural_reference.as_ref().is_none_or(|reference|optimization_quality(reference,d,speed,trim).coverage>=85.);
    for (attempt,radius) in [24.,18.,32.,12.,40.,8.].into_iter().enumerate() {
        if mode.exhausted(){break}
        let seed=if attempt%2==0{hatch.as_ref().unwrap_or(source)}else{source};
        let mut doc=rebuild_solid_artwork(seed,uids,radius,&mode).unwrap_or_else(||seed.clone());
        if optimize_geometry(&mut doc,&mode,uids,radius).is_err()||mode.exhausted(){continue}
        let plan=doc.plan();
        let mut candidates=vec![(doc.clone(),plan.clone())];
        if !mode.exhausted(){if let Some(v)=simplify_design_candidate(&doc,&plan,3,uids,true){candidates.push(v);}}
        if !mode.exhausted(){if let Some(v)=combined_economy_candidate(&doc,&plan,uids,&mode,5){candidates.push(v);}}
        if !mode.exhausted(){if let Some(v)=economical_fill_candidate(&doc,&plan,uids,5,0.){candidates.push(v);}}
        for (doc,plan) in candidates {
            // A structural candidate must preserve every recorded text object and its geometry.
            let protected=source.shapes.iter().enumerate().filter(|(i,s)|protected_letters.contains(&s.uid)||source.records_text(*i)||s.groups.iter().any(|g|g.starts_with("tl-lettering-")||g=="tl-small-ink-detail")||source.layer_properties(&s.id).is_some_and(|l|l.locked||l.hidden)).all(|(_,s)|doc.shapes.iter().any(|q|q.uid==s.uid&&q.color==s.color&&q.params==s.params&&zigzag::svg::shapes_bounds(std::slice::from_ref(q)).min.dist(zigzag::svg::shapes_bounds(std::slice::from_ref(s)).min)<0.01&&zigzag::svg::shapes_bounds(std::slice::from_ref(q)).max.dist(zigzag::svg::shapes_bounds(std::slice::from_ref(s)).max)<0.01));
            if protected&&structural_ok(&plan)&&eligible(&plan)&&best.as_ref().is_none_or(|(_,old):&(zigzag::document::Document,Design)|(plan.stitch_count() as f64/original.stitch_count().max(1) as f64+optimization_seconds(&plan,speed,trim)/optimization_seconds(original,speed,trim).max(1.))<(old.stitch_count() as f64/original.stitch_count().max(1) as f64+optimization_seconds(old,speed,trim)/optimization_seconds(original,speed,trim).max(1.))){
                best=Some((doc,plan));
            }
        }
        if best.as_ref().is_some_and(|(_,p)|mode.target_stitches.is_some_and(|n|p.stitch_count()<=n)){break}
    }
    best.ok_or("No texture-changing preview passed the coverage and stitch safety checks.".into())
}
fn choose_fast_stitch(source:&zigzag::document::Document,original:&Design,uids:Option<&[usize]>,options:&SimplifyOptions)->Result<(zigzag::document::Document,Design),String>{
    let speed=options.speed.unwrap_or(800.).clamp(100.,1500.);let trim=options.trim_seconds.unwrap_or(3.).clamp(0.,30.);
    let score=|d:&Design|optimization_seconds(d,speed,trim);
    let baseline_seconds=score(original);
    let mut choices=Vec::new();
    if !options.exhausted(){if let Some(v)=automatic_texture_candidate(source,uids,options){choices.push(v);}}
    if !options.exhausted(){if let Some(v)=remove_covered_fill_candidate(source,uids,options){choices.push(v);}}
    if !options.exhausted(){if let Some(v)=narrow_artwork_candidate(source,original,uids,options){choices.push(v);}}
    if let Some(v)=combined_economy_candidate(source,original,uids,options,5){choices.push(v);}
    if !options.exhausted(){if let Some(doc)=union_redundant_fills(source,uids,options){let plan=doc.plan();if uids.is_none()&&!options.exhausted(){if let Some(v)=economical_fill_candidate(&doc,&plan,None,5,0.){choices.push(v);}}choices.push((doc,plan));}}
    for angle in [0.,45.,90.] {
        if options.exhausted(){break}
        if let Some(v)=economical_fill_candidate(source,original,uids,5,angle)
            .or_else(|| economical_fill_candidate(source,original,uids,3,angle)) {
            choices.push(v);
        }
    }
    if !options.exhausted() && uids.is_none() && source.shapes.iter().all(|s|s.params.stop!=Some(true)&&s.params.trim!=Some(true)&&!matches!(s.params.kind,Some(zigzag::params::Kind::Manual|zigzag::params::Kind::Applique))&&!source.layer_properties(&s.id).is_some_and(|l|l.locked||l.hidden)){
        // Reuse dependency-aware ordering, without moving overlapping layers.
        let mut doc=source.clone();doc.settings.hat_order=true;
        if doc.sync().is_ok(){
            let plan=doc.plan();
            choices.push((doc,plan));
        }
    }
    let audit=measure_stitches(original);let bounds=original.bounds();
    choices.retain(|(_,d)|{let b=d.bounds();let q=measure_stitches(d);
        d.stitch_count()>0&&d.stitch_count()<=original.stitch_count()&&score(d)<baseline_seconds&&q.long<=audit.long&&q.zero<=audit.zero&&q.short<=audit.short.saturating_add(5)
        &&d.trim_count()<=original.trim_count()
        &&bounds.min.dist(b.min)<=5.&&bounds.max.dist(b.max)<=5.
        &&original.blocks.iter().map(|b|b.color).eq(d.blocks.iter().map(|b|b.color))
        &&optimization_quality(original,d,speed,trim).coverage>=85.
    });
    choices.sort_by(|a,b|{let gap=|d:&Design|options.target_minutes.filter(|t|t.is_finite()&&*t>0.).map(|t|(score(d)/(t*60.)-1.).max(0.)).unwrap_or(0.)+options.target_stitches.filter(|n|*n>0).map(|n|(d.stitch_count() as f64/n as f64-1.).max(0.)).unwrap_or(0.);gap(&a.1).total_cmp(&gap(&b.1)).then_with(||score(&a.1).total_cmp(&score(&b.1)))});
    choices.into_iter().next().ok_or("No faster eligible stitch plan found".into())
}
/// Join selected shading fragments into a fill at the same layer position.
fn solid_selected_fill(source: &zigzag::document::Document, uids: &[usize], radius: f64, color: Option<[u8; 3]>)
    -> Option<(zigzag::document::Document, usize)>
{
    use zigzag::{boolean, geom::FillRule, params::Kind, svg::Geometry};

    if uids.is_empty() || uids.len() > 96 || (uids.len() < 2 && color.is_none()) { return None; }
    let indices: Vec<_> = source.shapes.iter().enumerate()
        .filter_map(|(index, shape)| uids.contains(&shape.uid).then_some(index)).collect();
    if indices.len() != uids.len() { return None; }
    let first = &source.shapes[indices[0]];
    let mut fill = None;
    let mut areas = Vec::new();
    for &index in &indices {
        let shape = &source.shapes[index];
        if (color.is_none() && shape.color != first.color) || shape.groups != first.groups || source.records_text(index)
            || shape.groups.iter().any(|group| group.starts_with("tl-lettering-") || group == "tl-small-ink-detail")
            || source.layer_properties(&shape.id).is_some_and(|layer| layer.hidden || layer.locked)
            || source.shapes.iter().filter(|part| part.id == shape.id).count() != 1
            || shape.params.stop == Some(true) || shape.params.trim == Some(true)
            || shape.params.colors.is_some() || shape.params.start.is_some() || shape.params.end.is_some()
        { return None; }
        match (&shape.geometry, shape.params.kind.unwrap_or(Kind::Fill)) {
            (Geometry::Fill { rings, rule }, Kind::Fill | Kind::Satin) => {
                fill.get_or_insert(index);
                areas.push((rings.clone(), *rule));
            }
            (Geometry::Stroke { lines, width }, Kind::Run | Kind::Satin) if *width > 0.0 => {
                areas.push((boolean::stroke_area(lines, *width), FillRule::NonZero));
            }
            _ => return None,
        }
    }
    let fill = fill?;
    let union = boolean::pathfinder(&areas, boolean::PathOp::Unite);
    let grown = boolean::offset(&union, FillRule::EvenOdd, radius);
    let closed = boolean::offset(&grown, FillRule::EvenOdd, -radius);
    // Selected fragments can be interleaved with distant lettering. Keep
    // layering intact when a shape between them crosses the resulting fill.
    let mut bounds = zigzag::geom::Bounds::empty();
    closed.iter().flatten().for_each(|&point| bounds.add(point));
    for shape in &source.shapes[indices[0]..=*indices.last()?] {
        if uids.contains(&shape.uid) { continue; }
        let other = zigzag::svg::shapes_bounds(std::slice::from_ref(shape));
        if !other.is_empty() && other.min.x <= bounds.max.x && other.max.x >= bounds.min.x
            && other.min.y <= bounds.max.y && other.max.y >= bounds.min.y
        { return None; }
    }
    let components = |rings: &[zigzag::geom::Polyline]| zigzag::stitch::satin::components(rings, FillRule::EvenOdd);
    let before = components(&union);
    let after = components(&closed);
    let area = |regions: &[Vec<zigzag::geom::Polyline>]| regions.iter().map(|rings| {
        boolean::ring_area(&rings[0]) - rings.iter().skip(1).map(|ring| boolean::ring_area(ring)).sum::<f64>()
    }).sum::<f64>();
    let holes = |regions: &[Vec<zigzag::geom::Polyline>]| regions.iter().flat_map(|rings| rings.iter().skip(1))
        .filter(|ring| boolean::ring_area(ring) >= 100.0).count();
    let old_area = area(&before);
    if after.is_empty() || (color.is_none() && after.len() >= before.len()) || old_area <= 0.0
        || !(old_area * 0.95..=old_area * 1.8).contains(&area(&after)) || holes(&after) < holes(&before)
    { return None; }

    let mut document = source.clone();
    let fill_uid = source.shapes[fill].uid;
    document.set_path(fill, &zigzag::bezier::from_rings(&closed, 0.2)).ok()?;
    let removed: Vec<_> = document.shapes.iter().enumerate().filter_map(|(index, shape)| {
        (shape.uid != fill_uid && uids.contains(&shape.uid)).then_some(index)
    }).collect();
    if removed.len() + 1 != indices.len() { return None; }
    document.delete_many(&removed).ok()?;
    let shape = document.shapes.iter_mut().find(|shape| shape.uid == fill_uid)?;
    shape.params.kind = Some(Kind::Fill);
    if let Some(color) = color { shape.color = color; }
    document.sync().ok()?;
    Some((document, fill_uid))
}

fn choose_silhouette(source:&zigzag::document::Document,original:&Design,uids:Option<&[usize]>,options:&SimplifyOptions)->Result<(zigzag::document::Document,Design),String>{
    let mut candidates=Vec::new();
    let old_bounds=original.bounds();let old_audit=measure_stitches(original);
    let speed=options.speed.filter(|v|v.is_finite()).unwrap_or(800.0).clamp(100.0,1500.0);
    let trim=options.trim_seconds.filter(|v|v.is_finite()).unwrap_or(3.0).clamp(0.0,30.0);
    let seconds=|d:&Design|optimization_seconds(d,speed,trim);
    let radii = if uids.is_some() { [8.0,12.0,16.0] } else { [16.0,12.0,8.0] };
    for radius in radii {
        if options.exhausted(){break}
        let joined = uids.and_then(|ids| solid_selected_fill(source, ids, radius, options.solid_color));
        let (doc, joined_uid) = match joined {
            Some((doc, uid)) => (doc, Some([uid])),
            None => {
                if options.solid_color.is_some() { continue; }
                let Some(doc) = rebuild_solid_artwork(source, uids, radius, options) else { continue };
                (doc, None)
            }
        };
        let fill_scope = joined_uid.as_ref().map(|ids| ids.as_slice()).or(uids);
        let plan=doc.plan();
        // Do not convert the reconstructed artwork back into outline-only
        // paths: this alternative is intended to show a solid fill.
        let mut variants=vec![(doc.clone(),plan.clone())];
        // A merged fill can route into a tight corner at a cardinal angle.
        // Try diagonal rows too, leaving the short-stitch gate in place.
        let angles: &[f64] = if joined_uid.is_some() { &[0.0, 90.0, 30.0, 60.0, 120.0, 150.0] } else { &[0.0, 90.0] };
        for &angle in angles {
            if options.exhausted(){break}
            if let Some(v)=economical_fill_candidate(&doc,&plan,fill_scope,3,angle){variants.push(v);}
        }
        for (d,p) in variants{
            let b=p.bounds();let audit=measure_stitches(&p);
            if p.stitch_count()==0||p.stitch_count()>200_000||p.stitch_count()>original.stitch_count().saturating_mul(2)
                ||p.stitch_count()<original.stitch_count()/3||audit.long>old_audit.long||audit.zero>old_audit.zero
                ||old_bounds.min.dist(b.min)>8.0||old_bounds.max.dist(b.max)>8.0
                ||(options.solid_color.is_none() && !original.blocks.iter().map(|b|b.color).eq(p.blocks.iter().map(|b|b.color))){continue}
            // Stronger visual reconstruction takes precedence over absolute
            // stitch savings. At equal strength choose the fastest plan.
            candidates.push((radius,d,p));
        }
        if uids.is_none() && !candidates.is_empty(){break}
    }
    candidates.sort_by(|a,b| if uids.is_some() {
        let saves_both = |p: &Design| p.stitch_count() < original.stitch_count() && p.trim_count() < original.trim_count();
        saves_both(&b.2).cmp(&saves_both(&a.2))
            .then_with(|| seconds(&a.2).total_cmp(&seconds(&b.2)))
            .then_with(|| b.0.total_cmp(&a.0))
    } else { b.0.total_cmp(&a.0).then_with(||seconds(&a.2).total_cmp(&seconds(&b.2))) });
    candidates.into_iter().next().map(|(_,d,p)|(d,p)).ok_or("No eligible solid silhouette could be reconstructed".into())
}
// Rebuild consecutive ordinary same-thread fills as one union, removing
// overlapping top stitches and duplicated underlay even when density or
// angle differs. Never cross a protected object or a color boundary.
fn union_redundant_fills(source:&zigzag::document::Document,uids:Option<&[usize]>,options:&SimplifyOptions)->Option<zigzag::document::Document>{
    use zigzag::{params::Kind,svg::Geometry,boolean::{self,PathOp},geom::FillRule};
    let mut doc=source.clone();let mut changed=false;let mut i=0;let mut attempts=0;
    while i+1<doc.shapes.len()&&attempts<64&&!options.exhausted(){
        attempts+=1;
        let eligible=|j:usize|{
            let s=&doc.shapes[j];
            uids.is_none_or(|ids|ids.contains(&s.uid))&&!doc.records_text(j)
            &&!doc.layer_properties(&s.id).is_some_and(|l|l.hidden||l.locked)
            &&!s.groups.iter().any(|g|g.starts_with("tl-lettering-")||g=="tl-small-ink-detail")
            &&doc.shapes.iter().filter(|q|q.id==s.id).count()==1
            &&s.params.kind.unwrap_or(Kind::Fill)==Kind::Fill
            &&s.params.start.is_none()&&s.params.end.is_none()&&s.params.colors.is_none()
            &&s.params.stop!=Some(true)&&s.params.trim!=Some(true)
        };
        let a=&doc.shapes[i];let b=&doc.shapes[i+1];
        if !eligible(i)||!eligible(i+1)||a.color!=b.color||a.groups!=b.groups {i+=1;continue}
        // Match all settings other than fill density, length and angle.
        let mut pa=a.params.clone();let mut pb=b.params.clone();
        pa.spacing=None;pb.spacing=None;pa.len=None;pb.len=None;pa.angle=None;pb.angle=None;
        if pa!=pb {i+=1;continue}
        let (Geometry::Fill{rings:ar,rule:af},Geometry::Fill{rings:br,rule:bf})=(&a.geometry,&b.geometry) else{i+=1;continue};
        let parts=[(ar.clone(),*af),(br.clone(),*bf)];
        let overlap=boolean::pathfinder(&parts,PathOp::Intersect);
        if overlap.is_empty(){i+=1;continue}
        let union=boolean::pathfinder(&parts,PathOp::Unite);
        if union.is_empty(){i+=1;continue}
        // Exact boolean union retains the visible silhouette, including holes.
        let path=zigzag::bezier::from_rings(&union,0.2);
        if path.is_empty(){i+=1;continue}
        let second=b.uid;
        doc.set_path(i,&path).ok()?;
        let j=doc.shapes.iter().position(|s|s.uid==second)?;
        doc.delete_many(&[j]).ok()?;changed=true;
    }
    if !changed{return None}
    doc.sync().ok()?;Some(doc)
}
// Reclassify expensive narrow traced fills as centerline runs when the
// existing geometry admits a continuous centerline. This is a production
// reconstruction, not a reduction in row density.
fn narrow_artwork_candidate(source:&zigzag::document::Document,base:&Design,uids:Option<&[usize]>,options:&SimplifyOptions)->Option<(zigzag::document::Document,Design)>{
    use zigzag::{params::Kind,svg::Geometry};
    let mut doc=source.clone();let mut changed=false;
    for i in 0..doc.shapes.len(){
        if options.exhausted(){return None}
        if doc.records_text(i)||doc.layer_properties(&doc.shapes[i].id).is_some_and(|l|l.hidden||l.locked){continue}
        let s=&mut doc.shapes[i];
        if !uids.is_none_or(|ids|ids.contains(&s.uid))||s.groups.iter().any(|g|g.starts_with("tl-lettering-")||g=="tl-small-ink-detail")
            ||s.params.kind.unwrap_or(Kind::Fill)!=Kind::Fill||s.params.trim==Some(true)||s.params.stop==Some(true)
            ||s.params.start.is_some()||s.params.end.is_some()||s.params.colors.is_some()
            ||base.per_shape.get(i).copied().unwrap_or(0)<24 {continue}
        let Geometry::Fill{rings,rule}=&s.geometry else{continue};
        if zigzag::design::thin_centerline(rings,*rule).is_none(){continue}
        s.params.kind=Some(Kind::Run);s.params.border=Some(false);s.params.repeats=Some(1);s.params.len=Some(2.0);
        changed=true;
    }
    if !changed{return None}
    doc.sync().ok()?;
    let plan=doc.plan();
    Some((doc,plan))
}
// Remove hidden duplicate stitching without changing the visible artwork.
// Only subtract portions covered by a later ordinary fill of the same
// thread. Keep the upper layer intact and avoid crossing protected layers.
fn remove_covered_fill_candidate(source:&zigzag::document::Document,uids:Option<&[usize]>,options:&SimplifyOptions)->Option<(zigzag::document::Document,Design)>{
    use zigzag::{params::Kind,svg::Geometry,boolean::{self,PathOp},geom::FillRule};
    let mut doc=source.clone();let mut edits=Vec::new();let mut remove=Vec::new();
    let eligible=|i:usize|{
        let s=&source.shapes[i];
        uids.is_none_or(|ids|ids.contains(&s.uid))&&!source.records_text(i)
        &&!source.layer_properties(&s.id).is_some_and(|l|l.hidden||l.locked)
        &&!s.groups.iter().any(|g|g.starts_with("tl-lettering-")||g=="tl-small-ink-detail")
        &&source.shapes.iter().filter(|q|q.id==s.id).count()==1
        &&s.params.kind.unwrap_or(Kind::Fill)==Kind::Fill
        &&s.params.start.is_none()&&s.params.end.is_none()&&s.params.colors.is_none()
        &&s.params.stop!=Some(true)&&s.params.trim!=Some(true)
    };
    // Use an inset cover so neighboring edges retain a small overlap.
    let mut attempts=0;
    for i in 0..source.shapes.len(){
        if options.exhausted()||attempts>=64{break}
        if !eligible(i){continue}
        let a=&source.shapes[i];
        let Geometry::Fill{rings:ar,rule:af}=&a.geometry else{continue};
        let ab=zigzag::svg::shapes_bounds(std::slice::from_ref(a));
        let mut covers=Vec::new();
        for j in i+1..(i+12).min(source.shapes.len()){
            let b=&source.shapes[j];
            if !eligible(j)||a.color!=b.color||a.groups!=b.groups{break}
            // Open fills are not opaque masks; preserve the original editable base.
            let fabric=zigzag::params::Fabric::by_id(&source.settings.fabric).or_else(||zigzag::params::Fabric::by_id("standard"))?;
            if b.params.fill_spacing(&fabric)>0.65{break}
            let bb=zigzag::svg::shapes_bounds(std::slice::from_ref(b));
            if ab.min.x>bb.max.x||ab.max.x<bb.min.x||ab.min.y>bb.max.y||ab.max.y<bb.min.y{continue}
            if let Geometry::Fill{rings,rule}=&b.geometry{covers.push((rings.clone(),*rule));}
        }
        if covers.is_empty(){continue}
        attempts+=1;
        let union=boolean::pathfinder(&covers,PathOp::Unite);
        let inset=boolean::offset(&union,FillRule::EvenOdd,-3.0);
        if inset.is_empty(){continue}
        let parts=[(ar.clone(),*af),(inset,FillRule::EvenOdd)];
        let overlap=boolean::pathfinder(&parts,PathOp::Intersect);
        if overlap.is_empty(){continue}
        let area=|rings:&[zigzag::geom::Polyline],rule|zigzag::stitch::satin::components(rings,rule).iter().map(|c|boolean::ring_area(&c[0]).abs()-c.iter().skip(1).map(|h|boolean::ring_area(h).abs()).sum::<f64>()).sum::<f64>();
        let old=area(ar,*af);
        if old<=0.||area(&overlap,FillRule::EvenOdd)<old*0.20{continue}
        let remaining=boolean::pathfinder(&parts,PathOp::MinusFront);
        if remaining.is_empty(){remove.push((a.uid,old));continue}
        let saved=old-area(&remaining,FillRule::EvenOdd);
        if saved<old*0.20{continue}
        let path=zigzag::bezier::from_rings(&remaining,0.2);
        if !path.is_empty(){edits.push((i,path,saved));}
    }
    if edits.is_empty()&&remove.is_empty(){return None}
    // Simultaneous subtraction could leave gaps if the later cover were
    // also edited. Process only one lower layer per candidate.
    edits.sort_by(|a,b|b.2.total_cmp(&a.2));remove.sort_by(|a,b|b.1.total_cmp(&a.1));
    if remove.first().is_some_and(|r|edits.first().is_none_or(|e|r.1>e.2)){
        let uid=remove[0].0;let i=doc.shapes.iter().position(|s|s.uid==uid)?;doc.delete_many(&[i]).ok()?;
    }else if let Some((i,path,_))=edits.into_iter().next(){doc.set_path(i,&path).ok()?;}
    doc.sync().ok()?;let plan=doc.plan();Some((doc,plan))
}
// A bounded automatic texture pass: close narrow scratches and merge
// adjacent same-thread fragments, then let the actual stitch plan decide
// whether this is an improvement. Never discard whole decorative objects.
fn automatic_texture_candidate(source:&zigzag::document::Document,uids:Option<&[usize]>,options:&SimplifyOptions)->Option<(zigzag::document::Document,Design)>{
    if options.exhausted(){return None}
    let mut mode=options.clone();mode.solid=true;mode.merge=true;mode.auto_types=false;mode.lighter_underlay=false;
    let mut doc=rebuild_solid_artwork(source,uids,6.0,&mode).unwrap_or_else(||source.clone());
    if mode.exhausted(){return None}
    optimize_geometry(&mut doc,&mode,uids,4.0).ok()?;
    if doc.xml==source.xml||mode.exhausted(){return None}
    let plan=doc.plan();
    Some((doc,plan))
}
fn choose_simplification(source:&zigzag::document::Document,original:&Design,strength:u8,uids:Option<&[usize]>,remove_detail:bool,options:&SimplifyOptions)->Result<(zigzag::document::Document,Design),String>{
        let speed=options.speed.filter(|v|v.is_finite()).unwrap_or(800.0).clamp(100.0,1500.0);
        let trim=options.trim_seconds.filter(|v|v.is_finite()).unwrap_or(3.0).clamp(0.0,30.0);
        let seconds=|d:&Design|optimization_seconds(d,speed,trim);
        let target=options.target_minutes.filter(|v|v.is_finite()&&*v>0.0).map(|v|v*60.0);
        let stitch_goal=options.target_stitches.or_else(||(original.stitch_count()>15_000).then_some(10_000));
        let before=measure_stitches(original);let a=original.bounds();let baseline_seconds=seconds(original);
        let baseline_peak=optimization_quality(original,original,speed,trim).density_peak;
        let (_, original_hotspots)=production_hotspots(original);
        let nearest_rejection = std::cell::Cell::new((usize::MAX, "No cheaper stitch plan was found for the eligible artwork."));
        let reject = |d: &Design, reason: &'static str| {
            if d.stitch_count() < nearest_rejection.get().0 {
                nearest_rejection.set((d.stitch_count(), reason));
            }
            false
        };
        let eligible = |d: &Design| {
            if d.stitch_count() == 0 { return false; }
            if d.stitch_count() > original.stitch_count() || seconds(d) >= baseline_seconds {
                return reject(d, "The available preview did not improve stitch count and estimated sewing time.");
            }
            if d.trim_count() > original.trim_count() || !original.blocks.iter().map(|b|b.color).eq(d.blocks.iter().map(|b|b.color)) {
                return reject(d, "A cheaper plan changed the thread order or added trims.");
            }
            let after = measure_stitches(d);
            if after.long > before.long || after.zero > before.zero || after.short > before.short.saturating_add(5) {
                return reject(d, "A cheaper plan increased short, long, or repeated needle penetrations.");
            }
            let b = d.bounds();
            if a.min.dist(b.min) > 5.0 || a.max.dist(b.max) > 5.0 {
                return reject(d, "A cheaper plan moved the design edges by more than 0.5 mm.");
            }
            let threshold = if strength == 1 { 95. } else if strength == 2 { 90. } else { 85. };
            let quality=optimization_quality(original,d,speed,trim);
            // Allow minor cell-boundary variation, but do not trade lower
            // total stitch counts for substantially worse local congestion.
            if quality.density_peak>baseline_peak.saturating_add(3).max(baseline_peak.saturating_mul(110)/100) {
                return reject(d, "A cheaper plan increased peak needle density.");
            }
            if quality.coverage < threshold {
                return reject(d, "A cheaper plan changed too much of the visible stitch footprint.");
            }
            // Global coverage can conceal missing strokes in a small glyph.
            if !local_coverage_preserved(original,d) {
                return reject(d, "A cheaper plan lost local coverage in lettering or small artwork.");
            }
            let (_, candidate_hotspots)=production_hotspots(d);
            if candidate_hotspots>original_hotspots {
                return reject(d, "A cheaper plan created additional concentrated needle-density hotspots.");
            }
            true
        };
        let mut candidates=Vec::new();
        if !options.exhausted() {
            if let Some(candidate) = length_only_candidate(source,original,uids,strength) {
                candidates.push(candidate);
            }
        }
        if options.quick {
            if strength==3 {
                if let Some(goal)=stitch_goal.filter(|goal|*goal<original.stitch_count()) {
                    // Try the original geometry first. A fast trim or texture
                    // candidate can score well after one pass but leave less
                    // room for larger reductions than the unchanged outlines.
                    let mut seed=None;
                    for _ in 0..3 {
                        if options.exhausted(){break}
                        let (doc,plan)=seed.as_ref().map_or((source,original),|(doc,plan)|(doc,plan));
                        let Some((next_doc,next_plan))=economical_fill_candidate(doc,plan,uids,4,0.)
                            .or_else(||economical_fill_candidate(doc,plan,uids,3,0.)) else {break};
                        if seconds(&next_plan)>=seconds(plan)||!eligible(&next_plan){break}
                        if next_plan.stitch_count()<=goal&&target.is_none_or(|t|seconds(&next_plan)<=t) {
                            return Ok((next_doc,next_plan));
                        }
                        seed=Some((next_doc,next_plan));
                    }
                    if let Some(variant)=seed{candidates.push(variant);}
                }
            }
            if !options.exhausted(){if let Some(v)=economical_fill_candidate(source,original,uids,strength,0.0){candidates.push(v);}}
            if strength==3&&!options.exhausted(){if let Some(v)=remove_covered_fill_candidate(source,uids,options){candidates.push(v);}if !options.exhausted(){if let Some(v)=narrow_artwork_candidate(source,original,uids,options){candidates.push(v);}}}
            if strength==3 && original.stitch_count()>=12_000 {
                if !options.exhausted(){if let Some(v)=automatic_texture_candidate(source,uids,options){candidates.push(v);}}
                if let Some(v)=combined_economy_candidate(source,original,uids,options,4){candidates.push(v);}
                if !options.exhausted(){if let Some(v)=economical_fill_candidate(source,original,uids,4,0.0){candidates.push(v);}}
                if !options.exhausted(){
                    if let Some(doc)=union_redundant_fills(source,uids,options){
                        let plan=doc.plan();
                        if !options.exhausted(){if let Some(v)=economical_fill_candidate(&doc,&plan,None,4,0.0){if uids.is_none(){candidates.push(v);}}}
                        candidates.push((doc,plan));
                    }
                }
            }
        }else{
        if !options.exhausted(){
            if strength==3{if let Some(v)=remove_covered_fill_candidate(source,uids,options){candidates.push(v);}}
            if strength>=2{if let Some(v)=narrow_artwork_candidate(source,original,uids,options){candidates.push(v);}}
            if let Some(v)=simplify_design_candidate(source,original,strength,uids,remove_detail){candidates.push(v);}
            if strength==3{if let Some(doc)=union_redundant_fills(source,uids,options){let plan=doc.plan();if uids.is_none()&&!options.exhausted(){if let Some(v)=economical_fill_candidate(&doc,&plan,None,4,0.){candidates.push(v);}}candidates.push((doc,plan));}}
        }
        if options.solid||options.merge||options.auto_types||options.lighter_underlay{
            let radii:&[f64]=if options.solid&&strength>=3{&[4.0,8.0,12.0]}else if options.solid&&strength==2{&[2.0,4.0]}else{&[2.0]};
            for &radius in radii{
                if options.exhausted(){break}
                let mut geometry=source.clone();
                if optimize_geometry(&mut geometry,options,uids,radius).is_ok() && !options.exhausted(){
                    let plan=geometry.plan();
                    if let Some(v)=simplify_design_candidate(&geometry,&plan,strength,uids,false){candidates.push(v);}
                    candidates.push((geometry,plan));
                }
            }
        }
        if strength>=2{
            for angle in [0.0,45.0,90.0]{
                if options.exhausted(){break}
                let level=if strength==3{4}else{strength};
                if let Some(v)=economical_fill_candidate(source,original,uids,level,angle)
                    .or_else(|| economical_fill_candidate(source,original,uids,strength,angle)) {candidates.push(v);}
            }
        }
        if strength==3&&options.solid{
            for radius in [5.0,8.0,12.0]{
                if options.exhausted(){break}
                if let Some(mut doc)=rebuild_solid_artwork(source,uids,radius,options){
                    if optimize_geometry(&mut doc,options,uids,4.0).is_ok() && !options.exhausted(){
                        let plan=doc.plan();
                        for angle in [0.0,90.0]{
                            if options.exhausted(){break}
                            if let Some(v)=economical_fill_candidate(&doc,&plan,uids,3,angle){candidates.push(v);}
                        }
                        candidates.push((doc,plan));
                    }
                }
            }
        }
        }
        if options.quick && candidates.is_empty() && !options.exhausted()
            && source.shapes.iter().any(|s| s.params.kind == Some(zigzag::params::Kind::Manual))
        {
            if let Some(candidate) = simplify_design_candidate(source, original, strength, uids, false) {
                candidates.push(candidate);
            }
        }
        candidates.retain(|(_,d)|eligible(d));
        candidates.sort_by(|(_,a),(_,b)|{
            let rank=|d:&Design|{
                let time_gap=target.map(|t|(seconds(d)/t-1.).max(0.)).unwrap_or(0.);
                let stitch_gap=stitch_goal.filter(|n|*n>0).map(|n|(d.stitch_count() as f64/n as f64-1.).max(0.)).unwrap_or(0.);
                (time_gap+stitch_gap,seconds(d))
            };
            let a=rank(a);let b=rank(b);a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1))
        });
        let (mut doc,mut design)=candidates.into_iter().next().ok_or_else(|| {
            if options.exhausted() && nearest_rejection.get().0 == usize::MAX {
                "The search reached its time limit before it found an eligible plan."
            } else { nearest_rejection.get().1 }
        })?;
        if strength==3 {
            // Refine the winning plan, not the original. Each accepted step
            // must independently pass the original-design quality guard.
            // Revisit expensive overlap first, then fill economy; stop at
            // the requested goals or the existing cooperative deadline.
            for stage in 0..4 {
                if options.exhausted(){break}
                if stitch_goal.is_some_and(|n|design.stitch_count()<=n)
                    &&target.is_none_or(|t|seconds(&design)<=t){break}
                let candidate=match stage{
                    0=>remove_covered_fill_candidate(&doc,uids,options),
                    1=>economical_fill_candidate(&doc,&design,uids,4,0.),
                    2=>narrow_artwork_candidate(&doc,&design,uids,options),
                    _=>economical_fill_candidate(&doc,&design,uids,3,0.),
                };
                let Some((next_doc,next_plan))=candidate else {continue};
                if next_plan.stitch_count()>design.stitch_count()||next_plan.trim_count()>design.trim_count()
                    ||seconds(&next_plan)>=seconds(&design)||!eligible(&next_plan){continue}
                (doc,design)=(next_doc,next_plan);
            }
        }
        Ok((doc,design))
}
#[tauri::command]
async fn simplify_current_design(strength:u8,uids:Option<Vec<usize>>,remove_detail:Option<bool>,options:Option<SimplifyOptions>,app:tauri::AppHandle)->Result<Preview,String>{
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move||{
        let state=app.state::<Mutex<Workspace>>();
        let mut w=state.lock().map_err(|e|e.to_string())?;
        let original=w.current.as_ref().ok_or("Open a design first")?;
        let source=editable_base(&w,"Simplified design")?;
        if let Some(ids)=&uids{if ids.is_empty()||ids.iter().any(|id|!source.shapes.iter().any(|s|s.uid==*id)){return Err("Select valid objects first".into())}}
        let options=options.unwrap_or_default();
        let (doc,design)=choose_simplification(&source,original,strength,uids.as_deref(),remove_detail.unwrap_or(false),&options)?;
        let result=preview(&design);
        w.checkpoint_named("Simplify design");w.source=Some(doc);w.current=Some(design);Ok(result)
    }).await.map_err(|e|e.to_string())?
}
struct SimplifyDraft {
    id:u64, original:Design, source_xml:Option<String>,
    variants:Vec<(u8,zigzag::document::Document,Design)>,
}
#[derive(serde::Serialize)]
struct SimplifyVariant { artwork_svg:Option<String>, strength:u8, plan:Option<Preview>, reason:Option<String>, quality:Option<OptimizationQuality> }
#[derive(serde::Serialize)]
struct SimplifyReview { id:u64, variants:Vec<SimplifyVariant>, limited: bool }
fn same_stitch_plan(a:&Design,b:&Design)->bool{
    a.name==b.name&&a.blocks.len()==b.blocks.len()&&a.blocks.iter().zip(&b.blocks).all(|(x,y)|x.color==y.color&&x.runs.len()==y.runs.len()&&x.runs.iter().zip(&y.runs).all(|(p,q)|p.trim_before==q.trim_before&&p.pts==q.pts))
}
#[tauri::command]
async fn preview_simplification(uids:Option<Vec<usize>>,remove_detail:Option<bool>,options:Option<SimplifyOptions>,request_id:Option<u64>,previous_id:Option<u64>,app:tauri::AppHandle)->Result<SimplifyReview,String>{
    use tauri::Manager;
    let request_id = request_id.unwrap_or(0);
    let budget = SimplifyBudget::new(std::time::Duration::from_secs(10));
    {
        let state = app.state::<Mutex<Workspace>>();
        let mut workspace = state.lock().map_err(|e| e.to_string())?;
        if request_id != 0 && request_id <= workspace.cancelled_simplify_request {
            return Err("Optimization cancelled".into());
        }
        if workspace.simplify_job.is_some() {
            return Err("The previous preview is still stopping. Try again in a moment.".into());
        }
        workspace.simplify_job = Some((request_id, budget.clone()));
    }
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move||{
        let state=worker_app.state::<Mutex<Workspace>>();
        let (original,source,source_xml)={let w=state.lock().map_err(|e|e.to_string())?;
        if budget.is_cancelled(){return Err("Optimization cancelled".into())}
        (w.current.clone().ok_or("Open a design first")?,editable_base(&w,"Simplified design")?,w.source.as_ref().map(|d|d.xml.clone()))};
        if let Some(ids)=&uids{if ids.is_empty()||ids.iter().any(|id|!source.shapes.iter().any(|s|s.uid==*id)){return Err("Select valid objects first".into())}}
        let mut options=options.unwrap_or_default();
        options.budget = Some(budget.clone());
        let mut variants=Vec::new();let mut stored=Vec::new();
        let strengths: &[u8] = if options.solid_only { &[4] }
            else if options.texture_reduction { &[6] }
            else if options.goal_search { &[5, 4, 3, 2] }
            else if options.quick { &[2, 3] }
            else if previous_id.is_some() { &[5, 4] }
            else { &[2, 3, 5, 4, 1] };
        for (index, &strength) in strengths.iter().enumerate() {
            if options.exhausted() { break; }
            let mut mode = options.clone();
            // Reserve a share for each remaining strategy so one slow pass
            // cannot consume the whole preview window.
            let now = std::time::Instant::now();
            let share = budget.deadline.saturating_duration_since(now) / (strengths.len() - index) as u32;
            mode.budget = Some(SimplifyBudget {
                deadline: now + share,
                cancelled: budget.cancelled.clone(),
            });
            if strength>=4{
                match if strength==6{choose_texture_reduction(&source,&original,uids.as_deref(),&mode)}else if strength==4{choose_silhouette(&source,&original,uids.as_deref(),&mode)}else{choose_fast_stitch(&source,&original,uids.as_deref(),&mode)}{
                    Ok((doc,design))=>{variants.push(SimplifyVariant{artwork_svg:doc.to_svg().ok(),strength,plan:Some(preview(&design)),reason:None,quality:Some(optimization_quality(&original,&design,options.speed.unwrap_or(800.),options.trim_seconds.unwrap_or(3.)))});stored.push((strength,doc,design));}
                    Err(reason)=>variants.push(SimplifyVariant{artwork_svg:None,strength,plan:None,reason:Some(reason),quality:None})
                }
                continue
            }
            if strength==1{mode.solid=false;mode.lighter_underlay=false;mode.merge=false;mode.auto_types=false;}
            if strength==2{mode.lighter_underlay=false;}
            if strength==3{mode.solid=true;mode.merge=true;mode.auto_types=true;}
            match choose_simplification(&source,&original,strength,uids.as_deref(),strength>1&&remove_detail.unwrap_or(false),&mode){
                Ok((doc,design))=>{variants.push(SimplifyVariant{artwork_svg:doc.to_svg().ok(),strength,plan:Some(preview(&design)),reason:None,quality:Some(optimization_quality(&original,&design,options.speed.unwrap_or(800.),options.trim_seconds.unwrap_or(3.)))});stored.push((strength,doc,design));}
                Err(reason)=>variants.push(SimplifyVariant{artwork_svg:None,strength,plan:None,reason:Some(reason),quality:None})
            }
        }
        let mut w=state.lock().map_err(|e|e.to_string())?;
        if budget.is_cancelled(){return Err("Optimization cancelled".into())}
        if !w.current.as_ref().is_some_and(|d|same_stitch_plan(d,&original))||w.source.as_ref().map(|d|d.xml.clone())!=source_xml{return Err("Design changed during optimization".into())}
        if let Some(previous_id) = previous_id {
            let previous = w.simplify_draft.as_mut().filter(|draft| draft.id == previous_id
                && same_stitch_plan(&draft.original,&original) && draft.source_xml == source_xml)
                .ok_or("The design changed. Generate fresh previews.")?;
            previous.variants.retain(|(strength, _, _)| !stored.iter().any(|entry| entry.0 == *strength));
            stored.append(&mut previous.variants);
        }
        variants.sort_by_key(|variant| variant.strength);
        let id = previous_id.unwrap_or_else(|| {
            w.next_draft_id = w.next_draft_id.wrapping_add(1);
            w.next_draft_id
        });
        w.simplify_draft=Some(SimplifyDraft{id,original,source_xml,variants:stored});
        Ok(SimplifyReview{id,variants,limited:budget.exhausted()})
    }).await;
    let state = app.state::<Mutex<Workspace>>();
    let mut workspace = state.lock().map_err(|e| e.to_string())?;
    workspace.simplify_job = None;
    result.map_err(|e|e.to_string())?
}
#[tauri::command]
fn cancel_simplification(request_id: u64, state: tauri::State<'_, Mutex<Workspace>>) -> Result<(), String> {
    let mut workspace = state.lock().map_err(|e| e.to_string())?;
    workspace.cancelled_simplify_request = workspace.cancelled_simplify_request.max(request_id);
    if let Some((_, budget)) = workspace.simplify_job.as_ref().filter(|(id, _)| *id == request_id) {
        budget.cancel();
    }
    Ok(())
}
#[tauri::command]
fn apply_simplification(id:u64,strength:u8,state:tauri::State<'_,Mutex<Workspace>>)->Result<Preview,String>{
    let mut w=state.lock().map_err(|e|e.to_string())?;
    let draft=w.simplify_draft.take().ok_or("Generate simplification previews first")?;
    if draft.id!=id||!w.current.as_ref().is_some_and(|d|same_stitch_plan(d,&draft.original))||w.source.as_ref().map(|d|&d.xml)!=draft.source_xml.as_ref(){return Err("The design changed. Generate fresh previews.".into())}
    let (_,doc,design)=draft.variants.into_iter().find(|(n,_,_)|*n==strength).ok_or("Choose an available preview")?;
    let result=preview(&design);w.checkpoint_named("Simplify design");w.source=Some(doc);w.current=Some(design);Ok(result)
}
#[tauri::command]
async fn optimize_editable_design(app:tauri::AppHandle)->Result<Preview,String>{
 use tauri::Manager;
 tauri::async_runtime::spawn_blocking(move||{
  let state=app.state::<Mutex<Workspace>>();
  let mut w=state.lock().map_err(|e|e.to_string())?;
  let source=w.source.as_ref().ok_or("Open editable artwork to optimize density")?;
  let original=w.current.as_ref().ok_or("Open artwork first")?;
  let (source,design)=optimized_density(source,original).ok_or("No conservative density improvement passed the checks. Original design retained.")?;
  let result=preview(&design);w.checkpoint_named("Optimize density");w.source=Some(source);w.current=Some(design);Ok(result)
 }).await.map_err(|e|e.to_string())?
}
// Balance only flagged glyph-like objects, preserving source outlines and explicit settings.
fn balance_lettering_density(source:&zigzag::document::Document,original:&Design)->Option<(zigzag::document::Document,Design)>{
    use zigzag::params::Kind;
    use zigzag::svg::Geometry;
    if source.shapes.len()>350||original.stitch_count()>100_000{return None}
    let issues=|d:&zigzag::document::Document,p:&Design|zigzag::checks::check(&d.shapes,p,&d.plan_options(),None);
    let before=issues(source,original);
    let flagged:Vec<_>=before.iter().filter(|i|i.message.starts_with("Possible inconsistent lettering density:")).filter_map(|i|i.shape).collect();
    if flagged.is_empty(){return None}
    let fabric=source.plan_options().fabric;
    let bounds=|s:&zigzag::svg::Shape|{let Geometry::Fill{rings,..}=&s.geometry else{return None};let mut b=zigzag::geom::Bounds::empty();for &p in rings.iter().flatten(){b.add(p);}if b.is_empty(){None}else{Some(b)}};
    let spacing=|s:&zigzag::svg::Shape|if s.params.kind==Some(Kind::Satin){s.params.satin_spacing(&fabric)}else{s.params.fill_spacing(&fabric)};
    let mut targets=Vec::new();
    for &i in &flagged{
        let s=source.shapes.get(i)?;
        if source.layer_properties(&s.id).is_some_and(|l|l.locked||l.hidden)
            ||s.params.stop==Some(true)||s.params.trim==Some(true)||s.params.colors.is_some()||!(0.30..=0.65).contains(&spacing(s)){continue}
        let Some(b)=bounds(s) else{continue};
        let mut peers=Vec::new();
        for (j,q) in source.shapes.iter().enumerate(){
            if i==j||flagged.contains(&j)||q.color!=s.color||q.params.kind.unwrap_or(Kind::Fill)!=s.params.kind.unwrap_or(Kind::Fill){continue}
            if source.layer_properties(&q.id).is_some_and(|l|l.hidden)||q.params.colors.is_some()||!(0.30..=0.65).contains(&spacing(q)){continue}
            let Some(c)=bounds(q) else{continue};
            if c.height()>=b.height()*0.8&&c.height()<=b.height()*1.25&&c.width()<=c.height()*1.8&&(c.center().y-b.center().y).abs()<=b.height()*0.2&&(c.center().x-b.center().x).abs()<=b.height()*4.0{peers.push(spacing(q));}
        }
        if peers.len()<3{continue}
        peers.sort_by(|a,b|a.total_cmp(b));
        let target=peers[peers.len()/2];
        if target.is_finite()&&(0.30..=0.65).contains(&target){
            let existing=spacing(s);
            // Limit each repair to a modest adjustment, including explicit spacing.
            if existing.is_finite()&&existing>0.0{
                targets.push((i,existing,target.clamp(existing*0.8,existing*1.25).clamp(0.30,0.65)));
            }
        }
    }
    if targets.is_empty(){return None}
    let count=|v:&[zigzag::checks::Issue]|v.iter().filter(|i|i.message.starts_with("Possible inconsistent lettering density:")).count();
    let mut best=None;
    // Compare partial and full corrections; a smaller adjustment can preserve
    // narrow glyphs better than forcing every letter to the peer median.
    for strength in [0.5,0.75,1.0] {
        let mut trial=source.clone();
        for &(i,existing,target) in &targets{
            trial.shapes[i].params.spacing=Some(existing+(target-existing)*strength);
        }
        if trial.sync().is_err(){continue}
        let plan=trial.plan();
        let after=issues(&trial,&plan);
        let n=count(&after);
        if n>=count(&before)||after.iter().any(|i|i.level!=zigzag::checks::Level::Info&&!before.iter().any(|j|j.shape==i.shape&&j.message==i.message))
            ||!production_not_worse(original,&plan)||!local_coverage_preserved(original,&plan)
            ||plan.stitch_count()>original.stitch_count().saturating_mul(125)/100
            ||plan.trim_count()>original.trim_count()
            ||!original.blocks.iter().map(|b|b.color).eq(plan.blocks.iter().map(|b|b.color))
            ||original.per_shape.len()!=plan.per_shape.len()
            ||!original.per_shape.iter().zip(&plan.per_shape).all(|(&a,&b)|a==0||b>0)
            ||validate_resized_design(&plan).is_err(){continue}
        if best.as_ref().is_none_or(|(_,old,k):&(zigzag::document::Document,Design,usize)|n<*k||(n==*k&&plan.stitch_count()<old.stitch_count())){
            best=Some((trial,plan,n));
        }
    }
    best.map(|(doc,plan,_)|(doc,plan))
}
fn repair_artwork_coverage(document:&zigzag::document::Document,design:&Design)->Option<(zigzag::document::Document,Design)>{
        if design.stitch_count()<=100_000 && document.shapes.len()<=350 {
            let gaps=|doc:&zigzag::document::Document,p:&Design|{
                zigzag::checks::check(&doc.shapes,p,&doc.plan_options(),None).into_iter()
                    .filter(|i|i.message.starts_with("Possible underfilled artwork:")).filter_map(|i|i.shape).collect::<Vec<_>>()
            };
            let flagged=gaps(&document,&design);
            // Compare the actual sampled missing fraction as well as warning
            // count, so a repair can improve a glyph without crossing the
            // warning threshold in one step.
            let gap_score=|doc:&zigzag::document::Document,p:&Design|{
                let (samples,complete)=zigzag::checks::coverage_gap_scan(&doc.shapes,p,&doc.plan_options());
                let score=samples.iter().map(|g|g.missing as f64/(g.inside.max(1) as f64)).sum::<f64>();
                (score,complete)
            };
            let (baseline_gap,baseline_complete)=gap_score(document,design);
            if !flagged.is_empty(){
                let baseline=measure_stitches(&design);
                let mut best=None;
                for (factor,angle_offset,pull_extra,foundation) in [(0.90,0.0,0.0,false),(0.80,0.0,0.0,false),(1.0,45.0,0.0,false),(1.0,90.0,0.0,false),(0.90,45.0,0.0,false),(1.0,0.0,0.05,false),(1.0,0.0,0.10,false),(1.0,0.0,0.0,true),(0.90,0.0,0.05,true)] {
                    let mut trial=(*document).clone();
                    let fabric=trial.plan_options().fabric;
                    for &i in &flagged {
                        if trial.shapes.get(i).is_some_and(|s|trial.layer_properties(&s.id).is_some_and(|l|l.locked||l.hidden)){continue}
                        if let Some(s)=trial.shapes.get_mut(i){
                            use zigzag::params::Kind;
                            let spacing=match s.params.kind.unwrap_or(Kind::Fill){
                                Kind::Fill=>s.params.fill_spacing(&fabric),
                                Kind::Satin=>s.params.satin_spacing(&fabric),
                                _=>continue,
                            };
                            // Open decorative fills and manually programmed stops
                            // are intentional, not missing coverage.
                            if spacing>0.65||s.params.stop==Some(true)||s.params.trim==Some(true)||s.params.colors.is_some(){continue}
                            if pull_extra>0.0&&s.params.pull.is_none(){
                                let base=if s.params.kind==Some(Kind::Satin){s.params.satin_pull(&fabric)}else{s.params.fill_pull(&fabric)};
                                s.params.pull=Some((base+pull_extra).min(base.max(0.45)));
                            }
                            if foundation&&s.params.underlay.is_none(){s.params.underlay=Some(true);}
                            if factor<1.0{s.params.spacing=Some((spacing*factor).max(0.30).min(spacing));}
                            if angle_offset!=0.0&&s.params.kind.unwrap_or(Kind::Fill)==Kind::Fill&&s.params.angle.is_none(){s.params.angle=Some((s.params.fill_angle()+angle_offset).rem_euclid(180.0));}
                        }
                    }
                    if trial.sync().is_err(){continue}
                    let p=trial.plan();
                    let audit=measure_stitches(&p);
                    let remaining=gaps(&trial,&p);
                    let (score,complete)=gap_score(&trial,&p);
                    if baseline_complete&&complete&&score+0.01<baseline_gap
                        &&remaining.len()<=flagged.len()&&remaining.iter().all(|i|flagged.contains(i))
                        &&p.stitch_count()<=design.stitch_count().saturating_mul(125)/100
                        &&audit.long<=baseline.long&&audit.zero<=baseline.zero
                        &&production_not_worse(design,&p)
                        &&local_coverage_preserved(design,&p)
                        &&p.trim_count()<=design.trim_count()
                        &&design.blocks.iter().map(|b|b.color).eq(p.blocks.iter().map(|b|b.color))
                        &&design.per_shape.len()==p.per_shape.len()
                        &&design.per_shape.iter().zip(&p.per_shape).all(|(&a,&b)|a==0||b>0)
                        &&validate_resized_design(&p).is_ok()
                        &&best.as_ref().is_none_or(|(_,old,n,old_score):&(zigzag::document::Document,Design,usize,f64)|remaining.len()<*n||(remaining.len()==*n&&(score+0.001<*old_score||((score-*old_score).abs()<=0.001&&p.stitch_count()<old.stitch_count())))){
                        best=Some((trial,p,remaining.len(),score));
                    }
                }
                if let Some((next,p,_,_))=best{return Some((next,p));}
            }
        }
    None
}
// Use the same repair sequence for preview, application and initial digitizing.
fn repair_artwork_quality(source:&zigzag::document::Document,original:&Design)->Option<(zigzag::document::Document,Design)>{
    let coverage=repair_artwork_coverage(source,original);
    if let Some((doc,plan))=coverage{
        if let Some((balanced,next))=balance_lettering_density(&doc,&plan){
            if next.stitch_count()<=original.stitch_count().saturating_mul(125)/100
                &&production_not_worse(original,&next)
                &&local_coverage_preserved(&plan,&next){
                return Some((balanced,next));
            }
        }
        return Some((doc,plan));
    }
    balance_lettering_density(source,original)
}
#[derive(serde::Serialize)]
struct CoverageRepairPreview {
    id: u64,
    before: Preview,
    after: Preview,
    warnings_before: usize,
    warnings_after: usize,
    lettering_before: usize,
    lettering_after: usize,
}
#[tauri::command]
async fn preview_coverage_repair(lettering_only: Option<bool>, app: tauri::AppHandle)->Result<CoverageRepairPreview,String>{
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move||{
        let state=app.state::<Mutex<Workspace>>();
        let tabs=app.state::<Mutex<workspace_tabs::WorkspaceTabs>>();
        let (tab,source,original)={
            let tabs=tabs.lock().map_err(|e|e.to_string())?;
            let w=state.lock().map_err(|e|e.to_string())?;
            (tabs.active().to_owned(),w.source.clone().ok_or("Coverage repair requires editable artwork.")?,
                w.current.clone().ok_or("Open artwork first")?)
        };
        let source_svg=source.to_svg().map_err(|e|e.to_string())?;
        let lettering_only=lettering_only.unwrap_or(false);
        let repair=if lettering_only {balance_lettering_density(&source,&original)} else {repair_artwork_quality(&source,&original)};
        let (next,plan)=repair.ok_or(if lettering_only {"No safe lettering consistency adjustment found."} else {"No safe coverage or lettering improvement found."})?;
        validate_resized_design(&plan)?;
        let count=|doc:&zigzag::document::Document,p:&Design|{
            let issues=zigzag::checks::check(&doc.shapes,p,&doc.plan_options(),None);
            (issues.iter().filter(|i|i.message.starts_with("Possible underfilled artwork:")).count(),
                issues.iter().filter(|i|i.message.starts_with("Possible inconsistent lettering density:")).count())
        };
        let (warnings_before,lettering_before)=count(&source,&original);
        let (warnings_after,lettering_after)=count(&next,&plan);
        let (before,after)=(preview(&original),preview(&plan));
        let tabs=tabs.lock().map_err(|e|e.to_string())?;
        let mut w=state.lock().map_err(|e|e.to_string())?;
        if tabs.active()!=tab.as_str()||!density_repair::matches_source(&w,&original,&source_svg){
            return Err("The design changed. Generate a new repair preview.".into());
        }
        let label=if lettering_only {"Balance lettering density"} else {"Repair artwork coverage"};
        let id=density_repair::stage(&mut w,original,source_svg,next,plan,label);
        Ok(CoverageRepairPreview{id,before,after,warnings_before,warnings_after,lettering_before,lettering_after})
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn repair_stitches(state:tauri::State<'_,Mutex<Workspace>>)->Result<Preview,String>{
 let mut w=state.lock().map_err(|e|e.to_string())?;
 // Repair editable artwork through its source, never by flattening the plan.
 if let Some(source)=w.source.clone(){
   let original=w.current.as_ref().ok_or("Open artwork first")?;
   let (doc,design)=repair_artwork_quality(&source,original)
     .or_else(||optimized_density(&source,original))
     .or_else(|| {
       let mut regenerated=source.clone();
       regenerated.sync().ok()?;
       let plan=regenerated.plan();
       validate_resized_design(&plan).ok()?;
       let before=measure_stitches(original);let after=measure_stitches(&plan);
       if after.long<before.long && after.short<=before.short && after.zero<=before.zero
         && plan.trim_count()<=original.trim_count()
         && original.blocks.iter().map(|b|b.color).eq(plan.blocks.iter().map(|b|b.color))
         && optimization_quality(original,&plan,800.,3.).coverage>=95.0 {Some((regenerated,plan))}else{None}
     })
     .ok_or("No safe automatic repair found. Adjust individual stitch settings for other issues.")?;
   validate_resized_design(&design)?;
   let result=preview(&design);
   w.checkpoint_named("Repair editable artwork");
   w.source=Some(doc);w.current=Some(design);
   return Ok(result)
 }
 let mut d=w.current.clone().ok_or("Open artwork first")?;
 let mut total=0usize;
 for run in d.blocks.iter_mut().flat_map(|b|&mut b.runs){
   if run.pts.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) { return Err("Invalid stitch geometry: non-finite coordinate".into()); }
   let mut out=Vec::with_capacity(run.pts.len());
   for p in run.pts.iter().copied(){
     if let Some(last)=out.last().copied(){
       let last:zigzag::geom::P=last;
       let distance=(p.x-last.x).hypot(p.y-last.y);
       // Preserve coincident penetrations: they may be intentional ties.
       let n=(distance/100.0).ceil().max(1.0);
       if !n.is_finite()||n>10000.0{return Err("Invalid stitch geometry".into())}
       if total.saturating_add(out.len()).saturating_add(n as usize)>2_000_000{return Err("Repair exceeds stitch limit".into())}
       for k in 1..n as usize{let t=k as f64/n;out.push(zigzag::geom::P::new(last.x+(p.x-last.x)*t,last.y+(p.y-last.y)*t));}
     }
     out.push(p);
     if out.len()>2000000{return Err("Repair exceeds stitch limit".into())}
   }
   total+=out.len();if total>2000000{return Err("Repair exceeds stitch limit".into())}
   run.pts=out;
 }
 let result=preview(&d);if d.stitch_count()!=w.current.as_ref().unwrap().stitch_count(){w.checkpoint_named("Repair fixed stitches");w.current=Some(d);}Ok(result)
}
fn place_design(workspace: &mut Workspace, matrix: [f64; 6]) -> Result<Preview, String> {
    if matrix.iter().any(|v| !v.is_finite()) { return Err("Placement contains invalid coordinates".into()); }
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
        if !point.x.is_finite() || !point.y.is_finite() { return Err("Placement exceeds the supported coordinate range".into()); }
    }
    let result = preview(&design);
    workspace.checkpoint_named("Change placement");
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
    const ARTWORK: [&str; 9] = ["svg", "png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "tif"];
    let types: Vec<_> = formats::READABLE_FORMATS.into_iter().chain(ARTWORK).collect();
    let Some(path) = rfd::AsyncFileDialog::new()
        .add_filter("Artwork and embroidery designs", &types)
        .add_filter("Embroidery designs", &formats::READABLE_FORMATS)
        .add_filter("Artwork and images", &ARTWORK)
        .pick_file().await else { return Ok(None); };
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
    if design.stitch_count() > 2_000_000 { return Err("Design exceeds the two million stitch export safety limit. Split the design before exporting.".into()); }
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
        let trim_outside = encoded_stream.iter().flatten()
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
async fn export_multiple_formats(selected_formats:Vec<String>,width:f64,height:f64,state:tauri::State<'_,Mutex<Workspace>>) -> Result<usize,String>{
 let design=state.lock().map_err(|e|e.to_string())?.current.clone().ok_or("Open artwork first")?;
 let mut selected_formats=selected_formats;
 selected_formats.sort();selected_formats.dedup();
 if selected_formats.is_empty()||selected_formats.len()>6{return Err("Choose one to six formats".into())}
 let encoded=tauri::async_runtime::spawn_blocking(move||->Result<Vec<(String,Vec<u8>)>,String>{
  selected_formats.into_iter().map(|format|{validate_export(&design,&format,width,height)?;let bytes=formats::write_format(&design,&format).map_err(|e|e.to_string())?;Ok((format,bytes))}).collect()
 }).await.map_err(|e|e.to_string())??;
 let Some(folder)=rfd::AsyncFileDialog::new().pick_folder().await else{return Ok(0)};
 let folder=folder.path().to_owned();
 tauri::async_runtime::spawn_blocking(move||->Result<usize,String>{
  use std::io::Write;
  let targets:Vec<_>=encoded.iter().map(|(ext,_)|folder.join(format!("design.{ext}"))).collect();
  if targets.iter().any(|p|p.exists()){return Err("Export files already exist. Choose an empty folder.".into())}
  let mut created=Vec::new();
  for (target,(_,bytes)) in targets.iter().zip(encoded){
   let result=(||->std::io::Result<()>{let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(target)?;created.push(target.clone());file.write_all(&bytes)?;file.sync_all()})();
   if let Err(e)=result{for p in created{let _=std::fs::remove_file(p);}return Err(format!("Batch export failed: {e}"))}
  }
  Ok(targets.len())
 }).await.map_err(|e|e.to_string())?
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
async fn current_preview(app: tauri::AppHandle) -> Result<Option<Preview>,String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let workspace = state.lock().map_err(|err| err.to_string())?;
        Ok(workspace.current.as_ref().map(preview))
    }).await.map_err(|err| err.to_string())?
}
#[tauri::command]
fn history_step(redo:bool,state:tauri::State<'_,Mutex<Workspace>>) -> Result<Preview,String> {
 let mut w=state.lock().map_err(|e|e.to_string())?;
 let next=if redo {w.redo.pop()} else {w.undo.pop()}.ok_or("No more history")?;
 let label=if redo {w.redo_labels.pop()}else{w.undo_labels.pop()}.unwrap_or_else(||"Edit design".into());
 let (design,source)=next;
 let previous_source=std::mem::replace(&mut w.source,source);
 if let Some(old)=w.current.replace(design){if redo {w.undo.push((old,previous_source));w.undo_labels.push(label)}else{w.redo.push((old,previous_source));w.redo_labels.push(label)}}
 Ok(preview(w.current.as_ref().ok_or("No design")?))
}
#[tauri::command]
async fn history_labels(app: tauri::AppHandle) -> Result<(Vec<String>, Vec<String>), String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let w=state.lock().map_err(|e|e.to_string())?;
        Ok((w.undo_labels.clone(),w.redo_labels.clone()))
    }).await.map_err(|err| err.to_string())?
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
        Ok(Some(LibraryEntry { file:path.to_string_lossy().into_owned(), name:project.name, stitches:project.blocks.iter().flat_map(|b|&b.runs).map(|r|r.points.len()).sum(), colors:project.blocks.len(), width:project.width,height:project.height,modified:std::fs::metadata(&path).ok().and_then(|m|m.modified().ok()).and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_secs()).unwrap_or(0),created:std::fs::metadata(&path).ok().and_then(|m|m.created().ok()).and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_secs()) }))
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
    workspace.checkpoint_named("Load template");
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
 let paths=if folder{let Some(p)=rfd::AsyncFileDialog::new().pick_folder().await else{return Ok(0)};vec![p.path().to_owned()]}else{let Some(p)=rfd::AsyncFileDialog::new().add_filter("Embroidery designs",&formats::READABLE_FORMATS).pick_files().await else{return Ok(0)};p.into_iter().map(|p|p.path().to_owned()).collect()};
 let dir=personal_design_dir(&app)?;
 tauri::async_runtime::spawn_blocking(move||->Result<usize,String>{
 let mut stack=paths;let mut count=0;let mut visited=0;
 while let Some(p)=stack.pop(){visited+=1;if visited>50000||count>=2000{break}
 let Ok(meta)=std::fs::symlink_metadata(&p) else{continue};if meta.file_type().is_symlink(){continue}
 if meta.is_dir(){if let Ok(entries)=std::fs::read_dir(&p){stack.extend(entries.flatten().map(|e|e.path()))}continue}
 let ext=p.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase();
 if !meta.is_file()||meta.len()>20_000_000||!formats::READABLE_FORMATS.contains(&ext.as_str()){continue}
 let Ok(bytes)=std::fs::read(&p) else{continue};if formats::read::read_stitch_file(&bytes,&ext).map(|f|f.blocks.is_empty()).unwrap_or(true){continue}
 let stem=p.file_stem().unwrap_or_default().to_string_lossy();
 for n in 0..1000{let name=if n==0{format!("{stem}.{ext}")}else{format!("{stem} ({n}).{ext}")};let dest=dir.join(name);
 match std::fs::OpenOptions::new().write(true).create_new(true).open(&dest){Ok(mut f)=>{use std::io::Write;if let Err(e)=f.write_all(&bytes){let _=std::fs::remove_file(&dest);return Err(e.to_string())}count+=1;break},Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists=>{if std::fs::read(&dest).ok().as_deref()==Some(bytes.as_slice()){break}},Err(e)=>return Err(e.to_string())}
 }}Ok(count)
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn insert_embroidery(x_mm:f64,y_mm:f64,file:Option<String>,bytes:Option<Vec<u8>>,name:Option<String>,app:tauri::AppHandle,state:tauri::State<'_,Mutex<Workspace>>)->Result<Option<Preview>,String>{
 if ![x_mm,y_mm].iter().all(|v|v.is_finite()&&v.abs()<=500.0){return Err("Invalid placement".into())}
 if let Some(bytes)=bytes {
     if bytes.len()>20_000_000 {return Err("Design exceeds 20 MB".into());}
     let name=name.ok_or("Missing design filename")?;
     let (label,svg)=tauri::async_runtime::spawn_blocking(move || -> Result<_,String>{
         let path=std::path::Path::new(&name);
         let ext=path.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase();
         let design=formats::read::read_stitch_file(&bytes,&ext).map_err(|e|e.to_string())?;
         if design.blocks.is_empty(){return Err("No stitches found".into());}
         Ok((path.file_stem().and_then(|s|s.to_str()).unwrap_or("Imported design").to_owned(),formats::read::to_svg(&design)))
     }).await.map_err(|e|e.to_string())??;
     let mut workspace=state.lock().map_err(|e|e.to_string())?;
     return insert_editable_artwork(&mut workspace,&svg,&label,x_mm,y_mm,false).map(Some);
 }
 let from_library = file.is_some();
 let path=if let Some(name)=file{let p=std::path::Path::new(&name);if p.components().count()!=1||!matches!(p.components().next(),Some(std::path::Component::Normal(_))){return Err("Invalid design filename".into())}personal_design_dir(&app)?.join(p)}else{let Some(path)=rfd::AsyncFileDialog::new().add_filter("Embroidery designs",&formats::READABLE_FORMATS).pick_file().await else{return Ok(None)};path.path().to_owned()};
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

// Native vector insertion for bundled and user-supplied artwork. Size the visible
// outline rather than the SVG viewport, retaining editable paths and thread colors.
fn insert_vector_artwork(workspace:&mut Workspace,svg:&str,name:&str,width_mm:f64,x_mm:f64,y_mm:f64)->Result<Preview,String>{
 if !(5.0..=250.0).contains(&width_mm)||![x_mm,y_mm].iter().all(|v|v.is_finite()&&v.abs()<=500.0){return Err("Invalid artwork dimensions or placement".into())}
 let mut doc=editable_base(workspace,name)?;
 let added=doc.add_svg(svg,zigzag::document::Placement{width_mm:Some(width_mm),center_mm:Some((x_mm,y_mm)),..Default::default()}).map_err(|e|e.to_string())?;
 if added.is_empty(){return Err("Artwork contains no editable objects".into())}
 for i in added{if doc.shapes[i].params.kind.is_none(){zigzag::design::auto_stitch_types(std::slice::from_mut(&mut doc.shapes[i]));}}
 doc.sync().map_err(|e|e.to_string())?;
 let design=doc.plan();
 if !(1..=2_000_000).contains(&design.stitch_count()) {return Err("Artwork produced no stitches or exceeds the design size limit".into())}
 let result=preview(&design);
 workspace.checkpoint_named("Insert vector artwork");
 workspace.current=Some(design);workspace.source=Some(doc);
 Ok(result)
}
#[tauri::command]
async fn insert_svg_artwork(bytes:Vec<u8>,name:String,width_mm:f64,x_mm:f64,y_mm:f64,app:tauri::AppHandle)->Result<Preview,String>{
 use tauri::Manager;
 if bytes.is_empty()||bytes.len()>20_000_000{return Err("Invalid SVG artwork size".into())}
 tauri::async_runtime::spawn_blocking(move||{
  let svg=std::str::from_utf8(&bytes).map_err(|e|e.to_string())?;
  let state=app.state::<Mutex<Workspace>>();let mut w=state.lock().map_err(|e|e.to_string())?;
  insert_vector_artwork(&mut w,svg,&name,width_mm,x_mm,y_mm)
 }).await.map_err(|e|e.to_string())?
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
    workspace.checkpoint_named("Insert artwork");
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
fn plan_artwork_style(mut doc:zigzag::document::Document,uids:&[usize],style:&str)->Result<(zigzag::document::Document,Design),String>{
 use zigzag::params::Kind;
 let (spacing,length,kind)=match style{"lightweight"=>(0.55,3.5,Kind::Fill),"standard"=>(0.40,3.0,Kind::Fill),"detailed"=>(0.35,2.5,Kind::Fill),"sketch"=>(1.4,2.5,Kind::Ripple),"vintage"=>(0.4,2.0,Kind::Run),"applique"=>(0.4,2.5,Kind::Applique),_=>return Err("Unknown artwork stitch style".into())};
 if kind==Kind::Applique && uids.len()!=1{return Err("Select one fabric region for appliqué".into())}
 let eligible:std::collections::HashSet<_>=doc.shapes.iter().enumerate().filter(|(i,s)| (uids.is_empty()||uids.contains(&s.uid)) && !doc.records_text(*i) && !s.groups.iter().any(|g|g.starts_with("tl-lettering-")||g=="tl-small-ink-detail") && !doc.layer_properties(&s.id).is_some_and(|l|l.locked||l.hidden) && s.params.stop!=Some(true) && s.params.trim!=Some(true) && s.params.colors.is_none() && (s.params.kind.unwrap_or(Kind::Fill)==Kind::Fill || (uids.contains(&s.uid) && matches!(s.params.kind,Some(Kind::Ripple|Kind::Run|Kind::Applique)) && kind==Kind::Fill)) && matches!(&s.geometry,zigzag::svg::Geometry::Fill{..})).map(|(_,s)|s.uid).collect();
 if eligible.is_empty(){return Err("No eligible editable fill regions selected".into())}
 for shape in &mut doc.shapes{if eligible.contains(&shape.uid){shape.params.spacing=Some(spacing);shape.params.len=Some(length);shape.params.kind=Some(kind);match kind{Kind::Ripple=>{shape.params.spiral=Some(false);},Kind::Run=>{shape.params.border=Some(true);shape.params.repeats=Some(3);},Kind::Applique=>{shape.params.width=Some(2.5);},_=>{}}}}
 doc.sync().map_err(|e|e.to_string())?;
 let design=doc.plan();validate_resized_design(&design)?;
 Ok((doc,design))
}
#[tauri::command]
async fn preview_artwork_styles(uids:Vec<usize>,app:tauri::AppHandle)->Result<Vec<(String,Result<Preview,String>)>,String>{
 use tauri::Manager;
 tauri::async_runtime::spawn_blocking(move||{
 let state=app.state::<Mutex<Workspace>>();
 let doc={let w=state.lock().map_err(|e|e.to_string())?;w.source.clone().ok_or("Open editable artwork first")?};
 let mut results=Vec::new();
 for style in ["lightweight","standard","detailed","sketch","vintage","applique"]{
 if matches!(style,"sketch"|"vintage"|"applique") && uids.is_empty(){continue}
 if style=="applique"&&uids.len()!=1{continue}
 results.push((style.to_string(),plan_artwork_style(doc.clone(),&uids,style).map(|(_,design)|preview(&design))));
 }
 Ok(results)
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn apply_artwork_density_preset(uids:Vec<usize>,style:String,app:tauri::AppHandle)->Result<Preview,String>{
 use tauri::Manager;
 tauri::async_runtime::spawn_blocking(move||{
 let state=app.state::<Mutex<Workspace>>();
 let mut w=state.lock().map_err(|e|e.to_string())?;
 let doc=w.source.clone().ok_or("Open editable artwork first")?;
 let (doc,design)=plan_artwork_style(doc,&uids,&style)?;
 let result=preview(&design);w.checkpoint_named("Change artwork stitch style");w.source=Some(doc);w.current=Some(design);Ok(result)
 }).await.map_err(|e|e.to_string())?
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
 let p=preview(&d);w.checkpoint_named("Change stitch properties");w.current=Some(d);w.source=Some(doc);Ok(p)
}
#[tauri::command]
fn get_routing_settings(state:tauri::State<'_,Mutex<Workspace>>)->Result<serde_json::Value,String>{
 let w=state.lock().map_err(|e|e.to_string())?;
 let doc=w.source.as_ref().ok_or("Open editable artwork first")?;
 Ok(serde_json::json!({"hatOrder":doc.settings.hat_order,"connectMm":doc.settings.connect_mm,"removeOverlaps":doc.settings.remove_overlaps}))
}
#[tauri::command]
fn set_routing_settings(hat_order:bool,connect_mm:f64,remove_overlaps:bool,state:tauri::State<'_,Mutex<Workspace>>)->Result<Preview,String>{
 if !(0.0..=5.0).contains(&connect_mm){return Err("Connection distance must be 0–5 mm".into())}
 let mut w=state.lock().map_err(|e|e.to_string())?;
 let mut doc=w.source.clone().ok_or("Open editable artwork first")?;
 if doc.shapes.iter().any(|s|doc.layer_properties(&s.id).is_some_and(|l|l.locked)){return Err("Unlock artwork before changing global routing".into())}
 doc.settings.hat_order=hat_order;doc.settings.connect_mm=connect_mm;doc.settings.remove_overlaps=remove_overlaps;
 doc.sync().map_err(|e|e.to_string())?;
 let design=doc.plan();validate_resized_design(&design)?;
 let result=preview(&design);w.checkpoint_named("Change sewing routing");w.source=Some(doc);w.current=Some(design);Ok(result)
}
#[tauri::command]
fn get_specialty_settings(uid:usize,state:tauri::State<'_,Mutex<Workspace>>) -> Result<serde_json::Value,String>{
 let w=state.lock().map_err(|e|e.to_string())?;
 let doc=w.source.as_ref().ok_or("No editable artwork")?;
 let p=&doc.shapes.iter().find(|s|s.uid==uid).ok_or("Object not found")?.params;
 Ok(serde_json::json!({"width":p.width,"split":p.split,"repeats":p.repeats,"cell":p.cell,"spiral":p.spiral,"border":p.border,"short_stitches":p.short_stitches,"start":p.start,"end":p.end,"satin_underlay":p.satin_underlay,"colors":p.colors,"sett":p.sett,"spacing":p.spacing,"length":p.len,"angle":p.angle,"pull":p.pull,"underlay":p.underlay}))
}
#[derive(serde::Deserialize)]
struct SpecialtySettings {
 satin_underlay:Option<u8>,style:Option<String>,colors:Option<Vec<[u8;3]>>,sett:Option<Vec<([u8;3],f64)>>,
 width:Option<f64>,split:Option<f64>,repeats:Option<u32>,cell:Option<f64>,
 spiral:Option<bool>,border:Option<bool>,short_stitches:Option<bool>,
 start:Option<f64>,end:Option<f64>,
}
#[tauri::command]
fn set_specialty_settings(uids:Vec<usize>,settings:SpecialtySettings,state:tauri::State<'_,Mutex<Workspace>>) -> Result<Preview,String>{
 let style=match settings.style.as_deref(){Some(s)=>Some(zigzag::stitch::satin::SatinStyle::parse(s).ok_or("Unknown satin style")?),None=>None};
 if settings.satin_underlay.is_some_and(|v|v>7)||settings.colors.as_ref().is_some_and(|v|v.len()>8)||settings.sett.as_ref().is_some_and(|v|v.len()>12||v.iter().any(|(_,w)|!(0.5..=20.0).contains(w))){return Err("Invalid specialty pattern".into())}
 if settings.width.is_some_and(|v|!(0.2..=20.0).contains(&v))
 ||settings.split.is_some_and(|v|!(0.0..=12.0).contains(&v))
 ||settings.repeats.is_some_and(|v|v!=1&&v!=3)
 ||settings.cell.is_some_and(|v|!(0.5..=10.0).contains(&v))
 ||[settings.start,settings.end].into_iter().flatten().any(|v|!(0.0..=1.0).contains(&v)){return Err("Invalid specialty stitch settings".into())}
 let mut w=state.lock().map_err(|e|e.to_string())?;
 let mut doc=w.source.clone().ok_or("No editable artwork")?;
 let ids:std::collections::HashSet<_>=uids.into_iter().collect();
 let indices:Vec<_>=doc.shapes.iter().enumerate().filter(|(_,s)|ids.contains(&s.uid)).map(|(i,_)|i).collect();
 if ids.is_empty()||indices.len()!=ids.len(){return Err("Select valid artwork".into())}
 for &i in &indices {
 let s=&doc.shapes[i];
 if doc.layer_properties(&s.id).is_some_and(|l|l.locked||l.hidden)||s.params.kind==Some(zigzag::params::Kind::Manual){return Err("Select unlocked generated artwork".into())}
 }
 for i in indices {
 let p=&mut doc.shapes[i].params;
 if let Some(v)=settings.satin_underlay{p.satin_underlay=Some(v);p.underlay=Some(v!=0);}
 if let Some(v)=style.clone(){p.style=Some(v);}
 if let Some(v)=&settings.colors{p.colors=if v.is_empty(){None}else{Some(v.clone())};}
 if let Some(v)=&settings.sett{p.sett=if v.is_empty(){None}else{Some(v.clone())};}
 if settings.width.is_some(){p.width=settings.width;}
 if settings.split.is_some(){p.split=settings.split;}
 if settings.repeats.is_some(){p.repeats=settings.repeats;}
 if settings.cell.is_some(){p.cell=settings.cell;}
 if settings.spiral.is_some(){p.spiral=settings.spiral;}
 if settings.border.is_some(){p.border=settings.border;}
 if settings.short_stitches.is_some(){p.short_stitches=settings.short_stitches;}
 if settings.start.is_some(){p.start=settings.start;}
 if settings.end.is_some(){p.end=settings.end;}
 }
 let design=doc.plan_cached(&mut w.plan_cache);validate_resized_design(&design)?;
 let result=preview(&design);w.checkpoint_named("Specialty stitch settings");w.source=Some(doc);w.current=Some(design);Ok(result)
}
#[tauri::command]
fn copy_stitch_properties(source_uid:usize,uids:Vec<usize>,state:tauri::State<'_,Mutex<Workspace>>) -> Result<Preview,String>{
 let mut w=state.lock().map_err(|e|e.to_string())?;
 let mut doc=w.source.clone().ok_or("No editable artwork")?;
 let source=doc.shapes.iter().find(|s|s.uid==source_uid).ok_or("Source object no longer exists")?.params.clone();
 let ids:std::collections::HashSet<_>=uids.into_iter().filter(|id|*id!=source_uid).collect();
 if ids.is_empty(){return Err("Select destination objects first".into())}
 let indices:Vec<_>=doc.shapes.iter().enumerate().filter(|(_,s)|ids.contains(&s.uid)).map(|(i,_)|i).collect();
 if indices.len()!=ids.len(){return Err("Selection changed".into())}
 for &i in &indices {
  let shape=&doc.shapes[i];
  if doc.layer_properties(&shape.id).is_some_and(|l|l.locked||l.hidden)||shape.params.kind==Some(zigzag::params::Kind::Manual){return Err("Select unlocked visible generated artwork".into())}
 }
 for i in indices {
  let p=&mut doc.shapes[i].params;
  p.spacing=source.spacing;p.len=source.len;p.angle=source.angle;p.pull=source.pull;p.underlay=source.underlay;
 }
 let design=doc.plan_cached(&mut w.plan_cache);
 validate_resized_design(&design)?;
 let p=preview(&design);w.checkpoint_named("Copy stitch properties");w.source=Some(doc);w.current=Some(design);Ok(p)
}
#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum SewingCommand {
    AddTrim,
    AddStop,
    AddBoth,
    AutomaticTrim,
    AutomaticStop,
    AutomaticBoth,
}

impl SewingCommand {
    fn apply(self, params: &mut zigzag::params::Params) {
        match self {
            Self::AddTrim => params.trim = Some(true),
            Self::AddStop => params.stop = Some(true),
            Self::AddBoth => {
                params.trim = Some(true);
                params.stop = Some(true);
            }
            Self::AutomaticTrim => params.trim = None,
            Self::AutomaticStop => params.stop = None,
            Self::AutomaticBoth => {
                params.trim = None;
                params.stop = None;
            }
        }
    }
}

#[cfg(test)]
#[test]
fn setting_trim_and_stop_independently_preserves_the_other_command() {
    let mut params = zigzag::params::Params::default();
    SewingCommand::AddTrim.apply(&mut params);
    SewingCommand::AddStop.apply(&mut params);
    assert_eq!((params.trim, params.stop), (Some(true), Some(true)));
    SewingCommand::AutomaticTrim.apply(&mut params);
    assert_eq!((params.trim, params.stop), (None, Some(true)));
    SewingCommand::AddBoth.apply(&mut params);
    SewingCommand::AutomaticStop.apply(&mut params);
    assert_eq!((params.trim, params.stop), (Some(true), None));
    SewingCommand::AutomaticBoth.apply(&mut params);
    assert_eq!((params.trim, params.stop), (None, None));
}

#[tauri::command]
fn set_sewing_commands(uids:Vec<usize>,action:SewingCommand,state:tauri::State<'_,Mutex<Workspace>>) -> Result<Preview,String>{
 let mut w=state.lock().map_err(|e|e.to_string())?;
 let mut doc=w.source.clone().ok_or("No editable artwork")?;
 let ids:std::collections::HashSet<_>=uids.into_iter().collect();
 if ids.is_empty(){return Err("Select artwork first".into())}
 let indices:Vec<_>=doc.shapes.iter().enumerate().filter(|(_,s)|ids.contains(&s.uid)).map(|(i,_)|i).collect();
 if indices.len()!=ids.len(){return Err("Selection changed".into())}
 for &i in &indices {
   if doc.layer_properties(&doc.shapes[i].id).is_some_and(|l|l.locked||l.hidden){return Err("Unlock and show selected artwork first".into())}
 }
 for i in indices { action.apply(&mut doc.shapes[i].params); }
 let design=doc.plan_cached(&mut w.plan_cache);
 validate_resized_design(&design)?;
 let p=preview(&design);w.checkpoint_named("Change sewing commands");w.source=Some(doc);w.current=Some(design);Ok(p)
}
#[derive(serde::Serialize)]
struct EditableObject {
    uid: usize,
    groups: Vec<String>,
    label: String,
    locked: bool,
    hidden: bool,
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
        locked: false,
        hidden: false,
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
async fn reorder_artwork_object(uid:usize,direction:String,target_uid:Option<usize>,app:tauri::AppHandle)->Result<Preview,String>{
 use tauri::Manager;
 tauri::async_runtime::spawn_blocking(move||{
    let state=app.state::<Mutex<Workspace>>();
    let mut w=state.lock().map_err(|e|e.to_string())?;
    let mut doc=w.source.clone().ok_or("No editable artwork")?;
    let i=doc.shapes.iter().position(|s|s.uid==uid).ok_or("Object not found")?;
    let last=doc.shapes.len()-1;
    let to=match direction.as_str(){"earlier"=>i.saturating_sub(1),"later"=>(i+1).min(last),"first"=>0,"last"=>last,"before"|"after"=>{
        let target=target_uid.ok_or("Missing destination")?;
        let j=doc.shapes.iter().position(|s|s.uid==target).ok_or("Destination not found")?;
        if j==i { i } else {
            j-usize::from(j>i)+usize::from(direction=="after")
        }
    },_=>return Err("Unknown sewing order action".into())};
    if i==to{return Ok(preview(w.current.as_ref().ok_or("No design")?))}
    let shape=doc.shapes.remove(i);doc.shapes.insert(to,shape);
    // Manual order must not be silently overridden by the automatic planner.
    doc.settings.hat_order=false;
    doc.sync().map_err(|e|e.to_string())?;
    let design=doc.plan_cached(&mut w.plan_cache);
    if design.stitch_count()==0{return Err("Reordering produced no stitches".into())}
    let result=preview(&design);w.checkpoint_named("Change sewing order");w.source=Some(doc);w.current=Some(design);Ok(result)
 }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
async fn editable_objects(app: tauri::AppHandle) -> Result<Vec<EditableObject>, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let workspace = state.lock().map_err(|error| error.to_string())?;
        let Some(document) = &workspace.source else { return Ok(Vec::new()); };
        let wrappers = document.artwork_wrapper_groups();
        Ok(document.shapes.iter().filter_map(|shape| {
            let mut object = editable_object(shape)?;
            if let Some(group) = wrappers.get(&shape.id) {
                if !object.groups.contains(group) { object.groups.push(group.clone()); }
            }
            if let Some(layer) = document.layer_properties(&shape.id) {
                object.locked = layer.locked;
                object.hidden = layer.hidden;
                if let Some(name) = &layer.name {
                    object.label = name.clone();
                }
            }
            Some(object)
        }).collect())
    }).await.map_err(|err| err.to_string())?
}

#[tauri::command]
async fn set_artwork_layer(
    uid: usize,
    name: Option<String>,
    locked: Option<bool>,
    hidden: Option<bool>,
    app: tauri::AppHandle,
) -> Result<Preview, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let mut workspace = state.lock().map_err(|error| error.to_string())?;
        let mut document = workspace.source.clone().ok_or("No editable artwork")?;
        let current = workspace.current.as_ref().ok_or("No design")?;
        let index = document.shapes.iter().position(|shape| shape.uid == uid).ok_or("Object not found")?;
        let previous = document.layer_properties(&document.shapes[index].id).cloned().unwrap_or_default();
        let mut properties = previous.clone();
        if let Some(name) = name { properties.name = Some(name.trim().to_owned()); }
        if let Some(locked) = locked { properties.locked = locked; }
        if let Some(hidden) = hidden { properties.hidden = hidden; }
        if properties == previous { return Ok(preview(current)); }

        let visibility_changed = properties.hidden != previous.hidden;
        let label = if visibility_changed {
            if properties.hidden { "Hide object from sewing" } else { "Show object in sewing" }
        } else if properties.locked != previous.locked {
            if properties.locked { "Lock object" } else { "Unlock object" }
        } else {
            "Rename layer"
        };
        document.set_layer_properties(index, properties).map_err(|error| error.to_string())?;
        let plan = if visibility_changed {
            document.plan_cached(&mut workspace.plan_cache)
        } else {
            current.clone()
        };
        if plan.stitch_count() == 0 {
            return Err("Keep at least one stitchable layer visible".into());
        }
        let result = preview(&plan);
        workspace.checkpoint_named(label);
        workspace.source = Some(document);
        workspace.current = Some(plan);
        Ok(result)
    }).await.map_err(|error| error.to_string())?
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
    if document.layer_properties(&document.shapes[index].id).is_some_and(|layer| layer.locked || layer.hidden) {
        return Err("Unlock and show this layer before editing it".into());
    }
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
            transform_for_resize(&mut document, &[index], [factor, 0.0, 0.0, factor, center.x * (1.0 - factor), center.y * (1.0 - factor)], factor, factor)?;
            Ok(())
        }
        ObjectEdit::Resize { sx, sy, x, y } => {
            if ![sx, sy].iter().all(|factor| (0.1..=10.0).contains(factor))
                || ![x, y].iter().all(|coord| coord.is_finite() && coord.abs() <= 100_000.0)
            {
                return Err("Invalid object resize".into());
            }
            transform_for_resize(&mut document, &[index], [sx, 0.0, 0.0, sy, x * 10.0 * (1.0 - sx), y * 10.0 * (1.0 - sy)], sx, sy)?;
            Ok(())
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
    validate_resized_design(&design)?;
    let result = preview(&design);
    workspace.checkpoint_named("Edit object");
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
 let result=preview(&design);workspace.checkpoint_named("Align objects");workspace.source=Some(doc);workspace.current=Some(design);Ok(result)
}
#[tauri::command]
async fn delete_artwork_objects(uids:Vec<usize>,all:bool,app:tauri::AppHandle)->Result<Preview,String>{
 use tauri::Manager;
 tauri::async_runtime::spawn_blocking(move||{
 let state=app.state::<Mutex<Workspace>>();let mut w=state.lock().map_err(|e|e.to_string())?;
 if w.current.is_none(){return Err("No design open".into())}
 let mut doc=if all{zigzag::document::Document::empty()}else{w.source.clone().ok_or("No editable artwork")?};
 if !all{
 let selected:std::collections::HashSet<_>=uids.into_iter().collect();
 let indices:Vec<_>=doc.shapes.iter().enumerate().filter(|(_,s)|selected.contains(&s.uid)).map(|(i,_)|i).collect();
 if indices.is_empty()||indices.len()!=selected.len(){return Err("Selection changed; select the design again".into())}
 if indices.len()==doc.shapes.len(){doc=zigzag::document::Document::empty()}else{doc.delete_many(&indices).map_err(|e|e.to_string())?;}
 }
 let design=doc.plan_cached(&mut w.plan_cache);
 let result=preview(&design);w.checkpoint_named("Delete artwork");w.source=Some(doc);w.current=Some(design);Ok(result)
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
 if indices.len()!=uids.len(){return Err("Selection changed. Select the objects again.".into())}
 if dx.abs()<1e-9&&dy.abs()<1e-9{return w.current.as_ref().map(preview).ok_or("No stitch preview".into())}
 if indices.len()==doc.shapes.len(){return place_design(&mut w,[1.0,0.0,0.0,1.0,dx*10.0,dy*10.0])}
 doc.transform(&indices,[1.0,0.0,0.0,1.0,dx*10.0,dy*10.0]).map_err(|e|e.to_string())?;
 let design=doc.plan_cached(&mut w.plan_cache);if design.stitch_count()==0{return Err("Movement produced no stitches".into())}
 let result=preview(&design);w.checkpoint_named("Move objects");w.source=Some(doc);w.current=Some(design);Ok(result)
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
 let mut bounds = zigzag::geom::Bounds::empty();
 for &index in &indices {
     let shape = &doc.shapes[index];
     let shape_bounds = zigzag::svg::shapes_bounds(std::slice::from_ref(shape));
     if !shape_bounds.is_empty() { bounds.add(shape_bounds.min); bounds.add(shape_bounds.max); }
 }
 if bounds.is_empty() { return Err("No artwork to transform".into()); }
 let center = bounds.center();
 let (s,c)=rotation.to_radians().sin_cos();let a=scale*c;let b=scale*s;
 transform_for_resize(&mut doc, &indices, [a, b, -b, a, center.x-a*center.x+b*center.y, center.y-b*center.x-a*center.y], scale, scale)?;
 let design=doc.plan_cached(&mut w.plan_cache);
 validate_resized_design(&design)?;
 let result=preview(&design);w.checkpoint_named("Transform selection");w.source=Some(doc);w.current=Some(design);Ok(result)
 }).await.map_err(|e|e.to_string())?
}
fn apply_group_palette(doc:&mut zigzag::document::Document,uids:&[usize],original:&[[u8;3]],colors:&[[u8;3]])->Result<(),String>{
 if uids.is_empty()||original.is_empty()||original.len()!=colors.len()||original.len()>64{return Err("Select artwork and valid palette colors".into())}
 let map:std::collections::HashMap<_,_>=original.iter().copied().zip(colors.iter().copied()).collect();
 if map.len()!=original.len(){return Err("Duplicate source colors".into())}
 let mut targets=Vec::new();
 for (i,shape) in doc.shapes.iter().enumerate(){
 if !uids.contains(&shape.uid){continue}
 let Some(&color)=map.get(&shape.color) else{continue};
 if color==shape.color{continue}
 if doc.layer_properties(&shape.id).is_some_and(|l|l.locked||l.hidden){return Err("Unlock or show selected artwork before recoloring".into())}
 if shape.params.kind==Some(zigzag::params::Kind::Tartan)||shape.params.colors.is_some(){return Err("Edit special pattern colors individually".into())}
 if doc.records_text(i)||shape.groups.iter().any(|g|g.starts_with("tl-lettering-")){return Err("Edit lettering colors using the text inspector".into())}
 targets.push((i,color));
 }
 if targets.is_empty(){return Err("No matching editable colors changed".into())}
 for (i,color) in targets{doc.shapes[i].color=color;}
 doc.sync().map_err(|e|e.to_string())?;
 Ok(())
}
#[tauri::command]
async fn recolor_artwork_palette(uids:Vec<usize>,original:Vec<[u8;3]>,colors:Vec<[u8;3]>,app:tauri::AppHandle)->Result<Preview,String>{
 use tauri::Manager;
 tauri::async_runtime::spawn_blocking(move||{
 let state=app.state::<Mutex<Workspace>>();let mut w=state.lock().map_err(|e|e.to_string())?;
 let mut doc=w.source.clone().ok_or("No editable artwork")?;
 apply_group_palette(&mut doc,&uids,&original,&colors)?;
 let design=doc.plan();validate_resized_design(&design)?;
 let result=preview(&design);w.checkpoint_named("Change artwork palette");w.source=Some(doc);w.current=Some(design);Ok(result)
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn recolor_artwork_group(uids:Vec<usize>,previous:[u8;3],color:[u8;3],app:tauri::AppHandle)->Result<Preview,String>{
 recolor_artwork_palette(uids,vec![previous],vec![color],app).await
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
 w.checkpoint_named("Change grouping");w.source=Some(doc);Ok(result)
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
 let p=preview(&d);w.checkpoint_named("Change stitch type");w.current=Some(d);w.source=Some(doc);Ok(p)
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
 let p=preview(&d);let mut w=state.lock().map_err(|e|e.to_string())?;w.checkpoint_named("Create specialty design");w.current=Some(d);w.source=Some(doc);Ok(p)
}
#[tauri::command]
async fn recovery_save(app: tauri::AppHandle, width: f64, height: f64, format: String, thread_assignments: Option<std::collections::HashMap<String,String>>, expected_tab: Option<String>) -> Result<(), String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        // Keep recovery writes in order if more than one caller requests a snapshot.
        static RECOVERY_WRITE: Mutex<()> = Mutex::new(());
        let _write = RECOVERY_WRITE.lock().map_err(|err| err.to_string())?;
        let tabs = app.state::<Mutex<workspace_tabs::WorkspaceTabs>>();
        let state = app.state::<Mutex<Workspace>>();
        let (id, project) = {
            let tabs=tabs.lock().map_err(|err|err.to_string())?;
            if expected_tab.as_deref().is_some_and(|id|id!=tabs.active()){return Ok(());}
            let workspace = state.lock().map_err(|err| err.to_string())?;
            (tabs.active().to_owned(),Project::capture(&workspace, width, height, format)?)
        };
        let Some(mut project) = project else { return Ok(()); };
        project.thread_assignments = thread_assignments.unwrap_or_default();
        let dir = app.path().app_local_data_dir().map_err(|err| err.to_string())?;
        let directory=workspace_tabs::recovery_directory(&dir,&id)?;
        project_recovery::save(&directory, &project)?;
        let name: String=project.name.chars().take(100).collect();
        let _=std::fs::write(directory.join("name.txt"),name);
        Ok(())
    }).await.map_err(|err| err.to_string())?
}

#[tauri::command]
fn recovery_open(app: tauri::AppHandle, tabs: tauri::State<'_,Mutex<workspace_tabs::WorkspaceTabs>>, state: tauri::State<'_, Mutex<Workspace>>) -> Result<Option<OpenedProject>, String> {
    use tauri::Manager;
    let dir = app.path().app_local_data_dir().map_err(|err| err.to_string())?;
    let tabs=tabs.lock().map_err(|err|err.to_string())?;
    project_recovery::open(&workspace_tabs::recovery_directory(&dir,tabs.active())?, &state)
}
#[tauri::command]
fn lettering_fonts()->Vec<String>{zigzag::document::font_families()}
#[tauri::command]
async fn create_lettering(
    text: String, font: String, size: f64, spacing: f64, arc: f64, bold: bool,
    italic: bool, color: [u8; 3], align: String, placement: Option<[f64; 2]>, kind: Option<String>, leading: Option<f64>, h_scale: Option<f64>, v_scale: Option<f64>, effect_color: Option<[u8;3]>, inner_color: Option<[u8;3]>, outer_width: Option<f64>, inner_width: Option<f64>, shadow_x: Option<f64>, shadow_y: Option<f64>, app: tauri::AppHandle,
) -> Result<Preview, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let settings = lettering_edit::LetteringSettings { text, font, size, spacing, arc, bold, italic, color, align, kind, leading, h_scale,v_scale,kern:None,path:None,path_offset:None,path_flip:None,effect_color,inner_color,outer_width,inner_width,shadow_x,shadow_y };
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
static FONT_IMPORT_LOCK: Mutex<()> = Mutex::new(());

fn store_font(dir: &std::path::Path, file: &std::path::Path, bytes: &[u8], result: &mut FontImport) {
    use std::io::Write;
    let ext = file.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if bytes.is_empty() || bytes.len() > 50_000_000 || !matches!(ext.as_str(), "ttf" | "otf" | "bx") {
        result.skipped += 1;
        return;
    }
    if ext != "bx" && !zigzag::svg::valid_font_bytes(bytes.to_vec()) {
        result.errors.push(format!("{}: no supported font faces", file.display()));
        return;
    }
    let stem = file.file_stem().unwrap_or_default().to_string_lossy();
    let _guard = FONT_IMPORT_LOCK.lock().unwrap_or_else(|err| err.into_inner());
    for attempt in 0..=10_000 {
        let name = if attempt == 0 {format!("{stem}.{ext}")} else {format!("{stem} ({attempt}).{ext}")};
        let dest = dir.join(name);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&dest) {
            Ok(mut output) => {
                if let Err(err) = output.write_all(bytes) {
                    drop(output);
                    let _ = std::fs::remove_file(&dest);
                    result.errors.push(err.to_string());
                } else {
                    result.imported += 1;
                    zigzag::svg::invalidate_app_fonts();
                }
                return;
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                if std::fs::symlink_metadata(&dest).is_ok_and(|meta| {
                    meta.file_type().is_file() && meta.len() == bytes.len() as u64
                }) && std::fs::read(&dest).ok().as_deref() == Some(bytes) {
                    result.duplicates += 1;
                    return;
                }
            }
            Err(err) => {
                result.errors.push(err.to_string());
                return;
            }
        }
    }
    result.errors.push("Too many filename conflicts".into());
}

#[tauri::command]
async fn import_dropped_font(name: String, bytes: Vec<u8>, app: tauri::AppHandle) -> Result<FontImport, String> {
    let path = std::path::Path::new(&name);
    if path.components().count() != 1
        || !matches!(path.components().next(), Some(std::path::Component::Normal(_)))
        || name.contains(['/', '\\', ':'])
    {
        return Err("Invalid font filename".into());
    }
    let dir = font_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut result = FontImport::default();
        store_font(&dir, std::path::Path::new(&name), &bytes, &mut result);
        result
    }).await.map_err(|err| err.to_string())
}

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
 store_font(&dir, &p, &bytes, &mut result);
 }Some(result)
 }).await.map_err(|e|e.to_string())
}
#[tauri::command]
fn remove_font_asset(app:tauri::AppHandle,file:String)->Result<(),String>{
 let p=std::path::Path::new(&file);
 if p.components().count()!=1||!matches!(p.components().next(),Some(std::path::Component::Normal(_)))||!["bx","ttf","otf"].contains(&p.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase().as_str()){return Err("Invalid font filename".into())}
 let target=font_dir(&app)?.join(p);
 let _guard = FONT_IMPORT_LOCK.lock().unwrap_or_else(|err| err.into_inner());
 if !std::fs::symlink_metadata(&target).map_err(|e|e.to_string())?.file_type().is_file(){return Err("Not a regular font file".into())}
 std::fs::remove_file(target).map_err(|e|e.to_string())?;
 zigzag::svg::invalidate_app_fonts();
 Ok(())
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
    alternatives: Vec<(u8,zigzag::document::Document,Design)>,
    document: zigzag::document::Document,
    design: Design,
}

#[derive(serde::Serialize)]
struct DigitizerReview {
    id: u64,
    artwork_svg: Option<String>,
    plan: Preview,
    quality: StitchAudit,
    warnings: Vec<String>,
    density: Vec<[i32; 3]>,
    jumps: usize,
    dst_stitches: usize,
    color_changes: usize,
    optimization: Option<[usize;2]>,
    estimated_seconds: f64,
    original_estimated_seconds: f64,
    original_trims: usize,
}


fn ocr_pixels(bytes: &[u8], remove_background: bool, tolerance: u8, cleanup: bool) -> Result<(u32,u32,Vec<u8>),String> {
    let (w,h,rgba) = zigzag::trace::prepared_pixels(bytes,remove_background,tolerance,cleanup).map_err(|e|e.to_string())?;
    let (mut l,mut t,mut r,mut b)=(w,h,0,0);
    for y in 0..h { for x in 0..w {
        if rgba[((y*w+x)*4+3) as usize]>=32 { l=l.min(x); t=t.min(y); r=r.max(x+1); b=b.max(y+1); }
    }}
    if l>=r || t>=b { return Err("No foreground available for lettering recognition".into()); }
    let mut cropped=Vec::new();
    for y in t..b { cropped.extend_from_slice(&rgba[((y*w+l)*4) as usize..((y*w+r)*4) as usize]); }
    Ok((r-l,b-t,cropped))
}

// Reconstruct only explicitly selected traced lettering; keep the rest of the document.
#[tauri::command]
async fn recognize_selected_lettering(uids:Vec<usize>,app:tauri::AppHandle)->Result<Vec<zigzag::ocr::RecognizedLine>,String>{
 use tauri::Manager;
 tauri::async_runtime::spawn_blocking(move || {
  if uids.is_empty()||uids.len()>128{return Err("Select one word or line with up to 128 traced shapes.".into())}
  let state=app.state::<Mutex<Workspace>>();
  let doc=state.lock().map_err(|e|e.to_string())?.source.clone().ok_or("Editable artwork required")?;
  let shapes:Vec<_>=doc.shapes.iter().filter(|s|uids.contains(&s.uid)).collect();
  let mut bounds=zigzag::geom::Bounds::empty();
  for shape in &shapes{let b=zigzag::svg::shapes_bounds(std::slice::from_ref(*shape));if !b.is_empty(){bounds.add(b.min);bounds.add(b.max);}}
  if bounds.is_empty()||bounds.height()<=0.0||bounds.width()<=0.0{return Err("Select traced letters first".into())}
  let scale=(144.0/bounds.height()).min(1800.0/bounds.width());
  let width=(bounds.width()*scale).ceil() as u32+24;
  let height=(bounds.height()*scale).ceil() as u32+24;
  let mut rgba=vec![255u8;width as usize*height as usize*4];
  for y in 0..height{for x in 0..width{
   let p=zigzag::geom::P::new(bounds.min.x+(x as f64-12.0)/scale,bounds.min.y+(y as f64-12.0)/scale);
   if shapes.iter().any(|s|match &s.geometry{zigzag::svg::Geometry::Fill{rings,rule}=>zigzag::geom::point_inside(rings,*rule,p),_=>false}){
    let i=(y as usize*width as usize+x as usize)*4;rgba[i..i+3].fill(0);
   }
  }}
  let lines=zigzag::ocr::recognize_rgba(width,height,&rgba).map_err(|e|e.to_string())?;
  if !lines.is_empty(){return Ok(lines)}
  // Retry with a slightly expanded ink silhouette for thin traced lettering.
  let mut expanded=rgba.clone();
  for y in 1..height-1{for x in 1..width-1{let i=(y as usize*width as usize+x as usize)*4;if [i-4,i+4,i-width as usize*4,i+width as usize*4].iter().any(|&j|rgba[j]==0){expanded[i..i+3].fill(0);}}}
  zigzag::ocr::recognize_rgba(width,height,&expanded).map_err(|e|e.to_string())
 }).await.map_err(|e|e.to_string())?
}

#[derive(serde::Serialize)]
struct LetteringReview {
    id: u64,
    uid: usize,
    view: [f64; 4],
    before: Preview,
    after: Preview,
}

#[tauri::command]
async fn preview_selected_lettering(uids:Vec<usize>,text:String,font:String,replacement:String,app:tauri::AppHandle)->Result<LetteringReview,String>{
 use tauri::Manager;
 tauri::async_runtime::spawn_blocking(move || {
  let state=app.state::<Mutex<Workspace>>();
  let tabs=app.state::<Mutex<workspace_tabs::WorkspaceTabs>>();
  let (tab,mut doc,original)={
   let tabs=tabs.lock().map_err(|e|e.to_string())?;
   let w=state.lock().map_err(|e|e.to_string())?;
   (tabs.active().to_owned(),w.source.clone().ok_or("Editable artwork is required")?,
      w.current.clone().ok_or("Open artwork first")?)
  };
  let source_svg=doc.to_svg().map_err(|e|e.to_string())?;
  let ids:std::collections::HashSet<_>=uids.into_iter().collect();
  if ids.is_empty()||ids.len()>128{return Err("Select the traced shapes in one word or line.".into())}
  let mut bounds=zigzag::geom::Bounds::empty();
  let mut found=0;
  for (index,shape) in doc.shapes.iter().enumerate().filter(|(_,s)|ids.contains(&s.uid)){
   if doc.records_text(index)||shape.params.stop==Some(true)||shape.params.trim==Some(true)
      ||doc.layer_properties(&shape.id).is_some_and(|layer|layer.hidden||layer.locked)
      ||!matches!(&shape.geometry,zigzag::svg::Geometry::Fill{..})
      ||matches!(shape.params.kind,Some(zigzag::params::Kind::Manual|zigzag::params::Kind::Applique)){
    return Err("Select only visible, unlocked traced lettering without special sewing commands.".into())
   }
   found+=1;
   let b=zigzag::svg::shapes_bounds(std::slice::from_ref(shape));
   if !b.is_empty(){bounds.add(b.min);bounds.add(b.max);}
  }
  if found!=ids.len(){return Err("The selection changed. Select the traced word again.".into())}
  if bounds.is_empty(){return Err("No selected artwork".into())}
  let pad=(bounds.height()*0.08).max(0.5);
  for shape in doc.shapes.iter().filter(|s|!ids.contains(&s.uid)){
   let b=zigzag::svg::shapes_bounds(std::slice::from_ref(shape));
   if !b.is_empty() && b.min.x>=bounds.min.x-pad && b.max.x<=bounds.max.x+pad && b.min.y>=bounds.min.y-pad && b.max.y<=bounds.max.y+pad{return Err("Select all artwork within the word region before converting".into())}
  }
  let line=zigzag::ocr::RecognizedLine{text,font,confidence:-1.0,enabled:true,rect:[bounds.min.x+doc.offset.x,bounds.min.y+doc.offset.y,bounds.max.x+doc.offset.x,bounds.max.y+doc.offset.y]};
  let old_uids:Vec<_>=doc.shapes.iter().map(|s|s.uid).collect();
  zigzag::ocr::replace_lettering(&mut doc,&[line],0.1).map_err(|e|e.to_string())?;
  if replacement.trim().is_empty()||replacement.chars().count()>120{return Err("Enter 1–120 characters".into())}
  let index=doc.shapes.iter().enumerate().find(|(i,s)|!old_uids.contains(&s.uid)&&doc.lettering(*i).is_some()).map(|(i,_)|i).ok_or("Reconstructed text not found")?;
  let mut spec=doc.lettering(index).ok_or("Text settings unavailable")?;
  spec.text=replacement;
  doc.set_lettering(index,&spec).map_err(|e|e.to_string())?;
  let fitted=zigzag::svg::shapes_bounds(std::slice::from_ref(&doc.shapes[index]));
  if fitted.is_empty(){return Err("Replacement generated no lettering outline".into())}
  // Fit longer names without stretching shorter words unnaturally.
  if fitted.width()>bounds.width(){
   spec.h_scale=(spec.h_scale*bounds.width()/fitted.width()).clamp(25.0,250.0);
   doc.set_lettering(index,&spec).map_err(|e|e.to_string())?;
  }
  let fitted=zigzag::svg::shapes_bounds(std::slice::from_ref(&doc.shapes[index]));
  if fitted.height()>bounds.height() && fitted.height()>0.0 {
   spec.v_scale=(spec.v_scale*bounds.height()/fitted.height()).clamp(25.0,250.0);
   doc.set_lettering(index,&spec).map_err(|e|e.to_string())?;
  }
  let fitted=zigzag::svg::shapes_bounds(std::slice::from_ref(&doc.shapes[index]));
  if fitted.is_empty(){return Err("Replacement generated no lettering outline".into())}
  // Preserve the original visual center even when the new word has different glyph metrics.
  let dx=bounds.center().x-fitted.center().x;
  let dy=bounds.center().y-fitted.center().y;
  if dx.abs()>0.01||dy.abs()>0.01 {
   doc.transform(&[index],[1.0,0.0,0.0,1.0,dx,dy]).map_err(|e|e.to_string())?;
  }
  let fitted=zigzag::svg::shapes_bounds(std::slice::from_ref(&doc.shapes[index]));
  if fitted.width()>bounds.width()*1.05 || fitted.height()>bounds.height()*1.15{
   return Err("Replacement does not fit the original lettering area. Try shorter text or a narrower font.".into())
  }
  let design=doc.plan();
  if design.per_shape.get(index).is_none_or(|&n|n==0){return Err("Replacement generated no stitches".into())}
  validate_resized_design(&design)?;
  let before=preview(&original);
  let after=preview(&design);
  let uid=doc.shapes[index].uid;
  let margin=(bounds.height()*0.25).max(20.0);
  let view=[(bounds.min.x-margin)/10.0,(bounds.min.y-margin)/10.0,
      (bounds.width()+2.0*margin)/10.0,(bounds.height()+2.0*margin)/10.0];
  let tabs=tabs.lock().map_err(|e|e.to_string())?;
  let mut w=state.lock().map_err(|e|e.to_string())?;
  if tabs.active()!=tab.as_str()||!density_repair::matches_source(&w,&original,&source_svg){
   return Err("The design changed. Generate a new lettering preview.".into())
  }
  let id=density_repair::stage(&mut w,original,source_svg,doc,design,"Convert traced lettering");
  Ok(LetteringReview{id,uid,view,before,after})
 }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
async fn recognize_artwork_lettering(bytes: Vec<u8>, remove_background: bool, tolerance: u8, cleanup: bool) -> Result<Vec<zigzag::ocr::RecognizedLine>,String> {
    if bytes.is_empty() || bytes.len()>20_000_000 { return Err("Invalid artwork size".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let (w,h,rgba)=ocr_pixels(&bytes,remove_background,tolerance,cleanup)?;
        let mut lines=zigzag::ocr::recognize_rgba(w,h,&rgba).map_err(|e|e.to_string())?;
        // Normalize to the prepared raster width/height; reconstruction uses the same crop.
        for line in &mut lines { line.rect=[line.rect[0]/w as f64,line.rect[1]/h as f64,line.rect[2]/w as f64,line.rect[3]/h as f64]; }
        Ok(lines)
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
async fn digitize_artwork(
    bytes: Vec<u8>, name: String, mime: String, width_mm: f64, colors: u32,
    remove_background: bool, detail: f64, fabric: String, cleanup: bool,
    tolerance: u8, thin_lines: bool, speckle_mm: Option<f64>, artwork_simplification: Option<f64>, optimization_strength: Option<u8>, production_speed: Option<f64>, production_trim_seconds: Option<f64>, thread_palette: Option<Vec<[u8; 3]>>, lettering: Option<Vec<zigzag::ocr::RecognizedLine>>, state: tauri::State<'_, Mutex<Workspace>>,
) -> Result<DigitizerReview, String> {
    if bytes.is_empty() || bytes.len() > 20_000_000 || !(5.0..=300.0).contains(&width_mm)
        || !(0.0..=100.0).contains(&detail) || !(colors == 0 || (2..=10).contains(&colors))
        || zigzag::params::Fabric::by_id(&fabric).is_none()
    {
        return Err("Invalid artwork settings or file size".into());
    }
    let speed=production_speed.unwrap_or(800.0);
    let trim=production_trim_seconds.unwrap_or(3.0);
    if !(100.0..=1500.0).contains(&speed)||!(0.0..=30.0).contains(&trim){return Err("Invalid production speed or trim duration".into());}
    let optimization_strength=optimization_strength.unwrap_or(2);
    if optimization_strength>3{return Err("Invalid optimization strength".into());}
    let speckle_mm=speckle_mm.unwrap_or(1.0);
    if !(0.0..=3.0).contains(&speckle_mm){return Err("Minimum detail must be between 0 and 3 mm".into());}
    static NEXT_DRAFT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let id = {
        let mut workspace = state.lock().map_err(|err| err.to_string())?;
        workspace.next_draft_id = NEXT_DRAFT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        workspace.digitizer_draft = None;
        workspace.next_draft_id
    };
    let (document, design, review) = tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
        let options = zigzag::trace::TraceOptions {
            width_mm, colors, remove_background, detail, speckle_mm, lines: thin_lines, threads: thread_palette.unwrap_or_default().into_iter().take(1024).collect(), ..Default::default()
        };
        let mut selected = lettering.unwrap_or_default();
        selected.retain(|l| l.enabled);
        if selected.len()>64 { return Err("Review at most 64 lettering regions.".into()); }
        let has_lettering = !selected.is_empty() && mime != "image/svg+xml";
        let prepared = if mime == "image/svg+xml" {
            None
        } else {
            Some(zigzag::trace::PreparedArtwork::new(&bytes, remove_background, tolerance, cleanup)
                .map_err(|err| err.to_string())?)
        };
        let mut lettering_warnings = Vec::new();
        let mut document = if let Some(raster) = prepared.as_ref().filter(|_| has_lettering) {
            let mut doc=raster.digitize(&name,&options).map_err(|e|e.to_string())?;
            let (w,h)=raster.size();
            for line in &mut selected { line.rect=[line.rect[0]*w as f64,line.rect[1]*h as f64,line.rect[2]*w as f64,line.rect[3]*h as f64]; }
            doc.settings.fabric=fabric.clone();
            let mut accepted_plan=doc.plan();
            for line in &selected {
                let mut candidate=doc.clone();
                match zigzag::ocr::replace_lettering(&mut candidate,std::slice::from_ref(line),width_mm/w as f64) {
                    Ok(()) => {
                        let plan=candidate.plan();
                        let old_trims=accepted_plan.trim_count();
                        let old_stitches=accepted_plan.stitch_count();
                        if plan.stitch_count()>0 &&
                            plan.trim_count() <= old_trims.saturating_add(4) &&
                            plan.stitch_count() <= old_stitches.saturating_add(old_stitches/10).saturating_add(40) {
                            doc=candidate;
                            accepted_plan=plan;
                        } else {
                            lettering_warnings.push(format!("Kept traced lettering '{}': reconstruction increased sewing complexity.",line.text));
                        }
                    }
                    Err(err) => lettering_warnings.push(format!("Kept traced lettering '{}': {}",line.text,err)),
                }
            }
            doc
        } else if let Some(raster) = &prepared {
            raster.digitize(&name, &options).map_err(|err| err.to_string())?
        } else {
            let svg = std::str::from_utf8(&bytes).map_err(|err| err.to_string())?;
            zigzag::document::Document::from_svg(svg, &name, None).map_err(|err| err.to_string())?
        };
        document.settings.fabric = fabric.clone();
        let artwork_bounds = zigzag::svg::shapes_bounds(&document.shapes);
        if artwork_bounds.width() > 10_000.0 || artwork_bounds.height() > 10_000.0 {
            return Err("Artwork is larger than 1 meter. Reduce the artwork dimensions before digitizing.".into());
        }
        let mut design = document.plan();
        let initial_count=design.stitch_count();
        let original_estimated_seconds=optimization_seconds(&design,speed,trim);
        let original_trims=design.trim_count();
        // Compare a second automatic trace only for raster imports with
        // automatic colors. Keep the original unless the alternate retains
        // the palette and approximate extent while reducing sewing complexity.
        if optimization_strength>=2 && !has_lettering && colors == 0 && !thin_lines && design.stitch_count() <= 100_000
            && let Some(raster) = &prepared
        {
            let mut alternate_options = options.clone();
            alternate_options.lines = true;
            if let Ok(mut alternate) = raster.digitize(&name, &alternate_options) {
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
                        && score(&candidate) < score(&design) * 0.90
                        && optimization_seconds(&candidate,speed,trim)<optimization_seconds(&design,speed,trim)
                        && candidate.trim_count()<=design.trim_count()
                        && optimization_quality(&design,&candidate,speed,trim).coverage>=90.0
                        && raster.preserves_fidelity(&document, &alternate)
                    {
                        document = alternate;
                        design = candidate;
                    }
                }
            }
        }

        // Test a simpler tracing strategy at the same physical dimensions
        // before spending time tuning an unnecessarily complicated plan.
        // Never retrace approved lettering or discard an explicit palette.
        if optimization_strength>=2 && initial_count>15_000 && !has_lettering && cleanup && colors==0 && !thin_lines {
            if let Some(raster)=&prepared {
                let mut trial=options.clone();
                trial.lines=true;
                trial.line_width_mm=2.0;
                trial.detail=detail.min(45.);
                if let Ok(mut next)=raster.digitize(&name,&trial){
                    next.settings.fabric=fabric.clone();
                    let plan=next.plan();
                    let old=design.bounds();let new=plan.bounds();
                    let palette=|d:&Design|d.blocks.iter().map(|b|b.color).collect::<std::collections::HashSet<_>>();
                    let audit=measure_stitches(&design);let candidate_audit=measure_stitches(&plan);
                    if plan.stitch_count()>0&&plan.stitch_count()<design.stitch_count()*9/10
                        &&plan.trim_count()<=design.trim_count()
                        &&candidate_audit.long<=audit.long&&candidate_audit.zero<=audit.zero
                        &&candidate_audit.short<=audit.short.saturating_add(5)
                        &&optimization_seconds(&plan,speed,trim)<optimization_seconds(&design,speed,trim)
                        &&old.min.dist(new.min)<=10.&&old.max.dist(new.max)<=10.
                        &&palette(&plan)==palette(&design)
                        &&raster.preserves_fidelity(&document,&next)
                        &&optimization_quality(&design,&plan,speed,trim).coverage>=85.
                    {document=next;design=plan;}
                }
            }
        }
        // Try up to two reduced palettes only in explicit maximum-efficiency mode.
        // Keep owned thread palettes, approved text and manual color counts intact.
        if optimization_strength==3 && colors==0 && !has_lettering && options.threads.is_empty()
            && design.stitch_count()<=100_000 {
            if let Some(raster)=&prepared {
                let original_document=document.clone();
                let original_plan=design.clone();
                let original_palette:std::collections::HashSet<_>=design.blocks.iter().map(|b|b.color).collect();
                let started=std::time::Instant::now();
                for _ in 0..2 {
                if started.elapsed().as_secs()>=4 {break;}
                let palette:std::collections::HashSet<_>=design.blocks.iter().map(|b|b.color).collect();
                if (3..=10).contains(&palette.len()) {
                    let mut trial=options.clone();
                    trial.colors=(palette.len()-1) as u32;
                    if let Ok(mut next)=raster.digitize(&name,&trial) {
                        next.settings.fabric=fabric.clone();
                        let plan=next.plan();
                        let next_palette:std::collections::HashSet<_>=plan.blocks.iter().map(|b|b.color).collect();
                        let a=design.bounds();let b=plan.bounds();
                        let before=measure_stitches(&design);let after=measure_stitches(&plan);
                        // Every original shade must have a close replacement.
                        let close=original_palette.iter().all(|old|next_palette.iter().any(|new|
                            old.iter().zip(new.iter()).map(|(&x,&y)|(f64::from(x)-f64::from(y)).powi(2)).sum::<f64>()<=24.0_f64.powi(2)));
                        if close && next_palette.len()<palette.len() && plan.stitch_count()>0
                            && plan.stitch_count()<=design.stitch_count() && plan.trim_count()<=design.trim_count()
                            && plan.blocks.len()<design.blocks.len()
                            && after.long<=before.long && after.zero<=before.zero && after.short<=before.short.saturating_add(5)
                            && a.min.dist(b.min)<=5.0 && a.max.dist(b.max)<=5.0
                            && optimization_seconds(&plan,speed,trim)<optimization_seconds(&design,speed,trim)
                            && raster.preserves_fidelity(&original_document,&next)
                            && original_plan.bounds().min.dist(b.min)<=5.0 && original_plan.bounds().max.dist(b.max)<=5.0 {
                            document=next;design=plan;
                        } else {break;}
                    } else {break;}
                } else {break;}
                }
            }
        }
        // Explicit artwork simplification shares the editor's geometry reconstruction engine.
        if let Some(floor)=artwork_simplification.filter(|v|v.is_finite()) {
            let opts=SimplifyOptions{texture_reduction:true,appearance_floor:Some(floor.clamp(65.,100.)),speed:Some(speed),trim_seconds:Some(trim),budget:Some(SimplifyBudget::new(std::time::Duration::from_secs(12))),..Default::default()};
            // Keep traced text intact when OCR replacement was not successful.
            if !has_lettering || lettering_warnings.is_empty() {
                if let Ok((next,plan))=choose_texture_reduction(&document,&design,None,&opts) {
                    document=next;design=plan;
                }
            }
        }
        let mut optimization = if design.stitch_count()<initial_count{Some([initial_count,design.stitch_count()])}else{None};
        // Prefer a production-efficient plan at the original requested size.
        // 10k is a soft goal, 15k a review threshold, never a destructive cap.
        if optimization_strength>0 && design.stitch_count() <= 100_000 {
            let before=design.stitch_count();
            let original=design.clone();
            let score=|p:&Design|optimization_seconds(p,speed,trim);
            let baseline=measure_stitches(&original);
            let baseline_seconds=score(&original);
            let budget=SimplifyBudget::new(std::time::Duration::from_secs(10));
            let opts=SimplifyOptions{quick:true,merge:true,auto_types:true,
                target_stitches:Some(10_000),speed:Some(speed),trim_seconds:Some(trim),budget:Some(budget),..Default::default()};
            let mut best:Option<(zigzag::document::Document,Design)>=None;
            let eligible=|p:&Design|{
                let a=original.bounds();let b=p.bounds();
                let audit=measure_stitches(p);
                p.stitch_count()>0&&p.stitch_count()<=before&&score(p)<baseline_seconds
                    &&p.trim_count()<=original.trim_count()
                    &&audit.long<=baseline.long&&audit.zero<=baseline.zero
                    &&production_not_worse(&original,p)
                    &&local_coverage_preserved(&original,p)
                    &&a.min.dist(b.min)<=5.&&a.max.dist(b.max)<=5.
                    &&original.blocks.iter().map(|b|b.color).eq(p.blocks.iter().map(|b|b.color))
                    &&optimization_quality(&original,p,speed,trim).coverage>=90.
            };
            // The aggressive pass comes first for expensive designs, so the
            // time budget is not spent entirely on marginal improvements.
            let levels:&[u8]=match optimization_strength{1=>&[1],3=>&[3,2,1],_ if before>15_000=>&[3,2],_=>&[2,1]};
            for &level in levels{
                if opts.exhausted(){break}
                if let Ok((d,p))=choose_simplification(&document,&original,level,None,false,&opts){
                    if eligible(&p)&&best.as_ref().is_none_or(|(_,old)|score(&p)<score(old)){
                        best=Some((d,p));
                    }
                }
                if optimization_strength<3&&best.as_ref().is_some_and(|(_,p)|p.stitch_count()<=10_000){break}
            }
            if optimization_strength>=2&&(before>15_000||optimization_strength==3)&&!opts.exhausted()&&(optimization_strength==3||best.as_ref().is_none_or(|(_,p)|p.stitch_count()>10_000)){
                if let Ok((d,p))=choose_fast_stitch(&document,&original,None,&opts){
                    if eligible(&p)&&best.as_ref().is_none_or(|(_,old)|score(&p)<score(old)){
                        best=Some((d,p));
                    }
                }
            }
            if let Some((next,plan))=best {
                optimization=Some([initial_count,plan.stitch_count()]);
                document=next;design=plan;
            }
        }
        if let Some((next,p))=repair_artwork_quality(&document,&design){document=next;design=p;}
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
        lettering_warnings.append(&mut warnings);
        let mut warnings = lettering_warnings;
        if count>15_000 {warnings.insert(0,format!("Efficiency goal not reached: {count} stitch points at the requested size. Consider a smaller design or simpler artwork; coverage was preserved rather than forcing a stitch cap."));}
        let audit=measure_stitches(&design);
        let (peak,hot)=production_hotspots(&design);
        if hot>0{warnings.insert(0,format!("Density review: {hot} square-mm cells have 24 or more needle points (peak {peak}). Inspect overlaps and test on the intended fabric."));}
        if audit.long>0||audit.zero>0{warnings.insert(0,format!("Stitch review: {} sewn segments over 12 mm and {} near-zero segments. Inspect stitch playback before exporting.",audit.long,audit.zero));}
        warnings.truncate(12);
        let review = DigitizerReview {
            id,
            artwork_svg: document.to_svg().ok(),
            plan: preview(&design),
            quality: measure_stitches(&design),
            warnings,
            density,
            jumps,
            dst_stitches,
            color_changes,
            optimization,
            estimated_seconds: optimization_seconds(&design,speed,trim),
            original_estimated_seconds,
            original_trims,
        };
        Ok((document, design, review))
    }).await.map_err(|err| err.to_string())??;
    let mut workspace = state.lock().map_err(|err| err.to_string())?;
    if workspace.next_draft_id != id { return Err("A newer digitizing request replaced this draft".into()); }
    workspace.digitizer_draft = Some(DigitizerDraft { id, document, design, alternatives: Vec::new() });
    Ok(review)
}

// Batch review stages editable projects separately from the active editor and library.
fn batch_dir(app:&tauri::AppHandle,approved:bool)->Result<std::path::PathBuf,String>{
 use tauri::Manager;
 let dir=app.path().app_local_data_dir().map_err(|e|e.to_string())?.join(if approved{"approved-batch-projects"}else{"batch-review"});
 std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
 Ok(dir)
}
fn batch_token_path(app:&tauri::AppHandle,token:&str)->Result<std::path::PathBuf,String>{
 if token.is_empty()||token.len()>100||!token.bytes().all(|c|c.is_ascii_alphanumeric()||c==b'-'){return Err("Invalid batch token".into())}
 Ok(batch_dir(app,false)?.join(format!("{token}.stitchstudio")))
}
#[tauri::command]
async fn stage_batch_draft(id:u64,strength:u8,token:String,app:tauri::AppHandle)->Result<(),String>{
 use tauri::Manager;
 let path=batch_token_path(&app,&token)?;
 let project={
  let state=app.state::<Mutex<Workspace>>();let w=state.lock().map_err(|e|e.to_string())?;
  let d=w.digitizer_draft.as_ref().filter(|d|d.id==id).ok_or("Digitizing draft expired")?;
  let (doc,plan)=if strength==0{(&d.document,&d.design)}else{let (_,doc,plan)=d.alternatives.iter().find(|(n,_,_)|*n==strength).ok_or("Preview unavailable")?;(doc,plan)};
  let b=plan.bounds();
  let width=(b.min.x.abs().max(b.max.x.abs())/5.+4.).max(100.);
  let height=(b.min.y.abs().max(b.max.y.abs())/5.+4.).max(100.);
  let staged=Workspace{source:Some(doc.clone()),current:Some(plan.clone()),..Default::default()};
  Project::capture(&staged,width,height,"dst".into())?.ok_or("Empty draft")?
 };
 tauri::async_runtime::spawn_blocking(move||write_project(&path,&project)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn approve_batch_draft(token:String,category:Option<String>,app:tauri::AppHandle)->Result<serde_json::Value,String>{
 let path=batch_token_path(&app,&token)?;let dir=batch_dir(&app,true)?;
 tauri::async_runtime::spawn_blocking(move||{
  let p=Project::load(&path)?;p.validate()?;
  let stem: String=p.name.chars().map(|c|if c.is_alphanumeric()||c=='-'||c=='_'{c}else{'_'}).take(100).collect();
  let dest=dir.join(format!("{}-{}.stitchstudio",stem,token));
  if !dest.exists(){write_project(&dest,&p)?;}
  let meta=std::fs::metadata(&dest).map_err(|e|e.to_string())?;
  let entry=LibraryEntry{file:dest.to_string_lossy().into_owned(),name:p.name,stitches:p.blocks.iter().flat_map(|b|&b.runs).map(|r|r.points.len()).sum(),colors:p.blocks.len(),width:p.width,height:p.height,modified:meta.modified().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_secs()).unwrap_or(0),created:meta.created().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_secs())};
  let category=category.unwrap_or_else(||"Uncategorized".into());
  let category:String=category.chars().filter(|c|!c.is_control()).take(100).collect();
  let mut meta_file=tempfile::NamedTempFile::new_in(&dir).map_err(|e|e.to_string())?;
  use std::io::Write;
  meta_file.write_all(category.as_bytes()).map_err(|e|e.to_string())?;
  meta_file.persist(dest.with_extension("category")).map_err(|e|e.to_string())?;
  let mut value=serde_json::to_value(entry).map_err(|e|e.to_string())?;value["category"]=serde_json::Value::String(category);
  let _=std::fs::remove_file(path);Ok(value)
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn discard_batch_draft(token:String,app:tauri::AppHandle)->Result<(),String>{
 let p=batch_token_path(&app,&token)?;
 match std::fs::remove_file(p){Ok(())=>Ok(()),Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(()),Err(e)=>Err(e.to_string())}
}
#[tauri::command]
async fn approved_batch_projects(app:tauri::AppHandle)->Result<Vec<serde_json::Value>,String>{
 let dir=batch_dir(&app,true)?;
 tauri::async_runtime::spawn_blocking(move||{
  let mut out=Vec::new();
  for entry in std::fs::read_dir(dir).map_err(|e|e.to_string())?.flatten().take(10000){
   let path=entry.path();let Ok(meta)=std::fs::symlink_metadata(&path) else{continue};
   if !meta.is_file()||!path.extension().is_some_and(|e|e=="stitchstudio"){continue}
   let Ok(p)=Project::load(&path) else{continue};
   let entry=LibraryEntry{file:path.to_string_lossy().into_owned(),name:p.name,stitches:p.blocks.iter().flat_map(|b|&b.runs).map(|r|r.points.len()).sum(),colors:p.blocks.len(),width:p.width,height:p.height,modified:meta.modified().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_secs()).unwrap_or(0),created:meta.created().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_secs())};
   let mut value=serde_json::to_value(entry).map_err(|e|e.to_string())?;
   let category=std::fs::read_to_string(path.with_extension("category")).unwrap_or_else(|_|"Uncategorized".into());
   value["category"]=serde_json::Value::String(category);out.push(value);
  }Ok(out)
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn insert_approved_design(file:String,x_mm:f64,y_mm:f64,app:tauri::AppHandle)->Result<Preview,String>{
 use tauri::Manager;
 if ![x_mm,y_mm].iter().all(|v|v.is_finite()&&v.abs()<=500.){return Err("Invalid placement".into())}
 let path=std::path::PathBuf::from(&file);
 let dir=batch_dir(&app,true)?;
 if path.parent()!=Some(dir.as_path())||!path.extension().is_some_and(|e|e=="stitchstudio")||!std::fs::symlink_metadata(&path).is_ok_and(|m|m.is_file()){return Err("Choose an approved design from the library".into())}
 tauri::async_runtime::spawn_blocking(move||{
  let project=Project::load(&path)?;
  let source=project.validate()?.ok_or("Design has no editable artwork")?;
  let svg=source.to_svg().map_err(|e|e.to_string())?;
  let state=app.state::<Mutex<Workspace>>();
  let mut w=state.lock().map_err(|e|e.to_string())?;
  insert_editable_artwork(&mut w,&svg,&project.name,x_mm,y_mm,false)
 }).await.map_err(|e|e.to_string())?
}
#[derive(serde::Serialize)]
struct DigitizerCoverage {
    complete: bool,
    gaps: Vec<String>,
}

#[tauri::command]
async fn inspect_digitizer_coverage(id: u64, strength: u8, app: tauri::AppHandle) -> Result<DigitizerCoverage, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let (document, plan) = {
            let workspace = state.lock().map_err(|error| error.to_string())?;
            let draft = workspace.digitizer_draft.as_ref().filter(|draft| draft.id == id)
                .ok_or("Digitizing draft expired.")?;
            if strength == 0 {
                (draft.document.clone(), draft.design.clone())
            } else {
                let (_, document, plan) = draft.alternatives.iter().find(|(level, _, _)| *level == strength)
                    .ok_or("This stitch preview is no longer available.")?;
                (document.clone(), plan.clone())
            }
        };
        let (gaps, complete) = zigzag::checks::coverage_gap_scan(&document.shapes, &plan, &document.plan_options());
        let gaps = gaps.iter().take(12).map(|gap| format!(
            "Object {} has gaps at {:.0}% of sampled interior points.",
            gap.shape + 1, 100.0 * gap.missing as f64 / gap.inside as f64,
        )).collect();
        Ok(DigitizerCoverage { complete, gaps })
    }).await.map_err(|error| error.to_string())?
}

// Compare against the same digitized source without changing the editor.
#[tauri::command]
async fn compare_digitizer_draft(id:u64,quick:Option<bool>,target_stitches:Option<usize>,app:tauri::AppHandle)->Result<Vec<SimplifyVariant>,String>{
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move||{
        let state=app.state::<Mutex<Workspace>>();
        let quick=quick.unwrap_or(true);
        let target_stitches=target_stitches.unwrap_or(10_000).clamp(500,200_000);
        let (doc,original,mut alternatives)={
            let w=state.lock().map_err(|e|e.to_string())?;
            let d=w.digitizer_draft.as_ref().filter(|d|d.id==id).ok_or("Digitizing draft expired")?;
            let alternatives=if quick { Vec::new() } else { d.alternatives.iter().filter(|v| matches!(v.0,2|3)).cloned().collect() };
            (d.document.clone(),d.design.clone(),alternatives)
        };
        let describe=|strength,plan:&Design| SimplifyVariant {
            artwork_svg:None,strength,plan:Some(preview(plan)),reason:None,quality:Some(optimization_quality(&original,plan,800.,3.)),
        };
        let mut variants:Vec<_>=alternatives.iter().map(|(strength,_,plan)|describe(*strength,plan)).collect();
        let budget=SimplifyBudget::new(std::time::Duration::from_secs(10));
        let strengths:&[u8]=if quick { &[2,3] } else { &[5,4,1] };
        for (index, &strength) in strengths.iter().enumerate() {
            if budget.exhausted(){break}
            let now = std::time::Instant::now();
            let share = budget.deadline.saturating_duration_since(now) / (strengths.len() - index) as u32;
            let options=SimplifyOptions{
                quick,solid:strength==3,merge:strength>=2,auto_types:strength>=2,
                target_stitches:Some(target_stitches),budget:Some(SimplifyBudget {
                    deadline: now + share, cancelled: budget.cancelled.clone(),
                }),..Default::default()
            };
            let variant=match strength {
                4=>choose_silhouette(&doc,&original,None,&options),
                5=>choose_fast_stitch(&doc,&original,None,&options),
                _=>choose_simplification(&doc,&original,strength,None,false,&options),
            };
            match variant {
                Ok((d,plan))=>{
                    variants.push(describe(strength,&plan));
                    alternatives.push((strength,d,plan));
                }
                Err(reason)=>variants.push(SimplifyVariant{artwork_svg:None,strength,plan:None,reason:Some(reason),quality:None}),
            }
        }
        variants.sort_by_key(|v|v.strength);
        let mut w=state.lock().map_err(|e|e.to_string())?;
        let d=w.digitizer_draft.as_mut().filter(|d|d.id==id).ok_or("A newer artwork replaced this draft")?;
        d.alternatives=alternatives;
        Ok(variants)
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn export_digitizer_variant(id:u64,strength:u8,format:String,width:f64,height:f64,state:tauri::State<'_,Mutex<Workspace>>)->Result<bool,String>{
    if !["dst","pes","pec","jef","exp","vp3"].contains(&format.as_str()){return Err("Unsupported format".into())}
    let design={
        let w=state.lock().map_err(|e|e.to_string())?;
        let d=w.digitizer_draft.as_ref().filter(|d|d.id==id).ok_or("Digitizing draft expired")?;
        if strength==0{d.design.clone()}else{d.alternatives.iter().find(|(n,_,_)|*n==strength).map(|(_,_,p)|p.clone()).ok_or("Selected preview unavailable")?}
    };
    let fmt=format.clone();
    let bytes=tauri::async_runtime::spawn_blocking(move||{
        validate_export(&design,&fmt,width,height)?;
        formats::write_format(&design,&fmt).map_err(|e|e.to_string())
    }).await.map_err(|e|e.to_string())??;
    let Some(path)=rfd::AsyncFileDialog::new().add_filter("Embroidery",&[format.as_str()]).set_file_name(format!("design.{format}")).save_file().await else{return Ok(false)};
    let mut path=path.path().to_owned();
    match path.extension().and_then(|e|e.to_str()){
        None=>{path.set_extension(&format);}
        Some(e) if e.eq_ignore_ascii_case(&format)=>{}
        _=>return Err(format!("Use a .{format} filename"))
    }
    std::fs::write(path,bytes).map_err(|e|e.to_string())?;
    Ok(true)
}
#[tauri::command]
fn apply_digitizer_draft(id: u64, strength: Option<u8>, state: tauri::State<'_, Mutex<Workspace>>) -> Result<(), String> {
    let mut workspace = state.lock().map_err(|err| err.to_string())?;
    if workspace.digitizer_draft.as_ref().is_none_or(|draft| draft.id != id) {
        return Err("This draft expired. Regenerate stitches before opening it.".into());
    }
    let strength=strength.unwrap_or(0);
    if strength!=0&&!workspace.digitizer_draft.as_ref().is_some_and(|d|d.alternatives.iter().any(|(n,_,_)|*n==strength)){return Err("Selected preview is unavailable".into())}
    let draft = workspace.digitizer_draft.take().ok_or("No digitizing draft")?;
    let (document,design)=if strength==0{(draft.document,draft.design)}else{let (_,doc,plan)=draft.alternatives.into_iter().find(|(n,_,_)|*n==strength).ok_or("Selected preview expired")?;(doc,plan)};
    workspace.checkpoint_named("Apply digitized artwork");
    workspace.current = Some(design);
    workspace.source = Some(document);
    Ok(())
}
#[tauri::command]
async fn insert_digitizer_draft(id: u64, strength: u8, app: tauri::AppHandle) -> Result<Preview, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let mut workspace = state.lock().map_err(|err| err.to_string())?;
        let draft = workspace.digitizer_draft.as_ref()
            .filter(|draft| draft.id == id)
            .ok_or("This draft expired. Regenerate stitches before inserting it.")?;
        let document = if strength == 0 {
            &draft.document
        } else {
            &draft.alternatives.iter().find(|(level, _, _)| *level == strength)
                .ok_or("Selected preview is unavailable")?.1
        };
        let xml = document.to_svg().map_err(|err| err.to_string())?;
        let name = document.name.clone();
        let result = insert_editable_artwork(&mut workspace, &xml, &name, 0.0, 0.0, false)?;
        workspace.digitizer_draft = None;
        Ok(result)
    }).await.map_err(|err| err.to_string())?
}

#[derive(serde::Serialize)]
struct LibraryEntry {file:String,name:String,stitches:usize,colors:usize,width:f64,height:f64,modified:u64,created:Option<u64>}
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
 out.push(LibraryEntry{file:path.to_string_lossy().into_owned(),name:p.name,stitches:p.blocks.iter().flat_map(|b|&b.runs).map(|r|r.points.len()).sum(),colors:p.blocks.len(),width:p.width,height:p.height,modified:meta.modified().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_secs()).unwrap_or(0),created:meta.created().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_secs())});
 }Some(out)
 }).await.map_err(|e|e.to_string())
}
#[tauri::command]
async fn import_artwork_files()->Result<Option<usize>,String>{
 let Some(files)=rfd::AsyncFileDialog::new().add_filter("Artwork",&["png","jpg","jpeg","webp","svg"]).pick_files().await else{return Ok(None)};
 let paths:Vec<_>=files.into_iter().map(|f|f.path().to_owned()).collect();
 tauri::async_runtime::spawn_blocking(move||->Result<Option<usize>,String>{
 let root=character_root()?;std::fs::create_dir_all(&root).map_err(|e|e.to_string())?;
 let dir=root.join("My imported artwork");std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
 if !std::fs::symlink_metadata(&dir).map_err(|e|e.to_string())?.file_type().is_dir(){return Err("Invalid artwork folder".into())}
 let mut count=0;
 for path in paths.into_iter().take(1000){
 let Ok(meta)=std::fs::symlink_metadata(&path) else{continue};if !meta.is_file()||meta.len()>20_000_000{continue}
 let ext=path.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase();if !matches!(ext.as_str(),"png"|"jpg"|"jpeg"|"webp"|"svg"){continue}
 let Ok(bytes)=std::fs::read(&path) else{continue};
 if ext=="svg" && (bytes.len()>4_000_000 || zigzag::svg::load(&bytes).is_err()){continue}
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
 out.push(LibraryEntry{file:path.to_string_lossy().into_owned(),name:p.name,stitches:p.blocks.iter().flat_map(|b|&b.runs).map(|r|r.points.len()).sum(),colors:p.blocks.len(),width:p.width,height:p.height,modified:meta.modified().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_secs()).unwrap_or(0),created:meta.created().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_secs())});
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
 if !matches!(ext.as_str(),"png"|"webp"|"jpg"|"jpeg"|"svg"){continue}
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
 if !matches!(ext.as_str(),"png"|"webp"|"jpg"|"jpeg"|"svg"){return Err("Unsupported artwork".into())}
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
    fn resize_validation_rejects_nonfinite_and_empty_plans() {
        use zigzag::{design::{Block, Run}, geom::P};
        let mut design = Design::default();
        assert!(validate_resized_design(&design).is_err());
        design.blocks.push(Block { color: [0, 0, 0], runs: vec![Run {
            pts: vec![P::new(0.0, 0.0), P::new(20.0, 10.0)], trim_before: false
        }] });
        assert!(validate_resized_design(&design).is_ok());
        design.blocks[0].runs[0].pts[1].x = f64::INFINITY;
        assert!(validate_resized_design(&design).is_err());
    }

    #[test]
    fn invalid_placement_leaves_design_unchanged() {
        use zigzag::{design::{Block, Run}, geom::P};
        let design = Design {
            blocks: vec![Block { color: [0, 0, 0], runs: vec![Run {
                pts: vec![P::new(10.0, 20.0), P::new(30.0, 40.0)], trim_before: false
            }] }],
            ..Default::default()
        };
        let mut workspace = Workspace { current: Some(design), ..Default::default() };
        let before = formats::write_format(workspace.current.as_ref().unwrap(), "dst").unwrap();
        assert!(place_design(&mut workspace, [1.0, 0.0, 0.0, 1.0, f64::NAN, 0.0]).is_err());
        assert!(place_design(&mut workspace, [f64::MAX, 0.0, 0.0, 1.0, 0.0, 0.0]).is_err());
        assert_eq!(formats::write_format(workspace.current.as_ref().unwrap(), "dst").unwrap(), before);
        assert!(workspace.undo.is_empty());
    }

    #[test]
    fn optimization_preserves_isolated_contrasting_detail() {
        use zigzag::{design::{Block, Run}, geom::P};
        let original = Design {
            blocks: vec![
                Block { color: [0, 0, 0], runs: vec![Run { pts: vec![P::new(0.0, 0.0), P::new(100.0, 0.0)], trim_before: false }] },
                Block { color: [255, 0, 0], runs: vec![Run { pts: vec![P::new(50.0, 20.0)], trim_before: false }] },
            ],
            ..Default::default()
        };
        let mut candidate = original.clone();
        candidate.blocks.pop();
        assert_eq!(optimization_quality(&original, &original, 800.0, 3.0).coverage, 100.0);
        assert_eq!(optimization_quality(&original, &candidate, 800.0, 3.0).coverage, 0.0);
    }

    #[test]
    fn optimization_rejects_missing_isolated_same_thread_detail() {
        use zigzag::{design::{Block,Run},geom::P};
        let original=Design{blocks:vec![Block{color:[0,0,0],runs:vec![
            Run{pts:vec![P::new(0.,0.),P::new(1000.,0.)],trim_before:false},
            Run{pts:vec![P::new(500.,100.)],trim_before:true}
        ]}],..Default::default()};
        let mut candidate=original.clone();
        candidate.blocks[0].runs.pop();
        assert_eq!(optimization_quality(&original,&candidate,800.,3.).coverage,0.);
        assert_eq!(optimization_quality(&original,&original,800.,3.).coverage,100.);
        let mut shifted=original.clone();
        shifted.blocks[0].runs[1].pts[0]=P::new(510.,100.);
        assert!(optimization_quality(&original,&shifted,800.,3.).coverage>95.);
    }

    #[test]
    fn production_estimate_includes_inter_color_travel_and_empty_runs() {
        use zigzag::{design::{Block, Run}, geom::P};
        let run = |x| Run { pts: vec![P::new(x, 0.0)], trim_before: false };
        let design = Design {
            blocks: vec![
                Block { color: [0, 0, 0], runs: vec![run(0.0), Run { pts: vec![], trim_before: false }] },
                Block { color: [255, 0, 0], runs: vec![run(1000.0)] },
            ],
            ..Default::default()
        };
        // Two penetrations at 600 spm, one color change, 100 mm travel.
        assert!((optimization_seconds(&design, 600.0, 3.0) - 9.2).abs() < 1e-9);
    }

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
    fn sports_applique_keeps_explicit_stitch_kind() {
        let svg=r#"<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="80mm" viewBox="0 0 80 80"><circle id="applique" cx="40" cy="40" r="30" fill="navy"/></svg>"#;
        let mut w=Workspace::default();
        insert_vector_artwork(&mut w,svg,"Sports patch",60.,0.,0.).unwrap();
        let doc=w.source.as_ref().unwrap();
        assert_eq!(doc.shapes[0].params.kind,Some(zigzag::params::Kind::Applique));
        let design=w.current.as_ref().unwrap();
        assert!(design.blocks.len()>=3);
        validate_export(design,"dst",100.,100.).unwrap();
    }
    #[test]
    fn group_palette_swaps_colors_without_cascading_or_affecting_unselected_artwork(){
        let svg=r##"<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="20mm" viewBox="0 0 60 20"><rect x="0" y="0" width="10" height="10" fill="#ff0000"/><rect x="20" y="0" width="10" height="10" fill="#0000ff"/><rect x="40" y="0" width="10" height="10" fill="#ff0000"/></svg>"##;
        let mut doc=zigzag::document::Document::from_svg(svg,"Palette",None).unwrap();
        let ids=vec![doc.shapes[0].uid,doc.shapes[1].uid];
        apply_group_palette(&mut doc,&ids,&[[255,0,0],[0,0,255]],&[[0,0,255],[255,0,0]]).unwrap();
        assert_eq!(doc.shapes[0].color,[0,0,255]);
        assert_eq!(doc.shapes[1].color,[255,0,0]);
        assert_eq!(doc.shapes[2].color,[255,0,0]);
    }
    #[test]
    fn optimizer_preserves_small_contrasting_color() {
        use zigzag::{design::{Block,Run},geom::P};
        let run=Run{pts:vec![P::new(0.,0.),P::new(20.,0.)],trim_before:false};
        let original=Design{blocks:vec![Block{color:[0,0,0],runs:vec![run.clone()]},Block{color:[255,0,0],runs:vec![run.clone()]}],..Default::default()};
        let candidate=Design{blocks:vec![Block{color:[0,0,0],runs:vec![run]}],..Default::default()};
        assert_eq!(optimization_quality(&original,&candidate,800.,3.).coverage,0.);
        assert_eq!(optimization_quality(&original,&original,800.,3.).coverage,100.);
    }
    #[test]
    fn covered_fill_optimizer_preserves_base_under_open_fill() {
        let svg=r#"<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="60mm" viewBox="0 0 80 60"><rect id="a" x="5" y="5" width="45" height="40" fill="navy"/><rect id="b" x="10" y="5" width="45" height="40" fill="navy"/></svg>"#;
        let mut doc=zigzag::document::Document::from_svg(svg,"Open overlap",None).unwrap();
        doc.shapes[1].params.spacing=Some(1.4);
        let options=SimplifyOptions::default();
        assert!(remove_covered_fill_candidate(&doc,None,&options).is_none());
    }
    #[test]
    fn optimizer_reports_savings_for_overlapping_fill_fixture() {
        let svg=r#"<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="60mm" viewBox="0 0 80 60"><rect id="a" x="5" y="5" width="45" height="40" fill="navy"/><rect id="b" x="10" y="5" width="45" height="40" fill="navy"/></svg>"#;
        let doc=zigzag::document::Document::from_svg(svg,"Overlap",None).unwrap();
        let original=doc.plan();let start=std::time::Instant::now();
        let options=SimplifyOptions{merge:true,..Default::default()};
        let (_,candidate)=choose_simplification(&doc,&original,2,None,false,&options).expect("overlapping fills should admit a faster alternative");
        assert!(candidate.stitch_count()<original.stitch_count());
        assert!(optimization_seconds(&candidate,800.,3.)<optimization_seconds(&original,800.,3.));
        eprintln!("optimizer fixture: {} -> {} stitches; {:.1} -> {:.1} estimated seconds; generation {:?}",original.stitch_count(),candidate.stitch_count(),optimization_seconds(&original,800.,3.),optimization_seconds(&candidate,800.,3.),start.elapsed());
    }
    #[test]
    fn bundled_vector_insert_scales_visible_width_and_keeps_existing_objects() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 500 500"><rect x="100" y="100" width="200" height="100" fill="purple"/></svg>"#;
        let mut workspace = Workspace::default();
        insert_vector_artwork(&mut workspace, svg, "First", 30.0, -30.0, 0.0).unwrap();
        let before = workspace.source.as_ref().unwrap().shapes[0].uid;
        insert_vector_artwork(&mut workspace, svg, "Second", 40.0, 30.0, 0.0).unwrap();
        let doc=workspace.source.as_ref().unwrap();
        assert_eq!(doc.shapes.len(),2);
        assert_eq!(doc.shapes[0].uid,before);
        let b=zigzag::svg::shapes_bounds(&doc.shapes[1..]);
        assert!((b.width()-400.0).abs()<1.0);
        assert!((b.center().x-300.0).abs()<1.0);
        assert_eq!(workspace.undo.last().unwrap().1.as_ref().unwrap().shapes.len(),1);
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

mod desktop_updates;
mod bundled_projects {
    include!(concat!(env!("OUT_DIR"), "/bundled_projects.rs"));
}
#[tauri::command]
fn prepared_bundled_designs()->Vec<&'static str>{
    bundled_projects::PREPARED_IDS.to_vec()
}
#[tauri::command]
async fn open_prepared_bundled_design(id:String,app:tauri::AppHandle)->Result<OpenedProject,String>{
    use tauri::Manager;
    let bytes=bundled_projects::prepared_project(&id).ok_or("No prepared stitch plan for this design; use Digitize instead.")?;
    tauri::async_runtime::spawn_blocking(move||{
        let project:Project=serde_json::from_slice(bytes).map_err(|e|e.to_string())?;
        let state=app.state::<Mutex<Workspace>>();
        project.restore(&state)
    }).await.map_err(|e|e.to_string())?
}
fn main(){desktop_updates::configure(tauri::Builder::default()).manage(Mutex::new(Workspace::default())).manage(agent_bridge::AgentBridge::default()).manage(editor_parity::StitchSettingsClipboard::default()).manage(Mutex::new(workspace_tabs::WorkspaceTabs::default())).invoke_handler(tauri::generate_handler![density_repair::preview_density_repair,density_repair::apply_stitch_review,lettering_edit::lettering_baseline,advanced_stitches::advanced_stitch_settings,advanced_stitches::set_advanced_stitches,workspace_tabs::workspace_tabs,workspace_tabs::change_workspace_tab,workspace_tabs::recoverable_workspace_tabs,workspace_tabs::restore_workspace_tab,workspace_tabs::restore_workspace_session,desktop_home::workspace_overview,desktop_home::new_blank_design,editor_parity::copy_object_stitch_settings,editor_parity::paste_object_stitch_settings,editor_parity::edit_object_stitch_controls,editor_parity::object_stitch_guides,canvas_drawing::draw_canvas_shape,assistant_composition::assistant_compose,assistant_motif::compose_assistant_design,assistant_motif::preview_assistant_motif,assistant_motif::insert_assistant_motif,assistant_motif::trace_assistant_motif,prepared_bundled_designs,open_prepared_bundled_design,insert_svg_artwork,specialty::preview_applique_letters,specialty::insert_applique_letters,insert_approved_design,stage_batch_draft,approve_batch_draft,discard_batch_draft,approved_batch_projects,path_edit::artwork_path,path_edit::update_artwork_path,history_labels,agent_bridge::start_agent_bridge,agent_bridge::agent_bridge_endpoint,agent_bridge::stop_agent_bridge,agent_bridge::agent_bridge_edit,stitch_tools::design_issues,stitch_tools::coverage_gap_preview,stitch_tools::apply_path_tool,stitch_tools::preview_test_swatches,stitch_tools::export_test_swatches,preview_simplification,cancel_simplification,apply_simplification,simplify_current_design,maximize_in_hoop,smart_resize_design,resize_artwork_selection,optimize_editable_design,delete_artwork_objects,desktop_updates::check_update,desktop_updates::save_update_access_key,desktop_updates::install_update,recolor_artwork_palette,recolor_artwork_group,set_artwork_group,transform_artwork_group,apply_reference_colors,move_artwork_objects,align_artwork_objects,lettering_edit::insert_lettering_settings,replace_design_color,center_design_axis,lettering_edit::lettering_settings,lettering_edit::update_lettering,import_project_files,import_artwork_files,saved_templates::insert_saved_template,saved_templates::import_template_archive,saved_templates::saved_templates,saved_templates::open_saved_template,saved_templates::preview_saved_template,fabric_profiles::fabric_catalog,fabric_profiles::current_fabric,fabric_profiles::apply_fabric_profile,machine_preview::preview_machine_commands,specialty::export_applique_cut_svg,set_canvas_fullscreen,insert_character,character_list,character_image,open_svg,export_multiple_formats, export_design,transform_design,mirror_design,center_design,audit_stitches,preview_coverage_repair,repair_stitches,recolor_block,history_step,current_preview,save_project,open_project,load_template,preview_template,insert_template,insert_embroidery,personal_designs,library_thumbnail,import_personal_designs,import_design_archive,get_routing_settings, set_routing_settings, get_specialty_settings, set_specialty_settings, copy_stitch_properties, set_sewing_commands, preview_artwork_styles,apply_artwork_density_preset, apply_stitch_properties,editable_objects,set_artwork_layer,reorder_artwork_object,edit_artwork_object,set_object_kind,create_specialty,preview_specialty,recovery_save,recovery_open,lettering_fonts,create_lettering,lettering_edit::preview_lettering,font_assets,import_fonts,import_dropped_font,remove_font_asset,choose_artwork,preview_cleanup,recognize_selected_lettering,preview_selected_lettering,recognize_artwork_lettering,digitize_artwork,compare_digitizer_draft,inspect_digitizer_coverage,export_digitizer_variant,apply_digitizer_draft,insert_digitizer_draft,scan_projects,project_thumbnail,library_open]).run(tauri::generate_context!()).expect("Stitch Studio failed to launch");}

#[cfg(test)]
mod fixed_resize_tests {
    #[test]
    fn automatic_logo_preview_can_meet_a_ten_thousand_stitch_goal() {
        use zigzag::document::Document;
        let mut source = Document::from_svg(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="90mm" viewBox="0 0 120 90">
            <rect id="badge" x="4" y="4" width="112" height="82" rx="8" fill="navy"/>
            <path id="initials" fill="white" fill-rule="evenodd"
            d="M18 28H45V62H18Z M25 36H38V54H25Z M62 28H101V36H87V62H76V36H62Z"/>
            </svg>"#, "Dense badge lettering", None,
        ).unwrap();
        source.shapes[0].params.spacing = Some(0.22);
        source.shapes[0].params.len = Some(1.6);
        source.shapes[1].groups.push("tl-small-ink-detail".into());
        source.sync().unwrap();
        assert!(source.shapes[1].groups.iter().any(|group|group=="tl-small-ink-detail"));
        let original = source.plan();
        let options = super::SimplifyOptions { quick: true, target_stitches: Some(10_000), ..Default::default() };
        let (document, candidate) = super::choose_simplification(&source, &original, 3, None, false, &options).unwrap();
        eprintln!("Badge stitch count: {} → {}", original.stitch_count(), candidate.stitch_count());
        assert!(original.stitch_count() > 20_000);
        assert!(candidate.stitch_count() <= 10_000);
        assert!(candidate.trim_count() <= original.trim_count());
        assert!(super::optimization_quality(&original, &candidate, 800., 3.).coverage >= 85.);
        assert_eq!(document.shapes[1].params, source.shapes[1].params);
        assert!(original.blocks.iter().map(|block|block.color).eq(candidate.blocks.iter().map(|block|block.color)));
        assert!(document.shapes[0].params.fill_spacing(&document.plan_options().fabric) <= 0.55);
    }

    #[test]
    fn longer_fill_stitches_reduce_textured_strips_without_changing_fill_density() {
        let strips: String = (0..14).map(|row| format!(
            r#"<rect x="4" y="{}" width="48" height="2" fill="black"/>"#, 4 + row * 3
        )).collect::<Vec<_>>().join("");
        let svg = format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="55mm" viewBox="0 0 60 55">{strips}</svg>"#
        );
        let mut source = zigzag::document::Document::from_svg(&svg, "Textured ribbon", None).unwrap();
        for shape in &mut source.shapes {
            shape.params.kind = Some(zigzag::params::Kind::Fill);
            shape.params.angle = Some(0.0);
            shape.params.spacing = Some(0.28);
            shape.params.len = Some(1.5);
        }
        source.sync().unwrap();
        let original = source.plan();
        let (doc, plan) = super::length_only_candidate(&source, &original, None, 3).unwrap();
        assert!(plan.stitch_count() * 10 < original.stitch_count() * 9);
        assert!(plan.trim_count() <= original.trim_count());
        assert!(super::optimization_quality(&original, &plan, 800., 3.).coverage >= 85.0);
        assert!(doc.shapes.iter().zip(&source.shapes).all(|(next, prior)|
            next.params.spacing == prior.params.spacing && next.params.angle == prior.params.angle));
    }

    #[test]
    fn maximum_refines_a_dense_fill_beyond_one_pass() {
        let mut source = zigzag::document::Document::from_svg(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="40mm" viewBox="0 0 80 40"><rect x="4" y="4" width="72" height="32" fill="red"/></svg>"#,
            "Dense fill", None,
        ).unwrap();
        source.shapes[0].params.spacing = Some(0.28);
        source.shapes[0].params.len = Some(2.2);
        source.sync().unwrap();
        let original = source.plan();
        let (_, single) = super::economical_fill_candidate(&source, &original, None, 3, 0.0).unwrap();
        let options = super::SimplifyOptions { quick: true, ..Default::default() };
        let (result, refined) = super::choose_simplification(&source, &original, 3, None, false, &options).unwrap();
        assert!(refined.stitch_count() < single.stitch_count());
        assert!(refined.trim_count() <= single.trim_count());
        assert!(super::optimization_quality(&original, &refined, 800., 3.).coverage >= 85.);
        let fabric = result.plan_options().fabric;
        assert!(result.shapes[0].params.fill_spacing(&fabric) <= 0.55);
        assert!(super::same_stitch_plan(&original, &source.plan()));
        eprintln!("Original: {}, one pass: {}, Maximum: {}", original.stitch_count(), single.stitch_count(), refined.stitch_count());
    }

    #[test]
    fn stopped_optimization_skips_new_candidate_plans() {
        use super::{SimplifyBudget, SimplifyOptions, choose_fast_stitch, choose_silhouette};
        let source = zigzag::document::Document::from_svg(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="40mm" viewBox="0 0 80 40"><rect x="4" y="4" width="72" height="32" fill="red"/></svg>"#,
            "Wide fill", None,
        ).unwrap();
        let original = source.plan();
        let budget = SimplifyBudget::new(std::time::Duration::from_secs(10));
        budget.cancel();
        let options = SimplifyOptions { budget: Some(budget), ..Default::default() };
        assert!(choose_fast_stitch(&source, &original, None, &options).is_err());
        assert!(choose_silhouette(&source, &original, None, &options).is_err());
    }

    #[test]
    fn solid_fill_joins_selected_shading_and_preserves_the_bow_opening_and_letter() {
        use zigzag::{document::Document, geom::{P, point_inside}, svg::Geometry};
        let source = Document::from_svg(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="30mm" viewBox="0 0 40 30">
              <path id="bow_loop" fill="red" fill-rule="evenodd" d="M2 2H22V16H2Z M7 6H17V12H7Z"/>
              <rect id="bow_shading" x="22.5" y="4" width="4" height="10" fill="red"/>
              <path id="letter" fill="blue" d="M4 20H8V27H4Z"/>
            </svg>"#, "Bow shading", None,
        ).unwrap();
        let selected: Vec<_> = source.shapes[..2].iter().map(|shape| shape.uid).collect();
        let letter = &source.shapes[2];
        let (solid, uid) = super::solid_selected_fill(&source, &selected, 8.0, None).unwrap();
        assert_eq!(solid.shapes.len(), 2);
        assert_eq!(solid.shapes[1].uid, letter.uid);
        assert_eq!(solid.shapes[1].color, letter.color);
        let bow = solid.shapes.iter().find(|shape| shape.uid == uid).unwrap();
        let Geometry::Fill { rings, rule } = &bow.geometry else { panic!("expected a fill") };
        assert!(!point_inside(rings, *rule, P::new(120.0, 90.0) - source.offset));
        assert!(point_inside(rings, *rule, P::new(222.0, 90.0) - source.offset));
        assert!(super::solid_selected_fill(&source, &[selected[0], letter.uid], 8.0, None).is_none());
        let original = source.plan();
        let (_, variant) = super::choose_silhouette(
            &source, &original, Some(&selected), &super::SimplifyOptions::default(),
        ).unwrap();
        assert!(variant.stitch_count() <= original.stitch_count() * 85 / 100);
        assert_eq!(super::measure_stitches(&variant).zero, 0);
        assert!(variant.trim_count() < original.trim_count());
    }

    #[test]
    fn explicit_solid_color_combines_different_shades_without_recoloring_other_artwork() {
        use zigzag::document::Document;
        let source = Document::from_svg(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="30mm" viewBox="0 0 40 30">
              <rect id="bow" x="2" y="2" width="20" height="14" fill="red"/>
              <rect id="shading" x="22" y="4" width="4" height="10" fill="orange"/>
              <rect id="letter" x="4" y="20" width="4" height="7" fill="blue"/>
            </svg>"#, "Bow shading", None,
        ).unwrap();
        let selected: Vec<_> = source.shapes[..2].iter().map(|shape| shape.uid).collect();
        let thread = [32, 80, 170];
        let (solid, _) = super::solid_selected_fill(&source, &selected, 8.0, Some(thread)).unwrap();
        assert_eq!(solid.shapes.len(), 2);
        assert_eq!(solid.shapes[0].color, thread);
        assert_eq!(solid.shapes[1].uid, source.shapes[2].uid);
        assert_eq!(solid.shapes[1].color, source.shapes[2].color);
        assert!(solid.plan().blocks.iter().any(|block| block.color == thread));
    }

    #[test]
    fn broad_fill_alternative_uses_fewer_stitches_with_the_same_row_spacing() {
        use zigzag::document::Document;
        let mut source = Document::from_svg(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="40mm" viewBox="0 0 80 40"><rect x="4" y="4" width="72" height="32" fill="red"/></svg>"#,
            "Wide fill", None,
        ).unwrap();
        source.shapes[0].params.len = Some(2.2);
        source.sync().unwrap();
        let original = source.plan();
        let (standard, previous) = super::economical_fill_candidate(&source, &original, None, 3, 0.0).unwrap();
        let (longer, improved) = super::economical_fill_candidate(&source, &original, None, 4, 0.0).unwrap();
        let (_, fast) = super::economical_fill_candidate(&source, &original, None, 5, 0.0).unwrap();
        assert_eq!(standard.shapes[0].params.spacing, longer.shapes[0].params.spacing);
        assert!(improved.stitch_count() < previous.stitch_count());
        assert!(fast.stitch_count() < improved.stitch_count());
        assert!(improved.trim_count() <= previous.trim_count());
        assert!(super::optimization_quality(&original, &improved, 800., 3.).coverage >= 90.0);
        assert!(super::optimization_quality(&original, &fast, 800., 3.).coverage >= 90.0);
    }

    #[test]
    fn hoop_fit_at_target_size_only_moves_the_existing_stitch_plan() {
        use zigzag::{design::{Block, Run}, document::Document, geom::P};

        let source = Document::from_svg(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40"><rect x="5" y="5" width="30" height="30" fill="red"/></svg>"#,
            "Hoop fit", None,
        ).unwrap();
        let points = vec![P::new(-60., -30.), P::new(140., 120.), P::new(100., 10.)];
        // A saved plan can include edits that cannot be reproduced from its artwork.
        let original = super::Design { name: "Hoop fit".into(), blocks: vec![Block {
            color: [255, 0, 0], runs: vec![Run { pts: points.clone(), trim_before: true }],
        }], ..Default::default() };
        let before_xml = source.to_svg().unwrap();
        let before_offset = source.offset;
        let mut workspace = super::Workspace { current: Some(original), source: Some(source), ..Default::default() };
        super::fit_workspace_in_hoop(&mut workspace, 24., 24., 2., false).unwrap();
        let shift = P::new(-40., -45.);
        let run = &workspace.current.as_ref().unwrap().blocks[0].runs[0];
        assert_eq!(run.pts, points.into_iter().map(|point| point + shift).collect::<Vec<_>>());
        assert!(run.trim_before);
        let source = workspace.source.as_ref().unwrap();
        assert_eq!(source.to_svg().unwrap(), before_xml);
        assert_eq!(source.offset, before_offset - shift);
        let restored = Document::restore_svg(&before_xml, &source.name, source.offset).unwrap();
        assert_eq!(zigzag::svg::shapes_bounds(&restored.shapes).center(), zigzag::svg::shapes_bounds(&source.shapes).center());
        // Repeating an already centered fit does not consume an undo slot.
        super::fit_workspace_in_hoop(&mut workspace, 24., 24., 2., false).unwrap();
        assert_eq!(workspace.undo.len(), 1);
    }

    #[test]
    fn hoop_fit_regenerates_editable_stitches_at_the_larger_size() {
        use zigzag::document::Document;
        let source = Document::from_svg(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="30mm" viewBox="0 0 40 30"><ellipse cx="20" cy="15" rx="15" ry="8" fill="red"/></svg>"#,
            "Hoop fit", None,
        ).unwrap();
        let original = source.plan();
        let original_stitches = original.stitch_count();
        let mut workspace = super::Workspace { current: Some(original), source: Some(source), ..Default::default() };
        super::fit_workspace_in_hoop(&mut workspace, 74., 54., 2., true).unwrap();
        let design = workspace.current.as_ref().unwrap();
        let bounds = design.bounds();
        assert!(bounds.center().len() < 0.001);
        assert!(bounds.width() > 680.0 && bounds.width() <= 700.1);
        assert!(bounds.height() > 480.0 && bounds.height() <= 500.1);
        assert!(design.stitch_count() > original_stitches * 2);
        assert_eq!(workspace.undo.len(), 1);
    }

 use super::*;use zigzag::geom::P;
 #[test] fn simplify_needle_path_removes_collinear_penetrations(){let p:Vec<_>=(0..40).map(|i|P::new(i as f64*5.,0.)).collect();let q=simplify_needle_path(&p,35.,0.6);assert!(q.len()<p.len()/2);assert_eq!(q.first(),p.first());assert_eq!(q.last(),p.last());assert!(q.windows(2).all(|w|w[0].dist(w[1])<=35.));}
 #[test] fn simplify_needle_path_protects_zigzags(){let p:Vec<_>=(0..40).map(|i|P::new(i as f64*3.,if i%2==0{0.}else{20.})).collect();assert_eq!(simplify_needle_path(&p,35.,0.6),p);}
 #[test] fn curved_satin_preserves_endpoints(){let mut p=Vec::new();for i in 0..16{let a=i as f64*0.08;for r in [40.,60.]{p.push(P::new(r*a.cos()*1.5,r*a.sin()*1.5));}}let q=regenerate_satin_run(&p,1.5,1.5).unwrap();assert!(q.len()>p.len());assert!(q[0].dist(p[0])<0.001);assert!(q.last().unwrap().dist(*p.last().unwrap())<0.001);}
 #[test] fn running_stitch_pitch_survives_resize(){let p:Vec<_>=(0..12).map(|i|P::new(i as f64*40.,0.)).collect();let q=regenerate_running_run(&p,2.,1.).unwrap();assert!(q.len()>p.len());assert_eq!(q.first(),p.first());assert_eq!(q.last(),p.last());assert!(reconstruction_ok(&p,&q));}
 #[test] fn rejects_reconstruction_outside_original(){let a=vec![P::new(0.,0.),P::new(100.,0.)];let b=vec![a[0],P::new(50.,100.),a[1]];assert!(!reconstruction_ok(&a,&b));}
 #[test] fn mixed_run_keeps_leading_and_trailing_ties(){let mut p=vec![P::new(-20.,0.),P::new(-20.,0.)];for i in 0..32{p.push(P::new(0.,i as f64*8.));p.push(P::new(30.,i as f64*8.+4.));}p.extend([P::new(40.,260.),P::new(40.,260.)]);let q=regenerate_mixed_run(&p,1.,2.);assert_eq!(&q[..2],&p[..2]);assert_eq!(&q[q.len()-2..],&p[p.len()-2..]);}
 #[test] fn regular_fill_adds_rows_when_enlarged(){let mut p=Vec::new();for row in 0..8{for i in 0..5{let x=if row%2==0{i}else{4-i};p.push(P::new(x as f64*20.,row as f64*8.));}}let rebuilt=regenerate_fill_run(&p,1.,2.).unwrap();assert!(rebuilt.len()>p.len());assert_eq!(rebuilt.first(),p.first());assert_eq!(rebuilt.last(),p.last());}
 #[test] fn satin_density_is_rebuilt_when_column_length_doubles(){let mut p=Vec::new();for i in 0..10{p.push(P::new(0.,i as f64*8.));p.push(P::new(30.,i as f64*8.+4.));}let result=regenerate_satin_run(&p,1.,2.).unwrap();assert!(result.len()>p.len());assert_eq!(result.first(),p.first());assert_eq!(result.last(),p.last());}
    #[test]
    fn long_moves_are_split_and_endpoints_preserved() {
        let a = P::new(0.0, 0.0);
        let b = P::new(250.0, 0.0);
        let r = resize_fixed_run(&[a, b], false, &mut 4).unwrap();
        assert_eq!(r.first(), Some(&a));
        assert_eq!(r.last(), Some(&b));
        assert!(r.windows(2).all(|p| p[0].dist(p[1]) <= 100.001));
    }

    #[test]
    fn directional_changes_and_ties_survive_reduction() {
        let a = P::new(0.0, 0.0);
        let b = P::new(1.0, 0.0);
        let corner = P::new(1.0, 0.1);
        let points = [a, a, b, a, b, corner, b, a];
        assert_eq!(resize_fixed_run(&points, true, &mut 8).unwrap(), points);
    }

    #[test]
    fn subdivision_checks_budget_before_allocating() {
        let points = [P::new(0.0, 0.0), P::new(1e12, 0.0)];
        let mut budget = 4;
        assert!(resize_fixed_run(&points, false, &mut budget).is_err());
        assert_eq!(budget, 3);
    }

    fn machine_boundaries(design: &Design) -> Vec<([u8; 3], Vec<bool>)> {
        design.blocks.iter().map(|block| {
            (block.color, block.runs.iter().map(|run| run.trim_before).collect())
        }).collect()
    }

    #[test]
    fn six_independent_formats_keep_run_boundaries_during_resize() {
        use zigzag::document::Document;
        let fixtures: [(&str, &[u8]); 6] = [
            ("dst", include_bytes!("../../../tests/fixtures/machine-import/two-color-path.dst")),
            ("pes", include_bytes!("../../../tests/fixtures/machine-import/two-color-path.pes")),
            ("pec", include_bytes!("../../../tests/fixtures/machine-import/two-color-path.pec")),
            ("exp", include_bytes!("../../../tests/fixtures/machine-import/two-color-path.exp")),
            ("jef", include_bytes!("../../../tests/fixtures/machine-import/two-color-path.jef")),
            ("vp3", include_bytes!("../../../tests/fixtures/machine-import/two-color-path.vp3")),
        ];
        for (extension, bytes) in fixtures {
            let imported = formats::read::read_stitch_file(bytes, extension).unwrap();
            let original = Document::from_svg(&formats::read::to_svg(&imported), "Fixture", None).unwrap();
            let before = original.plan();
            let indices: Vec<_> = (0..original.shapes.len()).collect();
            for (sx, sy) in [(1.0, 1.0), (4.0, 2.5), (0.5, 0.7)] {
                let mut document = original.clone();
                transform_for_resize(&mut document, &indices, [sx, 0.0, 0.0, sy, 0.0, 0.0], sx, sy).unwrap();
                let after = document.plan();
                validate_resized_design(&after).unwrap();
                assert_eq!(machine_boundaries(&after), machine_boundaries(&before), "{extension}");
                assert!((after.bounds().width() - before.bounds().width() * sx).abs() < 0.1, "{extension}");
                assert!((after.bounds().height() - before.bounds().height() * sy).abs() < 0.1, "{extension}");
                for (before, after) in before.blocks.iter().flat_map(|b| &b.runs).zip(after.blocks.iter().flat_map(|b| &b.runs)) {
                    for (a, b) in [(before.pts.first(), after.pts.first()), (before.pts.last(), after.pts.last())] {
                        let a = a.unwrap();
                        assert!(b.unwrap().dist(P::new(a.x * sx, a.y * sy)) < 0.1, "{extension}");
                    }
                    assert!(after.pts.windows(2).all(|pair| pair[0].dist(pair[1]) <= 100.01), "{extension}");
                }
                let reopened = Document::restore_svg(&document.to_svg().unwrap(), &document.name, document.offset)
                    .unwrap().plan();
                assert_eq!(formats::dst::stream(&reopened), formats::dst::stream(&after), "{extension}");
                for format in ["dst", "pes"] {
                    let encoded = formats::write_format(&after, format).unwrap();
                    let read_back = formats::read::read_stitch_file(&encoded, format).unwrap();
                    assert_eq!(read_back.blocks.len(), imported.blocks.len(), "{extension} to {format}");
                }
            }
        }
    }

    #[test]
    fn resize_preserves_same_thread_stop_and_other_run_boundaries() {
        use zigzag::{document::Document, formats::read::{StitchBlock, StitchFile}};
        let file = StitchFile {
            name: "Stops and trims".into(),
            blocks: vec![
                StitchBlock { color: [20, 50, 100], runs: vec![
                    vec![P::new(0.0, 0.0), P::new(75.0, 0.0)],
                    vec![P::new(80.0, 0.0), P::new(90.0, 0.0)],
                ] },
                StitchBlock { color: [20, 50, 100], runs: vec![
                    vec![P::new(95.0, 0.0), P::new(150.0, 30.0)],
                ] },
            ],
        };
        let mut document = Document::from_svg(&formats::read::to_svg(&file), &file.name, None).unwrap();
        let before = document.plan();
        let boundary = machine_boundaries(&before);
        assert_eq!(boundary.len(), 2);
        assert_eq!(boundary[0].0, boundary[1].0);
        assert!(boundary[0].1[1]);
        let indices: Vec<_> = (0..document.shapes.len()).collect();
        transform_for_resize(&mut document, &indices, [2.0, 0.0, 0.0, 0.7, 0.0, 0.0], 2.0, 0.7).unwrap();
        let after = document.plan();
        assert_eq!(machine_boundaries(&after), boundary);
        let commands = formats::dst::stream(&after);
        assert_eq!(commands.iter().filter(|cmd| cmd.op == formats::Op::ColorChange).count(), 1);
    }

    #[test]
    fn numeric_object_scale_corrects_only_the_selected_stitch_path() {
        use zigzag::{document::Document, formats::read::{StitchBlock, StitchFile}};
        let file = StitchFile {
            name: "Two runs".into(),
            blocks: vec![StitchBlock { color: [20, 50, 100], runs: vec![
                vec![P::new(0.0, 0.0), P::new(80.0, 10.0)],
                vec![P::new(90.0, 40.0), P::new(100.0, 50.0)],
            ] }],
        };
        let document = Document::from_svg(&formats::read::to_svg(&file), &file.name, None).unwrap();
        let selected = document.shapes[0].uid;
        let before = document.plan();
        let mut workspace = Workspace { current: Some(before.clone()), source: Some(document), ..Default::default() };
        apply_object_edit(&mut workspace, selected, ObjectEdit::Scale { factor: 2.0 }).unwrap();
        let after = workspace.current.as_ref().unwrap();
        assert_eq!(machine_boundaries(after), machine_boundaries(&before));
        assert!(after.blocks[0].runs[0].pts.len() > before.blocks[0].runs[0].pts.len());
        assert_eq!(after.blocks[0].runs[1].pts, before.blocks[0].runs[1].pts);
        assert!(workspace.source.is_some());
        assert_eq!(workspace.undo.len(), 1);
    }

    #[test]
    fn resizing_a_stitch_only_project_retains_commands_and_undo() {
        use zigzag::design::{Block, Run};
        let original = Design {
            name: "Legacy stitch project".into(),
            blocks: vec![Block { color: [1, 2, 3], runs: vec![
                Run { pts: vec![P::new(0.0, 0.0), P::new(90.0, 0.0)], trim_before: false },
                Run { pts: vec![P::new(100.0, 60.0), P::new(100.0, 120.0)], trim_before: true },
            ] }],
            ..Default::default()
        };
        let mut workspace = Workspace { current: Some(original.clone()), ..Default::default() };
        apply_design_transform(&mut workspace, 1.0, 0.0, 0.0, 0.0).unwrap();
        assert!(workspace.undo.is_empty());
        apply_design_transform(&mut workspace, 2.0, 0.0, 0.0, 0.0).unwrap();
        let after = workspace.current.as_ref().unwrap();
        assert_eq!(machine_boundaries(after), machine_boundaries(&original));
        assert!(after.stitch_count() > original.stitch_count());
        assert_eq!(after.bounds().width(), original.bounds().width() * 2.0);
        assert_eq!(formats::dst::write_dst(&workspace.undo[0].0), formats::dst::write_dst(&original));
        assert!(workspace.source.is_none());
    }
}
