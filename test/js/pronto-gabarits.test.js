// Le même gabarit Pronto, en .docx et en .odt, doit produire la même fiche et les mêmes lignes
// d'instructions (pronto_modele.py, le noyau ; pronto_docx.py, le lecteur ; pronto-lire.py,
// la CLI). Le lecteur ne lit que le .docx : le .odt passe par la chaîne de l'import,
// pipeline/conversion_odt.py (LibreOffice, dans la WSL), puis pronto-lire.py.
//
// Les gabarits comparés sont ceux du dépôt (revue-template/), un par langue :
// `Pronto - modele d'article_FR.docx` (Revue), `_DE.docx` (Zeitschrift), et leurs `.odt`,
// produits par :
//
//   soffice --headless --convert-to odt --outdir <dossier> "<le .docx>"
//
// Commande à rejouer après toute modification d'un .docx : le contrôle de parité de structure
// détecte un .odt resté en arrière. Les contrôles sur le .odt tournent dans la WSL et
// sautent, ou échouent avec SZH_WSL_OBLIGATOIRE, quand elle manque.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gardes = require('./gardes');
const { sansPandocWsl, sansPython } = gardes;

const RACINE = path.resolve(__dirname, '..', '..');
const PRONTO_LIRE = path.join(RACINE, 'pipeline', 'pronto-lire.py');
const GABARITS = [['FR', 'revue', 'fr'], ['DE', 'zeitschrift', 'de']].map(([code, produit, langue]) => ({
  code, produit, langue,
  docx: path.join(RACINE, 'revue-template', "Pronto - modele d'article_" + code + '.docx'),
  odt: path.join(RACINE, 'revue-template', "Pronto - modele d'article_" + code + '.odt')
}));

function python(args, env, opts) {
  return gardes.python(args, Object.assign({
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }, env || {})
  }, opts || {}));
}

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-pronto-gabarits-'));
}

// ---- Conversion .odt -> .docx, dans la WSL (LibreOffice), comme l'import ------------------
// Le gabarit .odt livré, converti en .docx par pipeline/conversion_odt.py, une fois par
// gabarit et par processus. Rend le chemin du .docx (dans un dossier jetable, nettoyé en fin
// de fichier).
const DOSSIERS_CONVERSION = [];
const CONVERTIS = {};
function odtConverti(G) {
  if (CONVERTIS[G.code]) { return CONVERTIS[G.code]; }
  assert.ok(fs.existsSync(G.odt), 'gabarit .odt manquant dans revue-template/ : ' + G.odt);
  const base = dossierJetable();
  DOSSIERS_CONVERSION.push(base);
  // Nom simple : l'apostrophe et les espaces du nom livré ne passent pas le relais wsl.exe.
  const source = path.join(base, 'gabarit-' + G.code + '.odt');
  fs.copyFileSync(G.odt, source);
  const sortie = path.join(base, 'converti');
  const r = python([path.join(RACINE, 'pipeline', 'conversion_odt.py'), source, 'docx', sortie],
    null, { timeout: 240000 });
  assert.strictEqual(r.status, 0, 'conversion_odt.py a échoué sur ' + G.odt + ' : ' + r.stderr);
  const docx = path.join(sortie, 'gabarit-' + G.code + '.docx');
  assert.ok(fs.existsSync(docx), 'la conversion n’a pas écrit ' + docx);
  CONVERTIS[G.code] = docx;
  return docx;
}

test.after(() => {
  for (const d of DOSSIERS_CONVERSION) { fs.rmSync(d, { recursive: true, force: true }); }
});

// Lance pronto-lire.py sur `chemin` (le .docx ou le .odt du dépôt) et rend { fiche,
// instructions, avertissements (codes seuls, triés), bloquant }. Un gabarit livré ne bloque
// pas : le statut de sortie est vérifié strictement, à la différence d'importer() dans
// pronto-lire.test.js, qui laisse passer le code 1.
function lire(chemin, slug, produit) {
  const base = dossierJetable();
  try {
    const instr = path.join(base, 'instructions.txt');
    const r = python([PRONTO_LIRE, chemin, slug, base], { SZH_META: instr, SZH_PRODUIT: produit });
    assert.strictEqual(r.status, 0, 'pronto-lire.py a échoué sur ' + chemin + ' : ' + r.stderr);
    const cheminFiche = path.join(base, slug + '.meta.yaml');
    const codes = String(r.stderr).split(/\r?\n/)
      .filter((l) => l.indexOf('[import-avertissement]') === 0)
      .map((l) => l.split(' | ')[0].replace('[import-avertissement] ', ''))
      .sort();
    const stats = JSON.parse(String(r.stdout).trim().split(/\r?\n/).pop());
    return {
      fiche: fs.existsSync(cheminFiche) ? fs.readFileSync(cheminFiche, 'utf8') : null,
      instructions: fs.existsSync(instr) ? fs.readFileSync(instr, 'utf8') : '',
      avertissements: codes,
      bloquant: !!stats.bloquant
    };
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

// Seule ligne de la fiche qui peut différer entre les deux formats : `source:` porte le nom
// du fichier déposé.
function sansLigneSource(fiche) {
  return (fiche || '').split(/\r?\n/).filter((l) => l.indexOf('source:') !== 0).join('\n');
}

// Seule instruction qui peut différer entre les deux formats : les noms de fichier de l'image
// d'un bloc figure (ligne FI). Word et LibreOffice nomment les médias différemment
// (media/image1.png + media/image2.svg d'un côté, « 1000038800000A0600000A067B9F4EE9.svg » de
// l'autre), sans conséquence : ce nom ne sert qu'à retrouver l'image dans le .md que pandoc
// écrit depuis le même fichier. Le reste de la ligne (légende, texte alternatif, crédit,
// source) doit être identique.
function sansNomsImages(instructions) {
  return (instructions || '').replace(/^(FI\t)[^\t\n]*/gm, '$1<image>');
}

for (const G of GABARITS) {
test('pronto-lire.py : le même gabarit ' + G.code + ' en .docx et en .odt (converti) donne la même fiche',
  { skip: sansPandocWsl || sansPython }, () => {
  const REVUE_DOCX = G.docx;
  assert.ok(fs.existsSync(REVUE_DOCX), 'gabarit .docx manquant dans revue-template/ : ' + REVUE_DOCX);

  const vuDocx = lire(REVUE_DOCX, 'gabarit-docx', G.produit);
  const vuOdt = lire(odtConverti(G), 'gabarit-odt', G.produit);
  assert.ok(new RegExp('^lang: ' + G.langue + '$', 'm').test(vuDocx.fiche),
    'la fiche du gabarit ' + G.code + ' ne porte pas lang: ' + G.langue + ' :\n' + vuDocx.fiche);

  assert.ok(vuDocx.fiche, 'le lecteur .docx n’a rien écrit dans la fiche');
  assert.ok(vuOdt.fiche, 'le lecteur .odt n’a rien écrit dans la fiche');
  assert.strictEqual(sansLigneSource(vuDocx.fiche), sansLigneSource(vuOdt.fiche),
    'la fiche (hors ligne source:) diffère entre le .docx et le .odt :\n--- docx ---\n'
    + vuDocx.fiche + '\n--- odt ---\n' + vuOdt.fiche);

  assert.strictEqual(sansNomsImages(vuDocx.instructions), sansNomsImages(vuOdt.instructions),
    'les lignes $SZH_META diffèrent entre le .docx et le .odt :\n--- docx ---\n'
    + vuDocx.instructions + '\n--- odt ---\n' + vuOdt.instructions);

  assert.deepStrictEqual(vuDocx.avertissements, vuOdt.avertissements,
    'les avertissements (codes) diffèrent entre le .docx et le .odt : docx=['
    + vuDocx.avertissements.join(', ') + '] odt=[' + vuOdt.avertissements.join(', ') + ']');

  // Les deux gabarits livrés sont tapés juste : aucune étiquette ne déclenche les clés
  // tolérantes (approximée ou ambiguë). Sinon le gabarit est fautif, ou le mécanisme trop
  // sensible.
  assert.deepStrictEqual(vuDocx.avertissements.filter((c) => c.indexOf('cle-approximee') !== -1
    || c.indexOf('cle-ambigue') !== -1), [],
    'le gabarit réel (tapé juste) déclenche pourtant une clé tolérante : '
    + vuDocx.avertissements.join(', '));

  // Les gabarits livrés n'ont aucune clé remplie : chaque champ y est « attendu mais absent »
  // (cle-attendue-absente), une information. Les codes bloquants (etiquette-*-inconnue,
  // cle-ambigue, voir GRAVITE_CODES dans pronto_modele.py) n'y figurent pas.
  assert.strictEqual(vuDocx.bloquant, false,
    'le gabarit .docx (tapé juste, vide par nature) a pourtant bloqué l’import');
  assert.strictEqual(vuOdt.bloquant, false,
    'le gabarit .odt (tapé juste, vide par nature) a pourtant bloqué l’import');
  const codesBloquants = ['etiquette-metadonnees-inconnue', 'auteur-etiquette-inconnue',
    'metadonnees-champ-hors-gabarit', 'bloc-etiquette-inconnue', 'cle-ambigue'];
  assert.deepStrictEqual(vuDocx.avertissements.filter((c) => codesBloquants.includes(c)), [],
    'le gabarit .docx déclenche pourtant un code bloquant : ' + vuDocx.avertissements.join(', '));
});
}

// ---- Parité de structure ------------------------------------------------------------------
//
// Le contrôle ci-dessus compare ce que pronto-lire.py produit. Celui-ci compare ce que les
// deux lecteurs voient dans le modèle neutre : étiquettes du tableau des métadonnées, rangées
// du tableau des auteurs et leurs étiquettes, étiquettes des blocs figure/tableau, même quand
// la valeur est vide. Or le gabarit n'a que des valeurs vides : sans ce contrôle, une
// étiquette retirée d'un seul côté passerait.
//
// Script Python écrit dans un dossier jetable, comme FABRICANTE_PY dans pronto-lire.test.js.
// Il importe pronto_docx/pronto_modele pour lire, sous chaque étiquette « SZH Cle », son
// texte aplati, qu'il y ait une valeur ou non, ce que pronto_modele.principal() ne rend pas.

const STRUCTURE_PY = `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json, os, sys

sys.path.insert(0, sys.argv[1])
import pronto_modele as pm
import pronto_docx


def lire(chemin):
    return pronto_docx.lire(chemin)


def etiquettes_cle(cellule):
    out = []
    for b in cellule.blocs:
        if not isinstance(b, pm.Par):
            continue
        if pm.normaliser_nom_style(b.style) != pm.NOM_STYLE_CLE:
            continue
        if not b.texte:
            continue
        out.append(pm.aplatir(b.texte.partition(':')[0]))
    return out


def etiquettes_groupe_cle_abb_tab(blocs, depart):
    # Étiquettes (aplaties, triées) d'un groupe de 1 à 4 paragraphes SZH Cle Abb/Tab
    # consécutifs à partir de l'indice depart, quel que soit le contenu qui les suit — une
    # vérification STRUCTURELLE (le gabarit porte-t-il les bonnes étiquettes ?), pas une
    # vérification de reconnaissance de bloc (pronto-lire.test.js s'en charge, fenêtre de
    # contenu comprise).
    out = []
    fin = depart
    while fin < len(blocs) and fin - depart < 5:
        b = blocs[fin]
        if not isinstance(b, pm.Par) or pm.normaliser_nom_style(b.style) != pm.NOM_STYLE_CLE_BLOC:
            break
        if b.texte:
            out.append(pm.aplatir(b.texte.partition(':')[0]))
        fin += 1
    return sorted(out), fin


def dump(chemin):
    blocs = lire(chemin)
    tables = [e for e in blocs if isinstance(e, pm.Tableau)]
    resultat = {'n_tables': len(tables)}
    if len(tables) >= 1:
        t1 = tables[0]
        resultat['table1_labels'] = [
            pm.aplatir(pm._etiquette_szh_cle(rangee[0]))
            for rangee in t1.rangees[1:] if len(rangee) == 2
        ]
    if len(tables) >= 2:
        t2 = tables[1]
        lignes = [etiquettes_cle(rangee[1]) for rangee in t2.rangees if len(rangee) == 2]
        resultat['table2_lignes'] = lignes

    # Ancienne forme (tableau enveloppe) : reste reconnue en repli, mais le gabarit livré
    # (révision du 21.09.2026) n'en porte plus aucune — devrait donner [] des deux côtés.
    resultat['blocs_ancienne_forme'] = []
    for t in tables[2:]:
        if not pm.est_bloc_meta(t):
            continue
        etiquettes = []
        for c in t.rangees[0]:
            etiquettes.extend(etiquettes_cle(c))
        resultat['blocs_ancienne_forme'].append(sorted(etiquettes))

    # Nouvelle forme (paragraphes SZH Cle Abb/Tab) : un groupe par run de 1 à 4 paragraphes
    # de ce style trouvé au premier niveau du document, dans l'ordre — le gabarit livré en
    # porte deux (l'exemple de bloc figure, non rempli, et l'exemple de bloc tableau).
    resultat['blocs_nouvelle_forme'] = []
    i = 0
    while i < len(blocs):
        b = blocs[i]
        if isinstance(b, pm.Par) and pm.normaliser_nom_style(b.style) == pm.NOM_STYLE_CLE_BLOC:
            etiquettes, fin = etiquettes_groupe_cle_abb_tab(blocs, i)
            resultat['blocs_nouvelle_forme'].append(etiquettes)
            i = fin
        else:
            i += 1
    return resultat


if __name__ == '__main__':
    print(json.dumps(dump(sys.argv[2]), ensure_ascii=False, sort_keys=True))
`;

let DOSSIER_STRUCTURE = null;
let CHEMIN_STRUCTURE = null;

function structurePy() {
  if (!CHEMIN_STRUCTURE) {
    DOSSIER_STRUCTURE = dossierJetable();
    CHEMIN_STRUCTURE = path.join(DOSSIER_STRUCTURE, 'structure.py');
    fs.writeFileSync(CHEMIN_STRUCTURE, STRUCTURE_PY, 'utf8');
  }
  return CHEMIN_STRUCTURE;
}

test.after(() => {
  if (DOSSIER_STRUCTURE) { fs.rmSync(DOSSIER_STRUCTURE, { recursive: true, force: true }); }
});

function structureDe(chemin) {
  const r = python([structurePy(), path.join(RACINE, 'pipeline'), chemin]);
  assert.strictEqual(r.status, 0, 'lecture de structure impossible sur ' + chemin + ' : ' + r.stderr);
  return JSON.parse(r.stdout);
}

for (const G of GABARITS) {
test('pronto-lire.py : mêmes étiquettes, même nombre de rangées d’auteur, mêmes blocs — ' + G.code + ' .docx et .odt (converti)',
  { skip: sansPandocWsl || sansPython }, () => {
  const structDocx = structureDe(G.docx);
  const structOdt = structureDe(odtConverti(G));

  assert.strictEqual(structDocx.n_tables, structOdt.n_tables,
    'nombre de tableaux de premier niveau différent : docx=' + structDocx.n_tables
    + ' odt=' + structOdt.n_tables);
  assert.deepStrictEqual(structDocx.table1_labels, structOdt.table1_labels,
    'étiquettes du tableau des métadonnées différentes : docx=' + JSON.stringify(structDocx.table1_labels)
    + ' odt=' + JSON.stringify(structOdt.table1_labels));
  assert.deepStrictEqual(structDocx.table2_lignes, structOdt.table2_lignes,
    'rangées (et leurs étiquettes de champ) du tableau des auteurs différentes : docx='
    + JSON.stringify(structDocx.table2_lignes) + ' odt=' + JSON.stringify(structOdt.table2_lignes));
  assert.deepStrictEqual(structDocx.blocs_ancienne_forme, structOdt.blocs_ancienne_forme,
    'blocs à l’ancienne forme différents : docx=' + JSON.stringify(structDocx.blocs_ancienne_forme)
    + ' odt=' + JSON.stringify(structOdt.blocs_ancienne_forme));
  assert.deepStrictEqual(structDocx.blocs_nouvelle_forme, structOdt.blocs_nouvelle_forme,
    'étiquettes des blocs figure/tableau (nouvelle forme) différentes : docx='
    + JSON.stringify(structDocx.blocs_nouvelle_forme) + ' odt='
    + JSON.stringify(structOdt.blocs_nouvelle_forme));

  // Forme attendue du gabarit : quatre étiquettes de métadonnées ; quatre rangées dans le
  // tableau des auteurs (l'en-tête « Photo »/« Autrice ou auteur », puis trois
  // rangées-modèle) ; aucun bloc à l'ancienne forme et deux à la nouvelle (exemples de bloc
  // figure et de bloc tableau), à cinq étiquettes chacun. Les deepStrictEqual ci-dessus
  // détectent déjà tout changement ; ces assertions décrivent la forme.
  assert.strictEqual(structDocx.table1_labels.length, 4);
  assert.strictEqual(structDocx.table2_lignes.length, 4);
  assert.strictEqual(structDocx.blocs_ancienne_forme.length, 0);
  assert.strictEqual(structDocx.blocs_nouvelle_forme.length, 2);
  assert.strictEqual(structDocx.blocs_nouvelle_forme[0].length, 5);
  // Le second bloc a cinq étiquettes, « Source : » comprise, comme le dit l'aide (« Copiez
  // ces quatre paragraphes »).
  assert.strictEqual(structDocx.blocs_nouvelle_forme[1].length, 5);
});
}

// Le .odt n'est pas lu directement : pronto-lire.py le refuse en le disant, l'import le
// convertit d'abord.
test('pronto-lire.py : un .odt passé directement est refusé, avec un message fr puis de', { skip: sansPython }, () => {
  const base = dossierJetable();
  try {
    const r = python([PRONTO_LIRE, GABARITS[0].odt, 'x', base]);
    assert.strictEqual(r.status, 1, 'un .odt direct doit être refusé : ' + r.stdout + r.stderr);
    assert.match(r.stderr, /\.odt n’est pas lu directement.*\[de\].*\.odt/s);
    assert.strictEqual(fs.readdirSync(base).length, 0, 'rien ne doit être créé');
    assert.notStrictEqual(python([PRONTO_LIRE, '--reconnaitre', GABARITS[0].odt]).status, 0);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ── Le choix du lecteur, document par document ────────────────────────────────────────────
//
// pipeline/import-docx.sh demande `pronto-lire.py --reconnaitre` pour chaque document
// déposé : ceux qui déclarent les styles du gabarit vont au lecteur du gabarit, les autres à
// docx-meta.py. La rédaction reçoit les deux sortes de documents, souvent le même jour.
//
// Le critère porte sur styles.xml, pas sur le corps : un document parti du gabarit reste
// reconnu même sans les lignes d'aide, et un Word hérité ne le devient pas par accident.

const CHAPITRE_HERITE = path.join(RACINE, 'livre-template', 'Modele-chapitre-SZH.docx');

// Codes de --reconnaitre : 0 = au gabarit, 10 = pas au gabarit, autre = panne (le shell la
// signale au lieu de la prendre pour un « non »).
const PAS_AU_GABARIT = 10;

function reconnait(chemin) {
  const r = python([PRONTO_LIRE, '--reconnaitre', chemin]);
  assert.ok(r.status === 0 || r.status === PAS_AU_GABARIT,
    '--reconnaitre a échoué de façon inattendue (code ' + r.status + ') : ' + r.stderr);
  return r.status === 0;
}

test('pronto-lire.py --reconnaitre : les deux gabarits livrés sont reconnus, un Word hérité ne l’est pas', { skip: sansPython }, () => {
  assert.ok(fs.existsSync(CHAPITRE_HERITE),
    'le Word hérité de référence manque : ' + CHAPITRE_HERITE);

  for (const G of GABARITS) {
    assert.strictEqual(reconnait(G.docx), true,
      'le gabarit .docx ' + G.code + ' livré n’est plus reconnu : tout document du gabarit '
      + 'repartirait chez docx-meta.py, qui devine au lieu de lire');
    if (!sansPandocWsl) {
      assert.strictEqual(reconnait(odtConverti(G)), true,
        'le gabarit .odt ' + G.code + ' converti n’est plus reconnu');
    }
  }
  assert.strictEqual(reconnait(CHAPITRE_HERITE), false,
    'un Word hérité a été pris pour un document du gabarit : il serait lu par un lecteur qui '
    + 'refuse de deviner, et son import échouerait');
});

test('pronto-lire.py --reconnaitre : un fichier absent ou illisible n’est jamais « au gabarit »', { skip: sansPython }, () => {
  // Un document illisible part chez l'ancien lecteur, dont le message d'échec est plus
  // précis : « pas au gabarit » (10), pas une panne.
  assert.strictEqual(python([PRONTO_LIRE, '--reconnaitre',
    path.join(RACINE, 'nulle-part-du-tout.docx')]).status, PAS_AU_GABARIT);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-pronto-'));
  try {
    const bidon = path.join(base, 'pas-un-zip.docx');
    fs.writeFileSync(bidon, 'ceci n’est pas une archive', 'utf8');
    assert.strictEqual(python([PRONTO_LIRE, '--reconnaitre', bidon]).status, PAS_AU_GABARIT);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
