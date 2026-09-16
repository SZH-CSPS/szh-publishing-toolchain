// pipeline/docx-pronto.py lit le gabarit « Pronto — modèle d'article v2 » : deux tableaux
// fixes en tête du document (métadonnées, puis autrices et auteurs), et des blocs
// figure/tableau reconnus par leur forme. Contrairement à pipeline/docx-meta.py, qui
// DEVINE sur 486 Word hérités de formes toutes différentes, ce lecteur-ci LIT une
// structure imposée par un gabarit — il n'a donc pas le droit de deviner : une étiquette
// inconnue, une rangée hors forme, un contenu absent doivent se DIRE (avertissement, dans
// les deux langues) et ne jamais faire perdre de texte en silence.
//
//   node --test "test/js/*.test.js"
//
// Patron repris de test/js/docx-meta-titre.test.js (interprète Python trouvé au démarrage,
// jamais de saut silencieux si absent ; .docx fabriqués depuis le test, jamais figés en
// binaire dans le dépôt). Les tableaux du gabarit forcent un fabricant plus général que
// celui de docx-meta-titre.test.js (qui n'avait que des paragraphes à écrire) : il est
// défini ci-dessous et écrit une seule fois dans un dossier jetable, comme un script
// ordinaire, plutôt que rejoué à chaque test comme un programme -c en ligne.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const DOCX_PRONTO = path.join(RACINE, 'pipeline', 'pronto-lire.py');

// python3, puis python — même repli que docx-meta-titre.test.js, szh-commun.test.js et
// livre-scinder.test.js. Aucun saut silencieux : un contrôle qui lit une fiche ne doit pas
// passer au vert sans rien avoir lancé.
function interpretePython() {
  for (const commande of ['python3', 'python']) {
    const r = cp.spawnSync(commande, ['--version'], { encoding: 'utf8' });
    if (!r.error && /Python 3/.test(String(r.stdout || '') + String(r.stderr || ''))) {
      return commande;
    }
  }
  return null;
}
const PYTHON = interpretePython();

function python(args, env) {
  return cp.spawnSync(PYTHON, args, {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }, env || {})
  });
}

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-pronto-'));
}

// ---- Fabricant de .docx : styles.xml + document.xml seulement -------------------------
//
// docx-pronto.py ne lit que ces deux entrées du zip (comme docx-meta.py). Le fabricant
// prend une spec JSON { styles: [[styleId, nom], ...], body: [bloc, ...] } où un bloc est
// soit { p: [style, texte] } (un paragraphe), soit { tbl: [rangée, ...] } (un tableau,
// rangée = [cellule, ...]). Une cellule est soit la forme courte [[style, texte], ...]
// (des paragraphes, comme dans les tableaux 1 et 2 du gabarit), soit { gridSpan, content }
// pour une cellule fusionnée sur plusieurs colonnes (w:gridSpan — le bloc figure/tableau à
// rangée 0 fusionnée décrit dans la consigne), où `content` est une liste d'éléments
// [style, texte] OU { tbl: [...] } (un tableau IMBRIQUÉ dans la cellule — le bloc tableau
// de contenu). Écrit une fois en tant que script Python dans un dossier jetable : plus
// lisible qu'un programme -c pour une structure aussi imbriquée.

const FABRICANTE_PY = `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json, sys, zipfile

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def para(style, texte):
    ppr = ('<w:pPr><w:pStyle w:val="%s"/></w:pPr>' % esc(style)) if style else ''
    r = '<w:r><w:t xml:space="preserve">%s</w:t></w:r>' % esc(texte) if texte else ''
    return '<w:p>%s%s</w:p>' % (ppr, r)


def contenu_item(it):
    if isinstance(it, dict):
        if 'tbl' in it:
            return table(it['tbl'])
        if 'p' in it:
            s, t = it['p']
            return para(s, t)
        raise ValueError('élément de cellule inconnu : %r' % it)
    style, texte = it
    return para(style, texte)


def cell(spec):
    if isinstance(spec, dict):
        items = spec.get('content', [])
        gridspan = spec.get('gridSpan')
    else:
        items = spec
        gridspan = None
    tcpr = '<w:tcPr>' + ('<w:gridSpan w:val="%d"/>' % gridspan if gridspan else '') + '</w:tcPr>'
    return '<w:tc>%s%s</w:tc>' % (tcpr, ''.join(contenu_item(it) for it in items))


def row(cellules):
    return '<w:tr>%s</w:tr>' % ''.join(cell(c) for c in cellules)


def table(rangees):
    return '<w:tbl><w:tblPr/>%s</w:tbl>' % ''.join(row(r) for r in rangees)


def marqueurs_page(n):
    # n paragraphes vides portant chacun un w:lastRenderedPageBreak — la marque que Word
    # pose à sa dernière repagination (voir l'en-tête de pronto_docx.compter_marqueurs_page).
    return '<w:p>' + ('<w:r><w:lastRenderedPageBreak/></w:r>' * n) + '</w:p>'


def bloc(b):
    if 'p' in b:
        style, texte = b['p']
        return para(style, texte)
    if 'tbl' in b:
        return table(b['tbl'])
    if 'marqueurs' in b:
        return marqueurs_page(b['marqueurs'])
    raise ValueError('bloc inconnu : %r' % b)


def build(chemin, spec):
    styles_xml = '<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="%s">' % W
    for sid, nom in spec.get('styles', []):
        styles_xml += '<w:style w:styleId="%s"><w:name w:val="%s"/></w:style>' % (esc(sid), esc(nom))
    styles_xml += '</w:styles>'
    corps = ''.join(bloc(b) for b in spec.get('body', []))
    doc_xml = ('<?xml version="1.0" encoding="UTF-8"?>'
               '<w:document xmlns:w="%s"><w:body>%s</w:body></w:document>' % (W, corps))
    with zipfile.ZipFile(chemin, 'w') as z:
        z.writestr('word/document.xml', doc_xml.encode('utf-8'))
        z.writestr('word/styles.xml', styles_xml.encode('utf-8'))


if __name__ == '__main__':
    build(sys.argv[1], json.loads(sys.argv[2]))
`;

let DOSSIER_FABRICANTE = null;
let CHEMIN_FABRICANTE = null;

function fabricantePy() {
  if (!CHEMIN_FABRICANTE) {
    DOSSIER_FABRICANTE = dossierJetable();
    CHEMIN_FABRICANTE = path.join(DOSSIER_FABRICANTE, 'fabricante.py');
    fs.writeFileSync(CHEMIN_FABRICANTE, FABRICANTE_PY, 'utf8');
  }
  return CHEMIN_FABRICANTE;
}

test.after(() => {
  if (DOSSIER_FABRICANTE) { fs.rmSync(DOSSIER_FABRICANTE, { recursive: true, force: true }); }
});

// Styles de base présents dans tout document fabriqué : les deux styles maison du gabarit
// Pronto (reconnus par leur NOM, pas par leur styleId — d'où l'écart volontaire entre
// l'id "SZHCle" et le nom « SZH Cle ») et Normal pour les valeurs.
const STYLES_BASE = [['SZHCle', 'SZH Cle'], ['SZHAide', 'SZH Aide'], ['Normal', 'Normal']];

function fabriquerDocx(chemin, spec) {
  const r = python([fabricantePy(), chemin, JSON.stringify(spec)]);
  assert.strictEqual(r.status, 0, 'fabrication du .docx impossible : ' + r.stderr);
}

// Une rangée du tableau des métadonnées : étiquette en SZH Cle (+ SZH Aide optionnel,
// toujours ignoré), valeur en Normal dans la seconde colonne.
function ligneMeta(label, valeur, aide) {
  const col0 = aide ? [['SZHCle', label], ['SZHAide', aide]] : [['SZHCle', label]];
  return [col0, [['Normal', valeur]]];
}

function tableMeta(lignes) {
  const entete = [[['Normal', 'Champ']], [['Normal', 'Valeur']]];
  return { tbl: [entete, ...lignes] };
}

// Une rangée du tableau des auteurs : pas de photo (colonne 0 vide), un paragraphe SZH Cle
// par ligne de texte fournie (« Prénom : Jeanne », etc.).
function ligneAuteur(lignesTexte) {
  return [[], lignesTexte.map((t) => ['SZHCle', t])];
}

function tableAuteurs(lignes) {
  return { tbl: lignes };
}

// Rangée 0 d'un bloc figure/tableau : une seule cellule portant un paragraphe SZH Cle par
// champ (« Légende : … », etc.), comme les cellules du tableau des auteurs.
function ligneBlocMeta(lignesTexte) {
  return [lignesTexte.map((t) => ['SZHCle', t])];
}

// Rangée 0 étalée sur PLUSIEURS cellules réelles (pas une fusion w:gridSpan, qui produirait
// une seule cellule côté XML — voir l'en-tête de docx-pronto.py) : une première cellule
// vide, puis les quatre paragraphes dans la seconde. Prouve que la lecture ne suppose pas
// une seule cellule par rangée.
function ligneBlocMetaMultiColonnes(lignesTexte) {
  return [[], lignesTexte.map((t) => ['SZHCle', t])];
}

// Rangée 1 d'un bloc tableau de contenu : une cellule portant le tableau interne, suivi
// d'un paragraphe vide — Word en pose toujours un après un tableau imbriqué, et il doit
// être ignoré.
function ligneBlocContenuTable(tableauInterne) {
  return [[{ tbl: tableauInterne }, { p: ['Normal', ''] }]];
}

// Rangée 1 restée vide de tout contenu reconnu (ni image, ni tableau) : le paragraphe
// SZH Aide « {{IMAGE ICI}} » du gabarit, tel qu'il reste quand personne n'a rien déposé.
function ligneBlocContenuAbsent() {
  return [[['SZHAide', '{{IMAGE ICI}}']]];
}

// n paragraphes portant chacun un w:lastRenderedPageBreak, à poser au fil du corps (jamais
// dans une cellule) pour donner une page connaissable aux tableaux qui suivent.
function marqueursPage(n) {
  return { marqueurs: n };
}

// Lance docx-pronto.py sur un .docx fabriqué depuis `spec`, et rend { statut, stats, fiche,
// instructions, avertissements }.
function importer(slug, spec) {
  const base = dossierJetable();
  try {
    const docx = path.join(base, slug + '.docx');
    fabriquerDocx(docx, spec);
    const instr = path.join(base, 'instructions.txt');
    const r = python([DOCX_PRONTO, docx, slug, base], { SZH_META: instr });
    assert.strictEqual(r.status, 0, 'docx-pronto.py a échoué : ' + r.stderr);
    const lignes = String(r.stdout).trim().split(/\r?\n/);
    const cheminFiche = path.join(base, slug + '.meta.yaml');
    return {
      stats: JSON.parse(lignes[lignes.length - 1]),
      fiche: fs.existsSync(cheminFiche) ? fs.readFileSync(cheminFiche, 'utf8') : null,
      instructions: fs.existsSync(instr) ? fs.readFileSync(instr, 'utf8') : '',
      avertissements: String(r.stderr).split(/\r?\n/)
        .filter((l) => l.indexOf('[import-avertissement]') === 0)
    };
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

// ---- 1. Document complet du gabarit ----------------------------------------------------

const SPEC_COMPLET = {
  styles: STYLES_BASE,
  body: [
    tableMeta([
      ligneMeta("Type d’article", 'dossier thématique',
        'dossier thématique · éditorial · varia · tribune libre'),
      ligneMeta('Langue de l’article', 'français', 'français · deutsch · italiano'),
      ligneMeta('Titre (FR)', 'Inclusion scolaire et pratiques enseignantes'),
      ligneMeta('Sous-titre (FR)', 'Une enquête romande'),
      ligneMeta('Résumé (FR)', 'Un résumé de test suffisamment long.')
    ]),
    tableAuteurs([
      ligneAuteur([
        'Prénom : Jeanne', 'Nom : Dupont', 'Fonction : Chercheuse',
        'Institution : HEP Vaud', 'ROR : https://ror.org/03xyz1234',
        'ORCID : 0000-0001-2345-6789', 'Email : jeanne.dupont@ex.ch'
      ]),
      ligneAuteur([
        'Prénom: Marc', 'Nom: Müller', 'Fonction: Professeur',
        'Institution: PH Zürich', 'ROR: ', 'ORCID: ', 'Email: marc.mueller@ex.ch'
      ])
    ])
  ]
};

test('docx-pronto.py : un document complet du gabarit donne une fiche juste', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé (python3, puis python)'); }
  const vu = importer('01-complet', SPEC_COMPLET);

  assert.match(vu.fiche, /^type: article$/m, 'type non reconnu : ' + vu.fiche);
  assert.match(vu.fiche, /^lang: fr$/m, 'langue non reconnue : ' + vu.fiche);
  assert.match(vu.fiche, /title:\n {2}fr: "Inclusion scolaire et pratiques enseignantes"/,
    'titre FR mal rangé : ' + vu.fiche);
  assert.match(vu.fiche, /subtitle:\n {2}fr: "Une enquête romande"/,
    'sous-titre FR mal rangé : ' + vu.fiche);
  assert.match(vu.fiche, /resume:\n {2}fr: "Un résumé de test suffisamment long\."/,
    'résumé FR mal rangé : ' + vu.fiche);

  // Deux auteurs, huit champs chacun (schéma CHAMPS_AUTEUR du cockpit, ror compris — le
  // premier auteur en a saisi un, le second l'a laissé vide).
  assert.strictEqual((vu.fiche.match(/^- prenom:/gm) || []).length, 2, 'pas deux auteurs');
  assert.match(vu.fiche, /- prenom: "Jeanne"\n {2}nom: "Dupont"\n {2}fonction: "Chercheuse"\n {2}affiliation: "HEP Vaud"\n {2}ror: "https:\/\/ror\.org\/03xyz1234"\n {2}orcid: "0000-0001-2345-6789"\n {2}email: "jeanne\.dupont@ex\.ch"/,
    'auteur 1 incomplet, mal ordonné, ou le ROR saisi n’a pas été repris : ' + vu.fiche);
  assert.match(vu.fiche, /- prenom: "Marc"\n {2}nom: "Müller"\n {2}fonction: "Professeur"\n {2}affiliation: "PH Zürich"\n {2}email: "marc\.mueller@ex\.ch"/,
    'auteur 2 incomplet ou mal ordonné : ' + vu.fiche);
  // L'auteur 2 n'a pas saisi de ROR (« ROR: » suivi de rien) : aucune ligne `ror:` ne doit
  // apparaître entre son prénom et l'email qui le suit dans la fiche.
  const blocMarc = vu.fiche.slice(vu.fiche.indexOf('"Marc"'), vu.fiche.indexOf('marc.mueller'));
  assert.ok(!/ {2}ror: /.test(blocMarc),
    'l’auteur 2, qui n’a pas saisi de ROR, en a pourtant un dans la fiche : ' + vu.fiche);
  assert.ok(!/keyword/i.test(vu.fiche), 'un mot-clé est apparu alors qu’aucune rangée n’en porte');

  // Les deux tableaux (métadonnées, auteurs) sont consommés : ils quitteront le corps.
  assert.match(vu.instructions, /^T\t1$/m, 'tableau des métadonnées non marqué consommé');
  assert.match(vu.instructions, /^T\t2$/m, 'tableau des auteurs non marqué consommé');
  assert.strictEqual(vu.stats.tableau1_consomme, true);
  assert.strictEqual(vu.stats.tableau2_consomme, true);
});

test('docx-pronto.py : les paragraphes SZH Aide ne finissent jamais dans une valeur', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('01b-aide', SPEC_COMPLET);
  const aides = ['tribune libre', 'thématique', 'deutsch', 'italiano'];
  for (const mot of aides) {
    assert.ok(vu.fiche.toLowerCase().indexOf(mot) === -1,
      'le texte d’aide « ' + mot + ' » a fui dans la fiche : ' + vu.fiche);
  }
});

// ---- 2. Email : / Email: — l’irrégularité mesurée du gabarit ---------------------------

function specEmail(separateur) {
  return {
    styles: STYLES_BASE,
    body: [
      tableMeta([ligneMeta('Langue de l’article', 'français')]),
      tableAuteurs([
        ligneAuteur(['Prénom : Ana', 'Nom : Rossi', 'Email' + separateur + 'ana.rossi@ex.ch'])
      ])
    ]
  };
}

test('docx-pronto.py : « Email : » et « Email: » donnent le même résultat', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const avecEspace = importer('02a-email', specEmail(' : '));
  const sansEspace = importer('02b-email', specEmail(': '));
  assert.match(avecEspace.fiche, /email: "ana\.rossi@ex\.ch"/, 'email avec espace non lu');
  assert.match(sansEspace.fiche, /email: "ana\.rossi@ex\.ch"/, 'email sans espace non lu');
});

// ---- 3. Rangée d’auteur vide -> aucun auteur --------------------------------------------

test('docx-pronto.py : une rangée d’auteur entièrement vide ne crée pas d’auteur', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('03-vide', {
    styles: STYLES_BASE,
    body: [
      tableMeta([ligneMeta('Langue de l’article', 'français')]),
      tableAuteurs([
        ligneAuteur(['Prénom : ', 'Nom : ', 'Fonction : ', 'Institution : ',
          'ROR : ', 'ORCID : ', 'Email : ']),
        ligneAuteur(['Prénom : Ida', 'Nom : Keller', 'Email : ida.keller@ex.ch'])
      ])
    ]
  });
  assert.strictEqual((vu.fiche.match(/^- prenom:/gm) || []).length, 1,
    'la rangée-modèle vide a produit un auteur : ' + vu.fiche);
  assert.match(vu.fiche, /- prenom: "Ida"/);
});

// ---- 4. Étiquette inconnue dans le tableau des métadonnées -----------------------------

test('docx-pronto.py : une étiquette inconnue ne perd pas sa valeur, et avertit', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('04-inconnue', {
    styles: STYLES_BASE,
    body: [
      tableMeta([
        ligneMeta('Langue de l’article', 'français'),
        ligneMeta('Titre (FR)', 'Titre malgré tout'),
        ligneMeta('Mots-clés', 'inclusion, école')
      ]),
      tableAuteurs([])
    ]
  });

  const ligne = vu.avertissements.find((l) => l.indexOf('etiquette-metadonnees-inconnue') !== -1);
  assert.ok(ligne, 'aucun avertissement pour l’étiquette inconnue : ' + vu.avertissements.join(' / '));
  assert.ok(ligne.indexOf('Mots-clés') !== -1, 'l’étiquette inconnue n’est pas citée : ' + ligne);
  assert.ok(ligne.indexOf('inclusion, école') !== -1, 'la valeur perdue n’apparaît pas dans l’avertissement : ' + ligne);

  // La valeur ne devient PAS un mot-clé — aucune rangée « Mots-clés » n’est jamais lue
  // comme telle, quel que soit son contenu.
  assert.ok(!/keyword/i.test(vu.fiche), 'un mot-clé est apparu : ' + vu.fiche);
  // Le champ compris (titre) reste écrit malgré la rangée fautive du même tableau.
  assert.match(vu.fiche, /fr: "Titre malgré tout"/, 'le titre a été perdu à cause d’une autre rangée : ' + vu.fiche);
  // Le tableau, lui, n’est pas marqué consommé : il reste visible dans le corps compilé.
  assert.ok(!/^T\t1$/m.test(vu.instructions), 'le tableau des métadonnées a été marqué consommé malgré l’étiquette inconnue');
  assert.strictEqual(vu.stats.tableau1_consomme, false);
});

// ---- 5. Type d'article : les quatre libellés du gabarit, et un mot hors liste ----------
//
// Le gabarit (revu le 16 septembre 2026) offre « dossier thématique · éditorial · varia ·
// tribune libre ». « dossier thématique » n'est pas le libellé d'un type mais celui de son
// GROUPE (GROUPES_TYPES.dossier de lib/yaml.js) : un article du dossier porte le jeton
// `article`. « recension », « article scientifique » et « entretien » ne sont plus
// proposés par le gabarit — un document qui en porterait un doit se comporter comme
// n'importe quel mot hors liste : avertir, ne rien écrire.

function docTypeSeul(libelle) {
  return {
    styles: STYLES_BASE,
    body: [
      tableMeta([ligneMeta("Type d’article", libelle), ligneMeta('Langue de l’article', 'français')]),
      tableAuteurs([])
    ]
  };
}

test("docx-pronto.py : les quatre libellés du gabarit donnent les quatre jetons attendus", () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const cas = [
    ['dossier thématique', 'article'],
    ['éditorial', 'editorial'],
    ['varia', 'varia'],
    ['tribune libre', 'tribune-libre']
  ];
  cas.forEach(([libelle, jeton], i) => {
    const vu = importer('05a-' + i + '-type', docTypeSeul(libelle));
    assert.match(vu.fiche, new RegExp('^type: ' + jeton + '$', 'm'),
      '« ' + libelle + '» n’a pas donné le jeton « ' + jeton + ' » : ' + vu.fiche);
    assert.deepStrictEqual(
      vu.avertissements.filter((l) => l.indexOf('type-article-non-reconnu') !== -1), [],
      '« ' + libelle + ' » est pourtant du gabarit, il ne devrait pas avertir');
  });
});

test('docx-pronto.py : un type hors liste avertit et n’écrit rien', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('05b-type-inconnu', docTypeSeul('recension'));
  assert.ok(!/^type:/m.test(vu.fiche), 'un type a été écrit malgré la valeur hors liste : ' + vu.fiche);
  const ligne = vu.avertissements.find((l) => l.indexOf('type-article-non-reconnu') !== -1);
  assert.ok(ligne, 'aucun avertissement pour la valeur hors liste : ' + vu.avertissements.join(' / '));
  assert.ok(ligne.indexOf('recension') !== -1, 'la valeur perdue n’apparaît pas dans l’avertissement : ' + ligne);
});

// ---- 6. Bloc figure ou tableau resté sans contenu reconnu ------------------------------

test('docx-pronto.py : un bloc resté sans image ni tableau avertit', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('06-vide', {
    styles: STYLES_BASE,
    body: [
      tableMeta([ligneMeta('Langue de l’article', 'français')]),
      tableAuteurs([]),
      {
        tbl: [
          ligneBlocMeta(['Légende : Une légende de test', 'Texte alternatif : Un texte alternatif',
            'Crédit : Photographe X', 'Source : Archives Y']),
          ligneBlocContenuAbsent()
        ]
      }
    ]
  });
  const ligne = vu.avertissements.find((l) => l.indexOf('bloc-contenu-absent') !== -1);
  assert.ok(ligne, 'aucun avertissement pour le bloc sans contenu : ' + vu.avertissements.join(' / '));
  assert.ok(ligne.indexOf('Une légende de test') !== -1,
    'la légende n’apparaît pas dans l’avertissement : ' + ligne);
});

// ---- 7. Bloc tableau de contenu (rangée 1 = un vrai tableau imbriqué) ------------------

const TABLEAU_INTERNE = [
  [[['Normal', 'Groupe A']], [['Normal', 'Groupe B']]],
  [[['Normal', '12']], [['Normal', '7']]]
];

test('docx-pronto.py : un bloc tableau bien formé lit sa méta, retrouve le tableau interne, et se consomme', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('07-bloc-table', {
    styles: STYLES_BASE,
    body: [
      tableMeta([ligneMeta('Langue de l’article', 'français')]),
      tableAuteurs([]),
      {
        tbl: [
          ligneBlocMeta(['Légende : Résultats bruts', 'Texte alternatif : Tableau de résultats',
            'Crédit : Enquête interne', 'Source : Données 2026']),
          ligneBlocContenuTable(TABLEAU_INTERNE)
        ]
      }
    ]
  });
  assert.strictEqual(vu.avertissements.length, 0,
    'un bloc tableau bien formé ne devrait rien signaler : ' + vu.avertissements.join(' / '));
  assert.strictEqual(vu.stats.blocs.length, 1, 'le bloc n’a pas été trouvé');
  const b = vu.stats.blocs[0];
  assert.strictEqual(b.nature, 'table', 'la nature du bloc n’est pas « table »');
  assert.strictEqual(b.legende, 'Résultats bruts', 'la légende n’a pas été lue');
  assert.strictEqual(b.tbl_interne, true, 'le tableau interne n’a pas été retrouvé');
  assert.strictEqual(b.consommee, true, 'le bloc n’est pas marqué consommé');
  // Le bloc externe (3e tableau de premier niveau : métadonnées, auteurs, puis le bloc)
  // est consommé — ligne T comme pour les deux premiers tableaux.
  assert.match(vu.instructions, /^T\t3$/m, 'le bloc externe n’a pas reçu de ligne T');
});

test('docx-pronto.py : un bloc tableau à rangée 0 étalée sur plusieurs cellules se lit pareil', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('08-bloc-table-multicol', {
    styles: STYLES_BASE,
    body: [
      tableMeta([ligneMeta('Langue de l’article', 'français')]),
      tableAuteurs([]),
      {
        tbl: [
          ligneBlocMetaMultiColonnes(['Légende : Résultats bruts',
            'Texte alternatif : Tableau de résultats', 'Crédit : Enquête interne',
            'Source : Données 2026']),
          ligneBlocContenuTable(TABLEAU_INTERNE)
        ]
      }
    ]
  });
  assert.strictEqual(vu.avertissements.length, 0,
    'un bloc bien formé à plusieurs cellules ne devrait rien signaler : ' + vu.avertissements.join(' / '));
  const b = vu.stats.blocs[0];
  assert.strictEqual(b.nature, 'table');
  assert.strictEqual(b.legende, 'Résultats bruts',
    'la légende répartie sur plusieurs cellules n’a pas été retrouvée');
  assert.strictEqual(b.tbl_interne, true);
  assert.strictEqual(b.consommee, true);
  assert.match(vu.instructions, /^T\t3$/m);
});

// ---- 8. Fiche déjà présente : jamais réécrite -------------------------------------------

test('docx-pronto.py : une fiche déjà là n’est jamais réécrite', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const base = dossierJetable();
  try {
    const slug = '06-existe';
    const docx = path.join(base, slug + '.docx');
    fabriquerDocx(docx, SPEC_COMPLET);
    const cheminFiche = path.join(base, slug + '.meta.yaml');
    fs.writeFileSync(cheminFiche, 'sentinelle: "ne pas toucher"\n', 'utf8');
    const r = python([DOCX_PRONTO, docx, slug, base]);
    assert.strictEqual(r.status, 0, 'docx-pronto.py a échoué : ' + r.stderr);
    assert.strictEqual(fs.readFileSync(cheminFiche, 'utf8'), 'sentinelle: "ne pas toucher"\n',
      'la fiche existante a été modifiée');
    const stats = JSON.parse(String(r.stdout).trim().split(/\r?\n/).pop());
    assert.strictEqual(stats.meta_ecrit, false, 'meta_ecrit aurait dû rester faux');
    const avert = String(r.stderr).split(/\r?\n/).filter((l) => l.indexOf('[import-avertissement]') === 0);
    assert.deepStrictEqual(avert, [], 'une fiche conservée ne doit pas émettre d’avertissement propre');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---- 9. Aucun mot-clé, dans aucun scénario ------------------------------------------------

test('docx-pronto.py : aucun mot-clé n’est jamais écrit dans la fiche', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  for (const [slug, spec] of [
    ['07a-motscles', SPEC_COMPLET],
    ['07b-motscles', {
      styles: STYLES_BASE,
      body: [
        tableMeta([
          ligneMeta('Langue de l’article', 'français'),
          ligneMeta('Mots-clés', 'un, deux, trois')
        ]),
        tableAuteurs([])
      ]
    }]
  ]) {
    const vu = importer(slug, spec);
    assert.ok(!/keyword/i.test(vu.fiche), 'un mot-clé est apparu pour ' + slug + ' : ' + vu.fiche);
  }
});

// ---- 10. Bibliographie reconnue au TITRE, plus au style (décision de la rédaction) -----
//
// Le gabarit Pronto ne définit aucun style de bibliographie : la détection par style de
// docx-meta.py n'a donc rien à reconnaître dessus (mesuré sur le banc de 20 articles :
// 0 paragraphe détaché sur 19). La reconnaissance se fait ici au TITRE — un paragraphe de
// niveau de titre (1 à 3) — comparé, une fois aplati, au même lexique que
// szh-citations.lua : tout ce qui suit ce titre, jusqu'à la fin du document, devient la
// bibliographie, un paragraphe = une entrée, les vides sautés.

const STYLES_TITRE = STYLES_BASE.concat([['H1', 'heading 1']]);

function titre1(texte) {
  return { p: ['H1', texte] };
}

function specBiblioTitre(titreTexte, entrees) {
  const corps = [
    tableMeta([ligneMeta('Langue de l’article', 'français')]),
    tableAuteurs([]),
    { p: ['Normal', 'Un paragraphe de corps, avant la bibliographie.'] },
    titre1(titreTexte)
  ];
  for (const e of entrees) { corps.push({ p: ['Normal', e] }); }
  return { styles: STYLES_TITRE, body: corps };
}

// fr, de, it, avec/sans accent, numéroté — les variantes que la rédaction demande de
// couvrir explicitement.
const VARIANTES_TITRE_BIBLIO = [
  'Références', 'References', 'Bibliographie', '5. Références',
  'Literatur', 'Literaturverzeichnis', 'Bibliografia'
];

test('pronto-lire.py : la bibliographie se reconnaît à son titre — fr/de/it, avec ou sans accent, numéroté', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  VARIANTES_TITRE_BIBLIO.forEach((titreTexte, i) => {
    const vu = importer('10-' + i + '-biblio', specBiblioTitre(titreTexte, [
      'Dupont, J. (2020). Titre un.',
      'Müller, A. (2019). Titre deux.',
      '',
      'Rossi, M. (2021). Titre trois.'
    ]));
    assert.strictEqual(vu.stats.biblio.voie, 'titre',
      '« ' + titreTexte + ' » n’a pas été reconnu comme titre de bibliographie : '
      + JSON.stringify(vu.stats.biblio));
    // Trois entrées : le paragraphe vide, au milieu, est sauté.
    assert.strictEqual(vu.stats.biblio.paragraphes, 3,
      '« ' + titreTexte + ' » : nombre d’entrées détachées inattendu : '
      + JSON.stringify(vu.stats.biblio));
    assert.strictEqual((vu.instructions.match(/^B\t/gm) || []).length, 3,
      '« ' + titreTexte + ' » : lignes B inattendues :\n' + vu.instructions);
    assert.match(vu.instructions, /^BT\t/m, '« ' + titreTexte + ' » : ligne BT absente');
  });
});

// ---- 11. Faux positif à éviter : un paragraphe de CORPS ne déclenche rien --------------

test('pronto-lire.py : un paragraphe de CORPS commençant par « Références » ne déclenche rien', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('11-faux-positif', {
    styles: STYLES_TITRE,
    body: [
      tableMeta([ligneMeta('Langue de l’article', 'français')]),
      tableAuteurs([]),
      { p: ['Normal', 'Références multiples ont servi à documenter cette étude, sans lien '
        + 'avec la bibliographie finale.'] },
      { p: ['Normal', 'Un second paragraphe de corps, qui ne doit pas non plus être '
        + 'détaché.'] }
    ]
  });
  assert.strictEqual(vu.stats.biblio.voie, 'aucune',
    'un paragraphe de corps a été pris pour un titre de bibliographie : '
    + JSON.stringify(vu.stats.biblio));
  assert.strictEqual(vu.stats.biblio.paragraphes, 0);
  assert.ok(!/^BT\t/m.test(vu.instructions), 'une ligne BT est apparue sans titre reconnu :\n' + vu.instructions);
  assert.ok(!/^B\t/m.test(vu.instructions), 'des lignes B sont apparues sans titre reconnu :\n' + vu.instructions);
});

// ---- 12. « entretien » est un type d'article, au même titre que les autres -------------

test("pronto-lire.py : « entretien » est reconnu comme le type interview", () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('12-entretien', docTypeSeul('entretien'));
  assert.match(vu.fiche, /^type: interview$/m, 'entretien n’a pas donné le jeton interview : ' + vu.fiche);
  assert.deepStrictEqual(
    vu.avertissements.filter((l) => l.indexOf('type-article-non-reconnu') !== -1), [],
    '« entretien » est un type du gabarit, il ne devrait pas avertir');
});

// ---- 13. Blocs collés : un tableau fusionné rend plusieurs blocs, jamais un seul --------
//
// Mesuré sur le gabarit réel avec deux blocs figure copiés l'un à la suite de l'autre, sans
// paragraphe entre eux : LibreOffice fusionne les deux `w:tbl`/`table:table` adjacents en
// UN SEUL tableau de 2×N rangées à la conversion .odt. Le lecteur doit RÉPARER — reconnaître
// les N blocs empilés — plutôt que perdre la légende et le texte alternatif de chacun en
// silence. Le cas ci-dessous glue directement deux (puis trois) blocs dans un seul tableau
// fabriqué, exactement la forme qu'aurait produite la fusion.

function specBlocsColles(nBlocs) {
  const rangees = [];
  for (let i = 0; i < nBlocs; i += 1) {
    rangees.push(ligneBlocMeta([
      'Légende : Bloc ' + (i + 1), 'Texte alternatif : alt ' + (i + 1),
      'Crédit : crédit ' + (i + 1), 'Source : source ' + (i + 1)
    ]));
    rangees.push(ligneBlocContenuTable(TABLEAU_INTERNE));
  }
  return {
    styles: STYLES_BASE,
    body: [
      tableMeta([ligneMeta('Langue de l’article', 'français')]),
      tableAuteurs([]),
      { tbl: rangees }
    ]
  };
}

test('pronto-lire.py : deux blocs collés dans un seul tableau (4 rangées) donnent 2 blocs, avec avertissement', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('13-colles-2', specBlocsColles(2));
  assert.strictEqual(vu.stats.blocs.length, 2,
    'les deux blocs collés n’ont pas été reconnus séparément : ' + JSON.stringify(vu.stats.blocs));
  assert.ok(vu.stats.blocs.every((b) => b.nature === 'table'),
    'un des deux blocs collés n’a pas retrouvé son tableau interne : ' + JSON.stringify(vu.stats.blocs));
  const ligne = vu.avertissements.find((l) => l.indexOf('blocs-colles') !== -1);
  assert.ok(ligne, 'aucun avertissement pour les blocs collés : ' + vu.avertissements.join(' / '));
});

test('pronto-lire.py : trois blocs collés (6 rangées) donnent 3 blocs', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('14-colles-3', specBlocsColles(3));
  assert.strictEqual(vu.stats.blocs.length, 3,
    'les trois blocs collés n’ont pas été reconnus séparément : ' + JSON.stringify(vu.stats.blocs));
  const ligne = vu.avertissements.find((l) => l.indexOf('blocs-colles') !== -1);
  assert.ok(ligne, 'aucun avertissement pour les blocs collés : ' + vu.avertissements.join(' / '));
});

test('pronto-lire.py : un bloc normal (2 rangées) reste 1 bloc, sans avertissement de collage', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('15-normal', specBlocsColles(1));
  assert.strictEqual(vu.stats.blocs.length, 1, 'un bloc normal ne devrait rendre qu’un bloc');
  assert.deepStrictEqual(
    vu.avertissements.filter((l) => l.indexOf('blocs-colles') !== -1), [],
    'un bloc normal (2 rangées) ne devrait jamais avertir de collage : '
    + vu.avertissements.join(' / '));
});

// ---- 16. Garde-fou « bloc-mal-forme » : un tableau porte les étiquettes d'un bloc mais pas -
//          sa forme ------------------------------------------------------------------------
//
// Aujourd'hui un tel tableau est simplement ignoré : imprimé tel quel dans l'article, sa
// légende et son texte alternatif jamais lus, sans que rien ne le dise. Le garde-fou se
// déclenche quand ressemble_a_un_bloc() est vrai (au moins un paragraphe SZH Cle dont
// l'étiquette est une des quatre du bloc) et n_blocs_meta() vaut 0 (la forme ne tient pas).

const LEGENDE_TEST = 'Légende : Répartition des élèves';

function specTableauMalForme(rangees) {
  return {
    styles: STYLES_BASE,
    body: [
      tableMeta([ligneMeta('Langue de l’article', 'français')]),
      tableAuteurs([]),
      { tbl: rangees }
    ]
  };
}

test('pronto-lire.py : un tableau à 3 rangées portant les étiquettes d’un bloc avertit, et reste dans le corps', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('16-impair', specTableauMalForme([
    ligneBlocMeta([LEGENDE_TEST, 'Texte alternatif : Un texte alternatif',
      'Crédit : Photographe X', 'Source : Archives Y']),
    ligneBlocContenuTable(TABLEAU_INTERNE),
    ligneBlocContenuTable(TABLEAU_INTERNE)     // rangée ajoutée : 3 rangées, la forme casse
  ]));
  const ligne = vu.avertissements.find((l) => l.indexOf('bloc-mal-forme') !== -1);
  assert.ok(ligne, 'aucun avertissement bloc-mal-forme pour le tableau à 3 rangées : '
    + vu.avertissements.join(' / '));
  assert.ok(ligne.indexOf('Répartition des élèves') !== -1,
    'l’étiquette remplie n’apparaît pas dans l’avertissement : ' + ligne);
  assert.ok(ligne.indexOf('tableau 3') !== -1, 'le rang du tableau n’apparaît pas : ' + ligne);
  // Le 3e tableau (métadonnées, auteurs, puis celui-ci) n’est pas marqué consommé : il reste
  // visible dans le corps compilé, comme n’importe quel tableau non reconnu.
  assert.ok(!/^T\t3$/m.test(vu.instructions),
    'le tableau mal formé a pourtant été marqué consommé :\n' + vu.instructions);
  assert.strictEqual(vu.stats.blocs.length, 0, 'un tableau mal formé ne devrait produire aucun bloc');
});

test('pronto-lire.py : une rangée de méta sans rangée de contenu (1 rangée) avertit aussi', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('17-seule-rangee', specTableauMalForme([
    ligneBlocMeta([LEGENDE_TEST, 'Texte alternatif : x', 'Crédit : y', 'Source : z'])
  ]));
  const ligne = vu.avertissements.find((l) => l.indexOf('bloc-mal-forme') !== -1);
  assert.ok(ligne, 'aucun avertissement bloc-mal-forme pour la rangée de méta seule : '
    + vu.avertissements.join(' / '));
  assert.ok(!/^T\t3$/m.test(vu.instructions),
    'le tableau mal formé (1 rangée) a pourtant été marqué consommé :\n' + vu.instructions);
});

// ---- 17. Le numéro de page : connaissable seulement quand Word l'a mesuré --------------
//
// w:lastRenderedPageBreak n'existe que dans un .docx déjà ouvert par Word. Un .docx fabriqué
// par ce test n'en porte aucun par défaut (comme tous les autres ci-dessus) : c'est
// exactement le cas « page inconnue » du test 16 déjà passé (aucune mention de page dans son
// avertissement). Celui-ci ajoute des marqueurs et vérifie que la bonne page en sort.

test('pronto-lire.py : des w:lastRenderedPageBreak avant le tableau donnent la bonne page', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('18-page-connue', {
    styles: STYLES_BASE,
    body: [
      tableMeta([ligneMeta('Langue de l’article', 'français')]),
      tableAuteurs([]),
      marqueursPage(5),
      { tbl: [
        ligneBlocMeta([LEGENDE_TEST, 'Texte alternatif : x', 'Crédit : y', 'Source : z']),
        ligneBlocContenuTable(TABLEAU_INTERNE),
        ligneBlocContenuTable(TABLEAU_INTERNE)
      ] }
    ]
  });
  const ligne = vu.avertissements.find((l) => l.indexOf('bloc-mal-forme') !== -1);
  assert.ok(ligne, 'aucun avertissement bloc-mal-forme : ' + vu.avertissements.join(' / '));
  assert.ok(ligne.indexOf('page 6') !== -1,
    '5 marqueurs avant le tableau auraient dû donner la page 6 : ' + ligne);
  assert.ok(ligne.indexOf('Le tableau de la page 6') !== -1,
    'la phrase ne commence pas par « Le tableau de la page 6 » : ' + ligne);
});

test('pronto-lire.py : sans aucun marqueur, le message se tient et ne parle jamais de page', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('18b-sans-marqueur', specTableauMalForme([
    ligneBlocMeta([LEGENDE_TEST, 'Texte alternatif : x', 'Crédit : y', 'Source : z']),
    ligneBlocContenuTable(TABLEAU_INTERNE),
    ligneBlocContenuTable(TABLEAU_INTERNE)
  ]));
  const ligne = vu.avertissements.find((l) => l.indexOf('bloc-mal-forme') !== -1);
  assert.ok(ligne, 'aucun avertissement bloc-mal-forme : ' + vu.avertissements.join(' / '));
  assert.ok(!/page/i.test(ligne), 'un document sans marqueur ne devrait jamais parler de page : ' + ligne);
  assert.ok(!/page none/i.test(ligne), '« page None » ne devrait jamais apparaître : ' + ligne);
  // La phrase doit quand même commencer par le rang, et rester lisible : la parenthèse ne
  // doit jamais rester vide.
  assert.ok(ligne.indexOf('()') === -1, 'une parenthèse vide est apparue : ' + ligne);
  assert.ok(ligne.indexOf('3ᵉ tableau') !== -1 || ligne.indexOf('tableau 3') !== -1,
    'le rang du tableau n’apparaît pas dans la phrase : ' + ligne);
});

// ---- 18. Faux positif à ne pas déclencher : un vrai tableau de contenu ------------------
//
// Une colonne d'en-tête intitulée « Légende », en style Normal (pas SZH Cle, pas de forme
// « Étiquette : valeur ») : ce n'est PAS une étiquette de bloc, et ne doit rien déclencher.
// C'est exactement le piège que ressemble_a_un_bloc() doit éviter (voir son commentaire).

test('pronto-lire.py : un tableau de contenu avec une colonne « Légende » ne déclenche rien', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('19-faux-positif', {
    styles: STYLES_BASE,
    body: [
      tableMeta([ligneMeta('Langue de l’article', 'français')]),
      tableAuteurs([]),
      { tbl: [
        [[['Normal', 'Légende']], [['Normal', 'Auteur']]],
        [[['Normal', 'Fig. 1']], [['Normal', 'Dupont']]],
        [[['Normal', 'Fig. 2']], [['Normal', 'Müller']]]
      ] }
    ]
  });
  assert.deepStrictEqual(
    vu.avertissements.filter((l) => l.indexOf('bloc-mal-forme') !== -1), [],
    'un vrai tableau de contenu portant le mot « Légende » en en-tête a pourtant déclenché '
    + 'le garde-fou : ' + vu.avertissements.join(' / '));
});

// ---- 19. Un bloc bien formé ne déclenche jamais ce code ---------------------------------

test('pronto-lire.py : un bloc bien formé (2 rangées) ne déclenche jamais bloc-mal-forme', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('20-bien-forme', {
    styles: STYLES_BASE,
    body: [
      tableMeta([ligneMeta('Langue de l’article', 'français')]),
      tableAuteurs([]),
      { tbl: [
        ligneBlocMeta([LEGENDE_TEST, 'Texte alternatif : alt', 'Crédit : c', 'Source : s']),
        ligneBlocContenuTable(TABLEAU_INTERNE)
      ] }
    ]
  });
  assert.deepStrictEqual(
    vu.avertissements.filter((l) => l.indexOf('bloc-mal-forme') !== -1), [],
    'un bloc bien formé ne devrait jamais déclencher bloc-mal-forme : '
    + vu.avertissements.join(' / '));
});
