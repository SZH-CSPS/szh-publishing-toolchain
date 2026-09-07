// La part de lib/formatting.js qui ne référence pas `vscode` : transformations de texte,
// pose des blocs ::: (.important/.highlight/.question), squelettes de tableau, noms de
// fichiers sûrs, et la palette du menu contextuel qui les rassemble.
//
// Extrait de lib/formatting.js pour que lib/medias.js et lib/panneaux.js puissent la
// réutiliser sans tirer tout l'hôte avec elle — lib/formatting.js requiert `vscode`, et un
// module qui vit hors de l'éditeur (lib/medias.js, rejoué seul en test) ne peut pas le
// charger. lib/formatting.js réexporte tout ce qui suit pour ne casser aucun appelant.
'use strict';

const fs = require('fs');
const path = require('path');
const { finaliserModele, PRESETS_TABLE } = require('./table-model');
const { RE_DIV_OUVERTURE, RE_DIV_FERMETURE, fermetureDeDiv } = require('./references');

// ---- Mise en forme au clic droit et aux raccourcis ----

function estEnrobe(t, marqueur) {
  if (t.length < marqueur.length * 2) { return false; }
  if (!t.startsWith(marqueur) || !t.endsWith(marqueur)) { return false; }
  // Ne pas confondre italique (*) et gras (**) : sinon « **x** » se dégraisserait en
  // « *x* » au lieu de recevoir l'italique.
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

// Attribut d'un bloc de classe : {.classe} ou {.classe data-titre="…"}. L'antislash est
// échappé avant le guillemet (comme citerValeur() de references.js:176-180), jamais
// retiré : un titre qui cite un mot ne doit pas perdre ses guillemets en silence — pandoc
// lit lui-même cette forme d'attribut cité.
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
// enroberBloc fabrique le texte du bloc, mais ne suffit pas à le poser : un « fenced
// div » pandoc doit commencer en colonne 0 et être séparé de ses voisins par une ligne
// vide — même exigence que blocReferenceTable —, et réappliquer la commande dans un bloc
// existant doit mettre sa ligne d'ouverture à jour, pas imbriquer un second bloc que
// pandoc rendrait comme deux cadres l'un dans l'autre.

// Les classes que le panneau d'édition pose, seules que poserBloc a le droit de
// réécrire. Les autres divs — .szh-tabelle, .szh-saut — portent des données (src=…)
// qu'une réécriture perdrait : dedans, le nouveau bloc se pose après, jamais à la place.
const CLASSES_BLOCS = ['important', 'highlight', 'question'];

// Le fenced div qui contient les lignes [debut, fin] de la sélection, ou null. Remontée
// depuis la sélection : une fermeture rencontrée au-dessus (hors ligne du curseur, qui
// peut être la fermeture elle-même) signifie un bloc déjà clos, donc une sélection à
// l'extérieur. Un bloc jamais refermé ne compte pas : on ne sait pas où il finit.
function blocAutour(lignes, debut, fin) {
  let ouverture = -1;
  for (let i = debut; i >= 0; i--) {
    if (RE_DIV_OUVERTURE.test(lignes[i])) { ouverture = i; break; }
    if (i < debut && RE_DIV_FERMETURE.test(lignes[i])) { return null; }
  }
  if (ouverture === -1) { return null; }
  const fermeture = fermetureDeDiv(lignes, ouverture);
  // Sélection débordant sous la fermeture : pas « dans » le bloc, on n'y touche pas.
  if (fermeture === -1 || fin > fermeture) { return null; }
  return { ouverture: ouverture, fermeture: fermeture,
    attrs: RE_DIV_OUVERTURE.exec(lignes[ouverture])[1] };
}

// poserBloc(lignes, sel, classe, titre) -> { ligneDebut, ligneFin, texte, curseur }
//
// `lignes` : les lignes du document ; `sel` : { debutLigne, debutCol, finLigne, finCol }.
// Rend la plage de lignes entières à remplacer, son nouveau texte, et où poser le
// curseur (fin de la dernière ligne de contenu du bloc : c'est là qu'on tape, et c'est
// ce qui fait qu'une seconde frappe retombe dans le bloc et le met à jour au lieu d'en
// empiler un second). Pur — c'est appliquerBlocClasse (lib/formatting.js) qui traduit en
// édition vscode.
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
    // Dans un bloc du panneau : réécrire la ligne d'ouverture — nouvelle classe, nouveau
    // titre —, garder le contenu tel quel. C'est la sémantique « à jour », pas « en plus ».
    morceaux = ['::: ' + attrBloc(classe, titre)]
      .concat(tab.slice(existant.ouverture + 1, existant.fermeture), [':::']);
    fermetureIdx = morceaux.length - 1;
    ligneDebut = existant.ouverture;
    ligneFin = existant.fermeture;
  } else if (existant) {
    // Dans un div étranger : ni imbriquer, ni le réécrire. Le nouveau bloc, vide, se
    // pose après sa fermeture ; le texte du div n'en sort pas.
    morceaux = [tab[existant.fermeture], ''].concat(enroberBloc('', classe, titre).split('\n'));
    fermetureIdx = morceaux.length - 1;
    ligneDebut = existant.fermeture;
    ligneFin = existant.fermeture;
    bordHaut = false;                    // la fermeture du div étranger reste en tête
  } else {
    // Insertion : la sélection devient le contenu du bloc. Les restes d'une ligne coupée
    // sont gardés autour, séparés du bloc par une ligne vide ; un reste fait de blancs
    // seuls est abandonné, le bloc devant démarrer en colonne 0.
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

  // Lignes vides voisines, quand le bloc touche le bord de la plage : avalées dans la
  // plage puis réémises — exactement une contre un voisin non vide, aucune contre le
  // bord du document. C'est ce qui évite autant le bloc collé à un paragraphe que les
  // deux ou trois lignes vides qu'un aller-retour laisserait s'accumuler.
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

// Borne commune aux noms de fichiers « premier libre » : au-delà, mieux vaut un échec net
// qu'une boucle qui ne rendrait jamais la main (dossier pathologique, appelant qui boucle
// par erreur sur le même nom).
const BORNE_NOM_LIBRE = 1000;

// Premier nom libre dans `dossier`, en partant de `nom` — accents, espaces et casse du nom
// d'origine préservés, comme « Insérer une figure » le veut : ce qui est réduit ici, c'est
// seulement le suffixe qui évite d'écraser un fichier déjà là.
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

// Premier nom libre : table-NN.html, NN sur deux chiffres comme dans
// pipeline/docx-tables.py. Le premier libre et non le dernier plus un, pour ne pas
// réécrire un tableau importé après la suppression d'un intermédiaire.
function nomTableLibre(dossier) {
  for (let n = 1; n < 1000; n++) {
    const nom = 'table-' + (n < 10 ? '0' + n : String(n)) + '.html';
    let pris = false;
    try { pris = fs.existsSync(path.join(dossier, nom)); } catch (e) { pris = false; }
    if (!pris) { return nom; }
  }
  return 'table-999.html';
}

// Bloc de référence à insérer dans le .md, à la lettre de ce que pose
// szh-tabelle-reference.lua à l'import et de ce que résout szh-tabelle-inclure.lua. Un
// « fenced div » pandoc doit commencer en début de ligne et être séparé du paragraphe
// voisin, d'où les lignes vides ajoutées d'après `avant` et `apres`.
function blocReferenceTable(nom, avant, apres) {
  const bloc = '::: {.szh-tabelle src="tables/' + nom + '"}\n:::';
  return (String(avant || '').trim() === '' ? '' : '\n\n') + bloc
       + (String(apres || '').trim() === '' ? '' : '\n\n');
}

// Marqueur de saut de page : un « fenced div » vide, pandoc n'offrant pas de balise
// universelle et `\newpage` ne valant que pour LaTeX, alors que le PDF sort de
// WeasyPrint. C'est print.css qui lui donne son sens, par `break-after: page`, ce qui le
// rend inerte en HTML.
function blocSautPage(avant, apres) {
  const bloc = '::: {.szh-saut}\n:::';
  return (String(avant || '').trim() === '' ? '' : '\n\n') + bloc
       + (String(apres || '').trim() === '' ? '' : '\n\n');
}

// Palette du menu contextuel, bâtie sur les commandes szh.fmt.*. Format d'une entrée :
// ['--', cléGroupe] pour un séparateur, sinon [cléLibellé, commande, raccourci, icône].
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
  ['palette.tableau', 'szh.fmt.tableau', 'Ctrl+Alt+T', ''],
  ['palette.collerTableau', 'szh.fmt.collerTableau', 'Ctrl+Alt+V', ''],
  ['palette.sautPage', 'szh.fmt.sautPage', 'Ctrl+Alt+Entrée', '']
];

module.exports = {
  estEnrobe, basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
  attrBloc, enroberBloc, CLASSES_BLOCS, blocAutour, poserBloc,
  squeletteTableau, tableauVierge, nomMediaUnique, nomTableLibre,
  blocReferenceTable, blocSautPage, PALETTE_MEF
};
