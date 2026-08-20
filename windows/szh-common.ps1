# Socle commun des scripts SZH — à dot-sourcer :  . "$PSScriptRoot\szh-common.ps1"
# Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# ---------- Environnement hérité : ELECTRON_RUN_AS_NODE (D128) ----------
#
# ⚠ SANS CECI, AUCUN DE NOS SCRIPTS NE PEUT OUVRIR VSCODIUM quand il est lancé par le
# cockpit. L'hôte d'extensions de VSCodium tourne avec ELECTRON_RUN_AS_NODE=1, et tout
# processus qu'il engendre en hérite. Or cette variable dit à Electron « comporte-toi
# comme Node » : `VSCodium.exe "<dossier>"` ne lit alors plus un dossier à ouvrir mais un
# SCRIPT à exécuter, et meurt sur « Error: Cannot find module '<dossier>' », code 1, sans
# fenêtre. Symptôme vu : l'archivage déplaçait la revue mais ne la rouvrait jamais, et un
# lien szh:// « ne faisait rien ».
# On nettoie donc l'environnement à l'entrée de CHAQUE script (le dot-source est le seul
# passage obligé), avant que quoi que ce soit ne lance un exécutable.
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
$script:SzhSupport    = 'robin.morand@szh.ch'          # contact affiché en cas de problème (D17)

# ---------- Langue de l'interface (D25) ----------
# Basée sur la langue d'AFFICHAGE de Windows (Get-UICulture). Le code à deux lettres
# couvre toutes les variantes régionales : fr-CH/fr-FR -> fr, de-CH/de-DE -> de.
# Tout le reste -> anglais (fallback). Forçable pour test/support : $env:SZH_LANGUE.
# Allemand en orthographe SUISSE (ss, pas de ß).
$script:SzhLangue = 'en'
try {
  $langueUi = (Get-UICulture).TwoLetterISOLanguageName.ToLower()
  if ($langueUi -eq 'fr' -or $langueUi -eq 'de') { $script:SzhLangue = $langueUi }
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
    'lanceur.aucune'    = "Aucune revue trouvée.`n`nVérifiez que le dossier OneDrive\Revues est bien synchronisé,`nou demandez la création d'une revue ({0})."
    'lanceur.codium'    = 'L''éditeur VSCodium est introuvable sur ce poste. Contact : {0}'
    'lanceur.vide'      = 'Aucune revue sur ce poste pour l''instant — « Nouvelle revue… » pour commencer.'
    'lanceur.nouvelle'          = 'Nouvelle revue…'
    'lanceur.nouvelle.dossier'  = 'Choisir l''emplacement (dossier parent) de la nouvelle revue — p. ex. OneDrive\Revues.'
    'lanceur.nouvelle.nom'      = 'Nom du dossier de la nouvelle revue (p. ex. 2026-02) :'
    'lanceur.nouvelle.ou'       = "Elle sera créée dans :`n{0}"
    'lanceur.nouvelle.existe'   = 'Un dossier « {0} » existe déjà à cet emplacement.'
    'lanceur.nouvelle.invalide' = 'Le nom contient des caractères interdits ( < > : " / \ | ? * ).'
    'lanceur.nouvelle.erreur'   = "La création de la revue a échoué :`n{0}"
    # Cycle de vie du numéro (D116-D119) : deux listes dans le lanceur, version du
    # logiciel affichée et changeable, mode test signalé.
    'maj.concurrente'           = 'Une mise à jour est déjà en cours dans une autre fenêtre — celle-ci se ferme.'
    'lanceur.versions.chargement' = 'Recherche des versions publiées…'
    'lanceur.versions.horsligne.deja' = "Aucune version n'est installable hors ligne sur ce poste : seule la version déjà installée est proposée."
    'lanceur.erreur'            = "Le lanceur n'a pas pu démarrer :`n`n{0}`n`nContact : {1}"
    'lanceur.titre'             = 'Revues SZH'
    'lanceur.titre.revue'       = 'Revues SZH'
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
    # Archivage / désarchivage d'une revue (archive-revue.ps1, D116)
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
    # Double-clic sur un .md (open-md.ps1, T6.2) : messages des cas ANORMAUX seulement.
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
    'lanceur.aucune'    = "Keine Zeitschrift gefunden.`n`nPrüfen Sie, ob der Ordner OneDrive\Revues synchronisiert ist,`noder lassen Sie eine Zeitschrift anlegen ({0})."
    'lanceur.codium'    = 'Der Editor VSCodium wurde auf diesem Computer nicht gefunden. Kontakt: {0}'
    'lanceur.vide'      = 'Noch keine Zeitschrift auf diesem Computer — mit « Neue Zeitschrift… » beginnen.'
    'lanceur.nouvelle'          = 'Neue Zeitschrift…'
    'lanceur.nouvelle.dossier'  = 'Speicherort (übergeordneten Ordner) der neuen Zeitschrift wählen — z. B. OneDrive\Revues.'
    'lanceur.nouvelle.nom'      = 'Ordnername der neuen Zeitschrift (z. B. 2026-02):'
    'lanceur.nouvelle.ou'       = "Sie wird erstellt in:`n{0}"
    'lanceur.nouvelle.existe'   = 'Ein Ordner « {0} » existiert an diesem Ort bereits.'
    'lanceur.nouvelle.invalide' = 'Der Name enthält unzulässige Zeichen ( < > : " / \ | ? * ).'
    'lanceur.nouvelle.erreur'   = "Die Zeitschrift konnte nicht erstellt werden:`n{0}"
    # Lebenszyklus der Ausgabe (D116-D119)
    'maj.concurrente'           = 'In einem anderen Fenster läuft bereits eine Aktualisierung — dieses schliesst sich.'
    'lanceur.versions.chargement' = 'Suche nach veröffentlichten Versionen…'
    'lanceur.versions.horsligne.deja' = "Auf diesem Computer ist keine Version offline installierbar: es wird nur die bereits installierte Version angeboten."
    'lanceur.erreur'            = "Der Starter konnte nicht gestartet werden:`n`n{0}`n`nKontakt: {1}"
    'lanceur.titre'             = 'Revues SZH'
    'lanceur.titre.revue'       = 'Revues SZH'
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
    # Archivieren / Dearchivieren (archive-revue.ps1, D116)
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
    # Doppelklick auf eine .md-Datei (open-md.ps1, T6.2) : nur die ANORMALEN Fälle.
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
    'lanceur.aucune'    = "No journal found.`n`nCheck that the OneDrive\Revues folder is synced,`nor ask for a journal to be created ({0})."
    'lanceur.codium'    = 'The VSCodium editor was not found on this computer. Contact: {0}'
    'lanceur.vide'      = 'No journal on this computer yet — use “New journal…” to get started.'
    'lanceur.nouvelle'          = 'New journal…'
    'lanceur.nouvelle.dossier'  = 'Choose where to create the new journal (parent folder) — e.g. OneDrive\Revues.'
    'lanceur.nouvelle.nom'      = 'Folder name for the new journal (e.g. 2026-02):'
    'lanceur.nouvelle.ou'       = "It will be created in:`n{0}"
    'lanceur.nouvelle.existe'   = 'A folder named {0} already exists at this location.'
    'lanceur.nouvelle.invalide' = 'The name contains forbidden characters ( < > : " / \ | ? * ).'
    'lanceur.nouvelle.erreur'   = "Creating the journal failed:`n{0}"
    # Issue life cycle (D116-D119)
    'maj.concurrente'           = 'An update is already running in another window — this one is closing.'
    'lanceur.versions.chargement' = 'Looking for published versions…'
    'lanceur.versions.horsligne.deja' = "No version can be installed offline on this computer: only the version already installed is offered."
    'lanceur.erreur'            = "The launcher could not start:`n`n{0}`n`nContact: {1}"
    'lanceur.titre'             = 'Revues SZH'
    'lanceur.titre.revue'       = 'Revues SZH'
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
    # Archiving / unarchiving a journal (archive-revue.ps1, D116)
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
    # Double-click on a .md file (open-md.ps1, T6.2): abnormal cases only.
    'openmd.vide'         = "No file to open.`n`nThis shortcut is meant to be used by double-clicking a .md file."
    'openmd.introuvable'  = "This file cannot be found.`n`nIt may have been moved or renamed, or OneDrive has not synced it yet."
    'openmd.horsrevue'    = "This file is not part of a journal: the preview and automatic rebuild will not be active.`n`nIt opens anyway, so you can read or fix it."
    'openmd.reseau'       = "This file sits on a network folder. It opens, but PDF building and the preview do not work from a network path.`n`nTo work on it, copy the journal to OneDrive or to this computer's disk."
  }
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

# ---------- Config / état ----------

# Écrit du JSON en UTF-8 SANS BOM.
#
# POURQUOI ce détour : `Set-Content -Encoding UTF8` (PowerShell 5.1) écrit un BOM, et
# JSON.parse() de Node le refuse — « Unexpected token  in JSON ». Or config.json et
# l'intention d'ouverture (D123) sont écrits ICI et relus par le COCKPIT (lib/archivage.js,
# lib/liens.js). Le BOM y rendait la lecture silencieusement vide : le mode développeur
# retombait toujours sur son défaut, et un lien szh:// ouvrait la revue sans jamais
# atteindre le panneau. ConvertFrom-Json, lui, tolère les deux — on peut donc écrire sans
# BOM sans rien casser côté PowerShell.
# (state.json reste écrit par Save-SzhState : il n'est lu que par PowerShell.)
function Set-SzhJson([string]$Chemin, $Objet) {
  $json = ($Objet | ConvertTo-Json -Depth 5)
  [System.IO.File]::WriteAllText($Chemin, $json, (New-Object System.Text.UTF8Encoding($false)))
}

# Lectures TOLÉRANTES : un fichier tronqué (mise à jour interrompue) ou en cours
# d'écriture ne doit pas faire échouer un script qui n'a rien à voir — le lanceur en
# particulier, qui n'a pas de console pour dire ce qui s'est passé.
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

# ---------- Version du logiciel installée (D120) ----------
#
# Source primaire : le fichier VERSION du toolkit (écrit par la CI dans toolkit-X.zip).
# Repli : state.json (écrit par update.ps1). Chaîne vide si rien n'est lisible.
#
# ⚠ CETTE FONCTION NE DOIT JAMAIS LEVER. Elle est appelée sur le chemin d'AFFICHAGE du
# lanceur, qui tourne sans console (hidden.vbs) et sans try/catch autrefois : avec
# $ErrorActionPreference = 'Stop', une exception ici ne donnait pas un message laid,
# elle donnait un lanceur qui ne s'ouvre pas du tout, sans trace. Deux pièges réels,
# tous deux pendant une mise à jour :
#   - VERSION vide ou en cours de réécriture par Expand-Archive -> Get-Content -Raw
#     renvoie $null et .Trim() lève InvokeMethodOnNull ;
#   - state.json tronqué -> ConvertFrom-Json lève.
# D'où le try/catch autour de chacune des deux lectures, et le repli sur ''.
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

# Trie des versions de la PLUS RÉCENTE à la plus ancienne, par NUMÉRO.
#
# L'API GitHub, elle, trie par date de publication : « 2026.08.10 » y arrive après
# « 2026.08.7 » (republication, release éditée…). Or c'est dans cette liste qu'on
# cherche « la précédente » — un ordre faux fait installer la mauvaise version. On
# trie donc soi-même : [version] quand les tags s'y prêtent (2026.08.10 > 2026.08.7,
# ce qu'une comparaison de chaînes rate), repli sur l'ordre alphabétique inverse pour
# un tag exotique (jamais d'exception).
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

# Versions publiées (Releases GitHub), les plus récentes d'abord. Tableau VIDE si le
# réseau est absent ou refuse (403 de limite de débit) — l'appelant le dit à l'écran.
# `per_page=100` : il y a déjà des dizaines de releases, et une page manquée ferait
# disparaître les anciennes en silence, c'est-à-dire exactement celles qu'on cherche.
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

# Versions réellement INSTALLABLES HORS LIGNE : il faut à la fois l'archive du toolkit
# ET le manifest de cette version en staging (update.ps1 les conserve tous deux, D10).
# Sans le manifest, update.ps1 s'arrête à sa première action (« lecture de la version
# disponible ») : annoncer une telle version comme disponible serait un mensonge.
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

# Une version est-elle un tag PLAUSIBLE ? Garde-fou de quoting : la valeur peut venir
# d'un nom de fichier de staging (dossier inscriptible sans privilège), et elle part en
# ARGUMENT de update.ps1 — un « 2026.08.0 -Verbose » y injecterait un paramètre.
function Test-SzhVersionTag([string]$Version) {
  if (-not $Version) { return $false }
  return ($Version -match '^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$')
}

# ---------- Mode développeur & emplacements des revues (D119) ----------
#
# UN SEUL endroit décide où vivent les revues — ici. Le cockpit (extension VSCodium)
# ne calcule aucun chemin SharePoint : il délègue l'archivage à archive-revue.ps1, qui
# appelle Get-SzhEmplacements. Les sous-dossiers sont IDENTIQUES en test et en
# production : seule la base change, donc un essai en mode test exerce exactement le
# même code que la production.
$script:SzhSousDossiers = @{
  revue       = @{ encours = '52_Revue\RV02_Redaction';        archive = '52_Revue\RV99_Archives' }
  zeitschrift = @{ encours = '53_Zeitschrift\ZS02_Redaktion';  archive = '53_Zeitschrift\ZS99_Archives' }
}
# Bases par défaut, surchargeables par config.json (clé « basesRevues ») — c'est la
# seule chaîne à corriger si la bibliothèque SharePoint est synchronisée ailleurs.
$script:SzhBasesDefaut = @{
  prod = '%USERPROFILE%\SZH CSPS\Daten_Allgemein - General\2_Produkte'
  dev  = '%USERPROFILE%\OneDrive - SZH CSPS\Revues-TESTING'
}

# Mode développeur : VRAI par défaut (clé absente de config.json) tant que la chaîne
# n'est pas passée en production — mieux vaut un essai qui déplace un dossier de test.
function Get-SzhDevMode {
  $cfg = Get-SzhConfig
  if (-not $cfg) { return $true }
  if ($null -eq $cfg.PSObject.Properties['devMode']) { return $true }
  return ([bool]$cfg.devMode)
}

function Set-SzhDevMode([bool]$Actif) {
  $cfg = Get-SzhConfig
  if (-not $cfg) { $cfg = [pscustomobject]@{ repo = (Get-SzhRepo); revuesRoots = @() } }
  if ($null -eq $cfg.PSObject.Properties['devMode']) {
    $cfg | Add-Member -MemberType NoteProperty -Name 'devMode' -Value $Actif
  } else {
    $cfg.devMode = $Actif
  }
  Set-SzhJson $SzhConfigFile $cfg
}

function Get-SzhBaseRevues {
  $cfg = Get-SzhConfig
  $cle = 'prod'
  if (Get-SzhDevMode) { $cle = 'dev' }
  $base = $SzhBasesDefaut[$cle]
  if ($cfg -and $cfg.basesRevues -and $cfg.basesRevues.$cle) { $base = [string]$cfg.basesRevues.$cle }
  return [Environment]::ExpandEnvironmentVariables($base)
}

# Les quatre emplacements du poste : « en cours » et « archives » pour chacune des deux
# revues. Renvoie aussi les listes à plat, que le lanceur balaie pour ses deux listes.
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

# Mode test : on CRÉE les quatre dossiers s'ils manquent (D119). Sans ça, le mode test
# ne serait utilisable qu'après avoir créé quatre dossiers à la main, et « Nouvelle
# revue… » ne saurait pas où se placer. En production, jamais : cette arborescence est
# celle de SharePoint, elle existe déjà et n'a pas à être inventée par un poste.
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

# Emplacement visé pour une revue : $Jeton = 'revue' | 'zeitschrift',
# $Etat = 'encours' | 'archive'. Chaîne vide si le jeton est inconnu (l'appelant le dit).
function Get-SzhEmplacementRevue([string]$Jeton, [string]$Etat) {
  $emp = Get-SzhEmplacements
  if ($Jeton -eq 'zeitschrift') { return [string]$emp.zeitschrift.$Etat }
  if ($Jeton -eq 'revue') { return [string]$emp.revue.$Etat }
  return ''
}

# ---------- Lecture d'ausgabe.yaml (D116) ----------
#
# YAML PLAT, comme le lit déjà le Makefile (sed) : une clé par ligne. Pas de module
# YAML (aucune dépendance ajoutée sur le poste). Guillemets et commentaire de fin de
# ligne retirés ; première occurrence gagnante, comme analyserAusgabe côté cockpit.
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

# Valeurs « vraies » tolérées — miroir de VRAIS_YAML (lib/yaml.js) et de la table du
# filtre szh-maquette.lua : un ausgabe.yaml peut avoir été écrit à la main.
function Test-SzhVraiYaml($Valeur) {
  if ($null -eq $Valeur) { return $false }
  return (@('true', '1', 'oui', 'ja', 'yes', 'si') -contains ([string]$Valeur).Trim().ToLower())
}

# Jeton canonique de revue : accepte le jeton ET l'ancien nom complet (rétrocompat),
# « zeitschrift » testé avant « revue » — même ordre que normaliserRevue / le Lua.
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
  $version = ''
  if ($valeurs.ContainsKey('version-toolkit')) { $version = $valeurs['version-toolkit'] }
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
    version     = $version
    verrouillee = $verrou
    archivee    = $archive
  }
}

# ---------- Manifest (Release GitHub) ----------

function Get-SzhManifestUrl([string]$Version) {
  $repo = Get-SzhRepo
  if ($Version) { return "https://github.com/$repo/releases/download/v$Version/manifest.json" }
  return "https://github.com/$repo/releases/latest/download/manifest.json"
}

# Chemin du manifest MIS EN CACHE pour une version donnée (staging).
function Get-SzhManifestCache([string]$Version) {
  return (Join-Path $SzhStaging ('manifest-{0}.json' -f $Version))
}

# Manifest d'une version : le réseau d'abord, le cache de staging ensuite.
#
# POURQUOI le cache : réinstaller une ancienne version (D120) doit rester possible sans
# réseau, or c'était faux — update.ps1 commence par télécharger le manifest, donc un
# poste hors ligne échouait à la première étape même quand l'archive du toolkit était
# encore là. Le cache est écrit par update.ps1 à chaque passage réussi.
# Le cache n'est consulté que pour une version EXPLICITE : « latest » n'a de sens qu'en
# ligne, et servir un vieux « latest » de cache serait pire que d'échouer franchement.
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

# ---------- Journal ----------

function Write-SzhLog([string]$Message) {
  New-Item -ItemType Directory -Force -Path $SzhLogs | Out-Null
  $ligne = ('{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
  Add-Content -Path (Join-Path $SzhLogs ('szh-{0}.log' -f (Get-Date -Format 'yyyy-MM'))) -Value $ligne -Encoding UTF8
}

# ---------- Téléchargement (barre de progression sobre) ----------

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

# ---------- Estampille de version dans ausgabe.yaml (D120) ----------
#
# `version-toolkit` dit avec QUELLE version du logiciel le numéro a été fabriqué : c'est
# ce qui permet, des années plus tard, de le recompiler dans les mêmes conditions. Posée
# à la CRÉATION de la revue, elle n'est jamais réécrite ensuite (le cockpit ne la complète
# que si elle manque, au moment d'archiver). Écriture minimale : ligne existante
# remplacée, sinon ajoutée en fin de fichier — tout le reste est préservé, comme le fait
# serialiserAusgabe côté cockpit. Valeur citée, même forme que les autres scalaires.
# Écriture MINIMALE d'une clé plate : ligne existante remplacée, sinon ajoutée en fin de
# fichier — tout le reste est préservé, comme le fait serialiserAusgabe côté cockpit.
# `$Cite` suit la règle de formaterValeurYaml : les scalaires du formulaire sont cités,
# mais `revue` et `lang` sont des jetons NUS (le Makefile les lit au sed, qui ne comprend
# pas les guillemets).
# `$Vide` autorise l'écriture d'une valeur VIDE (`title: ""`). Sans ce garde-fou
# explicite, un appel qui perd sa valeur en route effacerait une clé sans le vouloir ;
# avec lui, vider est un geste demandé.
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
  Set-Content -Path $fichier -Value $lignes -Encoding UTF8
  return $true
}

function Set-SzhAusgabeVersion([string]$Dossier, [string]$Version) {
  return (Set-SzhAusgabeCle $Dossier 'version-toolkit' $Version $true $false)
}

# ---------- Envoi pour traduction (D127) ----------
#
# Le SENS de la traduction découle du produit, et tout le reste en découle :
#   zeitschrift (allemand) -> à traduire vers le FRANÇAIS -> rédaction francophone
#   revue       (français) -> à traduire vers l'ALLEMAND  -> rédaction germanophone
# La langue de l'E-MAIL est celle de la personne qui va traduire — pas celle de
# l'interface de l'expéditeur. C'est pourquoi ces gabarits vivent ici et non dans
# $SzhTextes, qui suit la langue d'affichage de Windows.
$script:SzhMailsTraduction = @{
  zeitschrift = 'redaction@csps.ch'      # allemand -> français
  revue       = 'redaktion@szh.ch'       # français -> allemand
}

# Comment prépare-t-on le brouillon ? (D130)
#   'mailto' (défaut)  : ouvre le client mail PAR DÉFAUT — donc le nouvel Outlook quand
#                        il l'est. Le corps est du TEXTE BRUT : le lien szh:// y arrive
#                        inerte (aucun client ne rend cliquable un schéma qu'il ne
#                        connaît pas), et le corps dit donc de le copier-coller.
#   'outlook'          : objet mail COM -> corps HTML, donc un VRAI hyperlien. Mais COM
#                        n'existe QUE pour l'Outlook classique : le nouvel Outlook
#                        (olk.exe) n'expose aucune automatisation, Microsoft ayant
#                        remplacé les compléments COM par des add-ins web.
# Il n'y a pas de troisième voie : c'est l'un ou l'autre, et c'est un choix de poste.
# Défaut 'mailto' (D132) : le client habituel de la rédaction pèse plus lourd qu'un lien
# cliquable, le copier-coller du lien étant un geste acceptable.
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

# Adresse de destination, surchargeable par config.json (clé « mailsTraduction ») :
# une adresse de rédaction peut changer sans qu'on republie le toolkit.
function Get-SzhMailTraduction([string]$Produit) {
  $cfg = Get-SzhConfig
  if ($cfg -and $cfg.mailsTraduction -and $cfg.mailsTraduction.$Produit) {
    return [string]$cfg.mailsTraduction.$Produit
  }
  if ($SzhMailsTraduction.ContainsKey($Produit)) { return $SzhMailsTraduction[$Produit] }
  return $SzhSupport
}

# Gabarits d'e-mail par langue CIBLE. {0} = le numéro (et l'article s'il y en a un),
# {1} = le lien szh://. Le corps HTML porte le VRAI hyperlien ; le texte brut est le
# repli quand Outlook manque (lien sur sa propre ligne, à copier-coller).
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

# ---------- Liens profonds « szh:// » (D123) ----------
#
# GRAMMAIRE — miroir EXACT de vscodium-extension/szh-cockpit/lib/liens.js, qui les
# FABRIQUE. Deux langages, une seule grammaire : à maintenir ensemble.
#     szh://traduction/<produit>/<numero>[/<article>]
# Un lien arrive d'un e-mail : c'est une donnée NON FIABLE. Elle ne porte donc aucun
# chemin — seulement un produit (choix fermé), un nom de dossier et un slug, aux
# alphabets stricts — et le dossier est cherché UNIQUEMENT dans les emplacements
# connus du poste. Aucun chemin n'est jamais construit sur l'entrée brute.
$script:SzhLienMotif = '^szh://traduction/(revue|zeitschrift)/([A-Za-z0-9][A-Za-z0-9._-]{0,63})(?:/([a-z0-9][a-z0-9-]{0,63}))?/?$'

# Analyse un lien -> { vue, produit, numero, article } ou $null si la grammaire n'est
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

# Retrouve le DOSSIER d'un numéro : « en cours » d'abord, puis les archives, et
# seulement là. Le nom vient du lien, mais la racine vient toujours du poste, et le
# dossier doit vraiment être une revue (ausgabe.yaml). '' si introuvable.
function Find-SzhRevue([string]$Produit, [string]$Numero) {
  foreach ($etat in @('encours', 'archive')) {
    $racine = Get-SzhEmplacementRevue $Produit $etat
    if (-not $racine) { continue }
    $candidat = Join-Path $racine $Numero
    if (Test-Path (Join-Path $candidat 'ausgabe.yaml')) { return (Resolve-Path $candidat).Path }
  }
  return ''
}

# ---------- Intention d'ouverture, à usage unique (D123) ----------
#
# Le lanceur ne peut pas dire à VSCodium « ouvre tel panneau ». Il dépose donc une
# intention que le cockpit lit à l'activation, vérifie (elle doit viser LA revue qui
# s'ouvre), consomme et supprime — cf. consommerIntention() dans lib/liens.js.
# ⚠ Mêmes chemin, clés et unité de temps que lib/liens.js : `pose` est en
# MILLISECONDES depuis l'époque Unix (Date.now() côté JavaScript), péremption 5 min.
# Hors du dossier de revue exprès : rien de technique n'entre dans une revue (D8).
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

# ---------- Ouverture d'un dossier dans VSCodium (D128) ----------
#
# UN SEUL endroit lance l'éditeur. Deux raisons : l'environnement doit être assaini
# (ELECTRON_RUN_AS_NODE, ci-dessus — la garde est répétée ici, un script pouvant régler
# ses variables après le dot-source), et un échec de lancement doit se voir dans le
# journal plutôt que de laisser croire que « rien ne se passe ».
# Retourne $true si l'éditeur a été lancé.
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

# ---------- Raccourci « Ouvrir la revue » (D14) ----------
#
# Le raccourci vit DANS le dossier de revue et porte son chemin ABSOLU en argument :
# il doit donc être réécrit à chaque déplacement du dossier (archivage, D116), sinon il
# rouvre un chemin qui n'existe plus. Une seule implémentation, partagée par
# new-revue.ps1 et archive-revue.ps1. Ne lève pas si VSCodium est introuvable : le
# raccourci est un confort, pas la condition du déplacement.
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

# ---------- Résolution d'exécutables ----------

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

# Exécute un binaire natif avec stderr redirigé SANS que ErrorActionPreference=Stop
# ne transforme les lignes stderr en erreurs fatales (piège connu de PS 5.1).
function Invoke-SzhNatif([scriptblock]$Bloc) {
  $ancien = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Bloc } finally { $ErrorActionPreference = $ancien }
}

# ---------- Petite UI terminal (sobre et rassurante) ----------

function Write-SzhTitre([string]$Texte) {
  Write-Host ''
  Write-Host ('  ' + $Texte) -ForegroundColor Cyan
  Write-Host ('  ' + ('─' * $Texte.Length)) -ForegroundColor DarkCyan
}

# Bannière encadrée pour l'installateur et l'updater (titre traduit, D25).
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
    if ($corps.Length -gt 1500) { $corps = $corps.Substring(0, 1500) }   # limite mailto (V5)
    $uri = ('mailto:{0}?subject={1}&body={2}' -f $SzhSupport, [Uri]::EscapeDataString($sujet), [Uri]::EscapeDataString($corps))
    Start-Process $uri
    if ($Journal -and (Test-Path $Journal)) { Start-Process explorer.exe ('/select,"' + $Journal + '"') }
  } elseif ($car -eq 'o' -or $car -eq 'O') {
    if ($Journal -and (Test-Path $Journal)) { Start-Process explorer.exe ('/select,"' + $Journal + '"') }
    else { Start-Process explorer.exe $SzhLogs }
  }
}
