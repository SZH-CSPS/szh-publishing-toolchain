// test/js/manuscrit-vale.test.js : le pont Vale du nettoyeur de manuscrit (article), §7 de
// outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md. Les familles lexicales et éditoriales
// (langage épicène, vocabulaire du handicap, casse maison, liaison et/&, citation directe,
// nom des éditions) vivent en YAML dans pipeline/vale/styles/, portées par Vale — jamais
// réimplémentées ici ni dans pipeline/manuscrit_regles.py, qui ne garde que le structurel
// (voir test/js/manuscrit-regles.test.js).
//
// Ce fichier éprouve :
//   1. la configuration Vale se charge (vale ls-config), les trois styles (CSPS,
//      CSPS-Biblio, SZH) sont bien attachés à leurs quatre fichiers ;
//   2. un positif et un négatif pour chacune des quatorze règles du catalogue ;
//   3. LE PIÈGE OQLF/CSPS, nommé comme critère d'acceptation : « personne en situation de
//      handicap » ne lève jamais rien ;
//   4. LE FAIT QUI COMMANDE TOUT (l'inversion épicène) : chaque produit proscrit
//      exactement le contraire de l'autre ;
//   5. les URL et DOI ne déclenchent jamais Epicene dans le corps, alors qu'un DOI reste
//      lisible (et donc réécrit) dans la bibliographie — le masquage est CORPS SEULEMENT ;
//   6. extraire() rend une ligne par paragraphe et un index exact, et refuse un mélange
//      corps/bibliographie plutôt que de rendre un index ambigu en silence ;
//   7. analyser() rend indisponible=True proprement (jamais une exception) quand vale ne
//      peut pas tourner — configuration cassée ou règle YAML mal formée ;
//   8. _resoudre_vale_bin() retrouve un vale installé hors PATH (poste de développement sans
//      sudo, ~/.local/bin) — bug mesuré le 21.09.2026 : Vale.Indisponible sur 11 manuscrits
//      sur 11 dans un exec WSL non interactif, PATH sans ~/.local/bin.
//
//   node --test test/js/manuscrit-vale.test.js
//
// Détection de vale FAITE ICI (jamais dans test/js/gardes.js, hors périmètre de ce
// chantier) : PATH d'abord, puis wsl.exe -d SZH-Publishing en repli — même distro que
// gardes.js. Sans vale : t.skip('vale absent'), sauf SZH_VALE_OBLIGATOIRE=1 qui transforme
// le saut en échec, comme les autres gardes du dépôt. Le motif du saut cite volontairement
// « wsl.exe » ET « dans la distro », les deux fragments que test/js/verifier-tap.js admet
// déjà pour la famille `wsl` sur ubuntu ET sur windows — aucune modification de ce fichier
// n'est donc nécessaire pour que ce test saute proprement en CI tant que vale n'y est pas
// installé (le job `contrats` l'installe : voir .github/workflows/ci.yml).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const MANUSCRIT_VALE = path.join(RACINE, 'pipeline', 'manuscrit_vale.py');
const DISTRO = 'SZH-Publishing';

function python(args, entree) {
  return cp.spawnSync(PYTHON, args,
    { encoding: 'utf8', input: entree, maxBuffer: 64 * 1024 * 1024 });
}

// ---------------------------------------------------------------------------------
// Détection de vale — PATH d'abord, wsl.exe en repli. Jamais bloquante : un délai borne
// chaque tentative, comme gardes.js le fait pour python3.

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
    // bash -lc : un poste de développement sans sudo installe vale dans ~/.local/bin, qui
    // n'entre sur le PATH que via .profile (jamais sourcé par une commande `wsl -- ...` nue).
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
// Motif de la famille `vale` (test/js/motifs-saut.js), admise sur windows et poste,
// refusée sur ubuntu (le job `contrats` y installe vale et pose SZH_VALE_OBLIGATOIRE=1) —
// avant cette famille, ce motif se déguisait en `wsl` (« dans la distro », « wsl.exe »)
// pour passer la porte : un motif qu'on peut mal écrire, exactement ce que la famille
// dédiée existe pour éviter.
const sansVale = exiger('SZH_VALE_OBLIGATOIRE',
  _valeOk ? false : 'vale absent (ni sur le PATH, ni dans la distro ' + DISTRO
    + ' via wsl.exe)');

// ---------------------------------------------------------------------------------
// Appels à manuscrit_vale.py — jamais d'import direct depuis Node (même patron que
// manuscrit_regles.py) : trois modes CLI, JSON sur stdin/stdout.

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
// Contrôle n°1 — la configuration Vale se charge : les trois styles sont attachés à leurs
// quatre fichiers, sans erreur de configuration.
//
// Sabotage minimal : dans pipeline/vale/.vale.ini, retirer l'étoile en tête d'une section
// (`[*corps-fr.txt]` -> `[corps-fr.txt]`) — mesuré le 18.09.2026 (Vale 3.22.0) : un nom de
// fichier littéral, sans caractère générique, ne déclenche JAMAIS aucune règle. La
// deuxième assertion du contrôle n°2 sur CSPS.Epicene.FormesContractees rougirait alors
// (aucune alerte au lieu d'une).

test('la configuration Vale se charge : CSPS, CSPS-Biblio et SZH sont attachés',
  { skip: sansVale }, () => {
    const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
    const exe = fs.existsSync(wslExe) ? wslExe : 'wsl.exe';
    const cheminIni = path.join(RACINE, 'pipeline', 'vale', '.vale.ini');
    let r;
    if (detecterValeSurPath()) {
      r = cp.spawnSync('vale', ['--config', cheminIni, 'ls-config'], { encoding: 'utf8' });
    } else {
      // wslpath : conversion du chemin Windows, même piège que pipeline/manuscrit_vale.py
      // (wsl.exe avale les antislashs d'un argument en tableau).
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
// Contrôle n°2 — un positif et un négatif pour chacune des vingt règles du catalogue (les six
// dernières ajoutées lors de la passe du 21.09.2026 : HandicapPersonne, Forme.
// AbreviationHorsParentheses côté français ; GenerischesMaskulinum, WoertlichesZitatSeite,
// UndInKlammern, KaufmannsUndAusserhalbKlammern côté allemand). Chaque cas nomme la fonction
// d'analyse (corps/biblio) et la langue, comme le fait le contexte réel. Les sabotages
// minimaux sont documentés dans le rapport (une ligne YAML par règle), pas ici : les répéter
// vingt fois ici serait le bruit que le contrat proscrit.

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

// ---------------------------------------------------------------------------------
// Contrôle complémentaire — CSPS.Vocabulaire.Cf : « cf. » en tête de phrase devient « Voir »
// (majuscule), jamais « voir » minuscule ; un mot qui contiendrait la séquence « cf » sans
// en être l'abréviation isolée ne doit jamais être touché. Le cas positif générique (mi-
// phrase) est déjà couvert par le tableau CAS ci-dessus.
//
// Sabotage minimal : dans pipeline/vale/styles/CSPS/Vocabulaire/Cf.yml, retirer
// `nonword: true` — chaque motif finit sur un point (non-mot), le \b que Vale ajoute par
// défaut en fin de motif échoue alors systématiquement : la règle entière cesse de se
// déclencher, les deux premières assertions rougissent.

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
// Contrôle complémentaire — CSPS.Vocabulaire.HandicapPersonne : un nom propre de loi ou de
// convention n'est jamais corrigé (Revue : 3.1.3, exemples exacts du PDF). Le cas positif
// générique (hors contexte légal) est déjà couvert par le tableau CAS ci-dessus.
//
// Sabotage minimal : dans pipeline/manuscrit_vale._raffiner_handicap_personne, remplacer le
// `or` par un `and` entre les deux signaux (mot introducteur ET sigle requis simultanément
// au lieu de l'un ou l'autre) — la première assertion ci-dessous (LHand, sigle après mais
// « Loi » à plus de 90 caractères dans le vrai intitulé complet) resterait correcte par
// chance, mais le second cas (une loi nommée sans sigle qui suit d'assez près) rougirait.

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
// Contrôle complémentaire — SZH.APA.WoertlichesZitatSeite : une citation de « persönliche
// Kommunikation » (entretien, communication personnelle) ne porte jamais de numéro de page en
// APA, ce n'est donc jamais une faute. Le cas positif générique est déjà couvert par CAS.
//
// Sabotage minimal : dans pipeline/manuscrit_vale._raffiner_woertliches_zitat_seite,
// remplacer `return None` par `return {}` — l'exclusion disparaît, l'assertion rougit.

test('SZH.APA.WoertlichesZitatSeite : une communication personnelle ne demande jamais de page',
  { skip: sansVale }, () => {
    const { sortie } = analyserCorps(
      '«Das war schwierig» (Müller, persönliche Kommunikation, 12.03.2025).', 'de');
    assert.deepStrictEqual(
      sortie.alertes.filter((a) => a.rule === 'SZH.APA.WoertlichesZitatSeite'), [],
      'une communication personnelle ne doit jamais être signalée : ' + JSON.stringify(sortie.alertes));
  });

// ---------------------------------------------------------------------------------
// Contrôle complémentaire — une entrée bibliographique réelle lève BIEN les deux règles
// CSPS-Biblio à la fois (DoiForme et Esperluette) sur la MÊME ligne. Signalé par le
// superviseur : un essai manuel avait conclu que ni l'une ni l'autre ne se déclenchaient —
// en fait le mécanisme fonctionne (vérifié par `vale --output=JSON` directement sur cette
// ligne, voir le rapport), l'essai manuel avait dû passer par un fichier nommé
// `corps-fr.txt` (le seul exemple donné par LISEZMOI.md avant sa mise à jour) au lieu de
// `biblio-fr.txt`, ou par le rôle de paragraphe '' au lieu de 'bibliographie' : dans les deux
// cas, c'est le style CSPS (corps) qui s'applique, où ces deux règles n'existent pas. Ce
// test fixe noir sur blanc le cas correct, avec le rôle 'bibliographie' explicite.
//
// Sabotage minimal : dans manuscrit_vale.extraire(), changer
// `cible = lignes_biblio if role == 'bibliographie' else lignes_corps` en
// `cible = lignes_corps` (le rôle n'est plus lu) — la ligne partirait alors dans le fichier
// corps-fr.txt (style CSPS, sans APA.DoiForme ni APA.Esperluette), les deux assertions
// rougissent.

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
// Contrôle n°3 — LE PIÈGE OQLF/CSPS, nommé comme critère d'acceptation par le brief : déjà
// couvert par le cas CSPS.Vocabulaire.Handicap ci-dessus, mais répété ici EXPLICITEMENT,
// sans filtrer sur une règle précise — c'est TOUTE alerte (n'importe laquelle) que la forme
// recommandée ne doit jamais lever, pas seulement celle-ci.
//
// Sabotage minimal : dans pipeline/vale/styles/CSPS/Vocabulaire/Handicap.yml, élargir le
// motif `personnes? handicap[ée]e?s?` en `personnes?.{0,30}handicap[ée]?e?s?` — le motif
// traverserait alors « en situation de » et attraperait la forme recommandée elle-même :
// la première assertion rougit.

test('le piège OQLF/CSPS : "personne en situation de handicap" ne lève absolument rien',
  { skip: sansVale }, () => {
    const { sortie } = analyserCorps(
      'Cette personne en situation de handicap participe pleinement.', 'fr');
    assert.deepStrictEqual(sortie.alertes, [],
      'la forme recommandée par la CSPS/MDH-PPH ne doit jamais être signalée, par aucune '
      + 'règle : ' + JSON.stringify(sortie.alertes));
  });

// ---------------------------------------------------------------------------------
// Contrôle n°4 — L'INVERSION ÉPICÈNE, le fait qui commande tout : les deux revues
// prescrivent des solutions opposées. Migré depuis l'ancien test/js/manuscrit-regles.test.js
// (la règle a déménagé vers Vale, le contrôle avec elle).
//
// Sabotage minimal : dans pipeline/vale/styles/SZH/Epicene/Paarform.yml, ajouter un motif
// qui reconnaît le deux-points (`Schüler:innen`) — la forme prescrite côté allemand se
// mettrait à être signalée, la deuxième assertion rougit.

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
// Contrôle n°5 — les URL et DOI ne déclenchent jamais Epicene dans le CORPS (masquage), et
// un DOI reste lisible (et donc réécrit) dans la BIBLIOGRAPHIE (pas de masquage là).
//
// Sabotage minimal : dans manuscrit_vale._masquer_urls ou son emploi dans analyser(), ne
// plus appeler le masquage sur les lignes de corps — la première assertion (aucune alerte
// sur l'URL) rougit : mesuré le 18.09.2026, `downloads/sections` lève Epicene sans lui.

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
// Contrôle n°6 — extraire() rend une ligne par paragraphe et un index EXACT ; un mélange de
// rôles corps/bibliographie dans le même appel est refusé plutôt que de rendre un index
// ambigu en silence.
//
// Sabotage minimal : dans extraire(), remplacer `index[len(cible)] = p.get('source')` par
// `index[len(cible) - 1] = p.get('source')` (décalage d'un cran) — la deuxième assertion
// (index exact par ligne 1-based) rougit : la ligne 1 pointerait alors vers rien (index[0]
// n'est jamais lu) et la ligne 3 vers la source de la ligne 2.

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

    // Un mélange corps + bibliographie dans le MÊME appel produirait un index ambigu
    // (ligne 1 côté corps ET ligne 1 côté bibliographie partageant la même clé) : extraire()
    // le refuse plutôt que de choisir en silence.
    const melange = extraire([
      { source: 1, texte: 'Corps.', role: '' },
      { source: 2, texte: 'Référence.', role: 'bibliographie' },
    ], 'fr');
    assert.notStrictEqual(melange.code, 0,
      'un mélange de rôles doit être refusé, jamais accepté avec un index ambigu');
  });

// ---------------------------------------------------------------------------------
// Contrôle n°7 — analyser() rend indisponible=True PROPREMENT (jamais une exception, jamais
// un plantage) quand vale ne peut pas tourner. Deux causes distinctes, mesurées le
// 19.09.2026 (corrigeant une mesure du 18.09.2026, qui plaçait à tort l'erreur sur stdout) :
// une configuration introuvable (exit 0) et une règle YAML mal formée dans un style par
// ailleurs valide (exit 2). Dans les DEUX cas, le diagnostic (un objet JSON portant "Code",
// ex. "E100") atterrit sur STDERR et stdout reste VIDE — le code de sortie, lui, varie sans
// motif fiable entre les deux causes. Les deux doivent aboutir au même indisponible=True.
//
// Sabotage minimal : dans _executer(), retirer le `try/except ValueError` autour de
// `json.loads(brut)` — sur stdout vide, `json.loads('')` lève ValueError NON CAPTURÉE, qui
// remonte jusqu'au processus Python (traceback sur stderr, code de sortie non nul) au lieu
// de devenir un indisponible=True propre. Vérifié réellement le 19.09.2026 : ce sabotage
// fait rougir CE contrôle, et lui seul.

test('analyser() : indisponible=True proprement, jamais un plantage, config cassée',
  { skip: sansPython }, () => {
    const racineFactice = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-vale-factice-'));
    // Aucun pipeline/vale/.vale.ini sous cette racine : --config pointera vers un chemin
    // qui n'existe pas, exactement la panne mesurée sur une configuration cassée.
    const r = cp.spawnSync(PYTHON, [MANUSCRIT_VALE, '--analyser'], {
      encoding: 'utf8',
      input: JSON.stringify({
        paragraphes_corps: [{ source: 0, texte: 'Un texte quelconque.', role: '' }],
        paragraphes_biblio: [], langue: 'fr',
      }),
      env: Object.assign({}, process.env, { SZH_RACINE_VALE_FACTICE: racineFactice }),
    });
    // On ne peut pas passer racine_depot en argument de la CLI (elle se calcule depuis
    // __file__) : on monkey-patche donc un fichier manuscrit_vale.py TEMPORAIRE qui importe
    // le vrai module et force racine_depot vers un dossier sans pipeline/vale/.vale.ini.
    const pontFactice = path.join(racineFactice, 'pont_vale_factice.py');
    fs.writeFileSync(pontFactice, [
      'import json, sys',
      'sys.path.insert(0, ' + JSON.stringify(path.dirname(MANUSCRIT_VALE)) + ')',
      'import manuscrit_vale',
      'entree = json.loads(sys.stdin.read())',
      'alertes, indisponible = manuscrit_vale.analyser(',
      '    entree["paragraphes_corps"], entree["paragraphes_biblio"], entree["langue"],',
      '    ' + JSON.stringify(racineFactice) + ')',
      'print(json.dumps({"alertes": alertes, "indisponible": indisponible}))',
    ].join('\n'), 'utf8');

    const r2 = cp.spawnSync(PYTHON, [pontFactice], {
      encoding: 'utf8',
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
// Contrôle n°8 — _resoudre_vale_bin() retrouve un vale installé hors PATH (poste de
// développement sans sudo, ~/.local/bin), sans avoir besoin de lancer vale pour de vrai. Le
// PATH réel de la machine de test n'est PAS fiable pour ce contrôle (une CI qui installerait
// vale sur le PATH ferait trouver CE vale-là par shutil.which, avant même le repli) : un
// petit pont Python (même patron que le contrôle n°7 ci-dessus, « config cassée ») monkey-
// patche donc `manuscrit_vale.shutil.which` pour qu'il rende toujours None, et appelle
// `_resoudre_vale_bin(domicile_factice)` directement — domicile_factice est le PARAMÈTRE
// INJECTABLE (jamais HOME : os.path.expanduser('~') ignore HOME sous Windows, mesuré) qui ne
// contient QUE .local/bin/vale, jamais /usr/local/bin.
//
// ⚠ Bug mesuré le 21.09.2026 : monkey-patcher shutil.which ne suffit PAS — le premier
// candidat du repli, `/usr/local/bin/vale`, est un chemin LITTÉRAL (le contrat le veut ainsi,
// chemin épinglé de l'image de production, Containerfile), jamais un appel à shutil.which.
// Sur la CI (job `contrats`, qui installe un vrai vale justement à cet endroit) comme sur la
// WSL SZH-Publishing de ce poste (même image), ce fichier existe pour de vrai : le premier
// candidat gagne avant même d'atteindre le domicile factice, et le test rougit — vert
// seulement sous le Python DE WINDOWS de ce poste, où `/usr/local/bin/vale` n'existe pas.
// Le pont neutralise donc aussi `os.path.isfile` : False pour CE chemin précis (jamais un
// vrai binaire ne doit pouvoir gagner ici, quelle que soit la machine), l'implémentation
// réelle pour tout le reste — la seule façon d'isoler ce contrôle de ce qui est réellement
// installé sur la machine qui l'exécute.
//
// Sabotage minimal : dans manuscrit_vale._resoudre_vale_bin(), retirer le candidat
// `os.path.join(domicile, '.local', 'bin', 'vale')` de la boucle — la fonction rend alors le
// repli littéral 'vale' au lieu du chemin du faux domicile, et l'assertion rougit.

test('_resoudre_vale_bin() : un vale hors PATH, dans ~/.local/bin, est retrouvé',
  { skip: sansPython }, () => {
    const fauxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-vale-home-'));
    const dossierBin = path.join(fauxHome, '.local', 'bin');
    fs.mkdirSync(dossierBin, { recursive: true });
    // Toujours 'vale' sans extension, même sous Windows : _resoudre_vale_bin() cherche ce nom
    // littéral (le repli ~/.local/bin ne joue de toute façon que sous Linux/WSL en
    // production — voir _lancer_vale ; ce test éprouve la fonction seule, indépendamment de
    // l'OS qui exécute la suite).
    const fauxVale = path.join(dossierBin, 'vale');
    fs.writeFileSync(fauxVale, '#!/bin/sh\necho vale version 3.22.0\n');
    try { fs.chmodSync(fauxVale, 0o755); } catch (e) { /* Windows : pas de bit x, ignoré */ }

    const pontFactice = path.join(fauxHome, 'pont_resolution_factice.py');
    fs.writeFileSync(pontFactice, [
      'import sys',
      'sys.path.insert(0, ' + JSON.stringify(path.dirname(MANUSCRIT_VALE)) + ')',
      'import manuscrit_vale',
      'manuscrit_vale.shutil.which = lambda nom: None',  // jamais un vale trouvé ailleurs
      '_vrai_isfile = manuscrit_vale.os.path.isfile',
      "manuscrit_vale.os.path.isfile = lambda p: False if p == '/usr/local/bin/vale' else _vrai_isfile(p)",
      'print(manuscrit_vale._resoudre_vale_bin(sys.argv[1]))',
    ].join('\n'), 'utf8');

    const r = cp.spawnSync(PYTHON, [pontFactice, fauxHome], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, 'le pont de résolution a échoué : ' + r.stderr);
    assert.strictEqual(r.stdout.trim(), fauxVale,
      'la résolution doit rendre le vale du faux ~/.local/bin, pas un repli littéral : '
      + 'stdout=' + JSON.stringify(r.stdout) + ' stderr=' + r.stderr);
  });
