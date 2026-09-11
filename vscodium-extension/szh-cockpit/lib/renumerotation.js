// Aligner le numéro du dossier sur celui de l'écran.
//
// Données pures et fonctions pures : ni `vscode`, ni `fs`, aucun accès disque — comme
// lib/constats.js et lib/codes-erreur.js. Ce module ne renomme rien : il rend un PLAN, que
// l'hôte exécute. C'est ce qui permet d'éprouver les cas qui font mal — l'échange de deux
// rangs, l'interruption au milieu, le dossier déjà en place — sans monter une arborescence.
//
// LE PROBLÈME. Le numéro qu'un article porte à l'écran vient de son rang dans l'ordre du
// numéro ; le préfixe de son dossier est figé à l'import et n'était jamais renommé — c'était
// écrit noir sur blanc dans l'infobulle de « Monter ». Les deux divergent donc au premier
// déplacement, et l'on cherche l'article 3 dans l'explorateur pour tomber sur « 01- ».
//
// DEUX PASSES, ET POURQUOI. Deux articles qui échangent leur rang ne peuvent pas se
// renommer directement : le premier viserait un nom que le second occupe encore. Tout
// dossier qui change de nom passe donc par un temporaire, puis rejoint sa destination. Le
// temporaire PORTE sa destination (« ~ordre-02-inclusion ») : c'est ce qui rend une
// interruption rattrapable, planReprise() n'ayant alors qu'à lire les noms restés sur le
// disque.
//
// CE QUI NE BOUGE PAS. Les images et les tableaux sont désignés en chemin relatif depuis le
// .md (`media/x.png`, `tables/y.html`) : ils ne sont pas concernés. En revanche le .md
// lui-même porte le nom de son dossier — le Makefile l'exige — et la fiche, la
// bibliographie et le sidecar des tâches suivent la même règle. On renomme donc, dans le
// dossier, tout fichier dont le nom commence par l'ancien slug : cela attrape aussi les
// sidecars qu'on ne connaît pas encore, alors qu'une liste écrite ici en oublierait un le
// jour où la chaîne en ajoute un.
'use strict';

// Le préfixe temporaire. Le tilde n'apparaît dans aucun slug (slugifier ne le produit
// jamais) et trie en fin de liste dans l'explorateur : un lot interrompu se voit.
const PREFIXE_TEMPO = '~ordre-';

// La partie parlante d'un slug : ce qui reste une fois le « NN- » retiré. Un dossier créé à
// la main n'en a pas, et garde alors son nom entier.
function tige(slug) {
  const m = String(slug).match(/^(\d+)-(.+)$/);
  return m ? m[2] : String(slug);
}

// Deux chiffres jusqu'à 99, puis autant qu'il en faut : un numéro de revue en compte dix,
// jamais cent, mais tronquer serait pire que s'allonger.
function prefixe(rang) {
  return (rang < 10 ? '0' : '') + String(rang);
}

function nomVoulu(slug, rang) {
  return prefixe(rang) + '-' + tige(slug);
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
//   ordreVoulu [slug…] — les mêmes slugs, dans l'ordre voulu à l'écran. C'est l'appelant
//              qui l'a calculé, avec la fonction qui décide déjà de l'ordre affiché : le
//              rang ne se recalcule pas ici, sinon le disque et l'écran divergeraient à
//              nouveau, en pire.
//
//   renommages [{ de, vers, fichiers: [{de, vers}] }] — les dossiers qui changent de nom.
//   passes     [[{de, vers}…], …] — les mouvements à exécuter, dans l'ordre. Deux passes
//              quand il y a des renommages, une seule à la reprise.
function planRenumerotation(articles, ordreVoulu) {
  const parSlug = new Map();
  for (const a of articles || []) { parSlug.set(String(a.slug), a); }
  const voulu = (ordreVoulu || []).map(String);

  // Un ordre calculé sur une liste périmée renommerait au hasard : on refuse, on ne
  // complète pas d'office.
  if (voulu.length !== parSlug.size) {
    throw new Error('ordre incomplet : ' + voulu.length + ' rangs pour ' + parSlug.size + ' articles');
  }
  for (const slug of voulu) {
    if (!parSlug.has(slug)) { throw new Error('ordre inconnu : « ' + slug + ' » n’est pas un article de ce numéro'); }
  }

  const renommages = [];
  voulu.forEach((slug, i) => {
    const vers = nomVoulu(slug, i + 1);
    if (vers === slug) { return; }                 // déjà au bon rang : on n'y touche pas
    renommages.push({ de: slug, vers: vers,
                      tempo: PREFIXE_TEMPO + vers,
                      fichiers: fichiersSuivis(parSlug.get(slug).fichiers, slug, vers) });
  });

  const cibles = renommages.map((r) => r.vers);
  if (new Set(cibles).size !== cibles.length) {
    throw new Error('deux articles viseraient le même dossier : ' + cibles.join(', '));
  }

  // Les passes ne portent que des DOSSIERS. Les fichiers de chaque dossier se renomment
  // après les deux passes, quand le dossier a repris un nom définitif : les renommer plus
  // tôt les laisserait sous un nom temporaire si le lot s'interrompait entre les deux.
  const passes = renommages.length === 0 ? [] : [
    renommages.map((r) => ({ de: r.de, vers: r.tempo })),
    renommages.map((r) => ({ de: r.tempo, vers: r.vers }))
  ];
  return { aFaire: renommages.length > 0, renommages: renommages, passes: passes };
}

// planReprise(dossiers) -> { aFaire, passes }
//
// Ce qu'il reste à faire quand un lot s'est interrompu : des « ~ordre-… » traînent sur le
// disque, et leur nom porte leur destination. Une seule passe suffit — le temporaire est
// justement ce qui garantit qu'aucune destination n'est occupée par un dossier en attente.
function planReprise(dossiers) {
  const noms = (dossiers || []).map(String);
  const presents = new Set(noms);
  const etapes = [];
  for (const nom of noms) {
    if (nom.indexOf(PREFIXE_TEMPO) !== 0) { continue; }
    const vers = nom.slice(PREFIXE_TEMPO.length);
    // Une destination déjà occupée veut dire deux exécutions concurrentes, ou un dossier
    // recréé à la main : on refuse plutôt que d'écraser le travail de quelqu'un.
    if (presents.has(vers)) {
      throw new Error('reprise impossible : « ' + vers + ' » est occupé');
    }
    etapes.push({ de: nom, vers: vers, fichiers: [] });
  }
  return { aFaire: etapes.length > 0, passes: etapes.length === 0 ? [] : [etapes] };
}

module.exports = { PREFIXE_TEMPO, tige, nomVoulu, planRenumerotation, planReprise };
