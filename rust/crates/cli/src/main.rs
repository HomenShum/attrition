use anyhow::Result;
use clap::{Parser, Subcommand};

const BANNER: &str = r#"
    _   _ ____   ___    _
   | \ | | __ ) / _ \  / \
   |  \| |  _ \| | | |/ _ \
   | |\  | |_) | |_| / ___ \
   |_| \_|____/ \__\_\_/   \_\
   nodebench-qa — QA for AI agents
"#;

#[derive(Parser)]
#[command(name = "nbqa")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "Full-stack QA platform for AI coding agents")]
#[command(long_about = "nodebench-qa: Run QA checks, site audits, diff crawls, and workflow replays.\nRust rewrite of retention.sh with MCP protocol support.")]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Server port (default: 8100)
    #[arg(long, default_value_t = 8100)]
    port: u16,

    /// Enable JSON output
    #[arg(long)]
    json: bool,

    /// Verbose logging
    #[arg(short, long)]
    verbose: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the nodebench-qa server (API + MCP)
    Serve {
        /// Host to bind to
        #[arg(long, default_value = "0.0.0.0")]
        host: String,

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
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Init telemetry
    if cli.verbose {
        unsafe { std::env::set_var("RUST_LOG", "debug") };
    }
    nodebench_qa_telemetry::init();

    match cli.command {
        Commands::Serve { host, mcp, mcp_port } => {
            println!("{}", BANNER);
            println!("  API server: http://{}:{}", host, cli.port);
            if mcp {
                println!("  MCP server: http://{}:{}/mcp", host, mcp_port);
            }
            println!();

            let config = nodebench_qa_core::AppConfig {
                server: nodebench_qa_core::config::ServerConfig {
                    host: host.clone(),
                    port: cli.port,
                    ..Default::default()
                },
                mcp: nodebench_qa_core::config::McpConfig {
                    enabled: mcp,
                    port: mcp_port,
                    auth_token: None,
                },
                ..Default::default()
            };

            let app = nodebench_qa_api::build_router(&config);
            let listener = tokio::net::TcpListener::bind(format!("{}:{}", host, cli.port)).await?;
            tracing::info!("nodebench-qa server listening on {}:{}", host, cli.port);
            axum::serve(listener, app).await?;
        }

        Commands::Check { url, timeout } => {
            let result = nodebench_qa_engine::qa::run_qa_check(&url, timeout).await?;
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
            let result = nodebench_qa_engine::crawl::crawl_sitemap(&url, depth, max_pages).await?;
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
            let result = nodebench_qa_engine::audit::run_ux_audit(&url).await?;
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
            let result = nodebench_qa_engine::diff::run_diff_crawl(&url, baseline.as_deref()).await?;
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
            let result = nodebench_qa_agents::pipeline::run_pipeline(&url).await?;
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
            let client = nodebench_qa_sdk::NbqaClient::new(&url);
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
            println!("  Config dir: {}", nodebench_qa_core::AppConfig::config_dir().display());
            println!("  Data dir: {}", nodebench_qa_core::AppConfig::data_dir().display());
        }
    }

    Ok(())
}
