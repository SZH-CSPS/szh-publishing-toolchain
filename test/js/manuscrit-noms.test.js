// pipeline/manuscrit_noms.py : attribution prénom/nom au sein d'un segment de nom déjà
// reconnu (problème (b), distinct de la SEGMENTATION de docx-meta.nom_plausible()) — §3 de
// CONTRAT-noms.md (lot A, non committé), qui prolonge outils-dev/ARCHITECTURE-nettoyeur-
// manuscrit.md, §5.5.
//
//   node --test "test/js/manuscrit-noms.test.js"
//
// Module PUR : ce fichier passe par le mode --diagnostic, patron de
// test/js/manuscrit-entete.test.js — {"segments": [{"texte", "indices"}, ...], "base":
// {"prenoms": [...], "noms": [...]}} sur stdin, une ligne JSON {"resultats": [...]} sur
// stdout. `base` voyage TOUJOURS en ligne : aucun test ici ne lit
// C:\ProgramData\SZH\auteurs.json (absent des runners CI, §2 bis du contrat de lot). Seul le
// test « BaseNoms.charger() » (§8 quater) sort de ce patron : il vérifie le chargement
// DEPUIS DISQUE du lexique du dépôt (pipeline/lexique/noms-famille.txt), toujours sans
// dépendre de la base OJS de production.
//
// Contrôles couverts (§3.7 du contrat de lot) : casse tapée, casse mise en forme, tout en
// majuscules (aucun signal) ; e-mail tranchant dans les deux sens, e-mail à initiale, adresse
// institutionnelle ignorée ; lexique tranchant (à un et deux jetons concordants), réellement
// indécis (égalité stricte), muet ; conflit à poids égal ; propagation dans une byline et
// non-propagation en cas de contradiction ; titres académiques ; particules dans les deux
// ordres ; base absente ; BaseNoms.charger() ne lit plus que noms-famille.txt (prenoms.txt
// supprimé le 22.09.2026, décision de Robin).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PYTHON, sansPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const MANUSCRIT_NOMS = path.join(RACINE, 'pipeline', 'manuscrit_noms.py');

const ENV_UTF8 = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });

// Lance manuscrit_noms.py --diagnostic sur {segments, base}, rend {resultats: [...]} déjà
// parsé — un résultat par segment, dans l'ordre d'entrée (la propagation de trancher_groupe()
// tourne sur les segments reçus ENSEMBLE dans un même appel).
function diagnostiquer(segments, base) {
  const entree = { segments, base: base || { prenoms: [], noms: [] } };
  const r = cp.spawnSync(PYTHON, [MANUSCRIT_NOMS, '--diagnostic'], {
    input: JSON.stringify(entree), encoding: 'utf8', env: ENV_UTF8,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.strictEqual(r.status, 0, 'manuscrit_noms.py --diagnostic a échoué : ' + r.stderr);
  const lignes = r.stdout.trim().split('\n');
  return JSON.parse(lignes[lignes.length - 1]).resultats;
}

// Un seul segment : raccourci pour ne pas répéter le tableau à chaque test.
function decouper(texte, indices, base) {
  return diagnostiquer([{ texte, indices: indices || {} }], base)[0];
}

// -----------------------------------------------------------------------------------------
// 1. La casse — force certaine.

test('trancher : casse TAPÉE marque le nom (GUILLEY Edith), ordre inversé',
  { skip: sansPython }, () => {
    const r = decouper('GUILLEY Edith');
    assert.strictEqual(r.prenom, 'Edith');
    assert.strictEqual(r.nom, 'GUILLEY');
    assert.strictEqual(r.ordre, 'nom_prenom');
    assert.strictEqual(r.confiance, 'certaine');
    assert.strictEqual(r.conflit, false);
    assert.match(r.motif, /capitales/);
  });

test('trancher : casse MISE EN FORME (indices.majuscules, pas de majuscule tapée)',
  { skip: sansPython }, () => {
    // « Guilley » est tapé en bas de casse ; c'est indices.majuscules (position 0, forme du
    // modèle riche — manuscrit_modele.FORME_CLES) qui dit que ce jeton est composé en
    // capitales — un texte tapé normalement ne peut pas porter ce renseignement lui-même.
    const r = decouper('Guilley Edith', { majuscules: [0] });
    assert.strictEqual(r.prenom, 'Edith');
    assert.strictEqual(r.nom, 'Guilley');
    assert.strictEqual(r.ordre, 'nom_prenom');
    assert.strictEqual(r.confiance, 'certaine');
  });

test('trancher : tout en majuscules -> aucun signal de casse (un titre capitalisé n’est pas un nom marqué)',
  { skip: sansPython }, () => {
    const r = decouper('GUILLEY EDITH');
    assert.strictEqual(r.confiance, 'defaut');
    assert.strictEqual(r.ordre, 'prenom_nom');
    assert.strictEqual(r.conflit, false);
  });

// -----------------------------------------------------------------------------------------
// 2. L'e-mail — force certaine, silence si les deux jetons (ou aucun) y apparaissent entiers.

test('trancher : e-mail où seul le NOM apparaît entier -> ordre direct (prénom en tête)',
  { skip: sansPython }, () => {
    const r = decouper('Delphine Protti', { email: 'protti@edu-vd.ch' });
    assert.strictEqual(r.prenom, 'Delphine');
    assert.strictEqual(r.nom, 'Protti');
    assert.strictEqual(r.ordre, 'prenom_nom');
    assert.strictEqual(r.confiance, 'certaine');
    assert.match(r.motif, /protti/);
  });

test('trancher : e-mail où seul le NOM (en tête du segment) apparaît entier -> ordre inverse',
  { skip: sansPython }, () => {
    const r = decouper('Guilley Delphine', { email: 'guilley@edu-vd.ch' });
    assert.strictEqual(r.prenom, 'Delphine');
    assert.strictEqual(r.nom, 'Guilley');
    assert.strictEqual(r.ordre, 'nom_prenom');
    assert.strictEqual(r.confiance, 'certaine');
  });

test('trancher : e-mail à initiale (d.protti), le nom entier tranche quand même',
  { skip: sansPython }, () => {
    const r = decouper('Delphine Protti', { email: 'd.protti@edu-vd.ch' });
    assert.strictEqual(r.prenom, 'Delphine');
    assert.strictEqual(r.nom, 'Protti');
    assert.strictEqual(r.ordre, 'prenom_nom');
    assert.strictEqual(r.confiance, 'certaine');
  });

test('trancher : e-mail avec les deux jetons entiers -> silence (aucune façon sûre de savoir lequel est le nom)',
  { skip: sansPython }, () => {
    const r = decouper('Edith Guilley', { email: 'edith.guilley@szh.ch' });
    assert.strictEqual(r.confiance, 'defaut');
    assert.strictEqual(r.conflit, false);
  });

test('trancher : adresse institutionnelle ignorée (aucun séparateur, aucun jeton du segment dedans)',
  { skip: sansPython }, () => {
    const r = decouper('Jean Dupont', { email: 'redaction@szh.ch' });
    assert.strictEqual(r.confiance, 'defaut');
    assert.strictEqual(r.prenom, 'Jean');
    assert.strictEqual(r.nom, 'Dupont');
  });

// -----------------------------------------------------------------------------------------
// 3. La bibliographie — force probable, un seul des deux jetons suffit.

test('trancher : nom certifié par la bibliographie (direct)', { skip: sansPython }, () => {
  const r = decouper('Edith Guilley', { noms_biblio: ['guilley'] });
  assert.strictEqual(r.ordre, 'prenom_nom');
  assert.strictEqual(r.confiance, 'probable');
  assert.match(r.motif, /bibliographie/);
});

test('trancher : nom certifié par la bibliographie (inverse)', { skip: sansPython }, () => {
  const r = decouper('Guilley Edith', { noms_biblio: ['guilley'] });
  assert.strictEqual(r.ordre, 'nom_prenom');
  assert.strictEqual(r.confiance, 'probable');
  assert.strictEqual(r.prenom, 'Edith');
  assert.strictEqual(r.nom, 'Guilley');
});

// -----------------------------------------------------------------------------------------
// 4. Le lexique — force probable, marge = 1 (§3.3 du contrat, marge révisée par le
// superviseur le 22.09.2026 après mesure : la formule d'origine du contrat, marge = 2, ne
// tranchait presque rien — voir le commentaire de MARGE_LEXIQUE dans manuscrit_noms.py).

test('trancher : lexique tranchant (les deux jetons concordent d’un côté, rien de l’autre)',
  { skip: sansPython }, () => {
    const base = { prenoms: ['edith'], noms: ['guilley'] };
    const r = decouper('Edith Guilley', {}, base);
    assert.strictEqual(r.ordre, 'prenom_nom');
    assert.strictEqual(r.confiance, 'probable');
    assert.match(r.motif, /connaît/);
  });

test('trancher : lexique tranchant avec un seul jeton concordant (marge = 1, un écart suffit)',
  { skip: sansPython }, () => {
    // La base ne connaît « Guilley » que comme nom : score_direct = 1 (Guilley nom, Edith
    // prénom inconnu), score_inverse = 0 — écart de 1, ça suffit désormais (MARGE_LEXIQUE = 1).
    const base = { prenoms: [], noms: ['guilley'] };
    const r = decouper('Edith Guilley', {}, base);
    assert.strictEqual(r.ordre, 'prenom_nom');
    assert.strictEqual(r.confiance, 'probable');
    assert.strictEqual(r.conflit, false);
  });

test('trancher : lexique réellement indécis (égalité stricte des deux scores, jamais un pari)',
  { skip: sansPython }, () => {
    // Les DEUX jetons sont connus à la fois comme prénom ET comme nom ailleurs dans la base
    // (des homonymes réels existent, « Martin » par exemple) : score_direct = score_inverse
    // = 2, égalité stricte — le seul cas qui reste muet à marge = 1.
    const base = { prenoms: ['edith', 'guilley'], noms: ['edith', 'guilley'] };
    const r = decouper('Edith Guilley', {}, base);
    assert.strictEqual(r.confiance, 'defaut');
    assert.strictEqual(r.conflit, false);
  });

test('trancher : lexique muet (base disponible mais aucun des deux jetons connu)',
  { skip: sansPython }, () => {
    const base = { prenoms: ['pierre'], noms: ['martin'] };
    const r = decouper('Edith Guilley', {}, base);
    assert.strictEqual(r.confiance, 'defaut');
  });

// -----------------------------------------------------------------------------------------
// 5. Conflit — deux signaux de même poids qui se contredisent.

test('trancher : conflit entre biblio (direct) et lexique (inverse), même poids (2)',
  { skip: sansPython }, () => {
    // La bibliographie certifie « guilley » comme nom (-> direct, Guilley en queue) ; la base
    // lexicale, elle, connaît « guilley » comme PRÉNOM et « edith » comme NOM (-> inverse) —
    // deux signaux de poids 2 qui se contredisent frontalement.
    const base = { prenoms: ['guilley'], noms: ['edith'] };
    const r = decouper('Edith Guilley', { noms_biblio: ['guilley'] }, base);
    assert.strictEqual(r.conflit, true);
    assert.strictEqual(r.confiance, 'defaut');
    assert.strictEqual(r.ordre, 'prenom_nom', 'la convention (direct) tranche par défaut en cas de conflit');
    assert.match(r.motif, /contradictoires/);
  });

// -----------------------------------------------------------------------------------------
// 6. Propagation — l'indice le moins cher, le plus robuste (§3.5 du contrat).

test('trancher_groupe : propagation dans une byline, un seul nom connu -> les deux segments en ordre inverse',
  { skip: sansPython }, () => {
    // « Guilley Edith, Valarino Isabel » : seule « Guilley » est certifiée par la
    // bibliographie. Le premier segment tranche (probable, inverse) ; le second, muet tout
    // seul, adopte le même ordre par propagation.
    const nomsBiblio = ['guilley'];
    const resultats = diagnostiquer([
      { texte: 'Guilley Edith', indices: { noms_biblio: nomsBiblio } },
      { texte: 'Valarino Isabel', indices: { noms_biblio: nomsBiblio } },
    ]);
    assert.strictEqual(resultats.length, 2);
    assert.strictEqual(resultats[0].ordre, 'nom_prenom');
    assert.strictEqual(resultats[0].confiance, 'probable');
    assert.strictEqual(resultats[0].prenom, 'Edith');
    assert.strictEqual(resultats[0].nom, 'Guilley');
    assert.strictEqual(resultats[1].ordre, 'nom_prenom');
    assert.strictEqual(resultats[1].confiance, 'propagee');
    assert.strictEqual(resultats[1].prenom, 'Isabel');
    assert.strictEqual(resultats[1].nom, 'Valarino');
    assert.match(resultats[1].motif, /propagé/);
  });

test('trancher_groupe : deux segments tranchés qui se contredisent -> aucune propagation',
  { skip: sansPython }, () => {
    const resultats = diagnostiquer([
      { texte: 'Guilley Edith', indices: { email: 'guilley@x.ch' } },       // -> inverse
      { texte: 'Isabel Valarino', indices: { email: 'valarino@x.ch' } },    // -> direct
      { texte: 'Jean Dupont', indices: {} },                                // muet, ne doit
    ]);                                                                     // pas bouger
    assert.strictEqual(resultats[0].ordre, 'nom_prenom');
    assert.strictEqual(resultats[0].confiance, 'certaine');
    assert.strictEqual(resultats[1].ordre, 'prenom_nom');
    assert.strictEqual(resultats[1].confiance, 'certaine');
    // Aucun consensus entre les deux segments tranchés : le troisième reste en 'defaut',
    // jamais 'propagee' — une propagation vers une contradiction serait pire que le silence.
    assert.strictEqual(resultats[2].confiance, 'defaut');
    assert.strictEqual(resultats[2].ordre, 'prenom_nom');
  });

// -----------------------------------------------------------------------------------------
// 7. Titres académiques — dm.sans_titres_academiques() en amont (§3.6 du contrat : « c'est
// ce qui manque aujourd'hui » à _segments_plausibles()).

test('trancher : titres académiques en tête retirés avant découpage (Dr. phil.)',
  { skip: sansPython }, () => {
    const r = decouper('Dr. phil. Romain Lanners');
    assert.strictEqual(r.prenom, 'Romain');
    assert.strictEqual(r.nom, 'Lanners');
  });

test('trancher : chaîne de titres académiques (Prof. Dr.)', { skip: sansPython }, () => {
  const r = decouper('Prof. Dr. Verena Müller');
  assert.strictEqual(r.prenom, 'Verena');
  assert.strictEqual(r.nom, 'Müller');
});

// -----------------------------------------------------------------------------------------
// 8. Particules — dans les deux ordres (§3.6 du contrat, les deux exemples de référence).

test('trancher : particule côté nom, ordre direct (Anne-Françoise de Chambrier)',
  { skip: sansPython }, () => {
    const r = decouper('Anne-Françoise de Chambrier');
    assert.strictEqual(r.prenom, 'Anne-Françoise');
    assert.strictEqual(r.nom, 'de Chambrier');
    assert.strictEqual(r.confiance, 'defaut', 'aucun indice : convention direct par défaut');
  });

test('trancher : particule côté nom, ordre inverse (De Chambrier Anne-Françoise, casse marquée)',
  { skip: sansPython }, () => {
    // Sans indice, « De Chambrier Anne-Françoise » resterait en ordre direct par défaut (la
    // particule en tête n'est PAS, à elle seule, un signal du contrat) — la casse, elle,
    // tranche : le nom composé « DE CHAMBRIER » est marqué en tête, bloc contigu.
    const r = decouper('DE CHAMBRIER Anne-Françoise');
    assert.strictEqual(r.prenom, 'Anne-Françoise');
    assert.strictEqual(r.nom, 'DE CHAMBRIER');
    assert.strictEqual(r.ordre, 'nom_prenom');
    assert.strictEqual(r.confiance, 'certaine');
  });

// -----------------------------------------------------------------------------------------
// 8 bis. Initiale(s) pointée(s) intercalaire(s) — ajout du 22.09.2026, mesuré sur 8 fiches
// sur 1155 (0,7 %) de la base réelle (« Susan C. A. » / « Burkhardt », « Bernard N. » /
// « Schumacher »…) : une seule lettre suivie d'un point, entre le prénom et le nom, colle au
// prénom — jamais un nom de famille à elle seule.

test('trancher : une initiale intercalaire colle au prénom, ordre direct (Bernard N. Schumacher)',
  { skip: sansPython }, () => {
    const r = decouper('Bernard N. Schumacher');
    assert.strictEqual(r.prenom, 'Bernard N.');
    assert.strictEqual(r.nom, 'Schumacher');
  });

test('trancher : deux initiales intercalaires collent au prénom, ordre direct (Susan C. A. Burkhardt)',
  { skip: sansPython }, () => {
    const r = decouper('Susan C. A. Burkhardt');
    assert.strictEqual(r.prenom, 'Susan C. A.');
    assert.strictEqual(r.nom, 'Burkhardt');
  });

test('trancher : initiale intercalaire, ordre INVERSE (casse marquée pour lever le doute d’ordre)',
  { skip: sansPython }, () => {
    // « SCHUMACHER Bernard N. » : sans la casse, l'ordre resterait direct par défaut — une
    // fois l'ordre inverse établi, l'initiale doit rester collée au prénom, jamais isolée
    // comme si elle était, à elle seule, tout le prénom (l'ancienne symétrie « dernier jeton
    // = prénom » aurait rendu prénom= « N. », nom= « SCHUMACHER Bernard », faux).
    const r = decouper('SCHUMACHER Bernard N.');
    assert.strictEqual(r.prenom, 'Bernard N.');
    assert.strictEqual(r.nom, 'SCHUMACHER');
    assert.strictEqual(r.ordre, 'nom_prenom');
    assert.strictEqual(r.confiance, 'certaine');
  });

test('trancher : initiale accentuée (É.), casse et accent indifférents à la règle',
  { skip: sansPython }, () => {
    const r = decouper('Marie É. Dupont');
    assert.strictEqual(r.prenom, 'Marie É.');
    assert.strictEqual(r.nom, 'Dupont');
  });

// -----------------------------------------------------------------------------------------
// 8 ter. Limite connue, documentée, non corrigée : un VRAI prénom composé à l'ESPACE, sans
// initiale ni tiret — mesuré le 22.09.2026, 12 fiches sur 1155 (1,0 %) de la base réelle
// (« Salomé Calina » / « Schneiter », « Laura Marie » / « Maaß »…). Rien dans le texte seul
// ne distingue ce cas d'un troisième jeton qui serait en réalité un second nom de famille :
// ce test CONSTATE la limite documentée dans _repartir(), il ne prétend pas la corriger.

test('trancher : limite connue — prénom composé à l’espace, sans initiale ni tiret (non corrigé)',
  { skip: sansPython }, () => {
    const r = decouper('Laura Marie Maaß');
    // Comportement documenté, pas souhaité : seul « Laura » est reconnu comme prénom, le
    // reste (y compris le vrai second prénom « Marie ») tombe dans le nom — une coupe
    // optimiste, jamais un prénom et un nom permutés (la propriété de sûreté du module tient
    // toujours : aucune inversion fabriquée à tort).
    assert.strictEqual(r.prenom, 'Laura');
    assert.strictEqual(r.nom, 'Marie Maaß');
    assert.strictEqual(r.confiance, 'defaut');
    assert.strictEqual(r.conflit, false);
  });

// -----------------------------------------------------------------------------------------
// 8 quater. BaseNoms.charger() — le lexique du dépôt (pipeline/lexique/) ne porte plus que
// noms-famille.txt : prenoms.txt a été supprimé le 22.09.2026 (décision de Robin, dérivé de
// la base OJS du poste — voir le rapport de livraison de ce lot). Seul ce test-ci passe par
// charger() (donc par le disque) ; tous les autres tests de ce fichier passent par
// depuis_dict() via --diagnostic, qui ne change pas (base toujours EN LIGNE).

test('BaseNoms.charger() : ne lit que noms-famille.txt dans le lexique du dépôt, même si '
  + 'un prenoms.txt traîne encore dans le dossier', { skip: sansPython }, () => {
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-basenoms-lexique-'));
    fs.writeFileSync(path.join(dossier, 'noms-famille.txt'), '# test\nguilley\n', 'utf8');
    // Un prenoms.txt présent malgré tout (reliquat d'un ancien poste, ou base régénérée à
    // l'ancienne) : BaseNoms ne doit plus le chercher, donc jamais le lire.
    fs.writeFileSync(path.join(dossier, 'prenoms.txt'), '# reliquat\nedith\n', 'utf8');
    // Chemin de base OJS délibérément inexistant : isole le test sur le SEUL lexique du
    // dépôt, sans dépendre de C:\ProgramData\SZH\auteurs.json (absent des runners CI).
    const cheminBaseInexistant = path.join(dossier, 'auteurs-inexistant.json');

    const programme = [
      'import importlib.util, json, sys',
      'spec = importlib.util.spec_from_file_location("mn", ' + JSON.stringify(MANUSCRIT_NOMS) + ')',
      'mn = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(mn)',
      'base = mn.BaseNoms.charger(chemin_base_auteurs=sys.argv[1], chemin_lexique=sys.argv[2])',
      'print(json.dumps({',
      '    "disponible": base.disponible,',
      '    "sources": base.sources,',
      '    "poids_nom_guilley": base.poids_nom("guilley"),',
      '    "poids_prenom_edith": base.poids_prenom("edith"),',
      '}, ensure_ascii=False))',
    ].join('\n');
    const r = cp.spawnSync(PYTHON, ['-c', programme, cheminBaseInexistant, dossier], {
      encoding: 'utf8', env: ENV_UTF8,
    });
    assert.strictEqual(r.status, 0, 'BaseNoms.charger() a échoué : ' + r.stderr);
    const sortie = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(sortie.disponible, true);
    assert.strictEqual(sortie.poids_nom_guilley, 1, 'noms-famille.txt doit être lu');
    assert.strictEqual(sortie.poids_prenom_edith, 0,
      'prenoms.txt ne doit plus être lu, même présent dans le dossier');
    assert.ok(sortie.sources.some((s) => s.includes('noms-famille.txt')),
      'la trace doit mentionner noms-famille.txt');
    assert.ok(!sortie.sources.some((s) => s.includes('prenoms.txt')),
      'aucune source ne doit mentionner prenoms.txt');
  });

// -----------------------------------------------------------------------------------------
// 9. Base absente — rien ne casse, tout sort en 'defaut'.

test('trancher : base absente (aucun prénom ni nom en ligne) -> defaut, rien ne casse',
  { skip: sansPython }, () => {
    const r = decouper('Marie Dupont', {}, { prenoms: [], noms: [] });
    assert.strictEqual(r.prenom, 'Marie');
    assert.strictEqual(r.nom, 'Dupont');
    assert.strictEqual(r.confiance, 'defaut');
    assert.strictEqual(r.conflit, false);
  });

test('trancher : un seul jeton -> tout dans le nom, defaut (comme decouper_prenom_nom avant)',
  { skip: sansPython }, () => {
    const r = decouper('Dupont');
    assert.strictEqual(r.prenom, '');
    assert.strictEqual(r.nom, 'Dupont');
    assert.strictEqual(r.confiance, 'defaut');
  });
