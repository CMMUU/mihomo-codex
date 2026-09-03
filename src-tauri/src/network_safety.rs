use crate::error::{AppError, AppResult};
use crate::models::AppSettings;
use serde::Serialize;
use std::time::{Duration, Instant};

type SafetyTarget = (&'static str, &'static str, u16);

const SAFETY_TARGETS: &[SafetyTarget] = &[
    ("google", "https://www.google.com/generate_204", 204),
    ("cloudflare", "https://cp.cloudflare.com", 204),
    ("openai", "https://api.openai.com/v1/models", 401),
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSafetyCheck {
    pub target: String,
    pub url: String,
    pub success: bool,
    pub expected_status: u16,
    pub actual_status: Option<u16>,
    pub latency_ms: u128,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSafetyReport {
    pub success: bool,
    pub proxy_endpoint: String,
    pub checks: Vec<NetworkSafetyCheck>,
}

pub async fn verify_local_proxy(settings: &AppSettings) -> AppResult<NetworkSafetyReport> {
    let endpoint = format!("http://127.0.0.1:{}", settings.mixed_port);
    let proxy =
        reqwest::Proxy::all(&endpoint).map_err(|error| AppError::Runtime(error.to_string()))?;
    let client = reqwest::Client::builder()
        .proxy(proxy)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|error| AppError::Runtime(error.to_string()))?;

    let (google, cloudflare, openai) = tokio::join!(
        check_target(&client, SAFETY_TARGETS[0]),
        check_target(&client, SAFETY_TARGETS[1]),
        check_target(&client, SAFETY_TARGETS[2]),
    );
    let checks = vec![google, cloudflare, openai];
    let success = checks.iter().all(|check| check.success);
    let report = NetworkSafetyReport {
        success,
        proxy_endpoint: endpoint,
        checks,
    };
    if report.success {
        Ok(report)
    } else {
        let failed = report
            .checks
            .iter()
            .filter(|check| !check.success)
            .map(|check| format!("{}: {}", check.target, check.detail))
            .collect::<Vec<_>>()
            .join("; ");
        Err(AppError::Runtime(format!(
            "代理安全预检失败，系统网络未接管: {failed}"
        )))
    }
}

pub async fn verify_tun_route() -> AppResult<NetworkSafetyReport> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|error| AppError::Runtime(error.to_string()))?;
    let (google, cloudflare, openai) = tokio::join!(
        check_target(&client, SAFETY_TARGETS[0]),
        check_target(&client, SAFETY_TARGETS[1]),
        check_target(&client, SAFETY_TARGETS[2]),
    );
    let checks = vec![google, cloudflare, openai];
    let report = NetworkSafetyReport {
        success: checks.iter().all(|check| check.success),
        proxy_endpoint: "system-tun".to_string(),
        checks,
    };
    if report.success {
        Ok(report)
    } else {
        let failed = report
            .checks
            .iter()
            .filter(|check| !check.success)
            .map(|check| format!("{}: {}", check.target, check.detail))
            .collect::<Vec<_>>()
            .join("; ");
        Err(AppError::Runtime(format!(
            "TUN 路由验收失败，已停止特权内核: {failed}"
        )))
    }
}

async fn check_target(
    client: &reqwest::Client,
    (target, url, expected_status): SafetyTarget,
) -> NetworkSafetyCheck {
    let started = Instant::now();
    match client.get(url).send().await {
        Ok(response) => {
            let actual_status = response.status().as_u16();
            let success = actual_status == expected_status;
            NetworkSafetyCheck {
                target: target.to_string(),
                url: url.to_string(),
                success,
                expected_status,
                actual_status: Some(actual_status),
                latency_ms: started.elapsed().as_millis(),
                detail: if success {
                    format!("HTTP {actual_status}")
                } else {
                    format!("期望 HTTP {expected_status}，实际 HTTP {actual_status}")
                },
            }
        }
        Err(error) => NetworkSafetyCheck {
            target: target.to_string(),
            url: url.to_string(),
            success: false,
            expected_status,
            actual_status: None,
            latency_ms: started.elapsed().as_millis(),
            detail: error.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::SAFETY_TARGETS;

    #[test]
    fn safety_targets_cover_google_cloudflare_and_openai() {
        assert_eq!(SAFETY_TARGETS.len(), 3);
        assert_eq!(SAFETY_TARGETS[0].2, 204);
        assert_eq!(SAFETY_TARGETS[1].2, 204);
        assert_eq!(SAFETY_TARGETS[2].2, 401);
        assert!(SAFETY_TARGETS[2].1.contains("api.openai.com"));
    }
}
