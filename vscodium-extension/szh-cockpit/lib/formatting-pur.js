// Partie de la mise en forme qui ne dépend pas de `vscode` : transformations de texte,
// blocs ::: , tableaux, notes, liens, noms de fichiers libres et palette du menu
// contextuel. lib/medias.js et lib/panneaux.js l'utilisent hors de l'éditeur ;
// lib/formatting.js la réexporte.
'use strict';

const fs = require('fs');
const path = require('path');
const { finaliserModele, PRESETS_TABLE } = require('./table-model');
const { RE_DIV_OUVERTURE, RE_DIV_FERMETURE, fermetureDeDiv } = require('./references');
const { analyserAusgabe } = require('./yaml');

// ---- Mise en forme au clic droit et aux raccourcis ----

function estEnrobe(t, marqueur) {
  if (t.length < marqueur.length * 2) { return false; }
  if (!t.startsWith(marqueur) || !t.endsWith(marqueur)) { return false; }
  // « **x** » est en gras, pas en italique : l'italique s'y ajoute au lieu d'ôter une étoile.
  if (marqueur === '*' && (t.startsWith('**') || t.endsWith('**'))) { return false; }
  return true;
}

function basculerEnrobage(texte, marqueur) {
  const t = String(texte);
  if (estEnrobe(t, marqueur)) { return t.slice(marqueur.length, t.length - marqueur.length); }
  return marqueur + t + marqueur;
}

function basculerSouligne(texte) {
  const t = String(texte);
  const m = t.match(/^\[([\s\S]*)\]\{\.underline\}$/);
  return m ? m[1] : '[' + t + ']{.underline}';
}

function basculerTitre(texte, niveau) {
  const t = String(texte);
  const m = t.match(/^(#{1,6})\s+/);
  if (m && m[1].length === niveau) { return t.replace(/^#{1,6}\s+/, ''); }
  return '#'.repeat(niveau) + ' ' + t.replace(/^#{1,6}\s+/, '');
}

function basculerCitation(texte) {
  const lignes = String(texte).split('\n');
  const nonVides = lignes.filter((l) => l !== '');
  const toutesCitees = nonVides.length > 0 && nonVides.every((l) => /^>\s?/.test(l));
  if (toutesCitees) { return lignes.map((l) => l.replace(/^>\s?/, '')).join('\n'); }
  return lignes.map((l) => '> ' + l).join('\n');
}

// Attribut d'un bloc de classe : {.classe} ou {.classe data-titre="…"}. Antislash puis
// guillemets sont échappés, comme dans citerValeur() de lib/references.js ; pandoc lit
// cette forme et le titre garde ses guillemets.
function attrBloc(classe, titre) {
  const titrePropre = String(titre || '').trim();
  if (titrePropre === '') { return '{.' + classe + '}'; }
  const echappe = titrePropre.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return '{.' + classe + ' data-titre="' + echappe + '"}';
}

function enroberBloc(texte, classe, titre) {
  return '::: ' + attrBloc(classe, titre) + '\n' + String(texte) + '\n:::';
}

// ---- Pose d'un bloc ::: de classe (.important, .highlight, .question) ----
//
// Un « fenced div » pandoc commence en colonne 0 et est séparé de ses voisins par une
// ligne vide. Réappliquer la commande dans un bloc existant met à jour sa ligne
// d'ouverture au lieu d'imbriquer un second bloc.

// Les classes que poserBloc peut réécrire. Les autres divs (.szh-tabelle, .szh-saut)
// portent des données (src=…) : le nouveau bloc se pose après eux.
const CLASSES_BLOCS = ['important', 'highlight', 'question'];

// Le fenced div qui contient les lignes [debut, fin], ou null. En remontant, une
// fermeture au-dessus de la première ligne signifie que la sélection est hors bloc. Un
// bloc jamais refermé ne compte pas.
function blocAutour(lignes, debut, fin) {
  let ouverture = -1;
  for (let i = debut; i >= 0; i--) {
    if (RE_DIV_OUVERTURE.test(lignes[i])) { ouverture = i; break; }
    if (i < debut && RE_DIV_FERMETURE.test(lignes[i])) { return null; }
  }
  if (ouverture === -1) { return null; }
  const fermeture = fermetureDeDiv(lignes, ouverture);
  if (fermeture === -1 || fin > fermeture) { return null; }
  return { ouverture: ouverture, fermeture: fermeture,
    attrs: RE_DIV_OUVERTURE.exec(lignes[ouverture])[1] };
}

// poserBloc(lignes, sel, classe, titre) -> { ligneDebut, ligneFin, texte, curseur }
//
// `lignes` : les lignes du document ; `sel` : { debutLigne, debutCol, finLigne, finCol }.
// Rend la plage de lignes entières à remplacer, son nouveau texte, et le curseur, posé en
// fin de la dernière ligne de contenu : une seconde frappe retombe ainsi dans le bloc et
// le met à jour. appliquerBlocClasse (lib/formatting.js) en fait une édition vscode.
function poserBloc(lignes, sel, classe, titre) {
  const tab = Array.isArray(lignes) && lignes.length > 0
    ? lignes.map((x) => String(x === undefined || x === null ? '' : x)) : [''];
  const borne = (n, max) => Math.max(0, Math.min(Number(n) || 0, max));
  let dl = borne(sel && sel.debutLigne, tab.length - 1);
  let fl = borne(sel && sel.finLigne, tab.length - 1);
  if (fl < dl) { const t = dl; dl = fl; fl = t; }
  let dc = borne(sel && sel.debutCol, tab[dl].length);
  let fc = borne(sel && sel.finCol, tab[fl].length);
  if (dl === fl && fc < dc) { const t = dc; dc = fc; fc = t; }

  const existant = blocAutour(tab, dl, fl);
  const aNous = existant
    && CLASSES_BLOCS.some((c) => existant.attrs.split(/\s+/).indexOf('.' + c) !== -1);
  let morceaux;          // les lignes de remplacement
  let fermetureIdx;      // la ligne « ::: » du bloc posé, dans morceaux
  let ligneDebut, ligneFin;
  let bordHaut = true, bordBas = true;   // le bloc touche-t-il le bord de la plage ?

  if (aNous) {
    // Dans un bloc de CLASSES_BLOCS : nouvelle ligne d'ouverture, contenu inchangé.
    morceaux = ['::: ' + attrBloc(classe, titre)]
      .concat(tab.slice(existant.ouverture + 1, existant.fermeture), [':::']);
    fermetureIdx = morceaux.length - 1;
    ligneDebut = existant.ouverture;
    ligneFin = existant.fermeture;
  } else if (existant) {
    // Dans un autre div : le nouveau bloc, vide, se pose après sa fermeture.
    morceaux = [tab[existant.fermeture], ''].concat(enroberBloc('', classe, titre).split('\n'));
    fermetureIdx = morceaux.length - 1;
    ligneDebut = existant.fermeture;
    ligneFin = existant.fermeture;
    bordHaut = false;                    // la fermeture du div étranger reste en tête
  } else {
    // La sélection devient le contenu du bloc. Les restes d'une ligne coupée restent
    // autour, séparés par une ligne vide ; un reste de blancs seuls est abandonné.
    const avant = tab[dl].slice(0, dc);
    const apres = tab[fl].slice(fc);
    const contenu = dl === fl ? tab[dl].slice(dc, fc)
      : [tab[dl].slice(dc)].concat(tab.slice(dl + 1, fl), [tab[fl].slice(0, fc)]).join('\n');
    const pre = avant.trim() === '' ? [] : [avant.replace(/\s+$/, ''), ''];
    const post = apres.trim() === '' ? [] : ['', apres.replace(/^\s+/, '')];
    const bloc = enroberBloc(contenu, classe, titre).split('\n');
    morceaux = pre.concat(bloc, post);
    fermetureIdx = pre.length + bloc.length - 1;
    ligneDebut = dl;
    ligneFin = fl;
    bordHaut = pre.length === 0;
    bordBas = post.length === 0;
  }

  // Les lignes vides voisines sont reprises dans la plage puis réémises : une seule
  // contre un voisin non vide, aucune contre le bord du document. Ainsi elles ne
  // s'accumulent pas d'une pose à l'autre.
  if (bordHaut) {
    while (ligneDebut > 0 && tab[ligneDebut - 1].trim() === '') { ligneDebut--; }
    if (ligneDebut > 0) { morceaux.unshift(''); fermetureIdx++; }
  }
  if (bordBas) {
    while (ligneFin + 1 < tab.length && tab[ligneFin + 1].trim() === '') { ligneFin++; }
    if (ligneFin + 1 < tab.length) { morceaux.push(''); }
  }
  return {
    ligneDebut: ligneDebut, ligneFin: ligneFin, texte: morceaux.join('\n'),
    curseur: { ligne: ligneDebut + fermetureIdx - 1, colonne: morceaux[fermetureIdx - 1].length }
  };
}

function squeletteTableau(colonne) {
  const c = String(colonne || 'Colonne');
  return [
    '| ' + c + ' 1 | ' + c + ' 2 | ' + c + ' 3 |',
    '|---|---|---|',
    '|  |  |  |',
    '|  |  |  |'
  ].join('\n');
}

// ---- Insérer un tableau ----

function tableauVierge(colonne) {
  const c = String(colonne || 'Colonne');
  const cellule = (contenu) => ({ contenu: contenu, colspan: 1, rowspan: 1, th: false, scope: '', align: 'left' });
  const lignes = [{ cellules: [cellule(c + ' 1'), cellule(c + ' 2'), cellule(c + ' 3')] }];
  for (let i = 0; i < 2; i++) { lignes.push({ cellules: [cellule(''), cellule(''), cellule('')] }); }
  return finaliserModele({
    attrs: Object.assign({ enteteLignes: 1 }, PRESETS_TABLE.academique),
    lignes: lignes
  });
}

// Nombre d'essais avant d'abandonner la recherche d'un nom libre.
const BORNE_NOM_LIBRE = 1000;

// Premier nom libre dans `dossier` : `nom`, ou `nom-1`, `nom-2`… L'appelant a déjà
// assaini le nom (nomImageAssaini, lib/medias.js).
function nomMediaUnique(dossier, nom) {
  const ext = path.extname(nom);
  const base = path.basename(nom, ext);
  let candidat = nom;
  let i = 1;
  while (fs.existsSync(path.join(dossier, candidat))) {
    if (i > BORNE_NOM_LIBRE) {
      throw new Error('nomMediaUnique : aucun nom libre pour « ' + nom + ' » dans ' + dossier
        + ' après ' + BORNE_NOM_LIBRE + ' essais.');
    }
    candidat = base + '-' + i + ext;
    i++;
  }
  return candidat;
}

// Premier nom table-NN.html libre (NN sur deux chiffres, comme pipeline/docx-tables.py).
function nomTableLibre(dossier) {
  for (let n = 1; n < 1000; n++) {
    const nom = 'table-' + (n < 10 ? '0' + n : String(n)) + '.html';
    let pris = false;
    try { pris = fs.existsSync(path.join(dossier, nom)); } catch (e) { pris = false; }
    if (!pris) { return nom; }
  }
  return 'table-999.html';
}

// Bloc de référence à un tableau, sous la forme que pose szh-tabelle-reference.lua et que
// lit szh-tabelle-inclure.lua. Une ligne vide le sépare du texte voisin (`avant`, `apres`).
function blocReferenceTable(nom, avant, apres) {
  const bloc = '::: {.szh-tabelle src="tables/' + nom + '"}\n:::';
  return (String(avant || '').trim() === '' ? '' : '\n\n') + bloc
       + (String(apres || '').trim() === '' ? '' : '\n\n');
}

// Saut de page : un fenced div vide .szh-saut, que print.css traduit en saut de page
// (`\newpage` ne vaut que pour LaTeX). Sans effet en HTML.
function blocSautPage(avant, apres) {
  const bloc = '::: {.szh-saut}\n:::';
  return (String(avant || '').trim() === '' ? '' : '\n\n') + bloc
       + (String(apres || '').trim() === '' ? '' : '\n\n');
}

// insererBlocIsole(lignes, point, bloc) -> { ligneDebut, ligneFin, texte, curseur }
//
// Pose un bloc ::: (saut de page, référence de tableau, en-tête FALC, QR) au point
// d'insertion, séparé de chaque voisin non vide par une ligne vide ; sans elle, pandoc
// lirait le bloc comme la suite du paragraphe. Les lignes vides voisines sont traitées
// comme dans poserBloc. Une ligne coupée garde ses deux moitiés autour du bloc.
// `curseur` : la ligne d'ouverture du bloc.
function insererBlocIsole(lignes, point, bloc) {
  const tab = Array.isArray(lignes) && lignes.length > 0
    ? lignes.map((x) => String(x === undefined || x === null ? '' : x)) : [''];
  const ligne = Math.max(0, Math.min(Number(point && point.ligne) || 0, tab.length - 1));
  const col = Math.max(0, Math.min(Number(point && point.colonne) || 0, tab[ligne].length));
  const avant = tab[ligne].slice(0, col).replace(/\s+$/, '');
  const apres = tab[ligne].slice(col).replace(/^\s+/, '');
  const corps = String(bloc).split('\n');
  const morceaux = (avant ? [avant, ''] : []).concat(corps, apres ? ['', apres] : []);
  let ligneDebut = ligne, ligneFin = ligne, debutBloc = avant ? 2 : 0;
  if (!avant) {
    while (ligneDebut > 0 && tab[ligneDebut - 1].trim() === '') { ligneDebut--; }
    if (ligneDebut > 0) { morceaux.unshift(''); debutBloc++; }
  }
  if (!apres) {
    while (ligneFin + 1 < tab.length && tab[ligneFin + 1].trim() === '') { ligneFin++; }
    if (ligneFin + 1 < tab.length) { morceaux.push(''); }
  }
  return { ligneDebut: ligneDebut, ligneFin: ligneFin, texte: morceaux.join('\n'),
    curseur: { ligne: ligneDebut + debutBloc, colonne: 0 } };
}

const BLOC_SAUT_PAGE = '::: {.szh-saut}\n:::';

function blocTableSeul(nom) {
  return '::: {.szh-tabelle src="tables/' + nom + '"}\n:::';
}

// ---- Insérer une note de bas de page ----
//
// La note s'écrit en référence : [^n] dans le texte, sa définition [^n]: en fin de
// document. C'est la forme que produit l'import Word (pipeline/import-docx.sh), et elle
// garde le paragraphe lisible, contrairement à la note en ligne ^[…].

// Le plus petit entier absent des étiquettes [^n] du document. Les étiquettes non
// numériques ([^note-a]) sont ignorées.
function premiereNoteLibre(texte) {
  const prises = new Set();
  const re = /\[\^(\d+)\]/g;
  let m;
  while ((m = re.exec(texte)) !== null) { prises.add(Number(m[1])); }
  let n = 1;
  while (prises.has(n)) { n++; }
  return n;
}

// noteBasPage(lignes, sel) -> { ligneDebut, ligneFin, texte, curseur }
//
// `lignes` : les lignes du document ; `sel` : { debutLigne, debutCol, finLigne, finCol }.
// Pose l'appel [^n] à la fin de la sélection, dont le texte reste en place, et ajoute la
// définition [^n]: en fin de document, précédée d'une ligne vide (pandoc l'exige). Le
// curseur est rendu en fin de la définition. fmtNoteBasPage (lib/formatting.js) en fait
// une édition vscode.
function noteBasPage(lignes, sel) {
  const tab = Array.isArray(lignes) && lignes.length > 0
    ? lignes.map((x) => String(x === undefined || x === null ? '' : x)) : [''];
  const borne = (n, max) => Math.max(0, Math.min(Number(n) || 0, max));
  let dl = borne(sel && sel.debutLigne, tab.length - 1);
  let fl = borne(sel && sel.finLigne, tab.length - 1);
  if (fl < dl) { const t = dl; dl = fl; fl = t; }
  let dc = borne(sel && sel.debutCol, tab[dl].length);
  let fc = borne(sel && sel.finCol, tab[fl].length);
  if (dl === fl && fc < dc) { const t = dc; dc = fc; fc = t; }

  const etiquette = '[^' + premiereNoteLibre(tab.join('\n')) + ']';
  const ligneAppel = tab[fl].slice(0, fc) + etiquette + tab[fl].slice(fc);
  const suite = tab.slice(fl + 1);

  // La dernière ligne se lit après la pose de l'appel, qui a pu la rendre non vide.
  const derniereLigne = suite.length > 0 ? suite[suite.length - 1] : ligneAppel;
  const definition = (derniereLigne.trim() === '' ? [] : ['']).concat([etiquette + ': ']);

  const morceaux = [ligneAppel].concat(suite, definition);
  return {
    ligneDebut: fl,
    ligneFin: tab.length - 1,
    texte: morceaux.join('\n'),
    curseur: { ligne: fl + morceaux.length - 1, colonne: morceaux[morceaux.length - 1].length }
  };
}

// ---- Insérer un lien ----
//
// normaliserUrl(brut) -> adresse prête pour un lien Markdown, ou null si la saisie n'est
// pas une adresse. « www.csps.ch » devient https://www.csps.ch, « nom@csps.ch » un
// mailto: ; une adresse avec schéma est gardée. Espaces, parenthèses et chevrons sont
// encodés, car ils fermeraient le lien au mauvais endroit.
function normaliserUrl(brut) {
  let u = String(brut === undefined || brut === null ? '' : brut).trim();
  if (u === '') { return null; }
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) {
    // « https:// » seul, la valeur proposée par défaut, n'est pas une adresse.
    if (/^[a-z][a-z0-9+.-]*:\/*$/i.test(u)) { return null; }
  } else if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(u)) {
    u = 'mailto:' + u;
  } else if (/^[^\s/]+\.[^\s/]+/.test(u)) {
    u = 'https://' + u;
  } else {
    return null;
  }
  return u.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
    .replace(/</g, '%3C').replace(/>/g, '%3E');
}

// lienMarkdown(texte, url) -> [texte](url). Seuls les crochets du texte sont échappés :
// l'italique ou le gras d'une sélection restent actifs à l'intérieur du lien.
function lienMarkdown(texte, url) {
  const t = String(texte === undefined || texte === null ? '' : texte).replace(/([[\]])/g, '\\$1');
  return '[' + t + '](' + url + ')';
}

// ---- Livre : en-tête de chapitre FALC et code QR (docs/ARCHITECTURE-LIVRES.md) ----
//
// Texte des deux snippets du profil livre : l'encadré « cette histoire existe aussi en
// audio » et le QR cliquable. fmtFalcHeader et fmtQrLink (lib/formatting.js) les posent
// en vscode.SnippetString.

// Textes par défaut de l'en-tête FALC, dans les quatre langues qu'accepte buch.yaml.
const FALC_HEADER_TEXTES = {
  fr: { audio: 'Cette histoire existe aussi en audio.', scan: 'Scannez le code QR.', ecoute: 'Écoutez l’histoire.' },
  de: { audio: 'Diese Geschichte gibt es auch zum Hören.', scan: 'Scannen Sie den QR-Code.', ecoute: 'Hören Sie zu.' },
  it: { audio: 'Questa storia esiste anche in versione audio.', scan: 'Scansiona il codice QR.', ecoute: 'Ascolta la storia.' },
  en: { audio: 'This story is also available as audio.', scan: 'Scan the QR code.', ecoute: 'Listen to the story.' }
};

// Langue du livre (`lang` de buch.yaml), 'fr' si le fichier est illisible ou la langue
// inconnue. yaml.langueRevue() ne convient pas : elle écarte 'en'.
function langueLivre(racine) {
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(String(racine || ''), 'buch.yaml'), 'utf8')); }
  catch (e) { /* illisible ou absent : repli fr */ }
  const brut = String(valeurs.lang || '').toLowerCase().slice(0, 2);
  return FALC_HEADER_TEXTES[brut] ? brut : 'fr';
}

// Corps du snippet d'en-tête FALC : un intitulé et deux étapes (${1} à ${3}, dans la
// langue du livre), une image et son alt (${4}, ${5} ; `altDefaut` est dans la langue de
// l'interface), un bloc qr-link (${6}). Sans lignes vides autour : l'appelant les ajoute.
function texteFalcHeader(langue, altDefaut) {
  const t = FALC_HEADER_TEXTES[langue] || FALC_HEADER_TEXTES.fr;
  return [
    ':::: falc-header',
    '${1:' + t.audio + '}',
    '',
    '1. ${2:' + t.scan + '}',
    '2. ${3:' + t.ecoute + '}',
    '',
    '![${4:' + String(altDefaut || '') + '}](${5:media/image.jpg})',
    '',
    '::: qr-link',
    '${6:https://}',
    ':::',
    '::::'
  ].join('\n');
}

// Corps du snippet de QR cliquable, avec les deux réglages les plus courants (tracked,
// size). Les autres options (background, color, title) sont dans
// docs/ARCHITECTURE-LIVRES.md et rappelées par palette.qrLink.detail.
const TEXTE_QR_LINK = '::: {.qr-link tracked=true size=25mm}\n${1:https://}\n:::';

// Groupe « Livre » de la palette. lib/panneaux.js et lib/formatting.js ne l'ajoutent que
// pour le profil livre.
const PALETTE_MEF_LIVRE = [
  ['--', 'palette.g.livre'],
  ['palette.falcHeader', 'szh.fmt.falcHeader', '', ''],
  ['palette.qrLink', 'szh.fmt.qrLink', '', '', 'palette.qrLink.detail']
];

// Palette du menu contextuel, bâtie sur les commandes szh.fmt.*. Format d'une entrée :
// ['--', cléGroupe] pour un séparateur, sinon [cléLibellé, commande, raccourci, icône,
// cléDétail?]. cléDétail, facultative, nomme un texte T() affiché en seconde ligne du
// QuickPickItem (itemsDepuisEntrees, lib/panneaux.js).
const PALETTE_MEF = [
  ['--', 'palette.g.style'],
  ['palette.gras', 'szh.fmt.gras', 'Ctrl+B', '$(bold)'],
  ['palette.italique', 'szh.fmt.italique', 'Ctrl+I', '$(italic)'],
  ['palette.souligne', 'szh.fmt.souligne', 'Ctrl+U', ''],
  ['--', 'palette.g.titres'],
  ['palette.titre1', 'szh.fmt.titre1', 'Ctrl+Alt+1', ''],
  ['palette.titre2', 'szh.fmt.titre2', 'Ctrl+Alt+2', ''],
  ['palette.titre3', 'szh.fmt.titre3', 'Ctrl+Alt+3', ''],
  ['--', 'palette.g.blocs'],
  ['palette.important', 'szh.fmt.important', 'Ctrl+Alt+W', ''],
  ['palette.highlight', 'szh.fmt.highlight', 'Ctrl+Alt+H', ''],
  ['palette.question', 'szh.fmt.question', 'Ctrl+Alt+Q', ''],
  ['palette.citation', 'szh.fmt.citation', 'Ctrl+Alt+C', ''],
  ['--', 'palette.g.inserer'],
  ['palette.figure', 'szh.fmt.figure', 'Ctrl+Alt+F', ''],
  ['palette.noteBasPage', 'szh.fmt.noteBasPage', 'Ctrl+Alt+N', ''],
  ['palette.lien', 'szh.fmt.lien', 'Ctrl+Alt+K', ''],
  ['palette.tableau', 'szh.fmt.tableau', 'Ctrl+Alt+T', ''],
  ['palette.collerTableau', 'szh.fmt.collerTableau', 'Ctrl+Alt+V', ''],
  ['palette.sautPage', 'szh.fmt.sautPage', 'Ctrl+Alt+Entrée', '']
];

// Clic droit « Mise en forme » : PALETTE_MEF plus « Lier une référence » après le lien.
// Cette entrée manque à PALETTE_MEF car le panneau Édition l'a dans son groupe Article.
const PALETTE_CLIC_DROIT = (() => {
  const p = PALETTE_MEF.slice();
  const i = p.findIndex((e) => e[1] === 'szh.fmt.lien');
  if (i === -1) { throw new Error('PALETTE_MEF sans szh.fmt.lien'); }
  p.splice(i + 1, 0, ['panneau.lierReference', 'szh.lierReference', 'Ctrl+Alt+L', '']);
  return p;
})();

module.exports = {
  estEnrobe, basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
  attrBloc, enroberBloc, CLASSES_BLOCS, blocAutour, poserBloc,
  squeletteTableau, tableauVierge, nomMediaUnique, nomTableLibre,
  blocReferenceTable, blocSautPage, noteBasPage, normaliserUrl, lienMarkdown, PALETTE_MEF,
  FALC_HEADER_TEXTES, langueLivre, texteFalcHeader, TEXTE_QR_LINK, PALETTE_MEF_LIVRE, PALETTE_CLIC_DROIT,
  insererBlocIsole, BLOC_SAUT_PAGE, blocTableSeul
};
