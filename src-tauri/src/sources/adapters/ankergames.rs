use crate::sources::schema::{SourceGame, DownloadOption};
use crate::sources::{Capabilities, QueryParams, ResolveResult};
pub fn capabilities() -> Capabilities { Capabilities::default() }
pub async fn query(_params: &QueryParams) -> Vec<SourceGame> { Vec::new() }
pub async fn search(_q: &str, _limit: usize) -> Vec<SourceGame> { Vec::new() }
pub async fn get_detail(_slug: &str) -> Option<SourceGame> { None }
pub async fn list_tags() -> Vec<String> { Vec::new() }
pub async fn resolve_download(_option: &DownloadOption) -> ResolveResult { ResolveResult::default() }
