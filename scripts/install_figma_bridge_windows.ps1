$ErrorActionPreference = 'Stop'
$InstallScriptVersion = '2026-07-09-figma-bridge-minimal'

$Root = if ($env:ART_WORKER_HOME) { $env:ART_WORKER_HOME } elseif ($env:ART_WORKER_PROJECT_ROOT) { $env:ART_WORKER_PROJECT_ROOT } else { Join-Path $env:USERPROFILE 'ArtDirectWorker' }
$Api = if ($env:ART_PLATFORM_API) { $env:ART_PLATFORM_API } elseif ($env:API_BASE) { $env:API_BASE } else { '' }
$Port = if ($env:FIGMA_BRIDGE_PORT) { $env:FIGMA_BRIDGE_PORT } else { '9530' }

if (-not $Api) { throw 'Missing ART_PLATFORM_API, for example: http://platform-server-ip:4288' }

$BridgeRoot = Join-Path $Root 'figma-bridge'
$PluginRoot = Join-Path $BridgeRoot 'figma-plugin'
$Service = Join-Path $BridgeRoot 'figma-bridge-service.mjs'
$Runner = Join-Path $BridgeRoot 'run-figma-bridge-windows.ps1'
$Log = Join-Path $BridgeRoot 'figma-bridge.log'

New-Item -ItemType Directory -Force -Path $BridgeRoot | Out-Null
New-Item -ItemType Directory -Force -Path $PluginRoot | Out-Null

$Base = $Api.TrimEnd('/')
Invoke-WebRequest -UseBasicParsing -Uri "$Base/worker/figma-bridge-service.mjs" -OutFile $Service -ErrorAction Stop
Invoke-WebRequest -UseBasicParsing -Uri "$Base/worker/figma-bridge-plugin/manifest.json" -OutFile (Join-Path $PluginRoot 'manifest.json') -ErrorAction Stop
Invoke-WebRequest -UseBasicParsing -Uri "$Base/worker/figma-bridge-plugin/code.js" -OutFile (Join-Path $PluginRoot 'code.js') -ErrorAction Stop
Invoke-WebRequest -UseBasicParsing -Uri "$Base/worker/figma-bridge-plugin/ui.html" -OutFile (Join-Path $PluginRoot 'ui.html') -ErrorAction Stop

$NodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCommand) { throw 'Missing Node.js. Install Node.js 20 or newer, then run this command again.' }
$Node = $NodeCommand.Source

@"
`$ErrorActionPreference = 'Stop'
Set-Location '$BridgeRoot'
`$env:FIGMA_BRIDGE_PORT = '$Port'
while (`$true) {
  & '$Node' '$Service' *>> '$Log'
  Add-Content -Path '$Log' -Value ("[" + (Get-Date).ToString("s") + "] figma bridge exited, restarting in 5 seconds. exitCode=" + `$LASTEXITCODE)
  Start-Sleep -Seconds 5
}
"@ | Set-Content -Path $Runner -Encoding UTF8

$SafeUser = ($env:USERNAME -replace '[\\/:*?"<>|]', '_')
$TaskName = "ArtFigmaBridge-$SafeUser"
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DisallowStartIfOnBatteries:$false -StartWhenAvailable

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host ''
Write-Host "Figma bridge service installed and started."
Write-Host "Plugin folder:"
Write-Host $PluginRoot
Write-Host ''
Write-Host "Next: In Figma Desktop, import this plugin folder via Plugins > Development > Import plugin from manifest, then keep the plugin window open."
Write-Host "Health check: http://127.0.0.1:$Port/health"
