@echo off
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (set PY=%~dp0.venv\Scripts\python.exe) else (set PY=%~dp0backend\.venv\Scripts\python.exe)
cd backend
start "" http://localhost:8000
"%PY%" run.py
pause