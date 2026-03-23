#!/bin/bash
# OmniRoute + Cloudflared Health Check & Auto-Recovery

LOG=/tmp/omni-health.log
DATE=$(date '+%Y-%m-%d %H:%M:%S')

check_and_restart() {
    local service=$1
    local check_cmd=$2
    
    if ! eval "$check_cmd" > /dev/null 2>&1; then
        echo "$DATE ⚠️  $service DOWN — restarting..." | tee -a $LOG
        sudo systemctl restart "$service" 2>&1 | tee -a $LOG
        sleep 5
        if eval "$check_cmd" > /dev/null 2>&1; then
            echo "$DATE ✅ $service RECOVERED" | tee -a $LOG
        else
            echo "$DATE ❌ $service FAILED TO RECOVER" | tee -a $LOG
        fi
    fi
}

# 1. Check OmniRoute
check_and_restart "omniroute" "curl -sf http://localhost:20128/v1/models -H 'Authorization: Bearer test' --max-time 5"

# 2. Check Cloudflared
check_and_restart "cloudflared" "systemctl is-active --quiet cloudflared"

# 3. Verify public URL
if systemctl is-active --quiet omniroute && systemctl is-active --quiet cloudflared; then
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://ai.aitradepulse.com/ --max-time 10 2>/dev/null)
    if [ "$HTTP_STATUS" != "200" ] && [ "$HTTP_STATUS" != "307" ] && [ "$HTTP_STATUS" != "302" ]; then
        echo "$DATE ⚠️  Public URL returned HTTP $HTTP_STATUS" | tee -a $LOG
    fi
fi
