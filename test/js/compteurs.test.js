// Les compteurs d'usage : l'écrivain (lib/compteurs.js), les compteurs de l'import tirés du
// journal du cockpit, et l'outil de synthèse (outils/compteurs-synthese.js).
//
//   node --test test/js/compteurs.test.js
//
// Aucun texte de manuscrit n'atteint un fichier de compteurs. Les tests le prouvent avec des
// sentinelles (slug, nom de fichier, noms, e-mail uniques, semés dans un journal et une
// fiche fabriqués) qu'on ne doit retrouver nulle part.
//
// Rien n'écrit dans le vrai `_Systeme` : SZH_COMPTEURS, SZH_BASE, LOCALAPPDATA et
// SZH_ANCRAGE sont détournés vers des dossiers jetables, et toute variable qui pourrait
// changer le contexte ou la garde est remise à zéro avant chaque cas.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const MODULE = path.join(COCKPIT, 'lib', 'compteurs.js');
const SYNTHESE = path.join(COCKPIT, 'outils', 'compteurs-synthese.js');
const compteurs = require(MODULE);
const synthese = require(SYNTHESE);
const rapport = require(path.join(COCKPIT, 'lib', 'rapport-erreur.js'));

const ENTETE = 'date;poste;contexte;version_toolkit;version_rootfs;source;passage;mesure;valeur';
const VARIABLES = ['SZH_COMPTEURS', 'SZH_ANCRAGE', 'SZH_RAPPORTS', 'SZH_BASE', 'LOCALAPPDATA',
  'SZH_MANUSCRIT_CLI', 'SZH_CODIUM_PROFIL', 'SZH_LANCEUR_SIMULE', 'SZH_RESEAU_INTERDIT', 'SZH_TOOLKIT'];

// Un poste jetable : toutes les variables détournées, rien de ce qui change le contexte posé.
// `env` ajoute ou remplace ; une valeur null retire la variable.
function poste(env) {
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-compteurs-'));
  const sauve = {};
  for (const v of VARIABLES) { sauve[v] = process.env[v]; delete process.env[v]; }
  const dossiers = {
    travail: travail,
    compteurs: path.join(travail, 'compteurs'),
    base: path.join(travail, 'Base'),
    local: path.join(travail, 'Local'),
    file: path.join(travail, 'Local', 'SZH', 'compteurs-en-attente')
  };
  fs.mkdirSync(dossiers.base, { recursive: true });
  fs.mkdirSync(dossiers.local, { recursive: true });
  process.env.SZH_COMPTEURS = dossiers.compteurs;
  process.env.SZH_BASE = dossiers.base;
  process.env.LOCALAPPDATA = dossiers.local;
  for (const k of Object.keys(env || {})) {
    if (env[k] === null) { delete process.env[k]; } else { process.env[k] = env[k]; }
  }
  dossiers.fin = () => {
    for (const v of VARIABLES) { if (sauve[v] === undefined) { delete process.env[v]; } else { process.env[v] = sauve[v]; } }
    fs.rmSync(travail, { recursive: true, force: true });
  };
  return dossiers;
}

function csvDe(dossier) {
  try { return fs.readdirSync(dossier).filter((n) => /\.csv$/.test(n)).sort(); } catch (e) { return []; }
}
function lire(dossier, nom) { return fs.readFileSync(path.join(dossier, nom), 'utf8'); }
function tout(dossier) { return csvDe(dossier).map((n) => lire(dossier, n)).join('\n'); }
function jourLocal() { return rapport.formaterJourLocal(new Date()); }

// ---------------------------------------------------------------------------------------
// 1. Le format
// ---------------------------------------------------------------------------------------

test('l’en-tête est exactement celui du contrat, et le fichier suit le format', () => {
  assert.strictEqual(compteurs.ENTETE_COMPTEURS, ENTETE);
  const p = poste();
  try {
    const r = compteurs.ecrireCompteurs({ source: 'nettoyeur', passage: 'abcdef012345',
      mesures: { 'issue.ok': 1, signes: 4200, 'regle:APA.CitationAbsente:revision': 3 } });
    assert.strictEqual(r.ecrit, true, JSON.stringify(r));
    const nom = path.basename(r.fichier);
    const hote = os.hostname().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    assert.match(nom, new RegExp('^' + jourLocal().replace(/-/g, '') + '-' + hote + '-nettoyeur-[0-9a-f]{6}\\.csv$'));
    const brut = fs.readFileSync(r.fichier);
    assert.deepStrictEqual(Array.from(brut.slice(0, 3)), [0xEF, 0xBB, 0xBF], 'BOM UTF-8 absent');
    const texte = brut.toString('utf8').replace(/^\uFEFF/, '');
    assert.ok(texte.endsWith('\r\n'));
    assert.ok(texte.indexOf('\n') === texte.indexOf('\r\n') + 1, 'fins de ligne non CRLF');
    assert.strictEqual(texte.replace(/\r\n/g, '\n').indexOf('\r'), -1);
    const lignes = texte.split('\r\n').filter((l) => l !== '');
    assert.strictEqual(lignes[0], ENTETE);
    assert.strictEqual(lignes.length, 4);
    for (const l of lignes.slice(1)) {
      const c = l.split(';');
      assert.strictEqual(c.length, 9);
      assert.strictEqual(c[0], jourLocal());
      assert.match(c[0], /^\d{4}-\d{2}-\d{2}$/, 'la date ne porte jamais d’heure');
      assert.strictEqual(c[5], 'nettoyeur');
      assert.strictEqual(c[6], 'abcdef012345');
      assert.match(c[8], /^\d+$/);
      assert.ok(c[2] === 'prod' || c[2] === 'dev');
    }
    assert.deepStrictEqual(fs.readdirSync(p.compteurs).filter((n) => n.startsWith('~$')), []);
  } finally { p.fin(); }
});

test('les mesures et les valeurs hors contrat sont écartées, l’Id inconnu devient Autre', () => {
  const { lignes, rejetees } = compteurs.assainirMesures({
    'issue.ok': 1, 'Mesure Majuscule': 2, 'avec;point-virgule': 3, ['x'.repeat(97)]: 4,
    'valeur.decimale': 1.5, 'valeur.negative': -1, 'valeur.texte': 'abc', 'valeur.chaine': '12',
    'regle:APA.CitationAbsente:revision': 2, 'regle:SZH.Epicene:commentaire': 1,
    'regle:PasUnId:rapport': 4, 'regle:sntl9x7:rapport': 5, 'regle:Autre:rapport': 1,
    'regle:APA.CitationAbsente:devenir-inconnu': 9, 'regle:': 1,
    'import.code:bloc-mal-forme': 2, 'import.code:Nom Fichier.docx': 1, 'import.code:x': 1
  });
  const m = new Map(lignes);
  assert.strictEqual(m.get('issue.ok'), 1);
  assert.strictEqual(m.get('valeur.chaine'), 12);
  assert.strictEqual(m.get('regle:APA.CitationAbsente:revision'), 2);
  assert.strictEqual(m.get('regle:SZH.Epicene:commentaire'), 1);
  assert.strictEqual(m.get('regle:Autre:rapport'), 10, 'les Id inconnus s’additionnent sous Autre');
  assert.strictEqual(m.get('import.code:bloc-mal-forme'), 2);
  assert.strictEqual(m.size, 6, Array.from(m.keys()).join(' | '));
  assert.strictEqual(rejetees, 10);
  for (const [nom, val] of lignes) {
    assert.match(String(val), /^\d+$/);
    assert.ok(/^[a-z0-9_.:-]{1,96}$/.test(nom) || /^regle:(Autre|[A-Z][A-Za-z0-9-]*(\.[A-Z][A-Za-z0-9-]*)+):(revision|commentaire|rapport)$/.test(nom), nom);
  }
});

test('une source inconnue, aucune mesure valable ou un passage mal formé ne donnent pas de fichier faux', () => {
  const p = poste();
  try {
    assert.strictEqual(compteurs.ecrireCompteurs({ source: 'autre', mesures: { a: 1 } }).motif, 'source-inconnue');
    assert.strictEqual(compteurs.ecrireCompteurs({ source: 'import', mesures: { 'Mal Forme': 1 } }).motif, 'vide');
    assert.strictEqual(compteurs.ecrireCompteurs(null).motif, 'source-inconnue');
    assert.strictEqual(csvDe(p.compteurs).length, 0);
    const r = compteurs.ecrireCompteurs({ source: 'nettoyeur', passage: 'SNTL9X7-pas-hex', mesures: { signes: 1 } });
    assert.strictEqual(r.ecrit, true);
    assert.ok(!/sntl9x7/i.test(tout(p.compteurs)), 'un passage non conforme ne doit pas être recopié');
    assert.match(lire(p.compteurs, csvDe(p.compteurs)[0]).split('\r\n')[1].split(';')[6], /^[0-9a-f]{12}$/);
  } finally { p.fin(); }
});

// ---------------------------------------------------------------------------------------
// 2. Aucun texte de manuscrit : les sentinelles
// ---------------------------------------------------------------------------------------

const RACINE_NUMERO = (travail) => path.join(travail, 'numero');
const FICHE = [
  'type: article', 'lang: fr', 'source: "sntl9x7-fichier-source.docx"', 'doi: "10.57161/sntl9x7"',
  'title:', '  fr: "SNTL9X7 titre de l’article"',
  'author:',
  '- prenom: "SNTL9X7prenom"', '  nom: "SNTL9X7nom"', '  email: "sntl9x7@exemple.test"',
  '  affiliation: "Institut SNTL9X7"', '  orcid: "0000-0002-1825-0097"', '  ror: "https://ror.org/sntl9x7"',
  '- prenom: "Deuxieme"', '  nom: "Personne"', '  orcid: ""',
  'keywords:', '  fr:', '  - "sntl9x7-mot"', ''
].join('\n');

function poserNumero(travail, conversions, journalExtra) {
  const racine = RACINE_NUMERO(travail);
  const lignes = [];
  conversions.forEach((c) => {
    const dossier = path.join(racine, 'articles', c.slug);
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, c.slug + '.meta.yaml'), c.fiche || FICHE);
    (c.avertissements || []).forEach((a) => lignes.push(a));
    lignes.push('[import] converti : ' + c.fichier + ' -> articles/' + c.slug + '/' + c.slug + '.md');
  });
  (journalExtra || []).forEach((l) => lignes.push(l));
  lignes.push('[import] terminé : ' + conversions.length + ' converti(s), 0 renommé(s), 0 redéposé(s), 0 échec(s).');
  fs.mkdirSync(racine, { recursive: true });
  const journal = path.join(racine, '.szh-journal.log');
  fs.writeFileSync(journal, lignes.join('\n') + '\n');
  return { racine: racine, journal: journal };
}
function toucher(journal, secondes) {
  const t = new Date(Date.now() + secondes * 1000);
  fs.utimesSync(journal, t, t);
}

test('sentinelles : ni slug, ni nom de fichier, ni nom, ni e-mail, ni phrase dans les fichiers de l’import', () => {
  const p = poste();
  try {
    const n = poserNumero(p.travail, [{
      slug: 'sntl9x7-slug', fichier: 'sntl9x7-mon article.docx',
      avertissements: [
        '[import-avertissement] langue-deduite | article « sntl9x7-slug » | langue « fr » | La langue n’était pas indiquée sntl9x7@exemple.test',
        '[import-avertissement] bloc-mal-forme | article « sntl9x7-slug » | fichier « sntl9x7-mon article.docx » | Phrase libre SNTL9X7',
        '[import-avertissement] bloc-mal-forme | article « sntl9x7-slug » | fichier « sntl9x7-mon article.docx » | encore'
      ]
    }]);
    const r = compteurs.enregistrerImportDepuisJournal(n.racine);
    assert.deepStrictEqual(r, { ecrits: 1, evenements: 1 });
    const noms = csvDe(p.compteurs);
    assert.strictEqual(noms.length, 1);
    assert.match(noms[0], /-import-[0-9a-f]{6}\.csv$/);
    const contenu = tout(p.compteurs);
    for (const s of ['sntl9x7', 'SNTL9X7', 'exemple.test', 'ror.org', '0000-0002', 'Institut', 'Phrase libre',
      'Deuxieme', 'Personne', 'mon article', 'docx', '10.57161', 'numero']) {
      assert.ok(contenu.indexOf(s) === -1, 'la sentinelle « ' + s + ' » est dans le fichier écrit');
    }
    const c = compteurs.analyserCsvCompteurs(contenu);
    assert.strictEqual(c.ok, true);
    const m = new Map(c.lignes.map((l) => [l.mesure, l.valeur]));
    assert.strictEqual(m.get('auteurs'), 2);
    assert.strictEqual(m.get('auteurs_orcid'), 1);
    assert.strictEqual(m.get('auteurs_ror'), 1);
    assert.strictEqual(m.get('langue_deduite'), 1);
    assert.strictEqual(m.get('import.code:bloc-mal-forme'), 2);
    assert.strictEqual(m.get('import.code:langue-deduite'), 1);
    for (const l of c.lignes) { assert.match(String(l.valeur), /^\d+$/); assert.strictEqual(l.source, 'import'); }
  } finally { p.fin(); }
});

test('sentinelles : des noms de mesure ou d’Id de règle portant du texte sont écartés ou remplacés', () => {
  const p = poste();
  try {
    compteurs.ecrireCompteurs({ source: 'nettoyeur', mesures: {
      signes: 10, 'regle:SNTL9X7.titre-du-manuscrit:rapport': 1, 'regle:sntl9x7:revision': 1,
      'sntl9x7-nom-de-fichier': 1, 'titres.h1': 2, 'issue.refus:docx-invalide': 1 } });
    const contenu = tout(p.compteurs);
    assert.ok(!/sntl9x7/i.test(contenu), contenu);
    assert.ok(contenu.indexOf('regle:Autre:rapport;1') !== -1);
    assert.ok(contenu.indexOf('regle:Autre:revision;1') !== -1);
  } finally { p.fin(); }
});

test('chaque source n’écrit que les mesures de sa liste blanche', () => {
  const nettoyeur = ['issue.ok', 'issue.alertes', 'issue.refus:docx-invalide', 'issue.plantage', 'issue.interrompu',
    'produit.revue', 'produit.zeitschrift', 'cas.a', 'cas.b', 'format.entree.odt', 'format.sortie.odt',
    'langue.desaccord', 'signes', 'signes_biblio', 'paragraphes', 'references', 'notes', 'images', 'images_sans_alt',
    'duree_ms', 'regle:APA.CitationAbsente:rapport', 'plafond_commentaires_atteint', 'perte_mots', 'ecartes',
    'vale.indisponible', 'typo.repli', 'annotation.restauree', 'reseau.crossref.panne', 'reseau.ror.panne',
    'reseau.orcid.panne', 'doi.proposes', 'ror.proposes', 'orcid.proposes', 'orcid.candidats', 'entete.auteurs',
    'entete.champs_vides', 'entete.ordre_incertain', 'titres.total_retenus'];
  for (const m of nettoyeur) { assert.strictEqual(compteurs.normaliserMesure(m, 'nettoyeur'), m, m); }
  for (const m of ['auteurs', 'auteurs_orcid', 'auteurs_ror', 'langue_deduite', 'import.code:bloc-mal-forme']) {
    assert.strictEqual(compteurs.normaliserMesure(m, 'import'), m, m);
  }
  // Une forme valable mais hors liste (un slug en minuscules, par exemple) est écartée.
  for (const m of ['mon-slug-de-article', 'issue.refus:Nom Fichier', 'titres.Nom', 'import.code:x']) {
    assert.strictEqual(compteurs.normaliserMesure(m, 'nettoyeur'), null, m);
  }
  assert.strictEqual(compteurs.normaliserMesure('auteurs', 'nettoyeur'), null);
  assert.strictEqual(compteurs.normaliserMesure('signes', 'import'), null);
  assert.strictEqual(compteurs.normaliserMesure('regle:SZH.Epicene:rapport', 'import'), null);
  assert.strictEqual(compteurs.normaliserMesure('mon-slug-de-article', 'import'), null);
});

// ---------------------------------------------------------------------------------------
// 3. L'import : un fichier par conversion, pas par compilation
// ---------------------------------------------------------------------------------------

test('trois compilations avec un Word en attente : zéro fichier ; une conversion : exactement un', () => {
  const p = poste();
  try {
    const redepose = '[import-avertissement] word-redepose | article « sntl9x7-slug » | fichier « sntl9x7.docx » | Déjà importé';
    const inconnu = '[import-avertissement] origine-inconnue | article « sntl9x7-slug » | fichier « sntl9x7.docx » | Inconnu';
    const n = poserNumero(p.travail, [], [redepose, inconnu, '[import] 1 fichier(s) Word attendent : x']);
    for (let i = 1; i <= 3; i++) {
      toucher(n.journal, i);
      assert.deepStrictEqual(compteurs.enregistrerImportDepuisJournal(n.racine), { ecrits: 0, evenements: 0 });
    }
    assert.strictEqual(csvDe(p.compteurs).length, 0, 'un Word en attente a été compté');

    // Un Word en attente et un article converti dans la même tâche : les deux refus ne sont
    // pas ceux de l'article converti.
    const n2 = poserNumero(p.travail, [{ slug: 'article-converti', fichier: 'nouveau.docx',
      avertissements: [redepose, '[import-avertissement] bloc-mal-forme | x | y | z'] }], [inconnu]);
    toucher(n2.journal, 10);
    assert.deepStrictEqual(compteurs.enregistrerImportDepuisJournal(n2.racine), { ecrits: 1, evenements: 1 });
    // Relire le même journal (relireJournal l'appelle à chaque fin de tâche) ne recompte pas.
    assert.deepStrictEqual(compteurs.enregistrerImportDepuisJournal(n2.racine), { ecrits: 0, evenements: 0 });
    assert.strictEqual(csvDe(p.compteurs).length, 1);
    const contenu = tout(p.compteurs);
    assert.ok(contenu.indexOf('word-redepose') === -1 && contenu.indexOf('origine-inconnue') === -1);
    assert.ok(contenu.indexOf('import.code:bloc-mal-forme;1') !== -1);
  } finally { p.fin(); }
});

test('un échec de conversion remet le compte à zéro ; deux conversions = deux fichiers', () => {
  const p = poserNumero;
  const pos = poste();
  try {
    const n = p(pos.travail, [
      { slug: 'un', fichier: 'un.docx', avertissements: ['[import-avertissement] code-un | a | b | c'] },
      { slug: 'deux', fichier: 'deux.docx', avertissements: [
        '[import-avertissement] code-perdu | a | b | c', '[import] ⚠ échec sur : x.docx (le fichier reste dans articles-word/)',
        '[import-avertissement] code-deux | a | b | c'] }
    ]);
    toucher(n.journal, 5);
    assert.deepStrictEqual(compteurs.enregistrerImportDepuisJournal(n.racine), { ecrits: 2, evenements: 2 });
    const contenu = tout(pos.compteurs);
    assert.ok(contenu.indexOf('code-un;1') !== -1 && contenu.indexOf('code-deux;1') !== -1);
    assert.ok(contenu.indexOf('code-perdu') === -1);
  } finally { pos.fin(); }
});

test('le réimport réussi compte ses codes, sans refaire les auteurs ; rien sans avertissement', () => {
  const p = poste();
  try {
    assert.strictEqual(compteurs.enregistrerReimport({ resultat: 'refuse', avertissements: ['tableau-en-conflit'] }).ecrit, false);
    assert.strictEqual(compteurs.enregistrerReimport({ resultat: 'reussi', avertissements: [] }).ecrit, false);
    assert.strictEqual(compteurs.enregistrerReimport(null).ecrit, false);
    assert.strictEqual(csvDe(p.compteurs).length, 0);
    assert.strictEqual(compteurs.enregistrerReimport({ resultat: 'reussi', article: 'sntl9x7-slug',
      avertissements: ['tableau-en-conflit', 'Nom Libre.docx', 'langue-deduite'] }).ecrit, true);
    const contenu = tout(p.compteurs);
    assert.ok(!/sntl9x7|Nom Libre/i.test(contenu));
    assert.ok(contenu.indexOf('import.code:tableau-en-conflit;1') !== -1);
    assert.ok(contenu.indexOf(';auteurs;') === -1, 'un réimport ne recompte pas les auteurs');
  } finally { p.fin(); }
});

test('compterAuteursMeta : ORCID et ROR vides ne comptent pas, deux styles d’indentation', () => {
  assert.deepStrictEqual(compteurs.compterAuteursMeta(FICHE), { auteurs: 2, auteurs_orcid: 1, auteurs_ror: 1 });
  const indente = 'author:\n  - prenom: "A"\n    orcid: "0000"\n  - prenom: "B"\n    ror: \'x\'\n  - prenom: "C"\nresume:\n  fr: "x"\n  orcid: "pas un auteur"\n';
  assert.deepStrictEqual(compteurs.compterAuteursMeta(indente), { auteurs: 3, auteurs_orcid: 1, auteurs_ror: 1 });
  assert.deepStrictEqual(compteurs.compterAuteursMeta('type: article\n'), { auteurs: 0, auteurs_orcid: 0, auteurs_ror: 0 });
  assert.deepStrictEqual(compteurs.compterAuteursMeta(''), { auteurs: 0, auteurs_orcid: 0, auteurs_ror: 0 });
});

test('l’article préfixé d’un rang après la conversion est retrouvé', () => {
  const p = poste();
  try {
    const n = poserNumero(p.travail, [{ slug: 'sntl9x7-slug', fichier: 'a.docx' }]);
    fs.renameSync(path.join(n.racine, 'articles', 'sntl9x7-slug'), path.join(n.racine, 'articles', '03-sntl9x7-slug'));
    fs.renameSync(path.join(n.racine, 'articles', '03-sntl9x7-slug', 'sntl9x7-slug.meta.yaml'),
      path.join(n.racine, 'articles', '03-sntl9x7-slug', '03-sntl9x7-slug.meta.yaml'));
    compteurs.enregistrerImportDepuisJournal(n.racine);
    assert.ok(tout(p.compteurs).indexOf('auteurs;2') !== -1);
  } finally { p.fin(); }
});

// ---------------------------------------------------------------------------------------
// 4. Écriture : atomique, simultanée, hors ligne, garde de banc
// ---------------------------------------------------------------------------------------

test('le temporaire « ~$ » est supprimé même quand l’écriture échoue', () => {
  const p = poste();
  try {
    fs.mkdirSync(p.compteurs, { recursive: true });
    // Un dossier sous le nom de la cible : le renommage échoue après l'écriture du temporaire.
    fs.mkdirSync(path.join(p.compteurs, 'cible.csv'));
    assert.throws(() => compteurs.ecrireFichierAtomique(p.compteurs, 'cible.csv', 'contenu'));
    assert.deepStrictEqual(fs.readdirSync(p.compteurs).filter((n) => n.startsWith('~$')), [],
      'un temporaire a été abandonné dans le dossier partagé');
    // En cas de succès non plus, le temporaire (« ~$<nom>.<pid> ») ne reste pas.
    compteurs.ecrireFichierAtomique(p.compteurs, 'ok.csv', 'x');
    assert.deepStrictEqual(fs.readdirSync(p.compteurs).sort(), ['cible.csv', 'ok.csv']);
  } finally { p.fin(); }
});

test('le temporaire porte le préfixe « ~$ » et le pid, et la source le nettoie dans un finally', () => {
  const src = fs.readFileSync(MODULE, 'utf8');
  assert.match(src, /'~\$' \+ nom \+ '\.' \+ process\.pid/);
  assert.match(src, /\}\s*finally\s*\{[\s\S]{0,120}unlinkSync\(tmp\)/);
});

test('deux processus qui écrivent en même temps : deux fichiers distincts', async () => {
  const p = poste();
  try {
    const script = "const c=require(" + JSON.stringify(MODULE) + ");"
      + "const r=c.ecrireCompteurs({source:'import',mesures:{auteurs:1}});"
      + "process.exit(r.ecrit?0:3);";
    const lancer = () => new Promise((resolve) => {
      const enfant = spawn(process.execPath, ['-e', script], { env: process.env, stdio: 'ignore' });
      enfant.on('close', (code) => resolve(code));
    });
    const codes = await Promise.all([lancer(), lancer(), lancer()]);
    assert.deepStrictEqual(codes, [0, 0, 0]);
    assert.strictEqual(csvDe(p.compteurs).length, 3);
    assert.deepStrictEqual(fs.readdirSync(p.compteurs).filter((n) => n.startsWith('~$')), []);
  } finally { p.fin(); }
});

test('hors ligne : la file d’attente reçoit le fichier, puis se vide au lancement suivant', () => {
  // Un dossier de compteurs impossible à créer : son parent est un fichier.
  const p = poste();
  try {
    const bloc = path.join(p.travail, 'bloc');
    fs.writeFileSync(bloc, 'fichier, pas dossier');
    process.env.SZH_COMPTEURS = path.join(bloc, 'compteurs');
    const r = compteurs.ecrireCompteurs({ source: 'nettoyeur', mesures: { signes: 12 } });
    assert.strictEqual(r.ecrit, false);
    assert.strictEqual(r.enAttente, true, JSON.stringify(r));
    assert.strictEqual(csvDe(p.file).length, 1);
    // Toujours injoignable : le vidage laisse le fichier en place.
    assert.deepStrictEqual(compteurs.viderFileCompteurs(), { deplaces: 0, restes: 1 });
    assert.strictEqual(csvDe(p.file).length, 1);
    // Le dossier redevient joignable.
    process.env.SZH_COMPTEURS = p.compteurs;
    assert.deepStrictEqual(compteurs.viderFileCompteurs(), { deplaces: 1, restes: 0 });
    assert.strictEqual(csvDe(p.file).length, 0);
    assert.strictEqual(csvDe(p.compteurs).length, 1);
    assert.ok(tout(p.compteurs).indexOf(';signes;12') !== -1);
    assert.deepStrictEqual(fs.readdirSync(p.compteurs).filter((n) => n.startsWith('~$')), []);
  } finally { p.fin(); }
});

// L'ancrage est rendu en antislashs (lib/rapport-erreur.js) : exact sous Windows seulement.
const HORS_WINDOWS = process.platform !== 'win32'
  ? 'chemins Windows — joué par le job contrats-windows'
  : false;

test('ancrage introuvable : file d’attente ; ancrage résolu : _Systeme\\compteurs sous lui',
  { skip: HORS_WINDOWS }, () => {
  const p = poste({ SZH_COMPTEURS: null });
  try {
    let r = compteurs.ecrireCompteurs({ source: 'import', mesures: { auteurs: 1 } });
    assert.strictEqual(r.enAttente, true, JSON.stringify(r));
    const ancrage = path.join(p.travail, 'Daten_Allgemein - General');
    fs.mkdirSync(ancrage, { recursive: true });
    process.env.SZH_ANCRAGE = ancrage;
    const dossier = path.join(ancrage, '2_Produkte', rapport.SEGMENT_APPLICATION, '_Systeme', 'compteurs');
    assert.strictEqual(compteurs.resoudreDossierCompteurs(), dossier);
    assert.deepStrictEqual(compteurs.viderFileCompteurs(), { deplaces: 1, restes: 0 });
    r = compteurs.ecrireCompteurs({ source: 'import', mesures: { auteurs: 1 } });
    assert.strictEqual(r.ecrit, true);
    assert.strictEqual(csvDe(dossier).length, 2);
  } finally { p.fin(); }
});

test('dossierSystemeDepuisAncrage : même dérivation que les rapports, sans recopier le segment', () => {
  const a = path.join(os.tmpdir(), 'ancrage');
  assert.strictEqual(rapport.dossierSystemeDepuisAncrage(a, 'rapports'), rapport.dossierRapportsDepuisAncrage(a));
  assert.strictEqual(rapport.dossierSystemeDepuisAncrage(a, 'compteurs'),
    path.join(path.dirname(rapport.dossierRapportsDepuisAncrage(a)), 'compteurs'));
  assert.strictEqual(rapport.dossierSystemeDepuisAncrage(null, 'compteurs'), null);
  assert.strictEqual(rapport.dossierSystemeDepuisAncrage(a, '..'), null);
  assert.strictEqual(rapport.dossierSystemeDepuisAncrage(a, 'a\\b'), null);
  assert.strictEqual(rapport.dossierSystemeDepuisAncrage(a, ''), null);
  assert.ok(fs.readFileSync(MODULE, 'utf8').indexOf(rapport.SEGMENT_APPLICATION) === -1,
    'le segment de l’application est recopié dans compteurs.js');
});

test('SZH_RESEAU_INTERDIT ou la simulation du lanceur, sans SZH_COMPTEURS : aucun fichier nulle part', () => {
  for (const variable of [{ SZH_RESEAU_INTERDIT: '1' }, { SZH_LANCEUR_SIMULE: '1' }]) {
    const p = poste(Object.assign({ SZH_COMPTEURS: null }, variable));
    try {
      const ancrage = path.join(p.travail, 'Daten_Allgemein - General');
      fs.mkdirSync(ancrage, { recursive: true });
      process.env.SZH_ANCRAGE = ancrage;
      const r = compteurs.ecrireCompteurs({ source: 'import', mesures: { auteurs: 1 } });
      assert.strictEqual(r.motif, 'harnais-test');
      assert.strictEqual(r.ecrit || r.enAttente, false);
      // Un fichier déjà en attente : le vidage ne doit pas le pousser vers le dossier partagé.
      fs.mkdirSync(p.file, { recursive: true });
      fs.writeFileSync(path.join(p.file, '20260101-X-import-aaaaaa.csv'), 'x');
      assert.strictEqual(compteurs.viderFileCompteurs().deplaces, 0);
      assert.strictEqual(csvDe(p.file).length, 1, 'le vidage a touché la file sous la garde');
      const n = poserNumero(p.travail, [{ slug: 'a', fichier: 'a.docx' }]);
      assert.strictEqual(compteurs.enregistrerImportDepuisJournal(n.racine).ecrits, 0);
      assert.deepStrictEqual(fs.readdirSync(p.travail).sort(), ['Base', 'Daten_Allgemein - General', 'Local', 'numero']);
      assert.strictEqual(csvDe(p.file).length, 1, 'la file d’attente a reçu un fichier sous la garde');
      assert.strictEqual(fs.existsSync(path.join(ancrage, '2_Produkte')), false, 'le dossier partagé a été créé');
      // SZH_COMPTEURS lève la garde : c'est ainsi que ces essais-ci écrivent.
      process.env.SZH_COMPTEURS = p.compteurs;
      assert.strictEqual(compteurs.ecrireCompteurs({ source: 'import', mesures: { auteurs: 1 } }).ecrit, true);
    } finally { p.fin(); }
  }
});

test('la file d’attente garde 200 fichiers et 90 jours, pas plus', () => {
  const p = poste();
  try {
    fs.mkdirSync(p.file, { recursive: true });
    const maintenant = Date.now();
    for (let i = 0; i < 205; i++) {
      const f = path.join(p.file, '20260101-X-import-' + String(i).padStart(6, '0') + '.csv');
      fs.writeFileSync(f, 'x');
      const t = new Date(maintenant - (i + 1) * 1000);
      fs.utimesSync(f, t, t);
    }
    const vieux = path.join(p.file, '20250101-X-import-ffffff.csv');
    fs.writeFileSync(vieux, 'x');
    const t = new Date(maintenant - 100 * 24 * 3600 * 1000);
    fs.utimesSync(vieux, t, t);
    const restes = rapport.purgerDossierAttente(p.file, '.csv', rapport.PLAFONDS_ATTENTE_COMPTEURS);
    assert.strictEqual(restes.length, 200);
    assert.strictEqual(fs.existsSync(vieux), false);
    assert.strictEqual(csvDe(p.file).length, 200);
    // Les plus anciens partent d'abord.
    assert.strictEqual(fs.existsSync(path.join(p.file, '20260101-X-import-000204.csv')), false);
    assert.strictEqual(fs.existsSync(path.join(p.file, '20260101-X-import-000000.csv')), true);
    assert.deepStrictEqual(rapport.PLAFONDS_ATTENTE_COMPTEURS, { fichiers: 200, jours: 90 });
  } finally { p.fin(); }
});

// ---------------------------------------------------------------------------------------
// 5. Le contexte
// ---------------------------------------------------------------------------------------

test('le contexte vaut dev selon la CLI, l’instance de dev, le toolkit en jonction ou config.json', () => {
  let p = poste();
  try { assert.strictEqual(compteurs.contexteCompteurs(), 'prod'); } finally { p.fin(); }
  p = poste({ SZH_MANUSCRIT_CLI: '1' });
  try { assert.strictEqual(compteurs.contexteCompteurs(), 'dev'); } finally { p.fin(); }
  p = poste({ SZH_CODIUM_PROFIL: path.join(os.tmpdir(), 'codium') });
  try { assert.strictEqual(compteurs.contexteCompteurs(), 'dev'); } finally { p.fin(); }
  p = poste();
  try {
    fs.writeFileSync(path.join(p.base, 'config.json'), '\uFEFF{"compteurs": "dev"}');
    assert.strictEqual(compteurs.contexteCompteurs(), 'dev');
    fs.writeFileSync(path.join(p.base, 'config.json'), '{"compteurs": "prod"}');
    assert.strictEqual(compteurs.contexteCompteurs(), 'prod');
  } finally { p.fin(); }
  p = poste();
  try {
    const depot = path.join(p.travail, 'depot');
    fs.mkdirSync(depot);
    fs.symlinkSync(depot, path.join(p.base, 'toolkit'), 'junction');
    assert.strictEqual(compteurs.contexteCompteurs(), 'dev');
    const r = compteurs.ecrireCompteurs({ source: 'import', mesures: { auteurs: 1 } });
    assert.ok(tout(p.compteurs).indexOf(';dev;') !== -1, 'la ligne doit porter contexte=dev');
    assert.strictEqual(r.ecrit, true);
  } finally { p.fin(); }
  p = poste();
  try {
    fs.mkdirSync(path.join(p.base, 'toolkit'));
    assert.strictEqual(compteurs.contexteCompteurs(), 'prod', 'un vrai dossier toolkit est la production');
  } finally { p.fin(); }
});

test('le nom du poste est en majuscules, réduit à [A-Z0-9-]', () => {
  const vrai = os.hostname;
  try {
    os.hostname = () => 'rmo desk.é_01;x';
    assert.strictEqual(compteurs.posteCompteurs(), 'RMODESK01X');
    os.hostname = () => '';
    assert.strictEqual(compteurs.posteCompteurs(), 'POSTE');
    os.hostname = () => { throw new Error('indisponible'); };
    assert.strictEqual(compteurs.posteCompteurs(), 'POSTE');
  } finally { os.hostname = vrai; }
});

test('les versions viennent du toolkit installé et de l’état du poste, nettoyées', () => {
  const p = poste();
  try {
    fs.mkdirSync(path.join(p.base, 'toolkit'), { recursive: true });
    fs.writeFileSync(path.join(p.base, 'toolkit', 'VERSION'), '2.7.0\r\n');
    fs.writeFileSync(path.join(p.base, 'state.json'), JSON.stringify({ rootfs: '2.6.1; drop table' }));
    compteurs.ecrireCompteurs({ source: 'import', mesures: { auteurs: 1 } });
    const l = compteurs.analyserCsvCompteurs(tout(p.compteurs)).lignes[0];
    assert.strictEqual(l.version_toolkit, '2.7.0');
    assert.strictEqual(l.version_rootfs, '2.6.1droptable');
  } finally { p.fin(); }
});

// ---------------------------------------------------------------------------------------
// 6. La synthèse
// ---------------------------------------------------------------------------------------

function ecrireFichier(dossier, nom, contexte, source, date, mesures, passage) {
  fs.mkdirSync(dossier, { recursive: true });
  const { lignes } = compteurs.assainirMesures(mesures);
  const texte = compteurs.construireCsv({ date: date, poste: 'POSTE1', contexte: contexte, versionToolkit: '2.7.0',
    versionRootfs: '2.7.0', source: source, passage: passage || 'aaaaaaaaaaaa' }, lignes);
  fs.writeFileSync(path.join(dossier, nom), texte);
}

// Un jeu dont on connaît chaque total.
function monterJeu(dossier) {
  // Trois passages du nettoyeur (prod), 10000 + 20000 + 10000 = 40000 signes.
  ecrireFichier(dossier, '20260901-P-nettoyeur-000001.csv', 'prod', 'nettoyeur', '2026-09-01', {
    'issue.alertes': 1, signes: 10000, 'regle:APA.CitationAbsente:revision': 8, 'regle:APA.CitationAbsente:rapport': 2,
    'regle:SZH.Epicene:commentaire': 4, 'regle:Zed.Tiers:revision': 2, 'regle:Zed.Tiers:rapport': 1,
    'plafond_commentaires_atteint': 1,
    'reseau.crossref.panne': 1, 'doi.proposes': 2, 'orcid.proposes': 1 }, '111111111111');
  ecrireFichier(dossier, '20260902-P-nettoyeur-000002.csv', 'prod', 'nettoyeur', '2026-09-02', {
    'issue.alertes': 1, signes: 20000, 'regle:APA.CitationAbsente:revision': 10, 'regle:SZH.Epicene:commentaire': 6,
    'regle:Typo.Guillemets:rapport': 6, 'reseau.ror.panne': 1, 'doi.proposes': 1 }, '222222222222');
  ecrireFichier(dossier, '20260903-P-nettoyeur-000003.csv', 'prod', 'nettoyeur', '2026-09-03', {
    'issue.refus:docx-invalide': 1 }, '333333333333');
  ecrireFichier(dossier, '20260904-P-nettoyeur-000004.csv', 'prod', 'nettoyeur', '2026-09-04', {
    'issue.plantage': 1, 'issue.interrompu': 0, signes: 10000, 'mesure.inconnue-du-futur': 7 }, '444444444444');
  // Deux articles importés (prod) : 5 auteurs, 2 avec ORCID, 1 avec ROR ; un réimport.
  ecrireFichier(dossier, '20260905-P-import-000005.csv', 'prod', 'import', '2026-09-05', {
    auteurs: 3, auteurs_orcid: 2, auteurs_ror: 1, 'import.code:bloc-mal-forme': 2, 'import.code:langue-deduite': 1,
    langue_deduite: 1 });
  ecrireFichier(dossier, '20260906-P-import-000006.csv', 'prod', 'import', '2026-09-06', {
    auteurs: 2, auteurs_orcid: 0, auteurs_ror: 0, 'import.code:bloc-mal-forme': 1 });
  ecrireFichier(dossier, '20260907-P-import-000007.csv', 'prod', 'import', '2026-09-07', {
    'import.code:tableau-en-conflit': 1 });
  // Un fichier de développement : exclu par défaut.
  ecrireFichier(dossier, '20260908-D-nettoyeur-000008.csv', 'dev', 'nettoyeur', '2026-09-08', {
    signes: 99999, 'regle:Dev.Bruit:rapport': 50 });
  // Les fichiers que la synthèse doit tolérer.
  fs.writeFileSync(path.join(dossier, '20260909-P-nettoyeur-000009.csv'), Buffer.from([0xFF, 0xFE, 0x00, 0x01, 0x80]));
  fs.writeFileSync(path.join(dossier, '20260910-P-import-00000a.csv'), 'date;autre;entete\r\n2026-09-10;x;1\r\n');
  fs.writeFileSync(path.join(dossier, '20260911-P-import-00000b.csv'),
    '\uFEFF' + ENTETE + '\r\n2026-09-11;P;prod;2.7.0;;import;aaaaaaaaaaaa;auteurs;douze\r\n2026-09-11;P;prod;2.7.0;;import;aaaaaaaaaaaa;auteurs;1,5\r\n');
  fs.writeFileSync(path.join(dossier, '~$20260912-P-import-00000c.csv.123'), 'orphelin');
  fs.writeFileSync(path.join(dossier, 'lisez-moi.txt'), 'pas un compteur');
  // Un « fichier » qu'on ne peut pas lire (ici un dossier nommé .csv).
  fs.mkdirSync(path.join(dossier, '20260913-P-import-0000dd.csv'));
}

test('synthèse : les chiffres attendus, les fichiers corrompus tolérés', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-synth-'));
  try {
    monterJeu(dossier);
    const r = synthese.synthetiser(dossier, { contexte: 'prod' }, new Date(2026, 8, 30));
    const a = r.agregat;
    assert.strictEqual(a.lecture.illisibles, 1, 'un fichier illisible est compté, pas fatal');
    assert.strictEqual(a.lecture.entetes, 2, 'le binaire et l’en-tête différent sont comptés et ignorés');
    assert.strictEqual(a.lecture.invalides, 2);
    assert.strictEqual(a.passages, 4);
    assert.strictEqual(a.signes, 40000);
    const regle = (id) => a.regles.find((x) => x.regle === id);
    assert.deepStrictEqual([regle('APA.CitationAbsente').revision, regle('APA.CitationAbsente').rapport,
      regle('APA.CitationAbsente').total], [18, 2, 20]);
    assert.strictEqual(regle('APA.CitationAbsente').pourMillion, 500);       // 20 alertes / 40000 signes
    assert.strictEqual(regle('APA.CitationAbsente').rapportPourMille, 100);
    assert.strictEqual(regle('SZH.Epicene').total, 10);
    assert.strictEqual(regle('Typo.Guillemets').rapportPourMille, 1000);
    assert.strictEqual(regle('Dev.Bruit'), undefined, 'le contexte dev est exclu par défaut');
    assert.strictEqual(a.plafond, 1);
    assert.deepStrictEqual(a.refus, [['docx-invalide', 1]]);
    assert.strictEqual(a.issues.plantage, 1);
    assert.strictEqual(a.reseau.find((s) => s.cle === 'crossref').pannes, 1);
    assert.strictEqual(a.reseau.find((s) => s.cle === 'ror').pannes, 1);
    assert.strictEqual(a.reseau.find((s) => s.cle === 'orcid').pannes, 0);
    assert.strictEqual(a.proposes.find((s) => s.cle === 'doi.proposes').n, 3);
    assert.strictEqual(a.import.articles, 2, 'le réimport n’est pas un article converti');
    assert.strictEqual(a.import.auteurs, 5);
    assert.deepStrictEqual(a.codesImport, [['bloc-mal-forme', 3], ['langue-deduite', 1], ['tableau-en-conflit', 1]]);
    assert.strictEqual(a.toutes.get('mesure.inconnue-du-futur'), 7, 'une mesure inconnue est gardée telle quelle');

    // La page.
    assert.ok(r.html.indexOf('APA.CitationAbsente') !== -1 && r.html.indexOf('mesure.inconnue-du-futur') !== -1);
    assert.ok(!/undefined|\[object|NaN/.test(r.html), 'la page montre une valeur absente');
    assert.ok(r.html.indexOf('0,50') !== -1, 'densité de APA.CitationAbsente : 0,50 pour 1000 signes');
    assert.ok(r.html.indexOf('<script') === -1 && r.html.indexOf('http://') === -1 && r.html.indexOf('https://') === -1);
    assert.ok(r.html.indexOf('20260901') === -1 && r.html.indexOf('POSTE1') === -1,
      'la page ne reprend ni les noms de fichier ni le poste');
    // À examiner : la plus bruyante d'abord, puis celle qui finit en rapport.
    assert.strictEqual(r.vue.examiner[0].regle, 'APA.CitationAbsente');
    assert.ok(r.vue.examiner.some((e) => e.regle === 'Typo.Guillemets' && /rapport/.test(e.raison)));
    assert.ok(r.vue.examiner.length >= 1 && r.vue.examiner.length <= 5);

    // Le CSV : que des entiers, BOM, CRLF, en-tête.
    assert.strictEqual(r.csv.charCodeAt(0), 0xFEFF);
    const lignes = r.csv.slice(1).split('\r\n').filter((l) => l !== '');
    assert.strictEqual(lignes[0], 'section;cle;detail;valeur');
    for (const l of lignes.slice(1)) {
      const c = l.split(';');
      assert.strictEqual(c.length, 4, l);
      assert.match(c[3], /^\d+$/, 'une valeur de synthèse n’est pas un entier : ' + l);
    }
    assert.ok(lignes.indexOf('regle;Zed.Tiers;rapport_pour_1000;333') !== -1, 'un tiers s’écrit 333, jamais 333,33');
    assert.ok(lignes.indexOf('import_auteurs;orcid_pour_1000;;400') !== -1);
    assert.ok(lignes.indexOf('import_auteurs;ror_pour_1000;;200') !== -1);
    assert.ok(lignes.indexOf('regle;APA.CitationAbsente;pour_million_signes;500') !== -1);
    assert.ok(lignes.indexOf('import_code;bloc-mal-forme;pour_1000_articles;1500') !== -1);
    assert.ok(lignes.indexOf('plafond_commentaires;pour_1000_passages;;250') !== -1);
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

test('synthèse : les filtres de contexte et de date', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-synth-'));
  try {
    monterJeu(dossier);
    const tous = synthese.synthetiser(dossier, { contexte: 'tous' }, new Date(2026, 8, 30)).agregat;
    assert.strictEqual(tous.signes, 40000 + 99999);
    assert.ok(tous.regles.some((x) => x.regle === 'Dev.Bruit'));
    const dev = synthese.synthetiser(dossier, { contexte: 'dev' }, new Date(2026, 8, 30)).agregat;
    assert.strictEqual(dev.passages, 1);
    assert.strictEqual(dev.import.articles, 0);
    const fenetre = synthese.synthetiser(dossier, { contexte: 'prod', depuis: '2026-09-02', jusqua: '2026-09-04' },
      new Date(2026, 8, 30)).agregat;
    assert.strictEqual(fenetre.passages, 3);
    assert.strictEqual(fenetre.signes, 30000);
    assert.strictEqual(fenetre.import.articles, 0);
    const vide = synthese.synthetiser(dossier, { contexte: 'prod', depuis: '2030-01-01' }, new Date(2026, 8, 30));
    assert.strictEqual(vide.agregat.passages, 0);
    assert.ok(!/undefined|\[object|NaN/.test(vide.html));
    assert.ok(vide.vue.examiner.length === 0);
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

test('synthèse : un dossier vide ou absent ne plante pas', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-synth-'));
  try {
    const r = synthese.synthetiser(dossier, { contexte: 'prod' }, new Date());
    assert.strictEqual(r.agregat.lecture.lus, 0);
    assert.ok(r.html.indexOf('</html>') !== -1);
    assert.throws(() => synthese.synthetiser(path.join(dossier, 'absent'), { contexte: 'prod' }, new Date()));
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

test('synthèse en ligne de commande : écrit la page et le CSV, --purger ne supprime que le vieux', () => {
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-synth-cli-'));
  try {
    const dossier = path.join(travail, 'compteurs');
    const sortie = path.join(travail, 'sortie');
    const aujourdhui = new Date();
    const il_y_a = (mois) => rapport.formaterJourLocal(new Date(aujourdhui.getFullYear(), aujourdhui.getMonth() - mois, aujourdhui.getDate()));
    const vieux = il_y_a(25);
    const limite = il_y_a(23);
    ecrireFichier(dossier, vieux.replace(/-/g, '') + '-P-import-aaaaaa.csv', 'prod', 'import', vieux, { auteurs: 1 });
    ecrireFichier(dossier, limite.replace(/-/g, '') + '-P-import-bbbbbb.csv', 'prod', 'import', limite, { auteurs: 1 });
    fs.writeFileSync(path.join(dossier, 'notes.csv'), 'pas de date dans le nom');
    const env = Object.assign({}, process.env);
    for (const v of VARIABLES) { delete env[v]; }
    const lancer = (args) => spawnSync(process.execPath, [SYNTHESE, '--dossier', dossier, '--sortie', sortie, '--contexte', 'tous'].concat(args),
      { encoding: 'utf8', env: env });

    let r = lancer([]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.ok, true);
    assert.ok(fs.existsSync(out.html) && fs.existsSync(out.csv));
    assert.strictEqual(out.purges, undefined);
    assert.strictEqual(csvDe(dossier).length, 3, 'sans --purger rien n’est supprimé');

    r = lancer(['--purger']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(JSON.parse(r.stdout).purges, 1);
    assert.deepStrictEqual(csvDe(dossier), [limite.replace(/-/g, '') + '-P-import-bbbbbb.csv', 'notes.csv']);

    r = lancer(['--depuis', 'hier']);
    assert.strictEqual(r.status, 1);
    assert.strictEqual(JSON.parse(r.stdout).ok, false);
    r = lancer(['--inconnu']);
    assert.strictEqual(r.status, 1);
  } finally { fs.rmSync(travail, { recursive: true, force: true }); }
});

test('synthèse : sans --dossier, le dossier résolu par SZH_COMPTEURS', () => {
  const p = poste();
  try {
    compteurs.ecrireCompteurs({ source: 'import', mesures: { auteurs: 4, auteurs_orcid: 1 } });
    const sortie = path.join(p.travail, 'sortie');
    const r = spawnSync(process.execPath, [SYNTHESE, '--sortie', sortie], { encoding: 'utf8', env: process.env });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.readFileSync(JSON.parse(r.stdout).csv, 'utf8').indexOf('import_auteurs;auteurs;;4') !== -1);
  } finally { p.fin(); }
});

// ---------------------------------------------------------------------------------------
// 7. Le câblage dans le cockpit
// ---------------------------------------------------------------------------------------

test('extension.js appelle les compteurs aux trois endroits prévus, et nulle part ailleurs', () => {
  // La relecture du journal vit dans lib/controles-hote.js : les deux fichiers sont lus ensemble.
  const src = fs.readFileSync(path.join(COCKPIT, 'extension.js'), 'utf8')
    + fs.readFileSync(path.join(COCKPIT, 'lib', 'controles-hote.js'), 'utf8');
  const appels = (nom) => (src.match(new RegExp('compteurs\\.' + nom + '\\(', 'g')) || []).length;
  assert.strictEqual(appels('enregistrerImportDepuisJournal'), 1);
  assert.strictEqual(appels('enregistrerReimport'), 1);
  assert.strictEqual(appels('viderFileCompteurs'), 1);
  assert.strictEqual((src.match(/compteurs\.ecrireCompteurs\(/g) || []).length, 0);
  // Les deux premiers sont sous garde : un compteur ne fait pas échouer la compilation.
  assert.match(src, /try \{ compteurs\.enregistrerImportDepuisJournal\(racine\); \} catch/);
  assert.match(src, /try \{ compteurs\.enregistrerReimport\(r\.json\); \} catch/);
  // Le réimport annulé ne compte pas.
  assert.match(src, /if \(reussi && !annulation\) \{ try \{ compteurs\.enregistrerReimport/);
});

// Les Id Vale réels portent un tiret (« CSPS-Biblio.APA.DoiForme ») : ils ne tombent pas dans
// « Autre ». Un Id en minuscules (forme d'un slug) y tombe toujours.
test('compteurs : Id de règle à tiret gardé, Id en minuscules ramené à Autre', () => {
  assert.equal(compteurs.normaliserMesure('regle:CSPS-Biblio.APA.DoiForme:revision', 'nettoyeur'),
    'regle:CSPS-Biblio.APA.DoiForme:revision');
  assert.equal(compteurs.normaliserMesure('regle:dupont-2021.x:revision', 'nettoyeur'),
    'regle:Autre:revision');
});
