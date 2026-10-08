// Smoke test : la chaîne d'import réelle, du .docx jusqu'au .md et au .meta.yaml, sur un
// document du dépôt.
//
//   node --test test/js/smoke-import-docx.test.js
//
// Les autres contrôles (docx-meta-titre.test.js, import.test.js…) fabriquent leur propre
// .docx et n'exercent qu'un maillon. Celui-ci rejoue la chaîne entière (docx-meta.py,
// docx-tables.py, docx-titres.py, pandoc et ses filtres Lua dans l'ordre du vrai script) :
// un maillon cassé (ordre des filtres, option pandoc retirée) se voit ici alors que chaque
// test unitaire passe encore.
//
// Le document est livre-template/Modele-chapitre-SZH.docx, déjà exercé par
// test/js/import-numerotation-titres.test.js : titre, trois niveaux de titre, une liste, un
// tableau, une note de bas de page. Pas de tableau d'auteur·e·s (un chapitre de livre n'en a
// pas) : docx-meta.py écrit une fiche sans auteur, comme la référence.
//
// Le pandoc qui compile en production est celui de la WSL SZH-Publishing, pas celui du PATH
// Windows, dont la version diffère et dont la sortie peut différer (une figure légendée, par
// exemple). La référence versionnée vient d'une vraie exécution dans la WSL, et ce test ne
// tourne que là. Sans la distribution, il est sauté avec un motif (gardes.js,
// sansPandocWsl), sauf sous SZH_WSL_OBLIGATOIRE, où l'absence est un échec.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const DISTRO = 'SZH-Publishing';
const MODELE = path.join(RACINE, 'livre-template', 'Modele-chapitre-SZH.docx');
const PIPE = path.join(RACINE, 'pipeline');
const FIXTURES = path.join(__dirname, 'fixtures', 'smoke-import');
const SLUG = 'essai-s1';

// Même conversion de chemin que import-numerotation-titres.test.js : wsl.exe n'accepte pas
// un chemin Windows tel quel, et Git Bash déforme /mnt/c : d'où l'appel direct par
// spawnSync plutôt que par un script shell.
function cheminVersWsl(p) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  const m = abs.match(/^([A-Za-z]):\/(.*)$/);
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2] : abs;
}

function wsl(args) {
  const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  return spawnSync(fs.existsSync(wslExe) ? wslExe : 'wsl.exe',
    ['-d', DISTRO, '--'].concat(args),
    { encoding: 'utf8', windowsHide: true, timeout: 120000 });
}

// CRLF -> LF avant comparaison : la référence est en LF (sortie WSL), et un clone sous
// Windows peut réécrire les fichiers versionnés en CRLF selon .gitattributes. Le test garde
// le contenu, pas la fin de ligne.
function normaliser(texte) {
  return texte.replace(/\r\n/g, '\n');
}

test('smoke S1 : .docx du modèle -> .md et .meta.yaml identiques à la référence figée',
  { skip: sansPandocWsl }, () => {
    assert.ok(fs.existsSync(MODELE), 'le modèle de chapitre a disparu : ' + MODELE);

    const chantier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-smoke-import-'));
    try {
      const pipe = cheminVersWsl(PIPE);
      const docxWsl = cheminVersWsl(MODELE);
      const rr = wsl(['sh', '-c',
        'cd ' + JSON.stringify(cheminVersWsl(chantier))
        + ' && PYTHONIOENCODING=utf-8 bash ' + JSON.stringify(pipe + '/import-docx.sh')
        + ' ' + JSON.stringify(docxWsl) + ' ' + SLUG + ' ' + JSON.stringify(pipe)]);
      assert.strictEqual(rr.status, 0, 'import-docx.sh a échoué : ' + rr.stderr);

      const dossier = path.join(chantier, 'articles', SLUG);
      const md = normaliser(fs.readFileSync(path.join(dossier, SLUG + '.md'), 'utf8'));
      const meta = normaliser(fs.readFileSync(path.join(dossier, SLUG + '.meta.yaml'), 'utf8'));

      const mdAttendu = normaliser(fs.readFileSync(path.join(FIXTURES, SLUG + '.md'), 'utf8'));
      const metaAttendu = normaliser(
        fs.readFileSync(path.join(FIXTURES, SLUG + '.meta.yaml'), 'utf8'));

      assert.strictEqual(md, mdAttendu,
        'le .md produit diverge de la référence figée (voir test/js/fixtures/smoke-import/'
        + SLUG + '.md)');
      assert.strictEqual(meta, metaAttendu,
        'le .meta.yaml produit diverge de la référence figée (voir test/js/fixtures/'
        + 'smoke-import/' + SLUG + '.meta.yaml)');
    } finally {
      fs.rmSync(chantier, { recursive: true, force: true });
    }
  });
