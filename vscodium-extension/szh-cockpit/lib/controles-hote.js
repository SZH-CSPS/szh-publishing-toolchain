// Contrôles de la compilation : les constats de la chaîne et des actions qui ne passent pas
// par elle, la vue « À corriger », le compteur et le badge PDF/UA de la barre d'état, et le
// voile « Analyse en cours… ».
//
// Les tâches sont en `reveal: never` (`silent` ouvrirait le terminal dès un échec) et
// écrivent leur sortie dans <numéro>/.szh-journal.log (vscodium-user/tasks.json) ;
// lib/journal.js la traduit en constats. Ce module les relit à la fin de chaque tâche, les
// annonce une fois et les garde à portée de clic.
//
// Affichage : la vue est la vue d'ensemble des autres sections (media/vue-ensemble.*,
// SZH.listeCartes, ouverte par extension.js), l'avis est une notification de l'éditeur, et
// le compteur un élément de la barre d'état.
//
// La validation PDF/UA en arrière-plan (lib/pdfua-hote.js) ne passe pas par une tâche, mais
// son état rejoint le même compteur et la même vue : voir pdfuaHote.constats() et le badge
// par article (majBadgePdfUa).
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { T, TL, TP, langueCockpit } = require('./i18n');
const { MSG } = require('./messages');
const profils = require('./profil');
const pdfuaHote = require('./pdfua-hote');
const paginationHote = require('./pagination-hote');
// La table des constats : ce qu'un défaut ferme, où on va le corriger, comment il s'écrit.
const tableConstats = require('./constats');
// L'alignement des dossiers d'article sur leur rang affiché : le plan et son exécution.
const renumerotation = require('./renumerotation-fs');
const { analyserJournal, resumeJournal, slugsCompiles, sansResumePdfUaRedondant } = require('./journal');
const { focusDeRepli } = require('./reperage-focus');
const { analyserTable } = require('./table-model');
const { imagesSansAlternative } = require('./references');
const { differer } = require('./interaction');
const compteurs = require('./compteurs');
const rapportErreur = require('./rapport-erreur');
const courriel = require('./courriel');
const { analyserMeta, langueRevue } = require('./yaml');
const { libelleArticle, prefixeDossier, titreFiche } = require('./articles');
const { slugifierArticle } = require('./slug');

// ---- Rappels vers l'hôte ----------------------------------------------------------
// Posés par extension.js. Les valeurs par défaut permettent à un test de charger ce module
// seul.
let ctx = {
  // Le contexte de l'extension, posé par activate() : les constats fermés et les slugs
  // retirés s'écrivent dans son globalState. Avant activate(), il est nul, et tous les
  // constats s'affichent.
  etatPoste: () => null,
  // L'uri du .md que l'arbre marque ouvert, ou null.
  articleOuvert: () => null,
  slugArticleContenant: () => null,
  relancerCompilation: () => {},
  // La vue « À corriger », si elle est ouverte : la renvoyer en entier, ou lui pousser un
  // message ANALYSE.
  rafraichirVueControles: () => {},
  pousserAnalyseControles: () => {}
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

function profilCourant() { return profils.courant(); }
function dossierUnites() { return profilCourant().unites.dossier; }

// Le nom d'un article tel que la vue Articles l'écrit : « 03 · Titre », le slug en repli.
function nomArticle(racine, slug) {
  let meta = null;
  try { meta = analyserMeta(fs.readFileSync(profils.chemins(profilCourant(), racine, slug).meta, 'utf8')); }
  catch (e) { meta = null; }
  return libelleArticle(prefixeDossier(slug), slug, titreFiche(meta, langueRevue(racine)));
}

// Aligne les dossiers d'article sur une liste de rangs, et range ce que le renommage
// périme. Deux appelants : « Terminer », avec l'ordre voulu à l'écran, et la suppression
// d'un article, avec ce qui reste.
// -> { erreur, renommes }, tel que lib/renumerotation-fs.js le rend.
function alignerDossiersSurOrdre(racine, voulu) {
  // Les dossiers d'avant : ce qui aura disparu après le renommage est retenu comme retiré
  // (retenirSlugsRetires), pour que plus rien ne s'affiche sous ces noms-là.
  const avant = slugsUnitesPresents(racine);
  // config/cle : le fichier et la clé où « Terminer » écrit l'ordre (ausgabe.yaml pour une
  // revue, buch.yaml pour un livre). Sans eux, ecrireOrdre() (lib/renumerotation-fs.js)
  // prendrait le défaut de la revue et créerait un ausgabe.yaml dans un livre.
  const r = renumerotation.renumeroter(racine, voulu,
    { dossier: dossierUnites(), config: profilCourant().config, cle: profilCourant().unites.ordre });
  // Les constats nomment les anciens slugs : ils sont périmés pour les articles renommés,
  // et la prochaine compilation les reposera sous leur nouveau nom.
  if (r.renommes > 0 && journal.racine === racine) {
    journal.sources.set('chaine', []);
  }
  // Ce qui n'est plus sur le disque : les anciens noms d'un renommage et, la suppression
  // passant aussi par ici, tout slug qu'un constat ou le journal nomme encore sans qu'aucun
  // dossier ne le porte. Retenus d'une session à l'autre : .szh-journal.log n'est pas
  // réécrit, et c'est à la lecture que constatsAffichables() les écarte.
  const apres = slugsUnitesPresents(racine);
  if (apres !== null) {
    const nommes = new Set(avant || []);
    const sources = [lireJournalTache(racine)];
    if (journal.racine === racine) {
      for (const liste of journal.sources.values()) { sources.push(liste); }
    }
    for (const liste of sources) { for (const c of liste) { if (c && c.slug) { nommes.add(c.slug); } } }
    retenirSlugsRetires(racine, Array.from(nommes).filter((s) => !apres.has(s)));
    // Les sources à part (réimport, refus d'export, pagination) ne se reposent pas à la
    // compilation suivante : elles sont nettoyées ici.
    if (journal.racine === racine) {
      const vivant = (c) => !c || !c.slug || apres.has(c.slug);
      for (const source of ['reimport', 'export', 'pagination']) {
        if (journal.sources.has(source)) { journal.sources.set(source, journal.sources.get(source).filter(vivant)); }
      }
    }
  }
  // Les verdicts PDF/UA en cache (.szh-pdfua.json) : migrés sous le nouveau nom si le PDF
  // est encore le même, oubliés sinon. Aussi après une suppression sans renommage, pour que
  // le verdict de l'article retiré parte avec lui.
  pdfuaHote.purgerAbsents(racine);
  if (journal.racine === racine) { majBarreControles(); }
  return r;
}

// ---- Les slugs retirés : les noms qu'un article a quittés -------------------------
//
// { <racine>: [slug…] } dans globalState, borné comme les constats fermés. Un nom retiré
// qui revient sur le disque (nouvel article, renommage inverse) redevient visible : le
// filtre exige « retiré » et « absent du disque ».
//
// Une liste explicite plutôt que « tout slug sans dossier » : un constat peut nommer ce qui
// n'a jamais été un dossier de ce numéro (un Word pas encore converti), et le taire
// cacherait ce qu'il dit. Seul ce qu'on a vu partir est écarté.
const CLE_SLUGS_RETIRES = 'szh.slugs.retires';
const MAX_SLUGS_RETIRES = 200;
// Sans globalState (avant activate) : la même table, en mémoire seulement.
const slugsRetiresMemoire = new Map();

function slugsRetires(racine) {
  if (!racine) { return new Set(); }
  const etatPoste = ctx.etatPoste();
  if (etatPoste) {
    const table = etatPoste.globalState.get(CLE_SLUGS_RETIRES) || {};
    const liste = table && Array.isArray(table[racine]) ? table[racine] : [];
    return new Set(liste.map(String));
  }
  return new Set(slugsRetiresMemoire.get(racine) || []);
}

function retenirSlugsRetires(racine, slugs) {
  if (!racine || !slugs || slugs.length === 0) { return; }
  const deja = slugsRetires(racine);
  const neufs = slugs.map(String).filter((s) => s !== '' && !deja.has(s));
  if (neufs.length === 0) { return; }
  const liste = Array.from(deja).concat(neufs);
  const borne = liste.slice(Math.max(0, liste.length - MAX_SLUGS_RETIRES));
  slugsRetiresMemoire.set(racine, borne);
  const etatPoste = ctx.etatPoste();
  if (etatPoste) {
    const table = Object.assign({}, etatPoste.globalState.get(CLE_SLUGS_RETIRES) || {});
    table[racine] = borne;
    // Sans attendre : la mémoire ci-dessus répond déjà. Un échec d'écriture laisse seulement
    // revenir, au redémarrage, un constat que la prochaine compilation effacera.
    Promise.resolve(etatPoste.globalState.update(CLE_SLUGS_RETIRES, table)).catch(() => {});
  }
}

const JOURNAL_TACHE = '.szh-journal.log';

// Le dernier journal lu, par racine de numéro : la barre d'état et la vue le relisent sans
// recompiler.
//
// Une liste par source. « chaine » est ce que .szh-journal.log a dit ; les autres ne passent
// pas par une tâche, et la recompilation suivante les effacerait si elles y étaient mêlées :
// « reimport » (l'action que le rédacteur vient de faire), « export » (les refus du dernier
// export) et « pagination » (la vérification en arrière-plan). Une source jamais posée vaut
// une liste vide.
let journal = { racine: null, sources: new Map() };

// L'ordre d'affichage : ce qui vient d'une action du rédacteur passe devant la chaîne.
const ORDRE_SOURCES = ['export', 'reimport', 'pagination', 'chaine'];

// Les sources du numéro `racine`, repartant de son journal si l'on changeait de numéro.
function sourcesDe(racine) {
  if (journal.racine !== racine) {
    journal = { racine: racine, sources: new Map([['chaine', lireJournalTache(racine)]]) };
  }
  return journal.sources;
}

// Les constats posés pour `source` sur le numéro retenu, ou [].
function constatsPoses(source) { return journal.sources.get(source) || []; }

function reunir(sources) {
  return sources.reduce((acc, s) => acc.concat(constatsPoses(s)), []);
}

// Le numéro ouvert change : ses constats sont relus de son journal, sans notification.
// -> true si le numéro a changé.
function ouvrirNumero(racine, fournisseur) {
  if (journal.racine === racine) { return false; }
  sourcesDe(racine);
  // Pagination continue : même vérification qu'après une compilation, pour que
  // l'avertissement soit là dès l'ouverture du numéro.
  controlerPagination(racine, fournisseur, 'à l’ouverture du numéro');
  return true;
}

// Pagination continue (lib/pagination-hote.js) : vérifiée en arrière-plan, seulement si le
// numéro a déjà été paginé une fois ; sinon aucun appel à la WSL pendant la rédaction. Pas
// attendue : une panne (distribution endormie, make en échec) laisse la source telle quelle
// et va dans la console.
function controlerPagination(racine, fournisseur, moment) {
  if (!racine || !fournisseur || !paginationHote.estPagine(racine)) { return; }
  paginationHote.lireEtat(racine, fournisseur.listerArticles())
    .then((etat) => { poserConstats(racine, 'pagination', paginationHote.constatsPagination(etat)); })
    .catch((e) => { console.warn('pagination : lecture de l’état ' + moment + ' : '
      + ((e && e.message) || e)); });
}

// Ce que la vue et la barre d'état ont à montrer, toutes les sources réunies, plus
// pdfua.constats() : la validation PDF/UA tourne hors tâche, ses verdicts en cache ne sont
// pas dans .szh-journal.log (lib/pdfua-hote.js).
function constatsCourants(racine) {
  const base = journal.racine !== racine ? lireJournalTache(racine) : reunir(ORDRE_SOURCES);
  return constatsAffichables(racine, base.concat(pdfuaHote.constats(racine, langueCockpit())));
}

// Les dossiers d'unité présents sur le disque, ou null quand on ne doit rien filtrer.
//
// null pour un livre : ses constats nomment souvent ce qui n'est pas un dossier (le
// manuscrit que livre-scinder.py vient de découper, le titre d'un chapitre dans
// livre-assembler.py), et les écarter cacherait ce qu'ils disent. null aussi quand le
// dossier ne se lit pas (OneDrive hors ligne, droits).
//
// Les sous-dossiers bruts, et non listerArticles() : un dossier encore sans .md (import en
// cours, page de Documentation) garde ses constats.
function slugsUnitesPresents(racine) {
  if (!racine || profilCourant().cle === 'livre') { return null; }
  try {
    return new Set(fs.readdirSync(path.join(racine, dossierUnites()), { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name));
  } catch (e) { return null; }
}

// Les slugs des Word du dépôt, tels que l'import les nommerait ; null s'il ne se lit pas.
function slugsWordEnAttente(racine) {
  try {
    return new Set(fs.readdirSync(path.join(racine, profilCourant().depot), { withFileTypes: true })
      .filter((e) => e.isFile() && /\.(docx|odt)$/i.test(e.name))
      .map((e) => slugifierArticle(e.name)));
  } catch (e) { return null; }
}

// Un constat de l'import dont l'article n'existe pas et dont le Word a quitté le dépôt :
// l'import a été refusé, puis le Word abandonné. Il n'y a plus rien à corriger.
function importSansWord(c, words) {
  return words !== null && (c.source === 'import' || c.origine === 'import') && !words.has(c.slug);
}

// Ce que « À corriger » et la barre d'état peuvent montrer d'une liste de constats. Deux
// règles, appliquées là où toutes les sources se rejoignent :
//
//   * aucun constat d'un article qui n'existe plus. Un article renommé (« 01-x » devenu
//     « 03-x » par « Terminer ») ou supprimé garderait sinon ses défauts sous son ancien
//     nom (relus de .szh-journal.log, ou gardés en mémoire par un réimport ou un export).
//     Chaque source a son propre nettoyage (alignerDossiersSurOrdre,
//     pdfuaHote.purgerAbsents) ; ce filtre vaut pour toutes. Est écarté ce qui porte un nom
//     qu'un article a quitté (slugsRetires) et qu'aucun dossier ne porte aujourd'hui. Un
//     constat du numéro entier (slug vide) n'est pas concerné, un livre non plus
//     (slugsUnitesPresents). Les verdicts PDF/UA sont déjà filtrés sur la liste réelle des
//     articles dans pdfuaHote.constats().
//   * pas de résumé PDF/UA quand ses règles suivent (journal.sansResumePdfUaRedondant) : le
//     cache et le journal d'un export parlent souvent du même PDF, d'où ce tri sur la liste
//     réunie.
function constatsAffichables(racine, constats) {
  const presents = slugsUnitesPresents(racine);
  const retires = presents === null ? null : slugsRetires(racine);
  const words = presents === null ? null : slugsWordEnAttente(racine);
  const vivants = constats.filter((c) => !c || !c.slug || presents === null || presents.has(c.slug)
    || (!(retires && retires.has(c.slug)) && !importSansWord(c, words)));
  return sansResumePdfUaRedondant(vivants);
}

// Les points qui ont fait refuser le dernier export, une carte chacun. Ils restent dans la
// liste « À corriger » jusqu'au prochain export ; un export réussi les efface.
//
// Le lieu dépend de la raison : les points de configuration ouvrent la liste
// (szhBloquantsConfig en donne le compte) et mènent aux réglages ; les autres nomment leur
// article en tête de phrase et mènent à sa fiche.
function constatsExport(liste, nConfig) {
  return (liste || []).map((brut, i) => {
    const m = String(brut).match(/^articles\/([^\s:]+)\s*:\s*([\s\S]*)$/);
    const slug = m ? m[1] : '';
    return { source: 'export', code: 'refus', ton: 'danger', cle: '', args: [],
             champs: { raison: m ? m[2] : String(brut) }, slug: slug,
             lieu: i < nConfig ? 'reglages' : (slug === '' ? '' : 'fiche'),
             brut: String(brut) };
  });
}

// Pose ou efface les constats d'une source : la nouvelle liste remplace celle de cette
// source seulement. Deux réimports successifs ne se cumulent pas ; la pagination (vérifiée
// en arrière-plan après la compilation d'un numéro déjà paginé, ou à son ouverture) est
// remplacée en bloc à chaque relecture.
function poserConstats(racine, source, liste) {
  sourcesDe(racine).set(source, liste || []);
  majBarreControles();
}

function poserConstatsExport(racine, liste, nConfig) {
  poserConstats(racine, 'export', constatsExport(liste, nConfig || 0));
}

function lireJournalTache(racine) {
  if (!racine) { return []; }
  let texte = '';
  try { texte = fs.readFileSync(path.join(racine, JOURNAL_TACHE), 'utf8'); }
  catch (e) { return []; }                           // aucune compilation depuis l'ouverture
  return analyserJournal(texte, langueCockpit());
}

// Le texte brut du dernier journal, pour savoir quels articles la compilation a traversés.
function texteJournalTache(racine) {
  if (!racine) { return ''; }
  try { return fs.readFileSync(path.join(racine, JOURNAL_TACHE), 'utf8'); }
  catch (e) { return ''; }
}

// Les constats du dernier passage, plus ceux des articles que ce passage n'a pas touchés.
//
// `make` est incrémental et la tâche réécrit le journal : enregistrer un seul article donne
// un journal qui ne parle que de lui. Remplacer tous les constats par les siens ferait
// disparaître les défauts des autres articles, qui tiennent toujours.
//
// Ne sont donc jetés que les constats des articles recompilés (slugsCompiles) : un défaut
// corrigé s'en va au passage suivant sur son article, un défaut non retouché reste. Les
// constats du numéro entier (slug vide) sont toujours remplacés.
// Un article est « traversé » s'il a sa ligne de pandoc, ou si le nouveau journal parle de
// lui : une vérification qui échoue avant pandoc (titre vide, dossier à espaces) écrit son
// constat sans compilation. Sans ce second cas, le même défaut se compterait deux fois.
function fusionnerConstats(racine, neufs) {
  if (journal.racine !== racine) { return neufs; }
  const traverses = slugsCompiles(texteJournalTache(racine));
  for (const c of neufs) { if (c.slug !== '') { traverses.add(c.slug); } }
  const gardes = constatsPoses('chaine').filter(
    (c) => c.slug !== '' && !traverses.has(c.slug));
  return gardes.concat(neufs);
}

// Le titre de section, par gravité.
const GROUPE_GRAVITE = {
  bloquant: 'ctl.groupe.bloquant', avert: 'ctl.groupe.avert', info: 'ctl.groupe.info'
};

const SOURCES_CONSTAT = {
  citations: 'ctl.source.citations', import: 'ctl.source.import', meta: 'ctl.source.meta',
  pdfua: 'ctl.source.pdfua', pipeline: 'ctl.source.pipeline', rendu: 'ctl.source.rendu',
  // szh-typographie.lua (« ß », guillemets droits, majuscule non accentuée) et
  // szh-metafichier.lua (images natives Word).
  typo: 'ctl.source.typo', metafichier: 'ctl.source.metafichier',
  // pipeline/livre-scinder.py, appelé par la cible `import` du Makefile pour un livre. Ses
  // lignes « [scission-avertissement] » passent par le préfixe générique « <source>-<ton> »
  // que familleCode() de lib/journal.js reconnaît ; sans cette étiquette, la carte
  // s'afficherait sous « ctl.source.pipeline ».
  scission: 'ctl.source.scission',
  // szh-numerotation.lua : l'image sans texte alternatif ni légende (« figure-sans-alt »),
  // déjà montrée dans l'encadré « lecteur d'écran » de l'aperçu.
  numerotation: 'ctl.source.numerotation',
  // pipeline/pagination.py, lancé par `make pdf` sur un numéro déjà paginé : ses lignes
  // « [pagination-avertissement] » passent par le même préfixe générique que « scission ».
  pagination: 'ctl.source.pagination'
};

// Ce dont lib/constats.js a besoin pour décider si une barrière est vraiment fermée : la
// validation PDF/UA est un réglage, et là où elle est éteinte, une image sans description
// ne fait plus échouer de PDF.
function contexteConstats() {
  return { pdfua: pdfuaHote.reglageActif() };
}

// Les destinations qui parlent d'un article : un constat peut nommer un Word qui n'est
// jamais devenu un article, et le bouton n'est alors pas posé. Aussi « pdf »
// (szh.voirPdfArticle) : avec un slug vide, cibleTraduction retombe sur l'article actif ou
// en aperçu, et le bouton ouvrirait le PDF d'un autre article. Et « table »
// (szh.editerTable) : l'éditeur ne s'ouvre que sur un tableau d'un article existant.
const LIEUX_ARTICLE = new Set(['article', 'fiche', 'medias', 'pdf', 'table']);

// Le bouton d'un constat, ou aucun. L'identifiant porte la destination et l'objet à
// atteindre (« medias:fig-01.png ») : la page le renvoie tel quel, et l'hôte n'a pas à
// retrouver de quel constat venait le clic, ce qui serait ambigu quand deux défauts du même
// article visent le même formulaire.
function actionsConstat(constat, connus) {
  const cible = tableConstats.cible(constat);
  if (!cible) { return []; }
  if (LIEUX_ARTICLE.has(cible.lieu) && !(cible.slug !== '' && connus.has(cible.slug))) {
    return [];
  }
  const lieu = tableConstats.LIEUX[cible.lieu];
  return [{ id: cible.lieu + (cible.focus === '' ? '' : ':' + cible.focus),
            libelle: T(lieu.libelle), icone: lieu.icone, tip: T(lieu.tip) }];
}

// Le clic sur le bouton d'un constat : « <lieu>:<objet> », tel que actionsConstat l'a formé
// et que la page l'a renvoyé. Une seule fonction pour toutes les destinations.
//
// `focus` dit à la page visée ce qu'elle doit amener à l'écran : le formulaire des médias
// déplie l'image nommée et pose le curseur là où il y a quelque chose à écrire ; les
// commandes qui ne le lisent pas l'ignorent.
async function ouvrirCible(id, cle) {
  const sep = id.indexOf(':');
  const lieu = sep === -1 ? id : id.slice(0, sep);
  const focus = sep === -1 ? '' : id.slice(sep + 1);
  const entree = tableConstats.LIEUX[lieu];
  if (!entree) { return; }
  await vscode.commands.executeCommand(entree.commande, { slug: String(cle || ''), focus: focus });
}

// Les défauts dont la seule consigne est de les signaler : la chaîne est en cause, et
// l'application ne les corrige pas. « signaler:<source>/<code>:<slug> » porte de quoi
// retrouver le constat, comme le bouton d'un lieu porte son objet.
const PREFIXE_SIGNALER = 'signaler:';

function actionSignaler(constat) {
  const cle = String(constat.source || '') + '/' + String(constat.code || '');
  const s = tableConstats.SECOND_ETAGE[cle];
  if (cle !== 'cockpit/compilation-echec' && !(s && s.consigne === 'consigne.signaler')) { return null; }
  return { id: PREFIXE_SIGNALER + cle + ':' + String(constat.slug || ''),
           libelle: T('ctl.signaler'), icone: 'fleche', tip: T('ctl.signaler.tip') };
}

// Le clic sur « Signaler » : un rapport COCKPIT-SIGNALEMENT (lib/rapport-erreur.js) qui
// nomme le contrôle et l'article, avec la fin du journal. Ni la phrase du constat ni son
// texte brut, qui peuvent citer l'article (docs/RAPPORTS-ERREUR.md).
// -> ce que la barre de la vue dit, selon ce qui a vraiment eu lieu.
function signalerConstat(fournisseur, id) {
  const reste = id.slice(PREFIXE_SIGNALER.length);
  const sep = reste.lastIndexOf(':');
  const cle = sep === -1 ? reste : reste.slice(0, sep);
  const slug = sep === -1 ? '' : reste.slice(sep + 1);
  const racine = fournisseur.racine;
  const constat = constatsCourants(racine).find((c) => c && (c.source + '/' + c.code) === cle
    && String(c.slug || '') === slug)
    || { source: cle.split('/')[0], code: cle.split('/').slice(1).join('/'), ton: null, slug: slug };
  const r = rapportErreur.emettreRapport({
    gravite: 'erreur', source: 'cockpit', code: 'COCKPIT-SIGNALEMENT', etape: cle,
    message: 'Signalé depuis les contrôles : ' + cle + (slug === '' ? '' : ', article ' + slug) + '.',
    produit: rapportErreur.produitDepuisRacine(racine, profilCourant().cle),
    journal: rapportErreur.lireExtraitFichier(path.join(racine, JOURNAL_TACHE)),
    constats: [constat],
    langueInterface: langueCockpit(), vscodiumVersion: vscode.version || null
  });
  // Le support est prévenu par un brouillon de courriel qui nomme le fichier du rapport.
  const rapport = r.chemin || (r.etouffe ? T('ctl.support.rapport.deja', [r.id || ''])
    : T('ctl.support.rapport.absent'));
  const brouillon = courriel.brouillonSupport(langueCockpit(), {
    poste: os.hostname(), numero: path.basename(racine), controle: cle, article: slug, rapport: rapport
  });
  try { vscode.env.openExternal(vscode.Uri.parse(courriel.uriMailto(brouillon))); }
  catch (e) { /* sans client de messagerie, le rapport reste écrit */ }
  if (r.ecrit) { return T('ctl.signaler.fait'); }
  if (r.enAttente) { return T('ctl.signaler.attente'); }
  if (r.etouffe) { return T('ctl.signaler.deja'); }
  return T('ctl.signaler.refuse');
}

// Un bouton de carte ou de constat de la vue « Contrôles » : `cle` est le slug de la carte.
// -> le message à afficher dans la barre de la vue, ou null.
async function actionControles(fournisseur, id, cle) {
  if (id.indexOf(PREFIXE_SIGNALER) === 0) { return signalerConstat(fournisseur, id); }
  if (id === 'recompiler-article') {
    const slug = String(cle || '');
    if (slug !== '' && fournisseur.listerArticles().indexOf(slug) !== -1) {
      ctx.relancerCompilation(fournisseur, slug);
    }
    return null;
  }
  await ouvrirCible(id, cle);
  return null;
}

// Le second étage d'un message de la vue « À corriger » (lib/constats.js, SECOND_ETAGE) :
// le titre seul, les objets en cause (un lien chacun, de même forme d'identifiant que le
// bouton : « medias:fig-01.png », « table:table-02.html »), la phrase d'action, et
// l'explication en infobulle. `pourquoi` est le libellé du bouton qui la déplie.
// -> { titre, elements, consigne, infobulle, pourquoi }, à fusionner dans le message.
function habillageConstat(constat, connus, langue) {
  const slug = String((constat && constat.slug) || '');
  const elements = tableConstats.elements(constat, langue)
    .filter((el) => tableConstats.LIEUX[el.lieu]
      && !(LIEUX_ARTICLE.has(el.lieu) && !(slug !== '' && connus.has(slug))))
    .map((el) => ({ libelle: el.libelle, id: el.lieu + (el.focus === '' ? '' : ':' + el.focus),
                    tip: TL(langue, tableConstats.LIEUX[el.lieu].tip) }));
  return {
    titre: tableConstats.phrase(constat, langue),
    elements: elements,
    consigne: tableConstats.consigne(constat, langue),
    infobulle: tableConstats.infobulle(constat, langue),
    pourquoi: TL(langue, 'ctl.pourquoi')
  };
}

// Ce qu'un tableau de l'article a d'illisible pour un lecteur d'écran, ou '' s'il va bien.
// « sans-entete » : aucune ligne ni colonne d'en-tête déclarée. « fusion » : une cellule
// d'en-tête couvre plusieurs colonnes ou rangées ; WeasyPrint ne l'inscrit qu'à sa première
// colonne et ignore l'attribut headers, si bien que les colonnes suivantes sortent sans
// en-tête (règle 7.5-1) alors que le tableau en déclare un.
function defautTableau(html) {
  let m;
  try { m = analyserTable(html); } catch (e) { return ''; }
  const a = (m && m.attrs) || {};
  if (!(a.enteteLignes > 0) && !(a.enteteColonnes > 0)) { return 'sans-entete'; }
  for (const l of (m.lignes || [])) {
    for (const c of (l.cellules || [])) {
      if (c.th && ((c.colspan || 1) > 1 || (c.rowspan || 1) > 1)) { return 'fusion'; }
    }
  }
  return '';
}

// Une case d'en-tête (th) sans intitulé : ni texte, ni image. Le coin en haut à gauche d'un
// tableau croisé en est le cas le plus fréquent. Le contenu est celui qu'analyserTable
// normalise (HTML en ligne) : on en retire les balises et les espaces, insécables compris.
function aUneCaseEnteteVide(html) {
  let m;
  try { m = analyserTable(html); } catch (e) { return false; }
  for (const l of ((m && m.lignes) || [])) {
    for (const c of (l.cellules || [])) {
      if (!c.th) { continue; }
      const contenu = String(c.contenu || '');
      if (/<img\b/i.test(contenu)) { continue; }
      const nu = contenu.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;|&#xa0;/gi, '')
        .replace(/[\s   ]+/g, '');
      if (nu === '') { return true; }
    }
  }
  return false;
}

// Les images sans nom accessible posées dans un tableau HTML de l'article : le .md ne les
// contient pas (imagesSansAlternative ne lit que lui), mais le validateur les relève. Par
// exemple le bloc des auteurs, un tableau qui porte un portrait en alt="".
// -> [{ image, table }]
function imagesMuettesDesTableaux(tables) {
  const res = [];
  for (const t of tables) {
    const re = /<img\b([^>]*)>/gi;
    let m;
    while ((m = re.exec(String(t.html || ''))) !== null) {
      const alt = m[1].match(/\balt\s*=\s*("([^"]*)"|'([^']*)')/i);
      const valeur = alt ? (alt[2] !== undefined ? alt[2] : alt[3]) : null;
      if (valeur !== null && valeur.trim() !== '') { continue; }
      const src = m[1].match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i);
      const chemin = src ? (src[2] !== undefined ? src[2] : src[3]) : '';
      res.push({ image: path.basename(chemin.replace(/\\/g, '/')) || '?', table: t.nom });
    }
  }
  return res;
}

// Le lecteur que tableConstats.regrouper() attend, et le .md et les tableaux de chaque
// article, lus une seule fois par affichage. -> (slug) => { images, tableaux, tousTableaux,
// texteMd, tables } | null
function lecteurObjetsArticles(fournisseur) {
  const memo = new Map();
  return (slug) => {
    if (memo.has(slug)) { return memo.get(slug); }
    let lu = null;
    try {
      const dossier = path.join(fournisseur.racine, dossierUnites(), slug);
      let texteMd = '';
      try { texteMd = fs.readFileSync(path.join(dossier, slug + '.md'), 'utf8'); } catch (e) { texteMd = ''; }
      const tables = fournisseur._tablesArticle(slug).map((nom) => {
        let html = '';
        try { html = fs.readFileSync(path.join(dossier, 'tables', nom), 'utf8'); } catch (e) { html = ''; }
        return { nom: nom, html: html };
      });
      // Les noms tels qu'ils sont sur le disque : imagesSansAlternative les rend en
      // minuscules, le formulaire des médias les connaît avec leur casse.
      const surDisque = fournisseur._imagesArticle(slug);
      const vrai = (relatif) => surDisque.find((r) => r.toLowerCase() === String(relatif).toLowerCase()) || relatif;
      const images = imagesSansAlternative(texteMd)
        .filter((i) => i.relatif)
        .map((i) => { const n = vrai(i.relatif); return { nom: n, lieu: 'medias', focus: n }; })
        // Une image d'un tableau se règle dans l'éditeur de ce tableau : le focus porte le
        // fichier du tableau, puis celui de l'image après « | » (tableDuConstat le défait
        // en item.focusImage). « | » n'entre dans aucun nom de fichier sous Windows.
        .concat(imagesMuettesDesTableaux(tables).map((x) => ({
          nom: x.image, lieu: 'table', focus: x.table + '|' + x.image,
          precision: { cle: 'objet.image.tableau', args: [x.table] } })));
      const tableaux = [];
      const entetesVides = [];
      for (const t of tables) {
        const raison = t.html === '' ? '' : defautTableau(t.html);
        if (raison) { tableaux.push({ nom: t.nom, raison: raison }); }
        if (t.html !== '' && aUneCaseEnteteVide(t.html)) { entetesVides.push(t.nom); }
      }
      lu = { images: images, tableaux: tableaux, tousTableaux: tables.map((t) => t.nom),
             entetesVides: entetesVides, texteMd: texteMd, tables: tables };
    } catch (e) { lu = null; }
    memo.set(slug, lu);
    return lu;
  };
}

// Les constats tels que la vue « À corriger » les montre : les voies multiples d'un même
// défaut réunies en une carte (tableConstats.regrouper), et un endroit retrouvé dans le .md
// pour ceux qui n'en citent aucun (focusDeRepli), pour que leur flèche n'ouvre pas l'article
// en haut. Aucune écriture : le journal garde les constats d'origine.
//
// S'y ajoutent les défauts que le cockpit voit seul en lisant les tableaux de chaque
// article : une case d'en-tête vide (ambre).
function constatsPourControles(fournisseur, constats) {
  if (!fournisseur.racine) { return constats; }
  const lire = lecteurObjetsArticles(fournisseur);
  const vus = [];
  for (const slug of fournisseur.listerArticles()) {
    const lu = lire(slug);
    const c = lu ? tableConstats.constatEnteteVide(slug, lu.entetesVides) : null;
    if (c) { vus.push(c); }
  }
  return tableConstats.regrouper(constats, lire).concat(vus).map((c) => {
    if (!c || !c.slug) { return c; }
    const cible = tableConstats.cible(c);
    if (!cible || cible.lieu !== 'article' || cible.focus !== '') { return c; }
    const lu = lire(c.slug);
    const focus = lu ? focusDeRepli(c.source + '/' + c.code, c.args, lu.texteMd, lu.tables, c.champs) : '';
    return focus === '' ? c : Object.assign({}, c, {
      champs: Object.assign({}, c.champs || {}, { focusCalcule: focus }) });
  });
}

// ---- Les constats « Pour information » qu'on a fermés d'un clic -------------------
//
// Un constat gris ne demande rien : il dit qu'une chose s'est bien passée, ou qu'une
// décision a été prise à la place du rédacteur. Il a donc une croix, et lui seul (voir
// `fermable` dans lib/constats.js).
//
// On retient son empreinte (racine, article, code et phrase affichée), pas son code. Si le
// fait change (« sauf 2 paragraphes » là où il n'y en avait aucun), la phrase change,
// l'empreinte ne correspond plus, et le message revient. Rangé dans globalState : propre
// au compte, pas à la machine.
const CLE_CONSTATS_FERMES = 'szh.constats.fermes';
// La liste est bornée : les plus anciennes empreintes tombent. 400 couvre plusieurs numéros
// entiers, et une empreinte oubliée ne fait que réafficher un message gris.
const MAX_CONSTATS_FERMES = 400;

const SEP_EMPREINTE = '\u0001';   // le même qu'en lib/journal.js

function empreinteConstat(racine, constat, texte) {
  return [String(racine || ''), String((constat && constat.source) || ''),
          String((constat && constat.code) || ''), String((constat && constat.slug) || ''),
          String(texte || '')].join(SEP_EMPREINTE);
}

// La phrase que l'empreinte retient : celle que la vue affiche.
function texteConstat(c, langue) {
  const detail = tableConstats.detail(c, langue);
  return tableConstats.phrase(c, langue) + (detail === '' ? '' : ' ' + detail);
}

// Ce qui reste une fois retirés les constats fermés d'un clic : la barre d'état ne doit pas
// compter ce que la vue ne montre plus.
function sansFermes(racine, constats, contexte) {
  const fermes = constatsFermes();
  if (fermes.size === 0) { return constats; }
  const langue = langueCockpit();
  return constats.filter((c) => !(c && tableConstats.fermable(c, contexte)
    && fermes.has(empreinteConstat(racine, c, texteConstat(c, langue)))));
}

function constatsFermes() {
  const etatPoste = ctx.etatPoste();
  if (!etatPoste) { return new Set(); }
  const liste = etatPoste.globalState.get(CLE_CONSTATS_FERMES);
  return new Set(Array.isArray(liste) ? liste.map(String) : []);
}

// -> true si la liste a changé, c'est-à-dire s'il y a une vue à renvoyer.
async function fermerConstat(empreinte) {
  const cle = String(empreinte || '');
  const etatPoste = ctx.etatPoste();
  if (!etatPoste || cle === '') { return false; }
  const liste = Array.from(constatsFermes());
  if (liste.indexOf(cle) !== -1) { return false; }
  liste.push(cle);
  await etatPoste.globalState.update(CLE_CONSTATS_FERMES,
    liste.slice(Math.max(0, liste.length - MAX_CONSTATS_FERMES)));
  majBarreControles();
  return true;
}

// Une carte par article, et non une par constat : plusieurs défauts du même article se
// lisent sous un seul nom. La séparation par gravité reste : ce qui empêche de publier ne
// se range pas avec ce qui mérite un regard. Chaque défaut porte son action au bout de sa
// phrase (media/_commun.js, `messages`) ; la carte n'a ni pastille de ton ni bouton
// « Ouvrir ».
function vueControles(fournisseur) {
  const racine = fournisseur.racine;
  // Une carte par défaut, et non une par voie d'arrivée (constatsPourControles).
  const constats = constatsPourControles(fournisseur, constatsCourants(racine));
  const langue = langueCockpit();
  const connus = new Set(fournisseur.listerArticles());
  const contexte = contexteConstats();
  const fermes = constatsFermes();
  const lignes = [];
  for (const gravite of ['bloquant', 'avert', 'info']) {
    const cartes = new Map();
    for (const c of constats) {
      if (tableConstats.gravite(c, contexte) !== gravite) { continue; }
      // La phrase est calculée avant la carte : elle entre dans l'empreinte, et un message
      // fermé ne doit pas laisser une carte vide.
      const texte = texteConstat(c, langue);
      const fermable = tableConstats.fermable(c, contexte);
      const empreinte = fermable ? empreinteConstat(racine, c, texte) : '';
      if (fermable && fermes.has(empreinte)) { continue; }
      const source = T(SOURCES_CONSTAT[c.origine || c.source] || 'ctl.source.pipeline');
      let carte = cartes.get(c.slug);
      if (!carte) {
        // La clé ne vaut que sur un article qui existe encore : un constat peut nommer
        // un Word qui n'est jamais devenu un article.
        const article = c.slug !== '' && connus.has(c.slug);
        carte = {
          cle: article ? c.slug : '',
          groupe: T(GROUPE_GRAVITE[gravite]),
          titre: c.slug === '' ? T('ctl.numero')
            : (article ? nomArticle(racine, c.slug) : T('ctl.article', [c.slug])),
          meta: source,
          messages: [],
          pastilles: [], ouvrir: false,
          // Revérifier un seul article, sans vider out/ ni recompiler tout le numéro.
          actions: article ? [{ id: 'recompiler-article', icone: 'fleche',
            libelle: TP('ctl.recompiler.article', profilCourant()),
            tip: TP('ctl.recompiler.article.tip', profilCourant()) }] : []
        };
        cartes.set(c.slug, carte);
        lignes.push(carte);
      }
      // Le sous-titre n'est posé que si toute la carte vient du même contrôle.
      if (carte.meta !== source) { carte.meta = ''; }
      carte.messages.push(Object.assign({
        ton: tableConstats.ton(c, contexte),
        texte: texte,
        // Une action par défaut au plus (actionsConstat). Sans lieu où corriger, « Signaler »
        // quand c'est la consigne.
        action: actionsConstat(c, connus)[0] || actionSignaler(c),
        // La croix, avec l'empreinte qui permet de la retenir ; vide ailleurs : la page ne
        // pose pas de croix sans empreinte.
        fermable: fermable, empreinte: empreinte
      }, habillageConstat(c, connus, langue)));   // titre, objets, consigne, infobulle
    }
  }
  return {
    titre: T('ctl.titre'),
    boutons: [
      { id: 'recompiler', libelle: T('ctl.recompiler'), icone: 'fleche', principal: true,
        tip: T('ctl.recompiler.tip') }
    ],
    lignes: lignes,
    // Le voile d'une compilation en cours : un panneau ouvert (ou rafraîchi) en pleine
    // analyse doit le montrer d'emblée, sans attendre le prochain message ANALYSE.
    analyse: etatAnalyse()
  };
}

// La barre d'état reste visible quand la notification a disparu. Rien n'y est affiché
// quand rien n'a été relevé.
let barreControles = null;
// Le fournisseur de l'arbre, retenu à l'activation : la barre compte les constats tels que
// la vue les montre (constatsPourControles : regroupés, cases d'en-tête vides comprises),
// et ce regroupement a besoin de lire les articles.
let fournisseurBarre = null;

// Le badge PDF/UA de l'article ouvert : entre le compteur des contrôles et la bascule
// d'aperçu.
let barrePdfUa = null;

// Le compteur des contrôles et le badge PDF/UA, créés une fois par activate() : à gauche de
// la bascule d'aperçu, masqués tant qu'il n'y a rien à dire.
function installerBarres(context, fournisseur) {
  barreControles = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 40);
  barreControles.command = 'szh.vueControles';
  context.subscriptions.push(barreControles);
  fournisseurBarre = fournisseur;
  barrePdfUa = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 45);
  barrePdfUa.command = 'szh.vueControles';
  context.subscriptions.push(barrePdfUa);
}

function majBarreControles() {
  if (!barreControles) { return; }
  // pdfuaHote.constats() s'ajoute : un PDF non conforme compte comme un bloquant, ici comme
  // à l'export. Même tri que la vue (constatsAffichables) : ni ce que la liste ne montre
  // plus, ni le résumé PDF/UA en plus de ses règles. Les refus d'export y entrent, au même
  // ton que dans la vue.
  let constats = constatsAffichables(journal.racine,
    reunir(ORDRE_SOURCES)
      .concat(pdfuaHote.constats(journal.racine, langueCockpit())));
  // Regroupés comme dans la vue : plusieurs voies pour les mêmes images font une carte, donc
  // un seul bloquant.
  if (fournisseurBarre && fournisseurBarre.racine && fournisseurBarre.racine === journal.racine) {
    constats = constatsPourControles(fournisseurBarre, constats);
  }
  // Comptés par la gravité que la vue affiche, réglage PDF/UA compris, sans ce qu'on a fermé.
  const contexte = contexteConstats();
  const r = resumeJournal(sansFermes(journal.racine, constats, contexte), contexte);
  if (r.bloquants > 0) { barreControles.text = T('ctl.barre.bloquant', [r.bloquants]); }
  else if (r.avertissements > 0) { barreControles.text = T('ctl.barre.avert', [r.avertissements]); }
  else { barreControles.hide(); return; }
  barreControles.tooltip = T('ctl.barre.tooltip');
  barreControles.show();
}

// ---- Le badge PDF/UA de l'article ouvert (ou du livre) ---------------------------
//
// Conforme, non conforme, en cours de validation, ou panne d'outillage ; masqué tant que
// rien n'est connu (pas d'article ouvert, ou verdict « inconnu »). L'état vient de
// lib/pdfua-hote.js ; ce module le traduit pour la barre.

// La clé d'état à demander à pdfuaHote.etat() pour l'article actuellement marqué ouvert :
// 'livre' en profil livre (le PDF de l'ouvrage, pas d'un chapitre en particulier), sinon le
// slug de l'article que majArticleOuvert a marqué — ou null si aucun n'est ouvert.
function cleBadgePdfUa(fournisseur) {
  if (!fournisseur.racine) { return null; }
  if (profilCourant().cle === 'livre') { return 'livre'; }
  const ouvert = ctx.articleOuvert();
  return ouvert ? ctx.slugArticleContenant(fournisseur.racine, ouvert.fsPath) : null;
}

function majBadgePdfUa(fournisseur) {
  if (!barrePdfUa) { return; }
  const cle = cleBadgePdfUa(fournisseur);
  const e = cle ? pdfuaHote.etat(cle) : { verdict: 'inconnu', regles: 0, date: '' };
  barrePdfUa.backgroundColor = undefined;
  if (e.verdict === 'conforme') {
    barrePdfUa.text = '$(verified) PDF/UA';
    barrePdfUa.tooltip = T('pdfua.badge.conforme', [e.date ? new Date(e.date).toLocaleString() : '']);
  } else if (e.verdict === 'non-conforme') {
    barrePdfUa.text = '$(error) PDF/UA';
    barrePdfUa.tooltip = T('pdfua.badge.nonconforme', [e.regles]);
    barrePdfUa.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (e.verdict === 'en-cours') {
    barrePdfUa.text = '$(sync~spin) PDF/UA';
    barrePdfUa.tooltip = T('pdfua.badge.encours');
  } else if (e.verdict === 'outillage') {
    barrePdfUa.text = '$(question) PDF/UA';
    barrePdfUa.tooltip = T('pdfua.badge.outillage');
  } else {
    barrePdfUa.hide();
    return;
  }
  barrePdfUa.show();
}

// À rafraîchir quand l'état change côté pdfuaHote (verdict mis en cache, validation démarrée
// ou terminée, réglage changé) : le badge, le compteur, et la vue Contrôles si elle est
// ouverte, comme relireJournal().
function rafraichirPdfUa(fournisseur) {
  majBadgePdfUa(fournisseur);
  majBarreControles();
  // Une validation qui se termine peut être la dernière chose que le voile attendait. Avant
  // la vue, pour que le message « valeurs » qui suit porte l'état levé.
  verifierFinAnalyse(fournisseur);
  ctx.rafraichirVueControles(fournisseur);
  annoncerVerdictsPdfUa(fournisseur);
}

// Le verdict PDF/UA arrive une minute après la compilation, quand la notification du
// journal est partie. Il se dit à son tour seulement s'il ajoute des règles en échec à
// celles du verdict qu'il remplace (pdfuaHote.prendreNouveautes) : recompiler sans rien
// corriger ne redit rien.
function annoncerVerdictsPdfUa(fournisseur) {
  const racine = fournisseur && fournisseur.racine;
  if (!racine) { return; }
  for (const n of pdfuaHote.prendreNouveautes(racine)) {
    const titre = n.cle === 'livre' ? path.basename(racine) : nomArticle(racine, n.cle);
    const notifier = async () => {
      const bouton = T('ctl.notif.pdfua.voir');
      const choix = await vscode.window.showErrorMessage(T('ctl.notif.pdfua', [titre, n.points]), bouton);
      if (choix === bouton) { await vscode.commands.executeCommand('szh.vueControles'); }
    };
    differer('notif-pdfua:' + n.cle, () => {
      notifier().catch(() => { /* un avis raté reste sans effet */ });
    });
  }
}

// ---- Le voile « Analyse en cours… » de la vue « À corriger » ----------------------
//
// Pendant une compilation, la liste est sur le point de changer : un défaut corrigé est
// encore là, un nouveau n'y est pas encore, et une flèche peut viser un endroit que la
// chaîne réécrit. La page voile donc les cartes concernées (media/vue-ensemble.js) jusqu'à
// ce que deux choses soient faites : le journal relu (relireJournal) et la validation
// PDF/UA de cet article terminée (pdfuaHote.enCours).
//
// Seules les cartes des articles qui se recompilent sont voilées ; le reste de la liste
// reste lisible et cliquable. Le slug vient du cockpit (compilerPuisAfficher, ouvrirArticle
// l'annoncent par annoncerAnalyse avant de lancer la tâche) ou, pour Ctrl+S
// (triggerTaskOnSave, hors cockpit), du dernier fichier d'article enregistré
// (retenirEnregistrement) : le .md, sa bibliographie ou un de ses tableaux. Deux
// compilations d'articles différents voilent les deux. Un article inconnu (ausgabe.yaml
// enregistré, tâche lancée à la main) ne voile rien : seul le bandeau « Analyse en cours… »
// s'affiche en tête de liste.
//
// Le voile ne reste pas coincé : une tâche interrompue avant son processus (onDidEndTask
// sans onDidEndTaskProcess) le lève, et un délai de sécurité le lève de toute façon.
const DELAI_SECURITE_ANALYSE = 180000;   // 3 min, réarmé à chaque étape
// Un enregistrement plus vieux que ça n'explique plus la tâche qui démarre.
const DELAI_ENREGISTREMENT_ANALYSE = 15000;
const ANALYSE_AU_REPOS = () => ({ actif: false, cles: [], journalRelu: false, processFini: false, minuteur: null });
let analyse = ANALYSE_AU_REPOS();
let slugAnalyseAnnonce = null;
let dernierEnregistre = { slug: null, quand: 0 };

function annoncerAnalyse(slug) { slugAnalyseAnnonce = slug ? String(slug) : null; }

function retenirEnregistrement(fournisseur, chemin) {
  const slug = ctx.slugArticleContenant(fournisseur.racine, chemin);
  dernierEnregistre = { slug: slug, quand: Date.now() };
}

// L'article que la tâche qui démarre recompile : annoncé par le cockpit, sinon celui du
// Ctrl+S qui vient d'avoir lieu, sinon null.
function slugDeLaTache() {
  if (slugAnalyseAnnonce) { return slugAnalyseAnnonce; }
  if (dernierEnregistre.slug && Date.now() - dernierEnregistre.quand < DELAI_ENREGISTREMENT_ANALYSE) {
    return dernierEnregistre.slug;
  }
  return null;
}

// Ctrl+S sur le texte ou la fiche d'un chapitre : seul ce chapitre est recompilé, et son
// aperçu se rafraîchit s'il est ouvert (compilerPuisAfficher). Le cockpit n'agit que sur un
// livre ; pour une revue, c'est triggerTaskOnSave qui lance la tâche.
// triggerTaskOnSave (vscodium-user/settings.json) ne doit pas viser les .md d'un livre : il
// lancerait make all en même temps, et le Makefile n'a pas de verrou.
function compilerChapitreEnregistre(fournisseur, chemin) {
  const racine = fournisseur.racine;
  if (!racine || profilCourant().cle !== 'livre') { return; }
  if (!/(\.md|\.meta\.yaml)$/i.test(chemin)) { return; }
  const slug = ctx.slugArticleContenant(racine, chemin);
  if (!slug || path.dirname(chemin) !== path.join(racine, dossierUnites(), slug)) { return; }
  ctx.relancerCompilation(fournisseur, slug);
}

// Ce que la page reçoit, dans « valeurs » comme dans le message ANALYSE. `cle` (le premier
// article) est gardé pour les lecteurs qui ne lisent pas `cles`.
function etatAnalyse() {
  const cles = analyse.actif ? analyse.cles.slice() : [];
  return { actif: analyse.actif, cle: cles[0] || '', cles: cles,
           texte: T('ctl.analyse.encours') };
}

function armerSecuriteAnalyse(fournisseur) {
  if (analyse.minuteur) { clearTimeout(analyse.minuteur); }
  analyse.minuteur = setTimeout(() => {
    analyse.minuteur = null;
    terminerAnalyse(fournisseur);
  }, DELAI_SECURITE_ANALYSE);
  // Le minuteur ne retient pas le processus de l'hôte (ni celui des tests).
  if (analyse.minuteur && typeof analyse.minuteur.unref === 'function') { analyse.minuteur.unref(); }
}

function pousserAnalyse() {
  ctx.pousserAnalyseControles(Object.assign({ type: MSG.ANALYSE }, etatAnalyse()));
}

function debuterAnalyse(fournisseur, slug) {
  if (!analyse.actif) { analyse.cles = []; }
  // Déjà voilé : l'article s'ajoute à ceux qui attendent, aucun n'en sort avant la fin.
  if (slug && analyse.cles.indexOf(String(slug)) === -1) { analyse.cles.push(String(slug)); }
  analyse.actif = true;
  analyse.journalRelu = false;
  analyse.processFini = false;
  armerSecuriteAnalyse(fournisseur);
  pousserAnalyse();
}

function terminerAnalyse(fournisseur) {
  if (analyse.minuteur) { clearTimeout(analyse.minuteur); analyse.minuteur = null; }
  if (!analyse.actif) { return; }
  analyse = ANALYSE_AU_REPOS();
  pousserAnalyse();
}

// Le processus de la tâche a rendu son code : c'est ce chemin, et non la fin de tâche seule,
// qui lève le voile, après le journal puis la validation PDF/UA.
function noterProcessFini() { analyse.processFini = true; }
function processFini() { return analyse.processFini; }

// Le journal est relu : le voile tombe, sauf si la validation PDF/UA de l'article tourne
// encore ; rafraichirPdfUa le lèvera alors.
function marquerJournalRelu(fournisseur) {
  if (!analyse.actif) { return; }
  analyse.journalRelu = true;
  armerSecuriteAnalyse(fournisseur);
  verifierFinAnalyse(fournisseur);
}

function verifierFinAnalyse(fournisseur) {
  if (!analyse.actif || !analyse.journalRelu) { return; }
  const racine = fournisseur && fournisseur.racine;
  // Un livre se valide d'un bloc (clé 'livre') ; une revue, article par article. Article
  // inconnu : '' attend n'importe quelle validation en cours (pdfuaHote.enCours).
  const clesPdfUa = profilCourant().cle === 'livre' ? ['livre']
    : (analyse.cles.length > 0 ? analyse.cles : ['']);
  if (racine && clesPdfUa.some((c) => pdfuaHote.enCours(racine, c))) { return; }
  terminerAnalyse(fournisseur);
}

// Vrai si le constat explique à lui seul l'arrêt de la chaîne : émis en blocage, ou rangé
// par la table derrière la compilation ou l'opération demandée. Une image sans description
// (barrière PDF/UA) n'arrête pas `make`.
function expliqueArret(c) {
  if (!c) { return false; }
  if (c.ton === 'danger') { return true; }
  const e = tableConstats.TABLE[String(c.source || '') + '/' + String(c.code || '')];
  return !!e && (e.barrage === 'compilation' || e.barrage === 'geste');
}

// Les dernières lignes non vides du journal, pour l'infobulle de la carte.
const LIGNES_EXTRAIT_ECHEC = 8;

function constatEchecMuet(racine) {
  const lignes = texteJournalTache(racine).split(/\r\n|\r|\n/).filter((l) => l.trim() !== '');
  return { source: 'cockpit', code: 'compilation-echec', ton: 'danger', slug: '', cle: '',
           args: [], champs: {}, brut: lignes.slice(-LIGNES_EXTRAIT_ECHEC).join('\n') };
}

// Fin d'une tâche de la chaîne : relit le journal, met le compteur à jour, et le dit une
// fois. Le code de sortie choisit le ton : « la compilation s'est arrêtée » seulement s'il
// est non nul ; un PDF sorti sans son image n'est pas un arrêt.
async function relireJournal(fournisseur, code) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  const lus = lireJournalTache(racine);
  // Un fichier de compteurs par article converti dans cette tâche, aucun sinon : l'import se
  // rejoue à chaque Ctrl+S tant qu'un Word attend, et ne doit alors rien compter.
  try { compteurs.enregistrerImportDepuisJournal(racine); } catch (e) { /* compteurs facultatifs */ }
  // Un arrêt qu'aucun constat n'explique (filtre qui plante, trace Python) : sans cette carte,
  // la vue et la barre diraient « rien à signaler » sur un PDF qui n'est pas sorti.
  const echecMuet = code !== 0 && !lus.some(expliqueArret);
  const constats = echecMuet ? lus.concat([constatEchecMuet(racine)]) : lus;
  // Seule la source « chaine » est remplacée. Le réimport, les refus d'export et la
  // pagination survivent à la compilation : ils restent vrais tant que leur action n'a pas
  // été refaite. La fusion se calcule avant sourcesDe(), qui repartirait du journal neuf si
  // l'on venait de changer de numéro.
  const chaine = fusionnerConstats(racine, constats);
  sourcesDe(racine).set('chaine', chaine);
  // Rapport automatique (lib/rapport-erreur.js) : une compilation qui s'arrête avec un code
  // non nul est une panne de la chaîne (COMPIL-ECHEC). Les constats de contenu
  // (tableau-sans-entête, figure-sans-alt…) ne déclenchent pas de rapport à eux seuls ; ils
  // l'accompagnent ici quand un rapport part. `code === 0` ne passe pas par ici.
  if (code !== 0) {
    try {
      rapportErreur.emettreRapport({
        gravite: 'erreur', source: 'chaine', code: 'COMPIL-ECHEC',
        message: 'La compilation a rendu le code de sortie ' + code + '.',
        produit: rapportErreur.produitDepuisRacine(racine, profilCourant().cle),
        journal: rapportErreur.lireExtraitFichier(path.join(racine, JOURNAL_TACHE)),
        constats: lus,
        langueInterface: langueCockpit(), vscodiumVersion: vscode.version || null
      });
    } catch (e) { /* un rapport ne fait ni échouer ni ralentir la compilation */ }
  }
  majBarreControles();
  ctx.rafraichirVueControles(fournisseur);

  controlerPagination(racine, fournisseur, 'après compilation');

  // Regroupés et comptés comme la barre et la vue : une carte, un point, de la même couleur.
  const r = resumeJournal(tableConstats.regrouper(constats, lecteurObjetsArticles(fournisseur)),
    contexteConstats());
  if (r.bloquants === 0 && r.avertissements === 0) { return; }
  const notifier = async () => {
    const bouton = T('ctl.notif.bouton');
    const ouvrir = () => vscode.commands.executeCommand('szh.vueControles');
    if (echecMuet) {
      // Le support se contacte d'ici, sans passer par la vue : même rapport que la carte.
      const support = T('ctl.signaler');
      const choix = await vscode.window.showErrorMessage(T('ctl.notif.echec'), bouton, support);
      if (choix === bouton) { await ouvrir(); }
      if (choix === support) {
        vscode.window.showInformationMessage(
          signalerConstat(fournisseur, PREFIXE_SIGNALER + 'cockpit/compilation-echec:'));
      }
      return;
    }
    if (r.bloquants > 0) {
      const cle = code === 0 ? 'ctl.notif.bloquant' : 'ctl.notif.arret';
      const choix = await vscode.window.showErrorMessage(T(cle, [r.bloquants]), bouton);
      if (choix === bouton) { await ouvrir(); }
      return;
    }
    // Non bloquant : un avertissement, pas un échec, et le ton de la notification le dit.
    const choix = await vscode.window.showWarningMessage(
      T('ctl.notif.avert', [r.avertissements]), bouton);
    if (choix === bouton) { await ouvrir(); }
  };
  // La notification attend qu'un QuickPick ouvert se ferme, pour ne pas interrompre la
  // saisie en cours. La barre d'état et la vue, sans effet sur le focus, sont déjà à jour.
  // Si plusieurs compilations finissent entre-temps, seul le dernier avis part.
  differer('notif-journal', () => {
    notifier().catch(() => { /* un avis raté ne casse pas la compilation */ });
  });
}

// Remet l'état du module à son départ, pour les tests qui rejouent un scénario à froid.
function reinitialiser() {
  if (analyse.minuteur) { clearTimeout(analyse.minuteur); }
  journal = { racine: null, sources: new Map() };
  analyse = ANALYSE_AU_REPOS();
  slugAnalyseAnnonce = null;
  dernierEnregistre = { slug: null, quand: 0 };
  slugsRetiresMemoire.clear();
}

module.exports = {
  configurer, reinitialiser,
  // Constats par source
  poserConstats, poserConstatsExport, constatsPoses, constatsCourants, ouvrirNumero,
  relireJournal, alignerDossiersSurOrdre, contexteConstats, constatsPourControles,
  // Vue « À corriger »
  vueControles, fermerConstat, ouvrirCible, actionControles,
  empreinteConstat, constatsFermes, texteConstat,
  // Barre d'état
  installerBarres, majBarreControles, majBadgePdfUa, rafraichirPdfUa,
  // Voile « Analyse en cours… »
  annoncerAnalyse, retenirEnregistrement, slugDeLaTache, compilerChapitreEnregistre,
  etatAnalyse, debuterAnalyse, terminerAnalyse, noterProcessFini, processFini,
  marquerJournalRelu
};
