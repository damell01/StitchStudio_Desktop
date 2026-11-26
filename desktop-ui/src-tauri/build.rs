use std::{fs,path::PathBuf};
use serde_json::{Value,json};
use zigzag::{document::{Document,Placement},design::auto_stitch_types,svg::shapes_bounds};

fn main() {
    let base=PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let out=PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let mut entries=Vec::<Value>::new();
    for name in ["catalog.ts","sports.ts"] {
        let path=base.join("../src/bundled-artwork").join(name);
        println!("cargo:rerun-if-changed={}",path.display());
        let content=fs::read_to_string(path).expect("bundled artwork source");
        let array=content.split_once("=[").expect("JSON catalog array").1;
        let parsed:Vec<Value>=serde_json::from_str(&format!("[{}",array.trim().trim_end_matches(';'))).expect("valid artwork catalog");
        entries.extend(parsed);
    }
    let mut arms=String::new();
    let mut manifest=Vec::new();
    let mut ids=std::collections::HashSet::new();
    for item in entries {
        let id=item["id"].as_str().expect("artwork id");
        assert!(id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_')&&ids.insert(id.to_owned()),"invalid or duplicate artwork id: {id}");
        let svg=item["svg"].as_str().expect("artwork svg");
        let result=(||->Result<Value,String>{
            let name=id.replace(['-','_']," ");
            let mut doc=Document::empty();
            doc.name=name.clone();
            let added=doc.add_svg(svg,Placement{width_mm:Some(75.),center_mm:Some((0.,0.)),..Default::default()}).map_err(|e|e.to_string())?;
            if added.is_empty(){return Err("Empty artwork".into())}
            for i in added { if doc.shapes[i].params.kind.is_none(){auto_stitch_types(std::slice::from_mut(&mut doc.shapes[i]));} }
            let b=shapes_bounds(&doc.shapes);
            let factor=(750./b.width().max(b.height())).min(1.);
            if factor<1. {
                let ids:Vec<_>=(0..doc.shapes.len()).collect();let c=b.center();
                doc.transform(&ids,[factor,0.,0.,factor,c.x*(1.-factor),c.y*(1.-factor)]).map_err(|e|e.to_string())?;
            }
            doc.sync().map_err(|e|e.to_string())?;
            let design=doc.plan();
            if !(1..=200_000).contains(&design.stitch_count()){return Err("Invalid stitch count".into())}
            if design.blocks.iter().flat_map(|b|&b.runs).flat_map(|r|&r.pts).any(|p|!p.x.is_finite()||!p.y.is_finite()||p.x.abs()>490.||p.y.abs()>490.){return Err("Stitches outside default hoop".into())}
            let source=doc.to_svg().map_err(|e|e.to_string())?;
            let blocks:Vec<_>=design.blocks.iter().map(|b|json!({"color":b.color,"runs":b.runs.iter().map(|r|json!({"points":r.pts.iter().map(|p|[p.x,p.y]).collect::<Vec<_>>(),"trim_before":r.trim_before})).collect::<Vec<_>>() })).collect();
            Ok(json!({"version":1,"name":name,"source_svg":source,"source_offset":[doc.offset.x,doc.offset.y],"width":100.,"height":100.,"format":"dst","blocks":blocks}))
        })();
        match result {
            Ok(project)=>{
                let file=format!("bundled-{id}.json");
                fs::write(out.join(&file),serde_json::to_vec(&project).unwrap()).expect("write prepared design");
                arms.push_str(&format!("{id:?} => Some(include_bytes!(concat!(env!(\"OUT_DIR\"), \"/{file}\"))),\n"));
                manifest.push(id.to_owned());
            },
            Err(e)=>println!("cargo:warning=Bundled design {id} remains available as SVG: {e}")
        }
    }
    assert!(!manifest.is_empty(),"No bundled design could be prepared");
    let generated=format!("pub fn prepared_project(id: &str) -> Option<&'static [u8]> {{ match id {{ {arms} _=>None }} }}\npub const PREPARED_IDS: &[&str] = &{:?};",manifest);
    fs::write(out.join("bundled_projects.rs"),generated).expect("write bundled project index");
    println!("cargo:warning=Prepared {} of {} bundled embroidery designs",manifest.len(),ids.len());
    tauri_build::build();
}
