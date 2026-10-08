// traiterPortraits (lib/portraits.js) pilote wsl.exe : recadrage du visage (YuNet) et
// détourage (rembg) dans la distribution, une ligne JSON par image sur stdout.
// portrait.test.js teste un autre sujet, le rendu du portrait dans le PDF.
//
// lib/portraits.js et lib/wsl.js prennent `spawn` par déstructuration au chargement
// (`const { spawn } = require('child_process')`), sans paramètre d'injection. Le test remplace
// donc `require('child_process').spawn` avant le premier require de lib/portraits.js, par un
// relais appelé à chaque spawn : `impl` peut changer d'un test à l'autre.
//
// traiterPortraits() commence par reveillerWsl() (lib/wsl.js), qui lance aussi un spawn : le
// même relais couvre les deux.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { EventEmitter } = require('node:events');

const cp = require('child_process');
const spawnReel = cp.spawn;
const appels = [];
let impl = null;
cp.spawn = function (commande, args, options) {
  appels.push({ commande: commande, args: args, options: options });
  if (impl) { return impl(commande, args, options); }
  return spawnReel(commande, args, options);
};

const { traiterPortraits, cheminVersWsl } = require(path.join(__dirname, '..', '..',
  'vscodium-extension', 'szh-cockpit', 'lib', 'portraits'));

function fauxProcessus() {
  const p = new EventEmitter();
  p.stdout = new EventEmitter();
  p.tue = false;
  p.kill = () => { p.tue = true; };
  return p;
}

// L'appel de reveillerWsl() (lib/wsl.js) est toujours ['-d', DISTRO, '--', 'true'] : un
// processus qui sort tout de suite convient à tous les scénarios.
function estAppelReveil(args) {
  return Array.isArray(args) && args[args.length - 1] === 'true';
}

function processusReveilImmediat() {
  const p = fauxProcessus();
  setImmediate(() => p.emit('exit', 0, null));
  return p;
}

function ligneJson(obj) { return JSON.stringify(obj) + '\n'; }

test('traiterPortraits : succès, une ligne JSON par image traitée', async () => {
  appels.length = 0;
  impl = (commande, args) => {
    if (estAppelReveil(args)) { return processusReveilImmediat(); }
    const p = fauxProcessus();
    setImmediate(() => {
      p.stdout.emit('data', Buffer.from(ligneJson({
        slug: 'anne-dupont', ok: true, visage: true, recadre: true,
        fichiers: { avec_fond: 'anne-dupont.avec-fond.png', sans_fond: 'anne-dupont.sans-fond.png' },
        erreur: null
      })));
      p.stdout.emit('data', Buffer.from(ligneJson({
        slug: 'bruno-meyer', ok: false, visage: false, recadre: false, fichiers: null,
        erreur: 'aucun visage détecté'
      })));
      p.emit('close', 0);
    });
    return p;
  };

  const resultats = await traiterPortraits({
    dossierPortraits: 'C:\\revue\\articles\\01-essai\\portraits',
    entrees: [
      { slug: 'anne-dupont', cheminSource: 'C:\\revue\\a.jpg' },
      { slug: 'bruno-meyer', cheminSource: 'C:\\revue\\b.jpg' }
    ]
  });

  assert.strictEqual(resultats.length, 2);
  assert.strictEqual(resultats[0].slug, 'anne-dupont');
  assert.strictEqual(resultats[0].ok, true);
  assert.strictEqual(resultats[0].fichiers.avec_fond, 'anne-dupont.avec-fond.png');
  assert.strictEqual(resultats[1].ok, false);
  assert.strictEqual(resultats[1].erreur, 'aucun visage détecté');

  // La commande vue par wsl.exe : réveil, puis un seul appel principal portant les deux
  // entrées (le modèle rembg n'est chargé qu'une fois par session).
  assert.strictEqual(appels.filter((a) => estAppelReveil(a.args)).length, 1);
  const principal = appels.find((a) => !estAppelReveil(a.args));
  assert.ok(principal, 'aucun appel principal à wsl.exe');
  assert.deepStrictEqual(principal.args.slice(-4), [
    'anne-dupont', cheminVersWsl('C:\\revue\\a.jpg'),
    'bruno-meyer', cheminVersWsl('C:\\revue\\b.jpg')
  ]);
});

test('traiterPortraits : une ligne parasite sur stdout est ignorée, les lignes JSON valides sortent',
  async () => {
    appels.length = 0;
    impl = (commande, args) => {
      if (estAppelReveil(args)) { return processusReveilImmediat(); }
      const p = fauxProcessus();
      setImmediate(() => {
        p.stdout.emit('data', Buffer.from('Loading u2net_human_seg model...\n'));   // parasite
        p.stdout.emit('data', Buffer.from(ligneJson({
          slug: 'anne-dupont', ok: true, visage: true, recadre: true,
          fichiers: { avec_fond: 'a.png', sans_fond: 'b.png' }, erreur: null
        })));
        p.stdout.emit('data', Buffer.from('\n'));                                    // ligne vide
        p.emit('close', 0);
      });
      return p;
    };

    const resultats = await traiterPortraits({
      dossierPortraits: 'C:\\revue\\portraits',
      entrees: [{ slug: 'anne-dupont', cheminSource: 'C:\\revue\\a.jpg' }]
    });
    assert.strictEqual(resultats.length, 1, 'la ligne parasite a été prise pour un résultat');
    assert.strictEqual(resultats[0].slug, 'anne-dupont');
  });

test('traiterPortraits : aucune ligne JSON exploitable -> rejet', async () => {
  appels.length = 0;
  impl = (commande, args) => {
    if (estAppelReveil(args)) { return processusReveilImmediat(); }
    const p = fauxProcessus();
    setImmediate(() => {
      p.stdout.emit('data', Buffer.from('Traceback (most recent call last):\nErreur inattendue\n'));
      p.emit('close', 1);
    });
    return p;
  };

  await assert.rejects(
    traiterPortraits({
      dossierPortraits: 'C:\\revue\\portraits',
      entrees: [{ slug: 'anne-dupont', cheminSource: 'C:\\revue\\a.jpg' }]
    }),
    /aucune sortie exploitable/);
});

test('traiterPortraits : délai dépassé -> le processus est tué et le rejet le dit', async () => {
  appels.length = 0;
  let principal = null;
  impl = (commande, args) => {
    if (estAppelReveil(args)) { return processusReveilImmediat(); }
    principal = fauxProcessus();   // ne répond jamais : ni data, ni close
    return principal;
  };

  const debut = Date.now();
  await assert.rejects(
    traiterPortraits({
      dossierPortraits: 'C:\\revue\\portraits',
      entrees: [{ slug: 'anne-dupont', cheminSource: 'C:\\revue\\a.jpg' }],
      timeoutMs: 60
    }),
    /délai dépassé/);
  assert.ok(Date.now() - debut >= 50, 'le rejet est arrivé avant le délai');
  assert.ok(principal && principal.tue, 'le processus n’a pas été tué au délai');
});

test('traiterPortraits : wsl.exe introuvable -> erreur marquée .wsl', async () => {
  appels.length = 0;
  impl = () => {
    const e = new Error('spawn wsl.exe ENOENT');
    e.code = 'ENOENT';
    throw e;
  };

  await assert.rejects(
    traiterPortraits({
      dossierPortraits: 'C:\\revue\\portraits',
      entrees: [{ slug: 'anne-dupont', cheminSource: 'C:\\revue\\a.jpg' }]
    }),
    (e) => {
      assert.strictEqual(e.wsl, true, 'l’erreur n’est pas marquée .wsl');
      return true;
    });
});
