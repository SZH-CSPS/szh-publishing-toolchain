// Les articles d'un numéro : leur ordre, le nom sous lequel l'interface les désigne, et
// les tâches éditoriales qui les suivent. Module pur — ni vscode ni écriture disque, pour
// être éprouvable en ligne de commande.
//
// Trois données, trois endroits, et ce n'est pas un hasard :
//
//   l'ORDRE décrit un numéro           -> ausgabe.yaml, clé `ordre-articles`
//   les DÉFINITIONS de tâches décrivent une revue
//                                      -> C:\ProgramData\SZH\config.json, `tachesArticle`
//   l'ÉTAT COCHÉ décrit un article     -> articles/<slug>/<slug>.taches.yaml
//
// L'ordre ne vit pas dans les noms de dossier : déplacer un article renommerait dossier et
// .md, donc tout out/, et casserait les liens du numéro. Il vit dans ausgabe.yaml, avec le
// reste de ce qui décrit le numéro, il voyage avec le dossier sur SharePoint et se relit à
// la main. Les définitions de tâches décrivent le processus éditorial d'une revue, pas d'un
// numéro : elles sont là où vivent déjà les réglages de ce genre, config.json, aux côtés de
// l'emplacement des revues et de la configuration OJS. L'état coché, lui, ne concerne qu'un
// article et part avec lui, comme le suivi de traduction juste à côté.
'use strict';

const { decouperValeurYaml, LANGUES_META, citerFrontmatter } = require('./yaml');

// ---- Ordre des articles ----------------------------------------------------------

const CLE_ORDRE = 'ordre-articles';

// Forme d'un slug d'article, telle que lib/slug.js la produit : rien d'autre n'entre dans
// l'ordre, ce qui met la clé à l'abri d'un chemin ou d'un titre collé à la main.
const FORME_SLUG = /^[a-z0-9][a-z0-9-]*$/;

// Lit la clé : séquence en ligne `["a", "b"]` telle qu'elle est écrite, ou simple suite de
// jetons séparés par des virgules ou des espaces, ce qu'une correction à la main donne.
// Doublons et jetons malformés sont écartés sans bruit — la valeur n'est qu'un ordre, elle
// ne porte aucune information qu'on perdrait.
function analyserOrdre(valeur) {
  const brut = Array.isArray(valeur)
    ? valeur.join(' ')
    : String(valeur === undefined || valeur === null ? '' : valeur);
  const interieur = brut.trim().replace(/^\[/, '').replace(/\]$/, '');
  const liste = [];
  const vus = Object.create(null);
  for (const morceau of interieur.split(/[,\s]+/)) {
    const v = decouperValeurYaml(morceau.trim()).valeur.trim();
    if (v === '' || !FORME_SLUG.test(v) || vus[v]) { continue; }
    vus[v] = true;
    liste.push(v);
  }
  return liste;
}

// Ordre effectif d'un numéro : ce que la clé retient et qui existe encore, puis ce qui
// n'y figure pas, dans l'ordre que le disque donne. Un article ajouté ou retiré hors de
// l'interface ne fait donc ni disparaître un autre ni casser l'ordre — il se range à la
// fin, et un article effacé quitte l'ordre de lui-même.
//
// `change` dit si la clé mérite d'être réécrite ; l'appelant décide, car réécrire à chaque
// rafraîchissement de l'arbre réveillerait le surveillant de fichiers en boucle.
function ordonnerArticles(valeurClef, slugsDisque) {
  const disque = (slugsDisque || []).map((s) => String(s));
  const presents = Object.create(null);
  for (const s of disque) { presents[s] = true; }
  const stocke = analyserOrdre(valeurClef);
  const ordre = [];
  for (const s of stocke) { if (presents[s] && ordre.indexOf(s) === -1) { ordre.push(s); } }
  for (const s of disque) { if (ordre.indexOf(s) === -1) { ordre.push(s); } }
  const change = stocke.length !== ordre.length || stocke.some((s, i) => s !== ordre[i]);
  return { slugs: ordre, change: change };
}

// Déplace un article d'un cran. Rend toujours une liste complète : c'est elle qui part dans
// ausgabe.yaml, et une liste partielle laisserait les autres articles à réparer.
function deplacerArticle(liste, slug, delta) {
  const l = (liste || []).slice();
  const i = l.indexOf(String(slug));
  if (i === -1) { return l; }
  const j = i + Number(delta || 0);
  if (j < 0 || j >= l.length) { return l; }
  l.splice(i, 1);
  l.splice(j, 0, String(slug));
  return l;
}

// Le préfixe visible : « 01 », « 02 »… Il suit l'ordre ci-dessus et non le nom du dossier,
// et dit d'un coup d'oeil où l'article se situe dans le numéro. Au-delà de 99 articles, le
// nombre s'écrit tel quel plutôt que de mentir sur deux chiffres.
function prefixeOrdre(index) {
  const n = Number(index) + 1;
  if (!isFinite(n) || n < 1) { return '00'; }
  return n < 10 ? '0' + n : String(n);
}

// ---- Nom d'un article ------------------------------------------------------------

// Le titre de la fiche, dans la langue du numéro si elle y est, sinon dans une autre —
// mieux vaut un titre allemand sur une revue française que le slug. '' si la fiche manque
// ou n'a pas de titre : l'appelant retombe alors sur le slug, et l'article reste visible.
function titreFiche(meta, langue) {
  const map = (meta && meta.title) || {};
  const prefere = LANGUES_META.indexOf(langue) !== -1 ? langue : LANGUES_META[0];
  const ordre = [prefere].concat(LANGUES_META.filter((l) => l !== prefere));
  for (const l of ordre) {
    const t = String(map[l] || '').trim();
    if (t !== '') { return t; }
  }
  return '';
}

const SEPARATEUR_LIBELLE = ' · ';

// « 03 · Inklusive Bildung in der Sekundarstufe I ». Le slug n'est plus le libellé : il
// passe en description, là où l'on va chercher le nom du dossier. Une fiche absente ou un
// titre vide laisse le slug en place — l'article se voit, il ne disparaît pas.
function libelleArticle(index, slug, titre) {
  const t = String(titre === undefined || titre === null ? '' : titre).trim();
  return prefixeOrdre(index) + SEPARATEUR_LIBELLE + (t !== '' ? t : String(slug));
}

// ---- Tâches éditoriales : les définitions ----------------------------------------

// Le jeu de départ, mot pour mot celui que la rédaction a demandé, dans les deux langues
// du cockpit. L'allemand est en orthographe suisse.
const TACHES_DEFAUT = [
  { id: 'version-finale', fr: 'version finale', de: 'Endfassung' },
  { id: 'traductions-terminees', fr: 'traductions terminées', de: 'Übersetzungen abgeschlossen' },
  { id: 'contraste-alternatif', fr: 'contraste et texte alternatif', de: 'Kontrast und Alternativtext' },
  { id: 'envoi-auteurs', fr: 'envoi de la version finale aux autrices et auteurs',
    de: 'Versand der Endfassung an die Autorinnen und Autoren' }
];

// Une liste par revue : les deux maisons ne suivent pas le même processus, et l'une doit
// pouvoir ajouter une étape sans l'imposer à l'autre. Jetons canoniques de lib/yaml.js.
const REVUES_TACHES = ['revue', 'zeitschrift'];
const CLE_TACHES = 'tachesArticle';

// Un numéro de tâches par revue, borné : la liste s'affiche sur chaque carte, et cinquante
// cases y seraient illisibles.
const MAX_TACHES = 20;
const LONGUEUR_MAX_TACHE = 80;

// Identifiant d'une tâche : c'est lui qui est écrit dans le sidecar de l'article, donc il
// ne doit contenir que ce qu'un YAML nu accepte. Renommer un intitulé ne perd rien ;
// renommer un identifiant décoche la tâche, et c'est pour cela qu'il est dérivé une fois,
// à la création, et jamais recalculé depuis l'intitulé.
const FORME_ID_TACHE = /^[a-z0-9][a-z0-9-]*$/;

function idTache(brut) {
  const s = String(brut === undefined || brut === null ? '' : brut)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return FORME_ID_TACHE.test(s) ? s : '';
}

// Nettoie une liste venue de config.json ou du panneau : identifiants valides, uniques,
// intitulés bornés, et jamais plus de MAX_TACHES rangées. Une tâche sans intitulé dans une
// langue garde l'autre — la case reste cochable, seul son nom manque dans une langue.
function normaliserTaches(liste) {
  const sortie = [];
  const vus = Object.create(null);
  for (const brute of (Array.isArray(liste) ? liste : [])) {
    if (!brute || typeof brute !== 'object') { continue; }
    const fr = String(brute.fr || '').replace(/[\r\n]+/g, ' ').trim().slice(0, LONGUEUR_MAX_TACHE);
    const de = String(brute.de || '').replace(/[\r\n]+/g, ' ').trim().slice(0, LONGUEUR_MAX_TACHE);
    // L'identifiant se dérive de l'intitulé français seulement quand il manque : une tâche
    // déjà écrite garde le sien, sans quoi la corriger décocherait tous les articles.
    const id = idTache(brute.id) || idTache(fr) || idTache(de);
    if (id === '' || vus[id]) { continue; }
    if (fr === '' && de === '') { continue; }
    vus[id] = true;
    sortie.push({ id: id, fr: fr, de: de });
    if (sortie.length >= MAX_TACHES) { break; }
  }
  return sortie;
}

// Les définitions des deux revues, telles que config.json les porte, avec le jeu de départ
// à la place de ce qui manque. La table est toujours complète : le panneau montre les deux
// revues, même sur un poste qui n'a jamais rien réglé.
function tachesConfig(cfg) {
  const brut = (cfg && typeof cfg[CLE_TACHES] === 'object' && cfg[CLE_TACHES]) || {};
  const table = {};
  for (const revue of REVUES_TACHES) {
    const liste = normaliserTaches(brut[revue]);
    table[revue] = liste.length > 0 ? liste : TACHES_DEFAUT.map((t) => Object.assign({}, t));
  }
  return table;
}

// Les tâches d'une revue donnée. Une revue inconnue — ausgabe.yaml sans clé `revue` —
// reçoit le jeu de départ : mieux vaut une liste que pas de suivi du tout.
function tachesRevue(cfg, revue) {
  const table = tachesConfig(cfg);
  const cle = String(revue === undefined || revue === null ? '' : revue).toLowerCase();
  return table[cle] || TACHES_DEFAUT.map((t) => Object.assign({}, t));
}

// Pose une liste sur une revue sans toucher au reste de config.json ni à l'autre revue.
// Pure, pour être éprouvable sans écrire dans C:\ProgramData.
function configAvecTaches(cfg, revue, liste) {
  const cle = String(revue === undefined || revue === null ? '' : revue).toLowerCase();
  if (REVUES_TACHES.indexOf(cle) === -1) { return cfg && typeof cfg === 'object' ? cfg : {}; }
  const sortie = Object.assign({}, (cfg && typeof cfg === 'object') ? cfg : {});
  const table = Object.assign({}, tachesConfig(cfg));
  table[cle] = normaliserTaches(liste);
  sortie[CLE_TACHES] = table;
  return sortie;
}

// L'intitulé dans la langue de l'interface, avec repli sur l'autre : une tâche n'ayant été
// nommée qu'en français doit rester lisible sur un cockpit allemand.
function libelleTache(tache, langue) {
  const t = tache || {};
  const prefere = langue === 'de' ? 'de' : 'fr';
  const autre = prefere === 'de' ? 'fr' : 'de';
  return String(t[prefere] || '').trim() || String(t[autre] || '').trim() || String(t.id || '');
}

// ---- Tâches éditoriales : l'état coché -------------------------------------------
//
// Sidecar articles/<slug>/<slug>.taches.yaml, sur le modèle du suivi de traduction juste à
// côté : ni publié, ni exporté, ignoré du Makefile, et il part avec l'article.
//
//   faites:
//   - version-finale
//   - traductions-terminees

const ENTETE_TACHES = '# Tâches de l’article — état de travail interne au cockpit.\n' +
  '# Ni publié, ni exporté vers OJS : le Makefile ne lit que <article>.meta.yaml.\n' +
  '# Édité par la vue « Articles ». Les intitulés des tâches, eux, sont un réglage de\n' +
  '# revue et vivent dans C:\\ProgramData\\SZH\\config.json.\n';

// -> { faites: [ids], _inconnues: [lignes brutes] }. Une clé inconnue est restituée telle
// quelle à l'écriture : ce fichier peut recevoir d'autres états d'atelier un jour.
function analyserTachesFaites(texte) {
  const valeurs = { faites: [], _inconnues: [] };
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
    if (m[1] === 'faites') {
      i++;
      while (i < lignes.length && /^\s*-\s/.test(lignes[i])) {
        const item = lignes[i].match(/^\s*-\s*(.*)$/);
        const v = idTache(decouperValeurYaml(item[1]).valeur);
        if (v !== '' && valeurs.faites.indexOf(v) === -1) { valeurs.faites.push(v); }
        i++;
      }
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

// Rend '' quand il n'y a plus rien à retenir : l'appelant supprime alors le fichier, et un
// article dont on décoche tout ne laisse pas de résidu dans son dossier.
function serialiserTachesFaites(valeurs) {
  const v = valeurs || {};
  const faites = [];
  for (const brut of (Array.isArray(v.faites) ? v.faites : [])) {
    const id = idTache(brut);
    if (id !== '' && faites.indexOf(id) === -1) { faites.push(id); }
  }
  const restantes = (Array.isArray(v._inconnues) ? v._inconnues : [])
    .filter((l) => !/^faites:/.test(String(l)));
  if (faites.length === 0 && restantes.length === 0) { return ''; }
  const lignes = [];
  if (faites.length > 0) {
    lignes.push('faites:');
    for (const id of faites) { lignes.push('- ' + citerFrontmatter(id)); }
  }
  for (const brute of restantes) { lignes.push(brute); }
  return ENTETE_TACHES + lignes.join('\n') + '\n';
}

// Ce que la carte doit dire sans qu'on l'ouvre : combien de tâches sont faites sur
// combien, et si tout est fait. Une tâche cochée puis retirée des définitions ne compte
// plus — l'avancement suit ce que la revue demande aujourd'hui.
function resumeTaches(taches, faites) {
  const definies = (taches || []).map((t) => String(t.id));
  const cochees = new Set((faites || []).map((f) => String(f)));
  let n = 0;
  for (const id of definies) { if (cochees.has(id)) { n++; } }
  return { faites: n, total: definies.length, toutes: definies.length > 0 && n === definies.length };
}

// Bascule une tâche dans la liste des faites, en n'y laissant que des tâches définies :
// une case cochée puis retirée de la configuration ne doit pas ressusciter.
function basculerTache(faites, id, cochee, taches) {
  const definies = new Set((taches || []).map((t) => String(t.id)));
  const cible = idTache(id);
  const sortie = [];
  for (const f of (faites || [])) {
    const v = idTache(f);
    if (v === '' || v === cible || !definies.has(v) || sortie.indexOf(v) !== -1) { continue; }
    sortie.push(v);
  }
  if (cochee && cible !== '' && definies.has(cible)) { sortie.push(cible); }
  // Remis dans l'ordre des définitions : le fichier se relit comme la liste s'affiche.
  return (taches || []).map((t) => String(t.id)).filter((id2) => sortie.indexOf(id2) !== -1);
}

// ---- Couverture du numéro --------------------------------------------------------
//
// ⚠ Recopie de NOMS_COUVERTURE dans lib/export-ojs.js, que ce module n'a pas le droit
// d'importer. test/js/articles.test.js compare les deux listes : si elles divergent, une
// couverture déposée ici ne serait pas celle que l'export va chercher.
const NOMS_COUVERTURE = ['couverture.jpg', 'couverture.jpeg', 'couverture.png'];

// Extension -> nom canonique. Une couverture déposée en .jpeg est écrite sous le premier
// nom que l'export essaie, pour qu'il n'y ait jamais deux fichiers de couverture.
const EXTENSIONS_COUVERTURE = { jpg: 'couverture.jpg', jpeg: 'couverture.jpg', png: 'couverture.png' };

function nomCouverture(nomFichier) {
  const ext = (String(nomFichier || '').match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
  return EXTENSIONS_COUVERTURE[ext] || '';
}

// Une couverture est une image de une : 12 Mo est déjà très large pour un scan de
// couverture, et l'aperçu voyage en base64 dans un postMessage.
const MAX_COUVERTURE = 12 * 1024 * 1024;

module.exports = {
  CLE_ORDRE, FORME_SLUG, analyserOrdre, ordonnerArticles, deplacerArticle, prefixeOrdre,
  titreFiche, libelleArticle, SEPARATEUR_LIBELLE,
  TACHES_DEFAUT, REVUES_TACHES, CLE_TACHES, MAX_TACHES, LONGUEUR_MAX_TACHE,
  idTache, normaliserTaches, tachesConfig, tachesRevue, configAvecTaches, libelleTache,
  ENTETE_TACHES, analyserTachesFaites, serialiserTachesFaites, resumeTaches, basculerTache,
  NOMS_COUVERTURE, EXTENSIONS_COUVERTURE, nomCouverture, MAX_COUVERTURE
};
