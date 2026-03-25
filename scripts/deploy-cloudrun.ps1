param(
    [string]$ProjectId,
    [string]$Region = "europe-west1",
    [string]$ServiceName = "bni-linked-backend",
    [string]$Image = "",
    [string]$DatabaseUrl = "",
    [string]$StoreNamespace = "",
    [string]$BackupBucket = "",
    [string]$BackupPrefix = "rtdb",
    [string]$MaintenanceSecret = "",
    [string]$RealtimeSecret = "",
    [string]$RealtimeSecretName = "",
    [string]$MaintenanceSecretName = "",
    [string]$RealtimeHttpUrl = "",
    [string]$RealtimeWsUrl = "",
    [long]$SessionMaxIdleMs = 2592000000,
    [long]$PresenceTtlMs = 120000,
    [long]$ExportRetentionDays = 45,
    [long]$RealtimeEventRetentionMs = 86400000,
    [string]$Memory = "1Gi",
    [int]$MaxInstances = 1,
    [int]$MinInstances = 1,
    [int]$Concurrency = 200,
    [int]$TimeoutSeconds = 3600
)

function Resolve-GcloudCommand {
    $command = Get-Command gcloud -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $fallback = Join-Path $env:LOCALAPPDATA "Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd"
    if (Test-Path $fallback) {
        return $fallback
    }

    throw "gcloud introuvable. Installe Google Cloud SDK ou ajoute gcloud au PATH."
}

function Invoke-Gcloud([string[]]$CommandArgs) {
    & $script:GcloudCommand @CommandArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Echec gcloud: $($CommandArgs -join ' ')"
    }
}

if (-not $ProjectId) {
    throw "ProjectId requis."
}

$script:GcloudCommand = Resolve-GcloudCommand

if (-not $Image) {
    $Image = "gcr.io/$ProjectId/$ServiceName"
}

Invoke-Gcloud @("builds", "submit", "--project", $ProjectId, "--tag", $Image, ".")

$deployArgs = @(
    "run", "deploy", $ServiceName,
    "--project", $ProjectId,
    "--region", $Region,
    "--image", $Image,
    "--platform", "managed",
    "--allow-unauthenticated",
    "--port", "8787",
    "--memory", $Memory,
    "--max-instances", $MaxInstances.ToString(),
    "--min-instances", $MinInstances.ToString(),
    "--concurrency", $Concurrency.ToString(),
    "--timeout", $TimeoutSeconds.ToString()
)

$baseEnvVars = @()
if ($DatabaseUrl) { $baseEnvVars += "FIREBASE_DATABASE_URL=$DatabaseUrl" }
if ($StoreNamespace) { $baseEnvVars += "BNI_FIREBASE_STORE_NAMESPACE=$StoreNamespace" }
if ($BackupBucket) { $baseEnvVars += "BNI_BACKUP_BUCKET=$BackupBucket" }
if ($BackupPrefix) { $baseEnvVars += "BNI_BACKUP_PREFIX=$BackupPrefix" }
if ($SessionMaxIdleMs -gt 0) { $baseEnvVars += "BNI_SESSION_MAX_IDLE_MS=$SessionMaxIdleMs" }
if ($PresenceTtlMs -gt 0) { $baseEnvVars += "BNI_PRESENCE_TTL_MS=$PresenceTtlMs" }
if ($ExportRetentionDays -gt 0) { $baseEnvVars += "BNI_EXPORT_RETENTION_DAYS=$ExportRetentionDays" }
if ($RealtimeEventRetentionMs -gt 0) { $baseEnvVars += "BNI_REALTIME_EVENT_RETENTION_MS=$RealtimeEventRetentionMs" }
if ($RealtimeSecret -and -not $RealtimeSecretName) { $baseEnvVars += "BNI_REALTIME_SECRET=$RealtimeSecret" }
if ($MaintenanceSecret -and -not $MaintenanceSecretName) { $baseEnvVars += "BNI_MAINTENANCE_SECRET=$MaintenanceSecret" }
if ($baseEnvVars.Count -gt 0) {
    $deployArgs += @("--set-env-vars", ($baseEnvVars -join ","))
}

$secretBindings = @()
if ($RealtimeSecretName) { $secretBindings += "BNI_REALTIME_SECRET=${RealtimeSecretName}:latest" }
if ($MaintenanceSecretName) { $secretBindings += "BNI_MAINTENANCE_SECRET=${MaintenanceSecretName}:latest" }
if ($secretBindings.Count -gt 0) {
    $deployArgs += @("--set-secrets", ($secretBindings -join ","))
}

Invoke-Gcloud $deployArgs

$serviceUrl = (& $script:GcloudCommand run services describe $ServiceName --project $ProjectId --region $Region --format "value(status.url)").Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Impossible de lire l'URL du service Cloud Run."
}
if (-not $RealtimeHttpUrl) {
    $RealtimeHttpUrl = $serviceUrl
}
if (-not $RealtimeWsUrl -and $RealtimeHttpUrl) {
    $RealtimeWsUrl = $RealtimeHttpUrl -replace '^https:', 'wss:' -replace '^http:', 'ws:'
}

$finalEnvVars = @()
if ($DatabaseUrl) { $finalEnvVars += "FIREBASE_DATABASE_URL=$DatabaseUrl" }
if ($RealtimeHttpUrl) { $finalEnvVars += "BNI_REALTIME_HTTP_URL=$RealtimeHttpUrl" }
if ($RealtimeWsUrl) { $finalEnvVars += "BNI_REALTIME_WS_URL=$RealtimeWsUrl" }
if ($StoreNamespace) { $finalEnvVars += "BNI_FIREBASE_STORE_NAMESPACE=$StoreNamespace" }
if ($BackupBucket) { $finalEnvVars += "BNI_BACKUP_BUCKET=$BackupBucket" }
if ($BackupPrefix) { $finalEnvVars += "BNI_BACKUP_PREFIX=$BackupPrefix" }
if ($SessionMaxIdleMs -gt 0) { $finalEnvVars += "BNI_SESSION_MAX_IDLE_MS=$SessionMaxIdleMs" }
if ($PresenceTtlMs -gt 0) { $finalEnvVars += "BNI_PRESENCE_TTL_MS=$PresenceTtlMs" }
if ($ExportRetentionDays -gt 0) { $finalEnvVars += "BNI_EXPORT_RETENTION_DAYS=$ExportRetentionDays" }
if ($RealtimeEventRetentionMs -gt 0) { $finalEnvVars += "BNI_REALTIME_EVENT_RETENTION_MS=$RealtimeEventRetentionMs" }
if ($RealtimeSecret -and -not $RealtimeSecretName) { $finalEnvVars += "BNI_REALTIME_SECRET=$RealtimeSecret" }
if ($MaintenanceSecret -and -not $MaintenanceSecretName) { $finalEnvVars += "BNI_MAINTENANCE_SECRET=$MaintenanceSecret" }

$updateArgs = @(
    "run", "services", "update", $ServiceName,
    "--project", $ProjectId,
    "--region", $Region,
    "--memory", $Memory,
    "--max-instances", $MaxInstances.ToString(),
    "--min-instances", $MinInstances.ToString(),
    "--concurrency", $Concurrency.ToString(),
    "--timeout", $TimeoutSeconds.ToString()
)
if ($finalEnvVars.Count -gt 0) {
    $updateArgs += @("--set-env-vars", ($finalEnvVars -join ","))
}
if ($secretBindings.Count -gt 0) {
    $updateArgs += @("--set-secrets", ($secretBindings -join ","))
}
Invoke-Gcloud $updateArgs
