// Catalogue des règles structurelles et moteur d'alertes du nettoyeur de manuscrit
// (pipeline/manuscrit_regles.py), voir docs/ARCHITECTURE-nettoyeur-manuscrit.md. Les règles
// de langue (épicène, vocabulaire du handicap) sont des règles Vale, testées dans
// manuscrit-vale.test.js ; l'ordre de la bibliographie, dans manuscrit-biblio.test.js.
// Le module est piloté par sa CLI (--diagnostiquer, --catalogue), dans la WSL.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { python, pythonSortie, sansPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const MANUSCRIT_REGLES = path.join(RACINE, 'pipeline', 'manuscrit_regles.py');

function lancerPython(args, entree) {
  return python(args,
    { encoding: 'utf8', input: entree, maxBuffer: 64 * 1024 * 1024 });
}

// Lance --diagnostiquer sur un contexte. Rend { code, sortie } : `code` est le code de
// sortie du processus (1 s'il y a au moins une alerte error), `sortie` le JSON lu.
function diagnostiquer(contexte) {
  const r = lancerPython([MANUSCRIT_REGLES, '--diagnostiquer'], JSON.stringify(contexte));
  assert.ok(r.status === 0 || r.status === 1,
    '--diagnostiquer devait rendre 0 ou 1, a rendu ' + r.status + ' : ' + r.stderr);
  return { code: r.status, sortie: JSON.parse(r.stdout) };
}

function catalogue() {
  const r = lancerPython([MANUSCRIT_REGLES, '--catalogue']);
  assert.strictEqual(r.status, 0, '--catalogue a échoué : ' + r.stderr);
  return JSON.parse(r.stdout);
}

// La référence de chapitre permet de remonter d'une alerte à sa source.
test('chaque règle du catalogue porte une référence de chapitre non vide',
  { skip: sansPython }, () => {
    const regles = catalogue();
    assert.ok(regles.length > 0, 'le catalogue ne doit pas être vide');
    const sansChapitre = regles.filter((r) => !r.chapitre || !r.chapitre.trim());
    assert.deepStrictEqual(sansChapitre.map((r) => r.id), [],
      'ces règles n\'ont aucune référence de chapitre : ' + JSON.stringify(sansChapitre));
  });

// `found` et `suggested` s'affichent tels quels : ils sont en allemand pour la Zeitschrift.
test('longueurs Zeitschrift : found et suggested en allemand, sans « signes »',
  { skip: sansPython }, () => {
    const { sortie } = diagnostiquer({ produit: 'zeitschrift', langue: 'de', paragraphes: [
      { source: 0, role: 'titre', texte: 'T'.repeat(101) },
      { source: 1, role: 'sous_titre', texte: 'S'.repeat(121) },
      { source: 2, role: 'resume', texte: 'R'.repeat(701) },
      { source: 3, role: 'corps', texte: 'C'.repeat(18000) },
    ] });
    const regles = sortie.alertes.filter((a) => /^Forme\.Longueur(Article|Resume|Titre|SousTitre)\.Zeitschrift$/.test(a.rule));
    assert.strictEqual(regles.length, 4, JSON.stringify(sortie.alertes.map((a) => a.rule)));
    for (const a of regles) {
      assert.match(a.found, /^\d+ Zeichen$/, a.rule);
      assert.match(a.suggested, /^höchstens \d+ Zeichen/, a.rule);
      assert.ok(!/signes|au plus|réduire/.test(a.message + a.found + a.suggested), a.rule + ' : ' + a.message);
    }
  });

// Résumé : 400 à 600 signes en Revue, 700 au plus en Zeitschrift.
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

test('le code de sortie est non nul dès la première alerte error, nul sinon',
  { skip: sansPython }, () => {
    // Forme.LongueurArticle.Revue (error) : 20 000 signes dépassent le plafond de 18 000.
    const { code: codeAvecError } = diagnostiquer({
      produit: 'revue', langue: 'fr',
      paragraphes: [{ source: 0, texte: 'x'.repeat(20000) }]
    });
    assert.strictEqual(codeAvecError, 1, 'une alerte error doit rendre le code de sortie 1');

    // APA.TroisAuteursPlus, de sévérité warning.
    const { code: codeSansError } = diagnostiquer({
      produit: 'revue', langue: 'fr',
      paragraphes: [{ source: 0, texte: 'Dupont et al a montré cela.' }]  // warning seule
    });
    assert.strictEqual(codeSansError, 0,
      'aucune error (seulement une warning) doit rendre le code de sortie 0');
  });

// Le module redécoupe la ligne stderr émise par pipeline/filters/szh-typographie.lua, sans
// refaire le contrôle.
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

// Une règle sans source allemande a deux entrées au catalogue : celle de la Revue, et une
// copie héritée en suggestion pour la Zeitschrift.
test('A11y.TexteAlternatif : actif en Revue, hérité en suggestion pour la Zeitschrift (pas de source allemande)',
  { skip: sansPython }, () => {
    const image = { source: 3, alt: '' };

    const { sortie: cotéRevue } = diagnostiquer({
      produit: 'revue', langue: 'fr', paragraphes: [], images: [image]
    });
    assert.strictEqual(cotéRevue.alertes.length, 1);
    assert.strictEqual(cotéRevue.alertes[0].rule, 'A11y.TexteAlternatif.Revue');
    assert.strictEqual(cotéRevue.alertes[0].severity, 'warning');
    // `found` reste null : aucun texte du document ne correspond à une image manquante.
    // manuscrit_annoter.py pose alors un commentaire sur le paragraphe.
    assert.strictEqual(cotéRevue.alertes[0].found, null);

    const { sortie: cotéZeitschrift } = diagnostiquer({
      produit: 'zeitschrift', langue: 'de', paragraphes: [], images: [image]
    });
    assert.strictEqual(cotéZeitschrift.alertes.length, 1);
    assert.strictEqual(cotéZeitschrift.alertes[0].rule, 'A11y.TexteAlternatif.ZeitschriftHeritee');
    assert.strictEqual(cotéZeitschrift.alertes[0].severity, 'suggestion',
      'sans source normative allemande, l\'alerte est héritée en suggestion, pas en warning');
  });

// Un document peut commencer à H2 : le premier titre fixe le niveau de départ.
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

// `regle.langue` est courte (fr, de) ; le contexte peut porter une langue longue (fr-CH).
test('la comparaison de langue se fait sur la sous-étiquette primaire (fr-CH -> fr)',
  { skip: sansPython }, () => {
    const { sortie } = diagnostiquer({
      produit: 'revue', langue: 'fr-CH',
      paragraphes: [{ source: 0, role: 'resume', texte: 'x'.repeat(650) }]
    });
    assert.deepStrictEqual(sortie.alertes.map((a) => a.rule), ['Forme.LongueurResume.Revue'],
      'langue="fr-CH" doit déclencher les règles langue="fr", comme langue="fr" tout court');
  });

// La CLI concatène les alertes des moteurs sans dédoublonner : une règle en double dans ce
// catalogue donnerait deux alertes pour le même défaut.
test('APA.OrdreAlphabetiqueBiblio ne réapparaît jamais dans le catalogue (recouverte par manuscrit_biblio.verifier_ordre)',
  { skip: sansPython }, () => {
    const regles = catalogue();
    assert.ok(!regles.some((r) => r.id === 'APA.OrdreAlphabetiqueBiblio'),
      'cette règle est un doublon de manuscrit_biblio.py (APA.OrdreBiblio) : elle ne doit '
      + 'jamais revenir dans le catalogue structurel');
  });

// Entete.OrdreNomIncertain se décide sur le booléen `ordre_conflit` (posé par
// manuscrit_noms.trancher()), pas sur le texte de `ordre_motif`. `found` cite
// `texte_source`, le segment tel que l'auteur l'a tapé. Une fiche 'defaut' sans conflit ne
// lève que Entete.OrdreNomParDefaut.
test('Entete.OrdreNomIncertain : une alerte par fiche à ordre_conflit=true, jamais pour une fiche defaut sans conflit',
  { skip: sansPython }, () => {
    const { sortie } = diagnostiquer({
      produit: 'revue', langue: 'fr', paragraphes: [],
      auteurs: [
        { prenom: 'Guilley', nom: 'Edith', ordre_confiance: 'defaut', ordre_conflit: true,
          ordre_motif: 'signaux contradictoires à poids égal (casse, email) : convention '
            + 'prénom-nom appliquée par défaut', texte_source: 'Guilley Edith' },
        { prenom: 'Isabel', nom: 'Valarino', ordre_confiance: 'certaine', ordre_conflit: false,
          ordre_motif: 'nom marqué par les capitales (VALARINO)',
          texte_source: 'Isabel VALARINO' },
        // Fiche 'defaut' sans conflit : attendue dans OrdreNomParDefaut seulement.
        { prenom: 'Jean', nom: 'Martin', ordre_confiance: 'defaut', ordre_conflit: false,
          ordre_motif: 'aucun indice, convention prénom-nom appliquée',
          texte_source: 'Jean Martin' },
      ]
    });
    const alertesConflit = sortie.alertes.filter((a) => a.rule === 'Entete.OrdreNomIncertain');
    assert.strictEqual(alertesConflit.length, 1,
      'seule la fiche à ordre_conflit=true doit lever cette règle : '
      + JSON.stringify(sortie.alertes));
    assert.strictEqual(alertesConflit[0].severity, 'warning');
    assert.strictEqual(alertesConflit[0].action, 'report');
    assert.strictEqual(alertesConflit[0].found, 'Guilley Edith');
    assert.ok(alertesConflit[0].message.includes('Guilley Edith'),
      'le message doit nommer le segment litigieux : ' + alertesConflit[0].message);

    const alertesParDefaut = sortie.alertes.filter((a) => a.rule === 'Entete.OrdreNomParDefaut');
    assert.strictEqual(alertesParDefaut.length, 1);
    assert.ok(alertesParDefaut[0].found.includes('Jean Martin'),
      'la fiche defaut SANS conflit doit être comptée dans l\'agrégat : '
      + alertesParDefaut[0].found);
    assert.ok(!alertesParDefaut[0].found.includes('Guilley Edith'),
      'la fiche EN CONFLIT ne doit jamais apparaître dans l\'agrégat (elle a déjà sa propre '
      + 'alerte, individuelle) : ' + alertesParDefaut[0].found);
  });

// Entete.OrdreNomParDefaut : une alerte pour tout le document, pour limiter le volume
// d'alertes. `found` liste les noms concernés, séparés par « ; ».
test('Entete.OrdreNomParDefaut : une seule alerte agrégée pour trois fiches en defaut, silence si tout est tranché',
  { skip: sansPython }, () => {
    const { sortie: avecDefaut } = diagnostiquer({
      produit: 'revue', langue: 'fr', paragraphes: [],
      auteurs: [
        { prenom: '', nom: 'Dupont', ordre_confiance: 'defaut', ordre_conflit: false,
          ordre_motif: 'un seul jeton, aucun ordre à trancher', texte_source: 'Dupont' },
        { prenom: 'Jean', nom: 'Martin', ordre_confiance: 'defaut', ordre_conflit: false,
          ordre_motif: 'aucun indice, convention prénom-nom appliquée',
          texte_source: 'Jean Martin' },
        { prenom: 'Anne', nom: 'Muller', ordre_confiance: 'defaut', ordre_conflit: false,
          ordre_motif: 'aucun indice, convention prénom-nom appliquée',
          texte_source: 'Anne Muller' },
      ]
    });
    const alertesDefaut = avecDefaut.alertes.filter((a) => a.rule === 'Entete.OrdreNomParDefaut');
    assert.strictEqual(alertesDefaut.length, 1,
      'trois fiches en defaut ne doivent lever QU\'UNE SEULE alerte agrégée : '
      + JSON.stringify(avecDefaut.alertes));
    assert.strictEqual(alertesDefaut[0].severity, 'suggestion');
    assert.ok(alertesDefaut[0].found.includes('Dupont')
      && alertesDefaut[0].found.includes('Jean Martin')
      && alertesDefaut[0].found.includes('Anne Muller'),
      '`found` doit nommer les trois fiches concernées, séparées par « ; » : '
      + alertesDefaut[0].found);
    assert.ok(alertesDefaut[0].message.includes('3'),
      'le message doit compter les fiches concernées : ' + alertesDefaut[0].message);
    // ordre_conflit: false partout : Entete.OrdreNomIncertain reste muette.
    assert.deepStrictEqual(
      avecDefaut.alertes.filter((a) => a.rule === 'Entete.OrdreNomIncertain'), []);

    const { sortie: toutTranche } = diagnostiquer({
      produit: 'revue', langue: 'fr', paragraphes: [],
      auteurs: [
        { prenom: 'Isabel', nom: 'Valarino', ordre_confiance: 'certaine',
          ordre_motif: 'nom marqué par les capitales (VALARINO)',
          texte_source: 'Isabel VALARINO' },
        { prenom: 'Edith', nom: 'Guilley', ordre_confiance: 'propagee',
          ordre_motif: 'ordre propagé depuis « Isabel VALARINO » (nom marqué par les '
            + 'capitales)', texte_source: 'Edith Guilley' },
      ]
    });
    assert.deepStrictEqual(
      toutTranche.alertes.filter((a) => a.rule.startsWith('Entete.OrdreNom')), [],
      'aucune fiche en defaut (certaine + propagee) : silence total sur les deux règles '
      + 'Entete.OrdreNom*');
  });

// Forme.LongueurTitreChapitre.Zeitschrift : une alerte par document, ancrée sur le premier
// intertitre trop long, avec leur nombre et la limite.
test('intertitres trop longs (Zeitschrift) : une seule alerte, qui compte et cite le premier',
  { skip: sansPython }, () => {
    const long = (c) => c.repeat(85);
    const contexte = {
      produit: 'zeitschrift', langue: 'de',
      paragraphes: [
        { source: 0, role: 'titre', texte: 'Titel', niveau_retenu: 0 },
        { source: 3, role: 'corps', texte: 'Kurz', niveau_retenu: 1 },
        { source: 5, role: 'corps', texte: long('a'), niveau_retenu: 2 },
        { source: 7, role: 'corps', texte: 'x'.repeat(80), niveau_retenu: 2 },
        { source: 9, role: 'corps', texte: long('b'), niveau_retenu: 3 },
        { source: 11, role: 'corps', texte: long('c'), niveau_retenu: 1 },
        // Corps de texte : pas compté.
        { source: 12, role: 'corps', texte: long('d'), niveau_retenu: 0 },
      ]
    };
    const { sortie } = diagnostiquer(contexte);
    const alertes = sortie.alertes.filter((a) => a.rule === 'Forme.LongueurTitreChapitre.Zeitschrift');
    assert.strictEqual(alertes.length, 1, 'une seule alerte pour trois intertitres trop longs');
    const a = alertes[0];
    assert.strictEqual(a.para, 5, 'ancrée sur le premier intertitre trop long');
    assert.deepStrictEqual(a.span, [0, 85]);
    assert.strictEqual(a.found, long('a'));
    assert.strictEqual(a.severity, 'error');
    assert.strictEqual(a.action, 'report');
    assert.ok(a.message.includes('3') && a.message.includes('80') && a.message.includes(long('a')),
      'le message dit le nombre, la limite et cite le premier : ' + a.message);
    assert.strictEqual(a.message,
      '3 Titel der Kapitel sind länger als 80 Zeichen (inkl. Leerzeichen); der erste: «' + long('a') + '».');

    const un = diagnostiquer({ produit: 'zeitschrift', langue: 'de',
      paragraphes: [{ source: 2, role: 'corps', texte: long('z'), niveau_retenu: 2 }] });
    assert.strictEqual(un.sortie.alertes.length, 1);
    assert.strictEqual(un.sortie.alertes[0].message,
      'Ein Titel der Kapitel ist länger als 80 Zeichen (inkl. Leerzeichen): «' + long('z') + '».');

    const aucun = diagnostiquer({ produit: 'zeitschrift', langue: 'de',
      paragraphes: [{ source: 2, role: 'corps', texte: 'x'.repeat(80), niveau_retenu: 2 }] });
    assert.deepStrictEqual(aucun.sortie.alertes, [], 'à la limite exacte : rien');
    const revue = diagnostiquer({ produit: 'revue', langue: 'fr',
      paragraphes: [{ source: 2, role: 'corps', texte: long('z'), niveau_retenu: 2 }] });
    assert.deepStrictEqual(revue.sortie.alertes, [], 'règle propre à la Zeitschrift');
  });
