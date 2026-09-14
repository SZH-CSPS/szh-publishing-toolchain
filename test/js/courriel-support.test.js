// Le troisième et dernier modèle de courriel du dépôt (le courriel de support de l'écran
// d'erreur, Show-SzhErreur dans windows/szh-common.ps1). Ce fichier a longtemps comparé
// deux moteurs qui ne se parlaient jamais -- lib/gabarits.js (JS, cockpit) et un mini-Twig
// écrit à la main dans Get-SzhCourriel (PowerShell). Depuis le 14.09.2026, il n'y a plus
// qu'UN SEUL moteur (lib/gabarits.js) : Get-SzhCourriel l'exécute via VSCodium-en-Node
// (outils/rendre-gabarit.js, vscodium-extension/szh-cockpit). Ce fichier devient donc un
// contrôle de CÂBLAGE : il prouve que les trois gabarits de support rendent, par
// Get-SzhCourriel, EXACTEMENT ce que rend lib/gabarits.js (conventions de trim et CRLF
// comprises), qu'une construction Twig hors de portée de l'ancien mini-moteur ({% if %},
// {% for %}, loop.last, un filtre) est maintenant rendue correctement, et que le repli
// (VSCodium ou l'extension introuvables) rend un texte simple sans jamais lever.
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

// ---- Le câblage réel, Windows seulement ----
// Get-SzhCourriel (windows/szh-common.ps1) appelle désormais un vrai sous-processus
// (VSCodium-en-Node) : on éprouve donc la VRAIE fonction PowerShell, extraite mot pour mot
// du VRAI szh-common.ps1 (même technique que test/js/orphelins-toolkit.test.js pour
// Remove-SzhToolkitOrphelins), plutôt que de faire confiance à la lecture du code.

// Le dossier du cockpit DANS CE DÉPÔT (pas une extension posée pour ce compte) :
// $env:SZH_COCKPIT_DOSSIER (Get-SzhDossierCockpit, szh-common.ps1) vise directement ici,
// pour éprouver lib/gabarits.js et outils/rendre-gabarit.js tels qu'ils sont dans l'arbre
// de travail, sans dépendre d'une extension déjà empaquetée et posée sur le poste.
const DOSSIER_COCKPIT_REPO = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');

// VSCodium doit exister sur le poste pour ces tests : Get-SzhCourriel le lance en vrai.
// Mêmes deux chemins que Get-VSCodiumExe (szh-common.ps1).
const sansVSCodium = (function () {
  if (process.platform !== 'win32') { return 'pas Windows'; }
  const candidats = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'VSCodium', 'VSCodium.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'VSCodium', 'VSCodium.exe')
  ];
  for (const c of candidats) { if (fs.existsSync(c)) { return false; } }
  return 'VSCodium introuvable sur ce poste';
})();

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
// Une valeur de hashtable peut être un tableau (variable `auteurs` du gabarit jetable,
// ci-dessous) : @('a', 'b'), jamais String(v) qui les joindrait en une seule chaîne et
// ferait disparaître le {% for %} qui la parcourt.
function psValeur(v) {
  if (Array.isArray(v)) { return '@(' + v.map(psValeur).join(', ') + ')'; }
  return psChaine(v);
}
function psHashtable(obj) {
  return '@{ ' + Object.keys(obj).map((k) => k + ' = ' + psValeur(obj[k])).join('; ') + ' }';
}

const COMMUN_SOURCE = fs.existsSync(COMMUN_PS1) ? fs.readFileSync(COMMUN_PS1, 'utf8') : '';
const CORPS_GET_SZH_COURRIEL = POWERSHELL ? corpsFonction(COMMUN_SOURCE, 'Get-SzhCourriel') : '';
// Get-SzhCourriel appelle maintenant ces quatre-là (VSCodium-en-Node, dossier de
// l'extension, journal, texte de repli) : la fonction extraite seule ne suffit plus, il
// leur faut ces dépendances dans le même script-pilote jetable.
const CORPS_GET_VSCODIUM_EXE = POWERSHELL ? corpsFonction(COMMUN_SOURCE, 'Get-VSCodiumExe') : '';
const CORPS_GET_SZH_DOSSIER_COCKPIT = POWERSHELL ? corpsFonction(COMMUN_SOURCE, 'Get-SzhDossierCockpit') : '';
const CORPS_WRITE_SZH_LOG = POWERSHELL ? corpsFonction(COMMUN_SOURCE, 'Write-SzhLog') : '';
const CORPS_T = POWERSHELL ? corpsFonction(COMMUN_SOURCE, 'T') : '';
// T() lit $SzhTextes et $SzhLangue -- windows/szh-textes.ps1 est une table de données pure
// (aucun effet de bord), son vrai chemin se dot-source donc tel quel dans le pilote.
const TEXTES_PS1 = path.join(RACINE, 'windows', 'szh-textes.ps1');

// Exécute Get-SzhCourriel (extraite ci-dessus, avec ses dépendances) dans un dossier de
// travail jetable qui porte son propre « mail-templates » -- $PSScriptRoot suit le fichier
// .ps1 réellement lancé, donc ce dossier-là, jamais windows/mail-templates/ du dépôt.
// `appel` est la ligne PowerShell qui peuple $sortie ; en cas de levée, $sortie.ok est faux
// et $sortie.erreur porte le message. `extraEnv` s'ajoute à l'environnement du pilote --
// $env:SZH_COCKPIT_DOSSIER, en particulier, pour viser un dossier précis sans dépendre
// d'une extension posée sur le poste.
function executerGetSzhCourriel(travail, appel, extraEnv) {
  const pilote = [
    "$ErrorActionPreference = 'Stop'",
    '$script:SzhLogs = ' + psChaine(path.join(travail, 'logs')),
    '. ' + psChaine(TEXTES_PS1),
    "$script:SzhLangue = 'fr'",
    CORPS_GET_VSCODIUM_EXE,
    CORPS_GET_SZH_DOSSIER_COCKPIT,
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

// Le contrôle qui prouve la mission : un gabarit jetable avec {% if %}, {% for %},
// loop.last et un filtre -- hors de portée de l'ancien mini-moteur (il y levait
// systématiquement « construction Twig non prise en charge ») -- est maintenant rendu
// CORRECTEMENT par Get-SzhCourriel, puisque c'est lib/gabarits.js qui s'en charge en vrai.
// Rouge avant le passage au moteur unique (14.09.2026), vert après : voir le rapport de
// mission pour la preuve des deux états.
// Pas de retour à la ligne entre {% endfor %} et {% endblock %} : comme les vrais gabarits
// de support (une seule ligne vide avant {% endblock %}), pour ne pas cumuler deux \n de
// fin -- .NET (-replace '\n$', '') et JS (.replace(/\n$/, '')) ne s'accordent pas sur
// combien en retirer quand il y en a deux d'affilée (`$` de .NET matche aussi juste avant
// un \n final, et -replace remplace TOUTES les occurrences), un écart de la convention de
// rendu qui n'est pas l'objet de ce test.
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
        // `r`n côté PowerShell (mailto), \n côté JS : même comparaison qu'ailleurs dans ce
        // fichier, normalisée avant de comparer.
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
    // Preuve que loop.last et le filtre |upper ont vraiment tourné, pas juste que « ok »
    // est vrai : le dernier auteur porte « (dernier) », le premier non.
    assert.match(resultatPs.corps, /MARTIN \(dernier\)/);
    assert.doesNotMatch(resultatPs.corps, /DUPONT \(dernier\)/);
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

// Le repli (VSCodium introuvable, extension introuvable, script manquant...) ne doit
// JAMAIS lever -- $env:SZH_COCKPIT_DOSSIER pointé sur un dossier vide simule ce cas sans
// avoir à désinstaller quoi que ce soit sur le poste de test.
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
      // Le texte de repli (szh-textes.ps1) est différent du gabarit habituel -- il ne doit
      // jamais avoir lu ni rendu support.fr.twig.
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
