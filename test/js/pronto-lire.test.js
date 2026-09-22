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
WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
ASVG = "http://schemas.microsoft.com/office/drawing/2016/SVG/main"

RIDS_IMAGES = []   # (rid, nomfichier) — accumulé pendant la construction, écrit dans .rels


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def drawing(nom_image, nom_svg=None):
    # Minimal, mais tout ce que pronto_docx.images_de_paragraphe() cherche : un w:drawing
    # portant quelque part un wp:extent (surface) et un a:blip r:embed (résolu via .rels).
    # nom_svg reproduit la forme que Word donne à une image VECTORIELLE : le a:blip pointe
    # un aperçu PNG, et le vrai SVG se cache dans son extension asvg:svgBlip. pandoc, lui,
    # écrit le SVG — d'où les deux noms à connaître.
    rid = 'rIdImg%d' % (len(RIDS_IMAGES) + 1)
    RIDS_IMAGES.append((rid, nom_image))
    svg = ''
    if nom_svg:
        rid_svg = 'rIdImg%d' % (len(RIDS_IMAGES) + 1)
        RIDS_IMAGES.append((rid_svg, nom_svg))
        svg = ('<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}">'
               '<asvg:svgBlip xmlns:asvg="%s" r:embed="%s"/></a:ext></a:extLst>'
               % (ASVG, rid_svg))
    return ('<w:drawing xmlns:wp="%s" xmlns:a="%s" xmlns:r="%s">'
            '<wp:extent cx="100000" cy="100000"/><a:blip r:embed="%s">%s</a:blip></w:drawing>'
            % (WP, A, R, rid, svg))


def para(style, texte, image=None, image_svg=None):
    ppr = ('<w:pPr><w:pStyle w:val="%s"/></w:pPr>' % esc(style)) if style else ''
    r = '<w:r><w:t xml:space="preserve">%s</w:t></w:r>' % esc(texte) if texte else ''
    d = '<w:r>%s</w:r>' % drawing(image, image_svg) if image else ''
    return '<w:p>%s%s%s</w:p>' % (ppr, r, d)


def contenu_item(it):
    if isinstance(it, dict):
        if 'tbl' in it:
            return table(it['tbl'])
        if 'p' in it:
            s, t = it['p']
            return para(s, t, it.get('image'), it.get('imageSvg'))
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
        return para(style, texte, b.get('image'), b.get('imageSvg'))
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
        if RIDS_IMAGES:
            rels = ('<?xml version="1.0" encoding="UTF-8"?>'
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
                    'relationships">')
            for rid, nom in RIDS_IMAGES:
                rels += ('<Relationship Id="%s" Type="http://schemas.openxmlformats.org/'
                         'officeDocument/2006/relationships/image" Target="media/%s"/>'
                         % (esc(rid), esc(nom)))
            rels += '</Relationships>'
            z.writestr('word/_rels/document.xml.rels', rels.encode('utf-8'))


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
// l'id "SZHCle" et le nom « SZH Cle ») et Normal pour les valeurs. « SZH Cle Abb/Tab »
// (révision du 21.09.2026) : le style des clés de bloc à la NOUVELLE forme.
const STYLES_BASE = [
  ['SZHCle', 'SZH Cle'], ['SZHAide', 'SZH Aide'], ['Normal', 'Normal'],
  ['SZHCleAbbTab', 'SZH Cle Abb/Tab']
];

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
// instructions, avertissements, info, bloquant }.
//
// « cle-attendue-absente » (clé attendue non trouvée, ou laissée vide — jamais bloquant, voir
// pronto_modele.py) est mise à part dans `info` plutôt que mélangée à `avertissements` : la
// plupart des fixtures ci-dessus ne renseignent qu'un sous-ensemble des champs du gabarit (par
// construction, pour isoler ce qu'elles testent), ce qui en produirait sinon systématiquement —
// et casserait les assertions plus anciennes qui vérifient qu'AUCUN AUTRE avertissement n'est
// apparu. `avertissementsTous` garde tout, pour qui en a besoin (ex. le test de parité des
// gabarits réels).
//
// Le statut de sortie n'est plus systématiquement 0 depuis les clés bloquantes (22.09.2026) :
// 1 signale un import refusé (voir stats.bloquant / stats.cles_non_reconnues), toute autre
// valeur reste un vrai échec de script.
// `produit` : le jeton `revue:` du numéro, d'où vient la LANGUE de l'article depuis le
// 22.09.2026 (le gabarit ne porte plus de champ « Langue de l'article »). La chaîne réelle le
// pose dans $SZH_PRODUIT, lu à la racine du numéro par import-docx.sh ; tous les contrôles
// tournent donc « dans la Revue » par défaut, comme un vrai import. Les deux contrôles qui
// visent la langue elle-même passent leur propre valeur — dont '' pour le cas sans numéro.
function importer(slug, spec, produit) {
  const base = dossierJetable();
  try {
    const docx = path.join(base, slug + '.docx');
    fabriquerDocx(docx, spec);
    const instr = path.join(base, 'instructions.txt');
    const r = python([DOCX_PRONTO, docx, slug, base],
      { SZH_META: instr, SZH_PRODUIT: produit === undefined ? 'revue' : produit });
    assert.ok(r.status === 0 || r.status === 1,
      'docx-pronto.py a échoué de façon inattendue (code ' + r.status + ') : ' + r.stderr);
    const lignes = String(r.stdout).trim().split(/\r?\n/);
    const cheminFiche = path.join(base, slug + '.meta.yaml');
    const tous = String(r.stderr).split(/\r?\n/)
      .filter((l) => l.indexOf('[import-avertissement]') === 0);
    const stats = JSON.parse(lignes[lignes.length - 1]);
    return {
      stats,
      bloquant: !!stats.bloquant,
      fiche: fs.existsSync(cheminFiche) ? fs.readFileSync(cheminFiche, 'utf8') : null,
      instructions: fs.existsSync(instr) ? fs.readFileSync(instr, 'utf8') : '',
      avertissements: tous.filter((l) => l.indexOf('cle-attendue-absente') === -1),
      info: tous.filter((l) => l.indexOf('cle-attendue-absente') !== -1),
      avertissementsTous: tous
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
      tableMeta([]),
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
      tableMeta([]),
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

test('docx-pronto.py : une étiquette inconnue mais PRÉSENTE (valeur réelle) bloque tout l’import (décision de Robin, 22.09.2026)', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('04-inconnue', {
    styles: STYLES_BASE,
    body: [
      tableMeta([
        ligneMeta('Titre (FR)', 'Titre malgré tout'),
        ligneMeta('Mots-clés', 'inclusion, école')
      ]),
      tableAuteurs([])
    ]
  });

  // « Mots-clés » est reconnue (score 1,0 — elle est écrite exactement) mais n'a aucune
  // destination : un contenu réel (« inclusion, école ») serait perdu si l'import continuait —
  // c'est exactement ce qui doit bloquer, avant même de regarder si le titre, lui, est bon.
  assert.strictEqual(vu.bloquant, true, 'une étiquette sans destination et à valeur réelle aurait dû bloquer l’import');
  assert.strictEqual(vu.fiche, null, 'rien n’aurait dû être écrit — le document ne s’importe pas : ' + vu.fiche);
  assert.strictEqual(vu.instructions, '', 'aucune instruction n’aurait dû être écrite non plus');

  const cles = vu.stats.cles_non_reconnues || [];
  assert.strictEqual(cles.length, 1, 'une seule clé non reconnue attendue : ' + JSON.stringify(cles));
  assert.strictEqual(cles[0].texte, 'Mots-clés', 'le texte de la clé bloquante n’est pas cité : ' + JSON.stringify(cles));
  assert.match(cles[0].lieu, /tableau metadonnees/, 'l’emplacement de la clé bloquante n’est pas cité : ' + JSON.stringify(cles));

  const ligne = vu.avertissements.find((l) => l.indexOf('etiquette-metadonnees-inconnue') !== -1);
  assert.ok(ligne, 'aucun avertissement pour l’étiquette inconnue : ' + vu.avertissements.join(' / '));
  assert.ok(ligne.indexOf('Mots-clés') !== -1, 'l’étiquette inconnue n’est pas citée : ' + ligne);
  assert.ok(ligne.indexOf('inclusion, école') !== -1, 'la valeur perdue n’apparaît pas dans l’avertissement : ' + ligne);
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
      tableMeta([ligneMeta("Type d’article", libelle)]),
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
      tableMeta([]),
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
      tableMeta([]),
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
  // L'ancienne forme (tableau enveloppe) est encore lue, mais avertit désormais qu'il faut la
  // convertir (révision du 21.09.2026) — c'est le SEUL avertissement attendu ici.
  assert.deepStrictEqual(
    vu.avertissements.filter((l) => l.indexOf('bloc-ancienne-forme') === -1), [],
    'un bloc tableau bien formé ne devrait signaler que la conversion vers la nouvelle forme : '
    + vu.avertissements.join(' / '));
  assert.ok(vu.avertissements.find((l) => l.indexOf('bloc-ancienne-forme') !== -1),
    'l’ancienne forme, bien lue, devrait quand même avertir qu’elle est dépassée');
  assert.strictEqual(vu.stats.blocs.length, 1, 'le bloc n’a pas été trouvé');
  const b = vu.stats.blocs[0];
  assert.strictEqual(b.nature, 'table', 'la nature du bloc n’est pas « table »');
  assert.strictEqual(b.legende, 'Résultats bruts', 'la légende n’a pas été lue');
  assert.strictEqual(b.tbl_interne, true, 'le tableau interne n’a pas été retrouvé');
  assert.strictEqual(b.consommee, true, 'le bloc n’est pas marqué consommé');
  // Le tableau enveloppe (3e tableau de premier niveau : métadonnées, auteurs, puis le bloc)
  // n'est PAS consommé, et c'est délibéré depuis le 22.09.2026. Une ligne T dit à la chaîne
  // de faire disparaître un tableau : docx-tables.py le saute ENTIÈREMENT, sans descendre
  // dedans, et szh-meta.lua le retire de l'AST. Sur une enveloppe de bloc TABLEAU, cela
  // ferait disparaître le tableau qu'elle contient, sans un mot. Le bloc s'imprime donc tel
  // quel, et 'bloc-ancienne-forme' dit comment retrouver un tableau légendé.
  // ⚠ Ne pas « réparer » ce contrôle en remettant une ligne T : c'est le tableau interne
  //   qu'on perdrait.
  assert.doesNotMatch(vu.instructions, /^T\t3$/m,
    'le tableau enveloppe d’un bloc ne doit JAMAIS recevoir de ligne T : son tableau interne '
    + 'disparaîtrait de l’article. Instructions : ' + vu.instructions);
  assert.deepStrictEqual(vu.stats.tableaux_consommes, [1, 2],
    'seuls les deux tableaux fixes de la tête se consomment');
});

test('docx-pronto.py : un bloc tableau à rangée 0 étalée sur plusieurs cellules se lit pareil', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('08-bloc-table-multicol', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
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
  assert.deepStrictEqual(
    vu.avertissements.filter((l) => l.indexOf('bloc-ancienne-forme') === -1), [],
    'un bloc bien formé à plusieurs cellules ne devrait signaler que la conversion vers la '
    + 'nouvelle forme : ' + vu.avertissements.join(' / '));
  const b = vu.stats.blocs[0];
  assert.strictEqual(b.nature, 'table');
  assert.strictEqual(b.legende, 'Résultats bruts',
    'la légende répartie sur plusieurs cellules n’a pas été retrouvée');
  assert.strictEqual(b.tbl_interne, true);
  assert.strictEqual(b.consommee, true);
  assert.doesNotMatch(vu.instructions, /^T\t3$/m);   // voir le contrôle précédent
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
    // « cle-attendue-absente » est mise à part : SPEC_COMPLET ne renseigne pas ROR/ORCID pour
    // le second auteur (délibérément, voir ce fixture) — une information, jamais un
    // avertissement propre.
    const avert = String(r.stderr).split(/\r?\n/)
      .filter((l) => l.indexOf('[import-avertissement]') === 0)
      .filter((l) => l.indexOf('cle-attendue-absente') === -1);
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
    tableMeta([]),
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
      tableMeta([]),
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
      tableMeta([]),
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
      tableMeta([]),
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
      tableMeta([]),
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
      tableMeta([]),
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

// ---- 21. Blocs figure/tableau — NOUVELLE forme (révision du 21.09.2026, décision de Robin) -
//
// Plus de tableau enveloppe : 1 à 4 paragraphes SZH Cle Abb/Tab consécutifs, suivis à 1 ou 2
// paragraphes de distance (un paragraphe vide toléré) par un paragraphe portant une image, ou
// par un tableau. Un document reçoit un fichier de relations (word/_rels/document.xml.rels)
// dès qu'une image y est posée — voir drawing()/RIDS_IMAGES dans FABRICANTE_PY.

function clesAbbTab(champs) {
  // champs : liste de chaînes "Étiquette : valeur" (ordre quelconque, comme le contrat
  // l'autorise) — un paragraphe SZH Cle Abb/Tab par entrée.
  return champs.map((t) => ({ p: ['SZHCleAbbTab', t] }));
}

function pVide() {
  return { p: ['Normal', ''] };
}

function pImage(nomImage) {
  return { p: ['Normal', ''], image: nomImage || 'figure.png' };
}

const CHAMPS_TEST = ['Légende : Une figure de test', 'Texte alternatif : Un texte alternatif',
  'Crédit : Photographe X', 'Source : Archives Y'];

test('pronto-lire.py : nouvelle forme, distance 1 — clés puis image directement : reconnu', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('21-nouvelle-d1', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([]),
      ...clesAbbTab(CHAMPS_TEST),
      pImage()
    ]
  });
  assert.strictEqual(vu.stats.blocs.length, 1, 'le bloc nouvelle forme n’a pas été trouvé : '
    + JSON.stringify(vu.stats.blocs));
  const b = vu.stats.blocs[0];
  assert.strictEqual(b.nature, 'image');
  assert.strictEqual(b.legende, 'Une figure de test');
  assert.strictEqual(b.consommee, true);
  assert.deepStrictEqual(
    vu.avertissements.filter((l) => l.indexOf('bloc-cles-sans-contenu') !== -1), [],
    'un bloc bien formé à distance 1 ne devrait jamais avertir de contenu absent : '
    + vu.avertissements.join(' / '));
});

test('pronto-lire.py : nouvelle forme, distance 2 — un paragraphe vide toléré entre les clés et l’image', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('22-nouvelle-d2', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([]),
      ...clesAbbTab(CHAMPS_TEST),
      pVide(),
      pImage()
    ]
  });
  assert.strictEqual(vu.stats.blocs.length, 1,
    'le bloc à distance 2 (un vide toléré) n’a pas été reconnu : ' + JSON.stringify(vu.stats.blocs));
  assert.strictEqual(vu.stats.blocs[0].nature, 'image');
});

test('pronto-lire.py : nouvelle forme, distance 3 (deux vides) — NON reconnu, avertit, rien ne se perd', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('23-nouvelle-d3', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([]),
      ...clesAbbTab(CHAMPS_TEST),
      pVide(),
      pVide(),
      pImage()
    ]
  });
  assert.strictEqual(vu.stats.blocs.length, 0,
    'une fenêtre de 3 paragraphes (deux vides) n’aurait pas dû être reconnue : '
    + JSON.stringify(vu.stats.blocs));
  const ligne = vu.avertissements.find((l) => l.indexOf('bloc-cles-sans-contenu') !== -1);
  assert.ok(ligne, 'aucun avertissement pour la fenêtre trop large : ' + vu.avertissements.join(' / '));
  assert.ok(ligne.indexOf('Une figure de test') !== -1,
    'la légende annoncée n’apparaît pas dans l’avertissement : ' + ligne);
});

test('pronto-lire.py : nouvelle forme — un vrai paragraphe de corps interposé arrête la fenêtre net', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('23b-corps-interpose', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([]),
      ...clesAbbTab(CHAMPS_TEST),
      { p: ['Normal', 'Un paragraphe de corps bien réel, pas une fausse manipulation.'] },
      pImage()
    ]
  });
  assert.strictEqual(vu.stats.blocs.length, 0,
    'un paragraphe de corps réel n’aurait jamais dû être traversé : ' + JSON.stringify(vu.stats.blocs));
  const ligne = vu.avertissements.find((l) => l.indexOf('bloc-cles-sans-contenu') !== -1);
  assert.ok(ligne, 'aucun avertissement malgré la fenêtre cassée : ' + vu.avertissements.join(' / '));
});

test('pronto-lire.py : nouvelle forme — clés sans aucun contenu nulle part dans le document', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('24-cles-sans-contenu', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([]),
      ...clesAbbTab(CHAMPS_TEST)
    ]
  });
  assert.strictEqual(vu.stats.blocs.length, 0);
  const ligne = vu.avertissements.find((l) => l.indexOf('bloc-cles-sans-contenu') !== -1);
  assert.ok(ligne, 'aucun avertissement pour des clés sans le moindre contenu : '
    + vu.avertissements.join(' / '));
});

test('pronto-lire.py : nouvelle forme — bloc tableau reconnu, mais SANS ligne T (rien à faire sauter)', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('25-nouvelle-table', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([]),
      ...clesAbbTab(CHAMPS_TEST),
      { tbl: TABLEAU_INTERNE }
    ]
  });
  assert.strictEqual(vu.stats.blocs.length, 1);
  const b = vu.stats.blocs[0];
  assert.strictEqual(b.nature, 'table');
  assert.strictEqual(b.tbl_interne, true);
  assert.strictEqual(b.consommee, true);
  // Différence assumée avec l'ancienne forme (voir TODO-BRANCHEMENT-PARSER-V2.md) : le
  // tableau n'est plus enveloppé, rien ne doit donc le faire sauter à l'import — seuls les
  // tableaux 1 et 2 (métadonnées, auteurs) sont consommés.
  assert.deepStrictEqual(vu.stats.tableaux_consommes, [1, 2],
    'le tableau de contenu de la nouvelle forme n’aurait pas dû recevoir de ligne T : '
    + JSON.stringify(vu.stats.tableaux_consommes));
  assert.ok(!/^T\t3$/m.test(vu.instructions),
    'une ligne T3 est apparue pour un tableau de contenu qui doit se rendre normalement :\n'
    + vu.instructions);
});

test('pronto-lire.py : un paragraphe SZH Cle ORDINAIRE (pas Abb/Tab) au premier niveau n’est jamais un bloc', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('26-cle-ordinaire', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([]),
      { p: ['SZHCle', 'Légende : ne devrait rien déclencher'] },
      pImage()
    ]
  });
  assert.strictEqual(vu.stats.blocs.length, 0,
    'un SZH Cle ordinaire hors des deux tableaux fixes a pourtant été pris pour un bloc : '
    + JSON.stringify(vu.stats.blocs));
  assert.deepStrictEqual(
    vu.avertissements.filter((l) => l.indexOf('bloc-cles-sans-contenu') !== -1), [],
    'un SZH Cle ordinaire ne devrait même pas être tenté comme bloc : '
    + vu.avertissements.join(' / '));
});

test('pronto-lire.py : ancienne forme (tableau enveloppe) toujours lue, mais avec l’avertissement de conversion', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('27-ancienne-forme-avertit', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([]),
      {
        tbl: [
          ligneBlocMeta(CHAMPS_TEST),
          ligneBlocContenuTable(TABLEAU_INTERNE)
        ]
      }
    ]
  });
  const ligne = vu.avertissements.find((l) => l.indexOf('bloc-ancienne-forme') !== -1);
  assert.ok(ligne, 'aucun avertissement pour l’ancienne forme : ' + vu.avertissements.join(' / '));
  assert.strictEqual(vu.stats.blocs.length, 1);
  assert.strictEqual(vu.stats.blocs[0].nature, 'table');
});

// ---- 22. Test différentiel : même bloc logique, ancienne et nouvelle forme, même sortie ---
//
// C'est le contrôle demandé par le contrat (§5.3, révision du 21.09.2026) : la fiche, les
// lignes B/BT et stats.blocs doivent être IDENTIQUES pour le même bloc logique, quelle que
// soit la forme d'entrée — SAUF la ligne T (voir le test 25 ci-dessus : la nouvelle forme n'a
// justement plus de tableau enveloppe à faire sauter, une différence assumée et documentée).

test('pronto-lire.py : test différentiel — même bloc, ancienne et nouvelle forme, même stats.blocs', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const specBase = (blocBody) => ({
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([]),
      ...blocBody
    ]
  });

  const vuAncienne = importer('28a-differentiel-ancienne', specBase([{
    tbl: [ligneBlocMeta(CHAMPS_TEST), ligneBlocContenuTable(TABLEAU_INTERNE)]
  }]));
  const vuNouvelle = importer('28b-differentiel-nouvelle', specBase([
    ...clesAbbTab(CHAMPS_TEST),
    { tbl: TABLEAU_INTERNE }
  ]));

  assert.deepStrictEqual(vuNouvelle.stats.blocs, vuAncienne.stats.blocs,
    'stats.blocs diffère entre l’ancienne et la nouvelle forme pour le même bloc logique :\n'
    + 'ancienne=' + JSON.stringify(vuAncienne.stats.blocs) + '\nnouvelle='
    + JSON.stringify(vuNouvelle.stats.blocs));

  const sansSource = (fiche) => (fiche || '').split(/\r?\n/)
    .filter((l) => l.indexOf('source:') !== 0).join('\n');
  assert.strictEqual(sansSource(vuNouvelle.fiche), sansSource(vuAncienne.fiche),
    'la fiche (hors ligne source:) diffère entre l’ancienne et la nouvelle forme');

  // Depuis le 22.09.2026, plus aucune divergence de lignes T : ni l'une ni l'autre forme ne
  // consomme de tableau de bloc — seuls les deux tableaux fixes de la tête s'en vont. C'est ce
  // qui rend impossible la perte du tableau interne d'un bloc tableau à l'ancienne forme.
  assert.deepStrictEqual(vuAncienne.stats.tableaux_consommes, [1, 2]);
  assert.deepStrictEqual(vuNouvelle.stats.tableaux_consommes, [1, 2]);

  // Ce qui, lui, diverge toujours et doit diverger : la nouvelle forme fait retirer du corps
  // ses quatre paragraphes de clé (lignes P) et pose ses champs sur le contenu (ligne FT),
  // quand l'ancienne laisse son tableau enveloppe s'imprimer tel quel.
  assert.match(vuNouvelle.instructions, /^FT\t3\t/m,
    'la nouvelle forme doit poser ses champs sur son tableau');
  assert.strictEqual((vuNouvelle.instructions.match(/^P\t/gm) || []).length, 4,
    'les quatre paragraphes de clé doivent quitter le corps');
  assert.doesNotMatch(vuAncienne.instructions, /^(P|FT|FI)\t/m,
    'l’ancienne forme ne fait rien retirer et ne pose rien');
});

test('pronto-lire.py : un bloc bien formé (2 rangées) ne déclenche jamais bloc-mal-forme', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('20-bien-forme', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
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

// ---- 29. Clés tolérantes : une étiquette mal tapée est reconnue avec un score de proximité,
//          jamais en silence -----------------------------------------------------------------
//
// aplatir() (déjà dans ce module, utilisé pour les VALEURS) retire tous les accents : avant ce
// mécanisme, « Resumé » et « Résumé » lui donnaient déjà la même clé, sans avertissement — le
// silence que la demande vise à remplacer par un avertissement `cle-approximee` (ou
// `cle-ambigue` en cas d'égalité entre deux clés). Voir identifier_cle()/CANON_* dans
// pronto_modele.py.

function cleApproximee(vu) {
  return vu.avertissements.filter((l) => l.indexOf('cle-approximee') !== -1);
}
function cleAmbigue(vu) {
  return vu.avertissements.filter((l) => l.indexOf('cle-ambigue') !== -1);
}

test('pronto-lire.py : « Resumé (FR) » (accent oublié) est reconnu comme Résumé, avec un avertissement de proximité', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('30-resume-accent', {
    styles: STYLES_BASE,
    body: [
      tableMeta([
        ligneMeta('Resumé (FR)', 'Un résumé de test suffisamment long.')
      ]),
      tableAuteurs([])
    ]
  });
  assert.match(vu.fiche, /resume:\n {2}fr: "Un résumé de test suffisamment long\."/,
    'le résumé mal accentué n’a pas été repris dans la fiche : ' + vu.fiche);
  const lignes = cleApproximee(vu);
  assert.strictEqual(lignes.length, 1, 'un seul avertissement cle-approximee attendu : '
    + vu.avertissements.join(' / '));
  assert.ok(lignes[0].indexOf('Resumé') !== -1 && lignes[0].indexOf('Résumé') !== -1,
    'la clé fautive et la clé reconnue ne sont pas toutes deux citées : ' + lignes[0]);
});

test('pronto-lire.py : « résumé (fr) : » (minuscules, sans espace avant les deux-points) est exact — aucun avertissement', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('30b-resume-minuscule', {
    styles: STYLES_BASE,
    body: [
      tableMeta([
        ligneMeta('résumé (fr)', 'Un résumé de test suffisamment long.')
      ]),
      tableAuteurs([])
    ]
  });
  assert.match(vu.fiche, /resume:\n {2}fr: "Un résumé de test suffisamment long\."/);
  assert.deepStrictEqual(cleApproximee(vu), [],
    'la casse seule est déjà tolérée par ailleurs, elle ne doit jamais avertir : '
    + vu.avertissements.join(' / '));
});

test('pronto-lire.py : « Prenom : » (accent oublié) est reconnu comme Prénom, avec un avertissement de proximité', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('31-prenom-accent', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([ligneAuteur(['Prenom : Jeanne', 'Nom : Dupont', 'Email : j@ex.ch'])])
    ]
  });
  assert.match(vu.fiche, /- prenom: "Jeanne"/, 'le prénom mal accentué n’a pas été repris : ' + vu.fiche);
  const lignes = cleApproximee(vu);
  assert.strictEqual(lignes.length, 1, 'un seul avertissement cle-approximee attendu : '
    + vu.avertissements.join(' / '));
  assert.ok(lignes[0].indexOf('Prenom') !== -1 && lignes[0].indexOf('Prénom') !== -1, lignes[0]);
});

test('pronto-lire.py : « E-mail : » (variante avec trait d’union) est reconnu comme Email, avec un avertissement', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('32-e-mail', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([ligneAuteur(['Prénom : Ana', 'Nom : Rossi', 'E-mail : ana.rossi@ex.ch'])])
    ]
  });
  assert.match(vu.fiche, /email: "ana\.rossi@ex\.ch"/, 'l’email n’a pas été repris : ' + vu.fiche);
  const lignes = cleApproximee(vu);
  assert.strictEqual(lignes.length, 1, 'un seul avertissement cle-approximee attendu : '
    + vu.avertissements.join(' / '));
  assert.ok(lignes[0].indexOf('E-mail') !== -1 && lignes[0].indexOf('Email') !== -1, lignes[0]);
});

test('pronto-lire.py : « Mots clefs / Keywords / Motsclés / Schlagwörter » sont reconnus comme Mots-clés — champ sans destination, mais compris', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  for (const [i, libelle] of ['Mots clefs', 'Keywords', 'Motsclés', 'Schlagwörter'].entries()) {
    const vu = importer('33-' + i + '-motscles', {
      styles: STYLES_BASE,
      body: [
        tableMeta([
          ligneMeta(libelle, 'inclusion, école')
        ]),
        tableAuteurs([])
      ]
    });
    const approx = cleApproximee(vu);
    assert.strictEqual(approx.length, 1,
      '« ' + libelle + ' » : un avertissement cle-approximee attendu (reconnu comme Mots-clés) : '
      + vu.avertissements.join(' / '));
    assert.ok(approx[0].indexOf('Mots-clés') !== -1,
      '« ' + libelle + ' » : la clé reconnue « Mots-clés » n’est pas citée : ' + approx[0]);
    // Mots-clés reste un champ SANS destination (voir CANON_METADONNEES) : la ligne reste
    // signalée comme inconnue, exactement comme aujourd'hui — et surtout n'écrit JAMAIS de
    // mot-clé dans la fiche (contrat existant, inchangé).
    const inconnue = vu.avertissements.filter((l) => l.indexOf('etiquette-metadonnees-inconnue') !== -1);
    assert.strictEqual(inconnue.length, 1,
      '« ' + libelle + ' » devrait aussi rester une étiquette sans destination : '
      + vu.avertissements.join(' / '));
    // Reconnue (score 1,0) mais sans destination + une valeur réelle ("inclusion, école") :
    // c'est justement le contenu qui serait perdu si l'import continuait — ça bloque tout.
    assert.strictEqual(vu.bloquant, true, '« ' + libelle + ' », à valeur réelle, aurait dû bloquer l’import');
    assert.strictEqual(vu.fiche, null, '« ' + libelle + ' » : rien n’aurait dû être écrit : ' + vu.fiche);
  }
});

test('pronto-lire.py : « Résultats : » ne devient jamais Résumé — score mesuré 0,571, sous le seuil', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('34-resultats', {
    styles: STYLES_BASE,
    body: [
      tableMeta([
        ligneMeta('Résultats', 'Un contenu qui ne doit jamais devenir un résumé.')
      ]),
      tableAuteurs([])
    ]
  });
  assert.deepStrictEqual(cleApproximee(vu), [], '« Résultats » n’aurait dû reconnaître aucune clé : '
    + vu.avertissements.join(' / '));
  assert.deepStrictEqual(cleAmbigue(vu), []);
  const inconnue = vu.avertissements.find((l) => l.indexOf('etiquette-metadonnees-inconnue') !== -1);
  assert.ok(inconnue, '« Résultats » devrait rester une étiquette inconnue : '
    + vu.avertissements.join(' / '));
  // Non reconnue, ET porteuse d'un contenu réel : bloque tout l'import (rien n'est écrit —
  // « Résultats » ne devient donc, entre autres, jamais un résumé).
  assert.strictEqual(vu.bloquant, true, '« Résultats », à valeur réelle, aurait dû bloquer l’import');
  assert.strictEqual(vu.fiche, null, 'rien n’aurait dû être écrit : ' + vu.fiche);
  const cles = vu.stats.cles_non_reconnues || [];
  assert.ok(cles.some((c) => c.texte === 'Résultats'),
    '« Résultats » n’apparaît pas dans les clés non reconnues : ' + JSON.stringify(cles));
});

test('pronto-lire.py : « Nom de la revue : » ne devient jamais Nom — et, portant un contenu réel, bloque tout l’import', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('35-nom-revue', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([ligneAuteur(['Nom de la revue : Revue suisse', 'Prénom : Ida', 'Nom : Keller'])])
    ]
  });
  assert.deepStrictEqual(cleApproximee(vu), [], '« Nom de la revue » n’aurait dû reconnaître aucune clé : '
    + vu.avertissements.join(' / '));
  // Une clé présente avec un contenu réel (« Revue suisse ») qu'on ne saurait où ranger bloque
  // tout l'import — même la ligne d'à côté, parfaitement renseignée (Ida Keller), n'est donc
  // PAS écrite : rien n'est importé à moitié.
  assert.strictEqual(vu.bloquant, true, '« Nom de la revue », à valeur réelle, aurait dû bloquer l’import');
  assert.strictEqual(vu.fiche, null, 'rien n’aurait dû être écrit : ' + vu.fiche);
  const cles = vu.stats.cles_non_reconnues || [];
  assert.ok(cles.some((c) => c.texte === 'Nom de la revue'),
    '« Nom de la revue » n’apparaît pas dans les clés non reconnues : ' + JSON.stringify(cles));
});

test('pronto-lire.py : « Légende » (insécable) et « Texte  alternatif » (double espace) sont déjà exacts au passage par normaliser() — aucun avertissement', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  // L'insécable et le double espace sont déjà écrasés par pm.normaliser(), appliqué par
  // pronto_docx.py à CHAQUE paragraphe avant que ce module ne le voie (voir l'en-tête de
  // pronto_modele.py) : du point de vue des clés tolérantes, ces deux étiquettes arrivent
  // donc déjà identiques au gabarit — les « sauf pour l'exact » de la demande.
  const champs = ['Légende : Une figure de test', 'Texte  alternatif : Un texte alternatif',
    'Crédit : Photographe X', 'Source : Archives Y'];
  const vu = importer('36-legende-nbsp', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([]),
      ...clesAbbTab(champs),
      pImage()
    ]
  });
  assert.strictEqual(vu.stats.blocs.length, 1, 'le bloc n’a pas été reconnu : '
    + JSON.stringify(vu.stats.blocs));
  assert.strictEqual(vu.stats.blocs[0].legende, 'Une figure de test');
  assert.deepStrictEqual(cleApproximee(vu), [],
    'insécable et double espace sont déjà lissés en amont, ils ne devraient jamais avertir : '
    + vu.avertissements.join(' / '));
});

test('pronto-lire.py : une clé beaucoup trop longue (> 40 signes avant les deux-points) reste une étiquette de bloc inconnue', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const etiquetteLongue = 'Ceci est une étiquette beaucoup trop longue pour être une vraie clé';
  assert.ok(etiquetteLongue.length > 40, 'l’étiquette de test doit dépasser 40 signes');
  const vu = importer('37-cle-trop-longue', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([]),
      ...clesAbbTab([etiquetteLongue + ' : une valeur quelconque']),
      pImage()
    ]
  });
  assert.deepStrictEqual(cleApproximee(vu), [],
    'une étiquette trop longue n’aurait jamais dû être scorée : ' + vu.avertissements.join(' / '));
  assert.deepStrictEqual(cleAmbigue(vu), []);
  const ligne = vu.avertissements.find((l) => l.indexOf('bloc-etiquette-inconnue') !== -1);
  assert.ok(ligne, 'l’étiquette trop longue devrait rester une étiquette de bloc inconnue : '
    + vu.avertissements.join(' / '));
  // Non reconnue, avec une valeur réelle (« une valeur quelconque ») : bloque tout l'import.
  assert.strictEqual(vu.bloquant, true, 'une clé trop longue à valeur réelle aurait dû bloquer l’import');
  assert.strictEqual(vu.fiche, null, 'rien n’aurait dû être écrit : ' + vu.fiche);
});

// Le test ci-dessus passe déjà SANS le garde-fou de longueur : une phrase de corps aussi
// longue n'atteint de toute façon jamais SEUIL_CLE contre une clé attendue courte (mesuré :
// le ratio de SequenceMatcher est plafonné par 2*min(longueurs)/(somme des longueurs), qui ne
// peut pas dépasser ~0,45 dès que le candidat fait deux fois la longueur de la clé la plus
// longue du vocabulaire réel). Le garde-fou de LONGUEUR_ETIQUETTE_SCORE est donc une défense
// en profondeur pour le jour où un alias plus long serait ajouté — il faut l'éprouver seul,
// avec une table jetable, pour prouver qu'il coupe AVANT le score et pas seulement grâce à
// lui (patron identique au test d'ambiguïté ci-dessous).
test('identifier_cle() : une étiquette de plus de 40 signes est jamais scorée, même contre une clé qui lui ressemblerait', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const script = [
    'import sys',
    'sys.path.insert(0, "' + path.join(RACINE, 'pipeline').replace(/\\/g, '\\\\') + '")',
    'import pronto_modele as pm',
    'table = {"x": ("A" * 50,)}',
    '# 45 signes, quasi identique à la forme canonique (50 A) — un score écrasant sans le',
    '# garde-fou de longueur (45 > pm.LONGUEUR_ETIQUETTE_SCORE == 40).',
    'candidat = "A" * 45',
    'assert len(candidat) > pm.LONGUEUR_ETIQUETTE_SCORE, "le candidat de test doit dépasser le seuil"',
    'r = pm.identifier_cle(candidat, table)',
    'assert r is None, "une étiquette trop longue a quand même été scorée : " + repr(r)',
    'print("OK")'
  ].join('\n');
  const r = python(['-c', script]);
  assert.strictEqual(r.status, 0, 'identifier_cle() a échoué : ' + r.stderr);
  assert.strictEqual(r.stdout.trim(), 'OK');
});

test('pronto-lire.py : un paragraphe SZH Cle Abb/Tab sans aucun deux-points n’est jamais scoré', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('38-sans-deux-points', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([]),
      ...clesAbbTab(['Ceci n’a pas la forme Étiquette deux-points valeur']),
      pImage()
    ]
  });
  assert.deepStrictEqual(cleApproximee(vu), []);
  assert.deepStrictEqual(cleAmbigue(vu), []);
});

// La clé ambiguë n'a pas de paire naturelle dans le vocabulaire réel du gabarit au-dessus de
// SEUIL_CLE (mesuré : les deux meilleures clés restent toujours loin l'une de l'autre — voir
// le rapport) ; ce test appelle donc identifier_cle() directement, sur une table jetable, pour
// prouver le MÉCANISME général d'ambiguïté (le même qui protège CANON_METADONNEES /
// CANON_AUTEUR / CANON_FIGURE) — c'est le même patron que le test decoder_nom_style() plus haut.
test('identifier_cle() : deux clés à égale distance ne sont jamais retenues — ambiguïté', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const script = [
    'import sys',
    'sys.path.insert(0, "' + path.join(RACINE, 'pipeline').replace(/\\/g, '\\\\') + '")',
    'import pronto_modele as pm',
    'table = {"un": ("Bonjour",), "deux": ("Bonjeur",)}',
    'r = pm.identifier_cle("Bonjur", table)',
    'assert r is not None, "aucune clé retenue du tout : " + repr(r)',
    'assert r[0] == "__ambigu__", "aurait dû être ambigu : " + repr(r)',
    'assert set(r[1:3]) == {"un", "deux"}, repr(r)',
    'print("OK")'
  ].join('\n');
  const r = python(['-c', script]);
  assert.strictEqual(r.status, 0, 'identifier_cle() a échoué : ' + r.stderr);
  assert.strictEqual(r.stdout.trim(), 'OK');
});

// ---- 30. Clé attendue absente / clé présente mais vide — informations, jamais bloquant -----
//
// Précision de Robin (22.09.2026), en plus des clés tolérantes : une clé PRÉSENTE mais NON
// reconnue (score sous le seuil, ou ambiguë) bloque tout l'import (voir les tests plus haut qui
// vérifient déjà vu.bloquant). Une clé ATTENDUE mais ABSENTE du document, ou présente mais VIDE
// (rien ou seulement des espaces après le deux-points), est une simple information
// (`cle-attendue-absente`) : jamais bloquante, sa valeur n'est jamais écrite. Ces informations
// sont mises à part dans vu.info par importer() (voir sa définition), pour ne pas casser les
// tests plus anciens qui ne les attendaient pas.

test('pronto-lire.py : une clé attendue absente du document est une simple information, jamais bloquante', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('40-absente', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),   // type/titre/soustitre/résumé : jamais posés
      tableAuteurs([])
    ]
  });
  assert.strictEqual(vu.bloquant, false, 'une clé simplement absente n’aurait jamais dû bloquer l’import');
  for (const canon of ["Type d'article", 'Titre', 'Sous-titre', 'Résumé']) {
    const ligne = vu.info.find((l) => l.indexOf('clé « ' + canon + ' »') !== -1);
    assert.ok(ligne, '« ' + canon + ' » absent aurait dû produire une information : '
      + vu.info.join(' / '));
  }
  // « Langue de l'article », elle, a été renseignée : elle ne doit PAS apparaître comme absente.
  assert.ok(!vu.info.some((l) => l.indexOf('Langue') !== -1),
    '« Langue de l\'article », pourtant renseignée, apparaît comme absente : ' + vu.info.join(' / '));
});

test('pronto-lire.py : une clé présente mais vide (espaces seuls) est traitée comme absente — jamais approximée, jamais bloquante', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('41-vide', {
    styles: STYLES_BASE,
    body: [
      tableMeta([
        ligneMeta('Resumé (FR)', '   ')            // clé mal tapée EN PLUS vide : ne compte que comme absente
      ]),
      tableAuteurs([])
    ]
  });
  assert.strictEqual(vu.bloquant, false, 'une clé vide n’aurait jamais dû bloquer l’import');
  assert.deepStrictEqual(vu.avertissements.filter((l) => l.indexOf('cle-approximee') !== -1), [],
    'une clé vide, même mal tapée, ne doit jamais être approximée : ' + vu.avertissements.join(' / '));
  assert.ok(!/resume:/.test(vu.fiche || ''), 'un résumé vide a quand même été écrit : ' + vu.fiche);
  const ligne = vu.info.find((l) => l.indexOf('clé « Résumé »') !== -1);
  assert.ok(ligne, 'le résumé laissé vide aurait dû apparaître comme absent : ' + vu.info.join(' / '));
});

test('pronto-lire.py : un auteur — un champ facultatif laissé vide est une information, jamais bloquant', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('42-auteur-vide', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([ligneAuteur(['Prénom : Ida', 'Nom : Keller', 'ROR : ', 'Email : ida@ex.ch'])])
    ]
  });
  assert.strictEqual(vu.bloquant, false, 'un champ auteur vide n’aurait jamais dû bloquer l’import');
  assert.match(vu.fiche, /- prenom: "Ida"/, 'l’auteur bien renseigné n’a pas été écrit : ' + vu.fiche);
  const ligne = vu.info.find((l) => l.indexOf('clé « ROR »') !== -1);
  assert.ok(ligne, 'le ROR laissé vide aurait dû apparaître comme absent : ' + vu.info.join(' / '));
  assert.ok(!/ror:/.test(vu.fiche), 'un ROR vide a quand même été écrit : ' + vu.fiche);
});

test('pronto-lire.py : un bloc — un champ laissé vide est une information, jamais bloquant', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('43-bloc-vide', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([]),
      ...clesAbbTab(['Légende : Une figure de test', 'Texte alternatif : Un texte alternatif',
        'Crédit : Photographe X', 'Source :   ']),
      pImage()
    ]
  });
  assert.strictEqual(vu.bloquant, false, 'un champ de bloc vide n’aurait jamais dû bloquer l’import');
  assert.strictEqual(vu.stats.blocs.length, 1, 'le bloc n’a pas été reconnu : '
    + JSON.stringify(vu.stats.blocs));
  const ligne = vu.info.find((l) => l.indexOf('clé « Source »') !== -1);
  assert.ok(ligne, 'la source laissée vide aurait dû apparaître comme absente : ' + vu.info.join(' / '));
});

// ---- 31. Garde-fou mesuré sur le corpus réel : un tableau de contenu ORDINAIRE (style
//          Normal, jamais au gabarit) pris pour celui des métadonnées par la seule position ---
//
// Mesuré sur tmp/corpus-relecture/lot-A (11 manuscrits réels, aucun au gabarit) : 3 documents
// sur 11 ont un tableau de données comme PREMIER tableau du document (ex. « Enregistrement des
// cours | 49 ») — pris pour le tableau des métadonnées par la seule position (piège déjà
// documenté dans TODO-BRANCHEMENT-PARSER-V2.md). Avant la correction de _etiquette_szh_cle()
// (22.09.2026), chaque rangée de ce tableau ORDINAIRE était comparée comme une étiquette — et,
// portant un contenu réel non reconnu, bloquait tout l'import. _etiquette_szh_cle() (et les
// mêmes lieux dans extraire_table_auteurs()/_champs_bloc_meta()) n'acceptent plus qu'un
// paragraphe de style SZH Cle comme candidat.

test('pronto-lire.py : un tableau de contenu ORDINAIRE (style Normal, pas au gabarit) pris pour celui des métadonnées ne bloque jamais l’import', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const tableOrdinaire = {
    tbl: [
      [[['Normal', 'Mesure']], [['Normal', 'Valeur']]],
      [[['Normal', 'Enregistrement des cours']], [['Normal', '49']]],
      [[['Normal', 'Allègement des horaires']], [['Normal', '38']]]
    ]
  };
  const vu = importer('44-table-ordinaire', { styles: STYLES_BASE, body: [tableOrdinaire] });
  assert.strictEqual(vu.bloquant, false,
    'un tableau de contenu ordinaire, pris par position pour celui des métadonnées, a '
    + 'pourtant bloqué l’import : ' + JSON.stringify(vu.stats.cles_non_reconnues || []));
  assert.deepStrictEqual(
    vu.avertissements.filter((l) => l.indexOf('etiquette-metadonnees-inconnue') !== -1), [],
    'un tableau de contenu ordinaire ne devrait même pas produire d’étiquette inconnue : '
    + vu.avertissements.join(' / '));
});

// ---- 32. La langue vient du PRODUIT du numéro, plus jamais du document (22.09.2026) ------
//
// Décision de la rédaction : le champ « Langue de l'article » a quitté le gabarit. La langue
// se déduit de la revue du numéro — Revue = français, Zeitschrift = allemand — et un article
// italien se corrige à la main dans la fiche après l'import. La chaîne pose le jeton dans
// $SZH_PRODUIT (import-docx.sh le lit dans ausgabe.yaml, à la racine du numéro).

const SPEC_NUE = { styles: STYLES_BASE, body: [tableMeta([]), tableAuteurs([])] };

test('pronto-lire.py : la langue de l’article vient de la revue du numéro', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  for (const [produit, attendue] of [['revue', 'fr'], ['zeitschrift', 'de'],
    // Le jeton canonique comme le nom complet de l'ancien ausgabe.yaml, même règle que
    // derive_revue() de szh-maquette.lua.
    ['Schweizerische Zeitschrift für Heilpädagogik', 'de'],
    ['Revue suisse de pédagogie spécialisée', 'fr']]) {
    const vu = importer('45-langue-' + attendue, SPEC_NUE, produit);
    assert.strictEqual(vu.stats.langue, attendue,
      'produit « ' + produit + ' » devrait donner la langue ' + attendue);
    assert.strictEqual(vu.stats.langue_deduite, false,
      'une langue venue du produit n’est pas une devinette');
    assert.match(vu.fiche, new RegExp('^lang: ' + attendue + '$', 'm'));
    assert.deepStrictEqual(
      vu.avertissements.filter((l) => l.indexOf('langue-deduite') !== -1), [],
      'un produit connu ne doit jamais faire avertir d’une langue devinée');
  }
});

test('pronto-lire.py : sans produit (hors numéro), le français est posé — et c’est DIT', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('46-sans-produit', SPEC_NUE, '');
  assert.strictEqual(vu.stats.langue, 'fr', 'le repli doit rester le français');
  assert.strictEqual(vu.stats.langue_deduite, true);
  assert.ok(vu.avertissements.find((l) => l.indexOf('langue-deduite') !== -1),
    'un repli silencieux sur le français serait exactement l’échec muet qu’on refuse : '
    + vu.avertissements.join(' / '));
});

test('pronto-lire.py : un champ « Langue de l’article » resté dans le document avertit, ne bloque pas, et n’impose pas sa langue', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  // Un document rempli avant le 22.09.2026 porte encore la ligne. Elle ne doit NI bloquer
  // l'import (une clé présente non reconnue le ferait), NI décider de la langue — mais elle
  // doit se dire, sans quoi un article italien sortirait en français sans que personne ne
  // l'apprenne.
  const vu = importer('47-langue-heritee', {
    styles: STYLES_BASE,
    body: [
      tableMeta([ligneMeta('Langue de l’article', 'italiano')]),
      tableAuteurs([])
    ]
  }, 'revue');
  assert.strictEqual(vu.bloquant, false,
    'un champ retiré du gabarit ne doit jamais bloquer l’import : '
    + JSON.stringify(vu.stats.cles_non_reconnues || []));
  assert.strictEqual(vu.stats.langue, 'fr',
    'la langue du document ne doit plus l’emporter sur celle du produit');
  assert.ok(vu.avertissements.find((l) => l.indexOf('langue-du-document-ignoree') !== -1),
    'ignorer ce champ sans le dire ferait sortir un article italien en français en silence : '
    + vu.avertissements.join(' / '));
  assert.deepStrictEqual(
    vu.avertissements.filter((l) => l.indexOf('etiquette-metadonnees-inconnue') !== -1), [],
    'la clé reste RECONNUE, elle n’est simplement plus lue');
});

// ---- 33. Les champs d'un bloc atteignent l'image et le tableau ---------------------------
//
// Sans ces instructions, les quatre paragraphes « Légende : », « Texte alternatif : »,
// « Crédit : », « Source : » s'impriment tels quels au milieu de l'article et le texte
// alternatif est perdu — mesuré sur le gabarit réel, chaîne complète, avant le branchement.
// FI (figure) est consommée par szh-legendes.lua, FT (tableau) par docx-tables.py.

test('pronto-lire.py : un bloc figure fait retirer ses clés du corps et pose ses champs sur l’image', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const vu = importer('48-bloc-figure-instructions', {
    styles: STYLES_BASE,
    body: [tableMeta([]), tableAuteurs([]), ...clesAbbTab(CHAMPS_TEST), pImage('figure.png')]
  });
  const pLignes = (vu.instructions.match(/^P\t.*$/gm) || []);
  assert.deepStrictEqual(pLignes.sort(), CHAMPS_TEST.map((c) => 'P\t' + c).sort(),
    'les quatre paragraphes de clé doivent quitter le corps, et eux seuls : '
    + vu.instructions);
  const fi = (vu.instructions.match(/^FI\t.*$/m) || [])[0];
  assert.ok(fi, 'aucune ligne FI : les champs du bloc n’atteindraient pas l’image');
  assert.deepStrictEqual(fi.split('\t'),
    ['FI', 'figure.png', 'Une figure de test', 'Un texte alternatif', 'Photographe X',
      'Archives Y'],
    'la ligne FI ne porte pas les quatre champs dans l’ordre du contrat');
});

test('pronto-lire.py : l’image d’un bloc est nommée par TOUTES ses variantes (aperçu PNG et SVG)', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  // Word range une image vectorielle derrière un aperçu PNG : le lecteur voit le PNG, pandoc
  // écrit le SVG. Un seul nom ferait manquer l'appariement — mesuré sur le gabarit réel, dont
  // la figure sort en media/image2.svg alors que le a:blip pointe media/image1.png.
  const vu = importer('49-bloc-figure-svg', {
    styles: STYLES_BASE,
    body: [tableMeta([]), tableAuteurs([]), ...clesAbbTab(CHAMPS_TEST),
      { p: ['Normal', ''], image: 'apercu.png', imageSvg: 'vraie.svg' }]
  });
  const fi = (vu.instructions.match(/^FI\t([^\t]*)/m) || [])[1];
  assert.strictEqual(fi, 'apercu.png|vraie.svg',
    'les deux noms de l’image doivent être donnés, séparés par « | » : ' + vu.instructions);
});

// ---- 34. Le contrat entre le lecteur et docx-tables.py, de bout en bout ------------------
//
// Le lecteur écrit la ligne FT, docx-tables.py la lit et bake les quatre champs dans
// tables/table-NN.html — sous la forme que szh-numerotation.lua attend à la compilation :
// <caption> pour la légende, data-alt / data-copyright / data-source sur la balise <table>.
// Les deux programmes sont exercés ensemble, sur le MÊME document et le MÊME fichier
// d'instructions : c'est le seul moyen de voir la ligne FT telle qu'elle voyage vraiment.

const DOCX_TABLES = path.join(RACINE, 'pipeline', 'docx-tables.py');

test('pronto-lire.py + docx-tables.py : les champs d’un bloc tableau arrivent dans le HTML du tableau', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const base = dossierJetable();
  try {
    const docx = path.join(base, 'bloc-tableau.docx');
    fabriquerDocx(docx, {
      styles: STYLES_BASE,
      body: [
        tableMeta([]),
        tableAuteurs([]),
        ...clesAbbTab(CHAMPS_TEST),
        { tbl: TABLEAU_INTERNE }
      ]
    });
    const instr = path.join(base, 'instructions.txt');
    const lecture = python([DOCX_PRONTO, docx, 'bloc-tableau', base],
      { SZH_META: instr, SZH_PRODUIT: 'revue' });
    assert.strictEqual(lecture.status, 0, 'le lecteur a échoué : ' + lecture.stderr);

    const dossierTables = path.join(base, 'tables');
    fs.mkdirSync(dossierTables, { recursive: true });
    const rendu = python([DOCX_TABLES, docx, dossierTables], { SZH_META: instr });
    assert.strictEqual(rendu.status, 0, 'docx-tables.py a échoué : ' + rendu.stderr);

    // Les deux tableaux fixes de la tête sont consommés (lignes T) : le tableau du bloc est
    // donc le PREMIER rendu, et il est bien rendu — ne pas le rendre du tout serait la perte
    // silencieuse que tout ce mécanisme existe pour empêcher.
    const html = fs.readFileSync(path.join(dossierTables, 'table-01.html'), 'utf8');
    assert.match(html, /<caption>Une figure de test<\/caption>/,
      'la légende du bloc n’a pas été bakée dans le <caption> : ' + html);
    assert.match(html, /data-alt="Un texte alternatif"/,
      'le texte alternatif n’atteint pas le tableau : ' + html);
    assert.match(html, /data-copyright="Photographe X"/, 'le crédit n’atteint pas le tableau : ' + html);
    assert.match(html, /data-source="Archives Y"/, 'la source n’atteint pas le tableau : ' + html);
    assert.match(html, /Groupe A/, 'le contenu du tableau a été perdu : ' + html);
    assert.ok(!fs.existsSync(path.join(dossierTables, 'table-02.html')),
      'un second tableau a été rendu : les deux tableaux de la tête auraient dû être sautés');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---- 35. Les rangs de titre au-delà du troisième (gabarit v3, 22.09.2026) ----------------
//
// Le gabarit porte un « Titre niveau 4 » depuis sa v3. Le lecteur ne s'en servait pas : son
// motif de rang s'arrêtait à 3, alors que famille() classait DÉJÀ « Titre 4 » en 'heading' —
// les deux se contredisaient. Ce que ça coûtait : une bibliographie intitulée en rang 4
// n'était pas détachée, sa liste restait dans le corps et l'export OJS partait sans
// références. C'est le LEXIQUE des titres qui doit trancher, jamais le rang.
//
// (Le rang lui-même ne voyage pas dans les instructions : c'est pandoc qui lit le style Word
// et écrit « #### » dans le .md, puis szh-niveaux.lua qui compacte le corps entre <h2> et
// <h6>. Ce contrôle vise donc le seul endroit où le lecteur, lui, regarde le rang.)

test('pronto-lire.py : une bibliographie intitulée en rang 4 est détachée comme les autres', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const stylesH4 = STYLES_BASE.concat([['H4', 'heading 4']]);
  const vu = importer('50-biblio-rang-4', {
    styles: stylesH4,
    body: [
      tableMeta([]),
      tableAuteurs([]),
      { p: ['Normal', 'Un paragraphe de corps, avant la bibliographie.'] },
      { p: ['H4', 'Références'] },
      { p: ['Normal', 'Flavell, J. H. (1976). Metacognitive aspects of problem-solving.'] },
      { p: ['Normal', 'Vygotski, L. S. (1934). Pensée et langage.'] }
    ]
  });
  assert.strictEqual(vu.stats.biblio.voie, 'titre',
    'un titre de bibliographie en rang 4 n’a pas été reconnu : ' + JSON.stringify(vu.stats.biblio));
  assert.strictEqual(vu.stats.biblio.paragraphes, 2,
    'les entrées n’ont pas été comptées : ' + JSON.stringify(vu.stats.biblio));
});

// ---- 36. Clés tolérantes : ce que le gabarit admet, et ce qu'il doit refuser -------------
//
// Deux mécanismes travaillent ensemble, et il ne faut pas les confondre :
//
//   * les ALIAS (CANON_*) reconnaissent à coup sûr les formes qu'on sait que la rédaction
//     tape — la forme sans accent, les synonymes, l'italien. C'est eux qui font le gros du
//     travail, et c'est là qu'on ajoute un cas nouveau ;
//   * le SEUIL de proximité (SEUIL_CLE, 0,75 depuis le 22.09.2026) rattrape ce que personne
//     n'avait prévu — une lettre en trop, deux lettres inversées.
//
// Ce qui est en jeu : une clé PRÉSENTE non reconnue REFUSE l'import en entier. Un faux négatif
// coûte donc un aller-retour à l'autrice ; un faux POSITIF, lui, range une valeur dans le
// mauvais champ, et ça ne se voit pas. Les deux contrôles ci-dessous tiennent les deux bouts.

function mesurerCle(etiquette, table) {
  const script = [
    'import json, sys',
    'sys.path.insert(0, ' + JSON.stringify(path.join(RACINE, 'pipeline')) + ')',
    'import pronto_modele as pm',
    'seuil = pm.SEUIL_CLE',
    'pm.SEUIL_CLE = 0.0',   // 0 : on veut le score brut, pas le verdict
    'r = pm.identifier_cle(sys.argv[2], getattr(pm, sys.argv[1]))',
    // ⚠ identifier_cle() rend DEUX formes : (jeton, score, exact), et
    //   ('__ambigu__', jeton1, jeton2, score1, score2) quand les deux meilleures clés se
    //   tiennent. Lire r[1] comme un score dans le second cas rend un JETON — une chaîne, qui
    //   fait passer toute comparaison numérique à NaN, donc au vert par accident.
    'if r is None:',
    '    sortie = {"jeton": None, "score": 0.0}',
    'elif r[0] == "__ambigu__":',
    '    sortie = {"jeton": "__ambigu__", "score": r[3]}',
    'else:',
    '    sortie = {"jeton": r[0], "score": r[1]}',
    'sortie["seuil"] = seuil',
    'print(json.dumps(sortie))'
  ].join('\n');
  const r = python(['-c', script, table, etiquette]);
  assert.strictEqual(r.status, 0, 'mesure du score impossible : ' + r.stderr);
  return JSON.parse(r.stdout);
}

test('clés tolérantes : tout ce que la rédaction tape vraiment est reconnu, sur la bonne clé', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  // Trois familles : la forme sans accent (c'est celle qui tombait sous le seuil — perdre deux
  // accents suffit), les synonymes de réflexe, et les fautes de frappe. « Legandes » est la
  // faute qu'a réellement portée la v3 du gabarit.
  const attendus = [
    // sans accent
    ['CANON_METADONNEES', 'Resume', 'resume'], ['CANON_FIGURE', 'Legende', 'legende'],
    ['CANON_AUTEUR', 'Prenom', 'prenom'], ['CANON_FIGURE', 'Credit', 'credit'],
    // synonymes de réflexe
    ['CANON_FIGURE', 'Copyright', 'credit'], ['CANON_FIGURE', 'Description', 'alt'],
    ['CANON_FIGURE', 'Provenance', 'source'], ['CANON_AUTEUR', 'Poste', 'fonction'],
    ['CANON_AUTEUR', 'Adresse e-mail', 'email'], ['CANON_AUTEUR', 'Nom de famille', 'nom'],
    // italien, aux côtés du français et de l'allemand
    ['CANON_METADONNEES', 'Riassunto', 'resume'], ['CANON_METADONNEES', 'Titolo', 'titre'],
    // fautes de frappe, rattrapées par le seuil
    ['CANON_AUTEUR', 'Prenoom', 'prenom'], ['CANON_AUTEUR', 'Fontion', 'fonction'],
    ['CANON_AUTEUR', 'Instituion', 'affiliation'], ['CANON_FIGURE', 'Sourse', 'source'],
    ['CANON_FIGURE', 'Legandes', 'legende'], ['CANON_METADONNEES', 'Resumé', 'resume']
  ];
  for (const [table, etiquette, jetonAttendu] of attendus) {
    const { jeton, score, seuil } = mesurerCle(etiquette, table);
    assert.strictEqual(jeton, jetonAttendu,
      '« ' + etiquette + ' » devrait se lire « ' + jetonAttendu + ' » (lue « ' + jeton
      + ' », score ' + score.toFixed(3) + ') — une clé non reconnue REFUSE l’import');
    assert.ok(score >= seuil,
      '« ' + etiquette + ' » passe sous le seuil (' + score.toFixed(3) + ' < ' + seuil + ')');
  }
});

test('clés tolérantes : une étiquette étrangère au gabarit reste sous le seuil, avec de la marge', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  // Des étiquettes qu'on rencontre pour de vrai — dans un tableau de contenu, dans la fiche
  // d'un autre gabarit — et qui ne doivent JAMAIS être prises pour un champ Pronto.
  const etrangeres = [
    ['CANON_AUTEUR', 'Photo'], ['CANON_AUTEUR', 'Biographie'], ['CANON_AUTEUR', 'Adresse'],
    ['CANON_AUTEUR', 'Ville'], ['CANON_AUTEUR', 'Téléphone'],
    ['CANON_METADONNEES', 'Résultats'], ['CANON_METADONNEES', 'Nom de la revue'],
    ['CANON_METADONNEES', 'DOI'], ['CANON_METADONNEES', 'Volume'],
    ['CANON_METADONNEES', 'Rubrique'],
    ['CANON_FIGURE', 'Licence'], ['CANON_FIGURE', 'Cellule 1'], ['CANON_FIGURE', 'Note'],
    ['CANON_FIGURE', 'Tableau']
  ];
  let pire = 0, pireNom = '';
  let seuil = 0;
  for (const [table, etiquette] of etrangeres) {
    const mesure = mesurerCle(etiquette, table);
    seuil = mesure.seuil;
    assert.ok(mesure.score < mesure.seuil,
      '« ' + etiquette + ' » est prise pour « ' + mesure.jeton + ' » (' + mesure.score.toFixed(3)
      + ' ≥ ' + mesure.seuil + ') : sa valeur partirait dans le mauvais champ, en silence');
    if (mesure.score > pire) { pire = mesure.score; pireNom = etiquette; }
  }
  // La plus proche mesurée est « Adresse » à 0,737 — tirée par l'alias allemand
  // « e-mail-adresse », qui est légitime et qu'on garde. 0,013 de marge sous un seuil à 0,75 :
  // c'est peu, et c'est exactement ce que ce contrôle est là pour surveiller. Le jour où
  // quelqu'un rebaisse le seuil, ce message doit tomber avant la production.
  assert.ok(pire < seuil,
    'plus aucune marge : « ' + pireNom + ' » atteint ' + pire.toFixed(3) + ' pour un seuil à '
    + seuil);
  assert.ok(seuil - pire >= 0.01,
    'la marge entre la dernière étiquette étrangère (« ' + pireNom + ' », ' + pire.toFixed(3)
    + ') et le seuil (' + seuil + ') est tombée sous 0,01 : le mécanisme devient un tirage au '
    + 'sort. Posez un alias plutôt que de baisser le seuil.');
});
