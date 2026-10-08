// lib/codes-erreur.js : la table des codes d'erreur et les fonctions pures du schéma v1 des
// rapports automatiques (voir docs/RAPPORTS-ERREUR.md).
//
//   node --test test/js/codes-erreur.test.js
//
// Pièges vérifiés :
//  1. L'id du rapport se fonde sur l'heure UTC de `horodatage`, pas sur l'heure locale de
//     `horodatageLocal` (« 081530 » dans l'id pour « 10:15:30 » en heure d'été). L'heure
//     locale casserait le tri alphabétique, qui est chronologique, au changement d'heure.
//  2. L'ordre des règles de masquage compte : les racines connues (ancrage, %USERPROFILE%,
//     ProgramData) sont retirées avant les règles génériques, sinon un chemin encore absolu,
//     donc long, serait masqué avant de devenir un chemin relatif lisible. L'ancrage passe
//     avant %USERPROFILE%, sous lequel il est presque toujours : l'ordre inverse donnerait
//     « ~\… » au lieu du chemin relatif à l'ancrage.
//  3. Le masquage garde ce qui sert au diagnostic (chemin relatif, URL, empreinte SHA-256)
//     et retire les secrets. Règle 5a : secret nu de 32 caractères ou plus, sans `/`, casse
//     et chiffres mélangés, jamais purement hexadécimal. Règle 5b : un JWT complet en un
//     seul passage, ses segments étant souvent trop courts pour 5a.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const codes = require(path.join(
  '..', '..', 'vscodium-extension', 'szh-cockpit', 'lib', 'codes-erreur'));

// ---------------------------------------------------------------------------------------
// La table des codes
// ---------------------------------------------------------------------------------------

const CODES_ATTENDUS = [
  'LANCEUR-TRAP', 'LANCEUR-CODIUM-ABSENT', 'ANCRAGE-INTROUVABLE', 'MAJ-ETAPE-ECHEC',
  'MAJ-ECHEC', 'ARCHIVAGE-ECHEC', 'COMPIL-ECHEC', 'COCKPIT-EXCEPTION', 'RAPPORT-ECHEC-ECRITURE',
  'LANCEUR-SIGNALEMENT', 'NETTOYEUR-ECHEC', 'COCKPIT-SIGNALEMENT', 'ACCUEIL-COCKPIT-ABSENT'
];

test('CODES : les codes gelés sont présents, chacun avec un résumé FR et DE non vide', () => {
  assert.deepStrictEqual(Object.keys(codes.CODES).sort(), CODES_ATTENDUS.slice().sort());
  for (const code of CODES_ATTENDUS) {
    const entree = codes.CODES[code];
    assert.ok(entree, 'code absent de la table : ' + code);
    assert.ok(/^[A-Z]+(-[A-Z]+)*$/.test(code), 'code hors convention MAJUSCULES-ET-TIRETS : ' + code);
    assert.strictEqual(typeof entree.resume.fr, 'string');
    assert.ok(entree.resume.fr.length > 0, code + ' : résumé français vide');
    assert.strictEqual(typeof entree.resume.de, 'string');
    assert.ok(entree.resume.de.length > 0, code + ' : résumé allemand vide');
  }
});

// Un code inconnu de l'une des deux tables est refusé par Test-SzhRapportValide :
// Write-SzhRapport n'écrit alors rien, ni sur le disque ni dans la file d'attente, sans
// erreur visible. Le test lit les scripts sans lancer PowerShell.
test('tout code cité par un script de windows/ est connu des DEUX tables', () => {
  const dossier = path.join(__dirname, '..', '..', 'windows');
  const cites = new Set();
  for (const f of fs.readdirSync(dossier).filter((n) => n.endsWith('.ps1'))) {
    const src = fs.readFileSync(path.join(dossier, f), 'utf8');
    for (const m of src.matchAll(/-Code\s+'([A-Z][A-Z-]*)'/g)) { cites.add(m[1]); }
  }
  assert.ok(cites.size > 0, 'aucun -Code trouvé dans windows/*.ps1 : la recherche ne mord plus');

  const rapport = fs.readFileSync(path.join(dossier, 'szh-rapport.ps1'), 'utf8');
  const depuis = rapport.slice(rapport.indexOf('function Get-SzhRapportCodesConnus'));
  const corps = depuis.slice(0, depuis.indexOf('\n}'));
  const connusPs = new Set([...corps.matchAll(/'([A-Z][A-Z-]*)'/g)].map((m) => m[1]));
  assert.ok(connusPs.size > 0, 'Get-SzhRapportCodesConnus ne se lit plus : la découpe a changé');

  for (const code of [...cites].sort()) {
    assert.ok(connusPs.has(code),
      code + ' : cité par un script du poste, absent de Get-SzhRapportCodesConnus '
      + '(szh-rapport.ps1) — le rapport serait refusé sans rien écrire');
    assert.ok(codes.CODES[code],
      code + ' : cité par un script du poste, absent de CODES (lib/codes-erreur.js)');
  }
});

// Le cockpit écrit des codes qu'aucun script du poste ne cite (COMPIL-ECHEC, COCKPIT-…) :
// l'écrivain PowerShell les relit pourtant quand il vide la file d'attente.
test('CODES et szh-rapport.ps1 connaissent les mêmes codes, résumés compris', () => {
  const rapport = fs.readFileSync(path.join(__dirname, '..', '..', 'windows', 'szh-rapport.ps1'), 'utf8');
  const corpsDe = (nom) => {
    const depuis = rapport.slice(rapport.indexOf('function ' + nom));
    return depuis.slice(0, depuis.indexOf('\n}'));
  };
  const connus = [...corpsDe('Get-SzhRapportCodesConnus').matchAll(/'([A-Z][A-Z-]*)'/g)].map((m) => m[1]);
  const resumes = [...corpsDe('Get-SzhRapportResume').matchAll(/^\s*'([A-Z][A-Z-]*)' = @\{/gm)].map((m) => m[1]);
  assert.deepStrictEqual(connus.slice().sort(), CODES_ATTENDUS.slice().sort());
  assert.deepStrictEqual(resumes.slice().sort(), CODES_ATTENDUS.slice().sort());
});

test('CODES et les tables gelées sont bien figées (Object.freeze)', () => {
  assert.throws(() => { codes.CODES['NOUVEAU-CODE'] = { resume: { fr: 'x', de: 'x' } }; }, TypeError);
  assert.throws(() => { codes.GRAVITES.push('autre'); }, TypeError);
});

// ---------------------------------------------------------------------------------------
// Masquage : chaque règle isolée, puis combinées
// ---------------------------------------------------------------------------------------

const ANCRAGE = 'C:\\Users\\robin\\SZH CSPS\\Daten_Allgemein - General';
const USERPROFILE = 'C:\\Users\\robin';

test('masquage, règle 1 : un chemin sous l’ancrage devient relatif à l’ancrage', () => {
  const texte = 'échec sur ' + ANCRAGE + '\\2_Produkte\\52_Revue\\x.md';
  const sortie = codes.masquer(texte, { ancrage: ANCRAGE });
  assert.strictEqual(sortie, 'échec sur 2_Produkte\\52_Revue\\x.md');
});

test('masquage, règle 2 : un chemin sous %USERPROFILE% devient ~\\…', () => {
  const texte = 'voir ' + USERPROFILE + '\\Bureau\\notes.txt';
  const sortie = codes.masquer(texte, { userProfile: USERPROFILE });
  assert.strictEqual(sortie, 'voir ~\\Bureau\\notes.txt');
});

test('masquage, règle 3 : un chemin sous ProgramData\\SZH devient relatif (défaut du module)', () => {
  const texte = 'journal : C:\\ProgramData\\SZH\\logs\\szh-2026-09.log';
  const sortie = codes.masquer(texte, {});
  assert.strictEqual(sortie, 'journal : logs\\szh-2026-09.log');
});

test('masquage, ordre 1 avant 2 : l’ancrage (imbriqué sous %USERPROFILE%) l’emporte', () => {
  const texte = ANCRAGE + '\\2_Produkte\\52_Revue\\x.md';
  const sortie = codes.masquer(texte, { ancrage: ANCRAGE, userProfile: USERPROFILE });
  assert.strictEqual(sortie, '2_Produkte\\52_Revue\\x.md',
    'l’ancrage doit gagner : l’ordre inverse aurait donné un chemin en ~\\…, moins parlant');
});

test('masquage, règle 4 : un mot-clé de secret masque la valeur qui le suit, garde le mot-clé', () => {
  assert.strictEqual(
    codes.masquer('Échec : token: eyJhbGciOiJIUzI1NiJ9.test.sig', {}),
    'Échec : token: ***');
  assert.strictEqual(
    codes.masquer('mot de passe: Sup3rSecret!', {}),
    'mot de passe: ***');
  assert.strictEqual(
    codes.masquer('API_KEY=abcDEF123456', {}),
    'API_KEY=***');
});

test('masquage, règle 5a : une suite nue de 32 caractères ou plus, à casse et chiffres mélangés, est masquée', () => {
  const jeton = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6';
  assert.strictEqual(jeton.length >= 32, true, 'le jeton de test doit atteindre le seuil');
  const sortie = codes.masquer('clé nue : ' + jeton + ' fin.', {});
  assert.strictEqual(sortie, 'clé nue : *** fin.');
});

test('masquage, règle 5a : une suite de 31 caractères ou moins n’est pas masquée (seuil exact)', () => {
  const jeton31 = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p';
  assert.strictEqual(jeton31.length, 31);
  assert.strictEqual(codes.masquer('valeur ' + jeton31 + ' fin', {}), 'valeur ' + jeton31 + ' fin');
});

test('masquage, règle 5a : ni un chemin (présence de `/`), ni une empreinte, ni un GUID mixte ne sont masqués', () => {
  // La classe de caractères de 5a exclut `/` : même long, un chemin n'est pas candidat.
  // Le `/` suffit à couper, quelle que soit la casse de part et d'autre (les slugs du dépôt
  // sont en minuscules, voir lib/slug.js).
  const cheminLong = 'articles/07-ressources-documentaires-2027/image-01.png';
  assert.strictEqual(codes.masquer(cheminLong, {}), cheminLong);
  // Empreinte SHA-256, purement hexadécimale : pas masquée.
  const empreinte = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  assert.strictEqual(codes.masquer(empreinte, {}), empreinte);
  // GUID à casse mélangée : hexadécimal + tirets seulement -> protégé au même titre.
  const guid = '550e8400-E29B-41d4-a716-446655440000';
  assert.strictEqual(codes.masquer(guid, {}), guid);
});

// Limite connue et acceptée : un segment de chemin isolé (sans `/`) qui mélange casse et
// chiffres sur 32 caractères ou plus est candidat pour 5a et masqué. Les slugs du dépôt
// sont en minuscules (lib/slug.js), mais un chemin extérieur peut contenir un tel segment
// (bibliothèque Node, dossier personnel Windows).
test('masquage : limite connue — un segment de chemin isolé en casse mixte peut être masqué à tort', () => {
  const chemin = 'C:\\Users\\robin\\Documents\\MonDossierPersonnel2027Sauvegarde\\notes.txt';
  const sortie = codes.masquer(chemin, {});
  assert.notStrictEqual(sortie, chemin,
    'si ce test casse, 5a ne mord plus sur ce cas : tant mieux, mais vérifier pourquoi avant de le retirer');
});

test('masquage, règle 5b : un JWT complet (en-tête, charge utile, signature) disparaît en un bloc', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SIGNATURE12345';
  const sortie = codes.masquer('Authorization: Bearer ' + jwt, {});
  // La règle 4 seule ne masque que le mot « Bearer » (son \S+ s'arrête à l'espace avant le
  // jeton), et des segments courts, comme la charge utile décodable en base64
  // (`{"sub":"1234567890"}`), échapperaient à 5a. Aucune trace du jeton ne doit rester.
  assert.strictEqual(sortie.indexOf('eyJ'), -1, 'un fragment du JWT survit : ' + sortie);
  assert.strictEqual(sortie.indexOf('sub'), -1, 'la charge utile décodée transparaît : ' + sortie);
  assert.strictEqual(sortie.indexOf('SIGNATURE12345'), -1);
});

test('masquage, règle 5b : un JWT nu (sans mot-clé devant) est aussi masqué', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcSIG';
  assert.strictEqual(codes.masquer('reçu : ' + jwt + ' dans l’en-tête', {}),
    'reçu : *** dans l’en-tête');
});

test('masquage, règle 4 : la phrase qui suit un mot-clé absent reste lisible', () => {
  // La règle 4 ne masque que le jeton qui suit le mot-clé, pas la fin de la ligne.
  assert.strictEqual(
    codes.masquer('token: absent — configuration OJS non remplie', {}),
    'token: *** — configuration OJS non remplie');
});

test('masquage : les cinq lignes réelles de l’amendement du 09.09.2026 survivent intactes', () => {
  // Lignes réelles de la chaîne (voir docs/RAPPORTS-ERREUR.md) : une règle dont la classe
  // contiendrait `/` les réduirait à « ***.<extension> », et le diagnostic serait perdu.
  const lignes = [
    '2_Produkte/52_Revue/RV02_Redaction/2027-02/articles/03-inclusion/03-inclusion.md',
    'make: *** [Makefile:142: out/2027-02/articles/03-inclusion-scolaire.pdf] Error 1',
    'WeasyPrint: figure sans alt dans articles/07-ressources-documentaires/image-01.png',
    'https://www.szh-csps.ch/revue/2027-02/inclusion-scolaire-participation-sociale',
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  ];
  for (const ligne of lignes) {
    assert.strictEqual(codes.masquer(ligne, {}), ligne, 'altérée à tort : ' + ligne);
  }
});

test('masquage : un slug d’article seul (minuscules, chiffres, tirets) n’est jamais masqué', () => {
  const slug = '03-inclusion-scolaire-participation-sociale-et-vie-associative';
  assert.strictEqual(codes.masquer(slug, {}), slug);
});

test('masquage : une clé DeepL réaliste précédée de son mot-clé reste masquée', () => {
  // Format d'une clé DeepL : hexadécimal minuscule, tirets, suffixe « :fx » (offre
  // gratuite), donc sans majuscule. C'est la règle 4, pas 5a, qui la protège (voir la
  // limite connue ci-dessous pour une clé sans mot-clé).
  const cle = 'ab12cd34-ef56-7890-ab12-cd34ef567890:fx';
  assert.strictEqual(codes.masquer('deepl: ' + cle, {}), 'deepl: ***');
  // « DEEPL_API_KEY=… » : `_` fait partie de \w, donc aucun \b ne sépare « deepl » ni
  // « api key », et la règle 4 ne s'applique pas. 5a rattrape ce cas : le `=` est dans sa
  // classe et relie le nom de variable à la valeur en une seule candidate. Le nom disparaît
  // aussi ; on vérifie seulement que le secret ne survit pas.
  const sortie = codes.masquer('DEEPL_API_KEY=' + cle, {});
  assert.strictEqual(sortie.indexOf(cle), -1, 'la clé survit : ' + sortie);
});

// Limite connue et acceptée de 5a : un secret nu, sans mot-clé ni mélange de casse et de
// chiffres (une clé DeepL nue, par exemple), ne se distingue pas d'un GUID ou d'un slug et
// n'est pas masqué. Pour ce cas, la protection reste la règle 4.
test('masquage : limite connue — une clé DeepL NUE, sans mot-clé, échappe à 5a', () => {
  const cleNue = 'ab12cd34-ef56-7890-ab12-cd34ef567890:fx';
  assert.strictEqual(codes.masquer('valeur trouvée : ' + cleNue, {}),
    'valeur trouvée : ' + cleNue,
    'si ce test casse, c’est que 5a a changé de comportement sur ce cas précis — à valider avec la spec avant de « corriger »');
});

test('masquage, règle 6 : une adresse courriel est masquée, sauf celle du support', () => {
  const sortie = codes.masquer(
    'contact : jean.dupont@example.com ou ROBIN.MORAND@SZH.CH', {});
  assert.strictEqual(sortie, 'contact : ***@*** ou ROBIN.MORAND@SZH.CH');
});

test('masquage : une clé d’API réaliste ne survit pas, qu’elle soit nommée ou nue', () => {
  const cleRealiste = 'sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij0123456789';
  const nommee = codes.masquer('apiKey: ' + cleRealiste, {});
  assert.strictEqual(nommee.indexOf(cleRealiste), -1, 'la clé nommée survit : ' + nommee);
  assert.ok(nommee.indexOf('***') !== -1);
  const nue = codes.masquer('paramètre suspect ' + cleRealiste + ' dans la requête', {});
  assert.strictEqual(nue.indexOf(cleRealiste), -1, 'la clé nue survit : ' + nue);
});

test('masquage combiné : chemin, secret nommé et courriel dans le même texte', () => {
  const texte = 'Ouverture de ' + ANCRAGE + '\\2_Produkte\\a.md a échoué. '
    + 'apiKey=ABCDEFGHIJ0123456789abcdefghijZZ. contact jean@example.com.';
  const sortie = codes.masquer(texte, { ancrage: ANCRAGE });
  assert.ok(sortie.indexOf(ANCRAGE) === -1, 'le chemin absolu de l’ancrage doit disparaître');
  assert.ok(sortie.indexOf('2_Produkte\\a.md') !== -1, 'le chemin relatif doit rester lisible');
  assert.ok(sortie.indexOf('ABCDEFGHIJ0123456789abcdefghijZZ') === -1, 'la clé doit être masquée');
  assert.ok(sortie.indexOf('jean@example.com') === -1, 'le courriel doit être masqué');
});

test('masquage : une valeur nulle ou absente ne fait pas échouer masquer()', () => {
  assert.strictEqual(codes.masquer(null, {}), '');
  assert.strictEqual(codes.masquer(undefined, {}), '');
  assert.strictEqual(codes.masquer('', {}), '');
});

// ---------------------------------------------------------------------------------------
// Mise en chemin relatif à une racine donnée
// ---------------------------------------------------------------------------------------

test('versCheminRelatif : sous la racine, insensible à la casse, séparateurs mêlés', () => {
  const chemin = 'c:/users/ROBIN/SZH CSPS/Daten_Allgemein - General/2_Produkte/52_Revue/x.md';
  const r = codes.versCheminRelatif(chemin, ANCRAGE, 'ancrage');
  assert.strictEqual(r.relatifA, 'ancrage');
  assert.strictEqual(r.chemin, '2_Produkte\\52_Revue\\x.md');
  // Recollable dans l'Explorateur Windows.
  assert.strictEqual(ANCRAGE + '\\' + r.chemin,
    'C:\\Users\\robin\\SZH CSPS\\Daten_Allgemein - General\\2_Produkte\\52_Revue\\x.md');
});

test('versCheminRelatif : hors de la racine, reste absolu, séparateurs normalisés', () => {
  const r = codes.versCheminRelatif('D:/Autre/fichier.txt', ANCRAGE, 'ancrage');
  assert.strictEqual(r.relatifA, 'absolu');
  assert.strictEqual(r.chemin, 'D:\\Autre\\fichier.txt');
});

test('versCheminRelatif : sans racine fournie, reste absolu', () => {
  const r = codes.versCheminRelatif('C:\\ProgramData\\SZH\\logs\\x.log', null, 'programdata');
  assert.strictEqual(r.relatifA, 'absolu');
  assert.strictEqual(r.chemin, 'C:\\ProgramData\\SZH\\logs\\x.log');
});

// ---------------------------------------------------------------------------------------
// Signature anti-inondation
// ---------------------------------------------------------------------------------------

test('calculerSignature : stable pour les mêmes entrées', () => {
  const champs = { source: 'lanceur', code: 'LANCEUR-TRAP', etape: 'ouverture', messageMasque: 'Erreur X', produitNumero: '2027-02' };
  const a = codes.calculerSignature(champs);
  const b = codes.calculerSignature(Object.assign({}, champs));
  assert.strictEqual(a, b);
  assert.match(a, /^[0-9a-f]{12}$/);
});

test('calculerSignature : sensible à une différence de message', () => {
  const base = { source: 'lanceur', code: 'LANCEUR-TRAP', etape: 'ouverture', produitNumero: '2027-02' };
  const a = codes.calculerSignature(Object.assign({}, base, { messageMasque: 'Erreur X' }));
  const b = codes.calculerSignature(Object.assign({}, base, { messageMasque: 'Erreur Y' }));
  assert.notStrictEqual(a, b);
});

test('calculerSignature : sensible à une différence de source, code, étape ou numéro', () => {
  const base = { source: 'lanceur', code: 'LANCEUR-TRAP', etape: 'ouverture', messageMasque: 'm', produitNumero: '2027-02' };
  const ref = codes.calculerSignature(base);
  assert.notStrictEqual(codes.calculerSignature(Object.assign({}, base, { source: 'cockpit' })), ref);
  assert.notStrictEqual(codes.calculerSignature(Object.assign({}, base, { code: 'MAJ-ECHEC' })), ref);
  assert.notStrictEqual(codes.calculerSignature(Object.assign({}, base, { etape: 'fermeture' })), ref);
  assert.notStrictEqual(codes.calculerSignature(Object.assign({}, base, { produitNumero: '2027-03' })), ref);
});

test('calculerSignature : les champs absents (null) sont stables, pas confondus avec du texte', () => {
  const a = codes.calculerSignature({ source: 'lanceur', code: 'LANCEUR-TRAP', etape: null, messageMasque: null, produitNumero: null });
  const b = codes.calculerSignature({ source: 'lanceur', code: 'LANCEUR-TRAP', etape: null, messageMasque: null, produitNumero: null });
  assert.strictEqual(a, b);
});

test('calculerSignature : seuls les 200 premiers caractères du message masqué comptent', () => {
  const prefixe = 'x'.repeat(200);
  const base = { source: 'lanceur', code: 'LANCEUR-TRAP', etape: 'ouverture', produitNumero: '2027-02' };
  const a = codes.calculerSignature(Object.assign({}, base, { messageMasque: prefixe + 'AAAA' }));
  const b = codes.calculerSignature(Object.assign({}, base, { messageMasque: prefixe + 'ZZZZ' }));
  assert.strictEqual(a, b, 'une différence après le 200e caractère ne doit pas changer la signature');
});

// ---------------------------------------------------------------------------------------
// L'identifiant du rapport
// ---------------------------------------------------------------------------------------

test('calculerId : reproduit exactement l’exemple gelé du §4', () => {
  const id = codes.calculerId('2026-09-09T08:15:30Z', 'ROBIN-PC', 'a1b2c3');
  assert.strictEqual(id, '20260909-081530-ROBIN-PC-a1b2c3');
  assert.match(id, codes.FORMAT_ID);
  assert.ok(id.length <= codes.ID_LONGUEUR_MAX);
});

test('calculerId : se fonde sur l’UTC, jamais sur l’heure locale', () => {
  const viaUtc = codes.calculerId('2026-09-09T08:15:30Z', 'ROBIN-PC', 'a1b2c3');
  const viaLocaleEte = codes.calculerId('2026-09-09T10:15:30+02:00', 'ROBIN-PC', 'a1b2c3');
  assert.strictEqual(viaLocaleEte, viaUtc,
    'même instant donné avec un décalage local : l’id doit être identique (basé sur l’UTC)');
});

test('calculerId : le nom de poste est ramené à de l’ASCII pur', () => {
  const id = codes.calculerId('2026-09-09T08:15:30Z', 'Zürich-Büro', 'a1b2c3');
  assert.strictEqual(id, '20260909-081530-ZURICH-BURO-a1b2c3');
  assert.ok(/^[\x00-\x7F]+$/.test(id), 'id non ASCII : ' + id);
});

test('calculerId : trié par ordre alphabétique, l’ordre est chronologique', () => {
  const ids = [
    codes.calculerId('2026-09-09T08:15:30Z', 'ROBIN-PC', 'aaaaaa'),
    codes.calculerId('2026-09-09T08:15:31Z', 'ROBIN-PC', 'bbbbbb'),
    codes.calculerId('2026-09-08T23:59:59Z', 'ROBIN-PC', 'cccccc')
  ];
  const attendu = [ids[2], ids[0], ids[1]];
  assert.deepStrictEqual(ids.slice().sort(), attendu);
});

test('calculerId : refuse un aléa qui n’est pas 6 caractères hexadécimaux', () => {
  assert.throws(() => codes.calculerId('2026-09-09T08:15:30Z', 'ROBIN-PC', 'zzzzzz'));
  assert.throws(() => codes.calculerId('2026-09-09T08:15:30Z', 'ROBIN-PC', 'abcde'));
  assert.throws(() => codes.calculerId('2026-09-09T08:15:30Z', 'ROBIN-PC', ''));
});

test('calculerId : refuse un horodatage illisible', () => {
  assert.throws(() => codes.calculerId('pas-une-date', 'ROBIN-PC', 'a1b2c3'));
});

test('genererAleatoireHex : rend bien 6 caractères hexadécimaux, et pas toujours les mêmes', () => {
  const a = codes.genererAleatoireHex();
  const b = codes.genererAleatoireHex();
  assert.match(a, /^[0-9a-f]{6}$/);
  assert.match(b, /^[0-9a-f]{6}$/);
  // Probabiliste, mais une chance sur 16 millions de coïncider : un échec signalerait une
  // source d'aléa cassée (un genererAleatoireHex qui renverrait toujours la même valeur).
  assert.notStrictEqual(a, b);
});

// ---------------------------------------------------------------------------------------
// Plafonds
// ---------------------------------------------------------------------------------------

test('PLAFONDS : les nombres gelés du §4.2', () => {
  assert.deepStrictEqual(codes.PLAFONDS, {
    message: 4000, pile: 8000, journalExtraitLignes: 200, journalExtraitCaracteres: 40000,
    fichiers: 50, constats: 100, fichierOctets: 262144
  });
});

test('ANTI_INONDATION : les seuils gelés du §4.3', () => {
  assert.deepStrictEqual(codes.ANTI_INONDATION, {
    signaturePeriodeHeures: 24, rapportsParJourMax: 20, purgeCompteursJours: 7
  });
});

function rapportMinimal(overrides) {
  const base = {
    schema: codes.SCHEMA_VERSION,
    id: '20260909-081530-ROBIN-PC-a1b2c3',
    horodatage: '2026-09-09T08:15:30Z',
    horodatageLocal: '2026-09-09T10:15:30+02:00',
    gravite: 'erreur',
    source: 'lanceur',
    code: 'LANCEUR-TRAP',
    signature: 'a1b2c3d4e5f6',
    resume: { fr: 'Résumé.', de: 'Zusammenfassung.' },
    etape: 'ouverture de la liste des numéros',
    message: 'Erreur de test',
    pile: null,
    poste: { nom: 'ROBIN-PC', utilisateur: 'robin', os: '10.0.26200', powershell: '5.1.26200.1', langueInterface: 'fr' },
    versions: { toolkit: 'v2026.08.59', cockpit: '0.26.7', vscodium: '1.101.2' },
    produit: { type: 'revue', numero: '2027-02', emplacement: 'production' },
    ancrage: { trouve: true, origine: 'cache', chemin: '2_Produkte' },
    fichiers: [],
    journal: { chemin: 'logs\\szh-2026-09.log', relatifA: 'programdata', lignes: 10, tronque: false, extrait: [] },
    constats: [],
    environnement: { wsl: 'repond', espaceLibreGo: 42.3 }
  };
  return Object.assign(base, overrides || {});
}

test('appliquerPlafonds : message et pile sont tronqués à leur plafond, sans muter l’original', () => {
  const rapport = rapportMinimal({ message: 'm'.repeat(5000), pile: 'p'.repeat(9000) });
  const capped = codes.appliquerPlafonds(rapport);
  assert.strictEqual(capped.message.length, codes.PLAFONDS.message);
  assert.strictEqual(capped.pile.length, codes.PLAFONDS.pile);
  assert.strictEqual(rapport.message.length, 5000, 'le rapport d’origine ne doit pas être modifié');
  assert.strictEqual(rapport.pile.length, 9000);
});

test('appliquerPlafonds : fichiers et constats sont bornés en nombre d’entrées', () => {
  const fichiers = Array.from({ length: 60 }, (_, i) => ({ chemin: 'f' + i + '.md', relatifA: 'ancrage', role: 'article' }));
  const constats = Array.from({ length: 150 }, (_, i) => ({ source: 'pandoc', code: 'x' + i, ton: 'info', slug: 's' }));
  const capped = codes.appliquerPlafonds(rapportMinimal({ fichiers, constats }));
  assert.strictEqual(capped.fichiers.length, codes.PLAFONDS.fichiers);
  assert.strictEqual(capped.constats.length, codes.PLAFONDS.constats);
});

test('appliquerPlafonds : journal.extrait garde les 200 DERNIÈRES lignes', () => {
  const lignes = Array.from({ length: 250 }, (_, i) => 'ligne ' + i);
  const rapport = rapportMinimal({ journal: { chemin: 'logs\\x.log', relatifA: 'programdata', lignes: 250, tronque: false, extrait: lignes } });
  const capped = codes.appliquerPlafonds(rapport);
  assert.strictEqual(capped.journal.extrait.length, codes.PLAFONDS.journalExtraitLignes);
  assert.strictEqual(capped.journal.extrait[0], 'ligne 50', 'doit garder la fin, pas le début');
  assert.strictEqual(capped.journal.extrait[capped.journal.extrait.length - 1], 'ligne 249');
  assert.strictEqual(capped.journal.tronque, true);
});

test('appliquerPlafonds : journal.extrait respecte aussi le plafond de caractères', () => {
  const lignesLongues = Array.from({ length: 5 }, () => 'x'.repeat(9000)); // 45000 caractères, 5 lignes
  const rapport = rapportMinimal({ journal: { chemin: null, relatifA: null, lignes: 5, tronque: false, extrait: lignesLongues } });
  const capped = codes.appliquerPlafonds(rapport);
  const texteFinal = capped.journal.extrait.join('\n');
  assert.ok(texteFinal.length <= codes.PLAFONDS.journalExtraitCaracteres, 'toujours au-dessus du plafond : ' + texteFinal.length);
  assert.strictEqual(capped.journal.tronque, true);
  assert.ok(capped.journal.extrait.length < 5, 'au moins une ligne doit avoir été retirée depuis le début');
});

test('appliquerPlafonds : une seule ligne énorme est coupée en gardant sa fin', () => {
  const ligneEnorme = 'z'.repeat(50000);
  const rapport = rapportMinimal({ journal: { chemin: null, relatifA: null, lignes: 1, tronque: false, extrait: [ligneEnorme] } });
  const capped = codes.appliquerPlafonds(rapport);
  assert.strictEqual(capped.journal.extrait.length, 1);
  assert.strictEqual(capped.journal.extrait[0].length, codes.PLAFONDS.journalExtraitCaracteres);
  assert.strictEqual(capped.journal.extrait[0], ligneEnorme.slice(-codes.PLAFONDS.journalExtraitCaracteres));
  assert.strictEqual(capped.journal.tronque, true);
});

test('appliquerPlafonds : au-delà de 256 Ko, journal.extrait est vidé et tronque posé à true', () => {
  const cheminLong = 'x'.repeat(6000);
  const fichiersEnormes = Array.from({ length: 50 }, (_, i) => ({ chemin: cheminLong + i, relatifA: 'ancrage', role: 'article' }));
  const rapport = rapportMinimal({
    fichiers: fichiersEnormes,
    journal: { chemin: 'logs\\x.log', relatifA: 'programdata', lignes: 1, tronque: false, extrait: ['une ligne, pas le problème ici'] }
  });
  // Témoin : le montage dépasse 256 Ko avant tout plafonnement.
  assert.ok(Buffer.byteLength(JSON.stringify(rapport, null, 2), 'utf8') > codes.PLAFONDS.fichierOctets,
    'le montage du test ne dépasse pas 256 Ko : à agrandir');
  const capped = codes.appliquerPlafonds(rapport);
  assert.deepStrictEqual(capped.journal.extrait, []);
  assert.strictEqual(capped.journal.tronque, true);
});

// ---------------------------------------------------------------------------------------
// Validation contre le schéma v1
// ---------------------------------------------------------------------------------------

test('validerRapport : un rapport conforme ne rend aucun écart', () => {
  assert.deepStrictEqual(codes.validerRapport(rapportMinimal()), []);
});

test('validerRapport : un champ omis est signalé', () => {
  const r = rapportMinimal();
  delete r.pile;
  const ecarts = codes.validerRapport(r);
  assert.ok(ecarts.some((e) => e.includes('champ absent : pile')), JSON.stringify(ecarts));
});

test('validerRapport : un champ inconnu du schéma v1 est signalé', () => {
  const r = rapportMinimal({ inventee: 'x' });
  const ecarts = codes.validerRapport(r);
  assert.ok(ecarts.some((e) => e.includes('champ inconnu du schéma v1 : inventee')), JSON.stringify(ecarts));
});

test('validerRapport : des clés présentes mais dans le désordre sont signalées', () => {
  const r = rapportMinimal();
  const cles = Object.keys(r);
  const permutees = cles.slice();
  const tmp = permutees[0]; permutees[0] = permutees[1]; permutees[1] = tmp;
  const reordonne = {};
  for (const cle of permutees) { reordonne[cle] = r[cle]; }
  const ecarts = codes.validerRapport(reordonne);
  assert.ok(ecarts.some((e) => e.includes('ordre')), JSON.stringify(ecarts));
});

test('validerRapport : les énumérations closes sont vérifiées (gravite, source, code)', () => {
  assert.ok(codes.validerRapport(rapportMinimal({ gravite: 'grave' }))
    .some((e) => e.includes('gravite hors énumération')));
  assert.ok(codes.validerRapport(rapportMinimal({ source: 'inconnue' }))
    .some((e) => e.includes('source hors énumération')));
  assert.ok(codes.validerRapport(rapportMinimal({ code: 'CODE-INVENTE' }))
    .some((e) => e.includes('code inconnu de la table')));
});

test('validerRapport : ancrage.origine et journal.relatifA sont vérifiés', () => {
  assert.ok(codes.validerRapport(rapportMinimal({ ancrage: { trouve: false, origine: 'inventee', chemin: null } }))
    .some((e) => e.includes('ancrage.origine hors énumération')));
  assert.ok(codes.validerRapport(rapportMinimal({
    journal: { chemin: 'x', relatifA: 'inventee', lignes: 0, tronque: false, extrait: [] }
  })).some((e) => e.includes('journal.relatifA hors énumération')));
});

test('validerRapport : fichiers/constats doivent être des tableaux, jamais null', () => {
  assert.ok(codes.validerRapport(rapportMinimal({ fichiers: null }))
    .some((e) => e.includes('fichiers doit être un tableau')));
  assert.ok(codes.validerRapport(rapportMinimal({ constats: null }))
    .some((e) => e.includes('constats doit être un tableau')));
});

test('validerRapport : une entrée de fichiers avec un relatifA hors énumération est signalée', () => {
  const ecarts = codes.validerRapport(rapportMinimal({
    fichiers: [{ chemin: 'a.md', relatifA: 'nulle-part', role: 'article' }]
  }));
  assert.ok(ecarts.some((e) => e.includes('fichiers[0].relatifA hors énumération')), JSON.stringify(ecarts));
});

test('validerRapport : un id mal formé est signalé', () => {
  assert.ok(codes.validerRapport(rapportMinimal({ id: 'pas-un-id' }))
    .some((e) => e.includes('id ne respecte pas le format')));
});

test('validerRapport : resume doit porter fr et de', () => {
  assert.ok(codes.validerRapport(rapportMinimal({ resume: { fr: 'Seulement le français.' } }))
    .some((e) => e.includes('resume doit porter')));
});
