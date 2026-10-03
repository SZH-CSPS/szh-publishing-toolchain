// Sommaire de livre rendu par WeasyPrint (WSL), avec la vraie pile de chaque maquette : le
// numéro de page d'une entrée de deux lignes est sur la ligne de base de la première ligne,
// au fer à droite, sans que le titre passe dessous ; le titre se lit avant le numéro.
//
//   node --test test/js/livre-sommaire-rendu.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { sansPandocWsl, sauter, cheminVersWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const STYLES = path.join(RACINE, 'pipeline', 'styles');

// Par cas et par entrée du sommaire : lignes de base (mm) des lignes du titre et du numéro,
// bord droit du titre et bords du numéro (boîtes de WeasyPrint), texte de l'entrée dans
// l'ordre du flux de contenu et dans celui de l'arbre de structure, liens du numéro.
const MESURER = String.raw`
import io, json, sys
import pypdf, weasyprint
from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject, NameObject
PX_MM = 25.4 / 96
PT_MM = 25.4 / 72
def res(o): return o.get_object() if isinstance(o, IndirectObject) else o
def boites_entrees(page_box):
    entrees = {}
    def walk(b, li, dans_a, dans_num):
        b = getattr(b, '_box', b)
        tag = getattr(b, 'element_tag', '') or ''
        if tag == 'li':
            li = entrees.setdefault(id(b.element), {'titre': [], 'num': []})
        if tag == 'a': dans_a = True
        if tag.endswith('::after') and dans_a: dans_num = True
        if li is not None and type(b).__name__ == 'TextBox' and dans_a:
            x0 = b.position_x * PX_MM; x1 = (b.position_x + b.width) * PX_MM
            (li['num'] if dans_num else li['titre']).append([round(x0, 2), round(x1, 2), b.text])
        for e in getattr(b, 'children', []) or []:
            walk(e, li, dans_a, dans_num)
    walk(page_box, None, False, False)
    return list(entrees.values())
def lignes(page):
    haut = float(page.mediabox[3]); vus = []
    def v(t, cm, tm, police, corps):
        if t.strip():
            vus.append([round((haut - (cm[1] * tm[4] + cm[3] * tm[5] + cm[5])) * PT_MM, 2),
                        round((cm[0] * tm[4] + cm[2] * tm[5] + cm[4]) * PT_MM, 2), t.strip()])
    page.extract_text(visitor_text=v)
    return vus
def structure(r, page):
    pid = page.indirect_reference.idnum; textes = {}; pile = []
    def avant(op, args, cm, tm):
        if op in (b'BDC', b'BMC'):
            p = res(args[1]) if op == b'BDC' and len(args) > 1 else None
            if isinstance(p, NameObject): p = page['/Resources']['/Properties'][p]
            m = p.get('/MCID') if isinstance(p, DictionaryObject) else None
            pile.append(int(m) if m is not None else (pile[-1] if pile else None))
        elif op == b'EMC' and pile: pile.pop()
    def texte(t, cm, tm, f, c):
        if pile and pile[-1] is not None: textes[pile[-1]] = textes.get(pile[-1], '') + t
    page.extract_text(visitor_operand_before=avant, visitor_text=texte)
    lis = []
    def walk(e, pg, acc):
        e = res(e)
        if isinstance(e, int):
            if pg == pid: acc.append(textes.get(e, ''))
            return
        if not isinstance(e, DictionaryObject): return
        if '/Pg' in e: pg = e.raw_get('/Pg').idnum
        if e.get('/Type') == '/MCR': walk(int(e['/MCID']), pg, acc); return
        if e.get('/S') == '/LI':
            acc = []; lis.append(acc)
        k = e.get('/K')
        for kid in (list(k) if isinstance(k, ArrayObject) else ([k] if k is not None else [])):
            walk(kid, pg, acc)
    walk(r.trailer['/Root']['/StructTreeRoot'], None, [])
    return [' '.join(''.join(a).split()) for a in lis if ''.join(a).strip()]
res_ = {}
for cas in json.load(open(sys.argv[1], encoding='utf-8')):
    doc = weasyprint.HTML(string=cas['html'], base_url=cas['base']).render()
    tampon = io.BytesIO(); doc.write_pdf(tampon, pdf_variant='pdf/ua-1')
    r = pypdf.PdfReader(io.BytesIO(tampon.getvalue())); p = r.pages[0]; haut = float(p.mediabox[3])
    liens = []
    for a in p.get('/Annots') or []:
        a = a.get_object()
        if a.get('/Subtype') != '/Link': continue
        x1, y1, x2, y2 = [float(v) for v in a['/Rect']]
        liens.append([round(min(x1, x2) * PT_MM, 2), round((haut - max(y1, y2)) * PT_MM, 2),
                      round(max(x1, x2) * PT_MM, 2), round((haut - min(y1, y2)) * PT_MM, 2)])
    res_[cas['nom']] = {'lignes': lignes(p), 'flux': p.extract_text(), 'structure': structure(r, p),
                        'boites': boites_entrees(doc.pages[0]._page_box), 'liens': liens}
print(json.dumps(res_))
`;

// Une entrée : classes du <li>, titre, numéro de partie et ligne d'auteurs éventuels.
function sommaire(entrees) {
  return '<section class="szh-sommaire" id="szh-sommaire" style="--onglet-hauteur: 25mm">'
    + '<h1>Inhalt</h1><ol>' + entrees.map((e, i) => '<li class="' + e.classes + '"><span>'
      + (e.num ? '<span class="szh-sommaire-num">' + e.num + '</span>' : '')
      + '<a href="#c' + i + '">' + e.titre + '</a></span>'
      + (e.auteurs ? '<span class="szh-sommaire-auteurs">' + e.auteurs + '</span>' : '') + '</li>').join('')
    + '</ol></section>'
    + entrees.map((e, i) => '<section class="szh-chapitre"><h1 id="c' + i + '">Kapitel ' + i
      + '</h1><p>Text.</p></section>').join('');
}

function livre(maquette, attrs, corps) {
  const pile = ['socle.css', 'livre/base.css', 'livre/' + maquette + '.css', 'partage-filtres.css']
    .map((f) => path.join(STYLES, f));
  return '<!doctype html><html lang="de" ' + attrs + '><head><meta charset="utf-8"><title>Banc</title>'
    + pile.map((f) => '<link rel="stylesheet" href="' + cheminVersWsl(f) + '">').join('')
    + '</head><body>' + corps + '</body></html>';
}

const LONG = 'Einleitung in die berufliche Teilhabe von Erwachsenen mit Beeinträchtigungen im Arbeitsleben';
const LONG2 = 'Theoretische Konzepte und Vorannahmen der beruflichen Teilhabe im späteren Erwachsenenalter';
const CAS = {
  plat: ['normal', 'data-sommaire="plat"', [
    { classes: 'niveau-1', titre: LONG }, { classes: 'niveau-2', titre: LONG2 },
    { classes: 'niveau-1', titre: 'Kurz' }]],
  hierarchique: ['normal', 'data-sommaire="hierarchique"', [
    { classes: 'niveau-0 partie-seule', num: '1', titre: 'Grundlagen einer Pädagogik der Vielfalt und der gemeinsamen Schule' },
    { classes: 'niveau-1 dans-partie', titre: '1.1\u2002' + LONG, auteurs: 'Lea Beispiel und Noah Probe' },
    { classes: 'niveau-1', titre: 'Kurz' }]],
  falc: ['falc', '', [
    { classes: 'niveau-1', titre: '1 La société doit comprendre les personnes handicapées et leurs droits dans la vie de tous les jours' },
    { classes: 'niveau-1', titre: '2 Court' }]],
};

let _mesures = null;
function mesures() {
  if (_mesures) { return _mesures; }
  const base = cheminVersWsl(STYLES) + '/';
  const cas = Object.entries(CAS).map(([nom, [maquette, attrs, entrees]]) =>
    ({ nom, base, html: livre(maquette, attrs, sommaire(entrees)) }));
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-sommaire-rendu-'));
  try {
    const entree = path.join(d, 'cas.json');
    const script = path.join(d, 'mesurer.py');
    fs.writeFileSync(entree, JSON.stringify(cas), 'utf8');
    fs.writeFileSync(script, MESURER, 'utf8');
    const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
    const r = cp.spawnSync(fs.existsSync(wslExe) ? wslExe : 'wsl.exe',
      ['-d', 'SZH-Publishing', '--', '/opt/weasyprint/bin/python', cheminVersWsl(script), cheminVersWsl(entree)],
      { encoding: 'utf8', windowsHide: true, timeout: 280000, maxBuffer: 64 * 1024 * 1024 });
    assert.strictEqual(r.status, 0, 'rendu WeasyPrint en échec : ' + r.stderr);
    _mesures = JSON.parse(r.stdout);
    return _mesures;
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

// Ligne de base (mm) d'un fragment de texte de la page, cherché par son début.
function y(m, debut, minX, maxX) {
  const v = m.lignes.find((l) => l[2].startsWith(debut) && l[1] >= (minX || 0) && l[1] <= (maxX || 1e9));
  assert.ok(v, '« ' + debut + ' » introuvable dans ' + JSON.stringify(m.lignes));
  return v[0];
}

for (const nom of Object.keys(CAS)) {
  const entrees = CAS[nom][2];

  test('sommaire ' + nom + ' : le numéro d’une entrée de deux lignes est sur la première', (t) => {
    if (sansPandocWsl) { sauter.wsl(t); return; }
    const m = mesures()[nom];
    entrees.forEach((e, i) => {
      const b = m.boites[i];
      assert.ok(b && b.num.length === 1, nom + ' ' + i + ' : un numéro attendu, ' + JSON.stringify(b));
      const num = b.num[0];
      const titre = b.titre.filter((f) => f[2].trim());
      const premier = titre[0][2].trim().split(/\s+/)[0];
      const yTitre = y(m, premier, 0, num[0] - 1);
      const yNum = y(m, num[2].trim(), num[0] - 0.5, num[0] + 0.5);
      assert.ok(Math.abs(yNum - yTitre) <= 0.1,
        nom + ' ' + i + ' : numéro à y ' + yNum + ', première ligne du titre à y ' + yTitre);
      // Le titre s'arrête avant la colonne des numéros, sur chacune de ses lignes.
      const droite = Math.max(...titre.map((f) => f[1]));
      assert.ok(droite <= num[0], nom + ' ' + i + ' : titre jusqu’à ' + droite + ' mm, numéro dès ' + num[0] + ' mm');
    });
    // Les entrées longues tiennent bien sur deux lignes : sinon le cas ne prouve rien.
    const lignesTitre = (b) => new Set(b.titre.map((f) => f[2]).filter((s) => s.trim())).size;
    assert.ok(lignesTitre(m.boites[0]) >= 2, nom + ' : la première entrée devrait faire deux lignes');
  });

  test('sommaire ' + nom + ' : numéros au même fer à droite, quelle que soit la hauteur de l’entrée', (t) => {
    if (sansPandocWsl) { sauter.wsl(t); return; }
    const m = mesures()[nom];
    assert.strictEqual(m.boites.length, entrees.length, nom + ' : entrées ' + JSON.stringify(m.boites));
    assert.ok(m.boites.every((b) => b.num.length === 1), nom + ' : numéros ' + JSON.stringify(m.boites));
    const fers = m.boites.map((b) => b.num[0][1]);
    for (const f of fers) {
      assert.ok(Math.abs(f - fers[fers.length - 1]) <= 0.05, nom + ' : fers à droite ' + JSON.stringify(fers));
    }
  });

  test('sommaire ' + nom + ' : le titre se lit avant le numéro, et le numéro est un lien', (t) => {
    if (sansPandocWsl) { sauter.wsl(t); return; }
    const m = mesures()[nom];
    entrees.forEach((e, i) => {
      const num = m.boites[i].num[0];
      const fin = e.titre.split(/\s+/).pop();
      // Arbre de structure : ce que lit un lecteur d'écran.
      const li = m.structure.find((s) => s.includes(fin));
      assert.ok(li, nom + ' ' + i + ' : entrée absente de l’arbre de structure ' + JSON.stringify(m.structure));
      assert.ok(li.indexOf(fin) < li.lastIndexOf(num[2].trim()), nom + ' ' + i + ' : structure « ' + li + ' »');
      // Couche texte, ce que rend un copier-coller : le numéro suit le titre, avant l'entrée
      // suivante (les auteur·e·s peuvent s'intercaler).
      const flux = m.flux.replace(/\s+/g, ' ');
      const debut = flux.indexOf(fin);
      const suivante = entrees[i + 1] ? flux.indexOf(entrees[i + 1].titre.split(/\s+/)[0], debut) : -1;
      const segment = flux.slice(debut, suivante > debut ? suivante : undefined);
      assert.ok(debut >= 0 && new RegExp('\\s' + num[2].trim() + '(\\s|$)').test(segment),
        nom + ' ' + i + ' : flux « ' + flux + ' »');
      // Une annotation de lien couvre le numéro.
      const centre = (num[0] + num[1]) / 2;
      const yNum = y(m, num[2].trim(), num[0] - 0.5, num[0] + 0.5);
      assert.ok(m.liens.some((l) => l[0] <= centre && centre <= l[2] && l[1] <= yNum && yNum <= l[3] + 1),
        nom + ' ' + i + ' : aucun lien sur le numéro ' + JSON.stringify(m.liens));
    });
  });
}
