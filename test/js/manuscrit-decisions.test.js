// pipeline/manuscrit_modele.py : les décisions du nettoyeur de manuscrit (article) — classement
// des titres (promotion ET rétrogradation, §5.1 du contrat) et nettoyage de la mise en forme
// manuelle (§5.2). Le module n'a pas de lecteur .docx/.odt ici : ce test passe par le mode
// --diagnostic, qui lit un Document au format JSON documenté en tête de manuscrit_modele.py.
//
//   node --test test/js/manuscrit-decisions.test.js
//
// ── Refonte du 18.09.2026 ───────────────────────────────────────────────────────────────────
//
// classer_titres() a été entièrement réécrite (§5.1 du contrat, refonte du 18.09.2026) : quatre
// passes — exclusions, état déclaré, regroupement par SIGNATURE (jamais un paragraphe seul,
// jamais un score), rétrogradation. L'ancienne conception jugeait chaque paragraphe SEUL contre
// des valeurs ABSOLUES (MAX_MOTS=12, SEUIL_TAILLE=1.2x, ponctuation finale) ; elle détruisait 4
// vrais titres sur 4 fichiers réels pour 6/17 pseudo-titres rattrapés sur un article sans style.
//
// Des 7 contrôles d'origine, ce fichier GARDE ceux qui exercent encore un mécanisme réel de la
// nouvelle conception (adaptés à son vocabulaire de trace) et REMPLACE ceux qui ne testaient
// qu'un mécanisme aujourd'hui disparu — en le disant à chaque fois :
//   1. « H2 posé sur trois paragraphes »            — GARDÉ (le cas d'ouverture du chantier),
//                                                       adapté : la trace ne parle plus de
//                                                       « suite stylée » mais de signature.
//   2. « style porté par 80 % du document »          — REMPLACÉ. Le garde-fou de
//                                                       GÉNÉRALISATION PAR RATIO DE STYLE a
//                                                       disparu : il ne distinguait rien de
//                                                       réel (un ratio, pas une preuve). Sa
//                                                       place est prise par le contrôle 6
//                                                       ci-dessous (bibliographie via
//                                                       TITRES_BIB), le vrai mécanisme que le
//                                                       §5.1 demandait pour ce risque.
//   3. « document déjà bien stylé -> inchangé »       — GARDÉ tel quel, c'est le contrôle le
//                                                       plus important de tous.
//   4. « aucun style de titre -> gras + taille »      — GARDÉ, adapté au vocabulaire de trace.
//   5. « formatage : italique/exposant/lien survivent » — GARDÉ à l'identique : ce contrôle
//                                                       porte sur nettoyer_mise_en_forme(),
//                                                       que ce chantier ne touche pas.
//   6. « 11 mots sans gras, taille du corps -> pas promu » — GARDÉ, cas dégénéré (un seul
//                                                       candidat du document, sa signature
//                                                       vaut donc trivialement celle du
//                                                       corps).
//   7. « garde-fou 1 ne protège pas un style isolé »  — REMPLACÉ. Le garde-fou 1 (« premier
//                                                       d'une suite stylée protégé ») a
//                                                       DISPARU de la nouvelle conception :
//                                                       chaque paragraphe déclaré est jugé
//                                                       individuellement par la passe 4, plus
//                                                       de notion de suite du tout. Remplacé
//                                                       par le contrôle 3bis ci-dessous, qui
//                                                       prouve la même intention avec le
//                                                       nouveau mécanisme (signature + longueur
//                                                       plutôt que position dans une suite).
//
// S'y ajoutent les contrôles neufs demandés pour cette refonte (§5.1, cas dangereux et
// critères d'acceptation) : l'italique seul (le cas qui a motivé toute la refonte), un
// intertitre long non détruit, l'entretien hors gabarit, la bibliographie, le repli « rien ne
// convainc », et la contrainte de trois niveaux.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython } = require('./gardes');

const fs = require('fs');
const RACINE = path.resolve(__dirname, '..', '..');
const MANUSCRIT_MODELE = path.join(RACINE, 'pipeline', 'manuscrit_modele.py');
const CORPUS_LOT_A = path.join(RACINE, 'tmp', 'corpus-relecture', 'lot-A');

// Lance manuscrit_modele.py --diagnostic sur un Document JSON, rend le résultat déjà parsé
// (gabarit, taille_dominante, titres.{stats,trace}, formatage.{stats,trace}, et surtout
// `document` : l'état RÉEL du document après les deux passes — c'est lui qu'il faut lire pour
// vérifier ce qui a survécu, jamais seulement le texte d'un motif de trace.
function diagnostiquer(document) {
  const r = cp.spawnSync(PYTHON, [MANUSCRIT_MODELE, '--diagnostic'], {
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
// Lit un .docx RÉEL (manuscrit_docx.lire()) et lui applique classer_titres() — pour le
// contrôle 10 ci-dessous, qui doit s'exercer sur le corpus réel et non sur une fixture
// synthétique (§5.1, correction de Robin du 18.09.2026 : « sur 1_Résumé-article-revue-
// CSPS.docx (corpus réel), l'adoption ne promeut pas le corps du document »). Petit script
// autonome plutôt qu'un nouveau mode CLI de manuscrit_docx.py (patron déjà suivi par
// encodage-sorties.test.js pour ne pas toucher aux deux fichiers de ce chantier).
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
  const r = cp.spawnSync(PYTHON, ['-c', CLASSER_SUR_FICHIER.join('\n'), path.join(RACINE, 'pipeline'), chemin],
    { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'lecture/classement du fichier réel a échoué : ' + r.stderr);
  return JSON.parse(r.stdout.trim());
}

// ---------------------------------------------------------------------------------------
// 1. Le H2 posé sur trois paragraphes : un titre court stylé, suivi de trois paragraphes
// longs, également stylés, mais en petite taille et sans gras — le cas d'ouverture du
// chantier. Attendu : un seul titre, les trois autres au corps, chacun tracé avec sa
// signature et sa longueur (la nouvelle conception ne parle plus de « suite »).

test('classer_titres : H2 posé sur trois paragraphes -> un titre, trois corps, chacun tracé',
  { skip: sansPython }, () => {
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
// 2. Un intertitre LONG (19 mots) mais à la signature des autres titres du document (gras,
// taille distincte) n'est PAS rétrogradé — contrairement à l'ancienne conception, qui
// détruisait sur le corpus réel des intertitres de 13, 17 et 19 mots au seul motif de leur
// nombre de mots. C'est un des trois chiffres du critère d'acceptation de cette refonte.

test('classer_titres : intertitre de 19 mots, à la signature des titres -> pas rétrogradé',
  { skip: sansPython }, () => {
    const dixNeufMots = Array.from({ length: 18 }, (_, i) => 'mot' + (i + 1)).join(' ') + ' final';
    const doc = {
      styles: ['heading 1', 'heading 2'],
      blocs: [
        para(0, 'Titre principal de niveau un', { style: 'heading 1', niveauDeclare: 1, gras: true, taille: 28 }),
        para(1, dixNeufMots, { style: 'heading 2', niveauDeclare: 2, gras: true, taille: 24 }),
        // Corps délibérément COURT (35-40 signes) : le titre de 19 mots (~100 signes) est
        // donc plus long que le corps lui-même, et échoue le critère de longueur relative
        // (RATIO_RETROGRADATION_MIN=1, « pas même plus court que le corps »). S'il survit
        // malgré tout, c'est UNIQUEMENT parce que sa signature (gras, 24) diffère de celle du
        // corps — exactement ce que ce contrôle doit prouver, sans un filet de longueur qui
        // le sauverait de toute façon.
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
// 3. Zéro faux positif : un document proprement stylé (heading 1, heading 2, corps) ressort
// STRICTEMENT INCHANGÉ. C'est le contrôle le plus important de tous.

test('classer_titres : document déjà bien stylé -> aucun niveau_retenu ne diffère de niveau_declare',
  { skip: sansPython }, () => {
    const doc = {
      styles: ['heading 1', 'heading 2'],
      blocs: [
        para(0, 'Introduction', { style: 'heading 1', niveauDeclare: 1, gras: true, taille: 28 }),
        para(1, 'Contexte historique', { style: 'heading 2', niveauDeclare: 2, gras: true, taille: 24 }),
        para(2, 'Un paragraphe de corps parfaitement ordinaire qui developpe le contexte '
          + 'sur plusieurs lignes sans jamais ressembler a un titre quelconque.', { taille: 20 }),
        // Paragraphe de corps AU BORD du seuil de promotion, exprès : court (5 mots), à la
        // MÊME taille que le corps (20) — sa signature est donc, par construction, identique
        // à la signature dominante du corps : aucun groupe ne peut jamais le retenir, quel
        // que soit le réglage des seuils de longueur relative. Sans ce paragraphe, un défaut
        // qui promouvrait « tout candidat court » resterait invisible à ce test.
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
// 3bis. Un paragraphe déclaré titre, isolé (aucun autre du même style), dont la signature
// est celle du corps ET dont la longueur ne tient plus dans celle d'un titre de ce document,
// est rétrogradé — quel que soit le fait qu'il soit seul de son style. Remplace le contrôle
// « garde-fou 1 » de l'ancienne conception : il n'existe plus de notion de suite du tout, le
// jugement est individuel dès la passe 4.

test('classer_titres : paragraphe stylé isolé, signature du corps, trop long -> rétrogradé',
  { skip: sansPython }, () => {
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
// 4. Déduction complète : aucun style de titre, hiérarchie seulement en gras et en corps 14
// sur corps 10. Les titres doivent être retrouvés par la seule mise en forme.

test('classer_titres : aucun style de titre -> déduction par gras et par taille (14 sur 10)',
  { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        // Plusieurs paragraphes de corps, exprès : avec seulement deux (comme dans une
        // première version de ce test), la médiane du corps se calcule sur un échantillon
        // trop petit — les deux titres courts (2-3 mots) la faussent en y entrant eux-mêmes,
        // et aucun ne ressort plus assez « court relativement au corps » pour qualifier.
        // Mesuré : il faut une masse de corps représentative pour que le critère relatif
        // (§5.1 passe 3) se comporte comme sur un vrai document.
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
// 5. Ce qui survit au nettoyage : italique, exposant et lien traversent intacts,
// alors que police, taille et couleur du même paragraphe disparaissent. Contrôle inchangé :
// il porte sur nettoyer_mise_en_forme(), que cette refonte ne touche pas.

test('nettoyer_mise_en_forme : italique, exposant et lien survivent, police/taille/couleur partent',
  { skip: sansPython }, () => {
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
    // Le paragraphe est le SEUL candidat du document (voir le contrôle 6) : sa signature
    // vaut donc trivialement celle du corps, jamais promu — ce qui garantit qu'on teste bien
    // le retrait « corps » (gras/souligné compris s'il y en avait).
    assert.strictEqual(trouver(titres.trace, 0).niveau_retenu, 0);

    const ligne = trouver(formatage.trace, 0);
    assert.strictEqual(ligne.decision, 'nettoye');
    assert.match(ligne.motif, /police/);
    assert.match(ligne.motif, /taille/);
    assert.match(ligne.motif, /couleur/);

    // Ce que le motif RACONTE ne prouve rien : on relit l'état réel des fragments après
    // nettoyage (`document`, rendu par le mode --diagnostic). C'est ce contrôle-là qui manquait
    // — sans lui, un sabotage qui détruit l'italique laissait ce test vert (constaté et rejoué,
    // voir le rapport de chantier).
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
// 5bis. Ajouté le 19.09.2026 (revue de chantier, §5.2 du contrat) — nettoyer_mise_en_forme()
// ne bouclait QUE sur document.blocs (premier niveau) : un paragraphe DANS une cellule de
// tableau gardait taille/police/couleur/gras (171 paragraphes de ce genre, mesurés sur le
// corpus réel). Elle descend maintenant à toute profondeur de cellule.
//
// Sabotage minimal : dans nettoyer_mise_en_forme(), remplacer
// `paragraphes_a_nettoyer = list(_paragraphes_en_profondeur(document.blocs))` par
// `paragraphes_a_nettoyer = [b for b in document.blocs if isinstance(b, Paragraphe)]`
// (l'ancien comportement, premier niveau seulement) — l'assertion sur la cellule rougit.

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

// La trace d'un paragraphe de cellule porte un `.source` LOCAL à sa cellule (0, 1, …) : deux
// cellules distinctes d'un même tableau produisent donc chacune un « paragraphe 0 », jamais
// ancrable et impossible à distinguer dans le rapport HTML (mesuré : 5 lignes « paragraphe 0 »
// sur 3_VF_Chanier-Delorme_Article CSPS_290626.docx, toutes en cellule). Décision : la trace
// porte le `.source` du TABLEAU porteur, avec `dans_tableau: true`.
//
// Sabotage minimal : dans _nettoyer_paragraphe(), remplacer
// `source = source_tableau if source_tableau is not None else paragraphe.source` par
// `source = paragraphe.source` (revient à la position locale) — les deux assertions sur
// `ligne.source`/`ligne.dans_tableau` rougissent (les deux paragraphes de cellule rendent
// `0` au lieu de `1`, la source du tableau).

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

// Même défaut, côté notes (document.notes, devenu un dict{id: [bloc, ...]} le 19.09.2026).
//
// Sabotage minimal : dans nettoyer_mise_en_forme(), retirer la boucle
// `for blocs_note in document.notes.values(): paragraphes_a_nettoyer.extend(...)` — l'assertion
// sur le fragment de note rougit.

test('nettoyer_mise_en_forme : descend aussi dans document.notes',
  { skip: sansPython }, () => {
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
// 5ter. Décision du superviseur (révision du 19.09.2026, §5.2) : « signalé sans être touché »
// était violé pour le gras — un paragraphe de corps ENTIÈREMENT gras et non retenu comme titre
// voyait son gras RETIRÉ dans la même passe qui le SIGNALE (mesuré : 16 paragraphes sur
// 3bis_CSPS_Revue3_2026_FLOW_Piloting_OFP.docx). Le gras intégral est désormais CONSERVÉ (une
// relectrice doit pouvoir le voir), le signalement reste dans le rapport. Le gras PARTIEL du
// corps, lui, part normalement — seul l'intégral déclenche l'exception.
//
// Sabotage minimal : dans _nettoyer_fragments(), remplacer `champs_corps_seul = (...)` par
// `champs_corps_seul = FORME_RETIREE_CORPS_SEUL` (toujours retirer, jamais l'exception) —
// l'assertion sur le gras intégral conservé rougit.

test('nettoyer_mise_en_forme : le gras intégral d\'un paragraphe de corps non retenu comme titre est CONSERVÉ, signalé',
  { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Un paragraphe de corps assez long pour etablir la taille dominante du '
          + 'document, largement suffisant pour ce test ici present.', { taille: 20 }),
        // Entièrement gras, mais assez long et sans autre signal : ne sera pas retenu comme
        // titre (signature = corps une fois le gras ignoré par la comparaison des tailles).
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

// Le gras PARTIEL du corps, lui, part normalement — sans quoi l'exception ci-dessus serait
// devenue un blanc-seing qui protège n'importe quel gras, même un simple mot en gras au milieu
// d'une phrase de corps (jamais l'intention du §5.2).
//
// Sabotage minimal : dans _nettoyer_fragments(), calculer `gras_integral` avec `any(...)` au
// lieu de `all(...)` — un seul fragment gras suffirait à déclencher l'exception, le gras
// partiel de ce contrôle survivrait aussi (rougit).

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
// 5quater. Défaut n°8c de l'en-tête de manuscrit_docx.py : tant que le lecteur rendait '\t'/
// '\n' comme une simple espace, cette logique de _nettoyer_paragraphe() ne pouvait JAMAIS se
// déclencher — du code mort. Depuis le 19.09.2026, le lecteur porte les vrais caractères ;
// ce contrôle prouve que le NETTOYAGE, lui, fonctionnait déjà et fonctionne toujours une fois
// exercé pour de vrai.
//
// Sabotage minimal : dans _nettoyer_paragraphe(), commenter les deux blocs `if
// dernier.texte.endswith('\n')` et `if premier.texte.startswith('\t')` — les deux assertions
// ci-dessous rougissent (le \t et le \n restent en place).

test('nettoyer_mise_en_forme : une tabulation en tête et un saut de ligne en fin de paragraphe sont réellement retirés',
  { skip: sansPython }, () => {
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
// 6. Le cas limite qui doit NE RIEN faire : un document d'UN SEUL paragraphe, 11 mots, sans
// gras, à une taille quelconque, sans style. Étant l'unique candidat du document, sa
// signature est PAR CONSTRUCTION celle du corps (il EST le corps) : aucun groupe ne peut le
// distinguer de lui-même. Un faux titre est pire qu'un titre manqué.

test('classer_titres : paragraphe unique de 11 mots, sans style -> pas promu',
  { skip: sansPython }, () => {
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
// 7. Un document dont les titres sont SEULEMENT en italique (aucune taille distincte, aucun
// gras) voit ses titres retrouvés — le cas qui a motivé toute cette refonte (§5.1 : l'article
// 3_VF_Chanier-Delorme a ses titres de niveau 2 en italique, presque sans changement de
// taille ; l'ancienne conception, qui ne regardait que le gras et la taille, n'en voyait
// aucun).

test('classer_titres : titres en italique seul (aucune taille ni gras) -> retrouvés',
  { skip: sansPython }, () => {
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
    // Trois promotions au total : le titre gras (niveau 1) et les deux sous-titres en
    // italique (niveau 2) — c'est bien l'italique SEUL, sans aucune taille ni gras propres,
    // qui est ici sous test (para2/para5) ; le titre gras n'est là que pour donner au
    // document une hiérarchie à deux niveaux plausible (§5.1 passe 2, bornes MIN/MAX_TITRES).
    assert.strictEqual(titres.stats.promus, 3);
  });

// ---------------------------------------------------------------------------------------
// 8. Un entretien hors gabarit (aucun style SZH, questions simplement en gras — la passe 1
// ne le voit pas). Arbitrage de Robin du 18.09.2026, pendant ce chantier : « c'est OK si les
// questions sont détectées comme H2, on fera avec » — le contrôle vérifie donc que les
// questions forment UN SEUL niveau cohérent (pas éparpillées sur deux ou trois), et que le
// rapport SIGNALE le nombre inhabituel plutôt que de le taire.

test('classer_titres : entretien hors gabarit -> questions promues à UN SEUL niveau, signalé',
  { skip: sansPython }, () => {
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
// 9. La bibliographie n'est jamais promue — reconnue par TITRES_BIB de szh-citations.lua
// (« Références » y figure). Les entrées, courtes et homogènes, formeraient un groupe très
// convaincant pour la passe 3 : la passe 1 les exclut explicitement.

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
    // Le titre de la rubrique elle-même (« Références », source=2) N'EST PAS dans l'étendue
    // exclue (§5.1 : « ne peuvent jamais devenir un titre par déduction » vise les ENTRÉES,
    // jamais la rubrique qui les introduit) : il reste un candidat ordinaire, court et à la
    // signature distincte du corps, donc légitimement promu — seul le danger réel (les
    // entrées) est neutralisé.
    const rubrique = trouver(titres.trace, 2);
    assert.strictEqual(rubrique.decision, 'promue',
      'la rubrique « Références » elle-même reste un candidat ordinaire, hors étendue exclue');
    assert.strictEqual(titres.stats.promus, 1, 'seule la rubrique est promue, aucune entrée');
  });

// ---------------------------------------------------------------------------------------
// 10. Quand rien ne convainc : aucun style, aucune mise en forme distinctive — rien n'est
// promu, et un constat le dit explicitement dans la trace (§5.1 : « en cas de doute : rien,
// et on le dit »).

test('classer_titres : rien ne convainc -> rien promu, et un constat le dit',
  { skip: sansPython }, () => {
    const doc = {
      styles: [],
      blocs: [
        para(0, 'Un paragraphe de corps assez long pour etablir la taille dominante '
          + 'coherente sur ce document teste ici pour de bon.', { taille: 20 }),
        para(1, 'Encore un paragraphe de corps assez long pour etablir la meme taille '
          + 'dominante coherente sur ce document teste encore un peu.', { taille: 20 }),
        para(2, 'Toujours un paragraphe de corps assez long et banal, sans structure '
          + 'particuliere a signaler ici non plus vraiment.', { taille: 20 }),
        // Un groupe existe bel et bien (taille distincte du corps, assez court, trois
        // occurrences) mais les trois sont COLLÉES l'une à l'autre : le critère de
        // répartition (§5.1 : « pas toutes collées », SEUIL_DISPERSION_MIN) l'écarte. Sans
        // candidat du tout, la trace ne dirait rien de plus qu'un non_promue par paragraphe ;
        // AVEC un groupe qui ne suffit pas, elle doit dire explicitement qu'aucune structure
        // ne se dégage — c'est cette ligne-là que ce contrôle vérifie, pas seulement
        // l'absence de promotion.
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
    // « En cas de doute : rien, et on le dit » (§5.1) — le constat doit être EXPLICITE dans
    // la trace, jamais seulement déductible de l'absence de promotion.
    const constat = traceDocument(titres.trace, 'aucune_promotion_decelee');
    assert.strictEqual(constat.length, 1, 'un constat explicite doit figurer dans la trace');
    assert.match(constat[0].motif, /aucune structure de titres décelable/);
  });

// ---------------------------------------------------------------------------------------
// 11. La contrainte de trois niveaux : avec QUATRE groupes qualifiants distincts, jamais plus
// de trois NIVEAUX DISTINCTS ne sont créés — les lignes directrices plafonnent à MAX_NIVEAUX=3.
//
// ⚠ RÉVISION du 19.09.2026 (§5.1) : l'ancien comportement écartait purement et simplement le
// 4e groupe (« groupe_non_retenu », jamais promu — « l'article sort sans aucun titre » dans le
// cas dégénéré où aucun autre groupe n'existe). Rabattre l'excédent sur le niveau 3 plutôt que
// le rejeter : un article qui distingue plus de trois mises en forme de titre existe (glossaire,
// dossier à rubriques), et le perdre entièrement serait pire qu'un sur-classement au niveau le
// plus bas. Le 4e groupe (D, souligné, le plus bas dans l'ordre du §5.1) rejoint donc le
// niveau 3 du 3e groupe (C) — TOUJOURS AU PLUS trois niveaux distincts au total, jamais un
// compromis qui en inventerait un quatrième.
//
// ⚠ Le rejet EN BLOC (« promotion_rejetee_contrainte_niveaux », niveaux_finaux > MAX_NIVEAUX)
// reste un garde-fou distinct, structurellement INATTEIGNABLE avec les données d'aujourd'hui :
// niveaux_a_chercher est TOUJOURS un sous-ensemble de {1,2,3} (Paragraphe.niveau_declare ne
// connaît que ces trois valeurs), et le rabattage ci-dessus ne peut jamais inventer un niveau
// hors de {1,2,3} non plus (voir le commentaire de classer_titres()).

test('classer_titres : quatre groupes qualifiants -> jamais plus de trois NIVEAUX, le 4e rabattu sur le niveau 3',
  { skip: sansPython }, () => {
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
// 12. Passe 3 bis — ADOPTION. Correction de Robin du 18.09.2026, pendant ce chantier : un
// titre déclaré fournit la signature de référence de son niveau ; un paragraphe non stylé qui
// la porte est adopté à ce niveau — « typiquement quelqu'un balise 5 titres, le 6ème il le
// met juste italique + augmente la taille ». Cinq H2 déclarés en 12 pt italique, plus un
// sixième paragraphe SANS style en 12 pt italique : les six ressortent au niveau 2.

test('classer_titres : passe 3 bis, adoption -> le 6e paragraphe (12 pt italique, sans style) rejoint les 5 H2',
  { skip: sansPython }, () => {
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
// 12bis. Passe 3 bis — garde-fou de MAJORITÉ. « Cinq H2 avec cinq mises en forme différentes
// ne donnent AUCUNE référence, et on n'adopte rien » (Robin, 18.09.2026). Sans ce garde-fou,
// n'importe quelle mise en forme d'un seul titre déclaré ferait foi — en apparence anodin sur
// cinq titres, mais c'est très exactement le mécanisme qui, mal gardé, transformerait le cas
// d'ouverture du chantier (un vrai titre sur quatre déclarés) en fausse évidence.

test('classer_titres : passe 3 bis, aucune majorité -> aucune référence, rien adopté',
  { skip: sansPython }, () => {
    const blocs = [
      para(0, 'Titre H2 un', { style: 'heading 2', niveauDeclare: 2, gras: true, taille: 24 }),
      para(1, 'Titre H2 deux', { style: 'heading 2', niveauDeclare: 2, italique: true, taille: 22 }),
      para(2, 'Titre H2 trois', { style: 'heading 2', niveauDeclare: 2, souligne: true, taille: 20 }),
      para(3, 'Un paragraphe de corps assez long pour établir la taille dominante '
        + 'cohérente sur ce document testé ici pour de bon et sans ambiguïté aucune.', { taille: 18 }),
      // Ce candidat porte la signature du PREMIER H2 (gras, 24) : s'il était adopté à tort
      // (garde-fou de majorité absent), il rejoindrait le niveau 2 sans qu'aucune majorité
      // ne le justifie — un seul titre sur trois ne fait pas une référence.
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
// 12ter. Passe 3 bis — garde-fou « jamais la signature du corps ». Trois H2 courts, SANS
// AUCUNE mise en forme directe (ils survivent la passe 4 par leur LONGUEUR, pas par leur
// signature) : leur majorité vaut alors exactement celle du corps. Une référence adoptée
// là-dessus adopterait N'IMPORTE QUEL paragraphe de corps du document — le filet qui
// protège le cas d'ouverture du chantier si la rétrogradation avait laissé passer des faux
// titres à la signature du corps.

test('classer_titres : passe 3 bis, majorité = signature du corps -> aucune référence',
  { skip: sansPython }, () => {
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
// 13. Passe 3 bis — ORDRE. « 1. rétrograder d'abord ; 2. calculer la référence ensuite, sur
// les titres déclarés qui ont survécu ; 3. adopter enfin. » Ce n'est pas une préférence de
// style : sur 1_Résumé-article-revue-CSPS.docx (corpus réel), un Titre 2 est posé sur QUATRE
// paragraphes — un vrai titre et trois paragraphes de corps, ramenés à la taille du corps et
// dégraissés. Calculée AVANT rétrogradation, la signature majoritaire de ces quatre serait
// celle du CORPS (trois sur quatre) : on adopterait alors tout paragraphe du document portant
// la signature du corps, soit l'article entier promu en titre. Ce contrôle vérifie que ce
// n'est PAS ce qui se produit.

test('classer_titres : passe 3 bis sur corpus réel (1_Résumé) -> l\'adoption ne promeut pas le corps du document',
  { skip: sansPython }, (t) => {
    if (!fs.existsSync(CORPUS_LOT_A)) {
      t.skip('corpus hors dépôt absent : tmp/corpus-relecture/lot-A (hors git, effacé sans prévenir)');
      return;
    }
    const fichier = fs.readdirSync(CORPUS_LOT_A).find((n) => n.startsWith('1_') && n.endsWith('.docx'));
    if (!fichier) {
      t.skip('corpus hors dépôt absent : aucun fichier "1_*.docx" dans lot-A');
      return;
    }
    const { stats, n_titres_retenus: nTitres, n_paragraphes: nParagraphes } =
      classerSurFichier(path.join(CORPUS_LOT_A, fichier));

    // Le seuil n'est pas arbitraire : c'est la borne MAX_TITRES du §5.1 passe 2 elle-même
    // (mesurée sur 36 articles réels, maximum observé 21) — un résultat qui la dépasserait
    // serait déjà signalé par le mécanisme du contrôle 8, mais ICI on veut plus qu'un signal :
    // la preuve que rien ne s'est emballé au point de promouvoir le corps de l'article.
    assert.ok(nTitres <= 21,
      'le nombre de titres retenus (' + nTitres + '/' + nParagraphes + ') doit rester dans '
      + 'les bornes plausibles (§5.1 passe 2) : l\'adoption n\'a pas promu le corps du document');
    assert.ok(nTitres < nParagraphes * 0.5,
      'moins de la moitié des paragraphes du document ne doivent jamais devenir des titres');
    assert.strictEqual(stats.rejet_contrainte_niveaux, false);
  });

// =========================================================================================
// Reprise du 19.09.2026 — signatures effectives, titres en liste numérotée, nouvelles
// exclusions de la passe 1 et plafond de trois groupes rabattu. Voir le §5.1 du contrat,
// révision du 19.09.2026, pour la justification complète de chaque règle.
// =========================================================================================

// ---------------------------------------------------------------------------------------
// 14. Titres en liste numérotée — décision de Robin, §5.1. Un item de liste NUMÉROTÉE isolé
// (aucun voisin non vide de la même liste), gras, portant un numéro manuel en tête de texte,
// est promu titre : le numéro manuel est retiré du premier fragment (le gabarit numérote lui
// -même les Titre1), et la liste elle-même disparaît (`liste = None`) — mesuré sur « Le
// coenseignement développemental… », dont les quatre vrais titres de section sont ainsi faits.
//
// Sabotage minimal : dans _item_numerote_isole(), remplacer le corps de la fonction par
// `return False` — plus aucun item de liste n'est jamais candidat, ce contrôle rougit
// (source=1 reste `exclu_liste`, jamais `promue_liste`).

test('classer_titres : item de liste numérotée isolé, gras, avec numéro manuel -> promu, numéro retiré',
  { skip: sansPython }, () => {
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
// 15. Une suite de trois items numérotés consécutifs (ou plus) est une VRAIE liste, jamais des
// titres — chacun a, au moins d'un côté, un voisin non vide de la même liste (numId), donc
// aucun n'est isolé.
//
// Sabotage minimal : dans _voisin_non_vide(), faire `return None` immédiatement (aucun voisin
// jamais trouvé) — les trois items deviennent chacun « isolé » à tort, ce contrôle rougit.

test('classer_titres : trois items numérotés consécutifs -> jamais promus (vraie liste)',
  { skip: sansPython }, () => {
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
// 16. Une liste à PUCES n'est jamais candidate, isolée ou non — seule la numérotation porte,
// en pratique, l'ambiguïté « ceci est peut-être un titre » (§5.1).
//
// Sabotage minimal : dans _item_numerote_isole(), retirer la condition `p.liste[2] != 'numero'`
// (ne garder que `p.liste is None`) — une puce isolée devient candidate, ce contrôle rougit si
// elle porte en plus une signature de titre (gras).

test('classer_titres : item de liste À PUCES isolé -> jamais promu, même gras',
  { skip: sansPython }, () => {
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
// 17. Un séparateur visuel (une ligne de tirets, sans aucune lettre) n'est jamais un titre,
// même gras et à une taille distincte du corps — mesuré sur `4_La méthode Flip Flap.docx` : 5
// lignes « ──────── » promues en Titre2/Titre3 avant cette exclusion.
//
// Sabotage minimal : dans _sans_aucune_lettre(), remplacer le corps par `return False` — la
// ligne de tirets redevient un candidat ordinaire, ce contrôle rougit (elle se retrouve seule
// candidate de sa signature, donc au corps... sauf si elle qualifie, auquel cas elle est
// promue : ici, isolée et distincte, elle qualifie et le contrôle rougit bel et bien).

test('classer_titres : une ligne de tirets (sans aucune lettre) -> jamais promue',
  { skip: sansPython }, () => {
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
// 18. Un paragraphe qui porte une adresse courriel n'est jamais un titre — un encadré de
// coordonnées, pas un intertitre, même mis en gras.
//
// Sabotage minimal : dans _porte_des_coordonnees(), remplacer le corps par `return False` —
// la ligne de coordonnées redevient candidate, ce contrôle rougit.

test('classer_titres : une ligne avec adresse courriel -> jamais promue',
  { skip: sansPython }, () => {
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
// 19. « Tableau 1 » (le lexique de légende RE_LEGENDE, importé de docx-titres.py) n'est jamais
// un titre — mesuré sur « Le coenseignement développemental… » : promu Titre3 avant cette
// exclusion.
//
// Sabotage minimal : commenter la branche `elif RE_LEGENDE.match(...)` dans
// _exclusions_passe1() — « Tableau 1 » redevient candidat, ce contrôle rougit.

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
// 20. Signatures EFFECTIVES (§5.1, révision du 19.09.2026) : un corps qui HÉRITE sa taille
// (« effectif » rempli par la cascade des styles, `forme` vide) et un faux titre qui la
// DÉCLARE directement (`forme` rempli, pas d'« effectif » propre — repli sur `forme`, même
// valeur) doivent être jugés à la MÊME taille effective — et donc, faute d'autre signal,
// rétrogradé par la longueur (BRIEF-REPRISE §6.2 : « corps sans taille déclarée » et « faux
// titre déclaré 12 pt » étaient jugés différents avant cette révision).
//
// Sabotage minimal : dans _valeur_effective(), remplacer le corps par
// `return fragment.forme.get(cle)` (ignorer `effectif`, repli sur la mise en forme DIRECTE
// seule, l'ancien comportement) — le corps (taille directe absente) et le faux titre (taille
// directe 24) redeviennent « distincts » sans même regarder la longueur, ce contrôle rougit
// (le faux titre reste conservé au lieu d'être rétrogradé).

function paragrapheAvecEffectif(source, texte, opts = {}) {
  const { style = '', niveauDeclare = 0, formeDirecte = {}, effectif = null } = opts;
  return { source, style, niveau_declare: niveauDeclare,
    fragments: [{ texte, forme: formeDirecte, effectif }], alignement: '', liste: null };
}

test('classer_titres : signature EFFECTIVE (corps hérite 12pt, faux titre le déclare) -> jugés identiques, rétrogradé par la longueur',
  { skip: sansPython }, () => {
    const corpsLong = (n) => 'Un paragraphe de corps assez long pour établir la taille '
      + 'dominante cohérente sur ce document testé ici pour de bon, numéro ' + n + '.';
    const doc = {
      styles: ['heading 2'],
      blocs: [
        // Corps : AUCUNE taille directe (`forme` vide), mais un « effectif » de 24 — simule
        // l'hérédité résolue par la cascade des styles (docDefaults/Normal).
        paragrapheAvecEffectif(0, corpsLong(1), { effectif: { taille: 24 } }),
        paragrapheAvecEffectif(1, corpsLong(2), { effectif: { taille: 24 } }),
        // Faux titre : un H2 DÉCLARÉ, sur un paragraphe de corps ordinaire (40 mots), avec une
        // taille DIRECTE de 24 (pas d'« effectif » propre : repli sur `forme`, même valeur que
        // le corps une fois résolue). Aucun gras, aucun italique, aucun autre signal direct.
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

// 20bis. Garde-fou INVERSE, sur le corpus 2-fabrique (§5.1) : un faux titre fabriqué par un
// simple remplacement de w:pStyle (AUCUN réglage direct, mais une signature EFFECTIVE qui
// prend celle de son style de titre, gras+grand) ne doit PAS être protégé pour cette seule
// raison — sans le garde-fou (exiger la distinction en DIRECT ET en effectif), la révision du
// test précédent romprait ce corpus-là (mesuré : 21/34 -> 5/34 avant ce garde-fou).
//
// Sabotage minimal : dans _passe4_retrogradation(), remplacer la condition
// `distinct_effectif and distinct_direct` par `distinct_effectif` seul (jamais exiger le
// direct) — ce contrôle rougit : le faux titre est conservé sans que la longueur soit même
// regardée.

test('classer_titres : signature distincte SEULEMENT en effectif (pStyle nu, aucun réglage direct) -> pas de conservation inconditionnelle',
  { skip: sansPython }, () => {
    const corpsLong = (n) => 'Un paragraphe de corps assez long pour établir la taille '
      + 'dominante cohérente sur ce document testé ici pour de bon, numéro ' + n + '.';
    const doc = {
      styles: ['heading 2'],
      blocs: [
        // Corps : aucune mise en forme directe NI effective déclarée (comme un vrai corps sans
        // aucun réglage propre).
        paragrapheAvecEffectif(0, corpsLong(1)),
        paragrapheAvecEffectif(1, corpsLong(2)),
        // Faux titre « 2-fabrique » : un H2 déclaré, sur 40 mots de corps, SANS AUCUN réglage
        // direct (`forme` vide, comme le corps) — mais dont l'« effectif » simule ce qu'une
        // vraie cascade de style « heading 2 » donnerait (gras, 28pt), parce qu'AUCUN réglage
        // direct ne vient le distinguer de son propre style.
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
// 21. Le plafond de trois groupes REJOINT le niveau 3 plutôt que d'être rejeté en bloc — voir
// aussi le contrôle 11 ci-dessus (mis à jour pour cette révision), qui exerce le même mécanisme
// avec quatre groupes. Ici, cinq groupes qualifiants : les deux excédentaires (D et E) doivent
// tous deux rejoindre le niveau 3, aucun n'est perdu.

test('classer_titres : cinq groupes qualifiants -> les deux excédentaires rejoignent tous deux le niveau 3',
  { skip: sansPython }, () => {
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
// 22. Le niveau « sinon l'ordre des signatures » des titres de liste numérotée (§5.1) groupe
// sur la signature TYPOGRAPHIQUE, sans l'alignement — mesuré sur « Le coenseignement
// développemental… » : ses quatre titres de section partagent gras/taille/police, mais deux
// sur quatre héritent un alignement justifié (« both ») que les deux autres n'ont pas ;
// grouper sur la signature complète les aurait à tort scindés en deux niveaux pour un
// attribut hérité incidemment.
//
// Sabotage minimal : dans _detecter_titres_liste(), remplacer
// `cle = _signature_typographique(sig)` par `cle = sig` (grouper sur la signature COMPLÈTE,
// alignement compris) — les deux candidats d'alignements différents se retrouvent sur deux
// niveaux distincts, ce contrôle rougit.

test('classer_titres : titres de liste numérotée, même gras/taille mais alignements différents -> même niveau',
  { skip: sansPython }, () => {
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
// 23. Reprise du 21.09.2026 — hiérarchie portée par le gras SEUL, avec des titres réels de
// longueurs très inégales (1 à 10 mots). Mesuré sur `3bis_CSPS_Revue3_2026_FLOW_Piloting_OFP`
// (LISEZMOI du corpus : « tout le document en style Normal 11 pt, 20 pseudo-titres, aucun
// changement de corps » — la hiérarchie n'est portée QUE par le gras) : le corps N'EST PAS
// gras (mesuré : 3/44 paragraphes longs seulement, contre une hypothèse initiale erronée de
// « corps globalement gras ») ; le vrai coupable était le critère d'homogénéité de longueurs
// de la passe 3, dont le plancher à 1 mot rejetait le seul groupe qualifiant (1 à 10 mots,
// dès qu'un titre à un seul mot — « Résumé », « Perspectives », « Références » — y figurait) :
// 1/17 pseudo-titres retrouvés avant cette révision.
//
// Sabotage minimal : dans _filtrer_groupes(), remplacer
// `SEUIL_HOMOGENEITE_MOTS * max(mn, PLANCHER_HOMOGENEITE_MOTS)` par
// `SEUIL_HOMOGENEITE_MOTS * max(mn, 1)` (l'ancien plancher) — le groupe entier redevient
// rejeté, ce contrôle rougit.

test('classer_titres : hiérarchie portée par le gras seul, titres de 1 à 10 mots -> un seul groupe, tous promus',
  { skip: sansPython }, () => {
    // Corps délibérément LONG (~300 signes chacun, proche des 274 signes médians mesurés sur
    // 3bis_CSPS_Revue3_2026_FLOW_Piloting_OFP) et en MAJORITÉ (7 paragraphes de corps pour 5
    // titres, comme un vrai document) : sans cette majorité, la MÉDIANE du corps se calcule à
    // cheval entre les titres courts et les paragraphes longs (piège déjà noté par le
    // contrôle 4 plus haut : « il faut une masse de corps représentative ») et le titre le
    // plus long du groupe (10 mots, 74 signes) échoue à tort le seuil relatif de la passe 3
    // (RATIO_LONGUEUR_TITRE=3) — mesuré : avec seulement 5 paragraphes de corps pour 5 titres,
    // la médiane tombe à 182,5 (entre 74 et 291) et exclut ce candidat AVANT même le critère
    // d'homogénéité que ce contrôle vise à exercer.
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
        // Les deux paragraphes de corps SUPPLÉMENTAIRES viennent AVANT « Références » — placés
        // après, ils tomberaient dans l'étendue de bibliographie que ce titre déclenche
        // (§5.1 : TITRES_BIB de szh-citations.lua), exclus de la médiane du corps comme le
        // fait, à raison, la passe 1 sur le vrai fichier.
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
