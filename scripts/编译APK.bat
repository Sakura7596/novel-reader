@echo off
echo [1/4] 同步最新源码到 www...
where node >nul 2>&1
if errorlevel 1 (
    echo 未找到 Node.js，无法同步源码，请先安装 Node.js
    pause
    exit /b
)
node "%~dp0sync-www.js"
if errorlevel 1 (
    echo 源码同步失败，请检查错误信息
    pause
    exit /b
)
echo [2/4] 拷贝到 Android assets...
pushd "%~dp0.."
call npx --no-install cap copy android
if errorlevel 1 (
    echo Android 资源拷贝失败，请检查 @capacitor/cli 是否安装
    popd
    pause
    exit /b
)
popd
cd /d "%~dp0..\android"
set JAVA_HOME=C:\Users\Sakura\java\jdk-21.0.11
set ANDROID_HOME=C:\Android
"%JAVA_HOME%\bin\java" -version >nul 2>&1
if errorlevel 1 (
    echo Java 未找到，请检查 JAVA_HOME 设置
    pause
    exit /b
)
echo [3/4] 编译 APK，请稍候...
call "%JAVA_HOME%\bin\java" -jar "%~dp0..\android\gradle\wrapper\gradle-wrapper.jar" assembleDebug
if errorlevel 1 (
    echo 编译失败，请检查错误信息
    pause
    exit /b
)
echo [4/4] 校验 APK 内资源与源码一致性...
node "%~dp0verify-apk-assets.js" "%~dp0..\android\app\build\outputs\apk\debug\app-debug.apk"
if errorlevel 1 (
    echo 产物校验失败：APK 与当前源码不一致，未覆盖对外安装包
    pause
    exit /b
)
copy /y "%~dp0..\android\app\build\outputs\apk\debug\app-debug.apk" "%~dp0..\小说阅读器.apk" >nul
echo.
echo APK 编译成功并通过一致性校验！
echo 安装包位置：%~dp0..\小说阅读器.apk
echo.
pause
