@echo off
rem Start the local Pipecat voice pipeline with the project's Python 3.11 venv.
rem Usage: run_voice.cmd [--host 127.0.0.1] [--port 8766]
setlocal
cd /d "%~dp0"
set "PYTHONPATH=%~dp0"
"%~dp0.venv311\Scripts\python.exe" -m aegis_daemon.voice_pipeline --host 127.0.0.1 --port 8766 %*
