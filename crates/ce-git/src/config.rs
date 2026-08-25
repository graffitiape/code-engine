use crate::repository::open_repository;
use anyhow::{bail, Context, Result};
use git2::{BranchType, Config, ConfigLevel, Repository};
use serde::{Deserialize, Serialize};
use std::path::Path;
use url::Url;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GitIdentityScope {
    Project,
    Global,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIdentityInfo {
    pub name: Option<String>,
    pub email: Option<String>,
    /// "project" | "global" | "mixed" | "missing"
    pub scope: String,
    pub configured: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteInfo {
    pub name: String,
    /// Redacted URL suitable for display. Credential-bearing userinfo is never returned.
    pub display_url: String,
    pub web_url: Option<String>,
    /// "github" | "azure-devops" | "gitlab" | "bitbucket" | "generic"
    pub provider: String,
    /// "https" | "ssh" | "local" | "other"
    pub transport: String,
    pub host: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositoryInfo {
    pub identity: GitIdentityInfo,
    pub remote: Option<GitRemoteInfo>,
    pub upstream: Option<String>,
    pub credential_helper: String,
}

pub fn repository_info<P: AsRef<Path>>(path: P) -> Result<GitRepositoryInfo> {
    let repo = open_repository(path.as_ref())?;
    let (remote, upstream) = selected_remote(&repo)?;
    let transport = remote.as_ref().map(|remote| remote.transport.as_str());
    let credential_helper = credential_helper_label(&repo, transport)?;
    Ok(GitRepositoryInfo {
        identity: identity_info(&repo)?,
        remote,
        upstream,
        credential_helper,
    })
}

pub fn set_identity<P: AsRef<Path>>(
    path: P,
    name: &str,
    email: &str,
    scope: GitIdentityScope,
) -> Result<GitRepositoryInfo> {
    let name = validate_identity_value("name", name, 200)?;
    let email = validate_identity_value("email", email, 320)?;
    if !is_reasonable_email(email) {
        bail!("Git email must contain one @ and no whitespace");
    }

    let repo = open_repository(path.as_ref())?;
    match scope {
        GitIdentityScope::Project => {
            let config = repo
                .config()
                .context("failed to open repository Git config")?;
            let mut local = config
                .open_level(ConfigLevel::Local)
                .context("failed to open project Git config")?;
            write_identity(&mut local, name, email, "project")?;
        }
        GitIdentityScope::Global => {
            let mut config = Config::open_default().context("failed to open global Git config")?;
            let mut global = config
                .open_global()
                .context("failed to open writable global Git config")?;
            write_identity(&mut global, name, email, "global")?;
        }
    }
    drop(repo);
    repository_info(path)
}

pub(crate) fn selected_remote_name(repo: &Repository) -> Result<Option<String>> {
    if let Ok(head) = repo.head() {
        if let Some(reference_name) = head.name() {
            if let Ok(name) = repo.branch_upstream_remote(reference_name) {
                if let Some(name) = name
                    .as_str()
                    .filter(|name| !name.is_empty() && *name != ".")
                {
                    return Ok(Some(name.to_string()));
                }
            }
        }
    }

    if repo.find_remote("origin").is_ok() {
        return Ok(Some("origin".to_string()));
    }

    let mut names = repo
        .remotes()
        .context("failed to list Git remotes")?
        .iter()
        .flatten()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    names.sort();
    Ok(names.into_iter().next())
}

pub(crate) fn provider_for_selected_remote(repo: &Repository) -> Result<String> {
    let Some(name) = selected_remote_name(repo)? else {
        return Ok("Git remote".to_string());
    };
    let remote = repo
        .find_remote(&name)
        .with_context(|| format!("failed to read Git remote {name}"))?;
    let url = remote
        .pushurl()
        .or_else(|| remote.url())
        .unwrap_or_default();
    Ok(provider_label(&parse_remote_url(url).provider).to_string())
}

fn write_identity(config: &mut Config, name: &str, email: &str, scope_label: &str) -> Result<()> {
    config
        .set_str("user.name", name)
        .with_context(|| format!("failed to save {scope_label} Git user.name"))?;
    config
        .set_str("user.email", email)
        .with_context(|| format!("failed to save {scope_label} Git user.email"))
}

fn identity_info(repo: &Repository) -> Result<GitIdentityInfo> {
    let config = repo.config().context("failed to read Git configuration")?;
    let name = config_value(&config, "user.name");
    let email = config_value(&config, "user.email");
    let local = config.open_level(ConfigLevel::Local).ok();
    let local_name = local
        .as_ref()
        .and_then(|config| config_value(config, "user.name"));
    let local_email = local
        .as_ref()
        .and_then(|config| config_value(config, "user.email"));
    let configured = name.is_some() && email.is_some();
    let local_values = usize::from(local_name.is_some()) + usize::from(local_email.is_some());
    let scope = match (configured, local_values) {
        (false, 0) => "missing",
        (false, _) => "mixed",
        (true, 2) => "project",
        (true, 0) => "global",
        (true, _) => "mixed",
    };
    Ok(GitIdentityInfo {
        name,
        email,
        scope: scope.to_string(),
        configured,
    })
}

fn config_value(config: &Config, key: &str) -> Option<String> {
    config
        .get_string(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn selected_remote(repo: &Repository) -> Result<(Option<GitRemoteInfo>, Option<String>)> {
    let upstream = current_upstream(repo);
    let Some(name) = selected_remote_name(repo)? else {
        return Ok((None, upstream));
    };
    let remote = repo
        .find_remote(&name)
        .with_context(|| format!("failed to read Git remote {name}"))?;
    let raw_url = remote
        .pushurl()
        .or_else(|| remote.url())
        .unwrap_or_default();
    let parsed = parse_remote_url(raw_url);
    Ok((Some(GitRemoteInfo { name, ..parsed }), upstream))
}

fn current_upstream(repo: &Repository) -> Option<String> {
    let branch_name = repo.head().ok()?.shorthand()?.to_string();
    repo.find_branch(&branch_name, BranchType::Local)
        .ok()?
        .upstream()
        .ok()?
        .name()
        .ok()?
        .map(str::to_owned)
}

fn credential_helper_label(repo: &Repository, transport: Option<&str>) -> Result<String> {
    if transport == Some("ssh") {
        return Ok("SSH agent or keychain".to_string());
    }
    if transport == Some("local") {
        return Ok("Local filesystem".to_string());
    }
    let config = repo
        .config()
        .context("failed to read Git credential configuration")?;
    let mut helpers = Vec::new();
    if let Ok(mut entries) = config.multivar("credential.helper", Some(".*")) {
        while let Some(entry) = entries.next() {
            if let Ok(entry) = entry {
                if let Some(value) = entry.value() {
                    helpers.push(value.to_ascii_lowercase());
                }
            }
        }
    }
    let joined = helpers.join(" ");
    let label = if joined.contains("credential-manager") || joined.contains("manager-core") {
        "Git Credential Manager"
    } else if joined.contains("osxkeychain") {
        "macOS Keychain"
    } else if joined.contains("wincred") {
        "Windows Credential Manager"
    } else if joined.contains("libsecret") || joined.contains("gnome-keyring") {
        "System keyring"
    } else if joined.contains("cache") {
        "Git credential cache"
    } else if joined.contains("store") {
        "Git credential store"
    } else if helpers.is_empty() {
        "No credential helper configured"
    } else {
        "Configured Git credential helper"
    };
    Ok(label.to_string())
}

fn validate_identity_value<'a>(label: &str, value: &'a str, max: usize) -> Result<&'a str> {
    let value = value.trim();
    if value.is_empty() {
        bail!("Git {label} cannot be empty");
    }
    if value.len() > max {
        bail!("Git {label} is too long");
    }
    if value.chars().any(char::is_control) {
        bail!("Git {label} cannot contain control characters");
    }
    Ok(value)
}

fn is_reasonable_email(email: &str) -> bool {
    let mut parts = email.split('@');
    matches!(
        (parts.next(), parts.next(), parts.next()),
        (Some(local), Some(domain), None)
            if !local.is_empty()
                && !domain.is_empty()
                && !email.chars().any(char::is_whitespace)
    )
}

fn parse_remote_url(raw: &str) -> GitRemoteInfo {
    if let Ok(mut parsed) = Url::parse(raw) {
        let transport = match parsed.scheme() {
            "http" | "https" => "https",
            "ssh" => "ssh",
            "file" => "local",
            _ => "other",
        };
        let host = parsed.host_str().map(|host| host.to_ascii_lowercase());
        let provider = provider_for_host(host.as_deref());
        let _ = parsed.set_username("");
        let _ = parsed.set_password(None);
        let display_url = parsed.to_string();
        let web_url = web_url(&parsed, &provider, transport);
        return GitRemoteInfo {
            name: String::new(),
            display_url,
            web_url,
            provider,
            transport: transport.to_string(),
            host,
        };
    }

    if let Some((authority, path)) = raw.split_once(':') {
        if !raw.contains("://") && !authority.contains('/') && !authority.contains('\\') {
            let host = authority
                .rsplit_once('@')
                .map(|(_, host)| host)
                .unwrap_or(authority)
                .to_ascii_lowercase();
            let safe_path = path.trim_start_matches('/');
            let provider = provider_for_host(Some(&host));
            let web_url = (provider != "azure-devops" && !safe_path.is_empty())
                .then(|| format!("https://{host}/{}", safe_path.trim_end_matches(".git")));
            return GitRemoteInfo {
                name: String::new(),
                display_url: format!("{host}:{safe_path}"),
                web_url,
                provider,
                transport: "ssh".to_string(),
                host: Some(host),
            };
        }
    }

    let transport =
        if Path::new(raw).is_absolute() || raw.starts_with("./") || raw.starts_with("../") {
            "local"
        } else {
            "other"
        };
    GitRemoteInfo {
        name: String::new(),
        display_url: fallback_remote_display(raw),
        web_url: None,
        provider: "generic".to_string(),
        transport: transport.to_string(),
        host: None,
    }
}

fn fallback_remote_display(raw: &str) -> String {
    let safe = raw
        .chars()
        .filter(|character| !character.is_control())
        .take(2_048)
        .collect::<String>();
    if safe.is_empty() {
        return "Remote URL unavailable".to_string();
    }
    let Some((scheme, remainder)) = safe.split_once("://") else {
        return safe;
    };
    let authority_end = remainder.find('/').unwrap_or(remainder.len());
    let authority = &remainder[..authority_end];
    let Some((_, host)) = authority.rsplit_once('@') else {
        return safe;
    };
    format!(
        "{scheme}://[redacted]@{host}{}",
        &remainder[authority_end..]
    )
}

fn provider_for_host(host: Option<&str>) -> String {
    let Some(host) = host else {
        return "generic".to_string();
    };
    if host == "github.com" || host.ends_with(".github.com") || host.starts_with("github.") {
        "github"
    } else if host == "dev.azure.com"
        || host == "ssh.dev.azure.com"
        || host.ends_with(".visualstudio.com")
    {
        "azure-devops"
    } else if host == "gitlab.com" || host.starts_with("gitlab.") {
        "gitlab"
    } else if host == "bitbucket.org" || host.starts_with("bitbucket.") {
        "bitbucket"
    } else {
        "generic"
    }
    .to_string()
}

fn provider_label(provider: &str) -> &str {
    match provider {
        "github" => "GitHub",
        "azure-devops" => "Azure DevOps",
        "gitlab" => "GitLab",
        "bitbucket" => "Bitbucket",
        _ => "Git remote",
    }
}

fn web_url(parsed: &Url, provider: &str, transport: &str) -> Option<String> {
    if transport == "https" && parsed.scheme() == "https" {
        let mut url = parsed.clone();
        url.set_fragment(None);
        url.set_query(None);
        let path = url
            .path()
            .trim_end_matches('/')
            .trim_end_matches(".git")
            .to_string();
        url.set_path(&path);
        return Some(url.to_string());
    }
    if transport != "ssh" || provider == "azure-devops" {
        return None;
    }
    let host = parsed.host_str()?;
    let path = parsed
        .path()
        .trim_start_matches('/')
        .trim_end_matches(".git");
    (!path.is_empty()).then(|| format!("https://{host}/{path}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_credentials_and_detects_popular_providers() {
        let github = parse_remote_url("https://secret-token@github.com/acme/project.git");
        assert_eq!(github.provider, "github");
        assert_eq!(github.transport, "https");
        assert!(!github.display_url.contains("secret-token"));
        assert_eq!(
            github.web_url.as_deref(),
            Some("https://github.com/acme/project")
        );

        let azure = parse_remote_url("git@ssh.dev.azure.com:v3/acme/platform/project");
        assert_eq!(azure.provider, "azure-devops");
        assert_eq!(azure.transport, "ssh");
        assert_eq!(
            azure.display_url,
            "ssh.dev.azure.com:v3/acme/platform/project"
        );

        let gitlab = parse_remote_url("ssh://git@gitlab.com/acme/project.git");
        assert_eq!(gitlab.provider, "gitlab");
        assert_eq!(
            gitlab.web_url.as_deref(),
            Some("https://gitlab.com/acme/project")
        );

        let malformed = parse_remote_url("https://secret-token@bad host/acme/project.git");
        assert!(!malformed.display_url.contains("secret-token"));
    }

    #[test]
    fn validates_identity_values_before_writing_config() {
        assert!(validate_identity_value("name", "Ada Lovelace", 200).is_ok());
        assert!(validate_identity_value("name", "Ada\nLovelace", 200).is_err());
        assert!(is_reasonable_email("ada@example.test"));
        assert!(!is_reasonable_email("ada.example.test"));
        assert!(!is_reasonable_email("ada @example.test"));
    }
}
