param(
    [string]$ProjectId,
    [string]$BillingAccountId,
    [string]$Region = "europe-west1",
    [string]$SchedulerLocation = "europe-west1",
    [string]$ServiceName = "bni-linked-backend",
    [string]$BudgetDisplayName = "bni-linked-monthly-guardrail",
    [decimal]$BudgetAmount = 20,
    [string]$NotificationEmail = "",
    [string]$RealtimeSecretName = "bni-linked-realtime-secret",
    [string]$MaintenanceSecretName = "bni-linked-maintenance-secret",
    [string]$BackupBucket = "",
    [string]$BackupPrefix = "rtdb",
    [int]$BackupRetentionDays = 30,
    [long]$ExportRetentionDays = 45,
    [long]$SessionMaxIdleMs = 2592000000,
    [long]$PresenceTtlMs = 120000,
    [long]$RealtimeEventRetentionMs = 86400000,
    [string]$DatabaseUrl = ""
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

    throw "gcloud introuvable."
}

function Invoke-Gcloud([string[]]$CommandArgs) {
    & $script:GcloudCommand @CommandArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Echec gcloud: $($CommandArgs -join ' ')"
    }
}

function Invoke-GcloudCapture([string[]]$CommandArgs) {
    $output = & $script:GcloudCommand @CommandArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Echec gcloud: $($CommandArgs -join ' ')"
    }
    return ($output | Out-String).Trim()
}

function New-RandomSecret([int]$Bytes = 48) {
    $buffer = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes($Bytes)
    return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Ensure-ServiceEnabled([string[]]$Services) {
    if (-not $Services -or $Services.Count -eq 0) { return }
    $args = @("services", "enable", "--project", $ProjectId)
    $args += $Services
    Invoke-Gcloud $args
}

function Ensure-SecretVersion([string]$SecretName, [string]$SecretValue) {
    & $script:GcloudCommand secrets describe $SecretName --project $ProjectId *> $null
    if ($LASTEXITCODE -ne 0) {
        Invoke-Gcloud @("secrets", "create", $SecretName, "--project", $ProjectId, "--replication-policy", "automatic")
    }

    $tmpFile = New-TemporaryFile
    try {
        [System.IO.File]::WriteAllText($tmpFile.FullName, $SecretValue)
        Invoke-Gcloud @("secrets", "versions", "add", $SecretName, "--project", $ProjectId, "--data-file", $tmpFile.FullName)
    } finally {
        Remove-Item $tmpFile.FullName -ErrorAction SilentlyContinue
    }
}

function Ensure-Bucket([string]$BucketName, [int]$RetentionDays) {
    & $script:GcloudCommand storage buckets describe "gs://$BucketName" --project $ProjectId *> $null
    if ($LASTEXITCODE -ne 0) {
        Invoke-Gcloud @(
            "storage", "buckets", "create", "gs://$BucketName",
            "--project", $ProjectId,
            "--location", $Region,
            "--uniform-bucket-level-access"
        )
    }

    $lifecycle = @"
{
  "rule": [
    {
      "action": { "type": "Delete" },
      "condition": { "age": $RetentionDays }
    }
  ]
}
"@
    $tmpLifecycle = New-TemporaryFile
    try {
        [System.IO.File]::WriteAllText($tmpLifecycle.FullName, $lifecycle)
        Invoke-Gcloud @("storage", "buckets", "update", "gs://$BucketName", "--lifecycle-file", $tmpLifecycle.FullName)
    } finally {
        Remove-Item $tmpLifecycle.FullName -ErrorAction SilentlyContinue
    }
}

function Ensure-SchedulerJob([string]$JobName, [string]$Schedule, [string]$Uri, [string]$SecretValue) {
    $headers = "x-bni-maintenance-secret=$SecretValue"
    & $script:GcloudCommand scheduler jobs describe $JobName --location $SchedulerLocation --project $ProjectId *> $null
    if ($LASTEXITCODE -eq 0) {
        Invoke-Gcloud @(
            "scheduler", "jobs", "update", "http", $JobName,
            "--project", $ProjectId,
            "--location", $SchedulerLocation,
            "--schedule", $Schedule,
            "--time-zone", "Europe/Paris",
            "--uri", $Uri,
            "--http-method", "POST",
            "--headers", $headers
        )
        return
    }

    Invoke-Gcloud @(
        "scheduler", "jobs", "create", "http", $JobName,
        "--project", $ProjectId,
        "--location", $SchedulerLocation,
        "--schedule", $Schedule,
        "--time-zone", "Europe/Paris",
        "--uri", $Uri,
        "--http-method", "POST",
        "--headers", $headers
    )
}

function Ensure-Budget([string]$ProjectNumber) {
    if (-not $BillingAccountId) {
        throw "BillingAccountId requis pour creer le budget."
    }

    $budgetAmountText = [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.##}", $BudgetAmount)
    $budgetName = Invoke-GcloudCapture @(
        "beta", "billing", "budgets", "list",
        "--billing-account", $BillingAccountId,
        "--format", "value(name)",
        "--filter", "displayName=$BudgetDisplayName"
    )

    if ($budgetName) {
        Invoke-Gcloud @(
            "beta", "billing", "budgets", "update", $budgetName,
            "--billing-account", $BillingAccountId,
            "--display-name", $BudgetDisplayName,
            "--budget-amount", $budgetAmountText,
            "--calendar-period", "month",
            "--clear-threshold-rules",
            "--add-threshold-rule", "percent=50",
            "--add-threshold-rule", "percent=80",
            "--add-threshold-rule", "percent=100",
            "--add-threshold-rule", "percent=120,basis=forecasted-spend",
            "--filter-projects", "projects/$ProjectNumber"
        )
        return
    }

    Invoke-Gcloud @(
        "beta", "billing", "budgets", "create",
        "--billing-account", $BillingAccountId,
        "--display-name", $BudgetDisplayName,
        "--budget-amount", $budgetAmountText,
        "--calendar-period", "month",
        "--threshold-rule", "percent=0.50",
        "--threshold-rule", "percent=0.80",
        "--threshold-rule", "percent=1.00",
        "--threshold-rule", "percent=1.20,basis=forecasted-spend",
        "--filter-projects", "projects/$ProjectNumber"
    )
}

if (-not $ProjectId) {
    throw "ProjectId requis."
}

$script:GcloudCommand = Resolve-GcloudCommand

if (-not $DatabaseUrl) {
    $DatabaseUrl = "https://$ProjectId-default-rtdb.$Region.firebasedatabase.app"
}

if (-not $BackupBucket) {
    $BackupBucket = "$ProjectId-rtdb-backups"
}

$projectNumber = Invoke-GcloudCapture @("projects", "describe", $ProjectId, "--format", "value(projectNumber)")
if (-not $projectNumber) {
    throw "Impossible de lire le project number pour $ProjectId."
}

Ensure-ServiceEnabled @(
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
    "billingbudgets.googleapis.com",
    "storage.googleapis.com"
)

$serviceDescriptionRaw = ""
try {
    $serviceDescriptionRaw = Invoke-GcloudCapture @("run", "services", "describe", $ServiceName, "--project", $ProjectId, "--region", $Region, "--format", "json")
} catch {
    $serviceDescriptionRaw = ""
}

$currentRealtimeSecret = ""
if ($serviceDescriptionRaw) {
    $serviceDescription = $serviceDescriptionRaw | ConvertFrom-Json
    $envVars = @($serviceDescription.spec.template.spec.containers[0].env)
    foreach ($entry in $envVars) {
        if ($entry.name -eq "BNI_REALTIME_SECRET" -and $entry.value) {
            $currentRealtimeSecret = [string]$entry.value
        }
    }
}

$realtimeSecretValue = if ($currentRealtimeSecret) { $currentRealtimeSecret } else { New-RandomSecret }
$maintenanceSecretValue = New-RandomSecret

Ensure-SecretVersion $RealtimeSecretName $realtimeSecretValue
Ensure-SecretVersion $MaintenanceSecretName $maintenanceSecretValue

$defaultServiceAccount = "$projectNumber-compute@developer.gserviceaccount.com"
$serviceAccount = Invoke-GcloudCapture @("run", "services", "describe", $ServiceName, "--project", $ProjectId, "--region", $Region, "--format", "value(spec.template.spec.serviceAccountName)")
if (-not $serviceAccount) {
    $serviceAccount = $defaultServiceAccount
}

Invoke-Gcloud @("secrets", "add-iam-policy-binding", $RealtimeSecretName, "--project", $ProjectId, "--member", "serviceAccount:$serviceAccount", "--role", "roles/secretmanager.secretAccessor")
Invoke-Gcloud @("secrets", "add-iam-policy-binding", $MaintenanceSecretName, "--project", $ProjectId, "--member", "serviceAccount:$serviceAccount", "--role", "roles/secretmanager.secretAccessor")

Ensure-Bucket $BackupBucket $BackupRetentionDays
Invoke-Gcloud @("storage", "buckets", "add-iam-policy-binding", "gs://$BackupBucket", "--member", "serviceAccount:$serviceAccount", "--role", "roles/storage.objectAdmin")

& (Join-Path $PSScriptRoot "deploy-cloudrun.ps1") `
    -ProjectId $ProjectId `
    -Region $Region `
    -ServiceName $ServiceName `
    -DatabaseUrl $DatabaseUrl `
    -BackupBucket $BackupBucket `
    -BackupPrefix $BackupPrefix `
    -RealtimeSecretName $RealtimeSecretName `
    -MaintenanceSecretName $MaintenanceSecretName `
    -SessionMaxIdleMs $SessionMaxIdleMs `
    -PresenceTtlMs $PresenceTtlMs `
    -ExportRetentionDays $ExportRetentionDays `
    -RealtimeEventRetentionMs $RealtimeEventRetentionMs
if ($LASTEXITCODE -ne 0) {
    throw "Le deploiement Cloud Run a echoue."
}

$serviceUrl = Invoke-GcloudCapture @("run", "services", "describe", $ServiceName, "--project", $ProjectId, "--region", $Region, "--format", "value(status.url)")
if (-not $serviceUrl) {
    throw "Impossible de lire l'URL du service Cloud Run."
}

Ensure-SchedulerJob "bni-linked-maintenance-hourly" "17 * * * *" "$serviceUrl/api/admin/maintenance/run" $maintenanceSecretValue
Ensure-SchedulerJob "bni-linked-rtdb-backup-daily" "15 3 * * *" "$serviceUrl/api/admin/backups/run" $maintenanceSecretValue
Ensure-Budget $projectNumber
& (Join-Path $PSScriptRoot "setup-cloud-monitoring.ps1") `
    -ProjectId $ProjectId `
    -ServiceName $ServiceName `
    -NotificationEmail $NotificationEmail | Out-Null

[PSCustomObject]@{
    ProjectId = $ProjectId
    ServiceName = $ServiceName
    ServiceUrl = $serviceUrl
    BackupBucket = $BackupBucket
    RealtimeSecretName = $RealtimeSecretName
    MaintenanceSecretName = $MaintenanceSecretName
    BudgetDisplayName = $BudgetDisplayName
    BudgetAmount = $BudgetAmount
}
