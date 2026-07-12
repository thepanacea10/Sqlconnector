$ProjectDir = 'E:\Test_Almohaseb_Old\TeryaqSQLConnector'
$BatchPath = Join-Path $ProjectDir 'start-teryaq.bat'
$StartupFolder = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$ShortcutPath = Join-Path $StartupFolder 'Teryaq SQL Connector.lnk'

if (-not (Test-Path -LiteralPath $BatchPath)) {
  throw "Startup batch file not found: $BatchPath"
}

if (-not (Test-Path -LiteralPath $StartupFolder)) {
  New-Item -ItemType Directory -Path $StartupFolder -Force | Out-Null
}

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $BatchPath
$Shortcut.WorkingDirectory = $ProjectDir
$Shortcut.Description = 'Start Teryaq SQL Connector backend and frontend'
$Shortcut.Save()

Write-Host "Created startup shortcut:"
Write-Host $ShortcutPath
