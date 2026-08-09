use super::*;

fn game(source: &str, title: &str) -> SourceGame {
    SourceGame {
        source_id: source.to_string(),
        title: title.to_string(),
        ..Default::default()
    }
}

fn params() -> QueryParams {
    QueryParams::default()
}

#[test]
fn finalize_pool_merges_same_appid_across_sources_into_one_game() {
    let mut a = game("steamrip", "Portal 2");
    a.steam_app_id = Some(620);
    let mut b = game("gamebounty", "Portal 2 (Pre-Installed)");
    b.steam_app_id = Some(620);
    let (games, _, total) = finalize_pool(vec![a, b], &params());
    assert_eq!(total, 1);
    assert_eq!(games[0].sources.len(), 2);
    assert_eq!(games[0].steam_app_id, Some(620));
}

#[test]
fn finalize_pool_merges_normalized_titles_without_appids() {
    let a = game("steamrip", "Dark Souls: Remastered");
    let b = game("gamebounty", "Dark Souls");
    let (games, _, total) = finalize_pool(vec![a, b], &params());
    assert_eq!(total, 1);
    assert_eq!(games[0].sources.len(), 2);
}

#[test]
fn finalize_pool_keeps_conflicting_appids_separate_despite_same_title() {
    let mut a = game("steamrip", "Overcooked");
    a.steam_app_id = Some(100);
    let mut b = game("gamebounty", "Overcooked");
    b.steam_app_id = Some(200);
    let (_, _, total) = finalize_pool(vec![a, b], &params());
    assert_eq!(total, 2);
}

#[test]
fn finalize_pool_text_filter_is_case_insensitive_substring() {
    let pool = vec![
        game("s", "Elden Ring"),
        game("s", "Hades II"),
        game("s", "RING of Pain"),
    ];
    let p = QueryParams {
        text: Some("ring".to_string()),
        ..Default::default()
    };
    let (games, _, total) = finalize_pool(pool, &p);
    assert_eq!(total, 2);
    assert!(games
        .iter()
        .all(|g| g.title.to_lowercase().contains("ring")));
}

#[test]
fn finalize_pool_tag_or_mode_matches_any_tag() {
    let mut a = game("s", "A");
    a.genres = vec!["Action".to_string()];
    let mut b = game("s", "B");
    b.genres = vec!["Puzzle".to_string()];
    let mut c = game("s", "C");
    c.genres = vec!["Horror".to_string()];
    let p = QueryParams {
        tags: vec!["action".to_string(), "puzzle".to_string()],
        ..Default::default()
    };
    let (_, _, total) = finalize_pool(vec![a, b, c], &p);
    assert_eq!(total, 2);
}

#[test]
fn finalize_pool_tag_and_mode_requires_all_tags() {
    let mut a = game("s", "A");
    a.genres = vec!["Action".to_string(), "Puzzle".to_string()];
    let mut b = game("s", "B");
    b.genres = vec!["Action".to_string()];
    let p = QueryParams {
        tags: vec!["action".to_string(), "puzzle".to_string()],
        tag_mode: Some("and".to_string()),
        ..Default::default()
    };
    let (games, _, total) = finalize_pool(vec![a, b], &p);
    assert_eq!(total, 1);
    assert_eq!(games[0].title, "A");
}

#[test]
fn finalize_pool_year_filter_excludes_unknown_years() {
    let mut a = game("s", "Old");
    a.release_year = Some(2001);
    let mut b = game("s", "New");
    b.release_year = Some(2024);
    let c = game("s", "Unknown");
    let p = QueryParams {
        min_year: Some(2010),
        ..Default::default()
    };
    let (games, _, total) = finalize_pool(vec![a, b, c], &p);
    assert_eq!(total, 1);
    assert_eq!(games[0].title, "New");
}

#[test]
fn finalize_pool_size_filter_bounds_both_ends_and_excludes_unknown() {
    let gb = 1024u64 * 1024 * 1024;
    let mut small = game("s", "Small");
    small.size_bytes = Some(gb);
    let mut mid = game("s", "Mid");
    mid.size_bytes = Some(20 * gb);
    let mut huge = game("s", "Huge");
    huge.size_bytes = Some(90 * gb);
    let unknown = game("s", "Unknown");
    let p = QueryParams {
        min_size_bytes: Some(5 * gb),
        max_size_bytes: Some(50 * gb),
        ..Default::default()
    };
    let (games, _, total) = finalize_pool(vec![small, mid, huge, unknown], &p);
    assert_eq!(total, 1);
    assert_eq!(games[0].title, "Mid");
}

#[test]
fn finalize_pool_latest_sort_puts_newest_first_and_undated_last() {
    let mut a = game("s", "Older");
    a.added_at = Some(1_000);
    let mut b = game("s", "Newest");
    b.added_at = Some(9_000);
    let c = game("s", "Undated");
    let p = QueryParams {
        sort: Some("latest".to_string()),
        ..Default::default()
    };
    let (games, _, _) = finalize_pool(vec![a, b, c], &p);
    let titles: Vec<&str> = games.iter().map(|g| g.title.as_str()).collect();
    assert_eq!(titles, vec!["Newest", "Older", "Undated"]);
}


#[test]
fn finalize_pool_facets_count_tags() {
    let mut a = game("s", "A");
    a.genres = vec!["Action".to_string(), "Indie".to_string()];
    let mut b = game("s", "B");
    b.genres = vec!["Action".to_string()];
    let (_, facets, _) = finalize_pool(vec![a, b], &params());
    let action = facets.tags.iter().find(|t| t.tag == "Action").unwrap();
    assert_eq!(action.count, 2);
    assert_eq!(facets.tags[0].tag, "Action");
}

#[test]
fn finalize_pool_facets_reflect_filtered_set_not_raw_pool() {
    let mut a = game("s", "Kept");
    a.genres = vec!["Action".to_string()];
    let mut b = game("s", "Dropped");
    b.genres = vec!["Horror".to_string()];
    let p = QueryParams {
        text: Some("kept".to_string()),
        ..Default::default()
    };
    let (_, facets, _) = finalize_pool(vec![a, b], &p);
    assert!(facets.tags.iter().all(|t| t.tag != "Horror"));
}

#[test]
#[ignore = "measurement helper; run explicitly with --ignored --nocapture"]
fn benchmark_large_source_pool_finalize_and_page_json() {
    let pool = large_source_pool(false);

    let started = std::time::Instant::now();
    let (games, _, total) = finalize_pool(pool, &params());
    let finalize = started.elapsed();
    assert_eq!(total, 2_400);
    let started = std::time::Instant::now();
    let page: Vec<_> = games[..48]
        .iter()
        .map(UnifiedGame::browse_summary)
        .collect();
    let json = serde_json::to_vec(&page).unwrap();
    let serialize = started.elapsed();
    eprintln!(
        "source_2400 finalize_ms={} page48_bytes={} page48_serialize_ms={}",
        finalize.as_millis(),
        json.len(),
        serialize.as_micros() as f64 / 1_000.0,
    );
}

fn large_source_pool(overlap: bool) -> Vec<SourceGame> {
    let mut pool = Vec::with_capacity(2_400);
    for source in 0..8 {
        for item in 0..300 {
            let i = source * 300 + item;
            let title = if overlap && item < 75 {
                format!("Shared catalog game {item}")
            } else {
                format!("Synthetic game {i}")
            };
            let mut entry = game(&format!("source-{source}"), &title);
            entry.source_slug = format!("game-{i}");
            entry.source_url = format!("https://source.test/games/{i}");
            entry.description = Some("A representative source description. ".repeat(30));
            entry.image = Some(format!("https://cdn.test/{i}/library_600x900.jpg"));
            entry.download_options = (0..4)
                .map(|part| crate::sources::schema::DownloadOption {
                    label: format!("Part {part}"),
                    host_type: "pixeldrain".to_string(),
                    url: Some(format!(
                        "https://files.test/{i}/{part}?token={}",
                        "x".repeat(80)
                    )),
                    page_url: Some(format!("https://source.test/{i}/{part}")),
                    size_bytes: Some(1_234_567_890),
                    size_text: None,
                    resolvable: true,
                })
                .collect();
            pool.push(entry);
        }
    }
    pool
}

#[test]
#[ignore = "measurement helper; run explicitly with --ignored --nocapture"]
fn benchmark_progressive_source_finalization() {
    let mut p = params();
    p.balanced = true;
    let source_pool = large_source_pool(true);
    let batches: Vec<Vec<_>> = source_pool
        .chunks(300)
        .map(<[SourceGame]>::to_vec)
        .collect();
    let mut uncached = Vec::with_capacity(2_400);
    let uncached_started = std::time::Instant::now();
    for mut batch in batches.clone() {
        uncached.append(&mut batch);
        std::hint::black_box(finalize_pool(uncached.clone(), &p));
    }
    let uncached_progressive = uncached_started.elapsed();
    let mut accumulated = Vec::with_capacity(2_400);
    let started = std::time::Instant::now();
    for mut batch in batches {
        accumulated.append(&mut batch);
        std::hint::black_box(finalize_pool_cached(&mut accumulated, &p));
    }
    let progressive = started.elapsed();

    let pool = large_source_pool(true);
    let started = std::time::Instant::now();
    let (_, _, total) = finalize_pool(pool, &p);
    let single = started.elapsed();
    assert_eq!(total, 1_875);
    eprintln!(
        "source_progressive_8x300_ms={} uncached_reference_ms={} final_2400_ms={}",
        progressive.as_millis(),
        uncached_progressive.as_millis(),
        single.as_millis(),
    );
}

#[test]
fn finalize_pool_balanced_interleaves_sources_round_robin() {
    let pool = vec![
        game("alpha", "A1"),
        game("alpha", "A2"),
        game("alpha", "A3"),
        game("beta", "B1"),
        game("beta", "B2"),
    ];
    let p = QueryParams {
        balanced: true,
        ..Default::default()
    };
    let (games, _, total) = finalize_pool(pool, &p);
    assert_eq!(total, 5);
    let titles: Vec<&str> = games.iter().map(|g| g.title.as_str()).collect();
    assert_eq!(titles, vec!["A1", "B1", "A2", "B2", "A3"]);
}

#[test]
fn finalize_pool_merge_prefers_richer_metadata_and_unions_genres() {
    let mut a = game("s1", "Same Game");
    a.description = Some("short".to_string());
    a.genres = vec!["Action".to_string()];
    a.release_year = Some(2019);
    let mut b = game("s2", "Same Game");
    b.description = Some("a much longer description".to_string());
    b.genres = vec!["Indie".to_string()];
    b.release_year = Some(2020);
    let (games, _, _) = finalize_pool(vec![a, b], &params());
    assert_eq!(games.len(), 1);
    let g = &games[0];
    assert_eq!(g.description.as_deref(), Some("a much longer description"));
    assert!(g.genres.contains(&"Action".to_string()) && g.genres.contains(&"Indie".to_string()));
    assert_eq!(g.release_year, Some(2020));
}
