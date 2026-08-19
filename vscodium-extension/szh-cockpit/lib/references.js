// SZH cockpit — retrait des références d'un asset dans le texte d'un article (C3).
//
// Supprimer une image ou un tableau depuis la barre latérale ne doit pas laisser
// un lien mort dans le .md : le rendu afficherait une image cassée (ou un bloc
// d'avertissement pour un tableau, cf. szh-tabelle-inclure.lua). Ces deux
// fonctions retirent la RÉFÉRENCE du texte, à la lettre des formes que le
// pipeline écrit :
//   image   ![légende](media/<relatif>)      — pandoc, --extract-media (D45)
//   tableau ::: {.szh-tabelle src="tables/table-NN.html"}\n:::   (D47)
//
// PURES (aucun accès disque, aucun vscode) : testables en headless via _pur.
// Elles rendent { texte, n } — n = nombre de références retirées, 0 si aucune
// (l'appelant prévient alors que le texte n'a pas été touché).
'use strict';

// Une image posée seule sur sa ligne EST un paragraphe (implicit_figures) : la
// ligne vidée doit disparaître, sinon il reste un paragraphe vide et deux lignes
// blanches consécutives. On ne recolle que les blancs devenus adjacents — jamais
// de normalisation globale du fichier, qui toucherait du texte non concerné.
function retirerLignesVidees(lignes, videes) {
  const resultat = [];
  for (let i = 0; i < lignes.length; i++) {
    if (!videes.has(i)) { resultat.push(lignes[i]); continue; }
    const avant = resultat.length > 0 ? resultat[resultat.length - 1] : null;
    let apres = null;
    for (let j = i + 1; j < lignes.length; j++) {
      if (videes.has(j)) { continue; }
      apres = lignes[j];
      break;
    }
    // Blanc de part et d'autre : en retirer un (celui d'avant), l'autre sépare
    // les deux paragraphes voisins.
    if (avant !== null && avant.trim() === '' && apres !== null && apres.trim() === '') {
      resultat.pop();
    }
  }
  return resultat;
}

// Cible d'un lien markdown -> chemin comparable : chevrons retirés, %20 et
// consorts décodés, antislash normalisé. Pandoc encode les espaces à l'écriture,
// l'arbre affiche le nom réel : sans décodage, « mon image.png » ne matcherait pas.
function cibleNormalisee(cible) {
  let c = String(cible || '').trim();
  if (c.length > 1 && c.charAt(0) === '<' && c.charAt(c.length - 1) === '>') { c = c.slice(1, -1); }
  try { c = decodeURIComponent(c); } catch (e) { /* encodage invalide : tel quel */ }
  return c.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

// Retire toutes les occurrences de l'image `relatif` (chemin relatif à media/,
// séparateurs quelconques). Une image au fil du texte laisse la phrase intacte ;
// une image seule sur sa ligne emporte la ligne.
function retirerImage(texte, relatif) {
  const attendu = ('media/' + String(relatif || '').replace(/\\/g, '/')).toLowerCase();
  if (attendu === 'media/') { return { texte: texte, n: 0 }; }
  // ![alt](cible "titre"){attributs} — l'alt peut contenir des crochets échappés,
  // la cible ne contient ni espace ni parenthèse (forme écrite par pandoc).
  const motif = /!\[[^\]]*\]\(\s*(<[^>]*>|[^()\s]+)(?:\s+"[^"]*")?\s*\)(?:\{[^}]*\})?/g;
  const lignes = String(texte).split('\n');
  const videes = new Set();
  let n = 0;
  for (let i = 0; i < lignes.length; i++) {
    const avant = lignes[i];
    if (avant.indexOf('![') === -1) { continue; }
    const apres = avant.replace(motif, (tout, cible) => {
      if (cibleNormalisee(cible) !== attendu) { return tout; }
      n++;
      return '';
    });
    if (apres === avant) { continue; }
    lignes[i] = apres;
    if (avant.trim() !== '' && apres.trim() === '') { videes.add(i); }
  }
  if (n === 0) { return { texte: texte, n: 0 }; }
  return { texte: retirerLignesVidees(lignes, videes).join('\n'), n: n };
}

// Retire le bloc de référence du tableau `nom` (« table-01.html ») : de la ligne
// d'ouverture `::: {.szh-tabelle src="tables/…"}` jusqu'à sa fermeture `:::`.
// Un bloc sans fermeture (fichier malmené à la main) n'emporte que sa ligne.
function retirerTable(texte, nom) {
  const attendu = ('tables/' + String(nom || '').replace(/\\/g, '/')).toLowerCase();
  if (attendu === 'tables/') { return { texte: texte, n: 0 }; }
  const lignes = String(texte).split('\n');
  const videes = new Set();
  let n = 0;
  for (let i = 0; i < lignes.length; i++) {
    const ouverture = /^\s*:::+\s*\{([^}]*)\}\s*$/.exec(lignes[i]);
    if (!ouverture || ouverture[1].indexOf('szh-tabelle') === -1) { continue; }
    const src = /src\s*=\s*"([^"]*)"|src\s*=\s*'([^']*)'|src\s*=\s*([^\s}]+)/.exec(ouverture[1]);
    const cible = src ? (src[1] || src[2] || src[3]) : '';
    if (cibleNormalisee(cible) !== attendu) { continue; }
    // Chercher la fermeture AVANT d'effacer quoi que ce soit : un bloc laissé
    // ouvert à la main ne doit pas emporter la fin de l'article.
    let fin = -1;
    for (let j = i + 1; j < lignes.length; j++) {
      if (/^\s*:::+\s*\{/.test(lignes[j])) { break; }            // bloc suivant : pas de fermeture
      if (/^\s*:::+\s*$/.test(lignes[j])) { fin = j; break; }
    }
    videes.add(i);
    if (fin !== -1) {
      for (let j = i + 1; j <= fin; j++) { videes.add(j); }
      i = fin;
    }
    n++;
  }
  if (n === 0) { return { texte: texte, n: 0 }; }
  return { texte: retirerLignesVidees(lignes, videes).join('\n'), n: n };
}

module.exports = { retirerImage, retirerTable, cibleNormalisee };
