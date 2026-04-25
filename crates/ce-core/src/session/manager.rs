use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use super::layout::Session;

/// Manages session persistence
pub struct SessionManager {
    sessions_dir: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
struct SessionFile {
    session: Session,
}

impl SessionManager {
    pub fn new() -> Result<Self> {
        let sessions_dir = dirs_config_path().join("sessions");
        std::fs::create_dir_all(&sessions_dir)?;
        Ok(Self { sessions_dir })
    }

    pub fn save(&self, session: &Session) -> Result<()> {
        let path = self.sessions_dir.join(format!("{}.json", session.id));
        let contents = serde_json::to_string_pretty(&SessionFile {
            session: session.clone(),
        })?;
        std::fs::write(path, contents)?;
        Ok(())
    }

    pub fn load(&self, session_id: &str) -> Result<Option<Session>> {
        let path = self.sessions_dir.join(format!("{}.json", session_id));
        if !path.exists() {
            return Ok(None);
        }
        let contents = std::fs::read_to_string(path)?;
        let file: SessionFile = serde_json::from_str(&contents)?;
        Ok(Some(file.session))
    }

    pub fn list_sessions(&self) -> Result<Vec<String>> {
        let mut sessions = Vec::new();
        for entry in std::fs::read_dir(&self.sessions_dir)? {
            let entry = entry?;
            if let Some(name) = entry.path().file_stem() {
                sessions.push(name.to_string_lossy().to_string());
            }
        }
        Ok(sessions)
    }

    pub fn delete(&self, session_id: &str) -> Result<()> {
        let path = self.sessions_dir.join(format!("{}.json", session_id));
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }
}

fn dirs_config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("code-engine")
}
