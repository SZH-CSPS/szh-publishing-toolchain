# Socle commun des scripts SZH — à dot-sourcer :  . "$PSScriptRoot\szh-common.ps1"
# Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# Proxy d'entreprise : sans ces deux lignes, un proxy qui demande une authentification rend
# 407 à chaque téléchargement, et l'installation d'un poste devient impossible sans qu'un
# message le dise. Les identifiants de la session suffisent (Kerberos ou NTLM), aucune
# saisie n'est demandée ; sans proxy, la valeur est inoffensive.
try {
  $proxySysteme = [Net.WebRequest]::GetSystemWebProxy()
  $proxySysteme.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials
  [Net.WebRequest]::DefaultWebProxy = $proxySysteme
} catch { }

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
    'maj.ext.ratee'     = 'Ces extensions n''ont pas pu être posées : {0}. Le reste de la mise à jour a bien eu lieu. Fermez complètement l''éditeur — toutes ses fenêtres — puis relancez cette mise à jour : il refuse de reposer une extension tant qu''il n''a pas redémarré.'
    'maj.codium.absent' = 'L''éditeur n''est pas installé sur ce poste : ses extensions ont été laissées de côté, tout le reste est à jour. Faites faire l''installation initiale du poste par le service informatique, puis relancez cette mise à jour.'
    'maj.e4'            = '4/5  Réglages de l''éditeur…'
    'maj.e4.ok'         = 'Réglages appliqués, raccourcis du menu Démarrer à jour.'
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
    'err.empreinte'     = 'Le fichier téléchargé « {0} » est arrivé abîmé : sa signature ne correspond pas. Rien n''a été installé — mieux vaut s''arrêter que d''installer un fichier douteux. Relancez la mise à jour : le fichier sera retéléchargé. Si cela se répète, c''est la connexion qui coupe en cours de route.'
    'err.wsl'           = 'L''environnement qui fabrique les PDF n''a pas pu être installé. Fermez l''éditeur et les revues ouvertes, puis relancez la mise à jour : l''installation ne peut pas remplacer cet environnement pendant qu''une compilation s''en sert. Si cela ne suffit pas, redémarrez le poste. Sans lui, aucun PDF ne peut être produit.'
    # Trois causes, trois gestes : « occupé » ci-dessus se ferme en fermant l'éditeur, mais
    # un dossier déjà pris ne se ferme pas et la virtualisation ne s'active pas sans le
    # service informatique. Un seul message pour les trois envoyait le support fermer un
    # éditeur qui n'avait rien à voir — c'est arrivé.
    'err.wsl.dossier'   = 'L''environnement qui fabrique les PDF n''a pas pu être installé : son dossier est déjà pris sur ce poste, sans appartenir à votre compte. Relancez la mise à jour — elle sait écarter ce reste d''une installation précédente. Si le message revient, redémarrez le poste puis relancez-la : un environnement en marche tient encore ses fichiers.'
    'err.wsl.moteur'    = 'L''environnement qui fabrique les PDF s''est installé mais refuse de démarrer. C''est presque toujours la virtualisation, désactivée dans le firmware du poste ou par une stratégie : le service informatique doit l''activer (VT-x / AMD-V, et la plateforme d''hyperviseur Windows). Sans elle, aucun PDF ne peut être produit sur ce poste.'
    'err.espace'        = 'Il ne reste que {0} Go libres sur le disque C:, et il en faut {1} pour installer l''environnement qui fabrique les PDF. Rien n''a été installé. Faites de la place, puis relancez la mise à jour.'
    'maj.env.repare'    = 'Reste d''une installation interrompue écarté.'
    'maj.env.essai'     = 'Vérification de l''environnement…'
    'maj.partiel'       = '⚠ Presque tout est à jour (version {0}). Ce point est resté en panne : {1}'
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
    # Un numéro se décrit par son année et son rang ; le volume et le nom du dossier s'en
    # déduisent. Plus rien à saisir qui ne soit une donnée du numéro.
    'lanceur.nouvelle.annee'    = 'Année :'
    'lanceur.nouvelle.numero'   = 'Numéro :'
    'lanceur.nouvelle.volume'   = 'Volume :'
    'lanceur.nouvelle.volume.manuel' = 'Régler le volume manuellement (déconseillé)'
    'lanceur.nouvelle.volume.auto'   = 'Revenir au volume calculé'
    'lanceur.nouvelle.dossier'  = 'Dossier : {0}'
    'lanceur.nouvelle.ou'       = "Il sera créé dans :`n{0}"
    'lanceur.nouvelle.existe'   = 'Un dossier « {0} » existe déjà à cet emplacement.'
    'lanceur.nouvelle.doublon'  = "Le volume {0}, numéro {1} existe déjà : c'est le numéro « {2} », ici :`n{3}"
    'lanceur.nouvelle.doublon.arch'  = 'Ce numéro-là est archivé — un numéro archivé reste un numéro publié.'
    'lanceur.nouvelle.doublon.suite' = 'Deux numéros ne peuvent pas porter le même volume et le même numéro. Supprimez d''abord celui qui existe, puis recréez celui-ci.'
    'lanceur.nouvelle.erreur'   = "La création de la revue a échoué :`n{0}"
    # Cycle de vie du numéro : listes du lanceur, version du logiciel, mode test.
    'maj.concurrente'           = 'Une mise à jour est déjà en cours dans une autre fenêtre — celle-ci se ferme.'
    'lanceur.versions.chargement' = 'Recherche des versions publiées…'
    'lanceur.versions.horsligne.deja' = "Aucune version n'est installable hors ligne sur ce poste : seule la version déjà installée est proposée."
    'lanceur.erreur'            = "Le lanceur n'a pas pu démarrer :`n`n{0}`n`nContact : {1}"
    'lanceur.titre'             = 'Revues SZH — {racine}'
    'lanceur.titre.zs'          = 'Zeitschriften SZH — {racine}'
    'lanceur.choisir.zs'        = 'Choisissez la Zeitschrift à ouvrir :'
    'lanceur.vide.zs'           = 'Aucune Zeitschrift sur ce poste pour l''instant — « Nouvelle revue… » pour commencer.'
    'lien.invalide'             = "Ce lien n'est pas un lien de revue SZH valide :`n`n{0}"
    'lien.introuvable'          = "Ce lien renvoie au numéro « {0} » ({1}), introuvable sur ce poste.`n`nVérifiez que OneDrive a fini de synchroniser le dossier, puis réessayez. Vous pouvez aussi ouvrir le numéro à la main depuis « Revues SZH »."
    'lanceur.hors'              = '{0} revue(s) hors arborescence dans {1} — à déplacer.'
    'lanceur.encours'           = 'En cours :'
    'lanceur.archives'          = 'Archivées :'
    'lanceur.vide.archives'     = 'Aucune revue archivée.'
    'lanceur.version'           = 'Version : {0}'
    'lanceur.version.inconnue'  = 'Version : inconnue'
    # Où vivent les numéros, dit dans les deux racines et non plus en test seulement : avec
    # le titre de la fenêtre, c'est le seul endroit qui rende la racine active visible, et le
    # chemin complet suffit à la reconnaître (« Revues-TESTING » ou « 2_Produkte »).
    'lanceur.test'              = 'Revue dans : {0}'
    'lanceur.test.zs'           = 'Zeitschrift dans : {0}'
    'racine.test'               = 'dossier de test'
    'racine.prod'               = 'dossier de production'
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
    'arch.err.emplacement'      = 'Le numéro « {0} » ne dit pas de quelle revue il fait partie : on ne sait donc pas dans quel dossier le ranger. Rien n''a été déplacé. Ouvrez ce numéro dans l''éditeur, choisissez la revue dans « Métadonnées du numéro », enregistrez, puis relancez l''archivage.'
    'arch.err.suite'            = 'Rien n''a été déplacé : la revue est restée où elle était. En cas de doute : {0}'
    # Double-clic sur un .md (open-md.ps1) : messages des cas anormaux seulement.
    'openmd.vide'         = "Aucun fichier à ouvrir.`n`nCe raccourci s'utilise en double-cliquant un fichier .md."
    'openmd.introuvable'  = "Ce fichier est introuvable.`n`nIl a peut-être été déplacé ou renommé, ou OneDrive ne l'a pas encore synchronisé."
    'openmd.horsrevue'    = "Ce fichier ne fait pas partie d'une revue : l'aperçu et la régénération ne seront pas actifs.`n`nIl s'ouvre quand même, pour le lire ou le corriger."
    'openmd.reseau'       = "Ce fichier est dans un dossier réseau. Il s'ouvre, mais la fabrication du PDF et l'aperçu ne fonctionnent pas depuis un chemin réseau.`n`nPour travailler dessus, copiez la revue dans OneDrive ou sur le disque de ce poste."
    # Raccourcis du menu Démarrer. Ces deux premiers noms sont ceux des FICHIERS .lnk :
    # les changer renomme les entrées du menu (l'ancienne est retirée, jamais doublée).
    'raccourci.maj.nom'   = 'Mise à jour de l''outil Revue'
    'raccourci.maj.desc'  = 'Installer la dernière version de l''outil Revue SZH. Une fenêtre s''ouvre et montre ce qui se passe.'
    'raccourci.revue.desc' = 'Ouvrir une revue SZH'
    'raccourci.zs.desc'   = 'Ouvrir une Zeitschrift SZH'
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
    'maj.ext.ratee'     = 'Diese Erweiterungen konnten nicht gesetzt werden: {0}. Der Rest der Aktualisierung ist erfolgt. Schliessen Sie den Editor vollständig — alle Fenster — und starten Sie diese Aktualisierung erneut: er setzt eine Erweiterung erst nach einem Neustart wieder.'
    'maj.codium.absent' = 'Der Editor ist auf diesem Rechner nicht installiert: seine Erweiterungen wurden übersprungen, alles andere ist aktuell. Lassen Sie die Ersteinrichtung des Rechners von der Informatik durchführen und starten Sie diese Aktualisierung danach erneut.'
    'maj.e4'            = '4/5  Editor-Einstellungen…'
    'maj.e4.ok'         = 'Einstellungen angewendet, Verknüpfungen im Startmenü aktualisiert.'
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
    'err.empreinte'     = 'Die heruntergeladene Datei « {0} » ist beschädigt angekommen: ihre Signatur stimmt nicht. Es wurde nichts installiert — besser abbrechen als eine zweifelhafte Datei einspielen. Starten Sie die Aktualisierung erneut, die Datei wird neu heruntergeladen. Wiederholt sich das, bricht die Verbindung unterwegs ab.'
    'err.wsl'           = 'Die Umgebung, die die PDF erzeugt, konnte nicht installiert werden. Schliessen Sie den Editor und die offenen Ausgaben und starten Sie die Aktualisierung erneut: die Installation kann diese Umgebung nicht ersetzen, während eine Kompilierung sie benutzt. Hilft das nicht, starten Sie den Rechner neu. Ohne sie lässt sich kein PDF erzeugen.'
    'err.wsl.dossier'   = 'Die Umgebung, die die PDF erzeugt, konnte nicht installiert werden: ihr Ordner ist auf diesem Rechner schon belegt und gehört nicht Ihrem Konto. Starten Sie die Aktualisierung erneut — sie kann diesen Rest einer früheren Installation beiseiteschieben. Kommt die Meldung wieder, starten Sie den Rechner neu und dann die Aktualisierung: eine laufende Umgebung hält ihre Dateien noch fest.'
    'err.wsl.moteur'    = 'Die Umgebung, die die PDF erzeugt, wurde installiert, startet aber nicht. Fast immer ist es die Virtualisierung, die in der Firmware des Rechners oder durch eine Richtlinie abgeschaltet ist: die Informatik muss sie einschalten (VT-x / AMD-V und die Windows-Hypervisor-Plattform). Ohne sie lässt sich auf diesem Rechner kein PDF erzeugen.'
    'err.espace'        = 'Auf Laufwerk C: sind nur noch {0} GB frei, gebraucht werden {1} GB für die Umgebung, die die PDF erzeugt. Es wurde nichts installiert. Schaffen Sie Platz und starten Sie die Aktualisierung erneut.'
    'maj.env.repare'    = 'Rest einer abgebrochenen Installation beiseitegeschoben.'
    'maj.env.essai'     = 'Prüfung der Umgebung…'
    'maj.partiel'       = '⚠ Fast alles ist aktuell (Version {0}). Dieser Punkt bleibt gestört: {1}'
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
    'lanceur.nouvelle.annee'    = 'Jahr:'
    'lanceur.nouvelle.numero'   = 'Nummer:'
    'lanceur.nouvelle.volume'   = 'Band:'
    'lanceur.nouvelle.volume.manuel' = 'Band manuell einstellen (nicht empfohlen)'
    'lanceur.nouvelle.volume.auto'   = 'Zurück zum berechneten Band'
    'lanceur.nouvelle.dossier'  = 'Ordner: {0}'
    'lanceur.nouvelle.ou'       = "Die Ausgabe wird erstellt in:`n{0}"
    'lanceur.nouvelle.existe'   = 'Ein Ordner « {0} » existiert an diesem Ort bereits.'
    'lanceur.nouvelle.doublon'  = "Band {0}, Nummer {1} existiert bereits: es ist die Ausgabe « {2} », hier:`n{3}"
    'lanceur.nouvelle.doublon.arch'  = 'Jene Ausgabe ist archiviert — eine archivierte Ausgabe bleibt eine veröffentlichte Ausgabe.'
    'lanceur.nouvelle.doublon.suite' = 'Zwei Ausgaben können nicht denselben Band und dieselbe Nummer tragen. Löschen Sie zuerst die vorhandene Ausgabe und erstellen Sie diese danach neu.'
    'lanceur.nouvelle.erreur'   = "Die Zeitschrift konnte nicht erstellt werden:`n{0}"
    # Lebenszyklus der Ausgabe
    'maj.concurrente'           = 'In einem anderen Fenster läuft bereits eine Aktualisierung — dieses schliesst sich.'
    'lanceur.versions.chargement' = 'Suche nach veröffentlichten Versionen…'
    'lanceur.versions.horsligne.deja' = "Auf diesem Computer ist keine Version offline installierbar: es wird nur die bereits installierte Version angeboten."
    'lanceur.erreur'            = "Der Starter konnte nicht gestartet werden:`n`n{0}`n`nKontakt: {1}"
    'lanceur.titre'             = 'Revues SZH — {racine}'
    'lanceur.titre.zs'          = 'Zeitschriften SZH — {racine}'
    'lanceur.choisir.zs'        = 'Wählen Sie die zu öffnende Zeitschrift:'
    'lanceur.vide.zs'           = 'Noch keine Zeitschrift auf diesem Computer — mit « Neue Zeitschrift… » beginnen.'
    'lien.invalide'             = "Dieser Link ist kein gültiger SZH-Zeitschriftenlink:`n`n{0}"
    'lien.introuvable'          = "Dieser Link verweist auf die Ausgabe « {0} » ({1}), die auf diesem Computer nicht gefunden wurde.`n`nPrüfen Sie, ob OneDrive den Ordner fertig synchronisiert hat, und versuchen Sie es erneut. Sie können die Ausgabe auch von Hand über « Zeitschriften SZH » öffnen."
    'lanceur.hors'              = '{0} Zeitschrift(en) ausserhalb der Ablage in {1} — zu verschieben.'
    'lanceur.encours'           = 'In Arbeit:'
    'lanceur.archives'          = 'Archiviert:'
    'lanceur.vide.archives'     = 'Keine archivierte Zeitschrift.'
    'lanceur.version'           = 'Version: {0}'
    'lanceur.version.inconnue'  = 'Version: unbekannt'
    'lanceur.test'              = 'Revue in: {0}'
    'lanceur.test.zs'           = 'Zeitschrift in: {0}'
    'racine.test'               = 'Testordner'
    'racine.prod'               = 'Produktionsordner'
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
    'arch.err.emplacement'      = 'Die Ausgabe « {0} » sagt nicht, zu welcher Zeitschrift sie gehört: darum ist nicht bekannt, in welchen Ordner sie kommt. Es wurde nichts verschoben. Öffnen Sie diese Ausgabe im Editor, wählen Sie die Zeitschrift unter « Metadaten der Ausgabe », speichern Sie und starten Sie die Archivierung erneut.'
    'arch.err.suite'            = 'Es wurde nichts verschoben: die Zeitschrift ist an ihrem Platz geblieben. Bei Zweifeln: {0}'
    # Doppelklick auf eine .md-Datei (open-md.ps1): nur die anormalen Fälle.
    'openmd.vide'         = "Keine Datei zum Öffnen.`n`nDieser Befehl wird per Doppelklick auf eine .md-Datei verwendet."
    'openmd.introuvable'  = "Diese Datei wurde nicht gefunden.`n`nSie wurde vielleicht verschoben oder umbenannt, oder OneDrive hat sie noch nicht synchronisiert."
    'openmd.horsrevue'    = "Diese Datei gehört zu keiner Zeitschrift: Vorschau und Neuerzeugung sind nicht aktiv.`n`nSie wird trotzdem geöffnet, zum Lesen oder Korrigieren."
    'openmd.reseau'       = "Diese Datei liegt in einem Netzwerkordner. Sie wird geöffnet, aber die PDF-Erzeugung und die Vorschau funktionieren von einem Netzwerkpfad aus nicht.`n`nKopieren Sie die Zeitschrift zum Arbeiten nach OneDrive oder auf die Festplatte dieses Computers."
    # Verknüpfungen im Startmenü. Die ersten beiden Namen sind DATEINAMEN (.lnk):
    # werden sie geändert, wird der Eintrag umbenannt — der alte wird entfernt, nie doppelt.
    'raccourci.maj.nom'   = 'Aktualisierung des Redaktionstools'
    'raccourci.maj.desc'  = 'Die neueste Version des SZH-Redaktionstools installieren. Ein Fenster öffnet sich und zeigt, was geschieht.'
    'raccourci.revue.desc' = 'Eine SZH-Revue öffnen'
    'raccourci.zs.desc'   = 'Eine SZH-Zeitschrift öffnen'
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
    'maj.ext.ratee'     = 'These extensions could not be installed: {0}. The rest of the update went through. Close the editor completely — every window — then start this update again: it refuses to reinstall an extension until it has restarted.'
    'maj.codium.absent' = 'The editor is not installed on this computer: its extensions were skipped, everything else is up to date. Have IT run the initial setup of this computer, then start this update again.'
    'maj.e4'            = '4/5  Editor settings…'
    'maj.e4.ok'         = 'Settings applied, Start menu shortcuts up to date.'
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
    'err.empreinte'     = 'The downloaded file “{0}” arrived damaged: its signature does not match. Nothing was installed — better to stop than to install a doubtful file. Start the update again and the file will be downloaded afresh. If it keeps happening, the connection is dropping midway.'
    'err.wsl'           = 'The environment that produces the PDFs could not be installed. Close the editor and any open issues, then start the update again: the installer cannot replace that environment while a compilation is using it. If that does not help, restart the computer. Without it, no PDF can be produced.'
    'err.wsl.dossier'   = 'The environment that produces the PDFs could not be installed: its folder is already taken on this computer and does not belong to your account. Start the update again — it knows how to set that leftover from an earlier installation aside. If the message comes back, restart the computer and start the update again: a running environment still holds its files.'
    'err.wsl.moteur'    = 'The environment that produces the PDFs was installed but refuses to start. This is almost always virtualisation, switched off in the computer''s firmware or by a policy: IT must enable it (VT-x / AMD-V, and the Windows Hypervisor Platform). Without it, no PDF can be produced on this computer.'
    'err.espace'        = 'Only {0} GB are free on drive C:, and {1} GB are needed to install the environment that produces the PDFs. Nothing was installed. Free up some space, then start the update again.'
    'maj.env.repare'    = 'Leftover from an interrupted installation set aside.'
    'maj.env.essai'     = 'Checking the environment…'
    'maj.partiel'       = '⚠ Almost everything is up to date (version {0}). This one point is still broken: {1}'
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
    'lanceur.nouvelle.annee'    = 'Year:'
    'lanceur.nouvelle.numero'   = 'Number:'
    'lanceur.nouvelle.volume'   = 'Volume:'
    'lanceur.nouvelle.volume.manuel' = 'Set the volume manually (not recommended)'
    'lanceur.nouvelle.volume.auto'   = 'Back to the calculated volume'
    'lanceur.nouvelle.dossier'  = 'Folder: {0}'
    'lanceur.nouvelle.ou'       = "It will be created in:`n{0}"
    'lanceur.nouvelle.existe'   = 'A folder named {0} already exists at this location.'
    'lanceur.nouvelle.doublon'  = "Volume {0}, number {1} already exists — that is issue {2}, here:`n{3}"
    'lanceur.nouvelle.doublon.arch'  = 'That issue is archived — an archived issue is still a published issue.'
    'lanceur.nouvelle.doublon.suite' = 'Two issues cannot carry the same volume and the same number. Delete the existing one first, then create this one again.'
    'lanceur.nouvelle.erreur'   = "Creating the journal failed:`n{0}"
    # Issue life cycle
    'maj.concurrente'           = 'An update is already running in another window — this one is closing.'
    'lanceur.versions.chargement' = 'Looking for published versions…'
    'lanceur.versions.horsligne.deja' = "No version can be installed offline on this computer: only the version already installed is offered."
    'lanceur.erreur'            = "The launcher could not start:`n`n{0}`n`nContact: {1}"
    'lanceur.titre'             = 'Revues SZH — {racine}'
    'lanceur.titre.zs'          = 'Zeitschriften SZH — {racine}'
    'lanceur.choisir.zs'        = 'Choose the Zeitschrift to open:'
    'lanceur.vide.zs'           = 'No Zeitschrift on this computer yet — use "New journal…" to get started.'
    'lien.invalide'             = "This is not a valid SZH journal link:`n`n{0}"
    'lien.introuvable'          = "This link points to issue {0} ({1}), which was not found on this computer.`n`nCheck that OneDrive has finished syncing the folder, then try again. You can also open the issue by hand from the Revues SZH launcher."
    'lanceur.hors'              = '{0} journal(s) outside the official tree in {1} — to be moved.'
    'lanceur.encours'           = 'In progress:'
    'lanceur.archives'          = 'Archived:'
    'lanceur.vide.archives'     = 'No archived journal.'
    'lanceur.version'           = 'Version: {0}'
    'lanceur.version.inconnue'  = 'Version: unknown'
    'lanceur.test'              = 'Revue in: {0}'
    'lanceur.test.zs'           = 'Zeitschrift in: {0}'
    'racine.test'               = 'test folder'
    'racine.prod'               = 'production folder'
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
    'arch.err.emplacement'      = 'Issue “{0}” does not say which journal it belongs to, so there is no folder to file it in. Nothing has been moved. Open the issue in the editor, pick the journal under “Issue metadata”, save, then run the archiving again.'
    'arch.err.suite'            = 'Nothing was moved: the journal stayed where it was. If in doubt: {0}'
    # Double-click on a .md file (open-md.ps1): abnormal cases only.
    'openmd.vide'         = "No file to open.`n`nThis shortcut is meant to be used by double-clicking a .md file."
    'openmd.introuvable'  = "This file cannot be found.`n`nIt may have been moved or renamed, or OneDrive has not synced it yet."
    'openmd.horsrevue'    = "This file is not part of a journal: the preview and automatic rebuild will not be active.`n`nIt opens anyway, so you can read or fix it."
    'openmd.reseau'       = "This file sits on a network folder. It opens, but PDF building and the preview do not work from a network path.`n`nTo work on it, copy the journal to OneDrive or to this computer's disk."
    # Start menu shortcuts. The first two names are .lnk FILE names: changing them
    # renames the menu entry — the old one is removed, never left as a duplicate.
    'raccourci.maj.nom'   = 'Update the journal tool'
    'raccourci.maj.desc'  = 'Install the latest version of the SZH journal tool. A window opens and shows what is going on.'
    'raccourci.revue.desc' = 'Open an SZH journal'
    'raccourci.zs.desc'   = 'Open an SZH Zeitschrift'
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
#
# Le jeton {racine} est remplacé par l'étiquette de la racine active (Get-SzhEtiquetteRacine) :
# un texte peut ainsi dire où vivent les revues sans que chaque appelant le passe en argument
# — c'est ce qui met l'emplacement actif dans le titre du lanceur. Substitué avant `-f`, un
# chemin ne portant pas d'accolade ; les textes 'racine.*' n'ont pas le jeton, donc pas de
# récursion.
function T {
  param([Parameter(Mandatory = $true)][string]$Cle, [object[]]$Valeurs)
  $texte = $null
  $table = $SzhTextes[$SzhLangue]
  if ($table -and $table.ContainsKey($Cle)) { $texte = $table[$Cle] }
  if (-not $texte) { $texte = $SzhTextes['en'][$Cle] }
  if (-not $texte) { return $Cle }
  if ($texte -like '*{racine}*') { $texte = $texte.Replace('{racine}', (Get-SzhEtiquetteRacine)) }
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

# Écrit les clés données SANS effacer le reste du fichier. state.json porte aussi la langue
# choisie par le dernier lanceur ouvert (Set-SzhLangueProduit), et une réécriture complète
# l'effaçait à chaque mise à jour : sur ces postes, dont Windows est en anglais, le lanceur
# reparlait anglais à une équipe francophone jusqu'au prochain clic sur « Revues SZH ».
# $Retirer : les clés d'une version antérieure qui ne veulent plus rien dire là où elles
# sont. `rootfs` et `vsix` ont déménagé dans l'état par utilisateur, et les laisser ici
# donnerait deux vérités pour une même question — celle qui a fait croire à un compte neuf
# que tout était déjà installé.
function Set-SzhStateCles($Cles, [string[]]$Retirer = @()) {
  $etat = Get-SzhState
  if (-not $etat) { $etat = New-Object psobject }
  foreach ($c in @($Cles.Keys)) {
    if ($etat.PSObject.Properties[$c]) { $etat.$c = $Cles[$c] }
    else { $etat | Add-Member -MemberType NoteProperty -Name $c -Value $Cles[$c] -Force }
  }
  foreach ($c in @($Retirer)) {
    if ($etat.PSObject.Properties[$c]) { $etat.PSObject.Properties.Remove($c) }
  }
  Save-SzhState $etat
  return $etat
}

# ---- Qui exécute, et pour qui ----
#
# Une installation lancée depuis la session du rédacteur mais élevée avec le compte du
# support tourne SOUS le compte du support : HKCU, %APPDATA%, %LOCALAPPDATA% et
# l'enregistrement des distributions WSL sont ceux du support. Tout ce qui est « par
# utilisateur » atterrit alors dans le mauvais profil, et le rédacteur ouvre sa session
# sans raccourcis, sans extensions, sans réglages et sans environnement de fabrication.
# C'est le poste du 26 août 2026, et rien dans les journaux ne le disait : les lignes
# « raccourcis posés » ne nommaient pas le compte. D'où ces deux mesures, et le nom du
# compte dans chaque ligne qui pose quelque chose par utilisateur.
function Get-SzhIdentite {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $admin = $false
  try {
    $admin = ([Security.Principal.WindowsPrincipal]$id).IsInRole(
               [Security.Principal.WindowsBuiltinRole]::Administrator)
  } catch { }
  return [ordered]@{ nom = [string]$id.Name; sid = [string]$id.User.Value; admin = $admin }
}

# Le compte dont la session graphique est ouverte : le propriétaire d'explorer.exe. C'est
# lui le rédacteur, même quand le script tourne sous un autre compte. Vide si personne
# n'est connecté ou si la mesure échoue — un doute ne doit pas arrêter une installation,
# il doit se lire dans le journal. Plusieurs sessions ouvertes : le premier propriétaire
# lisible, ce qui suffit au seul usage qu'on en fait, dire « ce n'est pas moi ».
function Get-SzhSessionUtilisateur {
  try {
    foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" -ErrorAction Stop)) {
      $rep = $null
      try { $rep = Invoke-CimMethod -InputObject $p -MethodName GetOwner -ErrorAction Stop } catch { $rep = $null }
      if ($rep -and $rep.User) {
        if ([string]$rep.Domain) { return (([string]$rep.Domain) + '\' + ([string]$rep.User)) }
        return [string]$rep.User
      }
    }
  } catch { }
  return ''
}

# ---- État par utilisateur ----
#
# state.json vit dans C:\ProgramData\SZH : il est donc commun à tous les comptes du poste.
# Or l'enregistrement de la distribution WSL et les extensions de l'éditeur sont, eux, PAR
# UTILISATEUR. Un état commun affirmait « environnement 2026.08.42 installé, dix extensions
# posées » à un compte qui n'avait ni l'un ni les autres, et la mise à jour les sautait
# comme « déjà à jour » : le rédacteur se retrouvait sans cockpit, sans que rien n'échoue.
# Ce qui est par utilisateur se retient donc chez lui.
$script:SzhBaseUtilisateur = ''
if ([string]$env:LOCALAPPDATA) {
  $script:SzhBaseUtilisateur = Join-Path $env:LOCALAPPDATA 'SZH'
} else {
  # Contexte sans profil (SYSTEM, session détachée) : le SID sépare, faute de %LOCALAPPDATA%.
  $script:SzhBaseUtilisateur = Join-Path $SzhBase ('comptes\' + (Get-SzhIdentite).sid)
}
$script:SzhEtatUtilisateurFile = Join-Path $SzhBaseUtilisateur 'etat-utilisateur.json'

function Get-SzhEtatUtilisateur {
  try {
    if (Test-Path $SzhEtatUtilisateurFile) {
      return (Get-Content $SzhEtatUtilisateurFile -Raw -Encoding UTF8 | ConvertFrom-Json)
    }
  } catch { }
  return $null
}

# Jamais bloquant : un état non écrit fait refaire un travail idempotent au prochain
# passage, alors qu'une exception ici arrêterait une mise à jour par ailleurs réussie.
function Save-SzhEtatUtilisateur($Etat) {
  try {
    New-Item -ItemType Directory -Force -Path $SzhBaseUtilisateur | Out-Null
    Set-SzhJson $SzhEtatUtilisateurFile $Etat
    return $true
  } catch { return $false }
}

function Get-SzhEtatUtilisateurChamp($Etat, [string]$Nom) {
  if (-not $Etat) { return '' }
  try { if ($null -ne $Etat.$Nom) { return [string]$Etat.$Nom } } catch { }
  return ''
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

# ---- Emplacement des revues : test ou production ----
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

# Les deux valeurs de `emplacementRevues` dans config.json. Cette clé remplace `devMode` :
# elle dit son effet — l'endroit où sont les revues — là où « mode développeur » ne parlait
# que du développeur. L'ancienne clé reste lue, des postes la portent déjà.
$script:SzhEmplacementTest = 'test'
$script:SzhEmplacementProd = 'production'

# Booléen d'un JSON écrit à la main : $true/$false, "true"/"false", 1/0. Tout le reste rend
# $null, soit « clé absente ». Sans cette normalisation, `"devMode": "false"` vaut vrai ici
# ([bool]'false' est $true) et faux côté JavaScript : les deux moitiés liraient deux
# racines différentes pour la même configuration.
function Resolve-SzhBooleenConfig($Valeur) {
  if ($null -eq $Valeur) { return $null }
  if ($Valeur -is [bool]) { return $Valeur }
  if ($Valeur -is [int] -or $Valeur -is [long] -or $Valeur -is [double] -or $Valeur -is [decimal]) {
    if ($Valeur -eq 1) { return $true }
    if ($Valeur -eq 0) { return $false }
    return $null
  }
  $t = ([string]$Valeur).Trim().ToLower()
  if ($t -eq 'true') { return $true }
  if ($t -eq 'false') { return $false }
  return $null
}

# Résolution pure : la clé neuve, puis l'ancienne, puis le défaut historique « test ». Rien
# n'est lu du disque ici — c'est Initialize-SzhEmplacementRevues qui interroge le disque, une
# fois, pour écrire la valeur en clair. Mêmes règles et même ordre que
# resoudreEmplacementRevues() de lib/archivage.js ; test/js/emplacements.test.js compare les
# deux sur les mêmes configurations.
function Resolve-SzhEmplacementRevues($Config) {
  if ($Config) {
    $brut = $null
    if ($Config.PSObject.Properties['emplacementRevues']) { $brut = $Config.emplacementRevues }
    $v = ([string]$brut).Trim().ToLower()
    if ($v -eq $SzhEmplacementProd) { return $SzhEmplacementProd }
    if ($v -eq $SzhEmplacementTest) { return $SzhEmplacementTest }
    $ancien = $null
    if ($Config.PSObject.Properties['devMode']) { $ancien = Resolve-SzhBooleenConfig $Config.devMode }
    if ($null -ne $ancien) {
      if ($ancien) { return $SzhEmplacementTest }
      return $SzhEmplacementProd
    }
  }
  return $SzhEmplacementTest
}

# Base d'un emplacement donné. Les sous-clés de `basesRevues` gardent leurs noms d'avant
# (`dev`, `prod`) : des postes les portent déjà.
function Get-SzhBaseRevuesPour([string]$Emplacement) {
  $cle = 'prod'
  if ($Emplacement -eq $SzhEmplacementTest) { $cle = 'dev' }
  $base = $SzhBasesDefaut[$cle]
  $cfg = Get-SzhConfig
  if ($cfg -and $cfg.basesRevues -and $cfg.basesRevues.$cle) { $base = [string]$cfg.basesRevues.$cle }
  return [Environment]::ExpandEnvironmentVariables($base)
}

# Combien de numéros dorment sous un emplacement : un dossier portant un ausgabe.yaml, dans
# les quatre dossiers du produit. Ne lève jamais — un OneDrive non synchronisé rend 0.
function Measure-SzhNumeros([string]$Emplacement) {
  $base = Get-SzhBaseRevuesPour $Emplacement
  $total = 0
  foreach ($produit in @('revue', 'zeitschrift')) {
    foreach ($etat in @('encours', 'archive')) {
      $racine = Join-Path $base $SzhSousDossiers[$produit][$etat]
      if (-not (Test-Path $racine)) { continue }
      try {
        $total += @(Get-ChildItem -Path $racine -Directory -ErrorAction SilentlyContinue |
          Where-Object { Test-Path (Join-Path $_.FullName 'ausgabe.yaml') }).Count
      } catch { }
    }
  }
  return $total
}

# Écrit l'emplacement en clair dans config.json quand il n'y est pas : la racine de tout le
# travail ne doit pas dépendre d'un défaut implicite, qu'une mise à jour pourrait renverser
# sous les pieds du rédacteur.
#
#   * `emplacementRevues` déjà là et valide -> rien ;
#   * `devMode` seul -> recopié sous le nom neuf, décision inchangée ;
#   * ni l'un ni l'autre -> le disque tranche, et jamais contre ce qui existe :
#     « production » seulement si la racine de production porte des numéros et celle de test
#     aucun. Dans tous les autres cas « test », c'est-à-dire ce que le poste voyait déjà.
#     Une racine de test vide n'a rien à perdre ; si OneDrive n'avait rien synchronisé
#     encore, le compte des deux racines part au journal, et une ligne de config.json
#     suffit à revenir (docs/EMPLACEMENTS.md).
#
# N'écrit rien si config.json n'existe pas : bootstrap.ps1 le crée lui-même, et un fichier
# posé ici l'empêcherait d'y mettre `repo` et `basesRevues`. Au plus une fois par processus.
$script:SzhEmplacementFige = $false
function Initialize-SzhEmplacementRevues {
  if ($SzhEmplacementFige) { return '' }
  $script:SzhEmplacementFige = $true
  if (-not (Test-Path $SzhConfigFile)) { return '' }
  $cfg = Get-SzhConfig
  if (-not $cfg) { return '' }
  if ($cfg.PSObject.Properties['emplacementRevues']) {
    $deja = ([string]$cfg.emplacementRevues).Trim().ToLower()
    if ($deja -eq $SzhEmplacementProd -or $deja -eq $SzhEmplacementTest) { return '' }
  }
  $ancien = $null
  if ($cfg.PSObject.Properties['devMode']) { $ancien = Resolve-SzhBooleenConfig $cfg.devMode }
  if ($null -ne $ancien) {
    $choisi = $SzhEmplacementProd
    if ($ancien) { $choisi = $SzhEmplacementTest }
    $motif = 'devMode existant recopie'
  } else {
    $nTest = Measure-SzhNumeros $SzhEmplacementTest
    $nProd = Measure-SzhNumeros $SzhEmplacementProd
    $choisi = $SzhEmplacementTest
    if ($nTest -eq 0 -and $nProd -gt 0) { $choisi = $SzhEmplacementProd }
    $motif = ('numeros trouves : test {0}, production {1}' -f $nTest, $nProd)
  }
  try {
    if ($cfg.PSObject.Properties['emplacementRevues']) { $cfg.emplacementRevues = $choisi }
    else { $cfg | Add-Member -MemberType NoteProperty -Name 'emplacementRevues' -Value $choisi }
    Set-SzhJson $SzhConfigFile $cfg
    Write-SzhLog ('emplacement des revues : "{0}" ecrit dans config.json ({1})' -f $choisi, $motif)
  } catch {
    try { Write-SzhLog ('emplacement des revues : ecriture impossible (' + $_.Exception.Message + ')') } catch { }
  }
  return $choisi
}

# Emplacement actif : passage obligé de tout le monde, et il fige la valeur au premier appel,
# pour que le titre du lanceur et les listes qu'il affiche viennent du même choix.
function Get-SzhEmplacementRevues {
  [void](Initialize-SzhEmplacementRevues)
  return (Resolve-SzhEmplacementRevues (Get-SzhConfig))
}

# Compatibilité : « mode développeur » n'était que le nom d'alors de l'emplacement de test.
function Get-SzhDevMode {
  return ((Get-SzhEmplacementRevues) -eq $SzhEmplacementTest)
}

function Get-SzhBaseRevues {
  return (Get-SzhBaseRevuesPour (Get-SzhEmplacementRevues))
}

# Étiquette courte de la racine active, pour le jeton {racine} des textes : le titre du
# lanceur dit alors où sont les revues, sans qu'on ouvre config.json. Mémorisée par langue —
# T est appelé souvent, et Set-SzhLangueProduit peut changer de langue après un premier
# appel : une mémoire d'une seule case figerait le titre en anglais.
$script:SzhEtiquetteMemo = @{}
function Get-SzhEtiquetteRacine {
  if ($SzhEtiquetteMemo.ContainsKey($SzhLangue)) { return $SzhEtiquetteMemo[$SzhLangue] }
  $emplacement = Get-SzhEmplacementRevues
  $mot = (T 'racine.prod')
  if ($emplacement -eq $SzhEmplacementTest) { $mot = (T 'racine.test') }
  $feuille = ''
  try { $feuille = Split-Path (Get-SzhBaseRevuesPour $emplacement) -Leaf } catch { }
  $etiquette = $mot
  if ($feuille) { $etiquette = ('{0} ({1})' -f $mot, $feuille) }
  $SzhEtiquetteMemo[$SzhLangue] = $etiquette
  return $etiquette
}

# Les quatre emplacements du poste ; les listes à plat sont celles que balaie le lanceur.
# La racine active part au journal une fois par processus : après coup, il dit d'où venaient
# les revues d'un lancement donné.
$script:SzhRacineJournalisee = $false
function Get-SzhEmplacements {
  $emplacement = Get-SzhEmplacementRevues
  $base = Get-SzhBaseRevuesPour $emplacement
  if (-not $SzhRacineJournalisee) {
    $script:SzhRacineJournalisee = $true
    try { Write-SzhLog ('revues : emplacement "{0}" -> {1}' -f $emplacement, $base) } catch { }
  }
  $revue = @{
    encours = (Join-Path $base $SzhSousDossiers.revue.encours)
    archive = (Join-Path $base $SzhSousDossiers.revue.archive)
  }
  $zeitschrift = @{
    encours = (Join-Path $base $SzhSousDossiers.zeitschrift.encours)
    archive = (Join-Path $base $SzhSousDossiers.zeitschrift.archive)
  }
  return [pscustomobject]@{
    emplacement = $emplacement
    devMode     = ($emplacement -eq $SzhEmplacementTest)
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

# ---- Identité d'un numéro : année, numéro, volume ----
# Le volume est le millésime de la revue : un par année civile. Il s'imprime sur la
# couverture (szh-maquette.lua) et part dans OJS en <volume> ; se tromper l'étiquetterait
# faux partout, sans qu'un message le dise. Il n'a donc pas à être saisi : l'année le donne,
# chaque revue ayant sa propre année de départ.
#
# Relevé sur ojs.szh.ch le 24.08.2026, neuf millésimes de suite pour chacune, sans trou :
#   Revue        2018 -> Vol. 8  … 2026 -> Vol. 16    soit annee - 2010
#   Zeitschrift  2018 -> Bd. 24  … 2026 -> Bd. 32     soit annee - 1994
# Un volume par année, sans exception sur ces neuf-là. Ne pas déduire autre chose du compte
# de numéros visible dans l'archive : une année en cours en montre moins que les autres, et
# la numérotation elle-même a changé de forme au fil du temps — ni l'un ni l'autre ne dit
# quoi que ce soit du volume. Une revue pourrait néanmoins sauter un volume ou en doubler
# un : le formulaire garde un réglage manuel, et c'est lui qui tranche le jour où le compte
# se décale.
$script:SzhVolumeAnneeZero = @{
  revue       = 2010
  zeitschrift = 1994
}

# Volume calculé, ou 0 si le produit est inconnu ou l'année antérieure au premier volume.
function Get-SzhVolumePour([string]$Produit, [int]$Annee) {
  $jeton = Get-SzhJetonRevue $Produit
  if (-not $jeton) { return 0 }
  if (-not $SzhVolumeAnneeZero.ContainsKey($jeton)) { return 0 }
  $volume = $Annee - $SzhVolumeAnneeZero[$jeton]
  if ($volume -lt 1) { return 0 }
  return $volume
}

# Première année dont le volume existe : la borne basse du formulaire, pour qu'il ne propose
# jamais un volume nul ou négatif.
function Get-SzhPremiereAnnee([string]$Produit) {
  $jeton = Get-SzhJetonRevue $Produit
  if ($jeton -and $SzhVolumeAnneeZero.ContainsKey($jeton)) { return ($SzhVolumeAnneeZero[$jeton] + 1) }
  return 1
}

# Nom de dossier d'un numéro : la convention « AAAA-NN », numéro sur deux chiffres. Toute la
# chaîne s'y appuie — szh-maquette.lua y prend l'année quand `date:` est vide, lib/yaml.js le
# titre de la barre latérale — et c'est pourquoi ce nom se déduit et ne se saisit pas.
function Get-SzhNomNumero([int]$Annee, [int]$Numero) {
  return ('{0:0000}-{1:00}' -f $Annee, $Numero)
}

# Entier d'une valeur d'ausgabe.yaml, 0 si elle n'en est pas une : « 01 » et « 1 » sont le
# même numéro, et un champ vide ne doit ressembler à aucun.
function Get-SzhEntierYaml($Valeur) {
  $texte = ([string]$Valeur).Trim()
  if ($texte -notmatch '^[0-9]{1,6}$') { return 0 }
  return [int]$texte
}

# Un numéro se reconnaît à son couple volume + numéro, jamais à son nom de dossier : deux
# dossiers différents peuvent porter le même couple, et c'est précisément ce qu'il faut
# refuser. On cherche donc dans les DEUX emplacements du produit, en cours et archives — un
# numéro archivé reste un numéro publié, et son volume est pris.
#
# Rend $null, ou le premier numéro trouvé : { nom, chemin, dossier, archive }.
function Find-SzhNumeroVolume([string]$Produit, [int]$Volume, [int]$Numero) {
  if ($Volume -lt 1) { return $null }
  if ($Numero -lt 1) { return $null }
  $jeton = Get-SzhJetonRevue $Produit
  if (-not $jeton) { return $null }
  foreach ($etat in @('encours', 'archive')) {
    $racine = Get-SzhEmplacementRevue $jeton $etat
    if (-not $racine) { continue }
    if (-not (Test-Path $racine)) { continue }
    $dossiers = @()
    try { $dossiers = @(Get-ChildItem -Path $racine -Directory -ErrorAction SilentlyContinue) } catch { }
    foreach ($d in $dossiers) {
      $fichier = Join-Path $d.FullName 'ausgabe.yaml'
      if (-not (Test-Path $fichier)) { continue }
      $valeurs = Get-SzhAusgabe $fichier
      # Le produit vient du jeton du numéro, pas de son emplacement : un dossier rangé du
      # mauvais côté ne doit pas bloquer la création d'un numéro de l'autre revue.
      $sien = ''
      if ($valeurs.ContainsKey('revue')) { $sien = Get-SzhJetonRevue $valeurs['revue'] }
      if ($sien -ne $jeton) { continue }
      if ((Get-SzhEntierYaml $valeurs['volume']) -ne $Volume) { continue }
      if ((Get-SzhEntierYaml $valeurs['numero']) -ne $Numero) { continue }
      return [pscustomobject]@{
        nom     = $d.Name
        chemin  = $d.FullName
        dossier = $racine
        archive = ($etat -eq 'archive')
      }
    }
  }
  return $null
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
    [switch]$Silencieux,
    [int]$Essais = 3
  )
  # Trois tentatives, et un fichier temporaire tant que le téléchargement n'est pas
  # complet. Deux pannes réelles derrière ces deux mesures : 574 Mo sur un wifi d'hôtel
  # coupent une fois sur trois, et une coupure ne lève pas — le flux rend simplement 0,
  # donc le fichier tronqué portait le bon nom et n'était rejeté qu'à l'empreinte, une
  # minute plus tard, en faisant échouer toute la mise à jour au lieu de réessayer.
  $partiel = $Destination + '.part'
  $derniere = $null
  for ($essai = 1; $essai -le [Math]::Max(1, $Essais); $essai++) {
    try {
      Get-SzhFichierUneFois -Url $Url -Destination $partiel -Silencieux:$Silencieux
      Move-Item -LiteralPath $partiel -Destination $Destination -Force
      return
    } catch {
      $derniere = $_
      try { if (Test-Path $partiel) { Remove-Item -LiteralPath $partiel -Force } } catch { }
      if ($essai -lt $Essais) {
        Write-SzhLog ('téléchargement : essai {0} échoué ({1}) -> nouvel essai' -f $essai, $_.Exception.Message)
        Start-Sleep -Seconds (2 * $essai)
      }
    }
  }
  throw $derniere
}

function Get-SzhFichierUneFois {
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
  # Une coupure de connexion ne lève pas : le flux rend 0 comme à la fin normale. Sans
  # cette comparaison, un fichier tronqué passe pour complet.
  if (($total -gt 0) -and ($fait -lt $total)) {
    throw ('téléchargement incomplet : {0} octets sur {1}' -f $fait, $total)
  }
}

# ---- Place libre ----
# L'environnement de fabrication demande l'archive (0,6 Go) puis le disque virtuel qu'elle
# déplie (≈ 2,4 Go). Un disque plein laissait un import à moitié fait : dossier pris,
# distribution absente — exactement l'état qui bloque toutes les mises à jour suivantes.
# Mesure impossible : on rend -1, et l'appelant n'empêche rien sur un doute.
function Get-SzhEspaceLibreGo {
  param([string]$Chemin = '')
  if (-not $Chemin) { $Chemin = $SzhBase }
  try {
    $d = New-Object System.IO.DriveInfo([System.IO.Path]::GetPathRoot($Chemin))
    return [Math]::Round($d.AvailableFreeSpace / 1GB, 1)
  } catch { return -1 }
}

# ---- Une seule mise à jour à la fois sur le POSTE ----
# « Local\ » borne le mutex à la session : deux comptes connectés en même temps détendaient
# donc deux Expand-Archive sur le même C:\ProgramData\SZH\toolkit, qui finit à moitié
# écrit. « Global\ » le rend visible à tout le poste, et son ACL doit nommer les
# Utilisateurs : sans elle, le deuxième compte se voit refuser l'ouverture et croit qu'une
# mise à jour est en cours alors qu'il n'y en a aucune.
function New-SzhMutexPoste {
  param([string]$Nom = 'SZH-Publishing-Update')
  try {
    $droits = New-Object System.Security.AccessControl.MutexSecurity
    $droits.AddAccessRule((New-Object System.Security.AccessControl.MutexAccessRule(
      (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545')),
      [System.Security.AccessControl.MutexRights]::FullControl,
      [System.Security.AccessControl.AccessControlType]::Allow)))
    $cree = $false
    return (New-Object System.Threading.Mutex($false, ('Global\' + $Nom), [ref]$cree, $droits))
  } catch {
    # Poste où « Global\ » est refusé (SeCreateGlobalPrivilege retiré par stratégie) : un
    # verrou de session vaut mieux que pas de verrou.
    return (New-Object System.Threading.Mutex($false, ('Local\' + $Nom)))
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

# ---- Raccourcis du menu Démarrer ----
# Quatre entrées, au niveau utilisateur : les deux lanceurs de produit et les deux entrées
# de mise à jour. Posées par update.ps1 (mise à jour), par update-launcher.ps1 (à chaque
# ouverture de session) et par bootstrap.ps1 (poste neuf), pour qu'un poste déjà à jour
# comme un poste sortant de sa boîte finisse par les avoir sans que personne n'intervienne,
# et chacun dans le profil du rédacteur qui ouvre la session.
#
# Pourquoi DEUX entrées de mise à jour, une française et une allemande, plutôt qu'une seule
# renommée selon la langue du poste ? Parce qu'un nom de fichier .lnk est figé alors que la
# langue de l'interface bouge (variable d'environnement, préférence retenue dans state.json,
# langue de Windows). Renommer à chaque mise à jour aurait trois défauts : sur un poste neuf
# la langue résolue est l'anglais — les Windows d'ici sont en anglais et state.json est
# encore muet —, c'est-à-dire la seule langue qu'aucune des deux équipes n'emploie ; le nom
# changerait sous les doigts du rédacteur dès qu'un collègue ouvre l'autre lanceur, alors
# qu'on ne retrouve une entrée du menu Démarrer qu'en tapant son nom ; et un renommage
# revient à supprimer puis recréer, ce qui casse l'épinglage. Deux noms fixes, chacun
# portant sa langue à update.ps1 : c'est déjà ce que font « Revues SZH » et
# « Zeitschriften SZH », qui cohabitent sur tous les postes. Ajouter 'en' ici y ajouterait
# une troisième entrée.
$script:SzhLanguesRaccourci = @('fr', 'de')

# Ce que le menu doit porter, une ligne par entrée : le nom du .lnk, sa cible, ses
# arguments, sa description (l'infobulle), son icône, et le script qu'elle pilote.
#
# Les deux lanceurs passent par hidden.vbs, qui lance sans console : une fenêtre noire
# devant un lanceur graphique n'apprendrait rien à personne. La mise à jour, elle, vise
# powershell.exe en direct : elle télécharge, elle prend plusieurs minutes, elle peut
# échouer, et sa fenêtre est la seule chose qui le montre — c'est aussi là que
# Show-SzhErreur propose le journal et l'e-mail au support.
#
# Chaque entrée porte une icône (windows/icone.py) : épinglée à la barre des tâches, elle
# perd son libellé et l'icône devient le seul repère. Sans IconLocation le shell affiche
# celle de wscript.exe, qui ne dit rien à personne ; d'où le repli sur celle de VSCodium.
function Get-SzhRaccourcisMenu {
  param([string]$Toolkit = $SzhToolkit)
  $vbs     = Join-Path $Toolkit 'windows\hidden.vbs'
  $lanceur = Join-Path $Toolkit 'windows\open-revue.ps1'
  $maj     = Join-Path $Toolkit 'windows\update.ps1'
  $wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
  # Windows PowerShell 5.1 explicitement : $PSHOME désignerait pwsh si la mise à jour
  # avait été lancée depuis PowerShell 7, et pwsh n'a pas de powershell.exe à côté.
  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-Path $ps)) { $ps = Join-Path $PSHOME 'powershell.exe' }

  $liste = New-Object System.Collections.ArrayList
  # « Revues SZH » et « Zeitschriften SZH » sont des noms de produit, pas des phrases à
  # traduire : ils ne bougent pas, des épinglages les désignent. Le produit est passé
  # explicitement des deux côtés, pour qu'un raccourci ancien ne montre pas les deux listes
  # mêlées. Chacun s'adresse à son équipe, donc chacun décrit dans sa langue.
  [void]$liste.Add([ordered]@{
    nom    = 'Revues SZH'
    cible  = $wscript
    args   = ('//B "{0}" "{1}" "-Produit" "revue"' -f $vbs, $lanceur)
    desc   = $SzhTextes['fr']['raccourci.revue.desc']
    icone  = (Join-Path $Toolkit 'windows\szh-revue.ico')
    pilote = $lanceur
  })
  [void]$liste.Add([ordered]@{
    nom    = 'Zeitschriften SZH'
    cible  = $wscript
    args   = ('//B "{0}" "{1}" "-Produit" "zeitschrift"' -f $vbs, $lanceur)
    desc   = $SzhTextes['de']['raccourci.zs.desc']
    icone  = (Join-Path $Toolkit 'windows\szh-zeitschrift.ico')
    pilote = $lanceur
  })
  foreach ($langue in $SzhLanguesRaccourci) {
    [void]$liste.Add([ordered]@{
      nom    = $SzhTextes[$langue]['raccourci.maj.nom']
      cible  = $ps
      args   = ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -Langue {1}' -f $maj, $langue)
      desc   = $SzhTextes[$langue]['raccourci.maj.desc']
      icone  = (Join-Path $Toolkit 'windows\szh-maj.ico')
      pilote = $maj
    })
  }
  return $liste
}

# Pose les entrées ci-dessus et retire celles d'une version antérieure. Ne lève jamais :
# un menu Démarrer verrouillé par une stratégie de groupe ne doit pas faire échouer une
# mise à jour par ailleurs réussie. Rend un bilan — poses, retires, manques — que
# l'appelant écrit au journal, car un raccourci absent qui ne se dit pas est introuvable.
# $Menu est paramétrable pour éprouver la fonction hors du vrai menu Démarrer.
function Set-SzhRaccourcisMenu {
  param(
    [string]$Menu    = '',
    [string]$Toolkit = $SzhToolkit
  )
  if (-not $Menu) { $Menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs' }
  $bilan = [ordered]@{
    poses   = New-Object System.Collections.ArrayList
    retires = New-Object System.Collections.ArrayList
    manques = New-Object System.Collections.ArrayList
  }
  $voulus = @(Get-SzhRaccourcisMenu -Toolkit $Toolkit)
  $canoniques = @{}
  foreach ($r in $voulus) { $canoniques[($r.nom + '.lnk').ToLower()] = $true }

  $shell = $null
  try {
    New-Item -ItemType Directory -Force -Path $Menu | Out-Null
    $shell = New-Object -ComObject WScript.Shell
  } catch {
    # Dossier non inscriptible, ou COM indisponible : rien ne sera posé, et c'est tout ce
    # qu'on peut en dire. On le dit une fois, pas quatre.
    [void]$bilan.manques.Add(('menu Démarrer inaccessible ({0}) : {1}' -f $Menu, $_.Exception.Message))
    return $bilan
  }

  $codium = Get-VSCodiumExe
  foreach ($r in $voulus) {
    try {
      # Pas de raccourci mort : un .lnk vers un script absent ne ferait que clignoter. Un
      # raccourci déjà en place est alors laissé tel quel plutôt que remplacé par du vide.
      if (-not (Test-Path $r.pilote)) {
        [void]$bilan.manques.Add(('{0} : non posé, {1} manque au toolkit — celui-ci est incomplet, la tâche planifiée le réinstalle à la prochaine ouverture de session.' -f $r.nom, (Split-Path $r.pilote -Leaf)))
        continue
      }
      $lnk = $shell.CreateShortcut((Join-Path $Menu ($r.nom + '.lnk')))
      $lnk.TargetPath  = $r.cible
      $lnk.Arguments   = $r.args
      $lnk.Description = $r.desc
      $lnk.WindowStyle = 1        # fenêtre normale : la mise à jour doit se voir
      if (Test-Path $r.icone) { $lnk.IconLocation = ('{0},0' -f $r.icone) }
      elseif ($codium) { $lnk.IconLocation = $codium }
      $lnk.Save()
      [void]$bilan.poses.Add($r.nom)
    } catch {
      [void]$bilan.manques.Add(('{0} : {1}' -f $r.nom, $_.Exception.Message))
    }
  }

  # Une seule ligne suffit à dire qu'un dossier entier se refuse, et elle doit dire la
  # suite : rien ne s'arrête pour autant, et la mise à jour garde deux autres portes.
  if (($bilan.poses.Count -eq 0) -and ($bilan.manques.Count -gt 0)) {
    [void]$bilan.manques.Add(('aucune entrée n''a pu être écrite dans « {0} » : ce dossier refuse l''écriture, le plus souvent parce qu''une stratégie de groupe tient le menu Démarrer. Rien d''autre n''est affecté, et la mise à jour reste atteignable par le bouton « Changer de version… » du lanceur et par la tâche planifiée qui la déclenche.' -f $Menu))
  }

  # Un raccourci d'une version antérieure, mal nommé, doublerait l'entrée sans jamais
  # disparaître : on retire donc tout .lnk qui pilote un de nos scripts sans porter l'un
  # des noms voulus. Un raccourci bien nommé mais pointant ailleurs a déjà été corrigé
  # ci-dessus, CreateShortcut réécrivant le fichier existant. Le premier niveau du menu
  # seulement : le sous-dossier « SZH » appartient à un autre produit, et rien ici ne doit
  # y toucher.
  $nos = @('open-revue.ps1', 'update.ps1')
  try {
    foreach ($f in @(Get-ChildItem -LiteralPath $Menu -Filter '*.lnk' -File -ErrorAction Stop)) {
      if ($canoniques.ContainsKey($f.Name.ToLower())) { continue }
      $vise = $false
      try {
        $vieux = $shell.CreateShortcut($f.FullName)
        $ligne = (([string]$vieux.TargetPath) + ' ' + ([string]$vieux.Arguments)).ToLower()
        foreach ($n in $nos) { if ($ligne -like ('*' + $n + '*')) { $vise = $true } }
      } catch { $vise = $false }
      if ($vise) {
        Remove-Item -LiteralPath $f.FullName -Force
        [void]$bilan.retires.Add($f.Name)
      }
    }
  } catch {
    [void]$bilan.manques.Add(('nettoyage des anciens raccourcis : ' + $_.Exception.Message))
  }
  return $bilan
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

# Les extensions posées, telles que l'éditeur les liste POUR CE COMPTE. La source de vérité
# est l'éditeur, pas state.json : celui-ci est commun au poste alors qu'une extension
# s'installe par utilisateur, et il affirmait « posée » à un compte qui n'avait rien.
# Table id -> version, et $null — pas une table vide — quand le CLI ne répond pas : un
# profil neuf n'a AUCUNE extension, et confondre les deux ferait sauter l'installation
# exactement là où elle est nécessaire. Les tables PowerShell ignorent la casse, ce qu'il
# faut ici : l'éditeur écrit « MS-CEINTL.vscode-language-pack-de ».
function Get-SzhExtensionsInstallees {
  param([string]$Cli = '')
  if (-not $Cli) { $Cli = Get-VSCodiumCli }
  if (-not $Cli) { return $null }
  $table = @{}
  try {
    $lignes = Invoke-SzhNatif { & $Cli --list-extensions --show-versions 2>$null }
    if ($LASTEXITCODE -ne 0) { return $null }
    foreach ($l in @($lignes)) {
      $t = ([string]$l).Trim()
      $i = $t.LastIndexOf('@')
      if ($i -gt 0) { $table[$t.Substring(0, $i)] = $t.Substring($i + 1) }
    }
  } catch { return $null }
  return $table
}

# Toutes les extensions du manifest sont-elles posées, dans leur version, pour ce compte ?
# $true quand le CLI ne répond pas ou que l'éditeur manque : on ne déclenche pas une mise à
# jour sur une mesure qu'on n'a pas pu faire.
function Test-SzhExtensionsAJour($Manifest) {
  if (-not $Manifest) { return $true }
  $reelles = Get-SzhExtensionsInstallees
  if ($null -eq $reelles) { return $true }
  foreach ($ext in @($Manifest.vsix)) {
    $id = [string]$ext.id
    if (-not $reelles.ContainsKey($id)) { return $false }
    if ($reelles[$id] -ne [string]$ext.version) { return $false }
  }
  return $true
}

# ---- Le disque de la distribution, par utilisateur ----
#
# L'enregistrement d'une distribution WSL est par utilisateur (HKCU\...\Lxss) alors que ce
# dossier était commun au poste. Le deuxième compte n'avait donc aucune distribution
# enregistrée mais trouvait le dossier déjà pris, et `wsl --import` refusait :
# Wsl/Service/RegisterDistro/ERROR_FILE_EXISTS, sans aucune issue puisque rien ne nettoyait
# jamais ce dossier. Pire : `wsl --unregister` du premier compte efface le disque, donc
# celui du second. Un dossier par SID supprime les deux. Le SID plutôt que le nom de
# compte : deux domaines peuvent porter le même nom, et un compte renommé garde son SID.
function Get-SzhDossierDistro {
  param([string]$Sid = '')
  if (-not $Sid) { $Sid = (Get-SzhIdentite).sid }
  return (Join-Path $SzhBase ('WSL\' + $Sid + '\' + $SzhDistro))
}

# Les distributions enregistrées pour ce compte. `-l -q` ne rend que des noms, sans
# en-tête ni colonne d'état traduite ; les octets nuls viennent de l'UTF-16 de wsl.exe.
function Get-SzhDistrosEnregistrees {
  $noms = New-Object System.Collections.ArrayList
  try {
    $wsl = Get-WslExe
    foreach ($l in @(Invoke-SzhNatif { & $wsl -l -q 2>$null })) {
      $n = (([string]$l) -replace "`0", '').Trim()
      if ($n) { [void]$noms.Add($n) }
    }
  } catch { }
  return $noms
}

# Un dossier de distribution présent alors que la distribution n'est PAS enregistrée pour
# ce compte est un reste : installation interrompue, disque plein, ou un autre compte qui
# l'avait posé là du temps du dossier commun. On l'écarte — l'environnement est jetable, il
# ne contient aucune donnée — et seulement si le dossier porte bien notre nom, jamais un
# chemin venu d'ailleurs. Échoue si une machine WSL en marche tient encore le .vhdx :
# l'appelant en fait alors le message « redémarrez le poste ».
function Clear-SzhDossierDistro {
  param([Parameter(Mandatory = $true)][string]$Dossier)
  if (-not (Test-Path $Dossier)) { return $false }
  if ((Split-Path $Dossier -Leaf) -ne $SzhDistro) {
    throw ('Dossier de distribution inattendu, rien n''a été supprimé : ' + $Dossier)
  }
  Remove-Item -LiteralPath $Dossier -Recurse -Force
  return $true
}

# L'environnement répond-il ? Un import réussi ne prouve pas qu'une distribution démarre :
# sans virtualisation (désactivée dans le firmware ou par une stratégie), l'import passe et
# le premier `--exec` échoue. Sans ce contrôle, la panne n'apparaît qu'à la première
# tentative de PDF du rédacteur, loin de l'installation qui l'a causée.
function Test-SzhDistroRepond {
  try {
    $wsl = Get-WslExe
    Invoke-SzhNatif { & $wsl -d $SzhDistro --exec /bin/true 2>$null | Out-Null }
    return ($LASTEXITCODE -eq 0)
  } catch { return $false }
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
# Ce qui n'a pas abouti sans faire echouer le reste : visible, mais pas rouge.
function Write-SzhAttention([string]$Texte) { Write-Host ('    ! ' + $Texte) -ForegroundColor Yellow }

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
