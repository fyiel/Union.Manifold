use super::*;

#[test]
fn detect_host_type_recognizes_every_native_resolver() {
    let cases = [
        ("https://pixeldrain.com/u/abc123", "pixeldrain"),
        ("https://buzzheavier.com/abc123", "buzzheavier"),
        ("https://gofile.io/d/AbCdEf", "gofile"),
        ("https://datanodes.to/abc123/game.zip", "datanodes"),
        ("https://fuckingfast.co/abc123", "fuckingfast"),
        (
            "https://www.mediafire.com/file/abc/game.zip/file",
            "mediafire",
        ),
        ("https://rootz.so/abc123", "rootz"),
        ("https://datavaults.co/abc/x.zip", "datavaults"),
        ("https://fileditchfiles.me/a13/abc/game.zip", "fileditch"),
        ("https://filekeeper.net/5bhrgi7pwnpl/game.zip", "filekeeper"),
    ];
    for (url, want) in cases {
        assert_eq!(detect_host_type(url), want, "{url}");
    }
}

#[test]
fn detect_host_type_recognizes_gated_hosts() {
    assert_eq!(detect_host_type("https://megadb.net/abc"), "megadb");
    assert_eq!(detect_host_type("https://1fichier.com/?abc"), "1fichier");
    assert_eq!(detect_host_type("https://fileq.net/x.html"), "fileq");
    assert_eq!(detect_host_type("https://mocha.my/f/abc"), "mocha");
    assert_eq!(detect_host_type("https://zerofs.link/f/abc"), "zerofs");
}

#[test]
fn detect_host_type_falls_back_to_domain_label() {
    assert_eq!(detect_host_type("https://www.example.com/file"), "example");
    assert_eq!(detect_host_type("https://mega.nz/file/abc"), "mega");
    assert_eq!(detect_host_type("not a url"), "unknown");
}

#[test]
fn native_hosts_are_always_resolvable() {
    for url in [
        "https://pixeldrain.com/u/abc123",
        "https://buzzheavier.com/abc123",
        "https://gofile.io/d/AbCdEf",
        "https://datanodes.to/abc123/game.zip",
        "https://fuckingfast.co/abc123",
        "https://www.mediafire.com/file/abc/game.zip/file",
        "https://rootz.so/abc123",
        "https://datavaults.co/abc/x.zip",
        "https://fileditchfiles.me/a13/abc/game.zip",
        "https://filekeeper.net/5bhrgi7pwnpl/game.zip",
    ] {
        assert!(is_resolvable(url), "{url}");
    }
}

#[test]
fn unknown_hosts_are_not_resolvable() {
    assert!(!is_resolvable("https://mega.nz/file/abc"));
    assert!(!is_resolvable("https://example.com/game.zip"));
    assert!(!is_resolvable(""));
}

#[tokio::test]
async fn resolve_url_unknown_host_falls_back_to_browser_with_reason() {
    let option = DownloadOption {
        url: Some("https://randomhost.example/file.zip".to_string()),
        ..Default::default()
    };
    let res = resolve_url(&option).await;
    assert!(!res.resolvable);
    assert_eq!(
        res.open_url.as_deref(),
        Some("https://randomhost.example/file.zip")
    );
    assert!(res.reason.unwrap().contains("unsupported host"));
}

#[tokio::test]
async fn resolve_url_mega_gets_dedicated_browser_only_reason() {
    let option = DownloadOption {
        url: Some("https://mega.nz/file/abc#key".to_string()),
        ..Default::default()
    };
    let res = resolve_url(&option).await;
    assert!(!res.resolvable);
    assert!(res.reason.unwrap().starts_with("mega"));
}

#[tokio::test]
async fn resolve_url_uses_page_url_when_direct_url_missing() {
    let option = DownloadOption {
        url: None,
        page_url: Some("https://unknownsite.io/game".to_string()),
        ..Default::default()
    };
    let res = resolve_url(&option).await;
    assert!(!res.resolvable);
    assert_eq!(res.open_url.as_deref(), Some("https://unknownsite.io/game"));
}
