@echo off

echo Checking Backend...
curl http://localhost:3001/api/status

echo.
echo Checking Frontend...
curl http://localhost:5173

pause
