@echo off
chcp 65001 > nul
title 테이블탑 WebRTC 서버
color 0A
echo.
echo ==============================================
echo     🎮 테이블탑 시뮬레이터 WebRTC 서버 🎮
echo ==============================================
echo.
echo 서버를 시작합니다...
echo.

node server.js

echo.
echo 서버가 종료되었습니다.
echo 아무 키나 누르면 창이 닫힙니다...
pause > nul
