// Liens profonds « szh:// ». Collé dans un e-mail et cliqué sur un poste de rédaction, un
// tel lien ouvre le bon numéro dans VSCodium, sur le suivi de traduction.
//
// Format, à maintenir identique au parseur de windows/open-revue.ps1 :
//     szh://traduction/<produit>/<numero>[/<article>]
//   produit : « revue » | « zeitschrift »
//   numero  : nom du dossier de la revue (« 2026-01 »), jamais un chemin
//   article : slug de l'article (« 03-inklusion »)
//
// Le lien ne porte aucun chemin : le lanceur retrouve le dossier dans les emplacements
// connus du poste. Un lien reçu par e-mail est une donnée non fiable, d'où les alphabets
// stricts ci-dessous, appliqués des deux côtés.
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

const RE_NUMERO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RE_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PRODUITS = ['revue', 'zeitschrift'];

function numeroValide(numero) {
  const v = String(numero === undefined || numero === null ? '' : numero);
  return RE_NUMERO.test(v) && v.indexOf('..') === -1;
}

function slugLienValide(slug) {
  const v = String(slug === undefined || slug === null ? '' : slug);
  return RE_SLUG.test(v) && v.indexOf('--') === -1;
}

// Chaîne vide si un élément ne passe pas les gardes : mieux vaut pas de lien qu'un lien
// qui ouvrira autre chose. `slug` est facultatif, et vise alors tout le numéro.
function construireLienTraduction(produit, numero, slug) {
  const p = String(produit === undefined || produit === null ? '' : produit);
  if (PRODUITS.indexOf(p) === -1) { return ''; }
  if (!numeroValide(numero)) { return ''; }
  const base = SCHEMA + '://' + VUE_TRADUCTION + '/' + p + '/' + numero;
  const s = String(slug === undefined || slug === null ? '' : slug);
  if (s === '') { return base; }
  if (!slugLienValide(s)) { return ''; }
  return base + '/' + s;
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
  SCHEMA, VUE_TRADUCTION, PRODUITS, FICHIER_INTENTION,
  numeroValide, slugLienValide, construireLienTraduction,
  consommerIntention, effacerIntention
};
