#!/usr/bin/env bash
# Aegis glue (new file): start the openmuse server as an OPTIONAL Aegis sidecar,
# configured entirely from the Aegis provider-registry env names.
#
# Why this shim exists — openmuse's own env contract (verified in its code):
#   * apps/server/src/config.ts reads MODEL (a "provider/model" spec string),
#     AGENT_BACKEND, WORKSPACE_MODE, PORT/HOST, COMPUTER_ENABLED /
#     COMPUTER_PROVIDER, and REQUIRES a CPK_INTELLIGENCE_API_KEY at boot
#     (readConfig() calls required("CPK_INTELLIGENCE_API_KEY", ...) on every
#     start — there is no mode that skips it).
#   * apps/server/src/engine/tanstack-agent.ts adapter(): for the "openai"
#     provider prefix it builds a @tanstack/ai-openai adapter with
#     baseURL = OPENAI_BASE_URL; the SDK takes its key from OPENAI_API_KEY.
#     OPENAI_CHAT_COMPLETIONS=true selects the Chat Completions wire format,
#     which the Aegis gateways (below) all implement; several do NOT implement
#     the Responses API tool loop, so the shim always sets it.
# So the mapping is: MODEL="openai/<model>", OPENAI_API_KEY=<active provider
# key>, OPENAI_BASE_URL=<active provider endpoint>. Key VALUES are only ever
# passed through the environment — this script never prints, logs or stores
# them (the startup banner prints provider/model/URL names only).
#
# Aegis registry (endpoints hard-coded, matching
# opendots/src/server/providers.ts and services/aegis-daemon providers.py):
#   provider     key env var          endpoint                              default model
#   openrouter   OPENROUTER_API_KEY   https://openrouter.ai/api/v1          openai/gpt-oss-20b:free
#   groq         GROQ_API_KEY         https://api.groq.com/openai/v1        llama-3.3-70b-versatile
#   nvidia       NVIDIA_API_KEY       https://integrate.api.nvidia.com/v1   meta/llama-3.3-70b-instruct
#   conduit      CONDUIT_API_KEY      https://conduit.ozdoev.net/v1         gpt-4o-mini
#   tokenharbor  TOKENHARBOR_API_KEY  https://tokenharbor.ai/v1             gpt-4o-mini
#   vercel       VERCEL_AI_KEY        https://ai-gateway.vercel.sh/v1       gpt-4o-mini
# Per-provider *_BASE_URL / VERCEL_GATEWAY_URL overrides win when set, exactly
# as in the rest of Aegis (.env.example). AEGIS_MODEL overrides every default.
#
# Sidecar contract for OpenDots: after start, point OpenDots at
#   AEGIS_COMPUTER_URL=http://127.0.0.1:${AEGIS_COMPUTER_PORT:-8788}
# (already declared in aegis/.env.example). OpenDots' own computer service
# stays primary; this sidecar is the optional openmuse computer backend
# (COMPUTER_ENABLED / COMPUTER_PROVIDER below, default docker).
set -euo pipefail
cd "$(dirname "$0")"

provider="${AEGIS_PROVIDER:-openrouter}"
model="${AEGIS_MODEL:-}"
case "$provider" in
  openrouter)  key_var=OPENROUTER_API_KEY;  base="${OPENROUTER_BASE_URL:-https://openrouter.ai/api/v1}";        def_model="openai/gpt-oss-20b:free" ;;
  groq)        key_var=GROQ_API_KEY;        base="${GROQ_BASE_URL:-https://api.groq.com/openai/v1}";            def_model="llama-3.3-70b-versatile" ;;
  nvidia)      key_var=NVIDIA_API_KEY;      base="${NVIDIA_BASE_URL:-https://integrate.api.nvidia.com/v1}";      def_model="meta/llama-3.3-70b-instruct" ;;
  conduit)     key_var=CONDUIT_API_KEY;     base="${CONDUIT_BASE_URL:-https://conduit.ozdoev.net/v1}";           def_model="gpt-4o-mini" ;;
  tokenharbor) key_var=TOKENHARBOR_API_KEY; base="${TOKENHARBOR_BASE_URL:-https://tokenharbor.ai/v1}";            def_model="gpt-4o-mini" ;;
  vercel)      key_var=VERCEL_AI_KEY;       base="${VERCEL_GATEWAY_URL:-https://ai-gateway.vercel.sh/v1}";       def_model="gpt-4o-mini" ;;
  *) echo "run-aegis: unknown AEGIS_PROVIDER '$provider' (expected openrouter|groq|nvidia|conduit|tokenharbor|vercel)" >&2; exit 1 ;;
esac
model="${model:-$def_model}"

if [ -z "${!key_var:-}" ]; then
  echo "run-aegis: $key_var is not set — the openmuse sidecar would boot but every model call will fail. Set it (env only) and retry." >&2
  exit 1
fi
if [ -z "${CPK_INTELLIGENCE_API_KEY:-}" ]; then
  echo "run-aegis: CPK_INTELLIGENCE_API_KEY is not set — openmuse's readConfig() refuses to boot without it (apps/server/src/config.ts). Set it (env only) and retry." >&2
  exit 1
fi

# Map the active Aegis provider onto the env names openmuse expects.
export OPENAI_API_KEY="${!key_var}"
export OPENAI_BASE_URL="$base"
export OPENAI_CHAT_COMPLETIONS="true"
export MODEL="openai/$model"
export AGENT_BACKEND="${AGENT_BACKEND:-model}"
export WORKSPACE_MODE="${WORKSPACE_MODE:-live}"
export PORT="${AEGIS_COMPUTER_PORT:-8788}"
export HOST="${AEGIS_COMPUTER_HOST:-127.0.0.1}"
# Computer sidecar: opt-in, upstream defaults preserved (docker provider).
export COMPUTER_ENABLED="${COMPUTER_ENABLED:-true}"
export COMPUTER_PROVIDER="${COMPUTER_PROVIDER:-docker}"

echo "Aegis computer sidecar: provider=$provider model=$MODEL base=$OPENAI_BASE_URL url=http://$HOST:$PORT (set AEGIS_COMPUTER_URL=http://$HOST:$PORT in the Aegis host env)"
# Same entry the upstream root package.json "dev" script uses.
exec npx tsx apps/server/src/index.ts
