@echo off

cd /d E:\Test_Almohaseb_Old\TeryaqSQLConnector

start "Teryaq Backend" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-backend-production.ps1" -Restart

timeout /t 5 >nul

start "Teryaq Frontend" cmd /k npm.cmd run frontend
