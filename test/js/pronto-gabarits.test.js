// LE CONTRÔLE LE PLUS IMPORTANT du chantier qui a séparé pipeline/docx-pronto.py en trois
// modules (pronto_modele.py, le noyau neutre ; pronto_docx.py et pronto_odt.py, les deux
// lecteurs ; pronto-lire.py, la CLI unique) : le même document, dans les deux formats, doit
// produire la MÊME fiche et les MÊMES lignes d'instructions. Sans ce contrôle, le partage de
// code entre les deux lecteurs ne serait qu'une promesse — rien ne prouverait qu'ils disent
// la même chose.
//
//   node --test "test/js/*.test.js"
//
// Les deux gabarits comparés ici sont ceux du dépôt (revue-template/), pas des fabrications
// de test : `Pronto - modele d'article.docx` est la copie de
// C:\Users\robin\Desktop\Pronto - modele d'article v2.docx (le « v2 » disparaît du nom : le
// dépôt versionne, pas le nom de fichier), et `Pronto - modele d'article.odt` en est la
// conversion LibreOffice, produite par :
//
//   soffice --headless --convert-to odt --outdir <dossier> "<le .docx>"
//
// C'est cette commande qu'il faudra rejouer le jour où quelqu'un modifiera le .docx sans
// toucher au .odt — ce qui arrivera, et c'est exactement ce que le second contrôle
// (parité de STRUCTURE) est là pour détecter.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const PRONTO_LIRE = path.join(RACINE, 'pipeline', 'pronto-lire.py');
const REVUE_DOCX = path.join(RACINE, 'revue-template', "Pronto - modele d'article.docx");
const REVUE_ODT = path.join(RACINE, 'revue-template', "Pronto - modele d'article.odt");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-pronto-gabarits-'));
}

// Lance pronto-lire.py sur `chemin` (le .docx ou le .odt du dépôt), rend { fiche,
// instructions, avertissements (codes seuls, triés) }.
function lire(chemin, slug) {
  const base = dossierJetable();
  try {
    const instr = path.join(base, 'instructions.txt');
    const r = python([PRONTO_LIRE, chemin, slug, base], { SZH_META: instr });
    assert.strictEqual(r.status, 0, 'pronto-lire.py a échoué sur ' + chemin + ' : ' + r.stderr);
    const cheminFiche = path.join(base, slug + '.meta.yaml');
    const codes = String(r.stderr).split(/\r?\n/)
      .filter((l) => l.indexOf('[import-avertissement]') === 0)
      .map((l) => l.split(' | ')[0].replace('[import-avertissement] ', ''))
      .sort();
    return {
      fiche: fs.existsSync(cheminFiche) ? fs.readFileSync(cheminFiche, 'utf8') : null,
      instructions: fs.existsSync(instr) ? fs.readFileSync(instr, 'utf8') : '',
      avertissements: codes
    };
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

// La seule ligne de la fiche qui a le droit de différer entre les deux formats : `source:`
// porte le nom du fichier déposé.
function sansLigneSource(fiche) {
  return (fiche || '').split(/\r?\n/).filter((l) => l.indexOf('source:') !== 0).join('\n');
}

test('pronto-lire.py : le même gabarit en .docx et en .odt donne la même fiche', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé (python3, puis python)'); }
  assert.ok(fs.existsSync(REVUE_DOCX), 'gabarit .docx manquant dans revue-template/ : ' + REVUE_DOCX);
  assert.ok(fs.existsSync(REVUE_ODT), 'gabarit .odt manquant dans revue-template/ : ' + REVUE_ODT);

  const vuDocx = lire(REVUE_DOCX, 'gabarit-docx');
  const vuOdt = lire(REVUE_ODT, 'gabarit-odt');

  assert.ok(vuDocx.fiche, 'le lecteur .docx n’a rien écrit dans la fiche');
  assert.ok(vuOdt.fiche, 'le lecteur .odt n’a rien écrit dans la fiche');
  assert.strictEqual(sansLigneSource(vuDocx.fiche), sansLigneSource(vuOdt.fiche),
    'la fiche (hors ligne source:) diffère entre le .docx et le .odt :\n--- docx ---\n'
    + vuDocx.fiche + '\n--- odt ---\n' + vuOdt.fiche);

  assert.strictEqual(vuDocx.instructions, vuOdt.instructions,
    'les lignes $SZH_META diffèrent entre le .docx et le .odt :\n--- docx ---\n'
    + vuDocx.instructions + '\n--- odt ---\n' + vuOdt.instructions);

  assert.deepStrictEqual(vuDocx.avertissements, vuOdt.avertissements,
    'les avertissements (codes) diffèrent entre le .docx et le .odt : docx=['
    + vuDocx.avertissements.join(', ') + '] odt=[' + vuOdt.avertissements.join(', ') + ']');
});

// ---- Parité de STRUCTURE ------------------------------------------------------------------
//
// Le contrôle ci-dessus compare ce que pronto-lire.py PRODUIT. Celui-ci compare directement
// ce que les deux lecteurs VOIENT dans le modèle neutre — étiquettes du tableau des
// métadonnées, nombre de rangées du tableau des auteurs et leurs étiquettes de champ,
// étiquettes du bloc figure/tableau — même quand la VALEUR saisie est vide (le gabarit,
// justement, n'a que des valeurs vides : le premier contrôle ne verrait donc pas une
// étiquette disparue ou renommée d'un seul côté, puisqu'une étiquette sans valeur n'écrit
// rien dans la fiche). Il tombera le jour où quelqu'un modifiera un seul des deux fichiers.
//
// Écrit une fois en tant que script Python dans un dossier jetable, comme FABRICANTE_PY dans
// pronto-lire.test.js : plus lisible qu'un programme -c pour une inspection aussi précise du
// modèle neutre. Importe pronto_docx/pronto_odt/pronto_modele DIRECTEMENT (pas via la CLI)
// pour lire, sous chaque étiquette « SZH Cle » d'une cellule, son texte aplati — QU'IL Y AIT
// UNE VALEUR OU NON, ce que pronto_modele.principal() ne rend jamais tel quel.

const STRUCTURE_PY = `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json, os, sys

sys.path.insert(0, sys.argv[1])
import pronto_modele as pm
import pronto_docx
import pronto_odt


def lire(chemin):
    ext = os.path.splitext(chemin)[1].lower()
    if ext == '.docx':
        return pronto_docx.lire(chemin)
    if ext == '.odt':
        return pronto_odt.lire(chemin)
    raise ValueError(ext)


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
    resultat['blocs'] = []
    for t in tables[2:]:
        if not pm.est_bloc_meta(t):
            continue
        etiquettes = []
        for c in t.rangees[0]:
            etiquettes.extend(etiquettes_cle(c))
        resultat['blocs'].append(sorted(etiquettes))
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

test('pronto-lire.py : mêmes étiquettes, même nombre de rangées d’auteur, mêmes blocs — .docx et .odt', () => {
  if (!PYTHON) { assert.ok(false, 'aucun interprète Python 3 trouvé'); }
  const structDocx = structureDe(REVUE_DOCX);
  const structOdt = structureDe(REVUE_ODT);

  assert.strictEqual(structDocx.n_tables, structOdt.n_tables,
    'nombre de tableaux de premier niveau différent : docx=' + structDocx.n_tables
    + ' odt=' + structOdt.n_tables);
  assert.deepStrictEqual(structDocx.table1_labels, structOdt.table1_labels,
    'étiquettes du tableau des métadonnées différentes : docx=' + JSON.stringify(structDocx.table1_labels)
    + ' odt=' + JSON.stringify(structOdt.table1_labels));
  assert.deepStrictEqual(structDocx.table2_lignes, structOdt.table2_lignes,
    'rangées (et leurs étiquettes de champ) du tableau des auteurs différentes : docx='
    + JSON.stringify(structDocx.table2_lignes) + ' odt=' + JSON.stringify(structOdt.table2_lignes));
  assert.deepStrictEqual(structDocx.blocs, structOdt.blocs,
    'étiquettes des blocs figure/tableau différentes : docx=' + JSON.stringify(structDocx.blocs)
    + ' odt=' + JSON.stringify(structOdt.blocs));

  // Le gabarit réel porte cinq étiquettes de métadonnées, quatre rangées dans le tableau des
  // auteurs (l'en-tête « Photo »/« Autrice ou auteur », puis trois rangées-modèle), et un
  // bloc figure/tableau à quatre étiquettes — mesuré à la main sur les deux fichiers. Si ces
  // nombres changent un jour, c'est que le gabarit a changé : les deux assertions
  // deepStrictEqual ci-dessus l'auraient déjà dit, celles-ci ne font que documenter la forme
  // attendue pour qui lit ce test.
  assert.strictEqual(structDocx.table1_labels.length, 5);
  assert.strictEqual(structDocx.table2_lignes.length, 4);
  assert.strictEqual(structDocx.blocs.length, 1);
  assert.strictEqual(structDocx.blocs[0].length, 4);
});
