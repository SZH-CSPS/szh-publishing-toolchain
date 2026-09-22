#!/usr/bin/env node
// Entrée en ligne de commande du moissonnage des auteur·e·s publiés
// (C:\ProgramData\SZH\auteurs.json, lib/auteurs-ojs.js), lancée par le lanceur PowerShell
// (windows/open-produit.ps1) avec le Node qu'embarque VSCodium :
//   ELECTRON_RUN_AS_NODE=1 VSCodium.exe <chemin>\outils\auteurs-cli.js
//
// Pourquoi ce fichier existe : le cache alimente l'autocomplétion du cockpit ET, depuis le
// 22.09.2026, le signal « lexique » du nettoyeur de manuscrit (pipeline/manuscrit_noms.py,
// voir outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md §5.5 ter). Il se construisait jusqu'ici
// seulement à l'activation du cockpit (extension.js -> rafraichirAuteursPubliesEnFond(),
// lib/metadonnees-hote.js) — donc seulement quand VSCodium a démarré. Or les raccourcis du
// menu Démarrer ouvrent windows/open-produit.ps1 directement (Set-SzhRaccourcisMenu,
// windows/szh-shell.ps1) : on peut nettoyer un manuscrit depuis l'onglet « Preprocessing »
// sans que VSCodium ait jamais tourné, donc sans base.
//
// ZÉRO logique de moissonnage propre ici : ce script appelle rafraichir() (lib/auteurs-ojs.js)
// puis rafraichirCorpus() (lib/auteurs-corpus.js) — EXACTEMENT ce que fait
// rafraichirAuteursPubliesEnFond() à l'activation du cockpit, dans le même ordre, sans
// argument (donc avec la même politique de fraîcheur : JOURS_FRAICHEUR = 30, cacheFrais()
// décide, un cache récent n'est jamais re-moissonné). Ce n'est pas un second moissonneur,
// c'est le même, appelé d'un second endroit. Il n'est pas possible de passer par
// rafraichirAuteursPubliesEnFond() elle-même : lib/metadonnees-hote.js fait
// `require('vscode')` en tête (webviews, hôte d'extensions) — un module absent hors de
// l'hôte d'extensions, donc hors de portée d'un simple `node`/VSCodium-en-Node.
//
// Contrat de sortie, calqué sur secretariat-cli.js : JSON Lines sur stdout, UTF-8, une ligne
// par étape, `fin` toujours la dernière. Le format n'est là que pour la mise au point et les
// tests — l'appelant (open-produit.ps1) ne suit jamais cette sortie : l'appel est NON
// BLOQUANT par décision du superviseur, un lancement du poste n'a pas à attendre un millier
// de notices OAI-PMH ni un balayage du corpus OneDrive.
//
// Ne lève JAMAIS, et sort toujours en 0 : hors ligne est un état normal du poste (même
// politique que rafraichir()/rafraichirCorpus(), qui ne lèvent déjà rien elles-mêmes — voir
// leurs en-têtes). Ce script n'ajoute qu'un filet de dernier recours par-dessus, pour une
// panne de programmation qu'aucune des deux n'aurait anticipée.
'use strict';

const path = require('path');
const { rafraichir } = require(path.join(__dirname, '..', 'lib', 'auteurs-ojs.js'));
const { rafraichirCorpus } = require(path.join(__dirname, '..', 'lib', 'auteurs-corpus.js'));

function emettreDefaut(objet) { console.log(JSON.stringify(objet)); }

// `opts.rafraichirOjs` / `opts.rafraichirCorpus` : injectables pour les tests, qui ne
// doivent ni toucher le réseau ni écrire dans C:\ProgramData (voir lib/auteurs-ojs.js,
// SZH_AUTEURS_CACHE et `recuperer`). En usage réel — main() plus bas — ce sont les deux
// moissonneurs tels quels, jamais réimplémentés ici.
async function executerRafraichissement(opts) {
  const o = opts || {};
  const emettre = o.emettre || emettreDefaut;
  const rafraichirOjs = o.rafraichirOjs || rafraichir;
  const rafraichirLeCorpus = o.rafraichirCorpus || rafraichirCorpus;

  let resOjs = null;
  try {
    resOjs = await rafraichirOjs();
    if (resOjs && resOjs.fait && resOjs.complet) {
      emettre({
        t: 'etape', texte: '[auteurs-ojs] OJS : ' + resOjs.nombre + ' nom(s), ' +
          (resOjs.nombreRor || 0) + ' institution(s) ROR' +
          (resOjs.rorRates ? ' (' + resOjs.rorRates + ' ROR non résolu(s), on réessaiera)' : '')
      });
    } else if (resOjs && resOjs.fait) {
      emettre({ t: 'etape', texte: '[auteurs-ojs] rafraîchissement incomplet (hors ligne ?) : ' + (resOjs.erreur || '?') });
    } else if (resOjs) {
      emettre({ t: 'etape', texte: '[auteurs-ojs] ' + (resOjs.raison === 'frais' ? 'cache frais (< 30 j), rien à faire' : 'rien fait') });
    }
  } catch (e) {
    // Ne devrait jamais arriver — rafraichir() ne lève déjà rien (voir son en-tête) — mais
    // « muet en cas d'échec » veut dire jamais d'exception qui remonte, même une imprévue.
    emettre({ t: 'etape', texte: '[auteurs-ojs] rafraîchissement raté : ' + String((e && e.message) || e) });
  }

  let resCorpus = null;
  try {
    resCorpus = await rafraichirLeCorpus();
    if (resCorpus && resCorpus.fait && resCorpus.complet) {
      emettre({
        t: 'etape', texte: '[auteurs-corpus] corpus balayé : ' + resCorpus.fichiers +
          ' fiche(s) lue(s), ' + resCorpus.nombre + ' nom(s) au total'
      });
    } else if (resCorpus && resCorpus.fait) {
      emettre({ t: 'etape', texte: '[auteurs-corpus] balayage incomplet, on reprendra : ' + (resCorpus.erreur || 'borne atteinte') });
    } else if (resCorpus) {
      emettre({ t: 'etape', texte: '[auteurs-corpus] ' + (resCorpus.raison === 'frais' ? 'cache frais (< 30 j), rien à faire' : 'rien fait') });
    }
  } catch (e) {
    // Idem : rafraichirCorpus() ne lève déjà rien — filet de dernier recours seulement.
    emettre({ t: 'etape', texte: '[auteurs-corpus] rafraîchissement raté : ' + String((e && e.message) || e) });
  }

  emettre({ t: 'fin', ok: true });
  return { ojs: resOjs, corpus: resCorpus };
}

function main() {
  executerRafraichissement().then(() => {
    process.exit(0);
  }).catch((e) => {
    // Filet de tout dernier recours : executerRafraichissement() attrape déjà chacun des
    // deux moissonneurs séparément, ceci ne devrait donc jamais s'exécuter. Sort quand même
    // en 0 — rien ici ne doit faire échouer le lanceur qui l'a appelé sans l'attendre.
    try { emettreDefaut({ t: 'fin', ok: true, texte: 'filet : ' + String((e && e.message) || e) }); }
    catch (e2) { /* stdout indisponible : rien de plus à faire */ }
    process.exit(0);
  });
}

// require.main === module : ce script reste directement exécutable (VSCodium-en-Node) et
// redevient aussi un module require()-able pour test/js/auteurs-cli.test.js, qui exerce
// executerRafraichissement() avec des moissonneurs factices — même patron que
// outils/rendre-gabarit.js (construireVueRapportManuscrit) et test/js/manuscrit-gabarit.test.js.
if (require.main === module) { main(); }

module.exports = { executerRafraichissement, main };
