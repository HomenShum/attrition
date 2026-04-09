//! Benchmark results REST endpoint — reads from disk.
//!
//! GET /api/benchmark/results — aggregate benchmark results from JSON files

use axum::{
    extract::State,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::state::AppState;

// ── Types matching the benchmark JSON on disk ─────────────────────────────

#[derive(Deserialize)]
struct BenchmarkSuiteFile {
    #[allow(dead_code)]
    suite_id: Option<String>,
    #[allow(dead_code)]
    timestamp: Option<String>,
    #[allow(dead_code)]
    task_count: Option<u32>,
    results: Vec<BenchmarkTaskResult>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct BenchmarkTaskResult {
    pub task_name: String,
    pub category: String,
    pub complexity: String,
    pub with_attrition: bool,
    pub total_tokens: u64,
    pub time_minutes: f64,
    pub corrections: u32,
    pub completion_score: f64,
    pub estimated_cost_usd: f64,
    pub model: String,
    #[serde(default)]
    pub simulated: bool,
}

// ── Response types ────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct BenchmarkResponse {
    pub tasks: Vec<BenchmarkTaskResult>,
    pub summary: BenchmarkSummary,
    pub source: String,
}

#[derive(Serialize)]
pub struct BenchmarkSummary {
    pub total_tasks: usize,
    pub token_savings_pct: f64,
    pub time_savings_pct: f64,
    pub completion_with: f64,
    pub completion_without: f64,
    pub first_pass_success_pct: f64,
    pub avg_corrections_with: f64,
    pub avg_corrections_without: f64,
}

// ── Handler ───────────────────────────────────────────────────────────────

/// GET /api/benchmark/results — read and aggregate benchmark results from disk
async fn get_results(
    State(state): State<Arc<AppState>>,
) -> Json<BenchmarkResponse> {
    state.increment_requests();

    // Locate the benchmarks/results directory relative to the project root.
    // The server is typically started from the project root.
    let results_dir = std::path::Path::new("benchmarks/results");
    let mut all_results: Vec<BenchmarkTaskResult> = Vec::new();

    if results_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(results_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    if let Ok(data) = std::fs::read_to_string(&path) {
                        // Try parsing as a suite file first (has .results array)
                        if let Ok(suite) = serde_json::from_str::<BenchmarkSuiteFile>(&data) {
                            all_results.extend(suite.results);
                        }
                        // Also try parsing as a single result
                        else if let Ok(single) =
                            serde_json::from_str::<BenchmarkTaskResult>(&data)
                        {
                            all_results.push(single);
                        }
                        // Skip files that don't match either format
                    }
                }
            }
        }
    }

    let summary = compute_summary(&all_results);
    let source = if all_results.is_empty() {
        "no_data".to_string()
    } else if all_results.iter().all(|r| r.simulated) {
        "simulated".to_string()
    } else {
        "benchmark_results".to_string()
    };

    Json(BenchmarkResponse {
        tasks: all_results,
        summary,
        source,
    })
}

fn compute_summary(results: &[BenchmarkTaskResult]) -> BenchmarkSummary {
    if results.is_empty() {
        return BenchmarkSummary {
            total_tasks: 0,
            token_savings_pct: 0.0,
            time_savings_pct: 0.0,
            completion_with: 0.0,
            completion_without: 0.0,
            first_pass_success_pct: 0.0,
            avg_corrections_with: 0.0,
            avg_corrections_without: 0.0,
        };
    }

    // Group by task_name to pair with/without
    let mut task_names: Vec<String> = results.iter().map(|r| r.task_name.clone()).collect();
    task_names.sort();
    task_names.dedup();

    let mut token_savings: Vec<f64> = Vec::new();
    let mut time_savings: Vec<f64> = Vec::new();
    let mut completions_with: Vec<f64> = Vec::new();
    let mut completions_without: Vec<f64> = Vec::new();
    let mut corrections_with: Vec<f64> = Vec::new();
    let mut corrections_without: Vec<f64> = Vec::new();

    for name in &task_names {
        let without: Vec<&BenchmarkTaskResult> = results
            .iter()
            .filter(|r| &r.task_name == name && !r.with_attrition)
            .collect();
        let with: Vec<&BenchmarkTaskResult> = results
            .iter()
            .filter(|r| &r.task_name == name && r.with_attrition)
            .collect();

        if let (Some(wo), Some(wi)) = (without.first(), with.first()) {
            if wo.total_tokens > 0 {
                token_savings.push((1.0 - wi.total_tokens as f64 / wo.total_tokens as f64) * 100.0);
            }
            if wo.time_minutes > 0.0 {
                time_savings.push((1.0 - wi.time_minutes / wo.time_minutes) * 100.0);
            }
            completions_with.push(wi.completion_score);
            completions_without.push(wo.completion_score);
            corrections_with.push(wi.corrections as f64);
            corrections_without.push(wo.corrections as f64);
        }
    }

    let avg = |v: &[f64]| -> f64 {
        if v.is_empty() { 0.0 } else { v.iter().sum::<f64>() / v.len() as f64 }
    };

    let first_pass = completions_with
        .iter()
        .filter(|&&c| c >= 0.875)
        .count() as f64;
    let total_paired = completions_with.len().max(1) as f64;

    BenchmarkSummary {
        total_tasks: task_names.len(),
        token_savings_pct: (avg(&token_savings) * 10.0).round() / 10.0,
        time_savings_pct: (avg(&time_savings) * 10.0).round() / 10.0,
        completion_with: (avg(&completions_with) * 1000.0).round() / 10.0,
        completion_without: (avg(&completions_without) * 1000.0).round() / 10.0,
        first_pass_success_pct: (first_pass / total_paired * 100.0).round(),
        avg_corrections_with: (avg(&corrections_with) * 10.0).round() / 10.0,
        avg_corrections_without: (avg(&corrections_without) * 10.0).round() / 10.0,
    }
}

// ── Route registration ────────────────────────────────────────────────────

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/results", get(get_results))
}
