//! Device-flow OAuth (RFC 8628) for GitHub and GitLab.
//!
//! Security: the Device Authorization Grant needs only the public client_id —
//! no client_secret ships in the binary and no localhost callback server is
//! required. The user confirms sign-in by entering a short user_code on the
//! provider's verification page.
//!
//! Flow:
//!   1. Frontend calls `oauth_device_start` with provider kind + host.
//!   2. Rust requests a device_code / user_code pair from the provider and
//!      opens the verification URL in the browser.
//!   3. Frontend shows the user_code so the user can type/paste it.
//!   4. Frontend calls `oauth_device_poll`; Rust polls the token endpoint
//!      until the user approves (or the code expires / is denied).
//!   5. Returns `OAuthResult` (access_token + username + avatar_url).
//!
//! Provider requirements:
//!   - GitHub: "Enable Device Flow" must be checked in the OAuth App settings.
//!   - GitLab: works for public (non-confidential) applications on
//!     GitLab.com and self-hosted GitLab 17.2+.

const GITHUB_CLIENT_ID: &str = "Ov23liiZXSqeiTlZ5JHV";
const GITLAB_CLIENT_ID: &str = "26cb9f595f88c878cf35a9bca4b7a2140a3b3b8f23c8a42180e1e843174db0a1";

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri_plugin_opener::OpenerExt;

// ── Public result types ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OAuthResult {
    pub access_token: String,
    pub username: String,
    pub avatar_url: String,
    pub name: String,
}

/// Returned by `oauth_device_start`; the frontend shows `user_code` to the
/// user and then passes `device_code` back into `oauth_device_poll`.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCodeInfo {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

// ── Provider endpoints ────────────────────────────────────────────────────────

fn client_id(kind: &str) -> Result<&'static str, String> {
    match kind {
        "github" => Ok(GITHUB_CLIENT_ID),
        "gitlab" => Ok(GITLAB_CLIENT_ID),
        _ => Err(format!("Unsupported provider: {}", kind)),
    }
}

fn device_code_url(kind: &str, host: &str) -> Result<String, String> {
    match kind {
        "github" => Ok(format!("https://{}/login/device/code", host)),
        "gitlab" => Ok(format!("https://{}/oauth/authorize_device", host)),
        _ => Err(format!("Unsupported provider: {}", kind)),
    }
}

fn token_url(kind: &str, host: &str) -> Result<String, String> {
    match kind {
        "github" => Ok(format!("https://{}/login/oauth/access_token", host)),
        "gitlab" => Ok(format!("https://{}/oauth/token", host)),
        _ => Err(format!("Unsupported provider: {}", kind)),
    }
}

fn scope(kind: &str) -> &'static str {
    match kind {
        "github" => "repo read:user",
        "gitlab" => "api read_user",
        _ => "",
    }
}

// ── User profile ──────────────────────────────────────────────────────────────

/// Fetch user profile with the newly obtained token.
async fn fetch_user(kind: &str, host: &str, token: &str) -> Result<(String, String, String), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let (url, auth_header) = match kind {
        "github" => (
            format!("https://api.{}/user", host),
            format!("token {}", token),
        ),
        "gitlab" => (
            format!("https://{}/api/v4/user", host),
            format!("Bearer {}", token),
        ),
        "gitee" => (
            format!("https://gitee.com/api/v5/user?access_token={}", token),
            String::new(),
        ),
        _ => return Err("Unknown provider".to_string()),
    };

    let mut req = client.get(&url).header("User-Agent", "git-client/1.0");
    if !auth_header.is_empty() {
        req = req.header("Authorization", &auth_header);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Failed to fetch user profile: {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let username   = json["login"].as_str()
        .or_else(|| json["username"].as_str())
        .unwrap_or("unknown")
        .to_string();
    let avatar_url = json["avatar_url"].as_str().unwrap_or("").to_string();
    let name       = json["name"].as_str()
        .unwrap_or(&username)
        .to_string();

    Ok((username, avatar_url, name))
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStartArgs {
    pub kind: String,   // "github" | "gitlab"
    pub host: String,   // e.g. "github.com", "gitlab.com", or self-hosted
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthPollArgs {
    pub kind: String,
    pub host: String,
    pub device_code: String,
    pub interval: u64,
    pub expires_in: u64,
}

/// Request a device_code / user_code pair and open the verification page in
/// the browser. The frontend displays `user_code` for the user to enter.
#[tauri::command]
pub async fn oauth_device_start(
    app: tauri::AppHandle,
    args: OAuthStartArgs,
) -> Result<DeviceCodeInfo, String> {
    if args.kind == "gitee" {
        return Err("Gitee does not support the OAuth device flow. Please use a Personal Access Token.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let mut params = HashMap::new();
    params.insert("client_id", client_id(&args.kind)?);
    params.insert("scope", scope(&args.kind));

    let resp = client
        .post(device_code_url(&args.kind, &args.host)?)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Device code request failed ({}): {}", status, e))?;

    if let Some(err) = json["error"].as_str() {
        let desc = json["error_description"].as_str().unwrap_or(err);
        return Err(format!("Device code request failed: {}", desc));
    }

    let device_code = json["device_code"].as_str()
        .ok_or_else(|| format!("No device_code in response: {}", json))?
        .to_string();
    let user_code = json["user_code"].as_str()
        .ok_or_else(|| format!("No user_code in response: {}", json))?
        .to_string();
    let verification_uri = json["verification_uri"].as_str()
        .ok_or_else(|| format!("No verification_uri in response: {}", json))?
        .to_string();
    let expires_in = json["expires_in"].as_u64().unwrap_or(900);
    let interval   = json["interval"].as_u64().unwrap_or(5);

    // Open the verification page. Prefer the pre-filled variant when the
    // provider supplies one (GitLab does; GitHub does not).
    let open_url = json["verification_uri_complete"]
        .as_str()
        .unwrap_or(&verification_uri)
        .to_string();
    app.opener()
        .open_url(&open_url, None::<&str>)
        .map_err(|e| format!("Failed to open browser: {}", e))?;

    Ok(DeviceCodeInfo {
        device_code,
        user_code,
        verification_uri,
        expires_in,
        interval,
    })
}

/// Poll the token endpoint until the user approves the device, then fetch the
/// user profile. Handles `authorization_pending` / `slow_down` per RFC 8628.
#[tauri::command]
pub async fn oauth_device_poll(args: OAuthPollArgs) -> Result<OAuthResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let url = token_url(&args.kind, &args.host)?;
    let cid = client_id(&args.kind)?;

    let mut interval = args.interval.max(1);
    let deadline = std::time::Instant::now() + Duration::from_secs(args.expires_in);

    loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;

        if std::time::Instant::now() >= deadline {
            return Err("The device code expired before authorization completed. Please try again.".to_string());
        }

        let mut params = HashMap::new();
        params.insert("client_id", cid);
        params.insert("device_code", args.device_code.as_str());
        params.insert("grant_type", "urn:ietf:params:oauth:grant-type:device_code");

        let resp = client
            .post(&url)
            .header("Accept", "application/json")
            .form(&params)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        // GitHub replies 200 with an "error" field; GitLab uses 4xx with the
        // same JSON shape — parse the body either way.
        let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

        if let Some(token) = json["access_token"].as_str() {
            let token = token.to_string();
            let (username, avatar_url, name) = fetch_user(&args.kind, &args.host, &token).await?;
            return Ok(OAuthResult {
                access_token: token,
                username,
                avatar_url,
                name,
            });
        }

        match json["error"].as_str() {
            Some("authorization_pending") => continue,
            Some("slow_down") => {
                interval += 5; // RFC 8628 §3.5
                continue;
            }
            Some("expired_token") => {
                return Err("The device code expired before authorization completed. Please try again.".to_string());
            }
            Some("access_denied") => {
                return Err("Authorization was denied.".to_string());
            }
            Some(err) => {
                let desc = json["error_description"].as_str().unwrap_or(err);
                return Err(format!("Authorization failed: {}", desc));
            }
            None => {
                return Err(format!("Unexpected token response: {}", json));
            }
        }
    }
}
