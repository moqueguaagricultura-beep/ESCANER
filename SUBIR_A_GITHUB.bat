@echo off
chcp 65001 >nul
cls
echo ======================================================
echo    SUBIR ESCANER PRO A GITHUB (GITHUB PAGES)
echo ======================================================
echo.

set /p REPO_URL="Pega aqui el enlace de tu repositorio de GitHub (ej: https://github.com/TU_USUARIO/escaner-pro.git): "

if "%REPO_URL%"=="" (
    echo.
    echo [ERROR] No ingresaste ninguna URL. Intentalo de nuevo.
    pause
    exit /b
)

echo.
echo Conectando con GitHub...
git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%
git branch -M main

echo Subiendo archivos...
git push -u origin main

if %ERRORLEVEL% equ 0 (
    echo.
    echo ======================================================
    echo  SUBIDA EXITOSA A GITHUB!
    echo ======================================================
    echo.
    echo Para que funcione en tu celular:
    echo 1. Ve a tu repositorio en GitHub.
    echo 2. Entra en Settings - Pages.
    echo 3. En 'Source' selecciona 'GitHub Actions'.
    echo 4. Listo, en 1 minuto tendras tu enlace web.
) else (
    echo.
    echo [AVISO] Si te pidio usuario/contrasena o dio error:
    echo Recuerda que GitHub requiere un Personal Access Token (PAT)
    echo o iniciar sesion en la ventana emergente de Git Credential Manager.
)

echo.
pause
