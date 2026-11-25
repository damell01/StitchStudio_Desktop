use crate::{OpenedProject, Preview, Project, Workspace, design_archive, open_project_path, preview};
use std::{path::{Component, Path, PathBuf}, sync::Mutex};
use tauri::Manager;

fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|error| error.to_string())?.join("templates");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn template_path(app: &tauri::AppHandle, file: &str) -> Result<PathBuf, String> {
    let mut parts = Path::new(file).components();
    if !matches!(parts.next(), Some(Component::Normal(_))) || parts.next().is_some()
        || !file.ends_with(".stitchstudio") {
        return Err("Choose a template from the library".into());
    }
    let path = directory(app)?.join(file);
    if !std::fs::symlink_metadata(&path).is_ok_and(|meta| meta.file_type().is_file()) {
        return Err("This template file is unavailable".into());
    }
    Ok(path)
}

#[tauri::command]
pub(crate) async fn import_template_archive(app: tauri::AppHandle) -> Result<Option<design_archive::Report>, String> {
    let Some(file) = rfd::AsyncFileDialog::new().add_filter("ZIP collection", &["zip"]).pick_file().await else {
        return Ok(None);
    };
    let path = file.path().to_owned();
    let destination = directory(&app)?;
    tauri::async_runtime::spawn_blocking(move ||
        design_archive::import(&path, &destination, design_archive::Target::Templates).map(Some)
    ).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn saved_templates(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    Ok(std::fs::read_dir(directory(&app)?).map_err(|error| error.to_string())?.flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name.ends_with(".stitchstudio")).collect())
}

#[tauri::command]
pub(crate) async fn preview_saved_template(file: String, app: tauri::AppHandle) -> Result<Preview, String> {
    let path = template_path(&app, &file)?;
    tauri::async_runtime::spawn_blocking(move || {
        let project = Project::load(&path)?;
        let document = project.validate()?.ok_or("This template has no editable artwork")?;
        Ok(preview(&document.plan()))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn open_saved_template(file: String, app: tauri::AppHandle) -> Result<OpenedProject, String> {
    let path = template_path(&app, &file)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        open_project_path(&path, &state)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn insert_saved_template(
    file: String, x_mm: f64, y_mm: f64, app: tauri::AppHandle,
) -> Result<Preview, String> {
    if ![x_mm, y_mm].iter().all(|value| value.is_finite() && value.abs() <= 500.0) {
        return Err("Choose an offset within 500 mm of the hoop center".into());
    }
    let path = template_path(&app, &file)?;
    tauri::async_runtime::spawn_blocking(move || {
        let project = Project::load(&path)?;
        let source = project.validate()?.ok_or("This template has no editable artwork")?;
        let svg = source.to_svg().map_err(|error| error.to_string())?;
        let state = app.state::<Mutex<Workspace>>();
        let mut workspace = state.lock().map_err(|error| error.to_string())?;
        crate::insert_editable_artwork(&mut workspace, &svg, &project.name, x_mm, y_mm, false)
    }).await.map_err(|error| error.to_string())?
}
