@echo off
title Abrir Chrome em Modo Depuracao - Axiom Monitor
echo ===================================================================
echo    INICIANDO O GOOGLE CHROME EM MODO DE DEPURACAO (PORTA 9222)
echo ===================================================================
echo.
echo Este script abrira o Chrome em uma janela dedicada.
echo Isso resolve o Cloudflare Turnstile / captcha pois voce estara usando
echo o seu proprio navegador ja autenticado e com comportamento humano.
echo.

set "PROFILE_DIR=C:\Users\wendel\ChromeDebugProfile"

if not exist "%PROFILE_DIR%" (
    echo [INFO] Criando pasta de perfil dedicada em: %PROFILE_DIR%
    mkdir "%PROFILE_DIR%"
)

:: Procurando o Chrome nos caminhos padroes do Windows
set "CHROME_PATH="

if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) else if exist "%USERPROFILE%\AppData\Local\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%USERPROFILE%\AppData\Local\Google\Chrome\Application\chrome.exe"
)

if "%CHROME_PATH%" == "" (
    echo [ERRO] Nao foi possivel encontrar o Google Chrome automaticamente.
    echo Por favor, abra o terminal do Windows e execute o Chrome com estes parametros:
    echo --remote-debugging-port=9222 --user-data-dir="C:\Users\wendel\ChromeDebugProfile"
    echo.
    pause
    exit /b
)

echo [INFO] Google Chrome localizado em: "%CHROME_PATH%"
echo [INFO] Iniciando Chrome na porta de depuracao 9222...
echo.
echo IMPORTANTE:
echo 1. Faça login na sua conta do Axiom Trade se nao estiver logado nesta janela do Chrome.
echo 2. Nao feche o Chrome ou esta aba da axiom.trade/pulse enquanto o monitor estiver rodando.
echo.

start "" "%CHROME_PATH%" --remote-debugging-port=9222 --user-data-dir="%PROFILE_DIR%" "https://axiom.trade/pulse?chain=sol"

echo [SUCESSO] Navegador aberto!
echo.
echo Agora voce ja pode iniciar o monitor no seu terminal com o comando:
echo   node server.js
echo.
pause
