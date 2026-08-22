//! End-to-end probe binary for GUI-environment testing; see src/lib.rs
//! `probes`. Requires the dev-probes feature.

#[cfg(feature = "dev-probes")]
mod imp {
    //! End-to-end probe binary for GUI-environment testing.
    //!
    //! Usage: `cargo run --example dev-probe --features dev-probes -- <cmd> [arg]`
    //!
    //! Commands:
    //!   boot              - report sidecar/CA/resource resolution
    //!   settings          - settings persistence sweep
    //!   download <url>    - full DownloadEngine + aria2 E2E with a small file
    //!   resolve <url>     - native host resolution (no solver)
    //!   solve <url>       - webview solver against a gated page
    //!   e2e <host>        - find a fresh catalog sample of <host>, resolve it,
    //!                       escalate to the solver when gated, range-check the
    //!                       direct link

    use union_manifold_lib::probes;

    async fn run_probe(
        app: &tauri::AppHandle,
        cmd: &str,
        arg: &str,
        args: &[String],
    ) -> serde_json::Value {
        match cmd {
            "boot" => probes::boot_report(app),
            "settings" => probes::settings_sweep(
                std::env::temp_dir().join("union-manifold-probe-settings-sweep.json"),
            ),
            "download" => {
                let url = if arg.is_empty() {
                    "https://raw.githubusercontent.com/git/git/v2.44.0/README.md"
                } else {
                    arg
                };
                let name = format!(
                    "probe-{}.bin",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs()
                );
                probes::download_e2e(app, url, &name, None).await
            }
            "resolve" => probes::resolve_host(arg).await,
            "mods" => probes::mods_e2e(app).await,
            "workshop" => probes::workshop_e2e().await,
            "pagecheck" => {
                let cookie = args.get(3).cloned().unwrap_or_default();
                let ua = args.get(4).cloned().unwrap_or_default();
                probes::page_check(arg, &cookie, &ua).await
            }
            "solve" => probes::solve_report(app, arg).await,
            "e2e" => {
                let host = if arg.is_empty() { "datanodes" } else { arg };
                let Some(page_url) = probes::find_sample(host).await else {
                    return serde_json::json!({ "ok": false, "stage": "sample", "error": format!("no live {host} mirror surfaced") });
                };
                let native = probes::resolve_host(&page_url).await;
                let final_result = if native["resolvable"].as_bool() == Some(true) {
                    serde_json::json!({ "mode": "native", "result": native })
                } else {
                    // Production path: native failure escalates to the webview
                    // solver (hidden unless interactive), then Slipgate.
                    let via = probes::resolve_via(app, &page_url).await;
                    serde_json::json!({ "mode": "via", "nativeReason": native["reason"], "result": via })
                };
                let result = &final_result["result"];
                if result["resolvable"].as_bool() != Some(true) {
                    let mut out = serde_json::Map::new();
                    out.insert("ok".into(), serde_json::Value::Bool(false));
                    out.insert("page".into(), serde_json::json!(page_url));
                    if let serde_json::Value::Object(obj) = final_result {
                        out.extend(obj.clone());
                    }
                    return serde_json::Value::Object(out);
                }
                let direct = result["url"].as_str().expect("direct url");
                let headers: std::collections::HashMap<String, String> = result["headers"]
                    .as_object()
                    .map(|m| {
                        m.iter()
                            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                            .collect()
                    })
                    .unwrap_or_default();
                let check = probes::range_check(direct, headers).await;
                let mut out = serde_json::Map::new();
                out.insert(
                    "ok".into(),
                    serde_json::Value::Bool(!check["html"].as_bool().unwrap_or(false)),
                );
                out.insert("page".into(), serde_json::json!(page_url));
                out.insert("direct".into(), serde_json::json!(direct));
                out.insert("check".into(), check);
                if let serde_json::Value::Object(obj) = final_result {
                    for k in ["mode", "nativeReason", "result"] {
                        if let Some(v) = obj.get(k) {
                            out.insert(k.into(), v.clone());
                        }
                    }
                }
                serde_json::Value::Object(out)
            }
            other => {
                serde_json::json!({ "ok": false, "error": format!("unknown command {other}") })
            }
        }
    }

    pub fn main() {
        let args: Vec<String> = std::env::args().collect();
        let cmd = args
            .get(1)
            .map(String::as_str)
            .unwrap_or("boot")
            .to_string();
        let arg = args.get(2).cloned().unwrap_or_default();
        let extra_args = args.clone();

        tauri::Builder::default()
            .setup(move |app| {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let result = run_probe(&handle, &cmd, &arg, &extra_args).await;
                    println!(
                        "PROBE_RESULT={}",
                        serde_json::to_string_pretty(&result).unwrap_or_default()
                    );
                    handle.exit(0);
                });
                Ok(())
            })
            .build(tauri::generate_context!())
            .expect("probe app build")
            .run(|_, _| {});
    }
}

#[cfg(not(feature = "dev-probes"))]
mod imp {
    pub fn main() {
        eprintln!(
            "dev-probe requires the dev-probes feature: cargo run --example dev-probe --features dev-probes"
        );
    }
}

fn main() {
    imp::main()
}
