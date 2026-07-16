// SZH — Revue (cockpit), tranches S2 + S3 + S4 (D36).
// Barre latérale « Revue SZH » (dans l'Explorateur, cf. S2.1) : deux sections —
// « Articles » (articles/<slug>/<slug>.md, clic = ouvrir ; actions inline
// « Ouvrir le PDF » et « Compiler ») et « Word en attente » (articles-word/*.docx
// hors _convertis/ ; compte affiché dans la description de la section ; tooltip
// « déjà converti » si le .md cible existe). La vue n'apparaît que si ausgabe.yaml
// existe à la racine (contexte szh.estRevue).
//
// S3 : commande « Importer des Word » (szh.importerWord).
// S4 puis N5 (D46) : le CLIC sur un article fait tout — ouvre le .md (colonne 1),
//   compile si le PDF est obsolète (mtime) ou absent, ferme l'aperçu de l'article
//   précédent et affiche le sien (colonne 2, pdf.preview, preserveFocus). Les
//   boutons « Ouvrir le PDF » / « Compiler » de S4 sont supprimés. Jamais de vol
//   de focus. szh-apercu reste en place (rafraîchissement après Ctrl+S).
// G1 (D37) : formulaire « Méta-données du numéro » (webview szh.metadonnees) qui
//   réécrit ausgabe.yaml — sérialiseur maison, lignes non gérées préservées,
//   écriture atomique.
// G3 (D40) : « Supprimer l'article » (szh.supprimerArticle) — confirmation MODALE
//   obligatoire, puis rm de articles/<slug>/ ET out/<slug>/ (onglets fermés avant).
// G5 (D41) : article dépliable -> ses images (articles/<slug>/media/, récursif)
//   avec dimensions + poids ; clic = aperçu natif ; « Remplacer » (szh.remplacerAsset)
//   écrase l'image EN GARDANT son nom (le lien du .md reste valide).
// N1 (D42) : dormant WSL (sleep infinity dans SZH-Publishing) tant qu'une revue est
//   ouverte — pas de démarrage à froid à la première compilation.
//
// Écritures autorisées : la COPIE des .docx choisis vers articles-word/ (S3),
// ausgabe.yaml (G1), la SUPPRESSION confirmée d'un article (G3) et l'ÉCRASEMENT
// confirmé d'une image (G5). Tout le reste est en lecture seule (ouverture/
// lancement de tâche uniquement).
// Posture szh-apercu : JavaScript pur, zéro dépendance, API VS Code ^1.75.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CLE_CONTEXTE = 'szh.estRevue';
const ID_VUE = 'szhCockpitVue';
// ⚠ Doivent correspondre EXACTEMENT aux labels de vscodium-user/tasks.json.
const NOM_TACHE_IMPORT = 'Importer les articles Word';
const NOM_TACHE_BUILD = 'Aperçu / Export PDF';
const NOM_TACHE_EXPORT = 'Tout exporter';

// ---- i18n du cockpit (M4, D52) ------------------------------------------------------
//
// Toutes les chaînes VISIBLES passent par T(clé[, args]). Langue : réglage
// szh.langue (fr/de) s'il est défini, sinon la langue de VSCodium (de -> de,
// tout le reste -> fr). Les traductions DE sont un premier jet à valider.
// Les titres de commandes de package.json passent par %clé% + package.nls*.json
// (résolus par VSCodium selon SA langue d'interface, pas szh.langue).

const TEXTES_COCKPIT = {
  fr: {
    'arbre.articles': 'Articles',
    'arbre.word': 'Word en attente',
    'arbre.vide.articles': 'Aucun article pour l’instant',
    'arbre.vide.word': 'Aucun Word en attente',
    'arbre.deja.badge': 'déjà converti',
    'arbre.deja.tooltip': 'Déjà converti — renommez le fichier si c’est une nouvelle version.',
    'arbre.word.tooltip': 'Word en attente d’import : {0}',
    'arbre.table.tooltip': '{0} — clic = éditer le HTML du tableau',
    'arbre.titre.defaut': 'Revue SZH',
    'statut.build.encours': 'Compilation déjà en cours…',
    'statut.build.de': 'Compilation de « {0} »…',
    'statut.import.encours': 'Import déjà en cours…',
    'statut.import': 'Import des Word en attente…',
    'statut.export': 'Export complet de la revue…',
    'statut.occupe': 'Compilation ou import en cours — réessayez ensuite.',
    'statut.supprime': 'Article « {0} » supprimé.',
    'statut.image.remplacee': 'Image « {0} » remplacée — recompilez pour voir le PDF à jour.',
    'statut.table.remplacee': 'Tableau « {0} » remplacé — recompilez pour voir le PDF à jour.',
    'statut.table.enregistree': 'Tableau « {0} » enregistré — recompilez (cliquez l’article) pour voir le PDF à jour.',
    'statut.ausgabe': 'ausgabe.yaml enregistré.',
    'statut.fiches': '{0} fiche(s) de métadonnées enregistrée(s).',
    'err.tache': 'Tâche « {0} » introuvable. Réglages de l’éditeur incomplets ?',
    'err.build': 'La compilation a échoué. Ouvrez le panneau « {0} » pour le détail.',
    'err.import': 'L’import a rencontré un problème. Ouvrez le panneau de la tâche « {0} » pour le détail.',
    'err.export': 'L’export complet a échoué. Ouvrez le panneau « {0} » pour le détail.',
    'err.pdf.introuvable': 'PDF introuvable après compilation : « {0} ».',
    'err.suppression': 'Suppression incomplète de « {0} » : {1}',
    'err.copie': 'Copie impossible : {0} ({1})',
    'err.remplacement': 'Remplacement impossible : {0}',
    'err.ecriture': 'Écriture impossible : {0}',
    'info.importes.un': '1 article importé.',
    'info.importes': '{0} articles importés.',
    'info.importes.aucun': 'Aucun nouvel article importé (déjà présent(s) ?).',
    'info.exportes.un': '1 article exporté.',
    'info.exportes': '{0} articles exportés.',
    'info.pdf.externe': 'Aperçu PDF intégré indisponible — ouverture dans le lecteur système.',
    'info.redemarrer': 'Langue de l’interface enregistrée — redémarrez VSCodium pour appliquer les menus natifs.',
    'modale.supprimer.question': 'Supprimer l’article « {0} » et son PDF ?',
    'modale.supprimer.detail': 'Les dossiers articles/{0} et out/{0} seront définitivement effacés.\nAction irréversible.',
    'modale.supprimer.bouton': 'Supprimer',
    'modale.remplacer.question': 'Remplacer « {0} » par « {1} » ?',
    'modale.remplacer.detail.image': 'L’ancienne image sera écrasée. Le nom « {0} » est conservé (le texte de l’article pointe ce nom).',
    'modale.remplacer.detail.format': '⚠ Le fichier choisi est un .{0} mais l’image de l’article est un .{1} : le contenu ne correspondra plus à l’extension et le rendu peut casser.\n',
    'modale.remplacer.detail.table': 'L’ancien tableau sera écrasé. Le nom « {0} » est conservé (l’article pointe ce nom).',
    'modale.remplacer.bouton': 'Remplacer',
    'modale.conflit.question': 'Ces fichiers sont déjà en attente : {0}.\nQue faire ?',
    'modale.conflit.ignorer': 'Ignorer ces fichiers',
    'dial.importer.titre': 'Choisir les fichiers Word à importer',
    'dial.importer.bouton': 'Importer',
    'dial.importer.filtre': 'Documents Word',
    'dial.image.titre': 'Choisir l’image de remplacement pour « {0} »',
    'dial.image.bouton': 'Choisir cette image',
    'dial.image.filtre': 'Images',
    'dial.table.titre': 'Choisir le fichier HTML de remplacement pour « {0} »',
    'dial.table.bouton': 'Choisir ce tableau',
    'dial.table.filtre': 'Tableaux HTML',
    'meta.titre': 'Méta-données du numéro',
    'meta.note': 'Enregistrées dans ausgabe.yaml — seuls les champs modifiés sont réécrits, le reste du fichier est préservé.',
    'meta.title': 'Titre du dossier thématique',
    'meta.revue': 'Nom de la revue',
    'meta.volume': 'Volume',
    'meta.numero': 'Numéro',
    'meta.date': 'Date de publication',
    'meta.date.indice': 'Valeur actuelle dans le fichier : « {0} » — choisir une date la remplacera.',
    'meta.langue': 'Langue du numéro',
    'meta.langue.aucune': '(non définie)',
    'meta.langue.fr': 'français',
    'meta.langue.de': 'allemand',
    'meta.langue.en': 'anglais',
    'meta.langue.it': 'italien',
    'meta.couleur': 'Couleur du numéro',
    'meta.couleur.aucune': '(aucune)',
    'meta.couleur.rouge': 'Rouge',
    'meta.couleur.capucine': 'Capucine',
    'meta.couleur.moutarde': 'Moutarde',
    'meta.couleur.poireau': 'Poireau',
    'meta.couleur.bleuacier': 'Bleu acier',
    'meta.couleur.mountbatten': 'Mountbatten',
    'form.enregistrer': 'Enregistrer',
    'form.rien': 'Aucune modification.',
    'form.enregistre': '✓ Enregistré',
    'fiches.titre': 'Métadonnées des articles',
    'fiches.note': 'Enregistrées dans la fiche de l’article (fichier caché, édité par ce formulaire uniquement) — seuls les articles modifiés (●) sont réécrits. Le texte de l’article n’est jamais touché.',
    'fiches.enregistre': '✓ {0} article(s) enregistré(s)',
    'fiches.type': 'Type d’article',
    'fiches.type.aucun': '(non défini)',
    'fiches.titre.champ': 'Titre ({0})',
    'fiches.soustitre': 'Sous-titre ({0})',
    'fiches.resume': 'Résumé ({0})',
    'fiches.auteurs': 'Auteur(s) — prénom, nom, fonction, affiliation, ORCID',
    'fiches.auteur.ajouter': '➕ Ajouter un auteur',
    'fiches.auteur.retirer': 'Retirer cet auteur',
    'fiches.auteur.prenom': 'Prénom',
    'fiches.auteur.nom': 'Nom',
    'fiches.auteur.fonction': 'Fonction',
    'fiches.auteur.affiliation': 'Affiliation',
    'fiches.auteur.orcid': 'ORCID',
    'fiches.motscles': 'Mots-clés ({0}, séparés par des virgules)',
    'fiches.italien': ' + Italien (champs IT)',
    'fmt.titre.placeholder': 'Titre du bloc « Important »',
    'fmt.titre.libre': 'Saisir un titre personnalisé',
    'fmt.titre.information': 'Information',
    'fmt.titre.important': 'Important',
    'fmt.titre.attention': 'Attention',
    'fmt.titre.note': 'Note',
    'fmt.titre.autre': 'Autre…',
    'fmt.figure.legende': 'Légende',
    'fmt.figure.filtre': 'Images',
    'fmt.figure.titre': 'Choisir une image à insérer',
    'fmt.figure.bouton': 'Insérer cette image',
    'fmt.figure.horsarticle': 'Ouvrez d’abord un article (.md) pour insérer une figure.',
    'fmt.figure.copiee': 'Image « {0} » ajoutée à l’article.',
    'fmt.tableau.colonne': 'Colonne',
    'table.titre': 'Tableau — {0}',
    'table.aide': 'Cliquez une cellule pour l’éditer (Ctrl+B gras, Ctrl+I italique). Maj+clic = plage rectangulaire. Cliquez une poignée grise pour une ligne ou une colonne entière.',
    'table.enregistrer': 'Enregistrer',
    'table.ajouterLigne': '＋ Ligne',
    'table.supprimerLigne': '－ Ligne',
    'table.ajouterColonne': '＋ Colonne',
    'table.supprimerColonne': '－ Colonne',
    'table.fusionner': 'Fusionner',
    'table.scinder': 'Scinder',
    'table.rien': 'Sélectionnez d’abord une cellule.',
    'table.fusionImpossible': 'Pour fusionner, la sélection doit être un rectangle plein (aucune cellule ne doit dépasser).',
    'table.enregistre': '✓ Tableau enregistré',
    'table.grpStructure': 'Structure',
    'table.grpEntetes': 'En-têtes',
    'table.grpStyles': 'Styles',
    'table.entete': 'Définir comme en-tête',
    'table.enteteRetirer': 'Retirer l’en-tête',
    'table.styleEntete': 'Style d’en-tête',
    'table.styleLigne': 'En-tête (haut)',
    'table.styleColonne': 'En-tête (gauche)',
    'table.st.normal': 'Normal',
    'table.st.gras': 'Gras',
    'table.st.negatif': 'Négatif',
    'table.st.fond': 'Fond',
    'table.zebre': 'Zébrage',
    'table.zebre.non': 'Aucun',
    'table.zebre.lignes': 'Lignes',
    'table.zebre.colonnes': 'Colonnes',
    'table.teinte': 'Teinte',
    'table.teinte.gris': 'Gris',
    'table.teinte.couleur': 'Couleur',
    'table.separateurs': 'Séparateurs',
    'table.sep.non': 'Aucun',
    'table.sep.gris': 'Gris',
    'table.sep.couleur': 'Couleur',
    'table.bordureHaute': 'Bordure haute',
    'table.bordureBasse': 'Bordure basse',
    'table.oui': 'Oui',
    'table.non': 'Non',
    'table.total': 'Ligne de total',
    'table.total.non': 'Non',
    'table.total.gris': 'Total gris',
    'table.total.couleur': 'Total couleur',
    'table.total.gras': 'Gras',
    'table.accent': 'Accent (aperçu)',
    'table.accent.gris': 'Gris',
    'table.accent.couleur': 'Couleur annuelle',
    'table.accent.aucune': 'Aucune couleur annuelle définie — l’aperçu couleur retombe sur le gris (comme le PDF).',
    'regl.titre': 'Réglages SZH',
    'regl.note': 'Appliqués immédiatement, pour cet utilisateur, sur ce poste.',
    'regl.theme': 'Thème',
    'regl.theme.systeme': 'Système',
    'regl.theme.clair': 'Clair',
    'regl.theme.sombre': 'Sombre',
    'regl.zoom': 'Taille de l’interface',
    'regl.zoom.normal': 'Normale',
    'regl.zoom.grand': 'Grande',
    'regl.zoom.tresgrand': 'Très grande',
    'regl.policemd': 'Taille du texte des articles (affichage seulement)',
    'regl.langue': 'Langue de l’interface',
    'regl.langue.note': 'Les menus natifs de l’éditeur changeront au prochain redémarrage (allemand : nécessite le pack de langue déployé).',
    'apercu.barre.html': '$(preview) Aperçu : HTML',
    'apercu.barre.pdf': '$(file-pdf) Aperçu : PDF',
    'apercu.barre.tooltip': 'Basculer l’aperçu HTML ⇄ PDF (tous les articles)',
    'apercu.bandeau': 'Aperçu HTML — cliquer un passage ouvre le texte correspondant',
    'apercu.bandeau.pdf': 'Voir en PDF',
    'apercu.indisponible': 'Aperçu HTML pas encore compilé pour cet article — enregistrez (Ctrl+S) ou recompilez, puis re-cliquez l’article.'
  },
  de: {
    'arbre.articles': 'Artikel',
    'arbre.word': 'Word in Warteschlange',
    'arbre.vide.articles': 'Noch keine Artikel',
    'arbre.vide.word': 'Kein Word in Warteschlange',
    'arbre.deja.badge': 'bereits konvertiert',
    'arbre.deja.tooltip': 'Bereits konvertiert — Datei umbenennen, falls es eine neue Version ist.',
    'arbre.word.tooltip': 'Word wartet auf Import: {0}',
    'arbre.table.tooltip': '{0} — Klick = HTML der Tabelle bearbeiten',
    'arbre.titre.defaut': 'Zeitschrift SZH',
    'statut.build.encours': 'Kompilierung läuft bereits…',
    'statut.build.de': 'Kompilierung von « {0} »…',
    'statut.import.encours': 'Import läuft bereits…',
    'statut.import': 'Import der wartenden Word-Dateien…',
    'statut.export': 'Vollständiger Export der Zeitschrift…',
    'statut.occupe': 'Kompilierung oder Import läuft — bitte danach erneut versuchen.',
    'statut.supprime': 'Artikel « {0} » gelöscht.',
    'statut.image.remplacee': 'Bild « {0} » ersetzt — neu kompilieren, um das PDF zu aktualisieren.',
    'statut.table.remplacee': 'Tabelle « {0} » ersetzt — neu kompilieren, um das PDF zu aktualisieren.',
    'statut.table.enregistree': 'Tabelle « {0} » gespeichert — neu kompilieren (Artikel anklicken), um das PDF zu aktualisieren.',
    'statut.ausgabe': 'ausgabe.yaml gespeichert.',
    'statut.fiches': '{0} Metadaten-Datei(en) gespeichert.',
    'err.tache': 'Aufgabe « {0} » nicht gefunden. Editor-Einstellungen unvollständig?',
    'err.build': 'Die Kompilierung ist fehlgeschlagen. Öffnen Sie das Panel « {0} » für Details.',
    'err.import': 'Beim Import ist ein Problem aufgetreten. Öffnen Sie das Panel der Aufgabe « {0} » für Details.',
    'err.export': 'Der vollständige Export ist fehlgeschlagen. Öffnen Sie das Panel « {0} » für Details.',
    'err.pdf.introuvable': 'PDF nach der Kompilierung nicht gefunden: « {0} ».',
    'err.suppression': 'Unvollständige Löschung von « {0} »: {1}',
    'err.copie': 'Kopieren nicht möglich: {0} ({1})',
    'err.remplacement': 'Ersetzen nicht möglich: {0}',
    'err.ecriture': 'Schreiben nicht möglich: {0}',
    'info.importes.un': '1 Artikel importiert.',
    'info.importes': '{0} Artikel importiert.',
    'info.importes.aucun': 'Kein neuer Artikel importiert (bereits vorhanden?).',
    'info.exportes.un': '1 Artikel exportiert.',
    'info.exportes': '{0} Artikel exportiert.',
    'info.pdf.externe': 'Integrierte PDF-Vorschau nicht verfügbar — Öffnen im System-Viewer.',
    'info.redemarrer': 'Oberflächensprache gespeichert — VSCodium neu starten, um die nativen Menüs anzuwenden.',
    'modale.supprimer.question': 'Artikel « {0} » und sein PDF löschen?',
    'modale.supprimer.detail': 'Die Ordner articles/{0} und out/{0} werden endgültig gelöscht.\nDies kann nicht rückgängig gemacht werden.',
    'modale.supprimer.bouton': 'Löschen',
    'modale.remplacer.question': '« {0} » durch « {1} » ersetzen?',
    'modale.remplacer.detail.image': 'Das alte Bild wird überschrieben. Der Name « {0} » bleibt erhalten (der Artikeltext verweist auf diesen Namen).',
    'modale.remplacer.detail.format': '⚠ Die gewählte Datei ist eine .{0}, das Bild des Artikels aber eine .{1}: Inhalt und Endung passen nicht mehr zusammen, die Ausgabe kann brechen.\n',
    'modale.remplacer.detail.table': 'Die alte Tabelle wird überschrieben. Der Name « {0} » bleibt erhalten (der Artikel verweist auf diesen Namen).',
    'modale.remplacer.bouton': 'Ersetzen',
    'modale.conflit.question': 'Diese Dateien warten bereits: {0}.\nWas tun?',
    'modale.conflit.ignorer': 'Diese Dateien überspringen',
    'dial.importer.titre': 'Word-Dateien zum Import auswählen',
    'dial.importer.bouton': 'Importieren',
    'dial.importer.filtre': 'Word-Dokumente',
    'dial.image.titre': 'Ersatzbild für « {0} » auswählen',
    'dial.image.bouton': 'Dieses Bild wählen',
    'dial.image.filtre': 'Bilder',
    'dial.table.titre': 'HTML-Ersatzdatei für « {0} » auswählen',
    'dial.table.bouton': 'Diese Tabelle wählen',
    'dial.table.filtre': 'HTML-Tabellen',
    'meta.titre': 'Metadaten der Ausgabe',
    'meta.note': 'In ausgabe.yaml gespeichert — nur geänderte Felder werden neu geschrieben, der Rest der Datei bleibt erhalten.',
    'meta.title': 'Titel des Themenschwerpunkts',
    'meta.revue': 'Name der Zeitschrift',
    'meta.volume': 'Band',
    'meta.numero': 'Nummer',
    'meta.date': 'Erscheinungsdatum',
    'meta.date.indice': 'Aktueller Wert in der Datei: « {0} » — die Wahl eines Datums ersetzt ihn.',
    'meta.langue': 'Sprache der Ausgabe',
    'meta.langue.aucune': '(nicht festgelegt)',
    'meta.langue.fr': 'Französisch',
    'meta.langue.de': 'Deutsch',
    'meta.langue.en': 'Englisch',
    'meta.langue.it': 'Italienisch',
    'meta.couleur': 'Farbe der Ausgabe',
    'meta.couleur.aucune': '(keine)',
    'meta.couleur.rouge': 'Rot',
    'meta.couleur.capucine': 'Kapuzinerkresse',
    'meta.couleur.moutarde': 'Senfgelb',
    'meta.couleur.poireau': 'Lauchgrün',
    'meta.couleur.bleuacier': 'Stahlblau',
    'meta.couleur.mountbatten': 'Mountbatten-Rosa',
    'form.enregistrer': 'Speichern',
    'form.rien': 'Keine Änderung.',
    'form.enregistre': '✓ Gespeichert',
    'fiches.titre': 'Metadaten der Artikel',
    'fiches.note': 'In der Artikel-Karteikarte gespeichert (versteckte Datei, nur über dieses Formular bearbeitet) — nur geänderte Artikel (●) werden neu geschrieben. Der Artikeltext wird nie verändert.',
    'fiches.enregistre': '✓ {0} Artikel gespeichert',
    'fiches.type': 'Artikeltyp',
    'fiches.type.aucun': '(nicht festgelegt)',
    'fiches.titre.champ': 'Titel ({0})',
    'fiches.soustitre': 'Untertitel ({0})',
    'fiches.resume': 'Zusammenfassung ({0})',
    'fiches.auteurs': 'Autor(en) — Vorname, Name, Funktion, Affiliation, ORCID',
    'fiches.auteur.ajouter': '➕ Autor hinzufügen',
    'fiches.auteur.retirer': 'Diesen Autor entfernen',
    'fiches.auteur.prenom': 'Vorname',
    'fiches.auteur.nom': 'Name',
    'fiches.auteur.fonction': 'Funktion',
    'fiches.auteur.affiliation': 'Affiliation',
    'fiches.auteur.orcid': 'ORCID',
    'fiches.motscles': 'Schlagwörter ({0}, durch Kommas getrennt)',
    'fiches.italien': ' + Italienisch (IT-Felder)',
    'fmt.titre.placeholder': 'Titel des Blocks « Wichtig »',
    'fmt.titre.libre': 'Eigenen Titel eingeben',
    'fmt.titre.information': 'Information',
    'fmt.titre.important': 'Wichtig',
    'fmt.titre.attention': 'Achtung',
    'fmt.titre.note': 'Hinweis',
    'fmt.titre.autre': 'Andere…',
    'fmt.figure.legende': 'Bildunterschrift',
    'fmt.figure.filtre': 'Bilder',
    'fmt.figure.titre': 'Bild zum Einfügen auswählen',
    'fmt.figure.bouton': 'Dieses Bild einfügen',
    'fmt.figure.horsarticle': 'Öffnen Sie zuerst einen Artikel (.md), um eine Abbildung einzufügen.',
    'fmt.figure.copiee': 'Bild « {0} » zum Artikel hinzugefügt.',
    'fmt.tableau.colonne': 'Spalte',
    'table.titre': 'Tabelle — {0}',
    'table.aide': 'Klicken Sie eine Zelle zum Bearbeiten (Ctrl+B fett, Ctrl+I kursiv). Umschalt+Klick = rechteckiger Bereich. Klicken Sie einen grauen Griff für eine ganze Zeile oder Spalte.',
    'table.enregistrer': 'Speichern',
    'table.ajouterLigne': '＋ Zeile',
    'table.supprimerLigne': '－ Zeile',
    'table.ajouterColonne': '＋ Spalte',
    'table.supprimerColonne': '－ Spalte',
    'table.fusionner': 'Verbinden',
    'table.scinder': 'Teilen',
    'table.rien': 'Wählen Sie zuerst eine Zelle aus.',
    'table.fusionImpossible': 'Zum Verbinden muss die Auswahl ein volles Rechteck sein (keine Zelle darf herausragen).',
    'table.enregistre': '✓ Tabelle gespeichert',
    'table.grpStructure': 'Struktur',
    'table.grpEntetes': 'Überschriften',
    'table.grpStyles': 'Stile',
    'table.entete': 'Als Überschrift festlegen',
    'table.enteteRetirer': 'Überschrift entfernen',
    'table.styleEntete': 'Überschriftenstil',
    'table.styleLigne': 'Überschrift (oben)',
    'table.styleColonne': 'Überschrift (links)',
    'table.st.normal': 'Normal',
    'table.st.gras': 'Fett',
    'table.st.negatif': 'Negativ',
    'table.st.fond': 'Hintergrund',
    'table.zebre': 'Zebrastreifen',
    'table.zebre.non': 'Keine',
    'table.zebre.lignes': 'Zeilen',
    'table.zebre.colonnes': 'Spalten',
    'table.teinte': 'Tönung',
    'table.teinte.gris': 'Grau',
    'table.teinte.couleur': 'Farbe',
    'table.separateurs': 'Trennlinien',
    'table.sep.non': 'Keine',
    'table.sep.gris': 'Grau',
    'table.sep.couleur': 'Farbe',
    'table.bordureHaute': 'Obere Linie',
    'table.bordureBasse': 'Untere Linie',
    'table.oui': 'Ja',
    'table.non': 'Nein',
    'table.total': 'Summenzeile',
    'table.total.non': 'Nein',
    'table.total.gris': 'Summe grau',
    'table.total.couleur': 'Summe farbig',
    'table.total.gras': 'Fett',
    'table.accent': 'Akzent (Vorschau)',
    'table.accent.gris': 'Grau',
    'table.accent.couleur': 'Jahresfarbe',
    'table.accent.aucune': 'Keine Jahresfarbe festgelegt — die Farbvorschau fällt auf Grau zurück (wie das PDF).',
    'regl.titre': 'SZH-Einstellungen',
    'regl.note': 'Werden sofort angewendet, für diese Benutzerin / diesen Benutzer, auf diesem Computer.',
    'regl.theme': 'Design',
    'regl.theme.systeme': 'System',
    'regl.theme.clair': 'Hell',
    'regl.theme.sombre': 'Dunkel',
    'regl.zoom': 'Grösse der Oberfläche',
    'regl.zoom.normal': 'Normal',
    'regl.zoom.grand': 'Gross',
    'regl.zoom.tresgrand': 'Sehr gross',
    'regl.policemd': 'Textgrösse der Artikel (nur Anzeige)',
    'regl.langue': 'Sprache der Oberfläche',
    'regl.langue.note': 'Die nativen Menüs des Editors ändern sich beim nächsten Neustart (Deutsch: erfordert das installierte Sprachpaket).',
    'apercu.barre.html': '$(preview) Vorschau: HTML',
    'apercu.barre.pdf': '$(file-pdf) Vorschau: PDF',
    'apercu.barre.tooltip': 'Vorschau HTML ⇄ PDF umschalten (alle Artikel)',
    'apercu.bandeau': 'HTML-Vorschau — ein Klick auf eine Stelle öffnet den zugehörigen Text',
    'apercu.bandeau.pdf': 'Als PDF anzeigen',
    'apercu.indisponible': 'HTML-Vorschau für diesen Artikel noch nicht kompiliert — speichern (Ctrl+S) oder neu kompilieren, dann den Artikel erneut anklicken.'
  }
};

function langueCockpit() {
  let choix = '';
  try { choix = String(vscode.workspace.getConfiguration('szh').get('langue', '') || ''); }
  catch (e) { /* configuration indisponible : repli env */ }
  if (choix === 'fr' || choix === 'de') { return choix; }
  const env = String((vscode.env && vscode.env.language) || 'fr').toLowerCase();
  return env.indexOf('de') === 0 ? 'de' : 'fr';
}

// T('clé', [args]) -> texte dans la langue du cockpit, repli fr, sinon la clé.
// Les {0} {1} … sont substitués par les args.
function T(cle, args) {
  const langue = langueCockpit();
  let texte = (TEXTES_COCKPIT[langue] && TEXTES_COCKPIT[langue][cle]);
  if (texte === undefined) { texte = TEXTES_COCKPIT.fr[cle]; }
  if (texte === undefined) { return cle; }
  if (args) {
    for (let i = 0; i < args.length; i++) { texte = texte.split('{' + i + '}').join(String(args[i])); }
  }
  return texte;
}
// Éditeur PDF (extension tomoki1207.pdf), comme szh-apercu.
const VUE_PDF = 'pdf.preview';
const EXT_PDF = 'tomoki1207.pdf';

// Reproduit le slug du Makefile (cible import) :
//   nom sans extension | iconv ASCII//TRANSLIT | minuscules | [^a-z0-9]+ -> '-' | trim '-'
// En JS sans iconv : on translittère les ligatures françaises courantes puis on
// supprime les diacritiques (NFD). Divergence connue (rare) : un symbole exotique
// qu'iconv//TRANSLIT convertirait en mot précis devient ici un tiret — sans effet
// visible sur des titres d'articles réels (accents et ligatures usuels couverts).
function slugifier(nomFichier) {
  let s = nomFichier.replace(/\.[^.]*$/, '');
  s = s
    .replace(/[œŒ]/g, 'oe').replace(/[æÆ]/g, 'ae').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'article';
}

// ---- Maintien en vie de WSL (N1, D42) ---------------------------------------------
//
// Les builds sont des `wsl.exe` éphémères : entre deux Ctrl+S la VM WSL s'éteint
// (vmIdleTimeout) et la compilation suivante paie un démarrage à froid. Tant qu'une
// revue est ouverte, on maintient un processus DORMANT dans la distro du pipeline —
// il ne consomme rien et empêche l'extinction de la VM. Tué quand on quitte la
// revue, à la désactivation, et de toute façon nettoyé par un `wsl --shutdown`/reboot.

// ⚠ Doit correspondre à la distro de vscodium-user/tasks.json et szh-common.ps1.
const DISTRO = 'SZH-Publishing';

let dormeurWsl = null;

// wsl.exe : System32 en priorité (chemin sûr), PATH en repli.
function cheminWsl() {
  const systeme = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'wsl.exe');
  try { if (fs.existsSync(systeme)) { return systeme; } } catch (e) { /* PATH en repli */ }
  return 'wsl.exe';
}

function demarrerDormeurWsl() {
  if (dormeurWsl) { return; }                      // un seul dormant à la fois
  let proc;
  try {
    proc = spawn(cheminWsl(), ['-d', DISTRO, '--', 'sh', '-c', 'exec sleep infinity'],
      { windowsHide: true, stdio: 'ignore' });
  } catch (e) { return; }                          // wsl introuvable : poste non bootstrappé
  dormeurWsl = proc;
  // Distro absente ou wsl en erreur : silencieux (l'activation ne doit jamais être
  // bloquée ni bruyante) ; on retentera au prochain changement de contexte.
  proc.on('error', () => { if (dormeurWsl === proc) { dormeurWsl = null; } });
  proc.on('exit', () => { if (dormeurWsl === proc) { dormeurWsl = null; } });
}

function arreterDormeurWsl() {
  if (!dormeurWsl) { return; }
  const proc = dormeurWsl;
  dormeurWsl = null;                               // avant kill : l'écouteur exit ne re-nettoie pas
  try { proc.kill(); } catch (e) { /* déjà mort */ }
}

// Racine de revue = premier dossier du workspace contenant ausgabe.yaml (D22),
// ou null si aucun (dossier quelconque -> la vue reste masquée).
function trouverRacineRevue() {
  const dossiers = vscode.workspace.workspaceFolders;
  if (!dossiers) { return null; }
  for (const d of dossiers) {
    try {
      if (fs.existsSync(path.join(d.uri.fsPath, 'ausgabe.yaml'))) { return d.uri.fsPath; }
    } catch (e) { /* dossier illisible : on continue */ }
  }
  return null;
}

class FournisseurRevue {
  constructor() {
    this.racine = null;
    this._changement = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._changement.event;
  }

  definirRacine(racine) { this.racine = racine; }
  rafraichir() { this._changement.fire(); }

  getTreeItem(element) { return element; }

  getChildren(element) {
    if (!this.racine) { return []; }
    if (!element) {
      // Compte des Word en attente dans la DESCRIPTION de la section (S4) : le badge
      // de conteneur n'est plus visible depuis que la vue est dans l'Explorateur (S2.1).
      const n = this.compterWord();
      return [
        this._section('articles', T('arbre.articles'), 'book', undefined),
        this._section('word', T('arbre.word'), 'inbox', n > 0 ? '(' + n + ')' : undefined)
      ];
    }
    if (element.categorie === 'articles') { return this._itemsArticles(); }
    if (element.categorie === 'word') { return this._itemsWord(); }
    if (element.contextValue === 'article') { return this._itemsAssets(element.slug); }
    return [];
  }

  _section(categorie, libelle, icone, description) {
    const it = new vscode.TreeItem(libelle, vscode.TreeItemCollapsibleState.Expanded);
    it.categorie = categorie;
    it.iconPath = new vscode.ThemeIcon(icone);
    it.contextValue = 'section-' + categorie;   // 'section-articles' / 'section-word'
    if (description) { it.description = description; }
    return it;
  }

  // Article = dossier articles/<slug>/ contenant le .md homonyme <slug>.md
  // (même règle que le Makefile : un dossier sans .md homonyme est ignoré).
  // G5/N6 : l'article est DÉPLIABLE s'il a des images OU des tableaux (la flèche
  // montre les assets, le clic sur le libellé ouvre l'article — risque R2).
  _itemsArticles() {
    const base = path.join(this.racine, 'articles');
    const slugs = this._sousDossiersAvecMd(base);
    if (slugs.length === 0) { return [this._vide(T('arbre.vide.articles'))]; }
    return slugs.map((slug) => {
      const md = vscode.Uri.file(path.join(base, slug, slug + '.md'));
      const aDesAssets = this._imagesArticle(slug).length > 0 || this._tablesArticle(slug).length > 0;
      const it = new vscode.TreeItem(slug, aDesAssets
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None);
      it.slug = slug;                   // utilisé par les actions S4/G3/G5
      it.resourceUri = md;              // icône de fichier selon le thème
      it.tooltip = md.fsPath;
      it.contextValue = 'article';      // pilote les boutons inline (menus view/item/context)
      // N5 (D46) : le clic fait tout — .md en colonne 1, build si obsolète,
      // aperçu en colonne 2 (l'aperçu du précédent article est fermé).
      it.command = {
        command: 'szh.ouvrirArticle', title: 'Ouvrir l’article',
        arguments: [slug]
      };
      return it;
    });
  }

  // Images d'un article : articles/<slug>/media/, récursif, extensions d'image
  // seulement. Chemins RELATIFS à media/ (lisibles en libellé), triés.
  _imagesArticle(slug) {
    const base = path.join(this.racine, 'articles', slug, 'media');
    const resultats = [];
    const parcourir = (dossier, prefixe) => {
      let entrees;
      try { entrees = fs.readdirSync(dossier, { withFileTypes: true }); }
      catch (e) { return; }
      for (const e of entrees) {
        if (e.isDirectory()) { parcourir(path.join(dossier, e.name), prefixe + e.name + '/'); }
        else if (e.isFile() && /\.(png|jpe?g|gif|svg)$/i.test(e.name)) { resultats.push(prefixe + e.name); }
      }
    };
    parcourir(base, '');
    return resultats.sort((a, b) => a.localeCompare(b, 'fr'));
  }

  // Tableaux extraits d'un article (N6, D47) : tables/*.html, triés.
  _tablesArticle(slug) {
    const base = path.join(this.racine, 'articles', slug, 'tables');
    let entrees;
    try { entrees = fs.readdirSync(base, { withFileTypes: true }); }
    catch (e) { return []; }
    return entrees
      .filter((e) => e.isFile() && /\.html?$/i.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'fr'));
  }

  // Enfants d'un article : images (G5, « L × H · poids ») puis tableaux (N6).
  _itemsAssets(slug) {
    const base = path.join(this.racine, 'articles', slug, 'media');
    const images = this._imagesArticle(slug).map((relatif) => {
      const chemin = path.join(base, relatif);
      const it = new vscode.TreeItem(relatif, vscode.TreeItemCollapsibleState.None);
      it.slug = slug;
      it.cheminAsset = chemin;
      it.resourceUri = vscode.Uri.file(chemin);
      it.contextValue = 'asset';
      it.description = decrireImage(chemin);
      it.tooltip = chemin;
      // Aperçu natif de VSCodium, colonne 1 (côté texte, comme le .md).
      it.command = {
        command: 'vscode.open', title: 'Aperçu de l’image',
        arguments: [it.resourceUri, { viewColumn: vscode.ViewColumn.One }]
      };
      return it;
    });
    const baseTables = path.join(this.racine, 'articles', slug, 'tables');
    const tables = this._tablesArticle(slug).map((nom) => {
      const chemin = path.join(baseTables, nom);
      const it = new vscode.TreeItem(nom, vscode.TreeItemCollapsibleState.None);
      it.slug = slug;
      it.cheminAsset = chemin;
      it.iconPath = new vscode.ThemeIcon('table');
      it.contextValue = 'table';
      it.description = decrireImage(chemin);      // pas une image : poids seul
      it.tooltip = T('arbre.table.tooltip', [chemin]);
      // Édition directe du HTML (copier-coller possible), colonne 1.
      it.command = {
        command: 'vscode.open', title: 'Ouvrir le tableau',
        arguments: [vscode.Uri.file(chemin), { viewColumn: vscode.ViewColumn.One }]
      };
      return it;
    });
    return images.concat(tables);
  }

  // Word en attente = articles-word/*.docx (niveau racine seulement -> _convertis/ exclu).
  _itemsWord() {
    const noms = this._docxEnAttente(path.join(this.racine, 'articles-word'));
    if (noms.length === 0) { return [this._vide(T('arbre.vide.word'))]; }
    return noms.map((nom) => {
      const it = new vscode.TreeItem(nom, vscode.TreeItemCollapsibleState.None);
      it.contextValue = 'word';
      if (this._articleExiste(slugifier(nom))) {
        // Le .md cible existe déjà : l'import l'ignorera (D12, non-écrasement).
        it.iconPath = new vscode.ThemeIcon('warning');
        it.description = T('arbre.deja.badge');
        it.tooltip = T('arbre.deja.tooltip');
      } else {
        it.iconPath = new vscode.ThemeIcon('file');
        it.tooltip = T('arbre.word.tooltip', [nom]);
      }
      return it;
    });
  }

  // Élément gris « rien pour l'instant » (une section vide reste visible et lisible).
  _vide(texte) {
    const it = new vscode.TreeItem(texte, vscode.TreeItemCollapsibleState.None);
    it.iconPath = new vscode.ThemeIcon('info');
    it.contextValue = 'vide';
    return it;
  }

  compterWord() {
    if (!this.racine) { return 0; }
    return this._docxEnAttente(path.join(this.racine, 'articles-word')).length;
  }

  // Liste des slugs d'articles (dossier + .md homonyme). Sert aussi au diff d'import.
  listerArticles() {
    if (!this.racine) { return []; }
    return this._sousDossiersAvecMd(path.join(this.racine, 'articles'));
  }

  _articleExiste(slug) {
    try { return fs.statSync(path.join(this.racine, 'articles', slug, slug + '.md')).isFile(); }
    catch (e) { return false; }
  }

  _sousDossiersAvecMd(base) {
    let entrees;
    try { entrees = fs.readdirSync(base, { withFileTypes: true }); }
    catch (e) { return []; }
    return entrees
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((slug) => {
        try { return fs.statSync(path.join(base, slug, slug + '.md')).isFile(); }
        catch (e) { return false; }
      })
      .sort((a, b) => a.localeCompare(b, 'fr'));
  }

  _docxEnAttente(base) {
    let entrees;
    try { entrees = fs.readdirSync(base, { withFileTypes: true }); }
    catch (e) { return []; }
    return entrees
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.docx'))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'fr'));
  }
}

// ---- PDF (S4) : ouverture calquée sur szh-apercu -------------------------------

// L'éditeur pdf.preview (tomoki1207.pdf) est MONO-INSTANCE (pas de
// supportsMultipleEditorsPerDocument) : openWith RÉVÈLE l'onglet existant sans le
// dupliquer. On appelle donc openWith même si le PDF est déjà ouvert -> « Ouvrir le
// PDF » ramène l'aperçu au premier plan. preserveFocus:true : on révèle sans voler
// le focus de l'éditeur. (C'était le rôle du test « déjà ouvert » retiré ici : il
// empêchait le rappel au premier plan sans rien apporter, l'anti-doublon étant déjà
// garanti par le mono-instance.)
async function ouvrirApercuPdf(uri) {
  if (vscode.extensions.getExtension(EXT_PDF)) {
    // Colonne 2 (droite) FIXE — pas « Beside » (relatif), qui empilait des colonnes
    // 3, 4… selon la vue active. Mise en page à deux vues : gauche = .md, droite = PDF.
    await vscode.commands.executeCommand('vscode.openWith', uri, VUE_PDF, {
      viewColumn: vscode.ViewColumn.Two,
      preserveFocus: true
    });
  } else {
    // Repli propre (hôte de dev sans tomoki1207.pdf) : lecteur système.
    vscode.window.showInformationMessage(T('info.pdf.externe'));
    await vscode.env.openExternal(uri);
  }
}

// ---- Tâche de build (S4) : réutilise la tâche user, écoute la fin ---------------

let buildEnCours = false;

// Lance une tâche user par son label exact et résout avec son code de sortie
// (null si la tâche est introuvable). Même mécanique que szh-apercu.
async function lancerTache(nomTache) {
  const taches = await vscode.tasks.fetchTasks();
  const tache = taches.find((t) => t.name === nomTache);
  if (!tache) {
    vscode.window.showErrorMessage(T('err.tache', [nomTache]));
    return null;
  }
  const execution = await vscode.tasks.executeTask(tache);
  return await new Promise((resolve) => {
    const abo = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution === execution) { abo.dispose(); resolve(e.exitCode); }
    });
  });
}

function lancerBuild() { return lancerTache(NOM_TACHE_BUILD); }

// « Tout exporter » (N3, D44) : rebuild FORCÉ de toute la revue. Ferme d'abord les
// aperçus ouverts sous out/ — le clean du Makefile supprime out/, et un PDF affiché
// est verrouillé côté Windows (R6). Notifie le compte d'articles exportés.
async function toutExporter(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (buildEnCours || importEnCours) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  buildEnCours = true;
  const statut = vscode.window.setStatusBarMessage(T('statut.export'));
  try {
    await fermerOngletsSous(path.join(racine, 'out'));
    apercuCourantUri = null;                       // tous les aperçus viennent d'être fermés
    const code = await lancerTache(NOM_TACHE_EXPORT);
    rafraichirTout();
    if (code === null) { return; }                 // tâche introuvable (déjà signalé)
    if (code !== 0) {
      vscode.window.showErrorMessage(T('err.export', [NOM_TACHE_EXPORT]));
      return;
    }
    const n = fournisseur.listerArticles().length;
    vscode.window.showInformationMessage(n > 1 ? T('info.exportes', [n]) : T('info.exportes.un'));
  } finally {
    statut.dispose();
    buildEnCours = false;
  }
}

// ---- Clic = aperçu direct (N5, D46) -----------------------------------------------

// URI du PDF actuellement affiché PAR LE COCKPIT (l'aperçu du précédent article est
// fermé avant d'ouvrir le suivant — deux colonnes stables, pas d'onglets qui
// s'empilent). szh-apercu, lui, ne fait que rafraîchir/ouvrir l'article ACTIF.
let apercuCourantUri = null;

async function fermerApercuCourant(saufUri) {
  const courant = apercuCourantUri;
  if (!courant) { return; }
  if (saufUri && courant.fsPath.toLowerCase() === saufUri.fsPath.toLowerCase()) { return; }
  apercuCourantUri = null;
  const cible = courant.fsPath.toLowerCase();
  const aFermer = [];
  for (const groupe of vscode.window.tabGroups.all) {
    for (const onglet of groupe.tabs) {
      const entree = onglet.input;
      if (entree && entree.uri && entree.uri.fsPath && entree.uri.fsPath.toLowerCase() === cible) {
        aFermer.push(onglet);
      }
    }
  }
  if (aFermer.length > 0) {
    try { await vscode.window.tabGroups.close(aFermer); } catch (e) { /* déjà fermé */ }
  }
}

// ---- Aperçu commutable HTML <-> PDF (M5, D53/D54) -----------------------------------
//
// Mode global persistant szh.apercuMode (défaut : html). En mode HTML, la
// colonne 2 est une webview maison qui charge out/<slug>/<slug>.apercu.html
// (rendu sourcepos) : survol = contour, clic = aller à la ligne source du .md.
// En mode PDF, comportement historique (tomoki1207.pdf). Un SEUL propriétaire
// de la colonne 2 à la fois : szh-apercu ne s'active qu'en mode pdf (D54).

function modeApercu() {
  try {
    return String(vscode.workspace.getConfiguration('szh').get('apercuMode', 'html') || 'html') === 'pdf' ? 'pdf' : 'html';
  } catch (e) { return 'html'; }
}

let panneauApercuHtml = null;
let apercuCourantSlug = null;
let apercuHtmlMtime = 0;

// « 01-exemple.md@12:3-14:1 » (ou « 12:3-14:1 ») -> 12. null si illisible.
function lignePos(pos) {
  const texte = String(pos || '');
  const droite = texte.indexOf('@') !== -1 ? texte.slice(texte.indexOf('@') + 1) : texte;
  const m = droite.match(/^(\d+):/);
  return m ? parseInt(m[1], 10) : null;
}

// Injecte dans le HTML autonome de pandoc : CSP stricte, bandeau, styles de
// survol et script (nonce). Les valeurs n'entrent jamais en HTML non échappé.
function injecterApercu(contenu, nonce) {
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\'">';
  const ajout =
    '<style>body{margin-top:2.4rem;}' +
    '#szh-bandeau{position:fixed;top:0;left:0;right:0;z-index:9999;font:13px sans-serif;' +
    'padding:.35rem .8rem;background:#1f6feb;color:#fff;display:flex;justify-content:space-between;align-items:center;}' +
    '#szh-bandeau button{font:inherit;border:none;border-radius:3px;padding:.15rem .6rem;cursor:pointer;background:#fff;color:#1f6feb;}' +
    '.szh-survol{outline:2px solid #1f6feb;outline-offset:2px;}</style>' +
    '<div id="szh-bandeau"><span>' + T('apercu.bandeau') + '</span>' +
    '<button id="szh-basculer" type="button">' + T('apercu.bandeau.pdf') + '</button></div>' +
    '<script nonce="' + nonce + '">(function(){' +
    "'use strict';" +
    'var vscodeApi=acquireVsCodeApi();var courant=null;' +
    "document.getElementById('szh-basculer').addEventListener('click',function(){vscodeApi.postMessage({type:'basculer'});});" +
    "document.addEventListener('mouseover',function(e){var c=e.target&&e.target.closest?e.target.closest('[data-pos]'):null;" +
    "if(courant===c){return;}if(courant){courant.classList.remove('szh-survol');}courant=c;if(courant){courant.classList.add('szh-survol');}});" +
    "document.addEventListener('click',function(e){var c=e.target&&e.target.closest?e.target.closest('[data-pos]'):null;" +
    "if(!c){return;}e.preventDefault();vscodeApi.postMessage({type:'revele',pos:c.getAttribute('data-pos')});});" +
    '})();</script>';
  let html = contenu;
  html = html.indexOf('<head>') !== -1 ? html.replace('<head>', '<head>\n' + csp) : csp + html;
  html = html.indexOf('</body>') !== -1 ? html.replace('</body>', ajout + '\n</body>') : html + ajout;
  return html;
}

async function revelerLigne(fournisseur, slug, ligne) {
  if (!ligne || !fournisseur.racine) { return; }
  const md = path.join(fournisseur.racine, 'articles', slug, slug + '.md');
  try {
    const doc = await vscode.workspace.openTextDocument(md);
    const editeur = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
    const l = Math.max(0, Math.min(ligne - 1, doc.lineCount - 1));
    editeur.revealRange(new vscode.Range(l, 0, l, 0), vscode.TextEditorRevealType.InCenter);
    editeur.selection = new vscode.Selection(l, 0, l, 0);
  } catch (e) { /* fichier disparu entre-temps */ }
}

function fermerApercuHtml() {
  if (!panneauApercuHtml) { return; }
  const p = panneauApercuHtml;
  panneauApercuHtml = null;
  try { p.dispose(); } catch (e) { /* déjà fermé */ }
}

// Ouvre (ou recharge) l'aperçu HTML de l'article en colonne 2 (webview réutilisée).
// Repli si le toolkit n'est pas resynchronisé : le .html du PDF (sans clic),
// sinon un message « pas encore compilé ».
function ouvrirApercuHtml(fournisseur, slug) {
  const dossier = path.join(fournisseur.racine, 'out', slug);
  let fichier = path.join(dossier, slug + '.apercu.html');
  let contenu = null;
  try { contenu = fs.readFileSync(fichier, 'utf8'); }
  catch (e) {
    fichier = path.join(dossier, slug + '.html');
    try { contenu = fs.readFileSync(fichier, 'utf8'); } catch (e2) { contenu = null; }
  }
  let mtime = 0;
  try { mtime = fs.statSync(fichier).mtimeMs; } catch (e) { /* placeholder */ }
  if (contenu === null) {
    contenu = '<!DOCTYPE html><html lang="fr"><head></head><body><p>' + T('apercu.indisponible') + '</p></body></html>';
  }
  const html = injecterApercu(contenu, crypto.randomBytes(16).toString('hex'));
  if (!panneauApercuHtml) {
    const panneau = vscode.window.createWebviewPanel(
      'szhApercuHtml', slug,
      { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [] }
    );
    panneauApercuHtml = panneau;
    panneau.onDidDispose(() => { if (panneauApercuHtml === panneau) { panneauApercuHtml = null; } });
    panneau.webview.onDidReceiveMessage((msg) => {
      if (!msg) { return; }
      if (msg.type === 'basculer') { vscode.commands.executeCommand('szh.basculerApercu'); }
      if (msg.type === 'revele' && apercuCourantSlug) { revelerLigne(fournisseur, apercuCourantSlug, lignePos(msg.pos)); }
    });
  }
  panneauApercuHtml.title = slug;
  panneauApercuHtml.webview.html = html;
  apercuCourantSlug = slug;
  apercuHtmlMtime = mtime;
}

// Recharge l'aperçu HTML si le fichier régénéré a changé (appelé au refresh —
// la perte du défilement n'arrive donc qu'à une vraie recompilation).
function rechargerApercuHtmlSiChange(fournisseur) {
  if (!panneauApercuHtml || !apercuCourantSlug || !fournisseur.racine || modeApercu() !== 'html') { return; }
  const slug = apercuCourantSlug;
  let mtime = 0;
  try { mtime = fs.statSync(path.join(fournisseur.racine, 'out', slug, slug + '.apercu.html')).mtimeMs; }
  catch (e) { return; }
  if (mtime > apercuHtmlMtime) { ouvrirApercuHtml(fournisseur, slug); }
}

// Bascule globale HTML <-> PDF : persiste szh.apercuMode et échange l'aperçu
// de l'article courant (jamais deux aperçus concurrents en colonne 2).
async function basculerApercu(fournisseur, majBarreApercu) {
  const nouveau = modeApercu() === 'html' ? 'pdf' : 'html';
  try {
    await vscode.workspace.getConfiguration('szh').update('apercuMode', nouveau, vscode.ConfigurationTarget.Global);
  } catch (e) {
    vscode.window.showErrorMessage(T('err.ecriture', [e.message]));
    return;
  }
  if (majBarreApercu) { majBarreApercu(); }
  const slug = apercuCourantSlug;
  if (!slug || !fournisseur.racine) { return; }
  if (nouveau === 'html') {
    if (apercuCourantUri) { await fermerApercuCourant(null); }   // l'onglet PDF courant
    ouvrirApercuHtml(fournisseur, slug);
  } else {
    fermerApercuHtml();
    const pdf = vscode.Uri.file(path.join(fournisseur.racine, 'out', slug, slug + '.pdf'));
    if (fs.existsSync(pdf.fsPath)) {
      await ouvrirApercuPdf(pdf);
      apercuCourantUri = pdf;
    }
  }
}

// Le geste unique du rédacteur : cliquer un article = voir son texte ET son PDF.
// 1. .md en colonne 1 ; 2. build si PDF absent/obsolète (mtime), incrémental ;
// 3. fermer l'aperçu de l'article précédent ; 4. aperçu en colonne 2.
// En cas d'échec de build : le .md reste ouvert, erreur sobre, PAS d'aperçu
// obsolète trompeur.
async function ouvrirArticle(fournisseur, slug) {
  const racine = fournisseur.racine;
  if (!racine || typeof slug !== 'string' || slug === '') { return; }
  const md = path.join(racine, 'articles', slug, slug + '.md');
  const pdf = vscode.Uri.file(path.join(racine, 'out', slug, slug + '.pdf'));

  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(md), { viewColumn: vscode.ViewColumn.One });

  // Obsolète = PDF plus ancien que la source la plus récente (.md, un tableau
  // extrait OU la fiche .meta.yaml — même graphe de dépendances que la règle
  // HTML du Makefile, N6 + M1).
  let obsolete = true;
  try {
    let mSource = fs.statSync(md).mtimeMs;
    const dossierTables = path.join(racine, 'articles', slug, 'tables');
    let tables = [];
    try { tables = fs.readdirSync(dossierTables); } catch (e) { /* pas de tableaux */ }
    for (const t of tables) {
      if (!/\.html?$/i.test(t)) { continue; }
      try { mSource = Math.max(mSource, fs.statSync(path.join(dossierTables, t)).mtimeMs); }
      catch (e) { /* fichier disparu entre-temps */ }
    }
    try { mSource = Math.max(mSource, fs.statSync(cheminMeta(racine, slug)).mtimeMs); }
    catch (e) { /* pas de fiche */ }
    obsolete = fs.statSync(pdf.fsPath).mtimeMs < mSource;
  } catch (e) { obsolete = true; }                 // PDF (ou .md) illisible -> on compile

  if (obsolete) {
    if (buildEnCours) { vscode.window.setStatusBarMessage(T('statut.build.encours'), 3000); return; }
    buildEnCours = true;
    const statut = vscode.window.setStatusBarMessage(T('statut.build.de', [slug]));
    try {
      const code = await lancerBuild();
      if (code === null) { return; }               // tâche introuvable (déjà signalé)
      if (code !== 0) {
        vscode.window.showErrorMessage(T('err.build', [NOM_TACHE_BUILD]));
        return;
      }
    } finally {
      statut.dispose();
      buildEnCours = false;
    }
  }
  // M5 : la colonne 2 affiche l'aperçu DU MODE COURANT (html par défaut).
  if (modeApercu() === 'html') {
    if (apercuCourantUri) { await fermerApercuCourant(null); }  // onglet PDF d'une bascule passée
    ouvrirApercuHtml(fournisseur, slug);
    return;
  }
  fermerApercuHtml();                              // webview HTML d'une bascule passée
  if (!fs.existsSync(pdf.fsPath)) {
    vscode.window.showErrorMessage(T('err.pdf.introuvable', [slug]));
    return;
  }
  await fermerApercuCourant(pdf);                  // l'aperçu du précédent article
  await ouvrirApercuPdf(pdf);                      // mono-instance : révèle si déjà là
  apercuCourantUri = pdf;
  apercuCourantSlug = slug;
}

// ---- Import guidé (S3) ---------------------------------------------------------

let importEnCours = false;

async function executerImport() {
  const taches = await vscode.tasks.fetchTasks();
  const tache = taches.find((t) => t.name === NOM_TACHE_IMPORT);
  if (!tache) {
    vscode.window.showErrorMessage(
      'Tâche « ' + NOM_TACHE_IMPORT + ' » introuvable. Réglages de l’éditeur incomplets ?'
    );
    return null;
  }
  const execution = await vscode.tasks.executeTask(tache);
  return await new Promise((resolve) => {
    const abo = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution === execution) { abo.dispose(); resolve(e.exitCode); }
    });
  });
}

// Convertit les Word présents dans articles-word/ (déposés à la main OU copiés par
// « Importer des Word »). Compte les NOUVEAUX articles par diff avant/après (jamais
// par parsing de la sortie). Garde anti-double (clics rapprochés).
async function lancerConversion(fournisseur, rafraichirTout) {
  if (importEnCours) { vscode.window.setStatusBarMessage(T('statut.import.encours'), 3000); return; }
  importEnCours = true;
  const statut = vscode.window.setStatusBarMessage(T('statut.import'));
  try {
    const avant = new Set(fournisseur.listerArticles());
    const code = await executerImport();
    rafraichirTout();
    if (code === null) { return; }               // tâche introuvable (déjà signalé)
    if (code !== 0) {
      vscode.window.showErrorMessage(T('err.import', [NOM_TACHE_IMPORT]));
      return;
    }
    let n = 0;
    for (const slug of fournisseur.listerArticles()) { if (!avant.has(slug)) { n++; } }
    if (n > 0) {
      vscode.window.showInformationMessage(n > 1 ? T('info.importes', [n]) : T('info.importes.un'));
    } else {
      vscode.window.showInformationMessage(T('info.importes.aucun'));
    }
  } finally {
    statut.dispose();
    importEnCours = false;
  }
}

async function importerWord(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }

  const filtresImport = {};
  filtresImport[T('dial.importer.filtre')] = ['docx'];
  const choix = await vscode.window.showOpenDialog({
    canSelectMany: true,
    filters: filtresImport,
    openLabel: T('dial.importer.bouton'),
    title: T('dial.importer.titre')
  });
  if (!choix || choix.length === 0) { return; }   // dialogue annulé

  const dossierWord = path.join(racine, 'articles-word');
  try { fs.mkdirSync(dossierWord, { recursive: true }); } catch (e) { /* existe déjà */ }

  // Jamais d'écrasement silencieux : si des .docx du même nom sont déjà en
  // attente, on demande explicitement (modale). On choisit « Remplacer / Ignorer »
  // plutôt qu'un renommage auto, qui créerait en douce un article dupliqué au
  // slug suffixé — déroutant pour un rédacteur.
  const conflits = choix.filter((u) => fs.existsSync(path.join(dossierWord, path.basename(u.fsPath))));
  let remplacer = true;
  if (conflits.length > 0) {
    const noms = conflits.map((u) => path.basename(u.fsPath)).join(', ');
    const rep = await vscode.window.showWarningMessage(
      T('modale.conflit.question', [noms]),
      { modal: true },
      T('modale.remplacer.bouton'), T('modale.conflit.ignorer')
    );
    if (rep === undefined) { return; }             // annulé
    remplacer = (rep === T('modale.remplacer.bouton'));
  }

  let copies = 0;
  for (const u of choix) {
    const dest = path.join(dossierWord, path.basename(u.fsPath));
    if (fs.existsSync(dest) && !remplacer) { continue; }
    try { fs.copyFileSync(u.fsPath, dest); copies++; }
    catch (e) { vscode.window.showErrorMessage(T('err.copie', [path.basename(u.fsPath), e.message])); }
  }
  if (copies === 0) { rafraichirTout(); return; }

  // Conversion + notification (compte par diff) — mutualisée avec « Convertir les
  // Word en attente ».
  await lancerConversion(fournisseur, rafraichirTout);
}

// ---- Assets (G5, D41) : dimensions sans dépendance + « Remplacer » ----------------

// Dimensions lues des en-têtes de fichier — PNG/GIF/SVG sûrs, JPEG au mieux
// (parcours des marqueurs jusqu'au SOF). null si indéterminable : la description
// retombe alors sur le poids seul. Seuls les premiers Ko sont lus.
function lireDimensionsImage(chemin) {
  let fd = null;
  try {
    fd = fs.openSync(chemin, 'r');
    const tampon = Buffer.alloc(65536);
    const lu = fs.readSync(fd, tampon, 0, tampon.length, 0);
    const b = tampon.subarray(0, lu);
    if (lu >= 24 && b.readUInt32BE(0) === 0x89504e47) {          // PNG : IHDR
      return { largeur: b.readUInt32BE(16), hauteur: b.readUInt32BE(20) };
    }
    if (lu >= 10 && (b.toString('latin1', 0, 6) === 'GIF87a' || b.toString('latin1', 0, 6) === 'GIF89a')) {
      return { largeur: b.readUInt16LE(6), hauteur: b.readUInt16LE(8) };
    }
    if (lu >= 4 && b[0] === 0xff && b[1] === 0xd8) {             // JPEG : marqueurs SOF
      let i = 2;
      while (i + 9 < lu) {
        if (b[i] !== 0xff) { i++; continue; }
        const marqueur = b[i + 1];
        if (marqueur === 0xff) { i++; continue; }                 // bourrage FF
        if (marqueur === 0xd8 || (marqueur >= 0xd0 && marqueur <= 0xd7) || marqueur === 0x01) { i += 2; continue; }
        if (marqueur === 0xda) { break; }                         // début des données : SOF manqué
        const longueur = b.readUInt16BE(i + 2);
        if (marqueur >= 0xc0 && marqueur <= 0xcf && marqueur !== 0xc4 && marqueur !== 0xc8 && marqueur !== 0xcc) {
          return { largeur: b.readUInt16BE(i + 7), hauteur: b.readUInt16BE(i + 5) };
        }
        if (longueur < 2) { break; }                              // en-tête corrompu
        i += 2 + longueur;
      }
      return null;
    }
    if (/\.svg$/i.test(chemin)) {                                 // SVG : attributs ou viewBox
      const texte = b.toString('utf8');
      const balise = texte.match(/<svg[^>]*>/i);
      if (balise) {
        const l = balise[0].match(/[\s"']width\s*=\s*["']?([0-9.]+)(?:px)?["']?/i);
        const h = balise[0].match(/[\s"']height\s*=\s*["']?([0-9.]+)(?:px)?["']?/i);
        if (l && h) { return { largeur: Math.round(parseFloat(l[1])), hauteur: Math.round(parseFloat(h[1])) }; }
        const vb = balise[0].match(/viewBox\s*=\s*["']\s*[0-9.+-]+[\s,]+[0-9.+-]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i);
        if (vb) { return { largeur: Math.round(parseFloat(vb[1])), hauteur: Math.round(parseFloat(vb[2])) }; }
      }
    }
    return null;
  } catch (e) {
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (e) { /* déjà fermé */ } }
  }
}

// « 1 234 × 567 · 245 Ko » — poids en o/Ko/Mo (virgule française pour les Mo).
function decrireImage(chemin) {
  let octets = 0;
  try { octets = fs.statSync(chemin).size; } catch (e) { return ''; }
  let poids;
  if (octets < 1024) { poids = octets + ' o'; }
  else if (octets < 1024 * 1024) { poids = Math.round(octets / 1024) + ' Ko'; }
  else { poids = (octets / (1024 * 1024)).toFixed(1).replace('.', ',') + ' Mo'; }
  const dims = lireDimensionsImage(chemin);
  return dims ? dims.largeur + ' × ' + dims.hauteur + ' · ' + poids : poids;
}

// Extension « logique » pour la comparaison de formats (jpg et jpeg = même format).
function formatImage(nom) {
  const ext = (nom.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

// « Remplacer » (D41) : écrase l'image cible EN GARDANT son nom — le lien du .md
// reste valide. Jamais silencieux : confirmation modale, renforcée si le format
// du fichier choisi diffère de la cible (risque R4 : contenu ≠ extension).
async function remplacerAsset(fournisseur, rafraichirTout, item) {
  if (!fournisseur.racine || !item || !item.cheminAsset) { return; }
  if (buildEnCours || importEnCours) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const cible = item.cheminAsset;
  const nomCible = path.basename(cible);
  const filtresImage = {};
  filtresImage[T('dial.image.filtre')] = ['png', 'jpg', 'jpeg', 'gif', 'svg'];
  const choix = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: filtresImage,
    openLabel: T('dial.image.bouton'),
    title: T('dial.image.titre', [nomCible])
  });
  if (!choix || choix.length === 0) { return; }    // dialogue annulé
  const source = choix[0].fsPath;
  const nomSource = path.basename(source);
  let detail = T('modale.remplacer.detail.image', [nomCible]);
  if (formatImage(nomSource) !== formatImage(nomCible)) {
    detail = T('modale.remplacer.detail.format', [formatImage(nomSource), formatImage(nomCible)]) + detail;
  }
  const reponse = await vscode.window.showWarningMessage(
    T('modale.remplacer.question', [nomCible, nomSource]),
    { modal: true, detail: detail },
    T('modale.remplacer.bouton')
  );
  if (reponse !== T('modale.remplacer.bouton')) { return; }   // annulé : rien n'est touché
  try {
    fs.copyFileSync(source, cible);                // même nom : lien du .md intact
    vscode.window.setStatusBarMessage(T('statut.image.remplacee', [nomCible]), 5000);
  } catch (e) {
    vscode.window.showErrorMessage(T('err.remplacement', [e.message]));
  }
  rafraichirTout();
}

// « Remplacer » un tableau (N6, D47) : écrase tables/table-NN.html par un fichier
// .html choisi, EN GARDANT le nom (la référence du .md reste valide). Jamais
// silencieux : confirmation modale. L'édition fine se fait au clic (fichier HTML).
async function remplacerTable(fournisseur, rafraichirTout, item) {
  if (!fournisseur.racine || !item || !item.cheminAsset) { return; }
  if (buildEnCours || importEnCours) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const cible = item.cheminAsset;
  const nomCible = path.basename(cible);
  const filtresTable = {};
  filtresTable[T('dial.table.filtre')] = ['html', 'htm'];
  const choix = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: filtresTable,
    openLabel: T('dial.table.bouton'),
    title: T('dial.table.titre', [nomCible])
  });
  if (!choix || choix.length === 0) { return; }    // dialogue annulé
  const source = choix[0].fsPath;
  const reponse = await vscode.window.showWarningMessage(
    T('modale.remplacer.question', [nomCible, path.basename(source)]),
    { modal: true, detail: T('modale.remplacer.detail.table', [nomCible]) },
    T('modale.remplacer.bouton')
  );
  if (reponse !== T('modale.remplacer.bouton')) { return; }   // annulé : rien n'est touché
  try {
    fs.copyFileSync(source, cible);
    vscode.window.setStatusBarMessage(T('statut.table.remplacee', [nomCible]), 5000);
  } catch (e) {
    vscode.window.showErrorMessage(T('err.remplacement', [e.message]));
  }
  rafraichirTout();
}

// ---- Suppression d'article (G3, D40) ---------------------------------------------

// Ferme les onglets dont le fichier vit sous `dossier` (comparaison insensible à la
// casse — système de fichiers Windows) : un onglet ouvert sur un fichier supprimé
// resterait sinon en « fantôme » avec une erreur à la première interaction.
async function fermerOngletsSous(dossier) {
  const prefixe = (dossier + path.sep).toLowerCase();
  const aFermer = [];
  for (const groupe of vscode.window.tabGroups.all) {
    for (const onglet of groupe.tabs) {
      const entree = onglet.input;
      if (entree && entree.uri && entree.uri.fsPath &&
          entree.uri.fsPath.toLowerCase().indexOf(prefixe) === 0) {
        aFermer.push(onglet);
      }
    }
  }
  if (aFermer.length > 0) {
    try { await vscode.window.tabGroups.close(aFermer); } catch (e) { /* onglet déjà fermé */ }
  }
}

// Première action DESTRUCTIVE du cockpit : confirmation modale obligatoire, nommant
// l'article (D40, risque R6) — jamais de suppression silencieuse.
async function supprimerArticle(fournisseur, rafraichirTout, item) {
  const racine = fournisseur.racine;
  if (!racine || !item || !item.slug) { return; }
  const slug = item.slug;
  // Pas de suppression pendant un build/import : make pourrait recréer out/<slug>
  // ou lire un dossier à moitié effacé.
  if (buildEnCours || importEnCours) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const reponse = await vscode.window.showWarningMessage(
    T('modale.supprimer.question', [slug]),
    { modal: true, detail: T('modale.supprimer.detail', [slug]) },
    T('modale.supprimer.bouton')
  );
  if (reponse !== T('modale.supprimer.bouton')) { return; }   // annulé : rien n'est touché
  const dossierArticle = path.join(racine, 'articles', slug);
  const dossierSortie = path.join(racine, 'out', slug);
  try {
    if (apercuCourantSlug === slug) { fermerApercuHtml(); apercuCourantSlug = null; }
    await fermerOngletsSous(dossierArticle);
    await fermerOngletsSous(dossierSortie);
    fs.rmSync(dossierArticle, { recursive: true, force: true });
    fs.rmSync(dossierSortie, { recursive: true, force: true });
    vscode.window.setStatusBarMessage(T('statut.supprime', [slug]), 3000);
  } catch (e) {
    vscode.window.showErrorMessage(T('err.suppression', [slug, e.message]));
  }
  rafraichirTout();
}

// ---- Méta-données du numéro (G1, D37) --------------------------------------------
//
// ausgabe.yaml est un YAML PLAT (clé: valeur, une par ligne). Pas de lib YAML :
// un sérialiseur maison qui ne touche QUE les lignes des clés du schéma D37 —
// toute autre ligne (commentaires, subtitle:, clés futures) est préservée
// byte pour byte, fins de ligne (LF/CRLF) et BOM compris.

const CLES_METADONNEES = ['title', 'revue', 'volume', 'numero', 'date', 'lang', 'couleur'];

// Couleur annuelle du numéro (M7, D56) : palette figée, stockée en hex dans
// ausgabe.yaml (clé plate `couleur`, citée). Libellés traduits via T().
const COULEURS_NUMERO = [
  { cle: 'rouge',       hex: '#D31932' },
  { cle: 'capucine',    hex: '#EB5E51' },
  { cle: 'moutarde',    hex: '#C7CF1C' },
  { cle: 'poireau',     hex: '#51A66D' },
  { cle: 'bleuacier',   hex: '#5F9FBC' },
  { cle: 'mountbatten', hex: '#A98899' }
];
const HEX_COULEURS = COULEURS_NUMERO.map((c) => c.hex.toUpperCase());

// Découpe la partie droite d'un « clé: reste » en { valeur, suite } — `suite` est
// l'éventuel commentaire de fin de ligne, AVEC ses espaces de tête, restitué tel
// quel à l'écriture. Gère les scalaires nus, « … » (échappes \" et \\) et '…'
// (échappe ''). Un droit malformé est traité comme scalaire nu (best effort).
function decouperValeurYaml(reste) {
  reste = String(reste);
  if (reste.startsWith('"')) {
    let i = 1, fin = -1;
    while (i < reste.length) {
      if (reste[i] === '\\') { i += 2; continue; }
      if (reste[i] === '"') { fin = i; break; }
      i++;
    }
    if (fin !== -1 && /^\s*(#.*)?$/.test(reste.slice(fin + 1))) {
      return {
        valeur: reste.slice(1, fin).replace(/\\(["\\])/g, '$1'),
        suite: reste.slice(fin + 1).replace(/\s+$/, '')
      };
    }
  } else if (reste.startsWith("'")) {
    const m = reste.match(/^'((?:[^']|'')*)'(\s*(?:#.*)?)$/);
    if (m) { return { valeur: m[1].replace(/''/g, "'"), suite: m[2].replace(/\s+$/, '') }; }
  }
  // Scalaire nu : le commentaire commence à « espace(s) + # » (ou « # » en tête) ;
  // toute la plage d'espaces fait partie de `suite` (alignement restitué tel quel).
  let debutComm = -1;
  if (reste.startsWith('#')) { debutComm = 0; }
  else {
    const m = reste.match(/\s+#/);
    if (m) { debutComm = m.index; }
  }
  if (debutComm === -1) { return { valeur: reste.trim(), suite: '' }; }
  return { valeur: reste.slice(0, debutComm).trim(), suite: reste.slice(debutComm).replace(/\s+$/, '') };
}

// Valeurs du schéma D37 actuellement dans le fichier (clés absentes : non définies).
function analyserAusgabe(contenu) {
  const valeurs = {};
  for (const ligne of contenu.split(/\r?\n/)) {
    const m = ligne.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m || CLES_METADONNEES.indexOf(m[1]) === -1) { continue; }
    if (!(m[1] in valeurs)) { valeurs[m[1]] = decouperValeurYaml(m[2]).valeur; }
  }
  return valeurs;
}

// ---- Frontmatter d'article (N7, D48) -----------------------------------------------
//
// Les métadonnées d'un article vivent dans le frontmatter YAML de son <slug>.md
// (créé s'il manque). Clés gérées : title, subtitle, author (liste structurée
// name/affiliation/orcid), doi, keywords (liste). Tout le reste — corps de
// l'article, clés inconnues, commentaires — est préservé VERBATIM (risque R1).

const CLES_FRONTMATTER = ['title', 'subtitle', 'author', 'doi', 'keywords'];

// Découpe un article : { bom, fm, corps, eol }. Le frontmatter n'existe que si la
// PREMIÈRE ligne du fichier est exactement « --- » ; il se ferme à la première
// ligne « --- » ou « ... ». Un « --- » plus loin dans le corps (règle horizontale)
// n'est JAMAIS pris pour une borne. `fm` = texte brut entre les bornes (null si
// absent) ; `corps` = tout le reste, restitué tel quel.
function separerFrontmatter(texte) {
  texte = String(texte);
  const bom = texte.charAt(0) === '\uFEFF' ? '\uFEFF' : '';
  const sansBom = bom ? texte.slice(1) : texte;
  const eol = sansBom.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
  const finLigne1 = sansBom.search(/\r?\n/);
  const ligne1 = finLigne1 === -1 ? sansBom : sansBom.slice(0, finLigne1);
  if (finLigne1 === -1 || !/^---\s*$/.test(ligne1)) {
    return { bom: bom, fm: null, corps: sansBom, eol: eol };
  }
  const debutFm = finLigne1 + (sansBom.charAt(finLigne1) === '\r' ? 2 : 1);
  let position = debutFm;
  while (position <= sansBom.length) {
    const finLigne = sansBom.indexOf('\n', position);
    const finBrute = finLigne === -1 ? sansBom.length : finLigne;
    let ligne = sansBom.slice(position, finBrute);
    if (ligne.charAt(ligne.length - 1) === '\r') { ligne = ligne.slice(0, -1); }
    if (/^(---|\.\.\.)\s*$/.test(ligne)) {
      const fm = sansBom.slice(debutFm, position).replace(/\r?\n$/, '');
      const corps = finLigne === -1 ? '' : sansBom.slice(finLigne + 1);
      return { bom: bom, fm: fm, corps: corps, eol: eol };
    }
    if (finLigne === -1) { break; }
    position = finLigne + 1;
  }
  return { bom: bom, fm: null, corps: sansBom, eol: eol };  // borne jamais fermée
}

// Valeurs des clés gérées d'un frontmatter (best effort sur l'existant).
// author accepte : scalaire (« author: Jean ») -> [{name}], liste de scalaires,
// liste de mappings (name/affiliation/orcid). keywords accepte : scalaire,
// flow ([a, b]) et liste « - mot ».
// Découpe l'intérieur d'une liste flow « [a, "b, c", d] » sur les virgules HORS
// guillemets (échappes \" et '' respectées).
function decouperFlowYaml(interieur) {
  const morceaux = [];
  let courant = '';
  let guillemet = null;
  for (let j = 0; j < interieur.length; j++) {
    const c = interieur.charAt(j);
    if (guillemet !== null) {
      courant += c;
      if (guillemet === '"' && c === '\\') { courant += interieur.charAt(j + 1); j++; continue; }
      if (c === guillemet) {
        if (guillemet === "'" && interieur.charAt(j + 1) === "'") { courant += "'"; j++; continue; }
        guillemet = null;
      }
      continue;
    }
    if (c === '"' || c === "'") { guillemet = c; courant += c; continue; }
    if (c === ',') { morceaux.push(courant); courant = ''; continue; }
    courant += c;
  }
  if (courant.trim() !== '') { morceaux.push(courant); }
  return morceaux;
}

function analyserFrontmatter(fm) {
  const valeurs = {};
  if (fm === null || fm === undefined) { return valeurs; }
  const lignes = String(fm).split(/\r?\n/);
  let i = 0;
  while (i < lignes.length) {
    const m = lignes[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const cle = m[1];
    const reste = m[2];
    if (cle === 'author') {
      const auteurs = [];
      const net = reste.trim();
      if (net !== '' && net.charAt(0) !== '#') {
        auteurs.push({ name: decouperValeurYaml(reste).valeur });
        i++;
      } else {
        i++;
        let courant = null;
        while (i < lignes.length && !/^[A-Za-z0-9_-]+:/.test(lignes[i])) {
          const item = lignes[i].match(/^\s*-\s*(.*)$/);
          const champ = lignes[i].match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
          if (item) {
            courant = {};
            auteurs.push(courant);
            const interne = item[1].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
            if (interne) { courant[interne[1]] = decouperValeurYaml(interne[2]).valeur; }
            else if (item[1].trim() !== '') { courant.name = decouperValeurYaml(item[1]).valeur; }
          } else if (champ && courant) {
            courant[champ[1]] = decouperValeurYaml(champ[2]).valeur;
          }
          i++;
        }
      }
      valeurs.author = auteurs
        .map((a) => ({
          name: String(a.name || ''), affiliation: String(a.affiliation || ''), orcid: String(a.orcid || '')
        }))
        .filter((a) => a.name !== '' || a.affiliation !== '' || a.orcid !== '');
      continue;
    }
    if (cle === 'keywords') {
      const mots = [];
      const net = reste.trim();
      if (net.charAt(0) === '[') {
        for (const morceau of decouperFlowYaml(net.replace(/^\[/, '').replace(/\]\s*$/, ''))) {
          const v = decouperValeurYaml(morceau.trim()).valeur;
          if (v !== '') { mots.push(v); }
        }
        i++;
      } else if (net !== '' && net.charAt(0) !== '#') {
        mots.push(decouperValeurYaml(net).valeur);
        i++;
      } else {
        i++;
        while (i < lignes.length && !/^[A-Za-z0-9_-]+:/.test(lignes[i])) {
          const item = lignes[i].match(/^\s*-\s*(.*)$/);
          if (item) {
            const v = decouperValeurYaml(item[1]).valeur;
            if (v !== '') { mots.push(v); }
          }
          i++;
        }
      }
      valeurs.keywords = mots;
      continue;
    }
    if (CLES_FRONTMATTER.indexOf(cle) !== -1 && !(cle in valeurs)) {
      valeurs[cle] = decouperValeurYaml(reste).valeur;
    }
    i++;
  }
  return valeurs;
}

function citerFrontmatter(valeur) {
  return '"' + String(valeur).replace(/([\\"])/g, '\\$1') + '"';
}

// Lignes canoniques d'une clé gérée. [] si la valeur est « vide » -> la clé est
// RETIRÉE du frontmatter (pas de clé fantôme « "" » côté pandoc).
function lignesCleFrontmatter(cle, valeur) {
  if (cle === 'author') {
    const auteurs = (Array.isArray(valeur) ? valeur : [])
      .map((a) => ({
        name: String((a && a.name) || '').trim(),
        affiliation: String((a && a.affiliation) || '').trim(),
        orcid: String((a && a.orcid) || '').trim()
      }))
      .filter((a) => a.name !== '' || a.affiliation !== '' || a.orcid !== '');
    if (auteurs.length === 0) { return []; }
    const lignes = ['author:'];
    for (const a of auteurs) {
      let premiere = true;
      for (const champ of ['name', 'affiliation', 'orcid']) {
        if (a[champ] === '') { continue; }
        lignes.push((premiere ? '- ' : '  ') + champ + ': ' + citerFrontmatter(a[champ]));
        premiere = false;
      }
    }
    return lignes;
  }
  if (cle === 'keywords') {
    const mots = (Array.isArray(valeur) ? valeur : [])
      .map((v) => String(v).trim())
      .filter((v) => v !== '');
    if (mots.length === 0) { return []; }
    return ['keywords:'].concat(mots.map((v) => '- ' + citerFrontmatter(v)));
  }
  const v = String(valeur === undefined || valeur === null ? '' : valeur).trim();
  if (v === '') { return []; }
  return [cle + ': ' + citerFrontmatter(v)];
}

// Réécrit le document : les clés gérées de `modifies` sont régénérées EN PLACE
// (à la position de leur première occurrence), les clés absentes sont ajoutées en
// fin de frontmatter (ordre D48), les lignes inconnues (clés libres, commentaires,
// vides) sont restituées telles quelles et le CORPS n'est jamais touché. Crée le
// bloc s'il manque ; le supprime s'il devient vide. BOM/CRLF préservés.
function serialiserFrontmatter(texte, modifies) {
  const partie = separerFrontmatter(texte);
  const fmLignes = (partie.fm === null || partie.fm === '') ? [] : partie.fm.split(/\r?\n/);
  const segments = [];
  for (const ligne of fmLignes) {
    const cle = (ligne.match(/^([A-Za-z0-9_-]+):/) || [])[1];
    if (cle) { segments.push({ cle: cle, lignes: [ligne] }); continue; }
    const dernier = segments[segments.length - 1];
    // Continuation d'une clé : ligne indentée ou item de liste « - … ».
    if (dernier && dernier.cle && (/^\s+\S/.test(ligne) || /^\s*-\s/.test(ligne))) {
      dernier.lignes.push(ligne);
    } else {
      segments.push({ cle: null, lignes: [ligne] });
    }
  }
  const restantes = new Set(
    Object.keys(modifies).filter((c) => CLES_FRONTMATTER.indexOf(c) !== -1)
  );
  const sortie = [];
  for (const s of segments) {
    if (s.cle && restantes.has(s.cle)) {
      restantes.delete(s.cle);
      const nouvelles = lignesCleFrontmatter(s.cle, modifies[s.cle]);
      for (const l of nouvelles) { sortie.push(l); }
    } else {
      for (const l of s.lignes) { sortie.push(l); }
    }
  }
  for (const cle of CLES_FRONTMATTER) {
    if (!restantes.has(cle)) { continue; }
    const nouvelles = lignesCleFrontmatter(cle, modifies[cle]);
    for (const l of nouvelles) { sortie.push(l); }
  }
  if (sortie.length === 0) { return partie.bom + partie.corps; }  // plus de frontmatter
  const eol = partie.eol;
  return partie.bom + '---' + eol + sortie.join(eol) + eol + '---' + eol + partie.corps;
}

// ---- Métadonnées d'article : fichier caché <slug>.meta.yaml (M1, D49/D51) ----------
//
// SUPERSEDE le stockage frontmatter de N7 : le .md ne contient QUE le texte ; les
// métadonnées vivent dans articles/<slug>/<slug>.meta.yaml (masqué par
// files.exclude, édité UNIQUEMENT par le formulaire). Fichier « form-owned » :
// régénéré à chaque enregistrement — les clés inconnues de haut niveau sont
// restituées par prudence. Lu par pandoc via --metadata-file (après ausgabe.yaml :
// l'article surcharge le numéro).

const TYPES_ARTICLE = ['varia', 'documentation', 'article', 'interview', 'tribune-libre', 'editorial'];
// Libellés traduits des types (DE/IT : premier jet à valider par Robin).
const LIBELLES_TYPES = {
  'varia':         { fr: 'Varia',         de: 'Varia',         it: 'Varia' },
  'documentation': { fr: 'Documentation', de: 'Dokumentation', it: 'Documentazione' },
  'article':       { fr: 'Article',       de: 'Artikel',       it: 'Articolo' },
  'interview':     { fr: 'Interview',     de: 'Interview',     it: 'Intervista' },
  'tribune-libre': { fr: 'Tribune libre', de: 'Freie Tribüne',  it: 'Tribuna libera' },
  'editorial':     { fr: 'Éditorial',     de: 'Editorial',     it: 'Editoriale' }
};
const LANGUES_META = ['fr', 'de', 'it'];   // fr + de affichées ; it activable par carte
const CHAMPS_AUTEUR = ['prenom', 'nom', 'fonction', 'affiliation', 'orcid'];

// Langue de la revue (base : « de-CH » -> « de ») limitée aux langues du schéma.
function langueRevue(racine) {
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* repli fr */ }
  const base = String(valeurs.lang || 'fr').toLowerCase().slice(0, 2);
  return LANGUES_META.indexOf(base) !== -1 ? base : 'fr';
}

// analyserMeta(texte) -> { type, doi, title:{}, subtitle:{}, resume:{}, keywords:{},
// author:[], _inconnues:[lignes brutes] }. Best effort : maps par langue en bloc OU
// en flow ({ fr: "…" }), listes en bloc OU en flow, auteurs en mappings.
function analyserMeta(texte) {
  const valeurs = { type: '', doi: '', title: {}, subtitle: {}, resume: {}, keywords: {}, author: [], _inconnues: [] };
  if (!texte) { return valeurs; }
  const lignes = String(texte).split(/\r?\n/);
  let i = 0;
  while (i < lignes.length) {
    const m = lignes[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) {
      if (lignes[i].trim() !== '' && lignes[i].trim().charAt(0) !== '#') { valeurs._inconnues.push(lignes[i]); }
      i++;
      continue;
    }
    const cle = m[1];
    const reste = m[2];
    if (cle === 'type') { valeurs.type = decouperValeurYaml(reste).valeur; i++; continue; }
    if (cle === 'doi') { valeurs.doi = decouperValeurYaml(reste).valeur; i++; continue; }
    if (cle === 'title' || cle === 'subtitle' || cle === 'resume') {
      const map = {};
      const net = reste.trim();
      if (net.charAt(0) === '{') {
        for (const partie of decouperFlowYaml(net.replace(/^\{/, '').replace(/\}\s*$/, ''))) {
          const mm = partie.match(/^\s*([A-Za-z-]+)\s*:\s*(.*)$/);
          if (mm) { map[mm[1]] = decouperValeurYaml(mm[2].trim()).valeur; }
        }
        i++;
      } else {
        i++;
        while (i < lignes.length && /^\s+\S/.test(lignes[i])) {
          const mm = lignes[i].match(/^\s+([A-Za-z-]+):\s*(.*)$/);
          if (mm) { map[mm[1]] = decouperValeurYaml(mm[2]).valeur; }
          i++;
        }
      }
      valeurs[cle] = map;
      continue;
    }
    if (cle === 'keywords') {
      const map = {};
      let langue = null;
      i++;
      while (i < lignes.length && /^\s+\S/.test(lignes[i])) {
        const mItem = lignes[i].match(/^\s+-\s*(.*)$/);
        const mLang = mItem ? null : lignes[i].match(/^\s+([A-Za-z-]+):\s*(.*)$/);
        if (mLang) {
          langue = mLang[1];
          map[langue] = map[langue] || [];
          const netL = mLang[2].trim();
          if (netL.charAt(0) === '[') {
            for (const p of decouperFlowYaml(netL.replace(/^\[/, '').replace(/\]\s*$/, ''))) {
              const v = decouperValeurYaml(p.trim()).valeur;
              if (v !== '') { map[langue].push(v); }
            }
          }
        } else if (mItem && langue) {
          const v = decouperValeurYaml(mItem[1]).valeur;
          if (v !== '') { map[langue].push(v); }
        }
        i++;
      }
      valeurs.keywords = map;
      continue;
    }
    if (cle === 'author') {
      const auteurs = [];
      let courant = null;
      i++;
      while (i < lignes.length && !/^[A-Za-z0-9_-]+:/.test(lignes[i])) {
        const item = lignes[i].match(/^\s*-\s*(.*)$/);
        const champ = item ? null : lignes[i].match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
        if (item) {
          courant = {};
          auteurs.push(courant);
          const interne = item[1].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
          if (interne) { courant[interne[1]] = decouperValeurYaml(interne[2]).valeur; }
          else if (item[1].trim() !== '') { courant.nom = decouperValeurYaml(item[1]).valeur; }
        } else if (champ && courant) {
          courant[champ[1]] = decouperValeurYaml(champ[2]).valeur;
        }
        i++;
      }
      valeurs.author = auteurs
        .map((a) => {
          const propre = {};
          for (const c of CHAMPS_AUTEUR) { propre[c] = String(a[c] || ''); }
          return propre;
        })
        .filter((a) => CHAMPS_AUTEUR.some((c) => a[c] !== ''));
      continue;
    }
    // Clé inconnue de haut niveau : sa ligne + ses continuations, restituées telles quelles.
    valeurs._inconnues.push(lignes[i]);
    i++;
    while (i < lignes.length && (/^\s+\S/.test(lignes[i]) || /^\s*-\s/.test(lignes[i]))) {
      valeurs._inconnues.push(lignes[i]);
      i++;
    }
  }
  return valeurs;
}

// serialiserMeta(valeurs) -> YAML régénéré (ordre D51 : type, doi, title, subtitle,
// resume, keywords, author, puis clés inconnues). Valeurs vides omises ; langue sans
// contenu omise ; auteur entièrement vide ignoré. LF, fin de fichier à la ligne.
function serialiserMeta(valeurs) {
  const v = valeurs || {};
  const lignes = [];
  const type = String(v.type || '').trim();
  if (TYPES_ARTICLE.indexOf(type) !== -1) { lignes.push('type: ' + type); }
  const doi = String(v.doi || '').trim();
  if (doi !== '') { lignes.push('doi: ' + citerFrontmatter(doi)); }
  for (const cle of ['title', 'subtitle', 'resume']) {
    const map = v[cle] || {};
    const sous = [];
    for (const l of LANGUES_META) {
      const t = String(map[l] || '').trim();
      if (t !== '') { sous.push('  ' + l + ': ' + citerFrontmatter(t)); }
    }
    if (sous.length > 0) {
      lignes.push(cle + ':');
      for (const s of sous) { lignes.push(s); }
    }
  }
  const km = v.keywords || {};
  const sousMots = [];
  for (const l of LANGUES_META) {
    const liste = (Array.isArray(km[l]) ? km[l] : []).map((x) => String(x).trim()).filter((x) => x !== '');
    if (liste.length > 0) {
      sousMots.push('  ' + l + ':');
      for (const mot of liste) { sousMots.push('  - ' + citerFrontmatter(mot)); }
    }
  }
  if (sousMots.length > 0) {
    lignes.push('keywords:');
    for (const s of sousMots) { lignes.push(s); }
  }
  const auteurs = (Array.isArray(v.author) ? v.author : [])
    .map((a) => {
      const propre = {};
      for (const c of CHAMPS_AUTEUR) { propre[c] = String((a && a[c]) || '').trim(); }
      return propre;
    })
    .filter((a) => CHAMPS_AUTEUR.some((c) => a[c] !== ''));
  if (auteurs.length > 0) {
    lignes.push('author:');
    for (const a of auteurs) {
      let premiere = true;
      for (const c of CHAMPS_AUTEUR) {
        if (a[c] === '') { continue; }
        lignes.push((premiere ? '- ' : '  ') + c + ': ' + citerFrontmatter(a[c]));
        premiere = false;
      }
    }
  }
  for (const brute of (Array.isArray(v._inconnues) ? v._inconnues : [])) { lignes.push(brute); }
  return lignes.length > 0 ? lignes.join('\n') + '\n' : '';
}

// ---- Titre de la vue (N2, D43) -----------------------------------------------------
//
// « {Z|R}{AAAA}-{numero} | {title} » : Z pour une revue allemande (lang commence
// par de), R sinon ; AAAA = première séquence de 4 chiffres de `date` ; chaque
// morceau manquant est omis (le préfixe seul ne compte pas). Si rien n'est
// exploitable -> nom du dossier de la revue. Jamais de titre vide.
function titreNumero(racine) {
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* illisible : replis ci-dessous */ }
  const prefixe = String(valeurs.lang || '').toLowerCase().indexOf('de') === 0 ? 'Z' : 'R';
  const annee = (String(valeurs.date || '').match(/\d{4}/) || [''])[0];
  const numero = String(valeurs.numero || '').trim();
  const titre = String(valeurs.title || '').trim();
  const morceaux = [];
  if (annee || numero) { morceaux.push(prefixe + annee + (numero ? '-' + numero : '')); }
  if (titre) { morceaux.push(titre); }
  if (morceaux.length === 0) { return path.basename(racine); }
  return morceaux.join(' | ');
}

// Représentation YAML d'une valeur du formulaire. Tout est cité « "…" » (sûr pour
// deux-points, dièses, guillemets, accents), SAUF `lang` : le Makefile lit cette
// clé avec un sed qui ne comprend pas les guillemets (LANG_LUE) → jeton nu,
// restreint à [a-zA-Z-] (le formulaire ne propose que fr/de/en/it).
function formaterValeurYaml(cle, valeur) {
  if (cle === 'lang') { return String(valeur).replace(/[^a-zA-Z-]/g, '') || 'fr'; }
  return '"' + String(valeur).replace(/([\\"])/g, '\\$1') + '"';
}

// Réécrit `contenu` avec les clés de `modifies` : lignes existantes mises à jour
// (commentaire de fin conservé), clés absentes ajoutées en fin de fichier (ordre
// D37, sauf valeur vide : rien à ajouter). Aucune autre ligne n'est modifiée.
function serialiserAusgabe(contenu, modifies) {
  const eol = contenu.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
  const bom = contenu.charAt(0) === '\uFEFF' ? '\uFEFF' : '';
  const corps = bom ? contenu.slice(1) : contenu;
  const lignes = corps === '' ? [] : corps.split(/\r?\n/);
  if (lignes.length > 0 && lignes[lignes.length - 1] === '') { lignes.pop(); }
  const restantes = new Set(Object.keys(modifies));
  const resultat = lignes.map((ligne) => {
    const m = ligne.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m || !restantes.has(m[1])) { return ligne; }
    restantes.delete(m[1]);
    // `suite` garde ses espaces de tête (restitution telle quelle de l'alignement
    // du commentaire) ; s'il colle à la valeur (droit « "x"# c »), on intercale un espace.
    const suite = decouperValeurYaml(m[2]).suite;
    return m[1] + ': ' + formaterValeurYaml(m[1], modifies[m[1]]) + (suite ? (/^\s/.test(suite) ? suite : ' ' + suite) : '');
  });
  for (const cle of CLES_METADONNEES) {
    if (!restantes.has(cle)) { continue; }
    if (String(modifies[cle]) === '') { continue; }
    resultat.push(cle + ': ' + formaterValeurYaml(cle, modifies[cle]));
  }
  return bom + resultat.join(eol) + (resultat.length > 0 ? eol : '');
}

// Écriture atomique : temporaire « ~$… » dans le même dossier (préfixe ignoré par
// la synchro OneDrive, comme le PDF du Makefile) puis rename — jamais de fichier
// à moitié écrit, même si l'éditeur est fermé en plein enregistrement.
function ecrireAusgabeAtomique(chemin, contenu) {
  const tmp = path.join(path.dirname(chemin), '~$' + path.basename(chemin));
  try {
    fs.writeFileSync(tmp, contenu, 'utf8');
    fs.renameSync(tmp, chemin);
  } finally {
    try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (e) { /* déjà renommé */ }
  }
}

// Formulaire (webview) — CSP stricte : aucun réseau, styles inline, script à nonce.
// Les valeurs ne sont PAS injectées dans le HTML : elles arrivent par postMessage
// (le webview envoie « pret » au chargement), donc zéro échappement HTML à gérer.
function htmlMetadonnees(nonce) {
  const txt = JSON.stringify({
    indiceDate: T('meta.date.indice'),
    rien: T('form.rien'),
    enregistre: T('form.enregistre'),
    couleurAucune: T('meta.couleur.aucune'),
    couleurs: COULEURS_NUMERO.map((c) => ({ hex: c.hex, nom: T('meta.couleur.' + c.cle) }))
  });
  return '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\'">\n' +
    '<title>' + T('meta.titre') + '</title>\n' +
    '<style>\n' +
    'body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);\n' +
    '  color: var(--vscode-foreground); background: var(--vscode-editor-background);\n' +
    '  padding: 1rem 1.2rem; max-width: 34rem; }\n' +
    'h1 { font-size: 1.15em; font-weight: 600; margin: 0 0 .25rem; }\n' +
    'p.note { color: var(--vscode-descriptionForeground); margin: 0 0 1rem; font-size: .88em; }\n' +
    'label { display: block; margin: .8rem 0 .25rem; font-weight: 600; font-size: .92em; }\n' +
    'input, select { width: 100%; box-sizing: border-box; padding: .35em .5em; font: inherit;\n' +
    '  color: var(--vscode-input-foreground); background: var(--vscode-input-background);\n' +
    '  border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; }\n' +
    'input:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); }\n' +
    '.indice { color: var(--vscode-descriptionForeground); font-size: .82em; margin-top: .2rem; }\n' +
    '.pastilles { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .3rem; }\n' +
    '.pastille { display: inline-flex; align-items: center; gap: .4em; cursor: pointer;\n' +
    '  padding: .3em .7em .3em .4em; border: 1px solid var(--vscode-input-border, rgba(128,128,128,.4));\n' +
    '  border-radius: 999px; background: var(--vscode-input-background); color: var(--vscode-foreground);\n' +
    '  font: inherit; margin: 0; width: auto; box-sizing: border-box; }\n' +
    '.pastille .puce { width: 1em; height: 1em; border-radius: 50%; border: 1px solid rgba(128,128,128,.5); flex: 0 0 auto; }\n' +
    '.pastille[aria-pressed="true"] { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; font-weight: 600; }\n' +
    'button { margin-top: 1.2rem; padding: .45em 1.1em; border: none; border-radius: 2px; font: inherit;\n' +
    '  color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }\n' +
    'button:hover { background: var(--vscode-button-hoverBackground); }\n' +
    '#etat { margin-left: .8rem; font-size: .92em; color: var(--vscode-descriptionForeground); }\n' +
    '</style>\n</head>\n<body>\n' +
    '<h1>' + T('meta.titre') + '</h1>\n' +
    '<p class="note">' + T('meta.note') + '</p>\n' +
    '<form id="formulaire">\n' +
    '<label for="title">' + T('meta.title') + '</label><input id="title" type="text">\n' +
    '<label for="revue">' + T('meta.revue') + '</label><input id="revue" type="text">\n' +
    '<label for="volume">' + T('meta.volume') + '</label><input id="volume" type="text">\n' +
    '<label for="numero">' + T('meta.numero') + '</label><input id="numero" type="text">\n' +
    '<label for="date">' + T('meta.date') + '</label><input id="date" type="date">\n' +
    '<div class="indice" id="indiceDate" hidden></div>\n' +
    '<label for="lang">' + T('meta.langue') + '</label>\n' +
    '<select id="lang"><option value="">' + T('meta.langue.aucune') + '</option><option value="fr">' + T('meta.langue.fr') + '</option>' +
    '<option value="de">' + T('meta.langue.de') + '</option><option value="en">' + T('meta.langue.en') + '</option><option value="it">' + T('meta.langue.it') + '</option></select>\n' +
    '<label>' + T('meta.couleur') + '</label>\n' +
    '<div class="pastilles" id="couleurs"></div>\n' +
    '<button type="submit">' + T('form.enregistrer') + '</button><span id="etat" role="status"></span>\n' +
    '</form>\n' +
    '<script nonce="' + nonce + '">\n' +
    '(function () {\n' +
    "  'use strict';\n" +
    '  const TXT = ' + txt + ';\n' +
    '  const vscodeApi = acquireVsCodeApi();\n' +
    "  const CLES = ['title', 'revue', 'volume', 'numero', 'date', 'lang'];\n" +
    '  const modifies = new Set();\n' +
    "  const etat = document.getElementById('etat');\n" +
    "  let couleurChoisie = '';\n" +
    '  function majPastilles() {\n' +
    "    for (const b of document.querySelectorAll('#couleurs .pastille')) {\n" +
    "      b.setAttribute('aria-pressed', b.dataset.hex === couleurChoisie ? 'true' : 'false');\n" +
    '    }\n' +
    '  }\n' +
    '  function rendreCouleurs() {\n' +
    "    const conteneur = document.getElementById('couleurs');\n" +
    "    conteneur.textContent = '';\n" +
    "    const items = [{ hex: '', nom: TXT.couleurAucune }].concat(TXT.couleurs);\n" +
    '    for (const c of items) {\n' +
    "      const b = document.createElement('button');\n" +
    "      b.type = 'button';\n" +
    "      b.className = 'pastille';\n" +
    '      b.dataset.hex = c.hex;\n' +
    "      b.setAttribute('aria-pressed', 'false');\n" +
    '      if (c.hex) {\n' +
    "        const puce = document.createElement('span');\n" +
    "        puce.className = 'puce';\n" +
    '        puce.style.background = c.hex;\n' +
    '        b.appendChild(puce);\n' +
    '      }\n' +
    '      b.appendChild(document.createTextNode(c.nom));\n' +
    "      b.addEventListener('click', function () {\n" +
    '        couleurChoisie = c.hex;\n' +
    '        majPastilles();\n' +
    "        modifies.add('couleur');\n" +
    "        etat.textContent = '';\n" +
    '      });\n' +
    '      conteneur.appendChild(b);\n' +
    '    }\n' +
    '  }\n' +
    '  function remplir(valeurs) {\n' +
    '    for (const cle of CLES) {\n' +
    '      const champ = document.getElementById(cle);\n' +
    "      const v = valeurs[cle] === undefined ? '' : String(valeurs[cle]);\n" +
    '      champ.value = v;\n' +
    "      if (cle === 'date') {\n" +
    "        const indice = document.getElementById('indiceDate');\n" +
    '        if (v && champ.value !== v) {\n' +
    "          indice.textContent = TXT.indiceDate.split('{0}').join(v);\n" +
    '          indice.hidden = false;\n' +
    '        } else { indice.hidden = true; }\n' +
    '      }\n' +
    "      if (cle === 'lang' && champ.value !== v) { champ.value = ''; }\n" +
    '    }\n' +
    "    couleurChoisie = valeurs.couleur === undefined ? '' : String(valeurs.couleur);\n" +
    '    majPastilles();\n' +
    '    modifies.clear();\n' +
    "    etat.textContent = '';\n" +
    '  }\n' +
    '  for (const cle of CLES) {\n' +
    "    document.getElementById(cle).addEventListener('input', function () { modifies.add(cle); etat.textContent = ''; });\n" +
    '  }\n' +
    '  rendreCouleurs();\n' +
    "  document.getElementById('formulaire').addEventListener('submit', function (e) {\n" +
    '    e.preventDefault();\n' +
    '    if (modifies.size === 0) { etat.textContent = TXT.rien; return; }\n' +
    '    const envoi = {};\n' +
    '    for (const cle of modifies) {\n' +
    "      envoi[cle] = cle === 'couleur' ? couleurChoisie : document.getElementById(cle).value;\n" +
    '    }\n' +
    "    vscodeApi.postMessage({ type: 'enregistrer', modifies: envoi });\n" +
    '  });\n' +
    "  window.addEventListener('message', function (e) {\n" +
    '    const msg = e.data || {};\n' +
    "    if (msg.type === 'valeurs') { remplir(msg.valeurs || {}); }\n" +
    "    if (msg.type === 'enregistre') { modifies.clear(); etat.textContent = TXT.enregistre; }\n" +
    "    if (msg.type === 'erreur') { etat.textContent = '⚠ ' + msg.message; }\n" +
    '  });\n' +
    "  vscodeApi.postMessage({ type: 'pret' });\n" +
    '})();\n' +
    '</script>\n</body>\n</html>\n';
}

let panneauMetadonnees = null;

function envoyerValeursMetadonnees(panneau, chemin) {
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(chemin, 'utf8')); }
  catch (e) { /* fichier illisible : formulaire vide */ }
  panneau.webview.postMessage({ type: 'valeurs', valeurs: valeurs });
}

// Panneau singleton : rouvrir la commande RÉVÈLE le formulaire existant (valeurs
// relues du disque) au lieu d'en empiler un deuxième. Colonne 1 = côté texte.
// `rafraichirTout` (N2) : le titre de la vue suit immédiatement l'enregistrement.
function ouvrirMetadonnees(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  const chemin = path.join(racine, 'ausgabe.yaml');
  if (panneauMetadonnees) {
    panneauMetadonnees.reveal(vscode.ViewColumn.One);
    envoyerValeursMetadonnees(panneauMetadonnees, chemin);
    return;
  }
  const panneau = vscode.window.createWebviewPanel(
    'szhMetadonnees', T('meta.titre'), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauMetadonnees = panneau;
  panneau.onDidDispose(() => { if (panneauMetadonnees === panneau) { panneauMetadonnees = null; } });
  panneau.webview.html = htmlMetadonnees(crypto.randomBytes(16).toString('hex'));
  panneau.webview.onDidReceiveMessage((msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') { envoyerValeursMetadonnees(panneau, chemin); return; }
    if (msg.type !== 'enregistrer') { return; }
    // Seuls les champs MODIFIÉS arrivent : un champ que le formulaire n'a pas su
    // afficher (ex. date « 2026 » dans un type=date) n'est jamais écrasé en douce.
    const modifies = {};
    for (const cle of CLES_METADONNEES) {
      if (msg.modifies && typeof msg.modifies[cle] === 'string') {
        modifies[cle] = msg.modifies[cle].replace(/[\r\n]+/g, ' ').slice(0, 500).trim();
      }
    }
    // couleur (M7, D56) : soit vide (« aucune »), soit un hex de la palette —
    // toute autre valeur est ignorée (jamais écrite dans ausgabe.yaml).
    if ('couleur' in modifies) {
      const c = modifies.couleur.toUpperCase();
      if (c !== '' && HEX_COULEURS.indexOf(c) === -1) { delete modifies.couleur; }
      else { modifies.couleur = c; }
    }
    if (Object.keys(modifies).length === 0) { return; }
    try {
      let contenu = '';
      try { contenu = fs.readFileSync(chemin, 'utf8'); } catch (e) { /* absent : recréé plat */ }
      ecrireAusgabeAtomique(chemin, serialiserAusgabe(contenu, modifies));
      panneau.webview.postMessage({ type: 'enregistre' });
      vscode.window.setStatusBarMessage(T('statut.ausgabe'), 3000);
      if (rafraichirTout) { rafraichirTout(); }    // titre de la vue à jour (N2)
    } catch (e) {
      panneau.webview.postMessage({ type: 'erreur', message: T('err.ecriture', [e.message]) });
    }
  });
}

// ---- Éditeur des métadonnées de TOUS les articles (N7 refondu par M1, D49/D51) -----

// Webview « Métadonnées des articles » : une carte par article — type (menu
// déroulant traduit), doi, title/subtitle/keywords TRADUCTIBLES (FR/DE toujours,
// IT révélé par la case « + Italien »), auteurs répétables à 5 champs. DOM
// construit sans injection HTML, valeurs par postMessage, dirty PAR ARTICLE.
function htmlApercuMetadonnees(nonce) {
  const txt = JSON.stringify({
    type: T('fiches.type'), typeAucun: T('fiches.type.aucun'),
    titreChamp: T('fiches.titre.champ'), sousTitre: T('fiches.soustitre'),
    resume: T('fiches.resume'),
    auteurs: T('fiches.auteurs'), ajouterAuteur: T('fiches.auteur.ajouter'),
    retirerAuteur: T('fiches.auteur.retirer'),
    aPrenom: T('fiches.auteur.prenom'), aNom: T('fiches.auteur.nom'),
    aFonction: T('fiches.auteur.fonction'), aAffiliation: T('fiches.auteur.affiliation'),
    aOrcid: T('fiches.auteur.orcid'),
    motsCles: T('fiches.motscles'), italien: T('fiches.italien'),
    rien: T('form.rien'), enregistre: T('fiches.enregistre')
  });
  return '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\'">\n' +
    '<title>' + T('fiches.titre') + '</title>\n' +
    '<style>\n' +
    'body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);\n' +
    '  color: var(--vscode-foreground); background: var(--vscode-editor-background);\n' +
    '  padding: 1rem 1.2rem; max-width: 46rem; }\n' +
    'h1 { font-size: 1.15em; font-weight: 600; margin: 0 0 .25rem; }\n' +
    'p.note { color: var(--vscode-descriptionForeground); margin: 0 0 1rem; font-size: .88em; }\n' +
    '.carte { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35));\n' +
    '  border-radius: 4px; padding: .8rem 1rem 1rem; margin: 0 0 1rem; }\n' +
    '.carte h2 { font-size: 1em; font-weight: 600; margin: 0 0 .2rem; font-family: var(--vscode-editor-font-family, monospace); }\n' +
    'label { display: block; margin: .6rem 0 .2rem; font-weight: 600; font-size: .9em; }\n' +
    'input, select, textarea { width: 100%; box-sizing: border-box; padding: .3em .5em; font: inherit;\n' +
    '  color: var(--vscode-input-foreground); background: var(--vscode-input-background);\n' +
    '  border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; }\n' +
    'textarea { resize: vertical; min-height: 3.4em; font-family: inherit; }\n' +
    'input:focus, select:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); }\n' +
    '.auteur { display: flex; gap: .4rem; margin: .3rem 0; align-items: center; }\n' +
    '.auteur input { flex: 1 1 0; min-width: 0; }\n' +
    '.champ-it { display: none; }\n' +
    '.carte.avec-it .champ-it { display: block; }\n' +
    '.case-it { font-weight: normal; margin-top: .8rem; }\n' +
    '.case-it input { width: auto; margin-right: .35em; }\n' +
    'button { padding: .35em .9em; border: none; border-radius: 2px; font: inherit; cursor: pointer;\n' +
    '  color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));\n' +
    '  background: var(--vscode-button-secondaryBackground, var(--vscode-button-background)); }\n' +
    'button.principal { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }\n' +
    'button.principal:hover { background: var(--vscode-button-hoverBackground); }\n' +
    'button.retirer { flex: 0 0 auto; padding: .3em .6em; }\n' +
    '.barre { position: sticky; top: 0; background: var(--vscode-editor-background);\n' +
    '  padding: .4rem 0 .6rem; margin-bottom: .6rem; z-index: 1; }\n' +
    '#etat { margin-left: .8rem; font-size: .92em; color: var(--vscode-descriptionForeground); }\n' +
    '.modifie h2::after { content: " ●"; color: var(--vscode-charts-orange, orange); }\n' +
    '</style>\n</head>\n<body>\n' +
    '<h1>' + T('fiches.titre') + '</h1>\n' +
    '<p class="note">' + T('fiches.note') + '</p>\n' +
    '<div class="barre"><button class="principal" id="enregistrer">' + T('form.enregistrer') + '</button><span id="etat" role="status"></span></div>\n' +
    '<div id="cartes"></div>\n' +
    '<script nonce="' + nonce + '">\n' +
    '(function () {\n' +
    "  'use strict';\n" +
    '  const TXT = ' + txt + ';\n' +
    '  const vscodeApi = acquireVsCodeApi();\n' +
    "  const etat = document.getElementById('etat');\n" +
    "  const conteneur = document.getElementById('cartes');\n" +
    '  const modifies = new Set();\n' +
    '  let TYPES = [];\n' +
    '  function marquer(carte, slug) { modifies.add(slug); carte.classList.add(\'modifie\'); etat.textContent = \'\'; }\n' +
    '  function champTexte(carte, parent, slug, cle, langue, libelle, valeur, multiligne) {\n' +
    "    const l = document.createElement('label');\n" +
    '    l.textContent = libelle;\n' +
    "    const i = document.createElement(multiligne ? 'textarea' : 'input');\n" +
    "    if (multiligne) { i.rows = 3; } else { i.type = 'text'; }\n" +
    '    i.value = valeur || \'\';\n' +
    '    i.dataset.cle = cle;\n' +
    '    if (langue) { i.dataset.langue = langue; l.classList.add(\'champ-\' + langue); i.classList.add(\'champ-\' + langue); }\n' +
    "    i.addEventListener('input', function () { marquer(carte, slug); });\n" +
    '    parent.appendChild(l);\n' +
    '    parent.appendChild(i);\n' +
    '  }\n' +
    '  function ligneAuteur(carte, slug, zone, auteur) {\n' +
    "    const rangee = document.createElement('div');\n" +
    "    rangee.className = 'auteur';\n" +
    "    for (const [cle, indice] of [['prenom', TXT.aPrenom], ['nom', TXT.aNom], ['fonction', TXT.aFonction], ['affiliation', TXT.aAffiliation], ['orcid', TXT.aOrcid]]) {\n" +
    "      const i = document.createElement('input');\n" +
    "      i.type = 'text';\n" +
    '      i.placeholder = indice;\n' +
    '      i.title = indice;\n' +
    '      i.value = (auteur && auteur[cle]) || \'\';\n' +
    '      i.dataset.cle = cle;\n' +
    "      i.addEventListener('input', function () { marquer(carte, slug); });\n" +
    '      rangee.appendChild(i);\n' +
    '    }\n' +
    "    const retirer = document.createElement('button');\n" +
    "    retirer.type = 'button';\n" +
    "    retirer.className = 'retirer';\n" +
    "    retirer.textContent = '✕';\n" +
    '    retirer.title = TXT.retirerAuteur;\n' +
    "    retirer.addEventListener('click', function () { rangee.remove(); marquer(carte, slug); });\n" +
    '    rangee.appendChild(retirer);\n' +
    '    zone.appendChild(rangee);\n' +
    '  }\n' +
    '  function rendre(articles) {\n' +
    '    conteneur.textContent = \'\';\n' +
    '    modifies.clear();\n' +
    '    for (const article of articles) {\n' +
    "      const carte = document.createElement('div');\n" +
    "      carte.className = 'carte';\n" +
    '      carte.dataset.slug = article.slug;\n' +
    "      const titre = document.createElement('h2');\n" +
    '      titre.textContent = article.slug;\n' +
    '      carte.appendChild(titre);\n' +
    '      const v = article.valeurs || {};\n' +
    '      const avecIt = [\'title\', \'subtitle\', \'resume\'].some(function (c) { return v[c] && v[c].it; }) ||\n' +
    '        (v.keywords && v.keywords.it && v.keywords.it.length > 0);\n' +
    '      if (avecIt) { carte.classList.add(\'avec-it\'); }\n' +
    "      const lType = document.createElement('label');\n" +
    '      lType.textContent = TXT.type;\n' +
    '      carte.appendChild(lType);\n' +
    "      const selection = document.createElement('select');\n" +
    "      selection.dataset.cle = 'type';\n" +
    "      const optVide = document.createElement('option');\n" +
    "      optVide.value = '';\n" +
    '      optVide.textContent = TXT.typeAucun;\n' +
    '      selection.appendChild(optVide);\n' +
    '      for (const t of TYPES) {\n' +
    "        const opt = document.createElement('option');\n" +
    '        opt.value = t.valeur;\n' +
    '        opt.textContent = t.libelle;\n' +
    '        selection.appendChild(opt);\n' +
    '      }\n' +
    '      selection.value = v.type || \'\';\n' +
    '      if (selection.value !== (v.type || \'\')) { selection.value = \'\'; }\n' +
    "      selection.addEventListener('input', function () { marquer(carte, article.slug); });\n" +
    '      carte.appendChild(selection);\n' +
    '      const langues = [\'fr\', \'de\', \'it\'];   // IT toujours construit, révélé par CSS\n' +
    '      const nomsLangues = { fr: \'FR\', de: \'DE\', it: \'IT\' };\n' +
    '      for (const lg of langues) {\n' +
    '        champTexte(carte, carte, article.slug, \'title\', lg, TXT.titreChamp.split(\'{0}\').join(nomsLangues[lg]), (v.title || {})[lg]);\n' +
    '      }\n' +
    '      for (const lg of langues) {\n' +
    '        champTexte(carte, carte, article.slug, \'subtitle\', lg, TXT.sousTitre.split(\'{0}\').join(nomsLangues[lg]), (v.subtitle || {})[lg]);\n' +
    '      }\n' +
    '      for (const lg of langues) {\n' +
    '        champTexte(carte, carte, article.slug, \'resume\', lg, TXT.resume.split(\'{0}\').join(nomsLangues[lg]), (v.resume || {})[lg], true);\n' +
    '      }\n' +
    "      const lAuteurs = document.createElement('label');\n" +
    '      lAuteurs.textContent = TXT.auteurs;\n' +
    '      carte.appendChild(lAuteurs);\n' +
    "      const zone = document.createElement('div');\n" +
    "      zone.className = 'auteurs';\n" +
    '      carte.appendChild(zone);\n' +
    '      for (const a of (v.author || [])) { ligneAuteur(carte, article.slug, zone, a); }\n' +
    "      const ajouter = document.createElement('button');\n" +
    "      ajouter.type = 'button';\n" +
    '      ajouter.textContent = TXT.ajouterAuteur;\n' +
    "      ajouter.addEventListener('click', function () { ligneAuteur(carte, article.slug, zone, null); marquer(carte, article.slug); });\n" +
    '      carte.appendChild(ajouter);\n' +
    '      champTexte(carte, carte, article.slug, \'doi\', null, \'DOI\', v.doi);\n' +
    '      for (const lg of langues) {\n' +
    '        champTexte(carte, carte, article.slug, \'keywords\', lg, TXT.motsCles.split(\'{0}\').join(nomsLangues[lg]), ((v.keywords || {})[lg] || []).join(\', \'));\n' +
    '      }\n' +
    '      const caseIt = document.createElement(\'label\');\n' +
    "      caseIt.className = 'case-it';\n" +
    "      const coche = document.createElement('input');\n" +
    "      coche.type = 'checkbox';\n" +
    '      coche.checked = avecIt;\n' +
    '      caseIt.appendChild(coche);\n' +
    '      caseIt.appendChild(document.createTextNode(TXT.italien));\n' +
    "      coche.addEventListener('change', function () {\n" +
    "        carte.classList.toggle('avec-it', coche.checked);\n" +
    '      });\n' +
    '      carte.appendChild(caseIt);\n' +
    '      conteneur.appendChild(carte);\n' +
    '    }\n' +
    '  }\n' +
    '  function collecter(carte) {\n' +
    '    const resultat = { type: \'\', doi: \'\', title: {}, subtitle: {}, resume: {}, keywords: {}, author: [] };\n' +
    "    const sel = carte.querySelector('select[data-cle=type]');\n" +
    '    if (sel) { resultat.type = sel.value; }\n' +
    "    for (const i of carte.querySelectorAll(':scope > input, :scope > textarea')) {\n" +
    '      const cle = i.dataset.cle;\n' +
    '      const langue = i.dataset.langue;\n' +
    "      if (cle === 'doi') { resultat.doi = i.value; }\n" +
    "      else if (cle === 'title' || cle === 'subtitle' || cle === 'resume') { resultat[cle][langue] = i.value; }\n" +
    "      else if (cle === 'keywords') {\n" +
    '        resultat.keywords[langue] = i.value.split(\',\').map(function (s) { return s.trim(); }).filter(function (s) { return s !== \'\'; });\n' +
    '      }\n' +
    '    }\n' +
    "    for (const rangee of carte.querySelectorAll('.auteur')) {\n" +
    '      const a = {};\n' +
    "      for (const i of rangee.querySelectorAll('input')) { a[i.dataset.cle] = i.value; }\n" +
    '      resultat.author.push(a);\n' +
    '    }\n' +
    '    return resultat;\n' +
    '  }\n' +
    "  document.getElementById('enregistrer').addEventListener('click', function () {\n" +
    '    if (modifies.size === 0) { etat.textContent = TXT.rien; return; }\n' +
    '    const envoi = {};\n' +
    "    for (const carte of conteneur.querySelectorAll('.carte')) {\n" +
    '      if (modifies.has(carte.dataset.slug)) { envoi[carte.dataset.slug] = collecter(carte); }\n' +
    '    }\n' +
    "    vscodeApi.postMessage({ type: 'enregistrer', articles: envoi });\n" +
    '  });\n' +
    "  window.addEventListener('message', function (e) {\n" +
    '    const msg = e.data || {};\n' +
    "    if (msg.type === 'valeurs') { TYPES = msg.types || []; rendre(msg.articles || []); }\n" +
    "    if (msg.type === 'enregistre') { etat.textContent = TXT.enregistre.split('{0}').join(msg.n); }\n" +
    "    if (msg.type === 'erreur') { etat.textContent = '⚠ ' + msg.message; }\n" +
    '  });\n' +
    "  vscodeApi.postMessage({ type: 'pret' });\n" +
    '})();\n' +
    '</script>\n</body>\n</html>\n';
}

let panneauArticles = null;

function cheminMeta(racine, slug) {
  return path.join(racine, 'articles', slug, slug + '.meta.yaml');
}

// Migration défensive (M1, idempotente) : un <slug>.md qui porte encore un
// frontmatter N7 (lot non déployé) est déplacé vers <slug>.meta.yaml — scalaires
// rangés sous la langue de la revue, name -> nom — puis le frontmatter est retiré
// du .md (le bloc disparaît s'il ne contenait que des clés gérées). Sans objet
// (no-op) si le .meta.yaml existe déjà ou si le .md n'a pas de frontmatter géré.
function migrerFrontmatterVersMeta(racine, slug) {
  const fichierMeta = cheminMeta(racine, slug);
  if (fs.existsSync(fichierMeta)) { return; }
  const fichierMd = path.join(racine, 'articles', slug, slug + '.md');
  let texte;
  try { texte = fs.readFileSync(fichierMd, 'utf8'); } catch (e) { return; }
  const partie = separerFrontmatter(texte);
  if (partie.fm === null) { return; }
  const ancien = analyserFrontmatter(partie.fm);
  const aDesCles = ancien.title !== undefined || ancien.subtitle !== undefined ||
    ancien.doi !== undefined || (ancien.author || []).length > 0 || (ancien.keywords || []).length > 0;
  if (!aDesCles) { return; }
  const langue = langueRevue(racine);
  const valeurs = { type: '', doi: String(ancien.doi || ''), title: {}, subtitle: {}, keywords: {}, author: [] };
  if (ancien.title) { valeurs.title[langue] = String(ancien.title); }
  if (ancien.subtitle) { valeurs.subtitle[langue] = String(ancien.subtitle); }
  if ((ancien.keywords || []).length > 0) { valeurs.keywords[langue] = ancien.keywords.map(String); }
  for (const a of (ancien.author || [])) {
    valeurs.author.push({ prenom: '', nom: String(a.name || ''), fonction: '', affiliation: String(a.affiliation || ''), orcid: String(a.orcid || '') });
  }
  try {
    ecrireAusgabeAtomique(fichierMeta, serialiserMeta(valeurs));
    ecrireAusgabeAtomique(fichierMd, serialiserFrontmatter(texte, { title: '', subtitle: '', doi: '', author: [], keywords: [] }));
  } catch (e) { /* migration best effort : la carte restera vide */ }
}

function lireMetadonneesArticles(fournisseur) {
  const articles = [];
  for (const slug of fournisseur.listerArticles()) {
    migrerFrontmatterVersMeta(fournisseur.racine, slug);
    let valeurs = { type: '', doi: '', title: {}, subtitle: {}, resume: {}, keywords: {}, author: [] };
    try {
      valeurs = analyserMeta(fs.readFileSync(cheminMeta(fournisseur.racine, slug), 'utf8'));
    } catch (e) { /* pas encore de fiche : carte vide */ }
    delete valeurs._inconnues;                     // le webview n'a pas à les voir
    articles.push({ slug: slug, valeurs: valeurs });
  }
  return articles;
}

// Nettoie une carte reçue du webview (types + bornes ; le slug est validé contre
// la liste réelle des articles — jamais de chemin construit sur une entrée libre).
function nettoyerCarte(brut) {
  const texteCourt = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, max).trim();
  const carte = { type: '', doi: texteCourt(brut && brut.doi, 200), title: {}, subtitle: {}, resume: {}, keywords: {}, author: [] };
  const type = texteCourt(brut && brut.type, 40);
  if (TYPES_ARTICLE.indexOf(type) !== -1) { carte.type = type; }
  for (const cle of ['title', 'subtitle', 'resume']) {
    const map = (brut && brut[cle]) || {};
    const max = cle === 'resume' ? 2000 : 500;   // le résumé est un abrégé, plus long
    for (const l of LANGUES_META) {
      const t = texteCourt(map[l], max);
      if (t !== '') { carte[cle][l] = t; }
    }
  }
  const km = (brut && brut.keywords) || {};
  for (const l of LANGUES_META) {
    if (!Array.isArray(km[l])) { continue; }
    const liste = [];
    for (const k of km[l].slice(0, 50)) {
      const v = texteCourt(k, 100);
      if (v !== '') { liste.push(v); }
    }
    if (liste.length > 0) { carte.keywords[l] = liste; }
  }
  if (brut && Array.isArray(brut.author)) {
    for (const a of brut.author.slice(0, 20)) {
      const propre = {};
      for (const c of CHAMPS_AUTEUR) { propre[c] = texteCourt(a && a[c], 300); }
      carte.author.push(propre);
    }
  }
  return carte;
}

function ouvrirApercuMetadonnees(fournisseur, rafraichirTout) {
  if (!fournisseur.racine) { return; }
  const envoyerValeurs = (panneau) => {
    const langue = langueRevue(fournisseur.racine);
    panneau.webview.postMessage({
      type: 'valeurs',
      articles: lireMetadonneesArticles(fournisseur),
      langue: langue,
      types: TYPES_ARTICLE.map((t) => ({ valeur: t, libelle: (LIBELLES_TYPES[t] || {})[langue] || t }))
    });
  };
  if (panneauArticles) {
    panneauArticles.reveal(vscode.ViewColumn.One);
    envoyerValeurs(panneauArticles);
    return;
  }
  const panneau = vscode.window.createWebviewPanel(
    'szhApercuMetadonnees', T('fiches.titre'), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauArticles = panneau;
  panneau.onDidDispose(() => { if (panneauArticles === panneau) { panneauArticles = null; } });
  panneau.webview.html = htmlApercuMetadonnees(crypto.randomBytes(16).toString('hex'));
  panneau.webview.onDidReceiveMessage((msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') { envoyerValeurs(panneau); return; }
    if (msg.type !== 'enregistrer' || !msg.articles) { return; }
    const connus = new Set(fournisseur.listerArticles());
    let n = 0;
    const erreurs = [];
    for (const slug of Object.keys(msg.articles)) {
      if (!connus.has(slug)) { continue; }         // slug inconnu : ignoré (sécurité)
      const fichierMeta = cheminMeta(fournisseur.racine, slug);
      try {
        // Fichier « form-owned » : régénéré — mais les clés inconnues de haut
        // niveau de la fiche existante sont restituées par prudence (D49).
        const carte = nettoyerCarte(msg.articles[slug]);
        try { carte._inconnues = analyserMeta(fs.readFileSync(fichierMeta, 'utf8'))._inconnues; }
        catch (e) { /* pas de fiche existante */ }
        ecrireAusgabeAtomique(fichierMeta, serialiserMeta(carte));
        n++;
      } catch (e) {
        erreurs.push(slug + ' (' + e.message + ')');
      }
    }
    if (erreurs.length > 0) {
      panneau.webview.postMessage({ type: 'erreur', message: T('err.ecriture', [erreurs.join(', ')]) });
    } else {
      panneau.webview.postMessage({ type: 'enregistre', n: n });
      vscode.window.setStatusBarMessage(T('statut.fiches', [n]), 3000);
    }
    if (rafraichirTout) { rafraichirTout(); }
    envoyerValeurs(panneau);                       // resynchronise les cartes (dirty remis à zéro)
  });
}

// ---- Réglages « SZH » (M4, D52) -----------------------------------------------------
//
// Formulaire webview qui écrit les réglages AU NIVEAU UTILISATEUR via l'API
// getConfiguration().update(…, Global) — jamais d'édition manuelle de
// settings.json. Chaque changement s'applique immédiatement. Thèmes : uniquement
// Default Light/Dark Modern (intégrés). La langue FR/DE pilote les chaînes du
// cockpit (szh.langue) ET la locale native (argv.json, redémarrage requis —
// menus natifs DE seulement si le pack de langue est déployé, cf. vsix.lock).

const REGL_TEXTES = () => JSON.stringify({
  theme: T('regl.theme'),
  themeSysteme: T('regl.theme.systeme'), themeClair: T('regl.theme.clair'), themeSombre: T('regl.theme.sombre'),
  zoom: T('regl.zoom'),
  zoomNormal: T('regl.zoom.normal'), zoomGrand: T('regl.zoom.grand'), zoomTresGrand: T('regl.zoom.tresgrand'),
  policeMd: T('regl.policemd'),
  langue: T('regl.langue'), langueNote: T('regl.langue.note')
});

function htmlReglages(nonce) {
  return '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\'">\n' +
    '<title>' + T('regl.titre') + '</title>\n' +
    '<style>\n' +
    'body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);\n' +
    '  color: var(--vscode-foreground); background: var(--vscode-editor-background);\n' +
    '  padding: 1rem 1.2rem; max-width: 34rem; }\n' +
    'h1 { font-size: 1.15em; font-weight: 600; margin: 0 0 .25rem; }\n' +
    'p.note { color: var(--vscode-descriptionForeground); margin: 0 0 1rem; font-size: .88em; }\n' +
    'fieldset { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35));\n' +
    '  border-radius: 4px; margin: 0 0 1rem; padding: .6rem 1rem .8rem; }\n' +
    'legend { font-weight: 600; padding: 0 .4em; }\n' +
    'label { display: inline-flex; align-items: center; margin: .25rem 1.1rem .25rem 0; gap: .35em; }\n' +
    '.indice { color: var(--vscode-descriptionForeground); font-size: .82em; margin-top: .3rem; }\n' +
    '</style>\n</head>\n<body>\n' +
    '<h1>' + T('regl.titre') + '</h1>\n' +
    '<p class="note">' + T('regl.note') + '</p>\n' +
    '<div id="zones"></div>\n' +
    '<script nonce="' + nonce + '">\n' +
    '(function () {\n' +
    "  'use strict';\n" +
    '  const TXT = ' + REGL_TEXTES() + ';\n' +
    '  const vscodeApi = acquireVsCodeApi();\n' +
    "  const zones = document.getElementById('zones');\n" +
    '  const GROUPES = [\n' +
    "    { cle: 'theme', legende: TXT.theme, options: [['systeme', TXT.themeSysteme], ['clair', TXT.themeClair], ['sombre', TXT.themeSombre]] },\n" +
    "    { cle: 'zoom', legende: TXT.zoom, options: [['0', TXT.zoomNormal], ['1', TXT.zoomGrand], ['2', TXT.zoomTresGrand]] },\n" +
    "    { cle: 'policeMd', legende: TXT.policeMd, options: [['14', '14 px'], ['16', '16 px'], ['18', '18 px']] },\n" +
    "    { cle: 'langue', legende: TXT.langue, options: [['fr', 'Français'], ['de', 'Deutsch']], indice: TXT.langueNote }\n" +
    '  ];\n' +
    '  function rendre() {\n' +
    '    for (const g of GROUPES) {\n' +
    "      const zone = document.createElement('fieldset');\n" +
    "      const legende = document.createElement('legend');\n" +
    '      legende.textContent = g.legende;\n' +
    '      zone.appendChild(legende);\n' +
    '      for (const [valeur, libelle] of g.options) {\n' +
    "        const l = document.createElement('label');\n" +
    "        const radio = document.createElement('input');\n" +
    "        radio.type = 'radio';\n" +
    '        radio.name = g.cle;\n' +
    '        radio.value = valeur;\n' +
    "        radio.addEventListener('change', function () {\n" +
    "          vscodeApi.postMessage({ type: 'regler', cle: g.cle, valeur: valeur });\n" +
    '        });\n' +
    '        l.appendChild(radio);\n' +
    '        l.appendChild(document.createTextNode(libelle));\n' +
    '        zone.appendChild(l);\n' +
    '      }\n' +
    '      if (g.indice) {\n' +
    "        const indice = document.createElement('div');\n" +
    "        indice.className = 'indice';\n" +
    '        indice.textContent = g.indice;\n' +
    '        zone.appendChild(indice);\n' +
    '      }\n' +
    '      zones.appendChild(zone);\n' +
    '    }\n' +
    '  }\n' +
    '  function cocher(valeurs) {\n' +
    '    for (const cle of Object.keys(valeurs)) {\n' +
    "      const radio = document.querySelector('input[name=\"' + cle + '\"][value=\"' + String(valeurs[cle]) + '\"]');\n" +
    '      if (radio) { radio.checked = true; }\n' +
    '    }\n' +
    '  }\n' +
    '  rendre();\n' +
    "  window.addEventListener('message', function (e) {\n" +
    '    const msg = e.data || {};\n' +
    "    if (msg.type === 'valeurs') { cocher(msg.valeurs || {}); }\n" +
    '  });\n' +
    "  vscodeApi.postMessage({ type: 'pret' });\n" +
    '})();\n' +
    '</script>\n</body>\n</html>\n';
}

// Écrit/Met à jour "locale" dans %APPDATA%\VSCodium\argv.json — édition ciblée
// par regex (le fichier accepte des commentaires : pas de JSON.parse/stringify
// qui les perdrait). Retourne false en cas d'échec (signalé sobrement).
function ecrireLocaleArgv(langue) {
  try {
    const dossier = path.join(process.env.APPDATA || '', 'VSCodium');
    const chemin = path.join(dossier, 'argv.json');
    let contenu = '';
    try { contenu = fs.readFileSync(chemin, 'utf8'); } catch (e) { contenu = '{\n}\n'; }
    if (/"locale"\s*:\s*"[^"]*"/.test(contenu)) {
      contenu = contenu.replace(/"locale"\s*:\s*"[^"]*"/, '"locale": "' + langue + '"');
    } else {
      const pos = contenu.lastIndexOf('}');
      if (pos === -1) {
        contenu = '{\n\t"locale": "' + langue + '"\n}\n';
      } else {
        const avant = contenu.slice(0, pos).replace(/\s*$/, '');
        const virgule = /[{,]\s*$/.test(avant) ? '' : ',';
        contenu = avant + virgule + '\n\t"locale": "' + langue + '"\n' + contenu.slice(pos);
      }
    }
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(chemin, contenu, 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

function lireReglagesActuels() {
  const cfg = vscode.workspace.getConfiguration();
  const autoDetect = cfg.get('window.autoDetectColorScheme', false) === true;
  const theme = String(cfg.get('workbench.colorTheme', '') || '');
  const etatTheme = autoDetect ? 'systeme'
    : (theme.toLowerCase().indexOf('light') !== -1 ? 'clair' : 'sombre');
  const zoom = Number(cfg.get('window.zoomLevel', 0)) || 0;
  let policeMd = 16;
  try {
    policeMd = Number(vscode.workspace.getConfiguration('editor', { languageId: 'markdown' }).get('fontSize', 16)) || 16;
  } catch (e) { /* repli 16 */ }
  return { theme: etatTheme, zoom: String(zoom), policeMd: String(policeMd), langue: langueCockpit() };
}

let panneauReglages = null;

function ouvrirReglages(rafraichirTout) {
  if (panneauReglages) {
    panneauReglages.reveal(vscode.ViewColumn.One);
    panneauReglages.webview.postMessage({ type: 'valeurs', valeurs: lireReglagesActuels() });
    return;
  }
  const panneau = vscode.window.createWebviewPanel(
    'szhReglages', T('regl.titre'), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauReglages = panneau;
  panneau.onDidDispose(() => { if (panneauReglages === panneau) { panneauReglages = null; } });
  panneau.webview.html = htmlReglages(crypto.randomBytes(16).toString('hex'));
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') {
      panneau.webview.postMessage({ type: 'valeurs', valeurs: lireReglagesActuels() });
      return;
    }
    if (msg.type !== 'regler') { return; }
    const Global = vscode.ConfigurationTarget.Global;
    const cfg = vscode.workspace.getConfiguration();
    try {
      if (msg.cle === 'theme') {
        if (msg.valeur === 'systeme') {
          await cfg.update('workbench.preferredLightColorTheme', 'Default Light Modern', Global);
          await cfg.update('workbench.preferredDarkColorTheme', 'Default Dark Modern', Global);
          await cfg.update('window.autoDetectColorScheme', true, Global);
        } else {
          await cfg.update('window.autoDetectColorScheme', false, Global);
          await cfg.update('workbench.colorTheme',
            msg.valeur === 'clair' ? 'Default Light Modern' : 'Default Dark Modern', Global);
        }
      } else if (msg.cle === 'zoom') {
        await cfg.update('window.zoomLevel', Number(msg.valeur) || 0, Global);
      } else if (msg.cle === 'policeMd') {
        // Scopé [markdown] : la taille du CONTENU affiché, pas le contenu lui-même.
        await vscode.workspace.getConfiguration('editor', { languageId: 'markdown' })
          .update('fontSize', Number(msg.valeur) || 16, Global, true);
      } else if (msg.cle === 'langue') {
        const langue = msg.valeur === 'de' ? 'de' : 'fr';
        await vscode.workspace.getConfiguration('szh').update('langue', langue, Global);
        ecrireLocaleArgv(langue);                  // langue native : au prochain démarrage
        vscode.window.showInformationMessage(T('info.redemarrer'));
        if (rafraichirTout) { rafraichirTout(); }  // libellés de l'arbre à jour tout de suite
      }
    } catch (e) {
      vscode.window.showErrorMessage(T('err.ecriture', [e.message]));
    }
  });
}

// ---- Mise en forme au clic droit + raccourcis (M6, D55) ----------------------------
//
// Sous-menu « Mise en forme » (editor/context, markdown) + raccourcis clavier
// (keybindings.json). Chaque action transforme la SÉLECTION via editor.edit.
// Les transformations sont des fonctions PURES (testées headless via _pur) ;
// les enrobages inline sont des TOGGLES (ré-appliquer retire le marquage).
// Blocs = classes canoniques .important / .highlight / .question ; citation =
// blockquote natif « > » ; le bloc « important » porte un titre paramétrable
// (::: {.important data-titre="…"}), rendu par print.css.

function estEnrobe(t, marqueur) {
  if (t.length < marqueur.length * 2) { return false; }
  if (!t.startsWith(marqueur) || !t.endsWith(marqueur)) { return false; }
  // Italique (*) : ne pas confondre avec gras (**) — sinon « **x** » se dé-graisserait
  // en « *x* » au lieu d'ajouter l'italique.
  if (marqueur === '*' && (t.startsWith('**') || t.endsWith('**'))) { return false; }
  return true;
}

// Toggle **…** (gras) ou *…* (italique) sur la sélection.
function basculerEnrobage(texte, marqueur) {
  const t = String(texte);
  if (estEnrobe(t, marqueur)) { return t.slice(marqueur.length, t.length - marqueur.length); }
  return marqueur + t + marqueur;
}

// Toggle [texte]{.underline} (souligné — attribut natif Pandoc).
function basculerSouligne(texte) {
  const t = String(texte);
  const m = t.match(/^\[([\s\S]*)\]\{\.underline\}$/);
  return m ? m[1] : '[' + t + ']{.underline}';
}

// Toggle de titre : préfixe #/##/### selon `niveau`. Même niveau -> retire ;
// niveau différent -> remplace ; aucun -> ajoute.
function basculerTitre(texte, niveau) {
  const t = String(texte);
  const m = t.match(/^(#{1,6})\s+/);
  if (m && m[1].length === niveau) { return t.replace(/^#{1,6}\s+/, ''); }
  return '#'.repeat(niveau) + ' ' + t.replace(/^#{1,6}\s+/, '');
}

// Toggle de citation : « > » par ligne (blockquote natif). Retire si toutes les
// lignes non vides sont déjà citées.
function basculerCitation(texte) {
  const lignes = String(texte).split('\n');
  const nonVides = lignes.filter((l) => l !== '');
  const toutesCitees = nonVides.length > 0 && nonVides.every((l) => /^>\s?/.test(l));
  if (toutesCitees) { return lignes.map((l) => l.replace(/^>\s?/, '')).join('\n'); }
  return lignes.map((l) => '> ' + l).join('\n');
}

// Enrobe la sélection dans un bloc « fenced div » Pandoc. `titre` (bloc important
// seulement) devient data-titre, rendu par CSS ; les guillemets en sont retirés.
function enroberBloc(texte, classe, titre) {
  const t = String(texte);
  const titrePropre = String(titre || '').replace(/"/g, '').trim();
  const attr = titrePropre ? '{.' + classe + ' data-titre="' + titrePropre + '"}' : '{.' + classe + '}';
  return '::: ' + attr + '\n' + t + '\n:::';
}

// Squelette de tableau Markdown (3 colonnes, 2 lignes) — édité ensuite via
// markdowntable (Tab) ou collage Excel (Maj+Alt+V).
function squeletteTableau(colonne) {
  const c = String(colonne || 'Colonne');
  return [
    '| ' + c + ' 1 | ' + c + ' 2 | ' + c + ' 3 |',
    '|---|---|---|',
    '|  |  |  |',
    '|  |  |  |'
  ].join('\n');
}

// Applique `transformer` (fonction pure texte->texte) à la sélection courante.
// opt.parLigne : étend la sélection aux lignes entières (titres, citation).
// opt.milieu : après une insertion sur sélection vide, place le curseur à N
// caractères du début (entre les marqueurs).
async function appliquerSelection(transformer, opt) {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  opt = opt || {};
  const doc = editeur.document;
  let sel = editeur.selection;
  if (opt.parLigne) {
    sel = new vscode.Selection(new vscode.Position(sel.start.line, 0), doc.lineAt(sel.end.line).range.end);
  }
  const texte = doc.getText(sel);
  const vide = texte === '';
  await editeur.edit((b) => { b.replace(sel, transformer(texte)); });
  if (vide && typeof opt.milieu === 'number') {
    const pos = doc.positionAt(doc.offsetAt(sel.start) + opt.milieu);
    editeur.selection = new vscode.Selection(pos, pos);
  }
}

// QuickPick de titres pour le bloc « important » (localisés + saisie libre).
// Retourne undefined si l'utilisateur annule (rien n'est inséré).
async function choisirTitreImportant() {
  const presets = [
    T('fmt.titre.information'), T('fmt.titre.important'),
    T('fmt.titre.attention'), T('fmt.titre.note')
  ];
  const autre = T('fmt.titre.autre');
  const choix = await vscode.window.showQuickPick(presets.concat([autre]), {
    placeHolder: T('fmt.titre.placeholder')
  });
  if (choix === undefined) { return undefined; }
  if (choix !== autre) { return choix; }
  const libre = await vscode.window.showInputBox({ prompt: T('fmt.titre.libre') });
  return libre === undefined ? undefined : libre.trim();
}

async function fmtImportant() {
  const titre = await choisirTitreImportant();
  if (titre === undefined) { return; }               // annulé : rien n'est inséré
  await appliquerSelection((t) => enroberBloc(t, 'important', titre));
}

// Nom de fichier libre dans `dossier` (jamais d'écrasement d'un média existant).
function nomMediaUnique(dossier, nom) {
  const ext = path.extname(nom);
  const base = path.basename(nom, ext);
  let candidat = nom;
  let i = 1;
  while (fs.existsSync(path.join(dossier, candidat))) { candidat = base + '-' + i + ext; i++; }
  return candidat;
}

// Insérer une figure : choisir une image, la copier dans articles/<slug>/media/
// (nom rendu unique), insérer ![Légende](media/nom.ext) à la sélection.
async function fmtFigure() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const doc = editeur.document;
  if (!/\.md$/i.test(doc.uri.fsPath)) {
    vscode.window.showInformationMessage(T('fmt.figure.horsarticle'));
    return;
  }
  const filtres = {};
  filtres[T('fmt.figure.filtre')] = ['png', 'jpg', 'jpeg', 'gif', 'svg'];
  const choix = await vscode.window.showOpenDialog({
    canSelectMany: false, filters: filtres,
    openLabel: T('fmt.figure.bouton'), title: T('fmt.figure.titre')
  });
  if (!choix || choix.length === 0) { return; }      // dialogue annulé
  const source = choix[0].fsPath;
  const mediaDir = path.join(path.dirname(doc.uri.fsPath), 'media');
  try { fs.mkdirSync(mediaDir, { recursive: true }); } catch (e) { /* existe déjà */ }
  const nom = nomMediaUnique(mediaDir, path.basename(source));
  try { fs.copyFileSync(source, path.join(mediaDir, nom)); }
  catch (e) { vscode.window.showErrorMessage(T('err.copie', [path.basename(source), e.message])); return; }
  const md = '![' + T('fmt.figure.legende') + '](media/' + nom + ')';
  await editeur.edit((b) => { b.replace(editeur.selection, md); });
  vscode.window.setStatusBarMessage(T('fmt.figure.copiee', [nom]), 4000);
}

function fmtTableau() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const sq = squeletteTableau(T('fmt.tableau.colonne'));
  return editeur.edit((b) => { b.replace(editeur.selection, sq); });
}

function enregistrerCommandesMiseEnForme(context) {
  const c = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  c('szh.fmt.gras', () => appliquerSelection((t) => basculerEnrobage(t, '**'), { milieu: 2 }));
  c('szh.fmt.italique', () => appliquerSelection((t) => basculerEnrobage(t, '*'), { milieu: 1 }));
  c('szh.fmt.souligne', () => appliquerSelection((t) => basculerSouligne(t), { milieu: 1 }));
  c('szh.fmt.titre1', () => appliquerSelection((t) => basculerTitre(t, 1), { parLigne: true }));
  c('szh.fmt.titre2', () => appliquerSelection((t) => basculerTitre(t, 2), { parLigne: true }));
  c('szh.fmt.titre3', () => appliquerSelection((t) => basculerTitre(t, 3), { parLigne: true }));
  c('szh.fmt.important', () => fmtImportant());
  c('szh.fmt.highlight', () => appliquerSelection((t) => enroberBloc(t, 'highlight', '')));
  c('szh.fmt.question', () => appliquerSelection((t) => enroberBloc(t, 'question', '')));
  c('szh.fmt.citation', () => appliquerSelection((t) => basculerCitation(t), { parLigne: true }));
  c('szh.fmt.figure', () => fmtFigure());
  c('szh.fmt.tableau', () => fmtTableau());
}

// ---- Éditeur de tableau maison (webview) — D57, T1 -------------------------------
//
// L'asset tableau (viewItem == table) reste un <table> autonome dans
// articles/<slug>/tables/table-NN.html. « Éditer » (szh.editerTable) ouvre une
// webview (grille éditable) qui charge le fichier, l'édite (texte + fusions +
// ajout/suppression de lignes/colonnes) et le réécrit (écriture atomique).
//
// PARSEUR / SÉRIALISEUR PURS (exportés via _pur, testés headless) :
//   analyserTable(html)  -> modèle { attrs, lignes:[{ total, teinte, gras,
//                            cellules:[{ contenu, colspan, rowspan, th, scope }] }] }
//   serialiserTable(mod) -> <table>…</table> propre et STABLE.
// Contrat GATE : analyser -> serialiser -> analyser identique (table nue M2 comprise).
//
// MODÈLE (encodage HTML, cf. PLAN-TABLEAU §Modèle) : le fichier est un <table
// class="szh-tableau"> ; le style est porté par des attributs data-* sur <table>
// et <tr> ; les en-têtes par <th scope>. Le contenu de cellule est de l'inline
// simple : texte échappé, <strong>, <em>, <br> (canonisé, jamais d'injection).
//
// Robustesse : un <table> nu (import M2, docx-tables.py) s'ouvre en mode neutre —
// les <th> d'en-tête sont préservés (comptes data-entete-* déduits à la volée).

// Attributs HTML d'une chaîne « a="b" c='d' e » -> { a:'b', c:'d', e:'' } (clés en
// minuscules). Best effort, tolérant (valeurs nues, guillemets simples/doubles).
function lireAttributsHtml(source) {
  const attrs = {};
  const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(String(source))) !== null) {
    const val = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));
    attrs[m[1].toLowerCase()] = val;
  }
  return attrs;
}

// Canonise le contenu inline d'une cellule : ne garde que <strong>/<em>/<br> et le
// texte (déjà échappé), normalise <b>->strong, <i>->em, <br/>->br, retire tout
// autre balisage (texte conservé). Idempotent — clé du round-trip stable.
function canoniserInline(contenu) {
  const s = String(contenu === undefined || contenu === null ? '' : contenu);
  let out = '';
  const re = /<[^>]*>/g;
  let dernier = 0, m;
  while ((m = re.exec(s)) !== null) {
    out += s.slice(dernier, m.index);
    dernier = re.lastIndex;
    const t = m[0].toLowerCase();
    if (/^<br\b[^>]*\/?>$/.test(t)) { out += '<br>'; }
    else if (/^<(strong|b)\b[^>]*>$/.test(t)) { out += '<strong>'; }
    else if (/^<\/(strong|b)\s*>$/.test(t)) { out += '</strong>'; }
    else if (/^<(em|i)\b[^>]*>$/.test(t)) { out += '<em>'; }
    else if (/^<\/(em|i)\s*>$/.test(t)) { out += '</em>'; }
    // sinon : balise inconnue -> abandonnée (le texte autour est conservé)
  }
  out += s.slice(dernier);
  return out.trim();
}

// Cellules d'un <tr> intérieur. Scan à profondeur td/th : un tableau imbriqué dans
// une cellule (rare, cf. docx-tables.py) ne casse pas le découpage — son contenu
// reste dans la cellule englobante (aplati en texte par canoniserInline).
function extraireCellules(interieur) {
  const cellules = [];
  const re = /<(\/?)(td|th)\b([^>]*)>/gi;
  let m, profondeur = 0, courant = null, debut = 0;
  while ((m = re.exec(String(interieur))) !== null) {
    if (m[1] !== '/') {
      if (profondeur === 0) { courant = { tag: m[2].toLowerCase(), attrs: lireAttributsHtml(m[3]) }; debut = re.lastIndex; }
      profondeur++;
    } else {
      profondeur--;
      if (profondeur <= 0 && courant) {
        const th = courant.tag === 'th';
        const sc = courant.attrs.scope;
        cellules.push({
          contenu: canoniserInline(String(interieur).slice(debut, m.index)),
          colspan: Math.max(1, parseInt(courant.attrs.colspan, 10) || 1),
          rowspan: Math.max(1, parseInt(courant.attrs.rowspan, 10) || 1),
          th: th,
          scope: th ? (sc === 'row' ? 'row' : (sc === 'col' ? 'col' : '')) : ''
        });
        courant = null;
        profondeur = 0;
      }
    }
  }
  return cellules;
}

function enumOu(v, liste, defaut) { return liste.indexOf(v) !== -1 ? v : defaut; }

// Matrice d'occupation (RT1) : place chaque cellule (colspan/rowspan) sur une grille
// visuelle. grid[r][c] = { li, ci, c0, colspan, rowspan } (indices MODÈLE de la
// cellule occupant la case) ; positions[r][ci] = { c0, colspan, rowspan } (origine
// visuelle d'une cellule modèle). Base commune du rendu, de la sélection et des ops.
function matriceOccupation(lignes) {
  const grid = [], positions = [];
  for (let r = 0; r < lignes.length; r++) {
    if (!grid[r]) { grid[r] = []; }
    positions[r] = [];
    let c = 0;
    const cells = lignes[r].cellules || [];
    for (let ci = 0; ci < cells.length; ci++) {
      while (grid[r][c]) { c++; }
      const cs = Math.max(1, parseInt(cells[ci].colspan, 10) || 1);
      const rs = Math.max(1, parseInt(cells[ci].rowspan, 10) || 1);
      positions[r][ci] = { c0: c, colspan: cs, rowspan: rs };
      for (let dr = 0; dr < rs; dr++) {
        if (!grid[r + dr]) { grid[r + dr] = []; }
        for (let dc = 0; dc < cs; dc++) { grid[r + dr][c + dc] = { li: r, ci: ci, c0: c, colspan: cs, rowspan: rs }; }
      }
      c += cs;
    }
  }
  let nbC = 0;
  for (let r = 0; r < grid.length; r++) { if (grid[r]) { nbC = Math.max(nbC, grid[r].length); } }
  return { grid: grid, positions: positions, nbLignes: Math.max(lignes.length, grid.length), nbColonnes: nbC };
}

// Modèle -> grille « dépliée » (une case = un id de cellule ; fusions = plusieurs
// cases au même id). Les trous d'un tableau ragged sont comblés par des cellules
// vides -> grille toujours rectangulaire. Base des opérations de structure.
function etendreGrille(modele) {
  const occ = matriceOccupation(modele.lignes);
  const nbL = modele.lignes.length, nbC = occ.nbColonnes;
  const grid = [];
  for (let r = 0; r < nbL; r++) { grid[r] = new Array(nbC).fill(null); }
  const cellules = [];
  for (let r = 0; r < nbL; r++) {
    modele.lignes[r].cellules.forEach((cell, ci) => {
      const pos = occ.positions[r][ci];
      const id = cellules.length;
      cellules.push({ contenu: cell.contenu, th: !!cell.th, scope: cell.scope || '' });
      for (let dr = 0; dr < pos.rowspan && r + dr < nbL; dr++) {
        for (let dc = 0; dc < pos.colspan && pos.c0 + dc < nbC; dc++) { grid[r + dr][pos.c0 + dc] = id; }
      }
    });
  }
  for (let r = 0; r < nbL; r++) {
    for (let c = 0; c < nbC; c++) {
      if (grid[r][c] == null) { grid[r][c] = cellules.length; cellules.push({ contenu: '', th: false, scope: '' }); }
    }
  }
  return {
    cellules: cellules, grid: grid,
    infosLignes: modele.lignes.map((lg) => ({ total: !!lg.total, teinte: lg.teinte || 'gris', gras: lg.gras || 'non' })),
    attrs: Object.assign({}, modele.attrs)
  };
}

// Grille dépliée -> modèle (colspan/rowspan recalculés depuis les blocs rectangulaires
// contigus). L'origine d'un id = case la plus haute puis la plus à gauche.
function compacterGrille(g) {
  const nbL = g.grid.length, nbC = nbL ? g.grid[0].length : 0;
  const origine = {};
  for (let r = 0; r < nbL; r++) {
    for (let c = 0; c < nbC; c++) {
      const id = g.grid[r][c];
      if (id != null && !(id in origine)) { origine[id] = { r: r, c: c }; }
    }
  }
  const lignes = [];
  for (let r = 0; r < nbL; r++) {
    const cellules = [];
    for (let c = 0; c < nbC; c++) {
      const id = g.grid[r][c];
      if (id == null) { continue; }
      if (origine[id].r !== r || origine[id].c !== c) { continue; }
      let cs = 0; while (c + cs < nbC && g.grid[r][c + cs] === id) { cs++; }
      let rs = 0; while (r + rs < nbL && g.grid[r + rs][c] === id) { rs++; }
      const cell = g.cellules[id];
      cellules.push({ contenu: cell.contenu, colspan: cs, rowspan: rs, th: !!cell.th, scope: cell.scope || '' });
    }
    lignes.push({ total: g.infosLignes[r].total, teinte: g.infosLignes[r].teinte, gras: g.infosLignes[r].gras, cellules: cellules });
  }
  return finaliserModele({ attrs: g.attrs, lignes: lignes });
}

// Réaligne th/scope de CHAQUE cellule sur les comptes data-entete-lignes/colonnes
// (source de vérité unique). Cellule en tête si son origine est dans les N lignes du
// haut (scope=col) OU les M colonnes de gauche (scope=row ; le haut l'emporte au coin).
function reappliquerEntetes(modele) {
  const occ = matriceOccupation(modele.lignes);
  const eL = modele.attrs.enteteLignes, eC = modele.attrs.enteteColonnes;
  modele.lignes.forEach((lg, r) => {
    lg.cellules.forEach((cell, ci) => {
      const enHaut = r < eL;
      const aGauche = occ.positions[r][ci].c0 < eC;
      cell.th = enHaut || aGauche;
      cell.scope = enHaut ? 'col' : (aGauche ? 'row' : '');
    });
  });
  return modele;
}

// Normalise (bornes + énumérations) un modèle, sans toucher à la structure.
function normaliserModele(modele) {
  const a = (modele && modele.attrs) || {};
  const lignesEntree = (modele && modele.lignes) || [];
  const nbLignes = lignesEntree.length;
  const attrs = {
    classe: 'szh-tableau',
    enteteLignes: Math.max(0, Math.min(2, Math.min(parseInt(a.enteteLignes, 10) || 0, nbLignes))),
    enteteColonnes: Math.max(0, Math.min(2, parseInt(a.enteteColonnes, 10) || 0)),
    enteteLigneStyle: enumOu(a.enteteLigneStyle, ['gras', 'negatif', 'fond', 'normal'], 'normal'),
    enteteColonneStyle: enumOu(a.enteteColonneStyle, ['gras', 'negatif', 'fond', 'normal'], 'normal'),
    zebre: enumOu(a.zebre, ['lignes', 'colonnes', 'non'], 'non'),
    zebreTeinte: enumOu(a.zebreTeinte, ['gris', 'couleur'], 'gris'),
    separateurs: enumOu(a.separateurs, ['gris', 'couleur', 'non'], 'non'),
    bordureHaute: a.bordureHaute === 'oui' ? 'oui' : 'non',
    bordureBasse: a.bordureBasse === 'oui' ? 'oui' : 'non'
  };
  if (attrs.enteteLignes === 0) { attrs.enteteLigneStyle = 'normal'; }
  if (attrs.enteteColonnes === 0) { attrs.enteteColonneStyle = 'normal'; }
  if (attrs.zebre === 'non') { attrs.zebreTeinte = 'gris'; }
  const lignes = lignesEntree.map((lg) => ({
    total: !!(lg && lg.total),
    teinte: enumOu(lg && lg.teinte, ['gris', 'couleur'], 'gris'),
    gras: (lg && lg.gras) === 'oui' ? 'oui' : 'non',
    cellules: ((lg && lg.cellules) || []).map((c) => {
      const th = !!(c && c.th);
      return {
        contenu: canoniserInline(c && c.contenu),
        colspan: Math.max(1, parseInt(c && c.colspan, 10) || 1),
        rowspan: Math.max(1, parseInt(c && c.rowspan, 10) || 1),
        th: th,
        scope: th ? ((c && c.scope) === 'row' ? 'row' : ((c && c.scope) === 'col' ? 'col' : '')) : ''
      };
    })
  }));
  if (lignes.length === 0) { lignes.push({ total: false, teinte: 'gris', gras: 'non', cellules: [{ contenu: '', colspan: 1, rowspan: 1, th: false, scope: '' }] }); }
  return { attrs: attrs, lignes: lignes };
}

// Modèle prêt à l'emploi : normalisé PUIS th/scope réalignés sur les comptes.
function finaliserModele(modele) {
  const m = normaliserModele(modele);
  reappliquerEntetes(m);
  return m;
}

// Déduit un compte d'en-tête à partir des <th> d'un import nu (M2) quand l'attribut
// data-entete-* est absent : nombre de lignes/colonnes de tête entièrement en <th>.
function infererEnteteLignes(occ, lignes) {
  let n = 0;
  for (let r = 0; r < occ.nbLignes && r < lignes.length; r++) {
    let toutTh = occ.nbColonnes > 0;
    for (let c = 0; c < occ.nbColonnes; c++) {
      const ref = occ.grid[r] && occ.grid[r][c];
      if (!ref || !lignes[ref.li].cellules[ref.ci].th) { toutTh = false; break; }
    }
    if (toutTh) { n++; } else { break; }
  }
  return Math.min(n, 2);
}
function infererEnteteColonnes(occ, lignes) {
  let m = 0;
  for (let c = 0; c < occ.nbColonnes; c++) {
    let toutTh = occ.nbLignes > 0;
    for (let r = 0; r < occ.nbLignes && r < lignes.length; r++) {
      const ref = occ.grid[r] && occ.grid[r][c];
      if (!ref || !lignes[ref.li].cellules[ref.ci].th) { toutTh = false; break; }
    }
    if (toutTh) { m++; } else { break; }
  }
  return Math.min(m, 2);
}

// analyserTable(html) -> modèle. Tolère un <table> nu (M2) ; déduit les comptes
// d'en-tête des <th> si les data-entete-* manquent ; ignore thead/tbody/caption/col.
function analyserTable(html) {
  const s = String(html === undefined || html === null ? '' : html);
  const mTable = s.match(/<table\b([^>]*)>/i);
  const at = mTable ? lireAttributsHtml(mTable[1]) : {};
  let corps;
  if (mTable) {
    const debut = mTable.index + mTable[0].length;
    const fin = s.toLowerCase().indexOf('</table>', debut);
    corps = fin === -1 ? s.slice(debut) : s.slice(debut, fin);
  } else { corps = s; }
  corps = corps
    .replace(/<\/?(thead|tbody|tfoot)\b[^>]*>/gi, '')
    .replace(/<colgroup\b[^>]*>[\s\S]*?<\/colgroup>/gi, '')
    .replace(/<col\b[^>]*\/?>/gi, '')
    .replace(/<caption\b[^>]*>[\s\S]*?<\/caption>/gi, '');
  const lignes = [];
  const reTr = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
  let mtr;
  while ((mtr = reTr.exec(corps)) !== null) {
    const attrsTr = lireAttributsHtml(mtr[1]);
    const classes = String(attrsTr['class'] || '').split(/\s+/);
    lignes.push({
      total: classes.indexOf('szh-total') !== -1,
      teinte: attrsTr['data-teinte'] === 'couleur' ? 'couleur' : 'gris',
      gras: attrsTr['data-gras'] === 'oui' ? 'oui' : 'non',
      cellules: extraireCellules(mtr[2])
    });
  }
  if (lignes.length === 0) { lignes.push({ total: false, teinte: 'gris', gras: 'non', cellules: [{ contenu: '', colspan: 1, rowspan: 1, th: false, scope: '' }] }); }
  const occ = matriceOccupation(lignes);
  const attrs = {
    classe: 'szh-tableau',
    enteteLignes: at['data-entete-lignes'] !== undefined ? Math.max(0, Math.min(2, parseInt(at['data-entete-lignes'], 10) || 0)) : infererEnteteLignes(occ, lignes),
    enteteColonnes: at['data-entete-colonnes'] !== undefined ? Math.max(0, Math.min(2, parseInt(at['data-entete-colonnes'], 10) || 0)) : infererEnteteColonnes(occ, lignes),
    enteteLigneStyle: enumOu(at['data-entete-ligne-style'], ['gras', 'negatif', 'fond', 'normal'], 'normal'),
    enteteColonneStyle: enumOu(at['data-entete-colonne-style'], ['gras', 'negatif', 'fond', 'normal'], 'normal'),
    zebre: enumOu(at['data-zebre'], ['lignes', 'colonnes', 'non'], 'non'),
    zebreTeinte: enumOu(at['data-zebre-teinte'], ['gris', 'couleur'], 'gris'),
    separateurs: enumOu(at['data-separateurs'], ['gris', 'couleur', 'non'], 'non'),
    bordureHaute: at['data-bordure-haute'] === 'oui' ? 'oui' : 'non',
    bordureBasse: at['data-bordure-basse'] === 'oui' ? 'oui' : 'non'
  };
  return finaliserModele({ attrs: attrs, lignes: lignes });
}

// serialiserTable(modèle) -> <table> propre et STABLE (attributs en ordre fixe, un
// data-* émis seulement s'il est signifiant). Une balise par ligne (lisible, diff-able).
function serialiserTable(modele) {
  const m = normaliserModele(modele);
  const a = m.attrs;
  let ouv = '<table class="' + a.classe + '"';
  if (a.enteteLignes > 0) { ouv += ' data-entete-lignes="' + a.enteteLignes + '"'; }
  if (a.enteteColonnes > 0) { ouv += ' data-entete-colonnes="' + a.enteteColonnes + '"'; }
  if (a.enteteLignes > 0 && a.enteteLigneStyle !== 'normal') { ouv += ' data-entete-ligne-style="' + a.enteteLigneStyle + '"'; }
  if (a.enteteColonnes > 0 && a.enteteColonneStyle !== 'normal') { ouv += ' data-entete-colonne-style="' + a.enteteColonneStyle + '"'; }
  if (a.zebre !== 'non') { ouv += ' data-zebre="' + a.zebre + '"'; if (a.zebreTeinte === 'couleur') { ouv += ' data-zebre-teinte="couleur"'; } }
  if (a.separateurs !== 'non') { ouv += ' data-separateurs="' + a.separateurs + '"'; }
  if (a.bordureHaute === 'oui') { ouv += ' data-bordure-haute="oui"'; }
  if (a.bordureBasse === 'oui') { ouv += ' data-bordure-basse="oui"'; }
  ouv += '>';
  const out = [ouv];
  for (const lg of m.lignes) {
    let tr = '<tr';
    if (lg.total) { tr += ' class="szh-total"'; if (lg.teinte === 'couleur') { tr += ' data-teinte="couleur"'; } if (lg.gras === 'oui') { tr += ' data-gras="oui"'; } }
    tr += '>';
    out.push(tr);
    for (const cell of lg.cellules) {
      const tag = cell.th ? 'th' : 'td';
      let t = '<' + tag;
      if (cell.th && (cell.scope === 'col' || cell.scope === 'row')) { t += ' scope="' + cell.scope + '"'; }
      if (cell.colspan > 1) { t += ' colspan="' + cell.colspan + '"'; }
      if (cell.rowspan > 1) { t += ' rowspan="' + cell.rowspan + '"'; }
      out.push(t + '>' + cell.contenu + '</' + tag + '>');
    }
    out.push('</tr>');
  }
  out.push('</table>');
  return out.join('\n') + '\n';
}

// Structure d'affichage pour la webview : chaque cellule avec ses coordonnées
// VISUELLES (r0,c0) et ses spans -> rendu direct + sélection sans dupliquer la
// matrice côté webview.
function disposition(modele) {
  const occ = matriceOccupation(modele.lignes);
  return {
    nbLignes: modele.lignes.length,
    nbColonnes: occ.nbColonnes,
    attrs: modele.attrs,
    lignes: modele.lignes.map((lg, r) => ({
      total: lg.total, teinte: lg.teinte, gras: lg.gras,
      cellules: lg.cellules.map((cell, ci) => ({
        li: r, ci: ci, r0: r, c0: occ.positions[r][ci].c0,
        colspan: occ.positions[r][ci].colspan, rowspan: occ.positions[r][ci].rowspan,
        th: cell.th, scope: cell.scope, contenu: cell.contenu
      }))
    }))
  };
}

// ---- Opérations de structure (pures, modèle -> modèle) ----------------------------

// Insère une ligne vide à l'index visuel `pos` (0..nbLignes). Une cellule qui
// FRANCHIT la frontière voit son rowspan grandir (elle couvre la nouvelle ligne).
function ajouterLigne(modele, pos) {
  const g = etendreGrille(modele);
  const nbC = g.grid.length ? g.grid[0].length : 1;
  pos = Math.max(0, Math.min(pos, g.grid.length));
  const rangee = new Array(nbC);
  for (let c = 0; c < nbC; c++) {
    if (pos > 0 && pos < g.grid.length && g.grid[pos - 1][c] != null && g.grid[pos - 1][c] === g.grid[pos][c]) {
      rangee[c] = g.grid[pos - 1][c];
    } else { rangee[c] = g.cellules.length; g.cellules.push({ contenu: '', th: false, scope: '' }); }
  }
  g.grid.splice(pos, 0, rangee);
  g.infosLignes.splice(pos, 0, { total: false, teinte: 'gris', gras: 'non' });
  return compacterGrille(g);
}

function supprimerLigne(modele, index) {
  const g = etendreGrille(modele);
  if (g.grid.length <= 1) { return finaliserModele(modele); }
  index = Math.max(0, Math.min(index, g.grid.length - 1));
  g.grid.splice(index, 1);
  g.infosLignes.splice(index, 1);
  return compacterGrille(g);
}

// Insère une colonne vide à l'index visuel `pos` (0..nbColonnes). Idem : un colspan
// qui franchit la frontière grandit.
function ajouterColonne(modele, pos) {
  const g = etendreGrille(modele);
  const nbC = g.grid.length ? g.grid[0].length : 1;
  pos = Math.max(0, Math.min(pos, nbC));
  for (let r = 0; r < g.grid.length; r++) {
    let id;
    if (pos > 0 && pos < nbC && g.grid[r][pos - 1] != null && g.grid[r][pos - 1] === g.grid[r][pos]) {
      id = g.grid[r][pos - 1];
    } else { id = g.cellules.length; g.cellules.push({ contenu: '', th: false, scope: '' }); }
    g.grid[r].splice(pos, 0, id);
  }
  return compacterGrille(g);
}

function supprimerColonne(modele, index) {
  const g = etendreGrille(modele);
  const nbC = g.grid.length ? g.grid[0].length : 0;
  if (nbC <= 1) { return finaliserModele(modele); }
  index = Math.max(0, Math.min(index, nbC - 1));
  for (let r = 0; r < g.grid.length; r++) { g.grid[r].splice(index, 1); }
  return compacterGrille(g);
}

// Fusionne une plage visuelle rectangulaire -> une cellule (colspan/rowspan),
// contenus non vides concaténés (séparés par <br>). Refuse une plage non
// rectangulaire (une cellule dépasserait) -> { erreur:'table.fusionImpossible' }.
function fusionner(modele, ra, ca, rb, cb) {
  const g = etendreGrille(modele);
  const nbL = g.grid.length, nbC = nbL ? g.grid[0].length : 0;
  const rMin = Math.max(0, Math.min(ra, rb)), rMax = Math.min(nbL - 1, Math.max(ra, rb));
  const cMin = Math.max(0, Math.min(ca, cb)), cMax = Math.min(nbC - 1, Math.max(ca, cb));
  const idsRect = new Set();
  for (let r = rMin; r <= rMax; r++) { for (let c = cMin; c <= cMax; c++) { idsRect.add(g.grid[r][c]); } }
  for (let r = 0; r < nbL; r++) {
    for (let c = 0; c < nbC; c++) {
      if (idsRect.has(g.grid[r][c]) && (r < rMin || r > rMax || c < cMin || c > cMax)) {
        return { erreur: 'table.fusionImpossible' };
      }
    }
  }
  const idCoin = g.grid[rMin][cMin];
  const contenus = [], vu = new Set();
  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      const id = g.grid[r][c];
      if (vu.has(id)) { continue; }
      vu.add(id);
      if (g.cellules[id].contenu !== '') { contenus.push(g.cellules[id].contenu); }
    }
  }
  g.cellules[idCoin].contenu = contenus.join('<br>');
  for (let r = rMin; r <= rMax; r++) { for (let c = cMin; c <= cMax; c++) { g.grid[r][c] = idCoin; } }
  return compacterGrille(g);
}

// Scinde la cellule fusionnée dont l'origine visuelle est (r,c) : chaque case
// libérée redevient une cellule vide (contenu conservé sur la cellule d'origine).
function scinder(modele, r, c) {
  const g = etendreGrille(modele);
  const nbL = g.grid.length, nbC = nbL ? g.grid[0].length : 0;
  if (r < 0 || r >= nbL || c < 0 || c >= nbC) { return finaliserModele(modele); }
  const id = g.grid[r][c];
  const positions = [];
  for (let rr = 0; rr < nbL; rr++) { for (let cc = 0; cc < nbC; cc++) { if (g.grid[rr][cc] === id) { positions.push([rr, cc]); } } }
  if (positions.length <= 1) { return finaliserModele(modele); }
  positions.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const base = g.cellules[id];
  for (let k = 1; k < positions.length; k++) {
    const nid = g.cellules.length;
    g.cellules.push({ contenu: '', th: base.th, scope: base.scope });
    g.grid[positions[k][0]][positions[k][1]] = nid;
  }
  return compacterGrille(g);
}

// Applique une opération nommée (venue de la webview) au modèle (assaini). Les
// plages (rMin..rMax / cMin..cMax) sont dépliées en appels unitaires des ops pures.
function appliquerOperationTable(nom, modeleBrut, args) {
  const modele = normaliserModele(modeleBrut);
  const a = args || {};
  const n = (v) => { const x = parseInt(v, 10); return isNaN(x) ? 0 : x; };
  if (nom === 'ajouterLigne') { return ajouterLigne(modele, n(a.pos)); }
  if (nom === 'supprimerLigne') {
    let m = modele;
    for (let i = n(a.rMax); i >= n(a.rMin); i--) { m = supprimerLigne(m, i); }
    return m;
  }
  if (nom === 'ajouterColonne') { return ajouterColonne(modele, n(a.pos)); }
  if (nom === 'supprimerColonne') {
    let m = modele;
    for (let i = n(a.cMax); i >= n(a.cMin); i--) { m = supprimerColonne(m, i); }
    return m;
  }
  if (nom === 'fusionner') { return fusionner(modele, n(a.rMin), n(a.cMin), n(a.rMax), n(a.cMax)); }
  if (nom === 'scinder') {
    const occ = matriceOccupation(modele.lignes);
    const coins = [];
    for (let r = n(a.rMin); r <= n(a.rMax); r++) {
      for (let c = n(a.cMin); c <= n(a.cMax); c++) {
        const ref = occ.grid[r] && occ.grid[r][c];
        if (ref && (ref.colspan > 1 || ref.rowspan > 1)) { coins.push(ref.c0 + '/' + ref.li); }
      }
    }
    let m = modele;
    for (const clef of new Set(coins)) {
      const parts = clef.split('/');
      m = scinder(m, parseInt(parts[1], 10), parseInt(parts[0], 10));
    }
    return m;
  }
  // ---- T2 : en-têtes + styles (encodage data-*) ----
  if (nom === 'entete') {
    if (a.sens === 'colonnes') { modele.attrs.enteteColonnes = Math.max(0, Math.min(2, n(a.n))); }
    else { modele.attrs.enteteLignes = Math.max(0, Math.min(2, n(a.n))); }
    return finaliserModele(modele);   // reapplique th/scope depuis les comptes
  }
  if (nom === 'enteteRetirer') {
    modele.attrs.enteteLignes = 0; modele.attrs.enteteColonnes = 0;
    return finaliserModele(modele);
  }
  if (nom === 'styleEntete') {
    const v = enumOu(a.valeur, ['gras', 'negatif', 'fond', 'normal'], 'normal');
    if (a.cible === 'colonne') { modele.attrs.enteteColonneStyle = v; } else { modele.attrs.enteteLigneStyle = v; }
    return finaliserModele(modele);
  }
  if (nom === 'reglage') {
    const champs = {
      zebre: ['lignes', 'colonnes', 'non'], zebreTeinte: ['gris', 'couleur'],
      separateurs: ['gris', 'couleur', 'non'], bordureHaute: ['oui', 'non'], bordureBasse: ['oui', 'non']
    };
    if (champs[a.champ]) { modele.attrs[a.champ] = enumOu(a.valeur, champs[a.champ], champs[a.champ][champs[a.champ].length - 1]); }
    return finaliserModele(modele);
  }
  if (nom === 'total') {
    const teinte = enumOu(a.teinte, ['gris', 'couleur', 'non'], 'non');
    const gras = a.gras === 'oui' || a.gras === true ? 'oui' : 'non';
    for (let r = n(a.rMin); r <= n(a.rMax); r++) {
      if (!modele.lignes[r]) { continue; }
      if (teinte === 'non') { modele.lignes[r].total = false; modele.lignes[r].gras = 'non'; }
      else { modele.lignes[r].total = true; modele.lignes[r].teinte = teinte; modele.lignes[r].gras = gras; }
    }
    return finaliserModele(modele);
  }
  return finaliserModele(modele);
}

// Couleur annuelle (hex) d'ausgabe.yaml (M7) pour l'APERÇU webview — repli '' si
// aucune couleur (l'aperçu « couleur » retombe alors sur le gris, comme le PDF).
function lireCouleurAccent(racine) {
  try {
    const c = String(analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')).couleur || '').toUpperCase();
    return HEX_COULEURS.indexOf(c) !== -1 ? c : '';
  } catch (e) { return ''; }
}

// Libellés localisés transmis à la webview de l'éditeur de tableau.
function textesTable() {
  const cles = [
    'table.aide', 'table.enregistrer', 'table.ajouterLigne', 'table.supprimerLigne',
    'table.ajouterColonne', 'table.supprimerColonne', 'table.fusionner', 'table.scinder',
    'table.rien', 'table.fusionImpossible', 'table.enregistre',
    'table.grpStructure', 'table.grpEntetes', 'table.grpStyles',
    'table.entete', 'table.enteteRetirer', 'table.styleEntete', 'table.styleLigne', 'table.styleColonne',
    'table.st.normal', 'table.st.gras', 'table.st.negatif', 'table.st.fond',
    'table.zebre', 'table.zebre.non', 'table.zebre.lignes', 'table.zebre.colonnes',
    'table.teinte', 'table.teinte.gris', 'table.teinte.couleur',
    'table.separateurs', 'table.sep.non', 'table.sep.gris', 'table.sep.couleur',
    'table.bordureHaute', 'table.bordureBasse', 'table.oui', 'table.non',
    'table.total', 'table.total.non', 'table.total.gris', 'table.total.couleur', 'table.total.gras',
    'table.accent', 'table.accent.gris', 'table.accent.couleur', 'table.accent.aucune'
  ];
  const o = {};
  for (const c of cles) { o[c.slice('table.'.length)] = T(c); }
  return o;
}

// Webview de l'éditeur — CSP stricte : aucun réseau, styles inline, script à nonce.
// Le contenu du tableau n'est JAMAIS injecté dans le HTML : le modèle arrive par
// postMessage et la grille est construite en DOM (createElement/textContent). Le
// contenu inline (déjà canonisé côté hôte : texte échappé + <strong>/<em>/<br>) est
// posé en nœuds DOM, pas via innerHTML.
function htmlEditeurTable(nonce) {
  return '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\'">\n' +
    '<title>' + T('table.titre', ['']) + '</title>\n' +
    '<style>\n' +
    'body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);\n' +
    '  color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: .6rem .8rem; }\n' +
    '.barre { position: sticky; top: 0; z-index: 5; background: var(--vscode-editor-background);\n' +
    '  display: flex; flex-wrap: wrap; align-items: center; gap: .35rem; padding: .3rem 0 .5rem; }\n' +
    '.grp { display: inline-flex; align-items: center; gap: .25rem; padding: .1rem .3rem;\n' +
    '  border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.3)); border-radius: 4px; }\n' +
    '.grp > .lbl { font-size: .78em; color: var(--vscode-descriptionForeground); margin-right: .1rem; }\n' +
    'button { font: inherit; padding: .25em .6em; border: none; border-radius: 3px; cursor: pointer;\n' +
    '  color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));\n' +
    '  background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.18)); }\n' +
    'button:hover { background: var(--vscode-button-hoverBackground); color: var(--vscode-button-foreground); }\n' +
    'button.principal { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }\n' +
    'button[aria-pressed="true"] { outline: 2px solid var(--vscode-focusBorder); outline-offset: -1px; }\n' +
    'select { font: inherit; padding: .2em .3em; color: var(--vscode-input-foreground);\n' +
    '  background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; }\n' +
    'p.aide { color: var(--vscode-descriptionForeground); font-size: .82em; margin: .1rem 0 .6rem; }\n' +
    '#etat { font-size: .85em; color: var(--vscode-descriptionForeground); margin-left: .3rem; }\n' +
    '#zone { overflow: auto; }\n' +
    'table.grille { border-collapse: collapse; }\n' +
    'table.grille th, table.grille td { border: 1px solid var(--vscode-panel-border, #888);\n' +
    '  padding: .3em .5em; min-width: 3em; vertical-align: top; text-align: left; }\n' +
    'table.grille td.cell, table.grille th.cell { background: var(--vscode-editor-background); cursor: text; }\n' +
    'table.grille .sel { outline: 2px solid var(--vscode-focusBorder); outline-offset: -2px;\n' +
    '  background: var(--vscode-editor-selectionBackground, rgba(90,140,220,.25)); }\n' +
    '.poignee { background: var(--vscode-editorGutter-background, rgba(128,128,128,.15));\n' +
    '  color: var(--vscode-descriptionForeground); cursor: pointer; text-align: center; user-select: none;\n' +
    '  min-width: 1.4em; padding: .15em .3em; font-size: .8em; }\n' +
    '.poignee:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.3)); }\n' +
    '.coin { background: var(--vscode-editorGutter-background, rgba(128,128,128,.15)); }\n' +
    '</style>\n</head>\n<body>\n' +
    '<div class="barre" id="barre"></div>\n' +
    '<p class="aide" id="aide"></p>\n' +
    '<div id="zone"></div>\n' +
    '<script nonce="' + nonce + '">\n' + scriptEditeurTable() + '\n</script>\n</body>\n</html>\n';
}

// Script de la webview (chaîne). Séparé pour la lisibilité ; aucune valeur dynamique
// n'y est interpolée (tout arrive par postMessage).
function scriptEditeurTable() {
  return "(function(){\n" +
    "'use strict';\n" +
    "var api=acquireVsCodeApi();\n" +
    "var modele=null, dispo=null, TXT={}, accent='', accentMode='gris', selection=null, ancre=null, premierChargement=true, ctl={};\n" +
    "var barre=document.getElementById('barre'), zone=document.getElementById('zone'), aide=document.getElementById('aide');\n" +
    // --- inline <-> DOM (sans innerHTML) ---
    "function dechap(s){return String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'\\\"').replace(/&#x27;/g,\"'\").replace(/&#39;/g,\"'\").replace(/&amp;/g,'&');}\n" +
    "function echap(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}\n" +
    "function poserInline(el,contenu){el.textContent='';var re=/<\\/?(?:strong|em)>|<br>/g,dernier=0,m,pile=[el];\n" +
    "  while((m=re.exec(contenu))!==null){var txt=contenu.slice(dernier,m.index);if(txt){pile[pile.length-1].appendChild(document.createTextNode(dechap(txt)));}\n" +
    "    dernier=re.lastIndex;var tg=m[0];\n" +
    "    if(tg==='<br>'){pile[pile.length-1].appendChild(document.createElement('br'));}\n" +
    "    else if(tg==='<strong>'){var s=document.createElement('strong');pile[pile.length-1].appendChild(s);pile.push(s);}\n" +
    "    else if(tg==='<em>'){var e=document.createElement('em');pile[pile.length-1].appendChild(e);pile.push(e);}\n" +
    "    else if(pile.length>1){pile.pop();}}\n" +
    "  var reste=contenu.slice(dernier);if(reste){pile[pile.length-1].appendChild(document.createTextNode(dechap(reste)));}}\n" +
    "function inlineDeNoeud(n){var out='';n.childNodes.forEach(function(ch){\n" +
    "  if(ch.nodeType===3){out+=echap(ch.nodeValue);}\n" +
    "  else if(ch.nodeType===1){var tg=ch.tagName.toLowerCase();\n" +
    "    if(tg==='br'){out+='<br>';}\n" +
    "    else if(tg==='strong'||tg==='b'){out+='<strong>'+inlineDeNoeud(ch)+'</strong>';}\n" +
    "    else if(tg==='em'||tg==='i'){out+='<em>'+inlineDeNoeud(ch)+'</em>';}\n" +
    "    else{out+=inlineDeNoeud(ch);}}});return out;}\n" +
    // --- récolte des contenus édités vers le modèle ---
    "function recolter(){if(!modele)return;zone.querySelectorAll('[data-li]').forEach(function(el){\n" +
    "  var li=+el.dataset.li,ci=+el.dataset.ci;if(modele.lignes[li]&&modele.lignes[li].cellules[ci]){modele.lignes[li].cellules[ci].contenu=inlineDeNoeud(el).trim();}});}\n" +
    // --- géométrie de sélection ---
    "function rectCell(c){return {rMin:c.r0,cMin:c.c0,rMax:c.r0+c.rowspan-1,cMax:c.c0+c.colspan-1};}\n" +
    "function union(a,b){return {rMin:Math.min(a.rMin,b.rMin),cMin:Math.min(a.cMin,b.cMin),rMax:Math.max(a.rMax,b.rMax),cMax:Math.max(a.cMax,b.cMax)};}\n" +
    "function chevauche(a,b){return !(a.rMax<b.rMin||a.rMin>b.rMax||a.cMax<b.cMin||a.cMin>b.cMax);}\n" +
    "function etendre(rect){var change=true;while(change){change=false;dispo.lignes.forEach(function(lg){lg.cellules.forEach(function(c){\n" +
    "  var cr=rectCell(c);if(chevauche(cr,rect)){var nr=union(rect,cr);if(nr.rMin!==rect.rMin||nr.cMin!==rect.cMin||nr.rMax!==rect.rMax||nr.cMax!==rect.cMax){rect=nr;change=true;}}});});}return rect;}\n" +
    "function plage(){return selection&&(selection.rMax>selection.rMin||selection.cMax>selection.cMin);}\n" +
    "function clampSel(s){if(!s||!dispo)return null;var rMax=Math.min(s.rMax,dispo.nbLignes-1),cMax=Math.min(s.cMax,dispo.nbColonnes-1);if(s.rMin>rMax||s.cMin>cMax||s.rMin<0||s.cMin<0)return null;return etendre({rMin:s.rMin,cMin:s.cMin,rMax:rMax,cMax:cMax});}\n" +
    // --- aperçu live (approxime print.css : accent gris|couleur annuelle) ---
    "function hx(h){h=String(h||'').replace('#','');if(h.length===3){h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];}return [parseInt(h.slice(0,2),16)||0,parseInt(h.slice(2,4),16)||0,parseInt(h.slice(4,6),16)||0];}\n" +
    "function hx2(v){var s=Math.max(0,Math.min(255,Math.round(v))).toString(16);return s.length<2?'0'+s:s;}\n" +
    "function melange(a,b,t){var x=hx(a),y=hx(b);return '#'+hx2(x[0]+(y[0]-x[0])*t)+hx2(x[1]+(y[1]-x[1])*t)+hx2(x[2]+(y[2]-x[2])*t);}\n" +
    "function accBrut(){return (accentMode==='couleur'&&accent)?accent:null;}\n" +
    "function fondClair(coul){var a=coul?accBrut():null;return a?melange(a,'#ffffff',0.82):'#eeeeee';}\n" +
    "function fondFonce(coul){var a=coul?accBrut():null;return a?melange(a,'#000000',0.35):'#4a4a4a';}\n" +
    "function ligne(coul){var a=coul?accBrut():null;return a?a:'#c9c9c9';}\n" +
    "function styleEnt(el,st){if(st==='gras'){el.style.fontWeight='700';}else if(st==='fond'){el.style.background=fondClair(true);el.style.fontWeight='700';}else if(st==='negatif'){el.style.background=fondFonce(true);el.style.color='#ffffff';el.style.fontWeight='700';}}\n" +
    "function stylerApercu(){if(!dispo||!modele)return;var a=modele.attrs;zone.querySelectorAll('.cell').forEach(function(el){\n" +
    "  el.style.background='';el.style.color='';el.style.fontWeight='';el.style.borderBottom='';el.style.borderTop='';\n" +
    "  var r=+el.dataset.r0,c=+el.dataset.c0,rs=+el.dataset.rs,li=+el.dataset.li,lg=dispo.lignes[li];\n" +
    "  var entL=r<a.enteteLignes,entC=(c<a.enteteColonnes)&&!entL,tot=lg&&lg.total;\n" +
    "  if(a.zebre==='lignes'&&!entL&&!entC&&!tot){var di=r-a.enteteLignes;if(di>=0&&di%2===1)el.style.background=fondClair(a.zebreTeinte==='couleur');}\n" +
    "  else if(a.zebre==='colonnes'&&!entC&&!entL&&!tot){var dc=c-a.enteteColonnes;if(dc>=0&&dc%2===1)el.style.background=fondClair(a.zebreTeinte==='couleur');}\n" +
    "  if(entL){styleEnt(el,a.enteteLigneStyle);}else if(entC){styleEnt(el,a.enteteColonneStyle);}\n" +
    "  if(tot){el.style.background=fondClair(lg.teinte==='couleur');if(lg.gras==='oui')el.style.fontWeight='700';}\n" +
    "  if(a.separateurs!=='non'){el.style.borderBottom='1px solid '+ligne(a.separateurs==='couleur');}\n" +
    "  if(a.bordureHaute==='oui'){if(a.enteteLignes>0&&r===a.enteteLignes-1)el.style.borderBottom='2px solid '+ligne(true);else if(a.enteteLignes===0&&r===0)el.style.borderTop='2px solid '+ligne(true);}\n" +
    "  if(a.bordureBasse==='oui'&&(r+rs===dispo.nbLignes))el.style.borderBottom='2px solid '+ligne(true);\n" +
    "});}\n" +
    // --- rendu ---
    "function cellDom(c){var el=document.createElement(c.th?'th':'td');el.className='cell';el.dataset.li=c.li;el.dataset.ci=c.ci;\n" +
    "  el.dataset.r0=c.r0;el.dataset.c0=c.c0;el.dataset.rs=c.rowspan;el.dataset.cs=c.colspan;\n" +
    "  if(c.colspan>1)el.colSpan=c.colspan;if(c.rowspan>1)el.rowSpan=c.rowspan;\n" +
    "  poserInline(el,c.contenu);\n" +
    "  el.addEventListener('mousedown',function(ev){onCell(ev,c);});\n" +
    "  el.addEventListener('input',function(){etat('');});\n" +
    "  return el;}\n" +
    "function rendre(){zone.textContent='';if(!dispo)return;\n" +
    "  var t=document.createElement('table');t.className='grille';\n" +
    "  var trh=document.createElement('tr');var coin=document.createElement('th');coin.className='coin';trh.appendChild(coin);\n" +
    "  for(var c=0;c<dispo.nbColonnes;c++){var ph=document.createElement('th');ph.className='poignee';ph.textContent='';(function(cc){ph.addEventListener('click',function(){selCol(cc);});})(c);trh.appendChild(ph);}\n" +
    "  t.appendChild(trh);\n" +
    "  dispo.lignes.forEach(function(lg,r){var tr=document.createElement('tr');\n" +
    "    var pl=document.createElement('td');pl.className='poignee';pl.textContent='';(function(rr){pl.addEventListener('click',function(){selLigne(rr);});})(r);tr.appendChild(pl);\n" +
    "    lg.cellules.forEach(function(c){tr.appendChild(cellDom(c));});t.appendChild(tr);});\n" +
    "  zone.appendChild(t);majEditable();marquer();stylerApercu();}\n" +
    "function majEditable(){var ed=!plage();zone.querySelectorAll('.cell').forEach(function(el){el.contentEditable=ed?'true':'false';});}\n" +
    "function marquer(){zone.querySelectorAll('.cell').forEach(function(el){\n" +
    "  var cr={rMin:+el.dataset.r0,cMin:+el.dataset.c0,rMax:+el.dataset.r0+ +el.dataset.rs-1,cMax:+el.dataset.c0+ +el.dataset.cs-1};\n" +
    "  var dans=selection&&cr.rMin>=selection.rMin&&cr.rMax<=selection.rMax&&cr.cMin>=selection.cMin&&cr.cMax<=selection.cMax;\n" +
    "  el.classList.toggle('sel',!!dans);});}\n" +
    // --- interactions de sélection ---
    "function onCell(ev,c){if(ev.shiftKey&&ancre){ev.preventDefault();var sel=window.getSelection&&window.getSelection();if(sel)sel.removeAllRanges();\n" +
    "  selection=etendre(union(rectCell(ancre),rectCell(c)));majEditable();marquer();return;}\n" +
    "  ancre=c;selection=rectCell(c);majEditable();marquer();}\n" +
    "function selLigne(r){ancre=null;selection=etendre({rMin:r,cMin:0,rMax:r,cMax:dispo.nbColonnes-1});majEditable();marquer();}\n" +
    "function selCol(c){ancre=null;selection=etendre({rMin:0,cMin:c,rMax:dispo.nbLignes-1,cMax:c});majEditable();marquer();}\n" +
    // --- barre d'outils (T1 : structure) ---
    "function bouton(txt,fn,cls){var b=document.createElement('button');b.type='button';b.textContent=txt;if(cls)b.className=cls;b.addEventListener('click',fn);return b;}\n" +
    "function groupe(label){var g=document.createElement('span');g.className='grp';if(label){var l=document.createElement('span');l.className='lbl';l.textContent=label;g.appendChild(l);}return g;}\n" +
    "function op(nom,args){recolter();api.postMessage({type:'operation',nom:nom,args:args,modele:modele});}\n" +
    "function exigeSel(){if(!selection){etat(TXT.rien);return false;}return true;}\n" +
    "function construireBarre(){barre.textContent='';\n" +
    "  var gs=groupe(TXT.grpStructure);\n" +
    "  gs.appendChild(bouton(TXT.ajouterLigne,function(){op('ajouterLigne',{pos:selection?selection.rMax+1:dispo.nbLignes});}));\n" +
    "  gs.appendChild(bouton(TXT.supprimerLigne,function(){if(exigeSel())op('supprimerLigne',{rMin:selection.rMin,rMax:selection.rMax});}));\n" +
    "  gs.appendChild(bouton(TXT.ajouterColonne,function(){op('ajouterColonne',{pos:selection?selection.cMax+1:dispo.nbColonnes});}));\n" +
    "  gs.appendChild(bouton(TXT.supprimerColonne,function(){if(exigeSel())op('supprimerColonne',{cMin:selection.cMin,cMax:selection.cMax});}));\n" +
    "  barre.appendChild(gs);\n" +
    "  var gf=groupe('');\n" +
    "  gf.appendChild(bouton(TXT.fusionner,function(){if(!exigeSel())return;if(!plage()){etat(TXT.fusionImpossible);return;}op('fusionner',{rMin:selection.rMin,cMin:selection.cMin,rMax:selection.rMax,cMax:selection.cMax});}));\n" +
    "  gf.appendChild(bouton(TXT.scinder,function(){if(exigeSel())op('scinder',{rMin:selection.rMin,cMin:selection.cMin,rMax:selection.rMax,cMax:selection.cMax});}));\n" +
    "  barre.appendChild(gf);\n" +
    "  barreT2(barre);\n" +
    "  var enr=bouton(TXT.enregistrer,function(){recolter();api.postMessage({type:'enregistrer',modele:modele});},'principal');\n" +
    "  barre.appendChild(enr);\n" +
    "  var e=document.createElement('span');e.id='etat';e.setAttribute('role','status');barre.appendChild(e);}\n" +
    // --- barre d'outils (T2 : en-têtes + styles) ---
    "function selCtrl(parent,label,options,onCh){var g=groupe('');var l=document.createElement('span');l.className='lbl';l.textContent=label;g.appendChild(l);var s=document.createElement('select');options.forEach(function(o){var op=document.createElement('option');op.value=o[0];op.textContent=o[1];s.appendChild(op);});s.addEventListener('change',function(){onCh(s.value);});g.appendChild(s);parent.appendChild(g);return s;}\n" +
    "function STYLES(){return [['normal',TXT['st.normal']],['gras',TXT['st.gras']],['negatif',TXT['st.negatif']],['fond',TXT['st.fond']]];}\n" +
    "function onDefinirEntete(){if(!selection){etat(TXT.rien);return;}var s=selection,nbC=dispo.nbColonnes,nbL=dispo.nbLignes;\n" +
    "  if(s.rMin===0&&(s.cMax-s.cMin+1)===nbC&&!(s.rMax===nbL-1&&nbC===1)){op('entete',{sens:'lignes',n:Math.min(2,s.rMax+1)});}\n" +
    "  else if(s.cMin===0&&(s.rMax-s.rMin+1)===nbL){op('entete',{sens:'colonnes',n:Math.min(2,s.cMax+1)});}\n" +
    "  else if(s.rMin===0){op('entete',{sens:'lignes',n:Math.min(2,s.rMax+1)});}\n" +
    "  else if(s.cMin===0){op('entete',{sens:'colonnes',n:Math.min(2,s.cMax+1)});}\n" +
    "  else{etat(TXT.rien);}}\n" +
    "function appliquerTotal(){if(!selection){etat(TXT.rien);return;}op('total',{rMin:selection.rMin,rMax:selection.rMax,teinte:ctl.total.value,gras:ctl.totalGras.checked?'oui':'non'});}\n" +
    "function barreT2(barre){\n" +
    "  var ge=groupe(TXT.grpEntetes);\n" +
    "  ge.appendChild(bouton(TXT.entete,onDefinirEntete));\n" +
    "  ge.appendChild(bouton(TXT.enteteRetirer,function(){op('enteteRetirer',{});}));\n" +
    "  barre.appendChild(ge);\n" +
    "  ctl.styleLigne=selCtrl(barre,TXT.styleLigne,STYLES(),function(v){op('styleEntete',{cible:'ligne',valeur:v});});\n" +
    "  ctl.styleColonne=selCtrl(barre,TXT.styleColonne,STYLES(),function(v){op('styleEntete',{cible:'colonne',valeur:v});});\n" +
    "  var etiq=groupe('');var le=document.createElement('span');le.className='lbl';le.textContent=TXT.grpStyles;etiq.appendChild(le);barre.appendChild(etiq);\n" +
    "  ctl.zebre=selCtrl(barre,TXT.zebre,[['non',TXT['zebre.non']],['lignes',TXT['zebre.lignes']],['colonnes',TXT['zebre.colonnes']]],function(v){op('reglage',{champ:'zebre',valeur:v});});\n" +
    "  ctl.zebreTeinte=selCtrl(barre,TXT.teinte,[['gris',TXT['teinte.gris']],['couleur',TXT['teinte.couleur']]],function(v){op('reglage',{champ:'zebreTeinte',valeur:v});});\n" +
    "  ctl.separateurs=selCtrl(barre,TXT.separateurs,[['non',TXT['sep.non']],['gris',TXT['sep.gris']],['couleur',TXT['sep.couleur']]],function(v){op('reglage',{champ:'separateurs',valeur:v});});\n" +
    "  ctl.bordureHaute=selCtrl(barre,TXT.bordureHaute,[['non',TXT.non],['oui',TXT.oui]],function(v){op('reglage',{champ:'bordureHaute',valeur:v});});\n" +
    "  ctl.bordureBasse=selCtrl(barre,TXT.bordureBasse,[['non',TXT.non],['oui',TXT.oui]],function(v){op('reglage',{champ:'bordureBasse',valeur:v});});\n" +
    "  ctl.total=selCtrl(barre,TXT.total,[['non',TXT['total.non']],['gris',TXT['total.gris']],['couleur',TXT['total.couleur']]],function(v){appliquerTotal();});\n" +
    "  var gg=groupe('');var lab=document.createElement('label');lab.style.display='inline-flex';lab.style.alignItems='center';lab.style.gap='.25em';var cb=document.createElement('input');cb.type='checkbox';ctl.totalGras=cb;cb.addEventListener('change',appliquerTotal);lab.appendChild(cb);lab.appendChild(document.createTextNode(TXT['total.gras']));gg.appendChild(lab);barre.appendChild(gg);\n" +
    "  ctl.accent=selCtrl(barre,TXT.accent,[['gris',TXT['accent.gris']],['couleur',TXT['accent.couleur']]],function(v){accentMode=v;stylerApercu();});\n" +
    "  if(!accent){ctl.accent.title=TXT['accent.aucune'];}\n" +
    "}\n" +
    "function majT2(){if(!modele||!ctl.zebre)return;var a=modele.attrs;\n" +
    "  ctl.styleLigne.value=a.enteteLigneStyle;ctl.styleColonne.value=a.enteteColonneStyle;\n" +
    "  ctl.zebre.value=a.zebre;ctl.zebreTeinte.value=a.zebreTeinte;ctl.separateurs.value=a.separateurs;\n" +
    "  ctl.bordureHaute.value=a.bordureHaute;ctl.bordureBasse.value=a.bordureBasse;ctl.accent.value=accentMode;}\n" +
    "function etat(msg){var e=document.getElementById('etat');if(e)e.textContent=msg;}\n" +
    // --- clavier : Ctrl+B / Ctrl+I intra-cellule ---
    "try{document.execCommand('styleWithCSS',false,false);}catch(e){}\n" +
    "document.addEventListener('keydown',function(ev){if(!(ev.ctrlKey||ev.metaKey))return;var k=(ev.key||'').toLowerCase();\n" +
    "  if(k==='b'){ev.preventDefault();try{document.execCommand('bold');}catch(e){}}\n" +
    "  else if(k==='i'){ev.preventDefault();try{document.execCommand('italic');}catch(e){}}\n" +
    "  else if(k==='s'){ev.preventDefault();recolter();api.postMessage({type:'enregistrer',modele:modele});}});\n" +
    // --- messages ---
    "window.addEventListener('message',function(ev){var msg=ev.data||{};\n" +
    "  if(msg.type==='charger'){modele=msg.modele;dispo=msg.disposition;if(msg.i18n)TXT=msg.i18n;if(msg.accent!==undefined)accent=msg.accent;\n" +
    "    if(premierChargement){accentMode=accent?'couleur':'gris';premierChargement=false;}\n" +
    "    selection=clampSel(selection);ancre=null;aide.textContent=TXT.aide||'';construireBarre();rendre();majT2();etat('');}\n" +
    "  else if(msg.type==='enregistre'){etat(TXT.enregistre||'');}\n" +
    "  else if(msg.type==='erreur'){etat('\\u26A0 '+msg.message);}});\n" +
    "api.postMessage({type:'pret'});\n" +
    "})();";
}

let panneauxTable = new Map();   // fsPath -> WebviewPanel (un éditeur par fichier)

// Ouvre l'éditeur de tableau pour l'asset (viewItem == table) : lit table-NN.html,
// l'analyse, et alimente la webview. Écrit atomiquement à l'enregistrement.
function ouvrirEditeurTable(fournisseur, item) {
  if (!fournisseur.racine || !item || !item.cheminAsset) { return; }
  const chemin = item.cheminAsset;
  const nom = path.basename(chemin);
  const existant = panneauxTable.get(chemin);
  if (existant) { existant.reveal(vscode.ViewColumn.One); return; }
  const panneau = vscode.window.createWebviewPanel(
    'szhEditeurTable', T('table.titre', [nom]), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauxTable.set(chemin, panneau);
  panneau.onDidDispose(() => { if (panneauxTable.get(chemin) === panneau) { panneauxTable.delete(chemin); } });
  panneau.webview.html = htmlEditeurTable(crypto.randomBytes(16).toString('hex'));
  const charger = () => {
    let html = '';
    try { html = fs.readFileSync(chemin, 'utf8'); } catch (e) { html = '<table><tr><td></td></tr></table>'; }
    const modele = analyserTable(html);
    panneau.webview.postMessage({
      type: 'charger', modele: modele, disposition: disposition(modele),
      accent: lireCouleurAccent(fournisseur.racine), i18n: textesTable()
    });
  };
  panneau.webview.onDidReceiveMessage((msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') { charger(); return; }
    if (msg.type === 'operation') {
      const res = appliquerOperationTable(String(msg.nom || ''), msg.modele, msg.args);
      if (res && res.erreur) { panneau.webview.postMessage({ type: 'erreur', message: T(res.erreur) }); return; }
      panneau.webview.postMessage({ type: 'charger', modele: res, disposition: disposition(res), accent: lireCouleurAccent(fournisseur.racine) });
      return;
    }
    if (msg.type === 'enregistrer') {
      try {
        ecrireAusgabeAtomique(chemin, serialiserTable(normaliserModele(msg.modele)));
        panneau.webview.postMessage({ type: 'enregistre' });
        vscode.window.setStatusBarMessage(T('statut.table.enregistree', [nom]), 5000);
      } catch (e) {
        panneau.webview.postMessage({ type: 'erreur', message: T('err.ecriture', [e.message]) });
      }
    }
  });
}

function activate(context) {
  const fournisseur = new FournisseurRevue();
  const vue = vscode.window.createTreeView(ID_VUE, {
    treeDataProvider: fournisseur,
    showCollapseAll: false
  });
  context.subscriptions.push(vue);

  let watchers = [];
  // Un SEUL nettoyage enregistré (les watchers ne sont plus poussés dans
  // context.subscriptions à chaque réinstallation — correctif du nit S2).
  context.subscriptions.push({ dispose: () => { for (const w of watchers) { w.dispose(); } } });
  context.subscriptions.push({ dispose: arreterDormeurWsl });   // N1 : pas de dormant orphelin

  // Barre d'état « Aperçu : HTML / PDF » (M5, D53) — clic = basculer.
  const barreApercu = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  barreApercu.command = 'szh.basculerApercu';
  context.subscriptions.push(barreApercu);
  const majBarreApercu = () => {
    barreApercu.text = T(modeApercu() === 'html' ? 'apercu.barre.html' : 'apercu.barre.pdf');
    barreApercu.tooltip = T('apercu.barre.tooltip');
    if (fournisseur.racine) { barreApercu.show(); } else { barreApercu.hide(); }
  };

  // Le compte « Word en attente » est recalculé par getChildren (description de
  // section) ; le TITRE de la vue reflète le numéro (N2, D43) à chaque
  // rafraîchissement ; l'aperçu HTML est rechargé si sa sortie a été régénérée (M5).
  const rafraichirTout = () => {
    fournisseur.rafraichir();
    vue.title = fournisseur.racine ? titreNumero(fournisseur.racine) : T('arbre.titre.defaut');
    majBarreApercu();
    rechargerApercuHtmlSiChange(fournisseur);
  };

  // Regroupe les rafales d'événements FS (OneDrive peut en émettre plusieurs).
  let minuteur = null;
  const rafraichirBientot = () => {
    if (minuteur) { clearTimeout(minuteur); }
    minuteur = setTimeout(() => { minuteur = null; rafraichirTout(); }, 300);
  };

  const reinstallerWatchers = (racine) => {
    for (const w of watchers) { w.dispose(); }
    watchers = [];
    if (!racine) { return; }
    // Articles, Word déposés, sorties (le PDF apparaît/disparaît après build) ET
    // ausgabe.yaml (le titre de la vue suit les métadonnées — N2).
    for (const motif of ['articles/**', 'articles-word/*', 'out/**', 'ausgabe.yaml']) {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(racine, motif));
      w.onDidCreate(rafraichirBientot);
      w.onDidChange(rafraichirBientot);
      w.onDidDelete(rafraichirBientot);
      watchers.push(w);
    }
  };

  // Recalcule racine + contexte (montre/masque la vue) + watchers + dormant WSL,
  // puis rafraîchit.
  const majContexte = () => {
    const racine = trouverRacineRevue();
    fournisseur.definirRacine(racine);
    vscode.commands.executeCommand('setContext', CLE_CONTEXTE, !!racine);
    reinstallerWatchers(racine);
    if (racine) { demarrerDormeurWsl(); } else { arreterDormeurWsl(); }   // N1 (D42)
    rafraichirTout();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('szh.cockpit.rafraichir', majContexte),
    vscode.commands.registerCommand('szh.metadonnees', () => ouvrirMetadonnees(fournisseur, rafraichirTout)),
    vscode.commands.registerCommand('szh.apercuMetadonnees', () => ouvrirApercuMetadonnees(fournisseur, rafraichirTout)),
    vscode.commands.registerCommand('szh.reglages', () => ouvrirReglages(rafraichirTout)),
    vscode.commands.registerCommand('szh.basculerApercu', () => basculerApercu(fournisseur, majBarreApercu)),
    vscode.commands.registerCommand('szh.importerWord', () => importerWord(fournisseur, rafraichirTout)),
    vscode.commands.registerCommand('szh.convertirEnAttente', () => lancerConversion(fournisseur, rafraichirTout)),
    vscode.commands.registerCommand('szh.toutExporter', () => toutExporter(fournisseur, rafraichirTout)),
    vscode.commands.registerCommand('szh.ouvrirArticle', (slug) => ouvrirArticle(fournisseur, slug)),
    vscode.commands.registerCommand('szh.supprimerArticle', (item) => supprimerArticle(fournisseur, rafraichirTout, item)),
    vscode.commands.registerCommand('szh.remplacerAsset', (item) => remplacerAsset(fournisseur, rafraichirTout, item)),
    vscode.commands.registerCommand('szh.remplacerTable', (item) => remplacerTable(fournisseur, rafraichirTout, item)),
    vscode.commands.registerCommand('szh.editerTable', (item) => ouvrirEditeurTable(fournisseur, item)),
    vscode.workspace.onDidChangeWorkspaceFolders(majContexte)
  );

  enregistrerCommandesMiseEnForme(context);          // M6, D55

  majContexte();
}

function deactivate() { arreterDormeurWsl(); }

// `_pur` : fonctions pures exposées pour les harnais headless (VS Code les ignore).
module.exports = {
  activate, deactivate,
  _pur: {
    titreNumero, separerFrontmatter, analyserFrontmatter, serialiserFrontmatter,
    analyserMeta, serialiserMeta, lignePos,
    analyserAusgabe, serialiserAusgabe,
    basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
    enroberBloc, squeletteTableau,
    analyserTable, serialiserTable, disposition,
    matriceOccupation, etendreGrille, compacterGrille,
    normaliserModele, finaliserModele, canoniserInline,
    ajouterLigne, supprimerLigne, ajouterColonne, supprimerColonne,
    fusionner, scinder, appliquerOperationTable,
    TEXTES_COCKPIT
  }
};
