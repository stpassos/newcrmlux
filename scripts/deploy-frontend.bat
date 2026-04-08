@echo off
setlocal

echo [1/4] Git fetch + reset...
cd /d C:\newcrmlux-api
git update-ref -d refs/remotes/origin/main 2>nul
git fetch origin main
if %ERRORLEVEL% neq 0 ( echo ERRO: git fetch falhou & exit /b 1 )
git reset --hard FETCH_HEAD
if %ERRORLEVEL% neq 0 ( echo ERRO: git reset falhou & exit /b 1 )

echo [2/4] npm install...
cd /d C:\newcrmlux-api\frontend
call npm install
if %ERRORLEVEL% neq 0 ( echo ERRO: npm install falhou & exit /b 1 )

echo [3/4] npm build...
call npm run build
if %ERRORLEVEL% neq 0 ( echo ERRO: npm build falhou & exit /b 1 )

echo [4/4] Copiar para httpdocs...
xcopy /E /Y /I /Q dist\* C:\inetpub\vhosts\imodigital.pt\httpdocs\
if %ERRORLEVEL% neq 0 ( echo ERRO: xcopy falhou & exit /b 1 )

echo Deploy concluido com sucesso.
endlocal
