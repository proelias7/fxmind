# fxmind desktop host: compiles desktop-native.cs once and answers one JSON
# request per line on stdin with one JSON response per line on stdout.
# Started by scripts/desktop-agent.js with Windows PowerShell 5.1 (-MTA).
param([Parameter(Mandatory = $true)][string]$Source)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$writer = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$writer.AutoFlush = $true

function Write-Reply($reply) {
  $writer.WriteLine(($reply | ConvertTo-Json -Compress -Depth 8))
}

function Get-ErrorMessage($record) {
  $exception = $record.Exception
  while ($exception.InnerException) { $exception = $exception.InnerException }
  return $exception.Message
}

try {
  $names = 'System.Drawing', 'UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'
  Add-Type -AssemblyName $names
  $references = foreach ($name in $names) {
    ([AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $_.GetName().Name -eq $name } | Select-Object -First 1).Location
  }
  Add-Type -Path $Source -ReferencedAssemblies $references
  [FxmindDesktop.Native]::Init()
  Write-Reply @{ ready = $true }
} catch {
  Write-Reply @{ ready = $false; error = (Get-ErrorMessage $_) }
  exit 1
}

while ($true) {
  $line = $reader.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $id = $null
  try {
    $request = $line | ConvertFrom-Json
    $id = $request.id
    $p = $request.params
    $value = $null
    switch ([string]$request.op) {
      'screen'       { $value = [FxmindDesktop.Native]::Screen() }
      'foreground'   { $value = [FxmindDesktop.Native]::Foreground() }
      'capture'      { $value = [FxmindDesktop.Native]::Capture([string]$p.screen, [int]$p.maxWidth, [int]$p.quality) }
      'click'        { $value = [FxmindDesktop.Native]::Click([int]$p.x, [int]$p.y, [string]$p.button) }
      'type'         { $value = [FxmindDesktop.Native]::TypeText([string]$p.text) }
      'scroll'       { $value = [FxmindDesktop.Native]::Scroll([int]$p.delta) }
      'drag'         { $value = [FxmindDesktop.Native]::Drag([int]$p.x, [int]$p.y, [int]$p.toX, [int]$p.toY, [int]$p.durationMs, [string]$p.button) }
      'chord'        { [FxmindDesktop.Native]::PressChord([int[]]@($p.keys)); $value = @{ dispatched = $true } }
      'hover'        { $value = [FxmindDesktop.Native]::Hover([int]$p.x, [int]$p.y) }
      'double_click' { $value = [FxmindDesktop.Native]::DoubleClick([int]$p.x, [int]$p.y) }
      'window'       { $value = [FxmindDesktop.Native]::WindowInfo([string]$p.title, [uint32]$p.pid) }
      'activate'     { $value = [FxmindDesktop.Native]::Activate([string]$p.title, [uint32]$p.pid, [int]$p.timeoutMs) }
      'uia_inspect'  { $value = [FxmindDesktop.Native]::UiaInspect([string]$p.windowTitle, [uint32]$p.pid, [int]$p.limit) }
      'uia_task'     {
        $value = [FxmindDesktop.Native]::UiaTask([string]$p.windowTitle, [uint32]$p.pid,
          [string[]]@($p.ops), [string[]]@($p.names), [string[]]@($p.ids), [int[]]@($p.types),
          [string[]]@($p.values), [int[]]@($p.timeouts))
      }
      default { throw "unknown desktop op: $($request.op)" }
    }
    Write-Reply @{ id = $id; ok = $true; value = $value }
  } catch {
    Write-Reply @{ id = $id; ok = $false; error = (Get-ErrorMessage $_) }
  }
}
