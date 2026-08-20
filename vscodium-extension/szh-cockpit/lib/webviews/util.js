// Assemble les webviews à partir des fichiers statiques media/<base>.{html,css,js} :
// libellés i18n (%%SZH:cle%% -> T(cle)), remplacements de gabarit, puis sortie en un
// document autonome à CSP stricte. Les données utilisateur passent par postMessage et
// n'entrent jamais dans le gabarit.
'use strict';

const fs = require('fs');
const path = require('path');
const { T } = require('../i18n');

const MEDIA = path.join(__dirname, '..', '..', 'media');
const RE_I18N = /%%SZH:([A-Za-z0-9_.]+)%%/g;

// Options : `titre` pour le <title>, `csp` pour la Content-Security-Policy, et
// `remplacements`, une map { marqueur: valeur } appliquée au HTML et au JS par split/join
// — String.replace interpréterait les séquences « $& » d'une valeur.
function construireHtml(base, nonce, opts) {
  opts = opts || {};
  let corps = fs.readFileSync(path.join(MEDIA, base + '.html'), 'utf8');
  const css = fs.readFileSync(path.join(MEDIA, base + '.css'), 'utf8');
  // Socle commun préfixé au script de la page : un seul <script>, donc un seul nonce,
  // et `SZH` est défini avant la première ligne du webview.
  const commun = fs.readFileSync(path.join(MEDIA, '_commun.js'), 'utf8');
  let js = commun.replace(/\n+$/, '') + '\n\n' + fs.readFileSync(path.join(MEDIA, base + '.js'), 'utf8');

  corps = corps.replace(RE_I18N, function (_, cle) { return T(cle); });
  js = js.replace(RE_I18N, function (_, cle) { return T(cle); });

  const rempl = opts.remplacements || {};
  for (const cle of Object.keys(rempl)) {
    corps = corps.split(cle).join(rempl[cle]);
    js = js.split(cle).join(rempl[cle]);
  }
  js = js.replace(/\n+$/, '');   // un seul \n sera ajouté avant </script>

  const csp = opts.csp || ("default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'");
  const titre = opts.titre === undefined ? 'SZH' : opts.titre;
  return '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="UTF-8">\n' +
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
