// Modèle des tableaux de la revue : parseur et sérialiseur HTML, matrice d'occupation,
// grille dépliée, opérations de structure. Fonctions pures, sans dépendance.
'use strict';

// « a="b" c='d' e » -> { a:'b', c:'d', e:'' }, clés en minuscules, valeurs nues admises.
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

// Ne garde que <strong>, <em>, <br> et le texte déjà échappé ; <b> et <i> sont
// normalisés, tout autre balisage retiré en conservant son texte. Idempotent, ce qui
// rend l'aller-retour stable.
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
  }
  out += s.slice(dernier);
  return out.trim();
}

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

// Les attributs data-* booléens s'écrivent « 1 » ; la webview, elle, envoie des booléens.
function vrai(v) { return v === true || v === 1 || v === '1' || v === 'oui' || v === 'true'; }

const FONDS = ['aucun', 'negatif', 'couleur', 'gris'];   // data-*-fond
const ZEBRES = ['aucun', 'paires', 'impaires'];          // data-zebre-*

// Préréglages de mise en forme : chacun pose tout l'habillage du tableau d'un coup, sans
// toucher aux comptes d'en-tête, qui décrivent la structure et non l'apparence. Les
// boutons radio se construisent depuis ce tableau, dans cet ordre : pour en retirer un,
// supprimer son entrée ici et son libellé `table.preset.<clé>` dans lib/i18n.js.
const PRESETS_TABLE = {
  academique: {
    ecGras: true, ecFond: 'aucun', elGras: true, elFond: 'aucun',
    totalGras: false, totalFond: 'aucun', bordureHaute: true, bordureBasse: true,
    zebreCol: 'aucun', zebreColEntetes: false, zebreLig: 'aucun', zebreLigEntetes: false
  },
  entetenegatif: {
    ecGras: true, ecFond: 'negatif', elGras: true, elFond: 'aucun',
    totalGras: false, totalFond: 'aucun', bordureHaute: false, bordureBasse: true,
    zebreCol: 'aucun', zebreColEntetes: false, zebreLig: 'aucun', zebreLigEntetes: false
  },
  entetecouleur: {
    ecGras: true, ecFond: 'couleur', elGras: true, elFond: 'aucun',
    totalGras: false, totalFond: 'aucun', bordureHaute: false, bordureBasse: true,
    zebreCol: 'aucun', zebreColEntetes: false, zebreLig: 'aucun', zebreLigEntetes: false
  },
  entetegris: {
    ecGras: true, ecFond: 'gris', elGras: true, elFond: 'aucun',
    totalGras: false, totalFond: 'aucun', bordureHaute: true, bordureBasse: true,
    zebreCol: 'aucun', zebreColEntetes: false, zebreLig: 'aucun', zebreLigEntetes: false
  },
  lignesalternees: {
    ecGras: true, ecFond: 'aucun', elGras: true, elFond: 'aucun',
    totalGras: false, totalFond: 'aucun', bordureHaute: true, bordureBasse: true,
    zebreCol: 'aucun', zebreColEntetes: false, zebreLig: 'paires', zebreLigEntetes: false
  },
  colonnesalternees: {
    ecGras: true, ecFond: 'aucun', elGras: true, elFond: 'aucun',
    totalGras: false, totalFond: 'aucun', bordureHaute: true, bordureBasse: true,
    zebreCol: 'paires', zebreColEntetes: false, zebreLig: 'aucun', zebreLigEntetes: false
  },
  synthese: {
    ecGras: true, ecFond: 'negatif', elGras: true, elFond: 'aucun',
    totalGras: true, totalFond: 'gris', bordureHaute: false, bordureBasse: true,
    zebreCol: 'aucun', zebreColEntetes: false, zebreLig: 'aucun', zebreLigEntetes: false
  },
  matrice: {
    ecGras: true, ecFond: 'couleur', elGras: true, elFond: 'gris',
    totalGras: false, totalFond: 'aucun', bordureHaute: true, bordureBasse: true,
    zebreCol: 'aucun', zebreColEntetes: false, zebreLig: 'paires', zebreLigEntetes: false
  }
};
const PRESETS_ORDRE = ['academique', 'entetenegatif', 'entetecouleur', 'entetegris',
  'lignesalternees', 'colonnesalternees', 'synthese', 'matrice'];

function echapTexteBrut(s) {
  return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Place chaque cellule, fusions comprises, sur une grille visuelle : grid[r][c] donne les
// indices modèle de la cellule qui occupe la case, positions[r][ci] l'origine visuelle
// d'une cellule modèle.
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

// Réaligne th et scope sur les comptes data-entete-lignes et data-entete-colonnes, seule
// source de vérité : en-tête si l'origine est dans les lignes du haut (scope=col) ou les
// colonnes de gauche (scope=row), le haut l'emportant au coin.
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

// Légende du tableau, soit son <caption> : même convention que le contenu d'une cellule.
// Assainie ici, passage obligé de tous les chemins, donc aucune injection venue de la
// webview ne passe. Chaîne vide veut dire pas de <caption> du tout.
function normaliserLegende(v) {
  return canoniserInline(String(v === undefined || v === null ? '' : v).replace(/[\r\n]+/g, ' '));
}

// Texte alternatif, copyright et source : trois attributs data-* sur <table>, du texte pur
// dans le modèle, dont une valeur vide veut dire attribut absent. Le pipeline n'écrit
// jamais dans ces fichiers : le numéro et les crédits sont ajoutés au rendu, en mémoire.
const LONGUEUR_MAX_META = 1000;

function normaliserTexteAttribut(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[\r\n\t]+/g, ' ').trim().slice(0, LONGUEUR_MAX_META);
}

// Entités d'un attribut HTML -> texte. &amp; en dernier, sinon un « &quot; » littéral,
// écrit « &amp;quot; », serait décodé deux fois.
function decoderEntites(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&#0*39;/g, '\'')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function echapAttribut(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Normalise bornes et énumérations sans toucher à la structure. Les styles vivent au
// niveau du tableau : en-têtes de lignes (el, colonnes de gauche), en-têtes de colonnes
// (ec, rangées du haut), total, bordures, zébrage. Par cellule, seuls l'alignement et la
// mise en forme du contenu.
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

  // ⚠ Aucune fusion de l'en-tête ne doit dépasser dans le corps : les navigateurs bornent
  // un rowspan à sa section, si bien qu'un <thead> qui tronque une fusion décale la
  // rangée suivante d'une colonne. On réduit donc le compte d'en-tête jusqu'à ce
  // qu'aucune fusion ne dépasse, quitte à tomber à zéro ; l'en-tête se repose ensuite
  // d'un clic dans l'éditeur. Le contrôle est ici, passage obligé de tous les chemins.
  while (attrs.enteteLignes > 0 && fusionFranchitEntete(lignes, attrs.enteteLignes)) {
    attrs.enteteLignes--;
  }
  if (attrs.enteteLignes === 0) { attrs.ecGras = false; attrs.ecFond = 'aucun'; }

  return { attrs: attrs, lignes: lignes };
}

function finaliserModele(modele) {
  const m = normaliserModele(modele);
  reappliquerEntetes(m);
  return m;
}

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

// analyserTable(html) -> modèle. Tolère un corps de tableau sans <table> et ignore thead,
// tbody, col ainsi que le balisage accessible que serialiserTable régénère, ce qui rend
// l'aller-retour stable.
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
  // La légende est lue avant le retrait du <caption> : c'est elle que le pipeline
  // numérote et affiche, et l'import Word en pose déjà une.
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

// serialiserTable(modèle) -> un <table> stable : attributs data-* dans un ordre fixe et
// émis seulement s'ils sont signifiants, une balise par ligne pour rester lisible en diff.
//
// Le balisage d'accessibilité dépend de la complexité. Un tableau simple, d'au plus une
// rangée et une colonne d'en-tête sans fusion, reçoit scope="col" ou "row" ; un tableau
// complexe reçoit un id sur chaque en-tête, un headers="…" sur chaque cellule de données
// et scope="colgroup" ou "rowgroup" pour un en-tête de groupe. Tout est dérivé du modèle
// et dépouillé par analyserTable.
function serialiserTable(modele) {
  const m = normaliserModele(modele);
  const a = m.attrs;
  const eL = a.enteteLignes, eC = a.enteteColonnes;
  let ouv = '<table class="' + a.classe + '"';
  if (eL > 0) { ouv += ' data-entete-lignes="' + eL + '"'; }
  if (eC > 0) { ouv += ' data-entete-colonnes="' + eC + '"'; }
  // Accessibilité et crédits, au format arrêté avec le pipeline, émis seulement s'ils
  // portent une valeur. Pas de alt="" ici, un tableau décoratif n'existant pas.
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
  let complexe = eL >= 2 || eC >= 2;
  if (!complexe) {
    for (const lg of m.lignes) {
      for (const cell of lg.cellules) {
        if (cell.th && (cell.colspan > 1 || cell.rowspan > 1)) { complexe = true; break; }
      }
      if (complexe) { break; }
    }
  }
  // Forme à garder identique à celle de pipeline/docx-tables.py, qui écrit le même
  // balisage à l'import.
  const idTh = (li, c0) => 'szh-th-r' + li + 'c' + c0;

  const out = [ouv];
  if (a.legende !== '') { out.push('<caption>' + a.legende + '</caption>'); }
  const emettreRangee = (lg, r) => {
    out.push('<tr>');
    lg.cellules.forEach((cell, ci) => {
      const c0 = occ.positions[r][ci].c0;
      const tag = cell.th ? 'th' : 'td';
      let t = '<' + tag;
      if (cell.th) {
        const estColonne = r < eL;   // rangée du haut : en-tête de colonne, scope col
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

// ---- Opérations de structure, pures, de modèle à modèle ----

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

function deplacerColonne(modele, de, vers) {
  const g = etendreGrille(normaliserModele(modele));
  const nbC = g.grid.length ? g.grid[0].length : 0;
  de = Math.max(0, Math.min(de, nbC - 1)); vers = Math.max(0, Math.min(vers, nbC - 1));
  if (de === vers) { return compacterGrille(g); }
  for (let r = 0; r < g.grid.length; r++) { const cell = g.grid[r].splice(de, 1)[0]; g.grid[r].splice(vers, 0, cell); }
  if (!grilleRectangulaire(g.grid)) { return { erreur: 'table.deplacementImpossible' }; }
  return compacterGrille(g);
}

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

function tableauDepuisTsv(texte) {
  const s = String(texte === undefined || texte === null ? '' : texte).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const lignesTxt = s.split('\n');
  const lignes = lignesTxt.map((l) => ({
    cellules: l.split('\t').map((v) => ({ contenu: echapTexteBrut(v), colspan: 1, rowspan: 1, th: false, scope: '', align: 'left' }))
  }));
  return finaliserModele({ attrs: {}, lignes: lignes });
}

// ---- Presse-papiers HTML d'Excel ou de Word -> modèle ----
//
// Troisième entrée du modèle, après analyserTable et tableauDepuisTsv. La lecture du
// presse-papiers, elle, est impérative et reste dans lib/formatting.js.
//
// vscode.env.clipboard.readText() ne rend que du TSV, où les cellules fusionnées
// n'existent pas ; seule la variante HTML du presse-papiers Windows porte colspan et
// rowspan.

const ATTRS_CELLULE = ['colspan', 'rowspan', 'scope', 'data-align', 'id', 'headers'];

const BALISES_GARDEES = {
  table: 1, thead: 1, tbody: 1, tfoot: 1, tr: 1, td: 1, th: 1, caption: 1,
  br: 1, strong: 1, b: 1, em: 1, i: 1
};

function attributsRetenus(attrs, cles) {
  let t = '';
  cles.forEach((cle) => {
    if (attrs[cle] === undefined || attrs[cle] === '') { return; }
    t += ' ' + cle + '="' + String(attrs[cle]).replace(/"/g, '') + '"';
  });
  return t;
}

// CF_HTML -> fragment HTML. Les décalages annoncés par l'en-tête CF_HTML sont des
// positions en octets, inutilisables sur une chaîne JS déjà décodée : on se fie aux
// marqueurs <!--StartFragment--> et <!--EndFragment-->, présents chez Word comme chez
// Excel. Excel les place à l'intérieur du <table>, si bien que le fragment n'a pas de
// balise <table> — sans conséquence, analyserTable tolérant un corps de tableau nu.
function fragmentCfHtml(brut) {
  const s = String(brut === undefined || brut === null ? '' : brut)
    .replace(/\0/g, '')                              // la donnée CF_HTML se termine par un NUL
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

// HTML d'Excel ou de Word -> HTML de tableau minimal, digeste pour analyserTable. On jette
// les blocs sans contenu de tableau (îlots XML, conditionnels, <style>), on traduit les
// frontières de paragraphe en <br> pour que deux paragraphes d'une cellule ne se collent
// pas, puis on filtre balise par balise en gardant le texte. Sur du HTML canonique, ce
// nettoyage ne retire rien de signifiant, d'où son emploi aussi pour le collage dans
// l'éditeur de tableau.
function nettoyerHtmlBureautique(html) {
  let s = String(html === undefined || html === null ? '' : html);
  s = s.replace(/<!--[\s\S]*?-->/g, '');                          // commentaires (dont les îlots mso)
  // Conditionnels révélés : contenu jeté avec le bloc. Ils ne portent que des rustines de
  // mise en page, et Excel y range une rangée fantôme qui ajouterait une ligne vide à
  // chaque collage.
  s = s.replace(/<!\[if\b[^\]]*\]>[\s\S]*?<!\[endif\]\s*>/gi, '');
  s = s.replace(/<!\[if\b[^\]]*\]>/gi, '').replace(/<!\[endif\]\s*>/gi, '');   // marqueur orphelin
  s = s.replace(/<\?[\s\S]*?\?>/g, '');                           // <?xml:namespace … ?>
  s = s.replace(/<!doctype\b[^>]*>/gi, '');
  s = s.replace(/<(style|script|head|title|xml)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<\/(?:p|div|h[1-6])\s*>\s*<(?:p|div|h[1-6])\b[^>]*>/gi, '<br>');
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
      // Sur <table>, class et data-* portent tout le style du HTML canonique et doivent
      // traverser le nettoyage intacts.
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

// Word et Excel émettent des retours à la ligne, des indentations et des &nbsp; de mise en
// page : on ramène tout à des espaces simples et on retire les <br> de bord, pour qu'une
// cellule vide le soit vraiment. Une espace insécable voulue y perd, mais la typographie
// fine est posée à la compilation.
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

// Hauteur de l'en-tête déduite d'une première rangée toute en gras. Elle ne vaut pas
// toujours 1 : pour un en-tête à deux niveaux, Word émet une cellule à rowspan=2 à côté
// d'un groupe à colspan=2 qui se subdivise à la rangée suivante. La hauteur est donc le
// plus grand rowspan de la rangée 0, et la retenir évite qu'un <thead> d'une seule rangée
// tronque la fusion et décale la rangée suivante.
function hauteurEnteteGras(lignes) {
  let h = 1;
  for (const cell of lignes[0].cellules) { h = Math.max(h, Math.max(1, parseInt(cell.rowspan, 10) || 1)); }
  return h;
}

function fusionFranchitEntete(lignes, n) {
  for (let r = 0; r < n && r < lignes.length; r++) {
    for (const cell of lignes[r].cellules) {
      if (r + Math.max(1, parseInt(cell.rowspan, 10) || 1) > n) { return true; }
    }
  }
  return false;
}

// Presse-papiers HTML, brut ou fragment, -> modèle avec ses fusions ; null si la chaîne ne
// contient aucune cellule, l'appelant se repliant alors sur le TSV. Sans <th> ni compte
// d'en-tête, les rangées de tête sont promues si la première est toute en gras — Excel,
// qui met son gras dans une classe CSS, donne donc un tableau sans en-tête.
function tableauDepuisHtmlBureautique(html) {
  const propre = nettoyerHtmlBureautique(fragmentCfHtml(html));
  if (!/<t[dh]\b/i.test(propre)) { return null; }
  const m = analyserTable(propre);
  m.lignes = m.lignes.filter((lg) => lg.cellules.length > 0);      // <tr> sans cellule : artefact
  m.lignes.forEach((lg) => lg.cellules.forEach((c) => { c.contenu = nettoyerContenuCellule(c.contenu); }));
  m.attrs.legende = nettoyerContenuCellule(m.attrs.legende);       // mêmes blancs que les cellules
  if (m.attrs.enteteLignes === 0 && m.lignes.length >= 2 && ligneToutGras(m.lignes[0].cellules)) {
    const hauteur = hauteurEnteteGras(m.lignes);
    let n = Math.min(hauteur, 2);
    if (hauteur >= m.lignes.length) { n = 1; }
    // Si une fusion dépasse encore, aucun <thead> : mieux vaut un tableau sans en-tête
    // qu'une grille tronquée par le navigateur.
    if (fusionFranchitEntete(m.lignes, n)) { n = 0; }
    m.attrs.enteteLignes = n;
  }
  return finaliserModele(m);
}

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
    // Le HTML du presse-papiers de la webview est aussi sale que le CF_HTML et porte les
    // mêmes fusions : même nettoyage, avec repli sur le TSV.
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
  // ---- En-têtes et styles, encodés en data-* ----
  if (nom === 'entete') {
    if (a.sens === 'colonnes') { modele.attrs.enteteColonnes = Math.max(0, Math.min(2, n(a.n))); }
    else { modele.attrs.enteteLignes = Math.max(0, Math.min(2, n(a.n))); }
    return finaliserModele(modele);   // réapplique th et scope depuis les comptes
  }
  if (nom === 'enteteRetirer') {
    if (a.sens === 'lignes') { modele.attrs.enteteLignes = 0; }
    else if (a.sens === 'colonnes') { modele.attrs.enteteColonnes = 0; }
    else { modele.attrs.enteteLignes = 0; modele.attrs.enteteColonnes = 0; }
    return finaliserModele(modele);
  }
  if (nom === 'styleEntete') {
    const fond = enumOu(a.fond, FONDS, 'aucun');
    const gras = vrai(a.gras);
    if (a.cible === 'colonnes') { modele.attrs.ecGras = gras; modele.attrs.ecFond = fond; }
    else if (a.cible === 'total') { modele.attrs.totalGras = gras; modele.attrs.totalFond = fond; }
    else { modele.attrs.elGras = gras; modele.attrs.elFond = fond; }
    return finaliserModele(modele);
  }
  if (nom === 'preset') {
    // Un préréglage pose tous les styles d'un coup, donc un seul pas d'annulation : un
    // réglage par champ en empilerait une dizaine.
    const p = PRESETS_TABLE[String(a.nom || '')];
    if (p) {
      // Ne jamais toucher aux comptes d'en-tête : ils décrivent la structure, pas
      // l'habillage.
      Object.keys(p).forEach((champ) => { modele.attrs[champ] = p[champ]; });
    }
    return finaliserModele(modele);
  }
  // La légende, le texte alternatif, le copyright et la source n'ont pas d'opération :
  // saisis dans la webview, ils voyagent avec le modèle et sont assainis par
  // normaliserModele, sans re-rendu de la grille.
  //
  // Réglages du tableau : bordures et zébrage. Un seul champ par appel.
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
