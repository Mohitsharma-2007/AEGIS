@echo off
setlocal
cd /d "%~dp0"
set "PYTHONPATH=%~dp0"
set "VOICES_DIR=%~dp0voices"

if exist "%~dp0.venv311\Scripts\python.exe" (
    echo Starting Aegis Voice Pipeline on Python 3.11...
    "%~dp0.venv311\Scripts\python.exe" -m aegis_daemon.voice_pipeline --host 127.0.0.1 --port 8766 %*
) else if exist "%~dp0.venv\Scripts\python.exe" (
    echo Starting Aegis Voice Pipeline on venv...
    "%~dp0.venv\Scripts\python.exe" -m aegis_daemon.voice_pipeline --host 127.0.0.1 --port 8766 %*
) else (
    echo Starting Aegis Voice Pipeline on global python...
    python -m aegis_daemon.voice_pipeline --host 127.0.0.1 --port 8766 %*
)
