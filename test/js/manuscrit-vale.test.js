// Tests du pont Vale du nettoyeur de manuscrit (pipeline/manuscrit_vale.py, voir
// docs/ARCHITECTURE-nettoyeur-manuscrit.md). Les règles lexicales et éditoriales (langage
// épicène, vocabulaire du handicap, casse maison, liaison et/&, citation directe, nom des
// éditions) sont des fichiers YAML de pipeline/vale/styles/, exécutés par Vale ;
// pipeline/manuscrit_regles.py ne garde que le structurel.
//
// Contrôles :
//   1. la configuration Vale se charge (vale ls-config) et les trois styles (CSPS,
//      CSPS-Biblio, SZH) sont attachés à leurs quatre fichiers ;
//   2. un positif et un négatif pour chaque règle du catalogue ;
//   3. « personne en situation de handicap » ne lève rien ;
//   4. inversion épicène : chaque produit proscrit le contraire de l'autre ;
//   5. les URL et DOI ne déclenchent pas Epicene dans le corps (masquage), alors qu'un DOI
//      reste lisible, donc réécrit, dans la bibliographie ;
//   6. extraire() rend une ligne par paragraphe avec un index exact, et refuse un mélange
//      corps/bibliographie ;
//   7. analyser() rend indisponible=True, sans exception, quand vale ne peut pas tourner
//      (configuration cassée, règle YAML mal formée) ;
//   8. _resoudre_vale_bin() retrouve un vale installé hors PATH (~/.local/bin, poste sans
//      sudo) : un exec WSL non interactif n'a pas ~/.local/bin dans son PATH.
//
// vale est cherché sur le PATH, puis par wsl.exe -d SZH-Publishing. Sans vale, le test est
// sauté, sauf avec SZH_VALE_OBLIGATOIRE=1 qui en fait un échec. Le job `contrats` de la CI
// installe vale (.github/workflows/ci.yml).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const gardes = require('./gardes');
const { sansPython, cheminPython } = gardes;

const RACINE = path.resolve(__dirname, '..', '..');
const MANUSCRIT_VALE = path.join(RACINE, 'pipeline', 'manuscrit_vale.py');
const DISTRO = 'SZH-Publishing';

function python(args, entree) {
  return gardes.pythonGroupe(args, { input: entree, maxBuffer: 64 * 1024 * 1024 });
}

// ---------------------------------------------------------------------------------
// Détection de vale : PATH d'abord, wsl.exe en repli. Un délai borne chaque tentative.

function detecterValeSurPath() {
  try {
    const r = cp.spawnSync('vale', ['--version'],
      { encoding: 'utf8', timeout: 5000, windowsHide: true });
    return !r.error && r.status === 0 && /vale version/i.test(String(r.stdout || ''));
  } catch (e) {
    return false;
  }
}

function detecterValeSurWsl() {
  const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  const exe = fs.existsSync(wslExe) ? wslExe : 'wsl.exe';
  try {
    // bash -lc : sans sudo, vale s'installe dans ~/.local/bin, qui n'entre sur le PATH que
    // par .profile, non lu par une commande `wsl -- ...` nue.
    const r = cp.spawnSync(exe, ['-d', DISTRO, '--', 'bash', '-lc', 'vale --version'],
      { encoding: 'utf8', timeout: 15000, windowsHide: true });
    return !r.error && r.status === 0 && /vale version/i.test(String(r.stdout || ''));
  } catch (e) {
    return false;
  }
}

const _valeOk = detecterValeSurPath() || detecterValeSurWsl();

function exiger(variable, motif) {
  if (motif && process.env[variable]) {
    throw new Error(motif + ' — ' + variable + ' est posé : cet outil est déclaré '
      + 'obligatoire, sauter le contrôle est refusé.');
  }
  return motif;
}
// Motif de la famille `vale` (test/js/motifs-saut.js) : admise sur windows et sur le poste,
// refusée sur ubuntu, où le job `contrats` installe vale et pose SZH_VALE_OBLIGATOIRE=1.
const sansVale = exiger('SZH_VALE_OBLIGATOIRE',
  _valeOk ? false : 'vale absent (ni sur le PATH, ni dans la distro ' + DISTRO
    + ' via wsl.exe)');

// ---------------------------------------------------------------------------------
// Appels à manuscrit_vale.py par ses trois modes CLI, JSON sur stdin/stdout.

function analyser(paragraphesCorps, paragraphesBiblio, langue) {
  const r = python([MANUSCRIT_VALE, '--analyser'], JSON.stringify({
    paragraphes_corps: paragraphesCorps, paragraphes_biblio: paragraphesBiblio, langue
  }));
  assert.ok(r.status === 0 || r.status === 1,
    '--analyser devait rendre 0 ou 1, a rendu ' + r.status + ' : ' + r.stderr);
  let sortie;
  try {
    sortie = JSON.parse(r.stdout);
  } catch (e) {
    throw new Error('--analyser n\'a pas rendu de JSON exploitable : ' + e.message
      + '\nstdout: ' + r.stdout + '\nstderr: ' + r.stderr);
  }
  return { code: r.status, sortie, stderr: r.stderr };
}

function analyserCorps(texte, langue, role) {
  return analyser([{ source: 0, texte, role: role || '' }], [], langue);
}

function analyserBiblio(texte, langue) {
  return analyser([], [{ source: 0, texte, role: 'bibliographie' }], langue);
}

function extraire(paragraphes, langue) {
  const r = python([MANUSCRIT_VALE, '--extraire'], JSON.stringify({ paragraphes, langue }));
  return { code: r.status, stderr: r.stderr,
    sortie: r.status === 0 ? JSON.parse(r.stdout) : null };
}

// ---------------------------------------------------------------------------------
// Contrôle n°1 : la configuration Vale se charge, les trois styles sont attachés à leurs
// quatre fichiers.
//
// Sabotage : dans pipeline/vale/.vale.ini, retirer l'étoile en tête d'une section
// (`[*corps-fr.txt]` -> `[corps-fr.txt]`). Un nom de fichier sans caractère générique ne
// déclenche aucune règle (Vale 3.22) : le contrôle n°2 sur CSPS.Epicene.FormesContractees
// rougit.

test('la configuration Vale se charge : CSPS, CSPS-Biblio et SZH sont attachés',
  { skip: sansVale }, () => {
    const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
    const exe = fs.existsSync(wslExe) ? wslExe : 'wsl.exe';
    const cheminIni = path.join(RACINE, 'pipeline', 'vale', '.vale.ini');
    let r;
    if (detecterValeSurPath()) {
      r = cp.spawnSync('vale', ['--config', cheminIni, 'ls-config'], { encoding: 'utf8' });
    } else {
      // wslpath : wsl.exe avale les barres inverses d'un argument en tableau.
      const versWsl = (c) => cp.spawnSync(exe, ['-d', DISTRO, '--', 'wslpath', '-a',
        c.replace(/\\/g, '/')], { encoding: 'utf8' }).stdout.trim();
      r = cp.spawnSync(exe, ['-d', DISTRO, '--', 'bash', '-lc',
        'vale --config ' + versWsl(cheminIni) + ' ls-config'], { encoding: 'utf8' });
    }
    assert.strictEqual(r.status, 0, 'vale ls-config a échoué : ' + r.stderr);
    const config = JSON.parse(r.stdout);
    assert.ok(!config.Code, 'la configuration ne doit porter aucune erreur : '
      + JSON.stringify(config));
    const base = config.SBaseStyles || {};
    assert.deepStrictEqual(base['*corps-fr.txt'], ['CSPS']);
    assert.deepStrictEqual(base['*biblio-fr.txt'], ['CSPS-Biblio']);
    assert.deepStrictEqual(base['*corps-de.txt'], ['SZH']);
  });

// ---------------------------------------------------------------------------------
// Contrôle n°2 : un positif et un négatif pour chacune des vingt règles du catalogue. Chaque
// cas nomme la fonction d'analyse (corps ou biblio) et la langue, comme en usage réel.

const CAS = [
  { regle: 'CSPS.Epicene.FormesContractees',
    positif: () => analyserCorps("L'éducateur/trice accompagne les élèves.", 'fr'),
    negatif: () => analyserCorps("L'éducatrice et l'éducateur accompagnent les élèves.", 'fr'),
    severitePositif: 'error' },
  { regle: 'CSPS.Epicene.FormesNonListees',
    positif: () => analyserCorps('Les étudiant-e-s sont attendus.', 'fr'),
    negatif: () => analyserCorps('Les étudiants sont attendus.', 'fr'),
    severitePositif: 'suggestion' },
  { regle: 'CSPS.Epicene.FormuleGenerique',
    positif: () => analyserCorps(
      'Le masculin est utilisé à titre générique dans ce texte.', 'fr'),
    negatif: () => analyserCorps('Le masculin est un genre grammatical courant.', 'fr'),
    severitePositif: 'error' },
  { regle: 'CSPS.Vocabulaire.Handicap',
    positif: () => analyserCorps('Ces places pour handicapés sont réservées.', 'fr'),
    negatif: () => analyserCorps('Ces places accessibles sont réservées.', 'fr'),
    severitePositif: 'suggestion' },
  { regle: 'CSPS.Vocabulaire.HandicapPersonne',
    positif: () => analyserCorps('Cette personne handicapée participe pleinement.', 'fr'),
    negatif: () => analyserCorps(
      'Cette personne en situation de handicap participe pleinement.', 'fr'),
    severitePositif: 'suggestion' },
  { regle: 'CSPS.Casse.Internet',
    positif: () => analyserCorps('On consulte internet régulièrement.', 'fr'),
    negatif: () => analyserCorps('On consulte Internet régulièrement.', 'fr'),
    severitePositif: 'warning' },
  { regle: 'CSPS.Editions.SZH',
    positif: () => analyserCorps('Les Editions SZH/CSPS ont publié cet ouvrage.', 'fr'),
    negatif: () => analyserCorps('Les éditions SZH/CSPS ont publié cet ouvrage.', 'fr'),
    severitePositif: 'warning' },
  { regle: 'CSPS.Vocabulaire.Cf',
    positif: () => analyserCorps('Voir cf. le rapport pour plus de détails.', 'fr'),
    negatif: () => analyserCorps('Voir le rapport pour plus de détails.', 'fr'),
    severitePositif: 'warning' },
  { regle: 'CSPS.APA.EtDansParentheses',
    positif: () => analyserCorps('Ils le montrent (Dupont et Martin, 2020).', 'fr'),
    negatif: () => analyserCorps('Ils le montrent (Dupont et al., 2020).', 'fr'),
    severitePositif: 'warning' },
  { regle: 'CSPS.APA.EsperluetteHorsParentheses',
    positif: () => analyserCorps('Dupont & Martin le montrent clairement.', 'fr'),
    negatif: () => analyserCorps('Ils le montrent (Dupont & Martin, 2020).', 'fr'),
    severitePositif: 'suggestion' },
  { regle: 'CSPS.APA.CitationDirectePage',
    positif: () => analyserCorps('« Une citation directe » (Fougeyrollas, 2010).', 'fr'),
    negatif: () => analyserCorps('« Une citation directe » (Fougeyrollas, 2010, p. 9).', 'fr'),
    severitePositif: 'warning' },
  { regle: 'CSPS.Forme.AbreviationHorsParentheses',
    positif: () => analyserCorps(
      'Les autrices utilisent des tableaux, des graphiques, etc. dans leur article.', 'fr'),
    negatif: () => analyserCorps(
      'Les autrices utilisent plusieurs supports visuels (tableaux, graphiques, etc.).', 'fr'),
    severitePositif: 'suggestion' },
  { regle: 'CSPS-Biblio.APA.DoiForme',
    positif: () => analyserBiblio(
      'Muster, E. (2010). Un article. Revue X, 3, 1-10. doi:10.1000/xyz123', 'fr'),
    negatif: () => analyserBiblio(
      'Muster, E. (2010). Un article. Revue X, 3, 1-10. https://doi.org/10.1000/xyz123', 'fr'),
    severitePositif: 'warning' },
  { regle: 'CSPS-Biblio.APA.Esperluette',
    positif: () => analyserBiblio(
      'Bissonnette, S., Richard, M., et Bouchard, C. (2010). Un titre.', 'fr'),
    negatif: () => analyserBiblio(
      'Bissonnette, S., Richard, M., & Bouchard, C. (2010). Un titre.', 'fr'),
    severitePositif: 'warning' },
  { regle: 'SZH.Epicene.Paarform',
    positif: () => analyserCorps('Die Schülerinnen und Schüler kommen morgen.', 'de'),
    negatif: () => analyserCorps('Die Schüler:innen kommen morgen.', 'de'),
    severitePositif: 'error' },
  { regle: 'SZH.Vokabular.Behinderung',
    positif: () => analyserCorps('Wir sprechen über behinderte Menschen im Alltag.', 'de'),
    negatif: () => analyserCorps('Wir sprechen über Menschen mit Behinderung im Alltag.', 'de'),
    severitePositif: 'warning' },
  { regle: 'SZH.Epicene.GenerischesMaskulinum',
    positif: () => analyserCorps('Das Maskulinum gilt hier generisch für beide Geschlechter.', 'de'),
    negatif: () => analyserCorps('Das Team bespricht die Struktur des Artikels sorgfältig.', 'de'),
    severitePositif: 'error' },
  { regle: 'SZH.APA.WoertlichesZitatSeite',
    positif: () => analyserCorps('«Ein wörtliches Zitat» (Muster, 2015).', 'de'),
    negatif: () => analyserCorps('«Ein wörtliches Zitat» (Muster, 2015, S. 10).', 'de'),
    severitePositif: 'suggestion' },
  { regle: 'SZH.APA.UndInKlammern',
    positif: () => analyserCorps('Das zeigen sie deutlich (Muster und Meier, 2015).', 'de'),
    negatif: () => analyserCorps('Das zeigen sie deutlich (Muster & Meier, 2015).', 'de'),
    severitePositif: 'warning' },
  { regle: 'SZH.APA.KaufmannsUndAusserhalbKlammern',
    positif: () => analyserCorps('Muster & Meier zeigen das deutlich.', 'de'),
    negatif: () => analyserCorps('Das zeigen sie deutlich (Muster & Meier, 2015).', 'de'),
    severitePositif: 'suggestion' },
];

for (const cas of CAS) {
  test('règle ' + cas.regle + ' : positif signalé, négatif silencieux',
    { skip: sansVale }, () => {
      const { sortie: avecFaute } = cas.positif();
      const trouves = avecFaute.alertes.filter((a) => a.rule === cas.regle);
      assert.strictEqual(trouves.length, 1,
        cas.regle + ' aurait dû lever exactement une alerte sur le cas positif : '
        + JSON.stringify(avecFaute.alertes));
      assert.strictEqual(trouves[0].severity, cas.severitePositif);

      const { sortie: sansFaute } = cas.negatif();
      const trouvesNeg = sansFaute.alertes.filter((a) => a.rule === cas.regle);
      assert.deepStrictEqual(trouvesNeg, [],
        cas.regle + ' n\'aurait dû lever aucune alerte sur le cas négatif : '
        + JSON.stringify(sansFaute.alertes));
    });
}

// Une ligne à silhouette de référence (« Baumann, M., Bolz, T. & Albers, V. (2021) ») ne
// reçoit pas la règle du « & », même lue comme corps parce que son intitulé de bibliographie
// n'a pas été reconnu.
test('« & » d’une ligne à silhouette de référence, lue comme corps : aucune alerte (de et fr)',
  { skip: sansVale }, () => {
    const { sortie: de } = analyserCorps(
      'Baumann, M., Bolz, T. & Albers, V. (2021). Verstehende Diagnostik in der Pädagogik.', 'de');
    assert.deepStrictEqual(
      de.alertes.filter((a) => a.rule === 'SZH.APA.KaufmannsUndAusserhalbKlammern'), [],
      JSON.stringify(de.alertes));
    const { sortie: fr } = analyserCorps(
      'Dupont, M., & Martin, P. (2020). Une étude de cas. Éditions X.', 'fr');
    assert.deepStrictEqual(
      fr.alertes.filter((a) => a.rule === 'CSPS.APA.EsperluetteHorsParentheses'), [],
      JSON.stringify(fr.alertes));
  });

// ---------------------------------------------------------------------------------
// _raffiner_et_dans_parentheses() et _raffiner_und_in_klammern() réduisent `found` à « et »
// ou « und » ; `_convertir_alerte()` réduit `span` de même. Sinon `span` couvre toute la
// parenthèse, manuscrit_annoter._localizar() refuse le span (`texto[d:f] != found`) et
// l'alerte retombe en commentaire sur le paragraphe entier.
//
// Sabotage : dans _convertir_alerte(), remplacer `span0 = resultat.get('span', span0)` par
// `pass`.

test('CSPS.APA.EtDansParentheses : `span` vise EXACTEMENT « et », jamais toute la parenthèse',
  { skip: sansVale }, () => {
    const { sortie } = analyserCorps('Ils le montrent (Dupont et Martin, 2020).', 'fr');
    const a = sortie.alertes.find((x) => x.rule === 'CSPS.APA.EtDansParentheses');
    assert.ok(a, 'alerte introuvable : ' + JSON.stringify(sortie.alertes));
    assert.strictEqual(a.found, 'et');
    assert.ok(Array.isArray(a.span) && a.span.length === 2, 'span absent : ' + JSON.stringify(a));
    const texte = 'Ils le montrent (Dupont et Martin, 2020).';
    assert.strictEqual(texte.slice(a.span[0], a.span[1]), 'et',
      'span devrait viser exactement « et », pas toute la parenthèse : ' + JSON.stringify(a));
  });

test('SZH.APA.UndInKlammern : `span` vise EXACTEMENT « und », jamais toute la parenthèse',
  { skip: sansVale }, () => {
    const { sortie } = analyserCorps('Das zeigen sie deutlich (Muster und Meier, 2015).', 'de');
    const a = sortie.alertes.find((x) => x.rule === 'SZH.APA.UndInKlammern');
    assert.ok(a, 'alerte introuvable : ' + JSON.stringify(sortie.alertes));
    assert.strictEqual(a.found, 'und');
    const texte = 'Das zeigen sie deutlich (Muster und Meier, 2015).';
    assert.strictEqual(texte.slice(a.span[0], a.span[1]), 'und',
      'span devrait viser exactement « und », pas toute la parenthèse : ' + JSON.stringify(a));
  });

// ---------------------------------------------------------------------------------
// CSPS.Vocabulaire.Cf : « cf. » en tête de phrase devient « Voir », avec majuscule ; un mot
// qui contient « cf » sans être l'abréviation n'est pas touché.
//
// Sabotage : dans pipeline/vale/styles/CSPS/Vocabulaire/Cf.yml, retirer `nonword: true`.
// Chaque motif finit sur un point ; le \b que Vale ajoute en fin de motif échoue alors et la
// règle ne se déclenche plus.

test('CSPS.Vocabulaire.Cf : « Cf. » en tête de phrase devient « Voir », jamais « voir »',
  { skip: sansVale }, () => {
    const { sortie: enTete } = analyserCorps('Cf. le rapport pour plus de détails.', 'fr');
    const trouve = enTete.alertes.filter((a) => a.rule === 'CSPS.Vocabulaire.Cf');
    assert.strictEqual(trouve.length, 1);
    assert.strictEqual(trouve[0].found, 'Cf.');
    assert.strictEqual(trouve[0].suggested, 'Voir',
      'en tête de phrase, la suggestion doit garder la majuscule');

    const { sortie: motOrdinaire } = analyserCorps(
      'On y trouve une confection artisanale et un scfumage rare.', 'fr');
    assert.deepStrictEqual(
      motOrdinaire.alertes.filter((a) => a.rule === 'CSPS.Vocabulaire.Cf'), [],
      '« cf » à l\'intérieur d\'un autre mot ne doit jamais être touché');
  });

// ---------------------------------------------------------------------------------
// CSPS.Vocabulaire.HandicapPersonne : un nom propre de loi ou de convention n'est pas corrigé
// (exemples des Lignes directrices de la Revue, 3.1.3).
//
// Sabotage : dans manuscrit_vale._raffiner_handicap_personne, remplacer le `or` entre les deux
// signaux (mot introducteur, sigle) par un `and` ; le second cas (une loi nommée sans sigle)
// rougit.

test("CSPS.Vocabulaire.HandicapPersonne : un nom propre de loi ou de convention n'est jamais corrigé",
  { skip: sansVale }, () => {
    const { sortie: loi } = analyserCorps(
      "Selon la Loi sur l'égalité pour les personnes handicapées (LHand), l'accès doit être garanti.",
      'fr');
    assert.deepStrictEqual(
      loi.alertes.filter((a) => a.rule === 'CSPS.Vocabulaire.HandicapPersonne'), [],
      "le nom d'une loi ne doit jamais être signalé : " + JSON.stringify(loi.alertes));

    const { sortie: convention } = analyserCorps(
      'La Convention relative aux droits des personnes handicapées (CDPH) le garantit.', 'fr');
    assert.deepStrictEqual(
      convention.alertes.filter((a) => a.rule === 'CSPS.Vocabulaire.HandicapPersonne'), [],
      "le nom d'une convention ne doit jamais être signalé : " + JSON.stringify(convention.alertes));

    const { sortie: ordinaire } = analyserCorps(
      'Cette personne handicapée participe pleinement aux activités.', 'fr');
    const trouve = ordinaire.alertes.filter((a) => a.rule === 'CSPS.Vocabulaire.HandicapPersonne');
    assert.strictEqual(trouve.length, 1,
      "un usage ordinaire, hors nom de loi, doit rester signalé : " + JSON.stringify(ordinaire.alertes));
    assert.strictEqual(trouve[0].suggested, 'personne(s) en situation de handicap');
  });

// ---------------------------------------------------------------------------------
// SZH.APA.WoertlichesZitatSeite : une « persönliche Kommunikation » ne porte pas de numéro
// de page en APA.
//
// Sabotage : dans manuscrit_vale._raffiner_woertliches_zitat_seite, remplacer `return None`
// par `return {}`.

test('SZH.APA.WoertlichesZitatSeite : une communication personnelle ne demande jamais de page',
  { skip: sansVale }, () => {
    const { sortie } = analyserCorps(
      '«Das war schwierig» (Müller, persönliche Kommunikation, 12.03.2025).', 'de');
    assert.deepStrictEqual(
      sortie.alertes.filter((a) => a.rule === 'SZH.APA.WoertlichesZitatSeite'), [],
      'une communication personnelle ne doit jamais être signalée : ' + JSON.stringify(sortie.alertes));
  });

// ---------------------------------------------------------------------------------
// Une entrée bibliographique lève les deux règles CSPS-Biblio (DoiForme et Esperluette) sur
// la même ligne, à condition de passer par le rôle 'bibliographie' (fichier biblio-fr.txt).
// Avec le rôle '' ou un fichier corps-fr.txt, c'est le style CSPS (corps) qui s'applique, où
// ces deux règles n'existent pas.
//
// Sabotage : dans manuscrit_vale.extraire(), remplacer
// `cible = lignes_biblio if role == 'bibliographie' else lignes_corps` par
// `cible = lignes_corps`.

test('une entrée bibliographique réelle lève DoiForme ET Esperluette sur la même ligne',
  { skip: sansVale }, () => {
    const { sortie } = analyserBiblio(
      'Dupont, A., et Martin, B. (2020). Titre. Revue, 3(2), 1-10. doi:10.1000/xyz', 'fr');
    const regles = sortie.alertes.map((a) => a.rule).sort();
    assert.deepStrictEqual(regles,
      ['CSPS-Biblio.APA.DoiForme', 'CSPS-Biblio.APA.Esperluette'].sort(),
      'les deux règles doivent se déclencher sur cette entrée : ' + JSON.stringify(sortie.alertes));
    const doi = sortie.alertes.find((a) => a.rule === 'CSPS-Biblio.APA.DoiForme');
    assert.strictEqual(doi.suggested, 'https://doi.org/10.1000/xyz');
    const esperluette = sortie.alertes.find((a) => a.rule === 'CSPS-Biblio.APA.Esperluette');
    assert.strictEqual(esperluette.suggested, ', & Martin, B.');
  });

// ---------------------------------------------------------------------------------
// Contrôle n°3 : la forme recommandée « personne en situation de handicap » ne lève aucune
// alerte, quelle que soit la règle.
//
// Sabotage : dans pipeline/vale/styles/CSPS/Vocabulaire/Handicap.yml, élargir
// `personnes? handicap[ée]e?s?` en `personnes?.{0,30}handicap[ée]?e?s?`.

test('le piège OQLF/CSPS : "personne en situation de handicap" ne lève absolument rien',
  { skip: sansVale }, () => {
    const { sortie } = analyserCorps(
      'Cette personne en situation de handicap participe pleinement.', 'fr');
    assert.deepStrictEqual(sortie.alertes, [],
      'la forme recommandée par la CSPS/MDH-PPH ne doit jamais être signalée, par aucune '
      + 'règle : ' + JSON.stringify(sortie.alertes));
  });

// ---------------------------------------------------------------------------------
// Contrôle n°4 : inversion épicène, les deux revues prescrivent des solutions opposées.
//
// Sabotage : dans pipeline/vale/styles/SZH/Epicene/Paarform.yml, ajouter un motif qui
// reconnaît le deux-points (`Schüler:innen`).

test('l\'inversion épicène : chaque produit proscrit exactement le contraire de l\'autre',
  { skip: sansVale }, () => {
    const { sortie: revueSlash } = analyserCorps("L'éducateur/trice accompagne les élèves.", 'fr');
    assert.deepStrictEqual(revueSlash.alertes.map((a) => a.rule),
      ['CSPS.Epicene.FormesContractees'],
      '« éducateur/trice » doit lever une alerte en français');

    const { sortie: zeitschriftDeuxPoints } = analyserCorps('Die Schüler:innen kommen morgen.', 'de');
    assert.deepStrictEqual(zeitschriftDeuxPoints.alertes, [],
      '« Schüler:innen » est la solution PRESCRITE côté allemand : aucune alerte');

    const { sortie: zeitschriftPaarform } = analyserCorps(
      'Die Schülerinnen und Schüler kommen morgen.', 'de');
    assert.deepStrictEqual(zeitschriftPaarform.alertes.map((a) => a.rule),
      ['SZH.Epicene.Paarform'], 'la Paarform avec "und" doit être signalée côté allemand');

    const { sortie: revueFormeDouble } = analyserCorps(
      "L'éducatrice et l'éducateur accompagnent les élèves.", 'fr');
    assert.deepStrictEqual(revueFormeDouble.alertes, [],
      'la forme double complète, équivalente à la Paarform allemande, n\'est PAS proscrite '
      + 'en français : c\'est au contraire la solution de repli prescrite par ce document');
  });

// ---------------------------------------------------------------------------------
// Contrôle n°5 : les URL et DOI ne déclenchent pas Epicene dans le corps (masquage) ; un DOI
// reste lisible, donc réécrit, dans la bibliographie.
//
// Sabotage : ne plus appeler manuscrit_vale._masquer_urls sur les lignes de corps ;
// `downloads/sections` lève alors Epicene.

test('une URL ne déclenche jamais Epicene dans le corps ; un DOI reste corrigible en bibliographie',
  { skip: sansVale }, () => {
    const { sortie: corps } = analyserCorps(
      'Voir https://www.exemple.ch/downloads/sections et https://vaud/documents ici.', 'fr');
    assert.deepStrictEqual(corps.alertes, [],
      'une URL masquée ne doit déclencher aucune règle du corps : '
      + JSON.stringify(corps.alertes));

    const { sortie: biblio } = analyserBiblio(
      'Muster, E. (2010). Un article. Revue X, 3, 1-10. doi:10.1000/xyz123', 'fr');
    assert.strictEqual(biblio.alertes.length, 1,
      'un DOI en bibliographie doit rester lisible pour être corrigé : jamais masqué');
    assert.strictEqual(biblio.alertes[0].rule, 'CSPS-Biblio.APA.DoiForme');
    assert.strictEqual(biblio.alertes[0].suggested, 'https://doi.org/10.1000/xyz123');
  });

// ---------------------------------------------------------------------------------
// Contrôle n°6 : extraire() rend une ligne par paragraphe et un index exact ; un mélange de
// rôles corps/bibliographie dans le même appel est refusé.
//
// Sabotage : dans extraire(), remplacer `index[len(cible)] = p.get('source')` par
// `index[len(cible) - 1] = p.get('source')`.

test('extraire() : une ligne par paragraphe, un index exact, jamais de mélange de rôles',
  { skip: sansPython }, () => {
    const { sortie } = extraire([
      { source: 10, texte: 'Premier paragraphe.', role: '' },
      { source: 20, texte: 'Deuxième paragraphe.', role: 'titre' },
      { source: 30, texte: 'Troisième paragraphe.', role: '' },
    ], 'fr');
    assert.strictEqual(sortie.texte_corps,
      'Premier paragraphe.\nDeuxième paragraphe.\nTroisième paragraphe.');
    assert.strictEqual(sortie.texte_biblio, '');
    assert.deepStrictEqual(sortie.index, { '1': 10, '2': 20, '3': 30 });

    const { sortie: biblioSeule } = extraire([
      { source: 40, texte: 'Une référence.', role: 'bibliographie' },
    ], 'fr');
    assert.strictEqual(biblioSeule.texte_corps, '');
    assert.strictEqual(biblioSeule.texte_biblio, 'Une référence.');
    assert.deepStrictEqual(biblioSeule.index, { '1': 40 });

    // Un mélange corps + bibliographie donnerait deux « ligne 1 » sous la même clé :
    // extraire() le refuse.
    const melange = extraire([
      { source: 1, texte: 'Corps.', role: '' },
      { source: 2, texte: 'Référence.', role: 'bibliographie' },
    ], 'fr');
    assert.notStrictEqual(melange.code, 0,
      'un mélange de rôles doit être refusé, jamais accepté avec un index ambigu');
  });

// ---------------------------------------------------------------------------------
// Contrôle n°7 : analyser() rend indisponible=True, sans exception, quand vale ne peut pas
// tourner. Deux causes : configuration introuvable (exit 0) et règle YAML mal formée dans un
// style valide (exit 2). Dans les deux cas, le diagnostic JSON (avec "Code", ex. "E100") va
// sur stderr et stdout reste vide ; le code de sortie ne permet pas de les distinguer.
//
// Sabotage : dans _executer(), retirer le `try/except ValueError` autour de
// `json.loads(brut)` ; `json.loads('')` lève et le processus Python échoue.

test('analyser() : indisponible=True proprement, jamais un plantage, config cassée',
  { skip: sansPython }, () => {
    const racineFactice = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-vale-factice-'));
    // Aucun pipeline/vale/.vale.ini sous cette racine : --config pointe vers un chemin
    // inexistant.
    const r = gardes.pythonGroupe([MANUSCRIT_VALE, '--analyser'], {
      input: JSON.stringify({
        paragraphes_corps: [{ source: 0, texte: 'Un texte quelconque.', role: '' }],
        paragraphes_biblio: [], langue: 'fr',
      }),
      env: Object.assign({}, process.env, { SZH_RACINE_VALE_FACTICE: racineFactice }),
    });
    // racine_depot se calcule depuis __file__ : un manuscrit_vale.py temporaire importe le
    // vrai module et force racine_depot vers un dossier sans pipeline/vale/.vale.ini.
    const pontFactice = path.join(racineFactice, 'pont_vale_factice.py');
    fs.writeFileSync(pontFactice, [
      'import json, sys',
      'sys.path.insert(0, ' + JSON.stringify(cheminPython(path.dirname(MANUSCRIT_VALE))) + ')',
      'import manuscrit_vale',
      'entree = json.loads(sys.stdin.read())',
      'alertes, indisponible = manuscrit_vale.analyser(',
      '    entree["paragraphes_corps"], entree["paragraphes_biblio"], entree["langue"],',
      '    ' + JSON.stringify(cheminPython(racineFactice)) + ')',
      'print(json.dumps({"alertes": alertes, "indisponible": indisponible}))',
    ].join('\n'), 'utf8');

    const r2 = gardes.pythonGroupe([pontFactice], {
      input: JSON.stringify({
        paragraphes_corps: [{ source: 0, texte: 'Un texte quelconque.', role: '' }],
        paragraphes_biblio: [], langue: 'fr',
      }),
    });
    assert.strictEqual(r2.status, 0,
      'analyser() ne doit jamais faire planter le processus, même config cassée : '
      + r2.stderr);
    let sortie;
    try {
      sortie = JSON.parse(r2.stdout);
    } catch (e) {
      throw new Error('analyser() a laissé filer une exception au lieu de indisponible=True :'
        + ' stdout=' + r2.stdout + ' stderr=' + r2.stderr);
    }
    assert.strictEqual(sortie.indisponible, true,
      'une configuration introuvable doit rendre indisponible=True');
    assert.deepStrictEqual(sortie.alertes, [], 'aucune alerte quand vale est indisponible');
  });

// ---------------------------------------------------------------------------------
// Contrôle n°8 : _resoudre_vale_bin() retrouve un vale installé dans ~/.local/bin, sans
// lancer vale. Le PATH de la machine de test ne convient pas (un vale sur le PATH serait
// trouvé d'abord) : un petit pont Python remplace `manuscrit_vale.shutil.which` par une
// fonction qui rend None, puis appelle `_resoudre_vale_bin(domicile_factice)`.
// domicile_factice est le paramètre injectable (os.path.expanduser('~') ignore HOME sous
// Windows) ; il ne contient que .local/bin/vale.
//
// Le premier candidat du repli, `/usr/local/bin/vale`, est un chemin littéral (celui de
// l'image de production), qui existe en CI et dans la WSL. Le pont remplace donc aussi
// `os.path.isfile` : False pour ce chemin, l'implémentation réelle pour le reste.
//
// Sabotage : retirer le candidat `os.path.join(domicile, '.local', 'bin', 'vale')` de la
// boucle ; la fonction rend le repli 'vale'.

test('_resoudre_vale_bin() : un vale hors PATH, dans ~/.local/bin, est retrouvé',
  { skip: sansPython }, () => {
    const fauxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-vale-home-'));
    const dossierBin = path.join(fauxHome, '.local', 'bin');
    fs.mkdirSync(dossierBin, { recursive: true });
    // 'vale' sans extension, même sous Windows : _resoudre_vale_bin() cherche ce nom. Le test
    // éprouve la fonction seule, quel que soit l'OS.
    const fauxVale = path.join(dossierBin, 'vale');
    fs.writeFileSync(fauxVale, '#!/bin/sh\necho vale version 3.22.0\n');
    try { fs.chmodSync(fauxVale, 0o755); } catch (e) { /* Windows : pas de bit x, ignoré */ }

    const pontFactice = path.join(fauxHome, 'pont_resolution_factice.py');
    fs.writeFileSync(pontFactice, [
      'import sys',
      'sys.path.insert(0, ' + JSON.stringify(cheminPython(path.dirname(MANUSCRIT_VALE))) + ')',
      'import manuscrit_vale',
      'manuscrit_vale.shutil.which = lambda nom: None',  // jamais un vale trouvé ailleurs
      '_vrai_isfile = manuscrit_vale.os.path.isfile',
      "manuscrit_vale.os.path.isfile = lambda p: False if p == '/usr/local/bin/vale' else _vrai_isfile(p)",
      'print(manuscrit_vale._resoudre_vale_bin(sys.argv[1]))',
    ].join('\n'), 'utf8');

    const r = gardes.pythonGroupe([pontFactice, fauxHome]);
    assert.strictEqual(r.status, 0, 'le pont de résolution a échoué : ' + r.stderr);
    assert.strictEqual(r.stdout.trim(), cheminPython(fauxVale),
      'la résolution doit rendre le vale du faux ~/.local/bin, pas un repli littéral : '
      + 'stdout=' + JSON.stringify(r.stdout) + ' stderr=' + r.stderr);
  });

// Les règles lexicales de la Zeitschrift sont générées (outils-dev/lexique/generer-lexique.py) :
// régénérées dans un dossier jetable, elles retombent sur les fichiers du dépôt, et leurs
// messages sont en allemand, sans l'espace française avant « : ». Les règles écrites à la main
// de la Zeitschrift n'ont pas non plus de « : « » à la française. Sabotage : remettre le message
// français dans construire_regles_sigle, ou « : « %s » » dans WoertlichesZitatSeite.yml.
test('règles Vale de la Zeitschrift : Lexique régénéré à l’identique, messages en allemand, ponctuation allemande',
  { skip: sansPython }, () => {
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-lexique-'));
    try {
      const styles = path.join(dossier, 'styles');
      const r = gardes.pythonGroupe([path.join(RACINE, 'outils-dev', 'lexique', 'generer-lexique.py'),
        '--sortie', path.join(dossier, 'sortie'), '--styles-dir', styles],
      { env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
      assert.strictEqual(r.status, 0, r.stderr);
      const depot = path.join(RACINE, 'pipeline', 'vale', 'styles', 'SZH', 'Lexique');
      const neufs = fs.readdirSync(path.join(styles, 'SZH', 'Lexique')).sort();
      assert.deepStrictEqual(fs.readdirSync(depot).sort(), neufs);
      for (const f of neufs) {
        const attendu = fs.readFileSync(path.join(styles, 'SZH', 'Lexique', f), 'utf8');
        assert.strictEqual(fs.readFileSync(path.join(depot, f), 'utf8'), attendu, f + ' retouché à la main');
        const message = (attendu.match(/^message: "(.*)"$/m) || [])[1];
        assert.ok(message, f + ' sans message');
        assert.ok(!/à développer|forme privilégiée|lexique maison|\s:/.test(message), f + ' : ' + message);
      }
    } finally {
      fs.rmSync(dossier, { recursive: true, force: true });
    }
    const styles = path.join(RACINE, 'pipeline', 'vale', 'styles', 'SZH');
    for (const sous of ['APA', 'Epicene', 'Vokabular', 'Lexique']) {
      for (const f of fs.readdirSync(path.join(styles, sous))) {
        const message = (fs.readFileSync(path.join(styles, sous, f), 'utf8').match(/^message: "(.*)"$/m) || [])[1];
        assert.ok(message && !/ : | « | »/.test(message), sous + '/' + f + ' : ' + message);
      }
    }
    // Le texte cité commence déjà par « : pas de seconde paire de guillemets autour.
    assert.match(fs.readFileSync(path.join(styles, 'APA', 'WoertlichesZitatSeite.yml'), 'utf8'),
      /^message: "Wörtliches Zitat ohne Seitenangabe \(Zeitschrift: Wörtliche Zitate im Text\): %s\."$/m);
  });
