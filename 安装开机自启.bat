@echo off
chcp 936 >nul
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $dir = '%~dp0'; $lnk = $ws.CreateShortcut(([Environment]::GetFolderPath('Startup')) + '\茜色箱.lnk'); $lnk.TargetPath = $dir + '茜色箱启动.bat'; $lnk.WorkingDirectory = $dir; $lnk.WindowStyle = 7; $lnk.Description = '茜色箱 · 开机自动启动本地服务'; $lnk.Save()"

if errorlevel 1 (
  echo.
  echo   [失败] 设置开机自启时出错。
  echo.
  pause
  exit /b 1
)

echo.
echo   已设置开机自启。
echo   以后开机时会自动在后台启动茜色箱服务（窗口最小化）。
echo   如需取消，请双击「取消开机自启.bat」。
echo.
pause
