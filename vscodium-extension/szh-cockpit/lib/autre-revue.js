// Les articles de l'autre revue, lus dans les numéros de la racine active (en cours et
// archivés), pour préremplir une fiche « D'une revue à l'autre ». La lecture d'un numéro
// est celle de la newsletter (secretariat.collecterNumeroLocal). Module pur, sans vscode.
'use strict';

const kirby = require('./kirby-contenu');
const secretariat = require('./secretariat');

const TYPE_ACTUALITE = 'documentation';

// Le texte dans la langue du numéro ouvert, sinon dans celle de l'article.
function selonLangue(fr, de, langue, langueArticle) {
  const voulu = langue === 'de' ? de : fr;
  if (voulu) { return voulu; }
  return (langueArticle === 'de' ? de : fr) || fr || de || '';
}

// articlesAutreRevue(racineArbreVal, revueCourante, langue) -> { numeros: [{ cle, libelle,
// archive, articles: [{ cle, titreAffiche, signature, valeurs }] }], illisibles }. Un numéro
// illisible est compté et sauté. `valeurs` porte les champs de la fiche `reprise`. La
// référence s'écrit « année, numéro » ; les pages ne sont pas lues.
function articlesAutreRevue(racineArbreVal, revueCourante, langue) {
  const autre = kirby.autreRevue(revueCourante);
  const sortie = { numeros: [], illisibles: 0 };
  if (!autre) { return sortie; }
  for (const n of kirby.listerNumeros(racineArbreVal)) {
    if (n.revue !== autre) { continue; }
    let lu;
    try { lu = secretariat.collecterNumeroLocal(n.chemin); } catch (e) { sortie.illisibles++; continue; }
    const num = lu.numero;
    const numeroCourt = /^\d+$/.test(num.numero) ? String(Number(num.numero)) : num.numero;
    const reference = [num.annee, numeroCourt].filter((x) => x).join(', ');
    const articles = lu.articles.filter((a) => a.type !== TYPE_ACTUALITE).map((a) => {
      const titre = selonLangue(a.titreFr, a.titreDe, langue, a.langue);
      const signature = langue === 'de' ? a.signatureDe : a.signatureFr;
      return {
        cle: n.chemin + '|' + a.slug, titreAffiche: titre, signature: signature,
        valeurs: {
          revue: autre, title: titre, auteurs: signature, reference: reference,
          doi: a.doi, lien: a.lien || '',
          descriptif: selonLangue(a.resumeFr, a.resumeDe, langue, a.langue)
        }
      };
    });
    sortie.numeros.push({ cle: num.cle, libelle: num.libelle, archive: n.archive, nom: n.nom, articles: articles });
  }
  sortie.numeros.sort((a, b) => (b.cle + '|' + b.nom).localeCompare(a.cle + '|' + a.nom));
  for (const n of sortie.numeros) { delete n.nom; }
  return sortie;
}

module.exports = { articlesAutreRevue };
