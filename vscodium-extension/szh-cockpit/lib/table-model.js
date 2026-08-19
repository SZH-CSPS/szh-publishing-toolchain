// SZH cockpit — modèle de tableau (D57, T1/T2). Extrait de extension.js (R3, refactor
// sans build, comportement identique). Parseur/sérialiseur PURS + modèle (matrice
// d'occupation, grille dépliée) + opérations de structure. Aucune dépendance externe
// (ni vscode, ni fs, ni i18n) : tout est fonction pure, testée headless via _pur.
'use strict';

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
          scope: th ? (sc === 'row' ? 'row' : (sc === 'col' ? 'col' : '')) : '',
          align: enumOu((courant.attrs['data-align'] || '').toLowerCase(), ['left', 'center', 'right'], 'left')
        });
        courant = null;
        profondeur = 0;
      }
    }
  }
  return cellules;
}

function enumOu(v, liste, defaut) { return liste.indexOf(v) !== -1 ? v : defaut; }

// Booléen tolérant : accepte true / 1 / '1' / 'oui' / 'true' (les attributs data-*
// booléens sont sérialisés en « 1 », le modèle webview envoie des vrais booléens).
function vrai(v) { return v === true || v === 1 || v === '1' || v === 'oui' || v === 'true'; }

// Énumérations de style de tableau (D64/D67), partagées analyser/serialiser/normaliser.
const FONDS = ['aucun', 'negatif', 'couleur', 'gris'];   // data-*-fond
const ZEBRES = ['aucun', 'paires', 'impaires'];          // data-zebre-*

// ─── Préréglages de mise en forme (huit PROPOSITIONS, à réduire à quatre) ────────────
//
// Chaque préréglage pose d'un coup tout l'habillage du tableau : styles des en-têtes de
// colonnes (ec) et de lignes (el), ligne de total, bordures, zébrage. Il ne touche PAS
// aux comptes d'en-tête, qui décrivent la structure et non l'apparence.
//
// Les huit sont là pour être COMPARÉS à l'écran, puis élagués : pour n'en garder que
// quatre, supprimer les entrées inutiles ici ET leurs libellés dans lib/i18n.js
// (`table.preset.<clé>`), rien d'autre — la liste des radios se construit depuis ce
// tableau, dans cet ordre.
//
// Les fonds disponibles sont ceux de D67, avec leurs contrastes garantis : « negatif »
// (accent foncé, texte blanc), « couleur » (accent clair, texte noir), « gris »
// (gris neutre, texte noir). Aucun préréglage n'invente de couleur.
const PRESETS_TABLE = {
  // 1. La table de revue scientifique classique : aucun aplat, deux filets, en-tête gras.
  academique: {
    ecGras: true, ecFond: 'aucun', elGras: true, elFond: 'aucun',
    totalGras: false, totalFond: 'aucun', bordureHaute: true, bordureBasse: true,
    zebreCol: 'aucun', zebreColEntetes: false, zebreLig: 'aucun', zebreLigEntetes: false
  },
  // 2. En-tête en aplat foncé : le plus contrasté, pour un tableau qu'on lit de loin.
  entetenegatif: {
    ecGras: true, ecFond: 'negatif', elGras: true, elFond: 'aucun',
    totalGras: false, totalFond: 'aucun', bordureHaute: false, bordureBasse: true,
    zebreCol: 'aucun', zebreColEntetes: false, zebreLig: 'aucun', zebreLigEntetes: false
  },
  // 3. En-tête dans la couleur du numéro : la variante « maison ».
  entetecouleur: {
    ecGras: true, ecFond: 'couleur', elGras: true, elFond: 'aucun',
    totalGras: false, totalFond: 'aucun', bordureHaute: false, bordureBasse: true,
    zebreCol: 'aucun', zebreColEntetes: false, zebreLig: 'aucun', zebreLigEntetes: false
  },
  // 4. En-tête gris : neutre, indépendant de la couleur annuelle.
  entetegris: {
    ecGras: true, ecFond: 'gris', elGras: true, elFond: 'aucun',
    totalGras: false, totalFond: 'aucun', bordureHaute: true, bordureBasse: true,
    zebreCol: 'aucun', zebreColEntetes: false, zebreLig: 'aucun', zebreLigEntetes: false
  },
  // 5. Lignes alternées : pour un tableau long, où l'œil doit suivre une rangée.
  lignesalternees: {
    ecGras: true, ecFond: 'aucun', elGras: true, elFond: 'aucun',
    totalGras: false, totalFond: 'aucun', bordureHaute: true, bordureBasse: true,
    zebreCol: 'aucun', zebreColEntetes: false, zebreLig: 'paires', zebreLigEntetes: false
  },
  // 6. Colonnes alternées : pour un tableau large, où l'œil doit suivre une colonne.
  colonnesalternees: {
    ecGras: true, ecFond: 'aucun', elGras: true, elFond: 'aucun',
    totalGras: false, totalFond: 'aucun', bordureHaute: true, bordureBasse: true,
    zebreCol: 'paires', zebreColEntetes: false, zebreLig: 'aucun', zebreLigEntetes: false
  },
  // 7. Tableau de synthèse : en-tête foncé et dernière rangée détachée (D65).
  synthese: {
    ecGras: true, ecFond: 'negatif', elGras: true, elFond: 'aucun',
    totalGras: true, totalFond: 'gris', bordureHaute: false, bordureBasse: true,
    zebreCol: 'aucun', zebreColEntetes: false, zebreLig: 'aucun', zebreLigEntetes: false
  },
  // 8. Matrice à double entrée : les deux en-têtes habillés, lignes alternées légères.
  matrice: {
    ecGras: true, ecFond: 'couleur', elGras: true, elFond: 'gris',
    totalGras: false, totalFond: 'aucun', bordureHaute: true, bordureBasse: true,
    zebreCol: 'aucun', zebreColEntetes: false, zebreLig: 'paires', zebreLigEntetes: false
  }
};
const PRESETS_ORDRE = ['academique', 'entetenegatif', 'entetecouleur', 'entetegris',
  'lignesalternees', 'colonnesalternees', 'synthese', 'matrice'];

// Échappe le texte BRUT (collage TSV) en inline sûr : &, <, > seulement. Le résultat
// passe ensuite par canoniserInline (aucune balise -> texte conservé, jamais d'injection).
function echapTexteBrut(s) {
  return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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
      cellules.push({ contenu: cell.contenu, th: !!cell.th, scope: cell.scope || '', align: cell.align || 'left' });
      for (let dr = 0; dr < pos.rowspan && r + dr < nbL; dr++) {
        for (let dc = 0; dc < pos.colspan && pos.c0 + dc < nbC; dc++) { grid[r + dr][pos.c0 + dc] = id; }
      }
    });
  }
  for (let r = 0; r < nbL; r++) {
    for (let c = 0; c < nbC; c++) {
      if (grid[r][c] == null) { grid[r][c] = cellules.length; cellules.push({ contenu: '', th: false, scope: '', align: 'left' }); }
    }
  }
  return {
    cellules: cellules, grid: grid,
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
      cellules.push({ contenu: cell.contenu, colspan: cs, rowspan: rs, th: !!cell.th, scope: cell.scope || '', align: cell.align || 'left' });
    }
    lignes.push({ cellules: cellules });
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

// Normalise (bornes + énumérations) un modèle, sans toucher à la structure. Les styles
// vivent au NIVEAU tableau (D64) : en-têtes de lignes (el = th[scope=row], colonnes de
// gauche), en-têtes de colonnes (ec = th[scope=col], rangées du haut), total (dernière
// rangée auto, D65), bordures, zébrage colonnes/lignes. Aucun style par cellule hormis
// l'alignement et la mise en forme inline du contenu.
// Légende de tableau (D94) — le <caption> du fichier. Même convention que le contenu
// d'une cellule : inline canonique (texte déjà échappé + <strong>/<em>/<br>), donc
// canoniserInline suffit à l'assainir et le round-trip est stable. Chaîne vide = pas
// de légende : serialiserTable n'émet alors AUCUN <caption> (un tableau sans légende
// ne doit pas en gagner un vide).
//
// Comme le contenu d'une cellule, la légende est SAISIE dans la webview et arrive
// avec le modèle : c'est ici — passage obligé de tous les chemins (analyse, opération,
// annulation, enregistrement) — qu'elle est assainie. Une balise inconnue y perd sa
// balise (le texte reste) : aucune injection possible, même si la webview envoyait
// n'importe quoi. Les retours à la ligne d'une légende collée deviennent des espaces
// (un <caption> est un titre d'une ligne ; les sauts voulus passent par <br>).
function normaliserLegende(v) {
  return canoniserInline(String(v === undefined || v === null ? '' : v).replace(/[\r\n]+/g, ' '));
}

// Texte alternatif / copyright / source d'un tableau : trois attributs data-* sur
// <table>, mêmes rôles que sur une figure. Contrairement à la légende, ce sont des
// chaînes de TEXTE PUR dans le modèle (aucun balisage inline n'y a de sens) :
//   - à l'ANALYSE, les entités de l'attribut HTML sont décodées -> texte pur ;
//   - à la SÉRIALISATION, le texte est ré-encodé pour un contexte d'attribut.
// L'aller-retour est donc stable, et aucune valeur venue de la webview ne peut
// s'échapper de son attribut (échappement au passage obligé qu'est serialiserTable).
// Vide = attribut ABSENT : un tableau qui n'en a pas ne doit jamais en gagner un vide
// (sortie minimale, réécriture à l'octet près des tableaux existants).
// ⚠ Le pipeline n'écrit JAMAIS dans ces fichiers : le numéro et les crédits sont
// ajoutés AU RENDU, en mémoire — aucun préfixe « Tableau N — » ici.
const LONGUEUR_MAX_META = 1000;

function normaliserTexteAttribut(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[\r\n\t]+/g, ' ').trim().slice(0, LONGUEUR_MAX_META);
}

// Entités d'un attribut HTML -> texte. &amp; en DERNIER : sinon « &amp;quot; »
// (un « &quot; » littéral écrit par quelqu'un) serait décodé deux fois.
function decoderEntites(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&#0*39;/g, '\'')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Texte -> valeur d'attribut HTML (contexte « attribut entre guillemets doubles »).
function echapAttribut(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normaliserModele(modele) {
  const a = (modele && modele.attrs) || {};
  const lignesEntree = (modele && modele.lignes) || [];
  const nbLignes = lignesEntree.length;
  const attrs = {
    classe: 'szh-tableau',
    legende: normaliserLegende(a.legende),
    alt: normaliserTexteAttribut(a.alt),
    copyright: normaliserTexteAttribut(a.copyright),
    source: normaliserTexteAttribut(a.source),
    enteteLignes: Math.max(0, Math.min(2, Math.min(parseInt(a.enteteLignes, 10) || 0, nbLignes))),
    enteteColonnes: Math.max(0, Math.min(2, parseInt(a.enteteColonnes, 10) || 0)),
    elGras: vrai(a.elGras), elFond: enumOu(a.elFond, FONDS, 'aucun'),
    ecGras: vrai(a.ecGras), ecFond: enumOu(a.ecFond, FONDS, 'aucun'),
    totalGras: vrai(a.totalGras), totalFond: enumOu(a.totalFond, FONDS, 'aucun'),
    bordureHaute: vrai(a.bordureHaute), bordureBasse: vrai(a.bordureBasse),
    zebreCol: enumOu(a.zebreCol, ZEBRES, 'aucun'), zebreColEntetes: vrai(a.zebreColEntetes),
    zebreLig: enumOu(a.zebreLig, ZEBRES, 'aucun'), zebreLigEntetes: vrai(a.zebreLigEntetes)
  };
  // Style d'en-tête sans en-tête correspondant -> défaut (sortie minimale, round-trip).
  if (attrs.enteteColonnes === 0) { attrs.elGras = false; attrs.elFond = 'aucun'; }   // el = colonnes de gauche
  if (attrs.enteteLignes === 0) { attrs.ecGras = false; attrs.ecFond = 'aucun'; }       // ec = rangées du haut
  if (attrs.zebreCol === 'aucun') { attrs.zebreColEntetes = false; }
  if (attrs.zebreLig === 'aucun') { attrs.zebreLigEntetes = false; }
  const lignes = lignesEntree.map((lg) => ({
    cellules: ((lg && lg.cellules) || []).map((c) => {
      const th = !!(c && c.th);
      return {
        contenu: canoniserInline(c && c.contenu),
        colspan: Math.max(1, parseInt(c && c.colspan, 10) || 1),
        rowspan: Math.max(1, parseInt(c && c.rowspan, 10) || 1),
        th: th,
        scope: th ? ((c && c.scope) === 'row' ? 'row' : ((c && c.scope) === 'col' ? 'col' : '')) : '',
        align: enumOu(c && c.align, ['left', 'center', 'right'], 'left')
      };
    })
  }));
  if (lignes.length === 0) { lignes.push({ cellules: [{ contenu: '', colspan: 1, rowspan: 1, th: false, scope: '', align: 'left' }] }); }

  // INVARIANT DE GRILLE : aucune fusion de l'en-tête ne doit DÉPASSER dans le corps.
  // Un rowspan ne franchit pas la frontière <thead>/<tbody> — les navigateurs le bornent
  // à la section. Un en-tête d'une rangée sur un tableau dont la rangée 0 porte un
  // rowspan=2 donne donc une grille FAUSSE : la rangée suivante remonte d'une colonne
  // (mesuré au rendu, c'est le défaut trouvé sur le collage d'un tableau Word à en-tête
  // à deux niveaux). On réduit donc le compte d'en-tête jusqu'à ce qu'aucune fusion ne
  // dépasse, quitte à tomber à 0 : un tableau sans <thead> reste JUSTE, un tableau à
  // <thead> tronqué est faux. L'en-tête se repose ensuite d'un clic dans l'éditeur.
  //
  // Placé ici, dans le passage OBLIGÉ de tous les chemins (analyse d'un fichier, collage,
  // opérations de l'éditeur, sérialisation via finaliserModele), plutôt que dans chaque
  // producteur : c'est le seul endroit où l'oubli est impossible.
  while (attrs.enteteLignes > 0 && fusionFranchitEntete(lignes, attrs.enteteLignes)) {
    attrs.enteteLignes--;
  }
  if (attrs.enteteLignes === 0) { attrs.ecGras = false; attrs.ecFond = 'aucun'; }

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
// d'en-tête des <th> si les data-entete-* manquent ; ignore thead/tbody/caption/col
// ET le markup accessible dérivé (id/headers/scope=colgroup/rowgroup) régénéré par
// serialiserTable (D68) -> le modèle est inchangé, le round-trip stable.
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
  // La LÉGENDE (D94) est lue AVANT que le <caption> ne soit retiré du corps : c'est
  // elle que le pipeline numérote et affiche, et l'import Word en bake déjà une.
  const mCaption = corps.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i);
  corps = corps
    .replace(/<\/?(thead|tbody|tfoot)\b[^>]*>/gi, '')
    .replace(/<colgroup\b[^>]*>[\s\S]*?<\/colgroup>/gi, '')
    .replace(/<col\b[^>]*\/?>/gi, '')
    .replace(/<caption\b[^>]*>[\s\S]*?<\/caption>/gi, '');
  const lignes = [];
  const reTr = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
  let mtr;
  while ((mtr = reTr.exec(corps)) !== null) {
    lignes.push({ cellules: extraireCellules(mtr[2]) });
  }
  if (lignes.length === 0) { lignes.push({ cellules: [{ contenu: '', colspan: 1, rowspan: 1, th: false, scope: '' }] }); }
  const occ = matriceOccupation(lignes);
  const attrs = {
    classe: 'szh-tableau',
    legende: mCaption ? canoniserInline(mCaption[1]) : '',
    // Texte pur : lireAttributsHtml rend la valeur telle qu'elle est écrite dans le
    // fichier (entités comprises), il faut donc la décoder pour retrouver le texte.
    alt: decoderEntites(at['data-alt'] || ''),
    copyright: decoderEntites(at['data-copyright'] || ''),
    source: decoderEntites(at['data-source'] || ''),
    enteteLignes: at['data-entete-lignes'] !== undefined ? Math.max(0, Math.min(2, parseInt(at['data-entete-lignes'], 10) || 0)) : infererEnteteLignes(occ, lignes),
    enteteColonnes: at['data-entete-colonnes'] !== undefined ? Math.max(0, Math.min(2, parseInt(at['data-entete-colonnes'], 10) || 0)) : infererEnteteColonnes(occ, lignes),
    elGras: at['data-el-gras'] === '1', elFond: enumOu(at['data-el-fond'], FONDS, 'aucun'),
    ecGras: at['data-ec-gras'] === '1', ecFond: enumOu(at['data-ec-fond'], FONDS, 'aucun'),
    totalGras: at['data-total-gras'] === '1', totalFond: enumOu(at['data-total-fond'], FONDS, 'aucun'),
    bordureHaute: at['data-bordure-haute'] === '1', bordureBasse: at['data-bordure-basse'] === '1',
    zebreCol: enumOu(at['data-zebre-col'], ZEBRES, 'aucun'), zebreColEntetes: at['data-zebre-col-entetes'] === '1',
    zebreLig: enumOu(at['data-zebre-lig'], ZEBRES, 'aucun'), zebreLigEntetes: at['data-zebre-lig-entetes'] === '1'
  };
  return finaliserModele({ attrs: attrs, lignes: lignes });
}

// Liste « headers » d'une cellule de données (D68) : ids des en-têtes de COLONNE qui la
// couvrent (tous les niveaux, de haut en bas), puis ids des en-têtes de LIGNE (colonnes
// de gauche). occ = matrice d'occupation ; idTh(li,c0) = id de l'en-tête d'origine (li,c0).
function headersDe(occ, r, c0, colspan, rowspan, eL, eC, idTh) {
  const ids = [], vus = {};
  const ajouter = (li, cc) => {
    const ref = occ.grid[li] && occ.grid[li][cc];
    if (!ref) { return; }
    const id = idTh(ref.li, ref.c0);
    if (!vus[id]) { vus[id] = 1; ids.push(id); }
  };
  for (let hr = 0; hr < eL; hr++) { for (let cc = c0; cc < c0 + colspan; cc++) { ajouter(hr, cc); } }
  for (let hc = 0; hc < eC; hc++) { for (let rr = r; rr < r + rowspan; rr++) { ajouter(rr, hc); } }
  return ids.join(' ');
}

// serialiserTable(modèle) -> <table> propre et STABLE (attributs data-* en ordre fixe,
// émis seulement s'ils sont signifiants -> sortie minimale ; une balise par ligne,
// lisible/diff-able). Markup accessible (D68/AX1) : tableau SIMPLE (≤1 rangée ET ≤1
// colonne d'en-tête, sans en-tête fusionné) -> scope="col"/"row" ; tableau COMPLEXE
// (2 niveaux d'en-tête OU en-tête fusionné) -> id sur chaque en-tête + headers="…" sur
// chaque cellule de données + scope="colgroup"/"rowgroup" pour un en-tête de groupe.
// Les rangées d'en-tête (les enteteLignes premières) vont dans <thead>, le reste dans
// <tbody> ; total = dernière rangée de <tbody> (D65). id/headers/thead/tbody sont
// DÉRIVÉS du modèle (dépouillés par analyserTable) -> le round-trip reste stable.
function serialiserTable(modele) {
  const m = normaliserModele(modele);
  const a = m.attrs;
  const eL = a.enteteLignes, eC = a.enteteColonnes;
  let ouv = '<table class="' + a.classe + '"';
  if (eL > 0) { ouv += ' data-entete-lignes="' + eL + '"'; }
  if (eC > 0) { ouv += ' data-entete-colonnes="' + eC + '"'; }
  // Accessibilité + crédits (contrat de format arrêté avec le pipeline) : émis
  // seulement s'ils portent une valeur — un tableau sans eux se réécrit à l'octet
  // près comme avant. Aucun « alt="" » ici : un tableau décoratif n'existe pas.
  if (a.alt !== '') { ouv += ' data-alt="' + echapAttribut(a.alt) + '"'; }
  if (a.copyright !== '') { ouv += ' data-copyright="' + echapAttribut(a.copyright) + '"'; }
  if (a.source !== '') { ouv += ' data-source="' + echapAttribut(a.source) + '"'; }
  if (eC > 0 && a.elGras) { ouv += ' data-el-gras="1"'; }
  if (eC > 0 && a.elFond !== 'aucun') { ouv += ' data-el-fond="' + a.elFond + '"'; }
  if (eL > 0 && a.ecGras) { ouv += ' data-ec-gras="1"'; }
  if (eL > 0 && a.ecFond !== 'aucun') { ouv += ' data-ec-fond="' + a.ecFond + '"'; }
  if (a.totalGras) { ouv += ' data-total-gras="1"'; }
  if (a.totalFond !== 'aucun') { ouv += ' data-total-fond="' + a.totalFond + '"'; }
  if (a.bordureHaute) { ouv += ' data-bordure-haute="1"'; }
  if (a.bordureBasse) { ouv += ' data-bordure-basse="1"'; }
  if (a.zebreCol !== 'aucun') { ouv += ' data-zebre-col="' + a.zebreCol + '"'; if (a.zebreColEntetes) { ouv += ' data-zebre-col-entetes="1"'; } }
  if (a.zebreLig !== 'aucun') { ouv += ' data-zebre-lig="' + a.zebreLig + '"'; if (a.zebreLigEntetes) { ouv += ' data-zebre-lig-entetes="1"'; } }
  ouv += '>';

  const occ = matriceOccupation(m.lignes);
  // Complexité (D68) : 2 niveaux d'en-tête OU au moins un en-tête fusionné.
  let complexe = eL >= 2 || eC >= 2;
  if (!complexe) {
    for (const lg of m.lignes) {
      for (const cell of lg.cellules) {
        if (cell.th && (cell.colspan > 1 || cell.rowspan > 1)) { complexe = true; break; }
      }
      if (complexe) { break; }
    }
  }
  const idTh = (li, c0) => 'szh-th-r' + li + 'c' + c0;

  const out = [ouv];
  // Légende (D94) : <caption> — PREMIER enfant de <table>, comme l'exige HTML (et comme
  // l'écrit l'import Word). Émis seulement s'il y a une légende : un tableau sans
  // légende ne gagne jamais de <caption> vide (sortie minimale, round-trip stable).
  if (a.legende !== '') { out.push('<caption>' + a.legende + '</caption>'); }
  const emettreRangee = (lg, r) => {
    out.push('<tr>');
    lg.cellules.forEach((cell, ci) => {
      const c0 = occ.positions[r][ci].c0;
      const tag = cell.th ? 'th' : 'td';
      let t = '<' + tag;
      if (cell.th) {
        const estColonne = r < eL;   // rangée du haut -> en-tête de colonne (scope col)
        if (complexe) {
          t += ' id="' + idTh(r, c0) + '"';
          const sc = estColonne ? (cell.colspan > 1 ? 'colgroup' : 'col')
                                 : (cell.rowspan > 1 ? 'rowgroup' : 'row');
          t += ' scope="' + sc + '"';
        } else if (cell.scope === 'col' || cell.scope === 'row') {
          t += ' scope="' + cell.scope + '"';
        }
      } else if (complexe) {
        const ids = headersDe(occ, r, c0, cell.colspan, cell.rowspan, eL, eC, idTh);
        if (ids) { t += ' headers="' + ids + '"'; }
      }
      if (cell.colspan > 1) { t += ' colspan="' + cell.colspan + '"'; }
      if (cell.rowspan > 1) { t += ' rowspan="' + cell.rowspan + '"'; }
      if (cell.align === 'center' || cell.align === 'right') { t += ' data-align="' + cell.align + '"'; }
      out.push(t + '>' + cell.contenu + '</' + tag + '>');
    });
    out.push('</tr>');
  };

  if (eL > 0) {
    out.push('<thead>');
    for (let r = 0; r < eL && r < m.lignes.length; r++) { emettreRangee(m.lignes[r], r); }
    out.push('</thead>');
  }
  out.push('<tbody>');
  for (let r = eL; r < m.lignes.length; r++) { emettreRangee(m.lignes[r], r); }
  out.push('</tbody>');
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
      cellules: lg.cellules.map((cell, ci) => ({
        li: r, ci: ci, r0: r, c0: occ.positions[r][ci].c0,
        colspan: occ.positions[r][ci].colspan, rowspan: occ.positions[r][ci].rowspan,
        th: cell.th, scope: cell.scope, align: cell.align || 'left', contenu: cell.contenu
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
    } else { rangee[c] = g.cellules.length; g.cellules.push({ contenu: '', th: false, scope: '', align: 'left' }); }
  }
  g.grid.splice(pos, 0, rangee);
  return compacterGrille(g);
}

function supprimerLigne(modele, index) {
  const g = etendreGrille(modele);
  if (g.grid.length <= 1) { return finaliserModele(modele); }
  index = Math.max(0, Math.min(index, g.grid.length - 1));
  g.grid.splice(index, 1);
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
    } else { id = g.cellules.length; g.cellules.push({ contenu: '', th: false, scope: '', align: 'left' }); }
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
    g.cellules.push({ contenu: '', th: base.th, scope: base.scope, align: base.align || 'left' });
    g.grid[positions[k][0]][positions[k][1]] = nid;
  }
  return compacterGrille(g);
}

// Vide la sélection visuelle (rMin..rMax / cMin..cMax) : mode 'contenu' -> texte
// effacé ; mode 'forme' -> mise en forme inline (<strong>/<em>) retirée, texte et
// sauts <br> conservés. N'affecte QUE les cellules dont l'origine est dans la plage
// (une cellule fusionnée traitée une seule fois). Pure : modèle -> modèle.
function viderCellules(modele, rMin, cMin, rMax, cMax, mode) {
  const m = normaliserModele(modele);
  const occ = matriceOccupation(m.lignes);
  const nbL = occ.nbLignes, nbC = occ.nbColonnes;
  const r0 = Math.max(0, Math.min(rMin, rMax)), r1 = Math.min(nbL - 1, Math.max(rMin, rMax));
  const c0 = Math.max(0, Math.min(cMin, cMax)), c1 = Math.min(nbC - 1, Math.max(cMin, cMax));
  const vus = new Set();
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const ref = occ.grid[r] && occ.grid[r][c];
      if (!ref) { continue; }
      const clef = ref.li + '/' + ref.ci;
      if (vus.has(clef)) { continue; }
      vus.add(clef);
      const cell = m.lignes[ref.li].cellules[ref.ci];
      if (mode === 'forme') { cell.contenu = canoniserInline(String(cell.contenu).replace(/<\/?(strong|em)\b[^>]*>/gi, '')); }
      else { cell.contenu = ''; }
    }
  }
  return finaliserModele(m);
}

// Vrai si CHAQUE id de la grille occupe un rectangle plein et contigu (aucune fusion
// coupée). Sert de garde au réordonnancement (RV5) : un déplacement qui fragmenterait
// une cellule fusionnée est refusé.
function grilleRectangulaire(grid) {
  const nbL = grid.length, nbC = nbL ? grid[0].length : 0;
  const info = {};
  for (let r = 0; r < nbL; r++) {
    for (let c = 0; c < nbC; c++) {
      const id = grid[r][c];
      if (id == null) { continue; }
      if (!info[id]) { info[id] = { rmin: r, rmax: r, cmin: c, cmax: c, n: 0 }; }
      const b = info[id];
      b.rmin = Math.min(b.rmin, r); b.rmax = Math.max(b.rmax, r);
      b.cmin = Math.min(b.cmin, c); b.cmax = Math.max(b.cmax, c); b.n++;
    }
  }
  for (const id in info) { const b = info[id]; if (b.n !== (b.rmax - b.rmin + 1) * (b.cmax - b.cmin + 1)) { return false; } }
  return true;
}

// Déplace la ligne visuelle `de` à l'index `vers` (0..nbLignes-1) ; refuse si cela
// couperait une fusion verticale -> { erreur:'table.deplacementImpossible' }. Pure.
function deplacerLigne(modele, de, vers) {
  const g = etendreGrille(normaliserModele(modele));
  const nbL = g.grid.length;
  de = Math.max(0, Math.min(de, nbL - 1)); vers = Math.max(0, Math.min(vers, nbL - 1));
  if (de === vers) { return compacterGrille(g); }
  const row = g.grid.splice(de, 1)[0];
  g.grid.splice(vers, 0, row);
  if (!grilleRectangulaire(g.grid)) { return { erreur: 'table.deplacementImpossible' }; }
  return compacterGrille(g);
}

// Déplace la colonne visuelle `de` à l'index `vers` ; refuse si cela couperait une
// fusion horizontale. Pure : modèle -> modèle.
function deplacerColonne(modele, de, vers) {
  const g = etendreGrille(normaliserModele(modele));
  const nbC = g.grid.length ? g.grid[0].length : 0;
  de = Math.max(0, Math.min(de, nbC - 1)); vers = Math.max(0, Math.min(vers, nbC - 1));
  if (de === vers) { return compacterGrille(g); }
  for (let r = 0; r < g.grid.length; r++) { const cell = g.grid[r].splice(de, 1)[0]; g.grid[r].splice(vers, 0, cell); }
  if (!grilleRectangulaire(g.grid)) { return { erreur: 'table.deplacementImpossible' }; }
  return compacterGrille(g);
}

// Alignement horizontal (D59) des cellules dont l'origine est dans la plage visuelle.
// Par colonne = sélectionner la colonne entière puis appliquer. Pure : modèle -> modèle.
function alignerCellules(modele, rMin, cMin, rMax, cMax, valeur) {
  const v = enumOu(valeur, ['left', 'center', 'right'], 'left');
  const m = normaliserModele(modele);
  const occ = matriceOccupation(m.lignes);
  const nbL = occ.nbLignes, nbC = occ.nbColonnes;
  const r0 = Math.max(0, Math.min(rMin, rMax)), r1 = Math.min(nbL - 1, Math.max(rMin, rMax));
  const c0 = Math.max(0, Math.min(cMin, cMax)), c1 = Math.min(nbC - 1, Math.max(cMin, cMax));
  const vus = new Set();
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const ref = occ.grid[r] && occ.grid[r][c];
      if (!ref) { continue; }
      const clef = ref.li + '/' + ref.ci;
      if (vus.has(clef)) { continue; }
      vus.add(clef);
      m.lignes[ref.li].cellules[ref.ci].align = v;
    }
  }
  return finaliserModele(m);
}

// Presse-papier TEXTE (TSV) -> modèle : lignes = \n, cellules = \t. Texte échappé
// (jamais d'injection). Ex. « a\tb\nc\td » -> tableau 2×2.
function tableauDepuisTsv(texte) {
  const s = String(texte === undefined || texte === null ? '' : texte).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const lignesTxt = s.split('\n');
  const lignes = lignesTxt.map((l) => ({
    cellules: l.split('\t').map((v) => ({ contenu: echapTexteBrut(v), colspan: 1, rowspan: 1, th: false, scope: '', align: 'left' }))
  }));
  return finaliserModele({ attrs: {}, lignes: lignes });
}

// ---- Presse-papiers HTML d'Excel/Word -> modèle (collage de tableau, D81) ----------
//
// POURQUOI ces fonctions vivent ICI : elles sont PURES (chaîne -> chaîne/modèle) et
// forment la TROISIÈME entrée du modèle, à côté de analyserTable (HTML canonique D47)
// et de tableauDepuisTsv (presse-papiers TEXTE). Elles se testent donc headless comme
// leurs sœurs. La LECTURE du presse-papiers, elle, est impérative (PowerShell) et
// reste dans lib/formatting.js.
//
// POURQUOI ce chemin existe : vscode.env.clipboard.readText() ne rend que du TEXTE,
// donc du TSV — les cellules FUSIONNÉES n'y sont pas et aucune astuce ne les y fera
// apparaître. Excel et Word déposent AUSSI une variante HTML sur le presse-papiers
// Windows, et celle-là porte colspan/rowspan : c'est la seule source qui préserve les
// fusions.

// Attributs conservés sur <td>/<th> par le nettoyage : ceux que le modèle lit
// (colspan/rowspan/scope/data-align) + le balisage accessible dérivé (id/headers,
// ignoré par analyserTable). Tout le reste — class=xl63, style='mso-…', width, height,
// nowrap, x:num, lang — est jeté.
const ATTRS_CELLULE = ['colspan', 'rowspan', 'scope', 'data-align', 'id', 'headers'];

// Balises conservées par le nettoyage : structure de tableau + inline canonisable par
// canoniserInline. Toute autre balise est retirée EN GARDANT son texte.
// `caption` en fait partie depuis D94 : la légende d'un tableau collé depuis Word
// arrive dans un <caption> et doit survivre au nettoyage (analyserTable la lit).
const BALISES_GARDEES = {
  table: 1, thead: 1, tbody: 1, tfoot: 1, tr: 1, td: 1, th: 1, caption: 1,
  br: 1, strong: 1, b: 1, em: 1, i: 1
};

// Sérialise les attributs retenus d'une balise (ordre = celui de `cles`, valeurs
// requotées en double — jamais d'injection : les " internes sont retirés).
function attributsRetenus(attrs, cles) {
  let t = '';
  cles.forEach((cle) => {
    if (attrs[cle] === undefined || attrs[cle] === '') { return; }
    t += ' ' + cle + '="' + String(attrs[cle]).replace(/"/g, '') + '"';
  });
  return t;
}

// CF_HTML -> fragment HTML. Le presse-papiers Windows livre le HTML dans le format
// CF_HTML : un en-tête « Version:0.9 / StartHTML: / EndHTML: / StartFragment: /
// EndFragment: / SourceURL: » suivi du document. On NE se fie PAS aux décalages
// annoncés (ce sont des positions en OCTETS, inutilisables sur une chaîne JS déjà
// décodée) mais aux marqueurs <!--StartFragment--> / <!--EndFragment-->, présents chez
// Word comme chez Excel. Excel place ces marqueurs À L'INTÉRIEUR du <table> (juste
// avant les <col>) : le fragment n'a alors PAS de balise <table> — sans conséquence,
// analyserTable tolère un corps de tableau nu (M2) et les attributs de tableau d'Excel
// ne nous intéressent pas. Sans marqueurs, on retire au moins l'en-tête ; sans en-tête
// (HTML déjà propre), la chaîne est rendue telle quelle. Pure.
function fragmentCfHtml(brut) {
  const s = String(brut === undefined || brut === null ? '' : brut)
    .replace(/\0/g, '')                              // la donnée CF_HTML est terminée par un NUL
    .replace(/^\uFEFF/, '');                         // BOM éventuel en tête de flux
  const debut = s.match(/<!--\s*StartFragment\s*-->/i);
  const fin = s.match(/<!--\s*EndFragment\s*-->/i);
  if (debut && fin && fin.index > debut.index) {
    return s.slice(debut.index + debut[0].length, fin.index);
  }
  if (/^\s*Version\s*:/i.test(s)) {
    const i = s.search(/<(?:!doctype|html|head|body|table|tbody|tr)\b/i);
    if (i > 0) { return s.slice(i); }
  }
  return s;
}

// HTML d'Excel/Word -> HTML de tableau MINIMAL, digeste pour analyserTable. Le HTML
// bureautique est très sale : îlots XML « <!--[if gte mso 9]><xml>…</xml><![endif]--> »,
// conditionnels révélés « <![if !supportMisalignedColumns]> », <style> de classes
// xl63, <o:p>, <span style='mso-…'>, <font>, paragraphes <p class=MsoNormal> dans les
// cellules. On jette les blocs entiers sans contenu de tableau, on traduit les
// FRONTIÈRES de paragraphe en <br> (sinon deux paragraphes d'une cellule se
// colleraient), puis on filtre balise par balise en gardant le texte.
//
// Propriété voulue : sur du HTML canonique D47 (celui de serialiserTable), ce
// nettoyage ne retire RIEN de signifiant — seul l'ordre des attributs peut changer.
// C'est ce qui permet de le poser aussi sur le collage DANS l'éditeur de tableau
// (appliquerOperationTable 'coller'), où l'on peut recoller du canonique. Pure.
function nettoyerHtmlBureautique(html) {
  let s = String(html === undefined || html === null ? '' : html);
  // 1. Blocs entiers sans contenu de tableau.
  s = s.replace(/<!--[\s\S]*?-->/g, '');                          // commentaires (dont les îlots mso)
  // Conditionnels « révélés » (<![if !supportMisalignedColumns]>…<![endif]>) : contenu
  // JETÉ avec le bloc. Ils ne portent jamais de données, seulement des rustines de mise
  // en page — Excel y range une rangée FANTÔME (height=0, display:none, cellules vides)
  // qui, gardée, ajouterait une ligne vide à chaque collage.
  s = s.replace(/<!\[if\b[^\]]*\]>[\s\S]*?<!\[endif\]\s*>/gi, '');
  s = s.replace(/<!\[if\b[^\]]*\]>/gi, '').replace(/<!\[endif\]\s*>/gi, '');   // marqueur orphelin
  s = s.replace(/<\?[\s\S]*?\?>/g, '');                           // <?xml:namespace … ?>
  s = s.replace(/<!doctype\b[^>]*>/gi, '');
  s = s.replace(/<(style|script|head|title|xml)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  // 2. Frontière de paragraphe -> <br> (les <p>/<div> restants tombent en 3).
  s = s.replace(/<\/(?:p|div|h[1-6])\s*>\s*<(?:p|div|h[1-6])\b[^>]*>/gi, '<br>');
  // 3. Filtrage des balises (même technique que canoniserInline : texte conservé).
  let out = '', dernier = 0, m;
  const re = /<[^>]*>/g;
  while ((m = re.exec(s)) !== null) {
    out += s.slice(dernier, m.index);
    dernier = re.lastIndex;
    const tete = m[0].match(/^<\s*(\/?)\s*([A-Za-z][-A-Za-z0-9:]*)/);
    if (!tete) { continue; }                                      // <! … > résiduel : jeté
    const nom = tete[2].toLowerCase();
    if (nom.indexOf(':') !== -1) { continue; }                    // <o:p>, <w:sdt>, <v:shape>
    if (!BALISES_GARDEES[nom]) { continue; }
    if (tete[1] === '/') { out += '</' + nom + '>'; continue; }
    if (nom === 'td' || nom === 'th' || nom === 'table') {
      const attrs = lireAttributsHtml(m[0].slice(tete[0].length).replace(/\/?>$/, ''));
      // Sur <table>, on garde class + data-* : c'est tout l'encodage de style D64 du
      // HTML canonique, qui doit traverser le nettoyage intact.
      const cles = (nom === 'table')
        ? Object.keys(attrs).filter((c) => c === 'class' || c.indexOf('data-') === 0)
        : ATTRS_CELLULE;
      out += '<' + nom + attributsRetenus(attrs, cles) + '>';
      continue;
    }
    out += '<' + nom + '>';
  }
  out += s.slice(dernier);
  return out;
}

// Blancs d'une cellule collée : Word/Excel émettent des retours à la ligne et des
// indentations dans le source, et des &nbsp; de mise en page (une cellule « vide » est
// un &nbsp;, un paragraphe vide un <o:p>&nbsp;</o:p>). On ramène tout à des espaces
// simples, on retire les <br> de tête/fin et les paires inline vides -> une cellule
// vide EST vide dans le modèle. Contrepartie ASSUMÉE : une espace insécable VOULUE
// (« 50 % ») redevient une espace ordinaire — la typographie fine est de toute façon
// posée par la chaîne de compilation, pas par le collage. Pure.
function nettoyerContenuCellule(contenu) {
  let s = String(contenu === undefined || contenu === null ? '' : contenu)
    .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/^(?:\s*<br>)+/gi, '')
    .replace(/(?:<br>\s*)+$/gi, '')
    .replace(/\s+/g, ' ');
  for (let i = 0; i < 3; i++) { s = s.replace(/<(strong|em)>\s*<\/\1>/g, ''); }
  return s.trim();
}

// Vrai si la rangée porte du texte et que TOUT son texte est en gras. Même heuristique
// que pipeline/docx-tables.py (ligne_toute_gras) : un tableau Word COLLÉ obtient ainsi
// le même en-tête que le même tableau IMPORTÉ (RM2). Les cellules vides ne
// disqualifient pas (elles ne portent aucun texte).
function ligneToutGras(cellules) {
  let vuTexte = false;
  for (const cell of cellules || []) {
    const c = String(cell.contenu || '');
    if (c === '') { continue; }
    vuTexte = true;
    if (!/^<strong>[\s\S]*<\/strong>$/.test(c)) { return false; }
    if (/<\/strong>[\s\S]*<strong>/.test(c)) { return false; }    // gras interrompu
  }
  return vuTexte;
}

// HAUTEUR de l'en-tête déduite d'une 1re rangée toute en gras. Elle n'est PAS toujours
// de 1 : la forme que Word émet pour un en-tête à DEUX NIVEAUX est une cellule qui
// couvre les deux rangées (« Canton », rowspan=2) à côté d'un groupe qui couvre deux
// colonnes (« Élèves 2024 », colspan=2) et se subdivise à la rangée suivante. La hauteur
// de l'en-tête est donc le plus grand rowspan de la rangée 0.
//
// POURQUOI c'est un défaut de GRILLE et pas de sémantique : un rowspan ne franchit
// jamais la frontière d'un groupe de rangées — les navigateurs le BORNENT à son
// <thead>/<tbody>. Un <thead> d'une seule rangée contenant « Canton » en rowspan=2
// tronque la fusion, et la rangée suivante remonte d'une colonne vers la gauche : le
// tableau est faux À L'AFFICHAGE.
function hauteurEnteteGras(lignes) {
  let h = 1;
  for (const cell of lignes[0].cellules) { h = Math.max(h, Math.max(1, parseInt(cell.rowspan, 10) || 1)); }
  return h;
}

// Vrai si une fusion verticale née dans les `n` premières rangées DÉPASSE de l'en-tête,
// donc franchirait la frontière <thead>/<tbody> — cas où il vaut mieux n'émettre AUCUN
// en-tête (tout en <tbody> : la grille reste juste) que d'émettre une grille fausse.
function fusionFranchitEntete(lignes, n) {
  for (let r = 0; r < n && r < lignes.length; r++) {
    for (const cell of lignes[r].cellules) {
      if (r + Math.max(1, parseInt(cell.rowspan, 10) || 1) > n) { return true; }
    }
  }
  return false;
}

// Presse-papiers HTML (CF_HTML brut ou fragment) -> modèle, FUSIONS PRÉSERVÉES.
// Rend `null` si la chaîne ne contient aucune cellule -> l'appelant se replie sur le
// TSV (tableauDepuisTsv). Sans <th> ni compte d'en-tête déduit, les rangées de tête sont
// promues en en-tête si la 1re est toute en gras (cf. ligneToutGras) — Excel, qui met son
// gras dans une classe CSS, donne donc un tableau sans en-tête, à régler d'un clic dans
// l'éditeur de tableau.
//
// On ne fait que POSER data-entete-lignes : serialiserTable en dérive seul <thead>, les
// <th> de toutes les rangées comprises dans l'en-tête et leurs scope/headers (D61/D68),
// via finaliserModele -> reappliquerEntetes. Rien de cette logique n'est réécrit ici.
// Pure.
function tableauDepuisHtmlBureautique(html) {
  const propre = nettoyerHtmlBureautique(fragmentCfHtml(html));
  if (!/<t[dh]\b/i.test(propre)) { return null; }
  const m = analyserTable(propre);
  m.lignes = m.lignes.filter((lg) => lg.cellules.length > 0);      // <tr> sans cellule : artefact
  m.lignes.forEach((lg) => lg.cellules.forEach((c) => { c.contenu = nettoyerContenuCellule(c.contenu); }));
  m.attrs.legende = nettoyerContenuCellule(m.attrs.legende);       // D94 : mêmes blancs que les cellules
  if (m.attrs.enteteLignes === 0 && m.lignes.length >= 2 && ligneToutGras(m.lignes[0].cellules)) {
    const hauteur = hauteurEnteteGras(m.lignes);
    // Plafond du modèle : 2 niveaux d'en-tête (normaliserModele borne de toute façon).
    let n = Math.min(hauteur, 2);
    // Ne pas promouvoir la moitié du tableau : une fusion qui couvre TOUTES les rangées
    // ne décrit pas un en-tête de N rangées (il ne resterait aucune donnée).
    if (hauteur >= m.lignes.length) { n = 1; }
    // Dernier garde-fou, décisif pour le rendu : si une fusion dépasse encore de
    // l'en-tête retenu (fusion de 3 rangées, ou cas dégénéré ci-dessus), aucun <thead>
    // — mieux vaut un tableau sans en-tête qu'une grille tronquée par le navigateur.
    if (fusionFranchitEntete(m.lignes, n)) { n = 0; }
    m.attrs.enteteLignes = n;
  }
  return finaliserModele(m);
}

// Colle le modèle `source` dans `modele` à l'ancre visuelle (ancreR,ancreC) : la
// grille cible s'agrandit au besoin, les cellules source sont ESTAMPÉES (fusions
// colspan/rowspan préservées : chaque origine source occupe le même rectangle dans
// la cible). Pure : modèle -> modèle ; round-trip garanti par compacterGrille.
function collerDans(modele, ancreR, ancreC, source) {
  const g = etendreGrille(normaliserModele(modele));
  const sg = etendreGrille(normaliserModele(source));
  const sL = sg.grid.length, sC = sL ? sg.grid[0].length : 0;
  if (sL === 0 || sC === 0) { return finaliserModele(modele); }
  ancreR = Math.max(0, ancreR | 0); ancreC = Math.max(0, ancreC | 0);
  let curC = g.grid.length ? g.grid[0].length : 0;
  const needC = ancreC + sC, needL = ancreR + sL;
  for (; curC < needC; curC++) { for (let r = 0; r < g.grid.length; r++) { const id = g.cellules.length; g.cellules.push({ contenu: '', th: false, scope: '', align: 'left' }); g.grid[r].push(id); } }
  while (g.grid.length < needL) { const row = []; for (let c = 0; c < curC; c++) { const id = g.cellules.length; g.cellules.push({ contenu: '', th: false, scope: '', align: 'left' }); row.push(id); } g.grid.push(row); }
  const origines = {};
  for (let r = 0; r < sL; r++) { for (let c = 0; c < sC; c++) { const id = sg.grid[r][c]; if (!(id in origines)) { origines[id] = { r: r, c: c }; } } }
  Object.keys(origines).forEach((idStr) => {
    const id = +idStr, o = origines[id];
    let cs = 0; while (o.c + cs < sC && sg.grid[o.r][o.c + cs] === id) { cs++; }
    let rs = 0; while (o.r + rs < sL && sg.grid[o.r + rs][o.c] === id) { rs++; }
    const sc = sg.cellules[id];
    const nid = g.cellules.length;
    g.cellules.push({ contenu: sc.contenu, th: !!sc.th, scope: sc.scope || '', align: sc.align || 'left' });
    for (let dr = 0; dr < rs; dr++) { for (let dc = 0; dc < cs; dc++) { g.grid[ancreR + o.r + dr][ancreC + o.c + dc] = nid; } }
  });
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
  if (nom === 'vider') { return viderCellules(modele, n(a.rMin), n(a.cMin), n(a.rMax), n(a.cMax), a.mode === 'forme' ? 'forme' : 'contenu'); }
  if (nom === 'aligner') { return alignerCellules(modele, n(a.rMin), n(a.cMin), n(a.rMax), n(a.cMax), a.valeur); }
  if (nom === 'deplacerLigne') { return deplacerLigne(modele, n(a.de), n(a.vers)); }
  if (nom === 'deplacerColonne') { return deplacerColonne(modele, n(a.de), n(a.vers)); }
  if (nom === 'coller') {
    // Le HTML vient du presse-papiers du navigateur (webview) : il est TOUT AUSSI sale
    // que celui de CF_HTML (styles mso-*, <p> dans les cellules) et porte, lui aussi,
    // les fusions. Même chemin de nettoyage que le collage Ctrl+Alt+V ; sans cellule
    // exploitable, repli sur le TSV.
    const src = (a.html ? tableauDepuisHtmlBureautique(String(a.html)) : null) || tableauDepuisTsv(a.texte);
    return collerDans(modele, n(a.ancreR), n(a.ancreC), src);
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
    // F3 : ne retirer QUE le sens demandé (lignes OU colonnes). Sans `sens` (ancien
    // appel), on retire les deux — compat ascendante.
    if (a.sens === 'lignes') { modele.attrs.enteteLignes = 0; }
    else if (a.sens === 'colonnes') { modele.attrs.enteteColonnes = 0; }
    else { modele.attrs.enteteLignes = 0; modele.attrs.enteteColonnes = 0; }
    return finaliserModele(modele);
  }
  // Styles des en-têtes / du total (D64/D67) : gras (bool) + fond (aucun|negatif|couleur|gris).
  // cible : 'lignes' = en-têtes de lignes (el, th[scope=row]) ; 'colonnes' = en-têtes de
  // colonnes (ec, th[scope=col]) ; 'total' = dernière rangée (D65).
  if (nom === 'styleEntete') {
    const fond = enumOu(a.fond, FONDS, 'aucun');
    const gras = vrai(a.gras);
    if (a.cible === 'colonnes') { modele.attrs.ecGras = gras; modele.attrs.ecFond = fond; }
    else if (a.cible === 'total') { modele.attrs.totalGras = gras; modele.attrs.totalFond = fond; }
    else { modele.attrs.elGras = gras; modele.attrs.elFond = fond; }
    return finaliserModele(modele);
  }
  // Réglages du tableau (D64) : bordures (bool), zébrage colonnes/lignes (enum) + « inclure
  // les en-têtes » (bool). Un seul champ par appel (les zones postent au changement).
  if (nom === 'preset') {
    // Un préréglage pose d'un coup TOUS les styles de mise en forme du tableau, donc un
    // seul pas d'annulation — l'ancienne voie (un « reglage » par champ) en aurait empilé
    // une dizaine, et un Ctrl+Z n'aurait défait qu'un huitième du changement.
    const p = PRESETS_TABLE[String(a.nom || '')];
    if (p) {
      // On ne touche JAMAIS aux COMPTES d'en-tête (enteteLignes/Colonnes) : ils décrivent
      // la structure du tableau, pas son habillage. Un préréglage qui styliserait un
      // en-tête inexistant reste sans effet visible, et le sous-bloc correspondant est
      // déjà grisé dans le panneau — c'est le comportement voulu.
      Object.keys(p).forEach((champ) => { modele.attrs[champ] = p[champ]; });
    }
    return finaliserModele(modele);
  }
  // (La LÉGENDE, le TEXTE ALTERNATIF, le COPYRIGHT et la SOURCE n'ont pas d'opération :
  // comme le TEXTE des cellules, ils sont saisis dans la webview, voyagent avec le
  // modèle et sont assainis par normaliserModele — ils participent donc à
  // annuler/rétablir par le même chemin que le texte, sans re-rendu de la grille, D94.)
  if (nom === 'reglage') {
    const enums = { zebreCol: ZEBRES, zebreLig: ZEBRES };
    const bools = ['bordureHaute', 'bordureBasse', 'zebreColEntetes', 'zebreLigEntetes'];
    if (enums[a.champ]) { modele.attrs[a.champ] = enumOu(a.valeur, enums[a.champ], 'aucun'); }
    else if (bools.indexOf(a.champ) !== -1) { modele.attrs[a.champ] = vrai(a.valeur); }
    return finaliserModele(modele);
  }
  return finaliserModele(modele);
}

module.exports = {
  lireAttributsHtml, canoniserInline, normaliserLegende, normaliserTexteAttribut,
  decoderEntites, echapAttribut, echapTexteBrut, extraireCellules, enumOu,
  matriceOccupation, etendreGrille, compacterGrille, reappliquerEntetes,
  normaliserModele, finaliserModele, infererEnteteLignes, infererEnteteColonnes,
  analyserTable, serialiserTable, disposition,
  ajouterLigne, supprimerLigne, ajouterColonne, supprimerColonne,
  fusionner, scinder, viderCellules, alignerCellules,
  deplacerLigne, deplacerColonne, grilleRectangulaire,
  tableauDepuisTsv, collerDans, appliquerOperationTable,
  fragmentCfHtml, nettoyerHtmlBureautique, nettoyerContenuCellule,
  ligneToutGras, hauteurEnteteGras, fusionFranchitEntete, tableauDepuisHtmlBureautique,
  PRESETS_TABLE, PRESETS_ORDRE
};
