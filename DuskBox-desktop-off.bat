@echo off
chcp 936 >nul
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$path = ([Environment]::GetFolderPath('Desktop')) + '\DuskBox.lnk'; if (Test-Path $path) { Remove-Item $path -Force }"

echo.
echo   已移除桌面上的「DuskBox」快捷方式。
echo.
pause
