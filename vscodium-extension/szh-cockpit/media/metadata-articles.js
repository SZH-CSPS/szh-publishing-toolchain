// Webview « Métadonnées des articles » : une carte par article, un bandeau de filtre
// quand l'hôte n'en envoie qu'une partie. Les cartes et la modale photo viennent de
// SZH.cartesArticles (media/_fiches.js).
//
// Protocole avec l'hôte, en plus de photo-*, du DOI manuel et de l'enregistrement (voir
// _fiches.js) :
//   webview -> hôte : pret ; modifie { modifie } ; tous ; markdown { slug } ;
//                     enregistrer { auto, articles } ; rechargement { articles }
//   hôte -> webview : valeurs { articles, types, langue, filtre, accent } ;
//                     demande-rechargement ; enregistre { auto, n } ; erreur { message } ;
//                     markdown { visible, message }
(function () {
  'use strict';
  const TXT = __TXT__;
  const vscodeApi = acquireVsCodeApi();
  const etat = document.getElementById('etat');
  const conteneur = document.getElementById('cartes');
  const bandeauFiltre = document.getElementById('filtre');
  let dernierModifie = false;

  // L'hôte doit savoir si des cartes sont modifiées : c'est lui qui garde le formulaire
  // contre un rechargement. On ne poste qu'aux changements d'état, pas à chaque frappe.
  function signalerModifie() {
    const m = cartes.estModifie();
    if (m === dernierModifie) { return; }
    dernierModifie = m;
    vscodeApi.postMessage({ type: SZH.MSG.MODIFIE, modifie: m });
  }

  const cartes = SZH.cartesArticles({
    conteneur: conteneur,
    api: vscodeApi,
    txt: TXT,
    etat: etat,
    surChangement: signalerModifie,
    surValeurs: function (msg) {
      rendreFiltre(msg.filtre || null);
      // Les cartes viennent d'être recréées : la carte visée par « Markdown » peut ne
      // plus être à l'écran (un filtre a changé). On repart de la première.
      slugVise = '';
    }
  });


  cartes.traductions(document.getElementById('traductions'));

  // ---- Le texte de l'article, à droite de sa fiche ----
  //
  // Interrupteur, comme celui des traductions : le libellé nomme la chose, l'oeil et le
  // fond disent si elle est à l'écran. Mais l'état n'est PAS tenu ici : c'est un onglet de
  // l'éditeur, qui se ferme aussi à la croix. La page demande donc une bascule et attend la
  // réponse de l'hôte pour se peindre — sans quoi le bouton resterait allumé devant un
  // onglet fermé, et le clic suivant ne ferait rien de visible.
  const boutonMd = document.getElementById('markdown');
  let mdVisible = false;

  // La carte visée : la dernière à avoir reçu le focus, à défaut la première de la liste.
  // Le formulaire s'ouvre presque toujours filtré sur un seul article — c'est le bouton
  // « Éditer les métadonnées » de l'arbre et des cartes — et la question ne se pose alors
  // pas ; sur « Voir tous les articles », c'est là où l'on travaille qui décide.
  let slugVise = '';
  conteneur.addEventListener('focusin', function (e) {
    const cible = e && e.target;
    const carte = (cible && cible.closest) ? cible.closest('.carte') : null;
    if (carte && carte.dataset && carte.dataset.slug) { slugVise = carte.dataset.slug; }
  });

  function cibleMarkdown() {
    if (slugVise) { return slugVise; }
    const premiere = conteneur.querySelector('.carte');
    return (premiere && premiere.dataset && premiere.dataset.slug) || '';
  }

  function peindreMd() {
    boutonMd.textContent = '';
    boutonMd.appendChild(SZH.icone(mdVisible ? 'oeil' : 'oeil-ferme'));
    const texte = document.createElement('span');
    texte.textContent = TXT.mdBouton || '';
    boutonMd.appendChild(texte);
    boutonMd.title = mdVisible ? (TXT.mdMasquer || '') : (TXT.mdAfficher || '');
    boutonMd.setAttribute('aria-pressed', mdVisible ? 'true' : 'false');
  }

  boutonMd.addEventListener('click', function () {
    vscodeApi.postMessage({ type: SZH.MSG.MARKDOWN, slug: cibleMarkdown() });
  });
  peindreMd();

  // « Changer la langue de l'article » : la langue se change sur chaque carte — son
  // sélecteur permute les contenus entre l'ancienne et la nouvelle langue (_fiches.js).
  // Le bouton de la barre est un aiguillage : il dit où se fait le geste.
  document.getElementById('langue').addEventListener('click', function () {
    etat.textContent = TXT.langueAvenir;
  });

  // « Vérifier les méta (print) » : la feuille A4, une page par article. Elle se lit du
  // disque, donc on envoie d'abord les cartes modifiées — l'hôte les enregistre, puis
  // génère et ouvre la feuille dans le navigateur, qui sait imprimer alors qu'une webview
  // ne le sait pas.
  document.getElementById('verifMeta').addEventListener('click', function () {
    vscodeApi.postMessage({ type: SZH.MSG.VERIF_META, articles: cartes.modifiees() });
  });

  function rendreFiltre(filtre) {
    bandeauFiltre.textContent = '';
    if (!filtre || !filtre.length) { bandeauFiltre.hidden = true; return; }
    const texte = document.createElement('span');
    texte.textContent = TXT.filtreNote.split('{0}').join(filtre.join(', '));
    bandeauFiltre.appendChild(texte);
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.textContent = TXT.tous;
    bouton.addEventListener('click', function () { vscodeApi.postMessage({ type: SZH.MSG.TOUS }); });
    bandeauFiltre.appendChild(bouton);
    bandeauFiltre.hidden = false;
  }

  // L'hôte répond sans renvoyer les valeurs quand l'enregistrement est automatique,
  // pour ne pas re-rendre la page sous les doigts.
  cartes.enregistrement(document.getElementById('enregistrer'));

  let recu = false;
  window.addEventListener('message', function (e) {
    const msg = e.data || {};
    recu = true;
    if (cartes.message(msg)) { return; }
    // L'hôte veut recharger le formulaire alors que des cartes sont modifiées : il lui
    // faut ce qu'elles contiennent pour pouvoir les enregistrer.
    // L'état de l'onglet, dit par l'hôte — jamais deviné ici.
    if (msg.type === SZH.MSG.MARKDOWN) {
      mdVisible = msg.visible === true;
      peindreMd();
      if (msg.message) { etat.textContent = msg.message; }
      return;
    }
    if (msg.type === SZH.MSG.DEMANDE_RECHARGEMENT) {
      vscodeApi.postMessage({ type: SZH.MSG.RECHARGEMENT, articles: cartes.modifiees() });
      return;
    }
    console.warn('métadonnées des articles : type de message inconnu', msg.type);
  });
  SZH.annoncerPret(vscodeApi, function () { return recu; });
})();
