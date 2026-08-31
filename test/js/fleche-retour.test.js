// Flèche retour : la bibliographie renvoie vers la PREMIÈRE occurrence de l'appel de
// chaque référence — jamais plus d'une par référence, et jamais vers une ancre qui
// n'existe pas.
//
//   node --test test/js
//
// szh-citations.lua posait déjà l'ancre de chaque entrée (ref-nom-annee, sur laquelle
// pointent les appels) ; il pose désormais aussi l'ancre inverse (appel-ref-nom-annee, sur
// la première occurrence de l'appel dans le corps) et, dans l'entrée de bibliographie, un
// lien de retour vers elle. Trois exigences d'accessibilité non négociables encadrent ce
// lien : un texte accessible EXPLICITE (aria-label, FR/DE — jamais une flèche nue), aucune
// flèche décorative de lien sortant (c'est un lien interne, « #… »), et la conformité
// PDF/UA-1 doit tenir (vérifiée par compilation réelle + veraPDF, hors de ce fichier).
//
// szh.desactiverLiensReferences (config.json du poste) saute la pose de l'appel : sans
// ancre à viser, aucun lien de retour ne doit apparaître — sauf pour une référence dont
// l'appel a été posé À LA MAIN (« [(Dupont, 2024)](#ref-dupont-2024) »), qui reste actif
// quel que soit ce réglage et doit donc garder sa flèche retour.
//
// Le Lua tourne dans la WSL, comme test/js/ancrages.test.js dont ce fichier reprend
// l'ossature (même wsl(), même repli de bibliographie « # Références » dans le corps,
// pour ne dépendre d'aucun autre filtre). S'il est introuvable, les contrôles sont sautés
// en le disant — jamais verts par défaut. Poser SZH_LUA_OBLIGATOIRE=1 en fait des échecs.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { DISTRO, cheminWsl } = require(path.join(COCKPIT, 'lib', 'wsl.js'));
const { cheminVersWsl } = require(path.join(COCKPIT, 'lib', 'portraits.js'));

const FILTRE = path.join(RACINE, 'pipeline', 'filters', 'szh-citations.lua');
const TRAVAIL = path.join(os.tmpdir(), 'szh-fleche-retour');

function wsl(args) {
  return spawnSync(cheminWsl(), ['-d', DISTRO, '--'].concat(args),
    { encoding: 'utf8', windowsHide: true, timeout: 120000 });
}

let pandocVu = null;
function pandocAbsent() {
  if (pandocVu !== null) { return pandocVu; }
  let r;
  try { r = wsl(['sh', '-c', 'command -v pandoc']); }
  catch (e) { pandocVu = 'wsl.exe injoignable : ' + e.message; return pandocVu; }
  if (r.error) { pandocVu = 'wsl.exe injoignable : ' + r.error.message; }
  else if (r.status !== 0) { pandocVu = 'pandoc introuvable dans la distro ' + DISTRO; }
  else { pandocVu = null; }
  return pandocVu;
}

// Saut bruyant : le contrôle n'est pas vert, il est déclaré non fait.
function sauterSansLua(t, raison) {
  const msg = 'Lua non vérifié : ' + raison;
  if (process.env.SZH_LUA_OBLIGATOIRE) { assert.fail(msg); }
  console.warn('\n*** ' + msg + ' — la flèche retour n’est PAS vérifiée ***\n');
  t.skip(msg);
}

// Compile un .md autonome avec szh-citations.lua seul (bibliographie en repli, « #
// Références » dans le corps — pas besoin d'un fichier détaché pour ce contrôle).
// `config`, s'il est fourni, écrit un config.json de poste et l'expose par SZH_CONFIG :
// c'est le seul canal que le filtre lit pour szh.desactiverLiensReferences (voir
// CONFIG_POSTE dans szh-citations.lua), et cela évite de toucher au vrai
// C:\ProgramData\SZH.
function compiler(nom, corps, config) {
  const dossier = path.join(TRAVAIL, nom);
  fs.rmSync(dossier, { recursive: true, force: true });
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'essai.md'), corps, 'utf8');
  // ⚠ `export …;`, et non `VAR=val cd … && pandoc …` : un préfixe VAR=val ne porte que
  // sur la commande qui le suit immédiatement (ici `cd`), jamais sur celle d'après un
  // « && » — pandoc recevrait alors un SZH_CONFIG vide, et le réglage ne serait jamais lu.
  let prefixe = '';
  if (config) {
    const cfg = path.join(dossier, 'config.json');
    fs.writeFileSync(cfg, JSON.stringify(config), 'utf8');
    prefixe = 'export SZH_CONFIG=' + JSON.stringify(cheminVersWsl(cfg)) + '; ';
  }
  const r = wsl(['sh', '-c', prefixe + 'cd ' + JSON.stringify(cheminVersWsl(dossier))
    + ' && pandoc essai.md --from=markdown --to=html --lua-filter='
    + JSON.stringify(cheminVersWsl(FILTRE))]);
  assert.ok(!r.error, 'pandoc injoignable : ' + (r.error && r.error.message));
  assert.strictEqual(r.status, 0, 'pandoc sorti en ' + r.status + ' : ' + r.stderr);
  // pandoc replie les lignes vers 72 colonnes (--wrap=auto, le défaut) et coupe donc au
  // beau milieu d'une balise, y compris entre deux attributs. Sans intérêt ici — seule la
  // structure compte — un espace unique remplace chaque coupure, pour que les motifs
  // ci-dessous cherchent un texte sur une seule ligne comme le ferait un vrai navigateur.
  return String(r.stdout).replace(/\s+/g, ' ');
}

// Deux références, l'une appelée deux fois (Dupont), l'autre une fois (Muller) — de vrais
// liens sortants dans les entrées (DOI + URL ordinaire), comme une bibliographie réelle.
const CORPS_FR = [
  'Un premier constat s’appuie sur (Dupont, 2024) et sur (Muller, 2023). On y revient : '
    + '(Dupont, 2024) une seconde fois.',
  '',
  '# Références',
  '',
  'Dupont, A. (2024). *Un titre*. SZH. <https://doi.org/10.1177/016502548100400101>',
  '',
  'Muller, B. (2023). Un autre titre. CSPS. <https://www.csps.ch/rapport-2023>'
].join('\n') + '\n';

test('flèche retour : seule la première occurrence de l’appel reçoit une ancre', (t) => {
  const absent = pandocAbsent();
  if (absent) { return sauterSansLua(t, absent); }
  const html = compiler('premiere-occurrence', CORPS_FR);
  const ids = [...html.matchAll(/id="(appel-ref-[^"]+)"/g)].map((m) => m[1]);
  t.diagnostic('ancres d’appel posées : ' + ids.join(' '));
  assert.deepStrictEqual(ids, ['appel-ref-dupont-2024', 'appel-ref-muller-2023'],
    'une ancre par référence, à sa première occurrence seulement');
  // Les deux appels vers Dupont restent bien liés (szh-appel) ; un seul porte l’ancre.
  const versDupont = [...html.matchAll(/<a href="#ref-dupont-2024"[^>]*>\(Dupont, 2024\)<\/a>/g)];
  assert.strictEqual(versDupont.length, 2, 'les deux appels vers Dupont devraient rester liés');
  assert.strictEqual(versDupont.filter((m) => /id="appel-/.test(m[0])).length, 1,
    'un seul des deux appels vers la même référence doit porter l’ancre');
});

test('flèche retour : le lien de la bibliographie a un texte accessible explicite, en français',
  (t) => {
    const absent = pandocAbsent();
    if (absent) { return sauterSansLua(t, absent); }
    const html = compiler('aria-fr', CORPS_FR);
    // Cible interne (« #appel-… »), classe dédiée, contenu VIDE (l’icône est un fond CSS,
    // print.css) et aria-label explicite — jamais une flèche nue pour le lecteur d’écran.
    assert.match(html,
      /<a href="#appel-ref-dupont-2024" class="szh-retour-appel" aria-label="Retour à l.appel de \(Dupont, 2024\)"><\/a>/,
      'lien de retour absent, mal ciblé, ou sans aria-label explicite : ' + html);
    assert.match(html,
      /<a href="#appel-ref-muller-2023" class="szh-retour-appel" aria-label="Retour à l.appel de \(Muller, 2023\)"><\/a>/,
      'lien de retour absent pour la seconde référence : ' + html);
  });

test('flèche retour : en Zeitschrift (allemand), l’aria-label se dit aussi en allemand', (t) => {
  const absent = pandocAbsent();
  if (absent) { return sauterSansLua(t, absent); }
  // Pas de <slug>.meta.yaml voisin dans ce banc : langue_article() retombe alors sur le
  // jeton de revue, où « zeitschrift » vaut « de » — même règle que le titre de
  // bibliographie (TITRES_BIBLIO_DEFAUT), dont c’est la seule autre consommatrice.
  const corps = '---\nrevue: zeitschrift\n---\n\n' + CORPS_FR;
  const html = compiler('aria-de', corps);
  assert.match(html, /aria-label="Zurück zum Zitatverweis \(Dupont, 2024\)"/,
    'l’aria-label devrait basculer en allemand pour la Zeitschrift : ' + html);
});

test('flèche retour : absente quand szh.desactiverLiensReferences est actif, sans ancre orpheline',
  (t) => {
    const absent = pandocAbsent();
    if (absent) { return sauterSansLua(t, absent); }
    const html = compiler('desactive', CORPS_FR, { desactiverLiensReferences: true });
    // Aucun appel n’est plus un lien : rien ne pointe donc « #appel-… », et un lien de
    // retour vers une ancre qui n’existe pas serait un défaut — il ne doit pas apparaître.
    assert.ok(!/class="szh-appel"/.test(html), 'un appel est resté un lien malgré le réglage');
    assert.ok(!/id="appel-/.test(html), 'une ancre d’appel est restée malgré le réglage');
    assert.ok(!/szh-retour-appel/.test(html),
      'un lien de retour est resté malgré le réglage, sans ancre à viser');
  });

test('flèche retour : un lien posé à la main garde son ancre et son retour, même réglage désactivé',
  (t) => {
    const absent = pandocAbsent();
    if (absent) { return sauterSansLua(t, absent); }
    // Un appel écrit à la main (l’action « Lier une référence » du cockpit) fonctionne
    // « quel que soit le réglage » — voir la note de tête de szh-citations.lua : la flèche
    // retour doit donc s’y poser tout autant, ce même réglage actif.
    const corps = [
      'Un lien posé à la main : [(Dupont, 2024)](#ref-dupont-2024).',
      '',
      '# Références',
      '',
      'Dupont, A. (2024). *Un titre*. SZH. <https://doi.org/10.1177/016502548100400101>'
    ].join('\n') + '\n';
    const html = compiler('lien-manuel', corps, { desactiverLiensReferences: true });
    assert.match(html, /<a href="#ref-dupont-2024" id="appel-ref-dupont-2024">\(Dupont, 2024\)<\/a>/,
      'le lien manuel devrait garder son ancre même réglage désactivé : ' + html);
    assert.match(html,
      /<a href="#appel-ref-dupont-2024" class="szh-retour-appel" aria-label="Retour à l.appel de \(Dupont, 2024\)"><\/a>/,
      'la flèche retour devrait accompagner un lien manuel même réglage désactivé : ' + html);
  });
