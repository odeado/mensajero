@echo off
title Compilar APK - Mensajero
cd /d "%~dp0AndroidApp"

echo.
echo ============================================================
echo    COMPILANDO APK - MENSAJERO (Android)
echo ============================================================
echo.

:: Usar el Java que trae Android Studio si JAVA_HOME no esta definido
if not defined JAVA_HOME (
    if exist "C:\Program Files\Android\Android Studio\jbr\bin\java.exe" (
        set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
    )
)
if not defined JAVA_HOME (
    echo [ERROR] No se encontro Java. Abre la carpeta AndroidApp en Android Studio
    echo         y usa Build ^> Build APK, o define JAVA_HOME.
    pause
    exit /b 1
)
echo [OK] Java: %JAVA_HOME%
echo.

call gradlew.bat assembleDebug
if errorlevel 1 (
    echo.
    echo [ERROR] Fallo la compilacion. Revisa los mensajes de arriba.
    pause
    exit /b 1
)

copy /Y "app\build\outputs\apk\debug\app-debug.apk" "%~dp0Mensajero.apk" >nul
echo.
echo ============================================================
echo   APK LISTO:  %~dp0Mensajero.apk
echo ============================================================
echo  Pasalo al celular (WhatsApp, Drive o cable USB) e instalalo.
echo.
explorer /select,"%~dp0Mensajero.apk"
pause
