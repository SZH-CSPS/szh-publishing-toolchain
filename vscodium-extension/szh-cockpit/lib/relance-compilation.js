// Recompile un article après un enregistrement fait hors de l'éditeur de texte (formulaire
// « Médias de l'article », éditeur de tableaux). Ces formulaires écrivent soit par fs
// (ecrireAtomique, copie dans media/), que triggerTaskOnSave ne voit pas, soit par
// doc.save() du .md, qu'il voit.
//
// Le module décide quand redemander la compilation, et la confie à relancerCompilation →
// compilerPuisAfficher (extension.js). Trois règles :
//
//   - Anti-rebond par article : l'éditeur de tableaux enregistre à chaque modification
//     (autoEnregistrement, 3 s après la dernière frappe, et à chaque sortie de champ).
//     Chaque demande repousse l'échéance ; une seule compilation part, DELAI ms après la
//     dernière. `vider(slug)` (fermeture du panneau) fait partir tout de suite une demande
//     encore en attente.
//   - Une compilation démarrée après la demande la couvre : elle lit le disque à jour.
//     C'est le cas d'un doc.save() relayé par triggerTaskOnSave (VS Code refuserait de
//     relancer une tâche active). `demarrages()` compte les démarrages de la tâche de
//     build (onDidStartTask, côté hôte) : s'il a bougé depuis la demande, rien à faire.
//   - Une compilation en cours avant la demande ne la couvre pas (elle a pu lire l'ancien
//     fichier) : l'échéance est repoussée jusqu'à ce qu'elle finisse.
//
// Compilation automatique coupée (numéro verrouillé ou archivé, compilationAutoCoupee) :
// aucune demande n'est retenue, et une échéance qui arrive après un verrouillage tombe.
'use strict';

const DELAI_PAR_DEFAUT = 2500;

// Modifiable par les tests (même instance de module qu'extension.js) : lu à chaque demande.
let delaiCourant = DELAI_PAR_DEFAUT;
function poserDelai(ms) { delaiCourant = Number(ms) >= 0 ? Number(ms) : DELAI_PAR_DEFAUT; }
function delai() { return delaiCourant; }

// deps : {
//   relancer(fournisseur, slug)  la compilation, en tâche de fond et sans affichage ;
//   coupee()                     vrai quand le numéro ne se compile plus tout seul ;
//   occupe()                     vrai quand une compilation est en vol ;
//   demarrages()                 compteur des démarrages de la tâche de build ;
//   minuteur                     { poser(fn, ms) -> jeton, annuler(jeton) } — facultatif,
//                                setTimeout/clearTimeout (sans retenir le processus) sinon.
// }
function creerRelanceDifferee(deps) {
  const minuteur = deps.minuteur || {
    poser: (fn, ms) => {
      const t = setTimeout(fn, ms);
      // Ni l'hôte ni un test ne doivent rester en vie pour une recompilation en attente.
      if (t && typeof t.unref === 'function') { t.unref(); }
      return t;
    },
    annuler: (t) => clearTimeout(t)
  };
  const attentes = new Map();   // slug -> { fournisseur, repere, jeton }

  function armer(slug, entree, ms) {
    if (entree.jeton !== null) { minuteur.annuler(entree.jeton); }
    entree.jeton = minuteur.poser(() => { entree.jeton = null; echoir(slug); }, ms);
  }

  function echoir(slug) {
    const entree = attentes.get(slug);
    if (!entree) { return; }
    if (deps.coupee()) { attentes.delete(slug); return; }
    // Une compilation partie depuis la demande a lu l'enregistrement : elle suffit.
    if (deps.demarrages() !== entree.repere) { attentes.delete(slug); return; }
    // Une compilation partie avant : on attend qu'elle finisse.
    if (deps.occupe()) { armer(slug, entree, delai()); return; }
    attentes.delete(slug);
    deps.relancer(entree.fournisseur, slug);
  }

  // Un enregistrement vient d'écrire ce que la compilation de `slug` lit.
  function demander(fournisseur, slug) {
    if (!fournisseur || !slug) { return; }
    if (deps.coupee()) { return; }
    const cle = String(slug);
    const entree = attentes.get(cle) || { fournisseur: fournisseur, repere: 0, jeton: null };
    entree.fournisseur = fournisseur;
    // Le repère suit la dernière écriture : une compilation démarrée entre deux
    // enregistrements rapprochés n'a pas lu le second.
    entree.repere = deps.demarrages();
    attentes.set(cle, entree);
    armer(cle, entree, delai());
  }

  // Fermeture du panneau : ce qui attendait part maintenant, sous les mêmes règles.
  function vider(slug) {
    const cle = String(slug || '');
    const entree = attentes.get(cle);
    if (!entree) { return; }
    if (entree.jeton !== null) { minuteur.annuler(entree.jeton); entree.jeton = null; }
    echoir(cle);
  }

  // Abandonne la demande : le tableau est en cours de suppression. L'enregistrement du .md
  // qui suit relance la compilation.
  function abandonner(slug) {
    const cle = String(slug || '');
    const entree = attentes.get(cle);
    if (!entree) { return; }
    if (entree.jeton !== null) { minuteur.annuler(entree.jeton); }
    attentes.delete(cle);
  }

  function enAttente(slug) { return attentes.has(String(slug || '')); }

  return { demander: demander, vider: vider, abandonner: abandonner, enAttente: enAttente };
}

module.exports = { creerRelanceDifferee, poserDelai, delai, DELAI_PAR_DEFAUT };
