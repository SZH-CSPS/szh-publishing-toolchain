// SZH cockpit — assemblage des webviews (R4/R5, refactor sans build). Lit les fichiers
// statiques media/<base>.{html,css,js}, y résout les libellés i18n (%%SZH:cle%% -> T(cle))
// et d'éventuels remplacements de GABARIT explicites (jamais de données utilisateur :
// celles-ci arrivent par postMessage, comme avant), puis assemble un document autonome à
// CSP stricte (styles inline, script à nonce, zéro requête réseau). Rendu identique à
// l'assemblage précédent (construit par concaténation dans extension.js).
'use strict';

const fs = require('fs');
const path = require('path');
const { T } = require('../i18n');

const MEDIA = path.join(__dirname, '..', '..', 'media');
const RE_I18N = /%%SZH:([A-Za-z0-9_.]+)%%/g;

// construireHtml(base, nonce, opts?) :
//   opts.titre        -> contenu de <title> (invisible dans un panneau webview ; conservé
//                        à l'identique de l'ancien code pour un rendu strictement égal).
//   opts.remplacements -> map { marqueur: valeur } appliquée AU HTML ET AU JS (ex.
//                        { '__TXT__': jsonLibelles }). split/join (pas de piège $ de replace).
//   opts.csp          -> Content-Security-Policy (défaut : formulaires, sans img-src).
function construireHtml(base, nonce, opts) {
  opts = opts || {};
  let corps = fs.readFileSync(path.join(MEDIA, base + '.html'), 'utf8');
  const css = fs.readFileSync(path.join(MEDIA, base + '.css'), 'utf8');
  // Socle commun (D114 : enregistrement automatique) préfixé au script de la page —
  // un seul <script>, donc un seul nonce, et `SZH` est défini avant la première ligne
  // du webview. Un webview qui ne s'en sert pas n'en paie que la taille (~2 Ko).
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

// Lit un fichier media/ (fragment inline : CSS/JS d'aperçu HTML injecté dans le
// document pandoc par preview). Chemin via __dirname -> jamais de requête externe.
function lireMedia(nom) {
  return fs.readFileSync(path.join(MEDIA, nom), 'utf8');
}

module.exports = { construireHtml, lireMedia };
