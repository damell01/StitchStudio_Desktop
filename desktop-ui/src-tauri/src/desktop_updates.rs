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

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn access_protected(app: &tauri::AppHandle) -> bool {
    app.config().plugins.0.get("updater")
        .and_then(|settings| settings.get("requireAccessKey"))
        .and_then(|value| value.as_bool()).unwrap_or(false)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn credential() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.stitchstudio.desktop", "update-feed")
        .map_err(|_| "Unable to open this computer's secure credential store.".into())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn access_key(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    if !access_protected(app) {
        return Ok(None);
    }
    match credential()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Unable to read the update access key from this computer.".into()),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    configured: bool,
    requires_access_key: bool,
    has_access_key: bool,
    version: Option<String>,
    error: Option<String>,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
async fn find_update(app: &tauri::AppHandle, key: Option<String>) -> Result<Option<tauri_plugin_updater::Update>, String> {
    let mut builder = app.updater_builder()
        .configure_client(|client| client.redirect(reqwest::redirect::Policy::none()))
        .timeout(std::time::Duration::from_secs(15));
    if let Some(key) = key {
        builder = builder.header("Authorization", format!("Bearer {key}"))
            .map_err(|_| "The update access key is invalid.")?;
    }
    let update = builder.build().map_err(|error| error.to_string())?
        .check().await.map_err(|_| "Check your connection and update access key, then try again.")?;
    if let Some(update) = &update {
        let endpoint = app.config().plugins.0.get("updater")
            .and_then(|config| config.get("endpoints")).and_then(|values| values.get(0))
            .and_then(|value| value.as_str()).and_then(|url| tauri::Url::parse(url).ok())
            .ok_or("The update endpoint is invalid.")?;
        if update.download_url.scheme() != "https" || endpoint.origin() != update.download_url.origin()
            || !update.download_url.username().is_empty() || update.download_url.password().is_some()
        {
            return Err("The update download must come directly from the private feed.".into());
        }
    }
    Ok(update)
}

#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> Result<UpdateStatus, String> {
    let configured = configured(&app);
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    if configured {
        let requires_access_key = access_protected(&app);
        let key = access_key(&app)?;
        let has_access_key = key.is_some();
        let (version, error) = if !requires_access_key || has_access_key {
            match find_update(&app, key).await {
                Ok(update) => (update.map(|update| update.version), None),
                Err(error) => (None, Some(error)),
            }
        } else {
            (None, None)
        };
        return Ok(UpdateStatus { configured, requires_access_key, has_access_key, version, error });
    }
    Ok(UpdateStatus { configured, requires_access_key: false, has_access_key: false, version: None, error: None })
}

#[tauri::command]
pub fn save_update_access_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    if configured(&app) && access_protected(&app) {
        let key = key.trim();
        if key.len() != 64 || !key.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("Enter the 64-character update access key.".into());
        }
        return credential()?.set_password(key)
            .map_err(|_| "Unable to save the update access key in this computer's credential store.".into());
    }
    let _ = (app, key);
    Err("This build has no private update feed.".into())
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle, version: String) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    if configured(&app) {
        let key = access_key(&app)?;
        if access_protected(&app) && key.is_none() {
            return Err("Enter the update access key in Settings first.".into());
        }
        let mut update = find_update(&app, key).await?
            .ok_or("The update is no longer available.")?;
        if update.version != version {
            return Err("The available version changed. Check for updates again.".into());
        }
        update.timeout = Some(std::time::Duration::from_secs(900));
        update.download_and_install(|_, _| {}, || {}).await.map_err(|error| error.to_string())?;
        app.restart();
    }
    let _ = (app, version);
    Err("This build has no configured update feed.".into())
}
