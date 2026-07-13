@echo off
setlocal

if not exist "%~dp0backend\.venv\Scripts\python.exe" (
  echo Backend virtual environment not found at backend\.venv
  pause
  exit /b 1
)

if not exist "%~dp0frontend\node_modules" (
  echo Frontend dependencies not found. Run npm.cmd install inside frontend first.
  pause
  exit /b 1
)

rem Running Uvicorn without --reload avoids orphaned Windows worker processes.
start "EvolvED Backend" /D "%~dp0backend" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --host ::1 --port 8000"
start "EvolvED Frontend" /D "%~dp0frontend" cmd /k "npm.cmd run dev -- --host 0.0.0.0 --port 8080"

echo EvolvED is starting. Use the Network URL shown in the frontend window on the other PC.
