pub mod health;
pub mod judge;
pub mod qa;
pub mod stats;

use axum::Router;
use crate::state::AppState;
use std::sync::Arc;

pub fn api_routes() -> Router<Arc<AppState>> {
    Router::new()
        .nest("/qa", qa::routes())
        .nest("/judge", judge::routes())
        .nest("/stats", stats::routes())
}

pub fn health_routes() -> Router<Arc<AppState>> {
    Router::new()
        .merge(health::routes())
}
