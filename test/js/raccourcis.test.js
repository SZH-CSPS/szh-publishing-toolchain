// Les raccourcis du menu Démarrer : ce que le rédacteur trouve dans son menu, et ce qui
// arrive quand le menu se refuse.
//
//   node --test "test/js/*.test.js"
//
// Le défaut gardé ici est une absence : la mise à jour n'avait aucune entrée de menu.
// `update.ps1` posait deux raccourcis de lanceur et aucun pour lui-même, si bien que la
// seule façon de mettre l'outil à jour à la demande était le sélecteur de versions du
// lanceur — atteignable seulement par qui savait déjà où chercher. Quatre dangers, tous
// gardés ici :
//   * le libellé d'un .lnk est un nom de fichier, donc figé : un poste germanophone ne
//     doit pas lire « Mise à jour de l’outil Revue », d'où deux entrées à noms fixes,
//     chacune portant sa langue à update.ps1 plutôt qu'une entrée renommée à chaque passe ;
//   * une mise à jour doit se VOIR — elle télécharge, elle peut échouer, son journal est
//     la seule trace : son raccourci ne passe donc pas par hidden.vbs, contrairement aux
//     deux lanceurs ;
//   * un menu Démarrer tenu par une stratégie de groupe ne doit pas faire échouer une mise
//     à jour par ailleurs réussie, mais doit le dire au journal ;
//   * un raccourci d'une version antérieure, mal nommé, doit être retiré et non doublé —
//     sans toucher au sous-dossier « SZH », qui appartient à un autre produit.
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
const SHELL = lire('windows', 'szh-shell.ps1');
const TEXTES = lire('windows', 'szh-textes.ps1');
const UPDATE = lire('windows', 'update.ps1');
const LANCEUR_MAJ = lire('windows', 'update-launcher.ps1');
const BOOTSTRAP = lire('windows', 'bootstrap.ps1');
const OUVRIR = lire('windows', 'open-revue.ps1');
const OUVRIR_LIVRE = lire('windows', 'open-livre.ps1');
// open-revue.ps1 et open-livre.ps1 restent les points d'entrée que visent les raccourcis et
// le protocole "szh:", mais ne sont plus que des enveloppes de quelques lignes : la fenêtre,
// l'icône et l'identité de barre des tâches vivent maintenant dans ce troisième fichier,
// commun aux trois produits (revue, zeitschrift, livre).
const OUVRIR_PRODUIT = lire('windows', 'open-produit.ps1');
const SHELL_PRODUITS = lire('windows', 'szh-produits.ps1');
const ICONE_PY = lire('windows', 'icone.py');
// Les deux icônes de l'application ne sortent pas du même dessin ni du même outil que
// les trois icônes de produit : leur source est un .svg, rendu par Edge. D'où un second
// fabricant, et c'est celui-là qu'il faut interroger pour pronto.ico et pronto-maj.ico.
const ICONE_PRONTO_PY = lire('windows', 'icone-pronto.py');

// Les cinq entrées PÉRIMÉES depuis le 13.09.2026 (fusion des trois lanceurs en un seul, à
// onglets, et des deux mises à jour en une entrée à nom fixe) : elles ne se posent plus,
// mais leurs littéraux survivent ailleurs — Get-SzhRaccourcisObsoletes (szh-shell.ps1) les
// nomme pour la désinstallation, et les deux noms de mise à jour restent les valeurs de
// `raccourci.maj.nom` (szh-textes.ps1), qui ne nomment plus aucun raccourci actuel. C'est ce
// que garde encore le test « les libellés des raccourcis existent dans les trois langues »,
// plus bas — d'où ce nom conservé.
const NOMS = ['Revues SZH', 'Zeitschriften SZH', 'Books SZH-CSPS',
  'Mise à jour de l’outil Revue', 'Aktualisierung des Redaktionstools'];

// Les DEUX entrées réellement posées depuis le 13.09.2026. Le nom définitif de l'application
// n'est pas arrêté (voir le commentaire de $script:SzhNomApplication dans szh-shell.ps1) :
// on le LIT depuis là plutôt que de le recopier en dur, pour qu'un futur baptême ne casse
// pas ce fichier sans avoir rien cassé de réel.
function litLitteral(source, nomVar) {
  const m = source.match(new RegExp('\\$script:' + nomVar + "\\s*=\\s*'([^']+)'"));
  assert.ok(m, nomVar + ' introuvable dans szh-shell.ps1');
  return m[1];
}
const NOM_APPLICATION = litLitteral(SHELL, 'SzhNomApplication');
const NOM_MISE_A_JOUR = litLitteral(SHELL, 'SzhNomMiseAJour');
const NOMS_ACTUELS = [NOM_APPLICATION, NOM_MISE_A_JOUR];

// Windows seulement : szh-common.ps1 vise Windows PowerShell 5.1, et un .lnk n'existe que
// là. Hissé en tête de fichier (il ne l'était qu'en bas avant) : plusieurs contrôles plus
// haut exécutent maintenant réellement la fonction, pour un fait (l'ordre des noms selon la
// langue) qu'une lecture de texte ne peut pas prouver.
const { POWERSHELL, sansPowerShell } = require('./gardes');

// ---- Ce que szh-shell.ps1 déclare ----

test('les raccourcis du menu sont posés par une seule fonction, paramétrable', () => {
  // Une seule, parce que trois scripts la posent : la mise à jour, la tâche de connexion
  // et l'installation d'un poste. Trois copies divergeraient sans qu'on le voie.
  for (const attendu of ['function Get-SzhRaccourcisMenu', 'function Set-SzhRaccourcisMenu']) {
    assert.ok(SHELL.indexOf(attendu) !== -1, 'szh-shell.ps1 ne déclare plus : ' + attendu);
  }
  const debut = SHELL.indexOf('function Set-SzhRaccourcisMenu');
  const corps = SHELL.slice(debut, SHELL.indexOf('\r\nfunction ', debut + 10));
  // $Menu et $Toolkit paramétrables : c'est ce qui rend la fonction éprouvable hors du
  // vrai menu Démarrer, et c'est ce dont se sert le contrôle du bas de ce fichier.
  assert.match(corps, /\[string\]\$Menu\s+=\s+''/);
  assert.match(corps, /\[string\]\$Toolkit\s+=\s+\$SzhToolkit/);
  // Le bilan est rendu, pas affiché : chaque appelant l'écrit dans son propre journal.
  for (const cle of ['poses', 'retires', 'manques']) {
    assert.ok(corps.indexOf(cle + '   =') !== -1 || corps.indexOf(cle + ' =') !== -1,
      'le bilan ne porte plus « ' + cle + ' »');
  }
});

// Glissement du 13.09.2026 : il n'y avait pas « deux entrées de mise à jour, une par
// équipe », mais quatre en tout (deux lanceurs de produit à noms fixes ET deux mises à jour
// à noms fixes, une par langue) — Set-SzhLangueProduit et $SzhLanguesRaccourci ont disparu
// avec ce modèle. Le défaut d'origine ne bougeait pas pour autant : un poste germanophone ne
// doit jamais lire un libellé français figé dans un nom de fichier. Le nouveau garde-fou
// est plus direct — le nom UNIQUE de la mise à jour ne contient plus aucun mot à traduire,
// donc il ne change JAMAIS avec $SzhLangue, à la différence de sa description. Éprouvé en
// exécutant réellement Get-SzhRaccourcisMenu sous fr puis sous de, et en comparant.
test('l’entrée de mise à jour garde un nom fixe quelle que soit la langue, à la différence de sa description',
  { skip: sansPowerShell }, () => {
    const lireEnLangue = (langue) => {
      const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-raccourcis-langue-'));
      const sortie = path.join(travail, 'bilan.json');
      const pilote = path.join(travail, 'lire.ps1');
      fs.writeFileSync(pilote, [
        "$ErrorActionPreference = 'Stop'",
        '. "' + COMMUN_PS1 + '"',
        '$r = @(Get-SzhRaccourcisMenu -Toolkit $args[0]) | ForEach-Object {',
        '  [ordered]@{ nom = $_.nom; desc = $_.desc }',
        '}',
        'Set-SzhJson $args[1] $r'
      ].join('\r\n') + '\r\n', 'utf8');
      const env = Object.assign({}, process.env, { SZH_LANGUE: langue });
      const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote,
        RACINE, sortie], { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
      assert.strictEqual(run.status, 0, 'pilote (' + langue + ') : ' + (run.stderr || ''));
      const r = JSON.parse(fs.readFileSync(sortie, 'utf8'));
      fs.rmSync(travail, { recursive: true, force: true });
      return r;
    };
    const fr = lireEnLangue('fr');
    const de = lireEnLangue('de');
    assert.deepStrictEqual(fr.map((x) => x.nom), de.map((x) => x.nom),
      'un nom de .lnk change avec la langue : un épinglage casserait à chaque bascule');
    assert.deepStrictEqual(fr.map((x) => x.nom).sort(), NOMS_ACTUELS.slice().sort());
    const majFr = fr.find((x) => x.nom === NOM_MISE_A_JOUR);
    const majDe = de.find((x) => x.nom === NOM_MISE_A_JOUR);
    assert.ok(majFr && majDe, 'l’entrée de mise à jour a disparu dans une des deux langues');
    assert.notStrictEqual(majFr.desc, majDe.desc,
      'la description ne suit plus la langue : le réglage ne servirait plus à rien');
  });

test('la mise à jour se voit, le lanceur non', () => {
  // Glissement du 13.09.2026 : un seul lanceur (trois onglets) au lieu de trois, et la mise
  // à jour ne reçoit plus -Langue par son raccourci — le défaut gardé ne change pas pour
  // autant : la mise à jour doit rester visible quand le lanceur, lui, reste sans console.
  const debut = SHELL.indexOf('function Get-SzhRaccourcisMenu');
  const corps = SHELL.slice(debut, SHELL.indexOf('\r\nfunction ', debut + 10));
  // Le lanceur unique : wscript.exe //B hidden.vbs, donc sans console.
  const lignesVbs = corps.split('\r\n').filter((l) => l.indexOf('//B "{0}"') !== -1);
  assert.strictEqual(lignesVbs.length, 1, 'seul le lanceur passe par hidden.vbs');
  assert.ok(lignesVbs[0].indexOf('open-revue.ps1') !== -1 || lignesVbs[0].indexOf('$lanceur') !== -1);
  // La mise à jour : powershell.exe en direct, et rien d'autre. hidden.vbs ici cacherait
  // le téléchargement, l'attente et l'échec.
  const ligneMaj = corps.split('\r\n').filter((l) => l.indexOf('-ExecutionPolicy Bypass -File') !== -1);
  assert.strictEqual(ligneMaj.length, 1, 'l’entrée de mise à jour a changé de forme');
  assert.ok(ligneMaj[0].indexOf('hidden.vbs') === -1, 'la mise à jour ne doit pas être cachée');
  assert.match(ligneMaj[0], /-NoProfile -ExecutionPolicy Bypass -File "\{0\}"/);
  assert.ok(ligneMaj[0].indexOf('-Langue') === -1,
    'la mise à jour reçoit encore -Langue : elle ne devrait plus le passer par son raccourci');
  // Windows PowerShell 5.1 nommé explicitement : $PSHOME désignerait pwsh si la mise à
  // jour avait été lancée depuis PowerShell 7, et pwsh n'a pas de powershell.exe à côté.
  assert.ok(corps.indexOf("System32\\WindowsPowerShell\\v1.0\\powershell.exe") !== -1);
  // Fenêtre normale, dite explicitement plutôt que laissée au défaut.
  assert.match(SHELL, /\$lnk\.WindowStyle = 1/);
});

test('le lanceur et sa mise à jour portent chacun leur propre icône, fabriquée par icone-pronto.py', () => {
  // Épinglé à la barre des tâches, un raccourci perd son libellé : l'icône devient le seul
  // repère. Glissement du 13.09.2026 : Get-SzhRaccourcisMenu ne pose plus que DEUX entrées,
  // donc ne cherche plus que DEUX icônes (pronto.ico pour le lanceur, pronto-maj.ico pour
  // la mise à jour), fabriquées par icone-pronto.py depuis pronto.svg et pronto-maj.svg.
  // szh-revue.ico, szh-zeitschrift.ico et szh-livre.ico restent au dépôt et fabriqués par
  // icone.py — ils servent encore aux fenêtres « Nouveau... » de open-produit.ps1 — mais ce
  // n'est plus ce fichier-ci qui les cherche pour le menu Démarrer.
  const debut = SHELL.indexOf('function Get-SzhRaccourcisMenu');
  const corps = SHELL.slice(debut, SHELL.indexOf('\r\nfunction ', debut + 10));
  const icones = ['pronto.ico', 'pronto-maj.ico'];
  for (const ico of icones) {
    assert.ok(corps.indexOf(ico) !== -1, 'szh-shell.ps1 ne cherche plus ' + ico);
    // Le fichier existe, et icone.py sait le refaire : un .ico déposé à la main ne se
    // régénère pas, et l'écart ne se verrait qu'à la prochaine retouche du dessin.
    assert.ok(fs.existsSync(path.join(RACINE, 'windows', ico)), ico + ' manque au dépôt');
    assert.ok(ICONE_PRONTO_PY.indexOf("'" + ico + "'") !== -1, 'icone-pronto.py ne fabrique plus ' + ico);
  }
  // Deux images distinctes, sinon l'icône ne distingue plus le lanceur de sa mise à jour.
  const empreintes = new Set(icones.map((i) =>
    require('crypto').createHash('sha256').update(fs.readFileSync(path.join(RACINE, 'windows', i))).digest('hex')));
  assert.strictEqual(empreintes.size, 2, 'les deux icônes du menu sont identiques');
  // Le repli quand l'icône manque reste celle de l'éditeur, jamais rien : sans
  // IconLocation le shell montre celle de wscript.exe, qui ne dit rien à personne.
  assert.ok(SHELL.indexOf('elseif ($codium) { $lnk.IconLocation = $codium }') !== -1);
});

test('la barre des tâches reçoit une identité, des deux côtés', () => {
  // Le défaut gardé ici ne change pas : le bouton de la barre des tâches portait l'icône de
  // PowerShell, alors que le raccourci du menu Démarrer et la fenêtre elle-même portaient la
  // bonne. La barre ne regarde pas l'icône de la fenêtre : elle groupe les boutons par
  // AppUserModelID et prend l'image de ce côté-là. Sans identité déclarée, Windows en
  // déduit une de l'exécutable hôte — powershell.exe, lancé par hidden.vbs — et affiche
  // son icône. Il faut les deux moitiés, et ce sont elles que ce contrôle garde.
  //
  // Glissement du 13.09.2026 : il n'y a plus trois identités de lanceur (une par produit)
  // mais UNE SEULE, « suite » — les trois onglets sont une seule fenêtre, pas trois
  // programmes, et Windows tiendrait autrement trois identités pour trois applications.
  // Les deux mises à jour par langue (« maj.fr », « maj.de ») ont pareillement fusionné en
  // une seule, « maj », son raccourci ne portant plus de langue.
  assert.match(SHELL, /\$script:SzhAppIds = @\{/);
  for (const id of ['SZH.Publishing.Suite', 'SZH.Publishing.MiseAJour']) {
    assert.ok(SHELL.indexOf("'" + id + "'") !== -1, 'identité disparue : ' + id);
  }
  assert.match(SHELL, /'suite'\s*=\s*'SZH\.Publishing\.Suite'/);
  assert.match(SHELL, /'maj'\s*=\s*'SZH\.Publishing\.MiseAJour'/);
  // Les cinq anciennes clés n'existent plus : une identité par produit ou par langue de
  // mise à jour n'aurait plus de sens dans ce modèle. Cherchées dans la table elle-même,
  // pas dans tout le fichier -- ses clés reviennent ailleurs (szh-produits.ps1 notamment).
  const iTable = SHELL.indexOf('$script:SzhAppIds = @{');
  const corpsTable = SHELL.slice(iTable, SHELL.indexOf('}', iTable));
  for (const ancien of ["'revue'", "'zeitschrift'", "'livre'", "'maj.fr'", "'maj.de'"]) {
    assert.ok(corpsTable.indexOf(ancien + ' = ') === -1,
      'szh-shell.ps1 garde encore une ancienne clé d’identité dans $SzhAppIds : ' + ancien);
  }

  // Première moitié : le .lnk porte l'identité — c'est elle qui fait retrouver au bouton
  // l'icône du raccourci, et qui fait qu'« Épingler » épingle le lanceur et non
  // powershell.exe. Posée APRÈS $lnk.Save() : WScript.Shell réécrit le fichier entier et
  // effacerait une propriété posée avant lui.
  const save = SHELL.indexOf('$lnk.Save()');
  const pose = SHELL.indexOf('Set-SzhLnkAppId', save);
  assert.ok(save !== -1 && pose !== -1, 'l’identité n’est plus posée sur les raccourcis');
  assert.ok(pose > save, 'posée avant $lnk.Save(), elle serait effacée par la sauvegarde');

  // Seconde moitié : le processus se déclare AVANT sa première fenêtre. Windows lit
  // l'identité quand la fenêtre s'inscrit à la barre et ne la relit jamais ensuite ;
  // déclarée après, elle n'a plus aucun effet. Une seule déclaration, par la clé fixe
  // 'suite' — et non plus table-driven par produit, puisqu'il n'y a plus qu'une fenêtre.
  const decl = OUVRIR_PRODUIT.indexOf('Set-SzhAppUserModelId');
  const fenetre = OUVRIR_PRODUIT.indexOf('New-Object System.Windows.Forms.Form');
  assert.ok(decl !== -1, 'open-produit.ps1 ne déclare plus l’identité de barre des tâches');
  assert.ok(fenetre !== -1, 'open-produit.ps1 ne crée plus la fenêtre du lanceur');
  assert.ok(decl < fenetre, 'identité déclarée après la première fenêtre : trop tard');
  assert.ok(OUVRIR_PRODUIT.indexOf("Get-SzhAppId 'suite'") !== -1,
    'l’identité n’est plus tirée de $SzhAppIds par la clé fixe "suite"');

  // Chaque produit garde sa propre ligne dans la table (onglet, icône, textes...), mais
  // plus de champ appId : une seule fenêtre pour les trois ne peut porter qu'une identité.
  for (const jeton of ['revue', 'zeitschrift', 'livre']) {
    const debutLigne = SHELL_PRODUITS.indexOf(jeton + ' = @{');
    assert.ok(debutLigne !== -1, 'szh-produits.ps1 : ligne de table manquante pour ' + jeton);
  }
  assert.ok(SHELL_PRODUITS.indexOf('appId') === -1,
    'szh-produits.ps1 garde encore un champ appId : il n’a plus de sens depuis la fusion des lanceurs');

  // Les deux enveloppes appellent open-produit.ps1 avec le bon -Produit, et rien d'autre :
  // c'est tout ce qu'il leur reste à faire.
  assert.ok(OUVRIR.indexOf("Join-Path $PSScriptRoot 'open-produit.ps1'") !== -1,
    'open-revue.ps1 ne délègue plus à open-produit.ps1');
  assert.ok(OUVRIR_LIVRE.indexOf("Join-Path $PSScriptRoot 'open-produit.ps1'") !== -1,
    'open-livre.ps1 ne délègue plus à open-produit.ps1');
  assert.ok(OUVRIR_LIVRE.indexOf("-Produit 'livre'") !== -1,
    'open-livre.ps1 ne transmet plus -Produit livre à open-produit.ps1');

  // La fenêtre de mise à jour n'est pas un lanceur, mais elle a son bouton elle aussi — une
  // seule clé fixe désormais, « maj », et non plus une par langue de son ancien raccourci.
  assert.ok(UPDATE.indexOf("Get-SzhAppId 'maj'") !== -1,
    'update.ps1 ne déclare plus son identité par la clé fixe "maj"');
  assert.ok(UPDATE.indexOf('Set-SzhAppUserModelId $idMaj') !== -1,
    'update.ps1 ne déclare plus son identité');
});

// ---- Les textes ----

test('les libellés des raccourcis existent dans les trois langues, en « ss »', () => {
  for (const cle of ['raccourci.maj.nom', 'raccourci.maj.desc',
    'raccourci.revue.desc', 'raccourci.zs.desc', 'raccourci.livre.desc']) {
    const motif = new RegExp("'" + cle.replace(/\./g, '\\.') + "'\\s*=\\s*(.+)", 'g');
    const lignes = TEXTES.match(motif) || [];
    assert.strictEqual(lignes.length, 3, 'il manque une traduction de ' + cle);
    for (const l of lignes) {
      assert.ok(l.indexOf('ß') === -1, 'orthographe suisse (ss) : ' + l);
      assert.ok(l.trim().length > cle.length + 6, 'traduction vide : ' + l);
    }
  }
  // Les trois noms de produit (« Revues SZH », « Zeitschriften SZH », « Books SZH-CSPS »)
  // sont des littéraux de szh-shell.ps1, pas des clés traduites ; les deux noms de mise à
  // jour viennent de szh-textes.ps1 (valeurs de raccourci.maj.nom). Chacun est un nom de
  // fichier .lnk : aucun caractère interdit par Windows.
  for (const nom of NOMS) {
    assert.ok(!/[<>:"/\\|?*]/.test(nom), 'nom de fichier impossible : ' + nom);
    // PowerShell traite l’apostrophe courbe comme un délimiteur de chaîne, au même titre
    // que la droite : dans le source elle est DOUBLÉE. On compare donc les deux formes —
    // sans quoi ce contrôle échouerait sur une chaîne pourtant correcte.
    const doublee = nom.split('’').join('’’');
    assert.ok(SHELL.indexOf(nom) !== -1 || SHELL.indexOf(doublee) !== -1 ||
      TEXTES.indexOf(nom) !== -1 || TEXTES.indexOf(doublee) !== -1,
      'ni szh-shell.ps1 ni szh-textes.ps1 ne portent plus le libellé : ' + nom);
  }
  // Le libellé français, avec son apostrophe doublée comme PowerShell l'exige.
  assert.ok(TEXTES.indexOf("'Mise à jour de l’’outil Revue'") !== -1);
  assert.ok(TEXTES.indexOf("'Aktualisierung des Redaktionstools'") !== -1);
});

test('la mise à jour ne parle plus d’un seul raccourci, ni d’un produit', () => {
  // Le message de fin d'étape annonçait « raccourci « Revues SZH » à jour » — au singulier,
  // et en nommant le produit français jusque dans la phrase allemande, alors qu'il y a
  // quatre entrées et deux équipes.
  const lignes = TEXTES.match(/'maj\.e4\.ok'\s*=\s*(.+)/g) || [];
  assert.strictEqual(lignes.length, 3, 'il manque une traduction de maj.e4.ok');
  for (const l of lignes) {
    assert.ok(l.indexOf('Revues SZH') === -1, 'maj.e4.ok nomme encore un produit : ' + l);
    assert.ok(/raccourcis|Verknüpfungen|shortcuts/.test(l), 'maj.e4.ok reste au singulier : ' + l);
  }
});

// ---- Les trois appelants ----

test('les trois chemins d’installation posent les mêmes raccourcis', () => {
  // Poste neuf (bootstrap), mise à jour (update), et chaque ouverture de session
  // (update-launcher) : sans le troisième, un poste déjà à la dernière version n'obtiendrait
  // jamais une entrée ajoutée après coup, puisque update.ps1 ne s'exécute plus.
  for (const [nom, source] of [['update.ps1', UPDATE], ['update-launcher.ps1', LANCEUR_MAJ],
    ['bootstrap.ps1', BOOTSTRAP]]) {
    const i = source.indexOf('Set-SzhRaccourcisMenu');
    assert.ok(i !== -1, nom + ' ne pose plus les raccourcis du menu Démarrer');
    // Jamais bloquant : l'appel est sous try, et le catch écrit au lieu de relever.
    const avant = source.slice(0, i);
    const dernierTry = avant.lastIndexOf('try {');
    assert.ok(dernierTry !== -1 && avant.indexOf('} catch', dernierTry) === -1,
      nom + ' : l’appel doit être sous try, un menu verrouillé ne doit rien faire échouer');
    const apres = source.slice(i, i + 1400);
    assert.ok(/\} catch \{/.test(apres), nom + ' : pas de catch après l’appel');
    // Et le journal doit le dire : un raccourci absent qui ne se dit pas est introuvable.
    assert.ok(apres.indexOf('$bilanMenu.manques') !== -1,
      nom + ' : les raccourcis non posés ne sont plus journalisés');
  }
  // bootstrap.ps1 pose les raccourcis APRÈS avoir obtenu le toolkit : si la Release est
  // injoignable, le repli hors ligne a déjà copié les scripts, et le poste garde son menu
  // même quand la première mise à jour échoue sur le manifest.
  assert.ok(BOOTSTRAP.indexOf("Impossible d''obtenir le toolkit") <
    BOOTSTRAP.indexOf('Set-SzhRaccourcisMenu'), 'bootstrap pose le menu avant le toolkit');
  // update-launcher.ps1 les pose AVANT de regarder s'il y a du neuf, sinon la sortie
  // anticipée « à jour » sauterait par-dessus.
  assert.ok(LANCEUR_MAJ.indexOf('Set-SzhRaccourcisMenu') <
    LANCEUR_MAJ.indexOf('Get-SzhManifest'), 'la sortie « à jour » sauterait le menu');
});

test('update.ps1 prend la langue de son raccourci, pour cette fenêtre seulement', () => {
  assert.match(UPDATE, /\[string\]\$Langue/);
  const debut = UPDATE.indexOf('. "$PSScriptRoot\\szh-common.ps1"');
  const corps = UPDATE.slice(debut, UPDATE.indexOf("T 'maj.fenetre'"));
  // La langue est appliquée avant le premier texte affiché, sinon le titre de la fenêtre
  // et la bannière sortiraient dans l'autre langue.
  assert.ok(corps.indexOf('$script:SzhLangue = $Langue.ToLower()') !== -1,
    'update.ps1 n’applique plus la langue reçue');
  // Trois valeurs admises, les mêmes que partout ; une valeur inconnue est ignorée plutôt
  // que fatale — c'est un détail d'affichage, pas une raison d'arrêter une mise à jour.
  assert.match(corps, /@\('fr', 'de', 'en'\) -contains \$Langue\.ToLower\(\)/);
  // $env:SZH_LANGUE garde le dernier mot, comme dans szh-common et Set-SzhLangueProduit.
  assert.ok(corps.indexOf('$envLangue') !== -1 && corps.indexOf('-not $envLangue') !== -1,
    'la variable d’environnement doit garder le dernier mot');
  // Et la préférence du poste n'est pas réécrite : la mise à jour n'est pas un produit et
  // n'a pas à choisir la langue des lanceurs.
  assert.ok(corps.indexOf('Save-SzhState') === -1,
    'update.ps1 ne doit pas écrire la préférence de langue du poste');
  assert.ok(corps.indexOf('Set-SzhLangueProduit') === -1);
});

// ---- La fonction, réellement exécutée ----
// Rien n'est écrit dans le vrai menu Démarrer — $Menu pointe sur un dossier de travail.

// Un seul passage de PowerShell pour les quatre situations : le démarrage du socle coûte
// plus cher que tout le reste.
const PILOTE = [
  "$ErrorActionPreference = 'Stop'",
  '. "' + COMMUN_PS1 + '"',
  '$menu = $args[0]; $toolkit = $args[1]; $sortie = $args[2]',
  '$sh = New-Object -ComObject WScript.Shell',
  'New-Item -ItemType Directory -Force -Path $menu | Out-Null',
  // Un raccourci d'une version antérieure, mal nommé ; un raccourci étranger ; et le
  // sous-dossier « SZH » d'un autre produit, auquel rien ne doit toucher.
  "$a = $sh.CreateShortcut((Join-Path $menu 'Mise a jour Revue SZH.lnk'))",
  '$a.TargetPath = (Join-Path $env:WINDIR \'System32\\wscript.exe\')',
  "$a.Arguments = ('//B \"{0}\" \"{1}\"' -f (Join-Path $toolkit 'windows\\hidden.vbs'), (Join-Path $toolkit 'windows\\update.ps1'))",
  '$a.Save()',
  "$b = $sh.CreateShortcut((Join-Path $menu 'Bloc-notes.lnk'))",
  '$b.TargetPath = (Join-Path $env:WINDIR \'System32\\notepad.exe\'); $b.Save()',
  "New-Item -ItemType Directory -Force -Path (Join-Path $menu 'SZH') | Out-Null",
  "$c = $sh.CreateShortcut((Join-Path $menu 'SZH\\SZH Updater.lnk'))",
  '$c.TargetPath = (Join-Path $env:LOCALAPPDATA \'SZH\\AppUpdater\\SZH-AppUpdater.exe\'); $c.Save()',
  '$r = [ordered]@{}',
  // 1. la pose
  '$p1 = Set-SzhRaccourcisMenu -Menu $menu -Toolkit $toolkit',
  '$r.poses = @($p1.poses); $r.retires = @($p1.retires); $r.manques = @($p1.manques)',
  '$r.lnk = @(Get-ChildItem -LiteralPath $menu -Filter \'*.lnk\' | Sort-Object Name | ForEach-Object {',
  '  $l = $sh.CreateShortcut($_.FullName)',
  '  [ordered]@{ nom = $_.Name; cible = $l.TargetPath; args = $l.Arguments; desc = $l.Description; icone = $l.IconLocation',
  '    fenetre = [int]$l.WindowStyle; appid = [string](Get-SzhLnkAppId $_.FullName) } })',
  "$r.sousDossier = @(Get-ChildItem -LiteralPath (Join-Path $menu 'SZH') -Filter '*.lnk' | ForEach-Object { $_.Name })",
  // 2. deux fois de suite ne doit rien doubler
  '$p2 = Set-SzhRaccourcisMenu -Menu $menu -Toolkit $toolkit',
  '$r.passe2 = [ordered]@{ poses = @($p2.poses).Count; retires = @($p2.retires).Count; manques = @($p2.manques).Count',
  '  fichiers = @(Get-ChildItem -LiteralPath $menu -Filter \'*.lnk\').Count }',
  // 3. un menu que le poste refuse d'écrire (ce que fait une stratégie de groupe)
  "$verrou = Join-Path (Split-Path $menu -Parent) 'menu-verrouille'",
  'New-Item -ItemType Directory -Force -Path $verrou | Out-Null',
  "Invoke-SzhNatif { & icacls $verrou /inheritance:r /grant ($env:USERNAME + ':(RX)') 2>$null | Out-Null }",
  // Un compte administrateur (le runner de CI, entre autres) passe outre cette ACL : mesuré
  // en tentant d'écrire un fichier témoin juste après avoir posé la restriction, plutôt que
  // supposé -- si l'écriture passe, la garde de groupe ne bloque plus rien ici, et le
  // contrôle qui suit ne mesurerait rien de réel.
  '$aclContournee = $false',
  'try {',
  '  Set-Content -Path (Join-Path $verrou "temoin-acl.txt") -Value "x" -ErrorAction Stop',
  '  $aclContournee = $true',
  '  Remove-Item -LiteralPath (Join-Path $verrou "temoin-acl.txt") -Force -ErrorAction SilentlyContinue',
  '} catch { }',
  '$p3 = Set-SzhRaccourcisMenu -Menu $verrou -Toolkit $toolkit',
  '$r.verrou = [ordered]@{ poses = @($p3.poses).Count; manques = @($p3.manques)',
  '  fichiers = @(Get-ChildItem -LiteralPath $verrou -Filter \'*.lnk\' -ErrorAction SilentlyContinue).Count',
  '  aclContournee = $aclContournee }',
  "Invoke-SzhNatif { & icacls $verrou /reset 2>$null | Out-Null }",
  "Invoke-SzhNatif { & icacls $verrou /grant ($env:USERNAME + ':(F)') 2>$null | Out-Null }",
  // 4. un toolkit incomplet : pas de raccourci mort vers un script absent
  "$partiel = Join-Path (Split-Path $menu -Parent) 'toolkit-partiel'",
  "New-Item -ItemType Directory -Force -Path (Join-Path $partiel 'windows') | Out-Null",
  "foreach ($f in 'open-revue.ps1', 'hidden.vbs') { Copy-Item (Join-Path $toolkit ('windows\\' + $f)) (Join-Path $partiel 'windows') -Force }",
  "$menu4 = Join-Path (Split-Path $menu -Parent) 'Programs-partiel'",
  '$p4 = Set-SzhRaccourcisMenu -Menu $menu4 -Toolkit $partiel',
  '$r.partiel = [ordered]@{ poses = @($p4.poses); manques = @($p4.manques)',
  '  fichiers = @(Get-ChildItem -LiteralPath $menu4 -Filter \'*.lnk\' | ForEach-Object { $_.Name }) }',
  'Set-SzhJson $sortie $r'
].join('\r\n') + '\r\n';

const bilan = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-raccourcis-'));
  const pilote = path.join(travail, 'poser.ps1');
  const sortie = path.join(travail, 'bilan.json');
  fs.writeFileSync(pilote, PILOTE, 'utf8');
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote,
    path.join(travail, 'Programs'), RACINE, sortie],
  { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  const restes = { travail, status: run.status, stderr: run.stderr || '' };
  fs.rmSync(travail, { recursive: true, force: true });
  return Object.assign({}, restes, { r: lu });
})();

test('le menu reçoit les DEUX entrées, résolues comme le shell les lit', { skip: sansPowerShell }, () => {
  // Glissement du 13.09.2026 : il n'y a plus cinq entrées (trois lanceurs de produit, deux
  // mises à jour) mais deux — le lanceur unique à onglets, et sa mise à jour. Le défaut
  // gardé ne change pas : chaque entrée voulue doit se poser, avec la bonne cible, la bonne
  // icône et sa propre identité de barre des tâches.
  assert.strictEqual(bilan.status, 0, 'le pilote PowerShell a échoué : ' + bilan.stderr);
  const r = bilan.r;
  assert.deepStrictEqual(r.manques, [], 'un raccourci n’a pas pu être posé');
  assert.deepStrictEqual(r.poses.slice().sort(), NOMS_ACTUELS.slice().sort());
  const par = {};
  for (const l of r.lnk) { par[l.nom] = l; }

  // Le lanceur : caché, sans -Produit (l'onglet ouvert vient du réglage du compte, pas du
  // raccourci — Get-SzhOngletDefaut, szh-produits.ps1).
  const lanceur = par[NOM_APPLICATION + '.lnk'];
  assert.ok(lanceur, NOM_APPLICATION + ' manque au menu');
  assert.match(lanceur.cible, /wscript\.exe$/i);
  assert.ok(lanceur.args.indexOf('hidden.vbs') !== -1, 'le lanceur doit rester sans console');
  assert.ok(lanceur.args.indexOf('-Produit') === -1,
    'le lanceur reçoit encore -Produit : l’onglet ouvert ne devrait plus dépendre du raccourci');
  assert.ok(lanceur.icone.indexOf('pronto.ico') !== -1, 'icône ' + lanceur.icone);
  assert.ok(lanceur.desc.length > 8, 'description vide');
  assert.strictEqual(lanceur.appid, 'SZH.Publishing.Suite', 'identité de barre des tâches');

  // La mise à jour : powershell.exe en direct, fenêtre normale, plus de langue portée par
  // le raccourci (la fenêtre suit le réglage du compte, comme le lanceur).
  const maj = par[NOM_MISE_A_JOUR + '.lnk'];
  assert.ok(maj, NOM_MISE_A_JOUR + ' manque au menu');
  assert.match(maj.cible, /WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
  assert.ok(maj.args.indexOf('hidden.vbs') === -1, 'une mise à jour doit se voir');
  assert.ok(maj.args.indexOf('-Langue') === -1,
    'la mise à jour reçoit encore -Langue par son raccourci');
  assert.ok(maj.args.indexOf('update.ps1"') !== -1, maj.args);
  assert.strictEqual(maj.fenetre, 1, 'la fenêtre doit être normale');
  assert.ok(maj.icone.indexOf('pronto-maj.ico') !== -1, 'icône ' + maj.icone);
  assert.strictEqual(maj.appid, 'SZH.Publishing.MiseAJour', 'identité');
  assert.ok(maj.desc.length > 8, 'description vide');

  // Le défaut qui a coûté une entrée de menu, en 2026 : Windows tient l'AppUserModelID pour
  // l'identité de l'application et n'affiche qu'une entrée par identité.
  const identites = r.lnk.map((l) => l.appid);
  assert.strictEqual(new Set(identites).size, identites.length,
    'deux entrées du menu partagent une identité : ' + identites.join(', '));
  assert.notStrictEqual(lanceur.desc, maj.desc, 'les deux entrées ont la même description');
});

test('un ancien raccourci mal nommé est retiré, pas doublé', { skip: sansPowerShell }, () => {
  const r = bilan.r;
  assert.deepStrictEqual(r.retires, ['Mise a jour Revue SZH.lnk']);
  const noms = r.lnk.map((l) => l.nom);
  assert.ok(noms.indexOf('Mise a jour Revue SZH.lnk') === -1, 'l’ancien raccourci survit');
  // Ce qui n'est pas à nous n'est pas touché : ni un raccourci étranger du premier niveau,
  // ni le sous-dossier « SZH », qui appartient à l'AppLauncher interne.
  assert.ok(noms.indexOf('Bloc-notes.lnk') !== -1, 'un raccourci étranger a été supprimé');
  assert.deepStrictEqual(r.sousDossier, ['SZH Updater.lnk'],
    'le sous-dossier « SZH » d’un autre produit a été touché');
  // Glissement du 13.09.2026 : DEUX entrées désormais, plus l'étranger -- trois fichiers,
  // pas six.
  assert.strictEqual(r.lnk.length, 3, 'le menu porte les deux entrées plus l’étranger');
  // Deux passes de suite : rien de doublé, rien de retiré une seconde fois.
  assert.strictEqual(r.passe2.poses, 2);
  assert.strictEqual(r.passe2.retires, 0);
  assert.strictEqual(r.passe2.manques, 0);
  assert.strictEqual(r.passe2.fichiers, 3);
});

// Set-SzhRaccourcisMenu (ci-dessus) reconnaît un ancien raccourci à sa CIBLE, jamais à son
// nom -- elle n'a donc besoin d'aucune liste de noms périmés. La désinstallation, elle, en a
// besoin : un poste dont le toolkit a déjà été retiré ne peut plus ouvrir un .lnk pour lire
// où il pointe, il ne lui reste que le nom (voir test/js/desinstallation.test.js, qui
// éprouve la seconde moitié du contrat : un nom périmé n'entre dans le plan que si le
// fichier existe réellement).
test('Get-SzhRaccourcisObsoletes nomme les huit entrées périmées : trois produits, trois langues de mise à jour, deux anciens noms d\'application',
  { skip: sansPowerShell }, () => {
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-obsoletes-'));
    const sortie = path.join(travail, 'bilan.json');
    const pilote = path.join(travail, 'lire.ps1');
    fs.writeFileSync(pilote, [
      "$ErrorActionPreference = 'Stop'",
      '. "' + COMMUN_PS1 + '"',
      '$r = [ordered]@{',
      '  obsoletes = @(Get-SzhRaccourcisObsoletes)',
      '  majFr     = [string]$SzhTextes[\'fr\'][\'raccourci.maj.nom\']',
      '  majDe     = [string]$SzhTextes[\'de\'][\'raccourci.maj.nom\']',
      '  majEn     = [string]$SzhTextes[\'en\'][\'raccourci.maj.nom\']',
      '}',
      'Set-SzhJson $args[0] $r'
    ].join('\r\n') + '\r\n', 'utf8');
    const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote, sortie],
      { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    assert.strictEqual(run.status, 0, 'pilote : ' + (run.stderr || ''));
    const r = JSON.parse(fs.readFileSync(sortie, 'utf8'));
    fs.rmSync(travail, { recursive: true, force: true });
    // Les trois noms de produit, en dur -- disparus avec la fusion des lanceurs -- puis les
    // trois traductions de « raccourci.maj.nom » (fr, de, ET en : un poste dont Windows
    // résolvait « en » avant qu'un compte n'y touche a pu recevoir cette troisième version), et
    // enfin les deux anciens noms de l'application avant le renommage en « Pronto ».
    const attendus = ['Revues SZH', 'Zeitschriften SZH', 'Books SZH-CSPS', r.majFr, r.majDe, r.majEn, 'Revue & Zeitschrift', 'Revue & Zeitschrift (Updater)'];
    assert.strictEqual(r.obsoletes.length, 8, 'Get-SzhRaccourcisObsoletes doit nommer les huit anciens noms');
    assert.deepStrictEqual(r.obsoletes.slice().sort(), attendus.slice().sort());
    // Aucune des deux entrées ACTUELLES ne doit s’y glisser : la désinstallation compterait
    // sinon le lanceur ou sa mise à jour, bien réels, parmi ce qui n’existe plus.
    for (const actuel of NOMS_ACTUELS) {
      assert.ok(r.obsoletes.indexOf(actuel) === -1, actuel + ' ne devrait pas être dans les entrées périmées');
    }
  });

test('un menu Démarrer non inscriptible n’arrête rien, et le dit', { skip: sansPowerShell }, (t) => {
  const v = bilan.r.verrou;
  // Un compte administrateur (le runner de CI, par exemple) passe outre la restriction
  // d'ACL posée par le pilote : la garde de groupe ne bloque alors plus rien, et ce
  // contrôle ne mesurerait rien de réel puisque le menu resterait inscriptible malgré
  // l'ACL. Le pilote a tenté d'écrire un fichier témoin juste après avoir posé cette
  // ACL (voir PILOTE plus haut) ; si l'écriture est passée, on saute plutôt que de
  // prétendre observer un blocage qui n'a pas eu lieu -- même patron que pandocAbsent()
  // / t.skip() dans test/js/ancrages.test.js.
  if (v.aclContournee) { t.skip('processus élevé : l’ACL ne bloque pas'); return; }
  // Le contrat : la fonction ne lève pas — le pilote entier serait tombé sinon.
  assert.strictEqual(bilan.status, 0);
  assert.strictEqual(v.poses, 0);
  assert.strictEqual(v.fichiers, 0);
  // Glissement du 13.09.2026 : deux entrées manquantes (au lieu de cinq) plus la ligne
  // d'ensemble -- au moins trois lignes, pas six.
  assert.ok(v.manques.length >= 3, 'chaque entrée manquante doit être nommée');
  for (const nom of NOMS_ACTUELS) {
    assert.ok(v.manques.some((m) => m.indexOf(nom) === 0), 'rien n’est dit de : ' + nom);
  }
  // Et une ligne d'ensemble qui dit la cause probable et par où passer en attendant :
  // un journal qui ne nomme que l'échec laisse le rédacteur sans porte de sortie.
  const ensemble = v.manques.filter((m) => m.indexOf('stratégie de groupe') !== -1);
  assert.strictEqual(ensemble.length, 1, 'il faut une ligne d’ensemble, et une seule');
  assert.match(ensemble[0], /Changer de version/);
  assert.match(ensemble[0], /Rien d'autre n'est affecté/);
});

test('un toolkit incomplet ne laisse pas de raccourci mort', { skip: sansPowerShell }, () => {
  // Le raccourci pointe dans le toolkit ; si le script visé n'y est pas, un .lnk ne ferait
  // que clignoter. On ne le pose pas, on le dit, et le reste est posé quand même. Glissement
  // du 13.09.2026 : Get-SzhRaccourcisMenu ne connaît plus que deux pilotes, open-revue.ps1
  // (le lanceur) et update.ps1 (la mise à jour) -- open-livre.ps1 n'est plus un pilote de
  // raccourci pour lui-même, le livre n'étant qu'un onglet du même lanceur. Ce toolkit
  // partiel a open-revue.ps1 et hidden.vbs, mais pas update.ps1 : un seul manque, celui du
  // lanceur.
  const p = bilan.r.partiel;
  assert.deepStrictEqual(p.poses.slice().sort(), [NOM_APPLICATION]);
  assert.deepStrictEqual(p.fichiers.slice().sort(), [NOM_APPLICATION + '.lnk']);
  assert.strictEqual(p.manques.length, 1);
  for (const m of p.manques) {
    assert.match(m, /update\.ps1 manque au toolkit/);
    // Et la suite : ce qui va le réparer, sans que personne n'ait à s'en occuper.
    assert.match(m, /tâche planifiée/);
  }
});

// ---- La MIGRATION : un poste en service porte encore les cinq anciennes entrées ----
//
// C'est le test qui prouve qu'un poste déjà en service se met à jour tout seul, sans le
// moindre geste du rédacteur : les cinq .lnk d'avant le 13.09.2026 (trois lanceurs, deux
// mises à jour) sont posés à la main sur un menu Démarrer jetable, ciblant réellement les
// scripts qu'ils visaient alors (open-revue.ps1, open-livre.ps1, update.ps1) -- c'est cette
// cible, et non le nom du fichier, que Set-SzhRaccourcisMenu reconnaît (voir le test
// « un ancien raccourci mal nommé... » plus haut, qui n'en pose qu'UN des cinq). Une seule
// passe doit les retirer tous les cinq et ne laisser que les deux entrées actuelles.
test('la migration : un menu à cinq anciennes entrées n’en garde plus que deux, et le dit',
  { skip: sansPowerShell }, () => {
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-migration-'));
    const menu = path.join(travail, 'Programs');
    const sortie = path.join(travail, 'bilan.json');
    const pilote = path.join(travail, 'migrer.ps1');
    fs.writeFileSync(pilote, [
      "$ErrorActionPreference = 'Stop'",
      '. "' + COMMUN_PS1 + '"',
      '$menu = $args[0]; $toolkit = $args[1]; $sortie = $args[2]',
      'New-Item -ItemType Directory -Force -Path $menu | Out-Null',
      '$sh = New-Object -ComObject WScript.Shell',
      '$vbs = Join-Path $toolkit "windows\\hidden.vbs"',
      '$wscript = Join-Path $env:WINDIR "System32\\wscript.exe"',
      '$ps = Join-Path $env:WINDIR "System32\\WindowsPowerShell\\v1.0\\powershell.exe"',
      // Les trois anciens lanceurs : wscript.exe //B hidden.vbs <script>, comme au temps où
      // chaque produit avait le sien.
      "foreach ($e in @(" +
        "@{ nom = 'Revues SZH'; script = 'open-revue.ps1'; args = '' }, " +
        "@{ nom = 'Zeitschriften SZH'; script = 'open-revue.ps1'; args = ' \"-Produit\" \"zeitschrift\"' }, " +
        "@{ nom = 'Books SZH-CSPS'; script = 'open-livre.ps1'; args = '' }" +
        ")) {",
      '  $l = $sh.CreateShortcut((Join-Path $menu ($e.nom + ".lnk")))',
      '  $l.TargetPath = $wscript',
      '  $cible = Join-Path $toolkit ("windows\\" + $e.script)',
      '  $l.Arguments = (\'//B "{0}" "{1}"\' -f $vbs, $cible) + $e.args',
      '  $l.Save()',
      '}',
      // Les deux anciennes mises à jour : powershell.exe en direct, une par langue.
      "foreach ($e in @(" +
        "@{ nom = 'Mise a jour Revue SZH'; langue = 'fr' }, " +
        "@{ nom = 'Update Redaktionstool SZH'; langue = 'de' }" +
        ")) {",
      '  $l = $sh.CreateShortcut((Join-Path $menu ($e.nom + ".lnk")))',
      '  $l.TargetPath = $ps',
      '  $cible = Join-Path $toolkit "windows\\update.ps1"',
      '  $l.Arguments = (\'-NoProfile -ExecutionPolicy Bypass -File "{0}" -Langue {1}\' -f $cible, $e.langue)',
      '  $l.Save()',
      '}',
      '$avant = @(Get-ChildItem -LiteralPath $menu -Filter \'*.lnk\').Count',
      '$bilan = Set-SzhRaccourcisMenu -Menu $menu -Toolkit $toolkit',
      '$apres = @(Get-ChildItem -LiteralPath $menu -Filter \'*.lnk\' | ForEach-Object { $_.Name })',
      '$r = [ordered]@{ avant = $avant; retires = @($bilan.retires); poses = @($bilan.poses)',
      '  manques = @($bilan.manques); apres = @($apres) }',
      'Set-SzhJson $sortie $r'
    ].join('\r\n') + '\r\n', 'utf8');
    const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote,
      menu, RACINE, sortie], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    assert.strictEqual(run.status, 0, 'le pilote de migration a échoué : ' + (run.stderr || ''));
    const r = JSON.parse(fs.readFileSync(sortie, 'utf8'));
    fs.rmSync(travail, { recursive: true, force: true });

    assert.strictEqual(r.avant, 5, 'le pilote n’a pas posé les cinq anciennes entrées');
    // Les cinq retraits, un par ancien .lnk -- reconnus à leur CIBLE (open-revue.ps1,
    // open-livre.ps1, update.ps1), jamais à leur nom.
    assert.strictEqual(r.retires.length, 5, 'Set-SzhRaccourcisMenu ne retire plus les cinq anciennes entrées');
    assert.deepStrictEqual(r.retires.slice().sort(), [
      'Books SZH-CSPS.lnk', 'Mise a jour Revue SZH.lnk', 'Revues SZH.lnk',
      'Update Redaktionstool SZH.lnk', 'Zeitschriften SZH.lnk'
    ]);
    // Les deux entrées actuelles, posées à la même passe.
    assert.deepStrictEqual(r.poses.slice().sort(), NOMS_ACTUELS.slice().sort());
    assert.deepStrictEqual(r.manques, []);
    // Et il ne reste plus QUE ces deux fichiers sur le disque : c'est le test qui prouve
    // qu'un poste en service se met à jour sans intervention, pas seulement que le bilan le
    // dit.
    assert.deepStrictEqual(r.apres.slice().sort(), (NOMS_ACTUELS.map((n) => n + '.lnk')).sort());
    assert.strictEqual(r.apres.length, 2, 'le menu ne porte plus exactement deux entrées');
  });
