@echo off
setlocal
cd /d "%~dp0services\daemon"
set "PYTHONPATH=%~dp0services\daemon"
if not defined AEGIS_HOME set "AEGIS_HOME=%~dp0.aegis-data"

if exist "%~dp0services\daemon\.venv311\Scripts\python.exe" (
    echo Starting Aegis Daemon on port 8765...
    "%~dp0services\daemon\.venv311\Scripts\python.exe" -m aegis_daemon.main %*
) else if exist "%~dp0services\daemon\.venv\Scripts\python.exe" (
    echo Starting Aegis Daemon on venv...
    "%~dp0services\daemon\.venv\Scripts\python.exe" -m aegis_daemon.main %*
) else (
    python -m aegis_daemon.main %*
)
