// test/js/manuscrit-regles.test.js : le catalogue de règles STRUCTURELLES et le moteur
// d'alertes du nettoyeur de manuscrit (article), §7 de
// outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md.
//
// ⚠ Révision du 19.09.2026 : les contrôles sur le langage épicène, le vocabulaire du
// handicap (dont le piège OQLF/CSPS) et la liaison et/& ont migré vers
// test/js/manuscrit-vale.test.js — ces familles vivent maintenant en YAML dans
// pipeline/vale/, portées par Vale, pas par ce module. Ce fichier ne garde que ce qui reste
// structurel :
//   1. chaque règle du catalogue porte une référence de chapitre non vide ;
//   2. les seuils diffèrent entre les deux produits : un résumé de 650 signes passe en
//      Zeitschrift (plafond seul, 700) et échoue en Revue (fourchette 400–600) ;
//   3. le code de sortie du moteur est non nul dès la première alerte `error` ;
//   4. les avertissements C1/C2 du filtre typographique sont REPRIS tels quels, jamais
//      réimplémentés ;
//   5. l'héritage en `suggestion` d'une règle d'accessibilité sans source normative
//      allemande ;
//   6. un saut de niveau de titre (H1 -> H3 sans H2) est détecté, un niveau de titre qui
//      reste dans l'ordre ne l'est pas ;
//   7. une bibliographie mal ordonnée est signalée, et une entrée SANS nom/année n'y entre
//      plus jamais comme un « None (None) » ;
//   8. `regle.langue` (toujours courte) se compare à la sous-étiquette PRIMAIRE d'une
//      langue de Contexte longue (fr-CH -> fr), jamais à la chaîne brute.
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

// ---------------------------------------------------------------------------------
// Contrôle n°1 — chaque règle du catalogue porte une référence de chapitre non vide :
// c'est ce qui permet à la rédaction de contester une alerte en remontant à sa source.
//
// Sabotage minimal : dans CATALOGUE, vider le champ `chapitre` d'UNE règle (par exemple
// Structure.NiveauxTitre -> '') — l'assertion sur cette règle précise rougit, et le message
// nomme l'id fautif.

test('chaque règle du catalogue porte une référence de chapitre non vide',
  { skip: sansPython }, () => {
    const regles = catalogue();
    assert.ok(regles.length > 0, 'le catalogue ne doit pas être vide');
    const sansChapitre = regles.filter((r) => !r.chapitre || !r.chapitre.trim());
    assert.deepStrictEqual(sansChapitre.map((r) => r.id), [],
      'ces règles n\'ont aucune référence de chapitre : ' + JSON.stringify(sansChapitre));
  });

// ---------------------------------------------------------------------------------
// Contrôle n°2 — les seuils sont bien des CONSTANTES PAR PRODUIT : un résumé de 650 signes
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
// Contrôle n°3 — le code de sortie du moteur est non nul dès la première alerte `error`,
// et reste nul quand toutes les alertes sont de sévérité moindre.
//
// Sabotage minimal : dans principal(), remplacer
// `return 1 if any(a['severity'] == 'error' for a in alertes) else 0` par `return 0` —
// la première assertion (code === 1) rougit alors que le contexte contient bel et bien
// une error.

test('le code de sortie est non nul dès la première alerte error, nul sinon',
  { skip: sansPython }, () => {
    // Forme.LongueurArticle.Revue (error) : un article de 20 000 signes dépasse le
    // plafond de 18 000. Ne dépend d'aucune règle lexicale migrée vers Vale.
    const { code: codeAvecError } = diagnostiquer({
      produit: 'revue', langue: 'fr',
      paragraphes: [{ source: 0, texte: 'x'.repeat(20000) }]
    });
    assert.strictEqual(codeAvecError, 1, 'une alerte error doit rendre le code de sortie 1');

    // Un contexte délibérément SANS RAPPORT avec le premier (APA.TroisAuteursPlus,
    // severity 'warning') : un sabotage qui casserait un autre contrôle ne doit jamais
    // faire rougir CELUI-CI par ricochet.
    const { code: codeSansError } = diagnostiquer({
      produit: 'revue', langue: 'fr',
      paragraphes: [{ source: 0, texte: 'Dupont et al a montré cela.' }]  // warning seule
    });
    assert.strictEqual(codeSansError, 0,
      'aucune error (seulement une warning) doit rendre le code de sortie 0');
  });

// ---------------------------------------------------------------------------------
// Contrôle n°4 — les avertissements C1 (ß) / C2 (guillemets droits) du filtre
// typographique sont REPRIS tels quels comme alertes, jamais réimplémentés (§6/§7 du
// contrat) : ce module ne fait que redécouper la ligne stderr que
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
// Contrôle n°5 — un chapitre sans équivalent allemand (ici l'accessibilité, §7 du brief)
// reste actif en Revue et hérité en `suggestion` pour la Zeitschrift : deux entrées de
// catalogue distinctes, jamais une seule règle qui prétendrait tenir sa source des deux
// documents.
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

// ---------------------------------------------------------------------------------
// Contrôle n°6 — Structure.NiveauxTitre détecte un SAUT de niveau (H1 direct à H3, sans
// jamais poser de H2), pas un niveau 4 impossible : `niveau_retenu` est déjà borné à 0..3
// par manuscrit_modele.classer_titres(), un contrôle qui guettait un niveau > 3 ne pouvait
// donc jamais s'allumer. Un document qui commence directement à H2 (aucun H1) n'est PAS un
// saut : c'est un choix éditorial valide, le premier titre fixe son propre départ.
//
// Sabotage minimal : dans _detecter_saut_niveau_titre, remplacer
// `niveau > niveau_max_vu + 1` par `niveau > niveau_max_vu + 2` — le saut H1 -> H3 (écart de
// 2) ne serait plus détecté, la première assertion rougit.

test('Structure.NiveauxTitre : un saut H1 -> H3 est détecté, un départ à H2 ne l\'est pas',
  { skip: sansPython }, () => {
    const { sortie: avecSaut } = diagnostiquer({
      produit: 'revue', langue: 'fr',
      paragraphes: [
        { source: 0, texte: 'Titre 1', niveau_retenu: 1 },
        { source: 1, texte: 'Corps', niveau_retenu: 0 },
        { source: 2, texte: 'Titre 3 direct', niveau_retenu: 3 },
      ]
    });
    assert.strictEqual(avecSaut.alertes.length, 1);
    assert.strictEqual(avecSaut.alertes[0].rule, 'Structure.NiveauxTitre');
    assert.strictEqual(avecSaut.alertes[0].para, 2);

    const { sortie: departH2 } = diagnostiquer({
      produit: 'revue', langue: 'fr',
      paragraphes: [
        { source: 0, texte: 'Titre 2 seul', niveau_retenu: 2 },
        { source: 1, texte: 'Un autre titre 2', niveau_retenu: 2 },
      ]
    });
    assert.deepStrictEqual(departH2.alertes, [],
      'commencer directement à H2 (jamais de H1) est un choix éditorial valide, pas un saut');
  });

// ---------------------------------------------------------------------------------
// Contrôle n°7 — APA.OrdreAlphabetiqueBiblio signale une entrée mal classée, et une entrée
// SANS nom ni année (donnée manquante côté lecteur) n'y entre plus comme comparateur : elle
// ne produit jamais de message « None (None) ».
//
// Sabotage minimal : dans _detecter_ordre_biblio, retirer la garde
// `if nom is None or annee is None: continue` — le message redevient
// « Référence mal classée : None (None). » dès qu'une entrée incomplète précède une entrée
// valide, et la deuxième assertion (aucun "None" dans les messages) rougit.

test('APA.OrdreAlphabetiqueBiblio : ordre fautif détecté, entrée incomplète jamais "None (None)"',
  { skip: sansPython }, () => {
    const { sortie } = diagnostiquer({
      produit: 'revue', langue: 'fr',
      bibliographie: [
        { nom: 'Zorro', annee: 2020, source: 0 },
        { source: 1 },  // entrée incomplète : ne doit jamais apparaître dans un message
        { nom: 'Adam', annee: 2019, source: 2 },
      ]
    });
    assert.strictEqual(sortie.alertes.length, 1);
    assert.strictEqual(sortie.alertes[0].rule, 'APA.OrdreAlphabetiqueBiblio');
    assert.strictEqual(sortie.alertes[0].para, 2);
    assert.ok(!sortie.alertes.some((a) => /None/.test(a.message)),
      'aucune alerte ne doit jamais citer "None" : ' + JSON.stringify(sortie.alertes));
  });

// ---------------------------------------------------------------------------------
// Contrôle n°8 — `regle.langue` (toujours courte : 'fr', 'de', '') se compare à la
// sous-étiquette PRIMAIRE d'une langue de Contexte longue ('fr-CH' -> 'fr'), jamais à la
// chaîne brute — la CLI passera des codes courts après ce lot, mais le module doit rester
// robuste aux deux formes.
//
// Sabotage minimal : dans evaluer(), remplacer `_langue_courte(contexte.get('langue'))` par
// `contexte.get('langue') or ''` (comparaison brute, sans normalisation) — avec
// langue='fr-CH', plus aucune règle à `langue='fr'` ne matcherait ('fr-CH' != 'fr'), et
// l'assertion sur Forme.LongueurResume.Revue rougirait (aucune alerte au lieu d'une).

test('la comparaison de langue se fait sur la sous-étiquette primaire (fr-CH -> fr)',
  { skip: sansPython }, () => {
    const { sortie } = diagnostiquer({
      produit: 'revue', langue: 'fr-CH',
      paragraphes: [{ source: 0, role: 'resume', texte: 'x'.repeat(650) }]
    });
    assert.deepStrictEqual(sortie.alertes.map((a) => a.rule), ['Forme.LongueurResume.Revue'],
      'langue="fr-CH" doit déclencher les règles langue="fr", comme langue="fr" tout court');
  });
