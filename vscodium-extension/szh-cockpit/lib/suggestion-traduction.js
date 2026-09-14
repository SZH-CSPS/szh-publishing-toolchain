// Suggestions de traduction : le dossier traduction/ d'un numéro, un fichier JSON par
// proposition, et la lecture qui les rend.
//
// Ce que ce module garde, et ce qu'il ne fait pas. Une suggestion est une PROPOSITION :
// elle dit qu'un titre, un sous-titre, un résumé ou une liste de mots-clés gagnerait à
// être dit autrement, et pourquoi. Elle ne touche jamais au texte publié — celui-ci vit
// dans articles/<slug>/<slug>.meta.yaml et n'est édité que par le formulaire des fiches et
// par le panneau « Traductions ». Quelqu'un lira ces fichiers plus tard et tranchera ;
// d'ici là, rien n'a bougé. C'est toute la différence avec lib/traduction.js, qui, lui,
// écrit dans la fiche.
//
// DEUX CIBLES depuis le mode « Trad ». Une suggestion vise soit un champ d'ARTICLE (le
// geste d'origine, rangé dans traduction/ du numéro), soit un libellé de l'OUTIL lui-même
// (rangé sur le poste, %LOCALAPPDATA%\SZH\suggestions-interface). Même format, même
// mécanique, deux dossiers : un libellé de bouton n'appartient à aucun numéro.
//
// ⚠ Le dossier est FRÈRE de articles/, jamais dedans. Les deux recensements d'articles du
//   dépôt listent les sous-dossiers de <racine>/articles (FournisseurRevue._sousDossiersAvecMd
//   dans extension.js, listerSlugs dans lib/export-ojs.js) : un dossier « traduction »
//   placé là serait examiné comme un article — il n'y survivrait que parce qu'il ne porte
//   pas de traduction.md, ce qui est une chance, pas une règle. À la racine du numéro,
//   aucun recensement ne le regarde : le Makefile compile articles/, l'export OJS lit
//   articles/, et l'arbre du cockpit n'affiche que les sections de son profil.
//
// ⚠ Un fichier PAR suggestion, jamais un fichier commun. Ces dossiers sont synchronisés
//   par OneDrive : deux personnes qui écriraient tour à tour le même fichier
//   produiraient une « copie en conflit », et l'une des deux suggestions serait perdue de
//   vue. Des fichiers distincts se synchronisent sans jamais se rencontrer.
//
// Le nom porte la date, l'article, le champ et la langue —
// 20260914-103012-mon-article-title-de.json — pour qu'un dossier se lise sans ouvrir
// aucun fichier. Le suffixe -2, -3 lève l'égalité de la seconde.
//
// Module pur : ni vscode, ni réglage d'éditeur. L'auteur·e de la suggestion lui est passé
// par l'appelant, qui seul connaît le réglage szh.nomUtilisateur.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ecrireAtomique, LANGUES_META } = require('./yaml');
const { CHAMPS_TRADUISIBLES } = require('./traduction');

// Le dossier, à la racine du numéro. Voir l'avertissement de tête : frère de articles/.
const DOSSIER_SUGGESTIONS = 'traduction';
const LISEZ_MOI = 'LISEZ-MOI.txt';

// La version du format, écrite dans chaque fichier : un relecteur de 2030 doit pouvoir
// dire à quelle grammaire il a affaire sans la deviner.
const SCHEMA = 'szh-suggestion-traduction/1';

// Le GESTE d'une suggestion. « remplacer » dit « ce texte gagnerait à être dit ainsi » ;
// « supprimer » dit « ce texte ne devrait pas exister » — ce qu'une proposition de
// remplacement ne sait pas exprimer : proposer le vide est ambigu, on ne saurait pas si
// c'est un oubli.
//
// ⚠ RÈGLE DU CHAMP AJOUTÉ, et c'est pourquoi le schéma reste /1 : `geste` est apparu
//   APRÈS les premiers fichiers. Un fichier écrit avant lui n'en porte pas, et il se lit
//   comme « remplacer » — c'était son seul geste possible. normaliserGeste est le seul
//   endroit où cette règle est écrite, et listerSuggestions y passe comme
//   construireSuggestion. Tout champ qu'on ajouterait ensuite doit suivre la même
//   discipline : une valeur par défaut qui redonne le comportement d'avant, et le numéro
//   de schéma ne bouge que le jour où un fichier ancien deviendrait ILLISIBLE.
const GESTE_REMPLACER = 'remplacer';
const GESTE_SUPPRIMER = 'supprimer';

function normaliserGeste(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur).trim() === GESTE_SUPPRIMER
    ? GESTE_SUPPRIMER : GESTE_REMPLACER;
}

// La CIBLE d'une suggestion. « article » vise un champ traduisible d'un article — le geste
// d'origine, celui des pastilles. « interface » vise un libellé de l'outil lui-même, cliqué
// dans le mode « Trad » : elle ne concerne aucun numéro, ne porte ni produit, ni numéro, ni
// article, ni champ, et se range ailleurs (voir dossierSuggestionsInterface).
//
// ⚠ MÊME RÈGLE DU CHAMP AJOUTÉ que `geste`, et c'est pourquoi le schéma reste /1 : `cible`
//   est apparu APRÈS les premiers fichiers. Un fichier écrit avant lui n'en porte pas, et
//   il se lit « article » — c'était sa seule cible possible. normaliserCible est le seul
//   endroit où cette règle est écrite.
const CIBLE_ARTICLE = 'article';
const CIBLE_INTERFACE = 'interface';

function normaliserCible(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur).trim() === CIBLE_INTERFACE
    ? CIBLE_INTERFACE : CIBLE_ARTICLE;
}

// Le mode d'emploi laissé à qui tombe sur ce dossier, en français puis en allemand — même
// forme que celui de .szh-avant-reimport (pipeline/reimporter.py) : le texte français,
// puis une seconde moitié ouverte par « [de] ». Écrit en CRLF, comme lui : ces fichiers
// s'ouvrent dans le Bloc-notes de Windows.
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

// ---- Les suggestions sur les textes de l'OUTIL ------------------------------------
//
// Une suggestion d'interface ne concerne aucun numéro : la ranger dans le traduction/ d'un
// numéro la rendrait introuvable — elle partirait à l'archivage avec un numéro qui n'a rien
// à voir, et la même remarque, faite depuis deux numéros, s'éparpillerait. Elle vit donc sur
// le POSTE, dans %LOCALAPPDATA%\SZH\suggestions-interface. Un fichier JSON par suggestion,
// pour la même raison que pour les autres.
const DOSSIER_INTERFACE = 'suggestions-interface';

function dossierSuggestionsInterface(base) {
  const b = String(base === undefined || base === null ? '' : base).trim() ||
    String(process.env.LOCALAPPDATA || '');
  return path.join(b, 'SZH', DOSSIER_INTERFACE);
}

// Le mode d'emploi du dossier de l'outil. Celui des numéros parle de meta.yaml et n'aurait
// aucun sens ici ; même forme, français puis « [de] », CRLF pour le Bloc-notes.
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

// ISO 8601 AVEC fuseau, et en heure locale : « 2026-09-14T10:30:12+02:00 ». Un horodatage
// nu se relirait à une heure près selon le lecteur, et un Z forcerait chacun à convertir
// mentalement l'heure de la rédaction.
function horodatageIso(date) {
  const d = date instanceof Date ? date : new Date();
  const dec = -d.getTimezoneOffset();
  const abs = Math.abs(dec);
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
    'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) +
    (dec >= 0 ? '+' : '-') + p2(Math.floor(abs / 60)) + ':' + p2(abs % 60);
}

// <AAAAMMJJ-HHMMSS>, la souche du nom de fichier. Heure locale, comme ci-dessus : c'est
// l'heure que la personne avait sous les yeux.
function horodatageNom(date) {
  const d = date instanceof Date ? date : new Date();
  return String(d.getFullYear()) + p2(d.getMonth() + 1) + p2(d.getDate()) +
    '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
}

// Un nom de fichier ne doit jamais pouvoir sortir du dossier ni porter un caractère que
// Windows refuse : le slug vient du disque, mais le champ et la langue viennent d'un
// message de webview.
function jeton(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur)
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'x';
}

function texteNet(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur).replace(/\r\n?/g, '\n');
}

// Le mode d'emploi n'est posé QU'À LA CRÉATION, et jamais réécrit : quelqu'un a pu
// l'annoter, ou le traduire dans une troisième langue, et une réécriture à chaque
// suggestion effacerait cela sans rien dire. Son échec n'est jamais fatal — le mode
// d'emploi n'est pas la suggestion.
function poserLisezMoi(dossier, texte) {
  const chemin = path.join(dossier, LISEZ_MOI);
  try {
    if (fs.existsSync(chemin)) { return false; }
    ecrireAtomique(chemin, texte === undefined ? TEXTE_LISEZ_MOI : texte);
    return true;
  } catch (e) { return false; }
}

// Le premier nom libre de la souche donnée. Le suffixe lève l'égalité de la seconde : deux
// suggestions sur le même champ dans la même seconde — un clic, une correction, un second
// clic — ne doivent pas s'écraser.
function nomLibre(dossier, souche) {
  let nom = souche + '.json';
  let n = 1;
  while (fs.existsSync(path.join(dossier, nom))) {
    n++;
    nom = souche + '-' + n + '.json';
  }
  return nom;
}

// Qui propose : ce que l'appelant sait (le réglage szh.nomUtilisateur), sinon le compte
// Windows. Même repli que l'identité de co-édition (lib/coedition.js).
function auteurSuggestion(nomRegle) {
  let nom = String(nomRegle === undefined || nomRegle === null ? '' : nomRegle).trim();
  if (nom === '') {
    try { nom = String(os.userInfo().username || '').trim(); }
    catch (e) { /* pas de compte lisible */ }
  }
  return nom === '' ? 'inconnu' : nom.slice(0, 80);
}

// La suggestion telle qu'elle est écrite. L'ordre des clés est celui du format : un
// fichier se lit de haut en bas sans sauter.
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
    // Une suppression ne propose AUCUN texte, et le fichier doit le montrer : laisser
    // passer ce que le formulaire avait dans sa zone de saisie donnerait à relire une
    // proposition de remplacement là où personne n'en a fait.
    propose: geste === GESTE_SUPPRIMER ? '' : texteNet(i.propose),
    commentaire: texteNet(i.commentaire)
  };
}

// Une suggestion identique au texte actuel ET sans commentaire ne dit rien : elle n'a pas
// à devenir un fichier que quelqu'un ouvrira pour n'y rien trouver. Le refus est rendu à
// l'appelant, qui l'affiche ; ce module n'a pas de voix.
//
// ⚠ Une SUPPRESSION n'a jamais de texte proposé : la comparer au texte actuel la
//   déclarerait vide de sens et la refuserait sans commentaire, alors qu'elle porte à elle
//   seule tout son propos — ce texte ne devrait pas exister. Le geste se lit donc avant la
//   comparaison, et non après.
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

// La suggestion d'interface telle qu'elle est écrite. Ni produit, ni numéro, ni article,
// ni champ : rien de tout cela n'existe ici. À la place, la CLÉ du libellé quand elle a été
// retrouvée (sinon null), et les candidates quand le texte en avait plusieurs — les garder
// dit au relecteur ce que l'outil avait proposé, et pourquoi telle clé a été retenue.
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
    // Null et non '' : « aucune clé retrouvée » n'est pas « clé vide ». Le formulaire
    // s'ouvre quand même dans ce cas, et c'est justement celui qu'un mainteneur veut voir.
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
// Le nom porte la clé quand il y en a une, « sans-cle » sinon : un dossier se lit sans
// ouvrir un seul fichier, et les textes non identifiés s'y repèrent d'un coup d'oeil.
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

// Le tri : la plus récente d'abord. À horodatage égal — la même seconde — c'est le nom qui
// tranche, et le suffixe -2 vient donc avant le nom nu, dans l'ordre où ils ont été
// écrits. Comparé sans l'extension, sans quoi « …-de.json » passerait avant « …-de-2.json »
// (« . » est au-dessus de « - »).
function comparerSuggestions(a, b) {
  if (a.horodatage !== b.horodatage) { return a.horodatage < b.horodatage ? 1 : -1; }
  const na = a.fichier.replace(/\.json$/i, '');
  const nb = b.fichier.replace(/\.json$/i, '');
  if (na === nb) { return 0; }
  return na < nb ? 1 : -1;
}

// Les suggestions d'un numéro, de la plus récente à la plus ancienne.
//
// Rien ne l'appelle encore, et c'est voulu : sans lecture, on écrirait un format que rien
// ne saurait relire, et une faute de structure passerait des mois sans se voir. C'est elle
// que test/js/suggestion-traduction.test.js exerce.
//
// Un fichier illisible — tronqué par une synchronisation en cours, ouvert et mal
// réenregistré à la main, ou simplement étranger — est SAUTÉ, jamais levé : une seule
// mauvaise pièce ne doit pas emporter la lecture de tout le dossier. Le LISEZ-MOI n'est
// pas un .json, il ne se présente donc jamais ici.
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
      // Le champ ajouté : absent d'un fichier ancien, il se relit « article ».
      cible: normaliserCible(valeurs.cible),
      produit: String(valeurs.produit || ''),
      numero: String(valeurs.numero || ''),
      article: String(valeurs.article || ''),
      champ: String(valeurs.champ || ''),
      langue: String(valeurs.langue || ''),
      // Le champ ajouté : absent d'un fichier ancien, il se relit « remplacer ».
      geste: normaliserGeste(valeurs.geste),
      actuel: texteNet(valeurs.actuel),
      propose: texteNet(valeurs.propose),
      commentaire: texteNet(valeurs.commentaire)
    });
  }
  return sorties.sort(comparerSuggestions);
}

// Les suggestions d'interface du poste, de la plus récente à la plus ancienne. Mêmes
// tolérances que ci-dessus : pas de dossier, pas de suggestion ; un fichier illisible est
// sauté, jamais levé.
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

// Combien en attente. Compté sur les fichiers relus et non sur le contenu du dossier : le
// LISEZ-MOI et une copie en conflit du synchroniseur ne sont pas des suggestions.
function compterSuggestionsInterface(dossier) {
  return listerSuggestionsInterface(dossier).length;
}

// Garde-fous de l'hôte : le champ et la langue viennent d'un message de webview, et seuls
// ceux que la fiche connaît ont un sens ici.
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
