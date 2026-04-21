Param(
    [switch]$Apply,
    [switch]$StrictExifOnly,
    [string]$DbPath,
    [string[]]$PhotosRoot,
    [string]$ReportPath,
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = 'Stop'

function Write-Info($message) { Write-Host "ℹ️  $message" -ForegroundColor Cyan }
function Write-Ok($message) { Write-Host "✅ $message" -ForegroundColor Green }
function Write-Warn($message) { Write-Host "⚠️  $message" -ForegroundColor Yellow }
function Write-Fail($message) { Write-Host "❌ $message" -ForegroundColor Red }

try {
    $projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    $serverPath = Join-Path $projectRoot 'server'
    $scriptPath = Join-Path $projectRoot 'rebuild-db-from-exif.js'

    Write-Info "Projet détecté: $projectRoot"

    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        throw "Node.js n'est pas installé (ou absent du PATH)."
    }
    Write-Ok "Node.js détecté: $(node --version)"

    if (-not (Test-Path $scriptPath)) {
        throw "Script introuvable: $scriptPath"
    }

    $betterSqlitePath = Join-Path $serverPath 'node_modules\better-sqlite3'
    $exiftoolPath = Join-Path $serverPath 'node_modules\exiftool-vendored'

    if ((-not (Test-Path $betterSqlitePath)) -or (-not (Test-Path $exiftoolPath))) {
        if ($SkipNpmInstall) {
            throw "Dépendances manquantes (better-sqlite3 / exiftool-vendored) et -SkipNpmInstall demandé."
        }

        Write-Warn "Dépendances serveur absentes, lancement de npm install dans server/..."
        Push-Location $serverPath
        try {
            npm install
        }
        finally {
            Pop-Location
        }
        Write-Ok "Dépendances installées."
    }
    else {
        Write-Ok "Dépendances détectées (better-sqlite3 + exiftool-vendored)."
    }

    $argsList = @($scriptPath)

    if ($Apply) { $argsList += '--apply' }
    if ($StrictExifOnly) { $argsList += '--strict-exif-only' }

    if ($DbPath) {
        $argsList += '--db-path'
        $argsList += $DbPath
    }

    if ($ReportPath) {
        $argsList += '--report-path'
        $argsList += $ReportPath
    }

    if ($PhotosRoot -and $PhotosRoot.Count -gt 0) {
        $joinedRoots = ($PhotosRoot | Where-Object { $_ -and $_.Trim() -ne '' }) -join ';'
        if ($joinedRoots) {
            $argsList += '--photos-root'
            $argsList += $joinedRoots
        }
    }

    Write-Info "Exécution de rebuild-db-from-exif.js..."
    if (-not $Apply) {
        Write-Warn "Mode DRY-RUN (audit sans remplacement DB). Ajoutez -Apply pour appliquer réellement."
    }

    Push-Location $projectRoot
    try {
        & node @argsList
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    if ($exitCode -ne 0) {
        throw "Le script Node a échoué avec code: $exitCode"
    }

    Write-Ok "Script terminé avec succès."

    if ($ReportPath -and (Test-Path $ReportPath)) {
        Write-Host ''
        Write-Host '====== RAPPORT REBUILD DB FROM EXIF ======' -ForegroundColor Magenta
        Get-Content -Path $ReportPath -Encoding UTF8
        Write-Host '===========================================' -ForegroundColor Magenta
    }
    elseif ($ReportPath) {
        Write-Warn "Rapport demandé mais introuvable: $ReportPath"
    }

    exit 0
}
catch {
    Write-Fail $_.Exception.Message
    exit 1
}
