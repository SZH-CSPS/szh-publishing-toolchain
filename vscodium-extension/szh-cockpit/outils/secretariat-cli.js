#!/usr/bin/env node
// Entrée en ligne de commande des quatre exports du secrétariat, lancée par le lanceur
// Windows avec le Node qu'embarque VSCodium :
//   ELECTRON_RUN_AS_NODE=1 VSCodium.exe <chemin>\outils\secretariat-cli.js <commande> [options]
//
// Contrat figé (voir lib/secretariat.js pour la logique) : JSON Lines sur stdout, UTF-8, un
// objet par ligne, vidé à chaque ligne — rien d'autre sur stdout, une trace de pile va sur
// stderr. La ligne `fin` est TOUJOURS la dernière. Code de sortie 0 si `ok`, sinon 1.
'use strict';

const path = require('path');
const secretariat = require(path.join(__dirname, '..', 'lib', 'secretariat.js'));

// « --cle valeur » répétable ; « --cle » seul (sans valeur suivante) vaut booléen true.
// Une clé vue plusieurs fois devient un tableau, dans l'ordre reçu — utile à
// « --numero » de la commande metadonnees, qui peut apparaître plusieurs fois.
function analyserArguments(argv) {
  const sortie = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { continue; }
    const cle = a.slice(2);
    const suivant = argv[i + 1];
    const aValeur = suivant !== undefined && !suivant.startsWith('--');
    const valeur = aValeur ? argv[++i] : true;
    if (sortie[cle] === undefined) { sortie[cle] = valeur; }
    else if (Array.isArray(sortie[cle])) { sortie[cle].push(valeur); }
    else { sortie[cle] = [sortie[cle], valeur]; }
  }
  return sortie;
}

function emettre(objet) { console.log(JSON.stringify(objet)); }

function listeCles(valeur) {
  return String(valeur || '').split(',').map((s) => s.trim()).filter((s) => s !== '');
}

async function main() {
  const argv = process.argv.slice(2);
  const commande = argv[0];
  const args = analyserArguments(argv.slice(1));
  let dossierGabarits = null;

  try {
    const commandesConnues = ['numeros-ojs', 'newsletter', 'edudoc', 'caracteres', 'metadonnees'];
    if (commandesConnues.indexOf(commande) === -1) {
      throw new Error("commande inconnue : « " + (commande || '') + " » (attendu : " + commandesConnues.join(', ') + ')');
    }

    const gabaritsForces = typeof args.gabarits === 'string' ? args.gabarits : null;
    dossierGabarits = secretariat.resoudreDossierGabarits(gabaritsForces, emettre);
    secretariat.installerGabaritsManquants(dossierGabarits, emettre);

    const opts = { emettre: emettre, dossierGabarits: dossierGabarits };
    let resultat;
    if (commande === 'numeros-ojs') {
      opts.revue = args.revue;
      opts.cheminCache = args.cache;
      resultat = await secretariat.commandeNumerosOjs(opts);
    } else if (commande === 'newsletter') {
      opts.racineNumero = args.numero;
      opts.dossierSortie = args.sortie;
      resultat = await secretariat.commandeNewsletter(opts);
    } else if (commande === 'edudoc') {
      opts.cheminCache = args.cache;
      opts.cles = listeCles(args.numeros);
      opts.dossierSortie = args.sortie;
      resultat = await secretariat.commandeEdudoc(opts);
    } else if (commande === 'caracteres') {
      opts.cheminCache = args.cache;
      opts.cles = listeCles(args.numeros);
      opts.dossierSortie = args.sortie;
      resultat = await secretariat.commandeCaracteres(opts);
    } else if (commande === 'metadonnees') {
      opts.racinesNumeros = Array.isArray(args.numero) ? args.numero : (args.numero ? [args.numero] : []);
      opts.cheminCache = args.cache;
      opts.dossierSortie = args.sortie;
      resultat = await secretariat.commandeMetadonnees(opts);
    }

    emettre({ t: 'fin', ok: true, texte: (resultat && resultat.texte) || '', gabarits: dossierGabarits });
    process.exit(0);
  } catch (e) {
    emettre({ t: 'fin', ok: false, texte: String((e && e.message) || e), gabarits: dossierGabarits || undefined });
    if (e && e.stack) { console.error(e.stack); }
    process.exit(1);
  }
}

main();
