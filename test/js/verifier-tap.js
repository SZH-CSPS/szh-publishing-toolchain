#!/usr/bin/env node
'use strict';
// Porte de la CI sur un run TAP de `node --test` : lit le fichier produit par le job et
// refuse ce qu'un vert par défaut laisserait passer.
//
//   node test/js/verifier-tap.js <fichier.tap> --runner ubuntu|windows|poste
//
// Quatre contrôles, tous nécessaires :
//   1. `# fail` vaut 0 ;
//   2. `# cancelled` vaut 0 — un test bloqué que --test-timeout a coupé sort en
//      `cancelled`, jamais en `fail` (mesuré) ;
//   3. chaque ligne `# SKIP` cite un motif ADMIS pour ce runner : sur ubuntu, l'absence de
//      PowerShell, de la WSL ou de pandoc est normale ; sur windows-latest, PowerShell est
//      exigé (SZH_PS_OBLIGATOIRE) et seuls la WSL, pandoc, le corpus hors dépôt et le
//      processus élevé du runner sont admis. Tout autre motif, ou un saut sans motif, fait
//      échouer : c'est ce qui remplace l'ancien plancher « # pass >= 950 » et l'égalité
//      stricte sur un compte statique, tous deux aveugles aux `t.skip()` posés au corps
//      des tests ;
//   4. moins de la moitié des tests sautés — une suite qui saute la moitié de ses tests
//      n'est pas une suite, quel que soit le motif.
// Le code de sortie du process `node --test` (pipefail dans ci.yml) reste la première porte.
const fs = require('fs');

// L'ordre compte : la première famille dont un fragment apparaît dans le motif l'emporte,
// et le motif du pliage cite lui aussi « pandoc ». Les fragments sont ceux que
// test/js/gardes.js, rapport-erreur.test.js, biblio.test.js, raccourcis.test.js et
// filtres-pandoc.test.js écrivent réellement dans leurs sauts.
const MOTIFS = {
  pliage: ['pliage des accents'],
  powershell: ['powershell.exe indisponible'],
  python: ['Python 3'],
  wsl: ['wsl.exe', 'dans la distro'],
  pandoc: ['pandoc introuvable', 'pandoc ou python3 introuvable'],
  horsWindows: ['chemins Windows'],
  corpus: ['corpus hors dépôt absent', 'aucun .docx dans'],
  eleve: ['processus élevé'],
  // courriel-support.test.js rend un gabarit par VSCodium-en-Node : aucun runner ne l'a.
  vscodium: ['VSCodium introuvable', 'pas Windows']
};
const ADMIS = {
  // Pas de PowerShell, pas de WSL, pas de pandoc dans le job contrats ; python est exigé.
  ubuntu: ['powershell', 'horsWindows', 'wsl', 'pandoc', 'corpus', 'vscodium'],
  // PowerShell exigé ; le runner tourne élevé, donc l'ACL ne bloque rien.
  windows: ['wsl', 'pandoc', 'corpus', 'eleve', 'python', 'vscodium'],
  // Un poste complet : ne restent que les accents du pandoc 3.9 et le corpus hors dépôt.
  poste: ['pliage', 'corpus', 'eleve']
};

function lireCompte(tap, cle) {
  const m = tap.match(new RegExp('^# ' + cle + ' (\\d+)$', 'm'));
  return m ? Number(m[1]) : null;
}

function verifier(tap, runner) {
  const erreurs = [];
  const admis = ADMIS[runner];
  if (!admis) { return { erreurs: ['runner inconnu : ' + runner], histogramme: {} }; }
  const tests = lireCompte(tap, 'tests');
  const fail = lireCompte(tap, 'fail');
  const cancelled = lireCompte(tap, 'cancelled');
  const skipped = lireCompte(tap, 'skipped');
  if (tests === null || fail === null || cancelled === null || skipped === null) {
    erreurs.push('bilan TAP incomplet : la suite ne s’est pas terminée normalement');
  }
  if (fail !== 0) { erreurs.push(fail + ' test(s) en échec'); }
  if (cancelled !== 0) { erreurs.push(cancelled + ' test(s) annulé(s) par --test-timeout : un blocage, pas un échec ordinaire'); }
  if (tests !== null && skipped !== null && skipped * 2 >= tests) {
    erreurs.push(skipped + ' tests sautés sur ' + tests + ' : la moitié de la suite manque');
  }
  const histogramme = {};
  const lignesSkip = tap.split('\n').filter((l) => /^\s*ok \d+ .*# SKIP/.test(l));
  for (const l of lignesSkip) {
    const motif = l.replace(/^.*# SKIP ?/, '').trim();
    const famille = Object.keys(MOTIFS).find((f) => MOTIFS[f].some((s) => motif.includes(s)));
    const cle = (famille || 'INCONNU') + (motif ? '' : ' (sans motif)');
    histogramme[cle] = (histogramme[cle] || 0) + 1;
    if (!famille || !admis.includes(famille)) {
      erreurs.push('saut non admis sur ' + runner + ' : ' + (motif || '(sans motif)') + ' — ' + l.trim().slice(0, 140));
    }
  }
  if (skipped !== null && lignesSkip.length !== skipped) {
    erreurs.push('le bilan annonce ' + skipped + ' sauts, le détail en montre ' + lignesSkip.length);
  }
  return { erreurs, histogramme, tests, fail, cancelled, skipped };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const fichier = args.find((a) => !a.startsWith('--'));
  const i = args.indexOf('--runner');
  const runner = i >= 0 ? args[i + 1] : 'poste';
  if (!fichier) { console.error('usage : verifier-tap.js <fichier.tap> --runner ubuntu|windows|poste'); process.exit(2); }
  const r = verifier(fs.readFileSync(fichier, 'utf8'), runner);
  console.log('tests=' + r.tests + ' fail=' + r.fail + ' cancelled=' + r.cancelled + ' skipped=' + r.skipped + ' runner=' + runner);
  console.log('motifs des sauts :', JSON.stringify(r.histogramme));
  for (const e of r.erreurs) { console.log('::error::' + e); }
  process.exit(r.erreurs.length ? 1 : 0);
}

module.exports = { verifier, MOTIFS, ADMIS };
