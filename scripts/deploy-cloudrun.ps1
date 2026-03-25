param(
    [string]$ProjectId,
    [string]$Region = "europe-west1",
    [string]$ServiceName = "bni-linked-backend",
    [string]$Image = "",
    [string]$DatabaseUrl = "",
    [string]$RealtimeSecret = "",
    [string]$RealtimeHttpUrl = "",
    [string]$RealtimeWsUrl = ""
)

if (-not $ProjectId) {
    throw "ProjectId requis."
}

if (-not $Image) {
    $Image = "gcr.io/$ProjectId/$ServiceName"
}

& gcloud builds submit --project $ProjectId --tag $Image .

$deployArgs = @(
    "run", "deploy", $ServiceName,
    "--project", $ProjectId,
    "--region", $Region,
    "--image", $Image,
    "--platform", "managed",
    "--allow-unauthenticated",
    "--port", "8787",
    "--max-instances", "1"
)

if ($DatabaseUrl -or $RealtimeSecret) {
    $initialEnvVars = @()
    if ($DatabaseUrl) { $initialEnvVars += "FIREBASE_DATABASE_URL=$DatabaseUrl" }
    if ($RealtimeSecret) { $initialEnvVars += "BNI_REALTIME_SECRET=$RealtimeSecret" }
    if ($initialEnvVars.Count -gt 0) {
        $deployArgs += @("--set-env-vars", ($initialEnvVars -join ","))
    }
}

& gcloud @deployArgs

$serviceUrl = (& gcloud run services describe $ServiceName --project $ProjectId --region $Region --format "value(status.url)").Trim()
if (-not $RealtimeHttpUrl) {
    $RealtimeHttpUrl = $serviceUrl
}
if (-not $RealtimeWsUrl -and $RealtimeHttpUrl) {
    $RealtimeWsUrl = $RealtimeHttpUrl -replace '^https:', 'wss:' -replace '^http:', 'ws:'
}

$finalEnvVars = @()
if ($DatabaseUrl) { $finalEnvVars += "FIREBASE_DATABASE_URL=$DatabaseUrl" }
if ($RealtimeSecret) { $finalEnvVars += "BNI_REALTIME_SECRET=$RealtimeSecret" }
if ($RealtimeHttpUrl) { $finalEnvVars += "BNI_REALTIME_HTTP_URL=$RealtimeHttpUrl" }
if ($RealtimeWsUrl) { $finalEnvVars += "BNI_REALTIME_WS_URL=$RealtimeWsUrl" }

if ($finalEnvVars.Count -gt 0) {
    & gcloud run services update $ServiceName `
        --project $ProjectId `
        --region $Region `
        --set-env-vars ($finalEnvVars -join ",")
}
