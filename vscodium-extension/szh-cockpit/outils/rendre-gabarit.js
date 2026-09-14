'use strict';

// Rend UN gabarit Twig avec le moteur du cockpit (lib/gabarits.js), pour que le lanceur
// PowerShell (Get-SzhCourriel, windows/szh-common.ps1) se serve du MÊME moteur que le
// cockpit au lieu d'en porter un second écrit à la main. Ne connaît rien aux courriels :
// chemin et variables lui arrivent tout faits, il ne fait qu'appeler compiler(...).rendre(...).
//
// Lancé par VSCodium-en-Node (ELECTRON_RUN_AS_NODE=1) -- voir Get-SzhCourriel pour le
// patron d'appel, calqué sur Invoke-SzhSecretariat (windows/open-produit.ps1).
//
// Entrée : un JSON sur STDIN, jamais en argument -- un corps de courriel porte des accents,
// des guillemets et des retours à la ligne qu'une ligne de commande Windows digère mal :
//   { "chemin": "<chemin du .twig>", "variables": { ... } }
// Sortie : un JSON sur STDOUT, rien d'autre sur ce flux :
//   { "ok": true, "blocs": { ... } }
//   { "ok": false, "erreur": "<message>" }
// Code de sortie : 0 si ok, 1 sinon.

const fs = require('fs');
const path = require('path');
const { compiler } = require(path.join(__dirname, '..', 'lib', 'gabarits.js'));

// Un BOM en tête d'un texte UTF-8 ne doit jamais entrer dans le rendu -- ni dans un bloc,
// ni dans une comparaison. Sert autant au .twig lu ci-dessous qu'à l'entrée reçue sur
// STDIN : VSCodium-en-Node en pose un en tête de ce que reçoit fs.readFileSync(0, 'utf8')
// quand l'appelant est un pipe de Windows PowerShell -- constaté sur ce poste, pas une
// hypothèse.
function sansBom(texte) {
  if (texte.charCodeAt(0) === 0xfeff) { return texte.slice(1); }
  return texte;
}

// Lecture bloquante de stdin : ce script ne fait qu'un aller-retour, jamais de flux long.
function lireEntree() {
  return sansBom(fs.readFileSync(0, 'utf8'));
}

function main() {
  let entree;
  try {
    entree = JSON.parse(lireEntree());
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, erreur: 'entrée JSON invalide : ' + e.message }) + '\n');
    process.exitCode = 1;
    return;
  }

  const chemin = String((entree && entree.chemin) || '');
  const variables = (entree && entree.variables) || {};
  try {
    const source = sansBom(fs.readFileSync(chemin, 'utf8'));
    const blocs = compiler(source, path.basename(chemin)).rendre(variables);
    process.stdout.write(JSON.stringify({ ok: true, blocs }) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, erreur: e.message }) + '\n');
    process.exitCode = 1;
  }
}

main();
