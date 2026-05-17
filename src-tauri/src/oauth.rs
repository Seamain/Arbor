//! Local-server OAuth flow for GitHub, GitLab, and Gitee.
//!
//! Flow:
//!   1. Frontend calls `oauth_start` with provider kind + optional host.
//!   2. Rust picks a random free port, builds the authorization URL, opens it in the browser.
//!   3. A minimal TCP listener waits for the browser redirect to `http://localhost:{port}/callback?code=…`.
//!   4. Rust exchanges the code for an access token via the provider's token endpoint.
//!   5. Returns `OAuthResult` (access_token + username + avatar_url) to the frontend.

// ── First-party OAuth credentials ────────────────────────────────────────────
const GITHUB_CLIENT_ID:     &str = "Ov23liiZXSqeiTlZ5JHV";
const GITHUB_CLIENT_SECRET: &str = "4aefcb76ec83e4c735c3f709d1a40c82f8e0cabd";
// GitHub OAuth Apps require client_secret for token exchange (no PKCE support).
const GITLAB_CLIENT_ID:     &str = "26cb9f595f88c878cf35a9bca4b7a2140a3b3b8f23c8a42180e1e843174db0a1";
const GITLAB_CLIENT_SECRET: &str = "gloas-87933561992668d759f34cc7d5bc22f006459f3425f6960e187541c6c1f35398";
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::time::Duration;

use std::collections::HashMap;

use rand::Rng;
use serde::{Deserialize, Serialize};
use tauri_plugin_opener::OpenerExt;

// ── Public result type ────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OAuthResult {
    pub access_token: String,
    pub username: String,
    pub avatar_url: String,
    pub name: String,
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Fixed callback port for GitLab (must be registered in the GitLab OAuth app).
/// GitHub accepts any localhost port so we still use random for it.
const GITLAB_CALLBACK_PORT: u16 = 47621;

/// Pick a random available port in 49152–65535 (used for GitHub).
fn pick_free_port() -> Result<u16, String> {
    let mut rng = rand::thread_rng();
    for _ in 0..20 {
        let port: u16 = rng.gen_range(49152..65535);
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    // Fallback: let the OS pick
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    Ok(listener.local_addr().map_err(|e| e.to_string())?.port())
}

/// Generate a simple random state string to guard against CSRF.
fn random_state() -> String {
    let mut rng = rand::thread_rng();
    (0..24)
        .map(|_| rng.sample(rand::distributions::Alphanumeric) as char)
        .collect()
}


/// Build the provider-specific authorization URL.
/// Both GitHub and GitLab use plain authorization code flow with client_secret.
fn build_auth_url(
    kind: &str,
    host: &str,
    redirect_uri: &str,
    state: &str,
) -> String {
    match kind {
        "github" => format!(
            "https://{host}/login/oauth/authorize\
             ?client_id={client_id}\
             &redirect_uri={redirect_uri}\
             &scope=repo%20read:user\
             &state={state}",
            host = host,
            client_id = urlenc(GITHUB_CLIENT_ID),
            redirect_uri = urlenc(redirect_uri),
            state = urlenc(state),
        ),
        "gitlab" => format!(
            "https://{host}/oauth/authorize\
             ?client_id={client_id}\
             &redirect_uri={redirect_uri}\
             &response_type=code\
             &scope=api+read_user\
             &state={state}",
            host = host,
            client_id = urlenc(GITLAB_CLIENT_ID),
            redirect_uri = urlenc(redirect_uri),
            state = urlenc(state),
        ),
        _ => String::new(),
    }
}

/// Minimal percent-encoder for URL query values.
fn urlenc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'
            | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Listen on a TCP socket for ONE HTTP GET request and return the raw request path.
/// Times out after `timeout_secs` using a background thread + channel.
fn wait_for_callback(port: u16, timeout_secs: u64) -> Result<String, String> {
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| e.to_string())?;

    // Spawn a thread that blocks on accept(); send the stream back via channel.
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let result = listener.accept();
        let _ = tx.send(result);
    });

    // Wait with timeout
    let (mut stream, _) = rx
        .recv_timeout(Duration::from_secs(timeout_secs))
        .map_err(|_| "OAuth timed out — no browser redirect received within 3 minutes.".to_string())?
        .map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;

    let mut buf = [0u8; 4096];
    let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buf[..n]).to_string();

    // Extract the request path: "GET /callback?... HTTP/1.1"
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/")
        .to_string();

    // Respond to the browser so the tab doesn't hang
    let html = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n\
        <!DOCTYPE html><html><head><meta charset=utf-8><title>Authorized</title>\
        <style>body{font-family:system-ui;display:flex;flex-direction:column;align-items:center;\
        justify-content:center;height:100vh;margin:0;background:#f5f7fa;color:#1a2130}\
        h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#66707c}</style></head><body>\
        <h1>&#10003; Authorization successful</h1><p>You can close this tab and return to Arbor.</p>\
        </body></html>";
    let _ = stream.write_all(html);

    Ok(path)
}

/// Parse `code` and `state` from a callback path like `/callback?code=ABC&state=XYZ`.
fn parse_callback(path: &str) -> (Option<String>, Option<String>) {
    let query = path.split_once('?').map(|x| x.1).unwrap_or("");
    let mut code = None;
    let mut state = None;
    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        match (kv.next(), kv.next()) {
            (Some("code"),  Some(v)) => code  = Some(v.to_string()),
            (Some("state"), Some(v)) => state = Some(v.to_string()),
            _ => {}
        }
    }
    (code, state)
}

/// Exchange the authorization code for an access token.
async fn exchange_code(
    kind: &str,
    host: &str,
    code: &str,
    redirect_uri: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let token_url = match kind {
        "github" => format!("https://{}/login/oauth/access_token", host),
        "gitlab" => format!("https://{}/oauth/token", host),
        _        => return Err("Unknown provider".to_string()),
    };

    let mut params = HashMap::new();
    match kind {
        "github" => {
            // GitHub OAuth Apps require client_secret; no PKCE support
            params.insert("client_id",     GITHUB_CLIENT_ID);
            params.insert("client_secret", GITHUB_CLIENT_SECRET);
        }
        "gitlab" => {
            params.insert("client_id",     GITLAB_CLIENT_ID);
            params.insert("client_secret", GITLAB_CLIENT_SECRET);
        }
        _ => return Err("Unknown provider".to_string()),
    }
    params.insert("code",         code);
    params.insert("redirect_uri", redirect_uri);
    params.insert("grant_type",   "authorization_code");

    let resp = client
        .post(&token_url)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Token exchange failed ({}): {}", status, body));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    // GitHub & GitLab both use "access_token" key
    json["access_token"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| format!("No access_token in response: {}", json))
}

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

// ── Tauri command ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStartArgs {
    pub kind: String,   // "github" | "gitlab"
    pub host: String,   // e.g. "github.com", "gitlab.com", or self-hosted
}

/// Start the OAuth PKCE flow. Opens the browser, waits up to 3 min for the callback,
/// exchanges the code for a token, fetches the user profile, and returns OAuthResult.
#[tauri::command]
pub async fn oauth_start(app: tauri::AppHandle, args: OAuthStartArgs) -> Result<OAuthResult, String> {
    if args.kind == "gitee" {
        return Err("Gitee OAuth requires a server-side callback. Please use a Personal Access Token.".to_string());
    }

    // GitLab requires a pre-registered fixed callback URL; GitHub accepts any localhost port.
    let port = if args.kind == "gitlab" {
        GITLAB_CALLBACK_PORT
    } else {
        pick_free_port()?
    };
    let state        = random_state();
    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);

    let auth_url = build_auth_url(
        &args.kind,
        &args.host,
        &redirect_uri,
        &state,
    );

    if auth_url.is_empty() {
        return Err(format!("Unsupported provider: {}", args.kind));
    }

    // Open the browser
    app.opener()
        .open_url(&auth_url, None::<&str>)
        .map_err(|e| format!("Failed to open browser: {}", e))?;

    // Wait for the browser callback (blocking, 3-minute timeout)
    let path = tokio::task::spawn_blocking(move || wait_for_callback(port, 180))
        .await
        .map_err(|e| e.to_string())??;

    let (code, returned_state) = parse_callback(&path);

    // Validate state
    if returned_state.as_deref() != Some(&state) {
        return Err("OAuth state mismatch — possible CSRF attack, please try again.".to_string());
    }

    let code = code.ok_or_else(|| {
        if path.contains("error=") {
            let err = path.split("error=").nth(1).unwrap_or("unknown").split('&').next().unwrap_or("unknown");
            format!("Authorization denied: {}", err)
        } else {
            "No authorization code received.".to_string()
        }
    })?;

    let token = exchange_code(
        &args.kind,
        &args.host,
        &code,
        &redirect_uri,
    ).await?;

    let (username, avatar_url, name) = fetch_user(&args.kind, &args.host, &token).await?;

    Ok(OAuthResult {
        access_token: token,
        username,
        avatar_url,
        name,
    })
}
