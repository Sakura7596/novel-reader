@echo off
cd /d "%~dp0desktop"
start "" "node_modules\.bin\electron.cmd" "."
exit
