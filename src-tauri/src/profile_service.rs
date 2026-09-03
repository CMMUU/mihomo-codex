use crate::config::{inspect_profile, ProfileSummary};
use crate::effective::build_effective_config_with_policy;
use crate::error::{AppError, AppResult};
use crate::models::{
    ConfigRevision, ProfileRecord, ProfileSource, PublicProfileRecord, RoutingMode,
    SubscriptionMetadata, ValidationReport,
};
use crate::runtime;
use crate::storage::AppStorage;
use crate::subscription::SubscriptionFetcher;
use chrono::Utc;
use serde::Serialize;
use tauri::AppHandle;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileOperationResult {
    pub profile: PublicProfileRecord,
    pub revision: ConfigRevision,
    pub summary: ProfileSummary,
    pub updated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDetails {
    pub profile: PublicProfileRecord,
    pub revisions: Vec<ConfigRevision>,
    pub summary: Option<ProfileSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionOverview {
    pub profile: PublicProfileRecord,
    pub summary: Option<ProfileSummary>,
    pub revision_count: usize,
    pub latest_fetched_at: Option<chrono::DateTime<Utc>>,
    pub latest_metadata: Option<SubscriptionMetadata>,
    pub latest_validation: Option<ValidationReport>,
    pub active: bool,
}

pub fn list_profiles(app: &AppHandle) -> AppResult<Vec<PublicProfileRecord>> {
    Ok(AppStorage::from_app(app)?
        .list_profiles()?
        .iter()
        .map(PublicProfileRecord::from)
        .collect())
}

pub fn list_subscriptions(app: &AppHandle) -> AppResult<Vec<SubscriptionOverview>> {
    let storage = AppStorage::from_app(app)?;
    let active_profile_id = storage.state()?.active_profile_id;
    storage
        .list_profiles()?
        .into_iter()
        .filter(|profile| matches!(profile.source, ProfileSource::RemoteSubscription { .. }))
        .map(|profile| {
            let revisions = storage.list_revisions(profile.id)?;
            let latest = revisions.first();
            let summary = match profile.active_revision_id {
                Some(revision_id) => storage
                    .load_revision_source(profile.id, revision_id)
                    .ok()
                    .and_then(|source| inspect_profile(&source).ok()),
                None => None,
            };
            Ok(SubscriptionOverview {
                profile: PublicProfileRecord::from(&profile),
                summary,
                revision_count: revisions.len(),
                latest_fetched_at: latest.map(|revision| revision.fetched_at),
                latest_metadata: latest.and_then(|revision| revision.subscription.clone()),
                latest_validation: latest.map(|revision| revision.validation.clone()),
                active: active_profile_id == Some(profile.id),
            })
        })
        .collect()
}

pub fn profile_details(app: &AppHandle, profile_id: Uuid) -> AppResult<ProfileDetails> {
    let storage = AppStorage::from_app(app)?;
    let profile = storage.load_profile(profile_id)?;
    let revisions = storage.list_revisions(profile_id)?;
    let summary = match profile.active_revision_id {
        Some(revision_id) => {
            let source = storage.load_revision_source(profile_id, revision_id)?;
            Some(inspect_profile(&source).map_err(AppError::Config)?)
        }
        None => None,
    };
    Ok(ProfileDetails {
        profile: PublicProfileRecord::from(&profile),
        revisions,
        summary,
    })
}

pub fn create_inline_profile(
    app: &AppHandle,
    display_name: String,
    source: String,
) -> AppResult<ProfileOperationResult> {
    let storage = AppStorage::from_app(app)?;
    let profile = storage.create_profile(
        display_name.clone(),
        ProfileSource::Inline {
            label: display_name,
        },
    )?;
    match persist_candidate(app, &storage, profile.clone(), source, None, true) {
        Ok(result) => Ok(result),
        Err(error) => {
            let _ = storage.delete_profile(profile.id);
            Err(error)
        }
    }
}

pub async fn create_subscription_profile(
    app: &AppHandle,
    display_name: String,
    url: String,
    user_agent: String,
) -> AppResult<ProfileOperationResult> {
    let storage = AppStorage::from_app(app)?;
    if let Some(existing) = storage.list_profiles()?.into_iter().find(|profile| {
        matches!(
            &profile.source,
            ProfileSource::RemoteSubscription {
                url: existing_url,
                ..
            } if existing_url == &url
        )
    }) {
        let mut result = refresh_profile(app, existing.id).await?;
        let activated = storage.activate_revision(existing.id, result.revision.id)?;
        result.profile = PublicProfileRecord::from(&activated);
        return Ok(result);
    }
    let fetcher = SubscriptionFetcher::new()?;
    let fetched = fetcher.fetch(&url, &user_agent, None, None).await?;
    let source = fetched
        .content
        .ok_or_else(|| AppError::Subscription("订阅没有返回内容".to_string()))?;
    let profile = storage.create_profile(
        display_name,
        ProfileSource::RemoteSubscription { url, user_agent },
    )?;
    match persist_candidate(
        app,
        &storage,
        profile.clone(),
        source,
        Some(fetched.metadata),
        true,
    ) {
        Ok(result) => Ok(result),
        Err(error) => {
            let _ = storage.delete_profile(profile.id);
            Err(error)
        }
    }
}

pub async fn refresh_profile(
    app: &AppHandle,
    profile_id: Uuid,
) -> AppResult<ProfileOperationResult> {
    let storage = AppStorage::from_app(app)?;
    let profile = storage.load_profile(profile_id)?;
    let activate_app = storage.state()?.active_profile_id == Some(profile_id);
    let ProfileSource::RemoteSubscription { url, user_agent } = &profile.source else {
        return Err(AppError::Conflict("该配置不是远程订阅".to_string()));
    };
    let latest = storage.list_revisions(profile_id)?.into_iter().next();
    let etag = latest
        .as_ref()
        .and_then(|revision| revision.subscription.as_ref())
        .and_then(|metadata| metadata.etag.as_deref());
    let last_modified = latest
        .as_ref()
        .and_then(|revision| revision.subscription.as_ref())
        .and_then(|metadata| metadata.last_modified.as_deref());
    let fetched = SubscriptionFetcher::new()?
        .fetch(url, user_agent, etag, last_modified)
        .await?;
    if fetched.not_modified {
        let revision = latest.ok_or_else(|| AppError::NotFound("当前订阅版本".to_string()))?;
        let source = storage.load_revision_source(profile_id, revision.id)?;
        return Ok(ProfileOperationResult {
            profile: PublicProfileRecord::from(&profile),
            revision,
            summary: inspect_profile(&source).map_err(AppError::Config)?,
            updated: false,
        });
    }
    persist_candidate(
        app,
        &storage,
        profile,
        fetched
            .content
            .ok_or_else(|| AppError::Subscription("订阅内容为空".to_string()))?,
        Some(fetched.metadata),
        activate_app,
    )
}

pub fn activate_profile(
    app: &AppHandle,
    profile_id: Uuid,
    revision_id: Option<Uuid>,
) -> AppResult<ProfileDetails> {
    let storage = AppStorage::from_app(app)?;
    let profile = storage.load_profile(profile_id)?;
    let revision_id = revision_id
        .or(profile.active_revision_id)
        .ok_or_else(|| AppError::NotFound("配置没有可激活版本".to_string()))?;
    let effective = storage.load_revision_effective(profile_id, revision_id)?;
    runtime::validate_source(app, &effective)?;
    storage.activate_revision(profile_id, revision_id)?;
    profile_details(app, profile_id)
}

pub fn rollback_profile(app: &AppHandle, profile_id: Uuid) -> AppResult<ProfileDetails> {
    AppStorage::from_app(app)?.rollback_profile(profile_id)?;
    profile_details(app, profile_id)
}

pub fn delete_profile(app: &AppHandle, profile_id: Uuid) -> AppResult<()> {
    AppStorage::from_app(app)?.delete_profile(profile_id)
}

pub fn set_routing_mode(
    app: &AppHandle,
    profile_id: Uuid,
    mode: RoutingMode,
) -> AppResult<ProfileDetails> {
    let storage = AppStorage::from_app(app)?;
    let mut profile = storage.load_profile(profile_id)?;
    profile.routing_mode = mode;
    profile.updated_at = Utc::now();
    storage.save_profile(&profile)?;
    profile_details(app, profile_id)
}

fn persist_candidate(
    app: &AppHandle,
    storage: &AppStorage,
    profile: ProfileRecord,
    source: String,
    metadata: Option<crate::models::SubscriptionMetadata>,
    activate_app: bool,
) -> AppResult<ProfileOperationResult> {
    let settings = storage.settings()?;
    let effective = build_effective_config_with_policy(
        &source,
        &settings,
        profile.routing_mode,
        Some(&profile.openai_policy),
    )?;
    runtime::validate_source(app, &effective.yaml)?;
    let validation = ValidationReport {
        valid: true,
        warnings: effective.summary.warnings.clone(),
        errors: Vec::new(),
        native_core_validated: true,
    };
    let revision = storage.save_revision(
        profile.id,
        &source,
        &effective.yaml,
        metadata,
        validation,
        profile.openai_policy.clone(),
    )?;
    let profile = if activate_app {
        storage.activate_revision(profile.id, revision.id)?
    } else {
        storage.update_profile_revision(profile.id, revision.id)?
    };
    Ok(ProfileOperationResult {
        profile: PublicProfileRecord::from(&profile),
        revision,
        summary: effective.summary,
        updated: true,
    })
}
