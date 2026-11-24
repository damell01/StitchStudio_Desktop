use std::{fs,path::Path};
fn main() {
    let path=Path::new("icons/icon.ico");
    if !path.exists() {
        fs::create_dir_all("icons").expect("create icon directory");
        let n=32usize;
        let image_size=n*n*4;
        let mask_size=n*4;
        let mut ico=Vec::new();
        ico.extend_from_slice(&[0,0,1,0,1,0,32,32,0,0,1,0,32,0]);
        ico.extend_from_slice(&((40+image_size+mask_size) as u32).to_le_bytes());
        ico.extend_from_slice(&22u32.to_le_bytes());
        for v in [40u32,n as u32,(n*2) as u32] {ico.extend_from_slice(&v.to_le_bytes());}
        ico.extend_from_slice(&1u16.to_le_bytes());
        ico.extend_from_slice(&32u16.to_le_bytes());
        for v in [0u32,image_size as u32,0,0,0,0] {ico.extend_from_slice(&v.to_le_bytes());}
        for y in 0..n {for x in 0..n {
            let stitch=(x>=7&&x<=24&&((y>=20&&y<=23)||(y>=8&&y<=11)))||(x>=7&&x<=10&&y>=14&&y<=23)||(x>=21&&x<=24&&y>=8&&y<=17)||(y>=14&&y<=17&&x>=7&&x<=24);
            ico.extend_from_slice(if stitch {&[230,237,229,255]} else {&[54,69,35,255]});
        }}
        ico.resize(ico.len()+mask_size,0);
        fs::write(path,ico).expect("write Windows icon");
    }
    tauri_build::build();
}
