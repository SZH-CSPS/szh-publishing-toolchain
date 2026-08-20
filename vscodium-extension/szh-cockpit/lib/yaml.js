// SZH cockpit — sérialiseurs YAML (ausgabe / frontmatter / meta). Extrait de
// extension.js (R2, refactor sans build, comportement identique). YAML maison
// (pas de dépendance) : parseurs/sérialiseurs à préservation de commentaires, écriture
// atomique, lecteurs titreNumero/langueRevue. Aucune dépendance à vscode ni à i18n.
'use strict';

const fs = require('fs');
const path = require('path');

// ---- Méta-données du numéro (G1, D37) --------------------------------------------
//
// ausgabe.yaml est un YAML PLAT (clé: valeur, une par ligne). Pas de lib YAML :
// un sérialiseur maison qui ne touche QUE les lignes des clés du schéma D37 —
// toute autre ligne (commentaires, subtitle:, clés futures) est préservée
// byte pour byte, fins de ligne (LF/CRLF) et BOM compris.

const CLES_METADONNEES = ['title', 'revue', 'volume', 'numero', 'date', 'lang', 'couleur',
  'entete-condensee', 'locked', 'archived', 'version-toolkit'];

// Cycle de vie du numéro (D116) : deux drapeaux INDÉPENDANTS, écrits en booléens
// YAML nus comme `entete-condensee`.
//   locked   -> le numéro est GELÉ : éditeur en lecture seule, gestes d'écriture du
//               cockpit refusés. Se lève par « Déverrouiller la revue ».
//   archived -> le numéro vit dans l'arborescence d'ARCHIVES : plus aucune
//               compilation automatique, export à la demande seulement.
// Les deux se combinent librement (désarchiver ne déverrouille pas, et l'inverse).
const CLES_BOOLEENNES = ['entete-condensee', 'locked', 'archived'];

// « Condenser l'en-tête » (D114) : réglage du NUMÉRO, écrit en booléen YAML NU
// (`entete-condensee: true`). Valeurs vraies TOLÉRÉES à la lecture, un ausgabe.yaml
// pouvant avoir été écrit à la main : miroir exact de la table VRAIS de
// pipeline/filters/szh-maquette.lua, qui décide au rendu. Tout le reste = non condensé.
const VRAIS_YAML = ['true', '1', 'oui', 'ja', 'yes', 'si'];
function estVraiYaml(valeur) {
  if (valeur === true) { return true; }
  const v = String(valeur === undefined || valeur === null ? '' : valeur).trim().toLowerCase();
  return VRAIS_YAML.indexOf(v) !== -1;
}

// Couleur annuelle du numéro (M7, D56) : palette figée, stockée en hex dans
// ausgabe.yaml (clé plate `couleur`, citée). Libellés traduits via T().
const COULEURS_NUMERO = [
  { cle: 'rouge',       hex: '#D31932' },
  { cle: 'capucine',    hex: '#EB5E51' },
  { cle: 'moutarde',    hex: '#C7CF1C' },
  { cle: 'poireau',     hex: '#51A66D' },
  { cle: 'bleuacier',   hex: '#5F9FBC' },
  { cle: 'mountbatten', hex: '#A98899' }
];
const HEX_COULEURS = COULEURS_NUMERO.map((c) => c.hex.toUpperCase());

// Revue (D74) : jeton canonique -> ISSN + langue par défaut, TOUS DÉRIVÉS (jamais
// stockés séparément dans ausgabe.yaml). Miroir exact de derive_revue() de
// pipeline/filters/szh-maquette.lua. Le nom affiché de la revue vit côté i18n
// (meta.revue.<jeton>) ; ici on ne garde que ce que le code doit calculer.
const REVUES = [
  { cle: 'zeitschrift', issn: '2813-4907', langue: 'de' },
  { cle: 'revue',       issn: '2813-4915', langue: 'fr' }
];

// Jeton canonique de revue depuis une valeur brute d'ausgabe.yaml : accepte le
// jeton (zeitschrift/revue) ET l'ancien nom complet (rétrocompat). Teste
// « zeitschrift » avant « revue » (comme le Lua). '' si rien d'exploitable.
function normaliserRevue(valeur) {
  const v = String(valeur === undefined || valeur === null ? '' : valeur).toLowerCase();
  if (v.indexOf('zeitschrift') !== -1) { return 'zeitschrift'; }
  if (v.indexOf('revue') !== -1) { return 'revue'; }
  return '';
}

// Découpe la partie droite d'un « clé: reste » en { valeur, suite } — `suite` est
// l'éventuel commentaire de fin de ligne, AVEC ses espaces de tête, restitué tel
// quel à l'écriture. Gère les scalaires nus, « … » (échappes \" et \\) et '…'
// (échappe ''). Un droit malformé est traité comme scalaire nu (best effort).
function decouperValeurYaml(reste) {
  reste = String(reste);
  if (reste.startsWith('"')) {
    let i = 1, fin = -1;
    while (i < reste.length) {
      if (reste[i] === '\\') { i += 2; continue; }
      if (reste[i] === '"') { fin = i; break; }
      i++;
    }
    if (fin !== -1 && /^\s*(#.*)?$/.test(reste.slice(fin + 1))) {
      return {
        valeur: reste.slice(1, fin).replace(/\\(["\\])/g, '$1'),
        suite: reste.slice(fin + 1).replace(/\s+$/, '')
      };
    }
  } else if (reste.startsWith("'")) {
    const m = reste.match(/^'((?:[^']|'')*)'(\s*(?:#.*)?)$/);
    if (m) { return { valeur: m[1].replace(/''/g, "'"), suite: m[2].replace(/\s+$/, '') }; }
  }
  // Scalaire nu : le commentaire commence à « espace(s) + # » (ou « # » en tête) ;
  // toute la plage d'espaces fait partie de `suite` (alignement restitué tel quel).
  let debutComm = -1;
  if (reste.startsWith('#')) { debutComm = 0; }
  else {
    const m = reste.match(/\s+#/);
    if (m) { debutComm = m.index; }
  }
  if (debutComm === -1) { return { valeur: reste.trim(), suite: '' }; }
  return { valeur: reste.slice(0, debutComm).trim(), suite: reste.slice(debutComm).replace(/\s+$/, '') };
}

// Valeurs du schéma D37 actuellement dans le fichier (clés absentes : non définies).
function analyserAusgabe(contenu) {
  const valeurs = {};
  for (const ligne of contenu.split(/\r?\n/)) {
    const m = ligne.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m || CLES_METADONNEES.indexOf(m[1]) === -1) { continue; }
    if (!(m[1] in valeurs)) { valeurs[m[1]] = decouperValeurYaml(m[2]).valeur; }
  }
  return valeurs;
}

// ---- Frontmatter d'article (N7, D48) -----------------------------------------------
//
// Les métadonnées d'un article vivent dans le frontmatter YAML de son <slug>.md
// (créé s'il manque). Clés gérées : title, subtitle, author (liste structurée
// name/affiliation/orcid), doi, keywords (liste). Tout le reste — corps de
// l'article, clés inconnues, commentaires — est préservé VERBATIM (risque R1).

const CLES_FRONTMATTER = ['title', 'subtitle', 'author', 'doi', 'keywords'];

// Découpe un article : { bom, fm, corps, eol }. Le frontmatter n'existe que si la
// PREMIÈRE ligne du fichier est exactement « --- » ; il se ferme à la première
// ligne « --- » ou « ... ». Un « --- » plus loin dans le corps (règle horizontale)
// n'est JAMAIS pris pour une borne. `fm` = texte brut entre les bornes (null si
// absent) ; `corps` = tout le reste, restitué tel quel.
function separerFrontmatter(texte) {
  texte = String(texte);
  const bom = texte.charAt(0) === '\uFEFF' ? '\uFEFF' : '';
  const sansBom = bom ? texte.slice(1) : texte;
  const eol = sansBom.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
  const finLigne1 = sansBom.search(/\r?\n/);
  const ligne1 = finLigne1 === -1 ? sansBom : sansBom.slice(0, finLigne1);
  if (finLigne1 === -1 || !/^---\s*$/.test(ligne1)) {
    return { bom: bom, fm: null, corps: sansBom, eol: eol };
  }
  const debutFm = finLigne1 + (sansBom.charAt(finLigne1) === '\r' ? 2 : 1);
  let position = debutFm;
  while (position <= sansBom.length) {
    const finLigne = sansBom.indexOf('\n', position);
    const finBrute = finLigne === -1 ? sansBom.length : finLigne;
    let ligne = sansBom.slice(position, finBrute);
    if (ligne.charAt(ligne.length - 1) === '\r') { ligne = ligne.slice(0, -1); }
    if (/^(---|\.\.\.)\s*$/.test(ligne)) {
      const fm = sansBom.slice(debutFm, position).replace(/\r?\n$/, '');
      const corps = finLigne === -1 ? '' : sansBom.slice(finLigne + 1);
      return { bom: bom, fm: fm, corps: corps, eol: eol };
    }
    if (finLigne === -1) { break; }
    position = finLigne + 1;
  }
  return { bom: bom, fm: null, corps: sansBom, eol: eol };  // borne jamais fermée
}

// Valeurs des clés gérées d'un frontmatter (best effort sur l'existant).
// author accepte : scalaire (« author: Jean ») -> [{name}], liste de scalaires,
// liste de mappings (name/affiliation/orcid). keywords accepte : scalaire,
// flow ([a, b]) et liste « - mot ».
// Découpe l'intérieur d'une liste flow « [a, "b, c", d] » sur les virgules HORS
// guillemets (échappes \" et '' respectées).
function decouperFlowYaml(interieur) {
  const morceaux = [];
  let courant = '';
  let guillemet = null;
  for (let j = 0; j < interieur.length; j++) {
    const c = interieur.charAt(j);
    if (guillemet !== null) {
      courant += c;
      if (guillemet === '"' && c === '\\') { courant += interieur.charAt(j + 1); j++; continue; }
      if (c === guillemet) {
        if (guillemet === "'" && interieur.charAt(j + 1) === "'") { courant += "'"; j++; continue; }
        guillemet = null;
      }
      continue;
    }
    if (c === '"' || c === "'") { guillemet = c; courant += c; continue; }
    if (c === ',') { morceaux.push(courant); courant = ''; continue; }
    courant += c;
  }
  if (courant.trim() !== '') { morceaux.push(courant); }
  return morceaux;
}

function analyserFrontmatter(fm) {
  const valeurs = {};
  if (fm === null || fm === undefined) { return valeurs; }
  const lignes = String(fm).split(/\r?\n/);
  let i = 0;
  while (i < lignes.length) {
    const m = lignes[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const cle = m[1];
    const reste = m[2];
    if (cle === 'author') {
      const auteurs = [];
      const net = reste.trim();
      if (net !== '' && net.charAt(0) !== '#') {
        auteurs.push({ name: decouperValeurYaml(reste).valeur });
        i++;
      } else {
        i++;
        let courant = null;
        while (i < lignes.length && !/^[A-Za-z0-9_-]+:/.test(lignes[i])) {
          const item = lignes[i].match(/^\s*-\s*(.*)$/);
          const champ = lignes[i].match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
          if (item) {
            courant = {};
            auteurs.push(courant);
            const interne = item[1].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
            if (interne) { courant[interne[1]] = decouperValeurYaml(interne[2]).valeur; }
            else if (item[1].trim() !== '') { courant.name = decouperValeurYaml(item[1]).valeur; }
          } else if (champ && courant) {
            courant[champ[1]] = decouperValeurYaml(champ[2]).valeur;
          }
          i++;
        }
      }
      valeurs.author = auteurs
        .map((a) => ({
          name: String(a.name || ''), affiliation: String(a.affiliation || ''), orcid: String(a.orcid || '')
        }))
        .filter((a) => a.name !== '' || a.affiliation !== '' || a.orcid !== '');
      continue;
    }
    if (cle === 'keywords') {
      const mots = [];
      const net = reste.trim();
      if (net.charAt(0) === '[') {
        for (const morceau of decouperFlowYaml(net.replace(/^\[/, '').replace(/\]\s*$/, ''))) {
          const v = decouperValeurYaml(morceau.trim()).valeur;
          if (v !== '') { mots.push(v); }
        }
        i++;
      } else if (net !== '' && net.charAt(0) !== '#') {
        mots.push(decouperValeurYaml(net).valeur);
        i++;
      } else {
        i++;
        while (i < lignes.length && !/^[A-Za-z0-9_-]+:/.test(lignes[i])) {
          const item = lignes[i].match(/^\s*-\s*(.*)$/);
          if (item) {
            const v = decouperValeurYaml(item[1]).valeur;
            if (v !== '') { mots.push(v); }
          }
          i++;
        }
      }
      valeurs.keywords = mots;
      continue;
    }
    if (CLES_FRONTMATTER.indexOf(cle) !== -1 && !(cle in valeurs)) {
      valeurs[cle] = decouperValeurYaml(reste).valeur;
    }
    i++;
  }
  return valeurs;
}

function citerFrontmatter(valeur) {
  return '"' + String(valeur).replace(/([\\"])/g, '\\$1') + '"';
}

// Lignes canoniques d'une clé gérée. [] si la valeur est « vide » -> la clé est
// RETIRÉE du frontmatter (pas de clé fantôme « "" » côté pandoc).
function lignesCleFrontmatter(cle, valeur) {
  if (cle === 'author') {
    const auteurs = (Array.isArray(valeur) ? valeur : [])
      .map((a) => ({
        name: String((a && a.name) || '').trim(),
        affiliation: String((a && a.affiliation) || '').trim(),
        orcid: String((a && a.orcid) || '').trim()
      }))
      .filter((a) => a.name !== '' || a.affiliation !== '' || a.orcid !== '');
    if (auteurs.length === 0) { return []; }
    const lignes = ['author:'];
    for (const a of auteurs) {
      let premiere = true;
      for (const champ of ['name', 'affiliation', 'orcid']) {
        if (a[champ] === '') { continue; }
        lignes.push((premiere ? '- ' : '  ') + champ + ': ' + citerFrontmatter(a[champ]));
        premiere = false;
      }
    }
    return lignes;
  }
  if (cle === 'keywords') {
    const mots = (Array.isArray(valeur) ? valeur : [])
      .map((v) => String(v).trim())
      .filter((v) => v !== '');
    if (mots.length === 0) { return []; }
    return ['keywords:'].concat(mots.map((v) => '- ' + citerFrontmatter(v)));
  }
  const v = String(valeur === undefined || valeur === null ? '' : valeur).trim();
  if (v === '') { return []; }
  return [cle + ': ' + citerFrontmatter(v)];
}

// Réécrit le document : les clés gérées de `modifies` sont régénérées EN PLACE
// (à la position de leur première occurrence), les clés absentes sont ajoutées en
// fin de frontmatter (ordre D48), les lignes inconnues (clés libres, commentaires,
// vides) sont restituées telles quelles et le CORPS n'est jamais touché. Crée le
// bloc s'il manque ; le supprime s'il devient vide. BOM/CRLF préservés.
function serialiserFrontmatter(texte, modifies) {
  const partie = separerFrontmatter(texte);
  const fmLignes = (partie.fm === null || partie.fm === '') ? [] : partie.fm.split(/\r?\n/);
  const segments = [];
  for (const ligne of fmLignes) {
    const cle = (ligne.match(/^([A-Za-z0-9_-]+):/) || [])[1];
    if (cle) { segments.push({ cle: cle, lignes: [ligne] }); continue; }
    const dernier = segments[segments.length - 1];
    // Continuation d'une clé : ligne indentée ou item de liste « - … ».
    if (dernier && dernier.cle && (/^\s+\S/.test(ligne) || /^\s*-\s/.test(ligne))) {
      dernier.lignes.push(ligne);
    } else {
      segments.push({ cle: null, lignes: [ligne] });
    }
  }
  const restantes = new Set(
    Object.keys(modifies).filter((c) => CLES_FRONTMATTER.indexOf(c) !== -1)
  );
  const sortie = [];
  for (const s of segments) {
    if (s.cle && restantes.has(s.cle)) {
      restantes.delete(s.cle);
      const nouvelles = lignesCleFrontmatter(s.cle, modifies[s.cle]);
      for (const l of nouvelles) { sortie.push(l); }
    } else {
      for (const l of s.lignes) { sortie.push(l); }
    }
  }
  for (const cle of CLES_FRONTMATTER) {
    if (!restantes.has(cle)) { continue; }
    const nouvelles = lignesCleFrontmatter(cle, modifies[cle]);
    for (const l of nouvelles) { sortie.push(l); }
  }
  if (sortie.length === 0) { return partie.bom + partie.corps; }  // plus de frontmatter
  const eol = partie.eol;
  return partie.bom + '---' + eol + sortie.join(eol) + eol + '---' + eol + partie.corps;
}

// ---- Métadonnées d'article : fichier caché <slug>.meta.yaml (M1, D49/D51) ----------
//
// SUPERSEDE le stockage frontmatter de N7 : le .md ne contient QUE le texte ; les
// métadonnées vivent dans articles/<slug>/<slug>.meta.yaml (masqué par
// files.exclude, édité UNIQUEMENT par le formulaire). Fichier « form-owned » :
// régénéré à chaque enregistrement — les clés inconnues de haut niveau sont
// restituées par prudence. Lu par pandoc via --metadata-file (après ausgabe.yaml :
// l'article surcharge le numéro).

// 6 types d'article (D71) en 2 groupes : « liés au dossier » (le libellé affiché
// sera le titre du dossier) puis « hors dossier » (libellé = nom du type). Ordre
// dossier-first, aligné sur szh-maquette.lua (TYPES_DOSSIER / LIBELLES).
const TYPES_DOSSIER = ['article', 'editorial', 'interview'];
const TYPES_HORS = ['varia', 'tribune-libre', 'documentation'];
const TYPES_ARTICLE = TYPES_DOSSIER.concat(TYPES_HORS);
// Libellés traduits des types (DE/IT : premier jet à valider par Robin).
const LIBELLES_TYPES = {
  'article':       { fr: 'Article',       de: 'Artikel',       it: 'Articolo' },
  'editorial':     { fr: 'Éditorial',     de: 'Editorial',     it: 'Editoriale' },
  'interview':     { fr: 'Interview',     de: 'Interview',     it: 'Intervista' },
  'varia':         { fr: 'Varia',         de: 'Varia',         it: 'Varia' },
  'tribune-libre': { fr: 'Tribune libre', de: 'Freie Tribüne',  it: 'Tribuna libera' },
  'documentation': { fr: 'Documentation', de: 'Dokumentation', it: 'Documentazione' }
};
// En-têtes des 2 groupes du menu « Type d'article » (parité fr=de ; DE premier
// jet). Localisés dans la langue par défaut du numéro, comme les libellés de type.
const GROUPES_TYPES = {
  dossier: { fr: 'Liés au dossier thématique', de: 'Zum Themenschwerpunkt gehörend', it: 'Legati al dossier tematico' },
  hors:    { fr: 'Hors dossier',               de: 'Ausserhalb des Schwerpunkts',     it: 'Fuori dossier' }
};
const LANGUES_META = ['fr', 'de', 'it'];   // fr + de affichées ; it activable par carte
// Champs auteur (D91/D92) : prenom/nom + fonction/affiliation/orcid/email/photo
// optionnels. `photo` = chemin RELATIF à l'article vers la version choisie
// (portraits/<slug-auteur>.original.<ext> | .avec-fond.png | .sans-fond.png),
// posé par la modale photo du cockpit — jamais saisi au clavier. Cet ordre est
// l'ordre canonique de sérialisation : analyserMeta/serialiserMeta itèrent cette
// constante, l'étendre ici suffit aux deux.
const CHAMPS_AUTEUR = ['prenom', 'nom', 'fonction', 'affiliation', 'orcid', 'email', 'photo'];

// Langue par défaut du numéro (D74), PURE : dérivée du choix de revue
// (zeitschrift -> de, revue -> fr) ; à défaut de revue exploitable, la clé `lang`
// (rétrocompat, « de-CH » -> « de ») ; à défaut, fr. `valeurs` = sortie
// d'analyserAusgabe. Pilote la langue affichée EN PREMIER dans les formulaires (E3).
function langueDefaut(valeurs) {
  const revue = normaliserRevue((valeurs && valeurs.revue) || '');
  if (revue) {
    for (const r of REVUES) { if (r.cle === revue) { return r.langue; } }
  }
  const base = String((valeurs && valeurs.lang) || 'fr').toLowerCase().slice(0, 2);
  return LANGUES_META.indexOf(base) !== -1 ? base : 'fr';
}

// Langue par défaut du numéro depuis le disque (repli fr si ausgabe.yaml illisible).
function langueRevue(racine) {
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* illisible : repli fr via langueDefaut({}) */ }
  return langueDefaut(valeurs);
}

// analyserMeta(texte) -> { type, doi, title:{}, subtitle:{}, resume:{}, keywords:{},
// author:[], _inconnues:[lignes brutes] }. Best effort : maps par langue en bloc OU
// en flow ({ fr: "…" }), listes en bloc OU en flow, auteurs en mappings.
function analyserMeta(texte) {
  const valeurs = { type: '', doi: '', title: {}, subtitle: {}, resume: {}, keywords: {}, author: [], _inconnues: [] };
  if (!texte) { return valeurs; }
  const lignes = String(texte).split(/\r?\n/);
  let i = 0;
  while (i < lignes.length) {
    const m = lignes[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) {
      if (lignes[i].trim() !== '' && lignes[i].trim().charAt(0) !== '#') { valeurs._inconnues.push(lignes[i]); }
      i++;
      continue;
    }
    const cle = m[1];
    const reste = m[2];
    if (cle === 'type') { valeurs.type = decouperValeurYaml(reste).valeur; i++; continue; }
    if (cle === 'doi') { valeurs.doi = decouperValeurYaml(reste).valeur; i++; continue; }
    if (cle === 'title' || cle === 'subtitle' || cle === 'resume') {
      const map = {};
      const net = reste.trim();
      if (net.charAt(0) === '{') {
        for (const partie of decouperFlowYaml(net.replace(/^\{/, '').replace(/\}\s*$/, ''))) {
          const mm = partie.match(/^\s*([A-Za-z-]+)\s*:\s*(.*)$/);
          if (mm) { map[mm[1]] = decouperValeurYaml(mm[2].trim()).valeur; }
        }
        i++;
      } else {
        i++;
        while (i < lignes.length && /^\s+\S/.test(lignes[i])) {
          const mm = lignes[i].match(/^\s+([A-Za-z-]+):\s*(.*)$/);
          if (mm) { map[mm[1]] = decouperValeurYaml(mm[2]).valeur; }
          i++;
        }
      }
      valeurs[cle] = map;
      continue;
    }
    if (cle === 'keywords') {
      const map = {};
      let langue = null;
      i++;
      while (i < lignes.length && /^\s+\S/.test(lignes[i])) {
        const mItem = lignes[i].match(/^\s+-\s*(.*)$/);
        const mLang = mItem ? null : lignes[i].match(/^\s+([A-Za-z-]+):\s*(.*)$/);
        if (mLang) {
          langue = mLang[1];
          map[langue] = map[langue] || [];
          const netL = mLang[2].trim();
          if (netL.charAt(0) === '[') {
            for (const p of decouperFlowYaml(netL.replace(/^\[/, '').replace(/\]\s*$/, ''))) {
              const v = decouperValeurYaml(p.trim()).valeur;
              if (v !== '') { map[langue].push(v); }
            }
          }
        } else if (mItem && langue) {
          const v = decouperValeurYaml(mItem[1]).valeur;
          if (v !== '') { map[langue].push(v); }
        }
        i++;
      }
      valeurs.keywords = map;
      continue;
    }
    if (cle === 'author') {
      const auteurs = [];
      let courant = null;
      i++;
      while (i < lignes.length && !/^[A-Za-z0-9_-]+:/.test(lignes[i])) {
        const item = lignes[i].match(/^\s*-\s*(.*)$/);
        const champ = item ? null : lignes[i].match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
        if (item) {
          courant = {};
          auteurs.push(courant);
          const interne = item[1].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
          if (interne) { courant[interne[1]] = decouperValeurYaml(interne[2]).valeur; }
          else if (item[1].trim() !== '') { courant.nom = decouperValeurYaml(item[1]).valeur; }
        } else if (champ && courant) {
          courant[champ[1]] = decouperValeurYaml(champ[2]).valeur;
        }
        i++;
      }
      valeurs.author = auteurs
        .map((a) => {
          const propre = {};
          for (const c of CHAMPS_AUTEUR) { propre[c] = String(a[c] || ''); }
          return propre;
        })
        .filter((a) => CHAMPS_AUTEUR.some((c) => a[c] !== ''));
      continue;
    }
    // Clé inconnue de haut niveau : sa ligne + ses continuations, restituées telles quelles.
    valeurs._inconnues.push(lignes[i]);
    i++;
    while (i < lignes.length && (/^\s+\S/.test(lignes[i]) || /^\s*-\s/.test(lignes[i]))) {
      valeurs._inconnues.push(lignes[i]);
      i++;
    }
  }
  return valeurs;
}

// serialiserMeta(valeurs) -> YAML régénéré (ordre D51 : type, doi, title, subtitle,
// resume, keywords, author, puis clés inconnues). Valeurs vides omises ; langue sans
// contenu omise ; auteur entièrement vide ignoré. LF, fin de fichier à la ligne.
function serialiserMeta(valeurs) {
  const v = valeurs || {};
  const lignes = [];
  const type = String(v.type || '').trim();
  if (TYPES_ARTICLE.indexOf(type) !== -1) { lignes.push('type: ' + type); }
  const doi = String(v.doi || '').trim();
  if (doi !== '') { lignes.push('doi: ' + citerFrontmatter(doi)); }
  for (const cle of ['title', 'subtitle', 'resume']) {
    const map = v[cle] || {};
    const sous = [];
    for (const l of LANGUES_META) {
      const t = String(map[l] || '').trim();
      if (t !== '') { sous.push('  ' + l + ': ' + citerFrontmatter(t)); }
    }
    if (sous.length > 0) {
      lignes.push(cle + ':');
      for (const s of sous) { lignes.push(s); }
    }
  }
  const km = v.keywords || {};
  const sousMots = [];
  for (const l of LANGUES_META) {
    const liste = (Array.isArray(km[l]) ? km[l] : []).map((x) => String(x).trim()).filter((x) => x !== '');
    if (liste.length > 0) {
      sousMots.push('  ' + l + ':');
      for (const mot of liste) { sousMots.push('  - ' + citerFrontmatter(mot)); }
    }
  }
  if (sousMots.length > 0) {
    lignes.push('keywords:');
    for (const s of sousMots) { lignes.push(s); }
  }
  const auteurs = (Array.isArray(v.author) ? v.author : [])
    .map((a) => {
      const propre = {};
      for (const c of CHAMPS_AUTEUR) { propre[c] = String((a && a[c]) || '').trim(); }
      return propre;
    })
    .filter((a) => CHAMPS_AUTEUR.some((c) => a[c] !== ''));
  if (auteurs.length > 0) {
    lignes.push('author:');
    for (const a of auteurs) {
      let premiere = true;
      for (const c of CHAMPS_AUTEUR) {
        if (a[c] === '') { continue; }
        lignes.push((premiere ? '- ' : '  ') + c + ': ' + citerFrontmatter(a[c]));
        premiere = false;
      }
    }
  }
  for (const brute of (Array.isArray(v._inconnues) ? v._inconnues : [])) { lignes.push(brute); }
  return lignes.length > 0 ? lignes.join('\n') + '\n' : '';
}

// ---- Titre de la vue (N2, D43) -----------------------------------------------------
//
// « {Z|R}{AAAA}-{numero} | {title} » : Z pour une revue allemande, R sinon — la
// langue par défaut vient du choix de revue (D74), avec repli sur `lang` ; AAAA =
// première séquence de 4 chiffres de `date` ; chaque morceau manquant est omis (le
// préfixe seul ne compte pas). Si rien n'est exploitable -> nom du dossier de la
// revue. Jamais de titre vide.
function titreNumero(racine) {
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* illisible : replis ci-dessous */ }
  const prefixe = langueDefaut(valeurs) === 'de' ? 'Z' : 'R';
  const annee = (String(valeurs.date || '').match(/\d{4}/) || [''])[0];
  const numero = String(valeurs.numero || '').trim();
  const titre = String(valeurs.title || '').trim();
  const morceaux = [];
  if (annee || numero) { morceaux.push(prefixe + annee + (numero ? '-' + numero : '')); }
  if (titre) { morceaux.push(titre); }
  if (morceaux.length === 0) { return path.basename(racine); }
  return morceaux.join(' | ');
}

// ---- Cycle de vie du numéro (D116/D117, version D120) ------------------------------
//
// Source de vérité UNIQUE de l'état d'un numéro : ausgabe.yaml. Rien n'est mémorisé
// côté éditeur ni côté poste — un numéro archivé sur OneDrive est archivé pour tout
// le monde, et le dossier reste lisible sans le toolkit.
//   verrouillee    : `locked: true`   -> gelé (lecture seule, écritures refusées)
//   archivee       : `archived: true`  -> dans les archives, aucune compilation auto
//   versionToolkit : `version-toolkit` -> version du logiciel qui a créé le numéro
//                    ('' si le numéro est antérieur à D120 : on ne l'invente pas,
//                    et aucun avertissement de divergence n'est alors affiché)
// Fichier illisible ou absent -> état neutre (un dossier quelconque n'est pas gelé).
function etatRevue(racine) {
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* illisible : état neutre ci-dessous */ }
  return {
    verrouillee: estVraiYaml(valeurs.locked),
    archivee: estVraiYaml(valeurs.archived),
    versionToolkit: String(valeurs['version-toolkit'] || '').trim()
  };
}

// Représentation YAML d'une valeur du formulaire. Tout est cité « "…" » (sûr pour
// deux-points, dièses, guillemets, accents), SAUF `lang` : le Makefile lit cette
// clé avec un sed qui ne comprend pas les guillemets (LANG_LUE) → jeton nu,
// restreint à [a-zA-Z-] (le formulaire ne propose que fr/de/en/it).
function formaterValeurYaml(cle, valeur) {
  if (cle === 'lang') { return String(valeur).replace(/[^a-zA-Z-]/g, '') || 'fr'; }
  // Drapeaux booléens (entete-condensee D114, locked/archived D116) : booléen YAML
  // NU, jamais cité. Une chaîne « "false" » serait VRAIE pour le `$if()$` du gabarit
  // pandoc — szh-maquette.lua sait la normaliser, mais le fichier que NOUS écrivons
  // doit être juste sans ce filet.
  if (CLES_BOOLEENNES.indexOf(cle) !== -1) { return estVraiYaml(valeur) ? 'true' : 'false'; }
  return '"' + String(valeur).replace(/([\\"])/g, '\\$1') + '"';
}

// Réécrit `contenu` avec les clés de `modifies` : lignes existantes mises à jour
// (commentaire de fin conservé), clés absentes ajoutées en fin de fichier (ordre
// D37, sauf valeur vide : rien à ajouter). Aucune autre ligne n'est modifiée.
function serialiserAusgabe(contenu, modifies) {
  const eol = contenu.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
  const bom = contenu.charAt(0) === '\uFEFF' ? '\uFEFF' : '';
  const corps = bom ? contenu.slice(1) : contenu;
  const lignes = corps === '' ? [] : corps.split(/\r?\n/);
  if (lignes.length > 0 && lignes[lignes.length - 1] === '') { lignes.pop(); }
  const restantes = new Set(Object.keys(modifies));
  const resultat = lignes.map((ligne) => {
    const m = ligne.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m || !restantes.has(m[1])) { return ligne; }
    restantes.delete(m[1]);
    // `suite` garde ses espaces de tête (restitution telle quelle de l'alignement
    // du commentaire) ; s'il colle à la valeur (droit « "x"# c »), on intercale un espace.
    const suite = decouperValeurYaml(m[2]).suite;
    return m[1] + ': ' + formaterValeurYaml(m[1], modifies[m[1]]) + (suite ? (/^\s/.test(suite) ? suite : ' ' + suite) : '');
  });
  for (const cle of CLES_METADONNEES) {
    if (!restantes.has(cle)) { continue; }
    if (String(modifies[cle]) === '') { continue; }
    resultat.push(cle + ': ' + formaterValeurYaml(cle, modifies[cle]));
  }
  return bom + resultat.join(eol) + (resultat.length > 0 ? eol : '');
}

// Écriture atomique de n'importe quel fichier de la revue (ausgabe.yaml, .meta.yaml,
// .md, tableau) : temporaire « ~$… » dans le même dossier — préfixe ignoré par la
// synchro OneDrive — puis rename. Jamais de fichier à moitié écrit, même si
// l'éditeur est fermé en plein enregistrement.
function ecrireAtomique(chemin, contenu) {
  const tmp = path.join(path.dirname(chemin), '~$' + path.basename(chemin));
  try {
    fs.writeFileSync(tmp, contenu, 'utf8');
    fs.renameSync(tmp, chemin);
  } finally {
    try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (e) { /* déjà renommé */ }
  }
}

module.exports = {
  CLES_METADONNEES, CLES_BOOLEENNES, COULEURS_NUMERO, HEX_COULEURS, CLES_FRONTMATTER, estVraiYaml,
  etatRevue,
  REVUES, normaliserRevue,
  TYPES_ARTICLE, TYPES_DOSSIER, TYPES_HORS, LIBELLES_TYPES, GROUPES_TYPES, LANGUES_META, CHAMPS_AUTEUR,
  decouperValeurYaml, decouperFlowYaml, analyserAusgabe,
  separerFrontmatter, analyserFrontmatter, citerFrontmatter, lignesCleFrontmatter, serialiserFrontmatter,
  langueDefaut, langueRevue, analyserMeta, serialiserMeta, titreNumero,
  formaterValeurYaml, serialiserAusgabe, ecrireAtomique
};
