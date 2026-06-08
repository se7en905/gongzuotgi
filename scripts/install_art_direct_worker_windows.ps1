$ErrorActionPreference = 'Stop'
$InstallScriptVersion = '2026-06-08-ps51'

$Root = if ($env:ART_WORKER_HOME) { $env:ART_WORKER_HOME } elseif ($env:ART_WORKER_PROJECT_ROOT) { $env:ART_WORKER_PROJECT_ROOT } else { Join-Path $env:USERPROFILE 'ArtDirectWorker' }
$Username = $env:ART_PLATFORM_USERNAME
$Password = $env:ART_PLATFORM_PASSWORD
$Api = $env:ART_PLATFORM_API
$PollInterval = if ($env:ART_WORKER_POLL_INTERVAL_MS) { $env:ART_WORKER_POLL_INTERVAL_MS } else { '300000' }
$HeartbeatInterval = if ($env:ART_WORKER_HEARTBEAT_INTERVAL_MS) { $env:ART_WORKER_HEARTBEAT_INTERVAL_MS } else { '300000' }
$LocalCheckInterval = if ($env:ART_WORKER_LOCAL_CHECK_INTERVAL_MS) { $env:ART_WORKER_LOCAL_CHECK_INTERVAL_MS } else { '300000' }
$CodexPath = if ($env:CODEX_CLI_PATH) { $env:CODEX_CLI_PATH } else { 'codex' }

function ConvertTo-PSLiteral([string]$Value) {
  return "'" + ($Value -replace "'", "''") + "'"
}

function ConvertTo-WindowsArgument([string]$Value) {
  return '"' + $Value + '"'
}

if (-not $Api) { throw 'Missing ART_PLATFORM_API, for example: http://platform-server-ip:4288' }
if (-not $Username) { throw 'Missing ART_PLATFORM_USERNAME' }
if (-not $Password) { throw 'Missing ART_PLATFORM_PASSWORD' }

$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
if ($Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Warning 'Running as Administrator. Startup will be installed for the current Windows account. Use the member normal Windows account if that is the account used at login.'
}

try {
  $LoginUri = $Api.TrimEnd('/') + '/api/auth/login'
  $LoginBody = @{ username = $Username; password = $Password } | ConvertTo-Json
  $LoginResult = Invoke-RestMethod -Uri $LoginUri -Method Post -ContentType 'application/json' -Body $LoginBody -ErrorAction Stop
  if (-not $LoginResult.user) {
    throw 'Login API did not return a valid user'
  }
} catch {
  throw "Platform login check failed. Check platform URL, username and password: $($_.Exception.Message)"
}

$NodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCommand) {
  throw 'Missing Node.js. Install Node.js 20 or newer, then copy the startup command again.'
}
$Node = $NodeCommand.Source
$NodeVersionText = (& $Node -p "process.versions.node" 2>$null)
$NodeMajor = 0
if ($NodeVersionText) {
  $NodeVersionParts = $NodeVersionText.Split('.')
  $NodeMajor = [int]$NodeVersionParts[0]
}
if ($NodeMajor -lt 20) {
  throw "Node.js version is too old: $NodeVersionText. Install Node.js 20 or newer."
}

$CodexCommand = Get-Command $CodexPath -ErrorAction SilentlyContinue
if (-not $CodexCommand) {
  throw 'Missing Codex CLI. Confirm codex --help works on this computer, then run the startup command again.'
}
$CodexPath = $CodexCommand.Source

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

Get-ChildItem -Path $StartupDir -Filter 'ArtDirectWorker-*.lnk' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -ne $StartupShortcut } |
  Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path $StartupDir -Filter 'ArtDirectWorker-*.cmd' -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue

if (-not (Test-Path $Worker)) {
  throw "Missing $Worker. Copy the worker command from the platform again first."
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
`$env:ART_WORKER_LOCAL_CHECK_INTERVAL_MS = $(ConvertTo-PSLiteral $LocalCheckInterval)
`$env:CODEX_CLI_PATH = $(ConvertTo-PSLiteral $CodexPath)
& $(ConvertTo-PSLiteral $Node) $(ConvertTo-PSLiteral $Worker) *>> $(ConvertTo-PSLiteral (Join-Path $LogDir "art-direct-worker.$SafeUsername.log"))
"@ | Set-Content -Path $Runner -Encoding UTF8

if (-not (Test-Path $Runner)) {
  throw "Failed to write worker runner: $Runner"
}

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($StartupShortcut)
$RunnerArgument = ConvertTo-WindowsArgument $Runner
$Shortcut.TargetPath = 'powershell.exe'
$Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File $RunnerArgument"
$Shortcut.WorkingDirectory = $Root
$Shortcut.WindowStyle = 7
$Shortcut.Description = 'Art platform direct worker'
$Shortcut.Save()
if (-not (Test-Path $StartupShortcut)) {
  throw "Failed to create startup shortcut: $StartupShortcut"
}

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

if ($existing) {
  foreach ($process in $existing) {
    try {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
      Write-Host "stopped stale worker process $($process.ProcessId)"
    } catch {
      Write-Host "failed to stop stale worker process $($process.ProcessId): $($_.Exception.Message)"
    }
  }
  Start-Sleep -Seconds 1
}

$StartArguments = "-NoProfile -ExecutionPolicy Bypass -File $RunnerArgument"
Start-Process -FilePath 'powershell.exe' -ArgumentList $StartArguments -WorkingDirectory $Root -WindowStyle Minimized
Start-Sleep -Seconds 3
$started = @()
try {
  $started = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop |
    Where-Object { $_.CommandLine -like '*art-direct-worker.mjs*' -and $_.CommandLine -like "*$Root*" }
} catch {
  $started = @()
}
if (-not $started) {
  Write-Warning "Startup shortcut was created, but no running node.exe worker was detected. Check log: $(Join-Path $LogDir "art-direct-worker.$SafeUsername.log")"
}
Write-Host "started $TaskName"
Write-Host "installed startup $TaskName"
Write-Host "startup $StartupShortcut"
Write-Host "runner $Runner"
Write-Host "install script version $InstallScriptVersion"
