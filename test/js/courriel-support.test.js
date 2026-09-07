// Le troisième et dernier modèle de courriel du dépôt (le courriel de support de l'écran
// d'erreur, Show-SzhErreur dans windows/szh-common.ps1) porté vers un gabarit Twig, comme
// les deux premiers l'ont été vers le cockpit (test/js/courriel.test.js). Différence de
// taille : ce gabarit-là est rendu par DEUX moteurs qui ne se parlent jamais --
// lib/gabarits.js (JS, cockpit) et Get-SzhCourriel (PowerShell, windows/szh-common.ps1), le
// lanceur Windows n'exécutant jamais de JS. Ce fichier compare donc les deux rendus,
// Windows seulement, en plus des contrôles habituels (compile, rend un sujet/corps non
// vides, identique à l'ancien texte).
//
//   node --test test/js/courriel-support.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const GABARITS = path.join(RACINE, 'windows', 'mail-templates');
const COMMUN_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');
const { compiler } = require(path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'lib', 'gabarits'));

// Convention sujet/corps du cockpit (lib/courriel.js#rendreCourriel), rejouée ici à la main :
// le lanceur Windows ne passe jamais par ce module (il n'a pas de Node), mais
// Get-SzhCourriel applique la MÊME convention -- sujet débarrassé de ses blancs de bord,
// corps amputé d'un retour à la ligne de chaque côté -- et c'est ce que ce test vérifie.
function rendreConvention(source, nom, variables) {
  const blocs = compiler(source, nom).rendre(variables);
  const sujet = String(blocs.sujet || '').trim();
  const corps = String(blocs.corps || '').replace(/^\n/, '').replace(/\n$/, '');
  return { sujet, corps };
}

function nomsGabarits() {
  return fs.readdirSync(GABARITS).filter((f) => f.endsWith('.twig'));
}

const VARIABLES_ESSAI = {
  poste: 'PC-ESSAI', etape: 'compilation du PDF', message: 'Erreur de test',
  journal: 'C:\\logs\\essai.log'
};

test('chaque support.*.twig compile et rend un sujet et un corps non vides ; les trois langues existent', () => {
  const noms = nomsGabarits();
  for (const langue of ['fr', 'de', 'en']) {
    assert.ok(noms.indexOf('support.' + langue + '.twig') !== -1, 'support.' + langue + '.twig est absent');
  }
  for (const nom of noms) {
    const source = fs.readFileSync(path.join(GABARITS, nom), 'utf8');
    assert.doesNotThrow(() => compiler(source, nom), nom + ' ne compile pas');
    const r = rendreConvention(source, nom, VARIABLES_ESSAI);
    assert.ok(r.sujet.length > 0, nom + ' : sujet vide');
    assert.ok(r.corps.length > 0, nom + ' : corps vide');
  }
});

// Les six anciens textes de windows/szh-textes.ps1 ('mail.sujet'/'mail.corps', fr/de/en),
// recopiés ici AVANT leur retrait -- l'oracle indépendant de ce test.
//
// Deux réglages typographiques minimes ont été appliqués en les recopiant, tous deux de la
// même famille que err.toolkit/arch.ok.livre corrigés par ailleurs dans ce fichier : ces
// six textes n'avaient JAMAIS été vus par test/typo-check.py (mail.corps est une chaîne à
// DOUBLES guillemets -- pour porter `r`n -- hors de portée de son extracteur PowerShell, qui
// ne lit que "= '...'"). Devenus un gabarit, ils entrent dans une surface contrôlée et en
// héritent : une apostrophe courbe (A1 : "l'outil" -> "l’outil", fr seulement) et une
// insécable devant les deux-points de la colonne la plus courte (E2 : "Journal : " a un seul
// espace, jamais exempté par la garde d'alignement qui ne laisse passer que deux espaces ou
// plus -- fr et de). Reproduire le défaut tel quel aurait fait échouer test/typo-check.py
// sur ce tout nouveau fichier, pour un manque qui n'avait simplement jamais été relevé.
const NBSP = '\u00a0';

const ANCIENS = {
  fr: {
    sujet: 'Probleme de mise a jour - outil Revue SZH ({0})',
    corps: 'Bonjour,\n\nLa mise a jour de l\u2019outil Revue a rencontre un probleme.\n\n'
      + 'Poste  ' + NBSP + ': {0}\nEtape  ' + NBSP + ': {1}\nDetail ' + NBSP + ': {2}\n'
      + 'Journal' + NBSP + ': {3}\n\nMerci de joindre le fichier journal ci-dessus a ce message.'
  },
  de: {
    sujet: 'Problem bei der Aktualisierung - SZH-Redaktionstool ({0})',
    corps: 'Guten Tag,\n\nBei der Aktualisierung des SZH-Redaktionstools ist ein Problem aufgetreten.\n\n'
      + 'Computer   : {0}\nSchritt    : {1}\nDetail     : {2}\nProtokoll  : {3}\n\n'
      + 'Bitte haengen Sie die oben genannte Protokolldatei an diese Nachricht an.'
  },
  en: {
    sujet: 'Update problem - SZH journal tool ({0})',
    corps: 'Hello,\n\nThe SZH journal tool update ran into a problem.\n\n'
      + 'Computer: {0}\nStep    : {1}\nDetail  : {2}\nLog     : {3}\n\n'
      + 'Please attach the log file above to this message.'
  }
};

function sub(texte, valeurs) {
  let r = texte;
  valeurs.forEach((v, i) => { r = r.split('{' + i + '}').join(v); });
  return r;
}

for (const langue of ['fr', 'de', 'en']) {
  test('support.' + langue + '.twig : identique au caractère près à l’ancien texte de windows/szh-textes.ps1', () => {
    const source = fs.readFileSync(path.join(GABARITS, 'support.' + langue + '.twig'), 'utf8');
    const r = rendreConvention(source, 'support.' + langue + '.twig', VARIABLES_ESSAI);
    const valeurs = [VARIABLES_ESSAI.poste, VARIABLES_ESSAI.etape, VARIABLES_ESSAI.message, VARIABLES_ESSAI.journal];
    assert.equal(r.sujet, sub(ANCIENS[langue].sujet, valeurs));
    assert.equal(r.corps, sub(ANCIENS[langue].corps, valeurs));
  });
}

// ---- La divergence réelle entre les deux moteurs, Windows seulement ----
// lib/gabarits.js (ci-dessus) et Get-SzhCourriel (windows/szh-common.ps1) sont deux
// implémentations indépendantes du même sous-ensemble : on éprouve donc la VRAIE fonction
// PowerShell, extraite mot pour mot du VRAI szh-common.ps1 (même technique que
// test/js/orphelins-toolkit.test.js pour Remove-SzhToolkitOrphelins), plutôt que de faire
// confiance à la lecture du code.

const POWERSHELL = (function () {
  if (process.platform !== 'win32') { return ''; }
  const candidats = [path.join(process.env.WINDIR || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), 'powershell.exe'];
  for (const c of candidats) {
    const essai = spawnSync(c, ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' });
    if (!essai.error && essai.status === 0) { return c; }
  }
  return '';
})();
const sansPowerShell = POWERSHELL ? false : 'powershell.exe indisponible';

// Le corps d'une fonction PowerShell : de sa ligne de déclaration jusqu'à la première ligne
// qui n'est QUE « } », en colonne 0 -- identique à l'aide de même nom dans
// test/js/orphelins-toolkit.test.js.
function corpsFonction(source, nom) {
  const lignes = source.split('\r\n');
  let debut = -1;
  for (let i = 0; i < lignes.length; i++) {
    if (lignes[i].indexOf('function ' + nom) === 0) { debut = i; break; }
  }
  assert.ok(debut !== -1, 'fonction introuvable : ' + nom);
  let fin = -1;
  for (let i = debut + 1; i < lignes.length; i++) {
    if (lignes[i] === '}') { fin = i; break; }
  }
  assert.ok(fin !== -1, 'fin de fonction introuvable : ' + nom);
  return lignes.slice(debut, fin + 1).join('\r\n');
}

// Sans BOM sous PowerShell 5.1, un .ps1 SANS ce préfixe se relit avec la page de code ANSI
// du poste, pas en UTF-8 (mêmes précautions que orphelins-toolkit.test.js).
function ecrirePs1(chemin, contenu) {
  fs.writeFileSync(chemin, '\ufeff' + contenu, 'utf8');
}

function psChaine(v) { return "'" + String(v).replace(/'/g, "''") + "'"; }
function psHashtable(obj) {
  return '@{ ' + Object.keys(obj).map((k) => k + ' = ' + psChaine(obj[k])).join('; ') + ' }';
}

const COMMUN_SOURCE = fs.existsSync(COMMUN_PS1) ? fs.readFileSync(COMMUN_PS1, 'utf8') : '';
const CORPS_GET_SZH_COURRIEL = POWERSHELL ? corpsFonction(COMMUN_SOURCE, 'Get-SzhCourriel') : '';

// Exécute Get-SzhCourriel (extraite ci-dessus) dans un dossier de travail jetable qui porte
// son propre « mail-templates » -- $PSScriptRoot suit le fichier .ps1 réellement lancé, donc
// ce dossier-là, jamais windows/mail-templates/ du dépôt. `appel` est la ligne PowerShell qui
// peuple $sortie ; en cas de levée, $sortie.ok est faux et $sortie.erreur porte le message.
function executerGetSzhCourriel(travail, appel) {
  const pilote = [
    "$ErrorActionPreference = 'Stop'",
    CORPS_GET_SZH_COURRIEL,
    '$sortie = [ordered]@{ ok = $true }',
    'try {',
    '  ' + appel,
    '} catch {',
    '  $sortie = [ordered]@{ ok = $false; erreur = $_.Exception.Message }',
    '}',
    '[System.IO.File]::WriteAllText($args[0], ($sortie | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))'
  ].join('\r\n') + '\r\n';
  const pPilote = path.join(travail, 'pilote.ps1');
  const pSortie = path.join(travail, 'sortie.json');
  ecrirePs1(pPilote, pilote);
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pPilote, pSortie],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.ok(run.status === 0 && fs.existsSync(pSortie),
    'le pilote PowerShell a échoué : ' + run.stderr);
  return JSON.parse(fs.readFileSync(pSortie, 'utf8'));
}

test('Get-SzhCourriel (PowerShell) et lib/gabarits.js (JS) rendent support.fr.twig à l’identique',
  { skip: sansPowerShell }, () => {
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-courriel-support-'));
    try {
      fs.mkdirSync(path.join(travail, 'mail-templates'));
      for (const nom of nomsGabarits()) {
        fs.copyFileSync(path.join(GABARITS, nom), path.join(travail, 'mail-templates', nom));
      }
      const appel = '$r = Get-SzhCourriel -Nom ' + psChaine('support') + ' -Variables ' +
        psHashtable(VARIABLES_ESSAI) + ' -Langue ' + psChaine('fr') +
        "; $sortie.sujet = $r.sujet; $sortie.corps = $r.corps";
      const resultatPs = executerGetSzhCourriel(travail, appel);
      assert.equal(resultatPs.ok, true, 'Get-SzhCourriel a levé : ' + resultatPs.erreur);

      const sourceJs = fs.readFileSync(path.join(GABARITS, 'support.fr.twig'), 'utf8');
      const resultatJs = rendreConvention(sourceJs, 'support.fr.twig', VARIABLES_ESSAI);
      assert.equal(resultatPs.sujet, resultatJs.sujet);
      // `r`n côté PowerShell (mailto), \n côté JS : même comparaison qu'ailleurs dans ce
      // fichier, normalisée avant de comparer.
      assert.equal(String(resultatPs.corps).replace(/\r\n/g, '\n'), resultatJs.corps);
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('Get-SzhCourriel lève sur une construction non supportée ({% if %}), avec le nom du gabarit',
  { skip: sansPowerShell }, () => {
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-courriel-mauvais-'));
    try {
      fs.mkdirSync(path.join(travail, 'mail-templates'));
      fs.writeFileSync(path.join(travail, 'mail-templates', 'mauvais.fr.twig'),
        '{% block sujet %}X{% endblock %}\r\n{% block corps %}\r\n{% if x %}y{% endif %}\r\n{% endblock %}\r\n',
        'utf8');
      const appel = 'Get-SzhCourriel -Nom ' + psChaine('mauvais') + ' -Variables @{} -Langue ' + psChaine('fr') +
        ' | Out-Null';
      const resultat = executerGetSzhCourriel(travail, appel);
      assert.equal(resultat.ok, false, 'Get-SzhCourriel n’a pas levé sur {% if x %}');
      assert.match(resultat.erreur, /mauvais\.fr\.twig/, 'le message ne nomme pas le gabarit : ' + resultat.erreur);
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('Get-SzhCourriel : gabarit totalement absent -> erreur explicite nommant le gabarit', { skip: sansPowerShell }, () => {
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-courriel-absent-'));
  try {
    fs.mkdirSync(path.join(travail, 'mail-templates'));
    const appel = 'Get-SzhCourriel -Nom ' + psChaine('zorglub') + ' -Variables @{} -Langue ' + psChaine('fr') +
      ' | Out-Null';
    const resultat = executerGetSzhCourriel(travail, appel);
    assert.equal(resultat.ok, false, 'Get-SzhCourriel n’a pas levé sur un gabarit absent');
    assert.match(resultat.erreur, /zorglub/);
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
});
