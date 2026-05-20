@echo off
echo.
echo  INSTINTO - Desinstalar Auto-arranque
echo  ----------------------------------------
echo.

schtasks /delete /tn "Instinto Print Server" /f >nul 2>&1

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if exist "%STARTUP%\instinto-print-server.bat" (
  del /f /q "%STARTUP%\instinto-print-server.bat" >nul 2>&1
)

echo  Listo. El servidor ya no arrancara automaticamente.
echo.
pause
