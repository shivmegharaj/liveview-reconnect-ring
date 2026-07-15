@echo off
setlocal EnableExtensions

rem Launch a dedicated Chrome for LiveView Reconnect Ring with silent debugger API.
rem Uses its own user-data-dir so an already-running Chrome does not swallow the flag.

set "RING_URL=https://account.ring.com/"

if defined LVR_CHROME_DATA_DIR (
  set "DATA_DIR=%LVR_CHROME_DATA_DIR%"
) else (
  set "DATA_DIR=%LOCALAPPDATA%\Google\Chrome-LiveViewReconnectRing"
)

set "CHROME="
if defined CHROME_PATH if exist "%CHROME_PATH%" set "CHROME=%CHROME_PATH%"

if not defined CHROME if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
)
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
)
if not defined CHROME if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
  set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
)

if not defined CHROME (
  echo Google Chrome not found. Install Chrome, or set CHROME_PATH to chrome.exe.
  exit /b 1
)

if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

echo OS:        Windows
echo Chrome:    %CHROME%
echo Data dir:  %DATA_DIR%

if /I "%~1"=="--dry-run" (
  echo Dry run. Would launch:
  echo   "%CHROME%" --user-data-dir="%DATA_DIR%" --silent-debugger-extension-api --no-first-run --no-default-browser-check %RING_URL%
  exit /b 0
)

echo Opening Ring Multi-Cam. Load unpacked extension\ in this window if needed.

start "" "%CHROME%" ^
  --user-data-dir="%DATA_DIR%" ^
  --silent-debugger-extension-api ^
  --no-first-run ^
  --no-default-browser-check ^
  "%RING_URL%"

endlocal
