Param(
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = 'Stop'

function Write-Info($message) {
    Write-Host "ℹ️  $message" -ForegroundColor Cyan
}

function Write-Ok($message) {
    Write-Host "✅ $message" -ForegroundColor Green
}

function Write-Warn($message) {
    Write-Host "⚠️  $message" -ForegroundColor Yellow
}

function Write-Fail($message) {
    Write-Host "❌ $message" -ForegroundColor Red
}

try {
    $projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    $serverPath = Join-Path $projectRoot 'server'
    $reportPath = Join-Path $projectRoot 'fix-processing-state-report.txt'
    $fixScript = Join-Path $projectRoot 'fix-processing-state.js'

    Write-Info "Projet détecté: $projectRoot"

    # 1) Vérification Node.js
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        throw "Node.js n'est pas installé (ou non présent dans PATH). Installez Node.js LTS puis relancez."
    }

    $nodeVersion = node --version
    Write-Ok "Node.js détecté: $nodeVersion"

    # 2) Vérification dossiers/scripts
    if (-not (Test-Path $serverPath)) {
        throw "Dossier server introuvable: $serverPath"
    }

    if (-not (Test-Path $fixScript)) {
        throw "Script fix-processing-state.js introuvable: $fixScript"
    }

    # 3) Vérification dépendance better-sqlite3 (dans server)
    $betterSqlitePath = Join-Path $serverPath 'node_modules\better-sqlite3'

    if (-not (Test-Path $betterSqlitePath)) {
        if ($SkipNpmInstall) {
            throw "better-sqlite3 manquant et -SkipNpmInstall a été demandé. Exécutez 'npm install' dans server."
        }

        Write-Warn "Dépendance better-sqlite3 absente. Installation des dépendances serveur..."
        Push-Location $serverPath
        try {
            npm install
        }
        finally {
            Pop-Location
        }
        Write-Ok "Dépendances npm installées dans server/"
    }
    else {
        Write-Ok "Dépendance better-sqlite3 détectée"
    }

    # 4) Exécution du correctif
    Write-Info "Lancement du correctif processing_state..."
    Push-Location $projectRoot
    try {
        node $fixScript
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    if ($exitCode -eq 0) {
        Write-Ok "Correctif terminé avec succès."
    }
    elseif ($exitCode -eq 2) {
        Write-Warn "Correctif terminé avec avertissements (vérifiez le rapport)."
    }
    else {
        throw "Le correctif a échoué avec code de sortie: $exitCode"
    }

    # 5) Affichage du rapport
    if (Test-Path $reportPath) {
        Write-Host ''
        Write-Host '====== RAPPORT FIX processing_state ======' -ForegroundColor Magenta
        Get-Content -Path $reportPath -Encoding UTF8
        Write-Host '==========================================' -ForegroundColor Magenta
    }
    else {
        Write-Warn "Rapport introuvable: $reportPath"
    }

    exit $exitCode
}
catch {
    Write-Fail $_.Exception.Message
    exit 1
}
