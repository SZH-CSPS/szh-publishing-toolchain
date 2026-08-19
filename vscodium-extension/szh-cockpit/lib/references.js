// SZH cockpit — références d'un asset dans le texte d'un article : RETRAIT (C3) et,
// pour une image, LECTURE/ÉCRITURE de ses attributs de figure (légende, texte
// alternatif, copyright, source — voir la seconde moitié du fichier).
//
// Supprimer une image ou un tableau depuis la barre latérale ne doit pas laisser
// un lien mort dans le .md : le rendu afficherait une image cassée (ou un bloc
// d'avertissement pour un tableau, cf. szh-tabelle-inclure.lua). Ces deux
// fonctions retirent la RÉFÉRENCE du texte, à la lettre des formes que le
// pipeline écrit :
//   image   ![légende](media/<relatif>)      — pandoc, --extract-media (D45)
//   tableau ::: {.szh-tabelle src="tables/table-NN.html"}\n:::   (D47)
//
// PURES (aucun accès disque, aucun vscode) : testables en headless via _pur.
// Elles rendent { texte, n } — n = nombre de références retirées, 0 si aucune
// (l'appelant prévient alors que le texte n'a pas été touché).
'use strict';

// Une image posée seule sur sa ligne EST un paragraphe (implicit_figures) : la
// ligne vidée doit disparaître, sinon il reste un paragraphe vide et deux lignes
// blanches consécutives. On ne recolle que les blancs devenus adjacents — jamais
// de normalisation globale du fichier, qui toucherait du texte non concerné.
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
    // Blanc de part et d'autre : en retirer un (celui d'avant), l'autre sépare
    // les deux paragraphes voisins.
    if (avant !== null && avant.trim() === '' && apres !== null && apres.trim() === '') {
      resultat.pop();
    }
  }
  return resultat;
}

// Cible d'un lien markdown -> chemin comparable : chevrons retirés, %20 et
// consorts décodés, antislash normalisé. Pandoc encode les espaces à l'écriture,
// l'arbre affiche le nom réel : sans décodage, « mon image.png » ne matcherait pas.
function cibleNormalisee(cible) {
  let c = String(cible || '').trim();
  if (c.length > 1 && c.charAt(0) === '<' && c.charAt(c.length - 1) === '>') { c = c.slice(1, -1); }
  try { c = decodeURIComponent(c); } catch (e) { /* encodage invalide : tel quel */ }
  return c.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

// Retire toutes les occurrences de l'image `relatif` (chemin relatif à media/,
// séparateurs quelconques). Une image au fil du texte laisse la phrase intacte ;
// une image seule sur sa ligne emporte la ligne.
function retirerImage(texte, relatif) {
  const attendu = ('media/' + String(relatif || '').replace(/\\/g, '/')).toLowerCase();
  if (attendu === 'media/') { return { texte: texte, n: 0 }; }
  // ![alt](cible "titre"){attributs} — l'alt peut contenir des crochets échappés,
  // la cible ne contient ni espace ni parenthèse (forme écrite par pandoc).
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

// Retire le bloc de référence du tableau `nom` (« table-01.html ») : de la ligne
// d'ouverture `::: {.szh-tabelle src="tables/…"}` jusqu'à sa fermeture `:::`.
// Un bloc sans fermeture (fichier malmené à la main) n'emporte que sa ligne.
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
    // Chercher la fermeture AVANT d'effacer quoi que ce soit : un bloc laissé
    // ouvert à la main ne doit pas emporter la fin de l'article.
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

// ---- Attributs d'une FIGURE (légende, texte alternatif, crédits) -------------------
//
// CONTRAT DE FORMAT (arrêté avec le pipeline — ne pas l'inventer ailleurs) :
//   ![Légende visible](media/x.png){alt="description" copyright="© J. Dupont" source="ESA"}
//   - le texte entre CROCHETS est LA LÉGENDE (visible dans le rendu) ;
//   - alt= est le texte alternatif. Attribut ABSENT -> le pipeline retombe sur la
//     légende ; attribut PRÉSENT ET VIDE (alt="") -> image DÉCORATIVE, ignorée des
//     lecteurs d'écran. C'est la seule valeur vide qui s'écrit.
//   - copyright= / source= sont facultatifs et OMIS quand vides.
//   - aucun attribut à écrire -> aucun bloc {…} du tout.
//   - échappement : " -> \" dans les valeurs ; sauts de ligne interdits (remplacés
//     par des espaces) ; valeurs trimées.
//
// POURQUOI ces données vivent dans le .md et pas dans un fichier annexe : la légende
// EST déjà le texte du lien markdown, et une figure sans son texte est un lien mort.
// Un fichier parallèle se désynchroniserait au premier copier-coller de paragraphe.
//
// PURES (aucun accès disque, aucun vscode) : testables en headless via _pur.

// Motif d'une image markdown, à la lettre de ce que pandoc écrit (même forme que
// retirerImage, mêmes limites assumées : la cible ne contient ni espace ni
// parenthèse hors chevrons, le bloc d'attributs ne contient pas d'accolade).
// Groupes : 1 = légende, 2 = cible, 3 = titre éventuel, 4 = bloc {…} éventuel.
// Fabriqué à CHAQUE appel : un littéral /g partagé garderait son lastIndex.
function reImage() {
  return /!\[([^\]]*)\]\(\s*(<[^>]*>|[^()\s]+)((?:\s+"[^"]*")?)\s*\)(\{[^}]*\})?/g;
}

// Contenu d'un bloc d'attributs pandoc -> jetons, DANS L'ORDRE et avec leur texte
// BRUT. On préserve ainsi tout ce qui ne nous regarde pas (#id, .classe,
// width=50%, une clé inconnue) en le réécrivant tel quel : la fiche image ne doit
// jamais faire disparaître un attribut posé par le pipeline ou à la main.
// Scanner caractère par caractère plutôt qu'une regex : les valeurs entre
// guillemets peuvent contenir des espaces, un « = », et des \" échappés.
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

// Valeur -> attribut cité. L'antislash est échappé AVANT le guillemet : sans cela,
// une valeur finissant par « \ » avalerait le guillemet fermant et casserait le
// bloc entier. Le contrat n'exige que \" — \\ est un sur-ensemble sûr, et notre
// propre lecteur (scannerAttributs) le défait à l'identique.
function citerValeur(v) {
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// Valeur d'attribut assainie : une seule ligne, trimée, SANS accolade. Aucune
// confiance accordée à la webview — c'est ici, passage obligé de l'écriture, que la
// règle s'applique.
// POURQUOI les accolades partent : le bloc d'attributs est délimité par { }, et tous
// les lecteurs de la chaîne (le nôtre comme retirerImage) s'arrêtent à la première
// accolade fermante. Une accolade dans un copyright casserait donc silencieusement la
// référence entière. Elles sont assez rares dans un crédit pour que le retrait soit
// préférable à une figure perdue ; le cas est vérifié par le harnais.
function normaliserValeurFigure(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[\r\n\t]+/g, ' ').replace(/[{}]/g, '').trim();
}

// Légende assainie : une seule ligne, trimée, et SANS crochets — le texte d'un lien
// markdown est délimité par eux, et les échapper (\]) casserait le motif utilisé
// partout ailleurs (retirerImage). Un crochet dans une légende est assez rare pour
// que le retrait soit préférable à une référence illisible.
function normaliserLegendeFigure(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[\r\n\t]+/g, ' ').replace(/[[\]]/g, '').trim();
}

// Bloc {…} reconstruit : nos trois clés mises à jour SUR PLACE (ordre du fichier
// préservé), les autres jetons rendus tels quels, les nouvelles ajoutées à la fin.
// `cibles[cle] === null` = attribut à ne pas écrire (donc à retirer s'il existait).
// Aucun jeton à écrire -> chaîne vide, donc aucun bloc dans le texte.
function reconstruireBloc(blocOriginal, cibles) {
  const contenu = blocOriginal ? String(blocOriginal).slice(1, -1) : '';
  const sortie = [];
  const traites = {};
  for (const j of scannerAttributs(contenu)) {
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

// lireAttributsImage(texte, relatif) -> { legende, alt, altDefini, copyright, source, n }
// n = nombre d'insertions de cette image dans le texte (0 = fichier jamais inséré ;
// la fiche le dit et refuse d'enregistrer). Les VALEURS viennent de la PREMIÈRE
// insertion : c'est celle qu'on montre, et l'écriture les reporte sur toutes.
function lireAttributsImage(texte, relatif) {
  const attendu = ('media/' + String(relatif || '').replace(/\\/g, '/')).toLowerCase();
  const res = { legende: '', alt: '', altDefini: false, copyright: '', source: '', n: 0 };
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
      if (!j.paire) { continue; }
      const cle = j.cle.toLowerCase();
      if (cle === 'alt' && !res.altDefini) { res.alt = j.valeur; res.altDefini = true; }
      else if (cle === 'copyright' && res.copyright === '') { res.copyright = j.valeur; }
      else if (cle === 'source' && res.source === '') { res.source = j.valeur; }
    }
  }
  return res;
}

// ecrireAttributsImage(texte, relatif, valeurs) -> { texte, n }
// Réécrit TOUTES les insertions de l'image (une image n'a qu'un jeu de crédits ;
// laisser deux insertions diverger produirait deux légendes pour une seule figure).
// n = 0 -> texte rendu à l'identique (rien à écrire, l'appelant le signale).
// Idempotent : réécrire deux fois les mêmes valeurs rend le même texte.
function ecrireAttributsImage(texte, relatif, valeurs) {
  const attendu = ('media/' + String(relatif || '').replace(/\\/g, '/')).toLowerCase();
  if (attendu === 'media/') { return { texte: texte, n: 0 }; }
  const v = valeurs || {};
  const legende = normaliserLegendeFigure(v.legende);
  const alt = normaliserValeurFigure(v.alt);
  const copyright = normaliserValeurFigure(v.copyright);
  const source = normaliserValeurFigure(v.source);
  const cibles = {
    // alt="" est un CHOIX (image décorative) : c'est la seule valeur vide écrite.
    alt: v.altDefini ? alt : null,
    copyright: copyright === '' ? null : copyright,
    source: source === '' ? null : source
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
  retirerImage, retirerTable, cibleNormalisee,
  lireAttributsImage, ecrireAttributsImage,
  scannerAttributs, normaliserValeurFigure, normaliserLegendeFigure
};
