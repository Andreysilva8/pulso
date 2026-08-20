[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$appRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workspaceRoot = (Resolve-Path (Join-Path $appRoot '..\..')).Path
$runtimeDirectory = Join-Path $workspaceRoot 'work\publicacao-pulso'

if (-not (Test-Path $runtimeDirectory)) {
  Write-Output 'Nenhuma publicação supervisionada foi encontrada.'
  return
}

$runningState = Get-ChildItem -LiteralPath $runtimeDirectory -Filter 'publication-*.json' |
  Sort-Object LastWriteTime -Descending |
  ForEach-Object {
      $state = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
      if ($state.status -in @('running', 'stopping')) {
        [PSCustomObject]@{ File = $_.FullName; State = $state }
      }
    } |
  Select-Object -First 1

if (-not $runningState) {
  Write-Output 'Nenhuma publicação ativa foi encontrada.'
  return
}

$sessionId = [IO.Path]::GetFileNameWithoutExtension($runningState.File).Replace('publication-', '')
$stopFile = Join-Path $runtimeDirectory "publication-$sessionId.stop"
New-Item -ItemType File -Force -Path $stopFile | Out-Null

Write-Output 'Parada solicitada. O supervisor encerrará o túnel em até 15 segundos.'
