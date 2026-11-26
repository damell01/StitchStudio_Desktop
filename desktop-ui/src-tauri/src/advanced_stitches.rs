use super::{
    Preview, Workspace,
    editor_parity::{editable_index, regenerate},
};
use std::sync::Mutex;
use tauri::Manager;
use zigzag::{document::Document, params::Kind, stitch::satin::SatinStyle};

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(super) enum Settings {
    Satin {
        style: String,
        split: f64,
        short_stitches: bool,
        underlay: Option<u8>,
    },
    Contour {
        spiral: bool,
    },
    Cross {
        cell: f64,
    },
    Run {
        repeats: u32,
    },
    Tartan {
        stripes: Vec<([u8; 3], f64)>,
    },
}

fn read(document: &Document, uid: usize) -> Result<Option<Settings>, String> {
    let shape = &document.shapes[editable_index(document, uid)?];
    let params = &shape.params;
    Ok(match params.kind {
        Some(Kind::Satin) => Some(Settings::Satin {
            style: params.satin_style().name().into(),
            split: params.satin_split().unwrap_or(0.0),
            short_stitches: params.short_stitches_on(),
            underlay: params.satin_underlay,
        }),
        Some(Kind::Contour | Kind::Ripple) => Some(Settings::Contour {
            spiral: params.spiral.unwrap_or(false),
        }),
        Some(Kind::Cross) => Some(Settings::Cross {
            cell: params.cross_cell(),
        }),
        Some(Kind::Run) => Some(Settings::Run {
            repeats: params.run_repeats(),
        }),
        Some(Kind::Tartan) => Some(Settings::Tartan {
            stripes: params.tartan_sett(shape.color),
        }),
        _ => None,
    })
}

fn apply(document: &mut Document, uid: usize, settings: Settings) -> Result<(), String> {
    let index = editable_index(document, uid)?;
    let p = &mut document.shapes[index].params;
    match (p.kind, settings) {
        (
            Some(Kind::Satin),
            Settings::Satin {
                style,
                split,
                short_stitches,
                underlay,
            },
        ) => {
            let style = SatinStyle::parse(&style).ok_or("Choose a supported satin pattern.")?;
            if !(split == 0.0 || (3.0..=12.0).contains(&split))
                || underlay.is_some_and(|mask| mask > 7)
            {
                return Err("Set satin split to 0 or 3–12 mm and choose a valid underlay.".into());
            }
            p.style = Some(style);
            p.split = Some(split);
            p.short_stitches = Some(short_stitches);
            if let Some(mask) = underlay {
                p.underlay = Some(mask != 0);
            } else if p.satin_underlay.is_some() {
                p.underlay = None;
            }
            p.satin_underlay = underlay;
        }
        (Some(Kind::Contour | Kind::Ripple), Settings::Contour { spiral }) => {
            p.spiral = Some(spiral)
        }
        (Some(Kind::Cross), Settings::Cross { cell }) if (0.5..=10.0).contains(&cell) => {
            p.cell = Some(cell)
        }
        (Some(Kind::Run), Settings::Run { repeats }) if (1..=5).contains(&repeats) => {
            p.repeats = Some(repeats)
        }
        (Some(Kind::Tartan), Settings::Tartan { stripes })
            if (1..=8).contains(&stripes.len())
                && stripes
                    .iter()
                    .all(|(_, width)| (0.5..=20.0).contains(width)) =>
        {
            p.sett = Some(stripes)
        }
        _ => return Err("Check the stitch type and the allowed setting range.".into()),
    }
    Ok(())
}

#[tauri::command]
pub(super) fn advanced_stitch_settings(
    uid: usize,
    state: tauri::State<'_, Mutex<Workspace>>,
) -> Result<Option<Settings>, String> {
    let workspace = state.lock().map_err(|error| error.to_string())?;
    let document = workspace
        .source
        .as_ref()
        .ok_or("Open editable artwork first.")?;
    read(document, uid)
}

#[tauri::command]
pub(super) async fn set_advanced_stitches(
    uid: usize,
    settings: Settings,
    app: tauri::AppHandle,
) -> Result<Preview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let mut workspace = state.lock().map_err(|error| error.to_string())?;
        let mut document = workspace
            .source
            .clone()
            .ok_or("Open editable artwork first.")?;
        apply(&mut document, uid, settings)?;
        regenerate(&mut workspace, document, "Change advanced stitch settings")
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_advanced_satin_and_preserves_its_thread() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm"><path id="ribbon_satin" d="M10 20L120 20" stroke="navy" stroke-width="12" fill="none"/></svg>"#;
        let mut document = Document::from_svg(svg, "Ribbon", None).unwrap();
        let uid = document.shapes[0].uid;
        let color = document.shapes[0].color;
        apply(
            &mut document,
            uid,
            Settings::Satin {
                style: "s".into(),
                split: 5.0,
                short_stitches: false,
                underlay: Some(5),
            },
        )
        .unwrap();
        document.sync().unwrap();
        assert!(matches!(
            read(&document, uid).unwrap(),
            Some(Settings::Satin {
                underlay: Some(5),
                ..
            })
        ));
        assert_eq!(document.shapes[0].params.style, Some(SatinStyle::SStitch));
        assert_eq!(document.shapes[0].color, color);
        assert!(document.plan().stitch_count() > 0);
        assert!(apply(&mut document, uid, Settings::Cross { cell: 2.0 }).is_err());
    }
}
