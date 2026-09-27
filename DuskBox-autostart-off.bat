@echo off
chcp 936 >nul
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$path = ([Environment]::GetFolderPath('Startup')) + '\DuskBox.lnk'; if (Test-Path $path) { Remove-Item $path -Force }"

echo.
echo   已取消开机自启。
echo.
pause
