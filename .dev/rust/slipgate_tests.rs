use super::*;

#[tokio::test]
async fn gated_hosts_resolve_via_slipgate_only_when_configured() {
    std::env::remove_var("SLIPGATE_URL");
    std::env::remove_var("SLIPGATE_KEY");
    assert!(cfg().is_none());

    let gated = "https://1fichier.com/?abcdef";
    // Gate hosts resolve in-app through the webview solver now, so they are
    // resolvable regardless of Slipgate configuration.
    assert!(crate::sources::hosts::is_resolvable(gated));
    let res = crate::sources::hosts::gate::resolve(gated).await;
    assert!(!res.resolvable);
    assert_eq!(res.open_url.as_deref(), Some(gated));
    assert!(res.reason.unwrap().contains("Slipgate URL in Settings"));

    std::env::set_var("SLIPGATE_URL", "https://gate.example/ ");
    let c = cfg().expect("cfg should parse from env");
    assert_eq!(c.base, "https://gate.example");
    assert_eq!(c.key, None);
    assert!(crate::sources::hosts::is_resolvable(gated));
    assert!(!crate::sources::hosts::is_resolvable(
        "https://mega.nz/file/abc"
    ));

    std::env::set_var("SLIPGATE_URL", "https://gate.example///");
    assert_eq!(cfg().unwrap().base, "https://gate.example");

    std::env::set_var("SLIPGATE_KEY", "  k123  ");
    assert_eq!(cfg().unwrap().key.as_deref(), Some("k123"));

    std::env::set_var("SLIPGATE_URL", "   ");
    assert!(
        cfg().is_none(),
        "blank url means Slipgate stays unconfigured"
    );
    std::env::set_var("SLIPGATE_KEY", "");
    std::env::set_var("SLIPGATE_URL", "https://gate.example");
    assert_eq!(cfg().unwrap().key, None, "blank key is treated as no key");

    std::env::remove_var("SLIPGATE_URL");
    std::env::remove_var("SLIPGATE_KEY");
    assert!(cfg().is_none());
    // Still resolvable: the webview solver covers gate hosts without Slipgate.
    assert!(crate::sources::hosts::is_resolvable(gated));
}

#[test]
fn resolved_download_replays_solver_session() {
    let headers = resolved_headers(&json!({
        "headers": { "Referer": "https://host.example/file" },
        "user_agent": "solver-browser",
        "cookies": [
            { "name": "cf_clearance", "value": "clear" },
            { "name": "session", "value": "ready" }
        ]
    }));
    assert_eq!(
        headers.get("Referer").map(String::as_str),
        Some("https://host.example/file")
    );
    assert_eq!(
        headers.get("User-Agent").map(String::as_str),
        Some("solver-browser")
    );
    assert_eq!(
        headers.get("Cookie").map(String::as_str),
        Some("cf_clearance=clear; session=ready")
    );
}

#[test]
fn onlinefix_fetch_requires_live_solver_health_not_recipes() {
    assert!(fetch_usable(&json!({
        "ok": true,
        "flaresolverrOk": true,
        "recipes": [],
    })));
    assert!(!fetch_usable(&json!({
        "ok": true,
        "flaresolverrOk": false,
        "recipes": ["datavaults"],
    })));
    assert!(!fetch_usable(&json!({
        "ok": false,
        "flaresolverrOk": true,
        "recipes": ["datavaults"],
    })));
}
