$env:PORT = "6800"
$env:FORCE_PORT = "true"

$backendScript = @"
Set-Location 'G:\Github perso\LocalSmartPhotoIndexer\server'
npm start
"@

$frontendScript = @"
Set-Location 'G:\Github perso\LocalSmartPhotoIndexer'
npm run dev
"@

$backendFile = "$env:TEMP\lspi_backend.ps1"
$frontendFile = "$env:TEMP\lspi_frontend.ps1"

$backendScript | Out-File -FilePath $backendFile -Encoding utf8
$frontendScript | Out-File -FilePath $frontendFile -Encoding utf8

$backendProc = Start-Process powershell -ArgumentList "-NoExit", "-File", $backendFile -PassThru -WindowStyle Normal
$frontendProc = Start-Process powershell -ArgumentList "-NoExit", "-File", $frontendFile -PassThru -WindowStyle Normal

Write-Host "Backend PID: $($backendProc.Id) on http://localhost:6800"
Write-Host "Frontend PID: $($frontendProc.Id) on http://localhost:5173"
Write-Host ""
Write-Host "Fermer les fenêtres PowerShell pour arreter."
