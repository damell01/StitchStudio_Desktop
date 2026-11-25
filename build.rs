fn main() {
    if std::env::var_os("CARGO_FEATURE_OCR").is_some() { prepare_ocr_models(); }
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=packaging/windows/AppIcon.ico");
    println!("cargo:rerun-if-changed=Cargo.toml");

    // On Windows every ZigZag .exe gets its icon and version metadata from a
    // resource compiled in by winresource. Elsewhere this file is a no-op.
    #[cfg(windows)]
    {
        let icon = std::path::Path::new("packaging/windows/AppIcon.ico");
        if !icon.exists() {
            println!(
                "cargo:warning=packaging/windows/AppIcon.ico is missing; \
                 run packaging/windows/make-icon.sh to regenerate it."
            );
            return;
        }
        let mut res = winresource::WindowsResource::new();
        res.set_icon(icon.to_str().unwrap());
        res.set("ProductName", "ZigZag");
        res.set("FileDescription", "ZigZag embroidery studio");
        res.set("CompanyName", "ZigZag");
        res.set("LegalCopyright", "Apache-2.0 licensed. See NOTICE.");
        res.set("ProductVersion", env!("CARGO_PKG_VERSION"));
        res.set("FileVersion", env!("CARGO_PKG_VERSION"));
        if let Err(e) = res.compile() {
            println!("cargo:warning=winresource compile failed: {e}");
        }
    }
}


// Fetch pinned model weights at build time, not while using the editor.
// The desktop executable embeds them, so no runtime network or sidecar is needed.
fn prepare_ocr_models() {
    use sha2::{Digest, Sha256};
    use std::{fs, path::PathBuf, process::Command};
    println!("cargo:rerun-if-env-changed=STITCHSTUDIO_OCR_MODELS");
    let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    for (name, digest) in [
        ("text-detection.rten", "f15cfb56bd02c4bf478a20343986504a1f01e1665c2b3a0ad66340f054b1b5ca"),
        ("text-recognition.rten", "e484866d4cce403175bd8d00b128feb08ab42e208de30e42cd9889d8f1735a6e"),
    ] {
        let dest = out.join(name);
        let valid = |path: &std::path::Path| fs::read(path).ok()
            .is_some_and(|bytes| format!("{:x}", Sha256::digest(bytes)) == digest);
        if let Some(dir) = std::env::var_os("STITCHSTUDIO_OCR_MODELS") {
            let source = PathBuf::from(dir).join(name);
            println!("cargo:rerun-if-changed={}", source.display());
            assert!(valid(&source), "Invalid offline OCR model: {}", source.display());
            fs::copy(source, &dest).expect("copy OCR model");
        } else if !valid(&dest) {
            let tmp = out.join(format!("{name}.download"));
            let url = format!("https://ocrs-models.s3-accelerate.amazonaws.com/{name}");
            let status = Command::new("curl").args(["--fail", "--location", "--silent", "--show-error", "--retry", "2", "--connect-timeout", "15", "--max-time", "180", "--output"])
                .arg(&tmp).arg(url).status().expect("curl is needed for the first OCR model build; alternatively set STITCHSTUDIO_OCR_MODELS");
            assert!(status.success() && valid(&tmp), "OCR model download or checksum failed: {name}");
            if dest.exists() { fs::remove_file(&dest).expect("remove invalid OCR model"); }
            fs::rename(tmp, &dest).expect("cache verified OCR model");
        }
    }
}
