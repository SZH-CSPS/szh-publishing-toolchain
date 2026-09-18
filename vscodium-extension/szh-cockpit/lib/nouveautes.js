// « Quoi de neuf » : la note que la rédaction lit après une mise à jour.
//
// Deux textes, deux publics, et c'est délibéré. CHANGELOG.md est le journal du dépôt : il
// nomme des fonctions, il est écrit en français, et il s'adresse à qui tient le code.
// nouveautes.json — livré à la racine du toolkit — est écrit pour la rédaction, dans les
// DEUX langues, et ne dit que ce qui change dans les gestes du quotidien.
//
// La clé est le MEDIUM (« 1.1 »), jamais la version complète : c'est l'unité d'annonce du
// dépôt. Une mineure corrige et ne s'annonce pas ; un medium se dit. Écrire une note par
// mineure reviendrait à en écrire deux par jour, et plus personne n'ouvrirait la fenêtre.
'use strict';

const fs = require('fs');
const path = require('path');

const { TOOLKIT, versionInstallee, mediumVersion } = require('./archivage');

// Le fichier vit à la racine du toolkit déployé, à côté de VERSION que versionInstallee()
// lit déjà — et non dans le VSIX du cockpit : les notes sont indexées par version du
// TOOLKIT, et les loger dans l'extension forcerait un bump du cockpit à chaque release, y
// compris quand pas une ligne de son code n'a bougé.
const FICHIER = 'nouveautes.json';

function cheminNouveautes() { return path.join(TOOLKIT, FICHIER); }

// Table vide en cas de pépin, jamais d'exception : un fichier manquant, illisible ou mal
// formé ne doit pas empêcher d'ouvrir un numéro. La fenêtre se contentera de dire qu'elle
// n'a rien à montrer.
function lireTable(chemin) {
  try {
    const brut = String(fs.readFileSync(chemin || cheminNouveautes(), 'utf8')).replace(/^﻿/, '');
    const lu = JSON.parse(brut);
    if (!lu || (typeof lu !== 'object') || Array.isArray(lu)) { return {}; }
    return lu;
  } catch (e) {
    return {};
  }
}

// « 1.10 » est PLUS RÉCENT que « 1.9 » : la comparaison se fait sur deux nombres, jamais sur
// la chaîne. Rend un négatif si a précède b, 0 s'ils sont égaux, un positif sinon.
function comparerMediums(a, b) {
  const da = String(a || '').split('.').map(Number);
  const db = String(b || '').split('.').map(Number);
  const majeure = (da[0] || 0) - (db[0] || 0);
  if (majeure !== 0) { return majeure; }
  return (da[1] || 0) - (db[1] || 0);
}

function estMedium(cle) { return /^\d+\.\d+$/.test(String(cle || '')); }

// Fonction pure : tout lui arrive par ses paramètres. C'est elle qui décide ce que la
// fenêtre montre, et c'est elle qu'on éprouve.
//
//   mediumVu       le dernier medium dont cette personne a vu la note ('' si jamais)
//   mediumInstalle celui du toolkit posé sur le poste ('' si illisible — poste de dev)
//   table          le contenu de nouveautes.json
//   langue         'fr' ou 'de'
//
// Rend les notes à montrer, de la plus récente à la plus ancienne. Vide quand il n'y a rien
// à dire — c'est le cas le plus fréquent, une mineure ne changeant pas de medium.
function notesAMontrer(mediumVu, mediumInstalle, table, langue) {
  if (!estMedium(mediumInstalle)) { return []; }
  const vu = estMedium(mediumVu) ? mediumVu : '';
  if (vu && (comparerMediums(vu, mediumInstalle) >= 0)) { return []; }
  const notes = [];
  for (const cle of Object.keys(table || {})) {
    if (!estMedium(cle)) { continue; }
    // Jamais une note d'un medium que ce poste n'a pas encore : le fichier est livré avec le
    // toolkit et ne peut pas en porter de plus récente que lui, mais une note d'avance
    // annoncerait une fonction introuvable.
    if (comparerMediums(cle, mediumInstalle) > 0) { continue; }
    // Personne n'a jamais rien vu : on ne déroule pas tout l'historique, seulement le
    // medium du jour. Un poste neuf n'a pas de « nouveautés » — tout y est nouveau.
    if (vu) { if (comparerMediums(cle, vu) <= 0) { continue; } }
    else if (comparerMediums(cle, mediumInstalle) !== 0) { continue; }
    const entree = table[cle] || {};
    const texte = entree[langue] || entree.fr || null;
    if (!texte) { continue; }
    const points = Array.isArray(texte.points) ? texte.points.filter((p) => String(p || '').trim() !== '') : [];
    if (points.length === 0) { continue; }
    notes.push({ medium: cle, titre: String(texte.titre || ''), points: points.map(String) });
  }
  notes.sort((a, b) => comparerMediums(b.medium, a.medium));
  return notes;
}

// Ce que l'hôte appelle : lit le poste et le fichier, puis délègue la décision à la fonction
// pure ci-dessus.
function notesPour(mediumVu, langue, chemin) {
  return notesAMontrer(mediumVu, mediumVersion(versionInstallee()), lireTable(chemin), langue);
}

function mediumInstalle() { return mediumVersion(versionInstallee()); }

module.exports = {
  FICHIER, cheminNouveautes, lireTable, comparerMediums, estMedium,
  notesAMontrer, notesPour, mediumInstalle
};
