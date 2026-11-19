@echo off
rem Start the Aegis Windows Voice Bridge (Windows speech engine, command-only access).
rem Usage: run_windows_voice.cmd [--host 127.0.0.1] [--port 8767]
setlocal
cd /d "%~dp0"
set "PYTHONPATH=%~dp0"
"%~dp0.venv311\Scripts\python.exe" -m aegis_daemon.windows_bridge --host 127.0.0.1 --port 8767 %*
