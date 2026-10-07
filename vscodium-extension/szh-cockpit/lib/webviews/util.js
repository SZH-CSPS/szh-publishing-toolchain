// Assemble une webview à partir de media/<base>.{html,css,js} : libellés i18n
// (%%SZH:cle%% -> TP(cle, profil)), remplacements, puis un document autonome à CSP stricte.
// Les données de l'utilisateur passent par postMessage, pas par le gabarit.
'use strict';

const fs = require('fs');
const path = require('path');
const { TP, langueCockpit } = require('../i18n');
const profils = require('../profil');

const MEDIA = path.join(__dirname, '..', '..', 'media');
const RE_I18N = /%%SZH:([A-Za-z0-9_.]+)%%/g;

// Le <title> est échappé : un titre qui contient « < » ou « & » ne doit pas ouvrir de balise.
function echapperHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Les remplacements posés dans le <script> sont du JSON (par exemple __TXT__). Le
// navigateur ferme la balise dès qu'il lit « </script> », même dans une chaîne : « < »
// s'écrit donc \u003c, valide en JSON et invisible pour le parseur HTML.
function echapperPourScript(s) {
  return String(s).replace(/</g, '\\u003c');
}

// Options : `titre` pour le <title>, `csp` pour la Content-Security-Policy,
// `cssPartage` et `jsPartage`, les fragments de media/ à poser avant ceux de la page,
// `profil` pour les variantes de libellés (le profil du dossier ouvert par défaut), et
// `remplacements`, une map { marqueur: valeur } appliquée au HTML et au JS par split/join
// (String.replace interpréterait « $& » dans une valeur).
function construireHtml(base, nonce, opts) {
  opts = opts || {};
  let corps = fs.readFileSync(path.join(MEDIA, base + '.html'), 'utf8');
  const partagees = (opts.cssPartage || []).map(function (nom) {
    return fs.readFileSync(path.join(MEDIA, nom), 'utf8');
  });
  partagees.push(fs.readFileSync(path.join(MEDIA, base + '.css'), 'utf8'));
  const css = partagees.join('\n');
  // _commun.js, fragments partagés, puis script de la page, dans un seul <script> à nonce :
  // `SZH` est défini avant le script de la page.
  const morceaux = ['_commun.js'].concat(opts.jsPartage || []).concat([base + '.js'])
    .map((nom) => fs.readFileSync(path.join(MEDIA, nom), 'utf8').replace(/\n+$/, ''));
  let js = morceaux.join('\n\n');

  const profil = opts.profil || profils.courant();
  corps = corps.replace(RE_I18N, function (_, cle) { return TP(cle, profil); });
  js = js.replace(RE_I18N, function (_, cle) { return TP(cle, profil); });

  const rempl = opts.remplacements || {};
  for (const cle of Object.keys(rempl)) {
    corps = corps.split(cle).join(rempl[cle]);
    js = js.split(cle).join(echapperPourScript(rempl[cle]));
  }
  js = js.replace(/\n+$/, '');   // un seul \n sera ajouté avant </script>

  const csp = opts.csp || ("default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'");
  const titre = echapperHtml(opts.titre === undefined ? 'SZH' : opts.titre);
  const langue = opts.langue || langueCockpit();
  return '<!DOCTYPE html>\n<html lang="' + langue + '">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta http-equiv="Content-Security-Policy" content="' + csp + '">\n' +
    '<title>' + titre + '</title>\n' +
    '<style>\n' + css + '</style>\n</head>\n<body>\n' +
    corps +
    '<script nonce="' + nonce + '">\n' + js + '\n</script>\n</body>\n</html>\n';
}

// Lit un fichier de media/ à injecter tel quel, comme le CSS et le JS de l'aperçu HTML.
function lireMedia(nom) {
  return fs.readFileSync(path.join(MEDIA, nom), 'utf8');
}

module.exports = { construireHtml, lireMedia };
