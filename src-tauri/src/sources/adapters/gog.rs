use std::sync::LazyLock;

use super::hydralinks::HydraSource;
use crate::sources::schema::SourceGame;
use crate::sources::{Capabilities, QueryParams};

static SRC: LazyLock<HydraSource> = LazyLock::new(|| {
    HydraSource::new(
        "gog",
        "https://gog-games.to",
        "https://hydralinks.cloud/sources/gog.json",
    )
});

pub fn capabilities() -> Capabilities {
    super::hydralinks::capabilities()
}

pub async fn query(_params: &QueryParams) -> Option<Vec<SourceGame>> {
    SRC.query().await
}

pub async fn search(q: &str, limit: usize) -> Vec<SourceGame> {
    SRC.search(q, limit).await
}

pub async fn get_detail(slug: &str) -> Option<SourceGame> {
    SRC.get_detail(slug).await
}

pub async fn refresh() -> Option<usize> {
    SRC.refresh().await
}

pub async fn prime() -> bool {
    SRC.prime_direct().await
}
