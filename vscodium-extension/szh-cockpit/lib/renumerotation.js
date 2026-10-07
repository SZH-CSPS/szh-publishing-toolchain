// Aligner le numéro du dossier sur celui de l'écran.
//
// Sans accès disque : le module rend un plan, que lib/renumerotation-fs.js exécute. Les cas
// délicats (échange de deux rangs, interruption, dossier déjà en place) se testent ainsi
// sans arborescence.
//
// Le numéro affiché d'un article vient de son rang dans l'ordre du numéro ; le préfixe de
// son dossier doit le suivre quand l'ordre change.
//
// Deux passes : deux articles qui échangent leur rang ne peuvent pas se renommer
// directement. Chaque dossier passe par un nom temporaire qui porte sa destination
// (« ~ordre-02-inclusion ») ; après une interruption, planReprise() n'a qu'à lire ces noms.
//
// Les images et les tableaux, désignés en chemin relatif depuis le .md, ne bougent pas. Le
// .md, la fiche, la bibliographie et le sidecar des tâches portent le nom du dossier (le
// Makefile l'exige pour le .md) : tout fichier dont le nom commence par l'ancien slug est
// renommé, ce qui couvre aussi un futur sidecar.
//
// Le marqueur de bibliographie, qui nomme <slug>.biblio.md dans le texte du .md, est
// réécrit à part par lib/renumerotation-fs.js (reecrireMarqueurBiblio()).
'use strict';

const { prefixeOrdre } = require('./articles');

// Le préfixe temporaire. Le tilde n'apparaît dans aucun slug et se trie en fin de liste
// dans l'explorateur : un lot interrompu se voit.
const PREFIXE_TEMPO = '~ordre-';

// La partie parlante d'un slug : ce qui reste une fois le « NN- » retiré. Un dossier créé à
// la main n'en a pas, et garde alors son nom entier.
function tige(slug) {
  const m = String(slug).match(/^(\d+)-(.+)$/);
  return m ? m[2] : String(slug);
}

// Le préfixe vient de prefixeOrdre() (lib/articles.js), qui calcule aussi le nombre
// affiché (libelleArticle(), et le DOI par rangDoi()) : disque et écran ont le même nombre.
function nomVoulu(slug, rang) {
  return prefixeOrdre(rang) + '-' + tige(slug);
}

// Les fichiers d'un dossier qui portent son nom, et le nom qu'ils prendront. Un fichier
// étranger au slug — une note, un Word déposé à la main — n'est pas touché.
function fichiersSuivis(fichiers, ancien, neuf) {
  const suivis = [];
  for (const nom of fichiers || []) {
    const n = String(nom);
    if (n.indexOf(ancien) !== 0) { continue; }
    suivis.push({ de: n, vers: neuf + n.slice(ancien.length) });
  }
  return suivis;
}

// planRenumerotation(articles, ordreVoulu) -> { aFaire, renommages, passes }
//
//   articles   [{ slug, fichiers: [nom…] }] — l'état du disque, dans n'importe quel ordre.
//   ordreVoulu [slug…] — les mêmes slugs, dans l'ordre affiché, calculé par l'appelant.
//
//   renommages [{ de, vers, fichiers: [{de, vers}] }] — les dossiers qui changent de nom.
//   passes     [[{de, vers}…], …] — les mouvements à exécuter, dans l'ordre. Deux passes
//              quand il y a des renommages, une seule à la reprise.
function planRenumerotation(articles, ordreVoulu) {
  const parSlug = new Map();
  for (const a of articles || []) { parSlug.set(String(a.slug), a); }
  const voulu = (ordreVoulu || []).map(String);

  // Un ordre calculé sur une liste périmée est refusé, et non complété.
  if (voulu.length !== parSlug.size) {
    throw new Error('ordre incomplet : ' + voulu.length + ' rangs pour ' + parSlug.size + ' articles');
  }
  for (const slug of voulu) {
    if (!parSlug.has(slug)) { throw new Error('ordre inconnu : « ' + slug + ' » n’est pas un article de ce numéro'); }
  }

  const renommages = [];
  voulu.forEach((slug, i) => {
    const vers = nomVoulu(slug, i);
    if (vers === slug) { return; }                 // déjà au bon rang
    renommages.push({ de: slug, vers: vers,
                      tempo: PREFIXE_TEMPO + vers,
                      fichiers: fichiersSuivis(parSlug.get(slug).fichiers, slug, vers) });
  });

  const cibles = renommages.map((r) => r.vers);
  if (new Set(cibles).size !== cibles.length) {
    throw new Error('deux articles viseraient le même dossier : ' + cibles.join(', '));
  }

  // Les passes ne portent que des dossiers. Leurs fichiers se renomment après, une fois le
  // nom définitif atteint, pour qu'une interruption ne les laisse pas sous un nom temporaire.
  const passes = renommages.length === 0 ? [] : [
    renommages.map((r) => ({ de: r.de, vers: r.tempo })),
    renommages.map((r) => ({ de: r.tempo, vers: r.vers }))
  ];
  return { aFaire: renommages.length > 0, renommages: renommages, passes: passes };
}

// planReprise(dossiers) -> { aFaire, passes }
//
// Ce qu'il reste à faire après un lot interrompu : les « ~ordre-… » restés sur le disque
// portent leur destination. Une seule passe suffit, aucune destination n'étant occupée par
// un dossier en attente.
function planReprise(dossiers) {
  const noms = (dossiers || []).map(String);
  const presents = new Set(noms);
  const etapes = [];
  for (const nom of noms) {
    if (nom.indexOf(PREFIXE_TEMPO) !== 0) { continue; }
    const vers = nom.slice(PREFIXE_TEMPO.length);
    // Une destination déjà occupée (deux exécutions concurrentes, ou dossier recréé à la
    // main) : refus, pour ne rien écraser.
    if (presents.has(vers)) {
      throw new Error('reprise impossible : « ' + vers + ' » est occupé');
    }
    etapes.push({ de: nom, vers: vers, fichiers: [] });
  }
  return { aFaire: etapes.length > 0, passes: etapes.length === 0 ? [] : [etapes] };
}

module.exports = { PREFIXE_TEMPO, tige, nomVoulu, planRenumerotation, planReprise };
