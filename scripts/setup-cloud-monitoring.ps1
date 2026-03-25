param(
    [string]$ProjectId,
    [string]$ServiceName = "bni-linked-backend",
    [string]$NotificationEmail = "",
    [string]$PolicyPrefix = "bni-linked"
)

$ErrorActionPreference = "Stop"

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

function Invoke-GcloudCapture([string[]]$CommandArgs) {
    $output = & $script:GcloudCommand @CommandArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Echec gcloud: $($CommandArgs -join ' ')"
    }
    return ($output | Out-String).Trim()
}

function Get-AccessToken {
    return Invoke-GcloudCapture @("auth", "print-access-token")
}

function Invoke-GoogleApi {
    param(
        [string]$Method,
        [string]$Uri,
        $Body = $null
    )

    $headers = @{
        Authorization = "Bearer $(Get-AccessToken)"
    }
    if ($Body -ne $null) {
        $headers["Content-Type"] = "application/json"
        return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -Body ($Body | ConvertTo-Json -Depth 12 -Compress) -ErrorAction Stop
    }
    return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -ErrorAction Stop
}

function Ensure-ServiceEnabled([string[]]$Services) {
    if (-not $Services -or $Services.Count -eq 0) { return }
    & $script:GcloudCommand services enable --project $ProjectId @Services
    if ($LASTEXITCODE -ne 0) {
        throw "Impossible d'activer les services GCP requis."
    }
}

function Ensure-LogMetric([string]$MetricName, [string]$Description, [string]$Filter) {
    $baseUri = "https://logging.googleapis.com/v2/projects/$ProjectId/metrics"
    $metricUri = "$baseUri/$MetricName"
    $payload = @{
        name = $MetricName
        description = $Description
        filter = $Filter
    }

    try {
        Invoke-GoogleApi -Method GET -Uri $metricUri | Out-Null
        Invoke-GoogleApi -Method PUT -Uri $metricUri -Body $payload | Out-Null
    } catch {
        Invoke-GoogleApi -Method POST -Uri $baseUri -Body $payload | Out-Null
    }
}

function Ensure-NotificationChannel([string]$EmailAddress) {
    if (-not $EmailAddress) { return "" }
    $channelList = Invoke-GoogleApi -Method GET -Uri "https://monitoring.googleapis.com/v3/projects/$ProjectId/notificationChannels"
    $existing = @($channelList.notificationChannels) | Where-Object {
        $_.type -eq "email" -and $_.labels.email_address -eq $EmailAddress
    } | Select-Object -First 1
    if ($existing) {
        return [string]$existing.name
    }

    $channel = Invoke-GoogleApi -Method POST -Uri "https://monitoring.googleapis.com/v3/projects/$ProjectId/notificationChannels" -Body @{
        type = "email"
        displayName = "$PolicyPrefix ops email"
        labels = @{
            email_address = $EmailAddress
        }
        enabled = $true
    }
    return [string]$channel.name
}

function Ensure-AlertPolicy([string]$DisplayName, [string]$ConditionName, [string]$MetricType, [double]$ThresholdValue, [string[]]$NotificationChannels) {
    $policyList = Invoke-GoogleApi -Method GET -Uri "https://monitoring.googleapis.com/v3/projects/$ProjectId/alertPolicies"
    $existing = @($policyList.alertPolicies) | Where-Object {
        $_.displayName -eq $DisplayName
    }
    foreach ($policy in $existing) {
        if ($policy.name) {
            Invoke-GoogleApi -Method DELETE -Uri "https://monitoring.googleapis.com/v3/$($policy.name)" | Out-Null
        }
    }

    $body = @{
        displayName = $DisplayName
        combiner = "OR"
        enabled = $true
        notificationChannels = @($NotificationChannels | Where-Object { $_ })
        alertStrategy = @{
            autoClose = "1800s"
        }
        conditions = @(
            @{
                displayName = $ConditionName
                conditionThreshold = @{
                    filter = "resource.type=`"cloud_run_revision`" AND metric.type=`"$MetricType`""
                    comparison = "COMPARISON_GT"
                    thresholdValue = $ThresholdValue
                    duration = "0s"
                    aggregations = @(
                        @{
                            alignmentPeriod = "300s"
                            perSeriesAligner = "ALIGN_DELTA"
                        }
                    )
                    trigger = @{
                        count = 1
                    }
                }
            }
        )
    }

    Invoke-GoogleApi -Method POST -Uri "https://monitoring.googleapis.com/v3/projects/$ProjectId/alertPolicies" -Body $body | Out-Null
}

if (-not $ProjectId) {
    throw "ProjectId requis."
}

$script:GcloudCommand = Resolve-GcloudCommand
Ensure-ServiceEnabled @(
    "monitoring.googleapis.com",
    "logging.googleapis.com"
)

if (-not $NotificationEmail) {
    $NotificationEmail = Invoke-GcloudCapture @("auth", "list", "--filter", "status:ACTIVE", "--format", "value(account)")
}

$channelName = Ensure-NotificationChannel $NotificationEmail
$escapedService = $ServiceName.Replace('"', '\"')

Ensure-LogMetric "bni_linked_cloudrun_runtime_failures" "Erreurs runtime Cloud Run critiques pour le backend BNI Linked" @"
resource.type="cloud_run_revision"
resource.labels.service_name="$escapedService"
(
  textPayload:"Reached heap limit"
  OR textPayload:"no available instance"
  OR textPayload:"The request failed because either the HTTP response was malformed or connection to the instance had an error"
  OR jsonPayload.message:"Reached heap limit"
  OR jsonPayload.message:"no available instance"
  OR jsonPayload.message:"The request failed because either the HTTP response was malformed or connection to the instance had an error"
)
"@

Ensure-LogMetric "bni_linked_cloudrun_http_5xx" "Reponses HTTP 5xx du backend BNI Linked" @"
resource.type="cloud_run_revision"
resource.labels.service_name="$escapedService"
httpRequest.status>=500
"@

Ensure-AlertPolicy "$PolicyPrefix runtime failures" "runtime failures > 0 / 5 min" "logging.googleapis.com/user/bni_linked_cloudrun_runtime_failures" 0 @($channelName)
Ensure-AlertPolicy "$PolicyPrefix http 5xx" "http 5xx > 2 / 5 min" "logging.googleapis.com/user/bni_linked_cloudrun_http_5xx" 2 @($channelName)

[PSCustomObject]@{
    ProjectId = $ProjectId
    ServiceName = $ServiceName
    NotificationEmail = $NotificationEmail
    ChannelName = $channelName
    Policies = @(
        "$PolicyPrefix runtime failures",
        "$PolicyPrefix http 5xx"
    )
}
