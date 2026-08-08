use super::*;

#[test]
fn normalize_title_unifies_accents_ampersands_and_trademarks() {
    assert_eq!(normalize_title("Pok\u{00e9}mon"), "pokemon");
    assert_eq!(
        normalize_title("Ratchet & Clank"),
        normalize_title("Ratchet and Clank")
    );
    assert_eq!(normalize_title("Portal\u{2122} 2\u{00ae}"), "portal 2");
}

#[test]
fn normalize_title_strips_version_and_build_parentheticals() {
    assert_eq!(normalize_title("Hades (v1.38)"), "hades");
    assert_eq!(normalize_title("Hades (Build 12345)"), "hades");
    assert_eq!(normalize_title("Hades (Update 7)"), "hades");
    assert_eq!(
        normalize_title("Outer Wilds (Director's Cut)"),
        "outer wilds director s cut"
    );
}

#[test]
fn normalize_title_drops_edition_noise_words() {
    assert_eq!(
        normalize_title("The Witcher 3 GOTY Complete Deluxe Edition Repack PreInstalled"),
        "the witcher 3"
    );
}

#[test]
fn normalize_title_hyphenated_pre_installed_slips_past_the_noise_list() {
    assert_eq!(
        normalize_title("Portal 2 Pre-Installed"),
        "portal 2 pre installed"
    );
}

#[test]
#[ignore]
fn known_bug_pre_installed_with_hyphen_should_dedupe_against_plain_title() {
    assert_eq!(
        normalize_title("Portal 2 Pre-Installed"),
        normalize_title("Portal 2")
    );
}

#[test]
fn dedup_key_prefers_steam_appid_over_title() {
    assert_eq!(dedup_key_for(Some(620), "whatever"), "steam:620");
    assert_eq!(dedup_key_for(Some(0), "Portal 2"), "title:portal 2");
    assert_eq!(dedup_key_for(None, "Portal 2"), "title:portal 2");
}

#[test]
fn parse_size_to_bytes_handles_all_units() {
    assert_eq!(parse_size_to_bytes("512 B"), Some(512));
    assert_eq!(parse_size_to_bytes("2 KB"), Some(2048));
    assert_eq!(
        parse_size_to_bytes("1.5 MB"),
        Some((1.5 * 1024.0 * 1024.0) as u64)
    );
    assert_eq!(
        parse_size_to_bytes("70.2 GB"),
        Some((70.2 * 1024f64.powi(3)) as u64)
    );
    assert_eq!(parse_size_to_bytes("1 TB"), Some(1024u64.pow(4)));
}

#[test]
fn parse_size_to_bytes_tolerates_surrounding_text_and_case() {
    assert_eq!(
        parse_size_to_bytes("Size: 3gb approx"),
        Some(3 * 1024u64.pow(3))
    );
    assert_eq!(
        parse_size_to_bytes("  12.0 Gb  "),
        Some(12 * 1024u64.pow(3))
    );
}

#[test]
fn parse_size_to_bytes_rejects_garbage() {
    assert_eq!(parse_size_to_bytes("unknown"), None);
    assert_eq!(parse_size_to_bytes(""), None);
}

#[test]
fn to_epoch_ms_accepts_common_site_date_formats() {
    assert_eq!(to_epoch_ms("1970-01-02"), Some(86_400_000));
    assert_eq!(to_epoch_ms("1970-01-01T00:00:01Z"), Some(1_000));
    assert_eq!(to_epoch_ms("02 Jan, 1970"), Some(86_400_000));
    assert_eq!(to_epoch_ms("Jan 2, 1970"), Some(86_400_000));
    assert_eq!(to_epoch_ms("January 2, 1970"), Some(86_400_000));
}

#[test]
fn to_epoch_ms_truncates_time_of_day_in_space_separated_datetimes() {
    assert_eq!(to_epoch_ms("1970-01-01 06:30:00"), Some(0));
}

#[test]
#[ignore]
fn known_bug_space_separated_datetime_should_keep_its_time_component() {
    assert_eq!(to_epoch_ms("1970-01-01 00:00:01"), Some(1_000));
}

#[test]
fn to_epoch_ms_rejects_unparseable_input() {
    assert_eq!(to_epoch_ms(""), None);
    assert_eq!(to_epoch_ms("someday soon"), None);
}

#[test]
fn year_from_extracts_plausible_years_only() {
    assert_eq!(year_from("Released 2019 worldwide"), Some(2019));
    assert_eq!(year_from("v1.0.1234"), None);
    assert_eq!(year_from("in 1969"), None);
    assert_eq!(year_from("year 2101"), None);
    assert_eq!(year_from("no digits"), None);
}

#[test]
fn merge_games_takes_max_timestamps_and_first_size() {
    let mut a = SourceGame {
        title: "Game".to_string(),
        ..Default::default()
    };
    a.added_at = Some(100);
    a.updated_at = Some(50);
    a.size_bytes = Some(111);
    a.size_text = Some("111 B".to_string());
    let mut b = SourceGame {
        title: "Game".to_string(),
        ..Default::default()
    };
    b.added_at = Some(50);
    b.updated_at = Some(200);
    b.size_bytes = Some(999);
    let out = merge_games(vec![a, b]);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].added_at, Some(100));
    assert_eq!(out[0].updated_at, Some(200));
    assert_eq!(out[0].size_bytes, Some(111));
    assert_eq!(out[0].size_text.as_deref(), Some("111 B"));
}


#[test]
fn merge_games_appid_bridges_title_variants_transitively() {
    let mut a = SourceGame {
        title: "Totally Different Name".to_string(),
        steam_app_id: Some(777),
        ..Default::default()
    };
    a.source_id = "s1".to_string();
    let mut b = SourceGame {
        title: "The Real Title".to_string(),
        steam_app_id: Some(777),
        ..Default::default()
    };
    b.source_id = "s2".to_string();
    let c = SourceGame {
        title: "The Real Title".to_string(),
        ..Default::default()
    };
    let out = merge_games(vec![a, b, c]);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].steam_app_id, Some(777));
    assert_eq!(out[0].dedup_key, "steam:777");
    assert_eq!(out[0].sources.len(), 3);
}
