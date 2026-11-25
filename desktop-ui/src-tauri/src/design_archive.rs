//! Bounded ZIP imports for the offline design and template libraries.
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tempfile::NamedTempFile;
use zigzag::formats;
use zip::ZipArchive;

#[derive(Clone, Copy)]
struct Limits {
    archive_bytes: usize,
    member_bytes: usize,
    expanded_bytes: usize,
    entries: usize,
}

const LIMITS: Limits = Limits {
    archive_bytes: 50_000_000,
    member_bytes: 8_000_000,
    expanded_bytes: 64_000_000,
    entries: 1_000,
};

#[derive(Debug, Default, serde::Serialize)]
pub(crate) struct Report {
    imported: usize,
    duplicates: usize,
    skipped: usize,
}

fn read_limited(reader: impl Read, limit: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > limit {
        return Err("Archive data exceeds its size limit".into());
    }
    Ok(bytes)
}

// Bound the central directory before the ZIP reader allocates per-entry metadata.
// This importer accepts ordinary single-volume ZIPs including archive comments.
fn check_directory(bytes: &[u8], limits: Limits) -> Result<usize, String> {
    let tail = &bytes[bytes.len().saturating_sub(22 + u16::MAX as usize)..];
    for (offset, signature) in tail.windows(4).enumerate().rev() {
        if signature != b"PK\x05\x06" {
            continue;
        }
        let record = &tail[offset..];
        if record.len() < 22 {
            continue;
        }
        let word = |i| u16::from_le_bytes([record[i], record[i + 1]]) as usize;
        if record.len() != 22 + word(20) {
            continue;
        }
        let count = word(10);
        let central_size = u32::from_le_bytes(record[12..16].try_into().unwrap()) as usize;
        if word(4) != 0 || word(6) != 0 || word(8) != count || count == u16::MAX as usize {
            return Err("Choose a single-volume ZIP archive".into());
        }
        if count > limits.entries || central_size > 4_000_000 {
            return Err(format!(
                "ZIP index exceeds the import limit of {} entries and 4 MB",
                limits.entries
            ));
        }
        let absolute = bytes.len() - record.len();
        let central_start = u32::from_le_bytes(record[16..20].try_into().unwrap()) as usize;
        if central_start.checked_add(central_size) != Some(absolute) {
            return Err("The ZIP directory does not match its recorded location".into());
        }
        // ZIP64 can advertise a second, different count to an archive reader.
        if absolute >= 20 && &bytes[absolute - 20..absolute - 16] == b"PK\x06\x07" {
            return Err("ZIP64 collections are not supported by the library importer".into());
        }
        return Ok(count);
    }
    Err("The ZIP index is missing or damaged".into())
}

fn portable_name(name: &str) -> Result<Option<&str>, String> {
    let path = name.trim_end_matches('/');
    if path.is_empty()
        || name.starts_with('/')
        || path.contains('\\')
        || path
            .chars()
            .any(|c| c.is_control() || "<>:\"|?*".contains(c))
    {
        return Err("The ZIP contains an unsafe file path".into());
    }
    let mut leaf = None;
    for part in path.split('/') {
        if part == "." {
            continue;
        }
        if part == ".." || part.is_empty() || part.ends_with([' ', '.']) || part.len() > 220 {
            return Err("The ZIP contains an unsafe file path".into());
        }
        let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        let numbered_device = ["COM", "LPT"].iter().any(|prefix| {
            base.strip_prefix(prefix).is_some_and(|suffix| {
                suffix.len() == 1 && b"123456789".contains(&suffix.as_bytes()[0])
                    || matches!(suffix, "¹" | "²" | "³")
            })
        });
        if matches!(
            base.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
        ) || numbered_device
        {
            return Err("The ZIP contains a reserved filename".into());
        }
        leaf = Some(part);
    }
    if path
        .split('/')
        .any(|part| part == "__MACOSX" || part.starts_with("._"))
    {
        return Ok(None);
    }
    Ok(leaf)
}

fn validate_members(
    bytes: &[u8],
    limits: Limits,
    target: Target,
) -> Result<(Vec<(String, Vec<u8>)>, usize), String> {
    let entries = check_directory(bytes, limits)?;
    let config = zip::read::Config {
        archive_offset: zip::read::ArchiveOffset::Known(0),
    };
    let mut archive = ZipArchive::with_config(config, Cursor::new(bytes))
        .map_err(|e| format!("Cannot open ZIP: {e}"))?;
    if archive.len() != entries
        || archive.has_duplicate_names()
        || archive
            .has_overlapping_entries()
            .map_err(|e| e.to_string())?
    {
        return Err("The ZIP has duplicate entries or an inconsistent index".into());
    }
    if !archive
        .decompressed_size()
        .is_some_and(|size| size <= limits.expanded_bytes as u128)
    {
        return Err(format!(
            "The expanded ZIP exceeds {} MB",
            limits.expanded_bytes / 1_000_000
        ));
    }
    let mut designs = Vec::new();
    let mut skipped = 0;
    for index in 0..entries {
        let entry = archive.by_index_raw(index).map_err(|e| e.to_string())?;
        let name = entry.name().map_err(|e| e.to_string())?;
        let filename = portable_name(&name)?;
        if entry.enclosed_name().is_none()
            || entry.is_symlink()
            || entry
                .unix_mode()
                .is_some_and(|mode| !matches!(mode & 0o170000, 0 | 0o040000 | 0o100000))
        {
            return Err("The ZIP contains an unsupported path or link".into());
        }
        if entry.is_dir() {
            continue;
        }
        let Some(filename) = filename else {
            skipped += 1;
            continue;
        };
        let path = Path::new(filename);
        let extension = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !target.accepts(&extension) {
            skipped += 1;
            continue;
        }
        if entry.encrypted() {
            return Err("Password-protected designs cannot be imported".into());
        }
        let size = entry.size();
        if size > limits.member_bytes as u64 {
            return Err(format!(
                "{filename} exceeds the {} MB design limit",
                limits.member_bytes / 1_000_000
            ));
        }
        let filename = filename.to_owned();
        drop(entry);
        let member = archive
            .by_index(index)
            .map_err(|e| format!("Cannot read {filename}: {e}"))?;
        let data = read_limited(member, size as usize)?;
        if data.len() as u64 != size {
            return Err(format!("{filename} has an inconsistent size"));
        }
        target.validate(&data, &extension).map_err(|e| format!("Cannot import {filename}: {e}"))?;
        designs.push((filename, data));
    }
    Ok((designs, skipped))
}

fn same_file(path: &Path, bytes: &[u8]) -> io::Result<bool> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.len() != bytes.len() as u64 {
        return Ok(false);
    }
    let mut file = File::open(path)?;
    let mut buf = [0u8; 16384];
    for chunk in bytes.chunks(buf.len()) {
        file.read_exact(&mut buf[..chunk.len()])?;
        if &buf[..chunk.len()] != chunk {
            return Ok(false);
        }
    }
    Ok(file.read(&mut buf[..1])? == 0)
}

fn publish(
    destination: &Path,
    staging: &Path,
    name: &str,
    data: &[u8],
    sizes: &mut HashMap<(String, u64), Vec<PathBuf>>,
) -> Result<Option<PathBuf>, String> {
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Invalid design filename")?;
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .ok_or("Missing design extension")?
        .to_ascii_lowercase();
    let candidates = sizes.entry((ext.clone(), data.len() as u64)).or_default();
    for candidate in candidates.iter() {
        match same_file(candidate, data) {
            Ok(true) => return Ok(None),
            Ok(false) => (),
            Err(e) if e.kind() == io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.to_string()),
        }
    }
    let mut staged = NamedTempFile::new_in(staging).map_err(|e| e.to_string())?;
    staged.write_all(data).map_err(|e| e.to_string())?;
    staged.as_file().sync_all().map_err(|e| e.to_string())?;
    for suffix in 0..10_000 {
        let file = if suffix == 0 {
            format!("{stem}.{ext}")
        } else {
            format!("{stem} ({suffix}).{ext}")
        };
        let target = destination.join(file);
        match staged.persist_noclobber(&target) {
            Ok(_) => {
                candidates.push(target.clone());
                return Ok(Some(target));
            }
            Err(e) if e.error.kind() == io::ErrorKind::AlreadyExists => {
                staged = e.file;
                if same_file(&target, data).unwrap_or(false) {
                    return Ok(None);
                }
            }
            Err(e) => return Err(e.error.to_string()),
        }
    }
    Err(format!("Too many library files share the name {name}"))
}

#[derive(Clone, Copy)]
pub(crate) enum Target {
    Designs,
    Templates,
}

impl Target {
    fn accepts(self, extension: &str) -> bool {
        match self {
            Self::Designs => formats::READABLE_FORMATS.contains(&extension),
            Self::Templates => extension == "stitchstudio",
        }
    }

    fn validate(self, bytes: &[u8], extension: &str) -> Result<(), String> {
        match self {
            Self::Designs => {
                let design = formats::read::read_stitch_file(bytes, extension).map_err(|error| error.to_string())?;
                if design.blocks.is_empty() {
                    return Err("File contains no embroidery stitches".into());
                }
            }
            Self::Templates => {
                let project: crate::Project = serde_json::from_slice(bytes).map_err(|error| error.to_string())?;
                if project.validate()?.is_none_or(|document| document.shapes.iter().all(|shape|
                    matches!(shape.params.kind, Some(zigzag::params::Kind::Manual | zigzag::params::Kind::Skip))))
                {
                    return Err("Templates need editable artwork or lettering. Use the design library for machine files.".into());
                }
            }
        }
        Ok(())
    }
}

pub(crate) fn import(path: &Path, destination: &Path, target: Target) -> Result<Report, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > LIMITS.archive_bytes as u64 {
        return Err("The ZIP exceeds the 50 MB archive limit".into());
    }
    let bytes = read_limited(file, LIMITS.archive_bytes)?;
    let (designs, skipped) = validate_members(&bytes, LIMITS, target)?;
    let mut report = Report {
        skipped,
        ..Default::default()
    };
    if designs.is_empty() {
        return Ok(report);
    }
    static WRITE: Mutex<()> = Mutex::new(());
    let _write = WRITE.lock().map_err(|e| e.to_string())?;
    let staging = tempfile::tempdir_in(destination).map_err(|e| e.to_string())?;
    let mut sizes = HashMap::new();
    for entry in fs::read_dir(destination).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if metadata.is_file()
            && let Some(ext) = path.extension().and_then(|s| s.to_str())
        {
            sizes
                .entry((ext.to_ascii_lowercase(), metadata.len()))
                .or_insert_with(Vec::new)
                .push(path);
        }
    }
    let mut created = Vec::new();
    for (name, bytes) in designs {
        match publish(destination, staging.path(), &name, &bytes, &mut sizes) {
            Ok(Some(path)) => created.push(path),
            Ok(None) => report.duplicates += 1,
            Err(error) => {
                for path in created {
                    fs::remove_file(path).map_err(|e| format!("{error}; rollback failed: {e}"))?;
                }
                return Err(error);
            }
        }
    }
    report.imported = created.len();
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use zigzag::{
        design::{Block, Design, Run},
        geom::P,
    };
    use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

    fn machine(name: &str, ext: &str) -> Vec<u8> {
        formats::write_format(
            &Design {
                name: name.into(),
                blocks: vec![Block {
                    color: [81, 64, 117],
                    runs: vec![Run {
                        pts: vec![P::new(0.0, 0.0), P::new(8.0, 20.0), P::new(12.0, 4.0)],
                        trim_before: false,
                    }],
                }],
                ..Default::default()
            },
            ext,
        )
        .unwrap()
    }

    fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, data) in entries {
            zip.start_file(*name, options).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn nested_zip_import_accepts_every_machine_format() {
        let formats = formats::READABLE_FORMATS;
        let data: Vec<_> = formats.iter().map(|ext| machine("mixed formats", ext)).collect();
        let names: Vec<_> = formats.iter().map(|ext| format!("nested/design.{ext}")).collect();
        let entries: Vec<_> = names.iter().zip(&data)
            .map(|(name, bytes)| (name.as_str(), bytes.as_slice())).collect();
        let (imported, skipped) = validate_members(&archive(&entries), LIMITS, Target::Designs).unwrap();
        assert_eq!(imported.len(), formats.len());
        assert_eq!(skipped, 0);
    }

    #[test]
    fn imports_real_files_without_replacing_names_and_deduplicates_on_retry() {
        let destination = tempfile::tempdir().unwrap();
        fs::write(destination.path().join("flower.dst"), b"existing design").unwrap();
        let flower = machine("flower", "dst");
        let leaf = machine("leaf", "pes");
        let bundle = archive(&[
            ("collection/flower.DST", &flower),
            ("other/flower-copy.dst", &flower),
            ("leaf.pes", &leaf),
            ("readme.txt", b"worksheet"),
        ]);
        let mut source = NamedTempFile::new().unwrap();
        source.write_all(&bundle).unwrap();
        let result = import(source.path(), destination.path(), Target::Designs).unwrap();
        assert_eq!(
            (result.imported, result.duplicates, result.skipped),
            (2, 1, 1)
        );
        assert_eq!(
            fs::read(destination.path().join("flower.dst")).unwrap(),
            b"existing design"
        );
        assert_eq!(
            fs::read(destination.path().join("flower (1).dst")).unwrap(),
            flower
        );
        assert_eq!(fs::read(destination.path().join("leaf.pes")).unwrap(), leaf);
        let retry = import(source.path(), destination.path(), Target::Designs).unwrap();
        assert_eq!((retry.imported, retry.duplicates), (0, 3));
    }

    #[test]
    fn nested_archives_route_editable_layouts_and_machine_files_to_the_chosen_library() {
        let mut workspace = crate::Workspace::default();
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="28mm" height="20mm"><rect x="6" y="4" width="50" height="30" fill="purple"/></svg>"#;
        crate::insert_editable_artwork(&mut workspace, svg, "badge", 5.0, 0.0, false).unwrap();
        let project = crate::Project::capture(&workspace, 100.0, 100.0, "dst".into()).unwrap().unwrap();
        let project = serde_json::to_vec(&project).unwrap();
        let design = machine("flower", "dst");
        let bytes = archive(&[("seasonal/badges/badge.stitchstudio", &project), ("seasonal/flower.dst", &design)]);

        let (templates, skipped) = validate_members(&bytes, LIMITS, Target::Templates).unwrap();
        assert_eq!(skipped, 1);
        assert_eq!(templates, vec![("badge.stitchstudio".into(), project)]);
        let (designs, skipped) = validate_members(&bytes, LIMITS, Target::Designs).unwrap();
        assert_eq!(skipped, 1);
        assert_eq!(designs, vec![("flower.dst".into(), design)]);
    }

    #[test]
    fn rejects_bad_member_before_publishing_valid_members() {
        let destination = tempfile::tempdir().unwrap();
        let mut source = NamedTempFile::new().unwrap();
        source
            .write_all(&archive(&[
                ("valid.dst", &machine("good", "dst")),
                ("broken.pes", b"bad"),
            ]))
            .unwrap();
        assert!(
            import(source.path(), destination.path(), Target::Designs)
                .unwrap_err()
                .contains("broken.pes")
        );
        assert_eq!(fs::read_dir(destination.path()).unwrap().count(), 0);
    }

    #[test]
    fn enforces_index_and_expansion_limits_and_rejects_invalid_paths() {
        let bundle = archive(&[("a.dst", &[1; 200]), ("notes.txt", &[0; 1000])]);
        for limits in [
            Limits {
                entries: 1,
                ..LIMITS
            },
            Limits {
                member_bytes: 50,
                ..LIMITS
            },
            Limits {
                expanded_bytes: 200,
                ..LIMITS
            },
        ] {
            assert!(validate_members(&bundle, limits, Target::Designs).is_err());
        }
        assert!(validate_members(&bundle[..bundle.len() - 12], LIMITS, Target::Designs).is_err());
        for name in [
            "../other.dst",
            "/bad.dst",
            "C:/bad.dst",
            "hidden/PRN.exp",
            "hidden\\bad.dst",
            "notes.dst:extra",
        ] {
            assert!(portable_name(name).is_err(), "{name}");
        }
        let unsafe_bundle = archive(&[("../other.dst", &machine("flower", "dst"))]);
        assert!(validate_members(&unsafe_bundle, LIMITS, Target::Designs).is_err());
    }
}
