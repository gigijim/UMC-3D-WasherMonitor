@echo off
title 聯苑二期洗衣監控守護程式
cd /d "%~dp0"
echo 正在啟動 24H 洗衣機監控背景服務...
node daemon.js
pause
