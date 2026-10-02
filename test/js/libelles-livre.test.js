// Un livre ouvert ne parle ni d'article ni de numéro : chaque panneau qu'il ouvre est
// construit, et chaque libellé résolu (%%SZH:…%% du gabarit, table __TXT__) est relu, en
// français puis en allemand.
//
//   node --test test/js/libelles-livre.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const COCKPIT = path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const MEDIA = path.join(COCKPIT, 'media');

// Chaque construction de page est retenue, avant que les modules de l'hôte ne prennent
// construireHtml par déstructuration (activerHote charge extension.js ensuite).
const util = require(path.join(COCKPIT, 'lib', 'webviews', 'util.js'));
const construireOriginal = util.construireHtml;
const PAGES = [];
util.construireHtml = function (base, nonce, opts) {
  PAGES.push({ base: base, opts: opts || {} });
  return construireOriginal.apply(this, arguments);
};

const archivage = require(path.join(COCKPIT, 'lib', 'archivage.js'));
archivage.lancerArchivage = () => null;
const { livreDEssai, activerHote } = require('./hote-factice');
const i18n = require(path.join(COCKPIT, 'lib', 'i18n.js'));

const LIVRE = livreDEssai();
const HOTE = activerHote(LIVRE);

const INTERDIT = /article|numéro|numero|artikel|ausgabe/i;

// L'Accueil sert tous les produits : ses onglets Produits, Nouveau et Secrétariat parlent de
// numéros pour les revues. Ce que garde ce fichier, c'est l'onglet Paramètres, que le livre voit :
// ses libellés portent les préfixes ci-dessous (rg*, regl_*, auteurs*, ojs*, biblio*, art*).
const PARAMETRES_ACCUEIL = /^(rg|regl_|auteurs|ojs|biblio|art)/;

// Les seules valeurs admises malgré le mot, par page et par clé.
const LISTE_BLANCHE = [
  // Paramètres de l'Accueil : blocs OJS, bibliographie, tâches et auteur·e·s publié·e·s, jamais
  // montrés pour un livre (l'hôte n'envoie pas leurs données, media/accueil.js les laisse masqués).
  'accueil:ojsIntro', 'accueil:ojsRubriquesAide', 'accueil:ojsTypes', 'accueil:ojsTypesAide',
  'accueil:rgOjsResume', 'accueil:biblioIntro', 'accueil:biblioColLangue', 'accueil:artTachesTitre',
  'accueil:artTachesAide', 'accueil:auteursCorpus', 'accueil:auteursCorpusJamais',
  // Le vérificateur de traduction ne vaut que pour les champs d'un article : réglage du poste, que
  // le livre voit parce que la page est celle de l'Accueil, commune à tous les produits.
  'accueil:rgVerifAide',
  // Fiche : champs que la carte d'un chapitre ne construit pas (capacités typeArticle,
  // licence et doi à faux).
  'metadata-articles:type', 'metadata-articles:licence', 'metadata-articles:doiVerrouTip',
  // Fiche : « ni numéro » parle du numéro du chapitre lui-même.
  'metadata-articles:sommaireAide',
];

// Les panneaux qu'un livre peut ouvrir, avec l'argument que le geste réel leur passe.
const GESTES = [
  ['szh.metadonnees'], ['szh.vueChapitres'], ['szh.vueWord'], ['szh.vueControles'],
  ['szh.reglages'], ['szh.metadonneesArticle', { slug: '01-ouverture' }],
  ['szh.mediasArticle', { slug: '01-ouverture' }], ['szh.nouveautes']
];

// Les clés %%SZH:…%% qu'une page lit : son gabarit, ses fragments partagés, le socle.
function clesDuGabarit(page) {
  const fichiers = [page.base + '.html', page.base + '.js', '_commun.js']
    .concat(page.opts.jsPartage || []);
  const cles = new Set();
  for (const f of fichiers) {
    const chemin = path.join(MEDIA, f);
    if (!fs.existsSync(chemin)) { continue; }
    for (const m of fs.readFileSync(chemin, 'utf8').matchAll(/%%SZH:([A-Za-z0-9_.]+)%%/g)) { cles.add(m[1]); }
  }
  return cles;
}

function chainesDe(valeur, chemin, out) {
  if (typeof valeur === 'string') { out.push([chemin, valeur]); }
  else if (Array.isArray(valeur)) { valeur.forEach((v, i) => chainesDe(v, chemin + '[' + i + ']', out)); }
  else if (valeur && typeof valeur === 'object') {
    for (const [k, v] of Object.entries(valeur)) { chainesDe(v, chemin ? chemin + '.' + k : k, out); }
  }
  return out;
}

async function relever(langue) {
  const avant = process.env.SZH_LANGUE;
  process.env.SZH_LANGUE = langue;
  i18n.oublierLanguePoste();
  PAGES.length = 0;
  const fautes = [];
  try {
    for (const [cmd, arg] of GESTES) {
      // Un panneau déjà ouvert se révèle sans se reconstruire : on le ferme d'abord.
      for (const p of HOTE.panneaux) { try { p.dispose(); } catch (e) { /* déjà fermé */ } }
      await HOTE.executer(cmd, arg);
    }
    const bases = new Set(PAGES.map((p) => p.base));
    for (const b of ['metadata-book', 'articles', 'metadata-articles', 'medias-article', 'accueil']) {
      assert.ok(bases.has(b), 'page ' + b + ' non construite (' + [...bases].join(', ') + ')');
    }
    for (const page of PAGES) {
      for (const cle of clesDuGabarit(page)) {
        const v = i18n.TP(cle, 'livre');
        if (INTERDIT.test(v) && !LISTE_BLANCHE.includes(page.base + ':' + cle)) { fautes.push(page.base + ' %%' + cle + '%% : ' + v); }
      }
      const brut = (page.opts.remplacements || {}).__TXT__;
      if (!brut) { continue; }
      for (const [cle, v] of chainesDe(JSON.parse(brut), '', [])) {
        if (page.base === 'accueil' && !PARAMETRES_ACCUEIL.test(cle)) { continue; }
        if (INTERDIT.test(v) && !LISTE_BLANCHE.includes(page.base + ':' + cle)) { fautes.push(page.base + ' __TXT__.' + cle + ' : ' + v); }
      }
    }
  } finally {
    if (avant === undefined) { delete process.env.SZH_LANGUE; } else { process.env.SZH_LANGUE = avant; }
    i18n.oublierLanguePoste();
  }
  return fautes;
}

test('livre (fr) : aucun libellé de panneau ne parle d’article ni de numéro', async () => {
  const fautes = await relever('fr');
  assert.deepStrictEqual(fautes, []);
});

test('livre (de) : aucun libellé de panneau ne parle d’Artikel ni d’Ausgabe', async () => {
  const fautes = await relever('de');
  assert.deepStrictEqual(fautes, []);
});

// construireHtml résout %%SZH:…%% par TP : une clé qui a sa variante livre la rend.
test('livre : construireHtml rend la variante .livre d’une clé de gabarit', () => {
  assert.ok(PAGES.length, 'aucune page construite');
  let vues = 0;
  for (const page of PAGES) {
    const html = construireOriginal(page.base, 'n', page.opts);
    for (const cle of clesDuGabarit(page)) {
      if (i18n.TP(cle, 'livre') === i18n.T(cle)) { continue; }
      vues++;
      assert.ok(html.includes(i18n.TP(cle, 'livre')), page.base + ' : ' + cle + ' rendue sans sa variante');
    }
  }
  assert.ok(vues > 0, 'aucune clé de gabarit n’a de variante livre : le contrôle ne prouve rien');
});
