use super::*;

#[test]
fn probe_payload_roundtrips_through_title() {
    let probe = Probe {
        h: "https://datanodes.to/download".to_string(),
        r: "complete".to_string(),
        c: "cf_clearance=abc123; lang=english".to_string(),
        u: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36".to_string(),
        t: true,
        n: false,
        k: 0,
        g: None,
        e: 1_700_000_000_000,
    };
    let title = encode_probe_payload(&probe);
    assert!(title.starts_with(PROBE_MARK));
    let decoded = decode_probe(&title).expect("decodes");
    assert_eq!(decoded, probe);
}

#[test]
fn decode_rejects_plain_and_stale_titles() {
    assert!(decode_probe("Just a moment...").is_none());
    assert!(decode_probe("").is_none());
    // Marker present but body is not base64 JSON.
    let bad = format!("{PROBE_MARK}not-base64!!!");
    assert!(decode_probe(&bad).is_none());
    // Valid encoding of a non-JSON payload.
    let junk = format!(
        "{PROBE_MARK}{}",
        base64::engine::general_purpose::STANDARD.encode(b"hello")
    );
    assert!(decode_probe(&junk).is_none());
}

#[test]
fn probe_freshness_rejects_old_payloads() {
    let now = now_ms();
    let fresh = Probe {
        e: now - 1_000,
        ..Default::default()
    };
    assert!(probe_fresh(&fresh));
    let stale = Probe {
        e: now - PROBE_FRESHNESS_MS - 1,
        ..Default::default()
    };
    assert!(!probe_fresh(&stale));
    let unset = Probe {
        e: 0,
        ..Default::default()
    };
    assert!(!probe_fresh(&unset));
}

#[test]
fn escalation_waits_for_grace_then_shows_once() {
    // Nothing interactive yet: hidden until the unattended budget is spent.
    assert_eq!(
        escalation_action(false, 5_000, None),
        Escalation::StayHidden
    );
    assert_eq!(
        escalation_action(false, HIDDEN_BUDGET_MS, None),
        Escalation::Show
    );
    // Interactive widget seen but inside its grace period.
    assert_eq!(
        escalation_action(false, 3_000, Some(2_000)),
        Escalation::StayHidden
    );
    // Interactive widget persisting past the grace period escalates early.
    assert_eq!(
        escalation_action(false, 9_000, Some(INTERACTIVE_GRACE_MS)),
        Escalation::Show
    );
    // Never escalates twice.
    assert_eq!(
        escalation_action(true, 999_999, Some(999_999)),
        Escalation::StayHidden
    );
}

#[test]
fn direct_file_classification() {
    assert!(looks_like_direct_file("https://cdn.host/d/token/Game.zip"));
    assert!(looks_like_direct_file(
        "https://fs.host/get/file.rar?token=abc"
    ));
    assert!(looks_like_direct_file("https://host/x/part1.iso"));
    // Pages and documents are not downloads.
    assert!(!looks_like_direct_file("https://host/download"));
    assert!(!looks_like_direct_file("https://host/file.php?f=/a/b.zip"));
    assert!(!looks_like_direct_file("https://host/page.html"));
    assert!(!looks_like_direct_file("https://host/page.htm#x"));
    // The extension must terminate the path (or hit a query), not be a prefix.
    assert!(!looks_like_direct_file("https://host/file.zipper/preview"));
}

#[test]
fn file_name_extraction_prefers_last_segment() {
    assert_eq!(
        file_name_from_url("https://cdn.host/d/tok/Big%20Game.zip"),
        Some("Big Game.zip".to_string())
    );
    assert_eq!(
        file_name_from_url("https://cdn.host/d/tok/Game.7z?ttl=1"),
        Some("Game.7z".to_string())
    );
    assert_eq!(file_name_from_url("https://cdn.host/"), None);
}

#[test]
fn cookie_headers_join_and_detect_clearance() {
    let jar = vec![
        tauri::webview::cookie::Cookie::new("cf_clearance", "tok"),
        tauri::webview::cookie::Cookie::new("lang", "english"),
    ];
    assert!(clearance_cookie(&jar));
    assert_eq!(
        cookie_header_from(&jar),
        Some("cf_clearance=tok; lang=english".to_string())
    );
    assert!(!clearance_cookie(&[tauri::webview::cookie::Cookie::new(
        "lang", "en"
    )]));
    assert_eq!(cookie_header_from(&[]), None);
}

#[test]
fn solved_headers_carry_ua_cookie_and_referer() {
    let solved = Solved {
        url: None,
        file_name: None,
        cookie_header: Some("cf_clearance=tok".to_string()),
        user_agent: Some("UA/1".to_string()),
    };
    let headers = solved.headers(Some("https://host/page"));
    assert_eq!(headers.get("User-Agent").map(String::as_str), Some("UA/1"));
    assert_eq!(
        headers.get("Cookie").map(String::as_str),
        Some("cf_clearance=tok")
    );
    assert_eq!(
        headers.get("Referer").map(String::as_str),
        Some("https://host/page")
    );
    assert!(Solved::default().headers(None).is_empty());
}

#[test]
fn clearance_cache_respects_ttl() {
    let host = "cache-test.example";
    assert!(cached_clearance(host).is_none());
    cache_clearance(host, "c=1".to_string(), Some("UA".into()));
    let (cookie, ua) = cached_clearance(host).expect("fresh entry");
    assert_eq!(cookie, "c=1");
    assert_eq!(ua.as_deref(), Some("UA"));

    CLEARANCE_CACHE.lock().get_mut(host).unwrap().at_ms = now_ms() - CLEARANCE_TTL_MS - 1_000;
    assert!(
        cached_clearance(host).is_none(),
        "expired entries are ignored"
    );
}

#[test]
fn solver_rejects_non_http_urls() {
    assert_eq!(
        parse_solve_url("javascript:alert(1)").unwrap_err(),
        "solver: only http(s) urls can be solved"
    );
    assert_eq!(
        parse_solve_url("not a url").unwrap_err(),
        "solver: invalid url"
    );
    let (url, host) = parse_solve_url("https://Datanodes.To/download").expect("valid");
    assert_eq!(host, "datanodes.to");
    assert_eq!(url.as_str(), "https://datanodes.to/download");
}

#[tokio::test]
async fn solver_slots_serialize_per_host_not_globally() {
    let a = acquire_slot("slots-a.example")
        .await
        .expect("first host locks");
    // A different host never waits for the first session.
    let b = tokio::time::timeout(Duration::from_millis(500), acquire_slot("slots-b.example"))
        .await
        .expect("different host must not block")
        .expect("second host locks");
    // The same host queues behind the active session.
    let again =
        tokio::time::timeout(Duration::from_millis(200), acquire_slot("slots-a.example")).await;
    assert!(again.is_err(), "same-host second solve must wait");
    drop((a, b));
}
