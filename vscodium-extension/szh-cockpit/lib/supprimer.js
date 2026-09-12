// Supprimer un arbre de fichiers qui vit sur OneDrive.
//
// Fonctions pures au sens du cockpit : du `fs`, pas de `vscode`. Le module existe pour une
// seule raison, mesurée le 12.09.2026 sur le poste de Robin en tentant d'archiver le numéro
// 2027-03.
//
// CE QUI S'EST PASSÉ. `out/` refusait de disparaître : EPERM, « Permission denied », sur le
// DOSSIER et non sur un fichier. Le cockpit a insisté dix secondes, a renoncé, a annulé
// l'archivage entier et a conseillé de fermer l'aperçu PDF — qui n'y était pour rien.
//
// LA CAUSE. Le dossier portait les attributs `ReadOnly` et `ReparsePoint` : OneDrive les
// pose sur ses dossiers marque-place (« fichiers à la demande »). `fs.rmSync(…, { force:
// true })` retire bien l'attribut en lecture seule d'un FICHIER, jamais celui d'un DOSSIER
// — et Windows refuse alors de le supprimer. Vérifié à la main : la suppression échouait
// sur « accès refusé », l'attribut retiré elle passait.
//
// D'où la règle de ce module : sur un refus, on retire `ReadOnly` de tout l'arbre, puis on
// réessaie. Et on réessaie plusieurs fois, parce que la synchronisation, elle, ne se retire
// pas — elle passe.
'use strict';

const fs = require('fs');
const path = require('path');

// Les codes qui s'arrangent avec le temps ou avec un attribut retiré. Les autres — chemin
// introuvable, disque plein — ne s'arrangeront pas : ils ressortent tout de suite.
const VERROUS_PASSAGERS = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);

// Retire l'attribut « lecture seule » d'un arbre entier. Sur Windows, un chmod en écriture
// est ce que Node traduit par le retrait de cet attribut ; ailleurs, c'est un chmod, et il
// est sans effet néfaste sur un dossier de travail.
//
// Ne lève jamais : ce n'est qu'une préparation, et un fichier qui résiste ici se dira de
// toute façon à la suppression, avec son vrai message.
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

// -> null quand le chemin est parti (ou n'existait déjà plus), sinon le message du dernier
// échec, prêt à être montré. `surReprise` est appelée avant chaque attente, pour que dix
// secondes de patience ne passent pas pour un blocage.
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
      // Au premier refus seulement : l'attribut se retire une fois, il ne revient pas.
      if (essai === 0) { retirerLectureSeule(chemin); }
      if (o.surReprise) { o.surReprise(path.basename(chemin), essai); }
      await dormir(attentes[essai]);
    }
  }
}

module.exports = { retirerLectureSeule, supprimerArbre, VERROUS_PASSAGERS };
