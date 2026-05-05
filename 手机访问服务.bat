@echo off
cd /d "%~dp0"
echo 正在启动手机访问服务...
start /min "小说阅读器" node scripts\serve.js
timeout /t 2 >nul
echo.
echo 服务已启动！
echo 请在手机 Chrome 浏览器中打开上面显示的地址
echo 然后点击菜单 -> 添加到主屏幕
echo.
echo 按任意键关闭服务...
pause >nul
taskkill /f /im node.exe >nul 2>&1
exit
