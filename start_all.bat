@echo off
title 聯苑二期 3D 洗衣監控與分析系統
echo =======================================================
echo   聯苑二期 3D 洗衣機/烘衣機監控分析系統 啟動精靈
echo =======================================================
echo.

echo 1. 正在背景啟動 24H 爬蟲守護程式...
start "聯苑二期爬蟲守護程式" cmd /k "cd /d "%~dp0backend" && node daemon.js"

echo 2. 正在啟動 3D 視覺化前端網頁 (Vite)...
cd /d "%~dp0frontend"
npm run dev

pause
