@echo off
chcp 936 >nul
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $dir = '%~dp0'; $lnk = $ws.CreateShortcut(([Environment]::GetFolderPath('Desktop')) + '\DuskBox.lnk'); $lnk.TargetPath = $dir + 'DuskBox-launch.vbs'; $lnk.WorkingDirectory = $dir; $lnk.WindowStyle = 7; $lnk.Description = 'Dusk Box · 从桌面打开茜色箱'; $lnk.Save()"

if errorlevel 1 (
  echo.
  echo   [失败] 在桌面上创建快捷方式时出错。
  echo.
  pause
  exit /b 1
)

echo.
echo   已在桌面创建「DuskBox」快捷方式。
echo   以后双击桌面图标就能打开茜色箱，不会弹出黑色窗口。
echo   如需移除，请双击「DuskBox-desktop-off.bat」。
echo.
pause
