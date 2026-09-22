// pipeline/manuscrit_typo.py : le pont typographique du nettoyeur de manuscrit (§6 de
// outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md). Ce fichier éprouve, depuis la révision du
// 19.09.2026 :
//   1. un run coupé au milieu d'un mot -> texte exact, aucun caractère perdu ;
//   2. un mot en italique reste en italique après réinjection ;
//   3. un caractère AJOUTÉ par le filtre est accepté sans abandon, hérite du fragment voisin ;
//   4. sous Windows sans wsl.exe joignable, le repli est signalé (jamais un silence) ;
//   5. la même phrase en fr puis en de donne deux espacements différents (`-M lang=` part
//      bien jusqu'au filtre) ;
//   6. une lettre SUPPRIMÉE par le filtre n'est plus un motif d'abandon : le pont fait
//      confiance au filtre, il ne rejuge plus ses corrections ;
//   7. un écart purement typographique (apostrophe, chevrons) n'abandonne rien ;
//   8. les quatre corrections réelles qui abandonnaient à tort avant cette révision (mesurées
//      sur lot-A) passent désormais sans abandon ;
//   9. la garde d'ENTRÉE (le texte des fragments a divergé de celui envoyé au filtre) abandonne
//      proprement, motif à l'appui ;
//   10. la garde de SORTIE (la reconstruction ne reproduit pas le texte rendu par le filtre)
//       abandonne proprement — éprouvée en sabotant directement les opcodes du diff, seule
//       façon de l'atteindre puisqu'aucune entrée réelle ne peut la déclencher ;
//   11. les avertissements [typo-avertissement] d'un appel RÉUSSI remontent désormais
//       (avant : capturés puis jetés en silence sur un succès) ;
//   12. sous Linux (sys.platform != 'win32', le cas de production), pandoc est appelé
//       directement, JAMAIS via wsl.exe/wslpath — la panne mesurée avant cette révision ;
//   13. régression du 19.09.2026 (§4 du contrat révisé, Fragment.note) : un fragment porteur
//       de note, au milieu d'un mot coupé en trois runs texte/note/texte, ressort avec sa note
//       intacte au même rang et le texte alentour normalisé — avant correction, _partitionner
//       ne savait rien de `note` et le fragment retombait dans le run de texte courant,
//       perdant sa note à la reconstruction (mesuré : 11 notes sur 12 disparaissaient sur
//       2-fin-de-document_Article_RSPS.docx).
//
//   node --test "test/js/*.test.js"
//
// Patron : test/js/docx-titres.test.js (fixtures fabriquées dans le test, jamais figées en
// binaire, via un petit programme Python écrit au vol) et test/js/biblio-vide.test.js (qui
// fait déjà tourner un filtre Lua pour de vrai plutôt que de deviner son comportement).
// Gardes de test/js/gardes.js : PYTHON (jamais `python3` en dur, qui tombe sur l'alias
// WindowsApps et fige toute la suite), sansPandocWsl (pandoc + WSL SZH-Publishing) et
// sansPandoc (pandoc du PATH Windows — utilisé UNIQUEMENT par le contrôle n°12, qui a besoin
// d'un vrai pandoc joignable SANS passer par wsl.exe pour prouver que la branche Linux ne le
// touche jamais).
//
// manuscrit_typo.py travaille en duck-typing contre les signatures du §4 du contrat
// (Fragment/Paragraphe) : il n'importe PAS pipeline/manuscrit_modele.py, qui est écrit EN
// PARALLÈLE par un autre agent et peut ne pas exister encore. Le harnais Python ci-dessous
// définit donc ses propres classes Fragment/Paragraphe minimales, à la même forme — ce
// fichier ne touche jamais pipeline/manuscrit_modele.py.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython, sansPandocWsl, sansPandoc } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');

// process.platform de CE poste (Windows) : le contrôle n°4 (repli sans wsl.exe) n'a de sens
// que là où wsl.exe est la voie normale — sous Linux, _executer_pandoc ne le regarde jamais.
const sansWindows = process.platform !== 'win32'
  ? 'contrôle valable uniquement sous Windows (repli via wsl.exe)' : false;

// Le harnais : construit des Fragment/Paragraphe locaux depuis une « recette » JSON, appelle
// normaliser_paragraphes(), rend le résultat en JSON. Les points d'injection remplacent une
// fonction/un attribut interne du module par une doublure de test AVANT l'appel — jamais en
// modifiant manuscrit_typo.py lui-même :
//   - `sortie_sabotee` : _appeler_pandoc rend exactement le texte fourni, sans toucher à pandoc ;
//   - `sans_wsl` : _chemin_wsl_exe rend un exécutable inexistant (repli, contrôle n°4) ;
//   - `forcer_linux` : sys.platform devient 'linux' et wsl.exe/wslpath explosent s'ils sont
//     appelés — pandoc, lui, tourne pour de vrai (celui du PATH Windows, contrôle n°12) ;
//   - `appel_direct` : appelle _reconstruire_unite() SANS passer par pandoc, pour éprouver les
//     deux gardes internes (entrée/sortie, contrôles n°9-10) sans dépendre de la WSL ; son
//     sous-champ `opcodes_bogues` remplace difflib.SequenceMatcher par une doublure dont
//     get_opcodes() rend une couverture délibérément incomplète.
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
  "if recette.get('forcer_linux'):",
  "    MT.sys.platform = 'linux'",
  '    def _explose(*a, **k):',
  "        raise AssertionError('la branche Linux a touche wsl.exe/wslpath')",
  '    MT._chemin_wsl_exe = _explose',
  '    MT._chemin_pour_wsl = _explose',
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
  "if recette.get('sans_wsl'):",
  "    MT._chemin_wsl_exe = lambda: r'C:\\chemin-tout-a-fait-inexistant\\wsl.exe'",
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
    const r = cp.spawnSync(PYTHON, [fHarnais, RACINE, fEntree, fSortie],
      { encoding: 'utf8', timeout: 120000 });
    assert.strictEqual(r.status, 0,
      'harnais Python sorti en ' + r.status + ' : ' + r.stderr + ' / ' + r.stdout);
    return JSON.parse(fs.readFileSync(fSortie, 'utf8'));
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

// Lance le harnais sur une recette de normalisation, rend l'objet JSON de sortie. `recette.
// paragraphes[].fragments[]` est `[{ texte, forme }]` — un seul paragraphe suffit à la plupart
// des contrôles de ce fichier.
function normaliser(recette) {
  return lancerHarnais(recette);
}

// Lance le harnais sur un `appel_direct` (voir le commentaire du HARNAIS ci-dessus), rend
// { ok, texte } ou { ok: false, motif }.
function appelDirect(appelDirectRecette) {
  return lancerHarnais({ appel_direct: appelDirectRecette });
}

function texteAPlat(paragraphe) {
  return paragraphe.fragments.map((f) => f.texte).join('');
}

// ---- 1. Un run coupé au milieu d'un mot : aucun caractère perdu -----------------------

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
    // Aucune lettre réelle n'a bougé : ôter tout ce que la typographie a le droit de poser
    // ou de retirer (espaces, insécables, chevrons, apostrophes...) laisse le même contenu
    // « de fond » que l'original passé au même nettoyage — la preuve indépendante du
    // garde-fou interne (qui, lui, aurait simplement abandonné le paragraphe).
    const TYPO = /[\s\u00a0\u202f\u2018\u2019\u201c\u201d\u00ab\u00bb\u2039\u203a"'`\u2013\u2014\-]/g;
    const origine = 'Voici \u201Cimpor' + 'tant\u201D ' + 'vraiment.';
    assert.strictEqual(texte.replace(TYPO, ''), origine.replace(TYPO, ''),
      'du contenu non typographique a changé pendant la réinjection');
  });

// ---- 2. L'italique survit à la réinjection, insécables comprises ----------------------

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
    // Toutes les lettres de "terme" doivent se trouver dans un (ou plusieurs) fragment(s)
    // marqués italique=true, sans qu'aucun fragment italique=false ne contienne "term".
    const italiques = frags.filter((f) => f.forme && f.forme.italique === true);
    const texteItalique = italiques.map((f) => f.texte).join('');
    assert.match(texteItalique, /terme/, 'le mot « terme » n\u2019est plus regroupé sous un fragment italique');
    for (const f of frags) {
      if (!(f.forme && f.forme.italique === true)) {
        assert.doesNotMatch(f.texte, /term/,
          'une partie de « terme » est sortie hors de son fragment italique : ' + JSON.stringify(f));
      }
    }
    // Preuve que la réinjection a vraiment travaillé (sinon ce contrôle ne prouverait rien) :
    // au moins une insécable a été posée quelque part autour du mot.
    const texte = texteAPlat(sortie.paragraphes[0]);
    assert.match(texte, /[\u00a0\u202f]/, 'aucune insécable posée : le filtre n\u2019a rien changé');
  });

// ---- 3. Un caractère AJOUTÉ par le filtre est accepté sans abandon ---------------------
//
// Avant la révision du 19.09.2026, ce même sabotage (un caractère ajouté, rien perdu) était
// traité comme un échec de reconstruction dès que le caractère ajouté n'était pas sur la
// liste blanche « typographique ». Le filtre est désormais la vérité : un ajout de contenu
// (ici un « X » qui ne ressemble à rien de typographique) doit simplement être accepté et
// rattaché au fragment voisin de gauche, jamais provoquer un abandon.

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

// ---- 4. Le repli sans WSL : inchangé, une trace, jamais d'exception -------------------

test('manuscrit-typo : sans wsl.exe joignable, le repli est signalé et les paragraphes ressortent inchangés',
  { skip: sansPython || sansWindows }, () => {
    const original = 'Un texte tout simple.';
    const sortie = normaliser({
      langue: 'fr',
      sans_wsl: true,   // point d'injection : _chemin_wsl_exe rend un exécutable inexistant
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
      'le paragraphe a été modifié malgré l\u2019absence de wsl.exe');
  });

// ---- 5. Français contre allemand : la langue part bien jusqu'au filtre ----------------

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

// ---- 6. Une lettre SUPPRIMÉE par le filtre n'est plus un motif d'abandon ---------------
//
// Avant la révision du 19.09.2026, ce scénario (un pur « delete », rien pour le remplacer)
// déclenchait systématiquement un abandon dès que la lettre perdue n'était pas sur la liste
// blanche « typographique ». C'était le bug mesuré sur lot-A : le filtre corrige parfois du
// contenu réel (3ème -> 3e, une espace fine -> une insécable fine...) et ce module n'a plus
// à en juger. Ici, pandoc est simulé (`sortie_sabotee`) pour isoler la décision : la lettre
// « s » de « simple » disparaît, rien ne la remplace — et ça ne doit PLUS abandonner.

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

// ---- 7. Le garde-fou n'est pas trop strict : rien que du typographique ----------------

test('manuscrit-typo : un ecart purement typographique (apostrophe, chevrons) n\u2019abandonne rien',
  { skip: sansPython }, () => {
    const original = "C'est le \"terme\" exact.";
    const sortie = normaliser({
      langue: 'fr',
      // apostrophe droite -> courbe, guillemets droits -> chevrons : rien d'autre ne change.
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

// ---- 8. Les quatre corrections réelles qui abandonnaient à tort avant cette révision ---
//
// Mesurées sur tmp/corpus-relecture/lot-A avant le correctif : 4 paragraphes sur 845
// abandonnés À TORT, tous pour la même raison (un caractère hors de l'ancienne liste
// blanche). Régression directe : chacune doit désormais passer sans abandon.

test('manuscrit-typo : les quatre corrections mesurées sur lot-A (A->À, 3ème->3e, espace fine, apostrophe->chevron) ne sont plus abandonnées',
  { skip: sansPython }, () => {
    const cas = [
      { original: 'A la suite de cet essai.', sabote: '\u00c0 la suite de cet essai.' },
      { original: 'Voir le 3ème exemple.', sabote: 'Voir le 3e exemple.' },
      { original: 'Un texte\u2009espace fine.', sabote: 'Un texte\u202fespace fine.' },
      // Corrig\u00e9 le 22.09.2026, une SECONDE fois : la valeur \u00ab sabote \u00bb pr\u00e9c\u00e9dente
      // (\u2039bonjour\u203a, un chevron SIMPLE) appariait juste mais reproduisait le d\u00e9faut de
      // R\u00c8GLE de a3_chevrons_sur_liste \u2014 elle convertissait TOUTE paire de guillemets simples
      // en chevron simple, sans regarder le niveau de citation (A2/A3, docs/TYPOGRAPHIE-FR.md
      // lignes 24-40 : le niveau d\u00e9cide de la forme, jamais le caract\u00e8re d'origine).
      // \u2018bonjour\u2019 est une citation de PREMIER niveau (rien n'est ouvert avant elle dans le
      // paragraphe) : la sortie correcte du filtre est \u00ab\u00a0bonjour\u00a0\u00bb, pas \u2039bonjour\u203a. Ce
      // test-ci ne rejoue jamais le vrai filtre (sortie_sabotee le remplace), donc cette
      // correction ne change rien \u00e0 son verdict \u2014 mais la valeur fig\u00e9e ici doit repr\u00e9senter
      // une sortie CORRECTE du filtre, pas une sortie bogu\u00e9e. Voir les tests A3 plus bas, qui
      // eux appellent le vrai pandoc et couvrent l'appariement ET le niveau r\u00e9els.
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

// ---- 9. La garde d'ENTRÉE : le texte des fragments a divergé de celui envoyé au filtre -

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

// ---- 10. La garde de SORTIE : la reconstruction doit reproduire EXACTEMENT le texte du -
//          filtre. Aucune entrée réelle ne peut la déclencher (les opcodes de
//          difflib.SequenceMatcher couvrent toujours tout `texte_normalise` par construction)
//          — la seule façon de l'éprouver est de saboter le diff lui-même, pour prouver que
//          le filet de sécurité EXISTE et fonctionne si l'algorithme se corrompait un jour.

test('manuscrit-typo : la garde de sortie abandonne si le diff (sabote) ne couvre pas tout le texte normalisé',
  { skip: sansPython }, () => {
    const sortie = appelDirect({
      fragments: ['abc'],
      texte_envoye: 'abc',
      texte_normalise: 'abcd',
      // Opcodes tronqués : ne couvrent que 'abc' de 'abcd', le 'd' final est passé sous silence.
      opcodes_bogues: [['equal', 0, 3, 0, 3]]
    });
    assert.strictEqual(sortie.ok, false, 'une reconstruction incomplète aurait dû abandonner');
    assert.match(sortie.motif, /reconstruction/,
      'le motif ne cite pas la garde de sortie : ' + sortie.motif);
  });

// ---- 11. Les avertissements [typo-avertissement] d'un appel RÉUSSI remontent ----------
//
// Avant la révision du 19.09.2026, _appeler_pandoc() ne lisait stderr QUE sur l'échec :
// sur un succès, les avertissements du filtre (ici C2, guillemet droit non apparié) étaient
// capturés puis jetés en silence. Mesuré sur lot-A : 7 documents sur 10 en émettent.

test('manuscrit-typo : les avertissements [typo-avertissement] d\u2019un appel réussi remontent désormais',
  { skip: sansPython || sansPandocWsl }, () => {
    const sortie = normaliser({
      langue: 'fr',
      paragraphes: [{
        source: 0,
        // Un guillemet droit non apparié : le filtre le signale (code C2) sans le corriger,
        // sur un appel qui réussit par ailleurs (returncode 0).
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

// ---- 12. Sous Linux, pandoc est appelé DIRECTEMENT, jamais via wsl.exe/wslpath --------
//
// La panne mesurée avant cette révision : la CLI de production tourne DANS la WSL (le
// lanceur fait `wsl -d SZH-Publishing -e python3 ...`), où wsl.exe n'existe pas —
// `_appeler_pandoc` l'invoquait quand même, sans erreur visible, et retombait en repli
// silencieux (845 paragraphes sur 845 inchangés, code de sortie 0). Ce contrôle force
// `sys.platform` à 'linux' SANS changer le poste réel : wsl.exe/_chemin_pour_wsl explosent
// s'ils sont appelés (la preuve que la branche ne les touche jamais), et pandoc tourne pour
// de vrai — celui du PATH Windows (gardes.sansPandoc), pas celui de la WSL.

test('manuscrit-typo : sous Linux (sys.platform != win32), pandoc est appelé directement, jamais via wsl.exe',
  { skip: sansPython || sansPandoc }, () => {
    const sortie = normaliser({
      langue: 'fr',
      forcer_linux: true,
      paragraphes: [{
        source: 0,
        fragments: [{ texte: 'Attention : ceci compte vraiment.', forme: { italique: false } }]
      }]
    });
    assert.strictEqual(sortie.statut, 'appliquee',
      'pandoc direct doit réussir sans jamais toucher wsl.exe : ' + JSON.stringify(sortie));
    assert.deepStrictEqual(sortie.abandons, []);
    const texte = texteAPlat(sortie.paragraphes[0]);
    assert.match(texte, /Attention[\u00a0\u202f]:/,
      'la typographie française (insécable devant « : ») n\u2019a pas été appliquée par le pandoc direct');
  });


// ---- 13. Un fragment a NOTE, au milieu d'un mot, ressort intact au meme rang -----------
//
// Regression du 19.09.2026 (§4 du contrat revise) : le lecteur pose desormais
// `Fragment.note` (int|None, texte == '' quand rempli) sur le fragment qui porte un appel de
// note -- meme convention qu'une image. AVANT correction, `_partitionner` ne savait rien de
// `note` : ce fragment retombait dans le run de texte courant, et `_reconstruire_unite` le
// redecoupait comme du texte ordinaire, perdant sa note. Mesure sur
// 2-fin-de-document_Article_RSPS.docx : le lecteur rend 12 fragments a note, la sortie n'en
// portait plus qu'1.

test('manuscrit-typo : un fragment a note (texte/note/texte), coupe en plein mot, ressort avec sa note intacte au meme rang',
  { skip: sansPython || sansPandocWsl }, () => {
    const sortie = normaliser({
      langue: 'fr',
      paragraphes: [{
        source: 0,
        fragments: [
          // << important >> coupe en deux runs de texte par un appel de note plante en plein
          // mot -- cas limite reel (Word autorise un appel de note n'importe ou dans un run).
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

    // Le texte de part et d'autre de la note a survecu ET a ete normalise (la note a coupe le
    // fil du texte, comme une image : chaque cote est traite comme sa propre unite).
    const texteAvant = frags.slice(0, indexNote).map((f) => f.texte).join('');
    const texteApres = frags.slice(indexNote + 1).map((f) => f.texte).join('');
    assert.match(texteAvant, /^Voici/, 'le debut du texte avant la note a ete perdu');
    assert.match(texteApres, /vraiment\.$/, 'la fin du texte apres la note a ete perdue');
    assert.match(texteAvant + texteApres, /impor/, 'le mot coupe a perdu du contenu');
    assert.match(texteAvant + texteApres, /tant/, 'le mot coupe a perdu du contenu');
  });

// ---- 14. A3 · appariement ET NIVEAU des guillemets simples, sur le chemin réel (pandoc +
// filtre) ------------------------------------------------------------------------------
//
// Défaut n°1, mesuré le 22.09.2026 : pipeline/filters/szh-typographie.lua (a2a3_chevrons) ne
// voyait qu'une seule chaîne, et pipeline/manuscrit_typo.py (_construire_inlines) découpe le
// texte en un Str PAR MOT -- dès qu'une citation dépasse un mot, l'ouvrant '‘' et le
// fermant '’' vivaient dans deux Str différents, invisibles l'un à l'autre. Correctif :
// a3_chevrons_sur_liste, dans le filtre Lua, qui voit tout le paragraphe.
//
// Défaut n°2, mesuré le même jour sur un document réel (tmp/docx-cleaner-error/1408_Alves.
// docx) : le premier correctif appariait juste mais écrivait TOUJOURS des chevrons simples
// ‹ ›, sans regarder si la paire était de premier niveau ou imbriquée dans une citation déjà
// ouverte — alors que la règle (A2/A3, docs/TYPOGRAPHIE-FR.md lignes 24-40) ne regarde que
// le niveau, jamais le caractère d'origine : premier niveau => « », imbriqué => ‹ ›. Les
// tests ci-dessous vérifient maintenant le NIVEAU autant que l'appariement.
//
// Ces contrôles passent par le VRAI pandoc (WSL), pas par sortie_sabotee : c'est le chemin
// qu'aucun test de correction typographique ne couvrait avant ce lot.

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
    // Rien n'est ouvert avant ‘mot’ dans ce paragraphe : premier niveau, donc chevron
    // DOUBLE (A2 : « les guillemets, quels qu'ils soient »), avec ses insécables (E1).
    assert.match(texte, /« mot »/, 'la paire « mot » n’a pas été formée : ' + texte);
    assert.doesNotMatch(texte, /[‘’‹›]/,
      'un guillemet simple non converti, ou un chevron SIMPLE indu (niveau faux), subsiste : ' + texte);
  });

test('A3 : citation MULTI-MOTS de premier niveau, apostrophes internes, chevrons DOUBLES aux deux bouts, l’élision intacte',
  { skip: sansPython || sansPandocWsl }, () => {
    // « qu’il » est le piège : un fermant mal détecté à l’intérieur de la citation la
    // couperait en deux, ou confondrait l’élision avec le fermant réel après « décrit ».
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
    // Premier niveau (rien d'ouvert avant) : chevrons DOUBLES, insécable seulement aux deux
    // bouts de la citation — pas entre les mots internes (E1, comme pour A2).
    assert.match(texte, /« Le cours sinueux des rivières qu’il décrit »/,
      'la citation multi-mots n’a pas été correctement appariée et nivelée, ou l’élision a été touchée : ' + texte);
    // Aucun guillemet simple ni chevron simple ne doit subsister hors de l’élision « qu’il » :
    // ni un ‘ resté non converti (appariement raté), ni un ’ isolé (fermant perdu ailleurs),
    // ni un ‹ ›  (niveau faux).
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

// ---- 14bis. A3 · une paire simple IMBRIQUÉE dans une citation « » déjà ouverte ---------
//
// Le seul contrôle qui prouve que la mesure de profondeur fonctionne : une paire simple
// trouvée ENTRE un « et son » doit sortir en chevrons SIMPLES, alors que la même paire, sans
// « » autour, sort en chevrons doubles (contrôles ci-dessus). C'est le cas mesuré sur
// tmp/docx-cleaner-error/1408_Alves.docx, à ceci près qu'ici le « » est déjà présent dans le
// texte source (posé par l'autrice), condition que a2a3_chevrons ne modifie jamais.

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
    // La citation imbriquée prend le chevron SIMPLE, avec ses insécables (même règle E1
    // que pour le double) ; la citation englobante garde son chevron DOUBLE, inchangé.
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

// Verdict du 22.09.2026 sur le cas allemand (voir la note de tête de a3_chevrons_sur_liste,
// pipeline/filters/szh-typographie.lua) : contrairement au français, où ‘ ’ est AMBIGU sur le
// niveau (une rédactrice l'emploie aussi bien en premier niveau qu'en imbrication réelle),
// l'idiome allemand natif réserve ‚ ‘ au SECOND niveau par construction — le premier niveau
// natif est „ “, jamais ‚ ‘ seul (Duden). ‚ganz konkret‘ vaut donc TOUJOURS ‹ganz konkret›,
// même hors de toute « » déjà ouverte dans le paragraphe : ce n'est pas une mesure de
// profondeur qui le décide ici (a3_chevrons_sur_liste ne la lui applique d'ailleurs pas,
// voir son code), mais l'idiome lui-même. Le comportement d'avant ce lot était donc déjà
// juste, pour cette raison précise — et seulement pour elle. Aucune occurrence de ‚ ‘ n'a
// été trouvée dans le corpus allemand disponible (tmp/docx-dev, tmp/docx-cleaner-error) pour
// le mesurer sur du réel ; la règle retenue est celle du Duden, non une mesure locale.
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
    // COLLEE = true en allemand : aucune insécable, ‹ et › collés au mot (comme « » l'est
    // déjà pour A2).
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
    // E1 pose une insécable à l’intérieur des « » en français : « Le … rivières » et non
    // «Le … rivières» collé — attendu, pas une régression de ce lot.
    assert.match(texte, /« Le cours sinueux des rivières »/,
      'les guillemets doubles multi-mots ont régressé : ' + texte);
  });
