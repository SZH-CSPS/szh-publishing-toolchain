// SZH cockpit — liens profonds « szh:// » (D123).
//
// « Envoyer pour traduction » fabrique un lien qu'on colle dans un e-mail ou un
// message Teams. Cliqué sur un poste de rédaction, il ouvre le BON numéro dans
// VSCodium et l'amène directement sur le suivi de traduction — au lieu de « ouvre
// « Revues SZH », cherche 2026-01, clique l'article, ouvre l'onglet Traductions ».
//
// FORMAT (contrat partagé avec windows/open-revue.ps1, qui le PARSE — deux langages,
// une seule grammaire, à maintenir ensemble) :
//     szh://traduction/<produit>/<numero>            tout le numéro
//     szh://traduction/<produit>/<numero>/<article>   un article
//   produit : « revue » | « zeitschrift » (jeton canonique de D74)
//   numero  : nom du DOSSIER de la revue (« 2026-01 ») — jamais un chemin
//   article : slug de l'article (« 03-inklusion »)
//
// Le lien ne contient AUCUN chemin : c'est le lanceur qui retrouve le dossier dans
// les emplacements connus du poste (Get-SzhEmplacements). Un lien reçu par e-mail est
// donc une DONNÉE NON FIABLE qui ne peut désigner qu'un numéro existant de
// l'arborescence officielle — jamais un dossier arbitraire. D'où les alphabets stricts
// ci-dessous, appliqués des DEUX côtés.
//
// ATTERRISSAGE : le lanceur ne peut pas dire à VSCodium « ouvre tel panneau ». Il
// dépose donc une INTENTION à usage unique dans %LOCALAPPDATA%\SZH\intention.json,
// puis ouvre le dossier ; le cockpit la lit à l'activation, vérifie qu'elle vise BIEN
// la revue qui s'ouvre, la consomme (fichier supprimé) et ouvre le panneau. Hors du
// dossier de revue exprès : rien de technique n'entre dans une revue (D8), et une
// intention périmée ne suit pas la revue sur OneDrive.
'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA = 'szh';
const VUE_TRADUCTION = 'traduction';

// Alphabets STRICTS — un segment ne peut être qu'un nom de dossier ou un slug, jamais
// un chemin : ni séparateur, ni « .. », ni deux-points, ni espace. Miroir des motifs
// de windows/open-revue.ps1.
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

// construireLienTraduction('zeitschrift', '2026-01', '03-inklusion')
//   -> 'szh://traduction/zeitschrift/2026-01/03-inklusion'
// Chaîne VIDE si un élément ne passe pas les gardes : mieux vaut pas de lien qu'un
// lien qui ouvrira autre chose. `slug` est facultatif (lien vers tout le numéro).
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

// ---- Intention d'ouverture (usage unique) -------------------------------------------
//
// ⚠ Même chemin que Set-SzhIntention dans windows/szh-common.ps1.
const DOSSIER_INTENTION = path.join(process.env.LOCALAPPDATA || '', 'SZH');
const FICHIER_INTENTION = path.join(DOSSIER_INTENTION, 'intention.json');
// Au-delà, l'intention est périmée : elle vient d'un clic ancien (VSCodium a été fermé
// entre-temps, la revue a été ouverte à la main…) et ne doit plus dérouter personne.
const PEREMPTION_MS = 5 * 60 * 1000;

// Lit l'intention si elle vise `racine` et n'est pas périmée, puis la CONSOMME.
// Retourne { vue, article } ou null. Ne lève jamais.
//   - visée par une AUTRE revue -> laissée en place (la bonne fenêtre la prendra) ;
//   - périmée ou illisible      -> supprimée, et on renvoie null.
function consommerIntention(racine) {
  let brut;
  try { brut = fs.readFileSync(FICHIER_INTENTION, 'utf8'); }
  catch (e) { return null; }                       // absente : le cas normal
  let intention = null;
  // BOM retiré avant l'analyse : PowerShell peut en poser un, et JSON.parse le refuse
  // — l'intention passerait alors pour illisible et le lien n'atterrirait jamais.
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
