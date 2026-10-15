@echo off
rem ==============================================================================
rem RescueOS — Emergency Command Line Control Utility (Windows)
rem "Boot. Connect. Rescue."
rem ==============================================================================

set DIR=%~dp0..
set BACKEND=%DIR%\backend

if "%1"=="start" goto start
if "%1"=="stop" goto stop
if "%1"=="restart" goto restart
if "%1"=="status" goto status
if "%1"=="test" goto test

:usage
echo Usage: rescueos.bat {start^|stop^|restart^|status^|test}
goto end

:start
echo 🚨 Booting RescueOS Emergency Station...
cd /d "%BACKEND%"
start "RescueOS Server" node server.js
echo ✅ RescueOS launched in separate console window.
echo 📡 Open: http://localhost:8080
goto end

:stop
echo 🛑 Stopping RescueOS process...
taskkill /F /FI "WINDOWTITLE eq RescueOS Server*" >nul 2>&1
echo ✅ RescueOS stop signal sent.
goto end

:restart
call :stop
timeout /t 2 /nobreak >nul
call :start
goto end

:status
netstat -ano | findstr :8080 >nul
if %errorlevel% equ 0 (
  echo ✅ RescueOS is LISTENING on port 8080
  echo 📡 Open: http://localhost:8080
) else (
  echo ⭕ RescueOS is STOPPED / OFFLINE
)
goto end

:test
echo 🧪 Running RescueOS test suite...
cd /d "%BACKEND%"
node tests/api.test.js
goto end

:end
