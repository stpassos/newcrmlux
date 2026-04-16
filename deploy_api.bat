cd C:\newcrmlux-api
git pull origin main
cd C:\newcrmlux-api\api
npm install --omit=dev
pm2 restart newcrmlux-api || pm2 start ecosystem.config.js
pm2 save
cd C:\newcrmlux-api\frontend
npm install
npm run build
del /Q C:\inetpub\vhosts\imodigital.pt\admin.imodigital.pt\assets\*
xcopy /E /Y dist\* C:\inetpub\vhosts\imodigital.pt\admin.imodigital.pt\
echo EXIT:%ERRORLEVEL%
