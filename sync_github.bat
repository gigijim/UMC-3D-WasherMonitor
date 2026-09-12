@echo off
title 自動同步最新分析數據至 GitHub (UMC-3D-WasherMonitor)
cd /d "%~dp0"
echo =======================================================
echo   正在將最新洗衣分析數據同步並推送至 GitHub...
echo   專案名稱: UMC-3D-WasherMonitor
echo   Vercel: https://UMC-3D-WasherMonitor.vercel.app
echo =======================================================
echo.

git add frontend/public/data/*.json
git commit -m "chore: update laundry usage analytics data [skip ci]"
git push origin main

echo.
echo 同步完成！Vercel 將自動於雲端更新最新報表：https://UMC-3D-WasherMonitor.vercel.app
pause
