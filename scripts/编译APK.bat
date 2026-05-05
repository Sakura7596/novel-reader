@echo off
cd /d "%~dp0..\android"
set JAVA_HOME=C:\Users\Sakura\java\jdk-21.0.11
set ANDROID_HOME=C:\Android
"%JAVA_HOME%\bin\java" -version >nul 2>&1
if errorlevel 1 (
    echo Java 未找到，请检查 JAVA_HOME 设置
    pause
    exit /b
)
echo 正在编译 APK，请稍候...
call "%JAVA_HOME%\bin\java" -jar "%~dp0..\android\gradle\wrapper\gradle-wrapper.jar" assembleDebug
if errorlevel 1 (
    echo 编译失败，请检查错误信息
    pause
    exit /b
)
copy /y "%~dp0..\android\app\build\outputs\apk\debug\app-debug.apk" "%~dp0..\小说阅读器.apk" >nul
echo.
echo APK 编译成功！
echo 安装包位置：%~dp0..\小说阅读器.apk
echo.
pause
