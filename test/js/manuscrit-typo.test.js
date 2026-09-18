// pipeline/manuscrit_typo.py : le pont typographique du nettoyeur de manuscrit (§6 de
// outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md). Ce fichier éprouve les cinq contrôles
// posés au §11 pour manuscrit-typo.test.js :
//   1. un run coupé au milieu d'un mot -> texte exact, aucun caractère perdu ;
//   2. un mot en italique reste en italique après réinjection ;
//   3. un paragraphe irreconstructible est abandonné et signalé, jamais rendu de travers ;
//   4. sans wsl.exe, la fonction rend les paragraphes inchangés et une trace qui le dit ;
//   5. la même phrase en fr puis en de donne deux espacements différents (preuve que
//      `-M lang=` part bien jusqu'au filtre).
//
//   node --test "test/js/*.test.js"
//
// Patron : test/js/docx-titres.test.js (fixtures fabriquées dans le test, jamais figées en
// binaire, via un petit programme Python écrit au vol) et test/js/biblio-vide.test.js (qui
// fait déjà tourner un filtre Lua pour de vrai plutôt que de deviner son comportement).
// Gardes de test/js/gardes.js : PYTHON (jamais `python3` en dur, qui tombe sur l'alias
// WindowsApps et fige toute la suite) et sansPandocWsl (pandoc + WSL SZH-Publishing).
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
const { PYTHON, sansPython, sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');

// Le harnais : construit des Fragment/Paragraphe locaux depuis une « recette » JSON, appelle
// normaliser_paragraphes(), rend le résultat en JSON. Les points d'injection `saboter` et
// `sans_wsl` remplacent une fonction interne du module par une doublure de test AVANT
// l'appel — jamais en modifiant manuscrit_typo.py lui-même.
const HARNAIS = [
  'import json, os, sys',
  'racine, chemin_entree, chemin_sortie = sys.argv[1], sys.argv[2], sys.argv[3]',
  "sys.path.insert(0, os.path.join(racine, 'pipeline'))",
  'import manuscrit_typo as MT',
  '',
  'class Fragment:',
  "    __slots__ = ('texte', 'image', 'forme', 'lien', 'source')",
  '    def __init__(self, texte, image, forme, lien, source):',
  '        self.texte, self.image, self.forme = texte, image, forme',
  '        self.lien, self.source = lien, source',
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
  "if recette.get('saboter'):",
  '    def _appel_sabote(textes, langue, racine_depot):',
  '        # Le point d\u2019injection prévu par le contrat pour le contrôle « abandon',
  '        # propre » : un texte volontairement différent, sans toucher à pandoc ni à la WSL.',
  '        sortie = []',
  '        for t in textes:',
  "            sortie.append(t.replace('e', 'X', 1) if 'e' in t else t + 'X')",
  '        return sortie',
  '    MT._appeler_pandoc = _appel_sabote',
  '',
  "if recette.get('sortie_sabotee') is not None:",
  '    # Point d’injection à contrôle EXACT, caractère par caractère (contrôles 6 et 7) :',
  '    # renvoie précisément le texte fourni par la recette, plutôt qu’une altération',
  '    # générique — c’est ce qui permet de viser le garde-fou ligne à ligne, dans un sens',
  '    # (un caractère non typographique perdu ou ajouté) puis dans l’autre (rien que du',
  '    # typographique, qui ne doit surtout pas être abandonné).',
  '    _fixe = recette[\'sortie_sabotee\']',
  '    def _appel_fixe(textes, langue, racine_depot):',
  '        return list(_fixe)',
  '    MT._appeler_pandoc = _appel_fixe',
  '',
  "if recette.get('sans_wsl'):",
  "    MT._chemin_wsl_exe = lambda: r'C:\\chemin-tout-a-fait-inexistant\\wsl.exe'",
  '',
  'paragraphes = []',
  "for p in recette['paragraphes']:",
  '    fragments = [Fragment(f[\'texte\'], None, f.get(\'forme\'), f.get(\'lien\'), i)',
  "                 for i, f in enumerate(p['fragments'])]",
  "    paragraphes.append(Paragraphe(p.get('style', ''), p.get('niveau_declare', 0),",
  "                                   p.get('niveau_retenu', 0), fragments, p.get('liste'),",
  "                                   p.get('alignement', ''), p.get('retrait', 0),",
  "                                   p.get('source', 0)))",
  '',
  "resultat, traces, abandons = MT.normaliser_paragraphes(paragraphes, recette['langue'], racine)",
  '',
  'sortie = {',
  "    'traces': traces, 'abandons': abandons,",
  "    'paragraphes': [",
  "        {'source': p.source,",
  "         'fragments': [{'texte': f.texte, 'forme': f.forme, 'lien': f.lien} for f in p.fragments]}",
  '        for p in resultat',
  '    ],',
  '}',
  "json.dump(sortie, open(chemin_sortie, 'w', encoding='utf-8'), ensure_ascii=False)",
  "print('OK')"
].join('\n') + '\n';

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-manuscrittypo-'));
}

// Lance le harnais sur une recette, rend l'objet JSON de sortie. `recette.paragraphes[].fragments[]`
// est `[{ texte, forme }]` — un seul paragraphe suffit à tous les contrôles de ce fichier.
function normaliser(recette) {
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

// ---- 3. L'abandon est propre : paragraphe intact, motif inscrit, aucune exception -----

test('manuscrit-typo : une reconstruction impossible abandonne le paragraphe proprement',
  { skip: sansPython }, () => {
    const original = 'Un texte tout simple.';
    const sortie = normaliser({
      langue: 'fr',
      // Insertion pure d'un caractere non typographique en fin de texte (rien n'est
      // perdu : perdu == '', ajoute == 'X') -- isole la moitie << ajoute >> du garde-fou,
      // complementaire du controle n°6 qui isole la moitie << perdu >>. Un ancien
      // sabotage (remplacer 'e' par 'X') declenchait les DEUX moities a la fois et ne
      // prouvait donc rien de plus que le controle n°6 -- corrige.
      sortie_sabotee: [original + 'X'],
      paragraphes: [{
        source: 5,
        fragments: [{ texte: original, forme: { italique: false } }]
      }]
    });
    assert.strictEqual(sortie.abandons.length, 1, 'l\u2019abandon attendu n\u2019a pas été inscrit');
    assert.strictEqual(sortie.abandons[0].source, 5);
    assert.ok(sortie.abandons[0].motif && sortie.abandons[0].motif.length > 0,
      'l\u2019abandon n\u2019a pas de motif');
    assert.strictEqual(texteAPlat(sortie.paragraphes[0]), original,
      'le paragraphe abandonné n\u2019est pas rendu intact');
  });

// ---- 4. Le repli sans WSL : inchangé, une trace, jamais d'exception -------------------

test('manuscrit-typo : sans wsl.exe joignable, les paragraphes ressortent inchangés',
  { skip: sansPython }, () => {
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
    assert.ok(sortie.traces.some((t) => /repli|indisponible/i.test(t)),
      'aucune trace n\u2019explique le repli : ' + JSON.stringify(sortie.traces));
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

// ---- 6. Le garde-fou n'est pas trop permissif : une lettre PERDUE (pas ajoutee) --------
//
// Le controle n°3 ci-dessus ne suffit PAS a eprouver le garde-fou de _reconstruire_unite :
// son sabotage (« saboter ») remplace un caractere d'origine PAR un caractere ajoute non
// typographique ('X'), ce qui declenche la moitie « ajoute » du test aux lignes 273-274 de
// manuscrit_typo.py, jamais sa moitie « perdu ». Une neutralisation de la seule moitie
// « perdu » (par exemple `if False and any(... perdu ...) or any(... ajoute ...)`, ou la
// precedence de `and` sur `or` ne laisse subsister QUE le test sur les caracteres ajoutes)
// laisse alors passer, SANS ABANDON, un texte qui a perdu une vraie lettre -- tant que rien
// n'est ajoute a sa place. Verifie a la main (18.09.2026) : avec ce sabotage exact applique
// a manuscrit_typo.py, les 5 controles precedents restent tous verts -- la preuve du trou.
// C'est exactement le scenario ici : pandoc (simule via le point d'injection
// `sortie_sabotee`) rend “Un texte imple.” pour “Un texte simple.” -- le 's' de
// « simple » a disparu, rien ne l'a remplace (un pur « delete », ajoute == '').
test('manuscrit-typo : une lettre perdue (jamais remplacee) abandonne le paragraphe, motif a l\u2019appui',
  { skip: sansPython }, () => {
    const original = 'Un texte simple.';
    const sortie = normaliser({
      langue: 'fr',
      sortie_sabotee: ['Un texte imple.'],   // le 's' de "simple" a disparu, non remplace
      paragraphes: [{
        source: 9,
        fragments: [{ texte: original, forme: { italique: false } }]
      }]
    });
    assert.strictEqual(sortie.abandons.length, 1,
      'la lettre perdue n\u2019a pas déclenché d\u2019abandon : ' + JSON.stringify(sortie));
    assert.strictEqual(sortie.abandons[0].source, 9);
    // Le motif doit CITER le caractere fautif, pas juste dire << echec >> en general.
    assert.match(sortie.abandons[0].motif, /'s'/,
      'le motif ne cite pas le caractere perdu : ' + sortie.abandons[0].motif);
    assert.strictEqual(texteAPlat(sortie.paragraphes[0]), original,
      'le paragraphe abandonne n\u2019est pas rendu intact malgre la lettre perdue');
  });

// ---- 7. Le garde-fou n'est pas trop strict : rien que du typographique ----------------
//
// Symetrique du controle precedent : un texte qui ne differe de l'original QUE par des
// caracteres de CARACTERES_TYPOGRAPHIQUES (une apostrophe droite devenue courbe, des
// guillemets droits devenus chevrons) ne doit PAS etre abandonne. Sans ce controle, une
// version du garde-fou qui abandonnerait TOUT ecart (au lieu de distinguer les deux listes)
// resterait indetectee par le controle n°6 -- et la typographie ne s'appliquerait plus
// jamais a aucun paragraphe modifie, en silence.
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
