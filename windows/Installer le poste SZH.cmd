@echo off
rem ---------------------------------------------------------------------------
rem  Installation d'un poste SZH, en un double-clic.
rem
rem  Ne fait qu'une chose : obtenir les droits administrateur, puis lancer
rem  bootstrap.ps1 qui est a cote. Tout le reste est dans ce script-la.
rem
rem  Pourquoi un .cmd et non un .ps1 : un .ps1 double-clique s'ouvre dans le
rem  Bloc-notes sur un poste neuf, et demander a une collegue d'ouvrir PowerShell
rem  en administrateur puis de taper une ligne, c'est deja trop.
rem ---------------------------------------------------------------------------
setlocal
title Installation du poste SZH
cd /d "%~dp0"

set "SZH_BOOTSTRAP=%~dp0bootstrap.ps1"
set "SZH_MOI=%~f0"

rem ---- Le script attendu est-il bien a cote ? --------------------------------
rem Verifie avant l'elevation : une boite UAC suivie d'une erreur serait plus
rem deroutante qu'un message tout de suite.
if not exist "%SZH_BOOTSTRAP%" (
  echo.
  echo   Fichier manquant : bootstrap.ps1
  echo.
  echo   Ce raccourci doit rester dans le dossier "windows" du toolkit, avec
  echo   bootstrap.ps1, szh-common.ps1 et szh-taches.ps1 a cote de lui.
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
if not errorlevel 1 goto :installer

rem ---- Non : on se relance en demandant l'elevation --------------------------
rem Le chemin passe par une variable d'environnement plutot que par la ligne de
rem commande : un dossier au nom contenant des espaces, une apostrophe ou un
rem accent casserait les guillemets imbriques de cmd et de PowerShell.
echo.
echo   Installation du poste SZH.
echo   Windows va demander l'autorisation d'administrateur : acceptez-la.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { Start-Process -FilePath $env:ComSpec -ArgumentList '/c', ('\"' + $env:SZH_MOI + '\"') -Verb RunAs } catch { exit 1 }"
if errorlevel 1 (
  echo.
  echo   Autorisation refusee : rien n'a ete installe.
  echo.
  echo   L'installation d'un poste demande les droits administrateur, une seule
  echo   fois. Ensuite, les mises a jour s'en passent. Si vous ne les avez pas
  echo   sur ce poste, demandez au service informatique de lancer ce fichier.
  echo.
  pause
)
exit /b

rem ---- Elevation obtenue : on installe ---------------------------------------
:installer
echo.
echo   Droits administrateur obtenus. Installation en cours.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%SZH_BOOTSTRAP%"
set "SZH_CODE=%errorlevel%"

echo.
if "%SZH_CODE%"=="0" (
  echo   Installation terminee.
  echo   Le menu Demarrer porte desormais "Revues SZH" et "Zeitschriften SZH".
) else (
  echo   L'installation s'est arretee ^(code %SZH_CODE%^).
  echo   Le detail est au-dessus, et dans C:\ProgramData\SZH\logs.
)
echo.
rem La fenetre reste ouverte : elevee, elle s'ouvre seule et se refermerait sans
rem que personne n'ait lu ce qui s'est passe.
pause
exit /b %SZH_CODE%
