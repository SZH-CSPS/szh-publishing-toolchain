# Table des textes de l'interface (fr, de, en) : données pures. Dot-sourcée par
# szh-common.ps1, avant que T (défini là-bas) ne s'en serve.
# Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).

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
    # Trois causes, trois gestes : « occupé » ci-dessus se ferme en fermant l'éditeur, mais
    # un dossier déjà pris ne se ferme pas et la virtualisation ne s'active pas sans le
    # service informatique. Un seul message pour les trois envoyait le support fermer un
    # éditeur qui n'avait rien à voir — c'est arrivé.
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
    # Repli de Get-SzhCourriel (szh-common.ps1) quand le rendu Twig est hors d'atteinte
    # (VSCodium ou l'extension du cockpit absents, script manquant...) : un texte minimal,
    # jamais un second moteur -- volontairement différent du gabarit habituel. Chaîne à
    # double guillemets (retours `n) : comme les autres messages multi-lignes de ce fichier
    # (lanceur.nouvelle.doublon, lien.introuvable...), hors de portée de test/typo-check.py,
    # qui ne lit que les valeurs entre apostrophes sur une seule ligne.
    'courriel.repli.sujet' = 'SZH – problème sur le poste {0}'
    'courriel.repli.corps' = "Bonjour,`n`nLa mise à jour de l'outil Revue a rencontré un problème. Ce message est un repli, envoyé sans le gabarit habituel.`n`nÉtape   : {0}`nDétail  : {1}`nJournal : {2}`n`nMerci de joindre le fichier journal ci-dessus à ce message."
    'dl.format'         = '{0:N1} / {1:N1} Mo'
    'lanceur.choisir'   = 'Choisissez la revue à ouvrir :'
    'lanceur.ouvrir'    = 'Ouvrir'
    'lanceur.annuler'   = 'Annuler'
    'lanceur.modifie'   = '{0}    (modifiée le {1})'
    'lanceur.codium'    = 'L’’éditeur VSCodium est introuvable sur ce poste. Contact : {0}'
    'lanceur.vide'      = 'Aucune revue sur ce poste pour l’’instant – « Nouvelle revue… » pour commencer.'
    'lanceur.nouvelle'          = 'Nouvelle revue…'
    # Un numéro se décrit par son année et son rang ; le volume et le nom du dossier s'en
    # déduisent. Plus rien à saisir qui ne soit une donnée du numéro.
    'lanceur.nouvelle.annee'    = 'Année :'
    'lanceur.nouvelle.numero'   = 'Numéro :'
    'lanceur.nouvelle.volume'   = 'Volume :'
    'lanceur.nouvelle.volume.manuel' = 'Régler le volume manuellement (déconseillé)'
    'lanceur.nouvelle.volume.auto'   = 'Revenir au volume calculé'
    'lanceur.nouvelle.dossier'  = 'Dossier : {0}'
    'lanceur.nouvelle.ou'       = "Il sera créé dans :`n{0}"
    'lanceur.nouvelle.existe'   = 'Un dossier « {0} » existe déjà à cet emplacement.'
    'lanceur.nouvelle.doublon'  = "Le volume {0}, numéro {1} existe déjà : c'est le numéro « {2} », ici :`n{3}"
    'lanceur.nouvelle.doublon.arch'  = 'Ce numéro-là est archivé – un numéro archivé reste un numéro publié.'
    'lanceur.nouvelle.doublon.suite' = 'Deux numéros ne peuvent pas porter le même volume et le même numéro. Supprimez d’’abord celui qui existe, puis recréez celui-ci.'
    'lanceur.nouvelle.erreur'   = "La création de la revue a échoué :`n{0}"
    # Cycle de vie du numéro : listes du lanceur, version du logiciel, mode test.
    'maj.concurrente'           = 'Une mise à jour est déjà en cours dans une autre fenêtre – celle-ci se ferme.'
    'lanceur.versions.chargement' = 'Recherche des versions publiées…'
    'lanceur.versions.horsligne.deja' = "Aucune version n'est installable hors ligne sur ce poste : seule la version déjà installée est proposée."
    'lanceur.erreur'            = "Le lanceur n'a pas pu démarrer :`n`n{0}`n`nContact : {1}"
    'lanceur.choisir.zs'        = 'Choisissez la Zeitschrift à ouvrir :'
    'lanceur.vide.zs'           = 'Aucune Zeitschrift sur ce poste pour l’’instant – « Nouvelle Zeitschrift… » pour commencer.'
    'lanceur.nouvelle.zs'       = 'Nouvelle Zeitschrift…'
    'lanceur.vide.archives.zs'  = 'Aucune Zeitschrift archivée.'
    'lien.invalide'             = "Ce lien n'est pas un lien de revue SZH valide :`n`n{0}"
    'lien.introuvable'          = "Ce lien renvoie au numéro « {0} » ({1}), introuvable sur ce poste.`n`nVérifiez que OneDrive a fini de synchroniser le dossier, puis réessayez. Vous pouvez aussi ouvrir le numéro à la main depuis « Pronto »."
    'lanceur.hors'              = '{0} revue(s) hors arborescence dans {1} – à déplacer.'
    'lanceur.encours'           = 'En cours :'
    'lanceur.archives'          = 'Archivées :'
    'lanceur.vide.archives'     = 'Aucune revue archivée.'
    'lanceur.version'           = 'Version : {0}'
    'lanceur.version.inconnue'  = 'Version : inconnue'
    # Où vivent les numéros, dit dans les deux racines et non plus en test seulement : avec
    # le titre de la fenêtre, c'est le seul endroit qui rende la racine active visible, et le
    # chemin complet suffit à la reconnaître (« Revues-TESTING » ou « 2_Produkte »).
    'lanceur.test'              = 'Revue dans : {0}'
    'lanceur.test.zs'           = 'Zeitschrift dans : {0}'
    'racine.test'               = 'dossier de test'
    'racine.prod'               = 'dossier de production'
    # Bandeau du mode test : première ligne du bloc d'informations et des deux formulaires
    # « Nouveau... » quand l'emplacement actif est « test » (jamais en production) -- Firebrick,
    # decide par $emplacements.emplacement (open-produit.ps1).
    'lanceur.modeTest'          = 'Mode test : tout ce que vous créez ici va dans le dossier de test, pas en production.'
    'lanceur.versions.bouton'   = 'Version du logiciel…'
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
    # Variante pour un livre (buch.yaml) : seulement là où « revue » serait visible et faux.
    'arch.titre.livre'          = 'Archivage du livre'
    'arch.titre.des.livre'      = 'Désarchivage du livre'
    'arch.ok.livre'             = 'Livre déplacé : {0}'
    'arch.rouvre.livre'         = 'Réouverture du livre…'
    'arch.err.suite.livre'      = 'Rien n’’a été déplacé : le livre est resté où il était. En cas de doute : {0}'
    # Double-clic sur un .md (open-md.ps1) : messages des cas anormaux seulement.
    'openmd.vide'         = "Aucun fichier à ouvrir.`n`nCe raccourci s'utilise en double-cliquant un fichier .md."
    'openmd.introuvable'  = "Ce fichier est introuvable.`n`nIl a peut-être été déplacé ou renommé, ou OneDrive ne l'a pas encore synchronisé."
    'openmd.horsrevue'    = "Ce fichier ne fait pas partie d'une revue : l'aperçu et la régénération ne seront pas actifs.`n`nIl s'ouvre quand même, pour le lire ou le corriger."
    'openmd.reseau'       = "Ce fichier est dans un dossier réseau. Il s'ouvre, mais la fabrication du PDF et l'aperçu ne fonctionnent pas depuis un chemin réseau.`n`nPour travailler dessus, copiez la revue dans OneDrive ou sur le disque de ce poste."
    # Raccourcis du menu Démarrer. Ces deux premiers noms sont ceux des fichiers .lnk :
    # les changer renomme les entrées du menu (l'ancienne est retirée, jamais doublée).
    # raccourci.maj.nom ne nomme plus aucun raccourci actuel : elle sert seulement à la
    # désinstallation, pour reconnaître et retirer l'ancien .lnk d'un poste venu d'une version
    # antérieure (Get-SzhRaccourcisObsoletes, szh-shell.ps1). Ne pas changer sa valeur.
    'raccourci.maj.nom'   = 'Mise à jour de l’’outil Revue'
    'raccourci.maj.desc'  = 'Installer la dernière version de l’’outil Pronto. Une fenêtre s’’ouvre et montre ce qui se passe.'
    'raccourci.revue.desc' = 'Ouvrir une revue SZH'
    'raccourci.zs.desc'   = 'Ouvrir une Pronto'
    'raccourci.livre.desc' = 'Ouvrir un livre SZH-CSPS'
    'raccourci.lanceur.desc' = 'Ouvrir une revue, une Zeitschrift ou un livre SZH'
    # Fenêtre unique à quatre onglets (Revue, Zeitschrift, Book, Paramètres) : titre générique
    # et textes de l'onglet Paramètres (langue de l'interface, onglet ouvert au démarrage).
    'lanceur.titre.suite'           = '{0} – {racine}'
    'lanceur.reglages'              = 'Paramètres'
    'lanceur.reglages.onglet'       = 'Onglet ouvert au démarrage'
    'lanceur.reglages.auto'         = 'Automatique (selon la langue du poste)'
    'lanceur.reglages.langue'       = 'Langue de l’’interface'
    'lanceur.reglages.langue.auto'  = 'Automatique ({0})'
    'lanceur.reglages.langue.fr'    = 'Français'
    'lanceur.reglages.langue.de'    = 'Allemand'
    'lanceur.reglages.langue.apres' = 'Effet à la prochaine ouverture.'
    # Réglage « mise à jour » : fenêtre visible ou silencieuse ; un échec répété se
    # signale quand même (voir la note ci-dessous).
    'lanceur.reglages.maj'          = 'Mise à jour de l’’outil'
    'lanceur.reglages.maj.visible'  = 'Montrer la fenêtre pendant la mise à jour'
    'lanceur.reglages.maj.silence'  = 'Mettre à jour en silence, sans fenêtre'
    'lanceur.reglages.maj.note'     = 'Un échec répété se signale quand même.'
    # Mode développeur : déménagé du formulaire de réglages de l'éditeur (mêmes
    # libellés), vaut pour tout le poste et non pour ce seul compte. L'onglet ne le dit
    # plus : où vit un réglage n'intéresse personne qui s'en sert.
    'lanceur.reglages.dev'          = 'Mode développeur (dossiers de test)'
    'lanceur.reglages.dev.oui'      = 'Activé'
    'lanceur.reglages.dev.non'      = 'Désactivé'
    'lanceur.reglages.dev.note'     = 'Les listes suivent à la prochaine ouverture.'
    # Onglet « Journal » : les dix dernières mises à jour et leur verdict.
    'lanceur.journal'                  = 'Journal'
    'lanceur.journal.liste'            = 'Dix dernières mises à jour :'
    'lanceur.journal.vide'             = 'Aucune mise à jour enregistrée.'
    'lanceur.journal.entree'           = '{0}    {1}    ({2} ko)'
    'lanceur.journal.ok'               = 'réussie'
    'lanceur.journal.echec'            = 'échouée'
    'lanceur.journal.inconnu'          = 'issue inconnue'
    'lanceur.journal.choisir'          = 'Choisissez une mise à jour pour lire son journal.'
    'lanceur.journal.illisible'        = 'Ce journal n’’a pas pu être lu : {0}'
    # Bouton « Signaler une erreur » : envoie au support un rapport structuré avec
    # le journal choisi.
    'lanceur.journal.signaler'         = 'Signaler une erreur…'
    'lanceur.journal.signaler.titre'   = 'Signaler une erreur'
    'lanceur.journal.signaler.quoi'    = 'En une phrase : que s’’est-il passé ?'
    'lanceur.journal.signaler.fait'    = 'Le signalement est parti, avec le journal choisi.'
    'lanceur.journal.signaler.attente' = 'Le signalement partira dès que le dossier SharePoint sera de nouveau joignable.'
    'lanceur.journal.signaler.refuse'  = 'Le signalement n’’a pas pu être enregistré. Le journal du poste en dit la raison.'
    # Bouton « Envoyer les journaux » : réunit les journaux dans une archive, ouvre un
    # brouillon de courriel et montre l'archive dans l'explorateur (mailto ne porte pas de pièce jointe).
    'lanceur.journal.envoyer'          = 'Envoyer les journaux…'
    'lanceur.journal.envoyer.fait'     = 'Les journaux sont réunis dans « {0} », que l’’explorateur vient d’’ouvrir. Un brouillon de courriel au support est ouvert : glissez-y ce fichier avant d’’envoyer.'
    'lanceur.journal.envoyer.erreur'   = 'Les journaux n’’ont pas pu être réunis : {0}'
    # Onglet « Book » du lanceur : un livre n'a ni volume ni numéro, il a un titre, une
    # année et une référence B — voir szh-produits.ps1.
    'lanceur.choisir.livre'        = 'Choisissez le livre à ouvrir :'
    'lanceur.vide.livre'           = 'Aucun livre sur ce poste pour l’’instant – « Nouveau livre… » pour commencer.'
    'lanceur.nouvelle.livre'       = 'Nouveau livre…'
    'lanceur.test.livre'           = 'Livre dans : {0}'
    'lanceur.modifie.livre'        = '{0}    (modifié le {1})'
    'lanceur.vide.archives.livre'  = 'Aucun livre archivé.'
    'lanceur.nouvelle.livre.titre'      = 'Titre :'
    'lanceur.nouvelle.livre.reference'  = 'Référence B :'
    'lanceur.nouvelle.livre.type'       = 'Type :'
    'lanceur.nouvelle.livre.type.mono'      = 'Monographie'
    'lanceur.nouvelle.livre.type.collectif' = 'Ouvrage collectif'
    'lanceur.nouvelle.livre.maquette'        = 'Maquette :'
    'lanceur.nouvelle.livre.maquette.normal' = 'Normal'
    'lanceur.nouvelle.livre.maquette.falc'   = 'FALC'
    'lanceur.nouvelle.livre.format'          = 'Format :'
    'lanceur.nouvelle.livre.format.standard' = 'Standard (155 × 225 mm)'
    'lanceur.nouvelle.livre.format.a4'       = 'A4 (210 × 297 mm)'
    'lanceur.nouvelle.livre.titre.manque'    = 'Le titre du livre est nécessaire pour créer son dossier.'
    'lanceur.nouvelle.livre.doublon'         = "La référence B{0} existe déjà : c'est le livre « {1} », ici :`n{2}"
    'lanceur.nouvelle.livre.doublon.arch'    = 'Ce livre-là est archivé – un livre archivé reste un livre publié.'
    'lanceur.nouvelle.livre.doublon.suite'   = 'Deux livres ne peuvent pas porter la même référence B. Supprimez d’’abord celui qui existe, puis recréez celui-ci.'
    'lanceur.nouvelle.livre.erreur'          = "La création du livre a échoué :`n{0}"
    # Demande du dossier partage SharePoint (ancrage) quand rien ne l'a trouve tout seul --
    # szh-ancrage.ps1, Resolve-SzhAncrage/Request-SzhAncrageUtilisateur.
    'ancrage.demande.titre' = 'Dossier partagé SharePoint introuvable'
    'ancrage.demande.texte' = 'L’’outil n’’a pas trouvé automatiquement le dossier partagé SharePoint des revues et des livres. Indiquez un dossier qui s’’y trouve, ou qui contient le dossier « Daten_Allgemein - General ».'
    'ancrage.demande.echec' = 'Ce dossier ne mène pas au dossier partagé recherché : un dossier nommé « Daten_Allgemein - General », sous le dossier indiqué ou au-dessus de lui. Choisissez un autre dossier.'
    'ancrage.abandon'       = 'Le dossier partagé SharePoint n’’a pas pu être rattaché : les revues et les livres resteront introuvables sur ce poste tant qu’’il ne l’’est pas. La demande réapparaîtra à la prochaine ouverture de « Pronto », passé 24 heures. Besoin d’’aide plus tôt : {0}'
    # Ligne d'info du lanceur (open-produit.ps1) quand l'ancrage reste absent après
    # Initialize-SzhAncrage : dit pourquoi la liste est vide, sans rouvrir de fenêtre.
    'lanceur.ancrage.absent' = 'Dossier partagé SharePoint introuvable : la liste ci-dessus restera vide tant que ce dossier ne sera pas rattaché.'
    # Onglet « Export et secrétariat » : quatre exports pilotés par secretariat-cli.js, livré
    # dans l'extension du cockpit et exécuté par le Node de VSCodium (Invoke-SzhSecretariat,
    # open-produit.ps1) -- newsletter/auteurs, Edudoc, caractères par article, contrôle des
    # métadonnées. Le filtre Revue/Zeitschrift, la barre de progression et le bouton
    # d'interruption sont décrits juste avant leur bloc de code dans open-produit.ps1.
    'lanceur.secretariat'                           = 'Export et secrétariat'
    'lanceur.secretariat.intro'                     = 'Choisissez un ou plusieurs numéros ci-dessous, puis un export.'
    'lanceur.secretariat.filtre'                    = 'Afficher :'
    'lanceur.secretariat.liste.entree'              = '{0}    {1}    {2}'
    'lanceur.secretariat.newsletter'                = 'Newsletter et auteurs…'
    'lanceur.secretariat.newsletter.manque'         = 'Choisissez d’’abord un numéro dans la liste.'
    'lanceur.secretariat.edudoc'                    = 'Export Edudoc (CSV)…'
    'lanceur.secretariat.caracteres'                = 'Caractères par article (CSV)…'
    'lanceur.secretariat.metadonnees'               = 'Contrôle des métadonnées…'
    'lanceur.secretariat.metadonnees.manque'        = 'Choisissez au moins un numéro dans la liste.'
    'lanceur.secretariat.dossier'                   = 'Ouvrir le dossier'
    'lanceur.secretariat.dossier.demande'           = 'Choisissez le dossier de destination :'
    'lanceur.secretariat.export.titre.edudoc'       = 'Export Edudoc'
    'lanceur.secretariat.export.titre.caracteres'   = 'Caractères par article'
    'lanceur.secretariat.export.titre.newsletter'   = 'Newsletter et auteurs'
    'lanceur.secretariat.export.titre.metadonnees'  = 'Contrôle des métadonnées'
    'lanceur.secretariat.export.titre.chargement'   = 'Chargement des numéros'
    'lanceur.secretariat.export.revue'              = 'Export pour : {0}'
    'lanceur.secretariat.export.charger'            = 'Charger les numéros de {0}'
    'lanceur.secretariat.export.charger.plus'       = 'Charger aussi {0}'
    'lanceur.secretariat.export.instructions'       = 'Cochez les numéros à inclure :'
    'lanceur.secretariat.export.aucun'              = 'Aucun numéro n’’a pu être chargé.'
    'lanceur.secretariat.export.fincourse'          = 'Rien de plus ancien à charger.'
    'lanceur.secretariat.resultat.ok'               = '✓ {0}'
    'lanceur.secretariat.resultat.echec'            = '⚠ {0}'
    'lanceur.secretariat.resultat.enregistre'       = 'Enregistré dans {0}. Appuyez sur « Ouvrir le dossier » pour les voir.'
    'lanceur.secretariat.echec.inconnu'             = 'Raison inconnue.'
    'lanceur.secretariat.erreur'                    = 'Erreur : {0}'
    'lanceur.secretariat.interrompu'                = 'Export interrompu.'
    'lanceur.secretariat.interrompre'               = 'Interrompre'
    'lanceur.secretariat.journal.entete'            = '[{0}] {1}'
    'lanceur.secretariat.outil.absent'              = 'L’’outil de secrétariat (secretariat-cli.js) est introuvable dans l’’extension du cockpit sur ce poste. Réinstallez ou mettez à jour l’’outil, puis réessayez.'
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
    # Ersatztext von Get-SzhCourriel (szh-common.ps1), wenn das Twig-Rendering nicht
    # erreichbar ist -- siehe den gleichen Kommentar im fr-Block weiter oben.
    'courriel.repli.sujet' = 'SZH – Problem auf dem Arbeitsplatz {0}'
    'courriel.repli.corps' = "Guten Tag,`n`nBei der Aktualisierung des SZH-Redaktionstools ist ein Problem aufgetreten. Diese Meldung ist ein Ersatztext ohne die übliche Vorlage.`n`nSchritt  : {0}`nDetail   : {1}`nProtokoll: {2}`n`nBitte hängen Sie die oben genannte Protokolldatei an diese Nachricht an."
    'dl.format'         = '{0:N1} / {1:N1} MB'
    'lanceur.choisir'   = 'Wählen Sie die zu öffnende Revue:'
    'lanceur.ouvrir'    = 'Öffnen'
    'lanceur.annuler'   = 'Abbrechen'
    'lanceur.modifie'   = '{0}    (geändert am {1})'
    'lanceur.codium'    = 'Der Editor VSCodium wurde auf diesem Computer nicht gefunden. Kontakt: {0}'
    'lanceur.vide'      = 'Noch keine Revue auf diesem Computer – mit «Neue Revue…» beginnen.'
    'lanceur.nouvelle'          = 'Neue Revue…'
    'lanceur.nouvelle.annee'    = 'Jahr:'
    'lanceur.nouvelle.numero'   = 'Nummer:'
    'lanceur.nouvelle.volume'   = 'Band:'
    'lanceur.nouvelle.volume.manuel' = 'Band manuell einstellen (nicht empfohlen)'
    'lanceur.nouvelle.volume.auto'   = 'Zurück zum berechneten Band'
    'lanceur.nouvelle.dossier'  = 'Ordner: {0}'
    'lanceur.nouvelle.ou'       = "Die Ausgabe wird erstellt in:`n{0}"
    'lanceur.nouvelle.existe'   = 'Ein Ordner «{0}» existiert an diesem Ort bereits.'
    'lanceur.nouvelle.doublon'  = "Band {0}, Nummer {1} existiert bereits: es ist die Ausgabe « {2} », hier:`n{3}"
    'lanceur.nouvelle.doublon.arch'  = 'Jene Ausgabe ist archiviert – eine archivierte Ausgabe bleibt eine veröffentlichte Ausgabe.'
    'lanceur.nouvelle.doublon.suite' = 'Zwei Ausgaben können nicht denselben Band und dieselbe Nummer tragen. Löschen Sie zuerst die vorhandene Ausgabe und erstellen Sie diese danach neu.'
    'lanceur.nouvelle.erreur'   = "Die Revue konnte nicht erstellt werden:`n{0}"
    # Lebenszyklus der Ausgabe
    'maj.concurrente'           = 'In einem anderen Fenster läuft bereits eine Aktualisierung – dieses schliesst sich.'
    'lanceur.versions.chargement' = 'Suche nach veröffentlichten Versionen…'
    'lanceur.versions.horsligne.deja' = "Auf diesem Computer ist keine Version offline installierbar: es wird nur die bereits installierte Version angeboten."
    'lanceur.erreur'            = "Der Starter konnte nicht gestartet werden:`n`n{0}`n`nKontakt: {1}"
    'lanceur.choisir.zs'        = 'Wählen Sie die zu öffnende Zeitschrift:'
    'lanceur.vide.zs'           = 'Noch keine Zeitschrift auf diesem Computer – mit «Neue Zeitschrift…» beginnen.'
    'lanceur.nouvelle.zs'       = 'Neue Zeitschrift…'
    'lanceur.vide.archives.zs'  = 'Keine archivierte Zeitschrift.'
    'lien.invalide'             = "Dieser Link ist kein gültiger SZH-Zeitschriftenlink:`n`n{0}"
    'lien.introuvable'          = "Dieser Link verweist auf die Ausgabe « {0} » ({1}), die auf diesem Computer nicht gefunden wurde.`n`nPrüfen Sie, ob OneDrive den Ordner fertig synchronisiert hat, und versuchen Sie es erneut. Sie können die Ausgabe auch von Hand über « Pronto » öffnen."
    'lanceur.hors'              = '{0} Zeitschrift(en) ausserhalb der Ablage in {1} – zu verschieben.'
    'lanceur.encours'           = 'In Arbeit:'
    'lanceur.archives'          = 'Archiviert:'
    'lanceur.vide.archives'     = 'Keine archivierte Revue.'
    'lanceur.version'           = 'Version: {0}'
    'lanceur.version.inconnue'  = 'Version: unbekannt'
    'lanceur.modeTest'          = 'Testmodus: Alles, was Sie hier anlegen, landet im Testordner, nicht in der Produktion.'
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
    'lanceur.versions.note'     = 'Angeboten wird nur die neueste Version jedes Stands.'
    'lanceur.versions.avert'    = "Ein Versionswechsel ersetzt das Layout, die PDF-Erzeugungsumgebung und die Editor-Erweiterungen.`n`nSchliessen Sie zuerst die Redaktionsfenster und starten Sie den Editor am Ende neu.`n`nVersion {0} installieren?"
    # Archivieren / Dearchivieren (archive-revue.ps1)
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
    # Variante für ein Buch (buch.yaml) : nur wo «Zeitschrift» sichtbar und falsch wäre.
    'arch.titre.livre'          = 'Archivierung des Buchs'
    'arch.titre.des.livre'      = 'Dearchivierung des Buchs'
    'arch.ok.livre'             = 'Buch verschoben: {0}'
    'arch.rouvre.livre'         = 'Buch wird wieder geöffnet…'
    'arch.err.suite.livre'      = 'Es wurde nichts verschoben: das Buch ist an seinem Platz geblieben. Bei Zweifeln: {0}'
    # Doppelklick auf eine .md-Datei (open-md.ps1): nur die anormalen Fälle.
    'openmd.vide'         = "Keine Datei zum Öffnen.`n`nDieser Befehl wird per Doppelklick auf eine .md-Datei verwendet."
    'openmd.introuvable'  = "Diese Datei wurde nicht gefunden.`n`nSie wurde vielleicht verschoben oder umbenannt, oder OneDrive hat sie noch nicht synchronisiert."
    'openmd.horsrevue'    = "Diese Datei gehört zu keiner Zeitschrift: Vorschau und Neuerzeugung sind nicht aktiv.`n`nSie wird trotzdem geöffnet, zum Lesen oder Korrigieren."
    'openmd.reseau'       = "Diese Datei liegt in einem Netzwerkordner. Sie wird geöffnet, aber die PDF-Erzeugung und die Vorschau funktionieren von einem Netzwerkpfad aus nicht.`n`nKopieren Sie die Zeitschrift zum Arbeiten nach OneDrive oder auf die Festplatte dieses Computers."
    # Verknüpfungen im Startmenü. Die ersten beiden Namen sind Dateinamen (.lnk):
    # werden sie geändert, wird der Eintrag umbenannt — der alte wird entfernt, nie doppelt.
    'raccourci.maj.nom'   = 'Aktualisierung des Redaktionstools'
    'raccourci.maj.desc'  = 'Die neueste Version des SZH-Redaktionstools installieren. Ein Fenster öffnet sich und zeigt, was geschieht.'
    'raccourci.revue.desc' = 'Eine SZH-Revue öffnen'
    'raccourci.zs.desc'   = 'Eine SZH-Zeitschrift öffnen'
    'raccourci.livre.desc' = 'Ein SZH-CSPS-Buch öffnen'
    'raccourci.lanceur.desc' = 'Eine Revue, eine Zeitschrift oder ein Buch des SZH öffnen'
    # Einzelnes Fenster mit vier Registerkarten (Revue, Zeitschrift, Book, Einstellungen): allgemeiner
    # Titel und Texte der Registerkarte Einstellungen (Sprache der Oberfläche, Start-Registerkarte).
    'lanceur.titre.suite'           = '{0} – {racine}'
    'lanceur.reglages'              = 'Einstellungen'
    'lanceur.reglages.onglet'       = 'Beim Start geöffnete Registerkarte'
    'lanceur.reglages.auto'         = 'Automatisch (nach der Sprache des Computers)'
    'lanceur.reglages.langue'       = 'Sprache der Oberfläche'
    'lanceur.reglages.langue.auto'  = 'Automatisch ({0})'
    'lanceur.reglages.langue.fr'    = 'Französisch'
    'lanceur.reglages.langue.de'    = 'Deutsch'
    'lanceur.reglages.langue.apres' = 'Wirkt beim nächsten Öffnen.'
    # Einstellung «Aktualisierung»: Fenster sichtbar oder still; ein wiederholt
    # fehlschlagender Vorgang meldet sich trotzdem.
    'lanceur.reglages.maj'          = 'Aktualisierung des Programms'
    'lanceur.reglages.maj.visible'  = 'Fenster während der Aktualisierung anzeigen'
    'lanceur.reglages.maj.silence'  = 'Still aktualisieren, ohne Fenster'
    'lanceur.reglages.maj.note'     = 'Ein wiederholter Fehlschlag meldet sich trotzdem.'
    # Entwicklermodus: aus dem Einstellungsformular des Editors verschoben (gleiche
    # Bezeichnungen), gilt für den ganzen Computer.
    'lanceur.reglages.dev'          = 'Entwicklermodus (Testordner)'
    'lanceur.reglages.dev.oui'      = 'Ein'
    'lanceur.reglages.dev.non'      = 'Aus'
    'lanceur.reglages.dev.note'     = 'Listen folgen beim nächsten Öffnen.'
    # Registerkarte «Protokoll»: die letzten zehn Aktualisierungen und ihr Ausgang.
    'lanceur.journal'                  = 'Protokoll'
    'lanceur.journal.liste'            = 'Letzte zehn Aktualisierungen:'
    'lanceur.journal.vide'             = 'Keine Aktualisierung aufgezeichnet.'
    'lanceur.journal.entree'           = '{0}    {1}    ({2} kB)'
    'lanceur.journal.ok'               = 'erfolgreich'
    'lanceur.journal.echec'            = 'fehlgeschlagen'
    'lanceur.journal.inconnu'          = 'Ausgang unbekannt'
    'lanceur.journal.choisir'          = 'Wählen Sie eine Aktualisierung, um ihr Protokoll zu lesen.'
    'lanceur.journal.illisible'        = 'Dieses Protokoll konnte nicht gelesen werden: {0}'
    # Schaltfläche «Fehler melden»: schickt dem Support einen strukturierten Bericht
    # mit dem gewählten Protokoll.
    'lanceur.journal.signaler'         = 'Fehler melden…'
    'lanceur.journal.signaler.titre'   = 'Fehler melden'
    'lanceur.journal.signaler.quoi'    = 'In einem Satz: Was ist geschehen?'
    'lanceur.journal.signaler.fait'    = 'Die Meldung ist mit dem gewählten Protokoll abgegangen.'
    'lanceur.journal.signaler.attente' = 'Die Meldung geht ab, sobald der SharePoint-Ordner wieder erreichbar ist.'
    'lanceur.journal.signaler.refuse'  = 'Die Meldung konnte nicht gespeichert werden. Das Protokoll des Computers nennt den Grund.'
    # Schaltfläche «Protokolle senden»: fasst die Protokolle in einem Archiv zusammen,
    # öffnet einen E-Mail-Entwurf und zeigt das Archiv im Explorer (mailto trägt keinen Anhang).
    'lanceur.journal.envoyer'          = 'Protokolle senden…'
    'lanceur.journal.envoyer.fait'     = 'Die Protokolle liegen zusammen in «{0}», das der Explorer soeben geöffnet hat. Ein E-Mail-Entwurf an den Support ist offen: Ziehen Sie die Datei hinein, bevor Sie senden.'
    'lanceur.journal.envoyer.erreur'   = 'Die Protokolle konnten nicht zusammengefasst werden: {0}'
    'lanceur.choisir.livre'        = 'Wählen Sie das zu öffnende Buch:'
    'lanceur.vide.livre'           = 'Noch kein Buch auf diesem Computer – mit «Neues Buch…» beginnen.'
    'lanceur.nouvelle.livre'       = 'Neues Buch…'
    'lanceur.test.livre'           = 'Buch in: {0}'
    'lanceur.modifie.livre'        = '{0}    (geändert am {1})'
    'lanceur.vide.archives.livre'  = 'Kein archiviertes Buch.'
    'lanceur.nouvelle.livre.titre'      = 'Titel:'
    'lanceur.nouvelle.livre.reference'  = 'B-Referenz:'
    'lanceur.nouvelle.livre.type'       = 'Typ:'
    'lanceur.nouvelle.livre.type.mono'      = 'Monografie'
    'lanceur.nouvelle.livre.type.collectif' = 'Sammelband'
    'lanceur.nouvelle.livre.maquette'        = 'Layout:'
    'lanceur.nouvelle.livre.maquette.normal' = 'Normal'
    'lanceur.nouvelle.livre.maquette.falc'   = 'FALC'
    'lanceur.nouvelle.livre.format'          = 'Format:'
    'lanceur.nouvelle.livre.format.standard' = 'Standard (155 × 225 mm)'
    'lanceur.nouvelle.livre.format.a4'       = 'A4 (210 × 297 mm)'
    'lanceur.nouvelle.livre.titre.manque'    = 'Der Titel des Buchs wird benötigt, um seinen Ordner anzulegen.'
    'lanceur.nouvelle.livre.doublon'         = "Die B-Referenz {0} existiert bereits: es ist das Buch «{1}», hier:`n{2}"
    'lanceur.nouvelle.livre.doublon.arch'    = 'Jenes Buch ist archiviert – ein archiviertes Buch bleibt ein veröffentlichtes Buch.'
    'lanceur.nouvelle.livre.doublon.suite'   = 'Zwei Bücher können nicht dieselbe B-Referenz tragen. Löschen Sie zuerst das vorhandene Buch und erstellen Sie dieses danach neu.'
    'lanceur.nouvelle.livre.erreur'          = "Das Buch konnte nicht erstellt werden:`n{0}"
    # Anfrage nach dem freigegebenen SharePoint-Ordner (Ancrage), wenn nichts automatisch
    # gefunden wurde -- szh-ancrage.ps1, Resolve-SzhAncrage/Request-SzhAncrageUtilisateur.
    'ancrage.demande.titre' = 'Freigegebener SharePoint-Ordner nicht gefunden'
    'ancrage.demande.texte' = 'Das Werkzeug hat den freigegebenen SharePoint-Ordner der Zeitschriften und Bücher nicht automatisch gefunden. Wählen Sie einen Ordner, der darin liegt, oder der den Ordner «Daten_Allgemein - General» enthält.'
    'ancrage.demande.echec' = 'Dieser Ordner führt nicht zum gesuchten freigegebenen Ordner: ein Ordner namens «Daten_Allgemein - General», unterhalb des gewählten Ordners oder darüber. Wählen Sie einen anderen Ordner.'
    'ancrage.abandon'       = 'Der freigegebene SharePoint-Ordner konnte nicht verknüpft werden: Zeitschriften und Bücher bleiben auf diesem Rechner unauffindbar, bis er es ist. Die Anfrage erscheint beim nächsten Öffnen von «Pronto» wieder, nach 24 Stunden. Für frühere Hilfe: {0}'
    # Info-Zeile des Launchers (open-produit.ps1), wenn der Ordner nach Initialize-SzhAncrage
    # weiterhin fehlt: sagt, weshalb die Liste leer bleibt.
    'lanceur.ancrage.absent' = 'Freigegebener SharePoint-Ordner nicht gefunden: Die Liste bleibt leer, bis er verknüpft ist.'
    # Registerkarte «Export und Sekretariat»: vier Exporte, gesteuert von
    # secretariat-cli.js, shipped in the cockpit extension and run by VSCodium's Node
    # (Invoke-SzhSecretariat, open-produit.ps1). Filter, Fortschrittsbalken und
    # Unterbrechen-Schaltfläche: siehe die Kommentare vor dem jeweiligen Codeblock in
    # open-produit.ps1.
    'lanceur.secretariat'                           = 'Export und Sekretariat'
    'lanceur.secretariat.intro'                     = 'Wählen Sie unten eine oder mehrere Ausgaben, dann einen Export.'
    'lanceur.secretariat.filtre'                    = 'Anzeigen:'
    'lanceur.secretariat.liste.entree'              = '{0}    {1}    {2}'
    'lanceur.secretariat.newsletter'                = 'Newsletter und Autorenschaft…'
    'lanceur.secretariat.newsletter.manque'         = 'Wählen Sie zuerst eine Ausgabe in der Liste.'
    'lanceur.secretariat.edudoc'                    = 'Edudoc-Export (CSV)…'
    'lanceur.secretariat.caracteres'                = 'Zeichen pro Artikel (CSV)…'
    'lanceur.secretariat.metadonnees'               = 'Metadatenkontrolle…'
    'lanceur.secretariat.metadonnees.manque'        = 'Wählen Sie mindestens eine Ausgabe in der Liste.'
    'lanceur.secretariat.dossier'                   = 'Ordner öffnen'
    'lanceur.secretariat.dossier.demande'           = 'Wählen Sie den Zielordner:'
    'lanceur.secretariat.export.titre.edudoc'       = 'Edudoc-Export'
    'lanceur.secretariat.export.titre.caracteres'   = 'Zeichen pro Artikel'
    'lanceur.secretariat.export.titre.newsletter'   = 'Newsletter und Autorenschaft'
    'lanceur.secretariat.export.titre.metadonnees'  = 'Metadatenkontrolle'
    'lanceur.secretariat.export.titre.chargement'   = 'Laden der Ausgaben'
    'lanceur.secretariat.export.revue'              = 'Export für: {0}'
    'lanceur.secretariat.export.charger'            = 'Ausgaben von {0} laden'
    'lanceur.secretariat.export.charger.plus'       = 'Auch {0} laden'
    'lanceur.secretariat.export.instructions'       = 'Wählen Sie die einzuschliessenden Ausgaben aus:'
    'lanceur.secretariat.export.aucun'              = 'Es konnte keine Ausgabe geladen werden.'
    'lanceur.secretariat.export.fincourse'          = 'Nichts Älteres mehr zu laden.'
    'lanceur.secretariat.resultat.ok'               = '✓ {0}'
    'lanceur.secretariat.resultat.echec'            = '⚠ {0}'
    'lanceur.secretariat.resultat.enregistre'       = 'In {0} gespeichert. Klicken Sie auf «Ordner öffnen», um sie zu sehen.'
    'lanceur.secretariat.echec.inconnu'             = 'Grund unbekannt.'
    'lanceur.secretariat.erreur'                    = 'Fehler: {0}'
    'lanceur.secretariat.interrompu'                = 'Export abgebrochen.'
    'lanceur.secretariat.interrompre'               = 'Unterbrechen'
    'lanceur.secretariat.journal.entete'            = '[{0}] {1}'
    'lanceur.secretariat.outil.absent'              = 'Das Sekretariats-Werkzeug (secretariat-cli.js) wurde in der Cockpit-Erweiterung auf diesem Rechner nicht gefunden. Installieren oder aktualisieren Sie das Werkzeug und versuchen Sie es dann erneut.'
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
    # Fallback text for Get-SzhCourriel (szh-common.ps1) when the Twig rendering is out of
    # reach -- see the same comment in the fr block above.
    'courriel.repli.sujet' = 'SZH – problem on workstation {0}'
    'courriel.repli.corps' = "Hello,`n`nThe SZH journal tool update ran into a problem. This is a fallback message, sent without the usual template.`n`nStep  : {0}`nDetail: {1}`nLog   : {2}`n`nPlease attach the log file above to this message."
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
    'lanceur.choisir.zs'        = 'Choose the Zeitschrift to open:'
    'lanceur.vide.zs'           = 'No Zeitschrift on this computer yet — use "New Zeitschrift…" to get started.'
    'lanceur.nouvelle.zs'       = 'New Zeitschrift…'
    'lanceur.vide.archives.zs'  = 'No archived Zeitschrift.'
    'lien.invalide'             = "This is not a valid SZH journal link:`n`n{0}"
    'lien.introuvable'          = "This link points to issue {0} ({1}), which was not found on this computer.`n`nCheck that OneDrive has finished syncing the folder, then try again. You can also open the issue by hand from the Pronto launcher."
    'lanceur.hors'              = '{0} journal(s) outside the official tree in {1} — to be moved.'
    'lanceur.encours'           = 'In progress:'
    'lanceur.archives'          = 'Archived:'
    'lanceur.vide.archives'     = 'No archived journal.'
    'lanceur.version'           = 'Version: {0}'
    'lanceur.version.inconnue'  = 'Version: unknown'
    'lanceur.modeTest'          = 'Test mode: everything you create here goes to the test folder, not to production.'
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
    'lanceur.versions.note'     = 'Only the latest version of each state is offered.'
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
    # Variant for a book (buch.yaml): only where “journal” would be visible and wrong.
    'arch.titre.livre'          = 'Archiving the book'
    'arch.titre.des.livre'      = 'Unarchiving the book'
    'arch.ok.livre'             = 'Book moved: {0}'
    'arch.rouvre.livre'         = 'Reopening the book…'
    'arch.err.suite.livre'      = 'Nothing was moved: the book stayed where it was. If in doubt: {0}'
    # Double-click on a .md file (open-md.ps1): abnormal cases only.
    'openmd.vide'         = "No file to open.`n`nThis shortcut is meant to be used by double-clicking a .md file."
    'openmd.introuvable'  = "This file cannot be found.`n`nIt may have been moved or renamed, or OneDrive has not synced it yet."
    'openmd.horsrevue'    = "This file is not part of a journal: the preview and automatic rebuild will not be active.`n`nIt opens anyway, so you can read or fix it."
    'openmd.reseau'       = "This file sits on a network folder. It opens, but PDF building and the preview do not work from a network path.`n`nTo work on it, copy the journal to OneDrive or to this computer's disk."
    # Start menu shortcuts. The first two names are .lnk file names: changing them
    # renames the menu entry — the old one is removed, never left as a duplicate.
    'raccourci.maj.nom'   = 'Update the journal tool'
    'raccourci.maj.desc'  = 'Install the latest version of the SZH journal tool. A window opens and shows what is going on.'
    'raccourci.revue.desc' = 'Open an SZH journal'
    'raccourci.zs.desc'   = 'Open an SZH Zeitschrift'
    'raccourci.livre.desc' = 'Open an SZH-CSPS book'
    'raccourci.lanceur.desc' = 'Open an SZH journal, Zeitschrift or book'
    # Single window with four tabs (Revue, Zeitschrift, Book, Settings): generic title and the
    # Settings tab's strings (interface language, tab opened at startup).
    'lanceur.titre.suite'           = '{0} — {racine}'
    'lanceur.reglages'              = 'Settings'
    'lanceur.reglages.onglet'       = 'Tab opened at startup'
    'lanceur.reglages.auto'         = 'Automatic (follows the computer’’s language)'
    'lanceur.reglages.langue'       = 'Interface language'
    'lanceur.reglages.langue.auto'  = 'Automatic ({0})'
    'lanceur.reglages.langue.fr'    = 'French'
    'lanceur.reglages.langue.de'    = 'German'
    'lanceur.reglages.langue.apres' = 'Takes effect the next time it opens.'
    # “Update” setting: window shown or silent; an update that keeps failing still
    # speaks up.
    'lanceur.reglages.maj'          = 'Updating the tool'
    'lanceur.reglages.maj.visible'  = 'Show the window while updating'
    'lanceur.reglages.maj.silence'  = 'Update silently, with no window'
    'lanceur.reglages.maj.note'     = 'A repeated failure still speaks up.'
    # Developer mode: moved from the editor's settings form (same labels), applies
    # to the whole computer.
    'lanceur.reglages.dev'          = 'Developer mode (test folders)'
    'lanceur.reglages.dev.oui'      = 'On'
    'lanceur.reglages.dev.non'      = 'Off'
    'lanceur.reglages.dev.note'     = 'Lists follow the next time it opens.'
    # “Log” tab: the last ten updates and their outcome.
    'lanceur.journal'                  = 'Log'
    'lanceur.journal.liste'            = 'Last ten updates:'
    'lanceur.journal.vide'             = 'No update recorded.'
    'lanceur.journal.entree'           = '{0}    {1}    ({2} kB)'
    'lanceur.journal.ok'               = 'succeeded'
    'lanceur.journal.echec'            = 'failed'
    'lanceur.journal.inconnu'          = 'outcome unknown'
    'lanceur.journal.choisir'          = 'Choose an update to read its log.'
    'lanceur.journal.illisible'        = 'This log could not be read: {0}'
    # “Report a problem” button: sends support a structured report with the chosen log.
    'lanceur.journal.signaler'         = 'Report a problem…'
    'lanceur.journal.signaler.titre'   = 'Report a problem'
    'lanceur.journal.signaler.quoi'    = 'In one sentence: what happened?'
    'lanceur.journal.signaler.fait'    = 'The report has gone off, with the chosen log.'
    'lanceur.journal.signaler.attente' = 'The report will go off as soon as the SharePoint folder can be reached again.'
    'lanceur.journal.signaler.refuse'  = 'The report could not be saved. The computer’’s log says why.'
    # “Send the logs” button: gathers the logs into an archive, opens a draft e-mail,
    # and shows the archive in Explorer (mailto cannot carry an attachment).
    'lanceur.journal.envoyer'          = 'Send the logs…'
    'lanceur.journal.envoyer.fait'     = 'The logs are gathered in “{0}”, which Explorer has just opened. A draft e-mail to support is open: drag the file into it before sending.'
    'lanceur.journal.envoyer.erreur'   = 'The logs could not be gathered: {0}'
    'lanceur.choisir.livre'        = 'Choose the book to open:'
    'lanceur.vide.livre'           = 'No book on this computer yet — use “New book…” to get started.'
    'lanceur.nouvelle.livre'       = 'New book…'
    'lanceur.test.livre'           = 'Book in: {0}'
    'lanceur.modifie.livre'        = '{0}    (modified on {1})'
    'lanceur.vide.archives.livre'  = 'No archived book.'
    'lanceur.nouvelle.livre.titre'      = 'Title:'
    'lanceur.nouvelle.livre.reference'  = 'B reference:'
    'lanceur.nouvelle.livre.type'       = 'Type:'
    'lanceur.nouvelle.livre.type.mono'      = 'Monograph'
    'lanceur.nouvelle.livre.type.collectif' = 'Edited volume'
    'lanceur.nouvelle.livre.maquette'        = 'Layout:'
    'lanceur.nouvelle.livre.maquette.normal' = 'Normal'
    'lanceur.nouvelle.livre.maquette.falc'   = 'FALC'
    'lanceur.nouvelle.livre.format'          = 'Format:'
    'lanceur.nouvelle.livre.format.standard' = 'Standard (155 × 225 mm)'
    'lanceur.nouvelle.livre.format.a4'       = 'A4 (210 × 297 mm)'
    'lanceur.nouvelle.livre.titre.manque'    = 'The book’’s title is needed to create its folder.'
    'lanceur.nouvelle.livre.doublon'         = "Reference B{0} already exists — that is the book {1}, here:`n{2}"
    'lanceur.nouvelle.livre.doublon.arch'    = 'That book is archived — an archived book is still a published book.'
    'lanceur.nouvelle.livre.doublon.suite'   = 'Two books cannot carry the same B reference. Delete the existing one first, then create this one again.'
    'lanceur.nouvelle.livre.erreur'          = "Creating the book failed:`n{0}"
    # Asking for the shared SharePoint folder (anchor) when nothing was found automatically --
    # szh-ancrage.ps1, Resolve-SzhAncrage/Request-SzhAncrageUtilisateur.
    'ancrage.demande.titre' = 'Shared SharePoint folder not found'
    'ancrage.demande.texte' = 'The tool could not automatically find the shared SharePoint folder for journals and books. Pick a folder that is inside it, or that contains the "Daten_Allgemein - General" folder.'
    'ancrage.demande.echec' = 'This folder does not lead to the shared folder being searched for: one named "Daten_Allgemein - General", below the folder you picked or above it. Choose another folder.'
    'ancrage.abandon'       = 'The shared SharePoint folder could not be linked: journals and books will stay unreachable on this computer until it is. The request comes back the next time the Pronto launcher is opened, after 24 hours. For earlier help: {0}'
    # Launcher info line (open-produit.ps1) when the anchor is still missing after
    # Initialize-SzhAncrage: says why the list stays empty.
    'lanceur.ancrage.absent' = 'Shared SharePoint folder not found: the list will stay empty until it is linked.'
    # "Export and secretariat" tab: four exports driven by secretariat-cli.js
    # (Invoke-SzhSecretariat, open-produit.ps1). Filter, progress bar and Interrupt
    # button: see the comments ahead of their code block in open-produit.ps1.
    'lanceur.secretariat'                           = 'Export and secretariat'
    'lanceur.secretariat.intro'                     = 'Choose one or more issues below, then an export.'
    'lanceur.secretariat.filtre'                    = 'Show:'
    'lanceur.secretariat.liste.entree'              = '{0}    {1}    {2}'
    'lanceur.secretariat.newsletter'                = 'Newsletter and authors…'
    'lanceur.secretariat.newsletter.manque'         = 'First choose an issue in the list.'
    'lanceur.secretariat.edudoc'                    = 'Edudoc export (CSV)…'
    'lanceur.secretariat.caracteres'                = 'Characters per article (CSV)…'
    'lanceur.secretariat.metadonnees'               = 'Metadata check…'
    'lanceur.secretariat.metadonnees.manque'        = 'Choose at least one issue in the list.'
    'lanceur.secretariat.dossier'                   = 'Open the folder'
    'lanceur.secretariat.dossier.demande'           = 'Choose the destination folder:'
    'lanceur.secretariat.export.titre.edudoc'       = 'Edudoc export'
    'lanceur.secretariat.export.titre.caracteres'   = 'Characters per article'
    'lanceur.secretariat.export.titre.newsletter'   = 'Newsletter and authors'
    'lanceur.secretariat.export.titre.metadonnees'  = 'Metadata check'
    'lanceur.secretariat.export.titre.chargement'   = 'Loading the issues'
    'lanceur.secretariat.export.revue'              = 'Export for: {0}'
    'lanceur.secretariat.export.charger'            = 'Load the issues from {0}'
    'lanceur.secretariat.export.charger.plus'       = 'Also load {0}'
    'lanceur.secretariat.export.instructions'       = 'Check the issues to include:'
    'lanceur.secretariat.export.aucun'              = 'No issue could be loaded.'
    'lanceur.secretariat.export.fincourse'          = 'Nothing older to load.'
    'lanceur.secretariat.resultat.ok'               = '✓ {0}'
    'lanceur.secretariat.resultat.echec'            = '⚠ {0}'
    'lanceur.secretariat.resultat.enregistre'       = 'Saved to {0}. Click “Open the folder” to see them.'
    'lanceur.secretariat.echec.inconnu'             = 'Reason unknown.'
    'lanceur.secretariat.erreur'                    = 'Error: {0}'
    'lanceur.secretariat.interrompu'                = 'Export interrupted.'
    'lanceur.secretariat.interrompre'               = 'Interrupt'
    'lanceur.secretariat.journal.entete'            = '[{0}] {1}'
    'lanceur.secretariat.outil.absent'              = 'The secretariat tool (secretariat-cli.js) could not be found in the cockpit extension on this computer. Reinstall or update the tool, then try again.'
  }
}
