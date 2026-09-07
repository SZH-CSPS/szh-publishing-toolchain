@echo off
rem ---------------------------------------------------------------------------
rem  Desinstallation d'un poste SZH, en un double-clic : retire le toolkit, les
rem  taches planifiees, les raccourcis, les reglages et extensions VSCodium du
rem  compte, sans toucher a WSL ni aux revues. Demande une confirmation tapee
rem  en clair avant d'agir -- voir uninstall.ps1.
rem
rem  A lancer depuis un clone frais du depot ou une extraction fraiche de
rem  toolkit-<version>.zip -- jamais depuis C:\ProgramData\SZH\toolkit : ce
rem  dossier est modifiable par n'importe quel compte du poste, et l'executer
rem  sous elevation reviendrait a executer un code qu'un compte standard y
rem  aurait depose.
rem ---------------------------------------------------------------------------
setlocal
title Desinstallation du poste SZH
cd /d "%~dp0"

set "SZH_UNINSTALL=%~dp0uninstall.ps1"
set "SZH_MOI=%~f0"

rem ---- Le script attendu est-il bien a cote ? --------------------------------
rem Verifie avant l'elevation : une boite UAC suivie d'une erreur serait plus
rem deroutante qu'un message tout de suite.
if not exist "%SZH_UNINSTALL%" (
  echo.
  echo   Fichier manquant : uninstall.ps1
  echo.
  echo   Ce raccourci doit rester dans le dossier "windows" du toolkit, avec
  echo   uninstall.ps1, szh-common.ps1 et szh-desinstallation.ps1 a cote de lui.
  echo   Recopiez le dossier "windows" en entier, puis relancez.
  echo.
  pause
  exit /b 1
)

rem ---- Sommes-nous administrateur ? ------------------------------------------
rem fltmc echoue sans elevation, et repond en quelques millisecondes ; net session
rem interroge le service Serveur et peut trainer, voire manquer sur un poste ou il
rem est desactive.
fltmc >nul 2>&1
if not errorlevel 1 goto :desinstaller

rem ---- Non : on se relance en demandant l'elevation --------------------------
rem Le chemin passe par une variable d'environnement plutot que par la ligne de
rem commande : un dossier au nom contenant des espaces, une apostrophe ou un
rem accent casserait les guillemets imbriques de cmd et de PowerShell.
echo.
echo   Desinstallation du poste SZH.
echo   Windows va demander l'autorisation d'administrateur : acceptez-la.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { Start-Process -FilePath $env:ComSpec -ArgumentList '/c', ('\"' + $env:SZH_MOI + '\"') -Verb RunAs } catch { exit 1 }"
if errorlevel 1 (
  echo.
  echo   Autorisation refusee : rien n'a ete desinstalle.
  echo.
  echo   La desinstallation d'un poste demande les droits administrateur. Si
  echo   vous ne les avez pas sur ce poste, demandez au service informatique de
  echo   lancer ce fichier.
  echo.
  pause
)
exit /b

rem ---- Elevation obtenue : on desinstalle ------------------------------------
:desinstaller
echo.
echo   Droits administrateur obtenus. Verification en cours.
echo   Une confirmation sera demandee avant toute suppression.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%SZH_UNINSTALL%"
set "SZH_CODE=%errorlevel%"

echo.
if "%SZH_CODE%"=="0" (
  echo   Desinstallation terminee.
) else if "%SZH_CODE%"=="2" (
  echo   Desinstallation non effectuee -- voir le message ci-dessus.
) else (
  echo   La desinstallation s'est arretee avec des echecs ^(code %SZH_CODE%^).
  echo   Le detail est au-dessus, et dans le journal indique en fin d'execution.
)
echo.
rem La fenetre reste ouverte : elevee, elle s'ouvre seule et se refermerait sans
rem que personne n'ait lu ce qui s'est passe.
pause
exit /b %SZH_CODE%
