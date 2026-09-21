// rapport-manuscrit.twig : la page HTML du rapport du nettoyeur de manuscrit, et la vue
// (construireVueRapportManuscrit, outils/rendre-gabarit.js) qui la nourrit -- §7/§7 bis/
// §7 ter/§9/§10 de outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md. Le moteur de gabarits
// (lib/gabarits.js) n'a ni arithmétique ni indexation par crochets : plafonner une liste
// d'occurrences, grouper par famille puis par règle, juger une image (lib/qualite-image.js)
// se font donc AVANT le rendu, dans construireVueRapportManuscrit -- ce fichier éprouve
// cette fonction directement (rapide, un cas par test) ET, une fois, le vrai sous-processus
// `node outils/rendre-gabarit.js` (le câblage réel de Invoke-SzhManuscrit).
//
//   node --test test/js/manuscrit-rapport.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const CHEMIN_TWIG = path.join(COCKPIT, 'export-templates', 'rapport-manuscrit.twig');
const CHEMIN_RENDRE_GABARIT = path.join(COCKPIT, 'outils', 'rendre-gabarit.js');

const { compiler } = require(path.join(COCKPIT, 'lib', 'gabarits.js'));
const { construireVueRapportManuscrit } = require(CHEMIN_RENDRE_GABARIT);

const SOURCE_TWIG = fs.readFileSync(CHEMIN_TWIG, 'utf8');

// Rend directement via lib/gabarits.js -- même fonction de vue que le vrai
// outils/rendre-gabarit.js (require()-ée depuis lui, jamais recopiée), sans repasser par un
// sous-processus à chaque cas : voir le test dédié plus bas pour le câblage réel.
function rendre(rapport, produit) {
  const vue = construireVueRapportManuscrit(rapport);
  const blocs = compiler(SOURCE_TWIG, 'rapport-manuscrit.twig')
    .rendre({ produit: produit || rapport.produit || 'revue', vue });
  return blocs.contenu || '';
}

// ---- Un parseur minimal : balises appariées, sur les conteneurs structurants de la page --
function compterBalise(html, nom) {
  const ouvre = (html.match(new RegExp('<' + nom + '(?:\\s[^>]*)?>', 'g')) || []).length;
  const ferme = (html.match(new RegExp('</' + nom + '>', 'g')) || []).length;
  return { ouvre, ferme };
}
function assertBienForme(html, etiquette) {
  assert.match(html, /^<!DOCTYPE html>/, etiquette + ' : pas de DOCTYPE en tête');
  for (const balise of ['html', 'head', 'body', 'table', 'tr', 'div', 'p', 'span']) {
    const { ouvre, ferme } = compterBalise(html, balise);
    assert.equal(ouvre, ferme,
      etiquette + ' : <' + balise + '> déséquilibrée (' + ouvre + ' ouvertes, ' + ferme + ' fermées)');
  }
  assert.match(html, /<\/html>\s*$/, etiquette + ' : ne se termine pas par </html>');
}

// Aucune URL externe, hors https://doi.org (la seule autorisée par le contrat de ce test) --
// une page qui en chargerait une romprait le contrat « sans réseau » du rapport.
function assertSansUrlExterne(html, etiquette) {
  const trouvees = html.match(/https?:\/\/[^\s"'<>]*/g) || [];
  for (const url of trouvees) {
    assert.ok(url.indexOf('https://doi.org') === 0,
      etiquette + ' : URL externe non autorisée : ' + url);
  }
}

// ---- (a) un JSON minimal fabriqué, une famille à deux règles, un peu de tout -------------
const RAPPORT_MINIMAL = {
  entree: '/mnt/c/Users/exemple/manuscrit-exemple.docx',
  produit: 'revue', langue: 'fr', gabarit: 'B',
  analyse_seule: false, sans_typo: false,
  sortie_docx: '/mnt/c/Users/exemple/manuscrit-exemple-nettoye.docx',
  compteurs: {
    signes_total: 12000, signes_bibliographie: 1500, nb_references: 8,
    commentaires: 2, note_commentaires: null,
    images: {
      total: 2, sans_alt: 1,
      details: [
        { nom: 'image1.jpg', source: 5, largeur_px: 500, hauteur_px: 400, alt_absent: true },
        { nom: 'image2.png', source: 9, largeur_px: 2400, hauteur_px: 1600, alt_absent: false }
      ]
    }
  },
  decisions: {
    entete: {
      donnees: {
        titre: 'Titre de l’article', sous_titre: '',
        auteurs: [{ prenom: 'Jeanne', nom: 'Exemple', fonction: 'Chargée d’enseignement',
          institution: 'HEP', email: 'jeanne@exemple.ch' }],
        resume: 'Un résumé assez long pour ne déclencher aucune alerte de longueur, écrit '
          + 'pour les besoins de ce test et rien de plus, en français courant, dans la '
          + 'fourchette attendue par le produit Revue : au moins quatre cents signes au '
          + 'total, pour être sûr de tomber dans la bonne fourchette annoncée par défaut.',
        langue_resume: 'fr', resumes_autres: {},
        mots_cles: ['mot-clé un', 'mot-clé deux'],
        doi: '10.1234/exemple', ligne_revue: 'Revue Suisse, Vol. 1'
      },
      indices_consommes: {}, trace: []
    },
    titres: {
      stats: {
        total_titres_retenus: 2, signal_nombre_inhabituel: false,
        groupes_rabattus_niveau3: 0, rejet_contrainte_niveaux: false
      },
      trace: [
        { portee: 'paragraphe', source: 3, style: 'heading 1', decision: 'promue',
          niveau_declare: 0, niveau_retenu: 1, motif: 'motif de test niveau 1' },
        { portee: 'paragraphe', source: 7, style: 'heading 2', decision: 'promue_liste',
          niveau_declare: 0, niveau_retenu: 2, motif: 'motif de test niveau 2, depuis une liste' },
        { portee: 'paragraphe', source: 11, style: 'heading 1',
          decision: 'retrogradee_signature_corps', niveau_declare: 1, niveau_retenu: 0,
          motif: 'motif de rétrogradation de test' }
      ]
    },
    formatage: {
      stats: { paragraphes_nettoyes: 10, paragraphes_inchanges: 5, paragraphes_vides_retires: 1, signalements: 1 },
      trace: [
        { portee: 'paragraphe', source: 20, decision: 'nettoye', signalements: ['gras intégral'],
          motif: 'gras intégral conservé, non retenu comme titre' }
      ]
    },
    typographie: {
      traces: [], abandons: [{ source: 4, motif: 'motif d’abandon de test' }],
      avertissements: ['[typo-avertissement] guillemets-droits | article « - » | phrase '
        + 'française de test | [de] Testsatz auf Deutsch'],
      statut: 'appliquee'
    },
    ecriture: { stats: { notes_ecrites: 3 }, trace: [] }
  },
  alertes: {
    total: 3, error: 1, warning: 1, suggestion: 1,
    liste: [
      { rule: 'Structure.NiveauxTitre', severity: 'error', action: 'report', para: 12,
        span: null, found: 'saut de niveau', suggested: null, message: 'Message de test structure.' },
      { rule: 'Structure.Bibliographie', severity: 'suggestion', action: 'report', para: 25,
        span: null, found: 'ordre alphabétique', suggested: null,
        message: 'Deuxième règle de la même famille, pour le test de groupement.' },
      { rule: 'A11y.TexteAlternatif.Revue', severity: 'warning', action: 'comment', para: 5,
        span: null, found: 'texte alternatif absent', suggested: null, message: 'Image sans texte alternatif.' }
    ],
    groupes: {}
  }
};

// ---- (b) un refus ---------------------------------------------------------------------
const RAPPORT_REFUS = {
  entree: '/mnt/c/Users/exemple/manuscrit-refuse.docx',
  refus: true, code_refus: 'suivi-modifications',
  message: 'Message de refus rédigé pour une relectrice, rien de technique dedans.',
  code_sortie: 2
};

// ---- (c) un JSON réel (lot-A, 1_Résumé-article-revue-CSPS), chemin anonymisé -----------
// Copié depuis tmp/corpus-relecture/lot-A (hors git, voir CONSIGNES du chantier) : seuls
// `entree`/`sortie_docx` ont été changés pour un chemin générique, le reste -- alertes,
// décisions, en-tête -- est EXACTEMENT ce que le nettoyeur a produit sur ce manuscrit.
const RAPPORT_REEL = JSON.parse(`{"entree":"/mnt/c/Users/exemple/manuscrit-reel.docx","produit":"revue","langue":"fr","gabarit":"B","analyse_seule":false,"sans_typo":false,"sortie_docx":"/mnt/c/Users/exemple/manuscrit-reel-nettoye.docx","compteurs":{"signes_total":4184,"signes_bibliographie":1494,"nb_references":6,"commentaires":0,"note_commentaires":null,"images":{"total":0,"sans_alt":0,"details":[]}},"decisions":{"entete":{"donnees":{"titre":"De la diversité des élèves à la diversité des professionnel-le-s","sous_titre":"Quels soutiens à l’activité enseignante ?","auteurs":[],"resume":"","langue_resume":"","resumes_autres":{},"mots_cles":[],"doi":"","ligne_revue":"","langue_produit":"fr"},"indices_consommes":{"0":"titre","1":"sous_titre","3":"auteurs","4":"auteurs","5":"auteurs","6":"auteurs"},"trace":[{"source":0,"decision":"titre","motif":"premier paragraphe non vide du document"},{"source":1,"decision":"sous_titre","motif":"même signature que le titre, deuxième ligne (finit par « : »)"},{"source":3,"decision":"auteur_info_non_attribuee","motif":"ligne de la zone auteurs, mais non attribuée : plusieurs noms déclarés ensemble juste avant, ou aucun auteur connu pour la recevoir"},{"source":4,"decision":"auteur_info_non_attribuee","motif":"ligne de la zone auteurs, mais non attribuée : plusieurs noms déclarés ensemble juste avant, ou aucun auteur connu pour la recevoir"},{"source":5,"decision":"auteur_info_non_attribuee","motif":"ligne de la zone auteurs, mais non attribuée : plusieurs noms déclarés ensemble juste avant, ou aucun auteur connu pour la recevoir"},{"source":6,"decision":"auteur_info_non_attribuee","motif":"ligne de la zone auteurs, mais non attribuée : plusieurs noms déclarés ensemble juste avant, ou aucun auteur connu pour la recevoir"}]},"titres":{"stats":{"total_paragraphes":28,"total_declares":0,"niveaux_utilises":[],"niveaux_recherches":[1,2,3],"promus":1,"adoptes":0,"retrogrades":0,"conserves_declares":0,"non_promus":4,"exclus":23,"exclus_par_categorie":{"vide":17,"bibliographie":5,"coordonnees":1},"promus_liste":0,"total_titres_retenus":1,"rejet_contrainte_niveaux":false,"groupes_rabattus_niveau3":0,"signal_nombre_inhabituel":false,"styles_exclus":[]},"trace":[{"portee":"document","source":null,"style":"","decision":"etat_declare","motif":"aucun style de titre déclaré : recherche des trois niveaux par mise en forme (passe 3)"},{"portee":"document","source":null,"style":"","decision":"groupe_promu","motif":"groupe : 12.0 pt, gras, police Times New Roman, 2 à 2 mots, 1 occurrence(s) réparties → niveau 1"},{"portee":"paragraphe","source":2,"style":"heading 2","decision":"exclu_vide","niveau_declare":2,"niveau_retenu":0,"motif":"jamais un titre par déduction : paragraphe vide"},{"portee":"paragraphe","source":17,"style":"","decision":"promue","niveau_declare":0,"niveau_retenu":1,"motif":"promu titre (niveau 1) : groupe 12.0 pt, gras, police Times New Roman, 2 mot(s)"}]},"formatage":{"stats":{"paragraphes_nettoyes":13,"paragraphes_inchanges":10,"paragraphes_vides_retires":5,"signalements":0},"trace":[{"portee":"paragraphe","source":2,"decision":"nettoye","signalements":[],"motif":"alignement/retrait manuels retirés"}]},"typographie":{"traces":["manuscrit-typo : 11 unité(s) normalisée(s) via pandoc en 397.8 ms."],"abandons":[],"avertissements":["[typo-avertissement] majuscule-accentuee | article « - » | une majuscule non accentuée subsiste dans le corps (« Etat », « Ecole ») : le Guide du typographe les accentue. Le filtre ne corrige que les titres, un mot anglais pouvant s’écrire de même — à trancher à la relecture. | [de] ein Grossbuchstabe ohne Akzent ist im Text geblieben (« Etat », « Ecole »): der Guide du typographe akzentuiert sie. Der Filter korrigiert nur die Titel, da ein englisches Wort gleich geschrieben sein kann – bei der Korrektur zu entscheiden."],"statut":"appliquee"},"ecriture":{"stats":{"paragraphes":23,"blocs_figure":0,"blocs_tableau":0,"images":0,"liens":0,"listes_non_reportees":0,"notes_ecrites":0},"trace":[]}},"alertes":{"total":1,"error":0,"warning":1,"suggestion":0,"liste":[{"rule":"Typo.majuscule-accentuee","severity":"warning","action":"report","para":null,"span":null,"found":"majuscule-accentuee","suggested":null,"message":"une majuscule non accentuée subsiste dans le corps (« Etat », « Ecole ») : le Guide du typographe les accentue. Le filtre ne corrige que les titres, un mot anglais pouvant s’écrire de même — à trancher à la relecture."}],"groupes":{"par_famille":{"Typo":1},"par_regle":{"Typo.majuscule-accentuee":{"total":1,"exemples":[]}}}}}`);

// ---- fixture dédiée au plafond : une règle à 25 occurrences ----------------------------
function fabriquerRapportPlafond(nOccurrences) {
  const liste = [];
  for (let i = 0; i < nOccurrences; i++) {
    liste.push({
      rule: 'A11y.TexteAlternatif.Revue', severity: 'warning', action: 'comment',
      para: i, span: null, found: 'texte alternatif absent', suggested: null,
      message: 'Image sans texte alternatif numéro ' + i + '.'
    });
  }
  return {
    entree: '/mnt/c/Users/exemple/manuscrit-plafond.docx',
    produit: 'revue', langue: 'fr', gabarit: 'B', analyse_seule: false, sans_typo: false,
    sortie_docx: '/mnt/c/Users/exemple/manuscrit-plafond-nettoye.docx',
    compteurs: { signes_total: 100, signes_bibliographie: 0, nb_references: 0, commentaires: 0,
      note_commentaires: null, images: { total: nOccurrences, sans_alt: nOccurrences, details: [] } },
    decisions: {
      entete: null,
      titres: { stats: { total_titres_retenus: 0, signal_nombre_inhabituel: false,
        groupes_rabattus_niveau3: 0, rejet_contrainte_niveaux: false }, trace: [] },
      formatage: { stats: { paragraphes_nettoyes: 0, paragraphes_inchanges: 0,
        paragraphes_vides_retires: 0, signalements: 0 }, trace: [] },
      typographie: { traces: [], abandons: [], avertissements: [], statut: 'appliquee' },
      ecriture: null
    },
    alertes: { total: nOccurrences, error: 0, warning: nOccurrences, suggestion: 0, liste, groupes: {} }
  };
}
const RAPPORT_PLAFOND = fabriquerRapportPlafond(25);

// =========================================================================================

test('(a) le JSON minimal rend du HTML bien formé, en français et en allemand', () => {
  for (const produit of ['revue', 'zeitschrift']) {
    const html = rendre(RAPPORT_MINIMAL, produit);
    assertBienForme(html, 'minimal/' + produit);
  }
});

test('(b) un refus rend une page COURTE, jamais la page complète', () => {
  const html = rendre(RAPPORT_REFUS, 'revue');
  assertBienForme(html, 'refus');
  assert.match(html, /class="refus-page"/, 'refus : la classe de la page courte est absente');
  assert.doesNotMatch(html, /class="bandeau"/, 'refus : le bandeau du rapport complet est apparu');
  assert.doesNotMatch(html, /class="regle /, 'refus : une règle d’alerte est apparue');
  assert.match(html, new RegExp(RAPPORT_REFUS.message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'refus : le message de refus n’apparaît pas tel quel');
});

test('(c) un rapport réel (corpus lot-A, chemin anonymisé) rend sans planter, dans les deux langues', () => {
  for (const produit of ['revue', 'zeitschrift']) {
    const html = rendre(RAPPORT_REEL, produit);
    assertBienForme(html, 'reel/' + produit);
    assertSansUrlExterne(html, 'reel/' + produit);
    // Le fichier réel n'a ni auteur ni résumé reconnus (voir la fixture) : la page doit le
    // dire, jamais rester silencieuse sur un champ manquant.
    assert.match(html, /class="absent"/, 'reel/' + produit + ' : aucun champ absent signalé');
    // Aucune trace du vrai chemin (nom d'utilisateur, dossier du corpus) : seule
    // l'anonymisation de la fixture doit apparaître.
    assert.doesNotMatch(html, /robin|corpus-relecture/i, 'reel/' + produit + ' : chemin réel non anonymisé');
  }
});

test('aucune URL externe hors https://doi.org', () => {
  const html = rendre(RAPPORT_MINIMAL, 'revue');
  assertSansUrlExterne(html, 'minimal');
  assert.match(html, /https:\/\/doi\.org\/10\.1234\/exemple/, 'le DOI de test n’est pas devenu un lien doi.org');
});

test('la sévérité de chaque alerte est rendue, dans sa langue', () => {
  const htmlFr = rendre(RAPPORT_MINIMAL, 'revue');
  assert.match(htmlFr, /puce-erreur">\s*Erreur/, 'erreur non rendue (fr)');
  assert.match(htmlFr, /puce-alerte">\s*Avertissement/, 'avertissement non rendu (fr)');
  assert.match(htmlFr, /puce-suggestion">\s*Suggestion/, 'suggestion non rendue (fr)');
  const htmlDe = rendre(RAPPORT_MINIMAL, 'zeitschrift');
  assert.match(htmlDe, /puce-erreur">\s*Fehler/, 'erreur non rendue (de)');
  assert.match(htmlDe, /puce-alerte">\s*Warnung/, 'avertissement non rendu (de)');
  assert.match(htmlDe, /puce-suggestion">\s*Vorschlag/, 'suggestion non rendue (de)');
});

test('deux règles de la même famille se groupent sous UN SEUL en-tête de famille', () => {
  const html = rendre(RAPPORT_MINIMAL, 'revue');
  // Structure.NiveauxTitre et Structure.Bibliographie, même famille « Structure » : un seul
  // <h3>Structure — …</h3>, et deux blocs <div class="regle …"> en dessous.
  const entetesFamille = (html.match(/<h3>Structure/g) || []).length;
  assert.equal(entetesFamille, 1, 'la famille Structure a plus d’un en-tête : ' + entetesFamille);
  const blocsRegle = (html.match(/class="regle regle-/g) || []).length;
  assert.equal(blocsRegle, 3, 'nombre de blocs de règle inattendu (2 Structure + 1 A11y) : ' + blocsRegle);
});

test('l’en-tête reconnue (titre, auteurs, résumé, mots-clés, DOI) est rendue', () => {
  const html = rendre(RAPPORT_MINIMAL, 'revue');
  assert.match(html, /Titre de l.article/, 'titre absent');
  assert.match(html, /Jeanne/, 'prénom d’auteur absent');
  assert.match(html, /Exemple/, 'nom d’auteur absent');
  assert.match(html, /mot-clé un, mot-clé deux/, 'mots-clés absents');
  assert.match(html, /10\.1234\/exemple/, 'DOI absent');
  assert.match(html, /signes \(fourchette du produit/, 'compte de signes du résumé absent');
});

test('cas A (entête non ré-analysée) : la section le dit, sans planter', () => {
  const rapportCasA = Object.assign({}, RAPPORT_PLAFOND, { gabarit: 'A', alertes: { total: 0, error: 0, warning: 0, suggestion: 0, liste: [], groupes: {} } });
  const html = rendre(rapportCasA, 'revue');
  assertBienForme(html, 'cas A');
  assert.match(html, /d[ée]j[àa] au gabarit|gabarit, l.en-t[êe]te/, 'cas A : le message dédié est absent');
});

test('section bibliographie : absente sans planter quand la clé manque, présente quand elle existe', () => {
  const htmlSansBiblio = rendre(RAPPORT_MINIMAL, 'revue');
  assert.doesNotMatch(htmlSansBiblio, /Bibliographie<\/h2>/, 'section bibliographie apparue alors que la clé manque');

  const rapportAvecBiblio = JSON.parse(JSON.stringify(RAPPORT_MINIMAL));
  rapportAvecBiblio.bibliographie = {
    stats: { references: 12, citations: 20, citees_absentes: 2, doi_normalises: 3, doi_retrouves: 1 }
  };
  const htmlAvecBiblio = rendre(rapportAvecBiblio, 'revue');
  assertBienForme(htmlAvecBiblio, 'avec bibliographie');
  assert.match(htmlAvecBiblio, /Bibliographie<\/h2>/, 'section bibliographie absente alors que la clé existe');
  assert.match(htmlAvecBiblio, />12</, 'nombre de références absent');
});

test('annotation absente : compteurs à 0, aucune occurrence marquée « déjà posée »', () => {
  const html = rendre(RAPPORT_MINIMAL, 'revue');
  assert.doesNotMatch(html, /déjà posée dans le document/, 'occurrence marquée posée sans annotation');
});

test('annotation présente : une occurrence renvoyée au rapport n’est PAS marquée posée, les autres le sont', () => {
  const rapportAnnote = JSON.parse(JSON.stringify(RAPPORT_MINIMAL));
  const renvoyee = rapportAnnote.alertes.liste[2]; // A11y.TexteAlternatif.Revue
  rapportAnnote.annotation = {
    revisions: 4, commentaires: 2,
    renvoyees_au_rapport: [renvoyee],
    non_ancrees: []
  };
  const html = rendre(rapportAnnote, 'revue');
  assert.match(html, /déjà posée dans le document/, 'aucune occurrence marquée posée alors que deux le sont');
  assert.match(html, /: 4 \/ 2</, 'compteur révisions/commentaires posés absent ou faux');
});

test('plafond : dix occurrences affichées au plus, et « et N autres » sur une règle à 25 alertes', () => {
  const html = rendre(RAPPORT_PLAFOND, 'revue');
  assertBienForme(html, 'plafond');
  const occurrences = (html.match(/class="occurrence"/g) || []).length;
  assert.equal(occurrences, 10, 'plus ou moins de dix occurrences affichées : ' + occurrences);
  assert.match(html, /et 15 autres/, '« et 15 autres » absent (25 - 10)');
});

test('textes fr et de : un même fait s’exprime dans la langue du produit', () => {
  const htmlFr = rendre(RAPPORT_MINIMAL, 'revue');
  const htmlDe = rendre(RAPPORT_MINIMAL, 'zeitschrift');
  assert.match(htmlFr, /Rapport de nettoyage/);
  assert.match(htmlDe, /Bereinigungsbericht/);
  assert.match(htmlFr, /Paragraphe 12/);
  assert.match(htmlDe, /Absatz 12/);
  assert.doesNotMatch(htmlFr, /Bereinigungsbericht|Absatz \d/);
  assert.doesNotMatch(htmlDe, /Rapport de nettoyage|Paragraphe \d/);
});

test('images : verdict de lib/qualite-image.js rendu, pas un jugement réinventé', () => {
  const html = rendre(RAPPORT_MINIMAL, 'revue');
  assert.match(html, /image1\.jpg[\s\S]*?puce-erreur">\s*trop petite/, 'image sous le plancher non signalée « trop petite »');
  assert.match(html, /image2\.png[\s\S]*?puce-ok">\s*bonne/, 'image au-dessus du conseillé non signalée « bonne »');
});

// ---- Le câblage réel : node outils/rendre-gabarit.js, un aller-retour JSON sur stdin -----
test('outils/rendre-gabarit.js (le vrai sous-processus) rend le même contenu que lib/gabarits.js en direct',
  () => {
    const entree = JSON.stringify({ chemin: CHEMIN_TWIG, variables: { produit: 'revue', rapport: RAPPORT_MINIMAL } });
    const resultat = spawnSync(process.execPath, [CHEMIN_RENDRE_GABARIT],
      { input: entree, encoding: 'utf8', timeout: 30000 });
    assert.equal(resultat.status, 0, 'rendre-gabarit.js a échoué : ' + resultat.stderr);
    const objet = JSON.parse(resultat.stdout.trim());
    assert.equal(objet.ok, true, 'rendre-gabarit.js : ok=false, ' + objet.erreur);
    assertBienForme(objet.blocs.contenu, 'sous-processus');
    assert.equal(objet.blocs.contenu, rendre(RAPPORT_MINIMAL, 'revue'),
      'le sous-processus et l’appel direct à lib/gabarits.js divergent');
  });

test('outils/rendre-gabarit.js : les autres appelants (sans `variables.rapport`) ne sont pas affectés', () => {
  // Un gabarit ordinaire (courriel, export) ne passe jamais `variables.rapport` : la
  // construction de vue ne doit alors jamais s’exécuter -- ce test le prouve avec un
  // gabarit jetable qui n’a rien à voir avec le rapport du nettoyeur.
  const gabaritJetable = '{% block contenu %}{{ x }}{% endblock %}';
  const cheminTemp = path.join(require('os').tmpdir(), 'szh-gabarit-jetable-' + Date.now() + '.twig');
  fs.writeFileSync(cheminTemp, gabaritJetable, 'utf8');
  try {
    const entree = JSON.stringify({ chemin: cheminTemp, variables: { x: 'ok' } });
    const resultat = spawnSync(process.execPath, [CHEMIN_RENDRE_GABARIT],
      { input: entree, encoding: 'utf8', timeout: 30000 });
    assert.equal(resultat.status, 0, resultat.stderr);
    const objet = JSON.parse(resultat.stdout.trim());
    assert.equal(objet.blocs.contenu, 'ok');
  } finally {
    fs.unlinkSync(cheminTemp);
  }
});
