#!/usr/bin/env bash
# Headless Edge screenshots of the running `lingxi ui` (dev QA helper).
# usage: scripts/ui-shot.sh <name> <hash-route> [height]
E="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
TOKEN=$(grep -o "token=[A-Za-z0-9_-]*" "${LXUI_LOG:-/c/Users/yujie.zhu/AppData/Local/Temp/lxui.log}" | head -1 | cut -d= -f2)
OUT='C:\Users\yujie.zhu\AppData\Local\Temp'
timeout 45 "$E" --headless=new --disable-gpu --hide-scrollbars --window-size=1536,${3:-1024} --virtual-time-budget=5000 \
  --screenshot="$OUT\\$1.png" "http://127.0.0.1:${LXUI_PORT:-4317}/?token=$TOKEN&nolive=1#$2" 2>&1 | grep -c written
