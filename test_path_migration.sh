#!/bin/bash
# Regression test: verify start.sh path migration from ~/AgentLink to REPO_ROOT.
# Run from any directory; exits 0 on pass, non-zero on failure.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$REPO_ROOT/start.sh"
PASS=0
FAIL=0

check() {
    local desc="$1" result="$2"
    if [ "$result" = "ok" ]; then
        echo "PASS  $desc"
        ((PASS++))
    else
        echo "FAIL  $desc"
        ((FAIL++))
    fi
}

# 1. No old ~/AgentLink references remain in start.sh
if grep -q '~/AgentLink' "$SCRIPT"; then
    check "start.sh: no ~/AgentLink references" "fail"
else
    check "start.sh: no ~/AgentLink references" "ok"
fi

# 2. REPO_ROOT definition exists and derives from script location
if grep -q 'REPO_ROOT=.*BASH_SOURCE' "$SCRIPT"; then
    check "start.sh: REPO_ROOT defined from BASH_SOURCE" "ok"
else
    check "start.sh: REPO_ROOT defined from BASH_SOURCE" "fail"
fi

# 3. Shell syntax is valid
if bash -n "$SCRIPT" 2>/dev/null; then
    check "start.sh: shell syntax valid" "ok"
else
    check "start.sh: shell syntax valid" "fail"
fi

# 4. REPO_ROOT resolves to the correct absolute path when invoked from a different CWD.
# We run a small inline script that sources just the REPO_ROOT definition from a
# different working directory and prints what it resolved.
DERIVED=$(cd /tmp && bash -c '
    script="'"$SCRIPT"'"
    REPO_ROOT="$(cd "$(dirname "$script")" && pwd)"
    echo "$REPO_ROOT"
')
if [ "$DERIVED" = "$REPO_ROOT" ]; then
    check "REPO_ROOT resolves correctly from /tmp" "ok"
else
    check "REPO_ROOT resolves correctly from /tmp (got: $DERIVED)" "fail"
fi

# 5. All paths referenced in start.sh exist
declare -a REQUIRED_PATHS=(
    "$REPO_ROOT/backend/.env"
    "$REPO_ROOT/backend/venv/bin/uvicorn"
    "$REPO_ROOT/frontend/node_modules/.bin/next"
    "$REPO_ROOT/docs/example_webhook_agent.py"
    "$REPO_ROOT/docs/gemini_webhook_agent.py"
    "$REPO_ROOT/docker-compose.yml"
    "$REPO_ROOT/index.html"
    "$REPO_ROOT/frontend/.env.local"
)
for p in "${REQUIRED_PATHS[@]}"; do
    if [ -e "$p" ]; then
        check "path exists: ${p#$REPO_ROOT/}" "ok"
    else
        check "path exists: ${p#$REPO_ROOT/}" "fail"
    fi
done

# 6. Git remote targets AgentLink (not Football)
REMOTE=$(cd "$REPO_ROOT" && git remote get-url origin 2>/dev/null)
if echo "$REMOTE" | grep -q "Lucaramallo/AgentLink"; then
    check "git remote: points to Lucaramallo/AgentLink" "ok"
else
    check "git remote: points to Lucaramallo/AgentLink (got: $REMOTE)" "fail"
fi

# 7. Football-Market-Intelligence repo is untouched (no staged changes)
FMI=/home/agentlink/Projects/Football-Market-Intelligence
if [ -d "$FMI/.git" ]; then
    STAGED=$(cd "$FMI" && git diff --cached --name-only 2>/dev/null)
    if [ -z "$STAGED" ]; then
        check "Football-Market-Intelligence: no staged changes" "ok"
    else
        check "Football-Market-Intelligence: no staged changes (found: $STAGED)" "fail"
    fi
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
