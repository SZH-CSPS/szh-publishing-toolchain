// Lit les chaînes de filtres de pipeline/filtres.mk sans make : affectations `NOM := …`,
// références $(NOM) et $(filter-out a b,$(NOM)), la seule syntaxe que ce fichier emploie.
// Rend { NOM: [noms de filtres] }, chaque nom désignant pipeline/filters/szh-<nom>.lua.
// test/js/chaines-filtres.test.js compare ce lecteur à la sortie réelle de make : s'ils
// divergent, c'est lui qui rougit, et les contrôles statiques qui s'en servent avec lui.
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const FICHIER = path.join(RACINE, 'pipeline', 'filtres.mk');

function developper(valeur, vars) {
  let v = valeur;
  let avant;
  do {
    avant = v;
    v = v.replace(/\$\(filter-out ([^,()]*),\$\(([A-Z_]+)\)\)/g, (m, retires, nom) => {
      const r = retires.trim().split(/\s+/);
      return (vars[nom] || []).filter((f) => !r.includes(f)).join(' ');
    });
    v = v.replace(/\$\(([A-Z_]+)\)/g, (m, nom) => (vars[nom] || []).join(' '));
  } while (v !== avant);
  if (/\$\(/.test(v)) { throw new Error('filtres.mk : expression non comprise : ' + valeur); }
  return v.trim().split(/\s+/).filter(Boolean);
}

function lireChaines(texte) {
  const src = (texte === undefined ? fs.readFileSync(FICHIER, 'utf8') : texte)
    .replace(/\r/g, '').replace(/\\\n/g, ' ');
  const vars = {};
  for (const ligne of src.split('\n')) {
    const m = /^(CHAINE_[A-Z_]+|SOCLE_[A-Z_]+)\s*:=\s*(.*)$/.exec(ligne);
    if (m) { vars[m[1]] = developper(m[2], vars); }
  }
  return vars;
}

module.exports = { lireChaines, FICHIER };
