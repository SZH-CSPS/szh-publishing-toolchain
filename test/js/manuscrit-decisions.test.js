// Tests des décisions du nettoyeur de manuscrit (pipeline/manuscrit_modele.py) : classement
// des titres (promotion et rétrogradation) et nettoyage de la mise en forme manuelle. Les
// tests passent par le mode --diagnostic, qui lit un Document JSON (format décrit en tête de
// manuscrit_modele.py). Voir docs/ARCHITECTURE-nettoyeur-manuscrit.md.
//
// classer_titres() procède en quatre passes : exclusions, état déclaré, regroupement par
// signature de mise en forme (un groupe, pas un paragraphe seul ; aucun score),
// rétrogradation. Une passe 3 bis adopte les paragraphes qui portent la signature des titres
// déclarés d'un niveau.
//
// Plusieurs tests indiquent un « sabotage » : la modification du module qui doit faire
// rougir le test.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { python, cheminPython, sansPython, sauter } = require('./gardes');

const fs = require('fs');
const RACINE = path.resolve(__dirname, '..', '..');
const MANUSCRIT_MODELE = path.join(RACINE, 'pipeline', 'manuscrit_modele.py');
const CORPUS_LOT_A = path.join(RACINE, 'tmp', 'corpus-relecture', 'lot-A');

// Lance manuscrit_modele.py --diagnostic sur un Document JSON et rend le résultat parsé
// (gabarit, taille_dominante, titres.{stats,trace}, formatage.{stats,trace}, `document`).
// `document` donne l'état réel après les deux passes : c'est lui qu'on lit pour vérifier ce
// qui a survécu, pas le texte d'un motif de trace.
function diagnostiquer(document) {
  const r = python( [MANUSCRIT_MODELE, '--diagnostic'], {
    input: JSON.stringify(document),
    encoding: 'utf8'
  });
  assert.strictEqual(r.status, 0, 'manuscrit_modele.py --diagnostic a échoué : ' + r.stderr);
  const lignes = r.stdout.trim().split('\n');
  return JSON.parse(lignes[lignes.length - 1]);
}

// Un paragraphe minimal : un seul fragment de texte, forme réduite aux clés fournies.
function para(source, texte, opts = {}) {
  const { style = '', niveauDeclare = 0, gras, italique, souligne, taille, police,
    alignement = '', liste = null } = opts;
  const forme = {};
  if (gras !== undefined) forme.gras = gras;
  if (italique !== undefined) forme.italique = italique;
  if (souligne !== undefined) forme.souligne = souligne;
  if (taille !== undefined) forme.taille = taille;
  if (police !== undefined) forme.police = police;
  return { source, style, niveau_declare: niveauDeclare, fragments: [{ texte, forme }],
    alignement, liste };
}

function trouver(trace, source) {
  return trace.find((l) => l.source === source);
}

function traceDocument(trace, decision) {
  return trace.filter((l) => l.portee === 'document' && l.decision === decision);
}

// ---------------------------------------------------------------------------------------
// Lit un vrai .docx (manuscrit_docx.lire()) et lui applique classer_titres(), pour le
// contrôle 13 qui s'exerce sur le corpus et non sur une fixture.
const CLASSER_SUR_FICHIER = [
  'import json, sys',
  'sys.path.insert(0, sys.argv[1])',
  'import manuscrit_docx as md',
  'import manuscrit_modele as mm',
  'document = md.lire(sys.argv[2])',
  'stats, trace = mm.classer_titres(document)',
  'n_titres = sum(1 for p in document.blocs if getattr(p, "niveau_retenu", 0) > 0)',
  'n_paras = sum(1 for p in document.blocs if hasattr(p, "niveau_retenu"))',
  'print(json.dumps({"stats": stats, "n_titres_retenus": n_titres, "n_paragraphes": n_paras}, ensure_ascii=True))'
];

function classerSurFichier(chemin) {
  const r = python( ['-c', CLASSER_SUR_FICHIER.join('\n'), path.join(RACINE, 'pipeline'), chemin],
    { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'lecture/classement du fichier réel a échoué : ' + r.stderr);
  return JSON.parse(r.stdout.trim());
}

// ---------------------------------------------------------------------------------------
// 1. Un titre court stylé, suivi de trois paragraphes longs du même style mais en petite
// taille et sans gras : un seul titre, les trois autres au corps, chacun tracé avec sa
// signature et sa longueur.

test('classer_titres : H2 posé sur trois paragraphes -> un titre, trois corps, chacun tracé', { skip: sansPython }, () => {
    const doc = {
      styles: ['heading 2'],
      blocs: [
        para(0, 'Titre court', { style: 'heading 2', niveauDeclare: 2 }),
        para(1, 'Ce paragraphe de corps contient largement plus de douze mots pour '
          + "verifier la retrogradation efficacement aujourd'hui.",
          { style: 'heading 2', niveauDeclare: 2, taille: 20 }),
        para(2, 'Un second paragraphe egalement long qui depasse nettement le seuil des '
          + 'douze mots fixe pour un titre correct.',
          { style: 'heading 2', niveauDeclare: 2, taille: 20 }),
        para(3, 'Et un troisieme paragraphe tout aussi long que les deux precedents pour '
          + 'confirmer la retrogradation systematique.',
          { style: 'heading 2', niveauDeclare: 2, taille: 20 }),
        para(4, 'Un paragraphe de corps ordinaire qui ne ressemble a aucun titre.', { taille: 20 }),
        para(5, 'Encore un paragraphe de corps ordinaire, sans aucune ambiguite ici.', { taille: 20 }),
        para(6, 'Toujours du corps de texte banal, rien de particulier a signaler.', { taille: 20 }),
        para(7, 'Un dernier paragraphe de corps pour diluer la proportion de titres.', { taille: 20 }),
        para(8, 'Et un tout dernier paragraphe de corps, bien present lui aussi.', { taille: 20 })
      ]
    };
    const { titres } = diagnostiquer(doc);

    const l0 = trouver(titres.trace, 0);
    assert.strictEqual(l0.decision, 'conserve_signature_distincte');
    assert.strictEqual(l0.niveau_retenu, 2, 'le titre court, sans taille propre, garde une '
      + 'signature distincte du corps (taille 20) : il reste titre');

    for (const source of [1, 2, 3]) {
      const ligne = trouver(titres.trace, source);
      assert.strictEqual(ligne.decision, 'retrogradee_signature_corps',
        'paragraphe ' + source + ' aurait dû être rétrogradé au corps');
      assert.strictEqual(ligne.niveau_retenu, 0);
      assert.match(ligne.motif, /signes/, 'la trace doit chiffrer la longueur');
      assert.match(ligne.motif, /identique à celle du corps/,
        'la trace doit dire que la signature ne distingue rien ici');
    }
  });

// ---------------------------------------------------------------------------------------
// 2. Un intertitre long (19 mots) à la signature des autres titres (gras, taille distincte)
// n'est pas rétrogradé à cause de son nombre de mots.

test('classer_titres : intertitre de 19 mots, à la signature des titres -> pas rétrogradé', { skip: sansPython }, () => {
    const dixNeufMots = Array.from({ length: 18 }, (_, i) => 'mot' + (i + 1)).join(' ') + ' final';
    const doc = {
      styles: ['heading 1', 'heading 2'],
      blocs: [
        para(0, 'Titre principal de niveau un', { style: 'heading 1', niveauDeclare: 1, gras: true, taille: 28 }),
        para(1, dixNeufMots, { style: 'heading 2', niveauDeclare: 2, gras: true, taille: 24 }),
        // Corps volontairement court : le titre de 19 mots est plus long que le corps et
        // échoue le critère de longueur relative (RATIO_RETROGRADATION_MIN=1). S'il survit,
        // c'est par sa signature (gras, 24), ce que ce contrôle doit prouver.
        para(2, 'Un paragraphe de corps assez bref ici.', { taille: 20 }),
        para(3, 'Encore un paragraphe de corps bref, pareil.', { taille: 20 }),
        para(4, 'Conclusion breve', { style: 'heading 2', niveauDeclare: 2, gras: true, taille: 24 }),
        para(5, 'Dernier paragraphe de corps, bref lui aussi.', { taille: 20 })
      ]
    };
    const { titres } = diagnostiquer(doc);
    const ligne = trouver(titres.trace, 1);
    assert.notStrictEqual(ligne.decision, 'retrogradee_signature_corps',
      "l'intertitre de 19 mots ne doit pas être rétrogradé");
    assert.strictEqual(ligne.niveau_retenu, 2, 'il garde son niveau déclaré');
  });

// ---------------------------------------------------------------------------------------
// 3. Un document proprement stylé (heading 1, heading 2, corps) ressort inchangé.

test('classer_titres : document déjà bien stylé -> aucun niveau_retenu ne diffère de niveau_declare', { skip: sansPython }, () => {
    const doc = {
      styles: ['heading 1', 'heading 2'],
      blocs: [
        para(0, 'Introduction', { style: 'heading 1', niveauDeclare: 1, gras: true, taille: 28 }),
        para(1, 'Contexte historique', { style: 'heading 2', niveauDeclare: 2, gras: true, taille: 24 }),
        para(2, 'Un paragraphe de corps parfaitement ordinaire qui developpe le contexte '
          + 'sur plusieurs lignes sans jamais ressembler a un titre quelconque.', { taille: 20 }),
        // Paragraphe court (5 mots) à la taille du corps : sa signature est celle du corps,
        // aucun groupe ne peut le retenir. Il rend visible un défaut qui promouvrait « tout
        // candidat court ».
        para(3, 'Un bref rappel sans titre', { taille: 20 }),
        para(4, 'Conclusion generale', { style: 'heading 1', niveauDeclare: 1, gras: true, taille: 28 }),
        para(5, 'Un dernier paragraphe de corps qui referme cet article sans ambiguite '
          + 'aucune sur sa nature de texte courant.', { taille: 20 })
      ]
    };
    const { titres } = diagnostiquer(doc);
    for (const ligne of titres.trace) {
      if (ligne.portee !== 'paragraphe') continue;
      assert.strictEqual(ligne.niveau_retenu, ligne.niveau_declare,
        'le paragraphe source=' + ligne.source + ' a changé de niveau alors que le document '
        + 'est déjà correctement stylé');
    }
    assert.strictEqual(titres.stats.promus, 0);
    assert.strictEqual(titres.stats.retrogrades, 0);
  });

// ---------------------------------------------------------------------------------------
// 3bis. Un paragraphe déclaré titre, seul de son style, à la signature du corps et trop long
// pour un titre de ce document, est rétrogradé (jugement individuel en passe 4).

test('classer_titres : paragraphe stylé isolé, signature du corps, trop long -> rétrogradé', { skip: sansPython }, () => {
    const quaranteMots = Array.from({ length: 39 }, (_, i) => 'mot' + (i + 1)).join(' ') + ' final.';
    const doc = {
      styles: ['heading 2'],
      blocs: [
        para(0, quaranteMots, { style: 'heading 2', niveauDeclare: 2, taille: 20 }),
        para(1, 'Un paragraphe de corps tout a fait ordinaire pour etablir la taille '
          + 'dominante, assez court celui-ci.', { taille: 20 })
      ]
    };
    const { titres } = diagnostiquer(doc);
    const ligne = trouver(titres.trace, 0);
    assert.strictEqual(ligne.decision, 'retrogradee_signature_corps',
      "un style isolé qui n'a ni signature distincte ni longueur de titre doit être rétrogradé");
    assert.strictEqual(ligne.niveau_retenu, 0);
  });

// ---------------------------------------------------------------------------------------
// 4. Aucun style de titre, hiérarchie en gras et en corps 14 sur corps 10 : les titres sont
// retrouvés par la seule mise en forme.

test('classer_titres : aucun style de titre -> déduction par gras et par taille (14 sur 10)', { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        // Plusieurs paragraphes de corps : avec deux seulement, les titres courts faussent la
        // médiane du corps et aucun ne ressort assez court relativement au corps.
        para(0, 'Un paragraphe de corps ordinaire qui etablit la taille dominante du '
          + 'document, assez long pour etre representatif du corps de ce texte.', { taille: 10 }),
        para(1, 'Introduction generale', { gras: true }),
        para(2, 'Grand titre de section', { taille: 14 }),
        para(3, 'Encore un paragraphe de corps banal, sans rien de particulier a signaler '
          + 'ici, mais assez long lui aussi pour representer fidelement le corps.', { taille: 10 }),
        para(4, 'Un troisieme paragraphe de corps, toujours a la taille dominante, pour '
          + 'etoffer encore un peu la masse de texte courant de ce document de test.', { taille: 10 }),
        para(5, 'Un quatrieme et dernier paragraphe de corps, lui aussi bien present et '
          + 'de longueur comparable aux precedents, pour clore ce document de test.', { taille: 10 })
      ]
    };
    const { taille_dominante: dominante, titres } = diagnostiquer(doc);
    assert.strictEqual(dominante, 10);

    const l1 = trouver(titres.trace, 1);
    assert.strictEqual(l1.decision, 'promue');
    assert.strictEqual(l1.niveau_retenu, 2, 'le titre gras seul, sans taille propre, prend le '
      + 'niveau le plus bas des deux groupes qualifiants');

    const l2 = trouver(titres.trace, 2);
    assert.strictEqual(l2.decision, 'promue');
    assert.strictEqual(l2.niveau_retenu, 1, 'le titre à la taille la plus grande devient le niveau 1');

    assert.strictEqual(titres.stats.promus, 2);
  });

// ---------------------------------------------------------------------------------------
// 5. Italique, exposant et lien traversent le nettoyage ; police, taille et couleur du même
// paragraphe disparaissent.

test('nettoyer_mise_en_forme : italique, exposant et lien survivent, police/taille/couleur partent', { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [{
        source: 0,
        style: '',
        niveau_declare: 0,
        fragments: [
          { texte: 'Un mot en italique', forme: { italique: true, police: 'Arial', taille: 22, couleur: 'FF0000' } },
          { texte: ' et un exposant', forme: { exposant: true, police: 'Arial', taille: 22 } },
          { texte: ' scientifique et un', forme: { indice: true, police: 'Arial', taille: 22 } },
          { texte: ' lien vers la source.', lien: 'https://example.org', forme: { police: 'Arial', taille: 22 } }
        ]
      }]
    };
    const { titres, formatage, document: doc2 } = diagnostiquer(doc);
    // Le paragraphe est le seul candidat du document : sa signature est celle du corps et il
    // n'est pas promu. On teste donc bien le retrait « corps ».
    assert.strictEqual(trouver(titres.trace, 0).niveau_retenu, 0);

    const ligne = trouver(formatage.trace, 0);
    assert.strictEqual(ligne.decision, 'nettoye');
    assert.match(ligne.motif, /police/);
    assert.match(ligne.motif, /taille/);
    assert.match(ligne.motif, /couleur/);

    // On relit l'état réel des fragments (`document`) : la trace seule ne prouve pas que
    // l'italique a survécu.
    const [f0, f1, f2, f3] = doc2.blocs[0].fragments;
    assert.strictEqual(f0.forme.italique, true, "l'italique doit survivre");
    assert.strictEqual(f1.forme.exposant, true, "l'exposant doit survivre");
    assert.strictEqual(f2.forme.indice, true, "l'indice doit survivre");
    assert.strictEqual(f3.lien, 'https://example.org', 'le lien doit survivre, intact');
    for (const f of [f0, f1, f2, f3]) {
      assert.strictEqual(f.forme.police, null, 'la police doit avoir disparu');
      assert.strictEqual(f.forme.taille, null, 'la taille doit avoir disparu');
    }
    assert.strictEqual(f0.forme.couleur, null, 'la couleur doit avoir disparu');
  });

// ---------------------------------------------------------------------------------------
// 5bis. nettoyer_mise_en_forme() descend dans les cellules de tableau, à toute profondeur.
//
// Sabotage : remplacer `paragraphes_a_nettoyer = list(_paragraphes_en_profondeur(document.blocs))`
// par `paragraphes_a_nettoyer = [b for b in document.blocs if isinstance(b, Paragraphe)]`.

test('nettoyer_mise_en_forme : descend dans les cellules d\'un tableau, à toute profondeur',
  { skip: sansPython }, () => {
    const cellule = (texte) => ({
      colspan: 1, rowspan: 1, entete: false,
      blocs: [{
        type: 'paragraphe', source: 0, style: '', niveau_declare: 0, alignement: '', retrait: 0,
        fragments: [{ texte, forme: { police: 'Arial', taille: 22, couleur: 'FF0000' } }]
      }]
    });
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Un paragraphe de corps assez long pour etablir la taille dominante du '
          + 'document, largement suffisant pour ce test.', { taille: 20 }),
        {
          type: 'tableau', source: 1, page: null,
          rangees: [[cellule('Contenu de cellule avec mise en forme manuelle')]]
        }
      ]
    };
    const { document: doc2 } = diagnostiquer(doc);
    const fCellule = doc2.blocs[1].rangees[0][0].blocs[0].fragments[0];
    assert.strictEqual(fCellule.forme.police, null, 'la police doit disparaître en cellule aussi');
    assert.strictEqual(fCellule.forme.taille, null, 'la taille doit disparaître en cellule aussi');
    assert.strictEqual(fCellule.forme.couleur, null, 'la couleur doit disparaître en cellule aussi');
  });

// Le `.source` d'un paragraphe de cellule est local à sa cellule (0, 1, …) : deux cellules
// donneraient chacune un « paragraphe 0 », impossible à distinguer dans le rapport. La trace
// porte donc le `.source` du tableau, avec `dans_tableau: true`.
//
// Sabotage : dans _nettoyer_paragraphe(), remplacer
// `source = source_tableau if source_tableau is not None else paragraphe.source` par
// `source = paragraphe.source`.

test('nettoyer_mise_en_forme : la trace d\'un paragraphe de cellule porte le source du TABLEAU porteur, pas sa position locale',
  { skip: sansPython }, () => {
    const celluleGrasse = (texte) => ({
      colspan: 1, rowspan: 1, entete: false,
      blocs: [{
        type: 'paragraphe', source: 0, style: '', niveau_declare: 0, alignement: '', retrait: 0,
        fragments: [{ texte, forme: { gras: true } }]
      }]
    });
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Un paragraphe de corps assez long pour etablir la taille dominante du '
          + 'document, largement suffisant pour ce test.', { taille: 20 }),
        {
          type: 'tableau', source: 1, page: null,
          rangees: [[celluleGrasse('Première cellule en gras intégral'),
                     celluleGrasse('Seconde cellule en gras intégral')]]
        }
      ]
    };
    const { formatage } = diagnostiquer(doc);
    const lignesCellule = formatage.trace.filter(
      (l) => l.portee === 'paragraphe' && Array.isArray(l.signalements) && l.signalements.length);
    assert.strictEqual(lignesCellule.length, 2, 'les deux cellules doivent signaler leur gras intégral');
    for (const ligne of lignesCellule) {
      assert.strictEqual(ligne.source, 1,
        'la trace doit porter le source du TABLEAU (1), pas la position locale (0) en cellule : '
        + JSON.stringify(ligne));
      assert.strictEqual(ligne.dans_tableau, true, 'dans_tableau doit être vrai en cellule');
    }
  });

// Même chose pour les notes (document.notes, un dict {id: [bloc, ...]}).
//
// Sabotage : dans nettoyer_mise_en_forme(), retirer la boucle
// `for blocs_note in document.notes.values(): paragraphes_a_nettoyer.extend(...)`.

test('nettoyer_mise_en_forme : descend aussi dans document.notes', { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Un paragraphe de corps assez long pour etablir la taille dominante du '
          + 'document, largement suffisant pour ce test.', { taille: 20 })
      ],
      notes: {
        '1': [{
          type: 'paragraphe', source: 0, style: '', niveau_declare: 0, alignement: '', retrait: 0,
          fragments: [{ texte: 'Contenu de note avec mise en forme manuelle',
            forme: { police: 'Arial', taille: 18, couleur: '0000FF' } }]
        }]
      }
    };
    const { document: doc2 } = diagnostiquer(doc);
    const fNote = doc2.notes['1'][0].fragments[0];
    assert.strictEqual(fNote.forme.police, null, 'la police doit disparaître dans une note aussi');
    assert.strictEqual(fNote.forme.taille, null, 'la taille doit disparaître dans une note aussi');
  });

// ---------------------------------------------------------------------------------------
// 5ter. Un paragraphe de corps entièrement gras et non retenu comme titre est signalé sans
// être touché : la relectrice doit voir le gras. Le gras partiel du corps est retiré.
//
// Sabotage : dans _nettoyer_fragments(), remplacer `champs_corps_seul = (...)` par
// `champs_corps_seul = FORME_RETIREE_CORPS_SEUL`.

test('nettoyer_mise_en_forme : le gras intégral d\'un paragraphe de corps non retenu comme titre est CONSERVÉ, signalé',
  { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Un paragraphe de corps assez long pour etablir la taille dominante du '
          + 'document, largement suffisant pour ce test ici present.', { taille: 20 }),
        // Entièrement gras, assez long, sans autre signal : pas retenu comme titre.
        para(1, 'Ce paragraphe entierement en gras ressemble a un intertitre manque mais '
          + 'reste assez long pour ne pas etre retenu comme titre par ce test.',
          { taille: 20, gras: true })
      ]
    };
    const { titres, formatage, document: doc2 } = diagnostiquer(doc);
    assert.strictEqual(trouver(titres.trace, 1).niveau_retenu, 0,
      'condition du contrôle : ce paragraphe ne doit pas être retenu comme titre');
    const ligne = trouver(formatage.trace, 1);
    assert.ok(ligne.signalements.includes('gras intégral'), 'le gras intégral doit être signalé');
    assert.match(ligne.motif, /signalé sans être touché/,
      'le motif doit dire que ce paragraphe est signalé SANS être touché');
    const fragment = doc2.blocs[1].fragments[0];
    assert.strictEqual(fragment.forme.gras, true,
      'le gras intégral doit être CONSERVÉ après nettoyage, pas retiré malgré le signalement');
  });

// Le gras partiel est retiré : l'exception ne protège pas un mot en gras dans une phrase.
//
// Sabotage : dans _nettoyer_fragments(), calculer `gras_integral` avec `any(...)` au lieu de
// `all(...)`.

test('nettoyer_mise_en_forme : le gras PARTIEL du corps est retiré normalement (l\'exception ne vaut que pour l\'intégral)',
  { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [{
        source: 0, style: '', niveau_declare: 0,
        fragments: [
          { texte: 'Un debut de phrase ordinaire, ', forme: {} },
          { texte: 'un mot en gras', forme: { gras: true } },
          { texte: ', puis la suite du paragraphe de corps qui reste assez long pour ce test.', forme: {} }
        ]
      }]
    };
    const { document: doc2 } = diagnostiquer(doc);
    const fragments = doc2.blocs[0].fragments;
    assert.strictEqual(fragments[1].forme.gras, null,
      'le gras PARTIEL (un seul fragment sur trois) doit être retiré, l\'exception ne vaut '
      + 'que pour un paragraphe ENTIÈREMENT gras');
  });

// ---------------------------------------------------------------------------------------
// 5quater. Le lecteur rend '\t' et '\n' tels quels ; _nettoyer_paragraphe() retire la
// tabulation de tête et le saut de ligne final.
//
// Sabotage : dans _nettoyer_paragraphe(), commenter les blocs
// `if dernier.texte.endswith('\n')` et `if premier.texte.startswith('\t')`.

test('nettoyer_mise_en_forme : une tabulation en tête et un saut de ligne en fin de paragraphe sont réellement retirés', { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [{
        source: 0, style: '', niveau_declare: 0,
        fragments: [
          { texte: '\tUn paragraphe de corps assez long pour etablir la taille dominante ' },
          { texte: 'du document, avec un saut de ligne manuel en fin.\n' }
        ]
      }]
    };
    const { document: doc2 } = diagnostiquer(doc);
    const [f0, f1] = doc2.blocs[0].fragments;
    assert.ok(!f0.texte.startsWith('\t'),
      'la tabulation d\'indentation en tête doit être retirée');
    assert.ok(!f1.texte.endsWith('\n'),
      'le saut de ligne manuel en fin de paragraphe doit être retiré');
  });

// ---------------------------------------------------------------------------------------
// 6. Un document d'un seul paragraphe, 11 mots, sans gras ni style : sa signature est celle
// du corps, rien n'est promu. Un faux titre est pire qu'un titre manqué.

test('classer_titres : paragraphe unique de 11 mots, sans style -> pas promu', { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Ceci est un paragraphe de test sans aucune mise en forme', { taille: 24 })
      ]
    };
    const { titres } = diagnostiquer(doc);
    const ligne = trouver(titres.trace, 0);
    assert.strictEqual(ligne.decision, 'non_promue');
    assert.strictEqual(ligne.niveau_retenu, 0);
    assert.strictEqual(titres.stats.promus, 0, 'aucune promotion : un faux titre est pire qu\'un titre manqué');
  });

// ---------------------------------------------------------------------------------------
// 7. Des titres seulement en italique (sans taille distincte ni gras) sont retrouvés.

test('classer_titres : titres en italique seul (aucune taille ni gras) -> retrouvés', { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Titre de niveau un du document', { gras: true, taille: 28 }),
        para(1, 'Un paragraphe de corps ordinaire qui developpe longuement le propos sur '
          + 'plusieurs lignes sans jamais ressembler a un titre quelconque dans ce document.',
          { taille: 22 }),
        para(2, 'Sous-titre en italique premier', { italique: true, taille: 22 }),
        para(3, 'Encore un paragraphe de corps assez long pour etablir une taille dominante '
          + 'coherente dans ce document de test relativement complet et bavard.', { taille: 22 }),
        para(4, 'Encore un paragraphe de corps assez long pour etablir une taille dominante '
          + 'coherente dans ce document de nouveau complet et bavard aussi.', { taille: 22 }),
        para(5, 'Sous-titre en italique second', { italique: true, taille: 22 }),
        para(6, 'Toujours du corps de texte ordinaire pour ce document de test, assez long '
          + 'et sans ambiguite aucune sur sa nature de texte courant banal.', { taille: 22 })
      ]
    };
    const { titres } = diagnostiquer(doc);
    const l0 = trouver(titres.trace, 0);
    const l2 = trouver(titres.trace, 2);
    const l5 = trouver(titres.trace, 5);
    assert.strictEqual(l0.decision, 'promue', 'le titre gras (niveau 1) doit aussi être promu');
    assert.strictEqual(l2.decision, 'promue', "le premier sous-titre en italique doit être promu");
    assert.strictEqual(l5.decision, 'promue', "le second sous-titre en italique doit être promu");
    assert.strictEqual(l2.niveau_retenu, l5.niveau_retenu,
      'les deux titres en italique, même signature, doivent porter le même niveau');
    assert.notStrictEqual(l2.niveau_retenu, l0.niveau_retenu,
      'le groupe italique (corps) et le groupe gras (plus grand) doivent porter des niveaux distincts');
    // Trois promotions : le titre gras (niveau 1) et les deux sous-titres en italique
    // (niveau 2). Le titre gras donne au document une hiérarchie plausible à deux niveaux
    // (bornes MIN/MAX_TITRES) ; c'est l'italique seul qui est testé (para2/para5).
    assert.strictEqual(titres.stats.promus, 3);
  });

// ---------------------------------------------------------------------------------------
// 8. Un entretien hors gabarit (questions en gras, sans style) : les questions peuvent
// devenir des H2, mais à un seul niveau, et le rapport signale leur nombre inhabituel.

test('classer_titres : entretien hors gabarit -> questions promues à UN SEUL niveau, signalé', { skip: sansPython }, () => {
    const blocs = [para(0, 'Un court paragraphe d introduction qui plante le decor de cet '
      + 'entretien mene a Zurich au printemps dernier pour la revue.', { taille: 20 })];
    let src = 1;
    for (let i = 1; i <= 25; i++) {
      blocs.push(para(src++, 'Question numero ' + i + ' en gras ici', { gras: true, taille: 20 }));
      blocs.push(para(src++, 'Premiere partie de la reponse assez longue et ordinaire qui '
        + 'developpe le propos sur plusieurs lignes sans jamais ressembler a un titre pour la '
        + 'question ' + i + ' dans ce document.', { taille: 20 }));
      blocs.push(para(src++, 'Seconde partie de la reponse qui poursuit le developpement du '
        + 'propos avec un peu plus de detail encore pour la question ' + i + ' de cet '
        + 'entretien fictif teste ici.', { taille: 20 }));
    }
    const { titres } = diagnostiquer({ styles: [], blocs });

    const niveaux = new Set();
    for (let i = 1; i <= 25; i++) {
      const source = 1 + (i - 1) * 3;
      const ligne = trouver(titres.trace, source);
      assert.strictEqual(ligne.decision, 'promue', 'la question ' + i + ' doit être promue');
      niveaux.add(ligne.niveau_retenu);
    }
    assert.strictEqual(niveaux.size, 1,
      'les 25 questions doivent toutes porter le MÊME niveau, jamais éparpillées sur 2 ou 3');
    assert.strictEqual(titres.stats.promus, 25);

    const signal = traceDocument(titres.trace, 'signal_nombre_titres_inhabituel');
    assert.strictEqual(signal.length, 1, 'le rapport doit signaler le nombre inhabituel de titres');
    assert.match(signal[0].motif, /25 titre/);
    assert.strictEqual(titres.stats.signal_nombre_inhabituel, true);
  });

// ---------------------------------------------------------------------------------------
// 9. Les entrées de bibliographie (repérées par TITRES_BIB de szh-citations.lua) ne sont
// jamais promues : courtes et homogènes, elles formeraient un groupe convaincant en passe 3.

test('classer_titres : la bibliographie n\'est jamais promue',
  { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Un paragraphe de corps assez long pour etablir la taille dominante '
          + 'coherente sur ce document teste ici pour de bon.', { taille: 20 }),
        para(1, 'Encore un paragraphe de corps assez long pour etablir la meme taille '
          + 'dominante coherente sur ce document teste encore.', { taille: 20 }),
        para(2, 'Références'),
        para(3, 'Dupont, J. (2020). Un premier ouvrage important. Editions Test.'),
        para(4, 'Martin, A. (2019). Un second ouvrage tout aussi important. Editions Test.'),
        para(5, 'Bernard, C. (2021). Un troisieme ouvrage. Editions Test.'),
        para(6, 'Lefevre, P. (2018). Un quatrieme ouvrage. Editions Test.')
      ]
    };
    const { titres } = diagnostiquer(doc);
    for (const source of [3, 4, 5, 6]) {
      const ligne = trouver(titres.trace, source);
      assert.strictEqual(ligne.decision, 'exclu_bibliographie',
        'l\'entrée ' + source + ' ne doit jamais être candidate à la promotion');
      assert.strictEqual(ligne.niveau_retenu, 0);
    }
    // Le titre « Références » (source=2) n'est pas exclu, seules les entrées le sont : court
    // et de signature distincte, il est promu.
    const rubrique = trouver(titres.trace, 2);
    assert.strictEqual(rubrique.decision, 'promue',
      'la rubrique « Références » elle-même reste un candidat ordinaire, hors étendue exclue');
    assert.strictEqual(titres.stats.promus, 1, 'seule la rubrique est promue, aucune entrée');
  });

// ---------------------------------------------------------------------------------------
// 10. Quand rien ne convainc, rien n'est promu et un constat le dit dans la trace.

test('classer_titres : rien ne convainc -> rien promu, et un constat le dit', { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Un paragraphe de corps assez long pour etablir la taille dominante '
          + 'coherente sur ce document teste ici pour de bon.', { taille: 20 }),
        para(1, 'Encore un paragraphe de corps assez long pour etablir la meme taille '
          + 'dominante coherente sur ce document teste encore un peu.', { taille: 20 }),
        para(2, 'Toujours un paragraphe de corps assez long et banal, sans structure '
          + 'particuliere a signaler ici non plus vraiment.', { taille: 20 }),
        // Un groupe existe (taille distincte, court, trois occurrences) mais ses trois
        // paragraphes se suivent : le critère de répartition (SEUIL_DISPERSION_MIN)
        // l'écarte. Le contrôle vérifie la ligne qui dit qu'aucune structure ne se dégage.
        para(3, 'Un mot isole un', { taille: 26 }),
        para(4, 'Un mot isole deux', { taille: 26 }),
        para(5, 'Un mot isole trois', { taille: 26 })
      ]
    };
    const { titres } = diagnostiquer(doc);
    assert.strictEqual(titres.stats.promus, 0);
    for (const ligne of titres.trace) {
      if (ligne.portee === 'paragraphe') assert.strictEqual(ligne.niveau_retenu, 0);
    }
    // Le constat est explicite dans la trace.
    const constat = traceDocument(titres.trace, 'aucune_promotion_decelee');
    assert.strictEqual(constat.length, 1, 'un constat explicite doit figurer dans la trace');
    assert.match(constat[0].motif, /aucune structure de titres décelable/);
  });

// ---------------------------------------------------------------------------------------
// 11. Au plus trois niveaux (MAX_NIVEAUX=3). Avec quatre groupes qualifiants, le 4e (D,
// souligné, le plus bas dans l'ordre) rejoint le niveau 3 du 3e groupe (C) au lieu d'être
// perdu.
//
// Le rejet en bloc (« promotion_rejetee_contrainte_niveaux ») reste un garde-fou distinct,
// inatteignable avec les données actuelles : niveau_declare ne prend que 1, 2 ou 3, et le
// rabattage n'invente pas de niveau (voir classer_titres()).

test('classer_titres : quatre groupes qualifiants -> jamais plus de trois NIVEAUX, le 4e rabattu sur le niveau 3', { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Un paragraphe de corps assez long pour etablir la taille dominante '
          + 'coherente sur ce document teste ici pour de bon et sans ambiguite.', { taille: 20 }),
        para(1, 'Premier groupe A', { taille: 30 }),
        para(2, 'Encore un paragraphe de corps assez long pour etablir la meme taille '
          + 'dominante coherente sur ce document teste encore un peu plus loin.', { taille: 20 }),
        para(3, 'Deuxieme groupe B', { taille: 26, gras: true }),
        para(4, 'Toujours un paragraphe de corps assez long et banal, sans structure '
          + 'particuliere a signaler ici non plus vraiment du tout.', { taille: 20 }),
        para(5, 'Troisieme groupe C', { taille: 22, italique: true }),
        para(6, 'Un dernier paragraphe de corps assez long pour fermer cette liste sans '
          + 'ambiguite aucune sur sa nature de texte courant banal ici.', { taille: 20 }),
        para(7, 'Quatrieme groupe D', { souligne: true })
      ]
    };
    const { titres } = diagnostiquer(doc);
    assert.strictEqual(titres.stats.promus, 4, 'les QUATRE paragraphes candidats sont promus '
      + '(plus aucun groupe n\'est purement et simplement rejeté)');

    const l1 = trouver(titres.trace, 1);
    const l3 = trouver(titres.trace, 3);
    const l5 = trouver(titres.trace, 5);
    const l7 = trouver(titres.trace, 7);
    for (const ligne of [l1, l3, l5, l7]) {
      assert.strictEqual(ligne.decision, 'promue', 'source=' + ligne.source + ' doit être promu');
    }
    assert.strictEqual(l7.niveau_retenu, 3, 'le 4e groupe (souligné, le plus bas) rejoint le '
      + 'niveau 3 plutôt que d\'être rejeté');
    assert.strictEqual(l5.niveau_retenu, 3, 'il rejoint le 3e groupe, déjà niveau 3');

    const niveaux = new Set([l1, l3, l5, l7].map((l) => l.niveau_retenu));
    assert.strictEqual(niveaux.size, 3, 'au plus trois niveaux DISTINCTS au total, malgré les '
      + 'quatre groupes qualifiants');

    const signal = traceDocument(titres.trace, 'groupes_rabattus_niveau3');
    assert.strictEqual(signal.length, 1, 'le rabattage doit être un signal explicite du rapport');
    assert.strictEqual(titres.stats.groupes_rabattus_niveau3, 1);
  });

// ---------------------------------------------------------------------------------------
// 12. Passe 3 bis, adoption : un titre déclaré fournit la signature de son niveau, et un
// paragraphe non stylé qui la porte est adopté. Cinq H2 déclarés en 12 pt italique, plus un
// sixième paragraphe sans style en 12 pt italique : les six ressortent au niveau 2.

test('classer_titres : passe 3 bis, adoption -> le 6e paragraphe (12 pt italique, sans style) rejoint les 5 H2', { skip: sansPython }, () => {
    const blocs = [];
    let src = 0;
    for (let i = 0; i < 5; i++) {
      blocs.push(para(src++, 'Titre H2 numéro ' + i, { style: 'heading 2', niveauDeclare: 2, italique: true, taille: 24 }));
      blocs.push(para(src++, 'Un paragraphe de corps assez long pour établir la taille '
        + 'dominante cohérente sur ce document testé ici numéro ' + i + ' pour de bon.', { taille: 20 }));
    }
    const sourceOubli = src++;
    blocs.push(para(sourceOubli, 'Titre en italique mais oublié', { italique: true, taille: 24 }));
    blocs.push(para(src++, 'Un dernier paragraphe de corps assez long pour fermer cet '
      + 'article sans ambiguïté aucune ici.', { taille: 20 }));

    const { titres } = diagnostiquer({ styles: ['heading 2'], blocs });

    const reference = traceDocument(titres.trace, 'reference_adoption');
    assert.strictEqual(reference.length, 1, 'une référence doit être calculée pour le niveau 2');
    assert.match(reference[0].motif, /niveau 2/);
    assert.match(reference[0].motif, /5\/5/, 'la référence doit couvrir les 5 titres déclarés, tous survivants');

    const oubli = trouver(titres.trace, sourceOubli);
    assert.strictEqual(oubli.decision, 'adoptee',
      'le paragraphe oublié doit être ADOPTÉ (jamais « promue », qui désigne la passe 3 aveugle)');
    assert.strictEqual(oubli.niveau_retenu, 2, 'il rejoint le niveau 2 de la référence, jamais un niveau déduit');
    assert.strictEqual(titres.stats.adoptes, 1);

    for (let i = 0; i < 5; i++) {
      const ligne = trouver(titres.trace, i * 2);
      assert.strictEqual(ligne.niveau_retenu, 2, 'le H2 déclaré ' + i + ' doit rester niveau 2');
    }
  });

// ---------------------------------------------------------------------------------------
// 12bis. Passe 3 bis, majorité : cinq H2 aux mises en forme toutes différentes ne donnent
// aucune référence, et rien n'est adopté.

test('classer_titres : passe 3 bis, aucune majorité -> aucune référence, rien adopté', { skip: sansPython }, () => {
    const blocs = [
      para(0, 'Titre H2 un', { style: 'heading 2', niveauDeclare: 2, gras: true, taille: 24 }),
      para(1, 'Titre H2 deux', { style: 'heading 2', niveauDeclare: 2, italique: true, taille: 22 }),
      para(2, 'Titre H2 trois', { style: 'heading 2', niveauDeclare: 2, souligne: true, taille: 20 }),
      para(3, 'Un paragraphe de corps assez long pour établir la taille dominante '
        + 'cohérente sur ce document testé ici pour de bon et sans ambiguïté aucune.', { taille: 18 }),
      // Signature du premier H2 (gras, 24) : sans garde-fou de majorité, ce candidat serait
      // adopté au niveau 2.
      para(4, 'Paragraphe gras non stylé', { gras: true, taille: 24 }),
      para(5, 'Encore un paragraphe de corps assez long pour établir la même taille '
        + 'dominante cohérente sur ce document testé ici pour de bon et sans ambiguïté.', { taille: 18 })
    ];
    const { titres } = diagnostiquer({ styles: ['heading 2'], blocs });

    const reference = traceDocument(titres.trace, 'reference_adoption');
    assert.strictEqual(reference.length, 0,
      'trois signatures différentes sur trois titres : aucune majorité, donc aucune référence');

    const candidat = trouver(titres.trace, 4);
    assert.notStrictEqual(candidat.decision, 'adoptee',
      'sans référence majoritaire, ce candidat ne doit jamais être adopté');
    assert.strictEqual(titres.stats.adoptes, 0);
  });

// ---------------------------------------------------------------------------------------
// 12ter. Passe 3 bis, signature du corps : trois H2 courts sans mise en forme directe
// survivent la passe 4 par leur longueur, et leur majorité vaut la signature du corps. Une
// référence calculée là-dessus adopterait n'importe quel paragraphe de corps : il n'y en a
// pas.

test('classer_titres : passe 3 bis, majorité = signature du corps -> aucune référence', { skip: sansPython }, () => {
    const doc = {
      styles: ['heading 2'],
      blocs: [
        para(0, 'Titre court un', { style: 'heading 2', niveauDeclare: 2, taille: 20 }),
        para(1, 'Un paragraphe de corps assez long pour établir la taille dominante '
          + 'cohérente sur ce document testé ici pour de bon.', { taille: 20 }),
        para(2, 'Titre court deux', { style: 'heading 2', niveauDeclare: 2, taille: 20 }),
        para(3, 'Encore un paragraphe de corps assez long pour établir la même taille '
          + 'dominante cohérente sur ce document testé encore.', { taille: 20 }),
        para(4, 'Titre court trois', { style: 'heading 2', niveauDeclare: 2, taille: 20 }),
        para(5, 'Toujours un paragraphe de corps assez long et banal, sans structure '
          + 'particulière à signaler ici non plus vraiment.', { taille: 20 })
      ]
    };
    const { titres } = diagnostiquer(doc);
    assert.strictEqual(titres.stats.retrogrades, 0,
      'ces trois H2 survivent par leur LONGUEUR (courts), pas par leur signature — condition du contrôle');
    const reference = traceDocument(titres.trace, 'reference_adoption');
    assert.strictEqual(reference.length, 0,
      'la majorité des survivants vaut exactement la signature du corps : aucune référence ne doit se former');
    assert.strictEqual(titres.stats.adoptes, 0);
  });

// ---------------------------------------------------------------------------------------
// 13. Passe 3 bis, ordre : rétrograder, puis calculer la référence sur les titres déclarés
// restants, puis adopter. Dans 1_Résumé-article-revue-CSPS.docx, un Titre 2 est posé sur
// quatre paragraphes, dont trois de corps. Calculée avant la rétrogradation, la signature
// majoritaire serait celle du corps, et tout l'article serait promu.

test('classer_titres : passe 3 bis sur corpus réel (1_Résumé) -> l\'adoption ne promeut pas le corps du document',
  { skip: sansPython }, (t) => {
    if (!fs.existsSync(CORPUS_LOT_A)) {
      sauter.corpus(t, 'tmp/corpus-relecture/lot-A (hors git, effacé sans prévenir)');
      return;
    }
    const fichier = fs.readdirSync(CORPUS_LOT_A).find((n) => n.startsWith('1_') && n.endsWith('.docx'));
    if (!fichier) {
      t.skip('corpus hors dépôt absent : aucun fichier "1_*.docx" dans lot-A');
      return;
    }
    const { stats, n_titres_retenus: nTitres, n_paragraphes: nParagraphes } =
      classerSurFichier(path.join(CORPUS_LOT_A, fichier));

    // Borne MAX_TITRES de la passe 2 (maximum observé sur 36 articles : 21).
    assert.ok(nTitres <= 21,
      'le nombre de titres retenus (' + nTitres + '/' + nParagraphes + ') doit rester dans '
      + 'les bornes plausibles (§5.1 passe 2) : l\'adoption n\'a pas promu le corps du document');
    assert.ok(nTitres < nParagraphes * 0.5,
      'moins de la moitié des paragraphes du document ne doivent jamais devenir des titres');
    assert.strictEqual(stats.rejet_contrainte_niveaux, false);
  });

// =========================================================================================
// Signatures effectives, titres en liste numérotée, exclusions de la passe 1 et plafond de
// trois groupes. Voir docs/ARCHITECTURE-nettoyeur-manuscrit.md.
// =========================================================================================

// ---------------------------------------------------------------------------------------
// 14. Un item de liste numérotée isolé (aucun voisin non vide de la même liste), gras, avec
// un numéro manuel en tête, est promu titre : le numéro manuel est retiré (le gabarit
// numérote lui-même les Titre1) et la liste disparaît (`liste = None`).
//
// Sabotage : remplacer le corps de _item_numerote_isole() par `return False`.

test('classer_titres : item de liste numérotée isolé, gras, avec numéro manuel -> promu, numéro retiré', { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Un paragraphe de corps assez long pour établir la taille dominante '
          + 'cohérente sur ce document testé ici pour de bon et sans ambiguïté aucune.', { taille: 20 }),
        para(1, '2.1 Sous-partie numérotée', { gras: true, taille: 20, liste: [7, 0, 'numero'] }),
        para(2, 'Encore un paragraphe de corps assez long pour établir la même taille '
          + 'dominante cohérente sur ce document testé encore un peu plus loin ici.', { taille: 20 })
      ]
    };
    const { titres, document: doc2 } = diagnostiquer(doc);
    const ligne = trouver(titres.trace, 1);
    assert.strictEqual(ligne.decision, 'promue_liste');
    assert.strictEqual(ligne.niveau_retenu, 2, 'la profondeur du numéro manuel (« 2.1 ») donne le niveau 2');
    assert.match(ligne.motif, /liste numérotée/);
    assert.match(ligne.motif, /« 2\.1 »/, 'la trace doit citer le numéro retiré');
    assert.strictEqual(titres.stats.promus_liste, 1);

    const p1 = doc2.blocs[1];
    assert.strictEqual(p1.liste, null, 'la liste doit avoir disparu du paragraphe promu');
    assert.strictEqual(p1.fragments[0].texte, 'Sous-partie numérotée',
      'le numéro manuel de tête doit être retiré du premier fragment');
  });

// ---------------------------------------------------------------------------------------
// 15. Trois items numérotés consécutifs ou plus forment une vraie liste : chacun a un voisin
// non vide de la même liste (numId), aucun n'est isolé.
//
// Sabotage : dans _voisin_non_vide(), faire `return None` immédiatement.

test('classer_titres : trois items numérotés consécutifs -> jamais promus (vraie liste)', { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Un paragraphe de corps assez long pour établir la taille dominante '
          + 'cohérente sur ce document testé ici pour de bon et sans ambiguïté aucune.', { taille: 20 }),
        para(1, 'Point un', { gras: true, taille: 20, liste: [9, 0, 'numero'] }),
        para(2, 'Point deux', { gras: true, taille: 20, liste: [9, 0, 'numero'] }),
        para(3, 'Point trois', { gras: true, taille: 20, liste: [9, 0, 'numero'] }),
        para(4, 'Encore un paragraphe de corps assez long pour établir la même taille '
          + 'dominante cohérente sur ce document testé encore un peu plus loin ici.', { taille: 20 })
      ]
    };
    const { titres } = diagnostiquer(doc);
    for (const source of [1, 2, 3]) {
      const ligne = trouver(titres.trace, source);
      assert.strictEqual(ligne.decision, 'exclu_liste',
        'item ' + source + ' d\'une vraie liste numérotée ne doit jamais être promu');
      assert.strictEqual(ligne.niveau_retenu, 0);
    }
    assert.strictEqual(titres.stats.promus_liste, 0);
  });

// ---------------------------------------------------------------------------------------
// 16. Une liste à puces n'est jamais candidate, isolée ou non : seule la numérotation rend un
// item ambigu.
//
// Sabotage : dans _item_numerote_isole(), retirer la condition `p.liste[2] != 'numero'`.

test('classer_titres : item de liste À PUCES isolé -> jamais promu, même gras', { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Un paragraphe de corps assez long pour établir la taille dominante '
          + 'cohérente sur ce document testé ici pour de bon et sans ambiguïté aucune.', { taille: 20 }),
        para(1, 'Point isolé en puce', { gras: true, taille: 20, liste: [7, 0, 'puce'] }),
        para(2, 'Encore un paragraphe de corps assez long pour établir la même taille '
          + 'dominante cohérente sur ce document testé encore un peu plus loin ici.', { taille: 20 })
      ]
    };
    const { titres } = diagnostiquer(doc);
    const ligne = trouver(titres.trace, 1);
    assert.strictEqual(ligne.decision, 'exclu_liste');
    assert.strictEqual(ligne.niveau_retenu, 0);
    assert.strictEqual(titres.stats.promus_liste, 0);
  });

// ---------------------------------------------------------------------------------------
// 17. Un séparateur visuel (ligne de tirets, sans lettre) n'est jamais un titre, même gras et
// d'une taille distincte.
//
// Sabotage : remplacer le corps de _sans_aucune_lettre() par `return False` ; isolée et
// distincte, la ligne qualifie et le contrôle rougit.

test('classer_titres : une ligne de tirets (sans aucune lettre) -> jamais promue', { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Un paragraphe de corps assez long pour établir la taille dominante '
          + 'cohérente sur ce document testé ici pour de bon et sans ambiguïté aucune.', { taille: 20 }),
        para(1, '————————————', { gras: true, taille: 30 }),
        para(2, 'Encore un paragraphe de corps assez long pour établir la même taille '
          + 'dominante cohérente sur ce document testé encore un peu plus loin ici.', { taille: 20 })
      ]
    };
    const { titres } = diagnostiquer(doc);
    const ligne = trouver(titres.trace, 1);
    assert.strictEqual(ligne.decision, 'exclu_sans_lettre');
    assert.strictEqual(ligne.niveau_retenu, 0);
  });

// ---------------------------------------------------------------------------------------
// 18. Un paragraphe qui porte une adresse courriel n'est jamais un titre, même en gras.
//
// Sabotage : remplacer le corps de _porte_des_coordonnees() par `return False`.

test('classer_titres : une ligne avec adresse courriel -> jamais promue', { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Un paragraphe de corps assez long pour établir la taille dominante '
          + 'cohérente sur ce document testé ici pour de bon et sans ambiguïté aucune.', { taille: 20 }),
        para(1, 'Contact : jean.dupont@example.com', { gras: true, taille: 30 }),
        para(2, 'Encore un paragraphe de corps assez long pour établir la même taille '
          + 'dominante cohérente sur ce document testé encore un peu plus loin ici.', { taille: 20 })
      ]
    };
    const { titres } = diagnostiquer(doc);
    const ligne = trouver(titres.trace, 1);
    assert.strictEqual(ligne.decision, 'exclu_coordonnees');
    assert.strictEqual(ligne.niveau_retenu, 0);
  });

// ---------------------------------------------------------------------------------------
// 19. « Tableau 1 » (lexique de légende RE_LEGENDE, importé de docx-titres.py) n'est jamais
// un titre.
//
// Sabotage : commenter la branche `elif RE_LEGENDE.match(...)` dans _exclusions_passe1().

test('classer_titres : "Tableau 1" (lexique de légende) -> jamais promu',
  { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Un paragraphe de corps assez long pour établir la taille dominante '
          + 'cohérente sur ce document testé ici pour de bon et sans ambiguïté aucune.', { taille: 20 }),
        para(1, 'Tableau 1', { gras: true, taille: 30 }),
        para(2, 'Encore un paragraphe de corps assez long pour établir la même taille '
          + 'dominante cohérente sur ce document testé encore un peu plus loin ici.', { taille: 20 })
      ]
    };
    const { titres } = diagnostiquer(doc);
    const ligne = trouver(titres.trace, 1);
    assert.strictEqual(ligne.decision, 'exclu_legende_lexique');
    assert.strictEqual(ligne.niveau_retenu, 0);
  });

// ---------------------------------------------------------------------------------------
// 20. Signatures effectives : un corps qui hérite sa taille (`effectif` rempli par la cascade
// des styles, `forme` vide) et un faux titre qui la déclare directement (`forme` rempli, repli
// sur `forme`) sont jugés à la même taille ; sans autre signal, le faux titre est rétrogradé
// par sa longueur.
//
// Sabotage : remplacer le corps de _valeur_effective() par `return fragment.forme.get(cle)`.

function paragrapheAvecEffectif(source, texte, opts = {}) {
  const { style = '', niveauDeclare = 0, formeDirecte = {}, effectif = null } = opts;
  return { source, style, niveau_declare: niveauDeclare,
    fragments: [{ texte, forme: formeDirecte, effectif }], alignement: '', liste: null };
}

test('classer_titres : signature EFFECTIVE (corps hérite 12pt, faux titre le déclare) -> jugés identiques, rétrogradé par la longueur', { skip: sansPython }, () => {
    const corpsLong = (n) => 'Un paragraphe de corps assez long pour établir la taille '
      + 'dominante cohérente sur ce document testé ici pour de bon, numéro ' + n + '.';
    const doc = {
      styles: ['heading 2'],
      blocs: [
        // Corps : aucune taille directe, un effectif de 24 (hérité de docDefaults/Normal).
        paragrapheAvecEffectif(0, corpsLong(1), { effectif: { taille: 24 } }),
        paragrapheAvecEffectif(1, corpsLong(2), { effectif: { taille: 24 } }),
        // Faux titre : H2 déclaré sur 40 mots de corps, taille directe 24 (même valeur que le
        // corps une fois résolue), aucun autre signal direct.
        paragrapheAvecEffectif(2,
          Array.from({ length: 40 }, (_, i) => 'mot' + (i + 1)).join(' ') + '.',
          { style: 'heading 2', niveauDeclare: 2, formeDirecte: { taille: 24 } }),
        paragrapheAvecEffectif(3, corpsLong(3), { effectif: { taille: 24 } }),
        paragrapheAvecEffectif(4, corpsLong(4), { effectif: { taille: 24 } })
      ]
    };
    const { titres } = diagnostiquer(doc);
    const ligne = trouver(titres.trace, 2);
    assert.strictEqual(ligne.decision, 'retrogradee_signature_corps',
      'même taille EFFECTIVE que le corps (24 des deux côtés) et trop long : rétrogradé');
    assert.strictEqual(ligne.niveau_retenu, 0);
    assert.match(ligne.motif, /identique à celle du corps/,
      'une fois résolues, les deux signatures sont bel et bien identiques (24 des deux côtés) '
      + '— la trace doit le dire sans détour, jamais parler d\'une distinction qui n\'existe plus');
  });

// 20bis. Un faux titre obtenu en remplaçant seulement w:pStyle (aucun réglage direct, mais
// une signature effective de titre, gras et grand) n'est pas protégé pour cette raison : la
// distinction doit exister en direct et en effectif.
//
// Sabotage : dans _passe4_retrogradation(), remplacer `distinct_effectif and distinct_direct`
// par `distinct_effectif`.

test('classer_titres : signature distincte SEULEMENT en effectif (pStyle nu, aucun réglage direct) -> pas de conservation inconditionnelle', { skip: sansPython }, () => {
    const corpsLong = (n) => 'Un paragraphe de corps assez long pour établir la taille '
      + 'dominante cohérente sur ce document testé ici pour de bon, numéro ' + n + '.';
    const doc = {
      styles: ['heading 2'],
      blocs: [
        // Corps : aucune mise en forme directe ni effective.
        paragrapheAvecEffectif(0, corpsLong(1)),
        paragrapheAvecEffectif(1, corpsLong(2)),
        // Faux titre : H2 déclaré sur 40 mots, sans réglage direct ; l'effectif simule la
        // cascade du style « heading 2 » (gras, 28 pt).
        paragrapheAvecEffectif(2,
          Array.from({ length: 40 }, (_, i) => 'mot' + (i + 1)).join(' ') + '.',
          { style: 'heading 2', niveauDeclare: 2, effectif: { taille: 28, gras: true } }),
        paragrapheAvecEffectif(3, corpsLong(3)),
        paragrapheAvecEffectif(4, corpsLong(4))
      ]
    };
    const { titres } = diagnostiquer(doc);
    const ligne = trouver(titres.trace, 2);
    assert.notStrictEqual(ligne.decision, 'conserve_signature_distincte',
      'aucun réglage DIRECT ne distingue ce faux titre du corps : la longueur doit trancher, '
      + 'pas une conservation inconditionnelle sur la seule foi de la cascade de style');
    assert.strictEqual(ligne.niveau_retenu, 0, 'trop long (40 mots) : rétrogradé');
  });

// ---------------------------------------------------------------------------------------
// 21. Au-delà de trois groupes, les excédentaires rejoignent le niveau 3 (voir aussi le
// contrôle 11). Ici cinq groupes : D et E rejoignent tous deux le niveau 3.

test('classer_titres : cinq groupes qualifiants -> les deux excédentaires rejoignent tous deux le niveau 3', { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Un paragraphe de corps assez long pour etablir la taille dominante '
          + 'coherente sur ce document teste ici pour de bon et sans ambiguite.', { taille: 20 }),
        para(1, 'Groupe A', { taille: 32 }),
        para(2, 'Encore un paragraphe de corps assez long pour etablir la meme taille '
          + 'dominante coherente sur ce document teste encore un peu plus loin.', { taille: 20 }),
        para(3, 'Groupe B', { taille: 28, gras: true }),
        para(4, 'Toujours un paragraphe de corps assez long et banal, sans structure '
          + 'particuliere a signaler ici non plus vraiment du tout.', { taille: 20 }),
        para(5, 'Groupe C', { taille: 24, italique: true }),
        para(6, 'Un autre paragraphe de corps assez long et banal, sans structure '
          + 'particuliere a signaler ici non plus vraiment du tout non plus.', { taille: 20 }),
        para(7, 'Groupe D', { souligne: true, taille: 18 }),
        para(8, 'Un dernier paragraphe de corps assez long pour fermer cette liste sans '
          + 'ambiguite aucune sur sa nature de texte courant banal ici.', { taille: 20 }),
        para(9, 'Groupe E', { souligne: true, taille: 16 })
      ]
    };
    const { titres } = diagnostiquer(doc);
    assert.strictEqual(titres.stats.promus, 5, 'les cinq candidats sont tous promus');
    const l7 = trouver(titres.trace, 7);
    const l9 = trouver(titres.trace, 9);
    assert.strictEqual(l7.niveau_retenu, 3);
    assert.strictEqual(l9.niveau_retenu, 3, 'les DEUX excédentaires rejoignent le niveau 3');
    assert.strictEqual(titres.stats.groupes_rabattus_niveau3, 2);
  });

// ---------------------------------------------------------------------------------------
// 22. Les titres de liste numérotée se groupent par niveau sur la signature typographique,
// sans l'alignement : un alignement justifié hérité ne doit pas scinder des titres
// gras/taille/police identiques en deux niveaux.
//
// Sabotage : dans _detecter_titres_liste(), remplacer `cle = _signature_typographique(sig)`
// par `cle = sig`.

test('classer_titres : titres de liste numérotée, même gras/taille mais alignements différents -> même niveau', { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Un paragraphe de corps assez long pour établir la taille dominante '
          + 'cohérente sur ce document testé ici pour de bon et sans ambiguïté aucune.', { taille: 20 }),
        para(1, 'Premier titre de liste', { gras: true, taille: 24, liste: [3, 0, 'numero'] }),
        para(2, 'Encore un paragraphe de corps assez long pour établir la même taille '
          + 'dominante cohérente sur ce document testé encore un peu plus loin ici.', { taille: 20 }),
        para(3, 'Second titre de liste', { gras: true, taille: 24, alignement: 'both', liste: [3, 0, 'numero'] }),
        para(4, 'Un dernier paragraphe de corps assez long pour fermer ce document sans '
          + 'ambiguïté aucune sur sa nature de texte courant banal ici pour de bon.', { taille: 20 })
      ]
    };
    const { titres } = diagnostiquer(doc);
    const l1 = trouver(titres.trace, 1);
    const l3 = trouver(titres.trace, 3);
    assert.strictEqual(l1.decision, 'promue_liste');
    assert.strictEqual(l3.decision, 'promue_liste');
    assert.strictEqual(l1.niveau_retenu, l3.niveau_retenu,
      'un alignement hérité incidemment ne doit jamais, à lui seul, séparer deux titres de '
      + 'liste par ailleurs identiques (gras, taille, police)');
  });

// ---------------------------------------------------------------------------------------
// 23. Hiérarchie portée par le gras seul, titres de 1 à 10 mots (« Résumé », « Perspectives »
// …) : le critère d'homogénéité de longueur de la passe 3, avec son plancher
// PLANCHER_HOMOGENEITE_MOTS, garde le groupe entier.
//
// Sabotage : dans _filtrer_groupes(), remplacer
// `SEUIL_HOMOGENEITE_MOTS * max(mn, PLANCHER_HOMOGENEITE_MOTS)` par
// `SEUIL_HOMOGENEITE_MOTS * max(mn, 1)`.

test('classer_titres : hiérarchie portée par le gras seul, titres de 1 à 10 mots -> un seul groupe, tous promus', { skip: sansPython }, () => {
    // Corps long (~300 signes) et majoritaire (7 paragraphes pour 5 titres). Sinon la
    // médiane du corps tombe entre titres et paragraphes, et le titre de 10 mots échoue le
    // seuil relatif de la passe 3 (RATIO_LONGUEUR_TITRE=3) avant le critère d'homogénéité
    // visé ici.
    const corpsLong = (n) => 'Un paragraphe de corps assez long pour établir la taille '
      + 'dominante cohérente sur ce document testé ici pour de bon, non gras comme tout le '
      + 'corps, numéro ' + n + ', avec largement assez de texte pour représenter fidèlement '
      + 'la longueur typique d\'un paragraphe de cet article sans aucune ambiguïté ici.';
    const doc = {
      styles: [],
      blocs: [
        para(0, corpsLong(1), { taille: 22 }),
        para(1, 'Résumé', { gras: true, taille: 22 }),
        para(2, corpsLong(2), { taille: 22 }),
        para(3, 'Le dispositif et ses enjeux curriculaires', { gras: true, taille: 22 }),
        para(4, corpsLong(3), { taille: 22 }),
        para(5, 'Résultats préliminaires sur les questions de recherche envisagées ici même',
          { gras: true, taille: 22 }),
        para(6, corpsLong(4), { taille: 22 }),
        para(7, 'Perspectives', { gras: true, taille: 22 }),
        para(8, corpsLong(5), { taille: 22 }),
        // Les paragraphes de corps supplémentaires précèdent « Références » : placés après,
        // ils tomberaient dans l'étendue de bibliographie et sortiraient de la médiane.
        para(9, corpsLong(6), { taille: 22 }),
        para(10, corpsLong(7), { taille: 22 }),
        para(11, 'Références', { gras: true, taille: 22 })
      ]
    };
    const { titres } = diagnostiquer(doc);
    for (const source of [1, 3, 5, 7, 11]) {
      const ligne = trouver(titres.trace, source);
      assert.strictEqual(ligne.decision, 'promue', 'source=' + source + ' doit être promu');
    }
    const niveaux = new Set([1, 3, 5, 7, 11].map((s) => trouver(titres.trace, s).niveau_retenu));
    assert.strictEqual(niveaux.size, 1,
      'un seul groupe qualifiant (même gras, même taille, aucune autre distinction) : un seul niveau');
    assert.strictEqual(titres.stats.promus, 5);
  });

// ---- Titres numérotés par leur style --------------------------------------------------
//
// Un titre Word numéroté par son style (« 1 », « 1.1 ») perd cette liste et prend la
// numérotation du gabarit. Un paragraphe de corps numéroté par la même liste devient un titre
// du niveau de son item, et non un item de liste.
const TITRES_DU_PLAN = [
  'import json, sys',
  'sys.path.insert(0, sys.argv[1])',
  'import manuscrit_modele as mm',
  'document = mm.document_depuis_json(json.loads(sys.stdin.read()))',
  'for p in document.blocs: p.niveau_retenu = p.niveau_declare',
  'n_promus, n_retires, trace = mm.titres_du_plan(document)',
  'print(json.dumps({"n_promus": n_promus, "n_retires": n_retires, "trace": trace,',
  '  "paras": [[p.niveau_retenu, p.liste] for p in document.blocs]}))'
].join('\n');

test('titres_du_plan : un titre perd la liste de son style, un paragraphe numéroté par elle devient titre', { skip: sansPython }, () => {
  const doc = { blocs: [
    para(0, 'Introduction', { style: 'heading 1', niveauDeclare: 1, liste: [1, 0, 'numero'] }),
    para(1, 'Un corps.'),
    para(2, 'Une sous-section', { style: 'heading 2', niveauDeclare: 2, liste: [1, 1, 'numero'] }),
    para(3, 'Une section oubliée', { gras: true, liste: [1, 1, 'numero'] }),
    para(4, 'Conclusion', { gras: true, liste: [1, 0, 'numero'] }),
    para(5, 'Un vrai item de liste', { liste: [7, 0, 'numero'] })
  ] };
  const r = python(['-c', TITRES_DU_PLAN, path.join(RACINE, 'pipeline')],
    { input: JSON.stringify(doc), encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const sortie = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(sortie.paras, [
    [1, null], [0, null], [2, null], [2, null], [1, null], [0, [7, 0, 'numero']]
  ], 'niveaux et listes après coup');
  assert.strictEqual(sortie.n_promus, 2);
  assert.strictEqual(sortie.n_retires, 2);
  assert.ok(sortie.trace.every((l) => l.decision === 'promue_plan'));
});
