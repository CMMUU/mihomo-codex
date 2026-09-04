use crate::error::{AppError, AppResult};
use crate::models::AppSettings;
use crate::storage::AppStorage;
use tauri::{AppHandle, Theme};

pub fn native_theme(preference: &str) -> AppResult<Option<Theme>> {
    match preference {
        "system" => Ok(None),
        "light" => Ok(Some(Theme::Light)),
        "dark" | "purple" => Ok(Some(Theme::Dark)),
        _ => Err(AppError::InvalidInput("无效主题".to_string())),
    }
}

pub fn apply_native_theme(app: &AppHandle, preference: &str) -> AppResult<()> {
    app.set_theme(native_theme(preference)?);
    Ok(())
}

pub fn persist_theme(storage: &AppStorage, preference: &str) -> AppResult<AppSettings> {
    native_theme(preference)?;
    // Read the latest settings here so a theme-only update never replays a stale
    // frontend snapshot over network settings or the private controller secret.
    let mut settings = storage.settings()?;
    settings.theme = preference.to_string();
    storage.save_settings(&settings)?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::{native_theme, persist_theme};
    use crate::models::{AppSettings, NetworkMode, PublicAppSettings, CURRENT_SCHEMA_VERSION};
    use crate::storage::AppStorage;
    use std::fs;
    use std::path::PathBuf;
    use tauri::Theme;
    use uuid::Uuid;

    struct Fixture {
        root: PathBuf,
        storage: AppStorage,
    }

    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("routedeck-appearance-{}", Uuid::new_v4()));
            let storage = AppStorage::from_root(root.clone()).expect("fixture storage");
            Self { root, storage }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn maps_all_preferences_to_native_appearance() {
        assert_eq!(native_theme("system").expect("system"), None);
        assert_eq!(native_theme("light").expect("light"), Some(Theme::Light));
        assert_eq!(native_theme("dark").expect("dark"), Some(Theme::Dark));
        assert_eq!(native_theme("purple").expect("purple"), Some(Theme::Dark));
    }

    #[test]
    fn rejects_unknown_preferences() {
        for value in ["", "Dark", "auto", "light ", " purple", "<script>"] {
            let error = native_theme(value).expect_err("invalid preference");
            assert_eq!(error.code(), "INVALID_INPUT");
        }
    }

    #[test]
    fn persists_each_preference_without_a_schema_change() {
        let fixture = Fixture::new();
        for preference in ["system", "light", "dark", "purple"] {
            let saved = persist_theme(&fixture.storage, preference).expect("save theme");
            let reopened = AppStorage::from_root(fixture.root.clone())
                .expect("reopen storage")
                .settings()
                .expect("read persisted settings");
            assert_eq!(saved.theme, preference);
            assert_eq!(reopened.theme, preference);
            assert_eq!(reopened.schema_version, CURRENT_SCHEMA_VERSION);
        }
    }

    #[test]
    fn theme_update_preserves_latest_unrelated_settings_and_private_secret() {
        let fixture = Fixture::new();
        fixture
            .storage
            .save_settings(&AppSettings::default())
            .expect("initial settings");
        let latest = AppSettings {
            locale: "en-US".to_string(),
            theme: "light".to_string(),
            launch_at_login: true,
            show_global_traffic: false,
            network_mode: NetworkMode::Tun,
            mixed_port: 17900,
            controller_port: 19090,
            controller_secret: "fixture-secret-must-stay-private".to_string(),
            update_channel: "preview".to_string(),
            diagnostics_retention_days: 30,
            ..AppSettings::default()
        };
        fixture
            .storage
            .save_settings(&latest)
            .expect("newer settings from another operation");

        let updated = persist_theme(&fixture.storage, "purple").expect("theme-only update");
        let mut expected = serde_json::to_value(&latest).expect("expected settings");
        expected["theme"] = "purple".into();
        assert_eq!(
            serde_json::to_value(&updated).expect("saved settings"),
            expected
        );
        assert_eq!(
            serde_json::to_value(fixture.storage.settings().expect("reload settings"))
                .expect("persisted settings"),
            expected
        );
        let public =
            serde_json::to_value(PublicAppSettings::from(&updated)).expect("public settings");
        assert!(public.get("controllerSecret").is_none());
    }

    #[test]
    fn invalid_preference_leaves_persisted_settings_unchanged() {
        let fixture = Fixture::new();
        fixture.storage.settings().expect("initial settings");
        let settings_path = fixture.root.join("settings.json");
        let before = fs::read(&settings_path).expect("settings before invalid update");
        let error = persist_theme(&fixture.storage, "unsupported").expect_err("reject theme");
        assert_eq!(error.code(), "INVALID_INPUT");
        assert_eq!(
            fs::read(settings_path).expect("settings after invalid update"),
            before
        );
    }
}
