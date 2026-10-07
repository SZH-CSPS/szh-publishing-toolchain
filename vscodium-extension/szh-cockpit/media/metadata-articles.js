// Webview « Métadonnées des articles » : une carte par article, et un bandeau de filtre
// quand l'hôte n'en envoie qu'une partie. Les cartes et la modale photo viennent de
// SZH.cartesArticles (_fiches.js).
//
// Protocole avec l'hôte, en plus de photo-*, du DOI manuel et de l'enregistrement (voir
// _fiches.js) :
//   webview -> hôte : pret ; modifie { modifie } ; tous ; markdown { slug } ;
//                     enregistrer { auto, articles } ; rechargement { articles } ;
//                     retourArticle { modifie, articles }
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
  const boutonRetour = document.getElementById('retour');
  let dernierModifie = false;

  // L'hôte protège le formulaire contre un rechargement : il doit savoir si des cartes sont
  // modifiées. On ne poste qu'aux changements d'état.
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
      // Le retour n'a de sens que filtré sur un seul article : c'est lui qu'on rouvre.
      boutonRetour.hidden = !(Array.isArray(msg.filtre) && msg.filtre.length === 1);
      // Les cartes viennent d'être recréées, et la carte visée par « Markdown » peut avoir
      // disparu (filtre changé) : on repart de la première.
      slugVise = '';
    }
  });


  cartes.traductions(document.getElementById('traductions'));

  // ---- Le texte de l'article, à droite de sa fiche ----
  //
  // Interrupteur, comme celui des traductions. L'état n'est pas tenu ici : le texte est un
  // onglet de l'éditeur, qui peut se fermer à la croix. La page demande une bascule et se
  // met à jour sur la réponse de l'hôte.
  const boutonMd = document.getElementById('markdown');
  let mdVisible = false;

  // La carte visée : la dernière à avoir reçu le focus, à défaut la première de la liste
  // (le formulaire s'ouvre le plus souvent filtré sur un seul article).
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

  // « Changer la langue de l'article » : la langue se change sur chaque carte, dont le
  // sélecteur permute les contenus entre l'ancienne et la nouvelle langue (_fiches.js). Le
  // bouton de la barre explique où le faire.
  document.getElementById('langue').addEventListener('click', function () {
    etat.textContent = TXT.langueAvenir;
  });

  // « Vérifier les méta (print) » : la feuille A4, une page par article, lue sur le disque.
  // On envoie d'abord les cartes modifiées ; l'hôte les enregistre, puis génère la feuille et
  // l'ouvre dans le navigateur, qui sait imprimer (une webview ne le sait pas).
  document.getElementById('verifMeta').addEventListener('click', function () {
    vscodeApi.postMessage({ type: SZH.MSG.VERIF_META, articles: cartes.modifiees() });
  });

  // « ← Retour à l'article » : l'hôte vérifie s'il reste des modifications, comme aux Médias.
  boutonRetour.textContent = TXT.retour || '';
  boutonRetour.title = TXT.retourTip || '';
  boutonRetour.addEventListener('click', function () {
    vscodeApi.postMessage({ type: SZH.MSG.RETOUR_ARTICLE, modifie: cartes.estModifie(),
      articles: cartes.modifiees() });
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

  // En enregistrement automatique, l'hôte ne renvoie pas les valeurs, pour ne pas
  // reconstruire la page pendant la saisie.
  cartes.enregistrement(document.getElementById('enregistrer'));

  let recu = false;
  window.addEventListener('message', function (e) {
    const msg = e.data || {};
    recu = true;
    if (cartes.message(msg)) { return; }
    // L'hôte veut recharger le formulaire alors que des cartes sont modifiées : il reçoit
    // leur contenu pour pouvoir les enregistrer.
    // L'état de l'onglet, tel que l'hôte le donne.
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
