// Suggestions de traduction : le dossier traduction/ d'un numéro, un fichier JSON par
// proposition, et la lecture qui les rend.
//
// Une suggestion propose de formuler autrement un titre, un sous-titre, un résumé ou des
// mots-clés, avec une raison. Elle ne modifie pas le texte publié (articles/<slug>/
// <slug>.meta.yaml, écrit par les fiches et par lib/traduction.js) : quelqu'un la relira.
//
// Deux cibles, même format : un champ d'article (dans traduction/ du numéro), ou un libellé
// de l'outil cliqué en mode « Trad » (sur le poste, %LOCALAPPDATA%\SZH\suggestions-interface).
//
// traduction/ est à la racine du numéro, à côté de articles/ : les recensements d'articles
// (_sousDossiersAvecMd dans extension.js, listerSlugs dans lib/export-ojs.js) parcourent
// les sous-dossiers de articles/ et le prendraient pour un article.
//
// Un fichier par suggestion : OneDrive synchronise ces dossiers, et un fichier commun écrit
// par deux personnes produirait une copie en conflit.
//
// Le nom porte la date, l'article, le champ et la langue
// (20260914-103012-mon-article-title-de.json), suivi de -2, -3 si la seconde est déjà prise.
//
// Module pur. Le nom de l'auteur·e est passé par l'appelant (réglage szh.nomUtilisateur).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ecrireAtomique, LANGUES_META } = require('./yaml');
const { CHAMPS_TRADUISIBLES } = require('./traduction');
const { racineUtilisateur } = require('./poste');

// Le dossier, à la racine du numéro (voir l'en-tête).
const DOSSIER_SUGGESTIONS = 'traduction';
const LISEZ_MOI = 'LISEZ-MOI.txt';

// Version du format, écrite dans chaque fichier.
const SCHEMA = 'szh-suggestion-traduction/1';

// Le geste d'une suggestion : « remplacer » (ce texte serait mieux ainsi) ou « supprimer »
// (ce texte ne devrait pas exister ; un remplacement vide serait ambigu).
//
// Un fichier sans `geste` se lit « remplacer » (normaliserGeste). Un champ ajouté au format
// reçoit ainsi une valeur par défaut, et le schéma reste /1 tant qu'un ancien fichier
// reste lisible.
const GESTE_REMPLACER = 'remplacer';
const GESTE_SUPPRIMER = 'supprimer';

function normaliserGeste(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur).trim() === GESTE_SUPPRIMER
    ? GESTE_SUPPRIMER : GESTE_REMPLACER;
}

// La cible d'une suggestion : « article » (un champ traduisible, depuis une pastille) ou
// « interface » (un libellé de l'outil, cliqué en mode « Trad », rangé dans
// dossierSuggestionsInterface). Un fichier sans `cible` se lit « article » (normaliserCible).
const CIBLE_ARTICLE = 'article';
const CIBLE_INTERFACE = 'interface';

function normaliserCible(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur).trim() === CIBLE_INTERFACE
    ? CIBLE_INTERFACE : CIBLE_ARTICLE;
}

// Le LISEZ-MOI du dossier : français, puis allemand après « [de] », comme celui de
// .szh-avant-reimport (pipeline/reimporter.py). En CRLF, pour le Bloc-notes de Windows.
const TEXTE_LISEZ_MOI = [
  'Ce dossier contient des SUGGESTIONS de traduction.',
  '',
  'Un fichier JSON par suggestion, nommé par sa date, son article, son champ et sa langue.',
  'Chacun dit le texte qui était en place au moment de la suggestion, celui qui est proposé',
  'à la place, et pourquoi. Certains ne proposent rien : leur « geste » vaut « supprimer »,',
  'et ils disent que ce texte ne devrait pas exister du tout.',
  '',
  'RIEN ICI N’EST PUBLIÉ, et rien ici ne modifie aucun texte. Les titres, sous-titres,',
  'résumés et mots-clés du numéro vivent dans articles/<article>/<article>.meta.yaml, et',
  'seuls les formulaires du cockpit les écrivent. Une suggestion est une proposition : elle',
  'attend qu’une personne la lise et tranche.',
  '',
  'On peut donc supprimer un fichier d’ici sans rien casser — c’est la proposition qu’on',
  'jette, jamais le numéro.',
  '',
  '[de] Dieser Ordner enthält VORSCHLÄGE für Übersetzungen.',
  '',
  'Eine JSON-Datei pro Vorschlag, benannt nach Datum, Artikel, Feld und Sprache. Jede Datei',
  'nennt den Text, der zum Zeitpunkt des Vorschlags vorlag, den vorgeschlagenen Text und die',
  'Begründung. Manche schlagen nichts vor: ihr «geste» lautet «supprimer», und sie sagen,',
  'dass dieser Text gar nicht bestehen sollte.',
  '',
  'HIER WIRD NICHTS VERÖFFENTLICHT, und nichts hier ändert einen Text. Titel, Untertitel,',
  'Zusammenfassungen und Schlagwörter der Ausgabe liegen in',
  'articles/<Artikel>/<Artikel>.meta.yaml und werden ausschliesslich von den Formularen des',
  'Cockpits geschrieben. Ein Vorschlag bleibt ein Vorschlag, bis jemand ihn liest und',
  'entscheidet.',
  '',
  'Eine Datei von hier zu löschen schadet also nichts: verworfen wird der Vorschlag, nie die',
  'Ausgabe.',
  ''
].join('\r\n');

function dossierSuggestions(racine) {
  return path.join(String(racine || ''), DOSSIER_SUGGESTIONS);
}

// ---- Les suggestions sur les textes de l'outil ------------------------------------
//
// Une suggestion d'interface ne concerne aucun numéro : elle est rangée sur le poste, dans
// %LOCALAPPDATA%\SZH\suggestions-interface, un fichier JSON par suggestion.
const DOSSIER_INTERFACE = 'suggestions-interface';

function dossierSuggestionsInterface(base) {
  const b = String(base === undefined || base === null ? '' : base).trim() ||
    racineUtilisateur();
  return path.join(b, 'SZH', DOSSIER_INTERFACE);
}

// Le LISEZ-MOI du dossier de l'outil, même forme que celui des numéros.
const TEXTE_LISEZ_MOI_INTERFACE = [
  'Ce dossier contient des SUGGESTIONS sur les TEXTES DE L’OUTIL lui-même :',
  'les libellés des boutons, des formulaires et des messages du cockpit.',
  '',
  'Un fichier JSON par suggestion. Chacun dit le texte qui était affiché, celui qui est',
  'proposé à la place, pourquoi, et — quand elle a pu être retrouvée — la clé du libellé.',
  'Certains ne proposent rien : leur « geste » vaut « supprimer ».',
  '',
  'RIEN ICI NE CHANGE L’INTERFACE. Les libellés vivent dans le code de l’extension, et',
  'seule une nouvelle version les modifie. Transmettez ce dossier à la personne qui gère',
  'l’outil.',
  '',
  '[de] Dieser Ordner enthält VORSCHLÄGE zu den TEXTEN DES WERKZEUGS selbst:',
  'Beschriftungen der Schaltflächen, Formulare und Meldungen des Cockpits.',
  '',
  'Eine JSON-Datei pro Vorschlag. Jede nennt den angezeigten Text, den vorgeschlagenen',
  'Text, die Begründung und – sofern gefunden – den Schlüssel der Beschriftung. Manche',
  'schlagen nichts vor: ihr «geste» lautet «supprimer».',
  '',
  'HIER WIRD NICHTS AN DER OBERFLÄCHE GEÄNDERT. Die Beschriftungen liegen im Code der',
  'Erweiterung und ändern sich nur mit einer neuen Version. Leiten Sie diesen Ordner an die',
  'Person weiter, die das Werkzeug betreut.',
  ''
].join('\r\n');

// Deux chiffres, pour l'horodatage et pour le fuseau.
function p2(n) { return String(n).padStart(2, '0'); }

// ISO 8601 en heure locale, avec le fuseau : « 2026-09-14T10:30:12+02:00 ».
function horodatageIso(date) {
  const d = date instanceof Date ? date : new Date();
  const dec = -d.getTimezoneOffset();
  const abs = Math.abs(dec);
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
    'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) +
    (dec >= 0 ? '+' : '-') + p2(Math.floor(abs / 60)) + ':' + p2(abs % 60);
}

// <AAAAMMJJ-HHMMSS>, le début du nom de fichier, en heure locale.
function horodatageNom(date) {
  const d = date instanceof Date ? date : new Date();
  return String(d.getFullYear()) + p2(d.getMonth() + 1) + p2(d.getDate()) +
    '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
}

// Morceau de nom de fichier sûr : ni sortie du dossier, ni caractère refusé par Windows.
// Le champ et la langue viennent d'un message de webview.
function jeton(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur)
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'x';
}

function texteNet(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur).replace(/\r\n?/g, '\n');
}

// Le LISEZ-MOI est écrit à la création du dossier seulement, pour garder les annotations
// qu'on y aurait ajoutées. Un échec d'écriture est ignoré.
function poserLisezMoi(dossier, texte) {
  const chemin = path.join(dossier, LISEZ_MOI);
  try {
    if (fs.existsSync(chemin)) { return false; }
    ecrireAtomique(chemin, texte === undefined ? TEXTE_LISEZ_MOI : texte);
    return true;
  } catch (e) { return false; }
}

// Le premier nom libre pour ce début de nom : -2, -3… départagent deux suggestions sur le
// même champ dans la même seconde.
function nomLibre(dossier, souche) {
  let nom = souche + '.json';
  let n = 1;
  while (fs.existsSync(path.join(dossier, nom))) {
    n++;
    nom = souche + '-' + n + '.json';
  }
  return nom;
}

// L'auteur·e : le réglage szh.nomUtilisateur passé par l'appelant, sinon le compte Windows
// (comme lib/coedition.js).
function auteurSuggestion(nomRegle) {
  let nom = String(nomRegle === undefined || nomRegle === null ? '' : nomRegle).trim();
  if (nom === '') {
    try { nom = String(os.userInfo().username || '').trim(); }
    catch (e) { /* pas de compte lisible */ }
  }
  return nom === '' ? 'inconnu' : nom.slice(0, 80);
}

// La suggestion telle qu'elle est écrite, les clés dans l'ordre du format.
function construireSuggestion(infos, date) {
  const i = infos || {};
  const geste = normaliserGeste(i.geste);
  return {
    schema: SCHEMA,
    horodatage: horodatageIso(date),
    auteur: auteurSuggestion(i.auteur),
    cible: CIBLE_ARTICLE,
    produit: String(i.produit || ''),
    numero: String(i.numero || ''),
    article: String(i.article || ''),
    champ: String(i.champ || ''),
    langue: String(i.langue || ''),
    geste: geste,
    actuel: texteNet(i.actuel),
    // Une suppression ne porte pas de texte proposé, même si la zone de saisie en avait un.
    propose: geste === GESTE_SUPPRIMER ? '' : texteNet(i.propose),
    commentaire: texteNet(i.commentaire)
  };
}

// Vrai pour un remplacement identique au texte actuel et sans commentaire : il n'y a rien
// à écrire. Une suppression n'est jamais vide, d'où le test du geste en premier.
function estVide(suggestion) {
  if (normaliserGeste(suggestion.geste) === GESTE_SUPPRIMER) { return false; }
  return suggestion.propose.trim() === suggestion.actuel.trim() &&
    suggestion.commentaire.trim() === '';
}

// Écrit une suggestion. Rend { ok, chemin, nom, suggestion } ou { ok: false, raison }.
// `raison` vaut 'vide' (rien à proposer) ou 'ecriture' (avec `message`).
function ecrireSuggestion(racine, infos, date) {
  const suggestion = construireSuggestion(infos, date);
  if (estVide(suggestion)) { return { ok: false, raison: 'vide' }; }
  const dossier = dossierSuggestions(racine);
  try {
    fs.mkdirSync(dossier, { recursive: true });
    poserLisezMoi(dossier);
    const souche = horodatageNom(date) + '-' + jeton(suggestion.article) +
      '-' + jeton(suggestion.champ) + '-' + jeton(suggestion.langue);
    const nom = nomLibre(dossier, souche);
    const chemin = path.join(dossier, nom);
    ecrireAtomique(chemin, JSON.stringify(suggestion, null, 2) + '\n');
    return { ok: true, chemin: chemin, nom: nom, suggestion: suggestion };
  } catch (e) {
    return { ok: false, raison: 'ecriture', message: String((e && e.message) || e) };
  }
}

// La suggestion d'interface telle qu'elle est écrite : la clé du libellé si elle a été
// retrouvée (sinon null), et les clés candidates quand le texte en avait plusieurs.
function construireSuggestionInterface(infos, date) {
  const i = infos || {};
  const geste = normaliserGeste(i.geste);
  const cles = Array.isArray(i.cles) ? i.cles.map((c) => String(c)) : [];
  const cle = String(i.cle === undefined || i.cle === null ? '' : i.cle).trim();
  return {
    schema: SCHEMA,
    horodatage: horodatageIso(date),
    auteur: auteurSuggestion(i.auteur),
    cible: CIBLE_INTERFACE,
    // null et non '' : aucune clé n'a été retrouvée.
    cle: cle === '' ? null : cle,
    cles: cles,
    langue: String(i.langue || ''),
    geste: geste,
    actuel: texteNet(i.actuel),
    propose: geste === GESTE_SUPPRIMER ? '' : texteNet(i.propose),
    commentaire: texteNet(i.commentaire)
  };
}

// Écrit une suggestion d'interface dans le dossier du poste. Même mécanique que
// ecrireSuggestion, et mêmes retours : { ok, chemin, nom, suggestion } ou { ok: false, raison }.
// Le nom porte la clé, ou « sans-cle » si le texte n'a pas été identifié.
function ecrireSuggestionInterface(dossier, infos, date) {
  const suggestion = construireSuggestionInterface(infos, date);
  if (estVide(suggestion)) { return { ok: false, raison: 'vide' }; }
  try {
    fs.mkdirSync(dossier, { recursive: true });
    poserLisezMoi(dossier, TEXTE_LISEZ_MOI_INTERFACE);
    const souche = horodatageNom(date) + '-' + jeton(suggestion.cle || 'sans-cle') +
      '-' + jeton(suggestion.langue);
    const nom = nomLibre(dossier, souche);
    const chemin = path.join(dossier, nom);
    ecrireAtomique(chemin, JSON.stringify(suggestion, null, 2) + '\n');
    return { ok: true, chemin: chemin, nom: nom, suggestion: suggestion };
  } catch (e) {
    return { ok: false, raison: 'ecriture', message: String((e && e.message) || e) };
  }
}

// La plus récente d'abord. Dans la même seconde, le nom départage (le suffixe -2 avant le
// nom nu). Comparé sans l'extension : « . » se trie après « - », et « …-de.json »
// passerait avant « …-de-2.json ».
function comparerSuggestions(a, b) {
  if (a.horodatage !== b.horodatage) { return a.horodatage < b.horodatage ? 1 : -1; }
  const na = a.fichier.replace(/\.json$/i, '');
  const nb = b.fichier.replace(/\.json$/i, '');
  if (na === nb) { return 0; }
  return na < nb ? 1 : -1;
}

// Les suggestions d'un numéro, de la plus récente à la plus ancienne.
//
// Seuls les tests l'appellent pour l'instant (test/js/suggestion-traduction.test.js) :
// elle garantit que le format écrit se relit.
//
// Un fichier illisible (synchronisation en cours, retouche manuelle, fichier étranger) est
// sauté, pour ne pas bloquer la lecture du dossier.
function listerSuggestions(racine) {
  const dossier = dossierSuggestions(racine);
  let noms = [];
  try { noms = fs.readdirSync(dossier); }
  catch (e) { return []; }                  // pas de dossier : pas de suggestion
  const sorties = [];
  for (const nom of noms) {
    if (!/\.json$/i.test(nom)) { continue; }
    let valeurs;
    try { valeurs = JSON.parse(fs.readFileSync(path.join(dossier, nom), 'utf8')); }
    catch (e) { continue; }                 // illisible : sauté, pas levé
    if (!valeurs || typeof valeurs !== 'object' || Array.isArray(valeurs)) { continue; }
    sorties.push({
      fichier: nom,
      chemin: path.join(dossier, nom),
      schema: String(valeurs.schema || ''),
      horodatage: String(valeurs.horodatage || ''),
      auteur: String(valeurs.auteur || ''),
      // Absent d'un fichier ancien : « article ».
      cible: normaliserCible(valeurs.cible),
      produit: String(valeurs.produit || ''),
      numero: String(valeurs.numero || ''),
      article: String(valeurs.article || ''),
      champ: String(valeurs.champ || ''),
      langue: String(valeurs.langue || ''),
      // Absent d'un fichier ancien : « remplacer ».
      geste: normaliserGeste(valeurs.geste),
      actuel: texteNet(valeurs.actuel),
      propose: texteNet(valeurs.propose),
      commentaire: texteNet(valeurs.commentaire)
    });
  }
  return sorties.sort(comparerSuggestions);
}

// Les suggestions d'interface du poste, de la plus récente à la plus ancienne. Un dossier
// absent donne une liste vide, un fichier illisible est sauté.
function listerSuggestionsInterface(dossier) {
  let noms = [];
  try { noms = fs.readdirSync(dossier); }
  catch (e) { return []; }
  const sorties = [];
  for (const nom of noms) {
    if (!/\.json$/i.test(nom)) { continue; }
    let valeurs;
    try { valeurs = JSON.parse(fs.readFileSync(path.join(dossier, nom), 'utf8')); }
    catch (e) { continue; }
    if (!valeurs || typeof valeurs !== 'object' || Array.isArray(valeurs)) { continue; }
    sorties.push({
      fichier: nom,
      chemin: path.join(dossier, nom),
      schema: String(valeurs.schema || ''),
      horodatage: String(valeurs.horodatage || ''),
      auteur: String(valeurs.auteur || ''),
      cible: normaliserCible(valeurs.cible),
      cle: valeurs.cle === undefined || valeurs.cle === null || String(valeurs.cle) === ''
        ? null : String(valeurs.cle),
      cles: Array.isArray(valeurs.cles) ? valeurs.cles.map((c) => String(c)) : [],
      langue: String(valeurs.langue || ''),
      geste: normaliserGeste(valeurs.geste),
      actuel: texteNet(valeurs.actuel),
      propose: texteNet(valeurs.propose),
      commentaire: texteNet(valeurs.commentaire)
    });
  }
  return sorties.sort(comparerSuggestions);
}

// Nombre de suggestions en attente, compté sur les fichiers lisibles : le LISEZ-MOI et
// les copies en conflit ne comptent pas.
function compterSuggestionsInterface(dossier) {
  return listerSuggestionsInterface(dossier).length;
}

// Pour l'hôte : le champ et la langue viennent d'une webview ; seuls ceux de la fiche sont
// acceptés.
function champValide(champ) {
  return CHAMPS_TRADUISIBLES.indexOf(String(champ || '')) !== -1;
}
function langueValide(langue) {
  return LANGUES_META.indexOf(String(langue || '')) !== -1;
}

module.exports = {
  DOSSIER_SUGGESTIONS, LISEZ_MOI, SCHEMA, TEXTE_LISEZ_MOI,
  GESTE_REMPLACER, GESTE_SUPPRIMER, normaliserGeste,
  CIBLE_ARTICLE, CIBLE_INTERFACE, normaliserCible,
  DOSSIER_INTERFACE, TEXTE_LISEZ_MOI_INTERFACE, dossierSuggestionsInterface,
  dossierSuggestions, horodatageIso, horodatageNom, auteurSuggestion,
  construireSuggestion, construireSuggestionInterface, estVide, poserLisezMoi,
  ecrireSuggestion, ecrireSuggestionInterface,
  listerSuggestions, listerSuggestionsInterface, compterSuggestionsInterface,
  comparerSuggestions, champValide, langueValide
};
