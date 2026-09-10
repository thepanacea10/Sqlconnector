@echo off

cd /d E:\Test_Almohaseb_Old\TeryaqSQLConnector

echo Starting Teryaq services...

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-backend-production.ps1"

powershell.exe -NoProfile -Command "Start-Sleep -Seconds 5"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "if (-not (Get-NetTCPConnection -LocalPort 5180 -State Listen -ErrorAction SilentlyContinue)) { Start-Process -FilePath 'E:\Test_Almohaseb_Old\teryaq-flow\start-flow-production.bat' -WorkingDirectory 'E:\Test_Almohaseb_Old\teryaq-flow' -WindowStyle Hidden }"

echo Teryaq startup commands completed.
