# Socle commun des scripts SZH — à dot-sourcer :  . "$PSScriptRoot\szh-common.ps1"
# Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# ---- Environnement hérité : ELECTRON_RUN_AS_NODE ----
# ⚠ Tout processus lancé par l'hôte d'extensions de VSCodium hérite de
# ELECTRON_RUN_AS_NODE=1 : Electron se prend alors pour Node et `VSCodium.exe "<dossier>"`
# cherche un script au lieu d'ouvrir le dossier, puis meurt sans fenêtre. D'où ce
# nettoyage à l'entrée de chaque script, le dot-source étant le seul passage obligé.
foreach ($nuisible in 'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE') {
  if (Test-Path ('Env:' + $nuisible)) {
    Remove-Item ('Env:' + $nuisible) -ErrorAction SilentlyContinue
  }
}

$script:SzhBase       = 'C:\ProgramData\SZH'
$script:SzhToolkit    = Join-Path $SzhBase 'toolkit'
$script:SzhStaging    = Join-Path $SzhBase 'staging'
$script:SzhLogs       = Join-Path $SzhBase 'logs'
$script:SzhStateFile  = Join-Path $SzhBase 'state.json'
$script:SzhConfigFile = Join-Path $SzhBase 'config.json'
$script:SzhDistro     = 'SZH-Publishing'
$script:SzhSupport    = 'robin.morand@szh.ch'          # contact affiché en cas de problème

# ---- Langue de l'interface ----
# Trois sources, par ordre de priorité : la variable d'environnement (pour un essai), la
# préférence enregistrée par le dernier lanceur ouvert, puis la langue d'affichage de
# Windows. Anglais en dernier recours seulement : les postes d'ici affichent Windows en
# anglais, et le lanceur parlait donc anglais à des équipes francophone et germanophone.
# Textes allemands en orthographe suisse (ss, pas de ß).
$script:SzhLangue = 'en'
try {
  $langueUi = (Get-UICulture).TwoLetterISOLanguageName.ToLower()
  if ($langueUi -eq 'fr' -or $langueUi -eq 'de') { $script:SzhLangue = $langueUi }
} catch { }
# Lecture directe, sans Get-SzhState : la table des textes est utilisée dès le début du
# script, avant que les fonctions de plus bas soient définies pour tout le monde.
try {
  if (Test-Path $SzhStateFile) {
    $etatLangue = (Get-Content $SzhStateFile -Raw -Encoding UTF8 | ConvertFrom-Json)
    $memo = [string]$etatLangue.langue
    if (@('fr', 'de') -contains $memo) { $script:SzhLangue = $memo }
  }
} catch { }
if ($env:SZH_LANGUE -and (@('fr', 'de', 'en') -contains $env:SZH_LANGUE.ToLower())) {
  $script:SzhLangue = $env:SZH_LANGUE.ToLower()
}

$script:SzhTextes = @{
  fr = @{
    'app.titre'         = 'SZH/CSPS — Toolchain de publication'
    'maj.soustitre'     = 'Mise à jour de l''outil Revue'
    'maj.fenetre'       = 'Mise à jour de l''outil Revue SZH'
    'maj.intro1'        = 'Vos textes et vos revues ne sont pas touchés par cette opération.'
    'maj.intro2'        = 'Vous pouvez continuer à travailler pendant ce temps.'
    'maj.verif'         = 'Vérification de la version disponible…'
    'maj.cible'         = 'Version cible : {0}'
    'maj.e1'            = '1/5  Maquette et réglages…'
    'maj.e1.ok'         = 'Maquette et réglages à jour.'
    'maj.deja'          = 'Déjà à jour.'
    'maj.e2'            = '2/5  Environnement de fabrication du PDF…'
    'maj.dl.gros'       = 'C''est le plus gros téléchargement — merci de patienter.'
    'maj.dl.cache'      = 'Archive déjà téléchargée, réutilisée.'
    'maj.install'       = 'Installation (l''ancien environnement est jetable : aucune donnée dedans)…'
    'maj.env.ok'        = 'Environnement {0} installé.'
    'maj.env.deja'      = 'Déjà à jour ({0}).'
    'maj.e3'            = '3/5  Extensions de l''éditeur…'
    'maj.ext.ok'        = 'Extensions à jour.'
    'maj.codium.absent' = 'VSCodium introuvable — extensions ignorées (bootstrap.ps1 pas encore passé ?).'
    'maj.e4'            = '4/5  Réglages de l''éditeur…'
    'maj.e4.ok'         = 'Réglages appliqués, raccourci « Revues SZH » à jour.'
    'maj.e5'            = '5/5  Nettoyage…'
    'maj.e5.ok'         = 'Terminé.'
    'maj.fini'          = '✓ Tout est à jour (version {0}). Bonne rédaction !'
    'maj.ferme'         = 'Cette fenêtre se ferme toute seule dans quelques secondes.'
    'etape.prepa'       = 'préparation'
    'etape.manifest'    = 'lecture de la version disponible'
    'etape.toolkit'     = 'mise à jour de la maquette et des réglages'
    'etape.env'         = 'mise à jour de l''environnement de fabrication'
    'etape.ext'         = 'mise à jour des extensions de l''éditeur'
    'etape.reglages'    = 'application des réglages de l''éditeur'
    'etape.nettoyage'   = 'nettoyage'
    'err.empreinte'     = 'Empreinte invalide pour {0}.'
    'err.wsl'           = 'L''import de l''environnement WSL a échoué.'
    'err.titre'         = 'Une erreur est survenue pendant la mise à jour.'
    'err.l.etape'       = 'Étape   : {0}'
    'err.l.detail'      = 'Détail  : {0}'
    'err.l.journal'     = 'Journal : {0}'
    'err.rassure'       = 'Pas d''inquiétude : vos textes et vos revues ne sont pas touchés.'
    'err.retry'         = 'La mise à jour réessaiera toute seule. Si le problème persiste : {0}'
    'err.menu'          = '[E] préparer un e-mail au support   [O] ouvrir le journal   [autre touche] fermer'
    'mail.sujet'        = 'Probleme de mise a jour - outil Revue SZH ({0})'
    'mail.corps'        = "Bonjour,`r`n`r`nLa mise a jour de l'outil Revue a rencontre un probleme.`r`n`r`nPoste   : {0}`r`nEtape   : {1}`r`nDetail  : {2}`r`nJournal : {3}`r`n`r`nMerci de joindre le fichier journal ci-dessus a ce message."
    'dl.format'         = '{0:N1} / {1:N1} Mo'
    'lanceur.choisir'   = 'Choisissez la revue à ouvrir :'
    'lanceur.ouvrir'    = 'Ouvrir'
    'lanceur.annuler'   = 'Annuler'
    'lanceur.modifie'   = '{0}    (modifiée le {1})'
    'lanceur.codium'    = 'L''éditeur VSCodium est introuvable sur ce poste. Contact : {0}'
    'lanceur.vide'      = 'Aucune revue sur ce poste pour l''instant — « Nouvelle revue… » pour commencer.'
    'lanceur.nouvelle'          = 'Nouvelle revue…'
    'lanceur.nouvelle.nom'      = 'Nom du dossier de la nouvelle revue (p. ex. 2026-02) :'
    'lanceur.nouvelle.ou'       = "Elle sera créée dans :`n{0}"
    'lanceur.nouvelle.existe'   = 'Un dossier « {0} » existe déjà à cet emplacement.'
    'lanceur.nouvelle.invalide' = 'Le nom contient des caractères interdits ( < > : " / \ | ? * ).'
    'lanceur.nouvelle.erreur'   = "La création de la revue a échoué :`n{0}"
    # Cycle de vie du numéro : listes du lanceur, version du logiciel, mode test.
    'maj.concurrente'           = 'Une mise à jour est déjà en cours dans une autre fenêtre — celle-ci se ferme.'
    'lanceur.versions.chargement' = 'Recherche des versions publiées…'
    'lanceur.versions.horsligne.deja' = "Aucune version n'est installable hors ligne sur ce poste : seule la version déjà installée est proposée."
    'lanceur.erreur'            = "Le lanceur n'a pas pu démarrer :`n`n{0}`n`nContact : {1}"
    'lanceur.titre'             = 'Revues SZH'
    'lanceur.titre.zs'          = 'Zeitschriften SZH'
    'lanceur.choisir.zs'        = 'Choisissez la Zeitschrift à ouvrir :'
    'lanceur.vide.zs'           = 'Aucune Zeitschrift sur ce poste pour l''instant — « Nouvelle revue… » pour commencer.'
    'lien.invalide'             = "Ce lien n'est pas un lien de revue SZH valide :`n`n{0}"
    'lien.introuvable'          = "Ce lien renvoie au numéro « {0} » ({1}), introuvable sur ce poste.`n`nVérifiez que OneDrive a fini de synchroniser le dossier, puis réessayez. Vous pouvez aussi ouvrir le numéro à la main depuis « Revues SZH »."
    'lanceur.hors'              = '{0} revue(s) hors arborescence dans {1} — à déplacer.'
    'lanceur.encours'           = 'En cours :'
    'lanceur.archives'          = 'Archivées :'
    'lanceur.vide.archives'     = 'Aucune revue archivée.'
    'lanceur.version'           = 'Logiciel v. {0}'
    'lanceur.version.inconnue'  = 'Logiciel : version inconnue'
    'lanceur.test'              = 'Mode test : {0}'
    'lanceur.versions.bouton'   = 'Version du logiciel…'
    'lanceur.versions.titre'    = 'Version du logiciel'
    'lanceur.versions.intro'    = 'Version installée : {0}. Choisissez la version à installer :'
    'lanceur.versions.installee' = '{0}    (installée)'
    'lanceur.versions.locale'   = '{0}    (installable hors ligne)'
    'lanceur.versions.installer' = 'Installer'
    'lanceur.versions.horsligne' = "Impossible de lister les versions publiées : pas de connexion, ou trop de demandes vers GitHub depuis ce réseau.`nSeules les versions installables hors ligne sont proposées."
    'lanceur.versions.vide'     = 'Aucune version disponible sur ce poste.'
    'lanceur.versions.avert'    = "Changer de version remplace la maquette, l'environnement de fabrication du PDF et les extensions de l'éditeur.`n`nFermez les fenêtres de rédaction avant de continuer, puis redémarrez l'éditeur à la fin.`n`nInstaller la version {0} ?"
    # Archivage / désarchivage d'une revue (archive-revue.ps1)
    'arch.titre'                = 'Archivage de la revue'
    'arch.titre.des'            = 'Désarchivage de la revue'
    'arch.attente'              = 'Attente de la fermeture de l''éditeur…'
    'arch.deplacement'          = 'Déplacement vers {0}…'
    'arch.ok'                   = 'Revue déplacée : {0}'
    'arch.rouvre'              = 'Réouverture de la revue…'
    'arch.err.introuvable'      = 'Dossier de revue introuvable : {0}'
    'arch.err.existe'           = 'Un dossier « {0} » existe déjà à destination — rien n''a été déplacé.'
    'arch.err.verrou'           = "Le dossier est encore utilisé par une autre application après {0} s — rien n'a été déplacé. Fermez l'éditeur et l'aperçu PDF, puis réessayez."
    'arch.err.emplacement'      = 'Aucun emplacement connu pour la revue « {0} » — vérifiez basesRevues dans config.json.'
    'arch.err.suite'            = 'Rien n''a été déplacé : la revue est restée où elle était. En cas de doute : {0}'
    # Double-clic sur un .md (open-md.ps1) : messages des cas anormaux seulement.
    'openmd.vide'         = "Aucun fichier à ouvrir.`n`nCe raccourci s'utilise en double-cliquant un fichier .md."
    'openmd.introuvable'  = "Ce fichier est introuvable.`n`nIl a peut-être été déplacé ou renommé, ou OneDrive ne l'a pas encore synchronisé."
    'openmd.horsrevue'    = "Ce fichier ne fait pas partie d'une revue : l'aperçu et la régénération ne seront pas actifs.`n`nIl s'ouvre quand même, pour le lire ou le corriger."
    'openmd.reseau'       = "Ce fichier est dans un dossier réseau. Il s'ouvre, mais la fabrication du PDF et l'aperçu ne fonctionnent pas depuis un chemin réseau.`n`nPour travailler dessus, copiez la revue dans OneDrive ou sur le disque de ce poste."
  }
  de = @{
    'app.titre'         = 'SZH/CSPS — Publikations-Toolchain'
    'maj.soustitre'     = 'Aktualisierung des Redaktionstools'
    'maj.fenetre'       = 'Aktualisierung — SZH-Redaktionstool'
    'maj.intro1'        = 'Ihre Texte und Zeitschriften werden dabei nicht verändert.'
    'maj.intro2'        = 'Sie können währenddessen weiterarbeiten.'
    'maj.verif'         = 'Prüfe die verfügbare Version…'
    'maj.cible'         = 'Zielversion: {0}'
    'maj.e1'            = '1/5  Layout und Einstellungen…'
    'maj.e1.ok'         = 'Layout und Einstellungen sind aktuell.'
    'maj.deja'          = 'Bereits aktuell.'
    'maj.e2'            = '2/5  PDF-Erzeugungsumgebung…'
    'maj.dl.gros'       = 'Dies ist der grösste Download — bitte etwas Geduld.'
    'maj.dl.cache'      = 'Archiv bereits heruntergeladen, wird wiederverwendet.'
    'maj.install'       = 'Installation (die alte Umgebung ist wegwerfbar: sie enthält keine Daten)…'
    'maj.env.ok'        = 'Umgebung {0} installiert.'
    'maj.env.deja'      = 'Bereits aktuell ({0}).'
    'maj.e3'            = '3/5  Editor-Erweiterungen…'
    'maj.ext.ok'        = 'Erweiterungen sind aktuell.'
    'maj.codium.absent' = 'VSCodium nicht gefunden — Erweiterungen übersprungen (bootstrap.ps1 noch nicht ausgeführt?).'
    'maj.e4'            = '4/5  Editor-Einstellungen…'
    'maj.e4.ok'         = 'Einstellungen angewendet, Verknüpfung « Revues SZH » aktualisiert.'
    'maj.e5'            = '5/5  Aufräumen…'
    'maj.e5.ok'         = 'Fertig.'
    'maj.fini'          = '✓ Alles ist aktuell (Version {0}). Gutes Schreiben!'
    'maj.ferme'         = 'Dieses Fenster schliesst sich in wenigen Sekunden von selbst.'
    'etape.prepa'       = 'Vorbereitung'
    'etape.manifest'    = 'Abruf der verfügbaren Version'
    'etape.toolkit'     = 'Aktualisierung von Layout und Einstellungen'
    'etape.env'         = 'Aktualisierung der Erzeugungsumgebung'
    'etape.ext'         = 'Aktualisierung der Editor-Erweiterungen'
    'etape.reglages'    = 'Anwenden der Editor-Einstellungen'
    'etape.nettoyage'   = 'Aufräumen'
    'err.empreinte'     = 'Ungültige Prüfsumme für {0}.'
    'err.wsl'           = 'Der Import der WSL-Umgebung ist fehlgeschlagen.'
    'err.titre'         = 'Bei der Aktualisierung ist ein Fehler aufgetreten.'
    'err.l.etape'       = 'Schritt   : {0}'
    'err.l.detail'      = 'Detail    : {0}'
    'err.l.journal'     = 'Protokoll : {0}'
    'err.rassure'       = 'Keine Sorge: Ihre Texte und Zeitschriften sind nicht betroffen.'
    'err.retry'         = 'Die Aktualisierung versucht es später automatisch erneut. Falls das Problem bleibt: {0}'
    'err.menu'          = '[E] E-Mail an den Support vorbereiten   [O] Protokoll öffnen   [andere Taste] schliessen'
    'mail.sujet'        = 'Problem bei der Aktualisierung - SZH-Redaktionstool ({0})'
    'mail.corps'        = "Guten Tag,`r`n`r`nBei der Aktualisierung des SZH-Redaktionstools ist ein Problem aufgetreten.`r`n`r`nComputer  : {0}`r`nSchritt   : {1}`r`nDetail    : {2}`r`nProtokoll : {3}`r`n`r`nBitte haengen Sie die oben genannte Protokolldatei an diese Nachricht an."
    'dl.format'         = '{0:N1} / {1:N1} MB'
    'lanceur.choisir'   = 'Wählen Sie die zu öffnende Zeitschrift:'
    'lanceur.ouvrir'    = 'Öffnen'
    'lanceur.annuler'   = 'Abbrechen'
    'lanceur.modifie'   = '{0}    (geändert am {1})'
    'lanceur.codium'    = 'Der Editor VSCodium wurde auf diesem Computer nicht gefunden. Kontakt: {0}'
    'lanceur.vide'      = 'Noch keine Zeitschrift auf diesem Computer — mit « Neue Zeitschrift… » beginnen.'
    'lanceur.nouvelle'          = 'Neue Zeitschrift…'
    'lanceur.nouvelle.nom'      = 'Ordnername der neuen Zeitschrift (z. B. 2026-02):'
    'lanceur.nouvelle.ou'       = "Sie wird erstellt in:`n{0}"
    'lanceur.nouvelle.existe'   = 'Ein Ordner « {0} » existiert an diesem Ort bereits.'
    'lanceur.nouvelle.invalide' = 'Der Name enthält unzulässige Zeichen ( < > : " / \ | ? * ).'
    'lanceur.nouvelle.erreur'   = "Die Zeitschrift konnte nicht erstellt werden:`n{0}"
    # Lebenszyklus der Ausgabe
    'maj.concurrente'           = 'In einem anderen Fenster läuft bereits eine Aktualisierung — dieses schliesst sich.'
    'lanceur.versions.chargement' = 'Suche nach veröffentlichten Versionen…'
    'lanceur.versions.horsligne.deja' = "Auf diesem Computer ist keine Version offline installierbar: es wird nur die bereits installierte Version angeboten."
    'lanceur.erreur'            = "Der Starter konnte nicht gestartet werden:`n`n{0}`n`nKontakt: {1}"
    'lanceur.titre'             = 'Revues SZH'
    'lanceur.titre.zs'          = 'Zeitschriften SZH'
    'lanceur.choisir.zs'        = 'Wählen Sie die zu öffnende Zeitschrift:'
    'lanceur.vide.zs'           = 'Noch keine Zeitschrift auf diesem Computer — mit « Neue Zeitschrift… » beginnen.'
    'lien.invalide'             = "Dieser Link ist kein gültiger SZH-Zeitschriftenlink:`n`n{0}"
    'lien.introuvable'          = "Dieser Link verweist auf die Ausgabe « {0} » ({1}), die auf diesem Computer nicht gefunden wurde.`n`nPrüfen Sie, ob OneDrive den Ordner fertig synchronisiert hat, und versuchen Sie es erneut. Sie können die Ausgabe auch von Hand über « Zeitschriften SZH » öffnen."
    'lanceur.hors'              = '{0} Zeitschrift(en) ausserhalb der Ablage in {1} — zu verschieben.'
    'lanceur.encours'           = 'In Arbeit:'
    'lanceur.archives'          = 'Archiviert:'
    'lanceur.vide.archives'     = 'Keine archivierte Zeitschrift.'
    'lanceur.version'           = 'Software v. {0}'
    'lanceur.version.inconnue'  = 'Software: Version unbekannt'
    'lanceur.test'              = 'Testmodus: {0}'
    'lanceur.versions.bouton'   = 'Software-Version…'
    'lanceur.versions.titre'    = 'Software-Version'
    'lanceur.versions.intro'    = 'Installierte Version: {0}. Wählen Sie die zu installierende Version:'
    'lanceur.versions.installee' = '{0}    (installiert)'
    'lanceur.versions.locale'   = '{0}    (offline installierbar)'
    'lanceur.versions.installer' = 'Installieren'
    'lanceur.versions.horsligne' = "Die veröffentlichten Versionen konnten nicht abgerufen werden: keine Verbindung, oder zu viele Anfragen an GitHub aus diesem Netz.`nEs werden nur die offline installierbaren Versionen angeboten."
    'lanceur.versions.vide'     = 'Keine Version auf diesem Computer verfügbar.'
    'lanceur.versions.avert'    = "Ein Versionswechsel ersetzt das Layout, die PDF-Erzeugungsumgebung und die Editor-Erweiterungen.`n`nSchliessen Sie zuerst die Redaktionsfenster und starten Sie den Editor am Ende neu.`n`nVersion {0} installieren?"
    # Archivieren / Dearchivieren (archive-revue.ps1)
    'arch.titre'                = 'Archivierung der Zeitschrift'
    'arch.titre.des'            = 'Dearchivierung der Zeitschrift'
    'arch.attente'              = 'Warten auf das Schliessen des Editors…'
    'arch.deplacement'          = 'Verschieben nach {0}…'
    'arch.ok'                   = 'Zeitschrift verschoben: {0}'
    'arch.rouvre'              = 'Zeitschrift wird wieder geöffnet…'
    'arch.err.introuvable'      = 'Ordner der Zeitschrift nicht gefunden: {0}'
    'arch.err.existe'           = 'Am Ziel existiert bereits ein Ordner « {0} » — es wurde nichts verschoben.'
    'arch.err.verrou'           = "Der Ordner wird nach {0} s noch von einer anderen Anwendung verwendet — es wurde nichts verschoben. Schliessen Sie den Editor und die PDF-Vorschau und versuchen Sie es erneut."
    'arch.err.emplacement'      = 'Kein bekannter Ort für die Zeitschrift « {0} » — prüfen Sie basesRevues in config.json.'
    'arch.err.suite'            = 'Es wurde nichts verschoben: die Zeitschrift ist an ihrem Platz geblieben. Bei Zweifeln: {0}'
    # Doppelklick auf eine .md-Datei (open-md.ps1): nur die anormalen Fälle.
    'openmd.vide'         = "Keine Datei zum Öffnen.`n`nDieser Befehl wird per Doppelklick auf eine .md-Datei verwendet."
    'openmd.introuvable'  = "Diese Datei wurde nicht gefunden.`n`nSie wurde vielleicht verschoben oder umbenannt, oder OneDrive hat sie noch nicht synchronisiert."
    'openmd.horsrevue'    = "Diese Datei gehört zu keiner Zeitschrift: Vorschau und Neuerzeugung sind nicht aktiv.`n`nSie wird trotzdem geöffnet, zum Lesen oder Korrigieren."
    'openmd.reseau'       = "Diese Datei liegt in einem Netzwerkordner. Sie wird geöffnet, aber die PDF-Erzeugung und die Vorschau funktionieren von einem Netzwerkpfad aus nicht.`n`nKopieren Sie die Zeitschrift zum Arbeiten nach OneDrive oder auf die Festplatte dieses Computers."
  }
  en = @{
    'app.titre'         = 'SZH/CSPS — Publishing toolchain'
    'maj.soustitre'     = 'Journal tool update'
    'maj.fenetre'       = 'SZH journal tool — update'
    'maj.intro1'        = 'Your texts and journals are not affected by this operation.'
    'maj.intro2'        = 'You can keep working in the meantime.'
    'maj.verif'         = 'Checking the available version…'
    'maj.cible'         = 'Target version: {0}'
    'maj.e1'            = '1/5  Layout and settings…'
    'maj.e1.ok'         = 'Layout and settings up to date.'
    'maj.deja'          = 'Already up to date.'
    'maj.e2'            = '2/5  PDF build environment…'
    'maj.dl.gros'       = 'This is the largest download — please be patient.'
    'maj.dl.cache'      = 'Archive already downloaded, reusing it.'
    'maj.install'       = 'Installing (the old environment is disposable: it holds no data)…'
    'maj.env.ok'        = 'Environment {0} installed.'
    'maj.env.deja'      = 'Already up to date ({0}).'
    'maj.e3'            = '3/5  Editor extensions…'
    'maj.ext.ok'        = 'Extensions up to date.'
    'maj.codium.absent' = 'VSCodium not found — extensions skipped (bootstrap.ps1 not run yet?).'
    'maj.e4'            = '4/5  Editor settings…'
    'maj.e4.ok'         = 'Settings applied, “Revues SZH” shortcut updated.'
    'maj.e5'            = '5/5  Cleanup…'
    'maj.e5.ok'         = 'Done.'
    'maj.fini'          = '✓ Everything is up to date (version {0}). Happy writing!'
    'maj.ferme'         = 'This window will close itself in a few seconds.'
    'etape.prepa'       = 'preparation'
    'etape.manifest'    = 'reading the available version'
    'etape.toolkit'     = 'updating layout and settings'
    'etape.env'         = 'updating the build environment'
    'etape.ext'         = 'updating editor extensions'
    'etape.reglages'    = 'applying editor settings'
    'etape.nettoyage'   = 'cleanup'
    'err.empreinte'     = 'Invalid checksum for {0}.'
    'err.wsl'           = 'Importing the WSL environment failed.'
    'err.titre'         = 'An error occurred during the update.'
    'err.l.etape'       = 'Step   : {0}'
    'err.l.detail'      = 'Detail : {0}'
    'err.l.journal'     = 'Log    : {0}'
    'err.rassure'       = 'No worries: your texts and journals are not affected.'
    'err.retry'         = 'The update will retry automatically. If the problem persists: {0}'
    'err.menu'          = '[E] prepare a support e-mail   [O] open the log   [any other key] close'
    'mail.sujet'        = 'Update problem - SZH journal tool ({0})'
    'mail.corps'        = "Hello,`r`n`r`nThe SZH journal tool update ran into a problem.`r`n`r`nComputer: {0}`r`nStep    : {1}`r`nDetail  : {2}`r`nLog     : {3}`r`n`r`nPlease attach the log file above to this message."
    'dl.format'         = '{0:N1} / {1:N1} MB'
    'lanceur.choisir'   = 'Choose the journal to open:'
    'lanceur.ouvrir'    = 'Open'
    'lanceur.annuler'   = 'Cancel'
    'lanceur.modifie'   = '{0}    (modified on {1})'
    'lanceur.codium'    = 'The VSCodium editor was not found on this computer. Contact: {0}'
    'lanceur.vide'      = 'No journal on this computer yet — use “New journal…” to get started.'
    'lanceur.nouvelle'          = 'New journal…'
    'lanceur.nouvelle.nom'      = 'Folder name for the new journal (e.g. 2026-02):'
    'lanceur.nouvelle.ou'       = "It will be created in:`n{0}"
    'lanceur.nouvelle.existe'   = 'A folder named {0} already exists at this location.'
    'lanceur.nouvelle.invalide' = 'The name contains forbidden characters ( < > : " / \ | ? * ).'
    'lanceur.nouvelle.erreur'   = "Creating the journal failed:`n{0}"
    # Issue life cycle
    'maj.concurrente'           = 'An update is already running in another window — this one is closing.'
    'lanceur.versions.chargement' = 'Looking for published versions…'
    'lanceur.versions.horsligne.deja' = "No version can be installed offline on this computer: only the version already installed is offered."
    'lanceur.erreur'            = "The launcher could not start:`n`n{0}`n`nContact: {1}"
    'lanceur.titre'             = 'Revues SZH'
    'lanceur.titre.zs'          = 'Zeitschriften SZH'
    'lanceur.choisir.zs'        = 'Choose the Zeitschrift to open:'
    'lanceur.vide.zs'           = 'No Zeitschrift on this computer yet — use "New journal…" to get started.'
    'lien.invalide'             = "This is not a valid SZH journal link:`n`n{0}"
    'lien.introuvable'          = "This link points to issue {0} ({1}), which was not found on this computer.`n`nCheck that OneDrive has finished syncing the folder, then try again. You can also open the issue by hand from the Revues SZH launcher."
    'lanceur.hors'              = '{0} journal(s) outside the official tree in {1} — to be moved.'
    'lanceur.encours'           = 'In progress:'
    'lanceur.archives'          = 'Archived:'
    'lanceur.vide.archives'     = 'No archived journal.'
    'lanceur.version'           = 'Software v. {0}'
    'lanceur.version.inconnue'  = 'Software: unknown version'
    'lanceur.test'              = 'Test mode: {0}'
    'lanceur.versions.bouton'   = 'Software version…'
    'lanceur.versions.titre'    = 'Software version'
    'lanceur.versions.intro'    = 'Installed version: {0}. Choose the version to install:'
    'lanceur.versions.installee' = '{0}    (installed)'
    'lanceur.versions.locale'   = '{0}    (installable offline)'
    'lanceur.versions.installer' = 'Install'
    'lanceur.versions.horsligne' = "Could not list the published versions: no connection, or too many requests to GitHub from this network.`nOnly versions installable offline are offered."
    'lanceur.versions.vide'     = 'No version available on this computer.'
    'lanceur.versions.avert'    = "Switching version replaces the layout, the PDF build environment and the editor extensions.`n`nClose the writing windows first, then restart the editor when it is done.`n`nInstall version {0}?"
    # Archiving / unarchiving a journal (archive-revue.ps1)
    'arch.titre'                = 'Archiving the journal'
    'arch.titre.des'            = 'Unarchiving the journal'
    'arch.attente'              = 'Waiting for the editor to close…'
    'arch.deplacement'          = 'Moving to {0}…'
    'arch.ok'                   = 'Journal moved: {0}'
    'arch.rouvre'              = 'Reopening the journal…'
    'arch.err.introuvable'      = 'Journal folder not found: {0}'
    'arch.err.existe'           = 'A folder named “{0}” already exists at the destination — nothing was moved.'
    'arch.err.verrou'           = "The folder is still in use by another application after {0} s — nothing was moved. Close the editor and the PDF preview, then try again."
    'arch.err.emplacement'      = 'No known location for journal “{0}” — check basesRevues in config.json.'
    'arch.err.suite'            = 'Nothing was moved: the journal stayed where it was. If in doubt: {0}'
    # Double-click on a .md file (open-md.ps1): abnormal cases only.
    'openmd.vide'         = "No file to open.`n`nThis shortcut is meant to be used by double-clicking a .md file."
    'openmd.introuvable'  = "This file cannot be found.`n`nIt may have been moved or renamed, or OneDrive has not synced it yet."
    'openmd.horsrevue'    = "This file is not part of a journal: the preview and automatic rebuild will not be active.`n`nIt opens anyway, so you can read or fix it."
    'openmd.reseau'       = "This file sits on a network folder. It opens, but PDF building and the preview do not work from a network path.`n`nTo work on it, copy the journal to OneDrive or to this computer's disk."
  }
}

# « Revues SZH » parle français, « Zeitschriften SZH » allemand : chaque lanceur s'adresse
# à son équipe, et non à la langue d'affichage de Windows. Le choix est retenu pour les
# scripts qui n'ont pas de produit — la mise à jour, surtout, qui s'ouvre seule.
# $env:SZH_LANGUE garde le dernier mot, pour un essai.
function Set-SzhLangueProduit([string]$Produit) {
  $voulue = if (([string]$Produit).ToLower() -eq 'zeitschrift') { 'de' } else { 'fr' }
  if ($env:SZH_LANGUE -and (@('fr', 'de', 'en') -contains $env:SZH_LANGUE.ToLower())) { return }
  $script:SzhLangue = $voulue
  try {
    $etat = Get-SzhState
    if (-not $etat) { $etat = New-Object psobject }
    if ($etat.PSObject.Properties['langue']) { $etat.langue = $voulue }
    else { $etat | Add-Member -MemberType NoteProperty -Name 'langue' -Value $voulue }
    Save-SzhState $etat
  } catch { }        # préférence non écrite : la session courante reste dans la bonne langue
}

# T 'clé' @(args…) -> texte dans la langue courante, fallback anglais, sinon la clé.
function T {
  param([Parameter(Mandatory = $true)][string]$Cle, [object[]]$Valeurs)
  $texte = $null
  $table = $SzhTextes[$SzhLangue]
  if ($table -and $table.ContainsKey($Cle)) { $texte = $table[$Cle] }
  if (-not $texte) { $texte = $SzhTextes['en'][$Cle] }
  if (-not $texte) { return $Cle }
  if ($Valeurs -and $Valeurs.Count -gt 0) { return ($texte -f $Valeurs) }
  return $texte
}

# ---- Config / état ----

# JSON en UTF-8 sans BOM : `Set-Content -Encoding UTF8` en poserait un sous PowerShell 5.1,
# que JSON.parse() de Node refuse, et le cockpit relit config.json et l'intention
# d'ouverture. state.json, lu par PowerShell seul, passe par Save-SzhState.
function Set-SzhJson([string]$Chemin, $Objet) {
  $json = ($Objet | ConvertTo-Json -Depth 5)
  [System.IO.File]::WriteAllText($Chemin, $json, (New-Object System.Text.UTF8Encoding($false)))
}

# Lectures tolérantes : un fichier tronqué ou en cours d'écriture ne doit pas faire
# échouer un script qui n'a rien à voir, le lanceur d'abord, qui n'a pas de console.
function Get-SzhConfig {
  try {
    if (Test-Path $SzhConfigFile) { return (Get-Content $SzhConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json) }
  } catch { }
  return $null
}

function Get-SzhRepo {
  $cfg = Get-SzhConfig
  if ($cfg -and $cfg.repo) { return $cfg.repo }
  return 'SZH-CSPS/szh-publishing-toolchain'
}

function Get-SzhState {
  try {
    if (Test-Path $SzhStateFile) { return (Get-Content $SzhStateFile -Raw -Encoding UTF8 | ConvertFrom-Json) }
  } catch { }
  return $null
}

function Save-SzhState($Etat) {
  $Etat | ConvertTo-Json -Depth 5 | Set-Content -Path $SzhStateFile -Encoding UTF8
}

# ---- Version du logiciel installée ----
# Le fichier VERSION du toolkit d'abord, state.json en repli, chaîne vide sinon. Ne doit
# jamais lever : le lanceur l'appelle sans console, et une exception l'empêcherait de
# s'ouvrir sans laisser de trace. Pendant une mise à jour, VERSION peut être vide et
# state.json tronqué, d'où un try/catch par lecture.
function Get-SzhVersionInstallee {
  try {
    $fichier = Join-Path $SzhToolkit 'VERSION'
    if (Test-Path $fichier) {
      $brut = Get-Content $fichier -Raw -ErrorAction Stop
      if ($null -ne $brut) {
        $v = ([string]$brut).Trim()
        if ($v) { return $v }
      }
    }
  } catch { }
  try {
    $etat = Get-SzhState
    if ($etat -and $etat.version) { return ([string]$etat.version).Trim() }
  } catch { }
  return ''
}

# Trie par numéro, la plus récente d'abord : l'API GitHub trie par date de publication,
# et c'est dans cette liste qu'on cherche « la précédente ». [version] quand le tag s'y
# prête (2026.08.10 > 2026.08.7), ordre alphabétique inverse sinon.
function Sort-SzhVersions($Versions) {
  $paires = @()
  foreach ($v in $Versions) {
    $num = $null
    try { $num = [version]($v -replace '[^0-9.]', '') } catch { $num = $null }
    $paires += [pscustomobject]@{ texte = [string]$v; num = $num }
  }
  $avec = @($paires | Where-Object { $null -ne $_.num } | Sort-Object -Property num -Descending)
  $sans = @($paires | Where-Object { $null -eq $_.num } | Sort-Object -Property texte -Descending)
  return @(($avec + $sans) | ForEach-Object { $_.texte })
}

# Releases GitHub, les plus récentes d'abord ; tableau vide si le réseau manque ou refuse
# (403 de limite de débit). `per_page=100` : une page manquée ferait disparaître en
# silence les anciennes versions, celles-là mêmes qu'on cherche.
function Get-SzhVersionsPubliees {
  try {
    $url = ('https://api.github.com/repos/{0}/releases?per_page=100' -f (Get-SzhRepo))
    $entetes = @{ 'User-Agent' = 'SZH-Publishing'; 'Accept' = 'application/vnd.github+json' }
    $releases = Invoke-RestMethod -Uri $url -Headers $entetes -UseBasicParsing -TimeoutSec 8
    $versions = @()
    foreach ($r in $releases) {
      if ($r.draft) { continue }
      $tag = [string]$r.tag_name
      if (-not $tag) { continue }
      $versions += ($tag -replace '^v', '')
    }
    return (Sort-SzhVersions $versions)
  } catch {
    return @()
  }
}

# Versions installables hors ligne : l'archive du toolkit et le manifest doivent être
# tous deux en staging, update.ps1 s'arrêtant dès sa première étape sans le manifest.
function Get-SzhVersionsLocales {
  $versions = @()
  Get-ChildItem (Join-Path $SzhStaging 'toolkit-*.zip') -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | ForEach-Object {
      if ($_.Name -match '^toolkit-(.+)\.zip$') {
        $v = $Matches[1]
        if (Test-Path (Join-Path $SzhStaging ('manifest-{0}.json' -f $v))) { $versions += $v }
      }
    }
  return (Sort-SzhVersions $versions)
}

# Garde-fou de quoting : la valeur peut venir d'un nom de fichier de staging et part en
# argument de update.ps1, où « 2026.08.0 -Verbose » injecterait un paramètre.
function Test-SzhVersionTag([string]$Version) {
  if (-not $Version) { return $false }
  return ($Version -match '^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$')
}

# ---- Mode développeur & emplacements des revues ----
# Seul endroit qui décide où vivent les revues : le cockpit ne calcule aucun chemin
# SharePoint, il délègue l'archivage à archive-revue.ps1. Sous-dossiers identiques en test
# et en production, seule la base change, si bien qu'un essai exerce le code réel.
$script:SzhSousDossiers = @{
  revue       = @{ encours = '52_Revue\RV02_Redaction';        archive = '52_Revue\RV99_Archives' }
  zeitschrift = @{ encours = '53_Zeitschrift\ZS02_Redaktion';  archive = '53_Zeitschrift\ZS99_Archives' }
}
# Bases par défaut, surchargeables par config.json (« basesRevues ») : seule chaîne à
# corriger si la bibliothèque SharePoint est synchronisée ailleurs.
$script:SzhBasesDefaut = @{
  prod = '%USERPROFILE%\SZH CSPS\Daten_Allgemein - General\2_Produkte'
  dev  = '%USERPROFILE%\OneDrive - SZH CSPS\Revues-TESTING'
}

# Vrai par défaut, clé absente comprise : mieux vaut un essai en dossier de test.
function Get-SzhDevMode {
  $cfg = Get-SzhConfig
  if (-not $cfg) { return $true }
  if ($null -eq $cfg.PSObject.Properties['devMode']) { return $true }
  return ([bool]$cfg.devMode)
}


function Get-SzhBaseRevues {
  $cfg = Get-SzhConfig
  $cle = 'prod'
  if (Get-SzhDevMode) { $cle = 'dev' }
  $base = $SzhBasesDefaut[$cle]
  if ($cfg -and $cfg.basesRevues -and $cfg.basesRevues.$cle) { $base = [string]$cfg.basesRevues.$cle }
  return [Environment]::ExpandEnvironmentVariables($base)
}

# Les quatre emplacements du poste ; les listes à plat sont celles que balaie le lanceur.
function Get-SzhEmplacements {
  $base = Get-SzhBaseRevues
  $revue = @{
    encours = (Join-Path $base $SzhSousDossiers.revue.encours)
    archive = (Join-Path $base $SzhSousDossiers.revue.archive)
  }
  $zeitschrift = @{
    encours = (Join-Path $base $SzhSousDossiers.zeitschrift.encours)
    archive = (Join-Path $base $SzhSousDossiers.zeitschrift.archive)
  }
  return [pscustomobject]@{
    devMode     = (Get-SzhDevMode)
    base        = $base
    revue       = $revue
    zeitschrift = $zeitschrift
    encours     = @($revue.encours, $zeitschrift.encours)
    archives    = @($revue.archive, $zeitschrift.archive)
  }
}

# En mode test seulement, crée les quatre dossiers manquants. En production, jamais :
# l'arborescence est celle de SharePoint, un poste n'a pas à l'inventer.
function Initialize-SzhEmplacementsTest {
  $emp = Get-SzhEmplacements
  if (-not $emp.devMode) { return $false }
  foreach ($d in ($emp.encours + $emp.archives)) {
    if (-not (Test-Path $d)) {
      try { New-Item -ItemType Directory -Force -Path $d | Out-Null } catch { }
    }
  }
  return $true
}

# $Jeton = 'revue' | 'zeitschrift', $Etat = 'encours' | 'archive' ; '' si jeton inconnu.
function Get-SzhEmplacementRevue([string]$Jeton, [string]$Etat) {
  $emp = Get-SzhEmplacements
  if ($Jeton -eq 'zeitschrift') { return [string]$emp.zeitschrift.$Etat }
  if ($Jeton -eq 'revue') { return [string]$emp.revue.$Etat }
  return ''
}

# ---- Lecture d'ausgabe.yaml ----
# YAML plat, une clé par ligne, comme le sed du Makefile : pas de module YAML à installer
# sur le poste. Guillemets et commentaire de fin de ligne retirés, première occurrence
# gagnante, comme analyserAusgabe côté cockpit.
function Get-SzhAusgabe([string]$Fichier) {
  $valeurs = @{}
  if (-not (Test-Path $Fichier)) { return $valeurs }
  foreach ($ligne in (Get-Content $Fichier -Encoding UTF8)) {
    if ($ligne -notmatch '^([A-Za-z0-9_-]+):\s*(.*)$') { continue }
    $cle = $Matches[1]
    if ($valeurs.ContainsKey($cle)) { continue }
    $brut = $Matches[2].Trim()
    if ($brut -match '^"(.*)"\s*(#.*)?$') { $brut = $Matches[1] }
    elseif ($brut -match "^'(.*)'\s*(#.*)?$") { $brut = $Matches[1] }
    elseif ($brut -match '^([^#]*?)\s*#.*$') { $brut = $Matches[1] }
    $valeurs[$cle] = $brut.Trim()
  }
  return $valeurs
}

# Valeurs « vraies » tolérées, à garder alignées avec VRAIS_YAML (lib/yaml.js) et
# szh-maquette.lua : un ausgabe.yaml peut avoir été écrit à la main.
function Test-SzhVraiYaml($Valeur) {
  if ($null -eq $Valeur) { return $false }
  return (@('true', '1', 'oui', 'ja', 'yes', 'si') -contains ([string]$Valeur).Trim().ToLower())
}

# Accepte aussi l'ancien nom complet ; « zeitschrift » testé avant « revue », même ordre
# que normaliserRevue côté cockpit.
function Get-SzhJetonRevue($Valeur) {
  $v = ([string]$Valeur).ToLower()
  if ($v -like '*zeitschrift*') { return 'zeitschrift' }
  if ($v -like '*revue*') { return 'revue' }
  return ''
}

# État complet d'un dossier de revue, pour le lanceur et pour l'archivage.
function Get-SzhRevueEtat([string]$Dossier) {
  $valeurs = Get-SzhAusgabe (Join-Path $Dossier 'ausgabe.yaml')
  $titre = ''
  if ($valeurs.ContainsKey('title')) { $titre = $valeurs['title'] }
  $jeton = ''
  if ($valeurs.ContainsKey('revue')) { $jeton = Get-SzhJetonRevue $valeurs['revue'] }
  $verrou = $false
  if ($valeurs.ContainsKey('locked')) { $verrou = Test-SzhVraiYaml $valeurs['locked'] }
  $archive = $false
  if ($valeurs.ContainsKey('archived')) { $archive = Test-SzhVraiYaml $valeurs['archived'] }
  return [pscustomobject]@{
    dossier     = $Dossier
    titre       = $titre
    jeton       = $jeton
    verrouillee = $verrou
    archivee    = $archive
  }
}

# ---- Manifest (Release GitHub) ----

function Get-SzhManifestUrl([string]$Version) {
  $repo = Get-SzhRepo
  if ($Version) { return "https://github.com/$repo/releases/download/v$Version/manifest.json" }
  return "https://github.com/$repo/releases/latest/download/manifest.json"
}

# Chemin du manifest mis en cache pour une version donnée (staging).
function Get-SzhManifestCache([string]$Version) {
  return (Join-Path $SzhStaging ('manifest-{0}.json' -f $Version))
}

# Le réseau d'abord, le cache de staging ensuite, pour qu'une réinstallation reste
# possible hors ligne. Le cache est écrit par update.ps1 à chaque passage réussi, et n'est
# consulté que pour une version explicite : « latest » n'a de sens qu'en ligne.
function Get-SzhManifest([string]$Version) {
  try {
    # L'asset est servi en octet-stream : Invoke-RestMethod peut rendre une chaîne brute.
    $brut = Invoke-RestMethod -Uri (Get-SzhManifestUrl $Version) -UseBasicParsing -TimeoutSec 30
    if ($brut -is [string]) { return ($brut | ConvertFrom-Json) }
    if ($brut -is [byte[]]) { return ([Text.Encoding]::UTF8.GetString($brut) | ConvertFrom-Json) }
    return $brut
  } catch {
    if ($Version) {
      $cache = Get-SzhManifestCache $Version
      if (Test-Path $cache) {
        Write-SzhLog ('manifest hors ligne : cache de staging utilisé pour ' + $Version)
        return (Get-Content $cache -Raw -Encoding UTF8 | ConvertFrom-Json)
      }
    }
    throw
  }
}

# ---- Journal ----

function Write-SzhLog([string]$Message) {
  New-Item -ItemType Directory -Force -Path $SzhLogs | Out-Null
  $ligne = ('{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
  Add-Content -Path (Join-Path $SzhLogs ('szh-{0}.log' -f (Get-Date -Format 'yyyy-MM'))) -Value $ligne -Encoding UTF8
}

# ---- Téléchargement (barre de progression) ----

function Get-SzhFichier {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Destination,
    [switch]$Silencieux
  )
  $req = [System.Net.HttpWebRequest]::Create($Url)
  $req.UserAgent = 'SZH-Publishing'
  $req.Timeout = 60000
  $req.ReadWriteTimeout = 600000
  $resp = $req.GetResponse()
  try {
    $total = $resp.ContentLength
    $flux  = $resp.GetResponseStream()
    $sortie = [System.IO.File]::Create($Destination)
    try {
      $tampon = New-Object byte[] 262144
      $fait = [long]0
      $dernierPct = -1
      while ($true) {
        $n = $flux.Read($tampon, 0, $tampon.Length)
        if ($n -le 0) { break }
        $sortie.Write($tampon, 0, $n)
        $fait += $n
        if ((-not $Silencieux) -and ($total -gt 0)) {
          $pct = [int](100 * $fait / $total)
          if ($pct -ne $dernierPct) {
            $dernierPct = $pct
            $largeur = 24
            $plein = [int]($largeur * $pct / 100)
            $barre = ('#' * $plein).PadRight($largeur, '.')
            $etatMo = (T 'dl.format' @(($fait / 1MB), ($total / 1MB)))
            Write-Host -NoNewline ("`r    [{0}] {1,3} %  {2}    " -f $barre, $pct, $etatMo)
          }
        }
      }
      if (-not $Silencieux) { Write-Host '' }
    } finally {
      $sortie.Close()
      $flux.Close()
    }
  } finally {
    $resp.Close()
  }
}

function Test-SzhSha256 {
  param([Parameter(Mandatory = $true)][string]$Fichier, [Parameter(Mandatory = $true)][string]$Attendu)
  if (-not (Test-Path $Fichier)) { return $false }
  $h = (Get-FileHash -Path $Fichier -Algorithm SHA256).Hash.ToLower()
  return ($h -eq $Attendu.ToLower())
}

# ---- Écriture d'une clé plate dans ausgabe.yaml ----
# Ligne existante remplacée, sinon ajoutée en fin de fichier : le reste est préservé,
# comme serialiserAusgabe côté cockpit. `$Cite` suit formaterValeurYaml ; `revue` et
# `lang` restent des jetons nus, le sed du Makefile ne comprenant pas les guillemets.
# `$Vide` autorise une valeur vide, pour qu'un appel sans valeur n'efface pas une clé.
function Set-SzhAusgabeCle([string]$Dossier, [string]$Cle, [string]$Valeur, [bool]$Cite, [bool]$Vide) {
  if ((-not $Valeur) -and (-not $Vide)) { return $false }
  $fichier = Join-Path $Dossier 'ausgabe.yaml'
  if (-not (Test-Path $fichier)) { return $false }
  $lignes = @(Get-Content $fichier -Encoding UTF8)
  $ligne = ('{0}: {1}' -f $Cle, $Valeur)
  if ($Cite) { $ligne = ('{0}: "{1}"' -f $Cle, $Valeur) }
  $trouvee = $false
  for ($i = 0; $i -lt $lignes.Count; $i++) {
    if ($lignes[$i] -match ('^' + [regex]::Escape($Cle) + ':')) { $lignes[$i] = $ligne; $trouvee = $true; break }
  }
  if (-not $trouvee) { $lignes += $ligne }
  # Sans BOM et par remplacement atomique : les lecteurs ancrés en début de ligne (sed du
  # Makefile, ^title: de szh-maquette.lua) ne savent pas ignorer un BOM.
  $tmp = Join-Path $Dossier '~$ausgabe.yaml'
  [System.IO.File]::WriteAllLines($tmp, $lignes, (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $fichier -Force
  return $true
}

# `version-toolkit` dit avec quelle version le numéro a été fabriqué, de quoi le
# recomposer plus tard à l'identique. Posée à la création, jamais réécrite ensuite.
function Set-SzhAusgabeVersion([string]$Dossier, [string]$Version) {
  return (Set-SzhAusgabeCle $Dossier 'version-toolkit' $Version $true $false)
}

# ---- Envoi pour traduction ----
# Le sens de la traduction découle du produit : zeitschrift part vers la rédaction
# francophone, revue vers la germanophone. L'e-mail est rédigé dans la langue de qui
# traduira, d'où des gabarits ici plutôt que dans $SzhTextes, qui suit Windows.
$script:SzhMailsTraduction = @{
  zeitschrift = 'redaction@csps.ch'      # allemand -> français
  revue       = 'redaktion@szh.ch'       # français -> allemand
}

# Deux façons de préparer le brouillon, et pas de troisième ; c'est un choix de poste.
#   'mailto' (défaut) : client mail par défaut, corps en texte brut ; le lien szh:// y est
#                       inerte, aucun client ne rendant cliquable un schéma inconnu.
#   'outlook'         : objet COM, corps HTML, vrai hyperlien — mais COM n'existe que pour
#                       l'Outlook classique, le nouvel Outlook n'expose rien.
function Get-SzhModeMailTraduction {
  $cfg = Get-SzhConfig
  if ($cfg -and $cfg.mailTraduction) {
    $m = ([string]$cfg.mailTraduction).ToLower()
    if ($m -eq 'outlook') { return 'outlook' }
  }
  return 'mailto'
}

function Get-SzhLangueTraduction([string]$Produit) {
  if ($Produit -eq 'zeitschrift') { return 'fr' }
  return 'de'
}

# Surchargeable par config.json (« mailsTraduction ») : une adresse de rédaction peut
# changer sans qu'on republie le toolkit.
function Get-SzhMailTraduction([string]$Produit) {
  $cfg = Get-SzhConfig
  if ($cfg -and $cfg.mailsTraduction -and $cfg.mailsTraduction.$Produit) {
    return [string]$cfg.mailsTraduction.$Produit
  }
  if ($SzhMailsTraduction.ContainsKey($Produit)) { return $SzhMailsTraduction[$Produit] }
  return $SzhSupport
}

# Gabarits par langue cible ; {0} = le numéro (et l'article s'il y en a un), {1} = le
# lien. Le corps HTML porte l'hyperlien, le texte brut est le repli sans Outlook.
function Get-SzhGabaritTraduction([string]$Langue) {
  if ($Langue -eq 'fr') {
    return @{
      sujet = 'Traduction allemand vers français — {0}'
      html  = @'
<p>Bonjour,</p>
<p>Le numéro <strong>{0}</strong> de la <em>Schweizerische Zeitschrift für Heilpädagogik</em> est prêt pour la traduction de l&rsquo;<strong>allemand</strong> vers le <strong>français</strong>.</p>
<p><a href="{1}">Ouvrir le suivi de traduction</a></p>
<p style="color:#666666;font-size:90%">Ce lien ouvre directement le bon numéro sur un poste de rédaction SZH. S&rsquo;il ne s&rsquo;ouvre pas : menu Démarrer &rarr; &laquo;&nbsp;Zeitschriften SZH&nbsp;&raquo;, puis choisir le numéro.</p>
'@
      texte = @'
Bonjour,

Le numéro {0} de la Schweizerische Zeitschrift für Heilpädagogik est prêt pour la
traduction de l'allemand vers le français.

Pour l'ouvrir directement au bon endroit : COPIEZ le lien ci-dessous, puis collez-le
dans la fenêtre « Exécuter » de Windows (touche Windows + R) et validez.

{1}

Autre chemin, sans le lien : menu Démarrer -> « Zeitschriften SZH », puis choisir le numéro.
'@
    }
  }
  return @{
    sujet = 'Übersetzung Französisch nach Deutsch — {0}'
    html  = @'
<p>Guten Tag</p>
<p>Die Ausgabe <strong>{0}</strong> der <em>Revue suisse de pédagogie spécialisée</em> ist bereit für die Übersetzung vom <strong>Französischen</strong> ins <strong>Deutsche</strong>.</p>
<p><a href="{1}">Übersetzungsstand öffnen</a></p>
<p style="color:#666666;font-size:90%">Dieser Link öffnet die richtige Ausgabe direkt auf einem SZH-Redaktionscomputer. Falls er sich nicht öffnet: Startmenü &rarr; &laquo;&nbsp;Revues SZH&nbsp;&raquo;, dann die Ausgabe wählen.</p>
'@
    texte = @'
Guten Tag

Die Ausgabe {0} der Revue suisse de pédagogie spécialisée ist bereit für die
Übersetzung vom Französischen ins Deutsche.

So öffnen Sie sie direkt an der richtigen Stelle: KOPIEREN Sie den Link unten, fügen
Sie ihn im Windows-Fenster « Ausführen » ein (Windows-Taste + R) und bestätigen Sie.

{1}

Ohne den Link: Startmenü -> « Revues SZH », dann die Ausgabe wählen.
'@
  }
}

# ---- Liens profonds « szh:// » ----
# Grammaire szh://traduction/<produit>/<numero>[/<article>], à garder alignée avec
# lib/liens.js, qui fabrique les liens. Un lien vient d'un e-mail, donc d'une source non
# fiable : il ne porte aucun chemin, et le dossier est cherché dans les seuls emplacements
# connus du poste.
$script:SzhLienMotif = '^szh://traduction/(revue|zeitschrift)/([A-Za-z0-9][A-Za-z0-9._-]{0,63})(?:/([a-z0-9][a-z0-9-]{0,63}))?/?$'

# Analyse un lien -> { vue, produit, numero, article }, ou $null si la grammaire n'est
# pas respectée. Le protocole Windows peut ajouter un « / » final ou un caractère nul.
function Get-SzhLien([string]$Lien) {
  if (-not $Lien) { return $null }
  $net = ([string]$Lien).Trim().Trim([char]0)
  if ($net -notmatch $SzhLienMotif) { return $null }
  $numero = [string]$Matches[2]
  if ($numero -like '*..*') { return $null }
  $article = ''
  if ($Matches.Count -ge 4) { $article = [string]$Matches[3] }
  return [pscustomobject]@{
    vue     = 'traduction'
    produit = [string]$Matches[1]
    numero  = $numero
    article = $article
  }
}

# « En cours » d'abord, puis les archives, et nulle part ailleurs : le nom vient du lien,
# la racine du poste, et le dossier doit porter un ausgabe.yaml. '' si introuvable.
function Find-SzhRevue([string]$Produit, [string]$Numero) {
  foreach ($etat in @('encours', 'archive')) {
    $racine = Get-SzhEmplacementRevue $Produit $etat
    if (-not $racine) { continue }
    $candidat = Join-Path $racine $Numero
    if (Test-Path (Join-Path $candidat 'ausgabe.yaml')) { return (Resolve-Path $candidat).Path }
  }
  return ''
}

# ---- Intention d'ouverture, à usage unique ----
# Le lanceur ne peut pas dire à VSCodium quel panneau ouvrir : il dépose une intention que
# le cockpit lit, vérifie, consomme et supprime. Chemin, clés et unité à garder alignés
# avec lib/liens.js : `pose` en millisecondes Unix, péremption 5 min. Posée hors du
# dossier de revue, où rien de technique n'entre.
$script:SzhIntentionFile = Join-Path $env:LOCALAPPDATA 'SZH\intention.json'

function Set-SzhIntention([string]$Revue, [string]$Vue, [string]$Article) {
  $dossier = Split-Path $SzhIntentionFile -Parent
  New-Item -ItemType Directory -Force -Path $dossier | Out-Null
  $intention = [ordered]@{
    revue   = $Revue
    vue     = $Vue
    article = $Article
    pose    = [long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
  }
  Set-SzhJson $SzhIntentionFile $intention
}

# ---- Ouverture d'un dossier dans VSCodium ----
# Un seul endroit lance l'éditeur : l'environnement doit être assaini
# (ELECTRON_RUN_AS_NODE ci-dessus ; la garde est répétée, un script pouvant régler ses
# variables après le dot-source) et un échec doit se voir dans le journal.
function Start-SzhCodium([string]$Dossier) {
  $codium = Get-VSCodiumExe
  if (-not $codium) {
    Write-SzhLog ('codium : introuvable, impossible d''ouvrir ' + $Dossier)
    return $false
  }
  if (Test-Path 'Env:ELECTRON_RUN_AS_NODE') { Remove-Item 'Env:ELECTRON_RUN_AS_NODE' -ErrorAction SilentlyContinue }
  try {
    Start-Process -FilePath $codium -ArgumentList ('"{0}"' -f $Dossier)
    return $true
  } catch {
    Write-SzhLog ('codium : lancement impossible (' + $_.Exception.Message + ') pour ' + $Dossier)
    return $false
  }
}

# ---- Raccourci « Ouvrir la revue » ----
# Le raccourci vit dans le dossier de revue et porte son chemin absolu : à réécrire à
# chaque déplacement, sinon il rouvre un chemin disparu. Ne lève pas si VSCodium manque,
# c'est un confort et non la condition du déplacement.
function Set-SzhRaccourciRevue([string]$Dossier) {
  $codium = Get-VSCodiumExe
  if (-not $codium) { return $false }
  $chemin = (Resolve-Path $Dossier).Path
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut((Join-Path $chemin 'Ouvrir la revue.lnk'))
  $lnk.TargetPath = $codium
  $lnk.Arguments = ('"{0}"' -f $chemin)
  $lnk.IconLocation = $codium
  $lnk.Description = 'Ouvrir cette revue dans l''éditeur'
  $lnk.Save()
  return $true
}

# ---- Résolution d'exécutables ----

function Get-WslExe {
  $c = Get-Command wsl.exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in "$env:WINDIR\System32\wsl.exe", "$env:WINDIR\sysnative\wsl.exe") {
    if (Test-Path $p) { return $p }
  }
  throw 'wsl.exe introuvable.'
}

function Get-VSCodiumExe {
  foreach ($p in "$env:ProgramFiles\VSCodium\VSCodium.exe", "$env:LOCALAPPDATA\Programs\VSCodium\VSCodium.exe") {
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Get-VSCodiumCli {
  foreach ($p in "$env:ProgramFiles\VSCodium\bin\codium.cmd", "$env:LOCALAPPDATA\Programs\VSCodium\bin\codium.cmd") {
    if (Test-Path $p) { return $p }
  }
  $c = Get-Command codium -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  return $null
}

# Exécute un natif sans que ErrorActionPreference = 'Stop' ne fasse d'une ligne de stderr
# une erreur fatale : piège de PowerShell 5.1.
function Invoke-SzhNatif([scriptblock]$Bloc) {
  $ancien = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Bloc } finally { $ErrorActionPreference = $ancien }
}

# ---- Petite interface de terminal ----

function Write-SzhTitre([string]$Texte) {
  Write-Host ''
  Write-Host ('  ' + $Texte) -ForegroundColor Cyan
  Write-Host ('  ' + ('─' * $Texte.Length)) -ForegroundColor DarkCyan
}

# Bannière encadrée de l'installation et de la mise à jour.
function Write-SzhBanniere([string]$SousTitre) {
  $titre = (T 'app.titre')
  $larg = [Math]::Max($titre.Length, $SousTitre.Length) + 4
  $h = ('─' * $larg)
  Write-Host ''
  Write-Host ('  ┌' + $h + '┐') -ForegroundColor DarkCyan
  Write-Host '  │  ' -ForegroundColor DarkCyan -NoNewline
  Write-Host $titre.PadRight($larg - 4) -ForegroundColor Cyan -NoNewline
  Write-Host '  │' -ForegroundColor DarkCyan
  Write-Host '  │  ' -ForegroundColor DarkCyan -NoNewline
  Write-Host $SousTitre.PadRight($larg - 4) -ForegroundColor White -NoNewline
  Write-Host '  │' -ForegroundColor DarkCyan
  Write-Host ('  └' + $h + '┘') -ForegroundColor DarkCyan
}

function Write-SzhEtape([string]$Texte) { Write-Host ('  > ' + $Texte) }
function Write-SzhOk([string]$Texte)    { Write-Host ('    ✓ ' + $Texte) -ForegroundColor Green }
function Write-SzhInfo([string]$Texte)  { Write-Host ('    ' + $Texte) -ForegroundColor Gray }

# Écran d'erreur final : message calme, contact, e-mail pré-rempli, accès au journal.
function Show-SzhErreur {
  param([string]$Etape, [string]$Message, [string]$Journal)
  Write-Host ''
  Write-Host ('  ' + (T 'err.titre')) -ForegroundColor Yellow
  Write-Host ('  ' + (T 'err.l.etape' @($Etape)))
  Write-Host ('  ' + (T 'err.l.detail' @($Message)))
  if ($Journal) { Write-Host ('  ' + (T 'err.l.journal' @($Journal))) }
  Write-Host ''
  Write-Host ('  ' + (T 'err.rassure')) -ForegroundColor Green
  Write-Host ('  ' + (T 'err.retry' @($SzhSupport)))
  Write-Host ''
  Write-Host ('  ' + (T 'err.menu'))
  try {
    $touche = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    $car = [string]$touche.Character
  } catch { $car = '' }
  if ($car -eq 'e' -or $car -eq 'E') {
    $sujet = (T 'mail.sujet' @($env:COMPUTERNAME))
    $corps = (T 'mail.corps' @($env:COMPUTERNAME, $Etape, $Message, $Journal))
    if ($corps.Length -gt 1500) { $corps = $corps.Substring(0, 1500) }   # limite de longueur d'un mailto
    $uri = ('mailto:{0}?subject={1}&body={2}' -f $SzhSupport, [Uri]::EscapeDataString($sujet), [Uri]::EscapeDataString($corps))
    Start-Process $uri
    if ($Journal -and (Test-Path $Journal)) { Start-Process explorer.exe ('/select,"' + $Journal + '"') }
  } elseif ($car -eq 'o' -or $car -eq 'O') {
    if ($Journal -and (Test-Path $Journal)) { Start-Process explorer.exe ('/select,"' + $Journal + '"') }
    else { Start-Process explorer.exe $SzhLogs }
  }
}
