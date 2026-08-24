// Lecture et écriture des YAML de la revue : ausgabe.yaml, frontmatter d'article et
// fiches <slug>.meta.yaml. Parseurs et sérialiseurs maison, sans dépendance, qui
// préservent les commentaires, plus l'écriture atomique.
'use strict';

const fs = require('fs');
const path = require('path');

// ---- Métadonnées du numéro ----
//
// ausgabe.yaml est un YAML plat, une clé par ligne. Le sérialiseur maison ne touche que
// les lignes des clés connues ; toute autre ligne — commentaire, clé future — est
// préservée telle quelle, fins de ligne et BOM compris.

const CLES_METADONNEES = ['title', 'revue', 'volume', 'numero', 'date', 'lang', 'couleur',
  'entete-condensee', 'locked', 'archived', 'version-toolkit', 'ordre-articles',
  'articles-sans-doi'];

// Les articles du numéro qui ne reçoivent pas de DOI, décidés à la case sur leur carte.
// Ils vivent ici, à côté de l'ordre, et non dans la fiche de l'article : c'est cette liste
// qui les range en fin de numéro, et le rang décide du DOI. Une seule ligne dit donc
// comment tout le numéro est numéroté, et elle se relit à la main.
const CLE_SANS_DOI = 'articles-sans-doi';

// Clés qui portent une liste et non un scalaire. `ordre-articles` retient l'ordre des
// articles dans le numéro : il vit ici, avec le reste de ce qui décrit le numéro, et non
// dans les noms de dossier — déplacer un article ne doit renommer ni dossier ni .md, sans
// quoi tout out/ serait à recompiler et les liens du numéro tomberaient. Écrite en
// séquence en ligne, la clé se relit et se corrige à la main, et elle voyage avec le
// dossier comme le reste d'ausgabe.yaml. lib/articles.js la lit et la répare.
const CLES_LISTES = ['ordre-articles', CLE_SANS_DOI];

// Les jetons d'une séquence en ligne, telle que `ordre-articles` et `articles-sans-doi`
// l'écrivent : `["a", "b"]` comme le sérialiseur la pose, ou une simple suite séparée par
// des virgules ou des espaces, ce qu'une correction à la main donne. Doublons et jetons
// vides partent ; ce qu'est un jeton VALIDE est jugé par l'appelant, seul à savoir ce
// qu'il attend. Un seul lecteur pour les deux clés : deux se seraient mis à diverger.
function listeYamlEnLigne(valeur) {
  const brut = Array.isArray(valeur)
    ? valeur.join(' ')
    : String(valeur === undefined || valeur === null ? '' : valeur);
  const interieur = brut.trim().replace(/^\[/, '').replace(/\]$/, '');
  const liste = [];
  for (const morceau of interieur.split(/[,\s]+/)) {
    const v = decouperValeurYaml(morceau.trim()).valeur.trim();
    if (v === '' || liste.indexOf(v) !== -1) { continue; }
    liste.push(v);
  }
  return liste;
}

// Deux drapeaux indépendants, écrits en booléens YAML nus : `locked` gèle le numéro
// (éditeur en lecture seule, écritures du cockpit refusées) et `archived` le range dans
// l'arborescence d'archives (plus de compilation automatique). Désarchiver ne
// déverrouille pas, et l'inverse.
const CLES_BOOLEENNES = ['entete-condensee', 'locked', 'archived'];

// Valeurs acceptées comme vraies à la lecture, un ausgabe.yaml pouvant avoir été écrit à
// la main. Miroir de la table VRAIS de pipeline/filters/szh-maquette.lua, qui décide au
// rendu ; tout le reste est faux.
const VRAIS_YAML = ['true', '1', 'oui', 'ja', 'yes', 'si'];
function estVraiYaml(valeur) {
  if (valeur === true) { return true; }
  const v = String(valeur === undefined || valeur === null ? '' : valeur).trim().toLowerCase();
  return VRAIS_YAML.indexOf(v) !== -1;
}

const COULEURS_NUMERO = [
  { cle: 'rouge',       hex: '#D31932' },
  { cle: 'capucine',    hex: '#EB5E51' },
  { cle: 'moutarde',    hex: '#C7CF1C' },
  { cle: 'poireau',     hex: '#51A66D' },
  { cle: 'bleuacier',   hex: '#5F9FBC' },
  { cle: 'mountbatten', hex: '#A98899' }
];
const HEX_COULEURS = COULEURS_NUMERO.map((c) => c.hex.toUpperCase());

// Jeton canonique de revue -> ISSN et langue par défaut, dérivés et jamais stockés
// séparément. Miroir de derive_revue() dans pipeline/filters/szh-maquette.lua.
const REVUES = [
  { cle: 'zeitschrift', issn: '2813-4907', langue: 'de' },
  { cle: 'revue',       issn: '2813-4915', langue: 'fr' }
];

function normaliserRevue(valeur) {
  const v = String(valeur === undefined || valeur === null ? '' : valeur).toLowerCase();
  if (v.indexOf('zeitschrift') !== -1) { return 'zeitschrift'; }
  if (v.indexOf('revue') !== -1) { return 'revue'; }
  return '';
}

// Découpe la partie droite d'un « clé: reste » en { valeur, suite }, où `suite` est
// l'éventuel commentaire de fin de ligne, espaces de tête compris, restitué tel quel à
// l'écriture. Une partie droite malformée passe pour un scalaire nu.
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
  // Scalaire nu : toute la plage d'espaces avant le « # » entre dans `suite`, ce qui
  // restitue l'alignement du commentaire.
  let debutComm = -1;
  if (reste.startsWith('#')) { debutComm = 0; }
  else {
    const m = reste.match(/\s+#/);
    if (m) { debutComm = m.index; }
  }
  if (debutComm === -1) { return { valeur: reste.trim(), suite: '' }; }
  return { valeur: reste.slice(0, debutComm).trim(), suite: reste.slice(debutComm).replace(/\s+$/, '') };
}

function analyserAusgabe(contenu) {
  const valeurs = {};
  for (const ligne of contenu.split(/\r?\n/)) {
    const m = ligne.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m || CLES_METADONNEES.indexOf(m[1]) === -1) { continue; }
    if (!(m[1] in valeurs)) { valeurs[m[1]] = decouperValeurYaml(m[2]).valeur; }
  }
  return valeurs;
}

// ---- Frontmatter d'article ----
//
// Format antérieur, encore lu et écrit : les métadonnées dans le frontmatter du
// <slug>.md. Clés gérées : title, subtitle, author, doi, keywords ; tout le reste, corps
// compris, est préservé mot pour mot.

const CLES_FRONTMATTER = ['title', 'subtitle', 'author', 'doi', 'keywords'];

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

// Réécrit le document : les clés gérées de `modifies` sont régénérées à la place de leur
// première occurrence, les clés absentes ajoutées à la fin, les lignes inconnues
// restituées telles quelles, et le corps n'est jamais touché. BOM et CRLF préservés.
function serialiserFrontmatter(texte, modifies) {
  const partie = separerFrontmatter(texte);
  const fmLignes = (partie.fm === null || partie.fm === '') ? [] : partie.fm.split(/\r?\n/);
  const segments = [];
  for (const ligne of fmLignes) {
    const cle = (ligne.match(/^([A-Za-z0-9_-]+):/) || [])[1];
    if (cle) { segments.push({ cle: cle, lignes: [ligne] }); continue; }
    const dernier = segments[segments.length - 1];
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

// ---- Métadonnées d'article : le fichier <slug>.meta.yaml ----
//
// Format en vigueur : le .md ne contient que le texte, et les métadonnées vivent dans
// articles/<slug>/<slug>.meta.yaml, masqué par files.exclude et édité par le seul
// formulaire, qui le régénère à chaque enregistrement en restituant les clés inconnues.
// Pandoc le lit par --metadata-file après ausgabe.yaml, donc l'article surcharge le numéro.

// Deux groupes : liés au dossier, dont le libellé affiché sera le titre du dossier, puis
// hors dossier. Même ordre que dans szh-maquette.lua.
const TYPES_DOSSIER = ['article', 'editorial', 'interview'];
const TYPES_HORS = ['varia', 'tribune-libre', 'documentation'];
const TYPES_ARTICLE = TYPES_DOSSIER.concat(TYPES_HORS);
const LIBELLES_TYPES = {
  'article':       { fr: 'Article',       de: 'Artikel',       it: 'Articolo' },
  'editorial':     { fr: 'Éditorial',     de: 'Editorial',     it: 'Editoriale' },
  'interview':     { fr: 'Interview',     de: 'Interview',     it: 'Intervista' },
  'varia':         { fr: 'Varia',         de: 'Varia',         it: 'Varia' },
  'tribune-libre': { fr: 'Tribune libre', de: 'Freie Tribüne',  it: 'Tribuna libera' },
  'documentation': { fr: 'Documentation', de: 'Dokumentation', it: 'Documentazione' }
};
const GROUPES_TYPES = {
  dossier: { fr: 'Liés au dossier thématique', de: 'Zum Themenschwerpunkt gehörend', it: 'Legati al dossier tematico' },
  hors:    { fr: 'Hors dossier',               de: 'Ausserhalb des Schwerpunkts',     it: 'Fuori dossier' }
};
const LANGUES_META = ['fr', 'de', 'it'];   // fr et de affichées ; it activable par carte

// Langue de l'article : les trois langues de la revue, jamais l'anglais — la maquette
// (libellés Figure/Tableau, « Résumé », mention de licence) n'existe que dans celles-là.
// Une fiche sans `lang` retombe sur la langue du numéro, et szh-maquette.lua le dit.
const LANGUES_ARTICLE = LANGUES_META;

// Jeton de langue d'article accepté : les deux premières lettres, dans la liste. Tout le
// reste rend '' (langue non déclarée), ce qui vaut « suivre le numéro ».
function normaliserLangueArticle(valeur) {
  const v = String(valeur === undefined || valeur === null ? '' : valeur).trim().toLowerCase().slice(0, 2);
  return LANGUES_ARTICLE.indexOf(v) !== -1 ? v : '';
}
// Champs d'un auteur, dans l'ordre de sérialisation : analyserMeta et serialiserMeta
// parcourent cette constante, l'étendre ici suffit aux deux. `photo` est un chemin
// relatif vers portraits/<slug-auteur>.{original.<ext>|avec-fond.png|sans-fond.png},
// posé par la modale photo et jamais saisi au clavier.
const CHAMPS_AUTEUR = ['prenom', 'nom', 'fonction', 'affiliation', 'orcid', 'email', 'photo'];

// Licence d'un article. La revue publie en CC-BY 4.0 : c'est la valeur par défaut, et une
// fiche sans clé `licence` sort exactement comme avant que ce champ existe — aucun numéro
// en cours ne bouge.
//
// Le jeu offert est la suite Creative Commons 4.0 au complet, ni plus ni moins : ces six
// licences sont les seules que Creative Commons publie en 4.0, et un sous-ensemble choisi
// à la main se rediscuterait à chaque reprise. S'y ajoute « droits réservés », le cas
// d'un entretien, d'une reprise ou d'une photo d'agence — sans lui, une figure « © Getty »
// continuerait de sortir sous une couverture CC-BY. Il n'a pas d'URL et on ne lui en
// fabrique pas : les consommateurs traitent l'absence au lieu de la contourner.
//
// `nom` est la mention imprimée sur la couverture, dans la graphie de la maison (trait
// d'union) ; elle est la même dans les trois langues, seule la phrase qui l'entoure est
// traduite — voir szh-maquette.lua, dont la table est le miroir de celle-ci. `url` est
// l'adresse du résumé Creative Commons, forme canonique avec barre finale. Les libellés du
// formulaire, eux, vivent dans lib/i18n.js sous « licence.<clé> ».
const LICENCE_DEFAUT = 'cc-by-4.0';
const LICENCES_ARTICLE = [
  { cle: 'cc-by-4.0',       nom: 'CC-BY 4.0',       url: 'https://creativecommons.org/licenses/by/4.0/' },
  { cle: 'cc-by-sa-4.0',    nom: 'CC-BY-SA 4.0',    url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  { cle: 'cc-by-nd-4.0',    nom: 'CC-BY-ND 4.0',    url: 'https://creativecommons.org/licenses/by-nd/4.0/' },
  { cle: 'cc-by-nc-4.0',    nom: 'CC-BY-NC 4.0',    url: 'https://creativecommons.org/licenses/by-nc/4.0/' },
  { cle: 'cc-by-nc-sa-4.0', nom: 'CC-BY-NC-SA 4.0', url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/' },
  { cle: 'cc-by-nc-nd-4.0', nom: 'CC-BY-NC-ND 4.0', url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/' },
  { cle: 'droits-reserves', nom: '',                url: '' }
];

// Jeton de licence accepté, ou '' hors liste — ce qui vaut « non déclarée », donc la
// licence par défaut. Une valeur de travers ne doit jamais s'imprimer.
function normaliserLicence(valeur) {
  const v = String(valeur === undefined || valeur === null ? '' : valeur).trim().toLowerCase();
  for (const l of LICENCES_ARTICLE) { if (l.cle === v) { return v; } }
  return '';
}

// L'entrée à appliquer : celle de la fiche, ou celle par défaut quand la clé est absente
// ou illisible. Point de passage unique de tout ce qui, côté cockpit, dit une licence.
function licenceArticle(valeur) {
  const cle = normaliserLicence(valeur) || LICENCE_DEFAUT;
  for (const l of LICENCES_ARTICLE) { if (l.cle === cle) { return l; } }
  return LICENCES_ARTICLE[0];
}

// Langue par défaut du numéro, dérivée du choix de revue, avec repli sur la clé `lang`
// puis sur fr. Détermine la langue affichée en premier dans les formulaires.
function langueDefaut(valeurs) {
  const revue = normaliserRevue((valeurs && valeurs.revue) || '');
  if (revue) {
    for (const r of REVUES) { if (r.cle === revue) { return r.langue; } }
  }
  const base = String((valeurs && valeurs.lang) || 'fr').toLowerCase().slice(0, 2);
  return LANGUES_META.indexOf(base) !== -1 ? base : 'fr';
}

function langueRevue(racine) {
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* illisible : repli fr via langueDefaut({}) */ }
  return langueDefaut(valeurs);
}

// analyserMeta(texte) -> { type, lang, source, licence, doi, title:{}, subtitle:{},
// resume:{}, keywords:{}, author:[], _inconnues:[lignes brutes] }. Accepte les maps par
// langue et les listes en bloc comme en ligne.
//
// `source` (le nom du .docx d'origine, posé par l'import) et `licence` sont des clés de
// première classe : le formulaire des métadonnées reconstruit sa carte depuis la webview,
// et c'est ecrireCartesArticles() qui relit du fichier ce que la carte ne porte pas.
function analyserMeta(texte) {
  const valeurs = { type: '', lang: '', source: '', licence: '', doi: '', title: {}, subtitle: {}, resume: {}, keywords: {}, author: [], _inconnues: [] };
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
    // Langue de l'article, propre à la fiche : elle prime sur la langue du numéro au
    // rendu. Une valeur hors liste est relue comme non déclarée, jamais imprimée.
    if (cle === 'lang') { valeurs.lang = normaliserLangueArticle(decouperValeurYaml(reste).valeur); i++; continue; }
    // Le Word d'origine : c'est lui qui distingue un redépôt du même fichier d'un
    // homonyme dont le nom se tronque pareil.
    if (cle === 'source') { valeurs.source = decouperValeurYaml(reste).valeur; i++; continue; }
    // Licence de l'article. Une valeur hors liste est relue comme absente, donc CC-BY 4.0 :
    // mieux vaut la licence de la revue qu'un jeton inventé imprimé sur la couverture.
    if (cle === 'licence') { valeurs.licence = normaliserLicence(decouperValeurYaml(reste).valeur); i++; continue; }
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
    valeurs._inconnues.push(lignes[i]);
    i++;
    while (i < lignes.length && (/^\s+\S/.test(lignes[i]) || /^\s*-\s/.test(lignes[i]))) {
      valeurs._inconnues.push(lignes[i]);
      i++;
    }
  }
  return valeurs;
}

// serialiserMeta(valeurs) -> YAML régénéré dans l'ordre type, lang, source, licence, doi,
// title, subtitle, resume, keywords, author, puis les clés inconnues. Valeurs vides, langues sans
// contenu et auteurs vides sont omis. Le même ordre que serialiser_meta() de
// pipeline/docx-meta.py, qui écrit la fiche à l'import : une fiche enregistrée par le
// formulaire ne doit pas différer de celle que l'import vient de poser.
function serialiserMeta(valeurs) {
  const v = valeurs || {};
  const lignes = [];
  const type = String(v.type || '').trim();
  if (TYPES_ARTICLE.indexOf(type) !== -1) { lignes.push('type: ' + type); }
  // Jeton nu et non cité : szh-maquette.lua relit cette ligne à part, hors pandoc, pour
  // savoir si l'article a déclaré sa langue ou s'il suit celle du numéro.
  const langue = normaliserLangueArticle(v.lang);
  if (langue !== '') { lignes.push('lang: ' + langue); }
  // Le Word d'origine, juste après la langue, là où l'import le pose.
  const source = String(v.source || '').trim();
  if (source !== '') { lignes.push('source: ' + citerFrontmatter(source)); }
  // Licence : jeton nu et non cité, comme la langue — szh-maquette.lua relit cette ligne
  // à part, hors pandoc. Absente, l'article sort sous la licence par défaut de la revue,
  // et rien ne s'écrit : c'est le cas de toutes les fiches d'avant ce champ.
  const licence = normaliserLicence(v.licence);
  if (licence !== '') { lignes.push('licence: ' + licence); }
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
  for (const brute of (Array.isArray(v._inconnues) ? v._inconnues : [])) { lignes.push(String(brute)); }
  return lignes.length > 0 ? lignes.join('\n') + '\n' : '';
}

// Titre de la vue : « {Z|R}{AAAA}-{numero} | {title} », Z pour une revue allemande et R
// sinon. Chaque morceau manquant est omis, le préfixe seul ne comptant pas ; à défaut, le
// nom du dossier sert de titre, qui n'est donc jamais vide.
function titreNumero(racine) {
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* illisible : replis ci-dessous */ }
  const prefixe = langueDefaut(valeurs) === 'de' ? 'Z' : 'R';
  // Année : celle de `date:` si elle y est, sinon celle du nom du dossier (« 2027-03 »).
  // `date:` est la date de publication, vide jusqu'à la parution ; sans ce repli, la barre
  // d'un numéro neuf s'annoncerait « R-03 ». Même règle que szh-maquette.lua.
  let annee = (String(valeurs.date || '').match(/\d{4}/) || [''])[0];
  if (annee === '') {
    annee = (String(path.basename(racine)).match(/^(\d{4})-\d/) || ['', ''])[1];
  }
  const numero = String(valeurs.numero || '').trim();
  const titre = String(valeurs.title || '').trim();
  const morceaux = [];
  if (annee || numero) { morceaux.push(prefixe + annee + (numero ? '-' + numero : '')); }
  if (titre) { morceaux.push(titre); }
  if (morceaux.length === 0) { return path.basename(racine); }
  return morceaux.join(' | ');
}

// État d'un numéro. ausgabe.yaml en est la seule source de vérité : rien n'est mémorisé
// côté éditeur ni côté poste, si bien qu'un numéro archivé sur OneDrive l'est pour tout le
// monde et que le dossier reste lisible sans le toolkit. `versionToolkit` est vide pour un
// numéro antérieur à cette clé, et aucun avertissement de divergence n'est alors affiché.
// Fichier illisible ou absent : état neutre.
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

// Tout est cité, ce qui met à l'abri des deux-points, dièses, guillemets et accents, sauf
// `lang` : le Makefile lit cette clé avec un sed qui ne comprend pas les guillemets, d'où
// un jeton nu restreint à [a-zA-Z-].
function formaterValeurYaml(cle, valeur) {
  if (cle === 'lang') { return String(valeur).replace(/[^a-zA-Z-]/g, '') || 'fr'; }
  // Séquence en ligne : une clé par ligne reste la règle du fichier, et la liste se lit
  // d'un coup d'oeil. Les jetons sont cités, comme partout ailleurs ici.
  if (CLES_LISTES.indexOf(cle) !== -1) {
    const liste = (Array.isArray(valeur) ? valeur : String(valeur === undefined || valeur === null ? '' : valeur).split(/[,\s]+/))
      .map((v) => String(v).trim()).filter((v) => v !== '');
    return '[' + liste.map((v) => '"' + v.replace(/([\\"])/g, '\\$1') + '"').join(', ') + ']';
  }
  // Les drapeaux s'écrivent en booléen YAML nu, jamais cité : la chaîne « "false" » serait
  // vraie pour le `$if()$` du gabarit pandoc.
  if (CLES_BOOLEENNES.indexOf(cle) !== -1) { return estVraiYaml(valeur) ? 'true' : 'false'; }
  return '"' + String(valeur).replace(/([\\"])/g, '\\$1') + '"';
}

// Réécrit `contenu` avec les clés de `modifies` : lignes existantes mises à jour en
// conservant leur commentaire de fin, clés absentes ajoutées à la fin sauf si leur valeur
// est vide. Aucune autre ligne n'est modifiée.
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
    // `suite` garde ses espaces de tête ; s'il colle à la valeur, on intercale un espace.
    const suite = decouperValeurYaml(m[2]).suite;
    return m[1] + ': ' + formaterValeurYaml(m[1], modifies[m[1]]) + (suite ? (/^\s/.test(suite) ? suite : ' ' + suite) : '');
  });
  for (const cle of CLES_METADONNEES) {
    if (!restantes.has(cle)) { continue; }
    // Une liste vide vaut « rien à retenir » : String([]) rend '', et la clé n'est pas
    // ajoutée. Une clé déjà présente, elle, est réécrite plus haut, vide comprise.
    if (String(modifies[cle]) === '') { continue; }
    resultat.push(cle + ': ' + formaterValeurYaml(cle, modifies[cle]));
  }
  return bom + resultat.join(eol) + (resultat.length > 0 ? eol : '');
}

// Écriture atomique : un temporaire « ~$… » dans le même dossier, préfixe ignoré par la
// synchro OneDrive, puis rename. Jamais de fichier à moitié écrit.
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
  CLES_METADONNEES, CLES_BOOLEENNES, CLES_LISTES, CLE_SANS_DOI, COULEURS_NUMERO, HEX_COULEURS, CLES_FRONTMATTER, estVraiYaml,
  etatRevue,
  REVUES, normaliserRevue,
  TYPES_ARTICLE, TYPES_DOSSIER, TYPES_HORS, LIBELLES_TYPES, GROUPES_TYPES, LANGUES_META, CHAMPS_AUTEUR,
  LANGUES_ARTICLE, normaliserLangueArticle,
  LICENCE_DEFAUT, LICENCES_ARTICLE, normaliserLicence, licenceArticle,
  decouperValeurYaml, decouperFlowYaml, listeYamlEnLigne, analyserAusgabe,
  separerFrontmatter, analyserFrontmatter, citerFrontmatter, lignesCleFrontmatter, serialiserFrontmatter,
  langueDefaut, langueRevue, analyserMeta, serialiserMeta, titreNumero,
  formaterValeurYaml, serialiserAusgabe, ecrireAtomique
};
