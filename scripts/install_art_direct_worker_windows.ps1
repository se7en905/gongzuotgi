$ErrorActionPreference = 'Stop'

$Root = if ($env:ART_WORKER_HOME) { $env:ART_WORKER_HOME } elseif ($env:ART_WORKER_PROJECT_ROOT) { $env:ART_WORKER_PROJECT_ROOT } else { Join-Path $env:USERPROFILE 'ArtDirectWorker' }
$Username = $env:ART_PLATFORM_USERNAME
$Password = $env:ART_PLATFORM_PASSWORD
$Api = $env:ART_PLATFORM_API
$PollInterval = if ($env:ART_WORKER_POLL_INTERVAL_MS) { $env:ART_WORKER_POLL_INTERVAL_MS } else { '300000' }
$HeartbeatInterval = if ($env:ART_WORKER_HEARTBEAT_INTERVAL_MS) { $env:ART_WORKER_HEARTBEAT_INTERVAL_MS } else { '300000' }
$CodexPath = if ($env:CODEX_CLI_PATH) { $env:CODEX_CLI_PATH } else { 'codex' }

if (-not $Api) { throw '缺少 ART_PLATFORM_API，例如：http://工作台服务器IP:4288' }
if (-not $Username) { throw '缺少 ART_PLATFORM_USERNAME' }
if (-not $Password) { throw '缺少 ART_PLATFORM_PASSWORD' }

$Node = (Get-Command node -ErrorAction Stop).Source
$TaskName = "ArtDirectWorker-$Username"
$LogDir = Join-Path $Root 'logs'
$Worker = Join-Path $Root 'scripts\art-direct-worker.mjs'
$Runner = Join-Path $Root 'scripts\run-art-direct-worker-windows.ps1'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'scripts') | Out-Null

if (-not (Test-Path $Worker)) {
  throw "缺少 $Worker，请先通过工作台复制命令下载 Worker。"
}

@"
`$ErrorActionPreference = 'Stop'
Set-Location '$Root'
`$env:ART_PLATFORM_API = '$Api'
`$env:ART_PLATFORM_USERNAME = '$Username'
`$env:ART_PLATFORM_PASSWORD = '$Password'
`$env:ART_WORKER_PROJECT_ROOT = '$Root'
`$env:ART_WORKER_POLL_INTERVAL_MS = '$PollInterval'
`$env:ART_WORKER_HEARTBEAT_INTERVAL_MS = '$HeartbeatInterval'
`$env:CODEX_CLI_PATH = '$CodexPath'
& '$Node' '$Worker' *>> '$LogDir\art-direct-worker.$Username.log'
"@ | Set-Content -Path $Runner -Encoding UTF8

$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`"" -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$Task = New-ScheduledTask -Action $Action -Trigger $Trigger -Principal $Principal -Description '美术工作台本机直接执行 Worker'

Register-ScheduledTask -TaskName $TaskName -InputObject $Task -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "installed $TaskName"
Write-Host "runner $Runner"
