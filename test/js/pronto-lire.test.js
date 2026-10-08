// pipeline/pronto-lire.py lit le gabarit « Pronto — modèle d'article v2 » : deux tableaux
// fixes en tête du document (métadonnées, puis autrices et auteurs), et des blocs
// figure/tableau reconnus par leur forme. À la différence de pipeline/docx-meta.py, qui
// devine sur des Word de formes variées, ce lecteur lit une structure imposée : une étiquette
// inconnue, une rangée hors forme ou un contenu absent produisent un avertissement dans les
// deux langues, et aucun texte ne se perd en silence.
//
//   node --test test/js/pronto-lire.test.js
//
// Les .docx sont fabriqués par le test (rien de binaire dans le dépôt), par un script Python
// écrit une fois dans un dossier jetable.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gardes = require('./gardes');
const { sansPython, cheminPython, cheminDepuisPython } = gardes;

const RACINE = path.resolve(__dirname, '..', '..');
const DOCX_PRONTO = path.join(RACINE, 'pipeline', 'pronto-lire.py');

function python(args, env) {
  return gardes.pythonGroupe(args, {
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }, env || {})
  });
}

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-pronto-'));
}

// ---- Fabricant de .docx : styles.xml + document.xml seulement -------------------------
//
// pronto-lire.py ne lit que ces deux entrées du zip. Le fabricant prend une spec JSON
// { styles: [[styleId, nom], ...], body: [bloc, ...] }. Un bloc est { p: [style, texte] }
// (un paragraphe) ou { tbl: [rangée, ...] } (un tableau, rangée = [cellule, ...]). Une
// cellule est soit [[style, texte], ...] (des paragraphes), soit { gridSpan, content } pour
// une cellule fusionnée (w:gridSpan), où `content` mêle des [style, texte] et des
// { tbl: [...] } (un tableau imbriqué dans la cellule).

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

// Styles présents dans tout document fabriqué. Les styles maison sont reconnus par leur nom,
// pas par leur styleId : d'où l'écart entre l'id "SZHCle" et le nom « SZH Cle ».
// « SZH Cle Abb/Tab » porte les clés des blocs figure/tableau à la nouvelle forme.
const STYLES_BASE = [
  ['SZHCle', 'SZH Cle'], ['SZHAide', 'SZH Aide'], ['Normal', 'Normal'],
  ['SZHCleAbbTab', 'SZH Cle Abb/Tab']
];

function fabriquerDocx(chemin, spec) {
  const r = python([fabricantePy(), chemin, JSON.stringify(spec)]);
  assert.strictEqual(r.status, 0, 'fabrication du .docx impossible : ' + r.stderr);
}

// Une rangée du tableau des métadonnées : étiquette en SZH Cle (+ SZH Aide facultatif,
// ignoré), valeur en Normal dans la seconde colonne.
function ligneMeta(label, valeur, aide) {
  const col0 = aide ? [['SZHCle', label], ['SZHAide', aide]] : [['SZHCle', label]];
  return [col0, [['Normal', valeur]]];
}

function tableMeta(lignes) {
  const entete = [[['Normal', 'Champ']], [['Normal', 'Valeur']]];
  return { tbl: [entete, ...lignes] };
}

// Une rangée du tableau des auteurs : colonne 0 (photo) vide, un paragraphe SZH Cle par
// ligne fournie (« Prénom : Jeanne », etc.).
function ligneAuteur(lignesTexte) {
  return [[], lignesTexte.map((t) => ['SZHCle', t])];
}

function tableAuteurs(lignes) {
  return { tbl: lignes };
}

// Rangée 0 d'un bloc figure/tableau : une seule cellule, un paragraphe SZH Cle par champ.
function ligneBlocMeta(lignesTexte) {
  return [lignesTexte.map((t) => ['SZHCle', t])];
}

// Rangée 0 étalée sur plusieurs cellules réelles (une fusion w:gridSpan donnerait une seule
// cellule dans le XML) : une cellule vide, puis les quatre paragraphes dans la seconde.
// Vérifie que la lecture ne suppose pas une seule cellule par rangée.
function ligneBlocMetaMultiColonnes(lignesTexte) {
  return [[], lignesTexte.map((t) => ['SZHCle', t])];
}

// Rangée 1 d'un bloc tableau de contenu : le tableau interne suivi d'un paragraphe vide,
// que Word pose toujours après un tableau imbriqué et que le lecteur doit ignorer.
function ligneBlocContenuTable(tableauInterne) {
  return [[{ tbl: tableauInterne }, { p: ['Normal', ''] }]];
}

// Rangée 1 sans contenu reconnu : le paragraphe SZH Aide « {{IMAGE ICI}} » du gabarit, tel
// qu'il reste quand rien n'a été déposé.
function ligneBlocContenuAbsent() {
  return [[['SZHAide', '{{IMAGE ICI}}']]];
}

// n paragraphes portant chacun un w:lastRenderedPageBreak, posés dans le corps (pas dans une
// cellule), pour donner une page connue aux tableaux qui suivent.
function marqueursPage(n) {
  return { marqueurs: n };
}

// Lance pronto-lire.py sur un .docx fabriqué depuis `spec`, et rend { statut, stats, fiche,
// instructions, avertissements, info, bloquant }.
//
// « cle-attendue-absente » (clé attendue absente ou vide, jamais bloquante) va dans `info`
// et non dans `avertissements` : la plupart des fixtures ne renseignent qu'une partie des
// champs, et les assertions qui vérifient qu'aucun autre avertissement n'apparaît
// casseraient. `avertissementsTous` garde tout.
//
// Statut de sortie : 1 signale un import refusé (stats.bloquant, stats.cles_non_reconnues),
// toute autre valeur non nulle est un échec du script.
// `produit` : le jeton `revue:` du numéro, d'où vient la langue de l'article. La chaîne réelle
// le pose dans $SZH_PRODUIT (lu par import-docx.sh à la racine du numéro). Par défaut, les
// contrôles tournent « dans la Revue » ; ceux qui visent la langue passent leur valeur, dont
// '' pour le cas sans numéro.
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

test('docx-pronto.py : un document complet du gabarit donne une fiche juste', { skip: sansPython }, () => {
  const vu = importer('01-complet', SPEC_COMPLET);

  assert.match(vu.fiche, /^type: article$/m, 'type non reconnu : ' + vu.fiche);
  assert.match(vu.fiche, /^lang: fr$/m, 'langue non reconnue : ' + vu.fiche);
  assert.match(vu.fiche, /title:\n {2}fr: "Inclusion scolaire et pratiques enseignantes"/,
    'titre FR mal rangé : ' + vu.fiche);
  assert.match(vu.fiche, /subtitle:\n {2}fr: "Une enquête romande"/,
    'sous-titre FR mal rangé : ' + vu.fiche);
  assert.match(vu.fiche, /resume:\n {2}fr: "Un résumé de test suffisamment long\."/,
    'résumé FR mal rangé : ' + vu.fiche);

  // Deux auteurs, huit champs chacun (schéma CHAMPS_AUTEUR du cockpit, ror compris : le
  // premier auteur en a un, le second l'a laissé vide).
  assert.strictEqual((vu.fiche.match(/^- prenom:/gm) || []).length, 2, 'pas deux auteurs');
  assert.match(vu.fiche, /- prenom: "Jeanne"\n {2}nom: "Dupont"\n {2}fonction: "Chercheuse"\n {2}affiliation: "HEP Vaud"\n {2}ror: "https:\/\/ror\.org\/03xyz1234"\n {2}orcid: "0000-0001-2345-6789"\n {2}email: "jeanne\.dupont@ex\.ch"/,
    'auteur 1 incomplet, mal ordonné, ou le ROR saisi n’a pas été repris : ' + vu.fiche);
  assert.match(vu.fiche, /- prenom: "Marc"\n {2}nom: "Müller"\n {2}fonction: "Professeur"\n {2}affiliation: "PH Zürich"\n {2}email: "marc\.mueller@ex\.ch"/,
    'auteur 2 incomplet ou mal ordonné : ' + vu.fiche);
  // L'auteur 2 n'a pas de ROR (« ROR: » suivi de rien) : aucune ligne `ror:` entre son
  // prénom et son email dans la fiche.
  const blocMarc = vu.fiche.slice(vu.fiche.indexOf('"Marc"'), vu.fiche.indexOf('marc.mueller'));
  assert.ok(!/ {2}ror: /.test(blocMarc),
    'l’auteur 2, qui n’a pas saisi de ROR, en a pourtant un dans la fiche : ' + vu.fiche);
  assert.ok(!/keyword/i.test(vu.fiche), 'un mot-clé est apparu alors qu’aucune rangée n’en porte');

  // Les deux tableaux (métadonnées, auteurs) sont consommés : ils quittent le corps.
  assert.match(vu.instructions, /^T\t1$/m, 'tableau des métadonnées non marqué consommé');
  assert.match(vu.instructions, /^T\t2$/m, 'tableau des auteurs non marqué consommé');
  assert.strictEqual(vu.stats.tableau1_consomme, true);
  assert.strictEqual(vu.stats.tableau2_consomme, true);
});

test('docx-pronto.py : les paragraphes SZH Aide ne finissent jamais dans une valeur', { skip: sansPython }, () => {
  const vu = importer('01b-aide', SPEC_COMPLET);
  const aides = ['tribune libre', 'thématique', 'deutsch', 'italiano'];
  for (const mot of aides) {
    assert.ok(vu.fiche.toLowerCase().indexOf(mot) === -1,
      'le texte d’aide « ' + mot + ' » a fui dans la fiche : ' + vu.fiche);
  }
});

// ---- 2. Email : / Email: — les deux graphies du gabarit --------------------------------

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

test('docx-pronto.py : « Email : » et « Email: » donnent le même résultat', { skip: sansPython }, () => {
  const avecEspace = importer('02a-email', specEmail(' : '));
  const sansEspace = importer('02b-email', specEmail(': '));
  assert.match(avecEspace.fiche, /email: "ana\.rossi@ex\.ch"/, 'email avec espace non lu');
  assert.match(sansEspace.fiche, /email: "ana\.rossi@ex\.ch"/, 'email sans espace non lu');
});

// ---- 3. Rangée d’auteur vide -> aucun auteur --------------------------------------------

test('docx-pronto.py : une rangée d’auteur entièrement vide ne crée pas d’auteur', { skip: sansPython }, () => {
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

test('docx-pronto.py : une étiquette inconnue mais PRÉSENTE (valeur réelle) bloque tout l’import (décision de Robin, 22.09.2026)', { skip: sansPython }, () => {
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

  // « Mots-clés » est reconnue exactement mais n'a aucune destination : son contenu réel
  // serait perdu si l'import continuait, donc l'import est bloqué.
  assert.strictEqual(vu.bloquant, true, 'une étiquette sans destination et à valeur réelle aurait dû bloquer l’import');
  assert.strictEqual(vu.fiche, null, 'rien n’aurait dû être écrit — le document ne s’importe pas : ' + vu.fiche);
  assert.strictEqual(vu.instructions, '', 'aucune instruction n’aurait dû être écrite non plus');

  const cles = vu.stats.cles_non_reconnues || [];
  assert.strictEqual(cles.length, 1, 'une seule clé non reconnue attendue : ' + JSON.stringify(cles));
  assert.strictEqual(cles[0].texte, 'Mots-clés', 'le texte de la clé bloquante n’est pas cité : ' + JSON.stringify(cles));
  assert.match(cles[0].lieu, /tableau metadonnees/, 'l’emplacement de la clé bloquante n’est pas cité : ' + JSON.stringify(cles));

  // Reconnue mais sans case dans le gabarit : son propre code, qui dit où vont les mots-clés.
  const ligne = vu.avertissements.find((l) => l.indexOf('metadonnees-champ-hors-gabarit') !== -1);
  assert.ok(ligne, 'aucun avertissement pour la ligne Mots-clés : ' + vu.avertissements.join(' / '));
  assert.ok(ligne.indexOf('Mots-clés') !== -1, 'l’étiquette n’est pas citée : ' + ligne);
  assert.ok(ligne.indexOf('Métadonnées des articles') !== -1, 'le message ne dit pas où vont les mots-clés : ' + ligne);
  assert.ok(!vu.avertissements.some((l) => l.indexOf('etiquette-metadonnees-inconnue') !== -1),
    'une étiquette reconnue ne doit plus se dire inconnue : ' + vu.avertissements.join(' / '));
  assert.ok(ligne.indexOf('inclusion, école') !== -1, 'la valeur perdue n’apparaît pas dans l’avertissement : ' + ligne);
});

// ---- 5. Type d'article : les quatre libellés du gabarit, et un mot hors liste ----------
//
// Le gabarit offre « dossier thématique · éditorial · varia · tribune libre ». « dossier
// thématique » est le libellé d'un groupe (GROUPES_TYPES.dossier de lib/yaml.js) : un article
// du dossier porte le jeton `article`. « recension », « article scientifique » et
// « entretien » ne sont pas proposés par le gabarit et se traitent comme un mot hors liste :
// avertir, ne rien écrire.

function docTypeSeul(libelle) {
  return {
    styles: STYLES_BASE,
    body: [
      tableMeta([ligneMeta("Type d’article", libelle)]),
      tableAuteurs([])
    ]
  };
}

test("docx-pronto.py : les quatre libellés du gabarit donnent les quatre jetons attendus", { skip: sansPython }, () => {
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

test('docx-pronto.py : un type hors liste avertit et n’écrit rien', { skip: sansPython }, () => {
  const vu = importer('05b-type-inconnu', docTypeSeul('recension'));
  assert.ok(!/^type:/m.test(vu.fiche), 'un type a été écrit malgré la valeur hors liste : ' + vu.fiche);
  const ligne = vu.avertissements.find((l) => l.indexOf('type-article-non-reconnu') !== -1);
  assert.ok(ligne, 'aucun avertissement pour la valeur hors liste : ' + vu.avertissements.join(' / '));
  assert.ok(ligne.indexOf('recension') !== -1, 'la valeur perdue n’apparaît pas dans l’avertissement : ' + ligne);
});

// ---- 6. Bloc figure ou tableau resté sans contenu reconnu ------------------------------

test('docx-pronto.py : un bloc resté sans image ni tableau avertit', { skip: sansPython }, () => {
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

test('docx-pronto.py : un bloc tableau bien formé lit sa méta, retrouve le tableau interne, et se consomme', { skip: sansPython }, () => {
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
  // L'ancienne forme (tableau enveloppe) est lue, avec un avertissement qui demande de la
  // convertir : c'est le seul avertissement attendu ici.
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
  // Le tableau enveloppe (3e tableau : métadonnées, auteurs, puis le bloc) n'est pas
  // consommé. Une ligne T fait disparaître un tableau entier : docx-tables.py le saute sans
  // descendre dedans et szh-meta.lua le retire de l'AST. Sur l'enveloppe d'un bloc tableau,
  // le tableau interne disparaîtrait avec. Le bloc s'imprime donc tel quel, et
  // 'bloc-ancienne-forme' dit comment retrouver un tableau légendé.
  assert.doesNotMatch(vu.instructions, /^T\t3$/m,
    'le tableau enveloppe d’un bloc ne doit JAMAIS recevoir de ligne T : son tableau interne '
    + 'disparaîtrait de l’article. Instructions : ' + vu.instructions);
  assert.deepStrictEqual(vu.stats.tableaux_consommes, [1, 2],
    'seuls les deux tableaux fixes de la tête se consomment');
});

test('docx-pronto.py : un bloc tableau à rangée 0 étalée sur plusieurs cellules se lit pareil', { skip: sansPython }, () => {
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

test('docx-pronto.py : une fiche déjà là n’est jamais réécrite', { skip: sansPython }, () => {
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
    // « cle-attendue-absente » est à part : SPEC_COMPLET ne renseigne pas ROR/ORCID pour le
    // second auteur, ce qui produit une information et non un avertissement.
    const avert = String(r.stderr).split(/\r?\n/)
      .filter((l) => l.indexOf('[import-avertissement]') === 0)
      .filter((l) => l.indexOf('cle-attendue-absente') === -1);
    assert.deepStrictEqual(avert, [], 'une fiche conservée ne doit pas émettre d’avertissement propre');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---- 9. Aucun mot-clé, dans aucun scénario ------------------------------------------------

test('docx-pronto.py : aucun mot-clé n’est jamais écrit dans la fiche', { skip: sansPython }, () => {
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

// ---- 10. Bibliographie reconnue au titre -----------------------------------------------
//
// Le gabarit Pronto n'a pas de style de bibliographie, la détection par style de
// docx-meta.py n'y trouve rien. La bibliographie se reconnaît à son titre : un paragraphe de
// niveau 1 à 3 dont le texte aplati figure dans le lexique de szh-citations.lua. Tout ce qui
// suit, jusqu'à la fin du document, devient la bibliographie : un paragraphe par entrée,
// paragraphes vides sautés.

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

// fr, de, it, avec ou sans accent, numéroté.
const VARIANTES_TITRE_BIBLIO = [
  'Références', 'References', 'Bibliographie', '5. Références',
  'Literatur', 'Literaturverzeichnis', 'Bibliografia'
];

test('pronto-lire.py : la bibliographie se reconnaît à son titre — fr/de/it, avec ou sans accent, numéroté', { skip: sansPython }, () => {
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

test('pronto-lire.py : un paragraphe de CORPS commençant par « Références » ne déclenche rien', { skip: sansPython }, () => {
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

test("pronto-lire.py : « entretien » est reconnu comme le type interview", { skip: sansPython }, () => {
  const vu = importer('12-entretien', docTypeSeul('entretien'));
  assert.match(vu.fiche, /^type: interview$/m, 'entretien n’a pas donné le jeton interview : ' + vu.fiche);
  assert.deepStrictEqual(
    vu.avertissements.filter((l) => l.indexOf('type-article-non-reconnu') !== -1), [],
    '« entretien » est un type du gabarit, il ne devrait pas avertir');
});

// ---- 13. Blocs collés : un tableau fusionné rend plusieurs blocs -----------------------
//
// Deux blocs figure collés sans paragraphe entre eux sont fusionnés par LibreOffice en un
// seul tableau de 2×N rangées lors de la conversion .odt. Le lecteur reconnaît les N blocs
// empilés, pour ne perdre ni légende ni texte alternatif. Le cas ci-dessous colle deux, puis
// trois blocs dans un seul tableau fabriqué, la forme que produit cette fusion.

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

test('pronto-lire.py : deux blocs collés dans un seul tableau (4 rangées) donnent 2 blocs, avec avertissement', { skip: sansPython }, () => {
  const vu = importer('13-colles-2', specBlocsColles(2));
  assert.strictEqual(vu.stats.blocs.length, 2,
    'les deux blocs collés n’ont pas été reconnus séparément : ' + JSON.stringify(vu.stats.blocs));
  assert.ok(vu.stats.blocs.every((b) => b.nature === 'table'),
    'un des deux blocs collés n’a pas retrouvé son tableau interne : ' + JSON.stringify(vu.stats.blocs));
  const ligne = vu.avertissements.find((l) => l.indexOf('blocs-colles') !== -1);
  assert.ok(ligne, 'aucun avertissement pour les blocs collés : ' + vu.avertissements.join(' / '));
});

test('pronto-lire.py : trois blocs collés (6 rangées) donnent 3 blocs', { skip: sansPython }, () => {
  const vu = importer('14-colles-3', specBlocsColles(3));
  assert.strictEqual(vu.stats.blocs.length, 3,
    'les trois blocs collés n’ont pas été reconnus séparément : ' + JSON.stringify(vu.stats.blocs));
  const ligne = vu.avertissements.find((l) => l.indexOf('blocs-colles') !== -1);
  assert.ok(ligne, 'aucun avertissement pour les blocs collés : ' + vu.avertissements.join(' / '));
});

test('pronto-lire.py : un bloc normal (2 rangées) reste 1 bloc, sans avertissement de collage', { skip: sansPython }, () => {
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
// Un tel tableau serait imprimé tel quel, sa légende et son texte alternatif jamais lus. Le
// garde-fou se déclenche quand ressemble_a_un_bloc() est vrai (au moins un paragraphe SZH Cle
// porte une des quatre étiquettes du bloc) et que n_blocs_meta() vaut 0 (la forme ne tient
// pas).

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

test('pronto-lire.py : un tableau à 3 rangées portant les étiquettes d’un bloc avertit, et reste dans le corps', { skip: sansPython }, () => {
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
  // Le 3e tableau (métadonnées, auteurs, puis celui-ci) n'est pas consommé : il reste visible
  // dans le corps compilé, comme tout tableau non reconnu.
  assert.ok(!/^T\t3$/m.test(vu.instructions),
    'le tableau mal formé a pourtant été marqué consommé :\n' + vu.instructions);
  assert.strictEqual(vu.stats.blocs.length, 0, 'un tableau mal formé ne devrait produire aucun bloc');
});

test('pronto-lire.py : une rangée de méta sans rangée de contenu (1 rangée) avertit aussi', { skip: sansPython }, () => {
  const vu = importer('17-seule-rangee', specTableauMalForme([
    ligneBlocMeta([LEGENDE_TEST, 'Texte alternatif : x', 'Crédit : y', 'Source : z'])
  ]));
  const ligne = vu.avertissements.find((l) => l.indexOf('bloc-mal-forme') !== -1);
  assert.ok(ligne, 'aucun avertissement bloc-mal-forme pour la rangée de méta seule : '
    + vu.avertissements.join(' / '));
  assert.ok(!/^T\t3$/m.test(vu.instructions),
    'le tableau mal formé (1 rangée) a pourtant été marqué consommé :\n' + vu.instructions);
});

// ---- 17. Le numéro de page : connu seulement quand Word l'a mesuré ---------------------
//
// w:lastRenderedPageBreak n'existe que dans un .docx déjà ouvert par Word. Les .docx
// fabriqués n'en portent pas : c'est le cas « page inconnue » du test 16 (pas de page dans
// l'avertissement). Ce test ajoute des marqueurs et vérifie la page annoncée.

test('pronto-lire.py : des w:lastRenderedPageBreak avant le tableau donnent la bonne page', { skip: sansPython }, () => {
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

test('pronto-lire.py : sans aucun marqueur, le message se tient et ne parle jamais de page', { skip: sansPython }, () => {
  const vu = importer('18b-sans-marqueur', specTableauMalForme([
    ligneBlocMeta([LEGENDE_TEST, 'Texte alternatif : x', 'Crédit : y', 'Source : z']),
    ligneBlocContenuTable(TABLEAU_INTERNE),
    ligneBlocContenuTable(TABLEAU_INTERNE)
  ]));
  const ligne = vu.avertissements.find((l) => l.indexOf('bloc-mal-forme') !== -1);
  assert.ok(ligne, 'aucun avertissement bloc-mal-forme : ' + vu.avertissements.join(' / '));
  assert.ok(!/page/i.test(ligne), 'un document sans marqueur ne devrait jamais parler de page : ' + ligne);
  assert.ok(!/page none/i.test(ligne), '« page None » ne devrait jamais apparaître : ' + ligne);
  // La phrase commence par le rang, et la parenthèse n'est jamais vide.
  assert.ok(ligne.indexOf('()') === -1, 'une parenthèse vide est apparue : ' + ligne);
  assert.ok(ligne.indexOf('3ᵉ tableau') !== -1 || ligne.indexOf('tableau 3') !== -1,
    'le rang du tableau n’apparaît pas dans la phrase : ' + ligne);
});

// ---- 18. Faux positif à éviter : un vrai tableau de contenu -----------------------------
//
// Une colonne d'en-tête « Légende » en style Normal (ni SZH Cle, ni forme « Étiquette :
// valeur ») n'est pas une étiquette de bloc : c'est le piège que ressemble_a_un_bloc() évite.

test('pronto-lire.py : un tableau de contenu avec une colonne « Légende » ne déclenche rien', { skip: sansPython }, () => {
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

// ---- 21. Blocs figure/tableau, nouvelle forme ------------------------------------------
//
// Pas de tableau enveloppe : 1 à 4 paragraphes SZH Cle Abb/Tab consécutifs, suivis à 1 ou 2
// paragraphes (un paragraphe vide toléré) d'un paragraphe portant une image, ou d'un tableau.
// Un document reçoit un fichier de relations (word/_rels/document.xml.rels) dès qu'il porte
// une image : voir drawing()/RIDS_IMAGES dans FABRICANTE_PY.

function clesAbbTab(champs) {
  // champs : liste de chaînes "Étiquette : valeur", dans n'importe quel ordre ; un paragraphe
  // SZH Cle Abb/Tab par entrée.
  return champs.map((t) => ({ p: ['SZHCleAbbTab', t] }));
}

function pVide() {
  return { p: ['Normal', ''] };
}

function pImage(nomImage) {
  return { p: ['Normal', ''], image: nomImage || 'figure.png' };
}

const CHAMPS_TEST = ['Légende : Une figure de test', 'Texte alternatif : Un texte alternatif',
  'Copyright : Photographe X', 'Source : Archives Y', 'Note : Une note de test'];

test('pronto-lire.py : nouvelle forme, distance 1 — clés puis image directement : reconnu', { skip: sansPython }, () => {
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

test('pronto-lire.py : nouvelle forme, distance 2 — un paragraphe vide toléré entre les clés et l’image', { skip: sansPython }, () => {
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

test('pronto-lire.py : nouvelle forme, distance 3 (deux vides) — NON reconnu, avertit, rien ne se perd', { skip: sansPython }, () => {
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

test('pronto-lire.py : nouvelle forme — un vrai paragraphe de corps interposé arrête la fenêtre net', { skip: sansPython }, () => {
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

test('pronto-lire.py : nouvelle forme — clés sans aucun contenu nulle part dans le document', { skip: sansPython }, () => {
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

test('pronto-lire.py : nouvelle forme — bloc tableau reconnu, mais SANS ligne T (rien à faire sauter)', { skip: sansPython }, () => {
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
  // Le tableau de la nouvelle forme n'est pas enveloppé : seuls les tableaux 1 et 2
  // (métadonnées, auteurs) reçoivent une ligne T.
  assert.deepStrictEqual(vu.stats.tableaux_consommes, [1, 2],
    'le tableau de contenu de la nouvelle forme n’aurait pas dû recevoir de ligne T : '
    + JSON.stringify(vu.stats.tableaux_consommes));
  assert.ok(!/^T\t3$/m.test(vu.instructions),
    'une ligne T3 est apparue pour un tableau de contenu qui doit se rendre normalement :\n'
    + vu.instructions);
});

test('pronto-lire.py : un paragraphe SZH Cle ORDINAIRE (pas Abb/Tab) au premier niveau n’est jamais un bloc', { skip: sansPython }, () => {
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

test('pronto-lire.py : ancienne forme (tableau enveloppe) toujours lue, mais avec l’avertissement de conversion', { skip: sansPython }, () => {
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
// La fiche, les lignes B/BT et stats.blocs sont identiques pour le même bloc logique, quelle
// que soit la forme d'entrée.

test('pronto-lire.py : test différentiel — même bloc, ancienne et nouvelle forme, même stats.blocs', { skip: sansPython }, () => {
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

  // Aucune forme ne consomme de tableau de bloc : seuls les deux tableaux fixes de la tête
  // s'en vont. Ainsi le tableau interne d'un bloc à l'ancienne forme ne peut pas se perdre.
  assert.deepStrictEqual(vuAncienne.stats.tableaux_consommes, [1, 2]);
  assert.deepStrictEqual(vuNouvelle.stats.tableaux_consommes, [1, 2]);

  // Ce qui diverge : la nouvelle forme fait retirer du corps ses paragraphes de clé et pose ses
  // champs sur le contenu (ligne FT, clés en queue de ligne, retirées par szh-legendes.lua :
  // voir le contrôle 33), alors que l'ancienne laisse son tableau enveloppe s'imprimer.
  const ft = (vuNouvelle.instructions.match(/^FT\t3\t.*$/m) || [''])[0];
  assert.ok(ft, 'la nouvelle forme doit poser ses champs sur son tableau');
  assert.strictEqual(ft.split('\t').length, 7 + 5,
    'les cinq paragraphes de clé doivent voyager avec la ligne FT : ' + ft);
  assert.strictEqual((vuNouvelle.instructions.match(/^P\t/gm) || []).length, 0,
    'plus aucune clé retirée d’avance par szh-meta.lua');
  assert.doesNotMatch(vuAncienne.instructions, /^(P|FT|FI)\t/m,
    'l’ancienne forme ne fait rien retirer et ne pose rien');
});

test('pronto-lire.py : un bloc bien formé (2 rangées) ne déclenche jamais bloc-mal-forme', { skip: sansPython }, () => {
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
//          et le lecteur le signale -----------------------------------------------------
//
// aplatir() retire les accents : « Resumé » et « Résumé » donnent la même clé. Une étiquette
// qui n'est pas exacte produit `cle-approximee` (ou `cle-ambigue` en cas d'égalité entre deux
// clés). Voir identifier_cle()/CANON_* dans pronto_modele.py.

function cleApproximee(vu) {
  return vu.avertissements.filter((l) => l.indexOf('cle-approximee') !== -1);
}
function cleAmbigue(vu) {
  return vu.avertissements.filter((l) => l.indexOf('cle-ambigue') !== -1);
}

test('pronto-lire.py : « Resumé (FR) » (accent oublié) est reconnu comme Résumé, avec un avertissement de proximité', { skip: sansPython }, () => {
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

test('pronto-lire.py : « résumé (fr) : » (minuscules, sans espace avant les deux-points) est exact — aucun avertissement', { skip: sansPython }, () => {
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

test('pronto-lire.py : « Prenom : » (accent oublié) est reconnu comme Prénom, avec un avertissement de proximité', { skip: sansPython }, () => {
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

// « E-mail » est la forme du gabarit allemand (« E-Mail: »), lue sans avertissement.
// « Courriel » est un alias.
test('pronto-lire.py : « Courriel : » (alias) est reconnu comme Email, avec un avertissement', { skip: sansPython }, () => {
  const vu = importer('32-e-mail', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([ligneAuteur(['Prénom : Ana', 'Nom : Rossi', 'Courriel : ana.rossi@ex.ch'])])
    ]
  });
  assert.match(vu.fiche, /email: "ana\.rossi@ex\.ch"/, 'l’email n’a pas été repris : ' + vu.fiche);
  const lignes = cleApproximee(vu);
  assert.strictEqual(lignes.length, 1, 'un seul avertissement cle-approximee attendu : '
    + vu.avertissements.join(' / '));
  assert.ok(lignes[0].indexOf('Courriel') !== -1 && lignes[0].indexOf('Email') !== -1, lignes[0]);
});

// Le gabarit allemand, rempli avec ses étiquettes : tout est lu, rien n'avertit. Cela suppose
// la forme allemande dans les tables CANON_* et « Autor:in » dans ENTETES_TABLE_AUTEURS.
test('pronto-lire.py : un document au gabarit allemand se lit sans un avertissement', { skip: sansPython }, () => {
  const vu = importer('32-de', {
    styles: STYLES_BASE,
    body: [
      tableMeta([
        ligneMeta('Artikeltyp', 'Themenschwerpunkt'),
        ligneMeta('Titel (DE)', 'Inklusive Schule'),
        ligneMeta('Untertitel (DE)', 'Eine Umfrage'),
        ligneMeta('Zusammenfassung (DE)', 'Eine Zusammenfassung.')
      ]),
      tableAuteurs([
        [[['SZHCle', 'Porträt']], [['SZHCle', 'Autor:in']]],
        ligneAuteur(['Vorname: Anna', 'Name: Muster', 'Funktion: Dozentin',
          'Institution: PH Bern', 'ROR: https://ror.org/01', 'ORCID: 0000-0001',
          'E-Mail: anna@ex.ch'])
      ]),
      ...clesAbbTab(['Beschriftung: Ein Bild', 'Alternativtext: Beschreibung',
        'Copyright: SZH', 'Quelle: Archiv']),
      pImage('image1.png')
    ]
  }, 'zeitschrift');
  assert.strictEqual(vu.bloquant, false, 'import refusé : ' + vu.avertissements.join(' / '));
  assert.deepStrictEqual(vu.avertissements, [], 'aucun avertissement attendu');
  for (const attendu of [/^type: article$/m, /Inklusive Schule/, /Eine Umfrage/, /prenom: "?Anna/,
    /affiliation: "?PH Bern/, /email: "anna@ex\.ch"/, /^lang: de$/m]) {
    assert.match(vu.fiche, attendu, 'fiche incomplète :\n' + vu.fiche);
  }
  assert.match(vu.instructions, /^FI\t.*Ein Bild.*Beschreibung.*SZH.*Archiv/m,
    'le bloc figure allemand n’a pas été lu :\n' + vu.instructions);
});

test('pronto-lire.py : « Mots clefs / Keywords / Motsclés / Schlagwörter » sont reconnus comme Mots-clés — champ sans destination, mais compris', { skip: sansPython }, () => {
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
    // Mots-clés est un champ sans destination (voir CANON_METADONNEES) : la ligne est
    // signalée hors gabarit, et aucun mot-clé n'est écrit dans la fiche.
    const inconnue = vu.avertissements.filter((l) => l.indexOf('metadonnees-champ-hors-gabarit') !== -1);
    assert.strictEqual(inconnue.length, 1,
      '« ' + libelle + ' » devrait aussi rester un champ hors gabarit : '
      + vu.avertissements.join(' / '));
    // Reconnue mais sans destination, avec une valeur réelle : ce contenu serait perdu, donc
    // l'import est bloqué.
    assert.strictEqual(vu.bloquant, true, '« ' + libelle + ' », à valeur réelle, aurait dû bloquer l’import');
    assert.strictEqual(vu.fiche, null, '« ' + libelle + ' » : rien n’aurait dû être écrit : ' + vu.fiche);
  }
});

test('pronto-lire.py : « Résultats : » ne devient jamais Résumé — score mesuré 0,571, sous le seuil', { skip: sansPython }, () => {
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
  // Non reconnue et porteuse d'un contenu réel : tout l'import est bloqué, rien n'est écrit
  // (« Résultats » ne devient donc pas un résumé).
  assert.strictEqual(vu.bloquant, true, '« Résultats », à valeur réelle, aurait dû bloquer l’import');
  assert.strictEqual(vu.fiche, null, 'rien n’aurait dû être écrit : ' + vu.fiche);
  const cles = vu.stats.cles_non_reconnues || [];
  assert.ok(cles.some((c) => c.texte === 'Résultats'),
    '« Résultats » n’apparaît pas dans les clés non reconnues : ' + JSON.stringify(cles));
});

test('pronto-lire.py : « Nom de la revue : » ne devient jamais Nom — et, portant un contenu réel, bloque tout l’import', { skip: sansPython }, () => {
  const vu = importer('35-nom-revue', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([ligneAuteur(['Nom de la revue : Revue suisse', 'Prénom : Ida', 'Nom : Keller'])])
    ]
  });
  assert.deepStrictEqual(cleApproximee(vu), [], '« Nom de la revue » n’aurait dû reconnaître aucune clé : '
    + vu.avertissements.join(' / '));
  // Une clé à contenu réel (« Revue suisse ») qu'on ne sait pas ranger bloque tout l'import :
  // la ligne voisine, bien renseignée (Ida Keller), n'est pas écrite non plus.
  assert.strictEqual(vu.bloquant, true, '« Nom de la revue », à valeur réelle, aurait dû bloquer l’import');
  assert.strictEqual(vu.fiche, null, 'rien n’aurait dû être écrit : ' + vu.fiche);
  const cles = vu.stats.cles_non_reconnues || [];
  assert.ok(cles.some((c) => c.texte === 'Nom de la revue'),
    '« Nom de la revue » n’apparaît pas dans les clés non reconnues : ' + JSON.stringify(cles));
});

test('pronto-lire.py : « Légende » (insécable) et « Texte  alternatif » (double espace) sont déjà exacts au passage par normaliser() — aucun avertissement', { skip: sansPython }, () => {
  // L'insécable et le double espace sont déjà normalisés par pm.normaliser(), que
  // pronto_docx.py applique à chaque paragraphe (voir l'en-tête de pronto_modele.py) : ces
  // deux étiquettes arrivent identiques à celles du gabarit, donc exactes.
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

test('pronto-lire.py : une clé beaucoup trop longue (> 40 signes avant les deux-points) reste une étiquette de bloc inconnue', { skip: sansPython }, () => {
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

// Le test ci-dessus passe aussi sans le garde-fou de longueur : le ratio de SequenceMatcher
// est plafonné par 2*min(longueurs)/(somme des longueurs), soit environ 0,45 quand le
// candidat fait deux fois la longueur de la plus longue clé, loin de SEUIL_CLE. Le garde-fou
// LONGUEUR_ETIQUETTE_SCORE protège contre un futur alias plus long : ce test l'éprouve seul,
// sur une table jetable, pour montrer qu'il coupe avant le calcul du score.
test('identifier_cle() : une étiquette de plus de 40 signes est jamais scorée, même contre une clé qui lui ressemblerait', { skip: sansPython }, () => {
  const script = [
    'import sys',
    'sys.path.insert(0, ' + JSON.stringify(cheminPython(path.join(RACINE, 'pipeline'))) + ')',
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

test('pronto-lire.py : un paragraphe SZH Cle Abb/Tab sans aucun deux-points n’est jamais scoré', { skip: sansPython }, () => {
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

// Le vocabulaire réel du gabarit n'a pas deux clés assez proches pour être ambiguës au-dessus
// de SEUIL_CLE : ce test appelle identifier_cle() sur une table jetable pour éprouver le
// mécanisme d'ambiguïté (celui qui protège CANON_METADONNEES, CANON_AUTEUR et CANON_FIGURE).
test('identifier_cle() : deux clés à égale distance ne sont jamais retenues — ambiguïté', { skip: sansPython }, () => {
  const script = [
    'import sys',
    'sys.path.insert(0, ' + JSON.stringify(cheminPython(path.join(RACINE, 'pipeline'))) + ')',
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

// ---- 30. Clé attendue absente / clé présente mais vide : informations, non bloquantes ----
//
// Une clé présente mais non reconnue (score sous le seuil, ou ambiguë) bloque tout l'import.
// Une clé attendue mais absente, ou présente mais vide (rien ou des espaces après le
// deux-points), produit l'information `cle-attendue-absente` : non bloquante, sans valeur
// écrite. importer() range ces informations à part, dans vu.info.

test('pronto-lire.py : une clé attendue absente du document est une simple information, jamais bloquante', { skip: sansPython }, () => {
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
  // « Langue de l'article », renseignée, n'apparaît pas comme absente.
  assert.ok(!vu.info.some((l) => l.indexOf('Langue') !== -1),
    '« Langue de l\'article », pourtant renseignée, apparaît comme absente : ' + vu.info.join(' / '));
});

test('pronto-lire.py : une clé présente mais vide (espaces seuls) est traitée comme absente — jamais approximée, jamais bloquante', { skip: sansPython }, () => {
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

test('pronto-lire.py : un auteur — un champ facultatif laissé vide est une information, jamais bloquant', { skip: sansPython }, () => {
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

test('pronto-lire.py : un bloc — un champ laissé vide est une information, jamais bloquant', { skip: sansPython }, () => {
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

// ---- 31. Un tableau de contenu ordinaire (style Normal) placé en premier n'est pas pris
//          pour celui des métadonnées --------------------------------------------------
//
// Des manuscrits réels hors gabarit commencent par un tableau de données (ex.
// « Enregistrement des cours | 49 »), que sa position seule ferait prendre pour le tableau des
// métadonnées. _etiquette_szh_cle() (et de même extraire_table_auteurs() et
// _champs_bloc_meta()) n'accepte comme étiquette qu'un paragraphe de style SZH Cle.

test('pronto-lire.py : un tableau de contenu ORDINAIRE (style Normal, pas au gabarit) pris pour celui des métadonnées ne bloque jamais l’import', { skip: sansPython }, () => {
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

// ---- 32. La langue vient du produit du numéro ------------------------------------------
//
// Le gabarit n'a pas de champ « Langue de l'article ». La langue se déduit de la revue du
// numéro (Revue = français, Zeitschrift = allemand) ; un article italien se corrige à la main
// dans la fiche après l'import. La chaîne pose le jeton dans $SZH_PRODUIT (import-docx.sh le
// lit dans ausgabe.yaml, à la racine du numéro).

const SPEC_NUE = { styles: STYLES_BASE, body: [tableMeta([]), tableAuteurs([])] };

test('pronto-lire.py : la langue de l’article vient de la revue du numéro', { skip: sansPython }, () => {
  for (const [produit, attendue] of [['revue', 'fr'], ['zeitschrift', 'de'],
    // Le jeton canonique et le nom complet d'un ancien ausgabe.yaml, comme derive_revue() de
    // szh-maquette.lua.
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

test('pronto-lire.py : sans produit (hors numéro), le français est posé — et c’est DIT', { skip: sansPython }, () => {
  const vu = importer('46-sans-produit', SPEC_NUE, '');
  assert.strictEqual(vu.stats.langue, 'fr', 'le repli doit rester le français');
  assert.strictEqual(vu.stats.langue_deduite, true);
  assert.ok(vu.avertissements.find((l) => l.indexOf('langue-deduite') !== -1),
    'un repli silencieux sur le français serait exactement l’échec muet qu’on refuse : '
    + vu.avertissements.join(' / '));
});

test('pronto-lire.py : un champ « Langue de l’article » resté dans le document avertit, ne bloque pas, et n’impose pas sa langue', { skip: sansPython }, () => {
  // Un document ancien porte encore la ligne « Langue de l'article ». Elle ne bloque pas
  // l'import et ne décide pas de la langue, mais elle est signalée : sinon un article italien
  // sortirait en français sans que personne le sache.
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
// Sans ces instructions, les paragraphes « Légende : », « Texte alternatif : », « Crédit : »,
// « Source : » s'imprimeraient au milieu de l'article et le texte alternatif serait perdu.
// FI (figure) est consommée par szh-legendes.lua, FT (tableau) par docx-tables.py.
//
// Les clés d'un bloc figure voyagent en queue de la ligne FI. szh-legendes.lua les retire au
// moment où il pose les valeurs sur l'image : si l'image n'est pas trouvée, les clés restent
// visibles dans l'article au lieu de disparaître.
test('pronto-lire.py : un bloc figure confie ses clés à la ligne FI, qui pose ses champs sur l’image', { skip: sansPython }, () => {
  const vu = importer('48-bloc-figure-instructions', {
    styles: STYLES_BASE,
    body: [tableMeta([]), tableAuteurs([]), ...clesAbbTab(CHAMPS_TEST), pImage('figure.png')]
  });
  const pLignes = (vu.instructions.match(/^P\t.*$/gm) || []);
  assert.deepStrictEqual(pLignes, [],
    'aucune clé de bloc figure ne doit être retirée d’avance par szh-meta.lua : '
    + vu.instructions);
  const fi = (vu.instructions.match(/^FI\t.*$/m) || [])[0];
  assert.ok(fi, 'aucune ligne FI : les champs du bloc n’atteindraient pas l’image');
  assert.deepStrictEqual(fi.split('\t'),
    ['FI', 'figure.png', 'Une figure de test', 'Un texte alternatif', 'Photographe X',
      'Archives Y', 'Une note de test'].concat(CHAMPS_TEST),
    'la ligne FI ne porte pas les cinq champs puis les cinq clés, dans l’ordre du contrat');
});

// La clé Note : cinquième champ de valeur des lignes FI/FG/FT, après la source.
test('pronto-lire.py : la note d’un bloc tableau voyage en 7e champ de la ligne FT', { skip: sansPython }, () => {
  const vu = importer('48b-bloc-tableau-note', {
    styles: STYLES_BASE,
    body: [tableMeta([]), tableAuteurs([]), ...clesAbbTab(CHAMPS_TEST), { tbl: TABLEAU_INTERNE }]
  });
  const ft = (vu.instructions.match(/^FT\t.*$/m) || [])[0];
  assert.ok(ft, 'aucune ligne FT : ' + vu.instructions);
  assert.deepStrictEqual(ft.split('\t').slice(0, 7),
    ['FT', '3', 'Une figure de test', 'Un texte alternatif', 'Photographe X', 'Archives Y',
      'Une note de test']);
});

test('pronto-lire.py : sans clé Note, le champ note reste vide et son absence n’est jamais signalée', { skip: sansPython }, () => {
  const vu = importer('48c-bloc-sans-note', {
    styles: STYLES_BASE,
    body: [tableMeta([]), tableAuteurs([]),
      ...clesAbbTab(['Légende : Une figure de test', 'Texte alternatif : Un texte alternatif',
        'Crédit : Photographe X', 'Source : Archives Y']),
      pImage('figure.png')]
  });
  const fi = (vu.instructions.match(/^FI\t.*$/m) || [])[0].split('\t');
  assert.deepStrictEqual(fi.slice(0, 7),
    ['FI', 'figure.png', 'Une figure de test', 'Un texte alternatif', 'Photographe X',
      'Archives Y', ''], 'le champ note doit exister, vide, même sans clé');
  assert.deepStrictEqual(vu.info.filter((l) => /clé « Note »|clé « Notiz »/.test(l)), [],
    'la note est facultative : aucune info « clé attendue absente »');
  // « Crédit » (ancien libellé) reste lu sur le champ crédit, et sans avertissement.
  assert.deepStrictEqual(vu.avertissements.filter((l) => l.indexOf('cle-approximee') !== -1), [],
    'l’ancien libellé « Crédit » ne doit pas avertir : ' + vu.avertissements.join(' / '));
});

test('pronto-lire.py : la clé Note se lit sous ses variantes (Notiz, Remarque, Anmerkung)', { skip: sansPython }, () => {
  for (const etiquette of ['Notiz', 'Remarque', 'Anmerkung', 'Hinweis', 'Notes']) {
    const vu = importer('48d-note-' + etiquette, {
      styles: STYLES_BASE,
      body: [tableMeta([]), tableAuteurs([]),
        ...clesAbbTab(['Légende : L', etiquette + ' : Texte de la note']), pImage('figure.png')]
    });
    const fi = (vu.instructions.match(/^FI\t.*$/m) || [])[0].split('\t');
    assert.strictEqual(fi[6], 'Texte de la note', etiquette + ' : la note n’a pas été lue : ' + fi);
  }
});

test('pronto-lire.py : l’image d’un bloc est nommée par TOUTES ses variantes (aperçu PNG et SVG)', { skip: sansPython }, () => {
  // Word range une image vectorielle derrière un aperçu PNG : le lecteur voit le PNG, pandoc
  // écrit le SVG. Un seul nom ferait manquer l'appariement (sur le gabarit réel, la figure
  // sort en media/image2.svg alors que le a:blip pointe media/image1.png).
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
// Le lecteur écrit la ligne FT ; docx-tables.py la lit et écrit les quatre champs dans
// tables/table-NN.html sous la forme que szh-numerotation.lua attend : <caption> pour la
// légende, data-alt / data-copyright / data-source sur <table>. Les deux programmes tournent
// sur le même document et le même fichier d'instructions, pour voir la ligne FT telle qu'elle
// voyage vraiment.

const DOCX_TABLES = path.join(RACINE, 'pipeline', 'docx-tables.py');

test('pronto-lire.py + docx-tables.py : les champs d’un bloc tableau arrivent dans le HTML du tableau', { skip: sansPython }, () => {
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
    // donc le premier rendu, et il doit être rendu.
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

// ---- 35. Les rangs de titre au-delà du troisième ---------------------------------------
//
// Le gabarit porte un « Titre niveau 4 », et famille() classe « Titre 4 » en 'heading'. Une
// bibliographie intitulée au rang 4 doit donc être détachée, sinon sa liste reste dans le
// corps et l'export OJS part sans références. C'est le lexique des titres qui décide, pas le
// rang.
//
// Le rang lui-même ne voyage pas dans les instructions : pandoc lit le style Word et écrit
// « #### » dans le .md, puis szh-niveaux.lua ramène le corps entre <h2> et <h6>. Ce contrôle
// vise le seul endroit où le lecteur regarde le rang.

test('pronto-lire.py : une bibliographie intitulée en rang 4 est détachée comme les autres', { skip: sansPython }, () => {
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
// Deux mécanismes travaillent ensemble :
//
//   * les alias (CANON_*) reconnaissent les formes connues : sans accent, synonymes,
//     italien. C'est là qu'on ajoute un cas nouveau ;
//   * le seuil de proximité (SEUIL_CLE, 0,75) rattrape l'imprévu : une lettre en trop, deux
//     lettres inversées.
//
// Une clé présente non reconnue refuse tout l'import. Un faux négatif coûte un aller-retour à
// l'autrice ; un faux positif range une valeur dans le mauvais champ sans que ça se voie. Les
// deux contrôles ci-dessous tiennent les deux bouts.

function mesurerCle(etiquette, table) {
  const script = [
    'import json, sys',
    'sys.path.insert(0, ' + JSON.stringify(cheminPython(path.join(RACINE, 'pipeline'))) + ')',
    'import pronto_modele as pm',
    'seuil = pm.SEUIL_CLE',
    'pm.SEUIL_CLE = 0.0',   // 0 : on veut le score brut, pas le verdict
    'r = pm.identifier_cle(sys.argv[2], getattr(pm, sys.argv[1]))',
    // identifier_cle() rend deux formes : (jeton, score, exact), et
    // ('__ambigu__', jeton1, jeton2, score1, score2) quand les deux meilleures clés se
    // tiennent. Dans le second cas r[1] est un jeton : une comparaison numérique donnerait
    // NaN et passerait au vert par accident.
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

test('clés tolérantes : tout ce que la rédaction tape vraiment est reconnu, sur la bonne clé', { skip: sansPython }, () => {
  // Trois familles : la forme sans accent (perdre deux accents suffit à tomber sous le
  // seuil), les synonymes courants et les fautes de frappe. « Legandes » figurait dans une
  // version du gabarit.
  const attendus = [
    // sans accent
    ['CANON_METADONNEES', 'Resume', 'resume'], ['CANON_FIGURE', 'Legende', 'legende'],
    ['CANON_AUTEUR', 'Prenom', 'prenom'], ['CANON_FIGURE', 'Credit', 'credit'],
    // synonymes courants
    ['CANON_FIGURE', 'Copyright', 'credit'], ['CANON_FIGURE', 'Description', 'alt'],
    ['CANON_FIGURE', 'Provenance', 'source'], ['CANON_AUTEUR', 'Poste', 'fonction'],
    ['CANON_AUTEUR', 'Adresse e-mail', 'email'], ['CANON_AUTEUR', 'Nom de famille', 'nom'],
    // italien, aux côtés du français et de l'allemand
    ['CANON_METADONNEES', 'Riassunto', 'resume'], ['CANON_METADONNEES', 'Titolo', 'titre'],
    // fautes de frappe, rattrapées par le seuil
    ['CANON_AUTEUR', 'Prenoom', 'prenom'], ['CANON_AUTEUR', 'Fontion', 'fonction'],
    ['CANON_AUTEUR', 'Instituion', 'affiliation'], ['CANON_FIGURE', 'Sourse', 'source'],
    ['CANON_FIGURE', 'Legandes', 'legende'], ['CANON_METADONNEES', 'Resumé', 'resume'],
    // la clé Note : les deux libellés du gabarit et les variantes courantes
    ['CANON_FIGURE', 'Note', 'note'], ['CANON_FIGURE', 'Notiz', 'note'],
    ['CANON_FIGURE', 'Notes', 'note'], ['CANON_FIGURE', 'Anmerkung', 'note'],
    ['CANON_FIGURE', 'Hinweis', 'note'], ['CANON_FIGURE', 'Remarque', 'note'],
    ['CANON_FIGURE', 'Nota', 'note']
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

test('clés tolérantes : une étiquette étrangère au gabarit reste sous le seuil, avec de la marge', { skip: sansPython }, () => {
  // Des étiquettes rencontrées pour de vrai (tableau de contenu, fiche d'un autre gabarit),
  // qui ne doivent pas être prises pour un champ Pronto.
  const etrangeres = [
    // Adresse, Biographie, Téléphone et Photo n'y figurent pas : déclarées dans CANON_AUTEUR
  // sans destination (section 37), elles se reconnaissent à 1,000 et n'entrent pas en
  // concurrence de proximité.
    ['CANON_AUTEUR', 'Ville'], ['CANON_AUTEUR', 'Pays'],
    ['CANON_METADONNEES', 'Résultats'], ['CANON_METADONNEES', 'Nom de la revue'],
    ['CANON_METADONNEES', 'DOI'], ['CANON_METADONNEES', 'Volume'],
    ['CANON_METADONNEES', 'Rubrique'],
    ['CANON_FIGURE', 'Licence'], ['CANON_FIGURE', 'Cellule 1'], ['CANON_FIGURE', 'Notation'],
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
  // La marge sous le seuil (0,75) est faible : ce contrôle échoue si le seuil est abaissé au
  // point qu'une étiquette étrangère soit prise pour un champ.
  assert.ok(pire < seuil,
    'plus aucune marge : « ' + pireNom + ' » atteint ' + pire.toFixed(3) + ' pour un seuil à '
    + seuil);
  assert.ok(seuil - pire >= 0.05,
    'la marge entre la dernière étiquette étrangère (« ' + pireNom + ' », ' + pire.toFixed(3)
    + ') et le seuil (' + seuil + ') est tombée sous 0,05 : le mécanisme s’approche du tirage '
    + 'au sort. Deux issues, dans cet ordre : déclarer la clé gênante sans destination (voir '
    + 'CLES_AUTEUR_SANS_DESTINATION), ou poser un alias. Jamais baisser le seuil.');
});

// ---- 37. Les champs que le gabarit ne porte pas, déclarés exprès -----------------------
//
// Adresse, biographie, téléphone, photo : la rédaction les tape par réflexe, le schéma
// d'auteur n'en a aucun. Ils sont déclarés dans CANON_AUTEUR sans destination, comme
// « Mots-clés » côté métadonnées, pour deux raisons :
//
//   1. la valeur ne se perd pas : une ligne remplie qu'on ne sait pas ranger refuse l'import ;
//   2. la clé n'entre pas en concurrence de proximité avec un vrai champ. Non déclarée,
//      « Adresse » obtenait 0,737 contre Email (via l'alias allemand « e-mail-adresse »),
//      juste sous le seuil de 0,75. Déclarée, elle se reconnaît elle-même à 1,000.

test('champs hors gabarit : une adresse ne peut plus être confondue avec un e-mail', { skip: sansPython }, () => {
  const { jeton, score } = mesurerCle('Adresse', 'CANON_AUTEUR');
  assert.strictEqual(jeton, 'adresse',
    '« Adresse » se lit « ' + jeton + ' » (score ' + score.toFixed(3) + ') : si c’est « email », '
    + 'une adresse postale part dans le champ e-mail');
  assert.strictEqual(score, 1,
    'la clé doit se reconnaître elle-même exactement, sinon la concurrence de proximité revient');
});

test('champs hors gabarit : la ligne refuse l’import, et le message dit où va l’information', { skip: sansPython }, () => {
  // Un cas par champ : la correction à faire diffère d'un champ à l'autre.
  const cas = [
    ['Adresse : Bergstrasse 12, 3007 Berne', 'Adresse', /retirez cette ligne/i],
    ['Biographie : Chercheuse en pédagogie depuis 2009.', 'Biographie', /biographique/i],
    ['Téléphone : 031 000 00 00', 'Téléphone', /retirez cette ligne/i],
    // La photo est le seul de ces champs qui ait une vraie place dans le document.
    ['Photo : portrait.jpg', 'Photo', /cellule de gauche/i]
  ];
  for (const [ligne, nom, motifGeste] of cas) {
    const vu = importer('51-hors-gabarit-' + nom.toLowerCase().slice(0, 4), {
      styles: STYLES_BASE,
      body: [
        tableMeta([]),
        tableAuteurs([ligneAuteur(['Prénom : Camille', 'Nom : Sauvage', ligne])])
      ]
    });
    assert.strictEqual(vu.bloquant, true,
      '« ' + nom +' » n’a pas refusé l’import : sa valeur se serait perdue en silence');
    const avert = vu.avertissements.find((l) => l.indexOf('auteur-champ-hors-gabarit') !== -1);
    assert.ok(avert, 'aucun avertissement « auteur-champ-hors-gabarit » pour « ' + nom + ' » : '
      + vu.avertissements.join(' / '));
    assert.match(avert, motifGeste,
      'le message ne dit pas quoi faire de « ' + nom + ' » : ' + avert);
    // L'étiquette est reconnue : le message ne doit pas dire « étiquette inconnue », ce qui
    // enverrait corriger une orthographe juste.
    assert.deepStrictEqual(
      vu.avertissements.filter((l) => l.indexOf('auteur-etiquette-inconnue') !== -1), [],
      '« ' + nom + ' » est annoncée comme une étiquette inconnue, alors qu’elle est reconnue');
  }
});

test('champs hors gabarit : les vrais champs de la même rangée restent lus', { skip: sansPython }, () => {
  // L'import est refusé, rien n'est écrit, mais le reste de la rangée doit être compris, sinon
  // le rapport nommerait des fautes qui n'existent pas.
  const vu = importer('52-hors-gabarit-reste', {
    styles: STYLES_BASE,
    body: [
      tableMeta([]),
      tableAuteurs([ligneAuteur(['Prénom : Camille', 'Nom : Sauvage',
        'Adresse : Bergstrasse 12'])])
    ]
  });
  assert.strictEqual(vu.bloquant, true);
  assert.deepStrictEqual(vu.stats.cles_non_reconnues.map((e) => e.texte), ['Adresse'],
    'une seule clé doit être en cause, celle qui n’a pas de place : '
    + JSON.stringify(vu.stats.cles_non_reconnues));
});
