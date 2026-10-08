// Le courriel de support de l'écran d'erreur (Show-SzhErreur, windows/szh-common.ps1).
// Get-SzhCourriel rend ses gabarits avec lib/gabarits.js, lancé par VSCodium-en-Node
// (outils/rendre-gabarit.js). On vérifie que :
// - les trois gabarits de support rendent par Get-SzhCourriel ce que rend lib/gabarits.js,
//   espaces de bord et CRLF compris ;
// - {% if %}, {% for %}, loop.last et les filtres passent par ce chemin ;
// - sans VSCodium ni extension, Get-SzhCourriel rend un texte de repli sans lever.
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
const { normaliserRenduCourriel } = require(path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'lib', 'courriel'));

// Convention sujet/corps de lib/courriel.js : sujet sans blancs de bord, corps privé d'un
// retour à la ligne de chaque côté. Get-SzhCourriel applique la même de son côté.
function rendreConvention(source, nom, variables) {
  return normaliserRenduCourriel(compiler(source, nom).rendre(variables));
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

// Texte attendu de chaque gabarit de support, écrit à la main : la référence indépendante
// de ce test. Il suit test/typo-check.py : apostrophe courbe (règle A1, fr) et insécable
// devant les deux-points précédés d'un seul espace (règle E2).
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

// ---- Get-SzhCourriel exécuté, Windows seulement ----
// La fonction est extraite telle quelle de windows/szh-common.ps1, avec ses dépendances,
// et lancée dans un script jetable (comme dans test/js/orphelins-toolkit.test.js).

// $env:SZH_COCKPIT_DOSSIER (Get-SzhDossierCockpit) vise le cockpit du dépôt, et non une
// extension installée sur le poste.
const DOSSIER_COCKPIT_REPO = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');

// Get-SzhCourriel lance VSCodium, qui doit donc être installé. Mêmes chemins que
// Get-VSCodiumExe (szh-common.ps1).
const sansVSCodium = (function () {
  if (process.platform !== 'win32') { return 'pas Windows'; }
  const candidats = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'VSCodium', 'VSCodium.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'VSCodium', 'VSCodium.exe')
  ];
  for (const c of candidats) { if (fs.existsSync(c)) { return false; } }
  return 'VSCodium introuvable sur ce poste';
})();

const { POWERSHELL, sansPowerShell } = require('./gardes');

// Le texte d'une fonction PowerShell : de sa déclaration jusqu'à la première ligne réduite
// à « } » en colonne 0.
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

// Sans BOM, PowerShell 5.1 lit un .ps1 dans la page de code ANSI du poste.
function ecrirePs1(chemin, contenu) {
  fs.writeFileSync(chemin, '\ufeff' + contenu, 'utf8');
}

function psChaine(v) { return "'" + String(v).replace(/'/g, "''") + "'"; }
// Un tableau devient @('a', 'b') : String(v) le joindrait en une chaîne, et le {% for %}
// du gabarit jetable n'aurait rien à parcourir.
function psValeur(v) {
  if (Array.isArray(v)) { return '@(' + v.map(psValeur).join(', ') + ')'; }
  return psChaine(v);
}
function psHashtable(obj) {
  return '@{ ' + Object.keys(obj).map((k) => k + ' = ' + psValeur(obj[k])).join('; ') + ' }';
}

const COMMUN_SOURCE = fs.existsSync(COMMUN_PS1) ? fs.readFileSync(COMMUN_PS1, 'utf8') : '';
const CORPS_GET_SZH_COURRIEL = POWERSHELL ? corpsFonction(COMMUN_SOURCE, 'Get-SzhCourriel') : '';
// Dépendances de Get-SzhCourriel : VSCodium-en-Node, dossier de l'extension, journal,
// texte de repli.
const CORPS_GET_VSCODIUM_EXE = POWERSHELL ? corpsFonction(COMMUN_SOURCE, 'Get-VSCodiumExe') : '';
const CORPS_GET_SZH_DOSSIER_COCKPIT = POWERSHELL ? corpsFonction(COMMUN_SOURCE, 'Get-SzhDossierCockpit') : '';
// Le lancement de VSCodium-en-Node vit dans szh-shell.ps1.
const SHELL_SOURCE = fs.readFileSync(path.join(RACINE, 'windows', 'szh-shell.ps1'), 'utf8');
const CORPS_LANCEUR_NODE = POWERSHELL
  ? ['ConvertTo-SzhArgumentEchappe', 'ConvertTo-SzhArguments', 'Get-SzhOutilCockpit', 'Invoke-SzhNodeCockpit']
    .map((nom) => corpsFonction(SHELL_SOURCE, nom)).join('\r\n')
  : '';
const CORPS_WRITE_SZH_LOG = POWERSHELL ? corpsFonction(COMMUN_SOURCE, 'Write-SzhLog') : '';
const CORPS_T = POWERSHELL ? corpsFonction(COMMUN_SOURCE, 'T') : '';
// T() lit $SzhTextes et $SzhLangue. windows/szh-textes.ps1 n'a pas d'effet de bord : le
// pilote le charge tel quel.
const TEXTES_PS1 = path.join(RACINE, 'windows', 'szh-textes.ps1');

// Exécute Get-SzhCourriel dans le dossier jetable `travail`, qui porte son propre
// mail-templates/ : $PSScriptRoot suit le .ps1 lancé. `appel` est la ligne PowerShell qui
// remplit $sortie ; si elle lève, $sortie.ok est faux et $sortie.erreur porte le message.
// `extraEnv` s'ajoute à l'environnement du pilote.
function executerGetSzhCourriel(travail, appel, extraEnv) {
  const pilote = [
    "$ErrorActionPreference = 'Stop'",
    '$script:SzhLogs = ' + psChaine(path.join(travail, 'logs')),
    '. ' + psChaine(TEXTES_PS1),
    "$script:SzhLangue = 'fr'",
    CORPS_GET_VSCODIUM_EXE,
    CORPS_GET_SZH_DOSSIER_COCKPIT,
    CORPS_LANCEUR_NODE,
    CORPS_WRITE_SZH_LOG,
    CORPS_T,
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
  const env = Object.assign({}, process.env, extraEnv || {});
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pPilote, pSortie],
    { encoding: 'utf8', windowsHide: true, timeout: 30000, env });
  assert.ok(run.status === 0 && fs.existsSync(pSortie),
    'le pilote PowerShell a échoué : ' + run.stderr);
  return JSON.parse(fs.readFileSync(pSortie, 'utf8'));
}

// Gabarit jetable avec {% if %}, {% for %}, loop.last et un filtre.
// Pas de retour à la ligne entre {% endfor %} et {% endblock %}, comme dans les gabarits de
// support : avec deux \n de fin, .NET (-replace '\n$', '') et JS (.replace(/\n$/, '')) n'en
// retirent pas le même nombre, car le `$` de .NET correspond aussi juste avant un \n final
// et -replace remplace toutes les occurrences.
const GABARIT_JETABLE = '{% block sujet %}Bilan{% endblock %}\r\n' +
  '{% block corps %}\r\n' +
  '{% for a in auteurs %}{{ a|upper }}{% if loop.last %} (dernier){% endif %}\r\n' +
  '{% endfor %}{% endblock %}\r\n';
const VARIABLES_JETABLE = { auteurs: ['dupont', 'martin'] };

for (const langue of ['fr', 'de', 'en']) {
  test('Get-SzhCourriel (PowerShell) et lib/gabarits.js (JS) rendent support.' + langue + '.twig à l’identique',
    { skip: sansPowerShell || sansVSCodium }, () => {
      const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-courriel-support-'));
      try {
        fs.mkdirSync(path.join(travail, 'mail-templates'));
        for (const nom of nomsGabarits()) {
          fs.copyFileSync(path.join(GABARITS, nom), path.join(travail, 'mail-templates', nom));
        }
        const appel = '$r = Get-SzhCourriel -Nom ' + psChaine('support') + ' -Variables ' +
          psHashtable(VARIABLES_ESSAI) + ' -Langue ' + psChaine(langue) +
          "; $sortie.sujet = $r.sujet; $sortie.corps = $r.corps";
        const resultatPs = executerGetSzhCourriel(travail, appel, { SZH_COCKPIT_DOSSIER: DOSSIER_COCKPIT_REPO });
        assert.equal(resultatPs.ok, true, 'Get-SzhCourriel a levé : ' + resultatPs.erreur);

        const sourceJs = fs.readFileSync(path.join(GABARITS, 'support.' + langue + '.twig'), 'utf8');
        const resultatJs = rendreConvention(sourceJs, 'support.' + langue + '.twig', VARIABLES_ESSAI);
        assert.equal(resultatPs.sujet, resultatJs.sujet);
        // `r`n côté PowerShell (mailto), \n côté JS.
        assert.equal(String(resultatPs.corps).replace(/\r\n/g, '\n'), resultatJs.corps);
      } finally {
        fs.rmSync(travail, { recursive: true, force: true });
      }
    });
}

test('Get-SzhCourriel rend maintenant correctement {% if %}/{% for %}/loop.last et un filtre ' +
  '(l’ancien mini-moteur y levait)', { skip: sansPowerShell || sansVSCodium }, () => {
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-courriel-jetable-'));
  try {
    fs.mkdirSync(path.join(travail, 'mail-templates'));
    fs.writeFileSync(path.join(travail, 'mail-templates', 'jetable.fr.twig'), GABARIT_JETABLE, 'utf8');
    const appel = '$r = Get-SzhCourriel -Nom ' + psChaine('jetable') + ' -Variables ' +
      psHashtable(VARIABLES_JETABLE) + ' -Langue ' + psChaine('fr') +
      "; $sortie.sujet = $r.sujet; $sortie.corps = $r.corps";
    const resultatPs = executerGetSzhCourriel(travail, appel, { SZH_COCKPIT_DOSSIER: DOSSIER_COCKPIT_REPO });
    assert.equal(resultatPs.ok, true, 'Get-SzhCourriel a levé sur if/for/loop.last/filtre : ' + resultatPs.erreur);

    const resultatJs = rendreConvention(GABARIT_JETABLE, 'jetable.fr.twig', VARIABLES_JETABLE);
    assert.equal(resultatPs.sujet, resultatJs.sujet);
    assert.equal(String(resultatPs.corps).replace(/\r\n/g, '\n'), resultatJs.corps);
    // loop.last et |upper ont tourné : seul le dernier auteur porte « (dernier) ».
    assert.match(resultatPs.corps, /MARTIN \(dernier\)/);
    assert.doesNotMatch(resultatPs.corps, /DUPONT \(dernier\)/);
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

// Le repli (VSCodium, extension ou script introuvable) ne lève pas. Un
// $env:SZH_COCKPIT_DOSSIER vide simule ce cas.
test('Get-SzhCourriel : repli en texte simple quand le dossier du cockpit est vide, sans lever',
  { skip: sansPowerShell }, () => {
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-courriel-repli-'));
    const dossierVide = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-cockpit-vide-'));
    try {
      fs.mkdirSync(path.join(travail, 'mail-templates'));
      fs.copyFileSync(path.join(GABARITS, 'support.fr.twig'), path.join(travail, 'mail-templates', 'support.fr.twig'));
      const appel = '$r = Get-SzhCourriel -Nom ' + psChaine('support') + ' -Variables ' +
        psHashtable(VARIABLES_ESSAI) + ' -Langue ' + psChaine('fr') +
        "; $sortie.sujet = $r.sujet; $sortie.corps = $r.corps";
      const resultat = executerGetSzhCourriel(travail, appel, { SZH_COCKPIT_DOSSIER: dossierVide });
      assert.equal(resultat.ok, true, 'Get-SzhCourriel a levé au lieu de replier : ' + resultat.erreur);
      assert.ok(resultat.sujet && resultat.sujet.length > 0, 'repli : sujet vide');
      assert.ok(resultat.corps && resultat.corps.length > 0, 'repli : corps vide');
      // Le texte de repli vient de szh-textes.ps1, et non de support.fr.twig.
      assert.doesNotMatch(resultat.sujet, /outil Revue SZH/);
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
      fs.rmSync(dossierVide, { recursive: true, force: true });
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
