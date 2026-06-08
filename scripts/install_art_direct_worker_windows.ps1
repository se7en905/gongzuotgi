$ErrorActionPreference = 'Stop'

$Root = if ($env:ART_WORKER_HOME) { $env:ART_WORKER_HOME } elseif ($env:ART_WORKER_PROJECT_ROOT) { $env:ART_WORKER_PROJECT_ROOT } else { Join-Path $env:USERPROFILE 'ArtDirectWorker' }
$Username = $env:ART_PLATFORM_USERNAME
$Password = $env:ART_PLATFORM_PASSWORD
$Api = $env:ART_PLATFORM_API
$PollInterval = if ($env:ART_WORKER_POLL_INTERVAL_MS) { $env:ART_WORKER_POLL_INTERVAL_MS } else { '300000' }
$HeartbeatInterval = if ($env:ART_WORKER_HEARTBEAT_INTERVAL_MS) { $env:ART_WORKER_HEARTBEAT_INTERVAL_MS } else { '300000' }
$CodexPath = if ($env:CODEX_CLI_PATH) { $env:CODEX_CLI_PATH } else { 'codex' }

function ConvertTo-PSLiteral([string]$Value) {
  return "'" + ($Value -replace "'", "''") + "'"
}

if (-not $Api) { throw '缺少 ART_PLATFORM_API，例如：http://工作台服务器IP:4288' }
if (-not $Username) { throw '缺少 ART_PLATFORM_USERNAME' }
if (-not $Password) { throw '缺少 ART_PLATFORM_PASSWORD' }

$Node = (Get-Command node -ErrorAction Stop).Source
$SafeUsername = ($Username -replace '[\\/:*?"<>|]', '_')
$TaskName = "ArtDirectWorker-$SafeUsername"
$LogDir = Join-Path $Root 'logs'
$Worker = Join-Path $Root 'scripts\art-direct-worker.mjs'
$Runner = Join-Path $Root 'scripts\run-art-direct-worker-windows.ps1'
$StartupDir = [Environment]::GetFolderPath('Startup')
if (-not $StartupDir) {
  $StartupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
}
$StartupShortcut = Join-Path $StartupDir "$TaskName.lnk"
$LegacyStartupCommand = Join-Path $StartupDir "$TaskName.cmd"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'scripts') | Out-Null
New-Item -ItemType Directory -Force -Path $StartupDir | Out-Null

if (-not (Test-Path $Worker)) {
  throw "缺少 $Worker，请先通过工作台复制命令下载 Worker。"
}

@"
`$ErrorActionPreference = 'Stop'
Set-Location $(ConvertTo-PSLiteral $Root)
`$env:ART_PLATFORM_API = $(ConvertTo-PSLiteral $Api)
`$env:ART_PLATFORM_USERNAME = $(ConvertTo-PSLiteral $Username)
`$env:ART_PLATFORM_PASSWORD = $(ConvertTo-PSLiteral $Password)
`$env:ART_WORKER_PROJECT_ROOT = $(ConvertTo-PSLiteral $Root)
`$env:ART_WORKER_POLL_INTERVAL_MS = $(ConvertTo-PSLiteral $PollInterval)
`$env:ART_WORKER_HEARTBEAT_INTERVAL_MS = $(ConvertTo-PSLiteral $HeartbeatInterval)
`$env:CODEX_CLI_PATH = $(ConvertTo-PSLiteral $CodexPath)
& $(ConvertTo-PSLiteral $Node) $(ConvertTo-PSLiteral $Worker) *>> $(ConvertTo-PSLiteral (Join-Path $LogDir "art-direct-worker.$SafeUsername.log"))
"@ | Set-Content -Path $Runner -Encoding UTF8

Remove-Item -Path $LegacyStartupCommand -Force -ErrorAction SilentlyContinue

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($StartupShortcut)
$Shortcut.TargetPath = 'powershell.exe'
$Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$Runner`""
$Shortcut.WorkingDirectory = $Root
$Shortcut.WindowStyle = 7
$Shortcut.Description = '美术工作台本机直接执行 Worker'
$Shortcut.Save()

try {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
} catch {
}

try {
  $existing = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop |
    Where-Object { $_.CommandLine -like '*art-direct-worker.mjs*' -and $_.CommandLine -like "*$Root*" }
} catch {
  $existing = @()
}

if (-not $existing) {
  Start-Process -FilePath 'powershell.exe' -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`"" -WorkingDirectory $Root -WindowStyle Minimized
  Write-Host "started $TaskName"
} else {
  Write-Host "already running $TaskName"
}

Write-Host "installed startup $TaskName"
Write-Host "startup $StartupShortcut"
Write-Host "runner $Runner"
