#!/usr/bin/env bash
# =============================================================================
# deploy-gcp.sh — Build and deploy attrition to GCP Cloud Run
#
# Prerequisites:
#   - gcloud CLI authenticated (`gcloud auth login`)
#   - Docker or Cloud Build enabled on the project
#   - Cloud Run API enabled
#
# Usage:
#   GCP_PROJECT_ID=my-project ./scripts/deploy-gcp.sh
#   GCP_PROJECT_ID=my-project GCP_REGION=us-east1 ./scripts/deploy-gcp.sh
# =============================================================================
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="attrition"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "============================================="
echo "  attrition -> Cloud Run"
echo "  Project : ${PROJECT_ID}"
echo "  Region  : ${REGION}"
echo "  Image   : ${IMAGE}"
echo "============================================="
echo ""

# ---- Build + push via Cloud Build (no local Docker needed) ----
echo "[1/2] Submitting build..."
gcloud builds submit \
  --project "${PROJECT_ID}" \
  --tag "${IMAGE}" \
  .

# ---- Deploy to Cloud Run ----
echo ""
echo "[2/2] Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars "ATTRITION_STATIC_DIR=/app/static"

# ---- Print results ----
URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format 'value(status.url)')

echo ""
echo "============================================="
echo "  Deployed!"
echo "  URL   : ${URL}"
echo "  Health: ${URL}/health"
echo "  MCP   : ${URL}/mcp"
echo "============================================="
echo ""
echo "Add to Claude Code (.mcp.json):"
echo ""
echo "  \"attrition\": {"
echo "    \"command\": \"npx\","
echo "    \"args\": [\"-y\", \"@anthropic-ai/mcp-remote\", \"${URL}/mcp\"]"
echo "  }"
echo ""
echo "Add to Codex:"
echo "  export ATTRITION_URL=${URL}"
echo ""
