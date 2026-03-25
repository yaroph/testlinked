param(
    [string]$ProjectId,
    [string]$ChannelId = "staging",
    [string]$Expires = "30d",
    [string]$ConfigPath = "firebase.staging.json"
)

function Resolve-FirebaseCommand {
    $command = Get-Command firebase -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    throw "firebase CLI introuvable. Installe firebase-tools."
}

if (-not $ProjectId) {
    throw "ProjectId requis."
}

$firebase = Resolve-FirebaseCommand
& $firebase hosting:channel:deploy $ChannelId --project $ProjectId --config $ConfigPath --expires $Expires
if ($LASTEXITCODE -ne 0) {
    throw "Le deploiement du preview channel Firebase a echoue."
}
