@echo off
setlocal

echo.
echo  INSTINTO - Instalador de Auto-arranque
echo  ----------------------------------------
echo.

:: Ruta de este directorio
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

:: Ruta al archivo iniciar.bat
set "BAT=%SCRIPT_DIR%\iniciar.bat"

if not exist "%BAT%" (
  echo  ERROR: No se encontro iniciar.bat en la misma carpeta.
  echo  Asegurate de copiar ambos archivos juntos.
  echo.
  pause
  exit /b 1
)

:: Crear tarea en el Programador de tareas
set "TASK=Instinto Print Server"

schtasks /create /tn "%TASK%" /tr "\"%BAT%\"" /sc ONLOGON /rl HIGHEST /f >nul 2>&1

if %ERRORLEVEL% EQU 0 (
  echo  OK - Auto-arranque instalado correctamente.
  echo.
  echo  Que pasa ahora:
  echo  - Cada vez que enciendas la PC el servidor arranca solo.
  echo  - Si necesitas cerrarlo: Administrador de tareas ^> busca "node.exe"
  echo  - Para desinstalar: ejecuta DESINSTALAR-AUTOARRANQUE.bat
  echo.
  echo  Iniciando el servidor ahora...
  start "" "%BAT%"
) else (
  echo  Intento alternativo: agregando al inicio de Windows...
  set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
  copy /y "%BAT%" "%STARTUP%\instinto-print-server.bat" >nul 2>&1
  if %ERRORLEVEL% EQU 0 (
    echo  OK - Agregado a la carpeta de inicio de Windows.
    echo  El servidor arrancara automaticamente al iniciar sesion.
    echo.
    start "" "%BAT%"
  ) else (
    echo  ERROR - No se pudo instalar el auto-arranque.
    echo  Ejecuta este archivo como Administrador:
    echo  clic derecho sobre INSTALAR-AUTOARRANQUE.bat ^> "Ejecutar como administrador"
  )
)

echo.
pause
endlocal
