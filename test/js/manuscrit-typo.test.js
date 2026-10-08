// Pont typographique du nettoyeur de manuscrit (pipeline/manuscrit_typo.py), voir
// docs/ARCHITECTURE-nettoyeur-manuscrit.md. Le pont envoie le texte des paragraphes au
// filtre typographique par pandoc, puis réinjecte le résultat dans les fragments (runs Word)
// d'origine. Le filtre fait foi : le pont accepte ses ajouts et ses suppressions.
//
// manuscrit_typo.py accepte tout objet de la forme Fragment/Paragraphe : le harnais Python
// définit ses propres classes minimales, sans importer manuscrit_modele.py.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { python, sansPython, sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');

// Le harnais construit des Fragment/Paragraphe depuis une recette JSON, appelle
// normaliser_paragraphes() et écrit le résultat en JSON. Clés de la recette qui remplacent
// une partie du module avant l'appel :
//   - `sortie_sabotee` : _appeler_pandoc rend exactement ce texte, sans lancer pandoc ;
//   - `sans_pandoc` : le lancement de pandoc lève FileNotFoundError (repli) ;
//   - `appel_direct` : appelle _reconstruire_unite() sans pandoc, pour éprouver les gardes
//     d'entrée et de sortie ; `opcodes_bogues` y remplace difflib.SequenceMatcher par une
//     doublure qui rend des opcodes incomplets.
const HARNAIS = [
  'import json, os, sys',
  'racine, chemin_entree, chemin_sortie = sys.argv[1], sys.argv[2], sys.argv[3]',
  "sys.path.insert(0, os.path.join(racine, 'pipeline'))",
  'import manuscrit_typo as MT',
  '',
  'class Fragment:',
  "    __slots__ = ('texte', 'image', 'forme', 'lien', 'source', 'note')",
  '    # `note` SANS valeur par défaut, comme les cinq champs précédents : un appelant qui',
  '    # omettrait de le fournir explicitement doit planter ici, jamais retomber en silence',
  '    # sur une valeur par défaut qui masquerait l’oubli (contrairement à la vraie classe',
  '    # Fragment, qui accepte note=None — voir le rapport de chantier du 19.09.2026).',
  '    def __init__(self, texte, image, forme, lien, source, note):',
  '        self.texte, self.image, self.forme = texte, image, forme',
  '        self.lien, self.source, self.note = lien, source, note',
  '',
  'class Paragraphe:',
  "    __slots__ = ('style', 'niveau_declare', 'niveau_retenu', 'fragments', 'liste',",
  "                 'alignement', 'retrait', 'source')",
  '    def __init__(self, style, niveau_declare, niveau_retenu, fragments, liste,',
  '                 alignement, retrait, source):',
  '        self.style, self.niveau_declare, self.niveau_retenu = style, niveau_declare, niveau_retenu',
  '        self.fragments, self.liste = fragments, liste',
  '        self.alignement, self.retrait, self.source = alignement, retrait, source',
  '',
  "recette = json.load(open(chemin_entree, encoding='utf-8'))",
  '',
  "if recette.get('appel_direct'):",
  "    ad = recette['appel_direct']",
  "    if ad.get('opcodes_bogues') is not None:",
  '        class _FauxMatcher:',
  '            def __init__(self, *a, **k):',
  '                pass',
  '            def get_opcodes(self):',
  "                return [tuple(o) for o in ad['opcodes_bogues']]",
  '        MT.difflib.SequenceMatcher = _FauxMatcher',
  "    frags = [Fragment(t, None, None, None, i, None) for i, t in enumerate(ad['fragments'])]",
  '    try:',
  "        resultat = MT._reconstruire_unite(frags, ad['texte_envoye'], ad['texte_normalise'])",
  "        sortie = {'ok': True, 'texte': ''.join(f.texte for f in resultat)}",
  '    except MT._EchecReconstruction as e:',
  "        sortie = {'ok': False, 'motif': str(e)}",
  "    json.dump(sortie, open(chemin_sortie, 'w', encoding='utf-8'), ensure_ascii=False)",
  "    print('OK')",
  '    sys.exit(0)',
  '',
  "if recette.get('sortie_sabotee') is not None:",
  '    # Point d’injection à contrôle EXACT, caractère par caractère : renvoie précisément le',
  '    # texte fourni par la recette, plutôt qu’une altération générique — c’est ce qui permet',
  '    # de simuler n’importe quelle correction du filtre, y compris une lettre supprimée.',
  '    _fixe = recette[\'sortie_sabotee\']',
  '    def _appel_fixe(textes, langue, racine_depot):',
  '        return list(_fixe), []',
  '    MT._appeler_pandoc = _appel_fixe',
  '',
  "if recette.get('sans_pandoc'):",
  '    def _introuvable(*a, **k):',
  "        raise FileNotFoundError('pandoc')",
  '    MT.subprocess.run = _introuvable',
  '',
  'paragraphes = []',
  "for p in recette['paragraphes']:",
  '    fragments = [Fragment(f[\'texte\'], None, f.get(\'forme\'), f.get(\'lien\'), i,',
  "                          f.get('note'))",
  "                 for i, f in enumerate(p['fragments'])]",
  "    paragraphes.append(Paragraphe(p.get('style', ''), p.get('niveau_declare', 0),",
  "                                   p.get('niveau_retenu', 0), fragments, p.get('liste'),",
  "                                   p.get('alignement', ''), p.get('retrait', 0),",
  "                                   p.get('source', 0)))",
  '',
  'resultat, traces, abandons, avertissements, statut = MT.normaliser_paragraphes(',
  "    paragraphes, recette['langue'], racine)",
  '',
  'sortie = {',
  "    'traces': traces, 'abandons': abandons, 'avertissements': avertissements,",
  "    'statut': statut,",
  "    'paragraphes': [",
  "        {'source': p.source,",
  "         'fragments': [{'texte': f.texte, 'forme': f.forme, 'lien': f.lien, 'note': f.note}",
  '                       for f in p.fragments]}',
  '        for p in resultat',
  '    ],',
  '}',
  "json.dump(sortie, open(chemin_sortie, 'w', encoding='utf-8'), ensure_ascii=False)",
  "print('OK')"
].join('\n') + '\n';

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-manuscrittypo-'));
}

function lancerHarnais(recette) {
  const dossier = dossierJetable();
  try {
    const fHarnais = path.join(dossier, 'harnais.py');
    const fEntree = path.join(dossier, 'entree.json');
    const fSortie = path.join(dossier, 'sortie.json');
    fs.writeFileSync(fHarnais, HARNAIS, 'utf8');
    fs.writeFileSync(fEntree, JSON.stringify(recette), 'utf8');
    const r = python([fHarnais, RACINE, fEntree, fSortie], { timeout: 120000 });
    assert.strictEqual(r.status, 0,
      'harnais Python sorti en ' + r.status + ' : ' + r.stderr + ' / ' + r.stdout);
    return JSON.parse(fs.readFileSync(fSortie, 'utf8'));
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

// `recette.paragraphes[].fragments[]` est une liste de { texte, forme }.
function normaliser(recette) {
  return lancerHarnais(recette);
}

// Rend { ok, texte } ou { ok: false, motif }.
function appelDirect(appelDirectRecette) {
  return lancerHarnais({ appel_direct: appelDirectRecette });
}

function texteAPlat(paragraphe) {
  return paragraphe.fragments.map((f) => f.texte).join('');
}

test('manuscrit-typo : un run coupé au milieu du mot « important » ne perd aucun caractère',
  { skip: sansPython || sansPandocWsl }, () => {
    const sortie = normaliser({
      langue: 'fr',
      paragraphes: [{
        source: 0,
        fragments: [
          // « important » coupé en trois runs Word, dont le second commence en plein mot.
          { texte: 'Voici \u201Cimpor', forme: { italique: false } },
          { texte: 'tant\u201D ', forme: { italique: false } },
          { texte: 'vraiment.', forme: { italique: false } }
        ]
      }]
    });
    assert.deepStrictEqual(sortie.abandons, [], 'le paragraphe a été abandonné : ' + JSON.stringify(sortie.abandons));
    assert.strictEqual(sortie.statut, 'appliquee');
    const texte = texteAPlat(sortie.paragraphes[0]);
    assert.match(texte, /important/, 'le mot « important » n\u2019a pas survécu intact à la coupure de run');
    assert.match(texte, /^Voici/, 'le début du paragraphe a été perdu');
    assert.match(texte, /vraiment\.$/, 'la fin du paragraphe a été perdue');
    // Sans les signes que la typographie peut poser ou retirer, le texte est identique à
    // l'original.
    const TYPO = /[\s\u00a0\u202f\u2018\u2019\u201c\u201d\u00ab\u00bb\u2039\u203a"'`\u2013\u2014\-]/g;
    const origine = 'Voici \u201Cimpor' + 'tant\u201D ' + 'vraiment.';
    assert.strictEqual(texte.replace(TYPO, ''), origine.replace(TYPO, ''),
      'du contenu non typographique a changé pendant la réinjection');
  });

test('manuscrit-typo : un mot en italique reste en italique malgré les insécables insérées',
  { skip: sansPython || sansPandocWsl }, () => {
    const sortie = normaliser({
      langue: 'fr',
      paragraphes: [{
        source: 0,
        fragments: [
          { texte: 'Voici ', forme: { italique: false } },
          { texte: '\u201Cterme\u201D', forme: { italique: true } },
          { texte: ' est technique.', forme: { italique: false } }
        ]
      }]
    });
    assert.deepStrictEqual(sortie.abandons, []);
    const frags = sortie.paragraphes[0].fragments;
    // Toutes les lettres de « terme » restent dans des fragments en italique.
    const italiques = frags.filter((f) => f.forme && f.forme.italique === true);
    const texteItalique = italiques.map((f) => f.texte).join('');
    assert.match(texteItalique, /terme/, 'le mot « terme » n\u2019est plus regroupé sous un fragment italique');
    for (const f of frags) {
      if (!(f.forme && f.forme.italique === true)) {
        assert.doesNotMatch(f.texte, /term/,
          'une partie de « terme » est sortie hors de son fragment italique : ' + JSON.stringify(f));
      }
    }
    // Le filtre a bien modifié le texte : au moins une insécable a été posée.
    const texte = texteAPlat(sortie.paragraphes[0]);
    assert.match(texte, /[\u00a0\u202f]/, 'aucune insécable posée : le filtre n\u2019a rien changé');
  });

// Un ajout, même non typographique (« X »), est rattaché au fragment de gauche.
test('manuscrit-typo : un caractère ajouté par le filtre est accepté sans abandon, hérite du fragment voisin',
  { skip: sansPython }, () => {
    const original = 'Un texte tout simple.';
    const sortie = normaliser({
      langue: 'fr',
      sortie_sabotee: [original + 'X'],
      paragraphes: [{
        source: 5,
        fragments: [{ texte: original, forme: { italique: false } }]
      }]
    });
    assert.deepStrictEqual(sortie.abandons, [],
      'un ajout de caractère a été abandonné à tort : ' + JSON.stringify(sortie.abandons));
    assert.strictEqual(texteAPlat(sortie.paragraphes[0]), original + 'X',
      'le caractère ajouté par le filtre doit être conservé tel quel');
  });

test('manuscrit-typo : sans pandoc joignable, le repli est signalé et les paragraphes ressortent inchangés',
  { skip: sansPython }, () => {
    const original = 'Un texte tout simple.';
    const sortie = normaliser({
      langue: 'fr',
      sans_pandoc: true,
      paragraphes: [{
        source: 7,
        fragments: [{ texte: original, forme: { italique: false } }]
      }]
    });
    assert.deepStrictEqual(sortie.abandons, [],
      'un repli sans outillage n\u2019est pas un abandon de paragraphe');
    assert.strictEqual(sortie.statut, 'repli',
      'le statut doit dire "repli", pas seulement une trace enfouie');
    assert.ok(sortie.traces.some((t) => /repli|indisponible/i.test(t)),
      'aucune trace n\u2019explique le repli : ' + JSON.stringify(sortie.traces));
    assert.deepStrictEqual(sortie.avertissements, [],
      'aucun avertissement typo ne peut venir d\u2019un appel qui n\u2019a jamais eu lieu');
    assert.strictEqual(texteAPlat(sortie.paragraphes[0]), original,
      'le paragraphe a été modifié malgré l\u2019absence de pandoc');
  });

// Vérifie que la langue (`-M lang=`) arrive jusqu'au filtre.
test('manuscrit-typo : la même phrase en fr et en de donne deux espacements différents',
  { skip: sansPython || sansPandocWsl }, () => {
    const phrase = 'Attention : ceci compte vraiment.';
    const fabriquer = (langue) => normaliser({
      langue,
      paragraphes: [{ source: 0, fragments: [{ texte: phrase, forme: { italique: false } }] }]
    });
    const fr = fabriquer('fr');
    const de = fabriquer('de');
    assert.deepStrictEqual(fr.abandons, []);
    assert.deepStrictEqual(de.abandons, []);
    const texteFr = texteAPlat(fr.paragraphes[0]);
    const texteDe = texteAPlat(de.paragraphes[0]);
    assert.notStrictEqual(texteFr, texteDe,
      'fr et de rendent le même espacement : -M lang= n\u2019est probablement plus transmis au filtre');
    // Le français insécable devant ':' (haute ponctuation), l'allemand suisse colle.
    assert.match(texteFr, /Attention[\u00a0\u202f]:/, 'le français ne pose pas d\u2019insécable devant « : »');
    assert.doesNotMatch(texteDe, /Attention[\u00a0\u202f]:/, 'l\u2019allemand pose une insécable qu\u2019il ne devrait pas poser');
  });

// Le filtre corrige parfois du contenu (3ème -> 3e) : le pont ne rejuge pas ses
// suppressions. pandoc est simulé ; le « s » de « simple » disparaît.
test('manuscrit-typo : une lettre supprimée par le filtre n\u2019est plus un motif d\u2019abandon (le filtre a raison)',
  { skip: sansPython }, () => {
    const original = 'Un texte simple.';
    const sortie = normaliser({
      langue: 'fr',
      sortie_sabotee: ['Un texte imple.'],   // le 's' de "simple" a disparu, non remplacé
      paragraphes: [{
        source: 9,
        fragments: [{ texte: original, forme: { italique: false } }]
      }]
    });
    assert.deepStrictEqual(sortie.abandons, [],
      'une lettre supprimée par le filtre ne doit plus provoquer d\u2019abandon : '
      + JSON.stringify(sortie));
    assert.strictEqual(texteAPlat(sortie.paragraphes[0]), 'Un texte imple.',
      'le pont doit faire confiance au filtre, pas rendre le texte d\u2019origine');
  });

test('manuscrit-typo : un ecart purement typographique (apostrophe, chevrons) n\u2019abandonne rien',
  { skip: sansPython }, () => {
    const original = "C'est le \"terme\" exact.";
    const sortie = normaliser({
      langue: 'fr',
      sortie_sabotee: ['C\u2019est le \u00abterme\u00bb exact.'],
      paragraphes: [{
        source: 11,
        fragments: [{ texte: original, forme: { italique: false } }]
      }]
    });
    assert.deepStrictEqual(sortie.abandons, [],
      'un ecart purement typographique a ete abandonne a tort : ' + JSON.stringify(sortie.abandons));
    assert.strictEqual(texteAPlat(sortie.paragraphes[0]), 'C\u2019est le \u00abterme\u00bb exact.',
      'la normalisation purement typographique n\u2019a pas ete acceptee telle quelle');
  });

// Quatre corrections rencontrées sur des manuscrits réels.
test('manuscrit-typo : les quatre corrections mesurées sur lot-A (A->À, 3ème->3e, espace fine, apostrophe->chevron) ne sont plus abandonnées',
  { skip: sansPython }, () => {
    const cas = [
      { original: 'A la suite de cet essai.', sabote: '\u00c0 la suite de cet essai.' },
      { original: 'Voir le 3ème exemple.', sabote: 'Voir le 3e exemple.' },
      { original: 'Un texte\u2009espace fine.', sabote: 'Un texte\u202fespace fine.' },
      // Citation de premier niveau : le filtre rend des chevrons doubles (r\u00e8gle A2/A3,
      // docs/TYPOGRAPHIE-FR.md). La valeur simul\u00e9e reproduit une sortie correcte du filtre.
      { original: 'Il a dit \u2018bonjour\u2019 gentiment.', sabote: 'Il a dit \u00ab\u00a0bonjour\u00a0\u00bb gentiment.' }
    ];
    for (const { original, sabote } of cas) {
      const sortie = normaliser({
        langue: 'fr',
        sortie_sabotee: [sabote],
        paragraphes: [{ source: 3, fragments: [{ texte: original, forme: { italique: false } }] }]
      });
      assert.deepStrictEqual(sortie.abandons, [],
        'abandonné à tort pour ' + JSON.stringify({ original, sabote }) + ' : '
        + JSON.stringify(sortie.abandons));
      assert.strictEqual(texteAPlat(sortie.paragraphes[0]), sabote,
        'le texte corrigé par le filtre doit être repris tel quel pour ' + JSON.stringify({ original, sabote }));
    }
  });

test('manuscrit-typo : la garde d\u2019entrée abandonne si le texte des fragments a divergé de celui envoyé au filtre',
  { skip: sansPython }, () => {
    const sortie = appelDirect({
      fragments: ['Un texte simple.'],
      texte_envoye: 'Un texte AUTRE CHOSE.',   // ne correspond plus a la concatenation des fragments
      texte_normalise: 'Un texte simple.'
    });
    assert.strictEqual(sortie.ok, false, 'la divergence d\u2019entrée aurait dû abandonner');
    assert.match(sortie.motif, /texte des fragments/,
      'le motif ne cite pas la garde d\u2019entrée : ' + sortie.motif);
  });

test('manuscrit-typo : la garde d\u2019entrée ne se déclenche PAS quand rien n\u2019a divergé',
  { skip: sansPython }, () => {
    const sortie = appelDirect({
      fragments: ['Un texte simple.'],
      texte_envoye: 'Un texte simple.',
      texte_normalise: 'Un texte corrigé.'
    });
    assert.strictEqual(sortie.ok, true, 'un appel cohérent ne doit pas être abandonné : ' + JSON.stringify(sortie));
    assert.strictEqual(sortie.texte, 'Un texte corrigé.');
  });

// La garde de sortie vérifie que la reconstruction reproduit exactement le texte du filtre.
// Les opcodes de difflib couvrent toujours tout le texte : seul un diff truqué l'atteint.
test('manuscrit-typo : la garde de sortie abandonne si le diff (sabote) ne couvre pas tout le texte normalisé',
  { skip: sansPython }, () => {
    const sortie = appelDirect({
      fragments: ['abc'],
      texte_envoye: 'abc',
      texte_normalise: 'abcd',
      // Opcodes tronqués : le 'd' final n'est pas couvert.
      opcodes_bogues: [['equal', 0, 3, 0, 3]]
    });
    assert.strictEqual(sortie.ok, false, 'une reconstruction incomplète aurait dû abandonner');
    assert.match(sortie.motif, /reconstruction/,
      'le motif ne cite pas la garde de sortie : ' + sortie.motif);
  });

// _appeler_pandoc() lit stderr aussi quand pandoc réussit.
test('manuscrit-typo : les avertissements [typo-avertissement] d\u2019un appel réussi remontent désormais',
  { skip: sansPython || sansPandocWsl }, () => {
    const sortie = normaliser({
      langue: 'fr',
      paragraphes: [{
        source: 0,
        // Guillemet droit non apparié : le filtre le signale (C2) sans le corriger.
        fragments: [{ texte: 'Il a dit "bonjour sans jamais refermer.', forme: { italique: false } }]
      }]
    });
    assert.strictEqual(sortie.statut, 'appliquee');
    assert.ok(sortie.avertissements.length > 0,
      'aucun avertissement remonté alors que le guillemet droit est non apparié : '
      + JSON.stringify(sortie));
    for (const ligne of sortie.avertissements) {
      assert.match(ligne, /^\[typo-avertissement\]/,
        'une ligne d\u2019avertissement ne porte pas le préfixe attendu : ' + JSON.stringify(ligne));
    }
  });

// Un appel de note est un fragment à `note` (entier) et texte vide, comme une image.
// `_partitionner` le traite comme une coupure : le texte de chaque côté est une unité à part.
test('manuscrit-typo : un fragment a note (texte/note/texte), coupe en plein mot, ressort avec sa note intacte au meme rang',
  { skip: sansPython || sansPandocWsl }, () => {
    const sortie = normaliser({
      langue: 'fr',
      paragraphes: [{
        source: 0,
        fragments: [
          // Word admet un appel de note en plein mot.
          { texte: 'Voici “impor', forme: { italique: false } },
          { texte: '', note: 7 },
          { texte: 'tant” vraiment.', forme: { italique: false } }
        ]
      }]
    });
    assert.deepStrictEqual(sortie.abandons, [],
      'le paragraphe a ete abandonne : ' + JSON.stringify(sortie.abandons));

    const frags = sortie.paragraphes[0].fragments;
    const indexNote = frags.findIndex((f) => f.note === 7);
    assert.notStrictEqual(indexNote, -1,
      'la note a disparu de la sortie : ' + JSON.stringify(frags));
    assert.strictEqual(frags[indexNote].texte, '',
      'un fragment a note doit garder un texte vide, comme une image');
    assert.strictEqual(frags.filter((f) => f.note === 7).length, 1,
      'la note ne doit etre portee que par UN SEUL fragment, jamais dupliquee');
    assert.ok(frags.slice(0, indexNote).every((f) => f.note == null),
      'un fragment AVANT la note porte lui aussi une note : structure corrompue');
    assert.ok(frags.slice(indexNote + 1).every((f) => f.note == null),
      'un fragment APRES la note porte lui aussi une note : structure corrompue');

    const texteAvant = frags.slice(0, indexNote).map((f) => f.texte).join('');
    const texteApres = frags.slice(indexNote + 1).map((f) => f.texte).join('');
    assert.match(texteAvant, /^Voici/, 'le debut du texte avant la note a ete perdu');
    assert.match(texteApres, /vraiment\.$/, 'la fin du texte apres la note a ete perdue');
    assert.match(texteAvant + texteApres, /impor/, 'le mot coupe a perdu du contenu');
    assert.match(texteAvant + texteApres, /tant/, 'le mot coupe a perdu du contenu');
  });

// A3 : guillemets simples, avec le vrai pandoc dans la WSL.
// manuscrit_typo.py envoie un Str par mot : l'ouvrant ‘ et le fermant ’ d'une citation de
// plusieurs mots sont dans des Str différents. a3_chevrons_sur_liste
// (pipeline/filters/szh-typographie.lua) les apparie sur tout le paragraphe. La forme dépend
// du niveau de la citation, pas du caractère d'origine : premier niveau « », imbriqué ‹ ›
// (règles A2/A3, docs/TYPOGRAPHIE-FR.md).

test('A3 : ‘mot’ de PREMIER niveau sur un seul mot devient « mot » (jamais ‹mot›)',
  { skip: sansPython || sansPandocWsl }, () => {
    const sortie = normaliser({
      langue: 'fr',
      paragraphes: [{
        source: 0,
        fragments: [{ texte: 'Il a dit ‘mot’ simplement.', forme: { italique: false } }]
      }]
    });
    assert.deepStrictEqual(sortie.abandons, []);
    const texte = texteAPlat(sortie.paragraphes[0]);
    // Premier niveau : chevrons doubles (A2), avec insécables (E1).
    assert.match(texte, /« mot »/, 'la paire « mot » n’a pas été formée : ' + texte);
    assert.doesNotMatch(texte, /[‘’‹›]/,
      'un guillemet simple non converti, ou un chevron SIMPLE indu (niveau faux), subsiste : ' + texte);
  });

test('A3 : citation MULTI-MOTS de premier niveau, apostrophes internes, chevrons DOUBLES aux deux bouts, l’élision intacte',
  { skip: sansPython || sansPandocWsl }, () => {
    // L'apostrophe de « qu’il » ne doit pas être prise pour le fermant.
    const sortie = normaliser({
      langue: 'fr',
      paragraphes: [{
        source: 0,
        fragments: [{
          texte: 'Elle cite ‘Le cours sinueux des rivières qu’il décrit’ avec émotion.',
          forme: { italique: false }
        }]
      }]
    });
    assert.deepStrictEqual(sortie.abandons, []);
    const texte = texteAPlat(sortie.paragraphes[0]);
    // Insécables aux deux bouts de la citation seulement (E1).
    assert.match(texte, /« Le cours sinueux des rivières qu’il décrit »/,
      'la citation multi-mots n’a pas été correctement appariée et nivelée, ou l’élision a été touchée : ' + texte);
    // Hors de l'élision, ni guillemet simple ni chevron simple.
    assert.doesNotMatch(texte.replace('qu’il', 'quil'), /[‘’‹›]/,
      'un guillemet simple non converti, ou un chevron simple indu, subsiste hors de l’élision : ' + texte);
  });

test('A3 : ouvrant de premier niveau suivi de ponctuation (‘…) devient « …, jamais un fermant ni un ‹',
  { skip: sansPython || sansPandocWsl }, () => {
    const sortie = normaliser({
      langue: 'fr',
      paragraphes: [{
        source: 0,
        fragments: [{
          texte: 'Le texte affirme ‘…ne refuse pas cette réalité’ avec force.',
          forme: { italique: false }
        }]
      }]
    });
    assert.deepStrictEqual(sortie.abandons, []);
    const texte = texteAPlat(sortie.paragraphes[0]);
    assert.match(texte, /« …ne refuse pas cette réalité »/,
      'l’ouvrant de premier niveau suivi de ponctuation n’a pas produit « … : ' + texte);
    assert.doesNotMatch(texte, /[›‹]|»…/,
      'l’ouvrant a été pris pour un fermant, ou nivelé en chevron simple : ' + texte);
  });

test('A3 : fermant de premier niveau collé à un mot à apostrophe (‘c’est cela’) -> « c’est cela »',
  { skip: sansPython || sansPandocWsl }, () => {
    const sortie = normaliser({
      langue: 'fr',
      paragraphes: [{
        source: 0,
        fragments: [{
          texte: 'Elle affirme que ‘c’est cela’ qui compte.',
          forme: { italique: false }
        }]
      }]
    });
    assert.deepStrictEqual(sortie.abandons, []);
    const texte = texteAPlat(sortie.paragraphes[0]);
    assert.match(texte, /« c’est cela »/,
      'la paire n’a pas été formée et nivelée autour de ‘c’est cela’, ou l’élision a été altérée : '
      + texte);
  });

// Seul test de la mesure de profondeur : une paire simple entre « et » sort en chevrons
// simples.
test('A3 : ‘référence’ IMBRIQUÉE entre un « et un » déjà ouverts devient ‹ référence › (chevron simple)',
  { skip: sansPython || sansPandocWsl }, () => {
    const sortie = normaliser({
      langue: 'fr',
      paragraphes: [{
        source: 0,
        fragments: [{
          texte: 'L’auteure écrit : « c’est une ‘référence’ importante ».',
          forme: { italique: false }
        }]
      }]
    });
    assert.deepStrictEqual(sortie.abandons, []);
    const texte = texteAPlat(sortie.paragraphes[0]);
    // Chevrons simples avec insécables (E1) ; la citation englobante est inchangée.
    assert.match(texte, /« c’est une ‹ référence › importante »/,
      'la paire imbriquée n’a pas été nivelée en chevron simple, ou l’englobante a régressé : ' + texte);
  });

test('A3 : citation non fermée dans le paragraphe -> rien n’est converti (pas de chevron orphelin)',
  { skip: sansPython || sansPandocWsl }, () => {
    const sortie = normaliser({
      langue: 'fr',
      paragraphes: [{
        source: 0,
        fragments: [{
          texte: 'Il commence par ‘une remarque qui ne se referme pas dans ce paragraphe.',
          forme: { italique: false }
        }]
      }]
    });
    assert.deepStrictEqual(sortie.abandons, []);
    const texte = texteAPlat(sortie.paragraphes[0]);
    assert.doesNotMatch(texte, /[‹›]/,
      'un chevron orphelin a été émis alors qu’aucun fermant n’existe : ' + texte);
    assert.match(texte, /‘une remarque/, 'l’ouvrant non apparié aurait dû rester tel quel : ' + texte);
  });

// En allemand, ‚ ‘ est toujours un second niveau (le premier est „ “, selon le Duden) :
// ‚ganz konkret‘ devient ‹ganz konkret› sans mesure de profondeur. En français, ‘ ’ sert aux
// deux niveaux, d'où la mesure.
test('A3 : non-régression allemande — ‚ganz konkret‘ -> ‹ganz konkret›, TOUJOURS (idiome, pas profondeur)',
  { skip: sansPython || sansPandocWsl }, () => {
    const sortie = normaliser({
      langue: 'de',
      paragraphes: [{
        source: 0,
        fragments: [{ texte: 'er sagt ‚ganz konkret‘ dazu', forme: { italique: false } }]
      }]
    });
    assert.deepStrictEqual(sortie.abandons, []);
    const texte = texteAPlat(sortie.paragraphes[0]);
    // En allemand, les chevrons sont collés au mot, sans insécable.
    assert.strictEqual(texte, 'er sagt ‹ganz konkret› dazu',
      'l’idiome allemand ‚…‘ a régressé : ' + texte);
  });

test('A3 : non-régression des guillemets doubles « » (forme inchangée, y compris multi-mots)',
  { skip: sansPython || sansPandocWsl }, () => {
    const sortie = normaliser({
      langue: 'fr',
      paragraphes: [{
        source: 0,
        fragments: [{
          texte: 'Elle cite “Le cours sinueux des rivières” en exemple.',
          forme: { italique: false }
        }]
      }]
    });
    assert.deepStrictEqual(sortie.abandons, []);
    const texte = texteAPlat(sortie.paragraphes[0]);
    // En français, E1 pose une insécable à l'intérieur des « ».
    assert.match(texte, /« Le cours sinueux des rivières »/,
      'les guillemets doubles multi-mots ont régressé : ' + texte);
  });
