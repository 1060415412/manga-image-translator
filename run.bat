@echo off

pushd "%~dp0"
git pull --quiet
set "MANGA_TRANSLATOR_MODEL_DIR=C:\manga-image-translator-deps\models"
"C:\manga-image-translator-deps\venv\Scripts\python.exe" -m manga_translator %*
popd
