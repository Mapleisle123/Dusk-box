@echo off
chcp 936 >nul
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $dir = '%~dp0'; $lnk = $ws.CreateShortcut(([Environment]::GetFolderPath('Startup')) + '\DuskBox.lnk'); $lnk.TargetPath = $dir + 'DuskBox-start.bat'; $lnk.WorkingDirectory = $dir; $lnk.WindowStyle = 7; $lnk.Description = 'Dusk Box · 开机自动启动本地服务'; $lnk.Save()"

if errorlevel 1 (
  echo.
  echo   [失败] 设置开机自启时出错。
  echo.
  pause
  exit /b 1
)

echo.
echo   已设置开机自启。
echo   以后开机时会自动在后台启动 Dusk Box 服务（窗口最小化）。
echo   如需取消，请双击「DuskBox-autostart-off.bat」。
echo.
pause
