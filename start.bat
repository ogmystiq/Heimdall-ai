@echo off
title HEIMDALL
cd /d "%~dp0"
if not exist launcher.js git fetch -q origin main && git reset -q --hard origin/main
node launcher.js
pause
