use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;

pub fn extract_balanced_json(text: &str, open_index: usize) -> Option<String> {
    let bytes: Vec<char> = text.chars().collect();
    if open_index >= bytes.len() {
        return None;
    }
    let open = bytes[open_index];
    let close = if open == '[' { ']' } else { '}' };
    let mut depth = 0i32;
    let mut in_str = false;
    let mut quote = '"';
    let mut i = open_index;
    while i < bytes.len() {
        let ch = bytes[i];
        if in_str {
            if ch == '\\' {
                i += 2;
                continue;
            }
            if ch == quote {
                in_str = false;
            }
            i += 1;
            continue;
        }
        if ch == '"' || ch == '\'' {
            in_str = true;
            quote = ch;
            i += 1;
            continue;
        }
        if ch == open {
            depth += 1;
        } else if ch == close {
            depth -= 1;
            if depth == 0 {
                return Some(bytes[open_index..=i].iter().collect());
            }
        }
        i += 1;
    }
    None
}

pub fn find_object_by_key(text: &str, key: &str) -> Option<Value> {
    let needle = format!("\"{key}\":");
    let mut from = 0;
    while let Some(rel) = text[from..].find(&needle) {
        let idx = from + rel;
        let mut j = idx + needle.len();
        let bytes = text.as_bytes();
        while j < bytes.len() && (bytes[j] as char).is_whitespace() {
            j += 1;
        }
        if j < bytes.len() && (bytes[j] == b'{' || bytes[j] == b'[') {
            let char_index = text[..j].chars().count();
            if let Some(raw) = extract_balanced_json(text, char_index) {
                if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                    return Some(v);
                }
            }
        }
        from = idx + needle.len();
    }
    None
}

static FLIGHT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"self\.__next_f\.push\(\[\d+,\s*("(?:[^"\\]|\\.)*")\s*\]\)"#).unwrap());

pub fn collect_next_flight(html: &str) -> String {
    let mut out = String::new();
    for caps in FLIGHT_RE.captures_iter(html) {
        if let Ok(Value::String(s)) = serde_json::from_str::<Value>(&caps[1]) {
            out.push_str(&s);
        }
    }
    out
}

pub fn first_match(text: &str, re: &Regex) -> String {
    re.captures(text)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_default()
}

static APPID_RES: Lazy<Vec<Regex>> = Lazy::new(|| {
    [
        r"store\.steampowered\.com/app/(\d+)",
        r"steamdb\.info/app/(\d+)",
        r#"(?:steam_appid|steamAppId|steam_id)["'\s:=]+(\d{3,8})"#,
        r"/apps/(\d{3,8})/",
    ]
    .iter()
    .map(|p| Regex::new(p).unwrap())
    .collect()
});

pub fn find_steam_app_id(text: &str) -> Option<u64> {
    for re in APPID_RES.iter() {
        if let Some(c) = re.captures(text) {
            if let Some(m) = c.get(1) {
                if let Ok(n) = m.as_str().parse::<u64>() {
                    return Some(n);
                }
            }
        }
    }
    None
}
