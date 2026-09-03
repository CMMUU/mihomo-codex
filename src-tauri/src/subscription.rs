use crate::error::{AppError, AppResult};
use crate::models::SubscriptionMetadata;
use futures_util::StreamExt;
use reqwest::header::{CONTENT_TYPE, ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH, LAST_MODIFIED};
use serde::Serialize;
use url::Url;

const MAX_SUBSCRIPTION_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedSubscription {
    pub content: Option<String>,
    pub metadata: SubscriptionMetadata,
    pub not_modified: bool,
}

#[derive(Debug, Clone)]
pub struct SubscriptionFetcher {
    client: reqwest::Client,
}

impl SubscriptionFetcher {
    pub fn new() -> AppResult<Self> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5 {
                    return attempt.stop();
                }
                let target = attempt.url();
                if target.scheme() == "https"
                    || (target.scheme() == "http" && is_loopback_host(target))
                {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .build()
            .map_err(|error| AppError::Subscription(error.to_string()))?;
        Ok(Self { client })
    }

    pub async fn fetch(
        &self,
        url: &str,
        user_agent: &str,
        etag: Option<&str>,
        last_modified: Option<&str>,
    ) -> AppResult<FetchedSubscription> {
        let parsed = validate_subscription_url(url)?;
        let mut request = self.client.get(parsed).header(
            reqwest::header::USER_AGENT,
            if user_agent.trim().is_empty() {
                "clash.meta"
            } else {
                user_agent
            },
        );
        if let Some(etag) = etag {
            request = request.header(IF_NONE_MATCH, etag);
        }
        if let Some(last_modified) = last_modified {
            request = request.header(IF_MODIFIED_SINCE, last_modified);
        }

        let response = request
            .send()
            .await
            .map_err(|error| AppError::Subscription(error.to_string()))?;
        if response.status() == reqwest::StatusCode::NOT_MODIFIED {
            return Ok(FetchedSubscription {
                content: None,
                metadata: SubscriptionMetadata {
                    content_type: None,
                    etag: etag.map(str::to_string),
                    last_modified: last_modified.map(str::to_string),
                    bytes: 0,
                },
                not_modified: true,
            });
        }
        if !response.status().is_success() {
            return Err(AppError::Subscription(format!(
                "HTTP {}",
                response.status().as_u16()
            )));
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_SUBSCRIPTION_BYTES as u64)
        {
            return Err(AppError::Subscription(
                "订阅内容超过 4 MiB 限制".to_string(),
            ));
        }

        let headers = response.headers().clone();
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| AppError::Subscription(error.to_string()))?;
            if bytes.len() + chunk.len() > MAX_SUBSCRIPTION_BYTES {
                return Err(AppError::Subscription(
                    "订阅内容超过 4 MiB 限制".to_string(),
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        if bytes.is_empty() {
            return Err(AppError::Subscription("订阅内容为空".to_string()));
        }
        let content = String::from_utf8(bytes)
            .map_err(|_| AppError::Subscription("订阅内容不是 UTF-8 文本".to_string()))?;
        Ok(FetchedSubscription {
            metadata: SubscriptionMetadata {
                bytes: content.len(),
                content_type: headers
                    .get(CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string),
                etag: headers
                    .get(ETAG)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string),
                last_modified: headers
                    .get(LAST_MODIFIED)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string),
            },
            content: Some(content),
            not_modified: false,
        })
    }
}

fn validate_subscription_url(url: &str) -> AppResult<Url> {
    let parsed = Url::parse(url).map_err(|error| AppError::InvalidInput(error.to_string()))?;
    match parsed.scheme() {
        "https" => Ok(parsed),
        "http" if is_loopback_host(&parsed) => Ok(parsed),
        "http" => Err(AppError::InvalidInput(
            "远程订阅必须使用 HTTPS；HTTP 仅允许本机地址".to_string(),
        )),
        _ => Err(AppError::InvalidInput(
            "订阅地址只支持 HTTPS，或本机 HTTP".to_string(),
        )),
    }
}

fn is_loopback_host(url: &Url) -> bool {
    matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"))
}

#[cfg(test)]
mod tests {
    use super::{validate_subscription_url, SubscriptionFetcher};

    #[test]
    fn allows_https_and_local_http() {
        assert!(validate_subscription_url("https://example.com/sub").is_ok());
        assert!(validate_subscription_url("http://127.0.0.1:8080/sub").is_ok());
    }

    #[test]
    fn rejects_remote_http_and_file_urls() {
        assert!(validate_subscription_url("http://example.com/sub").is_err());
        assert!(validate_subscription_url("file:///tmp/sub.yaml").is_err());
    }

    #[tokio::test]
    async fn fetches_a_local_subscription_with_metadata() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("listener");
        let address = listener.local_addr().expect("address");
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept");
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request).await;
            let body = "proxies: []\nrules: []\n";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: text/yaml\r\nETag: fixture\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(response.as_bytes()).await.expect("write");
        });
        let result = SubscriptionFetcher::new()
            .expect("fetcher")
            .fetch(
                &format!("http://127.0.0.1:{}/subscription", address.port()),
                "clash.meta",
                None,
                None,
            )
            .await
            .expect("fetch");
        assert_eq!(result.metadata.etag.as_deref(), Some("fixture"));
        assert!(result.content.expect("content").contains("proxies"));
    }

    #[tokio::test]
    #[ignore = "requires TEST_SUBSCRIPTION_URL and network access"]
    async fn validates_an_external_subscription_fixture() {
        use crate::effective::build_effective_config;
        use crate::models::{AppSettings, RoutingMode};
        use std::process::Command;
        let Ok(url) = std::env::var("TEST_SUBSCRIPTION_URL") else {
            return;
        };
        let fetched = SubscriptionFetcher::new()
            .expect("fetcher")
            .fetch(&url, "clash.meta", None, None)
            .await
            .expect("fetch");
        let effective = build_effective_config(
            &fetched.content.expect("content"),
            &AppSettings::default(),
            RoutingMode::Rule,
        )
        .expect("effective");
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let target = std::process::Command::new("rustc")
            .args(["--print", "host-tuple"])
            .output()
            .expect("target");
        let target = String::from_utf8(target.stdout)
            .expect("utf8")
            .trim()
            .to_string();
        let binary = root.join("binaries").join(format!("mihomo-{target}"));
        let directory = std::env::temp_dir().join(format!(
            "mihomo-subscription-pipeline-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).expect("directory");
        let config = directory.join("effective.yaml");
        std::fs::write(&config, effective.yaml).expect("write");
        let output = Command::new(binary)
            .args(["-t", "-d"])
            .arg(&directory)
            .arg("-f")
            .arg(&config)
            .output()
            .expect("mihomo");
        if !output.status.success() {
            panic!("{}", String::from_utf8_lossy(&output.stderr));
        }
        let _ = std::fs::remove_dir_all(directory);
    }
}
