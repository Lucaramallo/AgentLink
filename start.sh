#!/bin/bash

echo "Stopping existing services..."
pkill -9 -f uvicorn 2>/dev/null
pkill -9 -f "next start" 2>/dev/null
pkill -9 -f "example_webhook" 2>/dev/null
pkill -9 -f cloudflared 2>/dev/null
fuser -k 8000/tcp 2>/dev/null
fuser -k 3001/tcp 2>/dev/null
fuser -k 9000/tcp 2>/dev/null
sleep 2

echo "Starting Docker..."
cd ~/AgentLink && sudo docker-compose up -d
sleep 3

echo "Starting Backend..."
cd ~/AgentLink/backend && venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 > /tmp/backend.log 2>&1 &
sleep 3

echo "Starting Frontend..."
cd ~/AgentLink/frontend && node node_modules/.bin/next start -p 3001 -H 0.0.0.0 > /tmp/frontend.log 2>&1 &
sleep 3

echo "Starting Webhook Agent..."
python3 ~/AgentLink/docs/example_webhook_agent.py 9000 > /tmp/webhook.log 2>&1 &
sleep 2

echo ""
echo "=== SERVICE STATUS ==="

if sudo docker ps | grep -q agentlink_postgres; then echo "OK Postgres"; else echo "FAIL Postgres"; fi
if sudo docker ps | grep -q agentlink_redis; then echo "OK Redis"; else echo "FAIL Redis"; fi
if curl -s http://localhost:8000/api/v1/health > /dev/null 2>&1; then echo "OK Backend"; else echo "FAIL Backend - check /tmp/backend.log"; fi
if curl -s http://localhost:3001 > /dev/null 2>&1; then echo "OK Frontend"; else echo "FAIL Frontend - check /tmp/frontend.log"; fi
if curl -s -X POST http://localhost:9000/agent -H "Content-Type: application/json" -d '{"room_id":"t","message":"p","session_messages":[],"agent_id":"t","agent_name":"t"}' > /dev/null 2>&1; then echo "OK Webhook"; else echo "FAIL Webhook - check /tmp/webhook.log"; fi

echo ""
echo "=== TUNNEL STARTING ==="
echo "When URL appears, run:"
echo "sed -i 's|https://OLD|https://NEW|g' ~/AgentLink/backend/.env ~/AgentLink/frontend/.env.local"
echo "Then update GitHub OAuth App callback URL"
echo ""

cloudflared tunnel --url http://localhost:3001
