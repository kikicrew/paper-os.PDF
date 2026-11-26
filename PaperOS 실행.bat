@echo off
rem Opens PaperOS in its own maximized Edge window (Whale if Edge is missing), without the thumbnail sidebar.
setlocal
set "PDF=%~dp0PaperOS.pdf"
set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles%\Naver\Naver Whale\Application\whale.exe"
if not exist "%BROWSER%" set "BROWSER=%LocalAppData%\Naver\Naver Whale\Application\whale.exe"
if not exist "%BROWSER%" (
  echo Microsoft Edge or Naver Whale was not found.
  pause
  exit /b 1
)
rem The --app address needs its Korean letters percent-encoded.
for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command "'file:///' + [uri]::EscapeUriString($env:PDF.Replace('\','/'))"`) do set "URL=%%U"
start "" "%BROWSER%" --start-maximized --app="%URL%#navpanes=0&view=Fit" %*
