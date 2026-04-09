//! AGENTS.md adapter — parses OpenAI Codex AGENTS.md files into canonical events.
//!
//! AGENTS.md is a markdown file used by Codex to define project-level rules:
//! ```markdown
//! # AGENTS.md
//!
//! ## Build
//! - Run `npm run build` before committing
//! - TypeScript strict mode required
//!
//! ## Test
//! - Run `npm test` before pushing
//! - Coverage must be above 80%
//! ```
//!
//! Each `## Section` becomes a group of `CanonicalEvent::Assert` events,
//! one per bullet point, so attrition can enforce them as workflow steps.

use crate::adapters::WorkflowAdapter;
use crate::CanonicalEvent;
use attrition_core::Result;

/// Parses AGENTS.md markdown into canonical Assert events.
pub struct AgentsMdAdapter;

impl WorkflowAdapter for AgentsMdAdapter {
    fn parse(input: &[u8]) -> Result<Vec<CanonicalEvent>> {
        let text = std::str::from_utf8(input).map_err(|e| {
            attrition_core::Error::Internal(format!("Invalid UTF-8: {e}"))
        })?;

        let mut events = Vec::new();
        let mut current_section: Option<String> = None;

        for line in text.lines() {
            let trimmed = line.trim();

            // Detect ## section headers
            if let Some(header) = trimmed.strip_prefix("## ") {
                let header = header.trim();
                if !header.is_empty() {
                    current_section = Some(header.to_string());
                }
                continue;
            }

            // Skip top-level # header
            if trimmed.starts_with("# ") {
                continue;
            }

            // Parse bullet points within a section
            if let Some(bullet_text) = trimmed.strip_prefix("- ") {
                let bullet_text = bullet_text.trim();
                if bullet_text.is_empty() {
                    continue;
                }

                let condition = if let Some(section) = &current_section {
                    format!("[{}] {}", section, bullet_text)
                } else {
                    bullet_text.to_string()
                };

                events.push(CanonicalEvent::Assert {
                    condition,
                    passed: false,
                    evidence: String::new(),
                });
            }
        }

        Ok(events)
    }

    fn source_name() -> &'static str {
        "agents-md"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_basic_agents_md() {
        let input = r#"# AGENTS.md

## Build
- Run `npm run build` before committing
- TypeScript strict mode required

## Test
- Run `npm test` before pushing
- Coverage must be above 80%

## Style
- Use ESLint with the project config
- No console.log in production code
"#;
        let events = AgentsMdAdapter::parse(input.as_bytes()).unwrap();
        assert_eq!(events.len(), 6);

        // Verify first event from Build section
        match &events[0] {
            CanonicalEvent::Assert { condition, passed, evidence } => {
                assert_eq!(condition, "[Build] Run `npm run build` before committing");
                assert!(!passed);
                assert!(evidence.is_empty());
            }
            other => panic!("Expected Assert, got {:?}", other),
        }

        // Verify first event from Test section
        match &events[2] {
            CanonicalEvent::Assert { condition, passed, .. } => {
                assert_eq!(condition, "[Test] Run `npm test` before pushing");
                assert!(!passed);
            }
            other => panic!("Expected Assert, got {:?}", other),
        }

        // Verify last event from Style section
        match &events[5] {
            CanonicalEvent::Assert { condition, .. } => {
                assert_eq!(condition, "[Style] No console.log in production code");
            }
            other => panic!("Expected Assert, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_empty_agents_md() {
        // Completely empty file
        let events = AgentsMdAdapter::parse(b"").unwrap();
        assert!(events.is_empty());

        // File with only a title, no sections or bullets
        let input = "# AGENTS.md\n\nSome freeform text without bullets.\n";
        let events = AgentsMdAdapter::parse(input.as_bytes()).unwrap();
        assert!(events.is_empty());

        // File with sections but no bullets
        let input = "# AGENTS.md\n\n## Build\n\n## Test\n";
        let events = AgentsMdAdapter::parse(input.as_bytes()).unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn test_parse_with_code_blocks() {
        let input = r#"# AGENTS.md

## Build
- Run `npm run build` before committing
- Ensure `tsc --noEmit` passes with zero errors

## Deploy
- Tag releases with `semver` format
- Run `./scripts/smoke-test.sh` after deploy
- Verify `curl -s https://api.example.com/health` returns 200
"#;
        let events = AgentsMdAdapter::parse(input.as_bytes()).unwrap();
        assert_eq!(events.len(), 5);

        // Inline backtick code is preserved verbatim in the condition
        match &events[0] {
            CanonicalEvent::Assert { condition, .. } => {
                assert!(condition.contains("`npm run build`"));
                assert!(condition.starts_with("[Build]"));
            }
            other => panic!("Expected Assert, got {:?}", other),
        }

        match &events[1] {
            CanonicalEvent::Assert { condition, .. } => {
                assert!(condition.contains("`tsc --noEmit`"));
            }
            other => panic!("Expected Assert, got {:?}", other),
        }

        // Deploy section
        match &events[2] {
            CanonicalEvent::Assert { condition, .. } => {
                assert_eq!(condition, "[Deploy] Tag releases with `semver` format");
            }
            other => panic!("Expected Assert, got {:?}", other),
        }

        match &events[4] {
            CanonicalEvent::Assert { condition, .. } => {
                assert!(condition.contains("`curl -s https://api.example.com/health`"));
            }
            other => panic!("Expected Assert, got {:?}", other),
        }
    }
}
