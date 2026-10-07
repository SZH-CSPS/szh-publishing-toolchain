// Co-édition : quand plusieurs postes travaillent le même numéro, un seul à la fois modifie
// un fichier donné, grâce à un bail.
//
// À distinguer de lib/verrou.js, où « verrou » désigne un numéro gelé en lecture seule.
// Ici rien n'est gelé : un formulaire pose un bail de deux minutes sur le fichier qu'il
// modifie. Les gardes s'enchaînent dans cet ordre : le verrou du numéro, puis le bail.
//
// ── Le problème ───────────────────────────────────────────────────────────────────
// Le numéro vit sur OneDrive/SharePoint. Quand deux postes écrivent le même fichier dans la
// même fenêtre de synchronisation, OneDrive dépose une « copie en conflit » à côté, et une
// des deux saisies sort du numéro (voir aussi lib/copies-conflit.js).
//
// ── Le bail expire seul ───────────────────────────────────────────────────────────
// Il dure BAIL_MS (2 min) et se renouvelle à chaque action de son titulaire. Poste éteint,
// VSCodium tué, formulaire laissé ouvert : après deux minutes sans action, le fichier est
// libre. Personne n'a à rendre un bail.
//
// ── Un fichier par titulaire ──────────────────────────────────────────────────────
// .szh-edition/<fichier-visé>--<qui>.json : deux postes qui posent leur bail au même instant
// écrivent deux fichiers différents, donc sans copie en conflit. Le titulaire se lit en
// filtrant le dossier sur le préfixe ; en cas de pose simultanée, le bail le plus ancien
// gagne et l'autre se retire.
//
// ── Renouvellement limité ─────────────────────────────────────────────────────────
// Les formulaires enregistrent toutes les trois secondes (media/_commun.js). Pour ne pas
// faire répliquer le bail à ce rythme, un bail plus récent que RENOUVELLEMENT_MS n'est pas
// réécrit.
//
// ── Limite ────────────────────────────────────────────────────────────────────────
// Le bail voyage par OneDrive, en quelques secondes à quelques minutes. Pendant ce délai,
// deux saisies simultanées restent possibles. D'où la seconde protection, côté hôte
// (lib/coedition-hote.js) : l'empreinte du fichier, prise au chargement du formulaire, est
// comparée avant d'écrire une saisie restée inactive.
//
// ── Horloges ──────────────────────────────────────────────────────────────────────
// Les dates sont écrites par un poste et relues par un autre. instantReference() retient la
// plus tardive de la date écrite et de celle du fichier, et écarte la date écrite si elle
// est trop en avance : un poste en avance d'une heure ne garde pas ses baux une heure. Un
// poste en retard, lui, voit ses baux paraître expirés aux autres, OneDrive conservant la
// date de modification d'origine. Sur un parc à l'heure du domaine, l'écart est de quelques
// secondes.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DOSSIER_EDITION = '.szh-edition';

// Durée du bail.
const BAIL_MS = 2 * 60 * 1000;
// Au-delà, une saisie inactive ne s'écrit que si le fichier n'a pas changé (empreinte).
const INACTIVITE_MS = 5 * 60 * 1000;
// Un bail plus récent n'est pas réécrit : voir « Renouvellement limité ».
const RENOUVELLEMENT_MS = 30 * 1000;
// Un bail expiré est ignoré, mais son fichier n'est effacé qu'après ce délai : effacer tôt
// un fichier qu'un autre poste tient encore pousserait OneDrive à le recréer.
const PEREMPTION_MS = 24 * 60 * 60 * 1000;

function dossierEdition(racine) { return path.join(racine, DOSSIER_EDITION); }

// Chemin -> clé du bail : relative au numéro, séparateurs unifiés, en minuscules (Windows
// ignore la casse ; deux chemins vers le même fichier donnent un seul bail). null quand le
// chemin sort du numéro.
function clefFichier(racine, chemin) {
  if (!racine || !chemin) { return null; }
  const rel = path.relative(racine, chemin).split(path.sep).join('/');
  if (rel === '' || rel.startsWith('../') || rel === '..') { return null; }
  return rel.toLowerCase();
}

// Un morceau de nom de fichier sûr sur Windows. Les suites de « - » sont réduites, si bien
// qu'un jeton ne peut pas contenir le séparateur « -- » du nom complet.
function jeton(texte) {
  return String(texte === undefined || texte === null ? '' : texte)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
}

// Préfixe du nom de bail, court pour rester loin de la limite des chemins Windows. Au-delà
// de 60 caractères, la fin est remplacée par une empreinte de la clé.
function prefixe(clef) {
  const j = jeton(clef) || 'fichier';
  if (j.length <= 60) { return j; }
  return j.slice(0, 51) + '-' + crypto.createHash('sha1').update(clef).digest('hex').slice(0, 8);
}

// « qui » désigne une personne sur un poste. Le même nom sur deux machines pose deux baux :
// ce sont deux synchronisations, donc deux écrivains.
// `nomRegle` est le réglage szh.nomUtilisateur ; sans lui, le nom de session Windows.
function identite(nomRegle) {
  let utilisateur = String(nomRegle === undefined || nomRegle === null ? '' : nomRegle).trim();
  if (utilisateur === '') {
    try { utilisateur = String(os.userInfo().username || '').trim(); }
    catch (e) { /* pas de compte lisible */ }
  }
  if (utilisateur === '') { utilisateur = 'inconnu'; }
  let poste = '';
  try { poste = String(os.hostname() || '').trim(); } catch (e) { /* pas de nom de poste */ }
  return { utilisateur: utilisateur.slice(0, 80), poste: poste.slice(0, 80) };
}

function qui(id) { return id.utilisateur + '@' + (id.poste || 'poste'); }

function nomBail(clef, id) { return prefixe(clef) + '--' + (jeton(qui(id)) || 'qui') + '.json'; }

// Écriture atomique : un temporaire « ~$… » (préfixe ignoré par OneDrive), puis rename. Un
// bail à moitié écrit serait illisible pour le poste voisin.
function ecrireBail(fichier, valeurs) {
  const tmp = path.join(path.dirname(fichier), '~$' + path.basename(fichier));
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  try {
    fs.writeFileSync(tmp, JSON.stringify(valeurs, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, fichier);
  } finally {
    try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (e) { /* déjà renommé */ }
  }
}

// L'instant à partir duquel le bail se compte (voir « Horloges » en tête de fichier).
function instantReference(renouvele, mtimeMs, maintenant) {
  const t = Date.parse(renouvele);
  if (!isFinite(t) || t > maintenant + BAIL_MS) { return mtimeMs; }
  return Math.max(t, mtimeMs);
}

// Un bail lu du disque, ou null si le fichier a disparu entre le listage et la lecture.
// Un contenu illisible (bail à moitié synchronisé) compte quand même : son nom de fichier
// dit qui le tient.
function lireBail(dossier, nom) {
  const fichier = path.join(dossier, nom);
  let mtimeMs;
  try { mtimeMs = fs.statSync(fichier).mtimeMs; } catch (e) { return null; }
  let brut = null;
  try { brut = JSON.parse(String(fs.readFileSync(fichier, 'utf8')).replace(/^﻿/, '')); }
  catch (e) { /* illisible : le nom du fichier reste */ }
  const lisible = !!(brut && typeof brut === 'object' && !Array.isArray(brut));
  const separateur = nom.lastIndexOf('--');
  const depuisNom = separateur === -1 ? '' : nom.slice(separateur + 2).replace(/\.json$/i, '');
  return {
    nom: nom,
    fichier: lisible ? String(brut.fichier || '') : '',
    utilisateur: lisible && brut.utilisateur ? String(brut.utilisateur) : depuisNom,
    poste: lisible && brut.poste ? String(brut.poste) : '',
    qui: lisible && brut.qui ? String(brut.qui) : depuisNom,
    pose: lisible ? String(brut.pose || '') : '',
    renouvele: lisible ? String(brut.renouvele || '') : '',
    mtimeMs: mtimeMs,
    lisible: lisible
  };
}

// Les temporaires d'écriture « ~$… » sont ignorés : ils sont en cours de renommage.
function nomsDuDossier(racine) {
  try {
    return fs.readdirSync(dossierEdition(racine))
      .filter((nom) => !nom.startsWith('~$') && /\.json$/i.test(nom));
  } catch (e) { return []; }                       // pas de dossier : aucun bail
}

// Cache de baux() : { racine -> { t, table: Map(clef -> baux bruts) } }. Il garde la lecture
// du dossier (lister, lire, parser), pas le verdict d'expiration, recalculé à chaque appel
// pour qu'un bail expire à l'instant exact. Sans lui, chaque formulaire ouvert relirait
// .szh-edition/ toutes les trois secondes. Il vit CACHE_BAUX_MS, et toute écriture dans le
// dossier l'invalide pour cette racine : poser() doit voir son propre bail.
const CACHE_BAUX_MS = 2000;
const cacheBaux = new Map();

function invaliderCacheBaux(racine) { cacheBaux.delete(racine); }

// Les baux posés sur ce fichier, expirés compris : la partie que le cache épargne.
function bauxBruts(racine, clef) {
  const dossier = dossierEdition(racine);
  const attendu = prefixe(clef) + '--';
  const bruts = [];
  for (const nom of nomsDuDossier(racine)) {
    if (!nom.startsWith(attendu)) { continue; }
    const b = lireBail(dossier, nom);
    if (!b) { continue; }
    if (b.lisible && b.fichier !== '' && b.fichier.toLowerCase() !== clef) { continue; }
    bruts.push(b);
  }
  return bruts;
}

// Tous les baux encore valides posés sur ce fichier, le plus ancien d'abord.
function baux(racine, clef, maintenant) {
  const entree = cacheBaux.get(racine);
  const frais = entree && (maintenant - entree.t) < CACHE_BAUX_MS && (maintenant - entree.t) >= 0;
  let bruts;
  if (frais && entree.table.has(clef)) {
    bruts = entree.table.get(clef);
  } else {
    bruts = bauxBruts(racine, clef);
    const table = frais ? entree.table : new Map();
    table.set(clef, bruts);
    cacheBaux.set(racine, { t: frais ? entree.t : maintenant, table: table });
  }
  const trouves = [];
  for (const b of bruts) {
    const reference = instantReference(b.renouvele, b.mtimeMs, maintenant);
    if (maintenant - reference >= BAIL_MS) { continue; }      // expiré : le fichier est libre
    trouves.push(Object.assign({}, b, { reference: reference }));
  }
  // Le plus ancien d'abord : c'est lui qui gagne une pose simultanée.
  trouves.sort((a, b) => {
    const ta = Date.parse(a.pose);
    const tb = Date.parse(b.pose);
    const va = isFinite(ta) ? ta : a.mtimeMs;
    const vb = isFinite(tb) ? tb : b.mtimeMs;
    if (va !== vb) { return va - vb; }
    return a.nom < b.nom ? -1 : (a.nom > b.nom ? 1 : 0);      // départage stable
  });
  return trouves;
}

// Le bail d'un autre poste sur ce fichier, ou null. Pour les actions ponctuelles (déplacer
// un article, cocher « pas de DOI », geler le numéro), qui consultent sans poser de bail.
function titulaireAutre(racine, chemin, id, maintenant) {
  const clef = clefFichier(racine, chemin);
  if (!clef) { return null; }
  const t = maintenant === undefined ? Date.now() : maintenant;
  const moi = qui(id);
  const autres = baux(racine, clef, t).filter((b) => b.qui !== moi);
  return autres.length > 0 ? autres[0] : null;
}

// Tous les baux valides du numéro, hors les nôtres, pour l'archivage : quelqu'un
// travaille-t-il encore dans ce numéro ? Lit le dossier entier, sans le cache : l'archivage
// est une action rare.
function titulairesDuNumero(racine, id, maintenant) {
  const t = maintenant === undefined ? Date.now() : maintenant;
  const dossier = dossierEdition(racine);
  const moi = qui(id);
  const trouves = [];
  for (const nom of nomsDuDossier(racine)) {
    const b = lireBail(dossier, nom);
    if (!b || b.qui === moi) { continue; }
    if (t - instantReference(b.renouvele, b.mtimeMs, t) >= BAIL_MS) { continue; }
    trouves.push(b);
  }
  return trouves;
}

// Pose ou renouvelle le bail. -> { ok: true } quand le fichier est à nous, sinon
// { ok: false, titulaire } avec le bail qui bloque.
//
// La pose se vérifie après écriture : deux postes peuvent avoir trouvé le fichier libre au
// même instant. Le bail le plus ancien gagne ; le perdant retire le sien, sinon les deux
// écriraient ensemble.
function poser(racine, chemin, id, maintenant) {
  const clef = clefFichier(racine, chemin);
  if (!clef) { return { ok: true, hors: true }; }   // hors numéro : rien à protéger
  const t = maintenant === undefined ? Date.now() : maintenant;
  const moi = qui(id);
  const avant = baux(racine, clef, t);
  const barre = avant.find((b) => b.qui !== moi);
  if (barre) { return { ok: false, titulaire: barre }; }
  const mien = avant.find((b) => b.qui === moi);
  // Déjà à nous et récent : pas de réécriture (voir « Renouvellement limité »).
  if (mien && t - mien.reference < RENOUVELLEMENT_MS) { return { ok: true, inchange: true }; }
  const fichierBail = path.join(dossierEdition(racine), nomBail(clef, id));
  try {
    ecrireBail(fichierBail, {
      fichier: clef,
      utilisateur: id.utilisateur,
      poste: id.poste,
      qui: moi,
      // La date de pose ne bouge pas au renouvellement : elle départage une pose simultanée.
      pose: mien && mien.pose !== '' ? mien.pose : new Date(t).toISOString(),
      renouvele: new Date(t).toISOString(),
      bail: BAIL_MS
    });
  } catch (e) {
    // Dossier en lecture seule, disque plein : la saisie n'est pas bloquée, le bail n'est
    // qu'une protection. `echec` dit à l'appelant qu'il écrit sans protection.
    return { ok: true, echec: String((e && e.message) || e) };
  }
  // Le cache date d'avant notre écriture : la vérification qui suit doit relire le dossier.
  invaliderCacheBaux(racine);
  const apres = baux(racine, clef, t);
  const gagnant = apres.length > 0 ? apres[0] : null;
  if (gagnant && gagnant.qui !== moi) {
    try { fs.unlinkSync(fichierBail); } catch (e) { /* déjà retiré */ }
    invaliderCacheBaux(racine);
    return { ok: false, titulaire: gagnant };
  }
  return { ok: true };
}

// Rend le fichier tout de suite (formulaire fermé, panneau détruit), sans attendre que le
// bail expire.
function rendre(racine, chemin, id) {
  const clef = clefFichier(racine, chemin);
  if (!clef) { return; }
  try { fs.unlinkSync(path.join(dossierEdition(racine), nomBail(clef, id))); }
  catch (e) { /* pas posé, ou déjà retiré */ }
  invaliderCacheBaux(racine);
}

// Supprime les baux de plus de PEREMPTION_MS, puis le dossier s'il est vide. Les noms étant
// fixes par (fichier, personne), le dossier ne grossit pas ; le ménage évite seulement de
// laisser un dossier technique dans un numéro inactif.
function purger(racine, maintenant) {
  const t = maintenant === undefined ? Date.now() : maintenant;
  const dossier = dossierEdition(racine);
  let restants = 0;
  for (const nom of nomsDuDossier(racine)) {
    const b = lireBail(dossier, nom);
    if (!b) { continue; }
    if (t - instantReference(b.renouvele, b.mtimeMs, t) < PEREMPTION_MS) { restants++; continue; }
    try { fs.unlinkSync(path.join(dossier, nom)); } catch (e) { restants++; }
  }
  if (restants === 0) { try { fs.rmdirSync(dossier); } catch (e) { /* pas vide : très bien */ } }
  invaliderCacheBaux(racine);
}

// Cache d'empreinte() : chemin -> { taille, mtimeMs, valeur }. Un formulaire ouvert l'appelle
// toutes les trois secondes ; tant que taille et mtime n'ont pas bougé, le fichier n'est
// pas relu.
const cacheEmpreinte = new Map();

// L'empreinte du fichier, ou '' s'il n'existe pas. Elle dit si le fichier a changé pendant
// qu'un formulaire l'affichait.
function empreinte(chemin) {
  let stat;
  try { stat = fs.statSync(chemin); }
  catch (e) { cacheEmpreinte.delete(chemin); return ''; }   // absent ou illisible : pas d'empreinte
  const avant = cacheEmpreinte.get(chemin);
  if (avant && avant.taille === stat.size && avant.mtimeMs === stat.mtimeMs) { return avant.valeur; }
  let valeur;
  try { valeur = crypto.createHash('sha1').update(fs.readFileSync(chemin)).digest('hex'); }
  catch (e) { valeur = ''; }
  cacheEmpreinte.set(chemin, { taille: stat.size, mtimeMs: stat.mtimeMs, valeur: valeur });
  return valeur;
}

module.exports = {
  DOSSIER_EDITION, BAIL_MS, INACTIVITE_MS, RENOUVELLEMENT_MS, PEREMPTION_MS,
  dossierEdition, clefFichier, prefixe, jeton, identite, qui, nomBail,
  baux, titulaireAutre, titulairesDuNumero, poser, rendre, purger, empreinte, instantReference
};
