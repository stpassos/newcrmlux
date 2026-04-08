@echo off
setlocal

echo [1/3] Git fetch + reset...
cd /d C:\newcrmlux-api
git fetch --prune --force origin
if %ERRORLEVEL% neq 0 ( echo ERRO: git fetch falhou & exit /b 1 )
git reset --hard origin/main
if %ERRORLEVEL% neq 0 ( echo ERRO: git reset falhou & exit /b 1 )

echo [2/3] npm install...
cd /d C:\newcrmlux-api\api
call npm install --omit=dev
if %ERRORLEVEL% neq 0 ( echo ERRO: npm install falhou & exit /b 1 )

echo [3/3] pm2 restart...
pm2 restart newcrmlux-api
if %ERRORLEVEL% neq 0 ( echo ERRO: pm2 restart falhou & exit /b 1 )
pm2 save

echo Deploy API concluido com sucesso.
endlocal
