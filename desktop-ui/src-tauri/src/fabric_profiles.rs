use crate::{Preview, Workspace, preview};
use std::sync::Mutex;
use zigzag::params::{FABRICS, Fabric, Kind};

#[derive(serde::Serialize)]
pub(crate) struct FabricInfo {
    id: &'static str,
    name: &'static str,
    group: &'static str,
    about: &'static str,
    stabilizer: &'static str,
    needle: &'static str,
}

#[tauri::command]
pub(crate) fn fabric_catalog() -> Vec<FabricInfo> {
    FABRICS.iter().map(|profile| FabricInfo {
        id: profile.id, name: profile.name, group: profile.group,
        about: profile.about, stabilizer: profile.stabilizer, needle: profile.needle,
    }).collect()
}

#[tauri::command]
pub(crate) async fn current_fabric(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let workspace = state.lock().map_err(|error| error.to_string())?;
        Ok(workspace.source.as_ref().map(|document| document.settings.fabric.clone()))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn apply_fabric_profile(fabric: String, state: tauri::State<'_, Mutex<Workspace>>) -> Result<Preview, String> {
    let profile = Fabric::by_id(&fabric).ok_or("Choose a listed fabric")?;
    let mut workspace = state.lock().map_err(|error| error.to_string())?;
    let mut source = workspace.source.clone().ok_or("Open editable artwork to apply a fabric profile")?;
    if source.shapes.iter().all(|shape| matches!(shape.params.kind, Some(Kind::Manual | Kind::Skip))) {
        return Err("This design contains only fixed stitch paths. Fabric profiles apply to editable artwork.".into());
    }
    if source.settings.fabric == profile.id {
        return workspace.current.as_ref().map(preview).ok_or_else(|| "Open a design first".to_owned());
    }
    // The planner takes unset properties from the document's fabric. Keep
    // every explicit object setting and imported manual path intact.
    source.settings.fabric = profile.id.to_owned();
    let design = source.plan();
    if design.stitch_count() == 0 { return Err("This fabric produced no stitches".into()); }
    let result = preview(&design);
    workspace.checkpoint_named("Change fabric profile");
    workspace.current = Some(design);
    workspace.source = Some(source);
    Ok(result)
}
