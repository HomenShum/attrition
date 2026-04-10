use anyhow::Result;
use clap::{Parser, Subcommand};
use std::path::PathBuf;

const BANNER: &str = r#"
        _   _        _ _   _
   __ _| |_| |_ _ __(_) |_(_) ___  _ __
  / _` | __| __| '__| | __| |/ _ \| '_ \
 | (_| | |_| |_| |  | | |_| | (_) | | | |
  \__,_|\__|\__|_|  |_|\__|_|\___/|_| |_|
  attrition — workflow memory + distillation engine
"#;

#[derive(Parser)]
#[command(name = "bp")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "Workflow memory + distillation engine")]
#[command(long_about = "attrition: Capture frontier model workflows, distill for cheaper replay.\nRust rewrite with MCP protocol support.")]
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
    /// Start the attrition server (API + MCP)
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
        /// Workflow ID to judge against (ignored when --on-stop is set)
        workflow_id: Option<String>,

        /// Model being evaluated during replay
        #[arg(long, default_value = "claude-sonnet-4-20250514")]
        replay_model: String,

        /// Run as a Claude Code Stop hook — read activity log, produce verdict, exit
        #[arg(long)]
        on_stop: bool,
    },

    /// Process a Claude Code PostToolUse hook event (reads JSON from stdin)
    Hook,

    /// Import an AGENTS.md file as an enforceable workflow
    ImportAgents {
        /// Path to AGENTS.md (default: ./AGENTS.md)
        #[arg(default_value = "AGENTS.md")]
        path: PathBuf,

        /// Workflow name (default: derived from filename)
        #[arg(long)]
        name: Option<String>,
    },

    /// Install attrition hooks into Claude Code settings.json
    Install,

    /// Show live attrition status: hooks, active workflow, recent activity
    Status,

    /// Show recent tool call activity from the log
    Activity {
        /// Number of recent entries to show
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
}

/// Resolve the workflow database path (~/.attrition/workflows.db).
fn workflow_db_path() -> Result<PathBuf> {
    let base = if let Some(proj_dirs) = directories::ProjectDirs::from("", "", "attrition") {
        proj_dirs.data_dir().to_path_buf()
    } else {
        // Fallback to home directory
        dirs_fallback()
    };
    std::fs::create_dir_all(&base)?;
    Ok(base.join("workflows.db"))
}

/// Fallback: ~/.attrition/
fn dirs_fallback() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".attrition")
}

/// Resolve a workflow ID from a short prefix or full UUID.
fn resolve_workflow_id(
    store: &attrition_workflow::storage::WorkflowStore,
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
    attrition_telemetry::init_with_level(if cli.verbose { "debug" } else { "info" });

    match cli.command {
        Commands::Serve { host, port, mcp, mcp_port } => {
            println!("{}", BANNER);
            println!("  API server: http://{}:{}", host, port);
            if mcp {
                println!("  MCP server: http://{}:{}/mcp", host, mcp_port);
            }
            println!();

            let config = attrition_core::AppConfig {
                server: attrition_core::config::ServerConfig {
                    host: host.clone(),
                    port,
                    ..Default::default()
                },
                mcp: attrition_core::config::McpConfig {
                    enabled: mcp,
                    port: mcp_port,
                    auth_token: None,
                },
                ..Default::default()
            };

            let app = attrition_api::build_router(&config);

            // Mount MCP server on separate port if enabled
            if mcp {
                let mcp_router = attrition_mcp::build_mcp_router();
                let mcp_listener = tokio::net::TcpListener::bind(format!("{}:{}", host, mcp_port)).await?;
                tracing::info!("MCP server listening on {}:{}", host, mcp_port);
                tokio::spawn(async move {
                    if let Err(e) = axum::serve(mcp_listener, mcp_router).await {
                        tracing::error!("MCP server error: {}", e);
                    }
                });
            }

            let listener = tokio::net::TcpListener::bind(format!("{}:{}", host, port)).await?;
            tracing::info!("attrition API server listening on {}:{}", host, port);
            axum::serve(listener, app).await?;
        }

        Commands::Check { url, timeout } => {
            let result = attrition_engine::qa::run_qa_check(&url, timeout).await?;
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
            let result = attrition_engine::crawl::crawl_sitemap(&url, depth, max_pages).await?;
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
            let result = attrition_engine::audit::run_ux_audit(&url).await?;
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
            let result = attrition_engine::diff::run_diff_crawl(&url, baseline.as_deref()).await?;
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
            let result = attrition_agents::pipeline::run_pipeline(&url).await?;
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
            let client = attrition_sdk::BpClient::new(&url);
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
            println!("  Config dir: {}", attrition_core::AppConfig::config_dir().display());
            println!("  Data dir: {}", attrition_core::AppConfig::data_dir().display());
        }

        // ── Workflow capture ──────────────────────────────────────────

        Commands::Capture { path, name, model } => {
            use attrition_workflow::adapters::claude_code::ClaudeCodeAdapter;
            use attrition_workflow::adapters::WorkflowAdapter;
            use attrition_workflow::storage::WorkflowStore;
            use attrition_workflow::{Workflow, WorkflowMetadata, TokenCost};

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
            use attrition_workflow::storage::WorkflowStore;

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
            use attrition_workflow::storage::WorkflowStore;

            let db_path = workflow_db_path()?;
            let store = WorkflowStore::new(&db_path)?;
            let id = resolve_workflow_id(&store, &workflow_id)?;
            let workflow = store
                .get_workflow(id)?
                .ok_or_else(|| anyhow::anyhow!("Workflow {} not found", id))?;

            let distilled = attrition_distiller::distill(&workflow, &target);

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

        Commands::Judge { workflow_id, replay_model, on_stop } => {
            if on_stop {
                // --on-stop mode: read activity log, count tool calls, produce verdict
                let verdict = run_on_stop_judge()?;
                println!("{}", serde_json::to_string(&verdict)?);
            } else {
                // Normal judge mode: requires workflow_id
                let workflow_id = workflow_id
                    .ok_or_else(|| anyhow::anyhow!("workflow_id is required when not using --on-stop"))?;

                use attrition_judge::engine::JudgeEngine;
                use attrition_workflow::storage::WorkflowStore;

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

        // ── Hook (PostToolUse stdin processor) ───────────────────────

        Commands::Hook => {
            // Silent on all errors — never break the agent
            let _ = run_hook();
        }

        // ── Import AGENTS.md ──────────────────────────────────────────

        Commands::ImportAgents { path, name } => {
            use attrition_workflow::adapters::agents_md::AgentsMdAdapter;
            use attrition_workflow::adapters::WorkflowAdapter;
            use attrition_workflow::storage::WorkflowStore;
            use attrition_workflow::{Workflow, WorkflowMetadata, TokenCost};

            if !path.exists() {
                anyhow::bail!("File not found: {}", path.display());
            }

            let raw = std::fs::read(&path)?;
            let events = AgentsMdAdapter::parse(&raw)?;

            if events.is_empty() {
                println!("No steps found in {}. Nothing to import.", path.display());
                return Ok(());
            }

            let workflow_name = name.unwrap_or_else(|| {
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("agents-md")
                    .to_string()
            });

            let workflow = Workflow::new(
                workflow_name.clone(),
                "agents-md".to_string(),
                events.clone(),
                WorkflowMetadata {
                    adapter: AgentsMdAdapter::source_name().to_string(),
                    session_id: None,
                    project_path: path.parent().and_then(|p| p.to_str()).map(String::from),
                    total_tokens: TokenCost::default(),
                    duration_ms: 0,
                    task_description: format!("Imported from {}", path.display()),
                },
            );

            let db_path = workflow_db_path()?;
            let store = WorkflowStore::new(&db_path)?;
            store.save_workflow(&workflow)?;

            if cli.json {
                println!("{}", serde_json::to_string_pretty(&serde_json::json!({
                    "id": workflow.id.to_string(),
                    "name": workflow_name,
                    "steps": events.len(),
                    "source": path.display().to_string(),
                    "db_path": db_path.display().to_string(),
                }))?);
            } else {
                println!(
                    "Imported {} steps from {} as workflow '{}'",
                    events.len(),
                    path.display(),
                    workflow_name,
                );
                println!("  ID: {}", workflow.id);
                println!("  Stored: {}", db_path.display());
            }
        }

        // ── Install hooks into Claude Code ───────────────────────────

        Commands::Install => {
            run_install()?;
        }

        // ── Status ───────────────────────────────────────────────────

        Commands::Status => {
            run_status(cli.json)?;
        }

        // ── Activity ─────────────────────────────────────────────────

        Commands::Activity { limit } => {
            run_activity(limit, cli.json)?;
        }
    }

    Ok(())
}

// ── Hook implementation ────────────────────────────────────────────────────

/// Read a PostToolUse JSON event from stdin, extract tool name + input key names
/// (never values for privacy), append one JSONL line to ~/.attrition/activity.jsonl.
fn run_hook() -> Result<()> {
    use std::io::Read;

    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;

    let event: serde_json::Value = serde_json::from_str(&input)?;

    let tool_name = event
        .get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    // Extract only key names from tool_input — never values (privacy)
    let input_keys: Vec<&str> = event
        .get("tool_input")
        .and_then(|v| v.as_object())
        .map(|obj| obj.keys().map(|k| k.as_str()).collect())
        .unwrap_or_default();

    let session_id = event
        .get("session_id")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    let record = serde_json::json!({
        "ts": chrono::Utc::now().to_rfc3339(),
        "tool": tool_name,
        "input_keys": input_keys,
        "session_id": session_id,
    });

    // Ensure ~/.attrition/ exists
    let attrition_dir = dirs_fallback();
    std::fs::create_dir_all(&attrition_dir)?;

    let log_path = attrition_dir.join("activity.jsonl");
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    writeln!(file, "{}", serde_json::to_string(&record)?)?;

    Ok(())
}

// ── On-stop judge implementation ───────────────────────────────────────────

/// Read the activity log, count tool calls in current session, produce a verdict.
fn run_on_stop_judge() -> Result<serde_json::Value> {
    let log_path = dirs_fallback().join("activity.jsonl");

    if !log_path.exists() {
        return Ok(serde_json::json!({
            "verdict": "correct",
            "reason": "No activity log found — trivial task.",
            "tool_count": 0,
            "decision": "allow_stop",
        }));
    }

    let content = std::fs::read_to_string(&log_path)?;
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    let tool_count = lines.len();

    if tool_count < 5 {
        return Ok(serde_json::json!({
            "verdict": "correct",
            "reason": format!("Only {} tool calls — trivial task, no workflow enforcement needed.", tool_count),
            "tool_count": tool_count,
            "decision": "allow_stop",
        }));
    }

    // For non-trivial sessions, check for evidence of common completion steps
    let has_build = lines.iter().any(|l| l.contains("\"build\"") || l.contains("\"tsc\""));
    let has_test = lines.iter().any(|l| l.contains("\"test\"") || l.contains("\"vitest\""));
    let has_visual = lines.iter().any(|l| {
        l.contains("\"screenshot\"") || l.contains("\"preview\"") || l.contains("\"browser\"")
    });

    let mut missing = Vec::new();
    if !has_build {
        missing.push("build/type-check");
    }
    if !has_test {
        missing.push("test run");
    }
    if !has_visual {
        missing.push("visual verification");
    }

    if missing.is_empty() {
        Ok(serde_json::json!({
            "verdict": "correct",
            "reason": format!("{} tool calls with build, test, and visual evidence.", tool_count),
            "tool_count": tool_count,
            "decision": "allow_stop",
        }))
    } else {
        Ok(serde_json::json!({
            "verdict": "incomplete",
            "reason": format!("{} tool calls but missing evidence for: {}.", tool_count, missing.join(", ")),
            "tool_count": tool_count,
            "missing": missing,
            "decision": "warn",
        }))
    }
}

// ── Install implementation ─────────────────────────────────────────────────

/// Write hook config to ~/.claude/settings.json.
/// Adds PostToolUse hook (bp hook) and Stop hook (bp judge --on-stop).
/// Backs up existing settings.json first.
fn run_install() -> Result<()> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let claude_dir = PathBuf::from(&home).join(".claude");
    let settings_path = claude_dir.join("settings.json");

    // Ensure ~/.claude/ exists
    std::fs::create_dir_all(&claude_dir)?;

    // Load existing settings or start fresh
    let mut settings: serde_json::Value = if settings_path.exists() {
        // Back up first
        let backup_path = claude_dir.join("settings.json.bak");
        std::fs::copy(&settings_path, &backup_path)?;
        println!("  Backed up: {}", backup_path.display());

        let content = std::fs::read_to_string(&settings_path)?;
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Ensure settings is an object
    let obj = settings.as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("settings.json is not a JSON object"))?;

    // Set up hooks array
    let hooks = obj
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));
    let hooks_obj = hooks.as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("hooks field is not a JSON object"))?;

    // Determine bp binary path — use the one currently running
    let bp_path = std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "bp".to_string());

    // PostToolUse hook
    hooks_obj.insert(
        "PostToolUse".to_string(),
        serde_json::json!([{
            "type": "command",
            "command": format!("{} hook", bp_path),
        }]),
    );

    // Stop hook
    hooks_obj.insert(
        "Stop".to_string(),
        serde_json::json!([{
            "type": "command",
            "command": format!("{} judge _ --on-stop", bp_path),
        }]),
    );

    // Write settings
    let output = serde_json::to_string_pretty(&settings)?;
    std::fs::write(&settings_path, output)?;

    println!("{}", BANNER);
    println!("  Hooks installed into Claude Code:");
    println!();
    println!("  PostToolUse -> bp hook");
    println!("    Silently logs tool name + input keys to ~/.attrition/activity.jsonl");
    println!();
    println!("  Stop -> bp judge --on-stop");
    println!("    Reads activity log, produces verdict JSON (allow/warn)");
    println!();
    println!("  Settings: {}", settings_path.display());
    println!();
    println!("  To uninstall, remove the hooks from {}", settings_path.display());

    Ok(())
}

// ── ANSI color helpers ────────────────────────────────────────────────────

fn green(s: &str) -> String { format!("\x1b[32m{}\x1b[0m", s) }
fn red(s: &str) -> String { format!("\x1b[31m{}\x1b[0m", s) }
fn yellow(s: &str) -> String { format!("\x1b[33m{}\x1b[0m", s) }
fn dim(s: &str) -> String { format!("\x1b[2m{}\x1b[0m", s) }
fn bold(s: &str) -> String { format!("\x1b[1m{}\x1b[0m", s) }

// ── Status implementation ─────────────────────────────────────────────────

fn run_status(json: bool) -> Result<()> {
    let attrition_dir = dirs_fallback();
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());

    // ── 1. Check hooks installed ──────────────────────────────────────
    let hooks_path = PathBuf::from(&home)
        .join(".claude")
        .join("settings.json");

    let installed_hooks = read_installed_hooks(&hooks_path);

    // ── 2. Check active workflow ──────────────────────────────────────
    let workflow_path = attrition_dir.join("active_workflow.json");
    let active_workflow = read_active_workflow(&workflow_path);

    // ── 3. Read recent activity ───────────────────────────────────────
    let activity_path = attrition_dir.join("activity.jsonl");
    let (recent_activity, total_events) = read_recent_activity(&activity_path, 10);

    // ── 4. Count blocked searches ─────────────────────────────────────
    let search_log_path = attrition_dir.join("search_log.jsonl");
    let blocked_count = count_blocked_searches(&search_log_path);

    // ── 5. Count workflows in DB ──────────────────────────────────────
    let db_path = workflow_db_path()?;
    let workflow_count = if db_path.exists() {
        attrition_workflow::storage::WorkflowStore::new(&db_path)
            .ok()
            .and_then(|store| store.list_workflows().ok())
            .map(|wfs| wfs.len())
            .unwrap_or(0)
    } else {
        0
    };

    // ── 6. Compute verdict if stopped now ─────────────────────────────
    let verdict = compute_verdict_now(&active_workflow, &recent_activity);

    // ── 7. Session duration ───────────────────────────────────────────
    let session_duration_sec = compute_session_duration(&recent_activity);

    if json {
        let hooks_json: Vec<serde_json::Value> = installed_hooks
            .iter()
            .map(|(name, detail)| serde_json::json!({ "name": name, "detail": detail }))
            .collect();

        let workflow_json = active_workflow.as_ref().map(|wf| {
            let steps_json: Vec<serde_json::Value> = wf.steps.iter().map(|s| {
                serde_json::json!({ "name": s.name, "has_evidence": s.has_evidence })
            }).collect();
            let completed = wf.steps.iter().filter(|s| s.has_evidence).count();
            let total = wf.steps.len();
            let pct = if total > 0 { (completed as f64 / total as f64 * 100.0) as u32 } else { 0 };
            serde_json::json!({
                "name": wf.name,
                "steps": steps_json,
                "completion_pct": pct,
            })
        });

        println!("{}", serde_json::to_string_pretty(&serde_json::json!({
            "hooks_installed": installed_hooks.len(),
            "hooks": hooks_json,
            "active_workflow": workflow_json,
            "total_events": total_events,
            "blocked_searches": blocked_count,
            "stored_workflows": workflow_count,
            "session_duration_sec": session_duration_sec,
            "verdict_if_stopped_now": verdict,
        }))?);
        return Ok(());
    }

    // ── Pretty print ──────────────────────────────────────────────────

    println!();
    println!("  {}", bold("attrition status"));
    println!("  {}", dim(&"═".repeat(48)));
    println!();

    // Hooks
    println!("  {}:", bold("Hooks"));

    let all_hooks = [
        ("SessionStart", ""),
        ("UserPromptSubmit", ""),
        ("PreToolUse", "Grep|Glob|WebSearch"),
        ("PostToolUse", ""),
        ("Stop", "hard-block enabled"),
        ("SubagentStop", ""),
        ("InstructionsLoaded", ""),
        ("PreCompact", ""),
        ("SessionEnd", ""),
        ("FileChanged", ""),
    ];

    for (hook_name, default_detail) in &all_hooks {
        let is_installed = installed_hooks.iter().any(|(n, _)| n == hook_name);
        if is_installed {
            let detail = installed_hooks.iter()
                .find(|(n, _)| n == hook_name)
                .map(|(_, d)| d.as_str())
                .unwrap_or(default_detail);
            let detail_str = if detail.is_empty() {
                "installed".to_string()
            } else {
                format!("installed ({})", detail)
            };
            println!("    {} {:<22} {}", green("✓"), hook_name, dim(&detail_str));
        } else {
            println!("    {} {:<22} {}", dim("·"), hook_name, dim("not installed"));
        }
    }

    println!();

    // Active workflow
    if let Some(ref wf) = active_workflow {
        let completed = wf.steps.iter().filter(|s| s.has_evidence).count();
        let total = wf.steps.len();
        let pct = if total > 0 { completed * 100 / total } else { 0 };

        println!("  {}: {} ({} steps)", bold("Active Workflow"), &wf.name, total);
        for (i, step) in wf.steps.iter().enumerate() {
            let mark = if step.has_evidence {
                green("✓")
            } else {
                red("✗")
            };
            let evidence_str = if step.has_evidence {
                "evidence found".to_string()
            } else {
                "no evidence yet".to_string()
            };
            println!(
                "    {}. {:<24} {} {}",
                i + 1,
                step.name,
                mark,
                dim(&evidence_str),
            );
        }
        println!();

        let verdict_color = match verdict.as_str() {
            "BLOCK" => red(&format!("Completion: {}/{} ({}%) — Stop hook will BLOCK", completed, total, pct)),
            "ESCALATE" => yellow(&format!("Completion: {}/{} ({}%) — Stop hook will ESCALATE", completed, total, pct)),
            _ => green(&format!("Completion: {}/{} ({}%) — Stop hook will ALLOW", completed, total, pct)),
        };
        println!("  {}", verdict_color);
    } else {
        println!("  {}: {}", bold("Active Workflow"), dim("None"));
    }
    println!();

    // Recent activity
    if !recent_activity.is_empty() {
        println!("  {} (last {}):", bold("Recent Activity"), recent_activity.len());
        for entry in &recent_activity {
            let time_str = &entry.time_short;
            let tool_display = if entry.was_blocked {
                red(&format!("{:<14}", "BLOCKED"))
            } else {
                format!("{:<14}", entry.tool)
            };
            let detail = if entry.was_blocked {
                red(&format!("Duplicate search: {}(\"{}\")", entry.tool, entry.scrubbed))
            } else {
                dim(&entry.scrubbed)
            };
            println!("    {}  {}  {}", dim(time_str), tool_display, detail);
        }
    }
    println!();

    // Footer
    println!("  Session: {} ({} events)", dim(&activity_path.display().to_string()), total_events);
    println!("  Workflows: {} ({} stored)", dim(&db_path.display().to_string()), workflow_count);
    if blocked_count > 0 {
        println!("  Blocked searches: {}", red(&blocked_count.to_string()));
    }
    println!();

    Ok(())
}

// ── Activity implementation ───────────────────────────────────────────────

fn run_activity(limit: usize, json: bool) -> Result<()> {
    let attrition_dir = dirs_fallback();
    let activity_path = attrition_dir.join("activity.jsonl");

    let (entries, total_events) = read_recent_activity(&activity_path, limit);
    let blocked = entries.iter().filter(|e| e.was_blocked).count();
    let session_duration_sec = compute_session_duration(&entries);

    if json {
        let entries_json: Vec<serde_json::Value> = entries.iter().map(|e| {
            serde_json::json!({
                "ts": e.ts,
                "tool": e.tool,
                "scrubbed": e.scrubbed,
                "was_blocked": e.was_blocked,
            })
        }).collect();
        println!("{}", serde_json::to_string_pretty(&serde_json::json!({
            "entries": entries_json,
            "total": total_events,
            "blocked": blocked,
            "session_duration_sec": session_duration_sec,
        }))?);
        return Ok(());
    }

    println!();
    println!("  {} (last {})", bold("Recent Activity"), limit);
    println!("  {}", dim(&"═".repeat(48)));
    println!();
    println!("  {:<12} {:<24} {}", dim("TIME"), dim("TOOL"), dim("ARGS (scrubbed)"));

    for entry in &entries {
        let time_str = &entry.time_short;
        if entry.was_blocked {
            println!(
                "  {:<12} {:<24} {}",
                dim(time_str),
                red(&format!("■ BLOCKED")),
                red(&format!("{}(\"{}\") — duplicate search", entry.tool, entry.scrubbed)),
            );
        } else {
            println!(
                "  {:<12} {:<24} {}",
                dim(time_str),
                entry.tool,
                dim(&entry.scrubbed),
            );
        }
    }

    let duration_str = format_duration(session_duration_sec);
    println!();
    println!(
        "  Total: {} events | Blocked: {} | Session duration: {}",
        total_events,
        blocked,
        duration_str,
    );
    println!();

    Ok(())
}

// ── Shared data structures & helpers ──────────────────────────────────────

struct WorkflowStep {
    name: String,
    has_evidence: bool,
}

struct ActiveWorkflow {
    name: String,
    steps: Vec<WorkflowStep>,
}

struct ActivityEntry {
    ts: String,
    time_short: String,
    tool: String,
    scrubbed: String,
    was_blocked: bool,
}

fn read_installed_hooks(settings_path: &PathBuf) -> Vec<(String, String)> {
    if !settings_path.exists() {
        return Vec::new();
    }

    let content = match std::fs::read_to_string(settings_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let settings: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let mut hooks = Vec::new();
    if let Some(hooks_obj) = settings.get("hooks").and_then(|h| h.as_object()) {
        for (name, _value) in hooks_obj {
            let detail = match name.as_str() {
                "PreToolUse" => "Grep|Glob|WebSearch".to_string(),
                "Stop" => "hard-block enabled".to_string(),
                _ => String::new(),
            };
            hooks.push((name.clone(), detail));
        }
    }

    hooks
}

fn read_active_workflow(workflow_path: &PathBuf) -> Option<ActiveWorkflow> {
    if !workflow_path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(workflow_path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&content).ok()?;

    let name = value.get("name")?.as_str()?.to_string();
    let steps_arr = value.get("steps")?.as_array()?;

    let steps = steps_arr
        .iter()
        .filter_map(|s| {
            let step_name = s.get("name")?.as_str()?.to_string();
            let has_evidence = s.get("has_evidence").and_then(|v| v.as_bool()).unwrap_or(false);
            Some(WorkflowStep { name: step_name, has_evidence })
        })
        .collect();

    Some(ActiveWorkflow { name, steps })
}

fn read_recent_activity(activity_path: &PathBuf, limit: usize) -> (Vec<ActivityEntry>, usize) {
    if !activity_path.exists() {
        return (Vec::new(), 0);
    }

    let content = match std::fs::read_to_string(activity_path) {
        Ok(c) => c,
        Err(_) => return (Vec::new(), 0),
    };

    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    let total = lines.len();

    let start = if lines.len() > limit { lines.len() - limit } else { 0 };
    let recent_lines = &lines[start..];

    let entries: Vec<ActivityEntry> = recent_lines
        .iter()
        .filter_map(|line| {
            let v: serde_json::Value = serde_json::from_str(line).ok()?;
            let ts = v.get("ts").and_then(|t| t.as_str()).unwrap_or("").to_string();
            let tool = v.get("tool").and_then(|t| t.as_str()).unwrap_or("unknown").to_string();
            let was_blocked = v.get("blocked").and_then(|b| b.as_bool()).unwrap_or(false);

            // Build a scrubbed representation from input_keys
            let scrubbed = if let Some(keys) = v.get("input_keys").and_then(|k| k.as_array()) {
                let key_strs: Vec<&str> = keys.iter().filter_map(|k| k.as_str()).collect();
                if key_strs.is_empty() {
                    String::new()
                } else {
                    key_strs.join(", ")
                }
            } else {
                String::new()
            };

            // Extract time portion from ISO timestamp (HH:MM:SS)
            let time_short = if ts.len() >= 19 {
                ts[11..19].to_string()
            } else {
                ts.clone()
            };

            Some(ActivityEntry { ts, time_short, tool, scrubbed, was_blocked })
        })
        .collect();

    (entries, total)
}

fn count_blocked_searches(search_log_path: &PathBuf) -> usize {
    if !search_log_path.exists() {
        return 0;
    }

    let content = match std::fs::read_to_string(search_log_path) {
        Ok(c) => c,
        Err(_) => return 0,
    };

    content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter(|l| l.contains("\"blocked\":true") || l.contains("\"blocked\": true"))
        .count()
}

fn compute_verdict_now(workflow: &Option<ActiveWorkflow>, activity: &[ActivityEntry]) -> String {
    if let Some(wf) = workflow {
        let completed = wf.steps.iter().filter(|s| s.has_evidence).count();
        let total = wf.steps.len();
        if total == 0 {
            return "ALLOW".to_string();
        }
        let pct = completed * 100 / total;
        if pct >= 80 {
            "ALLOW".to_string()
        } else if pct >= 50 {
            "ESCALATE".to_string()
        } else {
            "BLOCK".to_string()
        }
    } else if activity.is_empty() {
        "ALLOW".to_string()
    } else {
        // No workflow loaded — use heuristic from on-stop judge
        let has_build = activity.iter().any(|e| {
            e.tool.contains("Bash") && (e.scrubbed.contains("build") || e.scrubbed.contains("tsc"))
        });
        let has_test = activity.iter().any(|e| {
            e.tool.contains("Bash") && (e.scrubbed.contains("test") || e.scrubbed.contains("vitest"))
        });
        if has_build && has_test {
            "ALLOW".to_string()
        } else if has_build || has_test {
            "ESCALATE".to_string()
        } else if activity.len() < 5 {
            "ALLOW".to_string()
        } else {
            "ESCALATE".to_string()
        }
    }
}

fn compute_session_duration(activity: &[ActivityEntry]) -> u64 {
    if activity.len() < 2 {
        return 0;
    }

    // Parse first and last timestamps
    let parse_ts = |ts: &str| -> Option<u64> {
        // Try to parse HH:MM:SS from the time_short field
        let parts: Vec<&str> = ts.split(':').collect();
        if parts.len() == 3 {
            let h: u64 = parts[0].parse().ok()?;
            let m: u64 = parts[1].parse().ok()?;
            let s: u64 = parts[2].parse().ok()?;
            Some(h * 3600 + m * 60 + s)
        } else {
            None
        }
    };

    let first = parse_ts(&activity[0].time_short);
    let last = parse_ts(&activity[activity.len() - 1].time_short);

    match (first, last) {
        (Some(f), Some(l)) if l >= f => l - f,
        _ => 0,
    }
}

fn format_duration(secs: u64) -> String {
    if secs < 60 {
        format!("{}s", secs)
    } else if secs < 3600 {
        format!("{}m", secs / 60)
    } else {
        format!("{}h {}m", secs / 3600, (secs % 3600) / 60)
    }
}

/// Truncate a string with ellipsis if it exceeds max length.
fn truncate_str(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max.saturating_sub(3)])
    }
}
