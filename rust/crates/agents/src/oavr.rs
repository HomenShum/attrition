use serde::{Deserialize, Serialize};

/// OAVR (Observe-Act-Verify-Reason) sub-agent pattern
///
/// Each sub-agent follows a 4-phase cycle:
/// 1. Observe: Capture current state (screenshot, DOM, network)
/// 2. Act: Execute an action (click, type, navigate)
/// 3. Verify: Confirm the action produced expected results
/// 4. Reason: Decide next action based on verification outcome

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OavrCycle {
    pub observe: Observation,
    pub act: Action,
    pub verify: Verification,
    pub reason: Reasoning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Observation {
    pub screenshot_id: Option<String>,
    pub dom_state: Option<String>,
    pub url: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    pub action_type: ActionType,
    pub target: Option<String>,
    pub value: Option<String>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionType {
    Click,
    Type,
    Navigate,
    Scroll,
    Wait,
    Screenshot,
    Assert,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Verification {
    pub success: bool,
    pub expected: String,
    pub actual: String,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reasoning {
    pub decision: Decision,
    pub rationale: String,
    pub next_action: Option<ActionType>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Continue,
    Retry,
    Escalate,
    Complete,
    Abort,
}

/// Sub-agent types that follow the OAVR pattern
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubAgentType {
    ScreenClassifier,
    ActionVerifier,
    FailureDiagnosis,
    BugReproducer,
}
