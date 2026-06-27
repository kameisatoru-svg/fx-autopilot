@echo off
rem このファイルをダブルクリックすると、クリップボードの文字起こしを要約します。
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0summarize.ps1"
