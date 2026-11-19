@echo off
setlocal
cd /d "%~dp0services\daemon"
call run_voice.bat %*
