@echo off

cd /d E:\Test_Almohaseb_Old\TeryaqSQLConnector

start "Teryaq Backend" cmd /k npm.cmd run backend

timeout /t 5 >nul

start "Teryaq Frontend" cmd /k npm.cmd run frontend
