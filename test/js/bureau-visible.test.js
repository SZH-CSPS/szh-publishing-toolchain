// Le Bureau que la personne voit : celui que Windows rend, redirection OneDrive comprise, et
// le Bureau du profil quand le système ne dit rien. La lecture du système est remplacée : le
// test ne lance jamais PowerShell.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const poste = require(path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit', 'lib', 'poste.js'));

const PROFIL = String.raw`D:\Profil`;
const ONEDRIVE = String.raw`D:\OneDrive - SZH\Bureau`;

// L'environnement tient jusqu'à la fin de la promesse.
async function avecEnv(vars, fn) {
  const anciennes = {};
  for (const cle of Object.keys(vars)) {
    anciennes[cle] = process.env[cle];
    if (vars[cle] === undefined) { delete process.env[cle]; } else { process.env[cle] = vars[cle]; }
  }
  try { return await fn(); }
  finally {
    for (const cle of Object.keys(vars)) {
      if (anciennes[cle] === undefined) { delete process.env[cle]; } else { process.env[cle] = anciennes[cle]; }
    }
  }
}

test.afterEach(() => { poste.poserLecteurBureau(null); });

// Le Bureau du système n'est lu que sous Windows ; ailleurs, <profil>/Desktop.
const SAUT_WIN = process.platform !== 'win32' ? 'chemins Windows — joué par le job contrats-windows' : false;

test('le Bureau rendu par le système l’emporte, redirigé vers OneDrive ou non', { skip: SAUT_WIN }, async () => {
  poste.poserLecteurBureau(() => ONEDRIVE);
  await avecEnv({ USERPROFILE: PROFIL }, async () => {
    assert.equal(await poste.dossierBureau(), ONEDRIVE);
  });
});

test('le système n’est lu qu’une fois par processus', async () => {
  let lectures = 0;
  poste.poserLecteurBureau(() => { lectures++; return ONEDRIVE; });
  await poste.dossierBureau();
  await poste.dossierBureau();
  assert.equal(lectures, 1);
});

test('rien de lisible, un chemin relatif ou une erreur : le Bureau du profil, puis de HOME', async () => {
  for (const lecteur of [() => '', () => '   ', () => 'Desktop', () => null,
    () => Promise.reject(new Error('PowerShell absent')), () => { throw new Error('pas de Windows'); }]) {
    poste.poserLecteurBureau(lecteur);
    await avecEnv({ USERPROFILE: PROFIL, HOME: String.raw`D:\Maison` }, async () => {
      assert.equal(await poste.dossierBureau(), path.join(PROFIL, 'Desktop'));
    });
    poste.poserLecteurBureau(lecteur);
    await avecEnv({ USERPROFILE: undefined, HOME: String.raw`D:\Maison` }, async () => {
      assert.equal(await poste.dossierBureau(), path.join(String.raw`D:\Maison`, 'Desktop'));
    });
  }
});
