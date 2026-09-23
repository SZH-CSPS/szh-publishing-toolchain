// Liens profonds « szh:// ». Un tel lien ne porte AUCUN chemin : il nomme un produit et un
// numéro (par son IDENTIFIANT, jamais son nom de dossier depuis le 23.09.2026), et le
// lanceur retrouve le dossier en cherchant cet identifiant dans les emplacements connus du
// poste. C'est ce qui le rend valable d'un poste à l'autre, là où un chemin absolu contient
// le nom du compte Windows et meurt au premier voyage par OneDrive -- et ce qui le rend
// valable après un RENOMMAGE ou un ARCHIVAGE du dossier, là où un lien par nom mourait au
// premier des deux : l'identifiant, lui, ne bouge jamais (posé une fois à la création,
// jamais recalculé -- new-revue.ps1, new-livre.ps1).
//
// Deux verbes, à maintenir identiques au parseur de windows/szh-produits.ps1 (Get-SzhLien,
// $SzhLienMotif / $SzhLienMotifOuvrir) :
//
//     szh://traduction/<produit>/<id>[/<article>]
//       Collé dans un e-mail par « Envoyer pour traduction » : ouvre le numéro dans
//       VSCodium, sur le suivi de traduction. produit : « revue » | « zeitschrift ».
//
//     szh://ouvrir/<produit>/<id>
//       Ce que porte le raccourci « Ouvrir la revue.lnk » (« Ouvrir le livre.lnk ») posé à
//       la racine de chaque numéro : ouvre le dossier, rien de plus. Le livre s'ajoute ici
//       aux deux revues, parce qu'il porte le même raccourci.
//
//   id      : la clé `id:` d'ausgabe.yaml / buch.yaml -- 16 caractères [A-Za-z0-9], posée
//             une fois à la création et jamais recalculée. Résolue par une recherche dans
//             les numéros/livres EN COURS et ARCHIVÉS du produit (jamais un chemin).
//   article : slug de l'article (« 03-inklusion »), verbe « traduction » seulement
//
// Pas de rétrocompatibilité avec un lien portant l'ancien nom de dossier : aucune
// production n'était en cours au moment du changement.
//
// Un lien reçu par e-mail est une donnée non fiable, d'où l'alphabet strict ci-dessous,
// appliqué des deux côtés.
//
// Le lanceur ne peut pas demander à VSCodium d'ouvrir tel panneau : il dépose une
// intention à usage unique dans %LOCALAPPDATA%\SZH\intention.json puis ouvre le dossier,
// et le cockpit la lit à l'activation, vérifie qu'elle vise bien cette revue, la supprime
// et ouvre le panneau. Elle reste hors du dossier de revue pour ne pas le suivre sur
// OneDrive.
'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA = 'szh';
const VUE_TRADUCTION = 'traduction';
const VUE_OUVRIR = 'ouvrir';

// 16 caractères [A-Za-z0-9], ni plus ni moins : la forme exacte de `id:` (ausgabe.yaml,
// buch.yaml). Aucun séparateur de chemin, aucune lettre de lecteur, aucun « .. » possible
// dans cet alphabet -- inutile de les refuser à part, comme il fallait le faire pour un nom
// de dossier.
const RE_ID = /^[A-Za-z0-9]{16}$/;
const RE_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PRODUITS = ['revue', 'zeitschrift'];
// Le livre ne figure QUE dans le verbe « ouvrir » : il n'a pas de suivi de traduction, donc
// rien à faire dans « traduction », et l'y admettre ouvrirait une grammaire vers un panneau
// qui n'existe pas pour lui.
const PRODUITS_OUVRIR = ['revue', 'zeitschrift', 'livre'];

// ⚠ Ces deux chaînes sont recopiées CARACTÈRE POUR CARACTÈRE de $script:SzhLienMotif et
// $script:SzhLienMotifOuvrir (windows/szh-produits.ps1). C'est délibérément une copie et non
// une dérivation : les deux mondes ne partagent aucun fichier. Un banc de test
// (test/js/raccourcis-portables.test.js) compare les quatre littéraux et fait échouer la
// suite dès qu'un côté bouge seul — une grammaire qui diverge, c'est un lien qui s'ouvre
// d'un côté et se refuse de l'autre, sans que personne ne sache lequel a raison.
const MOTIF_TRADUCTION = '^szh://traduction/(revue|zeitschrift)/([A-Za-z0-9]{16})(?:/([a-z0-9][a-z0-9-]{0,63}))?/?$';
const MOTIF_OUVRIR = '^szh://ouvrir/(revue|zeitschrift|livre)/([A-Za-z0-9]{16})/?$';
// L'indicateur « i » n'est pas une facilité : c'est ce qui aligne l'analyse sur PowerShell,
// dont l'opérateur -match ignore la casse par défaut. Sans lui, « szh://OUVRIR/revue/… »
// s'ouvrirait sur le poste et se ferait refuser par le cockpit — exactement la divergence
// que la copie des deux motifs cherche à empêcher. Les alphabets restent bornés de la même
// façon : rien de ce qui est refusé (séparateur, lettre de lecteur, longueur) ne passe pour
// autant. La casse D'ORIGINE est rendue telle quelle, des deux côtés ($Matches[n] côté
// PowerShell), et c'est le résolveur qui la normalise.
const RE_TRADUCTION = new RegExp(MOTIF_TRADUCTION, 'i');
const RE_OUVRIR = new RegExp(MOTIF_OUVRIR, 'i');

function idValide(id) {
  const v = String(id === undefined || id === null ? '' : id);
  return RE_ID.test(v);
}

function slugLienValide(slug) {
  const v = String(slug === undefined || slug === null ? '' : slug);
  return RE_SLUG.test(v) && v.indexOf('--') === -1;
}

// Chaîne vide si un élément ne passe pas les gardes : mieux vaut pas de lien qu'un lien
// qui ouvrira autre chose. `slug` est facultatif, et vise alors tout le numéro.
function construireLienTraduction(produit, id, slug) {
  const p = String(produit === undefined || produit === null ? '' : produit);
  if (PRODUITS.indexOf(p) === -1) { return ''; }
  if (!idValide(id)) { return ''; }
  const base = SCHEMA + '://' + VUE_TRADUCTION + '/' + p + '/' + id;
  const s = String(slug === undefined || slug === null ? '' : slug);
  if (s === '') { return base; }
  if (!slugLienValide(s)) { return ''; }
  return base + '/' + s;
}

// Le lien que porte le raccourci posé à la racine d'un numéro. Même prudence que ci-dessus :
// chaîne vide si le produit est inconnu ou l'id hors alphabet — mieux vaut pas de raccourci
// qu'un raccourci qui ouvre autre chose.
function construireLienOuvrir(produit, id) {
  const p = String(produit === undefined || produit === null ? '' : produit);
  if (PRODUITS_OUVRIR.indexOf(p) === -1) { return ''; }
  if (!idValide(id)) { return ''; }
  return SCHEMA + '://' + VUE_OUVRIR + '/' + p + '/' + id;
}

// Jumeau exact de Get-SzhLien (windows/szh-produits.ps1) : -> { vue, produit, id, article },
// ou null si la grammaire n'est pas respectée. Le nettoyage d'entrée reproduit le sien dans
// le même ordre — le gestionnaire de protocole de Windows peut ajouter des espaces, un « / »
// final ou un caractère nul. L'alphabet de l'id (16 alnum) exclut par construction tout
// séparateur et tout « .. » : inutile de les refuser à part.
function analyserLien(lien) {
  if (lien === undefined || lien === null || lien === '') { return null; }
  const net = String(lien).trim().replace(/^\u0000+/, '').replace(/\u0000+$/, '');
  const t = RE_TRADUCTION.exec(net);
  if (t) {
    return { vue: VUE_TRADUCTION, produit: t[1], id: t[2], article: t[3] || '' };
  }
  const o = RE_OUVRIR.exec(net);
  if (o) {
    return { vue: VUE_OUVRIR, produit: o[1], id: o[2], article: '' };
  }
  return null;
}

// ⚠ Même chemin que Set-SzhIntention dans windows/szh-common.ps1.
const DOSSIER_INTENTION = path.join(process.env.LOCALAPPDATA || '', 'SZH');
const FICHIER_INTENTION = path.join(DOSSIER_INTENTION, 'intention.json');
const PEREMPTION_MS = 5 * 60 * 1000;

// Lit l'intention si elle vise `racine` et n'est pas périmée, puis la supprime ; renvoie
// { vue, article } ou null, sans jamais lever. Une intention qui vise une autre revue est
// laissée en place pour la bonne fenêtre ; périmée ou illisible, elle part.
function consommerIntention(racine) {
  let brut;
  try { brut = fs.readFileSync(FICHIER_INTENTION, 'utf8'); }
  catch (e) { return null; }                       // absente : le cas normal
  let intention = null;
  // BOM retiré avant l'analyse : PowerShell peut en poser un et JSON.parse le refuse,
  // l'intention passerait alors pour illisible.
  try { intention = JSON.parse(String(brut).replace(/^﻿/, '')); } catch (e) { intention = null; }
  const pose = intention && Number(intention.pose);
  const perimee = !intention || !pose || !isFinite(pose) || (Date.now() - pose) > PEREMPTION_MS;
  if (perimee) { effacerIntention(); return null; }
  const cible = String(intention.revue || '');
  if (cible === '' || !racine || cible.toLowerCase() !== String(racine).toLowerCase()) {
    return null;                                   // pas pour cette fenêtre
  }
  effacerIntention();
  const article = String(intention.article || '');
  return {
    vue: String(intention.vue || ''),
    article: slugLienValide(article) ? article : ''
  };
}

function effacerIntention() {
  try { fs.unlinkSync(FICHIER_INTENTION); } catch (e) { /* déjà partie */ }
}

module.exports = {
  SCHEMA, VUE_TRADUCTION, VUE_OUVRIR, PRODUITS, PRODUITS_OUVRIR, FICHIER_INTENTION,
  MOTIF_TRADUCTION, MOTIF_OUVRIR,
  idValide, slugLienValide, construireLienTraduction, construireLienOuvrir,
  analyserLien, consommerIntention, effacerIntention
};
