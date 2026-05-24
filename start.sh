#!/bin/bash
set +x

# Load env vars silently
while IFS= read -r line; do
    case "$line" in
        \#*) ;;
        *=*) export "${line?}" 2>/dev/null ;;
    esac
done < ~/AgentLink/backend/.env

echo "Stopping existing services..."
pkill -9 -f uvicorn 2>/dev/null
pkill -9 -f "next start" 2>/dev/null
pkill -9 -f "example_webhook" 2>/dev/null
pkill -9 -f cloudflared 2>/dev/null
fuser -k 8000/tcp 2>/dev/null
fuser -k 3001/tcp 2>/dev/null
fuser -k 9000/tcp 2>/dev/null
sleep 3

echo "Starting Docker..."
cd ~/AgentLink && sudo docker-compose up -d
sleep 5

echo "Starting Backend..."
cd ~/AgentLink/backend && venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 > /tmp/backend.log 2>&1 &
sleep 10

echo "Starting Frontend..."
cd ~/AgentLink/frontend && node node_modules/.bin/next start -p 3001 -H 0.0.0.0 > /tmp/frontend.log 2>&1 &
sleep 30

echo "Starting Webhook Agent..."
python3 ~/AgentLink/docs/example_webhook_agent.py 9000 > /tmp/webhook.log 2>&1 &
sleep 5

echo ""
echo "=== SERVICE STATUS ==="
if sudo docker ps | grep -q agentlink_postgres; then echo "OK Postgres"; else echo "FAIL Postgres"; fi
if sudo docker ps | grep -q agentlink_redis; then echo "OK Redis"; else echo "FAIL Redis"; fi
if curl -s http://localhost:8000/api/v1/health > /dev/null 2>&1; then echo "OK Backend"; else echo "FAIL Backend - check /tmp/backend.log"; fi
if curl -s http://localhost:3001 > /dev/null 2>&1; then echo "OK Frontend"; else echo "FAIL Frontend - check /tmp/frontend.log"; fi
if curl -s -X POST http://localhost:9000/agent -H "Content-Type: application/json" -d '{"room_id":"t","message":"p","session_messages":[],"agent_id":"t","agent_name":"t"}' > /dev/null 2>&1; then echo "OK Webhook"; else echo "FAIL Webhook"; fi

echo ""
echo "=== STARTING TUNNEL ==="
cloudflared tunnel --url http://localhost:3001 2>&1 | while IFS= read -r line; do
    echo "$line"
    if echo "$line" | grep -q "trycloudflare.com"; then
        NEW_URL=$(echo "$line" | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com')
        if [ -n "$NEW_URL" ]; then
            echo ""
            echo "=== TUNNEL URL DETECTED: $NEW_URL ==="

            OLD_URL=$(grep "FRONTEND_URL" ~/AgentLink/backend/.env | cut -d'=' -f2 | tr -d '"' | tr -d "'")
            if [ -n "$OLD_URL" ]; then
                sed -i "s|$OLD_URL|$NEW_URL|g" ~/AgentLink/backend/.env ~/AgentLink/frontend/.env.local
                echo "OK Updated .env files"
            fi

            pkill -f uvicorn 2>/dev/null
            sleep 5
            cd ~/AgentLink/backend && venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 > /tmp/backend.log 2>&1 &
            echo "OK Backend restarted with new URL"

            CALLBACK_URL="${NEW_URL}/auth/github/callback"
            HTTP_STATUS=$(curl -s -o /tmp/github_oauth_response.txt -w "%{http_code}" \
                -X PATCH \
                -H "Authorization: token ${GITHUB_PAT}" \
                -H "Accept: application/vnd.github+json" \
                "https://api.github.com/applications/${GITHUB_OAUTH_CLIENT_ID}" \
                -d "{\"url\":\"$NEW_URL\",\"callback_url\":\"$CALLBACK_URL\"}")

            if [ "$HTTP_STATUS" = "200" ]; then
                echo "OK GitHub OAuth callback updated to $CALLBACK_URL"
            else
                echo "WARN GitHub OAuth update failed (HTTP $HTTP_STATUS) - update manually: $CALLBACK_URL"
            fi

            cd ~/AgentLink
            sed -i "s|https://[a-z0-9-]*\.trycloudflare\.com/api/v1/health|${NEW_URL}/api/v1/health|g" index.html
            sed -i "s|https://[a-z0-9-]*\.trycloudflare\.com/directory|${NEW_URL}/directory|g" index.html
            git add index.html
            git diff --cached --quiet || (git commit -m "chore: update tunnel URL in landing" && git push origin main)
            echo "OK Landing page updated and pushed"

            echo ""
            echo "=== ALL DONE ==="
            echo "App URL: $NEW_URL"
        fi
    fi
done
