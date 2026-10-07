// « Quoi de neuf » : la note que la rédaction lit après une mise à jour.
//
// nouveautes.json, à la racine du toolkit, est écrit pour la rédaction, en fr et en de ;
// CHANGELOG.md s'adresse aux développeurs. Les notes sont rangées par medium (« 1.1 ») :
// une version mineure ne s'annonce pas.
'use strict';

const fs = require('fs');
const path = require('path');

const { TOOLKIT, versionInstallee, mediumVersion } = require('./archivage');

// Le fichier est à la racine du toolkit déployé, à côté de VERSION, et non dans le VSIX :
// les notes suivent la version du toolkit, pas celle du cockpit.
const FICHIER = 'nouveautes.json';

function cheminNouveautes() { return path.join(TOOLKIT, FICHIER); }

// Fichier manquant, illisible ou mal formé : table vide, pour ne pas empêcher d'ouvrir un
// numéro.
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

// Compare deux numéros, « 1.10 » étant plus récent que « 1.9 ». Rend un négatif si a
// précède b, 0 s'ils sont égaux, un positif sinon.
function comparerMediums(a, b) {
  const da = String(a || '').split('.').map(Number);
  const db = String(b || '').split('.').map(Number);
  const majeure = (da[0] || 0) - (db[0] || 0);
  if (majeure !== 0) { return majeure; }
  return (da[1] || 0) - (db[1] || 0);
}

function estMedium(cle) { return /^\d+\.\d+$/.test(String(cle || '')); }

// Décide ce que la fenêtre montre.
//
//   mediumVu       le dernier medium dont cette personne a vu la note ('' si jamais)
//   mediumInstalle celui du toolkit posé sur le poste ('' si illisible — poste de dev)
//   table          le contenu de nouveautes.json
//   langue         'fr' ou 'de'
//
// Rend les notes à montrer, de la plus récente à la plus ancienne ; souvent vide.
function notesAMontrer(mediumVu, mediumInstalle, table, langue) {
  if (!estMedium(mediumInstalle)) { return []; }
  const vu = estMedium(mediumVu) ? mediumVu : '';
  if (vu && (comparerMediums(vu, mediumInstalle) >= 0)) { return []; }
  const notes = [];
  for (const cle of Object.keys(table || {})) {
    if (!estMedium(cle)) { continue; }
    // Pas de note pour un medium plus récent que celui installé.
    if (comparerMediums(cle, mediumInstalle) > 0) { continue; }
    // Rien de vu jusqu'ici : seulement la note du medium installé, pas tout l'historique.
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

// Lit le poste et le fichier, puis applique la fonction ci-dessus.
function notesPour(mediumVu, langue, chemin) {
  return notesAMontrer(mediumVu, mediumVersion(versionInstallee()), lireTable(chemin), langue);
}

function mediumInstalle() { return mediumVersion(versionInstallee()); }

module.exports = {
  FICHIER, cheminNouveautes, lireTable, comparerMediums, estMedium,
  notesAMontrer, notesPour, mediumInstalle
};
