[CmdletBinding()]
param(
  [ValidateRange(1, 24)]
  [int] $Hours = 10,

  [switch] $Supervisor,

  [int] $TunnelPid,
  [int] $AppPid,
  [int] $AppStartedByScript = 0,
  [string] $StateFile,
  [string] $StopFile,
  [string] $TunnelLog
)

$ErrorActionPreference = 'Stop'
$appRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workspaceRoot = (Resolve-Path (Join-Path $appRoot '..\..')).Path
$runtimeDirectory = Join-Path $workspaceRoot 'work\publicacao-pulso'
$cloudflaredDirectory = Join-Path $workspaceRoot 'work\cloudflared'
$cloudflaredPath = Join-Path $cloudflaredDirectory 'cloudflared.exe'

function Save-State {
  param(
    [string] $Status,
    [string] $Url,
    [datetimeoffset] $StartedAt,
    [datetimeoffset] $EndsAt,
    [string] $Message = ''
  )

  $state = [ordered]@{
    status             = $Status
    url                = $Url
    startedAt          = $StartedAt.ToString('o')
    endsAt             = $EndsAt.ToString('o')
    tunnelPid          = $TunnelPid
    appPid             = $AppPid
    appStartedByScript = [bool]$AppStartedByScript
    supervisorPid      = $PID
    message            = $Message
  }

  $state | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding utf8
}

if ($Supervisor) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PulsoAwake {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
'@

  $continuous = [uint32]2147483648
  $keepSystemAwake = [uint32]2147483649
  $startedAt = [datetimeoffset]::UtcNow
  $endsAt = $startedAt.AddHours($Hours)
  $url = ''

  try {
    [void][PulsoAwake]::SetThreadExecutionState($keepSystemAwake)

    for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
      if (Test-Path $TunnelLog) {
        $logContent = Get-Content -LiteralPath $TunnelLog -Raw -ErrorAction SilentlyContinue
        $urlMatch = [regex]::Match($logContent, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($urlMatch.Success) {
          $url = $urlMatch.Value
          break
        }
      }
      Start-Sleep -Seconds 1
    }

    if (-not $url) {
      throw 'A Cloudflare não retornou uma URL dentro de 60 segundos.'
    }

    Save-State -Status 'running' -Url $url -StartedAt $startedAt -EndsAt $endsAt

    while ([datetimeoffset]::UtcNow -lt $endsAt) {
      if (Test-Path $StopFile) {
        Save-State -Status 'stopping' -Url $url -StartedAt $startedAt -EndsAt $endsAt -Message 'Parada solicitada.'
        break
      }

      if (-not (Get-Process -Id $TunnelPid -ErrorAction SilentlyContinue)) {
        Save-State -Status 'stopped' -Url $url -StartedAt $startedAt -EndsAt $endsAt -Message 'O túnel foi encerrado antes do prazo.'
        return
      }

      if (-not (Get-Process -Id $AppPid -ErrorAction SilentlyContinue)) {
        Save-State -Status 'stopped' -Url $url -StartedAt $startedAt -EndsAt $endsAt -Message 'A aplicação local foi encerrada.'
        return
      }

      Start-Sleep -Seconds 15
    }
  } catch {
    Save-State -Status 'failed' -Url $url -StartedAt $startedAt -EndsAt $endsAt -Message $_.Exception.Message
  } finally {
    $tunnelProcess = Get-Process -Id $TunnelPid -ErrorAction SilentlyContinue
    if ($tunnelProcess -and $tunnelProcess.ProcessName -eq 'cloudflared') {
      Stop-Process -Id $TunnelPid -Force -ErrorAction SilentlyContinue
    }

    if ($AppStartedByScript -eq 1) {
      $appProcess = Get-Process -Id $AppPid -ErrorAction SilentlyContinue
      if ($appProcess -and $appProcess.ProcessName -eq 'node') {
        Stop-Process -Id $AppPid -Force -ErrorAction SilentlyContinue
      }
    }

    [void][PulsoAwake]::SetThreadExecutionState($continuous)
    Remove-Item -LiteralPath $StopFile -Force -ErrorAction SilentlyContinue

    if (Test-Path $StateFile) {
      $currentState = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
      if ($currentState.status -in @('running', 'stopping')) {
        Save-State -Status 'completed' -Url $url -StartedAt $startedAt -EndsAt $endsAt -Message 'Publicação encerrada.'
      }
    }
  }

  return
}

New-Item -ItemType Directory -Force -Path $runtimeDirectory, $cloudflaredDirectory | Out-Null

if (-not (Test-Path $cloudflaredPath)) {
  $downloadArguments = @{
    Uri     = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    OutFile = $cloudflaredPath
  }
  Invoke-WebRequest @downloadArguments
}

$listener = Get-NetTCPConnection -State Listen -LocalPort 4173 -ErrorAction SilentlyContinue | Select-Object -First 1
$startedApp = $false

if ($listener) {
  $applicationPid = $listener.OwningProcess
} else {
  $nodePath = (Get-Command node -ErrorAction Stop).Source
  $appOutLog = Join-Path $runtimeDirectory 'app.out.log'
  $appErrorLog = Join-Path $runtimeDirectory 'app.err.log'
  $previousHost = $env:HOST
  $previousPort = $env:PORT

  try {
    $env:HOST = '127.0.0.1'
    $env:PORT = '4173'
    $appProcessArguments = @{
      FilePath               = $nodePath
      ArgumentList           = @('server/index.mjs')
      WorkingDirectory       = $appRoot
      WindowStyle            = 'Hidden'
      RedirectStandardOutput = $appOutLog
      RedirectStandardError  = $appErrorLog
      PassThru               = $true
    }
    $appProcess = Start-Process @appProcessArguments
    $applicationPid = $appProcess.Id
    $startedApp = $true
  } finally {
    $env:HOST = $previousHost
    $env:PORT = $previousPort
  }

  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    if (Get-NetTCPConnection -State Listen -LocalPort 4173 -ErrorAction SilentlyContinue) {
      break
    }
    Start-Sleep -Seconds 1
  }

  if (-not (Get-NetTCPConnection -State Listen -LocalPort 4173 -ErrorAction SilentlyContinue)) {
    throw 'A aplicação não iniciou na porta 4173.'
  }
}

$sessionId = [guid]::NewGuid().ToString('N')
$statePath = Join-Path $runtimeDirectory "publication-$sessionId.json"
$stopPath = Join-Path $runtimeDirectory "publication-$sessionId.stop"
$tunnelLogPath = Join-Path $runtimeDirectory "tunnel-$sessionId.log"
$tunnelErrorLog = Join-Path $runtimeDirectory "tunnel-$sessionId.err.log"
$supervisorOutLog = Join-Path $runtimeDirectory "supervisor-$sessionId.out.log"
$supervisorErrorLog = Join-Path $runtimeDirectory "supervisor-$sessionId.err.log"

$tunnelProcessArguments = @{
  FilePath     = $cloudflaredPath
  ArgumentList = @(
    '--no-autoupdate',
    '--loglevel', 'info',
    '--logfile', $tunnelLogPath,
    'tunnel',
    '--url', 'http://127.0.0.1:4173'
  )
  WindowStyle           = 'Hidden'
  RedirectStandardError = $tunnelErrorLog
  PassThru               = $true
}
$tunnelProcess = Start-Process @tunnelProcessArguments

$powerShellPath = (Get-Process -Id $PID).Path
$supervisorArguments = @(
  '-NoLogo',
  '-NoProfile',
  '-File', $PSCommandPath,
  '-Supervisor',
  '-Hours', $Hours,
  '-TunnelPid', $tunnelProcess.Id,
  '-AppPid', $applicationPid,
  '-AppStartedByScript', $(if ($startedApp) { 1 } else { 0 }),
  '-StateFile', $statePath,
  '-StopFile', $stopPath,
  '-TunnelLog', $tunnelLogPath
)

$supervisorProcessArguments = @{
  FilePath               = $powerShellPath
  ArgumentList           = $supervisorArguments
  WindowStyle            = 'Hidden'
  RedirectStandardOutput = $supervisorOutLog
  RedirectStandardError  = $supervisorErrorLog
  PassThru               = $true
}
$supervisorProcess = Start-Process @supervisorProcessArguments

for ($attempt = 0; $attempt -lt 70; $attempt += 1) {
  $supervisorProcess.Refresh()
  if ($supervisorProcess.HasExited -and -not (Test-Path $statePath)) {
    Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
    $supervisorError = if (Test-Path $supervisorErrorLog) {
      Get-Content -LiteralPath $supervisorErrorLog -Raw
    } else {
      'sem log de erro'
    }
    throw "O supervisor não iniciou: $supervisorError"
  }

  if (Test-Path $statePath) {
    $publicationState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($publicationState.status -eq 'running') {
      [PSCustomObject]@{
        Url           = $publicationState.url
        Inicio        = $publicationState.startedAt
        Termino       = $publicationState.endsAt
        TunnelPid     = $publicationState.tunnelPid
        SupervisorPid = $supervisorProcess.Id
        StateFile     = $statePath
        StopFile      = $stopPath
      }
      return
    }

    if ($publicationState.status -eq 'failed') {
      throw $publicationState.message
    }
  }
  Start-Sleep -Seconds 1
}

Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
throw 'A publicação não ficou pronta dentro de 70 segundos.'
