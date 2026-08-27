// L'installation d'un poste et ce qui est « par utilisateur ».
//
//   node --test "test/js/*.test.js"
//
// Le défaut gardé ici est celui du 26 août 2026, et il a coûté une matinée de support. Une
// installation lancée depuis la session d'une rédactrice mais élevée avec le compte du
// support tourne SOUS le compte du support : HKCU, %APPDATA%, %LOCALAPPDATA% et
// l'enregistrement des distributions WSL sont ceux du support. Tout ce qui est par
// utilisateur atterrissait donc dans le mauvais profil, et rien ne le disait — les lignes
// de journal ne nommaient pas le compte. Quatre conséquences, toutes gardées ici :
//
//   * le dossier de la distribution était commun au poste alors que son enregistrement est
//     par compte : le deuxième compte trouvait le dossier pris et `wsl --import` refusait
//     (Wsl/Service/RegisterDistro/ERROR_FILE_EXISTS), sans que rien ne nettoie jamais ce
//     reste — le même message à chaque essai, pour toujours ;
//   * state.json, commun au poste, affirmait « environnement installé, dix extensions
//     posées » à un compte qui n'avait ni l'un ni les autres, et la mise à jour les sautait
//     comme « déjà à jour » : une panne parfaitement silencieuse ;
//   * l'échec de l'étape de l'environnement emportait les étapes suivantes, donc les
//     raccourcis, les réglages et les extensions — pour une panne qui ne les concernait pas ;
//   * la passe silencieuse lisait « poste à jour » et ressortait, laissant un compte neuf
//     sans rien, sur un poste que le journal disait en ordre.
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
  // Et le chemin commun d'avant a disparu partout : c'est lui qui bloquait le deuxième
  // compte du poste.
  for (const [nom, source] of [['update.ps1', UPDATE], ['szh-common.ps1', COMMUN]]) {
    assert.ok(source.indexOf("Join-Path $SzhBase 'WSL\\SZH-Publishing'") === -1,
      nom + ' construit encore un dossier de distribution commun au poste');
  }
  assert.ok(UPDATE.indexOf('Get-SzhDossierDistro') !== -1,
    'update.ps1 n’importe plus dans le dossier par compte');
});

test('l’état est coupé en deux : ce qui est au poste, ce qui est au compte', () => {
  // Le toolkit est commun — une seule copie, une seule version. La distribution WSL et les
  // extensions sont par compte. Les confondre est ce qui faisait sauter l'installation.
  assert.match(COMMUN, /\$script:SzhEtatUtilisateurFile = Join-Path \$SzhBaseUtilisateur/);
  assert.match(COMMUN, /\$script:SzhBaseUtilisateur = Join-Path \$env:LOCALAPPDATA 'SZH'/);
  for (const f of ['Get-SzhEtatUtilisateur', 'Save-SzhEtatUtilisateur', 'Get-SzhEtatUtilisateurChamp']) {
    assert.ok(COMMUN.indexOf('function ' + f) !== -1, 'szh-common.ps1 ne déclare plus ' + f);
  }
  // update.ps1 écrit les deux, et retire du commun ce qui a déménagé : deux vérités pour
  // une même question, c'est exactement ce qui a menti à un compte neuf.
  assert.match(UPDATE, /Set-SzhStateCles \(\[ordered\]@\{/);
  assert.match(UPDATE, /-Retirer @\('rootfs', 'vsix'\)/);
  assert.match(UPDATE, /Save-SzhEtatUtilisateur \(\[ordered\]@\{/);
  // Et la version de l'environnement se lit chez le compte, plus dans l'état commun.
  assert.ok(UPDATE.indexOf("Get-SzhEtatUtilisateurChamp $etatUtil 'rootfs'") !== -1);
  assert.ok(LANCEUR.indexOf("Get-SzhEtatUtilisateurChamp $etatUtil 'rootfs'") !== -1);
  // Une seule lecture de l'état commun subsiste de chaque côté, et sous condition : les
  // postes installés avant l'état par utilisateur ne doivent ni réimporter 3 Go, ni voir
  // s'ouvrir une fenêtre de mise à jour pour rien. La confiance n'est accordée que si la
  // distribution est enregistrée pour CE compte — sans quoi ce serait le mensonge
  // d'origine, réintroduit sous forme de reprise.
  assert.match(UPDATE,
    /if \(\(-not \$rootfsPose\) -and \$distroPresente -and \$etat -and \$etat\.rootfs\) \{/);
  assert.match(LANCEUR,
    /if \(\(-not \$rootfsActuel\) -and \$etat -and \$etat\.rootfs -and[\s\S]{0,120}Get-SzhDistrosEnregistrees\) -contains \$SzhDistro\)\) \{/);
  // Deux mentions de chaque côté, et deux seulement : la condition gardée et l'affectation
  // qu'elle protège.
  for (const [nom, source] of [['update.ps1', UPDATE], ['update-launcher.ps1', LANCEUR]]) {
    const reprises = source.match(/\$etat\.rootfs/g) || [];
    assert.strictEqual(reprises.length, 2, nom + ' relit l’environnement dans l’état commun');
  }
});

test('une distribution absente fait taire l’état, jamais l’inverse', () => {
  // Un fichier peut mentir, une distribution enregistrée non : c'est elle qui décide.
  const i = UPDATE.indexOf('$distroPresente = ((Get-SzhDistrosEnregistrees) -contains $SzhDistro)');
  assert.ok(i !== -1, 'update.ps1 ne demande plus la liste des distributions enregistrées');
  const suite = UPDATE.slice(i, i + 1000);
  assert.match(suite, /if \(-not \$distroPresente\) \{ \$rootfsPose = '' \}/);
});

test('les extensions se lisent chez l’éditeur, et « aucune » se distingue de « pas de réponse »', () => {
  const corps = fonction(COMMUN, 'Get-SzhExtensionsInstallees');
  assert.match(corps, /--list-extensions --show-versions/);
  // $null quand le CLI ne répond pas, une table quand il répond. Un profil neuf n'a AUCUNE
  // extension : confondre les deux ferait sauter l'installation là où elle est nécessaire.
  assert.match(corps, /if \(-not \$Cli\) \{ return \$null \}/);
  assert.match(corps, /if \(\$LASTEXITCODE -ne 0\) \{ return \$null \}/);
  assert.match(corps, /catch \{ return \$null \}/);
  // Et update.ps1 fait de cette lecture la vérité, l'état retenu ne servant que de repli.
  assert.ok(UPDATE.indexOf('if ($null -ne $reelles) { $etatVsix = $reelles }') !== -1,
    'update.ps1 ne fait plus confiance à l’éditeur mais au fichier');
});

test('la passe silencieuse demande aussi « et CE compte, a-t-il tout reçu ? »', () => {
  // « Le poste est-il à la bonne version ? » ne dit rien d'un compte qui vient d'ouvrir sa
  // première session sur ce poste : c'est ainsi qu'un compte neuf restait sans rien.
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
  // Fichier commun : le premier compte connecté consommait la fenêtre de la semaine pour
  // tout le monde, et le deuxième ressortait muet jusqu'au mardi suivant.
  assert.match(TACHES, /\$script:SzhMajSuiviFile = Join-Path \$SzhBaseUtilisateur 'maj-auto\.json'/);
  // Et l'ancien fichier commun est retiré au nettoyage : laissé en place, il ne dirait plus
  // rien de personne et ferait mal lire un poste au diagnostic suivant.
  assert.match(UPDATE, /\$ancienneCadence = Join-Path \$SzhBase 'maj-auto\.json'/);
  assert.match(UPDATE, /Remove-Item -LiteralPath \$ancienneCadence -Force/);
});

// ---- Un reste d'installation ne bloque plus le poste pour toujours ----

test('le reste d’une installation interrompue est écarté, et jamais un dossier étranger', () => {
  const corps = fonction(COMMUN, 'Clear-SzhDossierDistro');
  // Garde-fou : on ne supprime récursivement que ce qui porte notre nom. La fonction reçoit
  // un chemin, et un chemin peut venir d'ailleurs.
  assert.match(corps, /if \(\(Split-Path \$Dossier -Leaf\) -ne \$SzhDistro\)/);
  assert.match(corps, /throw/);
  assert.match(corps, /Remove-Item -LiteralPath \$Dossier -Recurse -Force/);
  // Et update.ps1 l'appelle AVANT l'import, sinon `wsl --import` refuse d'écrire dans un
  // dossier déjà pris et rien ne le nettoie jamais.
  const iClear = UPDATE.indexOf('Clear-SzhDossierDistro');
  const iImport = UPDATE.indexOf('--import $SzhDistro');
  assert.ok(iClear !== -1 && iImport !== -1 && iClear < iImport,
    'le reste doit être écarté avant l’import');
});

test('trois pannes WSL, trois messages, trois gestes — dans les trois langues', () => {
  // Un seul message envoyait le support fermer un éditeur qui n'avait rien à voir : un
  // dossier déjà pris ne se ferme pas, et la virtualisation ne s'active pas sans la DSI.
  for (const cle of ['err.wsl', 'err.wsl.dossier', 'err.wsl.moteur', 'err.espace', 'maj.partiel']) {
    const motif = new RegExp("'" + cle.replace(/\./g, '\\.') + "'\\s*=\\s*(.+)", 'g');
    const lignes = COMMUN.match(motif) || [];
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
  // Sans virtualisation, l'import passe et le premier `--exec` échoue : la panne
  // n'apparaissait qu'à la première tentative de PDF, loin de sa cause.
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

// ---- Une étape qui tombe n'emporte plus les autres ----

test('l’environnement de fabrication ne peut plus priver le rédacteur du reste', () => {
  // C'est le cœur du défaut : l'étape 2 mourait et les étapes 3, 4 et 5 ne s'exécutaient
  // jamais. La rédactrice s'est retrouvée sans raccourcis, sans extensions et sans réglages
  // pour une panne qui ne concernait que la distribution WSL.
  const iEnv = UPDATE.indexOf("Write-SzhEtape (T 'maj.e2')");
  const iExt = UPDATE.indexOf("Write-SzhEtape (T 'maj.e3')");
  assert.ok(iEnv !== -1 && iExt > iEnv);
  const etape = UPDATE.slice(iEnv, iExt);
  assert.match(etape, /\} catch \{/, 'l’étape de l’environnement n’est plus sous try/catch');
  assert.match(etape, /\[void\]\$ennuis\.Add/, 'l’ennui n’est plus retenu');
  assert.match(etape, /\$rootfsPose = ''\s+# rien n'est retenu de ce qui n'est pas installé/);
  // Et rien n'est affirmé de ce qui n'a pas été fait : la version n'est retenue qu'après
  // l'essai de démarrage réussi.
  const iPose = UPDATE.indexOf('$rootfsPose = $manifest.rootfs.version');
  assert.ok(iPose > UPDATE.indexOf('Test-SzhDistroRepond'),
    'la version est retenue avant que la distribution ait répondu');
});

test('un ennui retenu se dit à l’écran, et l’état est écrit avant', () => {
  // Ni « terminé », qui serait faux, ni un écran d'erreur nu qui laisserait croire que rien
  // n'a été fait. Et l'état s'écrit d'abord : ce qui a réussi ne doit pas être réinstallé
  // au prochain passage sous prétexte qu'autre chose a échoué.
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
  // Le défaut de diagnostic : « raccourcis du menu Démarrer posés : Revues SZH, … » sans
  // dire pour QUI. La ligne était vraie — pour le compte du support.
  assert.match(UPDATE, /\$moi = Get-SzhIdentite/);
  assert.match(UPDATE, /update : compte \{0\} \(admin : \{1\}\)/);
  for (const motif of [/raccourcis du menu Démarrer posés pour \{0\}/,
    /ProgId SZH\.Markdown posé pour \{0\}/, /protocole szh: posé pour \{0\}/]) {
    assert.match(UPDATE, motif);
  }
  // Et la fonction qui dit qui exécute, plus celle qui dit pour qui la session est ouverte :
  // c'est l'écart entre les deux qui décrit une élévation avec un autre compte.
  for (const f of ['Get-SzhIdentite', 'Get-SzhSessionUtilisateur']) {
    assert.ok(COMMUN.indexOf('function ' + f) !== -1, 'szh-common.ps1 ne déclare plus ' + f);
  }
  assert.match(fonction(COMMUN, 'Get-SzhSessionUtilisateur'), /explorer\.exe/);
});

// ---- Le réseau du poste ----

test('un proxy d’entreprise et une connexion qui coupe ne bloquent plus une installation', () => {
  // 407 à chaque téléchargement, sans qu'un message le dise : les identifiants de la session
  // suffisent, aucune saisie n'est demandée.
  assert.match(COMMUN, /\[Net\.WebRequest\]::DefaultWebProxy = \$proxySysteme/);
  assert.match(COMMUN, /DefaultNetworkCredentials/);
  const corps = fonction(COMMUN, 'Get-SzhFichier');
  // Trois essais, et un fichier temporaire tant que le téléchargement n'est pas complet.
  assert.match(corps, /\[int\]\$Essais = 3/);
  assert.match(corps, /\$partiel = \$Destination \+ '\.part'/);
  assert.match(corps, /Move-Item -LiteralPath \$partiel -Destination \$Destination -Force/);
  // Une coupure ne lève pas : le flux rend 0 comme à la fin normale. Sans cette
  // comparaison, un fichier tronqué portait le bon nom et n'était rejeté qu'à l'empreinte,
  // une minute plus tard, en faisant échouer toute la mise à jour au lieu de réessayer.
  const une = fonction(COMMUN, 'Get-SzhFichierUneFois');
  assert.match(une, /if \(\(\$total -gt 0\) -and \(\$fait -lt \$total\)\)/);
});

test('une seule mise à jour à la fois sur le POSTE, pas par session', () => {
  // « Local\ » bornait le verrou à la session : deux comptes connectés détendaient deux
  // Expand-Archive sur le même toolkit.
  const corps = fonction(COMMUN, 'New-SzhMutexPoste');
  assert.match(corps, /'Global\\' \+ \$Nom/);
  // Et son ACL nomme les Utilisateurs (S-1-5-32-545), sinon le deuxième compte se voit
  // refuser l'ouverture et croit qu'une mise à jour est en cours alors qu'il n'y en a aucune.
  assert.match(corps, /SecurityIdentifier\('S-1-5-32-545'\)/);
  assert.match(corps, /MutexRights\]::FullControl/);
  // Repli de session si le poste refuse « Global\ » : un verrou de session vaut mieux que
  // pas de verrou.
  assert.match(corps, /'Local\\' \+ \$Nom/);
  assert.ok(UPDATE.indexOf('$script:SzhMutex = New-SzhMutexPoste') !== -1);
});

// ---- Les deux applications du poste : figées, vérifiées, au niveau machine ----

test('winget n’est plus dans la chaîne d’installation', () => {
  // Il tombe en panne sur un poste neuf plus souvent qu'on ne le croit — index de source
  // jamais synchronisé, source msstore qui réclame une région, proxy qui coupe le CDN — et
  // sous une élévation faite avec un compte de support, son App Installer n'est même pas
  // provisionné pour ce compte : winget n'existe simplement pas. Le 26 août 2026, VSCodium
  // et SumatraPDF ont fini par être posés à la main.
  // L'appel, pas la mention : l'en-tête et les commentaires expliquent justement pourquoi il
  // a disparu.
  const appels = BOOTSTRAP.split(/\r?\n/).filter((l) =>
    /(&\s*winget|winget\s+(install|source)|Get-Command\s+winget)/.test(l));
  assert.deepStrictEqual(appels, [], 'bootstrap.ps1 appelle encore winget : ' + appels.join(' | '));
  // Et l'appel à l'API GitHub a disparu avec : non authentifiée, elle rend 403 au-delà de
  // 60 requêtes par heure et par adresse — tout un bureau derrière un même NAT l'épuise.
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
    // La version se lit dans le nom du fichier et dans l'URL : un bump qui n'en change
    // qu'une moitié se verrait ici avant de se voir sur un poste.
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
  // Le paquet SYSTÈME de VSCodium, jamais « UserSetup » : sous une élévation faite avec un
  // autre compte, la variante par utilisateur atterrit dans le profil du support.
  assert.ok(apps[0].fichier.indexOf('UserSetup') === -1,
    'VSCodium est épinglé sur son installeur par utilisateur');
  assert.match(apps[0].fichier, /^VSCodiumSetup-x64-/);
});

test('l’installation vérifie avant de poser, et conclut par le disque', () => {
  const debut = BOOTSTRAP.indexOf('function Install-SzhAppEpinglee');
  assert.ok(debut !== -1, 'bootstrap.ps1 ne déclare plus Install-SzhAppEpinglee');
  const corps = BOOTSTRAP.slice(debut, BOOTSTRAP.indexOf('\r\nInfo ', debut));
  // L'empreinte arrête tout : un installeur qui n'est pas celui qui est épinglé ne
  // s'exécute pas.
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
  // Et c'est la sonde qui tranche, pas le code de retour : un installeur peut sortir en 0
  // sans rien poser là où on l'attend.
  const iSortie = corps.indexOf('$p = Start-Process');
  const iSonde = corps.indexOf('Get-SzhAppChemin $App', iSortie);
  assert.ok(iSonde > iSortie, 'la présence sur le disque n’est plus vérifiée après l’installation');
  assert.match(corps.slice(iSonde), /if \(\$chemin\) \{ return \$chemin \}/);
});

test('une version déjà posée n’est jamais remplacée en silence', () => {
  // Une montée de version est un geste volontaire : remplacer l'éditeur pendant
  // l'installation d'un poste n'est pas une surprise à faire à quelqu'un.
  const i = BOOTSTRAP.indexOf('Info \'Applications du poste (versions figées dans apps.lock)\'');
  assert.ok(i !== -1, 'bootstrap.ps1 ne pose plus les applications épinglées');
  const boucle = BOOTSTRAP.slice(i, i + 2000);
  assert.match(boucle, /déjà en place/);
  assert.match(boucle, /Laissé tel quel : une montée de version est un geste volontaire/);
  assert.match(boucle, /windows\/APPS\.md/);
  // Et quand l'élévation vient d'un autre compte, le paquet « par utilisateur » trouvé
  // serait celui du support : on l'ignore et on pose le paquet système.
  assert.match(boucle, /-SystemeSeulement:\(-not \$memeCompte\)/);
  const sonde = BOOTSTRAP.slice(BOOTSTRAP.indexOf('function Get-SzhAppChemin'), i);
  assert.match(sonde, /if \(\$SystemeSeulement -and \(\$brut -like '\*LOCALAPPDATA\*'\)\) \{ continue \}/);
});

test('la CI refuse de publier si un installeur épinglé a changé amont', () => {
  // Les installeurs ne sont pas réhébergés — 164 Mo par release. La contrepartie se vérifie
  // à chaque release : l'URL répond, et les octets sont les mêmes.
  assert.match(RELEASE, /Vérifier les installeurs épinglés \(apps\.lock\)/);
  const etape = RELEASE.slice(RELEASE.indexOf('Vérifier les installeurs épinglés'));
  assert.match(etape, /jq -c '\.applications\[\]' windows\/apps\.lock/);
  assert.match(etape, /sha256sum/);
  assert.match(etape, /Empreinte inattendue pour/);
  assert.match(etape, /exit 1/);
  // Et la procédure de montée est écrite quelque part : un verrou sans mode d'emploi finit
  // contourné.
  assert.match(APPS_MD, /Monter de version/);
  assert.match(APPS_MD, /Get-FileHash/);
  assert.match(APPS_MD, /Get-AuthenticodeSignature/);
});

test('le diagnostic compare les versions posées au verrou', () => {
  // Sans cela, un écart de flotte ne se voit qu'en ouvrant dix postes un par un.
  assert.match(DIAGNOSTIC, /Join-Path \$PSScriptRoot 'apps\.lock'/);
  assert.match(DIAGNOSTIC, /version épinglée \{1\}/);
  assert.match(DIAGNOSTIC, /installé pour ce compte seulement/);
});

// ---- Les fonctions, réellement exécutées ----
// Windows seulement. Rien n'est écrit dans les vrais emplacements du poste : les variables
// de socle sont réécrites dans la portée du pilote, ce que permet leur portée $script:.

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
  //    concurrence ne se mesure que depuis un AUTRE processus, ce qui est justement le cas
  //    à garder — deux fenêtres de mise à jour, ou deux sessions.
  //    La sonde est écrite par Node ($args[2]) : un script qui écrit un script qui écrit un
  //    script ne se relit pas.
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

const sansPowerShell = POWERSHELL ? false : 'powershell.exe indisponible';

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
  // Le défaut : update.ps1 réécrivait state.json de zéro, donc la langue disparaissait à
  // chaque mise à jour. Sur ces postes, dont Windows est en anglais, le lanceur reparlait
  // anglais à une équipe francophone.
  assert.strictEqual(s.langue, 'de', 'la langue du poste a été effacée');
  assert.strictEqual(s.version, '2026.08.55');
  // Et ce qui a déménagé chez l'utilisateur ne traîne plus dans le commun : deux vérités
  // pour une même question, c'est ce qui a menti à un compte neuf.
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
