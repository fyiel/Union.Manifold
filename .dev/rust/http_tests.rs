use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};

fn serve_scripted(responses: Vec<String>) -> (String, std::thread::JoinHandle<usize>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = std::thread::spawn(move || {
        let mut served = 0usize;
        for resp in responses {
            let (mut stream, _) = match listener.accept() {
                Ok(s) => s,
                Err(_) => break,
            };
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf);
            let _ = stream.write_all(resp.as_bytes());
            served += 1;
        }
        served
    });
    (format!("http://{addr}"), handle)
}

fn http_response(status_line: &str, extra_headers: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status_line}\r\nContent-Length: {}\r\nConnection: close\r\n{extra_headers}\r\n{body}",
        body.len()
    )
}

#[tokio::test]
async fn fetch_retries_server_errors_then_succeeds() {
    let (base, handle) = serve_scripted(vec![
        http_response("500 Internal Server Error", "", "boom"),
        http_response("200 OK", "", "recovered"),
    ]);
    let resp = fetch(&base, &FetchOpts::default()).await.unwrap();
    assert_eq!(resp.status().as_u16(), 200);
    assert_eq!(resp.text().await.unwrap(), "recovered");
    assert_eq!(handle.join().unwrap(), 2);
}

#[tokio::test]
async fn fetch_does_not_retry_client_errors() {
    let (base, handle) = serve_scripted(vec![
        http_response("404 Not Found", "", "gone"),
        http_response("200 OK", "", "never"),
    ]);
    let resp = fetch(&base, &FetchOpts::default()).await.unwrap();
    assert_eq!(resp.status().as_u16(), 404);
    drop(resp);
    if let Ok(mut probe) = std::net::TcpStream::connect(base.trim_start_matches("http://")) {
        let _ = probe.write_all(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n");
        let _ = probe.shutdown(std::net::Shutdown::Write);
    }
    assert_eq!(handle.join().unwrap(), 2);
}

#[tokio::test]
async fn fetch_gives_up_after_retry_budget() {
    let (base, handle) = serve_scripted(vec![
        http_response("503 Service Unavailable", "", "a"),
        http_response("503 Service Unavailable", "", "b"),
    ]);
    let opts = FetchOpts {
        retries: Some(1),
        ..Default::default()
    };
    let resp = fetch(&base, &opts).await.unwrap();
    assert_eq!(resp.status().as_u16(), 503);
    assert_eq!(handle.join().unwrap(), 2);
}

#[tokio::test]
async fn manual_redirect_returns_redirect_instead_of_following() {
    let (base, handle) = serve_scripted(vec![http_response(
        "302 Found",
        "Location: http://127.0.0.1:9/never\r\n",
        "",
    )]);
    let opts = FetchOpts {
        manual_redirect: true,
        ..Default::default()
    };
    let resp = fetch(&base, &opts).await.unwrap();
    assert_eq!(resp.status().as_u16(), 302);
    assert_eq!(
        resp.headers().get("location").unwrap().to_str().unwrap(),
        "http://127.0.0.1:9/never"
    );
    assert_eq!(handle.join().unwrap(), 1);
}

#[tokio::test]
async fn auto_redirect_follows_to_final_target() {
    let (final_base, final_handle) = serve_scripted(vec![http_response("200 OK", "", "landed")]);
    let (base, handle) = serve_scripted(vec![http_response(
        "302 Found",
        &format!("Location: {final_base}/dest\r\n"),
        "",
    )]);
    let resp = fetch(&base, &FetchOpts::default()).await.unwrap();
    assert_eq!(resp.status().as_u16(), 200);
    assert_eq!(resp.text().await.unwrap(), "landed");
    assert_eq!(handle.join().unwrap(), 1);
    assert_eq!(final_handle.join().unwrap(), 1);
}

#[tokio::test]
async fn fetch_sends_custom_headers_and_body() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).unwrap();
        let req = String::from_utf8_lossy(&buf[..n]).to_string();
        let body = "ok";
        stream
            .write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .as_bytes(),
            )
            .unwrap();
        req
    });
    let mut headers = HashMap::new();
    headers.insert("X-Test-Header".to_string(), "union".to_string());
    let opts = FetchOpts {
        method: Some("POST".to_string()),
        headers,
        body: Some(b"payload=1".to_vec()),
        ..Default::default()
    };
    let resp = fetch(&format!("http://{addr}/submit"), &opts)
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 200);
    let req = handle.join().unwrap();
    assert!(req.starts_with("POST /submit"));
    assert!(req.contains("x-test-header: union") || req.contains("X-Test-Header: union"));
    assert!(req.contains("payload=1"));
    assert!(req.to_lowercase().contains("user-agent: mozilla/5.0"));
}

#[tokio::test]
async fn jar_round_trips_cookies_between_requests() {
    let (base, handle) = serve_scripted(vec![http_response(
        "200 OK",
        "Set-Cookie: session=abc123; Path=/\r\n",
        "first",
    )]);
    let jar = Jar::new();
    let host = url::Url::parse(&base)
        .unwrap()
        .host_str()
        .unwrap()
        .to_string();
    let opts = FetchOpts {
        jar: Some(jar.clone()),
        ..Default::default()
    };
    fetch(&base, &opts).await.unwrap();
    handle.join().unwrap();
    assert_eq!(jar.header_for(&host).as_deref(), Some("session=abc123"));
    jar.set(&host, "extra", "1");
    let header = jar.header_for(&host).unwrap();
    assert!(header.contains("session=abc123"));
    assert!(header.contains("extra=1"));
}

#[tokio::test]
async fn map_limit_preserves_order_and_drops_nones() {
    let out = map_limit(vec![1, 2, 3, 4, 5], 2, |n| async move {
        tokio::time::sleep(Duration::from_millis((6 - n) as u64 * 5)).await;
        (n % 2 == 1).then_some(n * 10)
    })
    .await;
    assert_eq!(out, vec![10, 30, 50]);
}

#[tokio::test]
async fn map_limit_never_exceeds_concurrency_bound() {
    static CURRENT: AtomicUsize = AtomicUsize::new(0);
    static PEAK: AtomicUsize = AtomicUsize::new(0);
    let _ = map_limit(0..20, 3, |n: i32| async move {
        let now = CURRENT.fetch_add(1, Ordering::SeqCst) + 1;
        PEAK.fetch_max(now, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(10)).await;
        CURRENT.fetch_sub(1, Ordering::SeqCst);
        Some(n)
    })
    .await;
    assert!(PEAK.load(Ordering::SeqCst) <= 3);
    assert!(PEAK.load(Ordering::SeqCst) >= 2);
}

#[tokio::test]
async fn map_limit_zero_is_clamped_to_serial() {
    let out = map_limit(vec![1, 2], 0, |n| async move { Some(n) }).await;
    assert_eq!(out, vec![1, 2]);
}

#[test]
fn decode_entities_handles_extended_named_and_hex() {
    assert_eq!(decode_entities("a&nbsp;b"), "a b");
    assert_eq!(decode_entities("x&mdash;y"), "x\u{2014}y");
    assert_eq!(
        decode_entities("&copy;&reg;&trade;"),
        "\u{00a9}\u{00ae}\u{2122}"
    );
    assert_eq!(decode_entities("&#x1F600;"), "\u{1F600}");
    assert_eq!(decode_entities("plain text"), "plain text");
}

#[test]
fn decode_entities_leaves_invalid_codepoints_verbatim() {
    assert_eq!(decode_entities("&#xD800;"), "&#xD800;");
    assert_eq!(decode_entities("&#1114112;"), "&#1114112;");
}

#[test]
fn strip_tags_flattens_html_to_clean_text() {
    assert_eq!(
        strip_tags("<p>Hello <b>world</b> &amp; friends</p>\n<br/>bye"),
        "Hello world & friends bye"
    );
    assert_eq!(
        strip_tags("<div\nclass=\"x\">multi\nline</div>"),
        "multi line"
    );
    assert_eq!(strip_tags("no tags here"), "no tags here");
}
