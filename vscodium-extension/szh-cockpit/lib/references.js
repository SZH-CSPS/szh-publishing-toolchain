// Références d'un asset dans le texte d'un article : retrait d'une image ou d'un tableau,
// et attributs de figure d'une image (seconde moitié du fichier). Tout est pur, sans
// disque ni vscode ; les retraits rendent { texte, n }, n comptant les références ôtées.
//
// Supprimer un asset ne doit pas laisser un lien mort dans le .md : le rendu afficherait
// une image cassée, ou le bloc d'avertissement de
// pipeline/filters/szh-tabelle-inclure.lua pour un tableau. Le retrait suit donc à la
// lettre les formes que le pipeline écrit :
//   image   ![légende](media/<relatif>)
//   tableau ::: {.szh-tabelle src="tables/table-NN.html"}\n:::
'use strict';

// Une image seule sur sa ligne est un paragraphe (implicit_figures) : la ligne vidée doit
// disparaître, sinon il reste un paragraphe vide. On ne recolle que les blancs devenus
// adjacents, jamais tout le fichier.
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
    const ouverture = /^\s*:::+\s*\{([^}]*)\}\s*$/.exec(lignes[i]);
    if (!ouverture || ouverture[1].indexOf('szh-tabelle') === -1) { continue; }
    const src = /src\s*=\s*"([^"]*)"|src\s*=\s*'([^']*)'|src\s*=\s*([^\s}]+)/.exec(ouverture[1]);
    const cible = src ? (src[1] || src[2] || src[3]) : '';
    if (cibleNormalisee(cible) !== attendu) { continue; }
    // Chercher la fermeture avant d'effacer quoi que ce soit : un bloc laissé ouvert
    // à la main ne doit pas emporter la fin de l'article.
    let fin = -1;
    for (let j = i + 1; j < lignes.length; j++) {
      if (/^\s*:::+\s*\{/.test(lignes[j])) { break; }            // bloc suivant : pas de fermeture
      if (/^\s*:::+\s*$/.test(lignes[j])) { fin = j; break; }
    }
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
// Format arrêté avec le pipeline, à ne pas réinventer ailleurs :
//   ![Légende visible](media/x.png){alt="description" copyright="© J. Dupont" source="ESA"}
//   - le texte entre crochets est la légende, visible dans le rendu ;
//   - alt absent : le pipeline retombe sur la légende. alt="" : image décorative,
//     ignorée des lecteurs d'écran, et seule valeur vide qui s'écrive ;
//   - copyright et source sont omis quand vides, et sans attribut il n'y a pas de bloc ;
//   - échappement : " -> \" dans les valeurs, pas de saut de ligne, valeurs trimées.

// Image hors numérotation : la classe .szh-hors-figure et une légende vide.
//   ![](media/x.png){.szh-hors-figure alt="description" copyright="© J. Dupont"}
// Aucun lecteur n'en fait de Figure — implicit_figures demande un texte entre crochets —
// et szh-numerotation.lua ne lui donne donc ni numéro ni légende ; il l'enveloppe dans une
// <figure> à <figcaption> de crédits seuls quand il y a des crédits à porter. La légende
// est forcée vide à l'écriture : la case cochée et un texte de légende se contrediraient.
const CLASSE_HORS_FIGURE = 'szh-hors-figure';

// Motif d'une image markdown, à la lettre de ce que pandoc écrit. Groupes : 1 = légende,
// 2 = cible, 3 = titre, 4 = bloc {…}. Fabriqué à chaque appel, un littéral /g partagé
// garderait son lastIndex.
function reImage() {
  return /!\[([^\]]*)\]\(\s*(<[^>]*>|[^()\s]+)((?:\s+"[^"]*")?)\s*\)(\{[^}]*\})?/g;
}

// Contenu d'un bloc d'attributs pandoc -> jetons, dans l'ordre et avec leur texte brut,
// pour réécrire tel quel ce qui ne nous regarde pas : la fiche image ne doit pas faire
// disparaître un attribut posé par le pipeline ou à la main. Scan caractère par caractère
// plutôt que regex, les valeurs citées pouvant contenir espaces, « = » et \" échappés.
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

// Valeur assainie ici, passage obligé de l'écriture : une seule ligne, trimée, sans
// accolade — le bloc étant délimité par { }, une accolade dans un copyright casserait
// silencieusement la référence entière. Les crochets, eux, partent de la légende, qu'ils
// délimitent dans un lien markdown.
function normaliserValeurFigure(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[\r\n\t]+/g, ' ').replace(/[{}]/g, '').trim();
}

function normaliserLegendeFigure(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[\r\n\t]+/g, ' ').replace(/[[\]]/g, '').trim();
}

// La classe .szh-hors-figure est réécrite en tête plutôt qu'à sa place d'origine : une
// seule position possible, donc un second passage rend le même texte.
function reconstruireBloc(blocOriginal, cibles) {
  const contenu = blocOriginal ? String(blocOriginal).slice(1, -1) : '';
  const sortie = cibles.horsFigure ? ['.' + CLASSE_HORS_FIGURE] : [];
  const traites = {};
  for (const j of scannerAttributs(contenu)) {
    if (!j.paire && j.brut === '.' + CLASSE_HORS_FIGURE) { continue; }   // reposée ou retirée
    const cle = j.paire ? j.cle.toLowerCase() : '';
    if (cle === 'alt' || cle === 'copyright' || cle === 'source') {
      if (traites[cle]) { continue; }              // doublon dans le fichier : une seule fois
      traites[cle] = true;
      if (cibles[cle] !== null) { sortie.push(cle + '=' + citerValeur(cibles[cle])); }
      continue;
    }
    sortie.push(j.brut);
  }
  for (const cle of ['alt', 'copyright', 'source']) {
    if (traites[cle] || cibles[cle] === null) { continue; }
    sortie.push(cle + '=' + citerValeur(cibles[cle]));
  }
  return sortie.length === 0 ? '' : '{' + sortie.join(' ') + '}';
}

// Ordre d'apparition des images de media/ dans le texte : rend une Map
// « relatif normalisé (minuscules) -> rang », les images jamais insérées n'y figurant pas.
// C'est ce qui permet au gestionnaire des médias de suivre la lecture de l'article plutôt
// que l'alphabet.
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
// Le curseur ne suffit pas. Au milieu d'un paragraphe, l'image reste au fil du texte et ne
// devient pas une figure ; dans un bloc de code elle s'affiche en clair ; dans une liste
// elle est avalée par l'item ; dans une citation elle emporte la ligne suivante ; dans un
// tableau elle le tronque ; et dans un bloc « ::: {.szh-tabelle} »,
// szh-tabelle-inclure.lua remplace tout le bloc et l'image disparaît du rendu sans un mot.
// On n'accepte donc le curseur que dans un paragraphe ordinaire de premier niveau, et on
// pose la figure à la fin de ce paragraphe. Ailleurs, l'appelant retombe sur la fin du
// document, où l'image est visible et déplaçable à la main.

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

// Toutes les insertions d'image du texte, dans l'ordre, une entrée par insertion — une
// même image insérée deux fois compte deux fois. `relatif` est le chemin sous media/,
// normalisé en minuscules, ou null quand la cible est ailleurs (lien externe, autre
// dossier). Sert aux contrôles qui portent sur les insertions et non sur les fichiers.
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
      legende: m[1], alt: '', altDefini: false, copyright: '', source: '', horsFigure: false
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
    }
    res.push(entree);
  }
  return res;
}

// Insertions sans nom accessible : pas de texte alternatif, pas de légende sur laquelle
// retomber, et pas de déclaration « décorative » (alt="" explicite). Le rendu les traite
// alors en images décoratives — szh-numerotation.lua leur pose alt="" et
// role="presentation" — ce qui est peut-être un oubli plutôt qu'un choix. C'est cette
// ambiguïté que l'export signale, au dernier moment où elle est réparable.
function imagesSansAlternative(texte) {
  return listerImages(texte).filter((i) => !i.altDefini && i.legende.trim() === '');
}

// lireAttributsImage(texte, relatif)
//   -> { legende, alt, altDefini, copyright, source, horsFigure, n }
// n compte les insertions de l'image ; à zéro, le gestionnaire refuse d'enregistrer. Les
// valeurs viennent de la première insertion, et l'écriture les reporte sur toutes.
function lireAttributsImage(texte, relatif) {
  const attendu = ('media/' + String(relatif || '').replace(/\\/g, '/')).toLowerCase();
  const res = { legende: '', alt: '', altDefini: false, copyright: '', source: '', horsFigure: false, n: 0 };
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
    }
  }
  return res;
}

// Réécrit toutes les insertions de l'image, qui n'a qu'un jeu de crédits : les laisser
// diverger donnerait deux légendes pour une seule figure. Idempotent.
function ecrireAttributsImage(texte, relatif, valeurs) {
  const attendu = ('media/' + String(relatif || '').replace(/\\/g, '/')).toLowerCase();
  if (attendu === 'media/') { return { texte: texte, n: 0 }; }
  const v = valeurs || {};
  const horsFigure = !!v.horsFigure;
  // Hors figure, la légende ne va nulle part : le texte entre crochets vide est ce qui
  // empêche implicit_figures d'en fabriquer une, et la laisser remplie donnerait un
  // fichier qui affirme deux choses contraires.
  const legende = horsFigure ? '' : normaliserLegendeFigure(v.legende);
  const alt = normaliserValeurFigure(v.alt);
  const copyright = normaliserValeurFigure(v.copyright);
  const source = normaliserValeurFigure(v.source);
  const cibles = {
    alt: v.altDefini ? alt : null,
    copyright: copyright === '' ? null : copyright,
    source: source === '' ? null : source,
    horsFigure: horsFigure
  };
  let n = 0;
  const sortie = String(texte === undefined || texte === null ? '' : texte)
    .replace(reImage(), (tout, leg, cible, titre, bloc) => {
      if (cibleNormalisee(cible) !== attendu) { return tout; }
      n++;
      return '![' + legende + '](' + cible + (titre || '') + ')' + reconstruireBloc(bloc, cibles);
    });
  if (n === 0) { return { texte: texte, n: 0 }; }
  return { texte: sortie, n: n };
}

module.exports = {
  retirerImage, retirerTable, cibleNormalisee, CLASSE_HORS_FIGURE, ordreImages,
  listerImages, imagesSansAlternative, placeFigure, envelopperFigure,
  lireAttributsImage, ecrireAttributsImage,
  scannerAttributs, normaliserValeurFigure, normaliserLegendeFigure
};
