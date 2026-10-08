#!/usr/bin/env node
// Entrée en ligne de commande des quatre exports du secrétariat, lancée par le lanceur
// Windows avec le Node qu'embarque VSCodium :
//   ELECTRON_RUN_AS_NODE=1 VSCodium.exe <chemin>\outils\secretariat-cli.js <commande> [options]
//
// Format de sortie (la logique est dans lib/secretariat.js) : JSON Lines sur stdout, UTF-8,
// un objet par ligne, vidé à chaque ligne ; rien d'autre sur stdout, les traces de pile vont
// sur stderr. Types de ligne :
//   etape    texte libre, ce qui se passe
//   avert    avertissement non bloquant
//   numero   un numéro OJS trouvé
//   fichier  un fichier produit
//   progres  { fait, total } ; total vaut 0 s'il est inconnu (moissonnage OAI-PMH), et le
//            lanceur affiche alors une barre indéterminée
//   fin      bilan, toujours la dernière ligne
// Code de sortie 0 si `ok`, sinon 1. --langue fr|de choisit la langue des textes (fr par
// défaut, le lanceur WinForms ne la passe pas).
'use strict';

const path = require('path');
const secretariat = require(path.join(__dirname, '..', 'lib', 'secretariat.js'));

// « --cle valeur » répétable ; « --cle » seul (sans valeur suivante) vaut booléen true.
// Une clé répétée devient un tableau, dans l'ordre reçu (« --numero » de metadonnees et
// d'edudoc).
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
      throw new Error(secretariat.dire(secretariat.langueDe(args), 'commande.inconnue', [commande || '', commandesConnues.join(', ')]));
    }

    // --gabarits sert à la mise au point et aux tests ; sinon, les gabarits sont ceux
    // livrés dans export-templates/.
    dossierGabarits = (typeof args.gabarits === 'string' ? args.gabarits : null) || secretariat.dossierGabaritsSource();

    const opts = { emettre: emettre, dossierGabarits: dossierGabarits, langue: args.langue };
    let resultat;
    if (commande === 'numeros-ojs') {
      opts.revue = args.revue;
      opts.cheminCache = args.cache;
      // --depuis-annee : l'année à partir de laquelle moissonner (voir commandeNumerosOjs) ;
      // absente, moisson complète. Pour remonter plus loin, on relance avec une année plus
      // petite : les appels ne se cumulent pas.
      opts.depuisAnnee = args['depuis-annee'];
      resultat = await secretariat.commandeNumerosOjs(opts);
    } else if (commande === 'newsletter') {
      opts.racineNumero = args.numero;
      opts.dossierSortie = args.sortie;
      resultat = await secretariat.commandeNewsletter(opts);
    } else if (commande === 'edudoc') {
      opts.cheminCache = args.cache;
      opts.cles = listeCles(args.numeros);
      // --numero (répétable, facultatif) : les numéros locaux dont on tire les mots-clés
      // (690), joints aux lignes OAI par DOI. Sans lui, le CSV n'a pas de colonnes 690.
      opts.racinesNumeros = Array.isArray(args.numero) ? args.numero : (args.numero ? [args.numero] : []);
      // --mots-cles : le cache du thésaurus edudoc, transmis par la variable que lit
      // lib/mots-cles-edudoc.js ; absent, son emplacement par défaut.
      if (typeof args['mots-cles'] === 'string') { process.env.SZH_MOTS_CLES_CACHE = args['mots-cles']; }
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

    // anneePlancher (chaîne ou null) n'existe que pour numeros-ojs ; la ligne `fin` ne le
    // porte que dans ce cas.
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
