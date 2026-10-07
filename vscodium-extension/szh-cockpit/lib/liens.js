// Liens profonds « szh:// ». Un lien ne porte pas de chemin : il nomme un produit et
// l'identifiant d'un numéro, et le lanceur cherche cet identifiant dans les emplacements
// connus du poste. Le lien reste donc valable d'un poste à l'autre (un chemin absolu
// contient le compte Windows) et après un renommage ou un archivage du dossier.
//
// Deux verbes, identiques au parseur de windows/szh-produits.ps1 (Get-SzhLien,
// $SzhLienMotif, $SzhLienMotifOuvrir) :
//
//     szh://traduction/<produit>/<id>[/<article>]
//       Collé dans un e-mail par « Envoyer pour traduction » : ouvre le numéro dans
//       VSCodium, sur le suivi de traduction. produit : « revue » | « zeitschrift ».
//
//     szh://ouvrir/<produit>/<id>
//       Porté par le raccourci « Ouvrir la revue.lnk » (« Ouvrir le livre.lnk ») à la racine
//       de chaque numéro : ouvre le dossier. produit : « revue » | « zeitschrift » | « livre ».
//
//   id      : la clé `id:` d'ausgabe.yaml / buch.yaml, 16 caractères [A-Za-z0-9], posée à
//             la création (new-revue.ps1, new-livre.ps1) et jamais recalculée. Cherchée
//             parmi les numéros en cours et archivés du produit.
//   article : slug de l'article (« 03-inklusion »), verbe « traduction » seulement.
//
// Un lien reçu par e-mail n'est pas fiable : les deux côtés appliquent le même alphabet strict.
//
// Le lanceur ne peut pas demander à VSCodium d'ouvrir un panneau : il dépose une intention à
// usage unique dans %LOCALAPPDATA%\SZH\intention.json, puis ouvre le dossier. À l'activation,
// le cockpit la lit, vérifie qu'elle vise cette revue, la supprime et ouvre le panneau.
// Elle vit hors du dossier de revue pour ne pas être synchronisée par OneDrive.
'use strict';

const fs = require('fs');
const path = require('path');
const { racineUtilisateur } = require('./poste');

const SCHEMA = 'szh';
const VUE_TRADUCTION = 'traduction';
const VUE_OUVRIR = 'ouvrir';

// Forme exacte de `id:`. Cet alphabet exclut séparateur de chemin, lettre de lecteur et « .. ».
const RE_ID = /^[A-Za-z0-9]{16}$/;
const RE_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PRODUITS = ['revue', 'zeitschrift'];
// Le livre n'a pas de suivi de traduction : il n'est admis que dans le verbe « ouvrir ».
const PRODUITS_OUVRIR = ['revue', 'zeitschrift', 'livre'];

// Copies exactes de $script:SzhLienMotif et $script:SzhLienMotifOuvrir
// (windows/szh-produits.ps1), qui ne partage aucun fichier avec le cockpit.
// test/js/raccourcis-portables.test.js vérifie que les deux côtés sont identiques.
const MOTIF_TRADUCTION = '^szh://traduction/(revue|zeitschrift)/([A-Za-z0-9]{16})(?:/([a-z0-9][a-z0-9-]{0,63}))?/?$';
const MOTIF_OUVRIR = '^szh://ouvrir/(revue|zeitschrift|livre)/([A-Za-z0-9]{16})/?$';
// « i » aligne l'analyse sur -match de PowerShell, qui ignore la casse. Les valeurs sont
// rendues dans leur casse d'origine, des deux côtés ; le résolveur la normalise.
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

// Chaîne vide si un élément est invalide. Sans `slug`, le lien vise tout le numéro.
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

// Lien du raccourci posé à la racine d'un numéro ; chaîne vide si le produit ou l'id est invalide.
function construireLienOuvrir(produit, id) {
  const p = String(produit === undefined || produit === null ? '' : produit);
  if (PRODUITS_OUVRIR.indexOf(p) === -1) { return ''; }
  if (!idValide(id)) { return ''; }
  return SCHEMA + '://' + VUE_OUVRIR + '/' + p + '/' + id;
}

// Même analyse que Get-SzhLien (windows/szh-produits.ps1) : -> { vue, produit, id, article },
// ou null. Le nettoyage d'entrée suit le même ordre : le gestionnaire de protocole de Windows
// peut ajouter des espaces, un « / » final ou un caractère nul.
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

// Même chemin que Set-SzhIntention (windows/szh-common.ps1).
const DOSSIER_INTENTION = path.join(racineUtilisateur(), 'SZH');
const FICHIER_INTENTION = path.join(DOSSIER_INTENTION, 'intention.json');
const PEREMPTION_MS = 5 * 60 * 1000;

// Lit l'intention si elle vise `racine` et n'est pas périmée, puis la supprime ; rend
// { vue, article } ou null, sans lever. Une intention pour une autre revue reste en place
// pour sa fenêtre ; périmée ou illisible, elle est supprimée.
function consommerIntention(racine) {
  let brut;
  try { brut = fs.readFileSync(FICHIER_INTENTION, 'utf8'); }
  catch (e) { return null; }                       // absente : cas normal
  let intention = null;
  // PowerShell peut poser un BOM, que JSON.parse refuse.
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
