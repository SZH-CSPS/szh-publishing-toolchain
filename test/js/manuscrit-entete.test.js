// pipeline/manuscrit_entete.py : reconnaissance de l'en-tête d'un manuscrit (titre,
// sous-titre, auteurs, résumé, mots-clés, DOI, ligne de revue) — §5.5 de
// outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md.
//
//   node --test test/js/manuscrit-entete.test.js
//
// Module PUR : ce fichier passe par le mode --diagnostic, patron de
// test/js/manuscrit-decisions.test.js pour manuscrit_modele.py — un Document JSON (même
// schéma, documenté en tête de manuscrit_modele.py) plus la langue du produit, sur stdin.
//
// Contrôles couverts (brief de chantier) : titre + sous-titre sur deux lignes ; titre avec
// deux-points sur sa propre ligne ; 1, 2 et 3 auteurs (byline groupée, lignes séparées avec
// institution/e-mail, ORCID) ; résumé après marqueur (jusqu'aux mots-clés) ; résumé absent
// (rien inventé) ; mots-clés ; DOI ; en-tête vide (document qui commence par un intertitre) ;
// et un test de bout en bout (fabriquerDocx -> manuscrit-nettoyer.py -> pronto-lire.py).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const PIPELINE = path.join(RACINE, 'pipeline');
const MANUSCRIT_ENTETE = path.join(PIPELINE, 'manuscrit_entete.py');
const NETTOYEUR = path.join(PIPELINE, 'manuscrit-nettoyer.py');
const PRONTO_LIRE = path.join(PIPELINE, 'pronto-lire.py');

const ENV_UTF8 = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });

function python(args, opts) {
  return cp.spawnSync(PYTHON, args,
    Object.assign({ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 }, opts || {}));
}

function dossierJetable(prefixe) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixe || 'szh-manuscritentete-'));
}

// Lance manuscrit_entete.py --diagnostic sur {langue, document}, rend {entete,
// indices_consommes, trace, document} déjà parsé.
function diagnostiquer(blocs, langue) {
  const document = { styles: [], langue: '', blocs };
  const r = cp.spawnSync(PYTHON, [MANUSCRIT_ENTETE, '--diagnostic'], {
    input: JSON.stringify({ langue: langue || 'fr', document }), encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, 'manuscrit_entete.py --diagnostic a échoué : ' + r.stderr);
  const lignes = r.stdout.trim().split('\n');
  return JSON.parse(lignes[lignes.length - 1]);
}

// Un paragraphe minimal : un seul fragment de texte, forme réduite aux clés fournies —
// patron `para()` de test/js/manuscrit-decisions.test.js.
function para(texte, opts = {}) {
  const { taille, gras, italique } = opts;
  const forme = {};
  if (taille !== undefined) { forme.taille = taille; }
  if (gras !== undefined) { forme.gras = gras; }
  if (italique !== undefined) { forme.italique = italique; }
  return { style: '', fragments: [{ texte, forme }] };
}

// ---------------------------------------------------------------------------------------
// 1. Titre + sous-titre sur deux lignes, même signature, sans ponctuation finale.

test('extraire_entete : titre et sous-titre sur deux lignes de même signature, sans ponctuation finale',
  { skip: sansPython }, () => {
    const out = diagnostiquer([
      para('Un grand titre de recherche', { taille: 32, gras: true }),
      para('un sous-titre explicatif', { taille: 32, gras: true }),
      para('Introduction'),
    ]);
    assert.strictEqual(out.entete.titre, 'Un grand titre de recherche');
    assert.strictEqual(out.entete.sous_titre, 'un sous-titre explicatif');
    assert.deepStrictEqual(out.indices_consommes, { 0: 'titre', 1: 'sous_titre' });
    // L'en-tête a bien quitté le corps : il ne reste que l'intertitre.
    assert.strictEqual(out.document.blocs.length, 1);
    assert.strictEqual(out.document.blocs[0].fragments[0].texte, 'Introduction');
  });

test('extraire_entete : titre finissant par « : », sous-titre sur la ligne suivante',
  { skip: sansPython }, () => {
    const out = diagnostiquer([
      para('Informations sur les autrices et auteurs :'),
      para('une precision de meme mise en forme'),
      para('Introduction'),
    ]);
    assert.strictEqual(out.entete.titre, 'Informations sur les autrices et auteurs');
    assert.strictEqual(out.entete.sous_titre, 'une precision de meme mise en forme');
  });

// ---------------------------------------------------------------------------------------
// 2. Titre avec deux-points sur sa PROPRE ligne (scinder_titre, repli à une seule ligne).

test('extraire_entete : titre scindé sur le deux-points de sa propre ligne (une seule ligne)',
  { skip: sansPython }, () => {
    const out = diagnostiquer([
      para('Inclusion scolaire : le role de l enseignant'),
      para('Introduction'),
    ]);
    assert.strictEqual(out.entete.titre, 'Inclusion scolaire');
    assert.strictEqual(out.entete.sous_titre, 'le role de l enseignant');
    assert.deepStrictEqual(out.indices_consommes, { 0: 'titre' });
  });

// ---------------------------------------------------------------------------------------
// 3. Auteurs — 1, 2 et 3, byline groupée et lignes séparées avec institution/e-mail/ORCID.

test('extraire_entete : un seul auteur, une seule ligne', { skip: sansPython }, () => {
  const out = diagnostiquer([para('Un titre'), para('Jean Dupont'), para('Introduction')]);
  assert.strictEqual(out.entete.auteurs.length, 1);
  assert.strictEqual(out.entete.auteurs[0].prenom, 'Jean');
  assert.strictEqual(out.entete.auteurs[0].nom, 'Dupont');
});

test('extraire_entete : deux auteurs sur des lignes séparées, chacun avec institution et e-mail',
  { skip: sansPython }, () => {
    const out = diagnostiquer([
      para('Un titre'),
      para('Jean Dupont'),
      para('Universite de Geneve, jean.dupont@unige.ch'),
      para('Marie Martin'),
      para('HEP Vaud, marie.martin@hepvd.ch'),
      para('Introduction'),
    ]);
    assert.strictEqual(out.entete.auteurs.length, 2);
    assert.strictEqual(out.entete.auteurs[0].nom, 'Dupont');
    assert.strictEqual(out.entete.auteurs[0].institution, 'Universite de Geneve');
    assert.strictEqual(out.entete.auteurs[0].email, 'jean.dupont@unige.ch');
    assert.strictEqual(out.entete.auteurs[1].nom, 'Martin');
    assert.strictEqual(out.entete.auteurs[1].institution, 'HEP Vaud');
    assert.strictEqual(out.entete.auteurs[1].email, 'marie.martin@hepvd.ch');
  });

test('extraire_entete : trois auteurs sur une seule byline, ORCID sur la ligne suivante non attribué',
  { skip: sansPython }, () => {
    const out = diagnostiquer([
      para('Un titre'),
      para('Jean Dupont, Marie Martin et Paul Durand'),
      para('ORCID 0000-0001-2345-6789'),
      para('Introduction'),
    ]);
    assert.strictEqual(out.entete.auteurs.length, 3);
    assert.deepStrictEqual(out.entete.auteurs.map((a) => a.nom), ['Dupont', 'Martin', 'Durand']);
    // Trois noms déclarés ENSEMBLE : la ligne d'ORCID qui suit ne peut être attribuée à
    // l'un d'eux sans deviner — elle est consommée (elle ne doit pas rester dans le corps)
    // mais aucun champ n'est rempli.
    assert.ok(out.entete.auteurs.every((a) => a.orcid === ''),
      'aucun ORCID ne doit être deviné quand trois noms sont déclarés ensemble');
    assert.strictEqual(out.indices_consommes[2], 'auteurs');
  });

test('extraire_entete : ORCID rattaché au bon auteur quand les noms sont sur des lignes séparées',
  { skip: sansPython }, () => {
    const out = diagnostiquer([
      para('Un titre'),
      para('Jean Dupont'),
      para('ORCID 0000-0001-2345-6789'),
      para('Introduction'),
    ]);
    assert.strictEqual(out.entete.auteurs.length, 1);
    assert.strictEqual(out.entete.auteurs[0].orcid, '0000-0001-2345-6789');
    // L'étiquette « ORCID » elle-même ne doit pas polluer un autre champ.
    assert.strictEqual(out.entete.auteurs[0].fonction, '');
    assert.strictEqual(out.entete.auteurs[0].institution, '');
  });

// ---------------------------------------------------------------------------------------
// 4. Résumé — capturé après son marqueur jusqu'au marqueur suivant ; absent -> rien inventé.

test('extraire_entete : résumé capturé après son marqueur, jusqu\'aux mots-clés',
  { skip: sansPython }, () => {
    const out = diagnostiquer([
      para('Un titre'),
      para('Resume : Un texte de resume tout a fait normal pour ce test.'),
      para('Mots-cles : pedagogie, inclusion'),
      para('Introduction'),
    ]);
    assert.strictEqual(out.entete.resume, 'Un texte de resume tout a fait normal pour ce test.');
    assert.strictEqual(out.entete.langue_resume, 'fr');
    assert.deepStrictEqual(out.entete.mots_cles, ['pedagogie', 'inclusion']);
    assert.strictEqual(out.indices_consommes[1], 'resume');
  });

test('extraire_entete : résumé sur deux paragraphes, capturé jusqu\'au marqueur suivant',
  { skip: sansPython }, () => {
    const out = diagnostiquer([
      para('Un titre'),
      para('Resume :'),
      para('Un texte de resume qui continue sur un second paragraphe distinct.'),
      para('Mots-cles : pedagogie'),
      para('Introduction'),
    ]);
    assert.strictEqual(out.entete.resume,
      'Un texte de resume qui continue sur un second paragraphe distinct.');
    assert.deepStrictEqual(out.indices_consommes, {
      0: 'titre', 1: 'resume', 2: 'resume', 3: 'mots_cles',
    });
  });

test('extraire_entete : résumé absent, rien n\'est inventé', { skip: sansPython }, () => {
  const out = diagnostiquer([para('Un titre'), para('Introduction')]);
  assert.strictEqual(out.entete.resume, '');
  assert.strictEqual(out.entete.langue_resume, '');
  assert.deepStrictEqual(out.entete.resumes_autres, {});
});

// ---------------------------------------------------------------------------------------
// 5. Mots-clés seuls.

test('extraire_entete : mots-clés seuls, découpés sur la virgule', { skip: sansPython }, () => {
  const out = diagnostiquer([
    para('Un titre'), para('Mots-cles : pedagogie, inclusion, ecole'), para('Introduction'),
  ]);
  assert.deepStrictEqual(out.entete.mots_cles, ['pedagogie', 'inclusion', 'ecole']);
});

// ---------------------------------------------------------------------------------------
// 6. DOI.

test('extraire_entete : DOI reconnu et nettoyé', { skip: sansPython }, () => {
  const out = diagnostiquer([
    para('Un titre'), para('DOI : 10.57161/r2023-03-08'), para('Introduction'),
  ]);
  assert.strictEqual(out.entete.doi, '10.57161/r2023-03-08');
  assert.strictEqual(out.indices_consommes[1], 'doi');
});

// ---------------------------------------------------------------------------------------
// 7. En-tête vide : le document commence directement par un intertitre connu.
//
// Sabotage minimal (vérifié pendant ce chantier) : dans extraire_entete(), retirer le
// contrôle RE_INTERTITRE_CONNU.match(texte) qui précède la détection du titre — la ligne
// « Introduction » se fait alors passer pour LE titre de l'article, et ce contrôle rougit
// (indices_consommes cesse d'être vide, entete.titre devient « Introduction »).

test('extraire_entete : document qui commence par un intertitre connu -> rien consommé',
  { skip: sansPython }, () => {
    const out = diagnostiquer([
      para('Introduction'),
      para('Un corps de texte tout a fait ordinaire qui suit.'),
    ]);
    assert.deepStrictEqual(out.indices_consommes, {});
    assert.strictEqual(out.entete.titre, '');
    assert.strictEqual(out.entete.auteurs.length, 0);
    assert.strictEqual(out.entete.resume, '');
    assert.strictEqual(out.document.blocs.length, 2, 'rien ne doit avoir été retiré du corps');
  });

// ---------------------------------------------------------------------------------------
// 8. Un long paragraphe de corps (>= 300 signes) qui n'est ni un marqueur ni un intertitre
// arrête aussi la zone d'en-tête — même sans intertitre connu.

test('extraire_entete : un long paragraphe de corps clôt la zone d\'en-tête, sans intertitre',
  { skip: sansPython }, () => {
    const long = 'Un paragraphe de corps ordinaire, bien assez long pour dépasser le seuil. '.repeat(6);
    const out = diagnostiquer([para('Un titre'), para(long)]);
    assert.strictEqual(out.indices_consommes[1], undefined, 'le long paragraphe ne doit pas être consommé');
    assert.strictEqual(out.document.blocs.length, 1);
  });

// ---------------------------------------------------------------------------------------
// 8 bis. Révision du 21.09.2026 (superviseur, mesuré sur 1_Résumé-article-revue-CSPS.docx) :
// une ligne « Nom, Prénom, institution, téléphone, e-mail » — TOUT sur une seule ligne,
// virgules — est UNE fiche, jamais un « non attribué ». Le numéro de téléphone n'a aucun
// champ dans le schéma EnTete.auteurs : il est écarté, tracé, jamais collé à fonction/
// institution.
//
// Sabotage minimal (vérifié pendant ce chantier) : dans extraire_entete(), retirer le bloc
// `resultat_virgule = _tenter_nom_virgule_avec_info(texte) ... continue` (le remplacer par
// un simple `pass`) — la ligne retombe sur _est_ligne_auteur(), sans auteur déjà connu pour
// la recevoir : elle devient « auteur_info_non_attribuee » et entete.auteurs reste VIDE.

test('extraire_entete : « Nom, Prénom, institution, téléphone, e-mail » sur une seule ligne -> une fiche, téléphone écarté',
  { skip: sansPython }, () => {
    const out = diagnostiquer([
      para('Un titre'),
      para('Protti, Delphine, HEP-VD, +41 79 507 58 10, delphine.protti@edu-vd.ch'),
      para('Introduction'),
    ]);
    assert.strictEqual(out.entete.auteurs.length, 1);
    const a = out.entete.auteurs[0];
    assert.strictEqual(a.nom, 'Protti');
    assert.strictEqual(a.prenom, 'Delphine');
    assert.strictEqual(a.institution, 'HEP-VD');
    assert.strictEqual(a.email, 'delphine.protti@edu-vd.ch');
    assert.strictEqual(a.fonction, '', 'le téléphone ne doit atterrir dans aucun champ');
    assert.strictEqual(out.indices_consommes[1], 'auteurs');
  });

test('extraire_entete : quatre autrices « Nom, Prénom, institution, tel, e-mail », une ligne chacune',
  { skip: sansPython }, () => {
    const out = diagnostiquer([
      para('Un titre'),
      para('Protti, Delphine, HEP-VD, +41 79 507 58 10, delphine.protti@edu-vd.ch'),
      para('Tevaearai, Delphine, HEP-VD, +41 79 866 87 58, delphine.tevaearai@edu-vd.ch'),
      para('Allenbach, Marco, HEP-VD, +41 79 427 18 12, marco.allenbach@hepl.ch'),
      para('Gabola, Piera, HEP-VD, +41 79 838 76 79, piera.gabola@hepl.ch'),
      para('Introduction'),
    ]);
    assert.strictEqual(out.entete.auteurs.length, 4);
    assert.deepStrictEqual(out.entete.auteurs.map((a) => a.nom),
      ['Protti', 'Tevaearai', 'Allenbach', 'Gabola']);
    assert.deepStrictEqual(out.entete.auteurs.map((a) => a.prenom),
      ['Delphine', 'Delphine', 'Marco', 'Piera']);
    assert.ok(out.entete.auteurs.every((a) => a.institution === 'HEP-VD'));
    assert.ok(out.entete.auteurs.every((a) => a.email));
  });

// ---------------------------------------------------------------------------------------
// 8 ter. Révision du 21.09.2026 (superviseur, mesuré sur
// 3bis_CSPS_Revue3_2026_FLOW_Piloting_OFP.docx) : un résumé doit s'arrêter DUR — au premier
// paragraphe court entièrement en gras (pseudo-titre non détecté par classer_titres(), qui
// tourne APRÈS ce module), et de toute façon au-delà de PLAFOND_RESUME_SIGNES signes ou
// PLAFOND_RESUME_PARAGRAPHES paragraphes — jamais avaler le reste du document.
//
// Sabotage minimal (vérifié pendant ce chantier) : dans extraire_entete(), remplacer
// `if pseudo_titre or plafond_atteint:` par `if False:` — la capture ne s'arrête plus
// jamais avant un marqueur ou un intertitre CONNU, et engloutit le pseudo-titre gras plus
// tout ce qui suit.

test('extraire_entete : un paragraphe court et entièrement gras arrête la capture du résumé (pseudo-titre)',
  { skip: sansPython }, () => {
    const out = diagnostiquer([
      para('Un titre'),
      para('Resume : Premier paragraphe du resume.'),
      para('Un pseudo-titre en gras', { gras: true }),
      para('Un paragraphe de corps qui ne doit JAMAIS entrer dans le resume.'),
    ]);
    assert.strictEqual(out.entete.resume, 'Premier paragraphe du resume.');
    assert.strictEqual(out.indices_consommes[2], undefined,
      'le pseudo-titre gras ne doit pas être consommé comme résumé');
    assert.strictEqual(out.indices_consommes[3], undefined,
      'le corps qui suit le pseudo-titre ne doit jamais être touché');
  });

test('extraire_entete : le résumé est plafonné à quatre paragraphes, le reste jamais capturé',
  { skip: sansPython }, () => {
    // index 0 = titre, 1 = marqueur, 2..10 = neuf paragraphes candidats à la suite.
    const paras = [para('Un titre'), para('Resume : paragraphe un.')];
    for (let i = 2; i <= 10; i += 1) {
      paras.push(para('Paragraphe de résumé numéro ' + i + ', tout à fait ordinaire et court.'));
    }
    const out = diagnostiquer(paras);
    // Le marqueur (1) + trois suites (2, 3, 4) : au paragraphe 5, n_paras_resume atteint
    // déjà 4 -> plafond, capture arrêtée AVANT de l'absorber.
    assert.deepStrictEqual(out.indices_consommes, { 0: 'titre', 1: 'resume', 2: 'resume',
      3: 'resume', 4: 'resume' });
    assert.strictEqual(out.document.blocs.length, paras.length - 5,
      'seuls le titre et les quatre paragraphes de résumé plafonnés doivent avoir quitté le corps');
  });

test('extraire_entete : le résumé est plafonné à 1500 signes, jamais tout un article',
  { skip: sansPython }, () => {
    const bloc300 = 'Un morceau de résumé assez long pour compter dans le plafond global. '.repeat(4);
    const paras = [para('Un titre'), para('Resume : ' + bloc300)];
    for (let i = 0; i < 6; i += 1) { paras.push(para(bloc300 + ' bis ' + i)); }
    const out = diagnostiquer(paras);
    assert.ok(out.entete.resume.length <= 1500,
      'le résumé capturé ne doit jamais dépasser le plafond '
      + '(longueur obtenue : ' + out.entete.resume.length + ')');
    assert.ok(out.document.blocs.length >= 2,
      'au moins les derniers paragraphes doivent être restés dans le corps, pas engloutis');
  });

// ---------------------------------------------------------------------------------------
// 9. Test de bout en bout — fabrique un .docx, passe la CLI complète, relit la sortie par
// pronto-lire.py (le lecteur de PRODUCTION) et compare titre, sous-titre, résumé, auteurs.
// Patron `fabriquerDocx` de test/js/docx-titres.test.js / test/js/manuscrit-nettoyer.test.js.

const FABRIQUER_DOCX = [
  'import json, sys, zipfile',
  'chemin, paras = sys.argv[1], json.loads(sys.argv[2])',
  'W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'def para_xml(p):',
  '    pStyle = (\'<w:pStyle w:val="%s"/>\' % p["style"]) if p.get("style") else ""',
  '    ppr = ("<w:pPr>%s</w:pPr>" % pStyle) if pStyle else ""',
  '    return \'<w:p>%s<w:r><w:t xml:space="preserve">%s</w:t></w:r></w:p>\' % (ppr, p.get("texte", ""))',
  'corps = "".join(para_xml(p) for p in paras)',
  'doc = (\'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="%s">\'',
  '       \'<w:body>%s</w:body></w:document>\') % (W, corps)',
  'styles = \'<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="%s">\' % W',
  'for sid, nom in (("Heading1", "heading 1"), ("Normal", "Normal")):',
  '    styles += \'<w:style w:styleId="%s"><w:name w:val="%s"/></w:style>\' % (sid, nom)',
  'styles += "</w:styles>"',
  'ct = (\'<?xml version="1.0"?><Types \'',
  '      \'xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>\')',
  'with zipfile.ZipFile(chemin, "w") as z:',
  '    z.writestr("word/document.xml", doc.encode("utf-8"))',
  '    z.writestr("word/styles.xml", styles.encode("utf-8"))',
  '    z.writestr("[Content_Types].xml", ct)',
].join('\n');

function fabriquerDocx(chemin, paragraphes) {
  const r = python(['-c', FABRIQUER_DOCX, chemin, JSON.stringify(paragraphes)]);
  assert.strictEqual(r.status, 0, 'fabrication du .docx impossible : ' + r.stderr);
}

function nettoyer(args) {
  return python([NETTOYEUR].concat(args));
}

function ligneUniqueJson(stdout) {
  const lignes = stdout.split('\n').filter((l) => l.trim());
  assert.strictEqual(lignes.length, 1, 'stdout doit porter EXACTEMENT une ligne : ' + stdout);
  return JSON.parse(lignes[0]);
}

// Compte les occurrences d'un texte dans TOUT le document.xml de sortie (tableaux fixes ET
// corps confondus) — sert à prouver qu'un paragraphe d'en-tête a bien QUITTÉ le corps : s'il
// y reste, il apparaît une SECONDE fois en plus de sa fiche dans le tableau des métadonnées
// ou des auteurs (patron `extraireTexteBrut` de test/js/manuscrit-nettoyer.test.js, réduit à
// un compte d'occurrences plutôt qu'au texte complet).
const LIRE_DOCUMENT_XML = 'import sys, zipfile\n'
  + 'z = zipfile.ZipFile(sys.argv[1])\n'
  + 'sys.stdout.write(z.read("word/document.xml").decode("utf-8"))\n';

function occurrencesDansLaSortie(cheminDocx, texte) {
  const xml = cp.execFileSync(PYTHON, ['-c', LIRE_DOCUMENT_XML, cheminDocx],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
  const morceaux = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(xml)) !== null) { morceaux.push(m[1]); }
  const plat = morceaux.join('');
  return plat.split(texte).length - 1;
}

test('bout en bout : manuscrit-nettoyer.py reconnaît l\'en-tête et le gabarit le porte, relu par pronto-lire.py',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, 'article.docx');
      fabriquerDocx(entree, [
        { texte: 'Inclusion scolaire : le role de l enseignant' },
        { texte: 'Jean Dupont' },
        { texte: 'HEP Vaud, jean.dupont@hepvd.ch' },
        { texte: 'Marie Martin' },
        { texte: 'Universite de Geneve, marie.martin@unige.ch' },
        { texte: 'Resume : Un texte de resume tout a fait ordinaire pour ce contrôle de bout en bout.' },
        { texte: 'Mots-cles : pedagogie, inclusion' },
        { texte: 'Introduction' },
        { texte: 'Un premier paragraphe de corps tout a fait ordinaire et sans probleme.' },
        { texte: 'References', style: 'Heading1' },
        { texte: 'Dupont, J. (2020). Un ouvrage important. Editions Test.' },
      ]);
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie]);
      const obj = ligneUniqueJson(r.stdout);
      assert.strictEqual(obj.gabarit, 'B');
      assert.ok(fs.existsSync(obj.sortie_docx));

      const rapport = JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8'));
      assert.ok(rapport.decisions.entete, 'le rapport doit porter decisions.entete en cas B');
      assert.strictEqual(rapport.decisions.entete.donnees.titre, 'Inclusion scolaire');
      assert.strictEqual(rapport.decisions.entete.donnees.sous_titre, 'le role de l enseignant');
      assert.strictEqual(rapport.decisions.entete.donnees.auteurs.length, 2);

      const dossierPronto = path.join(base, 'article-pronto');
      fs.mkdirSync(dossierPronto);
      const rl = python([PRONTO_LIRE, obj.sortie_docx, 'essai', dossierPronto]);
      assert.strictEqual(rl.status, 0, 'pronto-lire.py doit relire la sortie sans erreur : ' + rl.stderr);
      const statsPronto = JSON.parse(rl.stdout);
      assert.strictEqual(statsPronto.tableau1_consomme, true);
      assert.strictEqual(statsPronto.tableau2_consomme, true);
      assert.deepStrictEqual(statsPronto.avertissements, []);

      const meta = fs.readFileSync(path.join(dossierPronto, 'essai.meta.yaml'), 'utf8');
      assert.match(meta, /title:\s*\n\s*fr: "Inclusion scolaire"/);
      assert.match(meta, /subtitle:\s*\n\s*fr: "le role de l enseignant"/);
      assert.match(meta, /resume:\s*\n\s*fr: "Un texte de resume tout a fait ordinaire pour ce contr[ôo]le de bout en bout\."/);
      assert.match(meta, /prenom: "Jean"/);
      assert.match(meta, /nom: "Dupont"/);
      assert.match(meta, /affiliation: "HEP Vaud"/);
      assert.match(meta, /email: "jean\.dupont@hepvd\.ch"/);
      assert.match(meta, /prenom: "Marie"/);
      assert.match(meta, /nom: "Martin"/);
      assert.match(meta, /affiliation: "Universite de Geneve"/);

      // L'en-tête a bien QUITTÉ le corps : son texte n'apparaît qu'UNE FOIS dans la sortie
      // (dans sa fiche du tableau — Prénom et Nom y sont deux PARAGRAPHES distincts, jamais
      // « Jean Dupont » accolé), jamais une seconde fois comme paragraphe du corps.
      // C'est ce contrôle-ci, et lui seul, qui rougit si extraire_entete() est bien appelé
      // mais que ses paragraphes ne sont pas retirés de document.blocs avant l'écriture.
      assert.strictEqual(occurrencesDansLaSortie(obj.sortie_docx, 'Jean'), 1);
      assert.strictEqual(occurrencesDansLaSortie(obj.sortie_docx, 'HEP Vaud'), 1);
      assert.strictEqual(
        occurrencesDansLaSortie(obj.sortie_docx, 'Inclusion scolaire : le role de l enseignant'),
        0, 'le titre original (non scindé) ne doit apparaître nulle part : ni tel quel dans '
           + 'le corps, ni recopié entier dans le tableau (titre et sous-titre y sont scindés)');
      // L'intertitre et le corps du texte, EUX, doivent être restés.
      assert.strictEqual(occurrencesDansLaSortie(obj.sortie_docx, 'Introduction'), 1);
      assert.strictEqual(
        occurrencesDansLaSortie(obj.sortie_docx,
          'Un premier paragraphe de corps tout a fait ordinaire et sans probleme.'), 1);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------------
// 10. Bloc final « Informations sur les autrices et auteurs » (décision de Robin,
// 21.09.2026) : la Revue le demande en FIN de manuscrit — reconnu par extraire_bloc_auteurs_
// final(), retiré du corps ET de l'étendue de bibliographie de la CLI (mesuré, avant ce
// correctif, sur 2-clairseme_Article_CSPS_C.Pedrosa.docx et 2-fin-de-document_Article_RSPS.
// docx : ces coordonnées ressortaient en APA.OrdreBiblio / APA.CitationAbsente / confiance
// basse). Fusionné dans entete.auteurs : même nom -> complète la fiche déjà ouverte par la
// tête, jamais dupliquée.
//
// Sabotage minimal (vérifié pendant ce chantier) : dans extraire_bloc_auteurs_final(),
// remplacer `if texte and RE_INTERTITRE_AUTEURS_FINAL.match(texte):` par `if False:` — le
// marqueur n'est plus jamais reconnu, indices_consommes reste vide et le bloc final reste
// dans le corps.

test('extraire_bloc_auteurs_final : intertitre « Informations sur les autrices et auteurs », un seul paragraphe multi-lignes',
  { skip: sansPython }, () => {
    const out = diagnostiquer([
      para('Un titre'),
      para('Introduction'),
      para('Un premier paragraphe de corps tout à fait ordinaire.'),
      para('Informations sur les autrices et auteurs :'),
      para('Caroline Pedrosa\nAssistante diplômée - Doctorante\nCERF, Université de Fribourg\ncaroline.pedrosa@unifr.ch'),
    ]);
    assert.strictEqual(out.entete.auteurs.length, 1);
    const a = out.entete.auteurs[0];
    assert.strictEqual(a.prenom, 'Caroline');
    assert.strictEqual(a.nom, 'Pedrosa');
    assert.strictEqual(a.fonction, 'Assistante diplômée - Doctorante');
    assert.strictEqual(a.institution, 'CERF, Université de Fribourg');
    assert.strictEqual(a.email, 'caroline.pedrosa@unifr.ch');
    // Le marqueur ET le paragraphe qui le suit ont quitté le corps (indices 3 et 4).
    assert.strictEqual(out.indices_consommes[3], 'auteurs');
    assert.strictEqual(out.indices_consommes[4], 'auteurs');
    assert.strictEqual(out.document.blocs.length, 2,
      'le titre (en-tête) et le bloc final doivent avoir quitté le corps ; intro et corps restent');
  });

test('extraire_bloc_auteurs_final : sans intertitre, un groupe final de paragraphes courts (nom/institution/e-mail) est reconnu',
  { skip: sansPython }, () => {
    const out = diagnostiquer([
      para('Un titre'),
      para('Introduction'),
      para('Un premier paragraphe de corps tout à fait ordinaire, assez long pour ne '
        + 'jamais être pris pour une ligne d’information d’autrice ou auteur.'),
      para('Bibliographie'),
      para('Ebersold, S., & Detraux, J.-J. (2013). Scolarisation et besoin éducatif '
        + 'particulier : enjeux conceptuels et méthodologiques.'),
      para(''),
      para('Edith Guilley'),
      para('Collaboratrice de recherche'),
      para('Service de la recherche en éducation (DIP Genève)'),
      para('edith.guilley@orange.fr'),
    ]);
    assert.strictEqual(out.entete.auteurs.length, 1);
    const a = out.entete.auteurs[0];
    assert.strictEqual(a.prenom, 'Edith');
    assert.strictEqual(a.nom, 'Guilley');
    assert.strictEqual(a.fonction, 'Collaboratrice de recherche');
    assert.strictEqual(a.institution, 'Service de la recherche en éducation (DIP Genève)');
    assert.strictEqual(a.email, 'edith.guilley@orange.fr');
    // La référence bibliographique et son intitulé ne doivent JAMAIS être consommés.
    assert.strictEqual(out.indices_consommes[3], undefined, 'l’intitulé « Bibliographie » ne doit pas être avalé');
    assert.strictEqual(out.indices_consommes[4], undefined, 'la référence réelle ne doit jamais être prise pour une info d’auteur');
  });

test('extraire_bloc_auteurs_final : fusionne avec un auteur déjà connu de la tête (même nom), sans dupliquer',
  { skip: sansPython }, () => {
    const out = diagnostiquer([
      para('Un titre'),
      para('Caroline Pedrosa'),
      para('Introduction'),
      para('Un premier paragraphe de corps tout à fait ordinaire.'),
      para('Informations sur les autrices et auteurs :'),
      para('Caroline Pedrosa\nCERF, Université de Fribourg\ncaroline.pedrosa@unifr.ch'),
    ]);
    assert.strictEqual(out.entete.auteurs.length, 1,
      'même nom en tête et en fin de document -> UNE SEULE fiche, jamais dupliquée');
    const a = out.entete.auteurs[0];
    assert.strictEqual(a.institution, 'CERF, Université de Fribourg');
    assert.strictEqual(a.email, 'caroline.pedrosa@unifr.ch');
  });

// Le repli ne doit jamais avaler l'intitulé de bibliographie lui-même (court, comme les
// lignes d'info) — même quand rien de long ne le sépare du bloc final (pas de référence
// entre l'intitulé et les coordonnées, ce qui prive le seuil de longueur de tout rôle ici :
// seul le lexique de titres de bibliographie peut arrêter la marche arrière).
//
// Sabotage minimal (vérifié pendant ce chantier) : dans extraire_bloc_auteurs_final(),
// remplacer `if _est_titre_biblio_pour_repli(texte, lexique_biblio): break` par `if False:
// break` — « Bibliographie » se fait alors avaler avec le bloc final.

test('extraire_bloc_auteurs_final : le repli s\'arrête net sur l\'intitulé de bibliographie, même collé au bloc final',
  { skip: sansPython }, () => {
    const out = diagnostiquer([
      para('Un titre'),
      para('Introduction'),
      para('Un premier paragraphe de corps tout à fait ordinaire, assez long pour ne '
        + 'jamais être pris pour une ligne d’information d’autrice ou auteur.'),
      para('Bibliographie'),
      para(''),
      para('Edith Guilley'),
      para('Collaboratrice de recherche'),
      para('Service de la recherche en éducation (DIP Genève)'),
      para('edith.guilley@orange.fr'),
    ]);
    assert.strictEqual(out.entete.auteurs.length, 1);
    assert.strictEqual(out.indices_consommes[3], undefined,
      'l’intitulé « Bibliographie » ne doit jamais être consommé par le repli, même sans '
      + 'référence longue pour l’arrêter autrement');
  });

// Frontière avec la zone d'en-tête (§ ci-dessus) : sur un document COURT où toutes les
// lignes sont brèves, le repli ne doit jamais revisiter une ligne déjà consommée par
// extraire_entete() — sinon un intertitre de tête (« Introduction ») se fait absorber comme
// complément d'un auteur ouvert plus haut (régression constatée en construisant ce module).
//
// Sabotage minimal (vérifié pendant ce chantier) : dans extraire_bloc_auteurs_final(),
// retirer la garde `if i in indices_entete: break` du repli — la fonction fait alors
// `a.fonction === 'Introduction'` au lieu de `''`.

test('extraire_bloc_auteurs_final : ne revisite jamais un paragraphe déjà consommé par extraire_entete()',
  { skip: sansPython }, () => {
    const out = diagnostiquer([
      para('Un titre'),
      para('Jean Dupont'),
      para('ORCID 0000-0001-2345-6789'),
      para('Introduction'),
    ]);
    assert.strictEqual(out.entete.auteurs.length, 1);
    assert.strictEqual(out.entete.auteurs[0].fonction, '',
      'l’intertitre de tête ne doit jamais être réattribué comme fonction par le repli');
    assert.deepStrictEqual(out.indices_consommes, { 0: 'titre', 1: 'auteurs', 2: 'auteurs' });
  });
