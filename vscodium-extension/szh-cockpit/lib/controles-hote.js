// Contrôles de la compilation : les constats de la chaîne et des gestes qui ne passent pas
// par elle, la vue « À corriger », le compteur et le badge PDF/UA de la barre d'état, et le
// voile « Analyse en cours… ».
//
// La chaîne repère une dizaine de choses à chaque compilation, et tout partait sur la
// sortie d'erreur d'un terminal. Les tâches sont en `reveal: never` (`silent` ouvrait le
// terminal dès un échec) et écrivent leur sortie dans <numéro>/.szh-journal.log
// (vscodium-user/tasks.json) ; lib/journal.js la traduit en constats. Ici : les relire à la
// fin de chaque tâche, les dire une fois, et les garder à portée de clic.
//
// Rien de neuf à l'écran : la vue est la vue d'ensemble des autres sections
// (media/vue-ensemble.*, SZH.listeCartes, ouverte par extension.js), l'avis est une
// notification de l'éditeur, et le compteur est un article de la barre d'état, comme la
// bascule d'aperçu.
//
// La validation PDF/UA en arrière-plan (lib/pdfua-hote.js) vit à part de tout ceci — elle
// ne passe pas par une tâche — mais son état rejoint les mêmes compteur et vue : voir
// pdfuaHote.constats() plus bas, et le badge posé par article (majBadgePdfUa).
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const { T, TL, langueCockpit } = require('./i18n');
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

// ---- Rappels vers l'hôte ----------------------------------------------------------
// Posés par extension.js. Les valeurs par défaut ne servent qu'à ne pas planter un test qui
// require ce module seul.
let ctx = {
  // Le contexte de l'extension, posé par activate() : les constats fermés et les slugs
  // retirés s'écrivent dans son globalState. Nul avant elle, et tout ce qui le lit s'en
  // accommode — un cockpit sans mémoire montre simplement tous ses constats.
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

// Aligner les dossiers d'article sur une liste de rangs, et ranger ce que le renommage
// périme. Deux appelants : « Terminer », qui donne l'ordre voulu à l'écran, et la
// suppression d'un article, qui donne ce qui reste.
// -> { erreur, renommes }, tel que lib/renumerotation-fs.js le rend.
function alignerDossiersSurOrdre(racine, voulu) {
  // Les dossiers d'avant : ce qui aura disparu après le renommage est retenu comme retiré
  // (retenirSlugsRetires), pour que plus rien ne s'affiche sous ces noms-là.
  const avant = slugsUnitesPresents(racine);
  // config/cle : le fichier et la clé où « Terminer » écrit l'ordre — ausgabe.yaml pour une
  // revue, buch.yaml pour un livre. Sans eux, ecrireOrdre() (lib/renumerotation-fs.js)
  // retombe sur son défaut de revue et créerait un ausgabe.yaml parasite dans un livre.
  const r = renumerotation.renumeroter(racine, voulu,
    { dossier: dossierUnites(), config: profilCourant().config, cle: profilCourant().unites.ordre });
  // Les constats nomment les anciens slugs : ils sont périmés pour les articles renommés,
  // et la prochaine compilation les reposera sous leur nouveau nom.
  if (r.renommes > 0 && journal.racine === racine) {
    journal.sources.set('chaine', []);
  }
  // Ce qui n'est plus sur le disque : les anciens noms d'un renommage, et — la suppression
  // passant aussi par ici, son dossier déjà effacé — tout slug qu'un constat ou le journal
  // nomme encore sans qu'aucun dossier ne le porte. Retenus d'une session à l'autre :
  // .szh-journal.log n'est pas réécrit (ce qu'il dit des articles restés en place reste
  // vrai au redémarrage), c'est à la lecture que constatsAffichables() écarte le reste.
  const apres = slugsUnitesPresents(racine);
  if (apres !== null) {
    const nommes = new Set(avant || []);
    const sources = [lireJournalTache(racine)];
    if (journal.racine === racine) {
      for (const liste of journal.sources.values()) { sources.push(liste); }
    }
    for (const liste of sources) { for (const c of liste) { if (c && c.slug) { nommes.add(c.slug); } } }
    retenirSlugsRetires(racine, Array.from(nommes).filter((s) => !apres.has(s)));
    // Les canaux à part (réimport, refus d'export, pagination) ne se reposent pas à la
    // compilation suivante : on les nettoie ici plutôt que de compter sur le seul filtre.
    if (journal.racine === racine) {
      const vivant = (c) => !c || !c.slug || apres.has(c.slug);
      for (const source of ['reimport', 'export', 'pagination']) {
        if (journal.sources.has(source)) { journal.sources.set(source, journal.sources.get(source).filter(vivant)); }
      }
    }
  }
  // Les verdicts PDF/UA en cache (.szh-pdfua.json) : migrés sous le nouveau nom si le PDF
  // est encore le même, oubliés sinon. Aussi après une suppression sans renommage — le
  // dernier article retiré ne décale personne, mais son verdict doit partir avec lui.
  pdfuaHote.purgerAbsents(racine);
  if (journal.racine === racine) { majBarreControles(); }
  return r;
}

// ---- Les slugs retirés : les noms qu'un article a quittés -------------------------
//
// { <racine>: [slug…] } dans globalState, borné comme les constats fermés. Un nom retiré
// qui revient sur le disque (un nouvel article, un renommage inverse) redevient visible de
// lui-même : le filtre exige à la fois « retiré » ET « absent du disque ».
//
// Pourquoi une liste explicite, et non « tout slug sans dossier » : un constat peut nommer
// ce qui n'a jamais été un dossier de ce numéro (un Word pas encore converti, les corpus de
// test), et le taire sous prétexte qu'il n'existe pas cacherait justement ce qu'il dit. Ce
// qu'on écarte, c'est ce qu'on a vu partir.
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
    // Sans attendre : la mémoire ci-dessus répond déjà, et un échec d'écriture ne fait que
    // laisser revenir, au redémarrage, un constat que la prochaine compilation effacera.
    Promise.resolve(etatPoste.globalState.update(CLE_SLUGS_RETIRES, table)).catch(() => {});
  }
}

const JOURNAL_TACHE = '.szh-journal.log';

// Le dernier journal lu, par racine de numéro : la barre d'état et la vue le relisent sans
// recompiler, et rouvrir la vue ne perd pas ce qui a été dit.
//
// Une liste par source. « chaine » est ce que .szh-journal.log a dit ; les autres ne passent
// pas par une tâche, et la recompilation qui suit les effacerait si elles y étaient mêlées :
// « reimport » (le geste que le rédacteur vient de faire), « export » (les refus du dernier
// export) et « pagination » (le contrôle en arrière-plan). Une source jamais posée vaut une
// liste vide : changer de numéro ne demande donc de reposer personne.
let journal = { racine: null, sources: new Map() };

// L'ordre d'affichage : ce qui vient d'un geste passe devant ce que la chaîne a dit.
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

// Le numéro ouvert change : ses constats sont relus de son journal, sans rien annoncer — ce
// que la dernière compilation avait relevé est encore vrai, mais ce n'est pas une nouvelle.
// -> true si le numéro a changé.
function ouvrirNumero(racine, fournisseur) {
  if (journal.racine === racine) { return false; }
  sourcesDe(racine);
  // Pagination continue : même contrôle en arrière-plan qu'après une compilation, pour que
  // l'avertissement soit là dès l'ouverture du numéro et pas seulement après le premier
  // Ctrl+S.
  controlerPagination(racine, fournisseur, 'à l’ouverture du numéro');
  return true;
}

// Pagination continue (lib/pagination-hote.js) : contrôle en arrière-plan, seulement si le
// numéro a déjà été paginé une fois — sinon aucun appel WSL, le contrôle ne doit rien coûter
// pendant la rédaction, avant le bouclage du numéro. Jamais attendu : une panne (distro
// endormie, make en échec) laisse le canal tel quel et se trace en sourdine.
function controlerPagination(racine, fournisseur, moment) {
  if (!racine || !fournisseur || !paginationHote.estPagine(racine)) { return; }
  paginationHote.lireEtat(racine, fournisseur.listerArticles())
    .then((etat) => { poserConstats(racine, 'pagination', paginationHote.constatsPagination(etat)); })
    .catch((e) => { console.warn('pagination : lecture de l’état ' + moment + ' : '
      + ((e && e.message) || e)); });
}

// Ce que la vue et la barre d'état ont à montrer, toutes les sources réunies.
// pdfua.constats() s'ajoute toujours : la validation PDF/UA tourne hors tâche, ses verdicts
// en cache ne vivent pas dans .szh-journal.log (lib/pdfua-hote.js).
function constatsCourants(racine) {
  const base = journal.racine !== racine ? lireJournalTache(racine) : reunir(ORDRE_SOURCES);
  return constatsAffichables(racine, base.concat(pdfuaHote.constats(racine, langueCockpit())));
}

// Les dossiers d'unité présents sur le disque, ou null quand on ne doit rien filtrer.
//
// null d'abord pour un livre : ses constats nomment volontiers ce qui n'est pas un dossier
// — le manuscrit que livre-scinder.py vient de découper (« slug_original », disparu par
// construction), le TITRE d'un chapitre dans livre-assembler.py (onglet-case-etroite) —, et
// les écarter parce qu'aucun dossier ne porte ce nom cacherait justement ce qu'ils disent.
// null aussi quand le dossier ne se lit pas (OneDrive hors ligne, droits) : ne rien savoir
// n'est pas une raison de tout taire.
//
// Les sous-dossiers bruts, et non listerArticles() : un dossier encore sans .md (import en
// cours, page de Documentation) garde ses constats — le filtre ne doit écarter que ce qui a
// réellement quitté le disque.
function slugsUnitesPresents(racine) {
  if (!racine || profilCourant().cle === 'livre') { return null; }
  try {
    return new Set(fs.readdirSync(path.join(racine, dossierUnites()), { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name));
  } catch (e) { return null; }
}

// Ce que « À corriger » et la barre d'état peuvent montrer d'une liste de constats. Deux
// règles, appliquées au dernier moment — là où toutes les sources se rejoignent :
//
//   * aucun constat d'un article qui n'existe plus. Un article renommé (« 01-x » devenu
//     « 03-x » par « Terminer ») ou supprimé laissait ses anciens défauts sous son ancien
//     nom : relus de .szh-journal.log au redémarrage, gardés en mémoire par un réimport ou
//     un export. Chaque source a son propre nettoyage (alignerDossiersSurOrdre,
//     pdfuaHote.purgerAbsents), ce filtre en est la garantie de fond : il vaut pour toutes,
//     y compris celles qu'on ajoutera. Est écarté ce qui porte un nom qu'un article a
//     quitté (slugsRetires) et qu'aucun dossier ne porte aujourd'hui ; un constat du numéro
//     entier (slug vide) n'est jamais concerné, un livre non plus (slugsUnitesPresents).
//     Les verdicts PDF/UA, eux, sont déjà confrontés à la liste réelle des articles dans
//     pdfuaHote.constats() : une clé fantôme n'en sort plus, retirée ou non.
//   * pas de résumé PDF/UA quand ses règles suivent (journal.sansResumePdfUaRedondant) : le
//     cache et le journal d'un export parlent souvent du même PDF, c'est donc sur la liste
//     réunie qu'il faut en juger.
function constatsAffichables(racine, constats) {
  const presents = slugsUnitesPresents(racine);
  const retires = presents === null ? null : slugsRetires(racine);
  const vivants = (retires === null || retires.size === 0) ? constats
    : constats.filter((c) => !c || !c.slug || presents.has(c.slug) || !retires.has(c.slug));
  return sansResumePdfUaRedondant(vivants);
}

// Les points qui ont fait refuser le dernier export, un par carte. Ils partaient
// concaténés dans le message d'une seule notification, avec des puces et des retours à la
// ligne que VSCodium écrase : le plus grave de l'application était son message le moins
// lisible, et rien n'en restait une fois la notification disparue. Ils vivent donc dans la
// liste « À corriger » jusqu'au prochain export — réussi, il les efface.
//
// Le lieu n'est pas dans la table des constats : il dépend de la raison. Les points de
// configuration ouvrent la liste (szhBloquantsConfig en donne le compte) et mènent aux
// réglages ; les autres nomment leur article en tête de phrase et mènent à sa fiche.
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

// Les constats d'une source, posés ou effacés : la nouvelle liste remplace la précédente de
// cette source, et d'elle seule. Deux réimports successifs ne se cumulent pas — leurs
// avertissements sur le même article se contrediraient ; la pagination (posée en
// arrière-plan après chaque compilation d'un numéro déjà paginé, ou à l'ouverture d'un tel
// numéro) est remplacée en bloc à chaque relecture.
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

// Les constats du dernier passage, PLUS ceux des articles que ce passage n'a pas touchés.
//
// `make` est incrémental et la tâche réécrit le journal : enregistrer un seul article donne
// un journal qui ne parle que de lui. On remplaçait pourtant tous les constats par les
// siens, et ceux des autres articles disparaissaient de la liste comme du compteur, alors
// que leurs défauts tenaient toujours. La liste mentait par omission, et dans le sens
// rassurant — celui qui laisse publier.
//
// Ne sont donc jetés que les constats des articles recompilés (slugsCompiles) : un défaut
// corrigé s'en va au passage suivant sur SON article, un défaut qu'on n'a pas retouché
// reste. Les constats du numéro entier (slug vide) sont toujours remplacés : ils parlent de
// l'ensemble, et l'ensemble vient d'être recompilé.
// Un article est « traversé » s'il a sa ligne de pandoc, MAIS AUSSI si le nouveau journal
// parle de lui : une porte qui ferme avant pandoc — un titre vide, un dossier à espaces —
// écrit son constat sans qu'aucune compilation n'ait eu lieu. Sans ce second cas, l'ancien
// constat du même article restait à côté du neuf, et le même défaut se comptait deux fois.
function fusionnerConstats(racine, neufs) {
  if (journal.racine !== racine) { return neufs; }
  const traverses = slugsCompiles(texteJournalTache(racine));
  for (const c of neufs) { if (c.slug !== '') { traverses.add(c.slug); } }
  const gardes = constatsPoses('chaine').filter(
    (c) => c.slug !== '' && !traverses.has(c.slug));
  return gardes.concat(neufs);
}

// Le titre de section, par gravité. Il se lisait jusqu'ici dans une table indexée par le
// ton, qui dérive strictement de la gravité (lib/constats.js) : deux tables disaient la
// même chose, et la vue passait de l'une à l'autre à chaque ligne.
const GROUPE_GRAVITE = {
  bloquant: 'ctl.groupe.bloquant', avert: 'ctl.groupe.avert', info: 'ctl.groupe.info'
};

const SOURCES_CONSTAT = {
  citations: 'ctl.source.citations', import: 'ctl.source.import', meta: 'ctl.source.meta',
  pdfua: 'ctl.source.pdfua', pipeline: 'ctl.source.pipeline', rendu: 'ctl.source.rendu',
  // szh-typographie.lua (« ß », guillemets droits, majuscule non accentuée) et
  // szh-metafichier.lua (images natives Word) : même mécanisme générique que « scission »
  // ci-dessous, seule l'étiquette de section manquait.
  typo: 'ctl.source.typo', metafichier: 'ctl.source.metafichier',
  // pipeline/livre-scinder.py, appelé depuis la cible `import` du Makefile pour un livre :
  // ses constats « [scission-avertissement] » arrivent ici sans code à ajouter (familleCode()
  // de lib/journal.js reconnaît déjà tout préfixe « <source>-<ton> » générique) — seule cette
  // étiquette manquait, sans quoi la carte se serait affichée sous « ctl.source.pipeline ».
  scission: 'ctl.source.scission',
  // szh-numerotation.lua : la seule image sans texte alternatif ni légende (« figure-sans-
  // alt »), déjà montrée dans l'encadré « lecteur d'écran » de l'aperçu.
  numerotation: 'ctl.source.numerotation',
  // pipeline/pagination.py, lancé par `make pdf` sur un numéro déjà paginé : ses lignes
  // « [pagination-avertissement] » passent par le même préfixe générique que « scission ».
  pagination: 'ctl.source.pagination'
};

// Ce dont lib/constats.js a besoin pour décider si une barrière est vraiment fermée. La
// validation PDF/UA est un réglage : là où elle est éteinte, une image muette ne fait plus
// échouer de PDF, et la couleur doit retomber avec elle.
function contexteConstats() {
  return { pdfua: pdfuaHote.reglageActif() };
}

// Les destinations qui parlent d'un article : un constat peut nommer un Word qui n'est
// jamais devenu un article, et un bouton qui ouvrirait le vide serait pire que rien.
// « pdf » (szh.voirPdfArticle) pour une raison de plus : voirPdfArticle passe par
// cibleTraduction, qui retombe sur l'article ACTIF ou en aperçu quand le slug reçu est vide
// — un bouton sans garde ouvrirait alors le PDF d'un AUTRE article plutôt que rien.
// « table » (szh.editerTable) aussi : l'éditeur ne s'ouvre que sur un tableau d'un article
// qui existe.
const LIEUX_ARTICLE = new Set(['article', 'fiche', 'medias', 'pdf', 'table']);

// Le bouton d'un constat, ou aucun. L'identifiant porte la destination ET l'objet à
// atteindre — « medias:fig-01.png » — parce que la page renvoie l'identifiant tel quel :
// l'hôte n'a ainsi pas à retrouver de quel constat venait le clic, ce qui serait ambigu dès
// que deux défauts du même article visent le même formulaire.
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

// Le bouton d'un constat : « <lieu>:<objet> », tel que actionsConstat l'a formé et que la
// page l'a renvoyé. Une seule fonction pour toutes les destinations.
//
// `focus` dit à la page visée ce qu'elle doit amener à l'écran : le formulaire des médias
// déplie l'image nommée et pose le curseur là où il y a quelque chose à écrire ; les
// commandes qui ne savent pas encore le lire l'ignorent sans rien casser.
async function ouvrirCible(id, cle) {
  const sep = id.indexOf(':');
  const lieu = sep === -1 ? id : id.slice(0, sep);
  const focus = sep === -1 ? '' : id.slice(sep + 1);
  const entree = tableConstats.LIEUX[lieu];
  if (!entree) { return; }
  await vscode.commands.executeCommand(entree.commande, { slug: String(cle || ''), focus: focus });
}

// Le second étage d'un message de la vue « À corriger » (lib/constats.js, SECOND_ETAGE) :
// le titre seul, les objets en cause — un lien chacun, à la même forme d'identifiant que le
// bouton (« medias:fig-01.png », « table:table-02.html ») —, la phrase d'action, et
// l'explication qui passe en infobulle. `pourquoi` est le libellé du bouton qui la déplie :
// porté par le message, la page n'a pas de texte de plus à attendre de l'hôte.
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
// d'en-tête couvre plusieurs colonnes ou rangées — WeasyPrint ne l'inscrit qu'à sa première
// colonne et ignore l'attribut headers, si bien que les colonnes suivantes sortent sans
// en-tête (7.5-1) alors même que le tableau en déclare un (mesuré sur 2025-02, article
// massie, table-01.html, 29.09.2026).
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
// canonise (HTML en ligne) : on en retire les balises et les espaces, insécables compris.
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

// Les images sans nom accessible posées DANS un tableau HTML de l'article : le .md ne les
// voit pas (imagesSansAlternative ne lit que lui), et c'est pourtant elles que le validateur
// relève — le bloc des autrices et auteurs, par exemple, est un tableau qui porte un
// portrait en alt="". -> [{ image, table }]
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
        // Une image d'un tableau se règle dans l'éditeur de CE tableau : le focus porte le
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
// pour ceux qui n'en citent aucun (focusDeRepli) — sans quoi leur flèche ouvrait l'article
// en haut. Aucune écriture : les constats d'origine restent tels quels dans le journal.
//
// S'y ajoutent les défauts que le cockpit voit seul, en lisant les tableaux de chaque
// article : une case d'en-tête vide (ambre, jamais bloquante).
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
    const focus = lu ? focusDeRepli(c.source + '/' + c.code, c.args, lu.texteMd, lu.tables) : '';
    return focus === '' ? c : Object.assign({}, c, {
      champs: Object.assign({}, c.champs || {}, { focusCalcule: focus }) });
  });
}

// ---- Les constats « Pour information » qu'on a fermés d'un clic -------------------
//
// Un constat gris ne demande rien : il dit qu'une chose s'est bien passée, ou qu'on a pris
// une décision à la place du rédacteur. Il a donc une croix, et lui seul — un bloquant se
// corrige, il ne se referme pas (lib/constats.js, `fermable`).
//
// Ce qu'on retient n'est pas le code du constat mais son EMPREINTE : la racine, l'article,
// le code et la phrase affichée. Le jour où le fait change — « sauf 2 paragraphes » là où
// il n'y en avait aucun —, la phrase change avec lui, l'empreinte ne correspond plus, et le
// message revient. Fermer, c'est donc dire « j'ai lu CE fait », jamais « tais-toi sur ce
// sujet ». globalState : « l'ai-je lu ? » est propre au compte, pas à la machine.
const CLE_CONSTATS_FERMES = 'szh.constats.fermes';
// La liste ne peut pas croître sans fin : les plus anciennes empreintes tombent. 400 tient
// plusieurs numéros entiers, et une empreinte oubliée ne fait que réafficher un message gris.
const MAX_CONSTATS_FERMES = 400;

const SEP_EMPREINTE = '\u0001';   // le même qu'en lib/journal.js

function empreinteConstat(racine, constat, texte) {
  return [String(racine || ''), String((constat && constat.source) || ''),
          String((constat && constat.code) || ''), String((constat && constat.slug) || ''),
          String(texte || '')].join(SEP_EMPREINTE);
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
  return true;
}

// Une carte par article, et non une par constat. Trois défauts de citation sur le même
// article donnaient trois cartes portant le même nom, le même sous-titre et le même bouton :
// on relisait l'entête trois fois pour trois phrases, et rien ne disait qu'elles parlaient
// du même texte. La séparation par gravité, elle, reste — ce qui empêche de publier ne se
// range pas avec ce qui mérite un regard, même pour un seul article.
//
// Ce que la carte ne porte plus, et pourquoi : la pastille de ton répétait le titre de
// section ET la couleur de l'encadré, trois fois le même mot ; le bouton « Ouvrir » doublait
// celui du constat, qui mène au même endroit et plus précisément. Le geste de chaque défaut
// est désormais au bout de sa phrase (media/_commun.js, `messages`).
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
      const detail = tableConstats.detail(c, langue);
      // La phrase est calculée avant la carte : c'est elle qui entre dans l'empreinte, et
      // un message fermé ne doit pas faire naître une carte vide à lui tout seul.
      const texte = tableConstats.phrase(c, langue) + (detail === '' ? '' : ' ' + detail);
      const fermable = tableConstats.fermable(c, contexte);
      const empreinte = fermable ? empreinteConstat(racine, c, texte) : '';
      if (fermable && fermes.has(empreinte)) { continue; }
      const source = T(SOURCES_CONSTAT[c.origine || c.source] || 'ctl.source.pipeline');
      let carte = cartes.get(c.slug);
      if (!carte) {
        carte = {
          // La clé ne vaut que sur un article qui existe encore : un constat peut nommer
          // un Word qui n'est jamais devenu un article.
          cle: c.slug !== '' && connus.has(c.slug) ? c.slug : '',
          groupe: T(GROUPE_GRAVITE[gravite]),
          titre: c.slug === '' ? T('ctl.numero') : T('ctl.article', [c.slug]),
          meta: source,
          messages: [],
          pastilles: [], ouvrir: false, actions: []
        };
        cartes.set(c.slug, carte);
        lignes.push(carte);
      }
      // Le sous-titre ne tient que si toute la carte vient du même contrôle : deux sources
      // dessous, et il mentirait sur la moitié des phrases.
      if (carte.meta !== source) { carte.meta = ''; }
      carte.messages.push(Object.assign({
        ton: tableConstats.ton(c, contexte),
        texte: texte,
        // Un seul geste par défaut, ou aucun : actionsConstat rend au plus une entrée.
        action: actionsConstat(c, connus)[0] || null,
        // La croix, et de quoi la retenir. Vide partout ailleurs : la page ne pose pas de
        // croix sans empreinte, et n'a donc rien à décider.
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

// La barre d'état : le seul endroit qui reste visible quand la notification a disparu.
// Rien à afficher quand rien n'a été relevé — un compteur à zéro est du bruit.
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
  // pdfuaHote.constats() s'ajoute : un PDF non conforme compte comme un bloquant, ici
  // comme à l'export — c'est la même règle, elle arrive juste une minute après le Ctrl+S
  // au lieu du jour de l'export.
  // Même tri que la vue (constatsAffichables) : la barre ne doit pas compter ce que la
  // liste ne montre plus, ni le résumé PDF/UA en plus de ses règles. Les refus d'export y
  // entrent, au même ton que dans la vue.
  let constats = constatsAffichables(journal.racine,
    reunir(ORDRE_SOURCES)
      .concat(pdfuaHote.constats(journal.racine, langueCockpit())));
  // Regroupés comme dans la vue : trois voies pour les mêmes images muettes font UNE carte,
  // donc un seul bloquant — la barre ne doit pas annoncer plus que la liste n'en montre.
  if (fournisseurBarre && fournisseurBarre.racine && fournisseurBarre.racine === journal.racine) {
    constats = constatsPourControles(fournisseurBarre, constats);
  }
  const r = resumeJournal(constats);
  if (r.bloquants > 0) { barreControles.text = T('ctl.barre.bloquant', [r.bloquants]); }
  else if (r.avertissements > 0) { barreControles.text = T('ctl.barre.avert', [r.avertissements]); }
  else { barreControles.hide(); return; }
  barreControles.tooltip = T('ctl.barre.tooltip');
  barreControles.show();
}

// ---- Le badge PDF/UA de l'article ouvert (ou du livre) ---------------------------
//
// Conforme, non conforme, en cours de validation, ou panne d'outillage — jamais montré
// tant que rien n'est connu (pas d'article ouvert, ou verdict encore « inconnu »). L'état
// vient de lib/pdfua-hote.js ; ce module ne fait ici que le traduire pour la barre.

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

// Ce qu'un changement d'état côté pdfuaHote (verdict mis en cache, validation démarrée ou
// terminée, réglage changé) doit rafraîchir : le badge, le compteur, et la vue Contrôles
// si elle est ouverte — même trio que relireJournal() plus bas.
function rafraichirPdfUa(fournisseur) {
  majBadgePdfUa(fournisseur);
  majBarreControles();
  // Une validation qui se termine peut être la dernière chose que le voile attendait. Avant
  // la vue : la « valeurs » qui suit porte ainsi l'état levé, pas l'ancien.
  verifierFinAnalyse(fournisseur);
  ctx.rafraichirVueControles(fournisseur);
}

// ---- Le voile « Analyse en cours… » de la vue « À corriger » ----------------------
//
// Pendant une compilation, ce que la liste montre est sur le point de changer : un défaut
// corrigé est encore là, un nouveau n'y est pas encore, et un clic sur la flèche d'un
// message peut viser un endroit que la chaîne est en train de réécrire. La page voile donc
// les messages (media/vue-ensemble.js) — la carte de l'article compilé si on le connaît,
// toute la liste sinon — jusqu'à ce que DEUX choses soient faites : le journal relu
// (relireJournal) ET la validation PDF/UA de cet article terminée (pdfuaHote.enCours), qui
// n'arrive qu'après.
//
// Seules les cartes des articles qui se recompilent sont voilées, jamais toute la liste
// (demande de Robin, 29.09.2026) : le reste de la liste reste lisible et cliquable. Le slug
// vient des chemins du cockpit (compilerPuisAfficher, ouvrirArticle), qui l'annoncent
// (annoncerAnalyse) juste avant de lancer la tâche, et pour Ctrl+S (triggerTaskOnSave, qui
// ne passe par aucune fonction du cockpit) du dernier fichier d'article enregistré
// (retenirEnregistrement) — le .md, sa bibliographie ou un de ses tableaux. Deux
// compilations d'articles différents voilent les deux. Un article inconnu (ausgabe.yaml
// enregistré, tâche lancée à la main) ne voile rien : seul le bandeau « Analyse en cours… »
// s'affiche en tête de liste.
//
// Ne jamais rester coincé : une tâche interrompue avant son processus (onDidEndTask sans
// onDidEndTaskProcess) lève le voile, et un délai de sécurité le lève de toute façon.
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

// Ctrl+S sur le texte ou la fiche d'un chapitre : seul ce chapitre est recompilé, et son aperçu
// se rafraîchit s'il est ouvert (compilerPuisAfficher). Le cockpit n'agit que sur un livre ;
// une revue reste à la tâche que lance triggerTaskOnSave.
// ⚠ triggerTaskOnSave (vscodium-user/settings.json) ne doit plus viser les .md d'un livre :
//   il lancerait make all en même temps, et le Makefile n'a pas de verrou.
function compilerChapitreEnregistre(fournisseur, chemin) {
  const racine = fournisseur.racine;
  if (!racine || profilCourant().cle !== 'livre') { return; }
  if (!/(\.md|\.meta\.yaml)$/i.test(chemin)) { return; }
  const slug = ctx.slugArticleContenant(racine, chemin);
  if (!slug || path.dirname(chemin) !== path.join(racine, dossierUnites(), slug)) { return; }
  ctx.relancerCompilation(fournisseur, slug);
}

// Ce que la page reçoit, dans « valeurs » comme dans le message ANALYSE. `cle` (le premier
// article) reste pour les lecteurs qui ne connaissent pas encore `cles`.
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
  // Le minuteur ne doit jamais retenir le processus de l'hôte (ni celui des tests).
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
// qui lève le voile — il attend le journal, puis la validation PDF/UA.
function noterProcessFini() { analyse.processFini = true; }
function processFini() { return analyse.processFini; }

// Le journal est relu : le voile tombe, sauf si la validation PDF/UA de l'article tourne
// encore — c'est alors elle (rafraichirPdfUa) qui le lèvera.
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

// Fin d'une tâche de la chaîne : on relit le journal, on met le compteur à jour, et on le
// dit une fois. Le code de sortie sépare les deux tons du message : « la compilation s'est
// arrêtée » n'est vrai que s'il est non nul, et un PDF sorti sans son image n'est pas un
// arrêt même s'il n'est pas publiable.
async function relireJournal(fournisseur, code) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  const constats = lireJournalTache(racine);
  // Un fichier de compteurs par article CONVERTI dans cette tâche, aucun sinon : l'import rejoue
  // à chaque Ctrl+S tant qu'un Word attend, et ne doit alors rien compter.
  try { compteurs.enregistrerImportDepuisJournal(racine); } catch (e) { /* jamais une panne */ }
  // Seule la source « chaine » est remplacée. Le réimport, les refus d'export et la
  // pagination survivent à la compilation : la chaîne ne les connaît pas, et ils restent
  // vrais tant que leur geste n'a pas été refait. La fusion se calcule avant sourcesDe(),
  // qui repartirait du journal neuf si l'on venait de changer de numéro.
  const chaine = fusionnerConstats(racine, constats);
  sourcesDe(racine).set('chaine', chaine);
  // Rapport automatique (lib/rapport-erreur.js) : une compilation qui s'arrête avec un code
  // de sortie non nul est une panne de la chaîne (COMPIL-ECHEC), pas un simple constat de
  // contenu — les constats (tableau-sans-entête, figure-sans-alt…) ne déclenchent jamais de
  // rapport à eux seuls (les noyer dans le dossier partagé le rendrait inutile) : ils ne
  // partent qu'en contexte, ici, quand un rapport part pour une autre raison. `code === 0`
  // (les Ctrl+S qui réussissent, l'immense majorité) ne passe jamais par ici.
  if (code !== 0) {
    try {
      rapportErreur.emettreRapport({
        gravite: 'erreur', source: 'chaine', code: 'COMPIL-ECHEC',
        message: 'La compilation a rendu le code de sortie ' + code + '.',
        produit: rapportErreur.produitDepuisRacine(racine, profilCourant().cle),
        journal: rapportErreur.lireExtraitFichier(path.join(racine, JOURNAL_TACHE)),
        constats: constats,
        langueInterface: langueCockpit(), vscodiumVersion: vscode.version || null
      });
    } catch (e) { /* un rapport ne doit jamais faire échouer ni ralentir la compilation */ }
  }
  majBarreControles();
  ctx.rafraichirVueControles(fournisseur);

  controlerPagination(racine, fournisseur, 'après compilation');

  const r = resumeJournal(constats);
  if (r.bloquants === 0 && r.avertissements === 0) { return; }
  const notifier = async () => {
    const bouton = T('ctl.notif.bouton');
    const ouvrir = () => vscode.commands.executeCommand('szh.vueControles');
    if (r.bloquants > 0) {
      const cle = code === 0 ? 'ctl.notif.bloquant' : 'ctl.notif.arret';
      const choix = await vscode.window.showErrorMessage(T(cle, [r.bloquants]), bouton);
      if (choix === bouton) { await ouvrir(); }
      return;
    }
    // Non bloquant : un avertissement, pas un échec. Le ton de la notification le dit, et
    // c'est tout ce que le rédacteur en verra s'il ne clique pas.
    const choix = await vscode.window.showWarningMessage(
      T('ctl.notif.avert', [r.avertissements]), bouton);
    if (choix === bouton) { await ouvrir(); }
  };
  // La notification attend qu'un QuickPick ouvert se ferme : la fin d'une compilation ne
  // doit pas interrompre le geste en cours. La barre d'état et la vue, inoffensives pour
  // le focus, ont déjà été mises à jour plus haut. Si plusieurs compilations finissent
  // pendant le geste, seul le dernier avis part — les précédents sont périmés.
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
  relireJournal, alignerDossiersSurOrdre, contexteConstats,
  // Vue « À corriger »
  vueControles, fermerConstat, ouvrirCible,
  // Barre d'état
  installerBarres, majBarreControles, majBadgePdfUa, rafraichirPdfUa,
  // Voile « Analyse en cours… »
  annoncerAnalyse, retenirEnregistrement, slugDeLaTache, compilerChapitreEnregistre,
  etatAnalyse, debuterAnalyse, terminerAnalyse, noterProcessFini, processFini,
  marquerJournalRelu
};
