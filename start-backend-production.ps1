param(
  [switch]$Restart,
  [int]$StartupTimeoutSeconds = 20
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendPort = 3001
$HashName = "STOCK_CHECK_PIN_HASH"

function Get-BackendListenerPids {
  $listenerPids = @()
  $lines = & netstat -ano
  foreach ($line in $lines) {
    $parts = $line -split "\s+" | Where-Object { $_ }
    if ($parts.Count -ge 5 -and $parts[0] -eq "TCP" -and $parts[3] -eq "LISTENING") {
      $localAddress = $parts[1]
      $owningProcess = 0
      if (($localAddress -match ":$BackendPort$") -and [int]::TryParse($parts[4], [ref]$owningProcess)) {
        $listenerPids += $owningProcess
      }
    }
  }
  return @($listenerPids | Select-Object -Unique)
}

$storedHash = (Get-ItemProperty -Path "HKCU:\Environment" -Name $HashName -ErrorAction SilentlyContinue).$HashName
if ([string]::IsNullOrWhiteSpace($storedHash)) {
  Write-Error "$HashName is not configured in the Windows User Environment. Backend was not started."
  exit 1
}

if ($storedHash -notmatch "^scrypt:v1:[0-9a-fA-F]+:[0-9a-fA-F]+:[0-9]+$") {
  Write-Error "$HashName is configured but does not look like a supported scrypt hash. Backend was not started."
  exit 1
}

$backendPids = @(Get-BackendListenerPids)
if ($backendPids.Count -gt 0) {
  if (-not $Restart) {
    Write-Host "Backend port $BackendPort is already listening on PID(s): $($backendPids -join ', ')."
    exit 0
  }

  foreach ($processId in $backendPids) {
    Write-Host "Stopping backend listener PID $processId on port $BackendPort..."
    Stop-Process -Id $processId -Force -ErrorAction Stop
  }

  $stopDeadline = (Get-Date).AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 500
    $backendPids = @(Get-BackendListenerPids)
    if ($backendPids.Count -eq 0) { break }
  } while ((Get-Date) -lt $stopDeadline)

  if ($backendPids.Count -gt 0) {
    Write-Error "Backend port $BackendPort is still in use. Backend was not restarted."
    exit 1
  }
}

$env:STOCK_CHECK_PIN_HASH = $storedHash
try {
  $process = Start-Process `
    -FilePath "node" `
    -ArgumentList @("backend/server.js") `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -PassThru
} finally {
  Remove-Item Env:\STOCK_CHECK_PIN_HASH -ErrorAction SilentlyContinue
  $storedHash = $null
}

$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
do {
  Start-Sleep -Milliseconds 500
  $started = @(Get-BackendListenerPids | Where-Object { $_ -eq $process.Id })
  if ($started) {
    Write-Host "Backend started on port $BackendPort with PID $($process.Id)."
    exit 0
  }
} while ((Get-Date) -lt $deadline)

Write-Error "Backend process PID $($process.Id) did not start listening on port $BackendPort within $StartupTimeoutSeconds seconds."
exit 1
