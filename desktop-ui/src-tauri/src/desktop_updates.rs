#[cfg(any(target_os = "windows", target_os = "macos"))]
use tauri_plugin_updater::UpdaterExt;

pub fn configure(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    let builder = builder.setup(|app| {
        if configured(app.handle()) {
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
        }
        Ok(())
    });
    builder
}

fn configured(app: &tauri::AppHandle) -> bool {
    !cfg!(debug_assertions)
        && cfg!(any(target_os = "windows", target_os = "macos"))
        && app.config().plugins.0.contains_key("updater")
}

#[derive(serde::Serialize)]
pub struct UpdateStatus {
    configured: bool,
    version: Option<String>,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
async fn find_update(app: &tauri::AppHandle) -> Result<Option<tauri_plugin_updater::Update>, String> {
    let updater = app.updater_builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?;
    updater.check().await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> Result<UpdateStatus, String> {
    let configured = configured(&app);
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    if configured {
        let version = find_update(&app).await?.map(|update| update.version);
        return Ok(UpdateStatus { configured, version });
    }
    Ok(UpdateStatus { configured, version: None })
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle, version: String) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    if configured(&app) {
        let update = find_update(&app).await?
            .ok_or("The update is no longer available.")?;
        if update.version != version {
            return Err("The available version changed. Check for updates again.".into());
        }
        update.download_and_install(|_, _| {}, || {}).await.map_err(|error| error.to_string())?;
        app.restart();
    }
    let _ = (app, version);
    Err("This build has no configured update feed.".into())
}
