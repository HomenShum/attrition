use anyhow::Result;
use clap::{Parser, Subcommand};
use std::path::PathBuf;

const BANNER: &str = r#"
    ____                  _     ____
   | __ )  ___ _ __   ___| |__ |  _ \ _ __ ___  ___ ___
   |  _ \ / _ \ '_ \ / __| '_ \| |_) | '__/ _ \/ __/ __|
   | |_) |  __/ | | | (__| | | |  __/| | |  __/\__ \__ \
   |____/ \___|_| |_|\___|_| |_|_|   |_|  \___||___/___/
   benchpress — workflow memory + distillation engine
"#;

#[derive(Parser)]
#[command(name = "bp")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "Workflow memory + distillation engine")]
#[command(long_about = "benchpress: Capture frontier model workflows, distill for cheaper replay.\nRust rewrite with MCP protocol support.")]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Enable JSON output
    #[arg(long)]
    json: bool,

    /// Verbose logging
    #[arg(short, long)]
    verbose: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the benchpress server (API + MCP)
    Serve {
        /// Host to bind to
        #[arg(long, default_value = "0.0.0.0")]
        host: String,

        /// API server port
        #[arg(long, default_value_t = 8100)]
        port: u16,

        /// Also start the MCP server
        #[arg(long, default_value_t = true)]
        mcp: bool,

        /// MCP server port
        #[arg(long, default_value_t = 8101)]
        mcp_port: u16,
    },

    /// Run a QA check on a URL
    Check {
        /// URL to check
        url: String,

        /// Timeout in milliseconds
        #[arg(long, default_value_t = 30000)]
        timeout: u64,
    },

    /// Generate a sitemap for a URL
    Sitemap {
        /// Root URL to crawl
        url: String,

        /// Maximum crawl depth
        #[arg(long, default_value_t = 3)]
        depth: u8,

        /// Maximum pages to crawl
        #[arg(long, default_value_t = 50)]
        max_pages: usize,
    },

    /// Run a UX audit on a URL
    Audit {
        /// URL to audit
        url: String,
    },

    /// Run a diff crawl comparing current state to baseline
    Diff {
        /// URL to diff crawl
        url: String,

        /// Baseline crawl ID to compare against
        #[arg(long)]
        baseline: Option<String>,
    },

    /// Run the full QA pipeline
    Pipeline {
        /// URL to run the pipeline on
        url: String,
    },

    /// Show server health status
    Health {
        /// Server URL to check
        #[arg(default_value = "http://localhost:8100")]
        url: String,
    },

    /// Show version and system info
    Info,

    // ── Workflow capture & distillation commands ───────────────────────

    /// Capture a Claude Code session into a replayable workflow
    Capture {
        /// Path to Claude Code JSONL session file
        path: PathBuf,

        /// Workflow name (default: derived from filename)
        #[arg(long)]
        name: Option<String>,

        /// Source model that produced the session
        #[arg(long, default_value = "claude-opus-4-6")]
        model: String,
    },

    /// List all captured workflows
    Workflows,

    /// Distill a workflow for cheaper replay on a target model
    Distill {
        /// Workflow ID (short prefix or full UUID)
        workflow_id: String,

        /// Target model for distillation
        #[arg(long)]
        target: String,
    },

    /// Start a judge session for workflow replay verification
    Judge {
        /// Workflow ID to judge against
        workflow_id: String,

        /// Model being evaluated during replay
        #[arg(long, default_value = "claude-sonnet-4-20250514")]
        replay_model: String,
    },
}

/// Resolve the workflow database path (~/.benchpress/workflows.db).
fn workflow_db_path() -> Result<PathBuf> {
    let base = if let Some(proj_dirs) = directories::ProjectDirs::from("", "", "benchpress") {
        proj_dirs.data_dir().to_path_buf()
    } else {
        // Fallback to home directory
        dirs_fallback()
    };
    std::fs::create_dir_all(&base)?;
    Ok(base.join("workflows.db"))
}

/// Fallback: ~/.benchpress/
fn dirs_fallback() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".benchpress")
}

/// Resolve a workflow ID from a short prefix or full UUID.
fn resolve_workflow_id(
    store: &benchpress_workflow::storage::WorkflowStore,
    input: &str,
) -> Result<uuid::Uuid> {
    // Try parsing as a full UUID first
    if let Ok(id) = uuid::Uuid::parse_str(input) {
        return Ok(id);
    }

    // Otherwise treat as a prefix — search through all workflows
    let all = store.list_workflows()?;
    let matches: Vec<_> = all
        .iter()
        .filter(|w| w.id.to_string().starts_with(input))
        .collect();

    match matches.len() {
        0 => anyhow::bail!("No workflow found matching '{}'", input),
        1 => Ok(matches[0].id),
        n => anyhow::bail!(
            "Ambiguous prefix '{}' matches {} workflows. Use a longer prefix.",
            input,
            n
        ),
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Init telemetry — verbose flag controls filter level without unsafe set_var
    benchpress_telemetry::init_with_level(if cli.verbose { "debug" } else { "info" });

    match cli.command {
        Commands::Serve { host, port, mcp, mcp_port } => {
            println!("{}", BANNER);
            println!("  API server: http://{}:{}", host, port);
            if mcp {
                println!("  MCP server: http://{}:{}/mcp", host, mcp_port);
            }
            println!();

            let config = benchpress_core::AppConfig {
                server: benchpress_core::config::ServerConfig {
                    host: host.clone(),
                    port,
                    ..Default::default()
                },
                mcp: benchpress_core::config::McpConfig {
                    enabled: mcp,
                    port: mcp_port,
                    auth_token: None,
                },
                ..Default::default()
            };

            let app = benchpress_api::build_router(&config);

            // Mount MCP server on separate port if enabled
            if mcp {
                let mcp_router = benchpress_mcp::build_mcp_router();
                let mcp_listener = tokio::net::TcpListener::bind(format!("{}:{}", host, mcp_port)).await?;
                tracing::info!("MCP server listening on {}:{}", host, mcp_port);
                tokio::spawn(async move {
                    if let Err(e) = axum::serve(mcp_listener, mcp_router).await {
                        tracing::error!("MCP server error: {}", e);
                    }
                });
            }

            let listener = tokio::net::TcpListener::bind(format!("{}:{}", host, port)).await?;
            tracing::info!("benchpress API server listening on {}:{}", host, port);
            axum::serve(listener, app).await?;
        }

        Commands::Check { url, timeout } => {
            let result = benchpress_engine::qa::run_qa_check(&url, timeout).await?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                println!("QA Check: {}", url);
                println!("  Score: {}/100", result.score.overall);
                println!("  Issues: {}", result.issues.len());
                println!("  Duration: {}ms", result.duration_ms);
                for issue in &result.issues {
                    println!("  [{:?}] {}: {}", issue.severity, issue.title, issue.description);
                }
            }
        }

        Commands::Sitemap { url, depth, max_pages } => {
            let result = benchpress_engine::crawl::crawl_sitemap(&url, depth, max_pages).await?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                println!("Sitemap: {}", url);
                println!("  Pages found: {}", result.total_pages);
                println!("  Duration: {}ms", result.crawl_duration_ms);
                for page in &result.pages {
                    println!("  [{}] {} — {:?}", page.status, page.url, page.title.as_deref().unwrap_or("(no title)"));
                }
            }
        }

        Commands::Audit { url } => {
            let result = benchpress_engine::audit::run_ux_audit(&url).await?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                println!("UX Audit: {}", url);
                println!("  Score: {}/100", result.score);
                println!("  Passed: {}/{}", result.rules_passed, result.rules_checked);
                println!("  Duration: {}ms", result.duration_ms);
                for finding in &result.findings {
                    let status = if finding.passed { "PASS" } else { "FAIL" };
                    println!("  [{}] {}: {}", status, finding.rule_name, finding.detail);
                    if let Some(rec) = &finding.recommendation {
                        println!("         Recommendation: {}", rec);
                    }
                }
            }
        }

        Commands::Diff { url, baseline } => {
            let result = benchpress_engine::diff::run_diff_crawl(&url, baseline.as_deref()).await?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                println!("Diff Crawl: {}", url);
                println!("  {}", result.summary);
                for diff in &result.diffs {
                    println!("  [{:?}] {}: {}", diff.diff_type, diff.url, diff.detail);
                }
            }
        }

        Commands::Pipeline { url } => {
            let result = benchpress_agents::pipeline::run_pipeline(&url).await?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                println!("Pipeline: {}", url);
                println!("  Status: {:?}", result.status);
                for stage in &result.stages {
                    println!("  [{:?}] {:?} — {}ms", stage.status, stage.stage, stage.duration_ms);
                }
            }
        }

        Commands::Health { url } => {
            let client = benchpress_sdk::BpClient::new(&url);
            match client.health().await {
                Ok(health) => {
                    println!("Server: {} (v{})", health.status, health.version);
                    println!("Uptime: {}s", health.uptime_secs);
                }
                Err(e) => {
                    eprintln!("Failed to reach server at {}: {}", url, e);
                    std::process::exit(1);
                }
            }
        }

        Commands::Info => {
            println!("{}", BANNER);
            println!("  Version: {}", env!("CARGO_PKG_VERSION"));
            println!("  Platform: {} / {}", std::env::consts::OS, std::env::consts::ARCH);
            println!("  Config dir: {}", benchpress_core::AppConfig::config_dir().display());
            println!("  Data dir: {}", benchpress_core::AppConfig::data_dir().display());
        }

        // ── Workflow capture ──────────────────────────────────────────

        Commands::Capture { path, name, model } => {
            use benchpress_workflow::adapters::claude_code::ClaudeCodeAdapter;
            use benchpress_workflow::adapters::WorkflowAdapter;
            use benchpress_workflow::storage::WorkflowStore;
            use benchpress_workflow::{Workflow, WorkflowMetadata, TokenCost};

            let raw = std::fs::read(&path)?;
            let events = ClaudeCodeAdapter::parse(&raw)?;

            let workflow_name = name.unwrap_or_else(|| {
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unnamed")
                    .to_string()
            });

            let workflow = Workflow::new(
                workflow_name.clone(),
                model.clone(),
                events.clone(),
                WorkflowMetadata {
                    adapter: ClaudeCodeAdapter::source_name().to_string(),
                    session_id: None,
                    project_path: path.parent().and_then(|p| p.to_str()).map(String::from),
                    total_tokens: TokenCost::default(),
                    duration_ms: 0,
                    task_description: format!("Captured from {}", path.display()),
                },
            );

            let db_path = workflow_db_path()?;
            let store = WorkflowStore::new(&db_path)?;
            store.save_workflow(&workflow)?;

            if cli.json {
                println!("{}", serde_json::to_string_pretty(&serde_json::json!({
                    "id": workflow.id.to_string(),
                    "name": workflow_name,
                    "model": model,
                    "event_count": events.len(),
                    "fingerprint": workflow.fingerprint,
                    "db_path": db_path.display().to_string(),
                }))?);
            } else {
                println!(
                    "Captured workflow: {} ({} events, {})",
                    workflow_name,
                    events.len(),
                    model,
                );
                println!("  ID: {}", workflow.id);
                println!("  Fingerprint: {}...{}", &workflow.fingerprint[..8], &workflow.fingerprint[workflow.fingerprint.len()-8..]);
                println!("  Stored: {}", db_path.display());
            }
        }

        // ── List workflows ────────────────────────────────────────────

        Commands::Workflows => {
            use benchpress_workflow::storage::WorkflowStore;

            let db_path = workflow_db_path()?;
            let store = WorkflowStore::new(&db_path)?;
            let workflows = store.list_workflows()?;

            if cli.json {
                println!("{}", serde_json::to_string_pretty(&workflows)?);
            } else if workflows.is_empty() {
                println!("No workflows captured yet.");
                println!("  Use: bp capture <path-to-session.jsonl>");
            } else {
                println!("{:<10} {:<30} {:<25} {:>6} {}", "ID", "Name", "Model", "Events", "Date");
                println!("{}", "-".repeat(90));
                for wf in &workflows {
                    let short_id = &wf.id.to_string()[..8];
                    let date = wf.captured_at.format("%Y-%m-%d %H:%M");
                    println!(
                        "{:<10} {:<30} {:<25} {:>6} {}",
                        short_id,
                        truncate_str(&wf.name, 28),
                        truncate_str(&wf.source_model, 23),
                        wf.event_count,
                        date,
                    );
                }
                println!("\n{} workflow(s) total", workflows.len());
            }
        }

        // ── Distill ───────────────────────────────────────────────────

        Commands::Distill { workflow_id, target } => {
            use benchpress_workflow::storage::WorkflowStore;

            let db_path = workflow_db_path()?;
            let store = WorkflowStore::new(&db_path)?;
            let id = resolve_workflow_id(&store, &workflow_id)?;
            let workflow = store
                .get_workflow(id)?
                .ok_or_else(|| anyhow::anyhow!("Workflow {} not found", id))?;

            let distilled = benchpress_distiller::distill(&workflow, &target);

            if cli.json {
                println!("{}", serde_json::to_string_pretty(&distilled)?);
            } else {
                println!("Distilled: {} -> {}", workflow.source_model, target);
                println!("  Original events:  {}", workflow.events.len());
                println!("  Distilled events: {}", distilled.events.len());
                println!("  Compression:      {:.1}%", distilled.compression_ratio * 100.0);
                println!("  Copy blocks:      {}", distilled.copy_blocks.len());
                println!("  Checkpoints:      {}", distilled.checkpoints.len());
                println!("  Est. tokens:      {} (was {})",
                    distilled.estimated_cost.total_tokens,
                    workflow.metadata.total_tokens.total_tokens,
                );
                println!("  Est. cost:        ${:.4} (was ${:.4})",
                    distilled.estimated_cost.estimated_cost_usd,
                    workflow.metadata.total_tokens.estimated_cost_usd,
                );
                println!("  Distilled ID:     {}", distilled.id);
            }
        }

        // ── Judge ─────────────────────────────────────────────────────

        Commands::Judge { workflow_id, replay_model } => {
            use benchpress_judge::engine::JudgeEngine;
            use benchpress_workflow::storage::WorkflowStore;

            let db_path = workflow_db_path()?;
            let store = WorkflowStore::new(&db_path)?;
            let id = resolve_workflow_id(&store, &workflow_id)?;
            let workflow = store
                .get_workflow(id)?
                .ok_or_else(|| anyhow::anyhow!("Workflow {} not found", id))?;

            let mut engine = JudgeEngine::new();
            let session_id = engine.start_session(
                workflow.id,
                workflow.events.clone(),
                &replay_model,
            );

            if cli.json {
                println!("{}", serde_json::to_string_pretty(&serde_json::json!({
                    "session_id": session_id.to_string(),
                    "workflow_id": workflow.id.to_string(),
                    "workflow_name": workflow.name,
                    "replay_model": replay_model,
                    "expected_events": workflow.events.len(),
                    "status": "active",
                }))?);
            } else {
                println!("Judge session started");
                println!("  Session ID: {}", session_id);
                println!("  Workflow:   {} ({})", workflow.name, &workflow.id.to_string()[..8]);
                println!("  Model:      {} -> {}", workflow.source_model, replay_model);
                println!("  Events:     {} expected", workflow.events.len());
                println!("  Status:     active");
                println!();
                println!("Use MCP tools bp.judge.event and bp.judge.verdict to");
                println!("report replay events and finalize the judgment.");
            }
        }
    }

    Ok(())
}

/// Truncate a string with ellipsis if it exceeds max length.
fn truncate_str(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max.saturating_sub(3)])
    }
}
