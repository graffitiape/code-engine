use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use url::{Host, Url};

/// Open a narrowly validated web URL in the user's default browser.
///
/// Production links must use HTTPS. Plain HTTP is accepted only for exact
/// localhost or 127.0.0.1 development URLs, and URL credentials are always
/// rejected before the operating system is invoked.
#[tauri::command]
#[allow(deprecated)]
pub fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    let url = validate_external_url(&url)?;
    app.shell()
        .open(url.as_str(), None)
        .map_err(|error| format!("failed to open external URL: {error}"))
}

fn validate_external_url(input: &str) -> Result<Url, String> {
    if input.chars().any(char::is_control) {
        return Err("external URL contains control characters".to_string());
    }

    let parsed = Url::parse(input).map_err(|error| format!("invalid external URL: {error}"))?;
    let authority = input
        .split_once("://")
        .map(|(_, remainder)| remainder.split(['/', '?', '#']).next().unwrap_or_default())
        .unwrap_or_default();
    if authority.contains('@') || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("external URL credentials are not allowed".to_string());
    }

    match parsed.scheme() {
        "https" => {
            if parsed.host().is_none() {
                return Err("HTTPS URL must include a host".to_string());
            }
        }
        "http" => match parsed.host() {
            Some(Host::Domain(host)) if host.eq_ignore_ascii_case("localhost") => {}
            Some(Host::Ipv4(address))
                if address.is_loopback() && address.octets() == [127, 0, 0, 1] => {}
            _ => {
                return Err("plain HTTP is allowed only for localhost or 127.0.0.1".to_string());
            }
        },
        _ => return Err("external URL must use HTTPS or approved local HTTP".to_string()),
    }

    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::validate_external_url;

    #[test]
    fn accepts_https_and_exact_local_development_urls() {
        assert!(validate_external_url("https://chatgpt.com/codex").is_ok());
        assert!(validate_external_url("http://localhost:1420/callback?code=ok").is_ok());
        assert!(validate_external_url("http://127.0.0.1:4312/callback").is_ok());
    }

    #[test]
    fn rejects_unsafe_schemes_hosts_and_credentials() {
        for url in [
            "http://example.com",
            "http://localhost.example.com",
            "http://127.0.0.2",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "mailto:user@example.com",
            "https://user:secret@example.com",
            "https://@example.com",
            "https://example.com\n.evil.test",
        ] {
            assert!(
                validate_external_url(url).is_err(),
                "accepted unsafe URL: {url}"
            );
        }
    }
}
