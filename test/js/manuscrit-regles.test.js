// test/js/manuscrit-regles.test.js : le catalogue de règles et le moteur d'alertes du
// nettoyeur de manuscrit (article), §7 de outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md.
// Ce fichier éprouve les six contrôles posés par le brief :
//   1. « personne en situation de handicap » (recommandé CSPS/MDH-PPH) ne lève AUCUNE
//      alerte — le piège OQLF/CSPS, nommé comme critère d'acceptation ;
//   2. l'inversion épicène : « éducateur/trice » lève une error en produit revue ;
//      « Schüler:innen » n'en lève AUCUNE en produit zeitschrift ; « die Schülerinnen und
//      Schüler » lève une alerte en zeitschrift alors que la forme double équivalente
//      n'en lève aucune en revue — LE FAIT QUI COMMANDE TOUT (les deux revues prescrivent
//      des solutions épicènes exactement opposées) ;
//   3. « étudiant-e-s » lève une suggestion, jamais une error (absente des lignes
//      directrices françaises : on n'invente pas une interdiction que le PDF ne porte pas) ;
//   4. chaque règle du catalogue porte une référence de chapitre non vide ;
//   5. les seuils diffèrent entre les deux produits : un résumé de 650 signes passe en
//      Zeitschrift (plafond seul, 700) et échoue en Revue (fourchette 400–600) ;
//   6. le code de sortie du moteur est non nul dès la première alerte `error`.
// Plus trois contrôles complémentaires, pour couvrir des familles supplémentaires du
// catalogue sans repayer les six premiers : la reprise (jamais la réimplémentation) des
// avertissements C1/C2 du filtre typographique, une correction APA mécanique, et
// l'héritage en `suggestion` d'une règle d'accessibilité sans source normative allemande.
//
//   node --test test/js/manuscrit-regles.test.js
//
// Patron : test/js/manuscrit-docx.test.js. Gardes de test/js/gardes.js : PYTHON (jamais
// `python3` en dur, qui tombe sur l'alias WindowsApps et fige toute la suite).
//
// manuscrit_regles.py n'est piloté que par sa CLI de diagnostic (--diagnostiquer/
// --catalogue) : Node ne peut pas l'importer directement.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const MANUSCRIT_REGLES = path.join(RACINE, 'pipeline', 'manuscrit_regles.py');

function python(args, entree) {
  return cp.spawnSync(PYTHON, args,
    { encoding: 'utf8', input: entree, maxBuffer: 64 * 1024 * 1024 });
}

// Lance --diagnostiquer sur un Contexte JS, rend {code, sortie} — `code` est le code de
// sortie du PROCESSUS (0 = aucune error, 1 = au moins une), `sortie` le JSON déjà parsé.
function diagnostiquer(contexte) {
  const r = python([MANUSCRIT_REGLES, '--diagnostiquer'], JSON.stringify(contexte));
  assert.ok(r.status === 0 || r.status === 1,
    '--diagnostiquer devait rendre 0 ou 1, a rendu ' + r.status + ' : ' + r.stderr);
  return { code: r.status, sortie: JSON.parse(r.stdout) };
}

function catalogue() {
  const r = python([MANUSCRIT_REGLES, '--catalogue']);
  assert.strictEqual(r.status, 0, '--catalogue a échoué : ' + r.stderr);
  return JSON.parse(r.stdout);
}

function regles(contexte) {
  return diagnostiquer(contexte).sortie.alertes.map((a) => a.rule);
}

// ---------------------------------------------------------------------------------
// Contrôle n°1 — le piège OQLF/CSPS, nommé comme critère d'acceptation par le brief.
//
// Sabotage minimal : dans RE_HANDICAP_OQLF, élargir le motif de
// `r'\bpersonnes?\s+handicap[ée]e?s?\b'` à `r'\bpersonnes?.{0,30}handicap[ée]?e?s?\b'` —
// exactement l'erreur que le brief redoute (« un import brut du vocabulaire OQLF »). Une
// fois élargi, le motif traverse « en situation de » et attrape la forme recommandée
// elle-même : la première assertion rougit.

test('Vocabulaire.HandicapTermePreferentiel : "personne en situation de handicap" ne lève aucune alerte',
  { skip: sansPython }, () => {
    const { sortie } = diagnostiquer({
      produit: 'revue', langue: 'fr',
      paragraphes: [{ source: 0, texte: 'Cette personne en situation de handicap participe pleinement.' }]
    });
    assert.deepStrictEqual(sortie.alertes, [],
      'la forme recommandée par la CSPS/MDH-PPH ne doit jamais être signalée');

    // Contrôle complémentaire, sur la même règle : le terme que l'OQLF privilégie, lui,
    // DOIT être signalé — sinon la règle ne fait rien d'utile et le premier test serait
    // vert par accident (absence totale de détection) plutôt que par la bonne raison.
    const { sortie: avecDeprecie } = diagnostiquer({
      produit: 'revue', langue: 'fr',
      paragraphes: [{ source: 0, texte: 'Cette personne handicapée participe pleinement.' }]
    });
    assert.deepStrictEqual(avecDeprecie.alertes.map((a) => a.rule),
      ['Vocabulaire.HandicapTermePreferentiel'],
      'le terme privilégié par l\'OQLF (mais pas par la CSPS) doit être signalé');
  });

// ---------------------------------------------------------------------------------
// Contrôle n°2 — L'INVERSION ÉPICÈNE, le fait qui commande tout : les deux revues
// prescrivent des solutions opposées. Un correcteur qui appliquerait le même motif aux
// deux langues serait faux à l'envers pour l'une des deux.
//
// Sabotage minimal : dans FORMES_INTERDITES_DE, ajouter `(RE_FORME_DEUXPOINTS, '...')`
// (le motif déjà utilisé côté français) — la règle allemande se mettrait alors à
// signaler « Schüler:innen », sa propre solution prescrite. La deuxième assertion
// (aucune alerte en zeitschrift) rougit.

test('l\'inversion épicène : chaque produit proscrit exactement le contraire de l\'autre',
  { skip: sansPython }, () => {
    const revueSlash = regles({
      produit: 'revue', langue: 'fr',
      paragraphes: [{ source: 0, texte: 'L\'éducateur/trice accompagne les élèves.' }]
    });
    assert.deepStrictEqual(revueSlash, ['Epicene.FormesContracteesProscrites'],
      '« éducateur/trice » doit lever une alerte en produit revue');
    const { sortie: sortieSlash } = diagnostiquer({
      produit: 'revue', langue: 'fr',
      paragraphes: [{ source: 0, texte: 'L\'éducateur/trice accompagne les élèves.' }]
    });
    assert.strictEqual(sortieSlash.alertes[0].severity, 'error',
      'la forme contractée est proscrite en français : severity doit être "error"');

    const zeitschriftDeuxPoints = regles({
      produit: 'zeitschrift', langue: 'de',
      paragraphes: [{ source: 0, texte: 'Die Schüler:innen kommen morgen.' }]
    });
    assert.deepStrictEqual(zeitschriftDeuxPoints, [],
      '« Schüler:innen » est la solution PRESCRITE côté allemand : aucune alerte');

    const zeitschriftPaarform = regles({
      produit: 'zeitschrift', langue: 'de',
      paragraphes: [{ source: 0, texte: 'Die Schülerinnen und Schüler kommen morgen.' }]
    });
    assert.deepStrictEqual(zeitschriftPaarform, ['Epicene.PaarformProscrites'],
      'la Paarform avec "und", elle, doit être signalée côté allemand');

    const revueFormeDouble = regles({
      produit: 'revue', langue: 'fr',
      paragraphes: [{ source: 0, texte: 'L\'éducatrice et l\'éducateur accompagnent les élèves.' }]
    });
    assert.deepStrictEqual(revueFormeDouble, [],
      'la forme double complète, équivalente à la Paarform allemande, n\'est PAS proscrite '
      + 'en français : c\'est au contraire la solution de repli prescrite par ce document');
  });

// ---------------------------------------------------------------------------------
// Contrôle n°3 — une forme absente des lignes directrices françaises (tiret, point médian,
// point) se signale en `suggestion`, jamais en `error` : on n'invente pas une interdiction
// que le PDF ne porte pas.
//
// Sabotage minimal : dans le catalogue, changer la sévérité de la règle
// Epicene.FormesNonListeesSuggestion de 'suggestion' à 'error' — l'assertion sur severity
// rougit.

test('"étudiant-e-s" lève une suggestion, jamais une error',
  { skip: sansPython }, () => {
    const { sortie } = diagnostiquer({
      produit: 'revue', langue: 'fr',
      paragraphes: [{ source: 0, texte: 'Les étudiant-e-s sont attendus.' }]
    });
    assert.strictEqual(sortie.alertes.length, 1, 'une seule alerte attendue');
    assert.strictEqual(sortie.alertes[0].rule, 'Epicene.FormesNonListeesSuggestion');
    assert.strictEqual(sortie.alertes[0].severity, 'suggestion',
      'une forme non listée par le PDF ne doit jamais devenir une error');
  });

// ---------------------------------------------------------------------------------
// Contrôle n°4 — chaque règle du catalogue porte une référence de chapitre non vide :
// c'est ce qui permet à la rédaction de contester une alerte en remontant à sa source.
//
// Sabotage minimal : dans CATALOGUE, vider le champ `chapitre` d'UNE règle (par exemple
// Structure.NiveauxTitre, 'Revue: 1.1 Mise en page / Zeitschrift: Checkliste' -> '') —
// l'assertion sur cette règle précise rougit, et le message nomme l'id fautif.

test('chaque règle du catalogue porte une référence de chapitre non vide',
  { skip: sansPython }, () => {
    const regles = catalogue();
    assert.ok(regles.length > 0, 'le catalogue ne doit pas être vide');
    const sansChapitre = regles.filter((r) => !r.chapitre || !r.chapitre.trim());
    assert.deepStrictEqual(sansChapitre.map((r) => r.id), [],
      'ces règles n\'ont aucune référence de chapitre : ' + JSON.stringify(sansChapitre));
  });

// ---------------------------------------------------------------------------------
// Contrôle n°5 — les seuils sont bien des CONSTANTES PAR PRODUIT : un résumé de 650 signes
// passe en Zeitschrift (plafond seul, 700) et échoue en Revue (fourchette 400–600).
//
// Sabotage minimal : dans manuscrit_regles.py, remplacer RESUME_MAX_ZEITSCHRIFT = 700 par
// RESUME_MAX_ZEITSCHRIFT = 600 (le seuil français) — la première assertion (aucune alerte
// en zeitschrift) rougit : 650 dépasserait alors le seuil confondu avec celui du français.

test('les seuils de longueur diffèrent entre les deux produits (résumé de 650 signes)',
  { skip: sansPython }, () => {
    const resume650 = { source: 0, role: 'resume', texte: 'x'.repeat(650) };

    const { sortie: cotéZeitschrift } = diagnostiquer({
      produit: 'zeitschrift', langue: 'de', paragraphes: [resume650]
    });
    assert.deepStrictEqual(cotéZeitschrift.alertes, [],
      '650 signes est sous le plafond allemand (700) : aucune alerte');

    const { sortie: cotéRevue } = diagnostiquer({
      produit: 'revue', langue: 'fr', paragraphes: [resume650]
    });
    assert.deepStrictEqual(cotéRevue.alertes.map((a) => a.rule),
      ['Forme.LongueurResume.Revue'],
      '650 signes dépasse la fourchette française (400–600) : une alerte');
    assert.strictEqual(cotéRevue.alertes[0].severity, 'error');
  });

// ---------------------------------------------------------------------------------
// Contrôle n°6 — le code de sortie du moteur est non nul dès la première alerte `error`,
// et reste nul quand toutes les alertes sont de sévérité moindre.
//
// Sabotage minimal : dans principal(), remplacer
// `return 1 if any(a['severity'] == 'error' for a in alertes) else 0` par `return 0` —
// la première assertion (code === 1) rougit alors que le contexte contient bel et bien
// une error.

test('le code de sortie est non nul dès la première alerte error, nul sinon',
  { skip: sansPython }, () => {
    const { code: codeAvecError } = diagnostiquer({
      produit: 'revue', langue: 'fr',
      paragraphes: [{ source: 0, texte: 'L\'éducateur/trice accompagne les élèves.' }]
    });
    assert.strictEqual(codeAvecError, 1, 'une alerte error doit rendre le code de sortie 1');

    // Un contexte délibérément SANS RAPPORT avec les autres contrôles (APA.TroisAuteursPlus,
    // severity 'warning') : un sabotage qui casserait le contrôle n°3 (severity de
    // Epicene.FormesNonListeesSuggestion) ne doit jamais faire rougir CELUI-CI par ricochet.
    const { code: codeSansError } = diagnostiquer({
      produit: 'revue', langue: 'fr',
      paragraphes: [{ source: 0, texte: 'Dupont et al a montré cela.' }]  // warning seule
    });
    assert.strictEqual(codeSansError, 0,
      'aucune error (seulement une suggestion) doit rendre le code de sortie 0');
  });

// ---------------------------------------------------------------------------------
// Contrôle complémentaire n°7 — les avertissements C1 (ß) / C2 (guillemets droits) du
// filtre typographique sont REPRIS tels quels comme alertes, jamais réimplémentés (§6/§7
// du contrat) : ce module ne fait que redécouper la ligne stderr que
// pipeline/filters/szh-typographie.lua émet déjà.
//
// Sabotage minimal : dans RE_TYPO_AVERTISSEMENT, retirer le groupe de capture du code
// (remplacer `(\S+)` par `\S+`) — la reprise perd le nom du code, `rule` devient
// littéralement 'Typo.' + la phrase française entière au lieu de 'Typo.eszett' : l'assertion
// sur le nom de la règle rougit.

test('les avertissements C1/C2 du filtre typographique sont repris comme alertes, avec leur code',
  { skip: sansPython }, () => {
    const ligne = '[typo-avertissement] eszett | article « essai » | '
      + 'un « ß » subsiste : phrase fr. | [de] phrase de.';
    const { sortie } = diagnostiquer({
      produit: 'revue', langue: 'fr', paragraphes: [],
      avertissements_typo: [ligne]
    });
    assert.strictEqual(sortie.alertes.length, 1);
    assert.strictEqual(sortie.alertes[0].rule, 'Typo.eszett');
    assert.strictEqual(sortie.alertes[0].severity, 'warning');
    assert.ok(sortie.alertes[0].message.startsWith('un « ß » subsiste'),
      'la phrase française reprise telle quelle, jamais réécrite : ' + sortie.alertes[0].message);
  });

// ---------------------------------------------------------------------------------
// Contrôle complémentaire n°8 — une correction APA mécanique (le mot de liaison "&" ne
// s'utilise QU'entre parenthèses, "et"/"und" QUE dans le texte courant), pour couvrir la
// famille APA sans repayer les six contrôles précédents.
//
// Sabotage minimal : dans _fabriquer_detecteur_apa_liaison(), retirer la boucle
// `for m in re.finditer(r'&', texte): ...` (garder seulement la détection à l'intérieur des
// parenthèses) — un "&" fautif hors parenthèses ne serait plus jamais signalé, la première
// assertion rougit.

test('APA.DeuxAuteurs : "&" hors parenthèses et "et" dans une citation sont tous deux signalés',
  { skip: sansPython }, () => {
    const { sortie } = diagnostiquer({
      produit: 'revue', langue: 'fr',
      paragraphes: [{ source: 0, texte: 'Dupont & Martin le montrent (Dupont et Martin, 2020).' }]
    });
    const trouves = sortie.alertes.filter((a) => a.rule === 'APA.DeuxAuteurs.Revue');
    assert.strictEqual(trouves.length, 2, 'un "&" hors parenthèses ET un "et" dans la citation');
    assert.ok(trouves.some((a) => a.found === '&' && a.suggested === 'et'),
      'le "&" hors parenthèses doit suggérer "et"');
    assert.ok(trouves.some((a) => a.found.toLowerCase() === 'et' && a.suggested === '&'),
      'le "et" dans la citation entre parenthèses doit suggérer "&"');
  });

// ---------------------------------------------------------------------------------
// Contrôle complémentaire n°9 — un chapitre sans équivalent allemand (ici l'accessibilité,
// §7 du brief) reste actif en Revue et hérité en `suggestion` pour la Zeitschrift : deux
// entrées de catalogue distinctes, jamais une seule règle qui prétendrait tenir sa source
// des deux documents.
//
// Sabotage minimal : dans le catalogue, changer la sévérité de
// A11y.TexteAlternatif.ZeitschriftHeritee de 'suggestion' à 'warning' (celle de la Revue) —
// la deuxième assertion (sévérité 'suggestion' côté zeitschrift) rougit.

test('A11y.TexteAlternatif : actif en Revue, hérité en suggestion pour la Zeitschrift (pas de source allemande)',
  { skip: sansPython }, () => {
    const image = { source: 3, alt: '' };

    const { sortie: cotéRevue } = diagnostiquer({
      produit: 'revue', langue: 'fr', paragraphes: [], images: [image]
    });
    assert.strictEqual(cotéRevue.alertes.length, 1);
    assert.strictEqual(cotéRevue.alertes[0].rule, 'A11y.TexteAlternatif.Revue');
    assert.strictEqual(cotéRevue.alertes[0].severity, 'warning');

    const { sortie: cotéZeitschrift } = diagnostiquer({
      produit: 'zeitschrift', langue: 'de', paragraphes: [], images: [image]
    });
    assert.strictEqual(cotéZeitschrift.alertes.length, 1);
    assert.strictEqual(cotéZeitschrift.alertes[0].rule, 'A11y.TexteAlternatif.ZeitschriftHeritee');
    assert.strictEqual(cotéZeitschrift.alertes[0].severity, 'suggestion',
      'sans source normative allemande, l\'alerte est héritée en suggestion, pas en warning');
  });
