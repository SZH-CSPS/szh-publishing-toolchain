#!/usr/bin/env node
// Entrée en ligne de commande des quatre exports du secrétariat, lancée par le lanceur
// Windows avec le Node qu'embarque VSCodium :
//   ELECTRON_RUN_AS_NODE=1 VSCodium.exe <chemin>\outils\secretariat-cli.js <commande> [options]
//
// Contrat figé (voir lib/secretariat.js pour la logique) : JSON Lines sur stdout, UTF-8, un
// objet par ligne, vidé à chaque ligne — rien d'autre sur stdout, une trace de pile va sur
// stderr. Types de ligne : `etape` (texte libre, ce qui se passe), `avert` (avertissement
// non bloquant), `numero` (un numéro OJS trouvé), `fichier` (un fichier produit), `progres`
// ({fait, total} — total à 0 quand il est inconnu d'avance, cas du moissonnage OAI-PMH : le
// lanceur y affiche une barre indéterminée), `fin` (bilan, TOUJOURS la dernière ligne).
// Code de sortie 0 si `ok`, sinon 1.
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

    // --gabarits : aide de mise au point (et porte d'entrée des tests), jamais un réglage de
    // rédacteur — en usage normal les gabarits sont toujours ceux livrés dans export-templates/.
    dossierGabarits = (typeof args.gabarits === 'string' ? args.gabarits : null) || secretariat.dossierGabaritsSource();

    const opts = { emettre: emettre, dossierGabarits: dossierGabarits };
    let resultat;
    if (commande === 'numeros-ojs') {
      opts.revue = args.revue;
      opts.cheminCache = args.cache;
      // Absente : moisson complète, comme avant. Présente : l'année à partir de laquelle
      // moissonner (voir lib/secretariat.js, commandeNumerosOjs) ; remonter d'une année se
      // fait en relançant avec une valeur plus petite, jamais en cumulant les appels.
      opts.depuisAnnee = args['depuis-annee'];
      resultat = await secretariat.commandeNumerosOjs(opts);
    } else if (commande === 'newsletter') {
      opts.racineNumero = args.numero;
      opts.dossierSortie = args.sortie;
      resultat = await secretariat.commandeNewsletter(opts);
    } else if (commande === 'edudoc') {
      opts.cheminCache = args.cache;
      opts.cles = listeCles(args.numeros);
      // --numero (répétable, comme pour « metadonnees ») : les numéros locaux dont on tire
      // les mots-clés (690), joints aux lignes OAI par DOI. Optionnel — sans lui, le CSV
      // sort comme avant, sans colonnes 690.
      opts.racinesNumeros = Array.isArray(args.numero) ? args.numero : (args.numero ? [args.numero] : []);
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

    // anneePlancher : seule commandeNumerosOjs le rend (string ou null) ; les autres
    // commandes ne portent pas ce champ, la ligne `fin` ne le porte alors pas non plus.
    const ligneFin = { t: 'fin', ok: true, texte: (resultat && resultat.texte) || '', gabarits: dossierGabarits };
    if (resultat && resultat.anneePlancher !== undefined) { ligneFin.anneePlancher = resultat.anneePlancher; }
    emettre(ligneFin);
    process.exit(0);
  } catch (e) {
    emettre({ t: 'fin', ok: false, texte: String((e && e.message) || e), gabarits: dossierGabarits || undefined });
    if (e && e.stack) { console.error(e.stack); }
    process.exit(1);
  }
}

main();
