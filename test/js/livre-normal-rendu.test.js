// Maquette normal rendue par WeasyPrint (WSL) : de petits livres factices composés avec la
// vraie pile du livre (socle, livre/base, livre/normal, partage-filtres), mesurés sur le PDF.
// Les cotes sont celles des livres de référence (docs/ARCHITECTURE-LIVRES.md § 5.1).
//
//   node --test test/js/livre-normal-rendu.test.js
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
const PILE = [
  path.join(STYLES, 'socle.css'), path.join(STYLES, 'livre', 'base.css'),
  path.join(STYLES, 'livre', 'normal.css'), path.join(STYLES, 'partage-filtres.css'),
];
const GRILLE = 20.0;
const PAS = 13.5 * 25.4 / 72;

// Rend chaque cas et rend, par cas : les lignes de chaque page (y de ligne de base en mm,
// police, corps, texte) et le style calculé des éléments demandés par classe.
const MESURER = String.raw`
import io, json, sys
import pypdf, weasyprint
PT_MM = 25.4 / 72
def lignes(page):
    haut = float(page.mediabox[3]); vues = {}
    def v(t, cm, tm, police, corps):
        if not t.strip(): return
        y = round((haut - (cm[1] * tm[4] + cm[3] * tm[5] + cm[5])) * PT_MM, 2)
        nom = str((police or {}).get('/BaseFont', '?')).split('+')[-1]
        vues.setdefault(y, []).append((nom, round(corps * abs(tm[3]) * abs(cm[3]) if tm[3] else corps, 2), t))
    page.extract_text(visitor_text=v)
    return [[y, x[0][0], max(c for _, c, _ in x), ''.join(t for *_, t in x)] for y, x in sorted(vues.items())]
def styles(boite, classes, acc):
    el = getattr(boite, 'element', None)
    cl = (el.get('class') or '').split() if el is not None else []
    for c in classes:
        if c in cl and c not in acc:
            s = boite.style
            acc[c] = {'corps': round(s['font_size'] * 0.75, 2), 'couleur': list(s['color']),
                      'cesure': list(s['hyphenate_limit_chars']),
                      'approche': s['letter_spacing'] if isinstance(s['letter_spacing'], str) else round(s['letter_spacing'], 3)}
    for e in getattr(boite, 'children', []) or []:
        styles(e, classes, acc)
    return acc
res = {}
for cas in json.load(open(sys.argv[1], encoding='utf-8')):
    doc = weasyprint.HTML(string=cas['html'], base_url=cas['base']).render()
    tampon = io.BytesIO(); doc.write_pdf(tampon)
    r = pypdf.PdfReader(io.BytesIO(tampon.getvalue()))
    st = {}
    for p in doc.pages: styles(p._page_box, cas.get('classes', []), st)
    res[cas['nom']] = {'pages': [lignes(p) for p in r.pages], 'styles': st}
print(json.dumps(res))
`;

function livre(corps, attrs) {
  return '<!doctype html><html lang="de" data-titre-chapitre="grand" data-intertitres="'
    + ((attrs && attrs.intertitres) || 'gras') + '" data-legende="dessus"'
    + ((attrs && attrs.html) || '') + '><head><meta charset="utf-8">'
    + '<title>Banc</title>'
    + PILE.map((f) => '<link rel="stylesheet" href="' + cheminVersWsl(f) + '">').join('')
    + '</head><body>' + corps + '</body></html>';
}

function chapitre(id, contenu) {
  return '<section class="szh-chapitre" id="ch-' + id + '">'
    + '<div class="szh-onglet" aria-hidden="true"></div><div class="szh-pastille" aria-hidden="true">1</div>'
    + contenu + '</section>';
}

// Un pixel gris, image de figure.
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==';
const TEXTE = 'Ein Satz ohne Bedeutung, der eine Zeile des Fliesstexts füllt und noch etwas weiter geht. ';
const CITATION = 'Zitierter Satz in kleinerer Schrift, der eine ganze Zeile der Blockzitate füllt. ';

// Une citation de n lignes : n phrases d'à peu près une ligne chacune, coupées par <br>.
function citation(n) {
  return '<blockquote><p>' + Array.from({ length: n }, (_, i) => 'Zeile ' + (i + 1) + ' des Zitats').join('<br>')
    + '</p></blockquote>';
}

function cas() {
  const base = cheminVersWsl(RACINE) + '/';
  const l = [];
  // Un titre ou une figure en tête de page, après une coupure forcée (nouveau chapitre).
  for (const [nom, tete, attrs] of [
    ['h2-forcé', '<h2 id="x-a">Abschnitt oben</h2>'],
    ['h3-forcé', '<h3 id="x-b">Unterabschnitt oben</h3>'],
    ['h4-forcé', '<h4 id="x-c">Kleiner Abschnitt oben</h4>'],
    ['h2-demi-gras-forcé', '<h2 id="x-d">Abschnitt oben</h2>', { intertitres: 'demi-gras' }],
    ['figure-forcée', '<figure><figcaption><span class="szh-numero">Abbildung 1:</span> Legende oben</figcaption>'
      + '<div style="height: 30mm; background: #ccc"></div></figure>'],
  ]) {
    l.push({ nom, base, html: livre(chapitre('a', '<p>' + TEXTE + '</p>')
      + chapitre('b', tete + '<p>' + TEXTE + TEXTE + '</p>'), attrs) });
  }
  // Une citation de 1 à 4 lignes entre deux paragraphes.
  for (let n = 1; n <= 4; n++) {
    l.push({ nom: 'citation-' + n, base, html: livre(chapitre('a', '<p>' + TEXTE + TEXTE + '</p>'
      + citation(n) + '<p>Danach folgt der Text. ' + TEXTE + '</p>')) });
  }
  // Légende avec crédit, indice et exposant ; paragraphe avec appel de note.
  l.push({ nom: 'legende', base, classes: ['szh-credit', 'szh-legende-test', 'szh-texte-test'], html: livre(chapitre('a',
    '<figure><figcaption class="szh-legende-test"><span class="szh-numero">Abbildung 1:</span> '
    + 'E<sub>3</sub>BP-Modell der Praxis mit x<sup>2</sup> nach einem langen Titel, der auf eine zweite '
    + 'und eine dritte Zeile umbricht, damit das Interlinear messbar ist, und noch weiter '
    + '<span class="szh-credit">(© Testbild | Quelle)</span></figcaption>'
    + '<div style="height: 20mm; background: #ccc"></div></figure>'
    + '<p class="szh-texte-test">' + TEXTE + 'Hier steht ein Anmerkungsaufruf<span class="szh-note">Eine Fussnote.</span> '
    + TEXTE + TEXTE + '</p>')) });
  // Figure à filets avec crédit, suivie de texte ; tableau zébré de cinq rangées.
  l.push({ nom: 'filets', base, html: livre(chapitre('a', '<p>' + TEXTE + '</p>'
    + '<figure><figcaption><span class="szh-numero">Abbildung 1:</span> Kurze Legende '
    + '<span class="szh-credit">(Quelle, 2020)</span></figcaption>'
    + '<img alt="Grau" style="height: 30mm; width: 60mm" src="data:image/png;base64,' + PIXEL + '"></figure>'
    + '<p>Nach der Abbildung. ' + TEXTE + '</p>'
    + '<div class="szh-tableau-boite"><table><caption>Tabelle 1: Legende</caption>'
    + '<thead><tr><th scope="col">Kopf</th></tr></thead><tbody>'
    + ['Eins', 'Zwei', 'Drei', 'Vier', 'Fünf'].map((x) => '<tr><td>Reihe ' + x + '</td></tr>').join('')
    + '</tbody></table></div>'), { html: ' data-cadre-figure="filets" data-tableaux="zebre"' }) });
  // Page de titre : éditeurs sur une ligne (Hofer p3) et sur deux (HfH p5).
  for (const [nom, noms] of [['titre-1', 'Anna Muster und Ben Beispiel (Hrsg.)'],
    ['titre-2', 'Anna Muster, Ben Beispiel, Carla Probe, Dora Vorlage, Emil Platzhalter, Fritz Fiktiv (Hrsg.)']]) {
    l.push({ nom, base, html: livre('<section class="szh-liminaire szh-page-titre"><p class="szh-auteurs">' + noms
      + '</p><p class="szh-titre">Ein Titel</p><p class="szh-sous-titre">Ein Untertitel</p></section>') });
  }
  // Liste numérotée qui reprend à 7 (balisage de szh-listes-serrees.lua).
  l.push({ nom: 'liste-rang', base, html: livre(chapitre('a', '<p>' + TEXTE + '</p>'
    + '<div class="szh-liste-rang" style="--szh-rang: 6"><ol start="7"><li>Sieben</li><li>Acht</li></ol></div>')) });
  // Impressum court et impressum long : la fin du texte tombe au même endroit.
  for (const [nom, n] of [['impressum-court', 3], ['impressum-long', 9]]) {
    l.push({ nom, base, html: livre('<section class="szh-liminaire szh-impressum">'
      + Array.from({ length: n }, (_, i) => '<p>Block ' + (i + 1) + ' des Impressums</p>').join('')
      + '<p>Letzter Block des Impressums</p></section>') });
  }
  return l;
}

let _mesures = null;
function mesures() {
  if (_mesures) { return _mesures; }
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-normal-rendu-'));
  try {
    const entree = path.join(d, 'cas.json');
    const script = path.join(d, 'mesurer.py');
    fs.writeFileSync(entree, JSON.stringify(cas()), 'utf8');
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

// Les lignes de la page qui porte `motif`, et l'index de cette ligne.
function trouver(pages, motif) {
  for (const ls of pages) {
    const i = ls.findIndex((x) => x[3].includes(motif));
    if (i >= 0) { return { ls, i }; }
  }
  return null;
}

function proche(vu, attendu, tol, quoi) {
  assert.ok(Math.abs(vu - attendu) <= tol, quoi + ' : ' + vu + ' mm, attendu ' + attendu.toFixed(2) + ' mm (± ' + tol + ')');
}

test('rendu normal : un intertitre ou une légende en tête de page, après une coupure forcée, pose sa ligne de base sur la grille', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  const m = mesures();
  for (const [nom, motif] of [['h2-forcé', 'Abschnitt oben'], ['h3-forcé', 'Unterabschnitt oben'],
    ['h4-forcé', 'Kleiner Abschnitt oben'], ['h2-demi-gras-forcé', 'Abschnitt oben'], ['figure-forcée', 'Legende oben']]) {
    const v = trouver(m[nom].pages, motif);
    assert.ok(v, nom + ' : texte introuvable');
    assert.strictEqual(v.i, 0, nom + ' : le titre n\'ouvre pas sa page');
    proche(v.ls[0][0], GRILLE, 0.1, nom + ', première ligne de base');
  }
});

test('rendu normal : le texte qui suit une citation de 1 à 4 lignes reprend 9,5 mm sous sa dernière ligne', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  const m = mesures();
  for (let n = 1; n <= 4; n++) {
    const v = trouver(m['citation-' + n].pages, 'Danach folgt');
    assert.ok(v, 'citation-' + n + ' : texte suivant introuvable');
    const derniere = v.ls[v.i - 1];
    assert.match(derniere[3], new RegExp('Zeile ' + n + ' des Zitats'), 'citation-' + n);
    proche(+(v.ls[v.i][0] - derniere[0]).toFixed(2), 2 * PAS, 0.1, 'citation de ' + n + ' ligne(s), écart');
    // Aucune ligne de la citation ne glisse : 12,25 pt entre deux lignes.
    for (let k = v.i - n + 1; k < v.i; k++) {
      proche(+(v.ls[k][0] - v.ls[k - 1][0]).toFixed(2), 12.25 * 25.4 / 72, 0.05, 'interligne de citation');
    }
  }
});

test('rendu normal : le crédit de la légende garde le corps et l’encre de la légende', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  const st = mesures().legende.styles;
  assert.ok(st['szh-credit'] && st['szh-legende-test'], JSON.stringify(st));
  assert.strictEqual(st['szh-credit'].corps, st['szh-legende-test'].corps, 'corps du crédit');
  assert.deepStrictEqual(st['szh-credit'].couleur, st['szh-legende-test'].couleur, 'encre du crédit');
});

test('rendu normal : un indice ou un exposant n’écarte pas l’interligne, ni l’appel de note', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  const pages = mesures().legende.pages;
  const v = trouver(pages, 'Abbildung 1');
  assert.ok(v, 'légende introuvable');
  const corps = v.ls.filter((x) => x[2] === 10);
  const i0 = corps.findIndex((x) => x[3].includes('Abbildung 1'));
  for (let k = i0 + 1; k < i0 + 3; k++) {
    proche(+(corps[k][0] - corps[k - 1][0]).toFixed(2), PAS, 0.05, 'interligne de la légende, ligne ' + (k - i0 + 1));
  }
  const appel = trouver(pages, 'Anmerkungsaufruf');
  assert.ok(appel, 'appel de note introuvable');
  const texte = appel.ls.filter((x) => x[2] === 10 && x[0] >= appel.ls[appel.i][0] - 6 && x[0] <= appel.ls[appel.i][0] + 6);
  for (let k = 1; k < texte.length; k++) {
    proche(+(texte[k][0] - texte[k - 1][0]).toFixed(2), PAS, 0.05, 'interligne autour de l’appel de note');
  }
});

test('rendu normal : la césure garde au moins 2 lettres avant le tiret et 3 après', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  const st = mesures().legende.styles['szh-legende-test'];
  assert.deepStrictEqual(st.cesure, [5, 2, 3]);
});

// Approche du texte courant : celle qui apparie le plus de lignes avec les deux livres de
// référence, mesurée de 0 à 0,01 em (docs/ARCHITECTURE-LIVRES.md § 5.1).
test('rendu normal : le texte courant compose sans approche', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  const st = mesures().legende.styles['szh-texte-test'];
  assert.ok(st, 'paragraphe introuvable');
  assert.ok(st.approche === 'normal' || st.approche === 0, 'approche : ' + JSON.stringify(st.approche));
});
// cadre-figure: filets (HfH p55, p207) : le crédit sur sa propre ligne, et le texte qui suit la
// figure à 9,6 mm environ sous le filet du bas, soit à 9,5–9,8 mm dans la référence.
test('rendu normal : figure à filets, crédit sur sa ligne et texte repris sous le filet', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  const pages = mesures().filets.pages;
  const leg = trouver(pages, 'Kurze Legende');
  assert.ok(leg, 'légende introuvable');
  assert.ok(!leg.ls[leg.i][3].includes('Quelle'), 'le crédit suit le titre sur la même ligne');
  const cred = trouver(pages, '(Quelle, 2020)');
  proche(+(cred.ls[cred.i][0] - leg.ls[leg.i][0]).toFixed(2), PAS, 0.05, 'crédit, ligne suivante');
  // Le filet bas n'est pas du texte : on mesure de la dernière ligne de la légende au texte.
  const apres = trouver(pages, 'Nach der Abbildung');
  // Hauteur de l'image plus 21,7 mm : ce que mesure la référence HfH p207 (légende 25,0, image
  // de 47,7 mm entre filets, texte 86,7), recoupé sur le livre de comparaison.
  proche(+(apres.ls[apres.i][0] - cred.ls[cred.i][0]).toFixed(2), 30 + 21.7, 0.3, 'légende → texte suivant');
});

// tableaux: zebre (HfH p105) : une rangée d'une ligne mesure 6,45 mm.
test('rendu normal : tableau zébré, rangées de 6,45 mm', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  const pages = mesures().filets.pages;
  const un = trouver(pages, 'Reihe Eins'); const cinq = trouver(pages, 'Reihe Fünf');
  assert.ok(un && cinq, 'rangées introuvables');
  proche(+((cinq.ls[cinq.i][0] - un.ls[un.i][0]) / 4).toFixed(3), 6.45, 0.01, 'pas des rangées');
});

// Impressum (Hofer p2, HfH p6) : le dernier bloc de texte finit à 185,6 mm, quel que soit le
// nombre de blocs ; la rangée de logos de l'imprimeur est sous lui, sur la dernière ligne.
test('rendu normal : l’impressum est calé sur le bas de la page', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  for (const nom of ['impressum-court', 'impressum-long']) {
    const v = trouver(mesures()[nom].pages, 'Letzter Block');
    assert.ok(v, nom + ' : dernier bloc introuvable');
    proche(v.ls[v.i][0], 185.6, 0.3, nom + ', dernier bloc');
  }
});

// Page de titre (Hofer p3, HfH p5) : le titre à 48,6 mm, que les éditeurs tiennent sur une
// ligne ou sur deux.
test('rendu normal : le titre de la page de titre ne bouge pas avec la ligne des éditeurs', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  for (const nom of ['titre-1', 'titre-2']) {
    const v = trouver(mesures()[nom].pages, 'Ein Titel');
    assert.ok(v, nom + ' : titre introuvable');
    proche(v.ls[v.i][0], 48.6, 0.25, nom + ', titre');
    proche(v.ls[0][0], 23.8, 0.25, nom + ', éditeurs');
  }
});

// Une liste qui reprend à 7 (HfH p166) imprime 7., 8. et non 1., 2.
test('rendu normal : une liste numérotée garde son rang de départ', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  const texte = mesures()['liste-rang'].pages.flat().map((x) => x[3]).join('\n');
  assert.match(texte, /7\./, texte);
  assert.match(texte, /8\./, texte);
  assert.doesNotMatch(texte, /(^|\n)1\.\s/, texte);
});
