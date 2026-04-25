/// Encode a web KeyboardEvent into Neovim's key notation.
///
/// Examples:
///   "a" → "a"
///   Ctrl+s → "<C-s>"
///   Alt+Enter → "<M-CR>"
///   Cmd+c → "<D-c>"
///   F1 → "<F1>"
///   Escape → "<Esc>"
///   Backspace → "<BS>"
///   Tab → "<Tab>"
///   Space → "<Space>"
pub fn encode_key(key: &str, ctrl: bool, alt: bool, meta: bool, shift: bool) -> Option<String> {
    let base = match key {
        "Escape" => "Esc",
        "Enter" => "CR",
        "Backspace" => "BS",
        "Tab" => "Tab",
        "Delete" => "Del",
        " " => "Space",
        "ArrowUp" => "Up",
        "ArrowDown" => "Down",
        "ArrowLeft" => "Left",
        "ArrowRight" => "Right",
        "Home" => "Home",
        "End" => "End",
        "PageUp" => "PageUp",
        "PageDown" => "PageDown",
        "Insert" => "Insert",
        "F1" => "F1",
        "F2" => "F2",
        "F3" => "F3",
        "F4" => "F4",
        "F5" => "F5",
        "F6" => "F6",
        "F7" => "F7",
        "F8" => "F8",
        "F9" => "F9",
        "F10" => "F10",
        "F11" => "F11",
        "F12" => "F12",
        // Ignore modifier-only keys
        "Shift" | "Control" | "Alt" | "Meta" | "CapsLock" | "NumLock" => return None,
        // Single printable character
        other => other,
    };

    let has_modifier = ctrl || alt || meta || (shift && base.len() > 1);

    if has_modifier {
        let mut mods = String::new();
        if shift && base.len() > 1 {
            mods.push_str("S-");
        }
        if ctrl {
            mods.push_str("C-");
        }
        if alt {
            mods.push_str("M-");
        }
        if meta {
            mods.push_str("D-");
        }
        Some(format!("<{}{}>", mods, base))
    } else if base.len() > 1 {
        // Special key without modifier
        Some(format!("<{}>", base))
    } else {
        // Plain character — apply shift via the character itself (browser already uppercases)
        Some(base.to_string())
    }
}

/// Encode a raw character for Neovim input (e.g., from IME composition)
pub fn encode_text(text: &str) -> String {
    text.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plain_char() {
        assert_eq!(encode_key("a", false, false, false, false), Some("a".into()));
    }

    #[test]
    fn test_ctrl_s() {
        assert_eq!(
            encode_key("s", true, false, false, false),
            Some("<C-s>".into())
        );
    }

    #[test]
    fn test_cmd_c() {
        assert_eq!(
            encode_key("c", false, false, true, false),
            Some("<D-c>".into())
        );
    }

    #[test]
    fn test_escape() {
        assert_eq!(
            encode_key("Escape", false, false, false, false),
            Some("<Esc>".into())
        );
    }

    #[test]
    fn test_enter() {
        assert_eq!(
            encode_key("Enter", false, false, false, false),
            Some("<CR>".into())
        );
    }

    #[test]
    fn test_alt_enter() {
        assert_eq!(
            encode_key("Enter", false, true, false, false),
            Some("<M-CR>".into())
        );
    }

    #[test]
    fn test_f1() {
        assert_eq!(
            encode_key("F1", false, false, false, false),
            Some("<F1>".into())
        );
    }

    #[test]
    fn test_space() {
        assert_eq!(
            encode_key(" ", false, false, false, false),
            Some("<Space>".into())
        );
    }

    #[test]
    fn test_ignore_modifier_only() {
        assert_eq!(encode_key("Shift", false, false, false, true), None);
        assert_eq!(encode_key("Control", true, false, false, false), None);
    }

    #[test]
    fn test_shift_f1() {
        assert_eq!(
            encode_key("F1", false, false, false, true),
            Some("<S-F1>".into())
        );
    }
}
