use axum::{extract::State, routing::get, Json, Router};
use serde::Serialize;
use std::sync::Arc;

use crate::state::AppState;

/// Benchmark summary stats for the landing page and /api/stats endpoint.
///
/// Values are seeded from task YAML expected values. Will be wired to
/// real benchmark_log.jsonl data after dogfood runs.
#[derive(Serialize)]
pub struct BenchmarkStats {
    /// Average token savings percentage (with vs without attrition)
    pub token_savings_pct: f64,
    /// Average time savings percentage
    pub time_savings_pct: f64,
    /// Average workflow completion rate with attrition (percentage)
    pub completion_rate: f64,
    /// Percentage of tasks achieving first-pass success (>=87.5% completion, 0 corrections)
    pub first_pass_success_pct: f64,
    /// Number of benchmark tasks in the suite
    pub total_tasks: u32,
    /// Average corrections per session with attrition
    pub corrections_with: f64,
    /// Average corrections per session without attrition
    pub corrections_without: f64,
}

#[derive(Serialize)]
pub struct StatsResponse {
    pub generated_at: String,
    pub source: &'static str,
    pub stats: BenchmarkStats,
}

/// GET /api/stats — returns benchmark summary.
///
/// For now, returns hardcoded values computed from the 10 task YAML
/// expected token/time values. Will be wired to real benchmark_log.jsonl
/// once dogfood runs produce data.
async fn get_stats(State(state): State<Arc<AppState>>) -> Json<StatsResponse> {
    state.increment_requests();

    // Hardcoded from task YAML aggregate computation:
    //   avg token savings: sum of per-task (1 - with/without) / 10
    //   avg time savings:  sum of per-task (1 - time_with/time_without) / 10
    //   completion rate:   avg of per-task estimated completion with attrition
    //   first-pass:        tasks with completion >= 87.5% and 0 corrections
    let stats = BenchmarkStats {
        token_savings_pct: 33.9,
        time_savings_pct: 33.2,
        completion_rate: 91.2,
        first_pass_success_pct: 100.0,
        total_tasks: 10,
        corrections_with: 0.5,
        corrections_without: 2.4,
    };

    Json(StatsResponse {
        generated_at: chrono_now_utc(),
        source: "task_yaml_estimates",
        stats,
    })
}

/// Simple UTC timestamp without pulling in chrono crate.
fn chrono_now_utc() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();

    // Convert epoch seconds to ISO 8601 manually
    // (avoids adding chrono as a dependency)
    let days = secs / 86400;
    let time_secs = secs % 86400;
    let hours = time_secs / 3600;
    let minutes = (time_secs % 3600) / 60;
    let seconds = time_secs % 60;

    // Simple days-since-epoch to Y-M-D (good enough for timestamps)
    let mut y = 1970i64;
    let mut remaining_days = days as i64;

    loop {
        let days_in_year = if is_leap(y) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        y += 1;
    }

    let month_days = if is_leap(y) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut m = 1u32;
    for &md in &month_days {
        if remaining_days < md {
            break;
        }
        remaining_days -= md;
        m += 1;
    }
    let d = remaining_days + 1;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, m, d, hours, minutes, seconds
    )
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/", get(get_stats))
}
