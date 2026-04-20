$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeScriptPath = Join-Path $scriptDir 'reset-error-photos.js'

if (-not (Test-Path $nodeScriptPath)) {
    Write-Error "Script Node.js introuvable: $nodeScriptPath"
    exit 1
}

Write-Host "Lancement du script de réinitialisation des photos en erreur..." -ForegroundColor Cyan
node $nodeScriptPath

if ($LASTEXITCODE -ne 0) {
    Write-Error "Le script Node.js s'est terminé avec le code $LASTEXITCODE"
    exit $LASTEXITCODE
}
