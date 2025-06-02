# Tabletop WebRTC Server Start Script

# Set UTF-8 encoding
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = "utf-8"
$OutputEncoding = [System.Text.Encoding]::UTF8

# Clear screen and set title
Clear-Host
$Host.UI.RawUI.WindowTitle = "Tabletop WebRTC Server"

Write-Host "=============================================="
Write-Host "    Tabletop Simulator WebRTC Server"
Write-Host "=============================================="
Write-Host ""
Write-Host "Starting server..." -ForegroundColor Green
Write-Host ""

try {
    npm start
} catch {
    Write-Host "Error occurred: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "Server has been stopped." -ForegroundColor Yellow
Write-Host "Press any key to close..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") 