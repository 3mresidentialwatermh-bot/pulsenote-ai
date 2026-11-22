@echo off
title PulseNote AI - Auto-KeepAlive Server & Tunnel
echo Starting PulseNote AI Backend on Port 4000...
start "PulseNote Backend" /min cmd /c "cd /d "%~dp0backend" && node server.js"

timeout /t 2 /nobreak >nul

:tunnel_loop
echo Connecting HTTPS Tunnel (https://pulsenote-ai-live.loca.lt)...
call npx --yes localtunnel --port 4000 --local-host 127.0.0.1 --subdomain pulsenote-ai-live
echo Tunnel disconnected, reconnecting in 2 seconds...
timeout /t 2 /nobreak >nul
goto tunnel_loop
