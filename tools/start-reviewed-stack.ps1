param([switch]$ValidateOnly, [switch]$OpenBrowser)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$reviewedProject = 'smart-duty-summary-rehearsal-20261014'
$reviewedDatabase = 'smart_duty_summary_20261014'
$reviewedFolder = Join-Path (Split-Path -Parent $PSScriptRoot) '.local-review/duty-summary-rehearsal-20261014'
$portalAddress = 'http://127.0.0.1:3380/security-ops/duty-register/'
$releaseMeta = Get-Content -LiteralPath (Join-Path $reviewedFolder 'metadata.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$acceptanceFile = Join-Path $reviewedFolder 'acceptance.json'
if (!(Test-Path -LiteralPath $acceptanceFile)) { throw 'The final verification is still in progress. Use this launcher after the completion report.' }
$acceptance = Get-Content -LiteralPath $acceptanceFile -Encoding UTF8 -Raw | ConvertFrom-Json
if (!$acceptance.complete -or $acceptance.sourceRevision -ne $releaseMeta.sourceRevision) { throw 'The reviewed source receipt does not match this copy.' }
if ($releaseMeta.project -ne $reviewedProject -or $releaseMeta.database -ne $reviewedDatabase -or $releaseMeta.frontendPort -ne 3380 -or $releaseMeta.apiPort -ne 18380 -or $releaseMeta.dbPort -ne 15380) { throw 'Unexpected copy metadata.' }
$startupProof = Get-Content -LiteralPath (Join-Path $reviewedFolder 'verified-artifacts/result.json') -Encoding UTF8 -Raw | ConvertFrom-Json
if (!$startupProof.complete -or !$startupProof.originalRowsAndFilesUnchanged -or !$startupProof.startupDataAndFilesUnchanged) { throw 'The restore and startup proof is incomplete.' }

# The original restore receipt remains intact. A verified application-only
# update supplies current immutable image references for the same data stack.
$currentAppFile = Join-Path $reviewedFolder 'current-app.json'
if (Test-Path -LiteralPath $currentAppFile) {
    $currentApp = Get-Content -LiteralPath $currentAppFile -Encoding UTF8 -Raw | ConvertFrom-Json
    if (!$currentApp.complete -or !$currentApp.databaseRowsUnchanged -or !$currentApp.databaseVolumeUnchanged -or !$currentApp.browserVerificationPassed) { throw 'The application update verification is incomplete.' }
    foreach ($field in @('project', 'database', 'frontendPort', 'apiPort', 'dbPort')) {
        if ($currentApp.$field -ne $releaseMeta.$field) { throw 'The application update points to a different stack.' }
    }
    $releaseMeta = $currentApp
}

Push-Location -LiteralPath $reviewedFolder
try {
    $composeArgs = @('compose', '-p', $reviewedProject, '--env-file', 'images.env', '--env-file', '.env', '-f', 'docker-compose.yml', '-f', 'rehearsal.networks.json')
    $privateConfig = & docker @composeArgs config --format json
    if ($LASTEXITCODE -ne 0) { throw 'Cannot validate the local Docker configuration.' }
    $checkedConfig = $privateConfig | ConvertFrom-Json
    if ($checkedConfig.name -ne $reviewedProject -or $checkedConfig.services.db.environment.POSTGRES_DB -ne $reviewedDatabase -or !$checkedConfig.networks.default.internal) { throw 'Unexpected project or database configuration.' }
    $serviceImages = @{ backend = 'backend'; worker = 'backend'; frontend = 'frontend'; proxy = 'proxy'; db = 'postgres'; redis = 'redis' }
    if ((@($checkedConfig.services.PSObject.Properties.Name | Sort-Object) -join ',') -ne (@($serviceImages.Keys | Sort-Object) -join ',')) { throw 'Unexpected service set.' }
    foreach ($serviceName in $serviceImages.Keys) {
        $expectedImage = $releaseMeta.images.($serviceImages[$serviceName])
        if ($checkedConfig.services.$serviceName.image -ne $expectedImage.tag) { throw 'A service image does not match the reviewed release.' }
        $imageId = & docker image inspect --format '{{.Id}}' $expectedImage.tag
        if ($LASTEXITCODE -ne 0 -or $imageId.Trim() -ne $expectedImage.id) { throw 'A reviewed image is missing or changed.' }
    }
    $volumeNames = @('beat', 'media', 'postgres', 'private', 'redis', 'static')
    if ((@($checkedConfig.volumes.PSObject.Properties.Name | Sort-Object) -join ',') -ne (@($volumeNames | Sort-Object) -join ',')) { throw 'Unexpected volume set.' }
    if ((@($acceptance.volumes.PSObject.Properties.Name | Sort-Object) -join ',') -ne (@($volumeNames | Sort-Object) -join ',')) { throw 'The verified volume identities are incomplete.' }
    foreach ($volumeName in $volumeNames) {
        $volume = $checkedConfig.volumes.$volumeName
        $expectedName = $reviewedProject + '_' + $volumeName
        $identity = $acceptance.volumes.$volumeName
        if ($volume.name -ne $expectedName -or $identity.name -ne $expectedName -or ($volume.PSObject.Properties.Name -contains 'external' -and $volume.external)) { throw 'Unexpected data volume.' }
        $volumeJson = & docker volume inspect $expectedName
        if ($LASTEXITCODE -ne 0) { throw 'A verified data volume is missing. Restore the reviewed copy before starting it.' }
        $inspectedVolume = @($volumeJson | ConvertFrom-Json)[0]
        if ($inspectedVolume.Name -ne $identity.name -or $inspectedVolume.CreatedAt -ne $identity.createdAt -or $inspectedVolume.Driver -ne 'local' -or $inspectedVolume.Scope -ne 'local' -or $inspectedVolume.Labels.'com.docker.compose.project' -ne $reviewedProject -or $inspectedVolume.Labels.'com.docker.compose.volume' -ne $volumeName) { throw 'A verified data volume has been replaced or changed.' }
    }
    foreach ($service in $checkedConfig.services.PSObject.Properties) {
        if ($service.Value.PSObject.Properties.Name -contains 'volumes') {
            foreach ($mount in @($service.Value.volumes)) { if ($mount.type -ne 'volume') { throw 'Unexpected source or data overlay.' } }
        }
    }
    foreach ($binding in @($checkedConfig.services.proxy.ports) + @($checkedConfig.services.db.ports)) {
        if ($binding.host_ip -ne '127.0.0.1' -or [int]$binding.published -notin @(3380, 18380, 15380)) { throw 'Unexpected published port.' }
    }
    if (!$ValidateOnly) {
        & docker @composeArgs up -d --pull never --no-build --wait --wait-timeout 240
        if ($LASTEXITCODE -ne 0) { throw 'The reviewed copy did not start. Check that Docker Desktop is running.' }
    }
    Write-Output ('Reviewed source: ' + $releaseMeta.sourceRevision)
    Write-Output ('Portal: ' + $portalAddress)
    if ($OpenBrowser -and !$ValidateOnly) { Start-Process -FilePath $portalAddress }
} finally { Pop-Location }
