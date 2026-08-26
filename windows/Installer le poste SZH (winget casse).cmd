@echo off
rem ---------------------------------------------------------------------------
rem  Installation d'un poste SZH, variante "la source winget est cassee".
rem
rem  Meme fichier que "Installer le poste SZH.cmd", avec une etape en plus avant
rem  bootstrap.ps1 : remettre la source winget d'aplomb, puis poser VSCodium et
rem  SumatraPDF, et seulement ensuite installer le poste.
rem
rem  A n'utiliser que si l'installation normale s'est arretee sur "VSCodium
rem  introuvable apres installation", ou sur un message winget du genre
rem  "0x8a15000f : donnees manquantes" / "aucun paquet trouve dans les sources".
rem  Dans tous les autres cas, "Installer le poste SZH.cmd" suffit : il repare
rem  deja la source tout seul, sans afficher ce detail.
rem ---------------------------------------------------------------------------
setlocal
title Installation du poste SZH (reparation winget)
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
echo   Installation du poste SZH, avec reparation prealable de winget.
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

rem ---- Elevation obtenue : winget d'abord, le poste ensuite -------------------
:installer
echo.
echo   Droits administrateur obtenus.
echo.
echo   ETAPE 1 sur 2 : remise en etat de winget.
echo   Les erreurs affichees ici ne sont pas bloquantes : bootstrap.ps1 sait
echo   telecharger VSCodium lui-meme si winget reste muet.
echo.

where winget >nul 2>&1
if errorlevel 1 (
  echo   winget est absent de ce poste ^(App Installer non provisionne^).
  echo   A installer depuis https://aka.ms/getwinget, ou passer outre : la suite
  echo   ira chercher VSCodium directement sur sa page de publication.
  echo.
  goto :bootstrap
)

echo   --- version de winget ---
winget --version
echo.
echo   --- 1/4  remise a zero des sources ---
winget source reset --force
echo.
echo   --- 2/4  resynchronisation de l'index ---
winget source update
echo.
echo   --- 3/4  VSCodium ---
rem --source winget : la source msstore n'heberge aucun de ces deux paquets, et
rem c'est elle qui reclame un accord et une region a deux lettres. L'ecarter
rem supprime la moitie des messages d'erreur a l'ecran.
winget install --id VSCodium.VSCodium -e --source winget --accept-source-agreements --accept-package-agreements
echo.
echo   --- 4/4  SumatraPDF ---
winget install --id SumatraPDF.SumatraPDF -e --source winget --accept-source-agreements --accept-package-agreements

:bootstrap
echo.
echo   ETAPE 2 sur 2 : installation du poste.
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
