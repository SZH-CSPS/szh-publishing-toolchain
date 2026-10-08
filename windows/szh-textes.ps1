# Textes de l'interface du lanceur (fr, de, en), lus par la fonction T de szh-common.ps1,
# qui dot-source ce fichier. Compatibilité : Windows PowerShell 5.1.

$script:SzhTextes = @{
  fr = @{
    'app.titre'         = 'SZH/CSPS – Toolchain de publication'
    'maj.soustitre'     = 'Mise à jour de l’’outil Revue'
    'maj.fenetre'       = 'Mise à jour de l’’outil Pronto'
    'maj.intro1'        = 'Vos textes et vos revues ne sont pas touchés par cette opération.'
    'maj.intro2'        = 'Vous pouvez continuer à travailler pendant ce temps.'
    'maj.verif'         = 'Vérification de la version disponible…'
    'maj.cible'         = 'Version cible : {0}'
    'maj.e1'            = '1/5  Maquette et réglages…'
    'maj.e1.ok'         = 'Maquette et réglages à jour.'
    'maj.deja'          = 'Déjà à jour.'
    'maj.e2'            = '2/5  Environnement de fabrication du PDF…'
    'maj.dl.gros'       = 'C’’est le plus gros téléchargement – merci de patienter.'
    'maj.dl.cache'      = 'Archive déjà téléchargée, réutilisée.'
    'maj.install'       = 'Installation (l’’ancien environnement est jetable : aucune donnée dedans)…'
    'maj.env.ok'        = 'Environnement {0} installé.'
    'maj.env.deja'      = 'Déjà à jour ({0}).'
    'maj.e3'            = '3/5  Extensions de l’’éditeur…'
    'maj.ext.ok'        = 'Extensions à jour.'
    'maj.ext.ratee'     = 'Ces extensions n’’ont pas pu être posées : {0}. Le reste de la mise à jour a bien eu lieu. Fermez complètement l’’éditeur – toutes ses fenêtres – puis relancez cette mise à jour : il refuse de reposer une extension tant qu’’il n’’a pas redémarré.'
    'maj.codium.absent' = 'L’’éditeur n’’est pas installé sur ce poste : ses extensions ont été laissées de côté, tout le reste est à jour. Faites faire l’’installation initiale du poste par le service informatique, puis relancez cette mise à jour.'
    'maj.e4'            = '4/5  Réglages de l’’éditeur…'
    'maj.e4.ok'         = 'Réglages appliqués, raccourcis du menu Démarrer à jour.'
    'maj.e5'            = '5/5  Nettoyage…'
    'maj.e5.ok'         = 'Terminé.'
    'maj.fini'          = '✓ Tout est à jour (version {0}). Bonne rédaction !'
    'maj.ferme'         = 'Cette fenêtre se ferme toute seule dans quelques secondes.'
    'etape.prepa'       = 'préparation'
    'etape.manifest'    = 'lecture de la version disponible'
    'etape.toolkit'     = 'mise à jour de la maquette et des réglages'
    'etape.env'         = 'mise à jour de l’’environnement de fabrication'
    'etape.ext'         = 'mise à jour des extensions de l’’éditeur'
    'etape.reglages'    = 'application des réglages de l’’éditeur'
    'etape.nettoyage'   = 'nettoyage'
    'err.empreinte'     = 'Le fichier téléchargé « {0} » est arrivé abîmé : sa signature ne correspond pas. Rien n’’a été installé – mieux vaut s’’arrêter que d’’installer un fichier douteux. Relancez la mise à jour : le fichier sera retéléchargé. Si cela se répète, c’’est la connexion qui coupe en cours de route.'
    'err.wsl'           = 'L’’environnement qui fabrique les PDF n’’a pas pu être installé. Fermez l’’éditeur et les numéros ouverts, puis relancez la mise à jour : l’’installation ne peut pas remplacer cet environnement pendant qu’’une compilation s’’en sert. Si cela ne suffit pas, redémarrez le poste. Sans lui, aucun PDF ne peut être produit.'
    # Un message par cause, car chacune demande une action différente : fermer l'éditeur
    # (« occupé » ci-dessus), relancer ou redémarrer (dossier pris), appeler le service
    # informatique (virtualisation).
    'err.wsl.dossier'   = 'L’’environnement qui fabrique les PDF n’’a pas pu être installé : son dossier est déjà pris sur ce poste, sans appartenir à votre compte. Relancez la mise à jour – elle sait écarter ce reste d’’une installation précédente. Si le message revient, redémarrez le poste puis relancez-la : un environnement en marche tient encore ses fichiers.'
    'err.wsl.moteur'    = 'L’’environnement qui fabrique les PDF s’’est installé mais refuse de démarrer. C’’est presque toujours la virtualisation, désactivée dans le firmware du poste ou par une stratégie : le service informatique doit l’’activer (VT-x / AMD-V, et la plateforme d’’hyperviseur Windows). Sans elle, aucun PDF ne peut être produit sur ce poste.'
    'err.espace'        = 'Il ne reste que {0} Go libres sur le disque C:, et il en faut {1} pour installer l’’environnement qui fabrique les PDF. Rien n’’a été installé. Faites de la place, puis relancez la mise à jour.'
    'err.toolkit'       = 'Le toolkit n’’a pas pu être remplacé : un fichier est encore ouvert. Fermez l’’éditeur, puis relancez la mise à jour.'
    'maj.env.repare'    = 'Reste d’’une installation interrompue écarté.'
    'maj.env.essai'     = 'Vérification de l’’environnement…'
    'maj.partiel'       = '⚠ Presque tout est à jour (version {0}). Ce point est resté en panne : {1}'
    'err.titre'         = 'Une erreur est survenue pendant la mise à jour.'
    'err.l.etape'       = 'Étape   : {0}'
    'err.l.detail'      = 'Détail  : {0}'
    'err.l.journal'     = 'Journal : {0}'
    'err.rassure'       = 'Pas d’’inquiétude : vos textes et vos revues ne sont pas touchés.'
    'err.retry'         = 'La mise à jour réessaiera toute seule. Si le problème persiste : {0}'
    'err.menu'          = '[E] préparer un e-mail au support   [O] ouvrir le journal   [autre touche] fermer'
    # Texte minimal de Get-SzhCourriel (szh-common.ps1) quand le rendu Twig est impossible
    # (VSCodium ou cockpit absent). test/typo-check.py ne lit que les valeurs entre
    # apostrophes sur une ligne : les chaînes entre guillemets doubles lui échappent.
    'courriel.repli.sujet' = 'SZH – problème sur le poste {0}'
    'courriel.repli.corps' = "Bonjour,`n`nLa mise à jour de l'outil Revue a rencontré un problème. Ce message est un repli, envoyé sans le gabarit habituel.`n`nÉtape   : {0}`nDétail  : {1}`nJournal : {2}`n`nMerci de joindre le fichier journal ci-dessus à ce message."
    'dl.format'         = '{0:N1} / {1:N1} Mo'
    'lanceur.annuler'   = 'Annuler'
    # {0} le nom de l'application, {1} celui de la mise à jour, {2} le contact.
    'accueil.cockpit.absent' = "L’extension de {0} manque sur ce poste, ou elle est trop ancienne.`n`nLancez « {1} » depuis le menu Démarrer, puis rouvrez {0}. Contact : {2}"
    'lanceur.codium'    = 'L’’éditeur VSCodium est introuvable sur ce poste. Contact : {0}'
    'maj.concurrente'           = 'Une mise à jour est déjà en cours dans une autre fenêtre – celle-ci se ferme.'
    'lanceur.versions.chargement' = 'Recherche des versions publiées…'
    'lanceur.versions.horsligne.deja' = "Aucune version n'est installable hors ligne sur ce poste : seule la version déjà installée est proposée."
    'lanceur.erreur'            = "Le lanceur n'a pas pu démarrer :`n`n{0}`n`nContact : {1}"
    'lien.invalide'             = "Ce lien n'est pas un lien de revue SZH valide :`n`n{0}"
    'lien.introuvable'          = "Ce lien renvoie au numéro « {0} » ({1}), introuvable sur ce poste.`n`nVérifiez que OneDrive a fini de synchroniser le dossier, puis réessayez. Vous pouvez aussi ouvrir le numéro à la main depuis « Pronto »."
    'lien.introuvable.livre'    = "Ce lien renvoie au livre « {0} », introuvable sur ce poste.`n`nVérifiez que OneDrive a fini de synchroniser le dossier, puis réessayez. Vous pouvez aussi ouvrir le livre à la main depuis le menu Démarrer."
    'lanceur.versions.titre'    = 'Version du logiciel'
    'lanceur.versions.intro'    = 'Version installée : {0}. Choisissez la version à installer :'
    'lanceur.versions.installee' = '{0}    (installée)'
    'lanceur.versions.locale'   = '{0}    (installable hors ligne)'
    'lanceur.versions.installer' = 'Installer'
    'lanceur.versions.horsligne' = "Impossible de lister les versions publiées : pas de connexion, ou trop de demandes vers GitHub depuis ce réseau.`nSeules les versions installables hors ligne sont proposées."
    'lanceur.versions.vide'     = 'Aucune version disponible sur ce poste.'
    'lanceur.versions.note'     = 'Seule la dernière version de chaque état est proposée.'
    'lanceur.versions.avert'    = "Changer de version remplace la maquette, l'environnement de fabrication du PDF et les extensions de l'éditeur.`n`nFermez les fenêtres de rédaction avant de continuer, puis redémarrez l'éditeur à la fin.`n`nInstaller la version {0} ?"
    # Archivage / désarchivage d'une revue (archive-revue.ps1)
    'arch.titre'                = 'Archivage de la revue'
    'arch.titre.des'            = 'Désarchivage de la revue'
    'arch.attente'              = 'Attente de la fermeture de l’’éditeur…'
    'arch.deplacement'          = 'Déplacement vers {0}…'
    'arch.ok'                   = 'Revue déplacée : {0}'
    'arch.rouvre'              = 'Réouverture de la revue…'
    'arch.err.introuvable'      = 'Dossier de revue introuvable : {0}'
    'arch.err.existe'           = 'Un dossier « {0} » existe déjà à destination – rien n’’a été déplacé.'
    'arch.err.verrou'           = "Le dossier est encore utilisé par une autre application après {0} s — rien n'a été déplacé. Fermez l'éditeur et l'aperçu PDF, puis réessayez."
    'arch.err.emplacement'      = 'Le numéro « {0} » ne dit pas de quelle revue il fait partie : on ne sait donc pas dans quel dossier le ranger. Rien n’’a été déplacé. Ouvrez ce numéro dans l’’éditeur, choisissez la revue dans « Métadonnées du numéro », enregistrez, puis relancez l’’archivage.'
    'arch.err.suite'            = 'Rien n’’a été déplacé : la revue est restée où elle était. En cas de doute : {0}'
    # Variantes pour un livre, là où le mot « revue » serait visible.
    'arch.titre.livre'          = 'Archivage du livre'
    'arch.titre.des.livre'      = 'Désarchivage du livre'
    'arch.ok.livre'             = 'Livre déplacé : {0}'
    'arch.rouvre.livre'         = 'Réouverture du livre…'
    'arch.err.suite.livre'      = 'Rien n’’a été déplacé : le livre est resté où il était. En cas de doute : {0}'
    # Raccourci posé à la racine d'un numéro ou d'un livre (szh-produits.ps1, nomRaccourci) : le nom
    # du fichier est le même dans les trois langues, seule la description se traduit.
    'raccourci.nom.revue'       = 'Ouvrir la revue'
    'raccourci.desc.revue'      = 'Ouvrir cette revue dans l’’éditeur'
    'raccourci.nom.livre'       = 'Ouvrir le livre'
    'raccourci.desc.livre'      = 'Ouvrir ce livre dans l’’éditeur'
    # Double-clic sur un .md (open-md.ps1) : messages des cas anormaux seulement.
    'openmd.vide'         = "Aucun fichier à ouvrir.`n`nCe raccourci s'utilise en double-cliquant un fichier .md."
    'openmd.introuvable'  = "Ce fichier est introuvable.`n`nIl a peut-être été déplacé ou renommé, ou OneDrive ne l'a pas encore synchronisé."
    'openmd.horsrevue'    = "Ce fichier ne fait pas partie d'une revue : l'aperçu et la régénération ne seront pas actifs.`n`nIl s'ouvre quand même, pour le lire ou le corriger."
    'openmd.reseau'       = "Ce fichier est dans un dossier réseau. Il s'ouvre, mais la fabrication du PDF et l'aperçu ne fonctionnent pas depuis un chemin réseau.`n`nPour travailler dessus, copiez la revue dans OneDrive ou sur le disque de ce poste."
    # Raccourcis du menu Démarrer. raccourci.maj.nom ne nomme plus de raccourci posé : il sert
    # à reconnaître et retirer l'ancien .lnk (Get-SzhRaccourcisObsoletes, szh-shell.ps1). Sa
    # valeur ne doit pas changer.
    'raccourci.maj.nom'   = 'Mise à jour de l’’outil Revue'
    'raccourci.maj.desc'  = 'Installer la dernière version de l’’outil Pronto. Une fenêtre s’’ouvre et montre ce qui se passe.'
    'raccourci.lanceur.desc' = 'Ouvrir une revue, une Zeitschrift ou un livre SZH'
    # Demande du dossier partagé SharePoint quand il n'a pas été trouvé (szh-ancrage.ps1).
    'ancrage.demande.titre' = 'Dossier partagé SharePoint introuvable'
    'ancrage.demande.texte' = 'L’’outil n’’a pas trouvé automatiquement le dossier partagé SharePoint des revues et des livres. Indiquez un dossier qui s’’y trouve, ou qui contient le dossier « Daten_Allgemein - General ».'
    'ancrage.demande.echec' = 'Ce dossier ne mène pas au dossier partagé recherché : un dossier nommé « Daten_Allgemein - General », sous le dossier indiqué ou au-dessus de lui. Choisissez un autre dossier.'
    'ancrage.abandon'       = 'Le dossier partagé SharePoint n’’a pas pu être rattaché : les revues et les livres resteront introuvables sur ce poste tant qu’’il ne l’’est pas. La demande réapparaîtra à la prochaine ouverture de « Pronto », passé 24 heures. Besoin d’’aide plus tôt : {0}'
  }
  de = @{
    'app.titre'         = 'SZH/CSPS – Publikations-Toolchain'
    'maj.soustitre'     = 'Aktualisierung des Redaktionstools'
    'maj.fenetre'       = 'Aktualisierung – SZH-Redaktionstool'
    'maj.intro1'        = 'Ihre Texte und Zeitschriften werden dabei nicht verändert.'
    'maj.intro2'        = 'Sie können währenddessen weiterarbeiten.'
    'maj.verif'         = 'Prüfe die verfügbare Version…'
    'maj.cible'         = 'Zielversion: {0}'
    'maj.e1'            = '1/5  Layout und Einstellungen…'
    'maj.e1.ok'         = 'Layout und Einstellungen sind aktuell.'
    'maj.deja'          = 'Bereits aktuell.'
    'maj.e2'            = '2/5  PDF-Erzeugungsumgebung…'
    'maj.dl.gros'       = 'Dies ist der grösste Download – bitte etwas Geduld.'
    'maj.dl.cache'      = 'Archiv bereits heruntergeladen, wird wiederverwendet.'
    'maj.install'       = 'Installation (die alte Umgebung ist wegwerfbar: sie enthält keine Daten)…'
    'maj.env.ok'        = 'Umgebung {0} installiert.'
    'maj.env.deja'      = 'Bereits aktuell ({0}).'
    'maj.e3'            = '3/5  Editor-Erweiterungen…'
    'maj.ext.ok'        = 'Erweiterungen sind aktuell.'
    'maj.ext.ratee'     = 'Diese Erweiterungen konnten nicht gesetzt werden: {0}. Der Rest der Aktualisierung ist erfolgt. Schliessen Sie den Editor vollständig – alle Fenster – und starten Sie diese Aktualisierung erneut: er setzt eine Erweiterung erst nach einem Neustart wieder.'
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
    'err.empreinte'     = 'Die heruntergeladene Datei «{0}» ist beschädigt angekommen: ihre Signatur stimmt nicht. Es wurde nichts installiert – besser abbrechen als eine zweifelhafte Datei einspielen. Starten Sie die Aktualisierung erneut, die Datei wird neu heruntergeladen. Wiederholt sich das, bricht die Verbindung unterwegs ab.'
    'err.wsl'           = 'Die Umgebung, die die PDF erzeugt, konnte nicht installiert werden. Schliessen Sie den Editor und die offenen Ausgaben und starten Sie die Aktualisierung erneut: die Installation kann diese Umgebung nicht ersetzen, während eine Kompilierung sie benutzt. Hilft das nicht, starten Sie den Rechner neu. Ohne sie lässt sich kein PDF erzeugen.'
    'err.wsl.dossier'   = 'Die Umgebung, die die PDF erzeugt, konnte nicht installiert werden: ihr Ordner ist auf diesem Rechner schon belegt und gehört nicht Ihrem Konto. Starten Sie die Aktualisierung erneut – sie kann diesen Rest einer früheren Installation beiseiteschieben. Kommt die Meldung wieder, starten Sie den Rechner neu und dann die Aktualisierung: eine laufende Umgebung hält ihre Dateien noch fest.'
    'err.wsl.moteur'    = 'Die Umgebung, die die PDF erzeugt, wurde installiert, startet aber nicht. Fast immer ist es die Virtualisierung, die in der Firmware des Rechners oder durch eine Richtlinie abgeschaltet ist: die Informatik muss sie einschalten (VT-x / AMD-V und die Windows-Hypervisor-Plattform). Ohne sie lässt sich auf diesem Rechner kein PDF erzeugen.'
    'err.espace'        = 'Auf Laufwerk C: sind nur noch {0} GB frei, gebraucht werden {1} GB für die Umgebung, die die PDF erzeugt. Es wurde nichts installiert. Schaffen Sie Platz und starten Sie die Aktualisierung erneut.'
    'err.toolkit'       = 'Das Toolkit konnte nicht ersetzt werden: eine Datei ist noch geöffnet. Schliessen Sie den Editor und starten Sie die Aktualisierung erneut.'
    'maj.env.repare'    = 'Rest einer abgebrochenen Installation beiseitegeschoben.'
    'maj.env.essai'     = 'Prüfung der Umgebung…'
    'maj.partiel'       = '⚠ Fast alles ist aktuell (Version {0}). Dieser Punkt bleibt gestört: {1}'
    'err.titre'         = 'Bei der Aktualisierung ist ein Fehler aufgetreten.'
    'err.l.etape'       = 'Schritt  : {0}'
    'err.l.detail'      = 'Detail   : {0}'
    'err.l.journal'     = 'Protokoll: {0}'
    'err.rassure'       = 'Keine Sorge: Ihre Texte und Zeitschriften sind nicht betroffen.'
    'err.retry'         = 'Die Aktualisierung versucht es später automatisch erneut. Falls das Problem bleibt: {0}'
    'err.menu'          = '[E] E-Mail an den Support vorbereiten   [O] Protokoll öffnen   [andere Taste] schliessen'
    # Texte minimal de Get-SzhCourriel : voir le bloc fr.
    'courriel.repli.sujet' = 'SZH – Problem auf dem Arbeitsplatz {0}'
    'courriel.repli.corps' = "Guten Tag,`n`nBei der Aktualisierung des SZH-Redaktionstools ist ein Problem aufgetreten. Diese Meldung ist ein Ersatztext ohne die übliche Vorlage.`n`nSchritt  : {0}`nDetail   : {1}`nProtokoll: {2}`n`nBitte hängen Sie die oben genannte Protokolldatei an diese Nachricht an."
    'dl.format'         = '{0:N1} / {1:N1} MB'
    'lanceur.annuler'   = 'Abbrechen'
    'accueil.cockpit.absent' = "Die Erweiterung von {0} fehlt auf diesem Computer oder ist zu alt.`n`nStarten Sie «{1}» über das Startmenü und öffnen Sie {0} danach erneut. Kontakt: {2}"
    'lanceur.codium'    = 'Der Editor VSCodium wurde auf diesem Computer nicht gefunden. Kontakt: {0}'
    'maj.concurrente'           = 'In einem anderen Fenster läuft bereits eine Aktualisierung – dieses schliesst sich.'
    'lanceur.versions.chargement' = 'Suche nach veröffentlichten Versionen…'
    'lanceur.versions.horsligne.deja' = "Auf diesem Computer ist keine Version offline installierbar: es wird nur die bereits installierte Version angeboten."
    'lanceur.erreur'            = "Der Starter konnte nicht gestartet werden:`n`n{0}`n`nKontakt: {1}"
    'lien.invalide'             = "Dieser Link ist kein gültiger SZH-Zeitschriftenlink:`n`n{0}"
    'lien.introuvable'          = "Dieser Link verweist auf die Ausgabe « {0} » ({1}), die auf diesem Computer nicht gefunden wurde.`n`nPrüfen Sie, ob OneDrive den Ordner fertig synchronisiert hat, und versuchen Sie es erneut. Sie können die Ausgabe auch von Hand über « Pronto » öffnen."
    'lien.introuvable.livre'    = "Dieser Link verweist auf das Buch « {0} », das auf diesem Computer nicht gefunden wurde.`n`nPrüfen Sie, ob OneDrive den Ordner fertig synchronisiert hat, und versuchen Sie es erneut. Sie können das Buch auch von Hand über das Startmenü öffnen."
    'lanceur.versions.titre'    = 'Software-Version'
    'lanceur.versions.intro'    = 'Installierte Version: {0}. Wählen Sie die zu installierende Version:'
    'lanceur.versions.installee' = '{0}    (installiert)'
    'lanceur.versions.locale'   = '{0}    (offline installierbar)'
    'lanceur.versions.installer' = 'Installieren'
    'lanceur.versions.horsligne' = "Die veröffentlichten Versionen konnten nicht abgerufen werden: keine Verbindung, oder zu viele Anfragen an GitHub aus diesem Netz.`nEs werden nur die offline installierbaren Versionen angeboten."
    'lanceur.versions.vide'     = 'Keine Version auf diesem Computer verfügbar.'
    'lanceur.versions.note'     = 'Angeboten wird nur die neueste Version jedes Stands.'
    'lanceur.versions.avert'    = "Ein Versionswechsel ersetzt das Layout, die PDF-Erzeugungsumgebung und die Editor-Erweiterungen.`n`nSchliessen Sie zuerst die Redaktionsfenster und starten Sie den Editor am Ende neu.`n`nVersion {0} installieren?"
    # Archivage et désarchivage (archive-revue.ps1)
    'arch.titre'                = 'Archivierung der Zeitschrift'
    'arch.titre.des'            = 'Dearchivierung der Zeitschrift'
    'arch.attente'              = 'Warten auf das Schliessen des Editors…'
    'arch.deplacement'          = 'Verschieben nach {0}…'
    'arch.ok'                   = 'Zeitschrift verschoben: {0}'
    'arch.rouvre'              = 'Zeitschrift wird wieder geöffnet…'
    'arch.err.introuvable'      = 'Ordner der Zeitschrift nicht gefunden: {0}'
    'arch.err.existe'           = 'Am Ziel existiert bereits ein Ordner «{0}» – es wurde nichts verschoben.'
    'arch.err.verrou'           = "Der Ordner wird nach {0} s noch von einer anderen Anwendung verwendet — es wurde nichts verschoben. Schliessen Sie den Editor und die PDF-Vorschau und versuchen Sie es erneut."
    'arch.err.emplacement'      = 'Die Ausgabe «{0}» sagt nicht, zu welcher Zeitschrift sie gehört: darum ist nicht bekannt, in welchen Ordner sie kommt. Es wurde nichts verschoben. Öffnen Sie diese Ausgabe im Editor, wählen Sie die Zeitschrift unter «Metadaten der Ausgabe», speichern Sie und starten Sie die Archivierung erneut.'
    'arch.err.suite'            = 'Es wurde nichts verschoben: die Zeitschrift ist an ihrem Platz geblieben. Bei Zweifeln: {0}'
    # Variantes pour un livre, là où le mot « Zeitschrift » serait visible.
    'arch.titre.livre'          = 'Archivierung des Buchs'
    'arch.titre.des.livre'      = 'Dearchivierung des Buchs'
    'arch.ok.livre'             = 'Buch verschoben: {0}'
    'arch.rouvre.livre'         = 'Buch wird wieder geöffnet…'
    'arch.err.suite.livre'      = 'Es wurde nichts verschoben: das Buch ist an seinem Platz geblieben. Bei Zweifeln: {0}'
    # Raccourci posé à la racine d'un numéro ou d'un livre (szh-produits.ps1, nomRaccourci) : le nom
    # du fichier est le même dans les trois langues, seule la description se traduit.
    'raccourci.nom.revue'       = 'Ouvrir la revue'
    'raccourci.desc.revue'      = 'Diese Zeitschrift im Editor öffnen'
    'raccourci.nom.livre'       = 'Ouvrir le livre'
    'raccourci.desc.livre'      = 'Dieses Buch im Editor öffnen'
    # Double-clic sur un .md (open-md.ps1) : messages des cas anormaux seulement.
    'openmd.vide'         = "Keine Datei zum Öffnen.`n`nDieser Befehl wird per Doppelklick auf eine .md-Datei verwendet."
    'openmd.introuvable'  = "Diese Datei wurde nicht gefunden.`n`nSie wurde vielleicht verschoben oder umbenannt, oder OneDrive hat sie noch nicht synchronisiert."
    'openmd.horsrevue'    = "Diese Datei gehört zu keiner Zeitschrift: Vorschau und Neuerzeugung sind nicht aktiv.`n`nSie wird trotzdem geöffnet, zum Lesen oder Korrigieren."
    'openmd.reseau'       = "Diese Datei liegt in einem Netzwerkordner. Sie wird geöffnet, aber die PDF-Erzeugung und die Vorschau funktionieren von einem Netzwerkpfad aus nicht.`n`nKopieren Sie die Zeitschrift zum Arbeiten nach OneDrive oder auf die Festplatte dieses Computers."
    # Raccourcis du menu Démarrer : voir le bloc fr.
    'raccourci.maj.nom'   = 'Aktualisierung des Redaktionstools'
    'raccourci.maj.desc'  = 'Die neueste Version des SZH-Redaktionstools installieren. Ein Fenster öffnet sich und zeigt, was geschieht.'
    'raccourci.lanceur.desc' = 'Eine Revue, eine Zeitschrift oder ein Buch des SZH öffnen'
    # Demande du dossier partagé SharePoint (szh-ancrage.ps1).
    'ancrage.demande.titre' = 'Freigegebener SharePoint-Ordner nicht gefunden'
    'ancrage.demande.texte' = 'Das Werkzeug hat den freigegebenen SharePoint-Ordner der Zeitschriften und Bücher nicht automatisch gefunden. Wählen Sie einen Ordner, der darin liegt, oder der den Ordner «Daten_Allgemein - General» enthält.'
    'ancrage.demande.echec' = 'Dieser Ordner führt nicht zum gesuchten freigegebenen Ordner: ein Ordner namens «Daten_Allgemein - General», unterhalb des gewählten Ordners oder darüber. Wählen Sie einen anderen Ordner.'
    'ancrage.abandon'       = 'Der freigegebene SharePoint-Ordner konnte nicht verknüpft werden: Zeitschriften und Bücher bleiben auf diesem Rechner unauffindbar, bis er es ist. Die Anfrage erscheint beim nächsten Öffnen von «Pronto» wieder, nach 24 Stunden. Für frühere Hilfe: {0}'
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
    'err.wsl.moteur'    = 'The environment that produces the PDFs was installed but refuses to start. This is almost always virtualisation, switched off in the computer’’s firmware or by a policy: IT must enable it (VT-x / AMD-V, and the Windows Hypervisor Platform). Without it, no PDF can be produced on this computer.'
    'err.espace'        = 'Only {0} GB are free on drive C:, and {1} GB are needed to install the environment that produces the PDFs. Nothing was installed. Free up some space, then start the update again.'
    'err.toolkit'       = 'The toolkit could not be replaced: a file is still open. Close the editor, then start the update again.'
    'maj.env.repare'    = 'Leftover from an interrupted installation set aside.'
    'maj.env.essai'     = 'Checking the environment…'
    'maj.partiel'       = '⚠ Almost everything is up to date (version {0}). This one point is still broken: {1}'
    'err.titre'         = 'An error occurred during the update.'
    'err.l.etape'       = 'Step  : {0}'
    'err.l.detail'      = 'Detail: {0}'
    'err.l.journal'     = 'Log   : {0}'
    'err.rassure'       = 'No worries: your texts and journals are not affected.'
    'err.retry'         = 'The update will retry automatically. If the problem persists: {0}'
    'err.menu'          = '[E] prepare a support e-mail   [O] open the log   [any other key] close'
    # Texte minimal de Get-SzhCourriel : voir le bloc fr.
    'courriel.repli.sujet' = 'SZH – problem on workstation {0}'
    'courriel.repli.corps' = "Hello,`n`nThe SZH journal tool update ran into a problem. This is a fallback message, sent without the usual template.`n`nStep  : {0}`nDetail: {1}`nLog   : {2}`n`nPlease attach the log file above to this message."
    'dl.format'         = '{0:N1} / {1:N1} MB'
    'lanceur.annuler'   = 'Cancel'
    'accueil.cockpit.absent' = "The {0} editor extension is missing on this computer, or is too old.`n`nRun {1} from the Start menu, then open {0} again. Contact: {2}"
    'lanceur.codium'    = 'The VSCodium editor was not found on this computer. Contact: {0}'
    'maj.concurrente'           = 'An update is already running in another window — this one is closing.'
    'lanceur.versions.chargement' = 'Looking for published versions…'
    'lanceur.versions.horsligne.deja' = "No version can be installed offline on this computer: only the version already installed is offered."
    'lanceur.erreur'            = "The launcher could not start:`n`n{0}`n`nContact: {1}"
    'lien.invalide'             = "This is not a valid SZH journal link:`n`n{0}"
    'lien.introuvable'          = "This link points to issue {0} ({1}), which was not found on this computer.`n`nCheck that OneDrive has finished syncing the folder, then try again. You can also open the issue by hand from the Pronto launcher."
    'lien.introuvable.livre'    = "This link points to book {0}, which was not found on this computer.`n`nCheck that OneDrive has finished syncing the folder, then try again. You can also open the book by hand from the Start menu."
    'lanceur.versions.titre'    = 'Software version'
    'lanceur.versions.intro'    = 'Installed version: {0}. Choose the version to install:'
    'lanceur.versions.installee' = '{0}    (installed)'
    'lanceur.versions.locale'   = '{0}    (installable offline)'
    'lanceur.versions.installer' = 'Install'
    'lanceur.versions.horsligne' = "Could not list the published versions: no connection, or too many requests to GitHub from this network.`nOnly versions installable offline are offered."
    'lanceur.versions.vide'     = 'No version available on this computer.'
    'lanceur.versions.note'     = 'Only the latest version of each state is offered.'
    'lanceur.versions.avert'    = "Switching version replaces the layout, the PDF build environment and the editor extensions.`n`nClose the writing windows first, then restart the editor when it is done.`n`nInstall version {0}?"
    # Archivage et désarchivage (archive-revue.ps1)
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
    # Variantes pour un livre, là où le mot « journal » serait visible.
    'arch.titre.livre'          = 'Archiving the book'
    'arch.titre.des.livre'      = 'Unarchiving the book'
    'arch.ok.livre'             = 'Book moved: {0}'
    'arch.rouvre.livre'         = 'Reopening the book…'
    'arch.err.suite.livre'      = 'Nothing was moved: the book stayed where it was. If in doubt: {0}'
    # Raccourci posé à la racine d'un numéro ou d'un livre (szh-produits.ps1, nomRaccourci) : le nom
    # du fichier est le même dans les trois langues, seule la description se traduit.
    'raccourci.nom.revue'       = 'Ouvrir la revue'
    'raccourci.desc.revue'      = 'Open this journal in the editor'
    'raccourci.nom.livre'       = 'Ouvrir le livre'
    'raccourci.desc.livre'      = 'Open this book in the editor'
    # Double-clic sur un .md (open-md.ps1) : messages des cas anormaux seulement.
    'openmd.vide'         = "No file to open.`n`nThis shortcut is meant to be used by double-clicking a .md file."
    'openmd.introuvable'  = "This file cannot be found.`n`nIt may have been moved or renamed, or OneDrive has not synced it yet."
    'openmd.horsrevue'    = "This file is not part of a journal: the preview and automatic rebuild will not be active.`n`nIt opens anyway, so you can read or fix it."
    'openmd.reseau'       = "This file sits on a network folder. It opens, but PDF building and the preview do not work from a network path.`n`nTo work on it, copy the journal to OneDrive or to this computer's disk."
    # Raccourcis du menu Démarrer : voir le bloc fr.
    'raccourci.maj.nom'   = 'Update the journal tool'
    'raccourci.maj.desc'  = 'Install the latest version of the SZH journal tool. A window opens and shows what is going on.'
    'raccourci.lanceur.desc' = 'Open an SZH journal, Zeitschrift or book'
    # Demande du dossier partagé SharePoint (szh-ancrage.ps1).
    'ancrage.demande.titre' = 'Shared SharePoint folder not found'
    'ancrage.demande.texte' = 'The tool could not automatically find the shared SharePoint folder for journals and books. Pick a folder that is inside it, or that contains the "Daten_Allgemein - General" folder.'
    'ancrage.demande.echec' = 'This folder does not lead to the shared folder being searched for: one named "Daten_Allgemein - General", below the folder you picked or above it. Choose another folder.'
    'ancrage.abandon'       = 'The shared SharePoint folder could not be linked: journals and books will stay unreachable on this computer until it is. The request comes back the next time the Pronto launcher is opened, after 24 hours. For earlier help: {0}'
  }
}
