use std::sync::LazyLock;
use regex::Regex;

static APPID_RES: LazyLock<Vec<Regex>> = LazyLock::new(|| {
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

#[cfg(test)]
#[path = "../../../.dev/rust/parse_tests.rs"]
mod dev_parse_tests;
