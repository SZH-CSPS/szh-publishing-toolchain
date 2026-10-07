// Supprime un arbre de fichiers synchronisé par OneDrive. Module pur (fs, sans vscode).
//
// OneDrive pose les attributs ReadOnly et ReparsePoint sur ses dossiers « à la demande ».
// fs.rmSync(…, { force: true }) retire la lecture seule d'un fichier, pas d'un dossier, et
// Windows refuse alors la suppression (EPERM). Sur un refus, on retire donc ReadOnly de
// tout l'arbre, puis on réessaie plusieurs fois le temps que la synchronisation passe.
'use strict';

const fs = require('fs');
const path = require('path');

// Codes qui peuvent passer avec le temps ou un attribut retiré. Les autres (chemin
// introuvable, disque plein) sont rendus tout de suite.
const VERROUS_PASSAGERS = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);

// Retire l'attribut « lecture seule » d'un arbre entier : sous Windows, Node traduit un
// chmod en écriture par le retrait de cet attribut. Ne lève pas : un fichier qui résiste
// échouera à la suppression, avec son vrai message.
function retirerLectureSeule(chemin) {
  let entrees = [];
  try { entrees = fs.readdirSync(chemin, { withFileTypes: true }); } catch (e) { entrees = []; }
  for (const e of entrees) {
    const enfant = path.join(chemin, e.name);
    if (e.isDirectory()) { retirerLectureSeule(enfant); }
    else { try { fs.chmodSync(enfant, 0o666); } catch (x) { /* se dira à la suppression */ } }
  }
  try { fs.chmodSync(chemin, 0o777); } catch (x) { /* idem */ }
}

// -> null quand le chemin n'existe plus, sinon le message du dernier échec. `surReprise`
// est appelée avant chaque attente, pour que l'attente se voie.
async function supprimerArbre(chemin, options) {
  const o = options || {};
  const attentes = o.attentes || [200, 500, 1000, 2000, 2000, 2000, 2000];
  const dormir = o.dormir || ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let essai = 0; ; essai++) {
    try {
      fs.rmSync(chemin, { recursive: true, force: true });
      return null;
    } catch (e) {
      if (essai >= attentes.length || !VERROUS_PASSAGERS.has(e.code)) {
        return String((e && e.message) || e);
      }
      // Au premier refus seulement : l'attribut retiré ne revient pas.
      if (essai === 0) { retirerLectureSeule(chemin); }
      if (o.surReprise) { o.surReprise(path.basename(chemin), essai); }
      await dormir(attentes[essai]);
    }
  }
}

module.exports = { retirerLectureSeule, supprimerArbre, VERROUS_PASSAGERS };
