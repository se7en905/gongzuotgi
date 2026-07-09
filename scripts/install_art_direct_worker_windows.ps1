$ErrorActionPreference = 'Stop'
$InstallScriptVersion = '2026-07-08-windows-worker-startup-stability'

$Root = if ($env:ART_WORKER_HOME) { $env:ART_WORKER_HOME } elseif ($env:ART_WORKER_PROJECT_ROOT) { $env:ART_WORKER_PROJECT_ROOT } else { Join-Path $env:USERPROFILE 'ArtDirectWorker' }
$Username = $env:ART_PLATFORM_USERNAME
$Password = $env:ART_PLATFORM_PASSWORD
$Api = $env:ART_PLATFORM_API
$PollInterval = if ($env:ART_WORKER_POLL_INTERVAL_MS) { $env:ART_WORKER_POLL_INTERVAL_MS } else { '300000' }
$HeartbeatInterval = if ($env:ART_WORKER_HEARTBEAT_INTERVAL_MS) { $env:ART_WORKER_HEARTBEAT_INTERVAL_MS } else { '300000' }
$LocalCheckInterval = if ($env:ART_WORKER_LOCAL_CHECK_INTERVAL_MS) { $env:ART_WORKER_LOCAL_CHECK_INTERVAL_MS } else { '2400000' }
$OpenAiBaseUrl = if ($env:OPENAI_BASE_URL) { $env:OPENAI_BASE_URL } else { '' }
$OpenAiApiBaseUrl = if ($env:OPENAI_API_BASE_URL) { $env:OPENAI_API_BASE_URL } else { '' }
$OpenAiApiBase = if ($env:OPENAI_API_BASE) { $env:OPENAI_API_BASE } else { '' }
$HttpProxy = if ($env:HTTP_PROXY) { $env:HTTP_PROXY } elseif ($env:http_proxy) { $env:http_proxy } else { '' }
$HttpsProxy = if ($env:HTTPS_PROXY) { $env:HTTPS_PROXY } elseif ($env:https_proxy) { $env:https_proxy } else { '' }
$AllProxy = if ($env:ALL_PROXY) { $env:ALL_PROXY } elseif ($env:all_proxy) { $env:all_proxy } else { '' }
$NoProxy = if ($env:NO_PROXY) { $env:NO_PROXY } elseif ($env:no_proxy) { $env:no_proxy } else { '' }
$CodexPath = if ($env:CODEX_CLI_PATH) { $env:CODEX_CLI_PATH } else { 'codex' }
$DefaultCodexHome = Join-Path $env:USERPROFILE '.codex'
$CodexHome = if ($env:CODEX_HOME) {
  $env:CODEX_HOME
} elseif (Test-Path -LiteralPath $DefaultCodexHome) {
  $DefaultCodexHome
} elseif (Test-Path -LiteralPath 'C:\Users\Administrator\.codex') {
  'C:\Users\Administrator\.codex'
} else {
  $DefaultCodexHome
}

function ConvertTo-PSLiteral([string]$Value) {
  return "'" + ($Value -replace "'", "''") + "'"
}

function ConvertTo-WindowsArgument([string]$Value) {
  return '"' + $Value + '"'
}

function Test-UsableCodexCliPath([string]$PathValue) {
  if (-not $PathValue) { return $false }
  if ($PathValue -match '\\WindowsApps\\') { return $false }
  if (-not (Test-Path -LiteralPath $PathValue -PathType Leaf)) { return $false }
  return $true
}

function Resolve-CodexCliPath([string]$PreferredPath, [string]$WorkerRoot) {
  $Candidates = New-Object System.Collections.Generic.List[string]
  if ($PreferredPath -and $PreferredPath -ne 'codex') {
    $Candidates.Add($PreferredPath)
  }
  $Candidates.Add((Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin\codex.exe'))
  $Candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\OpenAI Codex\codex.exe'))
  $Candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\Codex\codex.exe'))
  $PackageCodex = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Packages') -Recurse -Filter codex.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like '*OpenAI*Codex*' } |
    Select-Object -First 5
  foreach ($Item in $PackageCodex) {
    if ($Item.FullName) { $Candidates.Add($Item.FullName) }
  }
  $Commands = Get-Command codex -All -ErrorAction SilentlyContinue
  foreach ($Command in $Commands) {
    if ($Command.Source) { $Candidates.Add($Command.Source) }
    if ($Command.Path) { $Candidates.Add($Command.Path) }
  }
  $Candidates.Add((Join-Path $WorkerRoot 'node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe'))
  foreach ($Candidate in ($Candidates | Select-Object -Unique)) {
    if (Test-UsableCodexCliPath $Candidate) {
      return $Candidate
    }
  }
  throw 'Missing usable Codex CLI. WindowsApps app aliases cannot be used by the background Worker. Install Codex CLI or provide CODEX_CLI_PATH as a real codex.exe path, then run the startup command again.'
}

if (-not $Api) { throw 'Missing ART_PLATFORM_API, for example: http://platform-server-ip:4288' }
if (-not $Username) { throw 'Missing ART_PLATFORM_USERNAME' }
if (-not $Password) { throw 'Missing ART_PLATFORM_PASSWORD' }

$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
if ($Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Warning 'Running as Administrator. Scheduled task will be installed for the current Windows account. Use the member normal Windows account if that is the account used at login.'
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

$SafeUsername = ($Username -replace '[\\/:*?"<>|]', '_')
$TaskName = "ArtDirectWorker-$SafeUsername"
$LogDir = Join-Path $Root 'logs'
$StateDir = Join-Path $Root 'state'
$Worker = Join-Path $Root 'scripts\art-direct-worker.mjs'
$Runner = Join-Path $Root 'scripts\run-art-direct-worker-windows.ps1'
$RunnerState = Join-Path $StateDir 'runner-status.json'
$StartupDir = [Environment]::GetFolderPath('Startup')
if (-not $StartupDir) {
  $StartupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
}
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'scripts') | Out-Null
New-Item -ItemType Directory -Force -Path $StartupDir | Out-Null

$CodexPath = Resolve-CodexCliPath $CodexPath $Root
if (-not (Test-Path -LiteralPath $CodexHome -PathType Container)) {
  Write-Warning "CODEX_HOME does not exist yet: $CodexHome. Open Codex once with this Windows account, finish Figma MCP authorization, then run this startup command again if self-check fails."
}

Get-ChildItem -Path $StartupDir -Filter 'ArtDirectWorker-*.lnk' -ErrorAction SilentlyContinue |
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
`$env:ART_WORKER_HOME = $(ConvertTo-PSLiteral $Root)
`$env:ART_WORKER_SUPERVISED = '1'
`$env:ART_WORKER_RUNNER_STATE_PATH = $(ConvertTo-PSLiteral $RunnerState)
`$env:CODEX_HOME = $(ConvertTo-PSLiteral $CodexHome)
`$env:CODEX_CLI_PATH = $(ConvertTo-PSLiteral $CodexPath)
if ($(ConvertTo-PSLiteral $OpenAiBaseUrl)) { `$env:OPENAI_BASE_URL = $(ConvertTo-PSLiteral $OpenAiBaseUrl) }
if ($(ConvertTo-PSLiteral $OpenAiApiBaseUrl)) { `$env:OPENAI_API_BASE_URL = $(ConvertTo-PSLiteral $OpenAiApiBaseUrl) }
if ($(ConvertTo-PSLiteral $OpenAiApiBase)) { `$env:OPENAI_API_BASE = $(ConvertTo-PSLiteral $OpenAiApiBase) }
if ($(ConvertTo-PSLiteral $HttpProxy)) { `$env:HTTP_PROXY = $(ConvertTo-PSLiteral $HttpProxy) }
if ($(ConvertTo-PSLiteral $HttpsProxy)) { `$env:HTTPS_PROXY = $(ConvertTo-PSLiteral $HttpsProxy) }
if ($(ConvertTo-PSLiteral $AllProxy)) { `$env:ALL_PROXY = $(ConvertTo-PSLiteral $AllProxy) }
if ($(ConvertTo-PSLiteral $NoProxy)) { `$env:NO_PROXY = $(ConvertTo-PSLiteral $NoProxy) }
while (`$true) {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri ((`$env:ART_PLATFORM_API).TrimEnd('/') + '/worker/art-direct-worker.mjs') -OutFile $(ConvertTo-PSLiteral $Worker) -ErrorAction Stop
  } catch {
    Add-Content -Path $(ConvertTo-PSLiteral (Join-Path $LogDir "art-direct-worker.$SafeUsername.log")) -Value ("[" + (Get-Date).ToString("s") + "] worker update download failed: " + `$_.Exception.Message)
  }
  & $(ConvertTo-PSLiteral $Node) $(ConvertTo-PSLiteral $Worker) *>> $(ConvertTo-PSLiteral (Join-Path $LogDir "art-direct-worker.$SafeUsername.log"))
  `$runnerExitCode = if (`$null -eq `$LASTEXITCODE) { -1 } else { [int]`$LASTEXITCODE }
  `$runnerExitAt = (Get-Date).ToString("s")
  `$runnerReason = if (`$runnerExitCode -eq 0) { 'Worker exited; runner will restart in 5 seconds.' } else { "Worker exited unexpectedly; runner will restart in 5 seconds. exitCode=`$runnerExitCode" }
  @{ lastExitCode = `$runnerExitCode; lastExitAt = `$runnerExitAt; lastExitReason = `$runnerReason } | ConvertTo-Json -Compress | Set-Content -Path $(ConvertTo-PSLiteral $RunnerState) -Encoding UTF8
  Add-Content -Path $(ConvertTo-PSLiteral (Join-Path $LogDir "art-direct-worker.$SafeUsername.log")) -Value ("[" + `$runnerExitAt + "] worker process exited, restarting in 5 seconds. exitCode=" + `$runnerExitCode)
  Start-Sleep -Seconds 5
}
"@ | Set-Content -Path $Runner -Encoding UTF8

if (-not (Test-Path $Runner)) {
  throw "Failed to write worker runner: $Runner"
}

$RunnerArgument = ConvertTo-WindowsArgument $Runner

try {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
} catch {
}

try {
  $existing = Get-CimInstance Win32_Process -ErrorAction Stop |
    Where-Object {
      (
        $_.Name -eq 'node.exe' -and $_.CommandLine -like '*art-direct-worker.mjs*' -and $_.CommandLine -like "*$Root*"
      ) -or (
        ($_.Name -eq 'powershell.exe' -or $_.Name -eq 'pwsh.exe') -and $_.CommandLine -like '*run-art-direct-worker-windows.ps1*' -and $_.CommandLine -like "*$Root*"
      )
    }
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

$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $RunnerArgument"
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $Identity.Name
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
$PrincipalConfig = New-ScheduledTaskPrincipal -UserId $Identity.Name -LogonType Interactive -RunLevel Limited
try {
  Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $PrincipalConfig -Description 'Art platform direct worker' -Force | Out-Null
} catch {
  Write-Warning "Scheduled task principal registration failed, retrying with current user defaults: $($_.Exception.Message)"
  Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description 'Art platform direct worker' -Force | Out-Null
}

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 5
$started = @()
try {
  $started = Get-CimInstance Win32_Process -ErrorAction Stop |
    Where-Object {
      (
        $_.Name -eq 'node.exe' -and $_.CommandLine -like '*art-direct-worker.mjs*' -and $_.CommandLine -like "*$Root*"
      ) -or (
        ($_.Name -eq 'powershell.exe' -or $_.Name -eq 'pwsh.exe') -and $_.CommandLine -like '*run-art-direct-worker-windows.ps1*' -and $_.CommandLine -like "*$Root*"
      )
    }
} catch {
  $started = @()
}
if (-not $started) {
  Write-Warning "Scheduled task was created, but no running worker process was detected. Check log: $(Join-Path $LogDir "art-direct-worker.$SafeUsername.log")"
}
Write-Host "started $TaskName"
Write-Host "installed scheduled task $TaskName"
Write-Host "runner $Runner"
Write-Host "codex home $CodexHome"
Write-Host "install script version $InstallScriptVersion"
