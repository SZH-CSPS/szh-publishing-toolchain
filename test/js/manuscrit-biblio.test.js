// pipeline/manuscrit_biblio.py — vérification de bibliographie APA 7 (nettoyeur de
// manuscrit, contrat §7 bis). Module PUR : pas de .docx ici, seulement du texte de paragraphe
// déjà extrait — les fonctions s'appellent depuis le Python de Windows (PYTHON de gardes.js),
// jamais la WSL, exactement comme docx-meta-titre.test.js pour docx-meta.py.
//
//   node --test test/js/manuscrit-biblio.test.js
//
// Le réseau n'est JAMAIS appelé ici : chaque contrôle Crossref remplace
// manuscrit_biblio._requete par une fonction Python injectée dans le programme -c, avant
// d'appeler resoudre_crossref()/retrouver_doi(). `reseau=False` est éprouvé séparément :
// aucune tentative, et crossref.indisponible vaut True.
//
// La fixture FR vient du corpus réel (tmp/corpus-relecture/lot-A, voir son LISEZMOI) —
// 12 références passées une à une dans la WSL avant d'être recopiées ici. La fixture DE n'a
// PAS de corpus réel équivalent (§12 du contrat : « L'allemand n'est calibré par rien ») :
// ses 6 références sont les exemples travaillés du guide Redaktionsrichtlinien Zeitschrift
// (Muster, Meier, Bonaparte...), seule source allemande faisant autorité dans ce dépôt.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const PIPELINE = path.join(RACINE, 'pipeline');

function python(programme, args) {
  return cp.spawnSync(PYTHON, ['-c', programme].concat(args || []), {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }),
    maxBuffer: 1024 * 1024 * 16,
  });
}

const PREAMBULE = [
  'import sys, os, json',
  'sys.path.insert(0, ' + JSON.stringify(PIPELINE) + ')',
  'import manuscrit_biblio as mb',
].join('\n');

function executer(corps) {
  const r = python(PREAMBULE + '\n' + corps, []);
  assert.strictEqual(r.status, 0, 'le script Python a échoué : ' + r.stderr);
  return JSON.parse(r.stdout);
}

// ---------------------------------------------------------------------------------
// 1. La fixture — 12 fr (corpus réel) + 6 de (guide Zeitschrift) — vérité champ par champ.

const FIXTURE_FR = [
  {
    texte: "Bacquelé, V. (2024). L’insertion des aides numériques dans des démarches "
      + "d’aménagements pédagogiques. Revue suisse de pédagogie spécialisée, 14(03), "
      + "26-31. https://doi.org/10.57161/r2024-03-04",
    attendu: {
      nb_auteurs: 1, auteurs: [{ nom: 'Bacquelé', initiales: 'V.' }], annee: 2024,
      suffixe: '', titre: "L’insertion des aides numériques dans des démarches "
        + "d’aménagements pédagogiques",
      conteneur: 'Revue suisse de pédagogie spécialisée', volume: '14', numero: '03',
      pages: '26-31', editeur: '', doi: 'https://doi.org/10.57161/r2024-03-04', url: '',
      type: 'article', confiance: 'haute',
    },
  },
  {
    texte: "Booms, A., Brau-Antony, S., & Emprin, F. (2023). Bifurcations didactiques lors "
      + "de l’inclusion d’un élève équipé d’un matériel pédagogique adapté : "
      + "La nouvelle revue - Éducation et société inclusives, N° 97(1), 203-221. "
      + "https://doi.org/10.3917/nresi.097.0203",
    attendu: {
      nb_auteurs: 3,
      auteurs: [{ nom: 'Booms', initiales: 'A.' }, { nom: 'Brau-Antony', initiales: 'S.' },
        { nom: 'Emprin', initiales: 'F.' }],
      annee: 2023, suffixe: '',
      conteneur: 'La nouvelle revue - Éducation et société inclusives', volume: '97',
      numero: '1', pages: '203-221', editeur: '',
      doi: 'https://doi.org/10.3917/nresi.097.0203', url: '', type: 'article',
      confiance: 'haute',
    },
  },
  {
    texte: "Vaivre-Douret, L., Lalanne, C., Cabrol, D., Ingster-Moati, I., Falissard, B., "
      + "& Golse, B. (2011). Identification de critères diagnostiques des sous-types de "
      + "troubles de l’acquisition de la coordination (TAC) ou dyspraxie "
      + "développementale. Neuropsychiatrie de l’Enfance et de l’Adolescence, "
      + "59(8), 443-453. https://doi.org/10.1016/j.neurenf.2011.07.006",
    attendu: {
      nb_auteurs: 6, annee: 2011, conteneur: "Neuropsychiatrie de l’Enfance et de "
        + "l’Adolescence", volume: '59', numero: '8', pages: '443-453', type: 'article',
      confiance: 'haute',
      doi: 'https://doi.org/10.1016/j.neurenf.2011.07.006',
    },
  },
  {
    texte: "Toullec-Théry, M. (2020). L’AESH, aide ou écran à l’inclusion "
      + "scolaire. Ressources, 22, 64-72.",
    attendu: {
      nb_auteurs: 1, auteurs: [{ nom: 'Toullec-Théry', initiales: 'M.' }], annee: 2020,
      // Nombre NU dans l'original (« Ressources, 22, 64-72 », pas de parenthèses) : c'est un
      // volume, pas un numéro — voir _regles_article() dans le module.
      conteneur: 'Ressources', volume: '22', numero: '', pages: '64-72', doi: '',
      type: 'article', confiance: 'haute',
    },
  },
  {
    texte: "Le Prévost, M. (2010). Hétérogénéité, diversité, différences : Vers quelle "
      + "égalité des élèves ? Nouvelle revue de psychosociologie, (9), 55-66.",
    attendu: {
      nb_auteurs: 1, annee: 2010, conteneur: 'Nouvelle revue de psychosociologie',
      volume: '', numero: '9', pages: '55-66', type: 'article', confiance: 'haute',
    },
  },
  {
    texte: "Pelgrims, G. (2016). De l'intégration scolaire à l'école inclusive : accès aux "
      + "structures scolaires ou au rôle d'élève et aux savoirs ? Revue suisse de "
      + "pédagogie spécialisée, 3, 20-29.",
    attendu: {
      nb_auteurs: 1, annee: 2016, conteneur: 'Revue suisse de pédagogie spécialisée',
      // Nombre NU (pas de parenthèses dans l'original) : volume, pas numéro — même règle
      // que Toullec-Théry ci-dessus.
      volume: '3', numero: '', pages: '20-29', type: 'article', confiance: 'haute',
    },
  },
  {
    // « et » (sans esperluette) entre deux auteurs, un des tours de la Revue.
    texte: "Vial, M. et Caparros-Mencacci, N. (2007) L’accompagnement professionnel "
      + "? Méthode à l’usage des praticiens exerçant une fonction éducative. "
      + "Bruxelles, De Boeck.",
    attendu: {
      nb_auteurs: 2,
      auteurs: [{ nom: 'Vial', initiales: 'M.' }, { nom: 'Caparros-Mencacci', initiales: 'N.' }],
      annee: 2007, conteneur: '', editeur: 'Bruxelles, De Boeck', type: 'ouvrage',
      confiance: 'haute',
    },
  },
  {
    // Ponctuation absente après l'année (« (2022) Quels… », pas de point) — mesuré tel
    // quel sur le corpus, 4 auteurs séparés par virgules et un « et » final sans virgule.
    texte: "Allenbach, M, Gabola, P., Leblanc, M. et Rebetez, F. (2022) Quels soutiens au "
      + "développement de pratiques inclusives? La nouvelle revue - Education et société "
      + "inclusives, 95, 91-109. Editions Inshea",
    attendu: {
      nb_auteurs: 4,
      auteurs: [{ nom: 'Allenbach', initiales: 'M' }, { nom: 'Gabola', initiales: 'P.' },
        { nom: 'Leblanc', initiales: 'M.' }, { nom: 'Rebetez', initiales: 'F.' }],
      annee: 2022,
      // Un éditeur commercial oublié APRÈS les pages (pas de comportement prescrit par les
      // guides, mais vu tel quel sur le corpus) : la référence reste un article, pages et
      // conteneur compris, l'éditeur en trop atterrit dans 'editeur' plutôt que de faire
      // échouer tout le motif et rejeter titre/conteneur/volume/pages en bloc.
      conteneur: 'La nouvelle revue - Education et société inclusives', volume: '95',
      numero: '', pages: '91-109', editeur: 'Editions Inshea', type: 'article',
      confiance: 'haute',
    },
  },
  {
    // Le genre entre crochets porte l'institution : rien après le crochet fermant.
    texte: "Booms, A. (2022). Les pratiques enseignantes auprès d’un élève présentant "
      + "des troubles de l’acquisition des coordinations et équipé de matériel "
      + "pédagogique adapté [Thèse de doctorat, Université de Reims Champagne-Ardenne]. "
      + "https://theses.hal.science/tel-03887749/document",
    attendu: {
      nb_auteurs: 1, annee: 2022, editeur: 'Université de Reims Champagne-Ardenne',
      url: 'https://theses.hal.science/tel-03887749/document', type: 'rapport',
      confiance: 'haute',
    },
  },
  {
    // « habilitation », pas « thèse » — même famille de genre entre crochets.
    texte: "Margolinas, C. (2004). Points de vue de l’élève et du professeur. Essai "
      + "de développement de la théorie des situations didactiques [Note de synthèse pour "
      + "l’habilitation à diriger des recherches, Université de Provence - "
      + "Aix-Marseille I].",
    attendu: {
      nb_auteurs: 1, annee: 2004,
      editeur: 'Université de Provence - Aix-Marseille I', type: 'rapport',
      confiance: 'haute',
    },
  },
  {
    // Auteur institutionnel, sans initiales, avec URL — pas de DOI.
    texte: "Comité des droits des personnes handicapées. (2022). Observations finales "
      + "concernant le rapport initial de la Suisse. Nations Unies. "
      + "https://www.ebgb.admin.ch/fr/presentation-du-rapport-cdph",
    attendu: {
      nb_auteurs: 1,
      auteurs: [{ nom: 'Comité des droits des personnes handicapées', initiales: '' }],
      annee: 2022, editeur: 'Nations Unies',
      url: 'https://www.ebgb.admin.ch/fr/presentation-du-rapport-cdph', doi: '',
      type: 'web', confiance: 'haute',
    },
  },
  {
    // Construite (aucun exemple trouvé dans les 117 références réelles du corpus lot-A) :
    // particule APRÈS les initiales, convention de classement APA des noms composés
    // (« Chambrier, A.-F. de » — le nom de famille seul, « Chambrier », commande le
    // classement alphabétique ; « de » n'est qu'un complément écrit à la suite). Sans
    // _decouper_initiales_et_particule(), le sabotage minimal §... du rapport prouve que
    // ce cas retombe sur DEUX faux auteurs au lieu d'un.
    texte: 'Chambrier, A.-F. de. (2020). Un titre encore. Revue Z, 2(1), 1-9.',
    attendu: {
      nb_auteurs: 1, auteurs: [{ nom: 'de Chambrier', initiales: 'A.-F.' }], annee: 2020,
      conteneur: 'Revue Z', volume: '2', numero: '1', pages: '1-9', type: 'article',
      confiance: 'haute',
    },
  },
];

const FIXTURE_DE = [
  {
    // volume(numéro) ESPACÉ en allemand (« 27 (3) »), collé en français (« 12(3) »).
    texte: 'Muster, E. (2010). Über die Plausibilität von Schmetterlingseffekten. '
      + 'Zeitschrift für Umweltfragen, 27 (3), 56–78.',
    attendu: {
      nb_auteurs: 1, auteurs: [{ nom: 'Muster', initiales: 'E.' }], annee: 2010,
      conteneur: 'Zeitschrift für Umweltfragen', volume: '27', numero: '3',
      pages: '56-78', type: 'article', confiance: 'haute',
    },
  },
  {
    // « & » sans virgule devant (« Schneider, H. & Hugentobler, G. ») — 4 auteurs.
    texte: 'Muster, E., Meier, T., Schneider, H. & Hugentobler, G. (2009). Von '
      + 'Schmetterlingen und Wirbelstürmen. Musterverlag.',
    attendu: {
      nb_auteurs: 4,
      auteurs: [{ nom: 'Muster', initiales: 'E.' }, { nom: 'Meier', initiales: 'T.' },
        { nom: 'Schneider', initiales: 'H.' }, { nom: 'Hugentobler', initiales: 'G.' }],
      annee: 2009, editeur: 'Musterverlag', type: 'ouvrage', confiance: 'haute',
    },
  },
  {
    // « (Hrsg.) » collé, sans virgule ni point avant l'année.
    texte: 'Meier, T. (Hrsg.) (2010). Ökosysteme im Wandel. Musterverlag.',
    attendu: {
      nb_auteurs: 1, auteurs: [{ nom: 'Meier', initiales: 'T.' }], annee: 2010,
      editeur: 'Musterverlag', type: 'ouvrage', confiance: 'haute',
    },
  },
  {
    // Deux éditeurs, marqueur anglais « (Eds.) » dans une référence par ailleurs allemande.
    texte: "Bonaparte, A. & Marchand, D. (Eds.) (2012). L'effet papillon. Editions "
      + 'Papillon.',
    attendu: {
      nb_auteurs: 2,
      auteurs: [{ nom: 'Bonaparte', initiales: 'A.' }, { nom: 'Marchand', initiales: 'D.' }],
      annee: 2012, editeur: 'Editions Papillon', type: 'ouvrage', confiance: 'haute',
    },
  },
  {
    // Particule EN TÊTE, classée sous sa lettre propre au Literaturverzeichnis allemand.
    texte: 'von Arx, R. (2014). Der Schmetterlingseffekt. Musterverlag.',
    attendu: {
      nb_auteurs: 1, auteurs: [{ nom: 'von Arx', initiales: 'R.' }], annee: 2014,
      editeur: 'Musterverlag', type: 'ouvrage', confiance: 'haute',
    },
  },
  {
    // Auteur institutionnel avec sigle EN TÊTE et développement entre parenthèses (sans
    // chiffre : le repérage de l'année ne doit pas s'y arrêter).
    texte: 'GbS (Gesellschaft für bedrohte Schmetterlinge) (2015). Länderbericht über '
      + 'erneuerbare Energie durch Flügelschläge von Schmetterlingen. Musterverlag.',
    attendu: {
      nb_auteurs: 1,
      auteurs: [{ nom: 'GbS (Gesellschaft für bedrohte Schmetterlinge)', initiales: '' }],
      annee: 2015, editeur: 'Musterverlag', type: 'ouvrage', confiance: 'haute',
    },
  },
];

function verifierChamps(t, resultat, attendu, libelle) {
  for (const cle of Object.keys(attendu)) {
    assert.deepStrictEqual(resultat[cle], attendu[cle],
      libelle + ' : champ "' + cle + '" — obtenu ' + JSON.stringify(resultat[cle])
      + ', attendu ' + JSON.stringify(attendu[cle]));
  }
}

test('analyser_reference : 12 références fr du corpus réel, vérité champ par champ',
  { skip: sansPython }, (t) => {
    const programme = 'cas = json.loads(sys.argv[1])\n'
      + 'print(json.dumps([mb.analyser_reference(c) for c in cas]))';
    const r = python(PREAMBULE + '\n' + programme,
      [JSON.stringify(FIXTURE_FR.map((c) => c.texte))]);
    assert.strictEqual(r.status, 0, r.stderr);
    const resultats = JSON.parse(r.stdout);
    FIXTURE_FR.forEach((cas, i) => {
      verifierChamps(t, resultats[i], cas.attendu, 'fr #' + i);
    });
  });

test('analyser_reference : 6 références de du guide Zeitschrift (pas de corpus allemand)',
  { skip: sansPython }, (t) => {
    const programme = 'cas = json.loads(sys.argv[1])\n'
      + 'print(json.dumps([mb.analyser_reference(c) for c in cas]))';
    const r = python(PREAMBULE + '\n' + programme,
      [JSON.stringify(FIXTURE_DE.map((c) => c.texte))]);
    assert.strictEqual(r.status, 0, r.stderr);
    const resultats = JSON.parse(r.stdout);
    FIXTURE_DE.forEach((cas, i) => {
      verifierChamps(t, resultats[i], cas.attendu, 'de #' + i);
    });
  });

test('analyser_reference : au moins 80% de confiance haute sur les 18 références de la '
  + 'fixture (cible du brief)', { skip: sansPython }, () => {
  const programme = 'cas = json.loads(sys.argv[1])\n'
    + 'print(json.dumps([mb.analyser_reference(c)["confiance"] for c in cas]))';
  const tous = FIXTURE_FR.concat(FIXTURE_DE).map((c) => c.texte);
  const r = python(PREAMBULE + '\n' + programme, [JSON.stringify(tous)]);
  assert.strictEqual(r.status, 0, r.stderr);
  const confiances = JSON.parse(r.stdout);
  const haute = confiances.filter((c) => c === 'haute').length;
  assert.ok(haute / confiances.length >= 0.8,
    'taux de confiance haute trop bas : ' + haute + '/' + confiances.length);
});

// Trouvaille du superviseur (rejeu réel) : un chapitre dont les pages sont données SANS
// « (pp. x-x) » (forme non prescrite par les guides mais vue sur le corpus) faisait prendre
// le TROISIÈME NOM D'ÉDITEUR pour le titre de l'ouvrage collectif — titre ET éditeurs perdus
// d'un coup. Trois éditeurs, virgules comprises, doivent être reconnus et retirés de tête.
test('analyser_reference : un chapitre à trois éditeurs et pages SANS "(pp.)" garde son '
  + 'titre d\'ouvrage', { skip: sansPython }, () => {
  const programme = 'r = mb.analyser_reference(sys.argv[1])\nprint(json.dumps(r))';
  const texte = 'Assude, T. & Millon-Faure, K. (2021). Un chapitre. In G. Pelgrims, T. Assude, '
    + '& J.-M. Perez (Éds.), Transitions et transformations, 151-167. Berne : SZH/CSPS.';
  const r = python(PREAMBULE + '\n' + programme, [texte]);
  assert.strictEqual(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.strictEqual(d.type, 'chapitre');
  assert.strictEqual(d.conteneur, 'Transitions et transformations',
    'le titre de l\'ouvrage collectif a été perdu : ' + JSON.stringify(d));
  assert.strictEqual(d.pages, '151-167');
  assert.strictEqual(d.editeur, 'Berne : SZH/CSPS');
  assert.strictEqual(d.confiance, 'haute');
  // Les trois éditeurs de l'ouvrage collectif eux-mêmes, retirés de tête : sans
  // _consommer_editeurs_de_tete(), ce champ reste vide (rien n'est reconnu comme éditeur) et
  // mise_en_forme_apa() rend « In (Éd.), » sans les noms — un cas que le test du titre seul,
  // ci-dessus, ne suffit pas à prouver (le repli sur les pages nues isole déjà le bon titre
  // même sans cette consommation, puisqu'il ne prend que le DERNIER segment avant les pages).
  assert.strictEqual(d.editeurs_ouvrage, 'G. Pelgrims, T. Assude, & J.-M. Perez',
    'les éditeurs de l\'ouvrage collectif ont été perdus : ' + JSON.stringify(d));
});

// Trouvaille du superviseur : le genre entre crochets (« [Thèse de doctorat] ») disparaissait
// de la proposition de mise en forme — une information prescrite par les deux guides.
test('analyser_reference + mise_en_forme_apa : le genre entre crochets d\'un rapport '
  + 'survit à la mise en forme', { skip: sansPython }, () => {
  const programme = [
    'r = mb.analyser_reference(sys.argv[1])',
    "r['_langue'] = 'fr'",
    'print(json.dumps({"genre": r["genre"], "rendu": mb.mise_en_forme_apa(r)}))',
  ].join('\n');
  const texte = 'Booms, A. (2022). Un travail. [Thèse de doctorat, Université de Reims].';
  const r = python(PREAMBULE + '\n' + programme, [texte]);
  assert.strictEqual(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.strictEqual(d.genre, 'Thèse de doctorat');
  assert.match(d.rendu, /\[Thèse de doctorat\]/,
    'le genre a disparu de la mise en forme : ' + d.rendu);
});

// ---------------------------------------------------------------------------------
// 1 bis. _calculer_confiance() : plausibilité des champs (révision du 22.09.2026).
//
// Défaut réel (corpus tmp/docx-cleaner-error/1408_Alves.docx) : « United Nations, 2016.
// General Comment No. 4 (2016), Article 24… » porte une SECONDE parenthèse à 4 chiffres, celle
// du titre du texte cité. `_trouver_annee()` s'y arrête, `analyser_reference()` découpe dessus,
// et l'« éditeur » qui en ressort vaut « 1-24 » — une plage de pages, jamais un éditeur. Avant
// ce correctif, `_calculer_confiance()` accordait 'haute' sur la seule non-vacuité du champ.
const TEXTE_UNITED_NATIONS = 'United Nations, 2016. General Comment No. 4 (2016), Article 24: '
  + 'Right to Inclusive Education. UN Committee on the Rights of Persons With Disabilities '
  + '(CRPD), pp. 1-24';

test('analyser_reference : une seconde parenthèse à 4 chiffres dans le TITRE ne doit pas '
  + 'faire passer une plage de pages égarée pour un éditeur plausible', { skip: sansPython }, () => {
  const programme = 'r = mb.analyser_reference(sys.argv[1])\nprint(json.dumps(r))';
  const r = python(PREAMBULE + '\n' + programme, [TEXTE_UNITED_NATIONS]);
  assert.strictEqual(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.strictEqual(d.editeur, '1-24',
    'le déraillement de découpage doit rester identique, seule la confiance change : '
    + JSON.stringify(d));
  assert.notStrictEqual(d.confiance, 'haute',
    'un « éditeur » qui vaut une plage de pages ne doit jamais valoir la confiance haute : '
    + JSON.stringify(d));
});

test('analyser_bibliographie : l\'entrée "United Nations, 2016…" ne reçoit plus de '
  + 'réécriture fabriquée (rendu = None)', { skip: sansPython }, () => {
  const programme = [
    'corps = []',
    'biblio = [{"source": 30, "texte": ' + JSON.stringify(TEXTE_UNITED_NATIONS) + '}]',
    "alertes, stats = mb.analyser_bibliographie(corps, biblio, 'fr', reseau=False)",
    'print(json.dumps({"alertes": alertes, "stats": stats}))',
  ].join('\n');
  const r = executer(programme);
  assert.strictEqual(r.alertes.filter((a) => a.rule === 'APA.MiseEnForme').length, 0,
    'aucune révision APA.MiseEnForme ne doit être proposée pour cette entrée : '
    + JSON.stringify(r.alertes));
});

// Non-régression (à ne jamais affaiblir) : les 18 références de la fixture ci-dessus — dont 12
// viennent du corpus réel — gardent leur confiance haute, vérifiée champ par champ pour CHACUNE
// (tests ci-dessus, "12 références fr…"/"6 références de…") et par le seuil global "au moins
// 80%" (juste après). Si le contrôle de plausibilité introduit ici affaiblissait l'une de ces
// références réellement APA, ces trois tests rougiraient déjà — nul besoin de les dupliquer.

// ---------------------------------------------------------------------------------
// 2. citations_du_corps() — narrative, parenthétique, et al., plusieurs années, particule,
//    année isolée hors citation exclue.

test('citations_du_corps : les formes narrative et parenthétique, dont "et al." et les '
  + 'particules', { skip: sansPython }, () => {
  const programme = [
    "paras = [",
    "  {'source': 5, 'texte': 'Comme le montre Tremblay (2023b), la question reste ouverte.'},",
    "  {'source': 7, 'texte': 'Plusieurs travaux (Bacharach et al., 2010) le confirment.'},",
    "  {'source': 9, 'texte': 'Deux sources (Bullough et al., 2003 ; Wenzlaff, 2002) divergent.'},",
    "  {'source': 11, 'texte': 'En 2010, la situation a change, sans lien avec une citation.'},",
    "  {'source': 13, 'texte': 'Pelgrims (2001, 2006) le montre aussi.'},",
    "  {'source': 15, 'texte': 'De Chambrier (2020) confirme, tout comme (de Chambrier, 2020).'},",
    "]",
    'print(json.dumps(mb.citations_du_corps(paras)))',
  ].join('\n');
  const citations = executer(programme);
  assert.strictEqual(citations.length, 8, JSON.stringify(citations));

  const parNom = {};
  citations.forEach((c) => { (parNom[c.nom_premier_auteur] = parNom[c.nom_premier_auteur] || []).push(c); });
  assert.strictEqual(parNom.Tremblay[0].annee, 2023);
  assert.strictEqual(parNom.Tremblay[0].suffixe, 'b');
  assert.strictEqual(parNom.Bacharach[0].et_al, true);
  assert.strictEqual(parNom.Wenzlaff[0].et_al, false);
  assert.strictEqual(parNom.Pelgrims.length, 2, 'Pelgrims (2001, 2006) : deux citations');
  assert.deepStrictEqual(parNom.Pelgrims.map((c) => c.annee).sort(), [2001, 2006]);
  // Aucune citation sur « En 2010, » : une année isolée hors parenthèse de citation.
  assert.ok(!citations.some((c) => c.annee === 2010 && c.para === 11));
  // Particule : narrative « De Chambrier » (majuscule de phrase) ET parenthétique minuscule.
  assert.ok(parNom['De Chambrier'], 'particule en tête de phrase perdue');
  assert.ok(parNom['de Chambrier'], 'particule en parenthèse perdue');
});

// Audit des ancrages (demande du coordinateur, 22.09.2026) — défaut RÉEL mesuré sur le
// corpus (« Le coenseignement développemental… », citation « Akerson et Montgomery, 2017 »
// répétée deux fois dans le même paragraphe) : `span` ne visait que l'ANNÉE (4 caractères),
// jamais toute la citation portée par `texte`/`found` — `manuscrit_annoter._localizar()`
// refusait alors ce span (`texto[d:f] != found`) ET son propre repli (found ambigu, deux
// occurrences dans le paragraphe, sans span pour départager) : APA.CitationAbsente retombait
// TOUJOURS sur un commentaire du paragraphe entier dans ce cas. `span` doit désormais couvrir
// EXACTEMENT `texte`, forme narrative ET parenthétique, pour que `texto[d:f] == found` motive
// une localisation exacte même quand la citation se répète.
//
// Sabotage minimal : dans citations_du_corps(), remplacer `span_texte = [m.start(), m.end()]`
// par `span_texte = [m.start(2), m.start(2) + 4]` (repro l'ancien "année seule") — la
// vérification narrative ci-dessous rougit.

test('citations_du_corps : `span` couvre EXACTEMENT `texte`, formes narrative et '
  + 'parenthétique (jamais seulement l\'année)', { skip: sansPython }, () => {
  const programme = [
    "paras = [",
    "  {'source': 1, 'texte': 'Comme le montre Tremblay (2023b), la question reste ouverte.'},",
    "  {'source': 2, 'texte': 'On le sait (Akerson et Montgomery, 2017 ; Bashan, 2012).'},",
    "]",
    'print(json.dumps(mb.citations_du_corps(paras)))',
  ].join('\n');
  const citations = executer(programme);
  const textes = ["Comme le montre Tremblay (2023b), la question reste ouverte.",
    'On le sait (Akerson et Montgomery, 2017 ; Bashan, 2012).'];
  for (const c of citations) {
    const texteParagraphe = textes[c.para - 1];
    const [d, f] = c.span;
    assert.strictEqual(texteParagraphe.slice(d, f), c.texte,
      'span devrait couvrir exactement `texte` (' + JSON.stringify(c) + ')');
  }
});

// Cas réel qui a déclenché ce correctif : la MÊME citation répétée deux fois dans le même
// paragraphe ne peut se désambiguïser que par un span EXACT (le repli « found unique dans le
// paragraphe » échoue par construction dès qu'il y a deux occurrences).
test('citations_du_corps + croiser : une citation répétée deux fois dans le même paragraphe '
  + 'reste localisable (span exact, pas de repli sur found seul)', { skip: sansPython }, () => {
  const programme = [
    "paras = [{'source': 7, 'texte': "
      + "'Le stage (Akerson et Montgomery, 2017 ; Bashan, 2012) est riche. "
      + "Les occasions sont plus riches (Akerson et Montgomery, 2017 ; Simons, 2020).'}]",
    'citations = mb.citations_du_corps(paras)',
    'references = []',
    'alertes = mb.croiser(citations, references)',
    'print(json.dumps({"citations": citations, "alertes": alertes}))',
  ].join('\n');
  const r = executer(programme);
  const akerson = r.citations.filter((c) => c.nom_premier_auteur === 'Akerson');
  assert.strictEqual(akerson.length, 2, 'les deux occurrences doivent être vues');
  assert.notDeepStrictEqual(akerson[0].span, akerson[1].span,
    'les deux occurrences de la même citation doivent porter des span DISTINCTS : '
    + JSON.stringify(akerson));
  const texteParagraphe = r.citations[0]
    ? 'Le stage (Akerson et Montgomery, 2017 ; Bashan, 2012) est riche. '
      + 'Les occasions sont plus riches (Akerson et Montgomery, 2017 ; Simons, 2020).'
    : '';
  for (const c of akerson) {
    assert.strictEqual(texteParagraphe.slice(c.span[0], c.span[1]), c.texte);
  }
});

// ---------------------------------------------------------------------------------
// 3. croiser() — absente/non citée/suffixe/et al.

test('croiser : citation absente de la bibliographie -> error', { skip: sansPython }, () => {
  const programme = [
    "citations = [{'nom_premier_auteur': 'Fantome', 'annee': 2020, 'suffixe': '', "
      + "'para': 1, 'span': [0, 5], 'et_al': False, 'texte': 'Fantome (2020)'}]",
    'references = []',
    'print(json.dumps(mb.croiser(citations, references)))',
  ].join('\n');
  const alertes = executer(programme);
  assert.strictEqual(alertes.length, 1);
  assert.strictEqual(alertes[0].rule, 'APA.CitationAbsente');
  assert.strictEqual(alertes[0].severity, 'error');
});

// Trouvaille du superviseur sur le manuscrit « coenseignement » (27 références, 49
// citations) : « Bullough Jr, R. V., Young, J., … (2002) » en bibliographie contre
// « Bullough et al., 2002 » dans le texte — la citation ne répète jamais le suffixe
// générationnel du premier auteur, la bibliographie si. Sans le retirer de la clé
// d'appariement, ces 3 citations ressortaient comme absentes à tort.
test('croiser : un suffixe générationnel (Jr/Sr/II/III) ne casse pas l\'appariement',
  { skip: sansPython }, () => {
    const programme = [
      "citations = [",
      "  {'nom_premier_auteur': 'Bullough', 'annee': 2002, 'suffixe': '', 'para': 5, "
        + "'span': [0, 5], 'et_al': True, 'texte': 'Bullough et al., 2002'},",
      "]",
      "references = [",
      "  {'auteurs': [{'nom': 'Bullough Jr', 'initiales': 'R. V.'}, "
        + "{'nom': 'Young', 'initiales': 'J.'}, {'nom': 'Clark', 'initiales': 'D. C.'}], "
        + "'nb_auteurs': 3, 'annee': 2002, 'para': 50, "
        + "'texte': 'Bullough Jr, R. V., Young, J., Clark, D. C. (2002). Un titre.'},",
      "]",
      'print(json.dumps(mb.croiser(citations, references)))',
    ].join('\n');
    const alertes = executer(programme);
    assert.deepStrictEqual(alertes, [],
      '« Jr » aurait dû être ignoré dans la clé d\'appariement : ' + JSON.stringify(alertes));
  });

// Trouvaille du superviseur : un auteur institutionnel MULTI-MOTS cité en entier
// (« Ministère de l'Éducation nationale & DEPP, 2006, 2024 ») ne s'appariait qu'à son
// PREMIER mot (« Ministère »), jamais présent seul dans la bibliographie (qui porte le nom
// entier, sans virgule interne). Les deux années de la citation doivent apparier chacune SA
// référence.
test('croiser : un auteur institutionnel multi-mots cité en entier s\'apparie (repli sur '
  + 'nom_brut)', { skip: sansPython }, () => {
    const programme = [
      "corps = [{'source': 1, 'texte': \"Ces chiffres (Minist\\u00e8re de l'\\u00e9ducation "
        + 'nationale & DEPP, 2006, 2024) le montrent."}]',
      'citations = mb.citations_du_corps(corps)',
      "refs_texte = [",
      "  \"Minist\\u00e8re de l'\\u00e9ducation nationale & DEPP. (2006). Un rapport.\",",
      "  \"Minist\\u00e8re de l'\\u00e9ducation nationale & DEPP. (2024). Un autre rapport.\",",
      ']',
      'references = []',
      'for i, t in enumerate(refs_texte):',
      "    r = mb.analyser_reference(t)",
      "    r['para'] = 100 + i",
      "    r['texte'] = t",
      '    references.append(r)',
      'print(json.dumps({"citations": len(citations), '
        + '"alertes": mb.croiser(citations, references)}))',
    ].join('\n');
    const r = executer(programme);
    assert.strictEqual(r.citations, 2, 'deux années -> deux citations attendues');
    assert.deepStrictEqual(r.alertes, [],
      'l\'auteur institutionnel entier aurait dû apparier les deux références : '
      + JSON.stringify(r.alertes));
  });

test('croiser : référence jamais citée -> warning', { skip: sansPython }, () => {
  const programme = [
    'citations = []',
    "references = [{'auteurs': [{'nom': 'Personne', 'initiales': 'N.'}], 'annee': 2099, "
      + "'nb_auteurs': 1, 'para': 42, 'texte': 'Personne, N. (2099). Jamais cité.'}]",
    'print(json.dumps(mb.croiser(citations, references)))',
  ].join('\n');
  const alertes = executer(programme);
  assert.strictEqual(alertes.length, 1);
  assert.strictEqual(alertes[0].rule, 'APA.ReferenceNonCitee');
  assert.strictEqual(alertes[0].severity, 'warning');
  assert.strictEqual(alertes[0].para, 42);
});

test('croiser : "et al." manquant dès trois auteurs, et posé à tort pour deux',
  { skip: sansPython }, () => {
    const programme = [
      "citations = [",
      "  {'nom_premier_auteur': 'Trois', 'annee': 2020, 'suffixe': '', 'para': 1, "
        + "'span': [0, 5], 'et_al': False, 'texte': 'Trois (2020)'},",
      "  {'nom_premier_auteur': 'Deux', 'annee': 2021, 'suffixe': '', 'para': 2, "
        + "'span': [0, 5], 'et_al': True, 'texte': 'Deux et al. (2021)'},",
      "]",
      "references = [",
      "  {'auteurs': [{'nom': 'Trois', 'initiales': 'A.'}, {'nom': 'B', 'initiales': 'B.'}, "
        + "{'nom': 'C', 'initiales': 'C.'}], 'nb_auteurs': 3, 'annee': 2020, 'para': 10, "
        + "'texte': 'Trois, A., B., B., & C., C. (2020).'},",
      "  {'auteurs': [{'nom': 'Deux', 'initiales': 'A.'}, {'nom': 'Autre', 'initiales': 'B.'}], "
        + "'nb_auteurs': 2, 'annee': 2021, 'para': 11, 'texte': 'Deux, A., & Autre, B. (2021).'},",
      "]",
      'print(json.dumps(mb.croiser(citations, references)))',
    ].join('\n');
    const alertes = executer(programme);
    const etAl = alertes.filter((a) => a.rule === 'APA.EtAl');
    assert.strictEqual(etAl.length, 2);
    const manquant = etAl.find((a) => a.found === 'Trois (2020)');
    assert.ok(manquant, 'et al. manquant sur 3 auteurs non signalé');
    assert.match(manquant.suggested, /et al\./);
    const trop = etAl.find((a) => a.found === 'Deux et al. (2021)');
    assert.ok(trop, 'et al. de trop sur 2 auteurs non signalé');
    assert.match(trop.suggested, /Deux & Autre/);
  });

// ---------------------------------------------------------------------------------
// 3 bis. signaler_references_non_verifiees() — l'appel, dans le corps, d'une référence de
// confiance non haute (§7 bis, révision du 22.09.2026). `mise_en_forme_apa()` refuse déjà de
// réécrire une telle référence ; la relectrice doit néanmoins être avertie, mais SUR L'APPEL,
// jamais sur l'entrée de bibliographie.

const BIBLIO_UNESCO_NON_APA = [{ source: 20,
  texte: "UNESCO, 2017. Rapport mondial de suivi sur l'éducation. Éditions UNESCO." }];

test('analyser_bibliographie : une entrée non-APA ("UNESCO, 2017…", année sans '
  + 'parenthèses) retrouve son appel dans un corps qui la cite (repli d\'appariement)',
  { skip: sansPython }, () => {
    const programme = [
      'corps = [{"source": 1, "texte": '
        + '"Ce constat est partagé (UNESCO, 2017) par plusieurs experts."}]',
      'biblio = ' + JSON.stringify(BIBLIO_UNESCO_NON_APA),
      "alertes, stats = mb.analyser_bibliographie(corps, biblio, 'fr', reseau=False)",
      'print(json.dumps({"alertes": alertes, "stats": stats}))',
    ].join('\n');
    const r = executer(programme);
    const rnv = r.alertes.filter((a) => a.rule === 'APA.ReferenceNonVerifiee');
    assert.strictEqual(rnv.length, 1, JSON.stringify(r.alertes));
    assert.strictEqual(rnv[0].action, 'comment');
    assert.strictEqual(rnv[0].para, 1, 'ancrée sur le PARAGRAPHE DU CORPS, pas la bibliographie');
    assert.strictEqual(rnv[0].found, 'UNESCO, 2017');
    assert.match(rnv[0].message, /UNESCO/, 'la référence concernée doit être nommée dans le '
      + 'message : ' + rnv[0].message);
    assert.strictEqual(r.stats.non_verifiees, 1);
  });

test('analyser_bibliographie : une référence non-APA citée trois fois ne reçoit qu\'un '
  + 'commentaire, sur le PREMIER appel', { skip: sansPython }, () => {
  const programme = [
    'corps = [',
    '  {"source": 1, "texte": "Première mention (UNESCO, 2017) du constat."},',
    '  {"source": 2, "texte": "Deuxième mention (UNESCO, 2017) du même constat."},',
    '  {"source": 3, "texte": "Troisième mention (UNESCO, 2017) encore."},',
    ']',
    'biblio = ' + JSON.stringify(BIBLIO_UNESCO_NON_APA),
    "alertes, stats = mb.analyser_bibliographie(corps, biblio, 'fr', reseau=False)",
    'print(json.dumps(alertes))',
  ].join('\n');
  const alertes = executer(programme);
  const rnv = alertes.filter((a) => a.rule === 'APA.ReferenceNonVerifiee');
  assert.strictEqual(rnv.length, 1,
    'une seule référence citée trois fois ne doit produire qu\'UN commentaire, pas trois : '
    + JSON.stringify(rnv));
  assert.strictEqual(rnv[0].para, 1, 'doit porter sur le PREMIER appel (paragraphe 1), pas '
    + 'un appel ultérieur : ' + JSON.stringify(rnv[0]));
});

test('analyser_bibliographie : une référence non-APA jamais citée ne reçoit aucun '
  + 'commentaire de cette règle (pas de doublon avec APA.ReferenceNonCitee)',
  { skip: sansPython }, () => {
    const programme = [
      'corps = [{"source": 1, "texte": "Ce paragraphe ne parle de rien de tel ici."}]',
      'biblio = ' + JSON.stringify(BIBLIO_UNESCO_NON_APA),
      "alertes, stats = mb.analyser_bibliographie(corps, biblio, 'fr', reseau=False)",
      'print(json.dumps({"alertes": alertes, "stats": stats}))',
    ].join('\n');
    const r = executer(programme);
    assert.strictEqual(
      r.alertes.filter((a) => a.rule === 'APA.ReferenceNonVerifiee').length, 0,
      'une référence jamais citée ne doit produire aucun commentaire de cette règle : '
      + JSON.stringify(r.alertes));
    assert.strictEqual(r.stats.non_verifiees, 0);
  });

test('analyser_bibliographie : le message de APA.ReferenceNonVerifiee est localisé (fr/de), '
  + 'même mécanisme que les autres alertes de l\'outil', { skip: sansPython }, () => {
  const programme = (langue) => [
    'corps = [{"source": 1, "texte": '
      + '"Ce constat est partagé (UNESCO, 2017) par plusieurs experts."}]',
    'biblio = ' + JSON.stringify(BIBLIO_UNESCO_NON_APA),
    "alertes, stats = mb.analyser_bibliographie(corps, biblio, '" + langue + "', reseau=False)",
    'print(json.dumps([a for a in alertes if a["rule"] == "APA.ReferenceNonVerifiee"]))',
  ].join('\n');
  const fr = executer(programme('fr'));
  const de = executer(programme('de'));
  assert.strictEqual(fr.length, 1);
  assert.strictEqual(de.length, 1);
  assert.match(fr[0].message, /référence/i);
  assert.match(fr[0].message, /UNESCO, 2017/);
  assert.match(de[0].message, /Verweis|Literaturverzeichnis/,
    'le message allemand doit être en allemand, pas une copie du français : ' + de[0].message);
  assert.notStrictEqual(fr[0].message, de[0].message);
});

// ---------------------------------------------------------------------------------
// 4. verifier_ordre() — alphabétique/chronologique, suffixes a/b requis.

test('verifier_ordre : ordre alphabétique rompu, et suffixes manquants sur même '
  + 'auteur/année', { skip: sansPython }, () => {
  const programme = [
    "references = [",
    "  {'auteurs': [{'nom': 'Zorro', 'initiales': 'A.'}], 'annee': 2020, 'suffixe': '', "
      + "'para': 1, 'texte': 'Zorro (2020)'},",
    "  {'auteurs': [{'nom': 'Abeille', 'initiales': 'B.'}], 'annee': 2019, 'suffixe': '', "
      + "'para': 2, 'texte': 'Abeille (2019)'},",
    "  {'auteurs': [{'nom': 'Muster', 'initiales': 'E.'}], 'annee': 2015, 'suffixe': '', "
      + "'para': 3, 'texte': 'Muster (2015) un'},",
    "  {'auteurs': [{'nom': 'Muster', 'initiales': 'E.'}], 'annee': 2015, 'suffixe': '', "
      + "'para': 4, 'texte': 'Muster (2015) deux'},",
    "]",
    'print(json.dumps(mb.verifier_ordre(references)))',
  ].join('\n');
  const alertes = executer(programme);
  assert.ok(alertes.some((a) => a.rule === 'APA.OrdreBiblio'),
    'Zorro avant Abeille non signalé');
  assert.ok(alertes.some((a) => a.rule === 'APA.Suffixe'),
    'deux Muster (2015) sans suffixe a/b non signalés');
});

// Trouvaille du superviseur (rejeu des 12 manuscrits, lot4) : une bibliographie DÉJÀ triée
// correctement (25 références réelles) voyait TOUTES ses entrées signalées « mal classées »
// dès qu'UNE SEULE d'entre elles (ici une entrée fabriquée, sans année) atterrissait au
// mauvais endroit — la comparaison position par position décalait tout ce qui suit. Seule
// l'entrée réellement fautive doit ressortir.
test('verifier_ordre : une seule entrée mal placée ne fait pas rougir tout le reste de la '
  + 'liste (pas de cascade)', { skip: sansPython }, () => {
  const noms = ['Caron', 'Claparede', 'Cnesco', 'Coen', 'Connac', 'Dottrens', 'Dupriez'];
  const programme = [
    'references = [',
    "  {'auteurs': [{'nom': 'Intrus sans annee', 'initiales': ''}], 'annee': None, "
      + "'suffixe': '', 'para': 0, 'texte': 'Intrus'},",
    ...noms.map((n, i) => `  {'auteurs': [{'nom': '${n}', 'initiales': 'X.'}], `
      + `'annee': ${2000 + i}, 'suffixe': '', 'para': ${i + 1}, 'texte': '${n}'},`),
    ']',
    'print(json.dumps(mb.verifier_ordre(references)))',
  ].join('\n');
  const alertes = executer(programme);
  assert.strictEqual(alertes.length, 1,
    'une seule entrée (l\'intrus) doit être signalée, pas ' + alertes.length + ' : '
    + JSON.stringify(alertes.map((a) => a.found)));
  assert.strictEqual(alertes[0].found, 'Intrus');
});

// Trouvaille du superviseur : « Le Prévost » (particule EN FRANÇAIS) se classe en L, jamais
// en P — les Lignes directrices Revue le disent explicitement (§3.2.1, « écrite en
// majuscule »). En allemand, à l'inverse, la particule est ignorée pour le tri (guide
// Zeitschrift, Literaturverzeichnis/Anordnung).
test('verifier_ordre : la particule compte dans le tri fr, pas en de', { skip: sansPython }, () => {
  const refs = "references = ["
    + "{'auteurs': [{'nom': 'Haramein', 'initiales': 'A.'}], 'annee': 1981, 'suffixe': '', "
    + "'para': 1, 'texte': 'Haramein'},"
    + "{'auteurs': [{'nom': 'Le Prévost', 'initiales': 'M.'}], 'annee': 2010, 'suffixe': '', "
    + "'para': 2, 'texte': 'Le Prévost'},"
    + "{'auteurs': [{'nom': 'Leroux', 'initiales': 'M.'}], 'annee': 2015, 'suffixe': '', "
    + "'para': 3, 'texte': 'Leroux'},"
    + "]";
  const programmeFr = [refs, "print(json.dumps(mb.verifier_ordre(references, 'fr')))"].join('\n');
  const fr = executer(programmeFr);
  assert.deepStrictEqual(fr, [], '« Le Prévost » entre Haramein et Leroux : ordre fr correct, '
    + 'rien à signaler : ' + JSON.stringify(fr));

  // Même liste, mais « Le Prévost » n'a plus sa place en allemand une fois la particule
  // ignorée pour le tri (elle se classerait sous P, après Leroux) : Haramein/Prévost/Leroux
  // n'est plus monotone, une des deux entrées en cause doit ressortir — laquelle des deux
  // n'est pas déterministe en cas d'égalité de longueur, seul le NOMBRE l'est ici.
  const programmeDe = [refs, "print(json.dumps(mb.verifier_ordre(references, 'de')))"].join('\n');
  const de = executer(programmeDe);
  assert.strictEqual(de.length, 1,
    'la particule aurait dû être ignorée pour le tri allemand, cassant l\'ordre : '
    + JSON.stringify(de));
  assert.ok(de[0].found === 'Le Prévost' || de[0].found === 'Leroux', JSON.stringify(de));
});

// ---------------------------------------------------------------------------------
// 5. doi_normaliser() — toutes les formes ramenées à https://doi.org/10....

test('doi_normaliser : doi:, DOI :, dx.doi.org/, http:// -> forme canonique ; déjà '
  + 'canonique -> rien', { skip: sansPython }, () => {
  const programme = [
    "cas = [",
    "  {'texte': 'Doi: 10.1234/abcd.5678', 'para': 1},",
    "  {'texte': 'DOI : 10.1234/abcd.5678', 'para': 2},",
    "  {'texte': 'dx.doi.org/10.1234/abcd.5678', 'para': 3},",
    "  {'texte': 'http://doi.org/10.1234/abcd.5678', 'para': 4},",
    "  {'texte': 'https://doi.org/10.1234/abcd.5678', 'para': 5},",
    "]",
    'print(json.dumps([mb.doi_normaliser(c) for c in cas]))',
  ].join('\n');
  const [a, b, c, d, e] = executer(programme);
  for (const alertes of [a, b, c, d]) {
    assert.strictEqual(alertes.length, 1, JSON.stringify(alertes));
    assert.strictEqual(alertes[0].rule, 'APA.DoiForme');
    assert.strictEqual(alertes[0].action, 'fix');
    assert.strictEqual(alertes[0].suggested, 'https://doi.org/10.1234/abcd.5678');
  }
  assert.strictEqual(e.length, 0, 'un DOI déjà canonique ne doit lever aucune alerte');
});

// ---------------------------------------------------------------------------------
// 6. resoudre_crossref() / retrouver_doi() — réseau TOUJOURS injecté, jamais réel.

test('resoudre_crossref : confirme quand auteur/année/titre concordent, divergent sinon',
  { skip: sansPython }, () => {
  const programme = [
    "def fausse_requete(url, delai):",
    "    return json.dumps({'message': {",
    "        'author': [{'family': 'Tremblay'}], 'title': ['Un titre'],",
    "        'issued': {'date-parts': [[2023]]},",
    "    }}).encode('utf-8')",
    'mb._requete = fausse_requete',
    "ref = {'doi': 'https://doi.org/10.1/x', 'auteurs': [{'nom': 'Tremblay', 'initiales': 'A.'}],",
    "       'annee': 2023, 'titre': 'Un titre'}",
    'confirme = mb.resoudre_crossref(ref)',
    "def fausse_requete_2(url, delai):",
    "    return json.dumps({'message': {",
    "        'author': [{'family': 'Quelqu\\'un-Autre'}], 'title': ['Titre sans rapport'],",
    "        'issued': {'date-parts': [[1990]]},",
    "    }}).encode('utf-8')",
    'mb._requete = fausse_requete_2',
    'divergent = mb.resoudre_crossref(ref)',
    'print(json.dumps({"confirme": confirme, "divergent": divergent}))',
  ].join('\n');
  const r = executer(programme);
  assert.strictEqual(r.confirme.confirme, true);
  assert.strictEqual(r.divergent.confirme, false);
});

test('resoudre_crossref : sans DOI, ne consulte jamais le réseau (rend None)',
  { skip: sansPython }, () => {
  const programme = [
    'appele = []',
    "def requete_espionne(url, delai):",
    "    appele.append(url)",
    "    raise AssertionError('ne doit jamais être appelée sans DOI')",
    'mb._requete = requete_espionne',
    "ref = {'doi': '', 'auteurs': [{'nom': 'X', 'initiales': 'A.'}], 'annee': 2020, 'titre': 'T'}",
    'resultat = mb.resoudre_crossref(ref)',
    'print(json.dumps({"resultat": resultat, "appele": appele}))',
  ].join('\n');
  const r = executer(programme);
  assert.strictEqual(r.resultat, null);
  assert.deepStrictEqual(r.appele, []);
});

test('retrouver_doi : accepte seulement une similarité de titre >= 0.9 avec auteur et '
  + 'année concordants', { skip: sansPython }, () => {
  const programme = [
    "def fausse_requete(url, delai):",
    "    return json.dumps({'message': {'items': [",
    "        {'title': ['Un titre totalement different'], 'author': [{'family': 'Tremblay'}],",
    "         'issued': {'date-parts': [[2023]]}, 'DOI': '10.1/mauvais'},",
    "        {'title': ['Un titre presque identique ici'], 'author': [{'family': 'Tremblay'}],",
    "         'issued': {'date-parts': [[2023]]}, 'DOI': '10.1/bon'},",
    "    ]}}).encode('utf-8')",
    'mb._requete = fausse_requete',
    "ref = {'doi': '', 'type': 'article', 'auteurs': [{'nom': 'Tremblay', 'initiales': 'A.'}],",
    "       'annee': 2023, 'titre': 'Un titre presque identique la'}",
    'trouve = mb.retrouver_doi(ref)',
    'print(json.dumps(trouve))',
  ].join('\n');
  const r = executer(programme);
  assert.ok(r, 'aucun DOI retrouvé alors qu\'un candidat suffisamment proche existait');
  assert.strictEqual(r[0], 'https://doi.org/10.1/bon');
});

// ---------------------------------------------------------------------------------
// 8. langue_ref et séparateur titre/sous-titre composé selon CETTE langue (lot du
//    21.09.2026, trouvaille du superviseur sur « Le coenseignement développemental… » :
//    l'insécable française posée à tort devant le ':' d'un titre ANGLAIS cité dans une
//    bibliographie française — « Coaching : The effects » au lieu de « Coaching: The
//    effects »).

test('analyser_reference : un titre anglais cité dans une bibliographie française garde le '
  + 'séparateur anglais (pas d\'insécable, majuscule d\'origine conservée)', { skip: sansPython }, () => {
  const programme = [
    "r = mb.analyser_reference(sys.argv[1], langue_doc='fr')",
    'print(json.dumps(r))',
  ].join('\n');
  const texte = "Ploessl, D. M., et Rock, M. L. (2014). Coaching : The effects on "
    + "co-teachers' planning and instruction. Teacher Education and Special Education, "
    + "37(3), 191-215.";
  const r = python(PREAMBULE + '\n' + programme, [texte]);
  assert.strictEqual(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.strictEqual(d.langue_ref, 'en', 'mots-outils anglais (the, effects...) non détectés');
  assert.strictEqual(d.titre, "Coaching: The effects on co-teachers' planning and instruction",
    'le séparateur devrait perdre son insécable française devant un titre anglais : '
    + JSON.stringify(d.titre));
});

test('analyser_reference : un titre français garde l\'insécable devant son séparateur',
  { skip: sansPython }, () => {
  const programme = [
    "r = mb.analyser_reference(sys.argv[1], langue_doc='fr')",
    'print(json.dumps(r))',
  ].join('\n');
  // Deux-points SANS insécable dans le texte source (manuscrit tapé au clavier) : la
  // composition doit quand même la poser, la référence étant détectée française (aucun
  // mot-outil anglais/allemand).
  const texte = 'Pelgrims, G. (2016). Une question de terrain: enjeux pour la pratique. '
    + 'Revue suisse de pédagogie spécialisée, 3, 20-29.';
  const r = python(PREAMBULE + '\n' + programme, [texte]);
  assert.strictEqual(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.strictEqual(d.langue_ref, 'fr');
  assert.strictEqual(d.titre, 'Une question de terrain : enjeux pour la pratique',
    'le séparateur français devrait porter une insécable devant : ' + JSON.stringify(d.titre));
});

test('analyser_reference : un titre allemand (mots-outils der/die/das/und/für) prend aussi '
  + 'le séparateur sans espace', { skip: sansPython }, () => {
  const programme = [
    "r = mb.analyser_reference(sys.argv[1], langue_doc='fr')",
    'print(json.dumps(r))',
  ].join('\n');
  const texte = 'Muster, E. (2010). Der Titel : Und der Untertitel. Zeitschrift für '
    + 'Umweltfragen, 27, 56-78.';
  const r = python(PREAMBULE + '\n' + programme, [texte]);
  assert.strictEqual(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.strictEqual(d.langue_ref, 'de');
  assert.strictEqual(d.titre, 'Der Titel: Und der Untertitel');
});

// ---------------------------------------------------------------------------------
// 9. mise_en_forme_apa() — italique du volume SEUL (pas le numéro entre parenthèses), et
//    suggested_texte sans astérisques sur l'alerte APA.MiseEnForme.

test('mise_en_forme_apa : seul le volume est en italique — "*37*(3)", jamais "*37(3)*"',
  { skip: sansPython }, () => {
  const programme = [
    'r = mb.analyser_reference(sys.argv[1])',
    "r['_langue'] = 'fr'",
    'print(json.dumps({"rendu": mb.mise_en_forme_apa(r)}))',
  ].join('\n');
  const texte = 'Ploessl, D. M., & Rock, M. L. (2014). Coaching: The effects on co-teachers\''
    + ' planning and instruction. Teacher Education and Special Education, 37(3), 191-215.';
  const r = python(PREAMBULE + '\n' + programme, [texte]);
  assert.strictEqual(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.match(d.rendu, /\*37\*\(3\)/, 'le volume seul doit être en italique : ' + d.rendu);
  assert.doesNotMatch(d.rendu, /\*37\(3\)\*/, 'le numéro entre parenthèses ne doit jamais '
    + 'être en italique avec le volume : ' + d.rendu);
});

test('analyser_bibliographie : APA.MiseEnForme porte suggested_texte, sans astérisques',
  { skip: sansPython }, () => {
  const programme = [
    "corps = []",
    "biblio = [{'source': 10, 'texte': "
      + "'Toullec-Th\\u00e9ry, M. (2020). Titre original mal forme. Ressources, 22, 64-72'}]",
    "alertes, stats = mb.analyser_bibliographie(corps, biblio, 'fr', reseau=False)",
    'print(json.dumps(alertes))',
  ].join('\n');
  const alertes = executer(programme);
  const mef = alertes.find((a) => a.rule === 'APA.MiseEnForme');
  assert.ok(mef, 'aucune alerte APA.MiseEnForme levée : ' + JSON.stringify(alertes));
  assert.ok(mef.suggested.includes('*'), 'suggested devrait porter le marquage italique');
  assert.ok(!mef.suggested_texte.includes('*'),
    'suggested_texte ne doit jamais porter d\'astérisque : ' + mef.suggested_texte);
  assert.strictEqual(mef.suggested_texte, mef.suggested.replace(/\*/g, ''));
});

// ---------------------------------------------------------------------------------
// 10. APA.DoiRetrouve — désormais une RÉVISION (insertion pure), plus un commentaire (lot du
//     21.09.2026, demande de Robin).

// Révision du 21.09.2026 quater (demande de Robin, mesuré sur le manuscrit réel
// « coenseignement » : 10 DOI retrouvés, seulement 2/10 en révision avant ce correctif) :
// quand une remise en forme est de toute façon proposée pour la référence, le DOI retrouvé est
// FUSIONNÉ dans `r['doi']` AVANT mise_en_forme_apa() — une seule révision par référence, jamais
// deux qui se disputent le même paragraphe (`APA.MiseEnForme`, span = toute la référence,
// gagnait systématiquement contre `APA.DoiRetrouve`, 'suggestion' — la sévérité la plus basse).
test('analyser_bibliographie : un DOI retrouvé pour une référence à reformer est fusionné '
  + 'dans APA.MiseEnForme — une seule révision, zéro APA.DoiRetrouve séparée', { skip: sansPython }, () => {
  const texteRef = "Ploessl, D. M., et Rock, M. L. (2014). Coaching: The effects on co-teachers' "
    + 'planning and instruction. Teacher Education and Special Education, 37(3), 191-215.';
  const programme = [
    "def fausse_requete(url, delai):",
    "    return json.dumps({'message': {'items': [",
    "        {\"title\": [\"Coaching: The effects on co-teachers' planning and instruction\"],",
    "         'author': [{'family': 'Ploessl'}], 'issued': {'date-parts': [[2014]]},",
    "         'DOI': '10.1177/8756870514540836'},",
    "    ]}}).encode('utf-8')",
    'mb._requete = fausse_requete',
    'corps = []',
    'biblio = [{"source": 55, "texte": ' + JSON.stringify(texteRef) + '}]',
    "alertes, stats = mb.analyser_bibliographie(corps, biblio, 'fr', reseau=True)",
    'print(json.dumps({"alertes": alertes, "stats": stats}))',
  ].join('\n');
  const r = executer(programme);
  const drs = r.alertes.filter((a) => a.rule === 'APA.DoiRetrouve');
  assert.deepStrictEqual(drs, [],
    'aucune APA.DoiRetrouve séparée ne doit apparaître quand APA.MiseEnForme porte déjà le '
    + 'DOI : ' + JSON.stringify(drs));
  const mef = r.alertes.find((a) => a.rule === 'APA.MiseEnForme');
  assert.ok(mef, 'APA.MiseEnForme absente : ' + JSON.stringify(r.alertes));
  assert.strictEqual(mef.action, 'track');
  assert.match(mef.suggested, /https:\/\/doi\.org\/10\.1177\/8756870514540836$/,
    'le DOI retrouvé doit terminer la révision unique : ' + mef.suggested);
  assert.match(mef.message, /DOI ajouté/);
  assert.strictEqual(r.stats.doi_retrouves, 1);
});

// Le repli en insertion `track` AUTONOME (aucune remise en forme possible pour cette
// référence) reste éprouvé, isolé de la question de confiance par injection de dépendance
// (mb.mise_en_forme_apa remplacée) — patron déjà utilisé dans ce fichier pour `_requete`.
test('analyser_bibliographie : sans remise en forme possible, le DOI retrouvé reste sa propre '
  + 'insertion track', { skip: sansPython }, () => {
  const programme = [
    "def fausse_requete(url, delai):",
    "    return json.dumps({'message': {'items': [",
    "        {'title': ['Un titre presque identique ici'], 'author': [{'family': 'Tremblay'}],",
    "         'issued': {'date-parts': [[2023]]}, 'DOI': '10.1/bon'},",
    "    ]}}).encode('utf-8')",
    'mb._requete = fausse_requete',
    'mb.mise_en_forme_apa = lambda *a, **k: None',
    "corps = []",
    "biblio = [{'source': 10, 'texte': "
      + "'Tremblay, A. (2023). Un titre presque identique la. Revue X, 1(1), 12-34.'}]",
    "alertes, stats = mb.analyser_bibliographie(corps, biblio, 'fr', reseau=True)",
    'print(json.dumps({"alertes": alertes, "stats": stats}))',
  ].join('\n');
  const r = executer(programme);
  const dr = r.alertes.find((a) => a.rule === 'APA.DoiRetrouve');
  assert.ok(dr, 'aucune alerte APA.DoiRetrouve : ' + JSON.stringify(r.alertes));
  assert.strictEqual(dr.action, 'track', 'doit être une révision, pas un commentaire');
  assert.strictEqual(dr.found, '12-34', 'l\'ancrage doit être les pages, dernier segment sûr');
  assert.strictEqual(dr.suggested, '12-34 https://doi.org/10.1/bon',
    'insertion pure du DOI après les pages, jamais une réécriture de la référence');
  assert.strictEqual(r.alertes.filter((a) => a.rule === 'APA.MiseEnForme').length, 0);
});

test('analyser_bibliographie : un DOI retrouvé sans pages localisables ni remise en forme '
  + 'retombe sur un commentaire (rien de sûr à ancrer)', { skip: sansPython }, () => {
  const programme = [
    "def fausse_requete(url, delai):",
    "    return json.dumps({'message': {'items': [",
    "        {'title': ['Un chapitre presque identique ici'], 'author': [{'family': 'Tremblay'}],",
    "         'issued': {'date-parts': [[2023]]}, 'DOI': '10.1/bon'},",
    "    ]}}).encode('utf-8')",
    'mb._requete = fausse_requete',
    'mb.mise_en_forme_apa = lambda *a, **k: None',
    "corps = []",
    // Un chapitre SANS pages ('In …' mais aucun marqueur de pages) ET SANS point final dans
    // le texte d'origine -> aucun segment de fin sûr : ni les pages (absentes), ni le point
    // final (absent). Le seul cas qui doit produire un repli commentaire.
    "biblio = [{'source': 10, 'texte': 'Tremblay, A. (2023). Un chapitre presque identique "
      + "la. In G. Pelgrims (\\u00c9d.), Un ouvrage collectif'}]",
    "alertes, stats = mb.analyser_bibliographie(corps, biblio, 'fr', reseau=True)",
    'print(json.dumps(alertes))',
  ].join('\n');
  const alertes = executer(programme);
  const dr = alertes.find((a) => a.rule === 'APA.DoiRetrouve');
  assert.ok(dr, 'aucune alerte APA.DoiRetrouve : ' + JSON.stringify(alertes));
  assert.strictEqual(dr.action, 'comment');
  assert.strictEqual(dr.found, null);
});

// ---------------------------------------------------------------------------------
// 11. Chapitre d'ouvrage collectif — révision du 21.09.2026 quinquies, référence réelle du
//     manuscrit de Robin : « … Dans E. Guyton et J. Ranier (dir.), Research on meeting
//     standards in the preparation of teachers (p. 11-24). Kendall-Hunt. » perdait ses DEUX
//     éditeurs (connecteur "et" jamais reconnu, seul "&" l'était) et proposait « In (Éd. »,
//     un marqueur hybride absent des deux guides. Vérifié dans les deux PDF
//     Redaktionsrichtlinien (§3.2.2.2 Revue, Sammelwerke/Herausgeberschaft Zeitschrift) :
//     « In » dans les deux langues, « (Ed.) »/« (Eds.) » (jamais accentué, jamais « (dir.) »)
//     pour un ouvrage cité en anglais OU en français, « (Hrsg.) » pour un ouvrage cité en
//     allemand — décidé par LA LANGUE DE L'OUVRAGE CITÉ, jamais celle du produit ; « pp. »
//     (Revue) contre « S. » (Zeitschrift, vu tel quel dans son exemple « S. 113–156 ») pour la
//     plage de pages d'un chapitre — un choix de STYLE DE CITATION, donc la langue du produit.

const TEXTE_GUYTON = 'Untel, A. (2020). Une pratique de coenseignement. Dans E. Guyton et '
  + 'J. Ranier (dir.), Research on meeting standards in the preparation of teachers '
  + '(p. 11-24). Kendall-Hunt.';

test('analyser_reference : deux éditeurs liés par "et" (pas seulement "&") sont capturés, '
  + 'jamais perdus — connecteur normalisé en "&"', { skip: sansPython }, () => {
  const programme = 'r = mb.analyser_reference(sys.argv[1])\nprint(json.dumps(r))';
  const r = python(PREAMBULE + '\n' + programme, [TEXTE_GUYTON]);
  assert.strictEqual(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.strictEqual(d.type, 'chapitre');
  assert.strictEqual(d.editeurs_ouvrage, 'E. Guyton & J. Ranier',
    'les deux éditeurs doivent survivre : ' + JSON.stringify(d.editeurs_ouvrage));
  assert.strictEqual(d.nb_editeurs_ouvrage, 2);
  assert.strictEqual(d.conteneur, 'Research on meeting standards in the preparation of teachers');
  assert.strictEqual(d.pages, '11-24');
});

test('mise_en_forme_apa : "In", "(Eds.)" (jamais "(dir.)"/accentué), éditeurs conservés, '
  + '"pp." pour la Revue', { skip: sansPython }, () => {
  const programme = [
    'r = mb.analyser_reference(sys.argv[1])',
    "r['_langue'] = 'fr'",
    'print(json.dumps({"rendu": mb.mise_en_forme_apa(r)}))',
  ].join('\n');
  const r = python(PREAMBULE + '\n' + programme, [TEXTE_GUYTON]);
  assert.strictEqual(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.match(d.rendu, /In E\. Guyton & J\. Ranier \(Eds\.\),/,
    'connecteur "In", marqueur "(Eds.)" (deux éditeurs), jamais "(dir.)" : ' + d.rendu);
  assert.doesNotMatch(d.rendu, /\(dir\.\)/);
  assert.doesNotMatch(d.rendu, /\(Éd/);
  assert.match(d.rendu, /\(pp\. 11-24\)/,
    'la Revue (APA) prescrit "pp.", jamais "p." : ' + d.rendu);
});

test('mise_en_forme_apa : la Zeitschrift (langue du produit) prescrit "S.", même pour un '
  + 'chapitre cité en anglais', { skip: sansPython }, () => {
  const programme = [
    'r = mb.analyser_reference(sys.argv[1])',
    "r['_langue'] = 'de'",
    'print(json.dumps({"rendu": mb.mise_en_forme_apa(r)}))',
  ].join('\n');
  const r = python(PREAMBULE + '\n' + programme, [TEXTE_GUYTON]);
  assert.strictEqual(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.match(d.rendu, /\(S\. 11–24\)/,
    'la Zeitschrift (DGPs) prescrit "S." et le demi-cadratin, même pour un ouvrage cité en '
    + 'anglais : ' + d.rendu);
  // L'ouvrage cité reste anglais (langue_ref) : le marqueur d'éditeur reste "(Eds.)", jamais
  // "(Hrsg.)" — seul le PRÉFIXE de pages suit la langue du produit.
  assert.match(d.rendu, /\(Eds\.\)/);
});

test('mise_en_forme_apa : un ouvrage collectif cité en ALLEMAND prend "(Hrsg.)", quelle que '
  + 'soit la langue du produit', { skip: sansPython }, () => {
  const programme = [
    "r = mb.analyser_reference(sys.argv[1], langue_doc='fr')",
    "r['_langue'] = 'fr'",
    'print(json.dumps({"rendu": mb.mise_en_forme_apa(r), "langue_ref": r["langue_ref"]}))',
  ].join('\n');
  const texte = 'Muster, E. (2010). Über die Plausibilität von Schmetterlingseffekten. In '
    + 'T. Meier und H. Schneider (dir.), Ökosysteme im Wandel (p. 113-156). Musterverlag.';
  const r = python(PREAMBULE + '\n' + programme, [texte]);
  assert.strictEqual(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.strictEqual(d.langue_ref, 'de');
  assert.match(d.rendu, /\(Hrsg\.\)/, 'un ouvrage cité en allemand prend "(Hrsg.)" même dans '
    + 'un article français : ' + d.rendu);
  assert.match(d.rendu, /T\. Meier & H\. Schneider/, 'connecteur "und" normalisé en "&" : ' + d.rendu);
});

// Défaut réel repéré en marge (corpus tmp/docx-cleaner-error/1408_Alves.docx, entrée
// « Alves, I., & Fernandes, D. (2022)… ») : la branche `chapitre` posait « (Ed.) »/« (Eds.) »
// sans jamais vérifier que `_consommer_editeurs_de_tete()` avait effectivement isolé des noms
// d'éditeurs — une entrée par ailleurs bien formée et légitimement en confiance haute rendait
// « In (Ed.), *Conteneur*… », un marqueur d'éditeur sans nom, jamais correct dans aucun des
// deux guides.
test('mise_en_forme_apa : un chapitre sans éditeur identifié ne produit plus "In (Ed.), "',
  { skip: sansPython }, () => {
  const programme = [
    'r = mb.analyser_reference(sys.argv[1])',
    "r['_langue'] = 'fr'",
    'print(json.dumps({"rendu": mb.mise_en_forme_apa(r), '
      + '"nb_editeurs_ouvrage": r["nb_editeurs_ouvrage"], "confiance": r["confiance"]}))',
  ].join('\n');
  const texte = 'Alves, I., & Fernandes, D. (2022). Un chapitre bien formé. In Un ouvrage '
    + 'collectif (pp. 10-20). Éditeur X.';
  const r = python(PREAMBULE + '\n' + programme, [texte]);
  assert.strictEqual(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.strictEqual(d.nb_editeurs_ouvrage, 0,
    'ce cas doit être celui où AUCUN éditeur n\'a pu être isolé : ' + JSON.stringify(d));
  assert.strictEqual(d.confiance, 'haute',
    'l\'entrée reste par ailleurs bien formée, en confiance haute : ' + JSON.stringify(d));
  assert.doesNotMatch(d.rendu, /\(Eds?\.\)/,
    'un marqueur d\'éditeur sans nom ne doit plus être posé : ' + d.rendu);
  assert.match(d.rendu, /In \*Un ouvrage collectif\*/,
    'le "In" et le conteneur doivent survivre, sans marqueur creux entre eux : ' + d.rendu);
});

// Le garde-fou général (§7 bis, révision du 21.09.2026 quinquies) : reproduit le défaut réel
// EXACT (sabotage LOCAL au test, jamais le fichier de production) — sous l'ancien regex qui ne
// reconnaissait "&" et jamais "et"/"und", les deux éditeurs disparaissent de la forme
// canonique. Le garde-fou doit alors bloquer TOUTE proposition (pas seulement celle des
// éditeurs) et compter la perte dans stats.non_proposees, jamais laisser sortir une révision
// qui efface une information.
test('analyser_bibliographie : le garde-fou "aucun jeton perdu" bloque la proposition si les '
  + 'éditeurs disparaissent (rejoue le défaut réel corrigé)', { skip: sansPython }, () => {
  const programme = [
    // Sabotage LOCAL au test (jamais le fichier de production) : un motif qui ne reconnaît
    // plus qu'UN SEUL éditeur, quel que soit le connecteur — reproduit fidèlement « le
    // connecteur d'un deuxième éditeur n'est jamais reconnu », sans reproduire l'intégralité
    // de l'ancien motif caractère pour caractère.
    "mb.RE_EDITEUR_INITIALES_NOM = __import__('re').compile(r\"^(?:[A-Z]\\.-?){1,3}\\s+[A-Z][\\w'-]*$\")",
    'corps = []',
    'biblio = [{"source": 7, "texte": ' + JSON.stringify(TEXTE_GUYTON) + '}]',
    "alertes, stats = mb.analyser_bibliographie(corps, biblio, 'fr', reseau=False)",
    'print(json.dumps({"alertes": alertes, "stats": stats}))',
  ].join('\n');
  const r = executer(programme);
  assert.strictEqual(r.alertes.filter((a) => a.rule === 'APA.MiseEnForme').length, 0,
    'sous l\'ancien regex, les éditeurs disparaissent : aucune révision ne doit être proposée : '
    + JSON.stringify(r.alertes));
  assert.strictEqual(r.stats.non_proposees.length, 1,
    'la perte doit être comptée dans non_proposees : ' + JSON.stringify(r.stats.non_proposees));
});

// ---------------------------------------------------------------------------------
// 7. analyser_bibliographie() — reseau=False : aucune tentative, indisponible=True.

test('analyser_bibliographie : reseau=False ne tente jamais Crossref', { skip: sansPython }, () => {
  const programme = [
    'appele = []',
    "def requete_espionne(url, delai):",
    "    appele.append(url)",
    "    return b'{}'",
    'mb._requete = requete_espionne',
    "corps = [{'source': 1, 'texte': 'Tremblay (2020) le montre.'}]",
    "biblio = [{'source': 10, 'texte': 'Tremblay, A. (2020). Un titre. Revue X, 1(1), 1-2. "
      + "https://doi.org/10.1234/abcd.5678'}]",
    "alertes, stats = mb.analyser_bibliographie(corps, biblio, 'fr', reseau=False)",
    'print(json.dumps({"stats": stats, "appele": appele}))',
  ].join('\n');
  const r = executer(programme);
  assert.strictEqual(r.stats.crossref.indisponible, true);
  assert.deepStrictEqual(r.appele, []);
});
