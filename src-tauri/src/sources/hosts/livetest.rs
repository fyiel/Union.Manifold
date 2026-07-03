use crate::http::{self, FetchOpts};
use crate::sources::adapters;
use crate::sources::hosts;
use crate::sources::schema::DownloadOption;
use crate::sources::QueryParams;
use std::collections::HashMap;
use std::time::Duration;

const TARGET_HOSTS: &[&str] = &[
    "gofile",
    "datanodes",
    "fuckingfast",
    "mediafire",
    "rootz",
    "buzzheavier",
    "pixeldrain",
];
const PER_HOST: usize = 3;

async fn verify_direct(
    url: &str,
    headers: &Option<HashMap<String, String>>,
) -> Result<String, String> {
    let mut h = headers.clone().unwrap_or_default();
    h.insert("Range".to_string(), "bytes=0-0".to_string());
    let opts = FetchOpts {
        method: Some("GET".to_string()),
        headers: h,
        retries: Some(1),
        timeout: Some(Duration::from_secs(25)),
        ..Default::default()
    };
    let resp = http::fetch(url, &opts)
        .await
        .map_err(|e| format!("request error: {e}"))?;
    let status = resp.status();
    let header = |name: reqwest::header::HeaderName| {
        resp.headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string()
    };
    let ct = header(reqwest::header::CONTENT_TYPE).to_lowercase();
    let len = header(reqwest::header::CONTENT_LENGTH);
    let cr = header(reqwest::header::CONTENT_RANGE);
    if !status.is_success() {
        return Err(format!("status {}", status.as_u16()));
    }
    if ct.contains("text/html") {
        return Err(format!("html response (ct={ct})"));
    }
    Ok(format!(
        "status={} ct={} len={} range={}",
        status.as_u16(),
        if ct.is_empty() { "?" } else { &ct },
        if len.is_empty() { "?" } else { &len },
        if cr.is_empty() { "?" } else { &cr }
    ))
}

async fn collect_options() -> Vec<DownloadOption> {
    let params = QueryParams {
        limit: 150,
        ..Default::default()
    };
    let mut opts = Vec::new();
    for g in adapters::steamrip::query(&params).await {
        opts.extend(g.download_options);
    }
    for g in adapters::gamebounty::query(&params).await {
        opts.extend(g.download_options);
    }
    opts
}

#[tokio::test]
#[ignore]
async fn host_resolvers_live() {
    let all = collect_options().await;
    eprintln!("collected {} download options across sources", all.len());
    let mut dist: HashMap<String, usize> = HashMap::new();
    for o in &all {
        *dist.entry(o.host_type.clone()).or_default() += 1;
    }
    let mut dist: Vec<(String, usize)> = dist.into_iter().collect();
    dist.sort_by(|a, b| b.1.cmp(&a.1));
    eprintln!("host distribution: {dist:?}\n");

    let mut verified: Vec<String> = Vec::new();
    let mut no_verified: Vec<String> = Vec::new();
    let mut no_sample: Vec<String> = Vec::new();

    for host in TARGET_HOSTS {
        let candidates: Vec<&DownloadOption> = all
            .iter()
            .filter(|o| o.host_type == *host)
            .take(PER_HOST)
            .collect();
        if candidates.is_empty() {
            eprintln!("[{host}] no sample links surfaced this run");
            no_sample.push(host.to_string());
            continue;
        }

        let mut ok = 0usize;
        for opt in &candidates {
            let src = opt.url.as_deref().or(opt.page_url.as_deref()).unwrap_or("");
            let r = hosts::resolve_url(opt).await;
            if r.resolvable {
                if let Some(direct) = r.url.as_deref() {
                    match verify_direct(direct, &r.headers).await {
                        Ok(info) => {
                            ok += 1;
                            eprintln!("[{host}] OK   {src}\n           -> {direct}\n           {info}");
                        }
                        Err(e) => eprintln!(
                            "[{host}] BAD  {src}\n           -> {direct}\n           {e}"
                        ),
                    }
                } else if r.files.as_ref().map(|f| !f.is_empty()).unwrap_or(false) {
                    ok += 1;
                    eprintln!("[{host}] OK   {src} (multi-file list)");
                } else {
                    eprintln!("[{host}] RESOLVABLE-BUT-EMPTY {src}");
                }
            } else {
                eprintln!(
                    "[{host}] SOFT {src} -> {}",
                    r.reason.as_deref().unwrap_or("(no reason)")
                );
            }
        }

        if ok > 0 {
            verified.push(format!("{host} ({ok}/{})", candidates.len()));
        } else {
            no_verified.push(format!("{host} (0/{})", candidates.len()));
        }
        eprintln!();
    }

    eprintln!("==== SUMMARY ====");
    eprintln!("verified live:  {}", verified.join(", "));
    if !no_verified.is_empty() {
        eprintln!("NOT verified:   {}", no_verified.join(", "));
    }
    if !no_sample.is_empty() {
        eprintln!("no samples:     {}", no_sample.join(", "));
    }
}
