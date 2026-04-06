# clear-data.ps1 - Nuclear clear for LocalSmartPhotoIndexer
# Bypass broken API by killing server, deleting .db, restarting.

$ServerDir = Join-Path $PSScriptRoot ".."
$DbFile = Join-Path $ServerDir "server\data\photo-index.db"

Write-Host "`n[1/5] Stopping all node/tsx processes..." -ForegroundColor Yellow
Get-Process | Where-Object { $_.ProcessName -eq "node" } | Stop-Process -Force
Start-Sleep -Seconds 2

Write-Host "[2/5] Verifying port 6800 is free..." -ForegroundColor Yellow
$portUsed = netstat -ano | Select-String ":6800"
if ($portUsed) {
    Write-Host "  Port 6800 still in use! Manually kill remaining processes." -ForegroundColor Red
    $portUsed
} else {
    Write-Host "  Port 6800 is free." -ForegroundColor Green
}

Write-Host "[3/5] Deleting database file..." -ForegroundColor Yellow
if (Test-Path $DbFile) {
    Remove-Item $DbFile -Force
    Write-Host "  Deleted: $DbFile" -ForegroundColor Green
} else {
    Write-Host "  DB file not found (already deleted?)" -ForegroundColor Cyan
}

Write-Host "[4/5] Clearing ts-node cache..." -ForegroundColor Yellow
Get-ChildItem -Path "$env:TEMP\ts-node-*" -Directory -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path "$env:LOCALAPPDATA\Temp\ts-node-*" -Directory -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "  Cache cleared." -ForegroundColor Green

Write-Host "[5/5] Restarting server..." -ForegroundColor Yellow
Set-Location $ServerDir
$env:FORCE_PORT = "true"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ServerDir'; npm run dev"
Write-Host "`nDone! Server restarted in new window." -ForegroundColor Green
Start-Sleep -Seconds 5

Write-Host "`nWaiting for server to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 3
$ok = $false
for ($i = 0; $i -lt 10; $i++) {
    try {
        $resp = Invoke-RestMethod -Uri "http://localhost:6800/api/health" -ErrorAction Stop
        if ($resp.status -eq "ok") { $ok = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
}
if ($ok) {
    Write-Host "Server is running at http://localhost:6800" -ForegroundColor Green
} else {
    Write-Host "Server may not be ready yet. Check the new window." -ForegroundColor Red
}
