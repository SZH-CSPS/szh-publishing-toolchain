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

module.exports = {
  lireAttributsHtml, canoniserInline, extraireCellules, enumOu,
  matriceOccupation, etendreGrille, compacterGrille, reappliquerEntetes,
  normaliserModele, finaliserModele, infererEnteteLignes, infererEnteteColonnes,
  analyserTable, serialiserTable, disposition,
  ajouterLigne, supprimerLigne, ajouterColonne, supprimerColonne,
  fusionner, scinder, viderCellules, appliquerOperationTable
};
