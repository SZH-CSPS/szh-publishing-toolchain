// L'installation d'un poste et ce qui est « par utilisateur ».
//
//   node --test "test/js/*.test.js"
//
// Une installation lancée depuis la session d'une rédactrice mais élevée avec le compte du
// support tourne sous le compte du support : HKCU, %APPDATA%, %LOCALAPPDATA% et
// l'enregistrement des distributions WSL sont ceux du support. Ce fichier vérifie que :
//
//   * le dossier de la distribution est par compte, comme son enregistrement ; un dossier
//     déjà pris ferait refuser `wsl --import`
//     (Wsl/Service/RegisterDistro/ERROR_FILE_EXISTS), et un reste d'installation est
//     nettoyé ;
//   * l'état de l'environnement et des extensions est lu chez le compte, pas dans
//     state.json, commun au poste ;
//   * l'échec d'une étape n'empêche pas les suivantes (raccourcis, réglages, extensions) ;
//   * la passe silencieuse regarde aussi le compte, pas seulement la version du poste ;
//   * le journal nomme le compte.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const COMMUN_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');
const COMMUN = lire('windows', 'szh-common.ps1');
const TEXTES = lire('windows', 'szh-textes.ps1');
const UPDATE = lire('windows', 'update.ps1');
const LANCEUR = lire('windows', 'update-launcher.ps1');
const TACHES = lire('windows', 'szh-taches.ps1');
const BOOTSTRAP = lire('windows', 'bootstrap.ps1');
const DIAGNOSTIC = lire('windows', 'diagnostic.ps1');
const APPS_LOCK = JSON.parse(lire('windows', 'apps.lock'));
const APPS_MD = lire('windows', 'APPS.md');
const RELEASE = lire('.github', 'workflows', 'release.yml');

// Le corps d'une fonction PowerShell, de sa déclaration à la suivante.
function fonction(source, nom) {
  const debut = source.indexOf('function ' + nom);
  assert.ok(debut !== -1, 'szh-common.ps1 ne déclare plus ' + nom);
  const fin = source.indexOf('\r\nfunction ', debut + 10);
  return source.slice(debut, fin === -1 ? source.length : fin);
}

// ---- Ce qui est par utilisateur l'est vraiment ----

test('le disque de la distribution est rangé par compte, et personne ne bâtit ce chemin à la main', () => {
  const corps = fonction(COMMUN, 'Get-SzhDossierDistro');
  // Le SID, pas le nom de compte : deux domaines peuvent porter le même nom d'utilisateur,
  // et un compte renommé garde son SID.
  assert.match(corps, /\$Sid = \(Get-SzhIdentite\)\.sid/);
  assert.match(corps, /Join-Path \$SzhBase \('WSL\\' \+ \$Sid \+ '\\' \+ \$SzhDistro\)/);
  // Le chemin commun au poste n'apparaît plus nulle part : il bloquerait le deuxième
  // compte.
  for (const [nom, source] of [['update.ps1', UPDATE], ['szh-common.ps1', COMMUN]]) {
    assert.ok(source.indexOf("Join-Path $SzhBase 'WSL\\SZH-Publishing'") === -1,
      nom + ' construit encore un dossier de distribution commun au poste');
  }
  assert.ok(UPDATE.indexOf('Get-SzhDossierDistro') !== -1,
    'update.ps1 n’importe plus dans le dossier par compte');
});

test('l’état est coupé en deux : ce qui est au poste, ce qui est au compte', () => {
  // Le toolkit est commun au poste (une seule copie, une seule version). La distribution
  // WSL et les extensions sont par compte.
  assert.match(COMMUN, /\$script:SzhEtatUtilisateurFile = Join-Path \$SzhBaseUtilisateur/);
  assert.match(COMMUN, /\$script:SzhBaseUtilisateur = Join-Path \$env:LOCALAPPDATA 'SZH'/);
  for (const f of ['Get-SzhEtatUtilisateur', 'Save-SzhEtatUtilisateur', 'Get-SzhEtatUtilisateurChamp']) {
    assert.ok(COMMUN.indexOf('function ' + f) !== -1, 'szh-common.ps1 ne déclare plus ' + f);
  }
  // update.ps1 écrit les deux, et retire de l'état commun ce qui est par compte.
  assert.match(UPDATE, /Set-SzhStateCles \(\[ordered\]@\{/);
  assert.match(UPDATE, /-Retirer @\('rootfs', 'vsix'\)/);
  assert.match(UPDATE, /Save-SzhEtatUtilisateur \(\[ordered\]@\{/);
  // La version de l'environnement se lit chez le compte.
  assert.ok(UPDATE.indexOf("Get-SzhEtatUtilisateurChamp $etatUtil 'rootfs'") !== -1);
  assert.ok(LANCEUR.indexOf("Get-SzhEtatUtilisateurChamp $etatUtil 'rootfs'") !== -1);
  // Une seule lecture de l'état commun reste de chaque côté, pour les postes installés
  // avant l'état par utilisateur (ni réimport de 3 Go, ni fenêtre de mise à jour inutile).
  // Elle ne compte que si la distribution est enregistrée pour ce compte.
  assert.match(UPDATE,
    /if \(\(-not \$rootfsPose\) -and \$distroPresente -and \$etat -and \$etat\.rootfs\) \{/);
  assert.match(LANCEUR,
    /if \(\(-not \$rootfsActuel\) -and \$etat -and \$etat\.rootfs -and[\s\S]{0,120}Get-SzhDistrosEnregistrees\) -contains \$SzhDistro\)\) \{/);
  // Deux mentions de chaque côté : la condition et l'affectation qu'elle protège.
  for (const [nom, source] of [['update.ps1', UPDATE], ['update-launcher.ps1', LANCEUR]]) {
    const reprises = source.match(/\$etat\.rootfs/g) || [];
    assert.strictEqual(reprises.length, 2, nom + ' relit l’environnement dans l’état commun');
  }
});

test('une distribution absente fait taire l’état, jamais l’inverse', () => {
  // C'est la distribution enregistrée qui décide, pas un fichier d'état.
  const i = UPDATE.indexOf('$distroPresente = ((Get-SzhDistrosEnregistrees) -contains $SzhDistro)');
  assert.ok(i !== -1, 'update.ps1 ne demande plus la liste des distributions enregistrées');
  const suite = UPDATE.slice(i, i + 1000);
  assert.match(suite, /if \(-not \$distroPresente\) \{ \$rootfsPose = '' \}/);
});

test('les extensions se lisent chez l’éditeur, et « aucune » se distingue de « pas de réponse »', () => {
  const corps = fonction(COMMUN, 'Get-SzhExtensionsInstallees');
  assert.match(corps, /--list-extensions --show-versions/);
  // $null quand le CLI ne répond pas, une table quand il répond. Un profil neuf n'a aucune
  // extension : confondre les deux sauterait l'installation là où elle est nécessaire.
  assert.match(corps, /if \(-not \$Cli\) \{ return \$null \}/);
  assert.match(corps, /if \(\$LASTEXITCODE -ne 0\) \{ return \$null \}/);
  assert.match(corps, /catch \{ return \$null \}/);
  // update.ps1 se fie à cette lecture ; l'état retenu ne sert que de repli.
  assert.ok(UPDATE.indexOf('if ($null -ne $reelles) { $etatVsix = $reelles }') !== -1,
    'update.ps1 ne fait plus confiance à l’éditeur mais au fichier');
});

test('la passe silencieuse demande aussi « et CE compte, a-t-il tout reçu ? »', () => {
  // La version du poste ne dit rien d'un compte qui ouvre sa première session.
  assert.match(LANCEUR, /\$moiPose = \(\(\$rootfsActuel -eq \$manifest\.rootfs\.version\) -and \(Test-SzhExtensionsAJour \$manifest\)\)/);
  assert.match(LANCEUR, /if \(\(\$actuel -eq \$manifest\.version\) -and \$moiPose\)/);
  // Une mesure impossible ne déclenche rien : sans éditeur, ou si son CLI se tait, on ne
  // rouvre pas une fenêtre à chaque ouverture de session.
  const corps = fonction(COMMUN, 'Test-SzhExtensionsAJour');
  assert.match(corps, /if \(\$null -eq \$reelles\) \{ return \$true \}/);
  // Et le journal dit laquelle des deux questions a répondu non.
  assert.match(LANCEUR, /poste à jour \(\{0\}\) mais ce compte n''a pas tout reçu/);
});

test('la cadence de la passe silencieuse est par utilisateur', () => {
  // Un fichier par compte : un fichier commun ferait consommer la fenêtre de la semaine par
  // le premier compte connecté, pour tout le monde.
  assert.match(TACHES, /\$script:SzhMajSuiviFile = Join-Path \$SzhBaseUtilisateur 'maj-auto\.json'/);
  // L'ancien fichier commun est retiré au nettoyage, pour ne pas tromper un diagnostic.
  assert.match(UPDATE, /\$ancienneCadence = Join-Path \$SzhBase 'maj-auto\.json'/);
  assert.match(UPDATE, /Remove-Item -LiteralPath \$ancienneCadence -Force/);
});

// ---- Un reste d'installation est nettoyé ----

test('le reste d’une installation interrompue est écarté, et jamais un dossier étranger', () => {
  const corps = fonction(COMMUN, 'Clear-SzhDossierDistro');
  // Garde-fou : on ne supprime récursivement que ce qui porte notre nom. La fonction reçoit
  // un chemin, et un chemin peut venir d'ailleurs.
  assert.match(corps, /if \(\(Split-Path \$Dossier -Leaf\) -ne \$SzhDistro\)/);
  assert.match(corps, /throw/);
  assert.match(corps, /Remove-Item -LiteralPath \$Dossier -Recurse -Force/);
  // update.ps1 l'appelle avant l'import : `wsl --import` refuse d'écrire dans un dossier
  // déjà pris.
  const iClear = UPDATE.indexOf('Clear-SzhDossierDistro');
  const iImport = UPDATE.indexOf('--import $SzhDistro');
  assert.ok(iClear !== -1 && iImport !== -1 && iClear < iImport,
    'le reste doit être écarté avant l’import');
});

test('trois pannes WSL, trois messages, trois gestes — dans les trois langues', () => {
  // Un message par cause : un dossier déjà pris ne se ferme pas comme un éditeur, et la
  // virtualisation ne s'active pas sans la DSI.
  for (const cle of ['err.wsl', 'err.wsl.dossier', 'err.wsl.moteur', 'err.espace', 'maj.partiel']) {
    const motif = new RegExp("'" + cle.replace(/\./g, '\\.') + "'\\s*=\\s*(.+)", 'g');
    const lignes = TEXTES.match(motif) || [];
    assert.strictEqual(lignes.length, 3, 'il manque une traduction de ' + cle);
    for (const l of lignes) {
      assert.ok(l.indexOf('ß') === -1, 'orthographe suisse (ss) : ' + l);
      assert.ok(l.length > cle.length + 40, 'traduction trop courte : ' + l);
    }
  }
  // Chaque message est employé, et pour sa propre cause.
  for (const cle of ['err.wsl.dossier', 'err.wsl.moteur', 'err.espace', 'maj.partiel']) {
    assert.ok(UPDATE.indexOf("T '" + cle + "'") !== -1, 'update.ps1 n’emploie pas ' + cle);
  }
  // Le disque virtuel présent après un import raté désigne le dossier, pas l'éditeur.
  assert.match(UPDATE, /if \(Test-Path \(Join-Path \$dirDistro 'ext4\.vhdx'\)\) \{ throw \(T 'err\.wsl\.dossier'\) \}/);
});

test('un import réussi ne suffit pas : la distribution doit répondre', () => {
  // Sans virtualisation, l'import passe et le premier `--exec` échoue : la panne se
  // montrerait à la première compilation, loin de sa cause.
  const corps = fonction(COMMUN, 'Test-SzhDistroRepond');
  assert.match(corps, /--exec \/bin\/true/);
  assert.match(corps, /return \(\$LASTEXITCODE -eq 0\)/);
  const iImport = UPDATE.indexOf('--import $SzhDistro');
  const iEssai = UPDATE.indexOf('Test-SzhDistroRepond');
  assert.ok(iEssai > iImport, 'l’essai de démarrage doit suivre l’import');
});

test('la place libre est vérifiée avant de désenregistrer quoi que ce soit', () => {
  // Un import à moitié fait laisse un dossier pris et aucune distribution : l'état qui
  // bloque ensuite toutes les mises à jour.
  const iEspace = UPDATE.indexOf('Get-SzhEspaceLibreGo');
  const iDesenr = UPDATE.indexOf('--unregister $SzhDistro');
  assert.ok(iEspace !== -1 && iDesenr !== -1 && iEspace < iDesenr,
    'la place doit être vérifiée avant le désenregistrement');
  // Mesure impossible : on n'empêche rien sur un doute.
  assert.match(fonction(COMMUN, 'Get-SzhEspaceLibreGo'), /catch \{ return -1 \}/);
  assert.match(UPDATE, /if \(\(\$libre -ge 0\) -and \(\$libre -lt 5\)\)/);
});

// ---- Une étape qui échoue n'empêche pas les suivantes ----

test('l’environnement de fabrication ne peut plus priver le rédacteur du reste', () => {
  // Un échec de l'étape 2 (distribution WSL) laisse s'exécuter les étapes 3, 4 et 5
  // (raccourcis, extensions, réglages).
  const iEnv = UPDATE.indexOf("Write-SzhEtape (T 'maj.e2')");
  const iExt = UPDATE.indexOf("Write-SzhEtape (T 'maj.e3')");
  assert.ok(iEnv !== -1 && iExt > iEnv);
  const etape = UPDATE.slice(iEnv, iExt);
  assert.match(etape, /\} catch \{/, 'l’étape de l’environnement n’est plus sous try/catch');
  assert.match(etape, /\[void\]\$ennuis\.Add/, 'l’ennui n’est plus retenu');
  assert.match(etape, /\$rootfsPose = ''\s+# rien n'est retenu de ce qui n'est pas installé/);
  // La version n'est retenue qu'après un essai de démarrage réussi.
  const iPose = UPDATE.indexOf('$rootfsPose = $manifest.rootfs.version');
  assert.ok(iPose > UPDATE.indexOf('Test-SzhDistroRepond'),
    'la version est retenue avant que la distribution ait répondu');
});

test('un ennui retenu se dit à l’écran, et l’état est écrit avant', () => {
  // Ni « terminé », ni un écran d'erreur nu : le bilan dit ce qui a réussi. L'état s'écrit
  // d'abord, pour que ce qui a réussi ne soit pas réinstallé au passage suivant.
  const iEtat = UPDATE.indexOf('Save-SzhEtatUtilisateur ([ordered]@{');
  const iPartiel = UPDATE.indexOf('if ($ennuis.Count -gt 0) {');
  assert.ok(iEtat !== -1 && iPartiel > iEtat, 'l’état doit être écrit avant l’écran de fin');
  const bloc = UPDATE.slice(iPartiel, iPartiel + 900);
  assert.match(bloc, /T 'maj\.partiel'/);
  assert.match(bloc, /Show-SzhErreur/);
  // Code de sortie 1 : la passe silencieuse doit compter un blocage et finir par rouvrir la
  // fenêtre si la panne dure.
  assert.match(bloc, /exit 1/);
});

// ---- Le journal nomme le compte ----

test('tout ce qui est posé par utilisateur nomme son compte au journal', () => {
  // « raccourcis du menu Démarrer posés : … » dit pour quel compte.
  assert.match(UPDATE, /\$moi = Get-SzhIdentite/);
  assert.match(UPDATE, /update : compte \{0\} \(admin : \{1\}\)/);
  for (const motif of [/raccourcis du menu Démarrer posés pour \{0\}/,
    /ProgId SZH\.Markdown posé pour \{0\}/, /protocole szh: posé pour \{0\}/]) {
    assert.match(UPDATE, motif);
  }
  // La fonction qui dit qui exécute, et celle qui dit pour qui la session est ouverte :
  // leur écart révèle une élévation avec un autre compte.
  for (const f of ['Get-SzhIdentite', 'Get-SzhSessionUtilisateur']) {
    assert.ok(COMMUN.indexOf('function ' + f) !== -1, 'szh-common.ps1 ne déclare plus ' + f);
  }
  assert.match(fonction(COMMUN, 'Get-SzhSessionUtilisateur'), /explorer\.exe/);
});

// ---- Le réseau du poste ----

test('un proxy d’entreprise et une connexion qui coupe ne bloquent plus une installation', () => {
  // Le proxy reçoit les identifiants de la session, sans saisie (sinon : 407 à chaque
  // téléchargement).
  assert.match(COMMUN, /\[Net\.WebRequest\]::DefaultWebProxy = \$proxySysteme/);
  assert.match(COMMUN, /DefaultNetworkCredentials/);
  const corps = fonction(COMMUN, 'Get-SzhFichier');
  // Trois essais, et un fichier temporaire tant que le téléchargement n'est pas complet.
  assert.match(corps, /\[int\]\$Essais = 3/);
  assert.match(corps, /\$partiel = \$Destination \+ '\.part'/);
  assert.match(corps, /Move-Item -LiteralPath \$partiel -Destination \$Destination -Force/);
  // Une coupure ne lève pas d'erreur : le flux rend 0 comme à la fin normale. La
  // comparaison de taille fait réessayer, au lieu d'un rejet à l'empreinte qui ferait
  // échouer toute la mise à jour.
  const une = fonction(COMMUN, 'Get-SzhFichierUneFois');
  assert.match(une, /if \(\(\$total -gt 0\) -and \(\$fait -lt \$total\)\)/);
});

test('une seule mise à jour à la fois sur le POSTE, pas par session', () => {
  // Verrou « Global\ » : « Local\ » le bornerait à la session, et deux comptes connectés
  // détendraient le toolkit en même temps.
  const corps = fonction(COMMUN, 'New-SzhMutexPoste');
  assert.match(corps, /'Global\\' \+ \$Nom/);
  // Son ACL nomme les Utilisateurs (S-1-5-32-545), sinon le deuxième compte se verrait
  // refuser l'ouverture et croirait une mise à jour en cours.
  assert.match(corps, /SecurityIdentifier\('S-1-5-32-545'\)/);
  assert.match(corps, /MutexRights\]::FullControl/);
  // Repli de session si le poste refuse « Global\ » : un verrou de session vaut mieux que
  // pas de verrou.
  assert.match(corps, /'Local\\' \+ \$Nom/);
  assert.ok(UPDATE.indexOf('$script:SzhMutex = New-SzhMutexPoste') !== -1);
});

// ---- Les deux applications du poste : figées, vérifiées, au niveau machine ----

test('winget n’est plus dans la chaîne d’installation', () => {
  // winget échoue souvent sur un poste neuf (index de source non synchronisé, source
  // msstore qui réclame une région, proxy), et n'existe pas sous une élévation faite avec
  // un compte de support. On cherche un appel, pas une mention : les commentaires de
  // bootstrap.ps1 peuvent le nommer.
  const appels = BOOTSTRAP.split(/\r?\n/).filter((l) =>
    /(&\s*winget|winget\s+(install|source)|Get-Command\s+winget)/.test(l));
  assert.deepStrictEqual(appels, [], 'bootstrap.ps1 appelle encore winget : ' + appels.join(' | '));
  // Pas d'appel à l'API GitHub : non authentifiée, elle rend 403 au-delà de 60 requêtes
  // par heure et par adresse, ce qu'un bureau derrière un même NAT atteint vite.
  assert.ok(BOOTSTRAP.indexOf('api.github.com') === -1,
    'bootstrap.ps1 dépend encore de l’API GitHub pour trouver un installeur');
});

test('apps.lock épingle les deux applications, empreinte et signataire compris', () => {
  const apps = APPS_LOCK.applications;
  assert.strictEqual(apps.length, 2, 'apps.lock ne porte plus exactement deux applications');
  assert.deepStrictEqual(apps.map((a) => a.id), ['VSCodium', 'SumatraPDF']);
  for (const a of apps) {
    // Une empreinte, sans quoi le reste n'est qu'un téléchargement.
    assert.match(a.sha256, /^[0-9a-f]{64}$/, a.id + ' : sha256 mal formé');
    assert.match(a.source, /^https:\/\//, a.id + ' : source non chiffrée');
    // La version figure dans le nom du fichier et dans l'URL : les deux doivent concorder.
    assert.ok(a.fichier.indexOf(a.version) !== -1, a.id + ' : version absente du nom de fichier');
    assert.ok(a.source.indexOf(a.version) !== -1, a.id + ' : version absente de l’URL');
    assert.ok(a.signataire && a.signataire.length > 4, a.id + ' : signataire attendu non déclaré');
    assert.ok(Array.isArray(a.installation) && a.installation.length > 0,
      a.id + ' : arguments d’installation silencieuse absents');
    assert.strictEqual(typeof a.requis, 'boolean', a.id + ' : « requis » doit être un booléen');
    // Le paquet système d'abord : c'est l'ordre des sondes qui décide de ce qu'on trouve, et
    // un paquet par utilisateur trouvé en premier serait celui du compte qui installe.
    assert.ok(a.sondes.length >= 2, a.id + ' : il manque une sonde');
    assert.match(a.sondes[0], /^%ProgramFiles%/, a.id + ' : la sonde système n’est plus la première');
    assert.ok(a.sondes.some((s) => s.indexOf('LOCALAPPDATA') !== -1),
      a.id + ' : un paquet déjà posé par utilisateur ne serait plus vu');
  }
  // L'éditeur est indispensable, le lecteur PDF non : la chaîne compile sans lui.
  assert.strictEqual(apps[0].requis, true, 'un poste sans éditeur n’est pas un poste');
  assert.strictEqual(apps[1].requis, false, 'le lecteur PDF ne doit pas bloquer une installation');
  // Le paquet système de VSCodium, pas « UserSetup » : sous une élévation faite avec un
  // autre compte, la variante par utilisateur irait dans le profil du support.
  assert.ok(apps[0].fichier.indexOf('UserSetup') === -1,
    'VSCodium est épinglé sur son installeur par utilisateur');
  assert.match(apps[0].fichier, /^VSCodiumSetup-x64-/);
});

test('l’installation vérifie avant de poser, et conclut par le disque', () => {
  const debut = BOOTSTRAP.indexOf('function Install-SzhAppEpinglee');
  assert.ok(debut !== -1, 'bootstrap.ps1 ne déclare plus Install-SzhAppEpinglee');
  const corps = BOOTSTRAP.slice(debut, BOOTSTRAP.indexOf('\r\nInfo ', debut));
  // Une empreinte fausse arrête tout : seul l'installeur épinglé s'exécute.
  assert.match(corps, /Test-SzhSha256 -Fichier \$exe -Attendu \$App\.sha256/);
  assert.match(corps, /Empreinte inattendue pour/);
  // Un proxy qui répond par une page d'erreur rend un fichier de la bonne taille et du
  // mauvais genre : deux octets nomment la cause.
  assert.match(corps, /-ne 0x4D/);
  assert.match(corps, /-ne 0x5A/);
  // La signature double l'empreinte sans la remplacer : « pas signé » et « empreinte de
  // signature fausse » arrêtent, un défaut de chaîne sur un poste hors ligne avertit.
  assert.match(corps, /Get-AuthenticodeSignature/);
  assert.match(corps, /HashMismatch/);
  assert.match(corps, /NotSigned/);
  // La sonde tranche, pas le code de retour : un installeur peut sortir en 0 sans rien
  // poser là où on l'attend.
  const iSortie = corps.indexOf('$p = Start-Process');
  const iSonde = corps.indexOf('Get-SzhAppChemin $App', iSortie);
  assert.ok(iSonde > iSortie, 'la présence sur le disque n’est plus vérifiée après l’installation');
  assert.match(corps.slice(iSonde), /if \(\$chemin\) \{ return \$chemin \}/);
});

test('une version déjà posée n’est jamais remplacée en silence', () => {
  // Une montée de version est un geste volontaire : l'installation ne remplace pas
  // l'éditeur déjà là.
  const i = BOOTSTRAP.indexOf('Info \'Applications du poste (versions figées dans apps.lock)\'');
  assert.ok(i !== -1, 'bootstrap.ps1 ne pose plus les applications épinglées');
  const boucle = BOOTSTRAP.slice(i, i + 2000);
  assert.match(boucle, /déjà en place/);
  assert.match(boucle, /Laissé tel quel : une montée de version est un geste volontaire/);
  assert.match(boucle, /windows\/APPS\.md/);
  // Quand l'élévation vient d'un autre compte, le paquet « par utilisateur » trouvé serait
  // celui du support : on l'ignore et on pose le paquet système.
  assert.match(boucle, /-SystemeSeulement:\(-not \$memeCompte\)/);
  const sonde = BOOTSTRAP.slice(BOOTSTRAP.indexOf('function Get-SzhAppChemin'), i);
  assert.match(sonde, /if \(\$SystemeSeulement -and \(\$brut -like '\*LOCALAPPDATA\*'\)\) \{ continue \}/);
});

test('la CI refuse de publier si un installeur épinglé a changé amont', () => {
  // Les installeurs ne sont pas réhébergés (164 Mo par release) : à chaque release, on
  // vérifie que l'URL répond et que les octets sont les mêmes.
  assert.match(RELEASE, /Vérifier les installeurs épinglés \(apps\.lock\)/);
  const etape = RELEASE.slice(RELEASE.indexOf('Vérifier les installeurs épinglés'));
  assert.match(etape, /jq -c '\.applications\[\]' windows\/apps\.lock/);
  assert.match(etape, /sha256sum/);
  assert.match(etape, /Empreinte inattendue pour/);
  assert.match(etape, /exit 1/);
  // La procédure de montée de version est documentée.
  assert.match(APPS_MD, /Monter de version/);
  assert.match(APPS_MD, /Get-FileHash/);
  assert.match(APPS_MD, /Get-AuthenticodeSignature/);
});

test('le diagnostic compare les versions posées au verrou', () => {
  // Un écart avec les versions épinglées se voit sans ouvrir les postes un par un.
  assert.match(DIAGNOSTIC, /Join-Path \$PSScriptRoot 'apps\.lock'/);
  assert.match(DIAGNOSTIC, /version épinglée \{1\}/);
  assert.match(DIAGNOSTIC, /installé pour ce compte seulement/);
});

// ---- Les fonctions, réellement exécutées ----
// Windows seulement. Rien n'est écrit dans les vrais emplacements du poste : les variables
// de socle sont réécrites dans la portée du pilote, ce que permet leur portée $script:.

const { POWERSHELL, sansPowerShell } = require('./gardes');

const PILOTE = [
  "$ErrorActionPreference = 'Stop'",
  '. "' + COMMUN_PS1 + '"',
  '$travail = $args[0]; $sortie = $args[1]',
  // Les emplacements du poste, déplacés dans un dossier de travail.
  '$script:SzhBase = Join-Path $travail "ProgramData"',
  '$script:SzhStateFile = Join-Path $SzhBase "state.json"',
  '$script:SzhBaseUtilisateur = Join-Path $travail "LocalAppData"',
  '$script:SzhEtatUtilisateurFile = Join-Path $SzhBaseUtilisateur "etat-utilisateur.json"',
  'New-Item -ItemType Directory -Force -Path $SzhBase | Out-Null',
  '$r = [ordered]@{}',
  // 1. l'identité, et le dossier de distribution qui en découle
  '$moi = Get-SzhIdentite',
  '$r.sid = $moi.sid',
  '$r.nom = $moi.nom',
  '$r.distro = Get-SzhDossierDistro',
  // 2. state.json : la langue survit à l'écriture des clés de la mise à jour, et ce qui a
  //    déménagé chez l'utilisateur est retiré du commun.
  'Set-SzhJson $SzhStateFile ([ordered]@{ langue = "de"; version = "2026.08.40"; rootfs = "2026.08.40"; vsix = [ordered]@{ "a.b" = "1.0.0" } })',
  'Set-SzhStateCles ([ordered]@{ version = "2026.08.55"; toolkit = "2026.08.55" }) -Retirer @("rootfs", "vsix") | Out-Null',
  '$apres = Get-SzhState',
  '$r.state = [ordered]@{ langue = [string]$apres.langue; version = [string]$apres.version',
  '  aRootfs = [bool]$apres.PSObject.Properties["rootfs"]; aVsix = [bool]$apres.PSObject.Properties["vsix"] }',
  // 3. l'état par utilisateur : écrit, relu, et un champ absent rend une chaîne vide
  'Save-SzhEtatUtilisateur ([ordered]@{ compte = $moi.nom; rootfs = "2026.08.42"; vsix = [ordered]@{ "a.b" = "1.0.0" } }) | Out-Null',
  '$eu = Get-SzhEtatUtilisateur',
  '$r.util = [ordered]@{ rootfs = (Get-SzhEtatUtilisateurChamp $eu "rootfs")',
  '  absent = (Get-SzhEtatUtilisateurChamp $eu "jamais-ecrit"); fichier = (Test-Path $SzhEtatUtilisateurFile) }',
  // 4. le reste d'installation : le nôtre s'écarte, un dossier étranger jamais
  '$mien = Get-SzhDossierDistro',
  'New-Item -ItemType Directory -Force -Path $mien | Out-Null',
  'Set-Content -Path (Join-Path $mien "ext4.vhdx") -Value "faux disque" -Encoding ASCII',
  '$r.efface = (Clear-SzhDossierDistro -Dossier $mien)',
  '$r.resteApres = (Test-Path $mien)',
  '$r.videRend = (Clear-SzhDossierDistro -Dossier $mien)',
  '$etranger = Join-Path $travail "Mes documents"',
  'New-Item -ItemType Directory -Force -Path $etranger | Out-Null',
  'Set-Content -Path (Join-Path $etranger "these.docx") -Value "travail" -Encoding ASCII',
  'try { Clear-SzhDossierDistro -Dossier $etranger | Out-Null; $r.etrangerLeve = $false }',
  'catch { $r.etrangerLeve = $true }',
  '$r.etrangerReste = (Test-Path (Join-Path $etranger "these.docx"))',
  // 5. la place libre : une mesure, ou -1, jamais une exception
  '$r.espace = Get-SzhEspaceLibreGo',
  '$r.espaceAbsurde = Get-SzhEspaceLibreGo -Chemin "ZZ:\\rien"',
  // 6. le verrou de poste. Un mutex Windows est réentrant pour le thread qui le tient : la
  //    concurrence se mesure depuis un autre processus (deux fenêtres de mise à jour, ou
  //    deux sessions). La sonde est écrite par Node ($args[2]), pour rester lisible.
  '$m1 = New-SzhMutexPoste -Nom "SZH-Essai-Installation"',
  '$r.verrou1 = $m1.WaitOne(0)',
  '$ps = Join-Path $env:WINDIR "System32\\WindowsPowerShell\\v1.0\\powershell.exe"',
  '$p = Start-Process -FilePath $ps -Wait -PassThru -WindowStyle Hidden -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $args[2])',
  '$r.verrouAutreProcessus = $p.ExitCode',
  '$m1.ReleaseMutex()',
  '$p2 = Start-Process -FilePath $ps -Wait -PassThru -WindowStyle Hidden -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $args[2])',
  '$r.verrouRendu = $p2.ExitCode',
  'Set-SzhJson $sortie $r'
].join('\r\n') + '\r\n';

// La sonde : un autre processus qui tente de prendre le même verrou de poste.
const SONDE = [
  '. "' + COMMUN_PS1 + '"',
  '$m = New-SzhMutexPoste -Nom "SZH-Essai-Installation"',
  'if ($m.WaitOne(0)) { $m.ReleaseMutex(); exit 7 } else { exit 8 }'
].join('\r\n') + '\r\n';

const bilan = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-installation-'));
  const pilote = path.join(travail, 'eprouver.ps1');
  const sonde = path.join(travail, 'sonde.ps1');
  const sortie = path.join(travail, 'bilan.json');
  fs.writeFileSync(pilote, PILOTE, 'utf8');
  fs.writeFileSync(sonde, SONDE, 'utf8');
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote,
    travail, sortie, sonde], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  const restes = { status: run.status, stderr: run.stderr || '' };
  fs.rmSync(travail, { recursive: true, force: true });
  return Object.assign({}, restes, { r: lu });
})();

test('le dossier de distribution porte le SID du compte qui l’exécute', { skip: sansPowerShell }, () => {
  assert.strictEqual(bilan.status, 0, 'le pilote PowerShell a échoué : ' + bilan.stderr);
  const r = bilan.r;
  assert.match(r.sid, /^S-1-5-21-/, 'SID inattendu : ' + r.sid);
  assert.ok(r.distro.indexOf(r.sid) !== -1, 'le SID ne sépare pas les comptes : ' + r.distro);
  assert.match(r.distro, /[\\/]WSL[\\/]/);
  assert.match(r.distro, /SZH-Publishing$/);
});

test('écrire l’état du poste n’efface pas la langue choisie', { skip: sansPowerShell }, () => {
  const s = bilan.r.state;
  // update.ps1 garde la langue de state.json : sur des postes dont Windows est en anglais,
  // le lanceur la perdrait.
  assert.strictEqual(s.langue, 'de', 'la langue du poste a été effacée');
  assert.strictEqual(s.version, '2026.08.55');
  // Ce qui est par compte est retiré de l'état commun.
  assert.strictEqual(s.aRootfs, false, 'rootfs traîne encore dans l’état commun');
  assert.strictEqual(s.aVsix, false, 'vsix traîne encore dans l’état commun');
});

test('l’état par utilisateur s’écrit, se relit, et ne devine rien', { skip: sansPowerShell }, () => {
  const u = bilan.r.util;
  assert.strictEqual(u.fichier, true, 'l’état par utilisateur n’a pas été écrit');
  assert.strictEqual(u.rootfs, '2026.08.42');
  assert.strictEqual(u.absent, '', 'un champ jamais écrit doit rendre une chaîne vide');
});

test('le reste s’écarte, le dossier de quelqu’un d’autre est intouchable', { skip: sansPowerShell }, () => {
  const r = bilan.r;
  assert.strictEqual(r.efface, true, 'le reste d’installation n’a pas été écarté');
  assert.strictEqual(r.resteApres, false, 'le dossier survit à son effacement');
  assert.strictEqual(r.videRend, false, 'un dossier absent doit rendre $false, non lever');
  // Le garde-fou : la fonction reçoit un chemin, et un chemin peut venir d'ailleurs.
  assert.strictEqual(r.etrangerLeve, true, 'un dossier étranger a été accepté');
  assert.strictEqual(r.etrangerReste, true, 'un dossier étranger a été supprimé');
});

test('la place libre se mesure, et un doute n’empêche rien', { skip: sansPowerShell }, () => {
  assert.ok(bilan.r.espace > 0, 'place libre invraisemblable : ' + bilan.r.espace);
  assert.strictEqual(bilan.r.espaceAbsurde, -1, 'une mesure impossible doit rendre -1');
});

test('le verrou de poste est pris une fois, et se rend', { skip: sansPowerShell }, () => {
  const r = bilan.r;
  assert.strictEqual(r.verrou1, true, 'le premier appelant n’obtient pas le verrou');
  // 8 = l'autre processus n'a pas pu le prendre, ce qu'on veut ; 7 = deux mises à jour
  // tourneraient en même temps sur le même toolkit.
  assert.strictEqual(r.verrouAutreProcessus, 8, 'deux mises à jour tourneraient en même temps');
  assert.strictEqual(r.verrouRendu, 7, 'le verrou rendu n’est pas reprenable');
});

// ---- Le bloc empreinte/signature, réellement exécuté ----
//
// Le test « l'installation vérifie avant de poser, et conclut par le disque », plus haut,
// lit la source de Install-SzhAppEpinglee ; celui-ci exécute la vérification.
//
// La fonction entière installerait pour de vrai (Start-Process) : seul le tronçon
// empreinte + en-tête + signature est extrait par tranche(), comme dans
// test/js/diagnostic.test.js, puis rejoué contre deux faux .exe dans un dossier jetable.
// Pas de réseau : Get-SzhFichier est remplacée par une fonction qui ne fait rien, et le
// fichier « en cache » reste tel quel.
function tranche(source, debutMotif, finMotif) {
  const iDebut = source.indexOf(debutMotif);
  assert.ok(iDebut !== -1, 'motif de début introuvable dans bootstrap.ps1 : ' + debutMotif);
  const iFin = source.indexOf(finMotif, iDebut + debutMotif.length);
  assert.ok(iFin !== -1, 'motif de fin introuvable dans bootstrap.ps1 : ' + finMotif);
  return source.slice(iDebut, iFin);
}

const BLOC_EMPREINTE = tranche(BOOTSTRAP, '$exe = Join-Path $SzhStaging',
  "\r\n  # Un jeu d'arguments");

const PILOTE_EMPREINTE = [
  "$ErrorActionPreference = 'Stop'",
  '. "' + COMMUN_PS1 + '"',
  // Pas de réseau : le « téléchargement » laisse le fichier en cache tel quel, et son
  // empreinte reste fausse.
  'function Get-SzhFichier { param($Url, $Destination) }',
  'function Info([string]$m) { }',
  'function Attention([string]$m) { }',
  'function essayer($App) {',
  '  try {',
  BLOC_EMPREINTE,
  '    return [ordered]@{ leve = $false; message = "" }',
  '  } catch {',
  '    return [ordered]@{ leve = $true; message = $_.Exception.Message }',
  '  }',
  '}',
  '$SzhStaging = $args[0]; $cas = $args[1]; $sortie = $args[2]',
  'if ($cas -eq "hash") {',
  '  # Empreinte attendue fausse, et le contenu du fichier ne matchera jamais : le second',
  '  # essai (après le faux téléchargement) échoue pour la même raison, et doit lever.',
  '  $App = [pscustomobject]@{ fichier = "faux.exe"; sha256 = ("0" * 64)',
  '    source = "https://exemple.invalide/faux.exe"; signataire = "" }',
  '  [IO.File]::WriteAllBytes((Join-Path $SzhStaging $App.fichier), [byte[]](0x4D,0x5A,1,2,3,4))',
  '  $r = essayer $App',
  '} elseif ($cas -eq "signature") {',
  '  # Empreinte CORRECTE (calculée sur le fichier), pour n’atteindre que le contrôle de',
  '  # signature. Un en-tête MZ à la main donne un « UnknownError » (pas assez d’un PE pour',
  '  # WinVerifyTrust) : il faut un exécutable RÉEL — trivial, et jamais signé — pour que',
  '  # Get-AuthenticodeSignature rende NotSigned, le cas que le bloc doit rejeter.',
  '  $chemin = Join-Path $SzhStaging "faux2.exe"',
  '  Add-Type -OutputType ConsoleApplication -OutputAssembly $chemin '
    + '-TypeDefinition "public class P { public static void Main(){} }"',
  '  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $chemin).Hash.ToLower()',
  '  $App = [pscustomobject]@{ fichier = "faux2.exe"; sha256 = $hash',
  '    source = "https://exemple.invalide/faux2.exe"; signataire = "" }',
  '  $r = essayer $App',
  '} else {',
  '  $r = [ordered]@{ leve = $false; message = "cas inconnu : $cas" }',
  '}',
  'Set-SzhJson $sortie $r'
].join('\r\n') + '\r\n';

function executerBlocEmpreinte(cas) {
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-empreinte-'));
  const pilote = path.join(travail, 'empreinte.ps1');
  const sortie = path.join(travail, 'bilan.json');
  fs.writeFileSync(pilote, PILOTE_EMPREINTE, 'utf8');
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote,
    travail, cas, sortie], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  const restes = { status: run.status, stderr: run.stderr || '' };
  fs.rmSync(travail, { recursive: true, force: true });
  return Object.assign({}, restes, lu || {});
}

test('le bloc empreinte/signature d’Install-SzhAppEpinglee lève sur une empreinte fausse',
  { skip: sansPowerShell }, () => {
    const r = executerBlocEmpreinte('hash');
    assert.strictEqual(r.status, 0, 'le pilote PowerShell a échoué : ' + r.stderr);
    assert.strictEqual(r.leve, true,
      'une empreinte différente de celle attendue n’a pas fait lever l’installation');
    assert.match(r.message, /Empreinte inattendue/, 'le message ne nomme pas l’empreinte : ' + r.message);
  });

test('le bloc empreinte/signature d’Install-SzhAppEpinglee lève sur un exécutable non signé',
  { skip: sansPowerShell }, () => {
    const r = executerBlocEmpreinte('signature');
    assert.strictEqual(r.status, 0, 'le pilote PowerShell a échoué : ' + r.stderr);
    assert.strictEqual(r.leve, true, 'un exécutable non signé n’a pas fait lever l’installation');
    assert.match(r.message, /NotSigned/, 'le message ne nomme pas l’état de la signature : ' + r.message);
  });
