# 테이블탑 WebRTC 서버 시작 스크립트
$Host.UI.RawUI.WindowTitle = "🎮 테이블탑 WebRTC 서버"

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "    🎮 테이블탑 시뮬레이터 WebRTC 서버 🎮    " -ForegroundColor Yellow
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host "서버를 시작합니다..." -ForegroundColor Cyan
Write-Host ""

# Node.js 설치 확인
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Node.js가 설치되지 않았습니다!" -ForegroundColor Red
    Write-Host "https://nodejs.org 에서 Node.js를 설치해주세요." -ForegroundColor Yellow
    pause
    exit
}

# 서버 시작
try {
    node server.js
} catch {
    Write-Host ""
    Write-Host "❌ 서버 시작 중 오류가 발생했습니다!" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}

Write-Host ""
Write-Host "서버가 종료되었습니다." -ForegroundColor Yellow
Write-Host "아무 키나 누르면 창이 닫힙니다..." -ForegroundColor Gray
pause 