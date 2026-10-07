// Références d'une image ou d'un tableau dans le texte d'un article : retrait, attributs de
// figure, place d'une nouvelle figure, grilles d'images. Fonctions sur du texte, sans
// disque ni vscode ; les retraits rendent { texte, n }, n comptant les références ôtées.
//
// Supprimer un fichier retire aussi ses références, sinon le rendu afficherait une image
// cassée, ou l'avertissement de pipeline/filters/szh-tabelle-inclure.lua pour un tableau.
// Formes reconnues, celles qu'écrit le pipeline :
//   image   ![légende](media/<relatif>)
//   tableau ::: {.szh-tabelle src="tables/table-NN.html"}\n:::
'use strict';

// Une image seule sur sa ligne est un paragraphe (implicit_figures) : la ligne vidée
// disparaît, sinon il resterait un paragraphe vide. Seuls les blancs devenus adjacents sont
// fusionnés.
function retirerLignesVidees(lignes, videes) {
  const resultat = [];
  for (let i = 0; i < lignes.length; i++) {
    if (!videes.has(i)) { resultat.push(lignes[i]); continue; }
    const avant = resultat.length > 0 ? resultat[resultat.length - 1] : null;
    let apres = null;
    for (let j = i + 1; j < lignes.length; j++) {
      if (videes.has(j)) { continue; }
      apres = lignes[j];
      break;
    }
    if (avant !== null && avant.trim() === '' && apres !== null && apres.trim() === '') {
      resultat.pop();
    }
  }
  return resultat;
}

// Ouverture « ::: {…} » et fermeture « ::: » d'un bloc pandoc (« fenced div »), seules
// formes que le toolkit écrit. Partagées avec lib/formatting.js.
const RE_DIV_OUVERTURE = /^\s*:::+\s*\{([^}]*)\}\s*$/;
const RE_DIV_FERMETURE = /^\s*:::+\s*$/;

// Fermeture du bloc ouvert à la ligne `ouverture` : l'indice de sa ligne « ::: », ou -1.
// Un bloc laissé ouvert à la main ne doit pas emporter la suite de l'article : la recherche
// s'arrête au bloc suivant, même mal formé (d'où le seul préfixe « ::: { »).
function fermetureDeDiv(lignes, ouverture) {
  for (let j = ouverture + 1; j < lignes.length; j++) {
    if (/^\s*:::+\s*\{/.test(lignes[j])) { return -1; }      // bloc suivant : pas de fermeture
    if (RE_DIV_FERMETURE.test(lignes[j])) { return j; }
  }
  return -1;
}

function cibleNormalisee(cible) {
  let c = String(cible || '').trim();
  if (c.length > 1 && c.charAt(0) === '<' && c.charAt(c.length - 1) === '>') { c = c.slice(1, -1); }
  try { c = decodeURIComponent(c); } catch (e) { /* encodage invalide : tel quel */ }
  return c.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function retirerImage(texte, relatif) {
  const attendu = ('media/' + String(relatif || '').replace(/\\/g, '/')).toLowerCase();
  if (attendu === 'media/') { return { texte: texte, n: 0 }; }
  // ![alt](cible "titre"){attributs}, forme écrite par pandoc : la cible ne contient
  // ni espace ni parenthèse.
  const motif = /!\[[^\]]*\]\(\s*(<[^>]*>|[^()\s]+)(?:\s+"[^"]*")?\s*\)(?:\{[^}]*\})?/g;
  const lignes = String(texte).split('\n');
  const videes = new Set();
  let n = 0;
  for (let i = 0; i < lignes.length; i++) {
    const avant = lignes[i];
    if (avant.indexOf('![') === -1) { continue; }
    const apres = avant.replace(motif, (tout, cible) => {
      if (cibleNormalisee(cible) !== attendu) { return tout; }
      n++;
      return '';
    });
    if (apres === avant) { continue; }
    lignes[i] = apres;
    if (avant.trim() !== '' && apres.trim() === '') { videes.add(i); }
  }
  if (n === 0) { return { texte: texte, n: 0 }; }
  return { texte: retirerLignesVidees(lignes, videes).join('\n'), n: n };
}

function retirerTable(texte, nom) {
  const attendu = ('tables/' + String(nom || '').replace(/\\/g, '/')).toLowerCase();
  if (attendu === 'tables/') { return { texte: texte, n: 0 }; }
  const lignes = String(texte).split('\n');
  const videes = new Set();
  let n = 0;
  for (let i = 0; i < lignes.length; i++) {
    const ouverture = RE_DIV_OUVERTURE.exec(lignes[i]);
    if (!ouverture || ouverture[1].indexOf('szh-tabelle') === -1) { continue; }
    const src = /src\s*=\s*"([^"]*)"|src\s*=\s*'([^']*)'|src\s*=\s*([^\s}]+)/.exec(ouverture[1]);
    const cible = src ? (src[1] || src[2] || src[3]) : '';
    if (cibleNormalisee(cible) !== attendu) { continue; }
    const fin = fermetureDeDiv(lignes, i);
    videes.add(i);
    if (fin !== -1) {
      for (let j = i + 1; j <= fin; j++) { videes.add(j); }
      i = fin;
    }
    n++;
  }
  if (n === 0) { return { texte: texte, n: 0 }; }
  return { texte: retirerLignesVidees(lignes, videes).join('\n'), n: n };
}

// ---- Attributs d'une figure (légende, texte alternatif, crédits) ----
//
// Format partagé avec le pipeline (szh-numerotation.lua) :
//   ![Légende visible](media/x.png){alt="description" copyright="© J. Dupont" source="ESA"}
//   - le texte entre crochets est la légende, visible dans le rendu ;
//   - alt absent : le pipeline retombe sur la légende. alt="" : image décorative,
//     ignorée des lecteurs d'écran, et seule valeur vide qui s'écrive ;
//   - copyright, source et note sont omis quand vides, et sans attribut il n'y a pas de bloc ;
//   - note : imprimée sous la figure ; comme la légende, une grille ne porte que celle de sa
//     première image (offsetsSuiveuses) ;
//   - échappement : " -> \" dans les valeurs, pas de saut de ligne, valeurs trimées.

// Image hors numérotation : la classe .szh-hors-figure et une légende vide.
//   ![](media/x.png){.szh-hors-figure alt="description" copyright="© J. Dupont"}
// Sans texte entre crochets, pandoc n'en fait pas une Figure : szh-numerotation.lua ne lui
// donne ni numéro ni légende, et l'enveloppe dans une <figure> dont la <figcaption> ne
// porte que les crédits, s'il y en a. La légende est forcée vide à l'écriture.
const CLASSE_HORS_FIGURE = 'szh-hors-figure';

// Motif d'une image markdown, à la lettre de ce que pandoc écrit. Groupes : 1 = légende,
// 2 = cible, 3 = titre, 4 = bloc {…}. Recréé à chaque appel, car une expression /g
// partagée garderait son lastIndex.
function reImage() {
  return /!\[([^\]]*)\]\(\s*(<[^>]*>|[^()\s]+)((?:\s+"[^"]*")?)\s*\)(\{[^}]*\})?/g;
}

// Contenu d'un bloc d'attributs pandoc -> éléments, dans l'ordre et avec leur texte brut,
// pour réécrire tels quels les attributs inconnus. Lecture caractère par caractère, car
// les valeurs citées peuvent contenir espaces, « = » et \" échappés.
function scannerAttributs(source) {
  const s = String(source === undefined || source === null ? '' : source);
  const jetons = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s.charAt(i))) { i++; }
    if (i >= s.length) { break; }
    const debut = i;
    while (i < s.length && !/[\s=]/.test(s.charAt(i))) { i++; }
    const cle = s.slice(debut, i);
    let j = i;
    while (j < s.length && /\s/.test(s.charAt(j))) { j++; }
    if (s.charAt(j) !== '=') {
      jetons.push({ cle: cle, valeur: null, paire: false, brut: s.slice(debut, i) });
      continue;                                    // jeton nu (#id, .classe, mot seul)
    }
    j++;
    while (j < s.length && /\s/.test(s.charAt(j))) { j++; }
    let valeur = '';
    const q = s.charAt(j);
    if (q === '"' || q === '\'') {
      j++;
      while (j < s.length && s.charAt(j) !== q) {
        if (s.charAt(j) === '\\' && j + 1 < s.length) { valeur += s.charAt(j + 1); j += 2; continue; }
        valeur += s.charAt(j); j++;
      }
      if (j < s.length) { j++; }                   // guillemet fermant
    } else {
      const d2 = j;
      while (j < s.length && !/\s/.test(s.charAt(j))) { j++; }
      valeur = s.slice(d2, j);
    }
    jetons.push({ cle: cle, valeur: valeur, paire: true, brut: s.slice(debut, j) });
    i = j;
  }
  return jetons;
}

// Valeur -> attribut cité. L'antislash est échappé avant le guillemet, sinon une valeur
// finissant par « \ » avalerait le guillemet fermant.
function citerValeur(v) {
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// Nettoie une valeur avant écriture : une seule ligne, sans espaces de bord, sans accolade
// (une accolade casserait le bloc { }). Les crochets sont retirés de la légende, qu'ils
// délimitent.
function normaliserValeurFigure(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[\r\n\t]+/g, ' ').replace(/[{}]/g, '').trim();
}

function normaliserLegendeFigure(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[\r\n\t]+/g, ' ').replace(/[[\]]/g, '').trim();
}

// La classe .szh-hors-figure est réécrite en tête, pour qu'un second passage rende le même
// texte.
function reconstruireBloc(blocOriginal, cibles) {
  const contenu = blocOriginal ? String(blocOriginal).slice(1, -1) : '';
  const sortie = cibles.horsFigure ? ['.' + CLASSE_HORS_FIGURE] : [];
  const traites = {};
  for (const j of scannerAttributs(contenu)) {
    if (!j.paire && j.brut === '.' + CLASSE_HORS_FIGURE) { continue; }   // reposée ou retirée
    const cle = j.paire ? j.cle.toLowerCase() : '';
    if (cle === 'alt' || cle === 'copyright' || cle === 'source' || cle === 'note') {
      if (traites[cle]) { continue; }              // doublon dans le fichier : une seule fois
      traites[cle] = true;
      if (cibles[cle] !== null) { sortie.push(cle + '=' + citerValeur(cibles[cle])); }
      continue;
    }
    sortie.push(j.brut);
  }
  for (const cle of ['alt', 'copyright', 'source', 'note']) {
    if (traites[cle] || cibles[cle] === null) { continue; }
    sortie.push(cle + '=' + citerValeur(cibles[cle]));
  }
  return sortie.length === 0 ? '' : '{' + sortie.join(' ') + '}';
}

// Ordre d'apparition des images de media/ dans le texte : Map « relatif en minuscules ->
// rang », sans les images non insérées. Le gestionnaire des médias suit ainsi l'ordre de
// l'article.
function ordreImages(texte) {
  const ordre = new Map();
  const re = reImage();
  const s = String(texte === undefined || texte === null ? '' : texte);
  let m;
  let rang = 0;
  while ((m = re.exec(s)) !== null) {
    const cible = cibleNormalisee(m[2]);
    if (cible.indexOf('media/') !== 0) { continue; }
    const relatif = cible.slice('media/'.length);
    if (relatif !== '' && !ordre.has(relatif)) { ordre.set(relatif, rang++); }
  }
  return ordre;
}

// ---- Où poser une nouvelle figure ----
//
// Au milieu d'un paragraphe, l'image ne deviendrait pas une figure ; dans un bloc de code,
// une liste, une citation, un tableau ou un bloc « ::: {.szh-tabelle} », elle serait mal
// rendue ou perdue. Le curseur n'est donc accepté que dans un paragraphe ordinaire de
// premier niveau, et la figure se pose à la fin de ce paragraphe. Sinon, l'appelant la
// pose à la fin du document.

// Une ligne qui ouvre autre chose qu'un paragraphe : liste, citation, titre, tableau, bloc
// clôturé, bloc pandoc, ou retrait de quatre espaces (bloc de code indenté).
const RE_LIGNE_STRUCTUREE = /^(\s{4,}|\t|>|#{1,6}\s|[-*+]\s|\d+[.)]\s|\||:::|```|~~~)/;

// placeFigure(lignes, ligneCurseur) -> { ligne, colonne } | null
function placeFigure(lignes, ligneCurseur) {
  const tab = Array.isArray(lignes) ? lignes.map((x) => String(x === undefined || x === null ? '' : x)) : [];
  if (tab.length === 0) { return null; }
  const l = Math.max(0, Math.min(Number(ligneCurseur) || 0, tab.length - 1));
  // Contexte ouvert au-dessus du curseur : bloc clôturé ou bloc pandoc en cours.
  let cloture = null;
  let divs = 0;
  for (let i = 0; i <= l; i++) {
    const t = tab[i].trim();
    const marque = t.match(/^(```+|~~~+)/);
    if (marque) {
      if (cloture === null) { cloture = marque[1].charAt(0); }
      else if (t.charAt(0) === cloture) { cloture = null; }
      continue;
    }
    if (cloture !== null) { continue; }
    if (/^:::+\s*\{/.test(t)) { divs++; }
    else if (/^:::+\s*$/.test(t)) { divs = Math.max(0, divs - 1); }
  }
  if (cloture !== null || divs > 0) { return null; }
  // Curseur sur une ligne vide : c'est déjà une place, à condition de ne pas être au milieu
  // d'une liste ou d'un tableau aérés, où la ligne vide sépare deux morceaux d'un même bloc.
  if (tab[l].trim() === '') {
    let avant = l - 1;
    while (avant >= 0 && tab[avant].trim() === '') { avant--; }
    if (avant >= 0 && RE_LIGNE_STRUCTUREE.test(tab[avant])) { return null; }
    return { ligne: l, colonne: 0 };
  }
  // Le paragraphe du curseur, délimité par les lignes vides, doit être ordinaire de bout
  // en bout : une seule ligne structurée suffit à refuser la place.
  let debut = l;
  while (debut > 0 && tab[debut - 1].trim() !== '') { debut--; }
  let fin = l;
  while (fin + 1 < tab.length && tab[fin + 1].trim() !== '') { fin++; }
  for (let i = debut; i <= fin; i++) {
    if (tab[i].trim() === '') { continue; }
    if (RE_LIGNE_STRUCTUREE.test(tab[i])) { return null; }
  }
  return { ligne: fin, colonne: tab[fin].length };
}

// Texte à insérer pour que la référence soit seule dans son paragraphe : les lignes vides
// ne sont ajoutées que si elles manquent.
function envelopperFigure(lignes, ligne, colonne, reference) {
  const tab = Array.isArray(lignes) ? lignes.map((x) => String(x === undefined || x === null ? '' : x)) : [];
  const courante = tab[ligne] === undefined ? '' : tab[ligne];
  const avant = courante.slice(0, colonne).trim() === ''
    && (ligne === 0 || (tab[ligne - 1] || '').trim() === '');
  const apres = courante.slice(colonne).trim() === ''
    && (ligne + 1 >= tab.length || (tab[ligne + 1] || '').trim() === '');
  return (avant ? '' : '\n\n') + String(reference) + (apres ? '' : '\n\n');
}

// Toutes les insertions d'image du texte, dans l'ordre, une entrée par insertion (une
// image insérée deux fois compte deux fois). `relatif` est le chemin sous media/ en
// minuscules, ou null pour une cible ailleurs (lien externe, autre dossier).
function listerImages(texte) {
  const res = [];
  const re = reImage();
  const s = String(texte === undefined || texte === null ? '' : texte);
  let m;
  while ((m = re.exec(s)) !== null) {
    const cible = cibleNormalisee(m[2]);
    const dansMedia = cible.indexOf('media/') === 0;
    const entree = {
      cible: cible,
      relatif: dansMedia ? cible.slice('media/'.length) : null,
      legende: m[1], alt: '', altDefini: false, copyright: '', source: '', note: '',
      horsFigure: false
    };
    for (const j of scannerAttributs(m[4] ? m[4].slice(1, -1) : '')) {
      if (!j.paire) {
        if (j.brut === '.' + CLASSE_HORS_FIGURE) { entree.horsFigure = true; }
        continue;
      }
      const cle = j.cle.toLowerCase();
      if (cle === 'alt' && !entree.altDefini) { entree.alt = j.valeur; entree.altDefini = true; }
      else if (cle === 'copyright' && entree.copyright === '') { entree.copyright = j.valeur; }
      else if (cle === 'source' && entree.source === '') { entree.source = j.valeur; }
      else if (cle === 'note' && entree.note === '') { entree.note = j.valeur; }
    }
    res.push(entree);
  }
  return res;
}

// Insertions sans nom accessible : ni texte alternatif, ni légende, ni alt="" explicite.
// Le rendu les traite en images décoratives (szh-numerotation.lua), ce qui est peut-être un
// oubli : l'export les signale.
function imagesSansAlternative(texte) {
  return listerImages(texte).filter((i) => !i.altDefini && i.legende.trim() === '');
}

// lireAttributsImage(texte, relatif)
//   -> { legende, alt, altDefini, copyright, source, note, horsFigure, n }
// n compte les insertions de l'image ; à zéro, le gestionnaire refuse d'enregistrer. Les
// valeurs viennent de la première insertion, et l'écriture les reporte sur toutes.
function lireAttributsImage(texte, relatif) {
  const attendu = ('media/' + String(relatif || '').replace(/\\/g, '/')).toLowerCase();
  const res = { legende: '', alt: '', altDefini: false, copyright: '', source: '', note: '',
                horsFigure: false, n: 0 };
  if (attendu === 'media/') { return res; }
  const re = reImage();
  const s = String(texte === undefined || texte === null ? '' : texte);
  let m;
  while ((m = re.exec(s)) !== null) {
    if (cibleNormalisee(m[2]) !== attendu) { continue; }
    res.n++;
    if (res.n > 1) { continue; }
    res.legende = m[1];
    for (const j of scannerAttributs(m[4] ? m[4].slice(1, -1) : '')) {
      if (!j.paire) {
        if (j.brut === '.' + CLASSE_HORS_FIGURE) { res.horsFigure = true; }
        continue;
      }
      const cle = j.cle.toLowerCase();
      if (cle === 'alt' && !res.altDefini) { res.alt = j.valeur; res.altDefini = true; }
      else if (cle === 'copyright' && res.copyright === '') { res.copyright = j.valeur; }
      else if (cle === 'source' && res.source === '') { res.source = j.valeur; }
      else if (cle === 'note' && res.note === '') { res.note = j.valeur; }
    }
  }
  return res;
}

// ---- Grilles d'images ----
//
// Plusieurs images qui se lisent ensemble (une série, un avant/après) forment une figure :
// un numéro, une légende, un bloc insécable. Format partagé avec
// pipeline/filters/szh-grille.lua :
//
//   ::: {.szh-grille disposition="2-2"}
//   ![Légende de la figure](media/a.png){alt="…" copyright="© A"}
//   ![](media/b.png){alt="…"}
//   ![](media/c.png){alt="…"}
//   ![](media/d.png){alt="…"}
//   :::
//
//   - une image par ligne, sans ligne vide entre elles : aucun lecteur n'en fait alors de
//     figure individuelle, et la grille reste un seul objet ;
//   - la légende et le numéro sont ceux de la première image, qui est la figure entière ;
//     les suivantes s'écrivent toujours avec un texte de légende vide (voir
//     offsetsSuiveuses, appliqué par ecrireAttributsImage) ;
//   - le texte alternatif et les crédits restent propres à chaque image ;
//   - `disposition` vaut « auto » ou une suite de rangées, « 2-2 » = deux rangées de deux.
//     Absente ou incohérente avec le nombre d'images -> le rendu retombe sur « auto ».
const CLASSE_GRILLE = 'szh-grille';
const GRILLE_AUTO = 'auto';

// Six images au plus : au-delà, chacune serait trop petite pour la largeur de la colonne.
const GRILLE_MAX = 6;

// Les dispositions offertes, par nombre d'images ; la première de chaque liste sert de
// repli quand « auto » ne peut pas mesurer les fichiers.
// Table recopiée dans pipeline/filters/szh-grille.lua ; test/js/contrats.test.js vérifie
// qu'elles sont identiques.
const DISPOSITIONS = {
  2: ['2', '1-1'],
  3: ['3', '2-1', '1-2', '1-1-1'],
  4: ['2-2', '4', '3-1', '1-3'],
  5: ['3-2', '2-3', '5'],
  6: ['3-3', '2-2-2', '6']
};

// Hauteur visée du bloc d'images, en fraction de la largeur de la colonne : le mode
// automatique retient la disposition dont la hauteur s'en approche le plus. Recopiée dans
// szh-grille.lua.
const GRILLE_CIBLE = 0.62;

function dispositionsPossibles(n) {
  return (DISPOSITIONS[Number(n)] || []).slice();
}
function dispositionParDefaut(n) {
  const l = DISPOSITIONS[Number(n)];
  return l ? l[0] : null;
}
// « 2-2 » -> [2, 2] ; rien d'autre n'est accepté, pas même « 2 - 2 ».
function rangeesDeDisposition(code) {
  const s = String(code === undefined || code === null ? '' : code);
  if (!/^[1-9](-[1-9])*$/.test(s)) { return null; }
  return s.split('-').map((x) => Number(x));
}
function dispositionValide(code, n) {
  return dispositionsPossibles(n).indexOf(String(code)) !== -1;
}

// Mode automatique : la disposition dont le bloc rendu s'approche le plus de GRILLE_CIBLE.
// `ratios` donne largeur/hauteur de chaque image, dans l'ordre ; une valeur absente ou
// aberrante vaut 1 (carrée). Une rangée justifiée sur la largeur de la colonne a pour
// hauteur 1 / Σ(ratios de la rangée) — c'est la somme de ces hauteurs que l'on compare.
//
// Exemple : deux panoramas côte à côte feraient un bandeau de 0,17, l'un sur l'autre 0,67 :
// ils sont empilés. Deux portraits sont mis côte à côte.
function dispositionAutomatique(n, ratios) {
  const codes = dispositionsPossibles(n);
  if (codes.length === 0) { return null; }
  // Une image sans dimensions lisibles (SVG sans taille, fichier disparu) fausse la mesure :
  // on rend la disposition de repli.
  const r = [];
  for (let i = 0; i < n; i++) {
    const v = Number((ratios || [])[i]);
    if (!isFinite(v) || v <= 0) { return codes[0]; }
    r.push(v);
  }
  let meilleur = codes[0];
  let ecartMin = Infinity;
  for (const code of codes) {
    let hauteur = 0;
    let k = 0;
    for (const largeurRangee of rangeesDeDisposition(code)) {
      let somme = 0;
      for (let j = 0; j < largeurRangee; j++) { somme += r[k++]; }
      hauteur += 1 / somme;
    }
    const ecart = Math.abs(hauteur - GRILLE_CIBLE);
    if (ecart < ecartMin - 1e-9) { ecartMin = ecart; meilleur = code; }
  }
  return meilleur;
}

// Une ligne qui ne porte qu'une image : sa cible normalisée, ou null. C'est la seule forme
// admise dans une grille.
function ligneImageSeule(ligne) {
  const t = String(ligne === undefined || ligne === null ? '' : ligne).trim();
  if (t === '') { return null; }
  const re = reImage();
  const m = re.exec(t);
  if (!m || m.index !== 0 || re.lastIndex !== t.length) { return null; }
  return cibleNormalisee(m[2]);
}

// Le jeton `.szh-grille` dans les attributs d'un « ::: {…} ».
function estOuvertureGrille(attrs) {
  for (const j of scannerAttributs(attrs)) {
    if (!j.paire && j.brut === '.' + CLASSE_GRILLE) { return true; }
  }
  return false;
}

// lireGrilles(texte) -> [ { ouverture, fermeture, disposition, membres } ]
// où membres = [ { cible, relatif, ligne } ], `relatif` étant le chemin sous media/ en
// minuscules (comme ordreImages) ou null quand la cible est ailleurs. Une ligne qui ne
// porte pas exactement une image est ignorée : elle ne fait pas partie de la grille.
function lireGrilles(texte) {
  const lignes = String(texte === undefined || texte === null ? '' : texte).split('\n');
  const res = [];
  for (let i = 0; i < lignes.length; i++) {
    const ouverture = RE_DIV_OUVERTURE.exec(lignes[i]);
    if (!ouverture || !estOuvertureGrille(ouverture[1])) { continue; }
    const fin = fermetureDeDiv(lignes, i);
    if (fin === -1) { continue; }                  // bloc laissé ouvert : on n'y touche pas
    const membres = [];
    for (let j = i + 1; j < fin; j++) {
      const cible = ligneImageSeule(lignes[j]);
      if (cible === null) { continue; }
      membres.push({
        cible: cible,
        relatif: cible.indexOf('media/') === 0 ? cible.slice('media/'.length) : null,
        ligne: j
      });
    }
    let disposition = GRILLE_AUTO;
    for (const j of scannerAttributs(ouverture[1])) {
      if (j.paire && j.cle.toLowerCase() === 'disposition') { disposition = j.valeur; break; }
    }
    res.push({ ouverture: i, fermeture: fin, disposition: disposition, membres: membres });
    i = fin;
  }
  return res;
}

// La grille qui contient cette image, et le rang qu'elle y tient ; null si l'image n'est
// dans aucune grille.
function grilleDeImage(texte, relatif) {
  const attendu = String(relatif || '').replace(/\\/g, '/').toLowerCase();
  if (attendu === '') { return null; }
  for (const g of lireGrilles(texte)) {
    for (let k = 0; k < g.membres.length; k++) {
      if (g.membres[k].relatif === attendu) { return { grille: g, rang: k }; }
    }
  }
  return null;
}

// Positions, dans le texte, des insertions qui suivent la première d'une grille. Elles
// s'écrivent entre crochets vides : sinon implicit_figures en ferait des figures séparées.
function offsetsSuiveuses(texte) {
  const s = String(texte === undefined || texte === null ? '' : texte);
  const lignes = s.split('\n');
  const debuts = [];
  let pos = 0;
  for (const l of lignes) { debuts.push(pos); pos += l.length + 1; }
  const res = new Set();
  for (const g of lireGrilles(s)) {
    for (let k = 1; k < g.membres.length; k++) {
      const colonne = lignes[g.membres[k].ligne].indexOf('![');
      if (colonne !== -1) { res.add(debuts[g.membres[k].ligne] + colonne); }
    }
  }
  return res;
}

// La ligne « ::: {…} » d'une grille, avec sa disposition remplacée. Les autres attributs
// sont réécrits tels quels, à leur place.
function ligneOuvertureGrille(attrsOriginaux, disposition) {
  const sortie = ['.' + CLASSE_GRILLE];
  let pose = false;
  for (const j of scannerAttributs(attrsOriginaux || '')) {
    if (!j.paire && j.brut === '.' + CLASSE_GRILLE) { continue; }
    if (j.paire && j.cle.toLowerCase() === 'disposition') {
      if (pose) { continue; }
      pose = true;
      sortie.push('disposition=' + citerValeur(disposition));
      continue;
    }
    sortie.push(j.brut);
  }
  if (!pose) { sortie.push('disposition=' + citerValeur(disposition)); }
  return '::: {' + sortie.join(' ') + '}';
}

// La référence markdown complète d'une image (avec crédits et texte alternatif), pour
// déplacer une insertion.
function referenceImage(relatif, valeurs) {
  const v = valeurs || {};
  const horsFigure = !!v.horsFigure;
  const alt = normaliserValeurFigure(v.alt);
  const copyright = normaliserValeurFigure(v.copyright);
  const source = normaliserValeurFigure(v.source);
  const note = normaliserValeurFigure(v.note);
  const cibles = {
    alt: v.altDefini ? alt : null,
    copyright: copyright === '' ? null : copyright,
    source: source === '' ? null : source,
    note: note === '' ? null : note,
    horsFigure: horsFigure
  };
  const legende = horsFigure ? '' : normaliserLegendeFigure(v.legende);
  return '![' + legende + '](media/' + String(relatif).replace(/\\/g, '/') + ')'
    + reconstruireBloc(null, cibles);
}

// Disposition à écrire quand le nombre d'images change : « auto » le reste, un choix
// explicite devenu impossible retombe sur le défaut du nouveau compte.
function dispositionApresChangement(ancienne, n) {
  if (String(ancienne) === GRILLE_AUTO) { return GRILLE_AUTO; }
  return dispositionValide(ancienne, n) ? String(ancienne) : (dispositionParDefaut(n) || GRILLE_AUTO);
}

// Insère des lignes à l'indice donné, isolées par une ligne vide de chaque côté (une image
// collée à un paragraphe n'est pas une figure). Aucune ligne vide n'est ajoutée là où il y
// en a déjà une.
function insererIsole(lignes, ou, bloc) {
  const avant = (ou > 0 && lignes[ou - 1].trim() !== '') ? [''] : [];
  const apres = (ou < lignes.length && lignes[ou].trim() !== '') ? [''] : [];
  lignes.splice(ou, 0, ...avant, ...bloc, ...apres);
}

// poserDansGrille(texte, ancre, ajout) -> { texte, ok, motif, legendePerdue }
//
// Met `ajout` à côté de `ancre`. Si `ancre` est déjà dans une grille, l'image s'ajoute à
// la fin ; sinon la grille se crée autour de son insertion. Un `ajout` absent du texte est
// posé ; inséré une fois ailleurs, il est déplacé ; inséré plusieurs fois, refusé, faute de
// savoir laquelle déplacer.
// `motif` nomme le refus : 'ancre' (introuvable, ou pas seule sur sa ligne), 'ajout'
// (plusieurs insertions), 'pleine' (six images), 'meme' (l'image et elle-même).
function poserDansGrille(texte, ancre, ajout) {
  const src = String(texte === undefined || texte === null ? '' : texte);
  const cibleAncre = String(ancre || '').replace(/\\/g, '/').toLowerCase();
  const cibleAjout = String(ajout || '').replace(/\\/g, '/').toLowerCase();
  const refus = (motif) => ({ texte: src, ok: false, motif: motif, legendePerdue: false });
  if (cibleAncre === '' || cibleAjout === '') { return refus('ancre'); }
  if (cibleAncre === cibleAjout) { return refus('meme'); }

  const dansGrille = grilleDeImage(src, cibleAncre);
  if ((dansGrille ? dansGrille.grille.membres.length : 1) >= GRILLE_MAX) { return refus('pleine'); }

  // Valeurs de l'image qui rejoint la grille, lues avant de la retirer : son texte
  // alternatif et ses crédits la suivent ; sa légende et sa note sont perdues, la grille
  // n'ayant que celles de la figure.
  const valeursAjout = lireAttributsImage(src, cibleAjout);
  if (valeursAjout.n > 1) { return refus('ajout'); }
  const legendePerdue = valeursAjout.n === 1
    && (valeursAjout.legende.trim() !== '' || valeursAjout.note.trim() !== '');

  // Le retrait d'abord : il déplace des lignes, et la suite se calcule après.
  let travail = src;
  if (valeursAjout.n === 1) {
    const ote = retirerImage(travail, cibleAjout);
    if (ote.n > 0) { travail = ote.texte; }
  }

  const lignes = travail.split('\n');
  // Légende forcée vide : la figure n'a que celle de son ancre. `legendePerdue` permet à
  // l'appelant de signaler la perte.
  const nouvelle = '  ' + referenceImage(cibleAjout,
    Object.assign({}, valeursAjout, { legende: '', note: '' }));
  const apres = grilleDeImage(travail, cibleAncre);
  if (apres) {
    // Grille existante : l'image s'ajoute en queue, juste avant le « ::: » de fermeture.
    const g = apres.grille;
    lignes.splice(g.fermeture, 0, nouvelle);
    lignes[g.ouverture] = ligneOuvertureGrille(RE_DIV_OUVERTURE.exec(lignes[g.ouverture])[1],
      dispositionApresChangement(g.disposition, g.membres.length + 1));
    return { texte: lignes.join('\n'), ok: true, motif: null, legendePerdue: legendePerdue };
  }

  // Pas de grille : on en crée une autour de l'ancre, qui doit être seule sur sa ligne
  // (l'envelopper au milieu d'un paragraphe couperait la phrase).
  let ligneAncre = -1;
  for (let i = 0; i < lignes.length; i++) {
    if (ligneImageSeule(lignes[i]) === 'media/' + cibleAncre) { ligneAncre = i; break; }
  }
  if (ligneAncre === -1) { return refus('ancre'); }
  lignes.splice(ligneAncre, 1,
    ligneOuvertureGrille('', dispositionApresChangement(GRILLE_AUTO, 2)),
    '  ' + lignes[ligneAncre].trim(),
    nouvelle,
    ':::');
  return { texte: lignes.join('\n'), ok: true, motif: null, legendePerdue: legendePerdue };
}

// retirerDeGrille(texte, relatif) -> { texte, ok }
// `options.garderDansTexte` (vrai par défaut) dit ce que devient l'image ôtée :
//   vrai  — « sortir de la grille » : elle reste dans l'article, en figure ordinaire juste
//           après le bloc ;
//   faux  — « retirer de la figure » : elle quitte le texte, mais le fichier reste dans
//           media/ et sa carte au formulaire.
// Une grille réduite à une image se dissout et redevient une figure ordinaire.
function retirerDeGrille(texte, relatif, options) {
  const garder = !options || options.garderDansTexte !== false;
  const src = String(texte === undefined || texte === null ? '' : texte);
  const trouve = grilleDeImage(src, relatif);
  if (!trouve) { return { texte: src, ok: false }; }
  const g = trouve.grille;
  const lignes = src.split('\n');
  const sortante = lignes[g.membres[trouve.rang].ligne].trim();
  const restants = g.membres.filter((m, k) => k !== trouve.rang);

  if (restants.length <= 1) {
    // Dissolution : les deux « ::: » disparaissent, les images redeviennent des figures
    // ordinaires, chacune dans son paragraphe, dans l'ordre de la grille ; l'image sortante
    // en dernier quand on la garde.
    const bloc = [];
    for (const m of restants) { bloc.push(lignes[m.ligne].trim(), ''); }
    if (garder) { bloc.push(sortante); } else if (bloc.length > 0) { bloc.pop(); }
    lignes.splice(g.ouverture, g.fermeture - g.ouverture + 1);
    if (bloc.length > 0) { insererIsole(lignes, g.ouverture, bloc); }
    return { texte: lignes.join('\n'), ok: true };
  }
  const disposition = dispositionApresChangement(g.disposition, restants.length);
  // La ligne ôtée est entre les deux « ::: » : la fermeture remonte d'une ligne, et l'image
  // sortante se pose juste après.
  lignes.splice(g.membres[trouve.rang].ligne, 1);
  if (garder) { insererIsole(lignes, g.fermeture, [sortante]); }
  lignes[g.ouverture] = ligneOuvertureGrille(RE_DIV_OUVERTURE.exec(lignes[g.ouverture])[1],
    disposition);
  return { texte: lignes.join('\n'), ok: true };
}

// normaliserGrilles(texte) -> { texte, n }
// Corrige les grilles après le retrait d'une image hors de retirerDeGrille (suppression
// d'un fichier, modification à la main du .md). Une grille d'une image ou moins se dissout ;
// les autres reçoivent une disposition possible pour leur nombre d'images. `n` compte les
// grilles touchées. Idempotent.
//
// Une correction par tour, puis relecture : chaque écriture décale les indices.
function normaliserGrilles(texte) {
  let travail = String(texte === undefined || texte === null ? '' : texte);
  let n = 0;
  for (let garde = 0; garde < 500; garde++) {
    let change = false;
    for (const g of lireGrilles(travail)) {
      const lignes = travail.split('\n');
      if (g.membres.length <= 1) {
        const bloc = g.membres.map((m) => lignes[m.ligne].trim());
        lignes.splice(g.ouverture, g.fermeture - g.ouverture + 1);
        if (bloc.length > 0) { insererIsole(lignes, g.ouverture, bloc); }
        travail = lignes.join('\n');
        change = true;
        break;
      }
      const voulue = dispositionApresChangement(g.disposition, g.membres.length);
      if (voulue !== g.disposition) {
        lignes[g.ouverture] = ligneOuvertureGrille(
          RE_DIV_OUVERTURE.exec(lignes[g.ouverture])[1], voulue);
        travail = lignes.join('\n');
        change = true;
        break;
      }
    }
    if (!change) { break; }
    n++;
  }
  return { texte: travail, n: n };
}

// ecrireDispositionGrille(texte, relatif, disposition) -> { texte, ok }
// Une disposition qui ne correspond pas au nombre d'images de la grille est refusée (le
// rendu retomberait sur « auto »).
function ecrireDispositionGrille(texte, relatif, disposition) {
  const src = String(texte === undefined || texte === null ? '' : texte);
  const trouve = grilleDeImage(src, relatif);
  if (!trouve) { return { texte: src, ok: false }; }
  const code = String(disposition);
  const g = trouve.grille;
  if (code !== GRILLE_AUTO && !dispositionValide(code, g.membres.length)) {
    return { texte: src, ok: false };
  }
  const lignes = src.split('\n');
  lignes[g.ouverture] = ligneOuvertureGrille(RE_DIV_OUVERTURE.exec(lignes[g.ouverture])[1], code);
  return { texte: lignes.join('\n'), ok: true };
}

// Réécrit toutes les insertions de l'image avec les mêmes valeurs. Idempotent.
function ecrireAttributsImage(texte, relatif, valeurs) {
  const attendu = ('media/' + String(relatif || '').replace(/\\/g, '/')).toLowerCase();
  if (attendu === 'media/') { return { texte: texte, n: 0 }; }
  const v = valeurs || {};
  const horsFigure = !!v.horsFigure;
  // Hors figure : crochets vides, pour qu'implicit_figures n'en fasse pas une figure.
  const legende = horsFigure ? '' : normaliserLegendeFigure(v.legende);
  const alt = normaliserValeurFigure(v.alt);
  const copyright = normaliserValeurFigure(v.copyright);
  const source = normaliserValeurFigure(v.source);
  const note = normaliserValeurFigure(v.note);
  const cibles = {
    alt: v.altDefini ? alt : null,
    copyright: copyright === '' ? null : copyright,
    source: source === '' ? null : source,
    note: note === '' ? null : note,
    horsFigure: horsFigure
  };
  const ciblesSuiveuse = Object.assign({}, cibles, { note: null });
  const entree = String(texte === undefined || texte === null ? '' : texte);
  // Dans une grille, seule la première image porte la légende et la note de la figure : les
  // suivantes s'écrivent entre crochets vides et sans note, quoi que la carte affiche.
  const suiveuses = offsetsSuiveuses(entree);
  let n = 0;
  const sortie = entree.replace(reImage(), function (tout, leg, cible, titre, bloc) {
    if (cibleNormalisee(cible) !== attendu) { return tout; }
    n++;
    const decalage = arguments[arguments.length - 2];
    const suiveuse = suiveuses.has(decalage);
    return '![' + (suiveuse ? '' : legende) + '](' + cible + (titre || '') + ')'
      + reconstruireBloc(bloc, suiveuse ? ciblesSuiveuse : cibles);
  });
  if (n === 0) { return { texte: texte, n: 0 }; }
  return { texte: sortie, n: n };
}

module.exports = {
  RE_DIV_OUVERTURE, RE_DIV_FERMETURE, fermetureDeDiv,
  retirerImage, retirerTable, cibleNormalisee, CLASSE_HORS_FIGURE, ordreImages,
  listerImages, imagesSansAlternative, placeFigure, envelopperFigure,
  lireAttributsImage, ecrireAttributsImage, referenceImage,
  scannerAttributs, normaliserValeurFigure, normaliserLegendeFigure,
  CLASSE_GRILLE, GRILLE_AUTO, GRILLE_MAX, DISPOSITIONS, GRILLE_CIBLE,
  dispositionsPossibles, dispositionParDefaut, dispositionValide, rangeesDeDisposition,
  dispositionAutomatique, lireGrilles, grilleDeImage, offsetsSuiveuses,
  poserDansGrille, retirerDeGrille, ecrireDispositionGrille, normaliserGrilles
};
