[CmdletBinding()]
param([switch]$NoBrowser, [switch]$CheckOnly)

# Start the existing local review stand. Never seed, migrate, or rebuild data.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$frontRoot = Join-Path $repoRoot 'PersonnelStatus/PersonalRecordFront'
$standRoot = Join-Path $repoRoot '.local-review'
$frontScript = Join-Path $PSScriptRoot 'local-review-frontend.cjs'
$proxyScript = Join-Path $PSScriptRoot 'local-review-proxy.cjs'
# Existing processes from the previous launcher can stay alive during upgrade.
# These paths are accepted only for ownership checks; no Temp files are needed
# to start the portal after migration to the persistent runtime.
$legacyFrontScript = Join-Path $env:LOCALAPPDATA 'Temp/smart-readiness-20261007/start-frontend.cjs'
$legacyProxyScript = Join-Path $env:LOCALAPPDATA 'Temp/smart-soak-20261007/frontend-proxy.cjs'
$nodeExe = Join-Path $env:LOCALAPPDATA 'Programs/dt-tools/node-v20.20.2-win-x64/node.exe'
$runtimeFile = Join-Path $standRoot 'browser-env.json'
$buildFile = Join-Path $frontRoot '.next-build/BUILD_ID'
$mutex = New-Object System.Threading.Mutex($false, 'Local\SmartJosparlauReviewStartup')
$ownsMutex = $false

function Assert-PortOwner([int]$Port, [string]$Script, [string]$LegacyScript = '') {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        $recognized = $false
        if ($null -ne $owner -and $owner.Name -eq 'node.exe' -and $null -ne $owner.CommandLine) {
            $command = $owner.CommandLine.Replace('\', '/').ToLowerInvariant()
            $recognized = $command.Contains($Script.Replace('\', '/').ToLowerInvariant()) -or
                ($LegacyScript -ne '' -and $command.Contains($LegacyScript.Replace('\', '/').ToLowerInvariant()))
        }
        if (-not $recognized) {
            throw "Port $Port belongs to another process. Nothing was stopped."
        }
    }
    return $listeners.Count -gt 0
}

function Start-ReviewNode([int]$Port, [string]$Script, [string]$Label, [string]$LegacyScript = '') {
    if (Assert-PortOwner $Port $Script $LegacyScript) { return }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    Start-Process -FilePath $nodeExe -ArgumentList ('"' + $Script + '"') -WorkingDirectory $frontRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $standRoot "$Label-$stamp.log") `
        -RedirectStandardError (Join-Path $standRoot "$Label-$stamp.err.log") | Out-Null
}

try {
    $ownsMutex = $mutex.WaitOne(0)
    if (-not $ownsMutex) { throw 'Another local portal startup is already running.' }
    foreach ($required in @($frontScript, $proxyScript, $nodeExe, $runtimeFile, $buildFile)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required local stand file is missing: $required" }
    }
    $runtime = Get-Content -LiteralPath $runtimeFile -Encoding UTF8 -Raw | ConvertFrom-Json
    if ($runtime.PR_DB_NAME -ne 'smart_soak_20261007' -or $runtime.BACKEND_URL -ne 'http://127.0.0.1:18345') {
        throw 'Local runtime does not identify the expected review database and API.'
    }
    & $nodeExe $frontScript --check
    if ($LASTEXITCODE -ne 0) { throw 'Compiled frontend routes do not match the local review runtime.' }
    $null = Assert-PortOwner 3346 $frontScript $legacyFrontScript
    $null = Assert-PortOwner 3345 $proxyScript $legacyProxyScript
    $containers = @('smart-soak-20261007-db-1', 'smart-soak-20261007-redis-1',
        'smart-soak-20261007-backend-1', 'smart-soak-20261007-worker-1', 'smart-local-media-20261008-soak-media-1')
    & docker info --format '{{.ServerVersion}}' 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop, wait until its engine is ready, and run this launcher again.' }
    foreach ($container in $containers) {
        $name = & docker inspect --format '{{.Name}}' $container 2>&1
        if ($LASTEXITCODE -ne 0 -or ($name -join '').Trim() -ne "/$container") { throw "Expected local container is missing: $container" }
    }
    if ($CheckOnly) {
        Write-Output 'Local runtime, build, container identities, and port owners verified. No changes made.'
        exit 0
    }
    & docker start @containers | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Unable to start the existing local containers.' }
    Start-ReviewNode 3346 $frontScript 'review-frontend' $legacyFrontScript
    Start-ReviewNode 3345 $proxyScript 'review-proxy' $legacyProxyScript
    $ready = $false
    $until = [DateTime]::UtcNow.AddSeconds(90)
    while ([DateTime]::UtcNow -lt $until) {
        try {
            $api = Invoke-WebRequest 'http://127.0.0.1:18345/api/token/' -Method Options -UseBasicParsing -TimeoutSec 5
            $portal = Invoke-WebRequest 'http://127.0.0.1:3345/api/auth/csrf/' -UseBasicParsing -TimeoutSec 5
            if ($api.StatusCode -eq 200 -and $portal.StatusCode -eq 200) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 750 }
    }
    if (-not $ready) { throw "Portal did not become ready within 90 seconds. See local runtime logs in $standRoot" }
    Write-Output 'Smart Josparlau is ready: http://localhost:3346/'
    if (-not $NoBrowser) { Start-Process 'http://localhost:3346/' }
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
