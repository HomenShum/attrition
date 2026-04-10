pub mod benchmark_api;
pub mod health;
pub mod judge;
pub mod judge_api;
pub mod live;
pub mod qa;
pub mod retention;
pub mod stats;
pub mod workflows;

use axum::Router;
use crate::state::AppState;
use std::sync::Arc;

pub fn api_routes() -> Router<Arc<AppState>> {
    // Judge routes: merge hooks (on-prompt, on-tool-use, on-stop, on-session-start)
    // and session query endpoints (sessions/, sessions/:id) under /judge
    let judge_routes = Router::new()
        .merge(judge::routes())
        .nest("/sessions", judge_api::routes());

    Router::new()
        .nest("/qa", qa::routes())
        .nest("/judge", judge_routes)
        .nest("/stats", stats::routes())
        .nest("/workflows", workflows::routes())
        .nest("/benchmark", benchmark_api::routes())
        .nest("/live", live::routes())
        .nest("/retention", retention::routes())
}

pub fn health_routes() -> Router<Arc<AppState>> {
    Router::new()
        .merge(health::routes())
}
