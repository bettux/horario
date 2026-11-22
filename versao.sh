#!/bin/sh
# Troca a versão dos arquivos (?v=...) para o navegador baixar tudo de novo após cada atualização.
V=$(date +%Y%m%d%H%M)
sed -i -E "s/(\.js|\.css)\?v=[0-9]+/\1?v=$V/g" js/*.js *.html
echo "versão $V"
