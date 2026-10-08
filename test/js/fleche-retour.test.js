// Flèche retour de pipeline/filters/szh-citations.lua : chaque entrée de bibliographie
// renvoie vers la première occurrence de son appel, une fois au plus, et jamais vers une
// ancre absente. wsl.js et portraits.js ne servent ici qu'à construire des chemins.
//
// Le filtre pose l'ancre de chaque entrée (ref-nom-annee, visée par les appels), l'ancre
// inverse (appel-ref-nom-annee, sur la première occurrence de l'appel) et, dans l'entrée,
// un lien de retour vers elle. Ce lien a un aria-label explicite en fr et en de, et pas de
// flèche de lien sortant (il est interne, « #… »). La conformité PDF/UA-1 se vérifie par
// compilation et veraPDF, hors de ce fichier.
//
// szh.desactiverLiensReferences (config.json du poste) supprime les liens d'appel, donc les
// liens de retour, sauf pour un appel posé à la main
// (« [(Dupont, 2024)](#ref-dupont-2024) »), qui garde sa flèche.
//
// Le Lua tourne dans la WSL. Sans elle, les contrôles sont sautés avec un motif ;
// SZH_WSL_OBLIGATOIRE en fait des échecs.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { sauter, sansPandocWsl } = require('./gardes');

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

// Saut avec motif. SZH_WSL_OBLIGATOIRE (gardes.js) en fait un échec au chargement.
function sauterSansLua(t, raison) {
  console.warn("\n*** Lua non vérifié : " + raison + " — la flèche retour n’est PAS "
    + "vérifiée ***\n");
  sauter.wsl(t);
}

// Compile un .md autonome avec szh-citations.lua seul (bibliographie en repli, « #
// Références » dans le corps). `config`, s'il est fourni, écrit un config.json de poste
// exposé par SZH_CONFIG, que le filtre lit pour szh.desactiverLiensReferences (voir
// CONFIG_POSTE dans szh-citations.lua).
function compiler(nom, corps, config) {
  const dossier = path.join(TRAVAIL, nom);
  fs.rmSync(dossier, { recursive: true, force: true });
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'essai.md'), corps, 'utf8');
  // `export …;`, et non `VAR=val cd … && pandoc …` : un préfixe VAR=val ne vaut que pour la
  // commande qui le suit (ici `cd`), et pandoc ne recevrait pas SZH_CONFIG.
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
  // pandoc replie les lignes vers 72 colonnes (--wrap=auto) et coupe parfois une balise
  // entre deux attributs : chaque coupure devient une espace, pour que les motifs
  // cherchent sur une seule ligne.
  return String(r.stdout).replace(/\s+/g, ' ');
}

// Deux références, l'une appelée deux fois (Dupont), l'autre une fois (Muller), avec des
// liens sortants dans les entrées (DOI et URL ordinaire).
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

test("flèche retour : seule la première occurrence de l’appel reçoit une ancre", (t) => {
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
  const html = compiler('premiere-occurrence', CORPS_FR);
  const ids = [...html.matchAll(/id="(appel-ref-[^"]+)"/g)].map((m) => m[1]);
  t.diagnostic('ancres d’appel posées : ' + ids.join(' '));
  assert.deepStrictEqual(ids, ['appel-ref-dupont-2024', 'appel-ref-muller-2023'],
    'une ancre par référence, à sa première occurrence seulement');
  // Les deux appels vers Dupont restent liés (szh-appel) ; un seul porte l’ancre.
  const versDupont = [...html.matchAll(/<a href="#ref-dupont-2024"[^>]*>\(Dupont, 2024\)<\/a>/g)];
  assert.strictEqual(versDupont.length, 2, 'les deux appels vers Dupont devraient rester liés');
  assert.strictEqual(versDupont.filter((m) => /id="appel-/.test(m[0])).length, 1,
    'un seul des deux appels vers la même référence doit porter l’ancre');
});

test("flèche retour : le lien de la bibliographie a un texte accessible explicite, en français",
  (t) => {
    if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
    const html = compiler('aria-fr', CORPS_FR);
    // Cible interne (« #appel-… »), classe dédiée, contenu vide (l’icône est un fond CSS,
    // print.css) et aria-label explicite pour le lecteur d’écran.
    assert.match(html,
      /<a href="#appel-ref-dupont-2024" class="szh-retour-appel" aria-label="Retour à l.appel de \(Dupont, 2024\)"><\/a>/,
      'lien de retour absent, mal ciblé, ou sans aria-label explicite : ' + html);
    assert.match(html,
      /<a href="#appel-ref-muller-2023" class="szh-retour-appel" aria-label="Retour à l.appel de \(Muller, 2023\)"><\/a>/,
      'lien de retour absent pour la seconde référence : ' + html);
  });

test("flèche retour : en Zeitschrift (allemand), l’aria-label se dit aussi en allemand", (t) => {
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
  // Pas de <slug>.meta.yaml voisin dans ce banc : langue_article() retombe alors sur le
  // jeton de revue, où « zeitschrift » vaut « de » — même règle que le titre de
  // bibliographie (TITRES_BIBLIO_DEFAUT), dont c’est la seule autre consommatrice.
  const corps = '---\nrevue: zeitschrift\n---\n\n' + CORPS_FR;
  const html = compiler('aria-de', corps);
  assert.match(html, /aria-label="Zurück zum Zitatverweis \(Dupont, 2024\)"/,
    'l’aria-label devrait basculer en allemand pour la Zeitschrift : ' + html);
});

test("flèche retour : absente quand szh.desactiverLiensReferences est actif, sans ancre orpheline",
  (t) => {
    if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
    const html = compiler('desactive', CORPS_FR, { desactiverLiensReferences: true });
    // Aucun appel n’est un lien : aucune ancre « #appel-… », donc aucun lien de retour.
    assert.ok(!/class="szh-appel"/.test(html), 'un appel est resté un lien malgré le réglage');
    assert.ok(!/id="appel-/.test(html), 'une ancre d’appel est restée malgré le réglage');
    assert.ok(!/szh-retour-appel/.test(html),
      'un lien de retour est resté malgré le réglage, sans ancre à viser');
  });

test("flèche retour : un lien posé à la main garde son ancre et son retour, même réglage désactivé",
  (t) => {
    if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
    // Un appel écrit à la main (action « Lier une référence » du cockpit) reste un lien
    // quel que soit le réglage (voir la tête de szh-citations.lua) : il garde sa flèche.
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
