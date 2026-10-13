// Les surprises de l'Accueil et des compilations : le calendrier de la semaine
// (lib/calendrier.js, calendrier.csv), les phrases d'attente (lib/attente.js) et les jeux
// cachés (media/_jeux.js).
//
//   node --test test/js/surprises.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ouvrir, chargerAvecVscodeFactice } = require('./dom-minimal');
const { pythonSortie, sansPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const calendrier = require(path.join(COCKPIT, 'lib', 'calendrier.js'));
const { TEXTES_COCKPIT } = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'i18n.js'));
const attente = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'attente.js'));
const { calendrierDeLaSemaine, textesJeux } = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'accueil-surprises.js'));
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
const { textesAccueil } = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'accueil-page.js'));

const jj = (d) => String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
const ENTETE = 'date;annee;type;fr;de\n';

// ---- Calendrier ----

test('calendrier.csv : chaque ligne se lit, et chaque semaine de 2026 à 2060 a au moins un événement', () => {
  const { entrees, erreurs } = calendrier.lire();
  assert.deepStrictEqual(erreurs, []);
  assert.ok(entrees.length > 52);
  const vides = [];
  for (let d = new Date(2026, 0, 5); d.getFullYear() < 2061; d.setDate(d.getDate() + 7)) {
    for (const langue of ['fr', 'de']) {
      if (!calendrier.semaine(entrees, d, langue).length) { vides.push(langue + ' ' + jj(d)); }
    }
  }
  assert.deepStrictEqual(vides, [], 'semaines sans événement');
});

test('calendrier : les dates mobiles tombent au bon jour', () => {
  const cas = [
    ['3e jeudi 05', 2027, '20.05.2027'], ['3e jeudi 05', 2026, '21.05.2026'],
    ['2e jeudi 10', 2026, '08.10.2026'], ['1er lundi 09', 2026, '07.09.2026'],
    ['3e dimanche 09', 2026, '20.09.2026'], ['dernier lundi 10', 2026, '26.10.2026'],
    ['dernier lundi 10', 2027, '25.10.2027'], ['dernier dimanche 02', 2026, '22.02.2026'],
    ['04.01', 2027, '04.01.2027']
  ];
  for (const [regle, an, attendu] of cas) {
    assert.strictEqual(jj(calendrier.dateDans(calendrier.regleDate(regle), an)), attendu, regle + ' ' + an);
  }
  assert.strictEqual(calendrier.dateDans(calendrier.regleDate('29.02'), 2027), null);
  assert.strictEqual(jj(calendrier.dateDans(calendrier.regleDate('29.02'), 2028)), '29.02.2028');
  assert.strictEqual(calendrier.dateDans(calendrier.regleDate('5e lundi 02'), 2026), null);
  for (const faux of ['32.01', '01.13', '1.2.2026', '3e jour 05', 'premier lundi 05', '']) {
    assert.strictEqual(calendrier.regleDate(faux), null, faux);
  }
});

test('calendrier : les lignes fautives sont écartées avec leur numéro et leur motif', () => {
  const texte = '\uFEFF# commentaire\r\n' + ENTETE.replace('\n', '\r\n') +
    '04.01;;int;Braille.;Braille.\r\n' +
    '\r\n' +
    '40.01;;int;a;b\r\n' +
    '05.01;19;int;a;b\r\n' +
    '06.01;;autre;a;b\r\n' +
    '07.01;;int;a;\r\n' +
    '08.01;;int;Il y a {ans} ans;Vor {ans} Jahren\r\n' +
    '09.01;;int;trop;de;colonnes\r\n' +
    '10.01;;fun;"Point-virgule ; ""cité""";Strichpunkt\r\n';
  const { entrees, erreurs } = calendrier.analyser(texte);
  assert.deepStrictEqual(erreurs.map((e) => e.ligne), [5, 6, 7, 8, 9, 10]);
  assert.match(erreurs[0].motif, /date illisible/);
  assert.match(erreurs[3].motif, /texte manquant en de/);
  assert.match(erreurs[4].motif, /\{ans\} sans année/);
  assert.strictEqual(entrees.length, 2);
  assert.strictEqual(entrees[1].textes.fr, 'Point-virgule ; "cité"');
  assert.match(calendrier.analyser('date;type\n').erreurs[0].motif, /en-tête attendu/);
  assert.match(calendrier.analyser('').erreurs[0].motif, /fichier vide/);
});

test('calendrier : la semaine va du lundi au dimanche, passe le Nouvel An et compte les années', () => {
  const { entrees } = calendrier.analyser(ENTETE +
    '31.12;;ch;Sylvestre;Silvester\n' +
    '01.01;2004;csps;Il y a {ans} ans;Vor {ans} Jahren\n' +
    '05.01;;int;Plus tard;Später\n' +
    '28.12;;fun;Lundi;Montag\n');
  // Le jeudi 31.12.2026 : du lundi 28.12.2026 au dimanche 03.01.2027.
  const s = calendrier.semaine(entrees, new Date(2026, 11, 31, 15), 'de');
  assert.deepStrictEqual(s.map((e) => [e.date, e.aujourdhui, e.texte]), [
    ['28.12', false, 'Montag'], ['31.12', true, 'Silvester'], ['01.01', false, 'Vor 23 Jahren']
  ]);
  // Une langue sans texte se rend en français.
  assert.strictEqual(calendrier.semaine(entrees, new Date(2027, 0, 5), 'it')[0].texte, 'Plus tard');
  assert.strictEqual(jj(calendrier.lundiDe(new Date(2026, 9, 18))), '12.10.2026');
});

test('accueil : l’encadré de la semaine porte ses libellés et les événements du fichier', () => {
  const cal = calendrierDeLaSemaine(new Date(2026, 11, 3), 'fr');
  assert.strictEqual(cal.titre, TEXTES_COCKPIT.fr['calendrier.titre']);
  assert.ok(cal.evenements.some((e) => e.aujourdhui && /handicapées/.test(e.texte)));
});

function pageAccueil(calendrierMsg) {
  const p = ouvrir({ racine: RACINE, page: 'accueil', cssPartage: ['_design.css'], jsPartage: ['_messages.js'], txt: textesAccueil() });
  p.envoyer({ type: MSG.CHARGER, langue: 'fr', anneeCourante: 2026, version: '3.11.0', exports: '',
    produits: [{ jeton: 'revue', libelle: 'Revue', type: 'numero', racine: 'C:\\P\\Revue', enCours: [], archives: [] }],
    dernierOuvert: '', historique: {}, journaux: [], calendrier: calendrierMsg });
  return p;
}

test('accueil : la page montre l’encadré, « aujourd’hui » à la place de la date du jour', () => {
  const p = pageAccueil({ titre: 'Prontogenda', aujourdhui: 'aujourd’hui', evenements: [
    { date: '01.12', aujourdhui: false, type: 'int', texte: 'Sida' },
    { date: '03.12', aujourdhui: true, type: 'int', texte: 'Handicap' }
  ] });
  const aside = p.parId.accueil.querySelectorAll('aside')[0];
  assert.ok(aside && !aside.hidden);
  assert.strictEqual(aside.getAttribute('aria-labelledby'), 'prod-calendrier');
  const lis = aside.querySelectorAll('li');
  assert.deepStrictEqual(lis.map((li) => li.textContent), ['01.12Sida', 'aujourd’huiHandicap']);
  assert.ok(lis[1].className.includes('accueil-calendrier-jour'));
  const vide = pageAccueil({ titre: 'Prontogenda', aujourdhui: '', evenements: [] });
  assert.ok(vide.parId.accueil.querySelectorAll('aside')[0].hidden);
});

// ---- Phrases d'attente ----

test('attente : chaque phrase existe en français et en allemand', () => {
  const cles = attente.clesPhrases();
  assert.ok(cles.length >= 10);
  for (const c of cles) {
    assert.ok(TEXTES_COCKPIT.fr[c] && TEXTES_COCKPIT.de[c], c);
  }
  assert.strictEqual(attente.phraseAuHasard(() => 0), TEXTES_COCKPIT.fr[cles[0]]);
});

test('attente : le message reste seul avant le délai, puis une phrase s’y ajoute et change', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const affiches = [];
  const ouverts = new Set();
  const fenetre = {
    setStatusBarMessage(texte) {
      affiches.push(texte);
      const jeton = {};
      ouverts.add(jeton);
      return { dispose: () => ouverts.delete(jeton) };
    }
  };
  const m = attente.messageAttente(fenetre, 'Compilation…', { delai: 5000, periode: 4000 });
  assert.deepStrictEqual(affiches, ['Compilation…']);
  t.mock.timers.tick(4999);
  assert.strictEqual(affiches.length, 1);
  t.mock.timers.tick(1);
  t.mock.timers.tick(4000);
  t.mock.timers.tick(4000);
  assert.strictEqual(affiches.length, 4);
  assert.ok(affiches.slice(1).every((a) => a.startsWith('Compilation… ') && a.length > 'Compilation… '.length));
  assert.strictEqual(new Set(affiches.slice(1)).size, 3, 'pas deux fois la même phrase de suite');
  assert.strictEqual(ouverts.size, 1, 'un seul message à la fois');
  m.dispose();
  assert.strictEqual(ouverts.size, 0);
  t.mock.timers.tick(20000);
  assert.strictEqual(affiches.length, 4, 'plus rien après dispose()');
});

// ---- Jeux ----

function chargerJeux() {
  const source = fs.readFileSync(path.join(COCKPIT, 'media', '_jeux.js'), 'utf8')
    .split('__TXT_JEUX__').join(JSON.stringify(textesJeux()));
  const element = () => ({ textContent: '', style: {}, setAttribute() {}, addEventListener() {}, appendChild() {} });
  const journal = { ouvertures: 0, fermetures: 0, clic: null, capture: null, modale: null };
  const contexte = {
    document: { documentElement: {}, addEventListener: (type, f, capture) => { if (type === 'click') { journal[capture ? 'capture' : 'clic'] = f; } } },
    getComputedStyle: () => ({ color: '#000', fontFamily: 'sans-serif', getPropertyValue: () => '#06c' }),
    SZH: {
      poser: element, bouton: element,
      modale: (o) => (journal.modale = {
        ouvrir() { journal.ouvertures++; if (o.construire) { o.construire(element()); o.construire = null; } },
        fermer() { journal.fermetures++; o.surFermeture(); }
      })
    },
    Date, Math, JSON, String, Number
  };
  vm.createContext(contexte);
  vm.runInContext(source, contexte);
  return { jeux: contexte.SZH_JEUX, journal };
}

test('jeux : cinq clics de suite sur le même produit ouvrent son jeu, pas moins ni plus espacés', () => {
  const { jeux, journal } = chargerJeux();
  const radio = (valeur) => ({ type: 'radio', name: 'produit-prod', value: valeur });
  let t = 1000;
  for (let i = 0; i < 4; i++) { assert.strictEqual(jeux.compterClic('produit-prod', 'revue', t += 300), null); }
  assert.strictEqual(jeux.compterClic('produit-prod', 'revue', t += 300), 'casse');
  // Un autre bouton, ou une pause trop longue, remet la série à zéro.
  for (let i = 0; i < 4; i++) { jeux.compterClic('produit-prod', 'zeitschrift', t += 300); }
  assert.strictEqual(jeux.compterClic('produit-prod', 'livre', t += 300), null);
  for (let i = 0; i < 4; i++) { jeux.compterClic('produit-nv', 'livre', t += 300); }
  assert.strictEqual(jeux.compterClic('produit-nv', 'livre', t += 5000), null);
  // Par le clic du document : seuls les boutons radio de produit comptent.
  for (let i = 0; i < 5; i++) { journal.clic({ target: radio('zeitschrift'), timeStamp: (t += 200) }); }
  assert.strictEqual(journal.ouvertures, 1);
  for (let i = 0; i < 5; i++) { journal.clic({ target: { type: 'button', name: 'produit-prod', value: 'livre' }, timeStamp: (t += 200) }); }
  assert.strictEqual(journal.ouvertures, 1);
});

test('jeux : chacun joue des milliers d’images au hasard sans erreur', () => {
  const { jeux } = chargerJeux();
  const toile = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  const touches = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '];
  let graine = 7;
  const hasard = () => { graine = (graine * 16807) % 2147483647; return graine / 2147483647; };
  for (const nom of Object.keys(jeux.fabriques)) {
    const jeu = jeux.fabriques[nom]();
    const etats = new Set();
    for (let i = 0; i < 20000; i++) {
      if (hasard() < 0.05) { jeu.touche(touches[Math.floor(hasard() * touches.length)], hasard() < 0.7); }
      if (hasard() < 0.02) { jeu.souris(hasard() * jeux.dimensions.L, hasard() * jeux.dimensions.H); }
      jeu.etape(1 / 60);
      etats.add(jeu.etat());
      if (i % 500 === 0) { jeu.dessiner(toile, { encre: '#000', rouge: jeux.rouge, teintes: jeux.teintes[i % 1000 ? 'clair' : 'sombre'] }); }
    }
    assert.ok([...etats].every((e) => ['pret', 'jeu', 'perdu', 'gagne'].includes(e)), nom);
    assert.ok(etats.has('jeu'), nom + ' a démarré');
    assert.match(jeu.bilan(), /\d/, nom);
  }
});

test('jeux : le rouge des jeux est celui de la charte du CSPS dans pipeline/styles/couleurs.css', () => {
  const { jeux } = chargerJeux();
  const css = fs.readFileSync(path.join(RACINE, 'pipeline', 'styles', 'couleurs.css'), 'utf8');
  const crans = Object.keys(jeux.rouge);
  assert.ok(crans.includes('700'));
  for (const cran of crans) {
    const m = new RegExp('--c-rouge-' + cran + ':\\s*(#[0-9A-Fa-f]{6})').exec(css);
    assert.ok(m, 'cran absent de couleurs.css : ' + cran);
    assert.strictEqual(jeux.rouge[cran].toUpperCase(), m[1].toUpperCase(), 'rouge ' + cran);
  }
  assert.match(css, /--c-rouge-700:\s*#D31932;\s*\/\* = couleur de charte/);
});

// Les surfaces de jeu (--surface, soit editorWidget-background) des thèmes mesurés aussi par
// cockpit-contraste.test.js. Chaque rouge employé est un objet graphique : APCA Lc 30 et
// WCAG 3:1 (critère 1.4.11).
const SURFACES = { 'Light+': ['clair', '#f3f3f3'], 'Dark+': ['sombre', '#252526'], 'Dark Modern': ['sombre', '#202020'] };
function rapportWcag(a, b) {
  const lum = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

test('jeux : chaque rouge employé se détache de la surface du jeu, thème clair et thèmes sombres', { skip: sansPython }, () => {
  const { jeux } = chargerJeux();
  const paires = [];
  for (const [theme, [teinte, fond]] of Object.entries(SURFACES)) {
    const t = jeux.teintes[teinte];
    const crans = new Set(t.briques.concat([t.balle, t.tete, t.corps, t.ligne]));
    for (const cran of crans) { paires.push({ nom: theme + ' rouge ' + cran, texte: jeux.rouge[cran], fond }); }
  }
  const script = 'import json, sys\nsys.path.insert(0, sys.argv[1])\nimport apca\n'
    + 'print(json.dumps([apca.lc(t, f) for t, f in json.load(sys.stdin)]))\n';
  const lcs = JSON.parse(pythonSortie(['-c', script, path.join(RACINE, 'pipeline')],
    { input: JSON.stringify(paires.map((p) => [p.texte, p.fond])) }));
  const bas = paires.map((p, i) => Object.assign({ lc: lcs[i], rapport: rapportWcag(p.texte, p.fond) }, p))
    .filter((p) => Math.abs(p.lc) < 30 || p.rapport < 3)
    .map((p) => p.nom + ' : ' + p.texte + ' sur ' + p.fond + ', Lc ' + p.lc.toFixed(1) + ', ' + p.rapport.toFixed(2) + ':1');
  assert.deepStrictEqual(bas, []);
});

test('jeux : les clics qui suivent l’ouverture ne referment pas le jeu et ne comptent plus', () => {
  const { journal } = chargerJeux();
  const voile = { classList: { contains: (c) => c === 'szh-modale' } };
  const radio = { type: 'radio', name: 'produit-prod', value: 'revue' };
  // Un clic comme le navigateur le propage : capture du document, puis la cible (le voile se
  // referme de lui-même), puis la remontée jusqu'au document.
  const cliquer = (cible, t) => {
    const ev = { target: cible, timeStamp: t, arrete: false, stopPropagation() { this.arrete = true; }, preventDefault() {} };
    journal.capture(ev);
    if (ev.arrete) { return ev; }
    if (cible === voile) { journal.modale.fermer(); }
    journal.clic(ev);
    return ev;
  };
  let t = 10000;
  for (let i = 0; i < 5; i++) { cliquer(radio, t += 250); }
  assert.strictEqual(journal.ouvertures, 1);
  for (let i = 0; i < 4; i++) { assert.ok(cliquer(voile, t += 250).arrete, 'clic ' + (6 + i) + ' arrêté'); }
  assert.strictEqual(journal.fermetures, 0, 'le jeu reste ouvert');
  for (let i = 0; i < 5; i++) { cliquer(radio, t += 250); }
  assert.strictEqual(journal.ouvertures, 1, 'un jeu ouvert ne compte plus les clics');
  // Après une pause, un clic à côté referme le jeu, et la série repart de zéro.
  assert.ok(!cliquer(voile, t += 3000).arrete);
  assert.strictEqual(journal.fermetures, 1);
  for (let i = 0; i < 4; i++) { cliquer(radio, t += 250); }
  assert.strictEqual(journal.ouvertures, 1);
  cliquer(radio, t += 250);
  assert.strictEqual(journal.ouvertures, 2);
});
