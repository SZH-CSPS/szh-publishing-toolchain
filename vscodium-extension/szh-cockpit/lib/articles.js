// Les articles d'un numéro : leur ordre, le nom sous lequel l'interface les désigne, et
// les tâches éditoriales qui les suivent. Module pur : ni vscode ni écriture disque.
//
// Où vit chaque donnée :
// - l'ordre, propre au numéro : `ordre-articles` dans ausgabe.yaml ;
// - les définitions de tâches, propres à une revue : `tachesArticle` dans
//   C:\ProgramData\SZH\config.json ;
// - les tâches cochées, propres à un article : articles/<slug>/<slug>.taches.yaml.
'use strict';

const { decouperValeurYaml, LANGUES_META, citerFrontmatter, CLE_SANS_DOI,
  listeYamlEnLigne } = require('./yaml');

// ---- Ordre des articles ----------------------------------------------------------

const CLE_ORDRE = 'ordre-articles';

// Forme d'un slug d'article, telle que lib/slug.js la produit. Seuls ces jetons entrent dans
// l'ordre : un chemin ou un titre collé à la main est écarté.
const FORME_SLUG = /^[a-z0-9][a-z0-9-]*$/;

// Lit la clé (séquence YAML en ligne, découpée par lib/yaml.js) et garde les jetons qui ont
// la forme d'un slug. Les autres sont écartés sans avertissement.
function analyserOrdre(valeur) {
  return listeYamlEnLigne(valeur).filter((v) => FORME_SLUG.test(v));
}

// Ordre effectif d'un numéro : les slugs de la clé qui existent encore, puis ceux qui n'y
// figurent pas, dans l'ordre du disque. Un article ajouté hors de l'interface se range à la
// fin ; un article effacé quitte l'ordre.
//
// `sansDoi` ramène ensuite à la fin les articles sans DOI (voir trierParDoi).
//
// `change` dit si la clé diffère du résultat. L'appelant décide de la réécrire : la
// réécrire à chaque rafraîchissement de l'arbre réveillerait le surveillant de fichiers en
// boucle.
function ordonnerArticles(valeurClef, slugsDisque, sansDoi) {
  const disque = (slugsDisque || []).map((s) => String(s));
  const presents = Object.create(null);
  for (const s of disque) { presents[s] = true; }
  const stocke = analyserOrdre(valeurClef);
  const ordre = [];
  for (const s of stocke) { if (presents[s] && ordre.indexOf(s) === -1) { ordre.push(s); } }
  for (const s of disque) { if (ordre.indexOf(s) === -1) { ordre.push(s); } }
  const trie = trierParDoi(ordre, sansDoi);
  const change = stocke.length !== trie.length || stocke.some((s, i) => s !== trie[i]);
  return { slugs: trie, change: change };
}

// ---- La règle du DOI sur l'ordre -------------------------------------------------
//
// Le DOI d'un article est son rang parmi ceux qui en portent un : l'éditorial ouvre le
// numéro et prend « 00 », le suivant « 01 ». Pour que le DOI 05 désigne le sixième article
// lu, les articles sans DOI sont tous placés après les autres. trierParDoi() l'assure, et
// refusDeplacement() empêche un déplacement de le défaire.

// -> Set des slugs sans DOI, quelle que soit la forme reçue (liste, Set, clé YAML brute).
function jeuSansDoi(sansDoi) {
  if (sansDoi instanceof Set) { return sansDoi; }
  if (Array.isArray(sansDoi)) { return new Set(sansDoi.map((s) => String(s))); }
  return new Set(analyserSansDoi(sansDoi));
}

function sansDoiIci(jeu, slug) { return jeu.has(String(slug)); }

// Les porteurs de DOI d'abord, dans leur ordre ; les autres ensuite, dans le leur. Le tri
// est stable : dans chaque bloc, l'ordre saisi à la main est conservé.
function trierParDoi(slugs, sansDoi) {
  const liste = (slugs || []).map((s) => String(s));
  const jeu = jeuSansDoi(sansDoi);
  if (jeu.size === 0) { return liste; }
  const porteurs = liste.filter((s) => !sansDoiIci(jeu, s));
  const autres = liste.filter((s) => sansDoiIci(jeu, s));
  return porteurs.concat(autres);
}

// La liste des articles sans DOI, lue comme l'ordre : même format, mêmes tolérances.
function analyserSansDoi(valeur) { return analyserOrdre(valeur); }

// Coche ou décoche un article. Rend la liste entière, dans l'ordre de `ordre` s'il est
// donné, pour que le fichier se lise comme le numéro s'affiche.
function basculerSansDoi(liste, slug, coche, ordre) {
  const cible = String(slug);
  if (!FORME_SLUG.test(cible)) { return analyserSansDoi(liste); }
  const jeu = new Set(analyserSansDoi(liste));
  if (coche) { jeu.add(cible); } else { jeu.delete(cible); }
  const rang = Array.isArray(ordre) ? ordre.map((s) => String(s)) : [];
  const dansOrdre = rang.filter((s) => jeu.has(s));
  const reste = Array.from(jeu).filter((s) => rang.indexOf(s) === -1);
  return dansOrdre.concat(reste);
}

// Pourquoi un déplacement est refusé, ou '' quand il se fait.
//   'bord'      l'article est déjà en tête ou en queue du numéro ;
//   'frontiere' le cran suivant appartient à l'autre bloc : un article sans DOI ne passe
//               pas au-dessus d'un article qui en porte un.
// L'interface explique la frontière, pas le bord.
function refusDeplacement(liste, slug, delta, sansDoi) {
  const l = (liste || []).map((s) => String(s));
  const i = l.indexOf(String(slug));
  if (i === -1) { return 'bord'; }
  const j = i + Number(delta || 0);
  if (j < 0 || j >= l.length) { return 'bord'; }
  const jeu = jeuSansDoi(sansDoi);
  if (sansDoiIci(jeu, l[i]) !== sansDoiIci(jeu, l[j])) { return 'frontiere'; }
  return '';
}

// Le rang du DOI, ou -1 pour un article qui n'en reçoit pas. Seuls les porteurs sont
// comptés : la série reste contiguë.
function rangDoi(slugs, slug, sansDoi) {
  const jeu = jeuSansDoi(sansDoi);
  let n = 0;
  for (const s of (slugs || []).map((x) => String(x))) {
    if (sansDoiIci(jeu, s)) { if (s === String(slug)) { return -1; } continue; }
    if (s === String(slug)) { return n; }
    n++;
  }
  return -1;
}

// Déplace un article d'un cran. Rend toujours la liste complète, qui part dans ausgabe.yaml.
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

// Le préfixe affiché d'un rang : « 00 », « 01 »… Au-delà de 99, le nombre s'écrit tel quel.
//
// Il compte à partir de zéro, comme le DOI : doiCalcule() (lib/export-ojs.js) reçoit
// rangDoi(), qui vaut 0 pour le premier porteur, et écrit « …-2026-03-00 ». Le numéro à
// l'écran est donc celui du DOI, de la galley et de la ligne OJS. Les articles sans DOI,
// rangés en fin de numéro, continuent la série ; leur nombre ne désigne aucun DOI.
function prefixeOrdre(index) {
  const n = Math.trunc(Number(index));
  if (!isFinite(n) || n < 0) { return '00'; }
  return n < 10 ? '0' + n : String(n);
}

// Le préfixe que porte le dossier, lu sur son nom ; '' s'il n'en a pas. Seuls les dossiers
// créés par un import ou réalignés par « Changer l'ordre » en ont un : un numéro peut
// mélanger des dossiers numérotés et non numérotés. Ce nombre sert à retrouver l'article
// dans l'Explorateur de fichiers.
//
// tige() (lib/renumerotation.js) lit le même motif ^(\d+)-. Elle n'est pas importée ici :
// renumerotation.js dépend déjà de ce module, et l'importer créerait un cycle.
function prefixeDossier(slug) {
  const m = String(slug === undefined || slug === null ? '' : slug).match(/^(\d+)-/);
  return m ? m[1] : '';
}

// Le nom du dossier sans son préfixe « NN- » ; un slug sans préfixe reste entier. Sert au
// repli de libelleArticle().
function tigeDossier(slug) {
  const s = String(slug === undefined || slug === null ? '' : slug);
  const m = s.match(/^(\d+)-(.+)$/);
  return m ? m[2] : s;
}

// ---- Nom d'un article ------------------------------------------------------------

// Le titre de la fiche, dans la langue du numéro si elle y est, sinon dans une autre.
// '' si la fiche manque ou n'a pas de titre : l'appelant affiche alors le slug.
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

// « 03 · Inklusive Bildung in der Sekundarstufe I ». Le slug va en description. Sans fiche
// ou sans titre, le libellé est le slug sans son préfixe.
//
// `numero` est formaté par l'appelant : `prefixeDossier(slug)` pour le préfixe du dossier
// (vue normale, arbre, listes de choix), ou `prefixeOrdre(index)` pour le rang à venir en
// mode « Changer l'ordre ». Avec un numéro '', le libellé est le titre seul, sans séparateur.
function libelleArticle(numero, slug, titre) {
  const t = String(titre === undefined || titre === null ? '' : titre).trim();
  // Le préfixe est retiré du slug, car `numero` est déjà affiché à côté.
  const nom = t !== '' ? t : tigeDossier(slug);
  const n = String(numero === undefined || numero === null ? '' : numero);
  return n !== '' ? n + SEPARATEUR_LIBELLE + nom : nom;
}

// ---- Les images d'un article -----------------------------------------------------
//
// Pour la carte de l'article : combien d'images il porte, et lesquelles ne sont pas prêtes.
// Les descripteurs sont ceux que lit le gestionnaire des médias ; ce module les compte.
// Les portraits des auteurs vivent dans portraits/ et n'entrent pas dans ce compte, qui ne
// porte que sur media/.
//
// Deux absences ne sont pas des défauts :
//   * une image décorative (alt="" volontaire, soit `altDefini` vrai et `alt` vide) n'a pas
//     de texte alternatif ;
//   * une image « sans légende ni numéro » (horsFigure) n'a pas de légende.
// Sont signalées : une image informative sans texte alternatif, et une figure sans légende.
function decorativeImage(image) {
  const i = image || {};
  return !!i.altDefini && String(i.alt || '').trim() === '';
}

// -> { total, sansAlt, sansLegende, horsFigure, decoratives }
function resumeImages(images) {
  const liste = Array.isArray(images) ? images : [];
  const r = { total: liste.length, sansAlt: 0, sansLegende: 0, horsFigure: 0, decoratives: 0 };
  for (const image of liste) {
    const i = image || {};
    if (decorativeImage(i)) { r.decoratives++; }
    else if (String(i.alt || '').trim() === '') { r.sansAlt++; }
    if (i.horsFigure) { r.horsFigure++; }
    else if (String(i.legende || '').trim() === '') { r.sansLegende++; }
  }
  return r;
}

// ---- Tâches éditoriales : les définitions ----------------------------------------

// Les tâches par défaut, dans les deux langues du cockpit. L'allemand est en orthographe
// suisse.
const TACHES_DEFAUT = [
  { id: 'version-finale', fr: 'version finale', de: 'Endfassung' },
  { id: 'traductions-terminees', fr: 'traductions terminées', de: 'Übersetzungen abgeschlossen' },
  { id: 'contraste-alternatif', fr: 'contraste et texte alternatif', de: 'Kontrast und Alternativtext' },
  { id: 'envoi-auteurs', fr: 'envoi de la version finale aux autrices et auteurs',
    de: 'Versand der Endfassung an die Autorinnen und Autoren' }
];

// Une liste par revue : chaque rédaction a son propre processus. Jetons de lib/yaml.js.
const REVUES_TACHES = ['revue', 'zeitschrift'];
const CLE_TACHES = 'tachesArticle';

// Nombre de tâches par revue, borné : la liste s'affiche sur chaque carte.
const MAX_TACHES = 20;
const LONGUEUR_MAX_TACHE = 80;

// Identifiant d'une tâche, écrit dans le .taches.yaml de l'article : seulement ce qu'un
// YAML nu accepte. Il est dérivé une fois, à la création, puis conservé : changer
// l'identifiant décocherait la tâche, changer l'intitulé ne perd rien.
const FORME_ID_TACHE = /^[a-z0-9][a-z0-9-]*$/;

function idTache(brut) {
  const s = String(brut === undefined || brut === null ? '' : brut)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return FORME_ID_TACHE.test(s) ? s : '';
}

// Nettoie une liste venue de config.json ou du panneau : identifiants valides, uniques,
// intitulés bornés, au plus MAX_TACHES. Une tâche nommée dans une seule langue est gardée.
function normaliserTaches(liste) {
  const sortie = [];
  const vus = Object.create(null);
  for (const brute of (Array.isArray(liste) ? liste : [])) {
    if (!brute || typeof brute !== 'object') { continue; }
    const fr = String(brute.fr || '').replace(/[\r\n]+/g, ' ').trim().slice(0, LONGUEUR_MAX_TACHE);
    const de = String(brute.de || '').replace(/[\r\n]+/g, ' ').trim().slice(0, LONGUEUR_MAX_TACHE);
    // L'identifiant se dérive de l'intitulé seulement quand il manque : une tâche existante
    // garde le sien, sinon la corriger décocherait tous les articles.
    const id = idTache(brute.id) || idTache(fr) || idTache(de);
    if (id === '' || vus[id]) { continue; }
    if (fr === '' && de === '') { continue; }
    vus[id] = true;
    sortie.push({ id: id, fr: fr, de: de });
    if (sortie.length >= MAX_TACHES) { break; }
  }
  return sortie;
}

// Les définitions des deux revues lues dans config.json, avec les tâches par défaut pour
// une revue sans liste. La table a toujours ses deux revues.
function tachesConfig(cfg) {
  const brut = (cfg && typeof cfg[CLE_TACHES] === 'object' && cfg[CLE_TACHES]) || {};
  const table = {};
  for (const revue of REVUES_TACHES) {
    const liste = normaliserTaches(brut[revue]);
    table[revue] = liste.length > 0 ? liste : TACHES_DEFAUT.map((t) => Object.assign({}, t));
  }
  return table;
}

// Les tâches d'une revue. Une revue inconnue (ausgabe.yaml sans clé `revue`) reçoit les
// tâches par défaut.
function tachesRevue(cfg, revue) {
  const table = tachesConfig(cfg);
  const cle = String(revue === undefined || revue === null ? '' : revue).toLowerCase();
  return table[cle] || TACHES_DEFAUT.map((t) => Object.assign({}, t));
}

// Pose la liste d'une revue sans toucher au reste de config.json ni à l'autre revue.
function configAvecTaches(cfg, revue, liste) {
  const cle = String(revue === undefined || revue === null ? '' : revue).toLowerCase();
  if (REVUES_TACHES.indexOf(cle) === -1) { return cfg && typeof cfg === 'object' ? cfg : {}; }
  const sortie = Object.assign({}, (cfg && typeof cfg === 'object') ? cfg : {});
  const table = Object.assign({}, tachesConfig(cfg));
  table[cle] = normaliserTaches(liste);
  sortie[CLE_TACHES] = table;
  return sortie;
}

// ---- Ce que la vue « Articles » montre ou cache ----------------------------------
//
// Quatre interrupteurs d'affichage : la liste des tâches sur chaque carte, les champs
// traduits de l'aperçu, l'aperçu des métadonnées, et ses avertissements. Ils ne cachent
// qu'à l'écran.
//
// Ils vivent dans config.json : la mise à jour du poste réécrit les réglages de l'éditeur
// en entier (voir configAvecLangue dans lib/archivage.js).
const CLE_VUE_ARTICLES = 'vueArticles';

// -> { cacherTaches, cacherTraductions, cacherMeta, cacherConstats }, toujours des
// booléens. Une configuration absente ou illisible montre tout.
function vueArticlesConfig(cfg) {
  const brut = (cfg && typeof cfg === 'object' && cfg[CLE_VUE_ARTICLES]) || {};
  return {
    cacherTaches: brut.cacherTaches === true,
    cacherTraductions: brut.cacherTraductions === true,
    cacherMeta: brut.cacherMeta === true,
    cacherConstats: brut.cacherConstats === true
  };
}

// Bascule un des quatre interrupteurs sans toucher au reste de config.json ; l'appelant
// écrit le résultat avec ecrireConfigPoste. Une clé inconnue ne change rien.
function configAvecVueArticles(cfg, cle, valeur) {
  const sortie = Object.assign({}, (cfg && typeof cfg === 'object') ? cfg : {});
  const etat = vueArticlesConfig(cfg);
  if (!(cle in etat)) { return sortie; }
  etat[cle] = valeur === true;
  sortie[CLE_VUE_ARTICLES] = etat;
  return sortie;
}

// L'intitulé dans la langue de l'interface, sinon dans l'autre, sinon l'identifiant.
function libelleTache(tache, langue) {
  const t = tache || {};
  const prefere = langue === 'de' ? 'de' : 'fr';
  const autre = prefere === 'de' ? 'fr' : 'de';
  return String(t[prefere] || '').trim() || String(t[autre] || '').trim() || String(t.id || '');
}

// ---- Tâches éditoriales : l'état coché -------------------------------------------
//
// Fichier articles/<slug>/<slug>.taches.yaml : ni publié, ni exporté, ignoré du Makefile.
//
//   faites:
//   - version-finale
//   - traductions-terminees

const ENTETE_TACHES = '# Tâches de l’article — état de travail interne au cockpit.\n' +
  '# Ni publié, ni exporté vers OJS : le Makefile ne lit que <article>.meta.yaml.\n' +
  '# Édité par la vue « Articles ». Les intitulés des tâches, eux, sont un réglage de\n' +
  '# revue et vivent dans C:\\ProgramData\\SZH\\config.json.\n';

// -> { faites: [ids], _inconnues: [lignes brutes] }. Une clé inconnue est restituée telle
// quelle à l'écriture.
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

// Rend '' quand il n'y a plus rien à retenir : l'appelant supprime alors le fichier.
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

// Pour la carte : combien de tâches sont faites sur combien, et si tout est fait. Seules
// les tâches encore définies comptent.
function resumeTaches(taches, faites) {
  const definies = (taches || []).map((t) => String(t.id));
  const cochees = new Set((faites || []).map((f) => String(f)));
  let n = 0;
  for (const id of definies) { if (cochees.has(id)) { n++; } }
  return { faites: n, total: definies.length, toutes: definies.length > 0 && n === definies.length };
}

// Bascule une tâche dans la liste des faites, en n'y laissant que des tâches définies.
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
  // Dans l'ordre des définitions, comme la liste s'affiche.
  return (taches || []).map((t) => String(t.id)).filter((id2) => sortie.indexOf(id2) !== -1);
}

// ---- Couverture du numéro --------------------------------------------------------
//
// Copie de NOMS_COUVERTURE de lib/export-ojs.js, que ce module pur ne peut pas importer.
// test/js/articles.test.js vérifie que les deux listes sont égales.
const NOMS_COUVERTURE = ['couverture.jpg', 'couverture.jpeg', 'couverture.png'];

// Extension -> nom du fichier. Un .jpeg est écrit en couverture.jpg, le premier nom que
// l'export essaie, pour qu'il n'y ait qu'un fichier de couverture.
const EXTENSIONS_COUVERTURE = { jpg: 'couverture.jpg', jpeg: 'couverture.jpg', png: 'couverture.png' };

function nomCouverture(nomFichier) {
  const ext = (String(nomFichier || '').match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
  return EXTENSIONS_COUVERTURE[ext] || '';
}

// Taille maximale d'une couverture : son aperçu voyage en base64 dans un postMessage.
const MAX_COUVERTURE = 12 * 1024 * 1024;

module.exports = {
  CLE_ORDRE, CLE_SANS_DOI, FORME_SLUG, analyserOrdre, ordonnerArticles, deplacerArticle, prefixeOrdre,
  prefixeDossier, tigeDossier,
  analyserSansDoi, basculerSansDoi, trierParDoi, refusDeplacement, rangDoi,
  resumeImages, decorativeImage,
  titreFiche, libelleArticle, SEPARATEUR_LIBELLE,
  TACHES_DEFAUT, REVUES_TACHES, CLE_TACHES, MAX_TACHES, LONGUEUR_MAX_TACHE,
  idTache, normaliserTaches, tachesConfig, tachesRevue, configAvecTaches, libelleTache,
  CLE_VUE_ARTICLES, vueArticlesConfig, configAvecVueArticles,
  ENTETE_TACHES, analyserTachesFaites, serialiserTachesFaites, resumeTaches, basculerTache,
  NOMS_COUVERTURE, EXTENSIONS_COUVERTURE, nomCouverture, MAX_COUVERTURE
};
