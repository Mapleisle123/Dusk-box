@echo off
chcp 936 >nul
title Dusk Box
cd /d "%~dp0"

set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "E:\application\Nodejs\node.exe" set "NODE_EXE=E:\application\Nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"

if not defined NODE_EXE (
  echo.
  echo   [错误] 没有找到 Node.js，无法启动 Dusk Box。
  echo.
  echo   请先安装 Node.js：https://nodejs.org/
  echo   安装完成后重新双击本文件即可。
  echo.
  pause
  exit /b 1
)

echo.
echo   正在启动 Dusk Box（茜色箱）...
echo   浏览器会自动打开；若没有，请手动访问窗口里显示的地址。
echo   关闭本窗口即停止服务（你的数据不会丢失）。
echo.

rem 以上提示由本脚本输出，随文件编码走本地代码页；
rem 下面启动的 Node 进程输出固定是 UTF-8，所以临时切到 65001 才能正常显示中文。
chcp 65001 >nul
"%NODE_EXE%" "server\index.js"
chcp 936 >nul

echo.
echo   Dusk Box 已停止。数据保存在本目录的 data 文件夹中。
echo   数据库文件：data\duskbox.db
pause
