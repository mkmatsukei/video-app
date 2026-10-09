@echo off
chcp 65001 >nul
cd /d "%~dp0"
node serve.js 8080
pause
