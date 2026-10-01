#!/usr/bin/env node
// Écrit un fichier de compteurs d'usage pour le lanceur Windows, avec le Node qu'embarque
// VSCodium (ELECTRON_RUN_AS_NODE=1). Un seul écrivain : lib/compteurs.js, qui valide, nomme,
// écrit et met en file d'attente.
//
// Entrée, JSON sur stdin (BOM toléré) : { source, passage?, fichier?, mesures }. Sans `passage`
// de 12 hexadécimaux, `fichier` donne le passage (SHA-256 tronqué du fichier, comme la CLI du
// nettoyeur) ; le chemin n'est jamais écrit. Sortie : une ligne JSON, le bilan de
// ecrireCompteurs. Code de sortie 0, quoi qu'il arrive : un compteur est un confort.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const compteurs = require(path.join(__dirname, '..', 'lib', 'compteurs.js'));

function passageDepuisFichier(chemin) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(chemin)).digest('hex').slice(0, 12);
  } catch (e) { return ''; }
}

function lireStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (e) { return ''; }
}

function main() {
  let bilan = { ecrit: false, enAttente: false, motif: 'entree-illisible', fichier: null, lignes: 0 };
  try {
    const entree = JSON.parse(lireStdin().replace(/^\uFEFF/, ''));
    let passage = String(entree.passage || '');
    if (!/^[0-9a-f]{12}$/.test(passage) && typeof entree.fichier === 'string' && entree.fichier) {
      passage = passageDepuisFichier(entree.fichier);
    }
    // ecrireCompteurs journalise sur stdout : seul le bilan doit y figurer.
    const log = console.log;
    console.log = function () {};
    try { bilan = compteurs.ecrireCompteurs({ source: entree.source, passage: passage, mesures: entree.mesures }); }
    finally { console.log = log; }
  } catch (e) { /* entrée absente ou mal formée : bilan d'échec */ }
  process.stdout.write(JSON.stringify(bilan) + '\n');
}

main();
