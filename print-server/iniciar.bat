@echo off
cd /d "%~dp0"
title INSTINTO - Servidor de Impresion
echo.
echo  INSTINTO - Servidor de Impresion
echo  Impresoras: Cocina 192.168.1.71 / Barra 192.168.1.76 / Caja 192.168.1.73
echo  No cierres esta ventana.
echo.
node server.js
echo.
echo  El servidor se detuvo. Presiona cualquier tecla para reiniciar.
pause >nul
start "" "%~f0"
