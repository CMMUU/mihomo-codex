use crate::models::AppSettings;
use serde::Serialize;
use std::net::{SocketAddr, TcpStream};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticCheck {
    pub stage: String,
    pub success: bool,
    pub latency_ms: Option<u128>,
    pub detail: String,
}

pub async fn run(settings: &AppSettings) -> Vec<DiagnosticCheck> {
    vec![
        check_tcp_port("local_proxy", settings.mixed_port, Duration::from_secs(2)),
        check_tcp_port(
            "controller",
            settings.controller_port,
            Duration::from_secs(2),
        ),
        check_http_proxy(settings).await,
    ]
}

fn check_tcp_port(stage: &str, port: u16, timeout: Duration) -> DiagnosticCheck {
    let started = Instant::now();
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    match TcpStream::connect_timeout(&address, timeout) {
        Ok(_) => DiagnosticCheck {
            stage: stage.to_string(),
            success: true,
            latency_ms: Some(started.elapsed().as_millis()),
            detail: format!("127.0.0.1:{port} 可连接"),
        },
        Err(error) => DiagnosticCheck {
            stage: stage.to_string(),
            success: false,
            latency_ms: None,
            detail: error.to_string(),
        },
    }
}

async fn check_http_proxy(settings: &AppSettings) -> DiagnosticCheck {
    let started = Instant::now();
    let proxy = match reqwest::Proxy::all(format!("http://127.0.0.1:{}", settings.mixed_port)) {
        Ok(proxy) => proxy,
        Err(error) => {
            return DiagnosticCheck {
                stage: "http_proxy".to_string(),
                success: false,
                latency_ms: None,
                detail: error.to_string(),
            };
        }
    };
    let client = match reqwest::Client::builder()
        .proxy(proxy)
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return DiagnosticCheck {
                stage: "http_proxy".to_string(),
                success: false,
                latency_ms: None,
                detail: error.to_string(),
            };
        }
    };
    match client
        .get("https://www.gstatic.com/generate_204")
        .send()
        .await
    {
        Ok(response) => DiagnosticCheck {
            stage: "http_proxy".to_string(),
            success: response.status().is_success(),
            latency_ms: Some(started.elapsed().as_millis()),
            detail: format!("HTTP {}", response.status().as_u16()),
        },
        Err(error) => DiagnosticCheck {
            stage: "http_proxy".to_string(),
            success: false,
            latency_ms: Some(started.elapsed().as_millis()),
            detail: error.to_string(),
        },
    }
}
