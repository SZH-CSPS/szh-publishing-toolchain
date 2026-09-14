// Panneau « Proposer une traduction » : un champ traduisible, le texte qui est en place,
// celui qu'on propose à la place, et pourquoi.
//
// Ce panneau n'écrit JAMAIS dans la fiche de l'article. Il envoie une proposition, que
// l'hôte range dans le dossier traduction/ du numéro (lib/suggestion-traduction.js) ;
// le titre, le sous-titre, le résumé et les mots-clés publiés restent exactement ce
// qu'ils étaient. C'est ce qui le sépare du panneau « Traductions », qui, lui, édite.
//
// La proposition s'ouvre pré-remplie du texte actuel : on corrige bien plus souvent qu'on
// ne réécrit, et partir d'une page blanche ferait retaper une phrase pour changer un mot.
//
// ---- Les deux gestes -------------------------------------------------------------
//
// « remplacer » (le geste ordinaire) dit comment ce texte devrait être dit. « supprimer »
// dit que ce texte ne devrait pas exister — ce qu'une proposition de remplacement ne sait
// pas exprimer : laisser la zone vide est ambigu, personne ne saurait si c'est un oubli.
//
// Le bouton « Proposer de supprimer ce texte » ARME le geste, il n'envoie rien. Un second
// geste, sur le bouton principal, enregistre. Pourquoi pas une boîte de confirmation : le
// risque n'est pas qu'on enregistre par mégarde — rien n'est effacé, une suggestion est
// une proposition, et le bandeau du haut le dit — mais qu'on croie supprimer le texte tout
// de suite. À cela une question « êtes-vous sûr ? » ne répond pas ; un formulaire qui
// change à vue et écrit ce qu'il va enregistrer, si. C'est aussi pourquoi le bouton est un
// interrupteur (aria-pressed) et non un second envoi : son libellé ne bouge pas, son état
// se voit, et un second clic revient en arrière.
//
// ---- Deux cibles -----------------------------------------------------------------
//
// Le même formulaire sert deux relectures. « article » vise un champ traduisible d'un
// article, ouvert par la pastille du vérificateur. « interface » vise un libellé de l'OUTIL,
// cliqué dans le mode « Trad » : il n'y a alors ni article, ni champ, ni langue d'article,
// mais la CLÉ du libellé — parfois plusieurs candidates, parfois aucune — et la langue de
// l'interface. Tout le reste est identique, et c'est voulu : on relit de la même façon.
//
// Une cible absente vaut « article » : c'était la seule possible avant le mode « Trad »
// (même règle de compatibilité que `geste`, lib/suggestion-traduction.js#normaliserCible).
//
// Protocole avec l'hôte :
//   webview -> hôte : pret ;
//                     enregistrer { cible: 'article', slug, champ, langue, geste, actuel,
//                                   propose, commentaire } ;
//                     enregistrer { cible: 'interface', cle, cles, langue, geste, actuel,
//                                   propose, commentaire } ;
//                     fermer
//   hôte -> webview : valeurs { cible, slug, champ, cle, cles, langue, libelles, actuel } ;
//                     enregistre { message } ; erreur { message }
(function () {
  'use strict';
  // GARDE-FOU DU MODE « TRAD » : ce formulaire ne détourne JAMAIS ses propres clics. Il est
  // justement ce que le mode ouvre ; s'il s'interceptait lui-même, « Enregistrer » serait
  // inatteignable.
  SZH.modeTradJamais();
  const CIBLE_INTERFACE = 'interface';
  const TXT = __TXT__;
  const vscodeApi = acquireVsCodeApi();
  let recu = false;

  const quoi = document.getElementById('quoi');
  const aideCle = document.getElementById('cle-aide');
  const actuel = document.getElementById('actuel');
  const propose = document.getElementById('propose');
  const blocPropose = document.getElementById('bloc-propose');
  const gesteQuoi = document.getElementById('geste-quoi');
  const commentaire = document.getElementById('commentaire');
  const etat = document.getElementById('etat');
  const boutonEnregistrer = document.getElementById('enregistrer');
  const boutonSupprimer = document.getElementById('supprimer');
  const boutonAnnuler = document.getElementById('annuler');

  // Ce que l'hôte a envoyé : le panneau ne le recalcule jamais, il le renvoie tel quel.
  // `actuel` en fait partie — c'est le texte au moment où la pastille a été cliquée, et
  // c'est lui qui doit être consigné, même si la fiche change ensuite ailleurs.
  let VISE = null;
  let suppression = false;
  // Le <select> des clés candidates, quand le texte cliqué en a plusieurs. Null le reste du
  // temps : une seule clé, ou aucune, se lit et ne se choisit pas.
  let choixCle = null;

  function afficher(message, erreur) {
    etat.textContent = String(message || '');
    etat.classList.toggle('erreur', !!erreur);
  }

  // Une ligne intitulé / valeur de la tête du formulaire.
  function ligneQuoi(libelle, valeur, classe) {
    const dt = document.createElement('dt');
    dt.textContent = libelle;
    quoi.appendChild(dt);
    const dd = document.createElement('dd');
    if (classe) { dd.className = classe; }
    dd.textContent = valeur;
    quoi.appendChild(dd);
  }

  // Le geste armé se voit : le bandeau dit ce qui sera enregistré, et la zone « Traduction
  // proposée » disparaît — une suppression n'en a pas, et la laisser à l'écran ferait
  // croire que ce qu'on y a tapé compte encore.
  function montrerGeste() {
    boutonSupprimer.setAttribute('aria-pressed', suppression ? 'true' : 'false');
    gesteQuoi.textContent = suppression ? TXT.supprimerQuoi : '';
    gesteQuoi.hidden = !suppression;
    blocPropose.hidden = suppression;
  }

  // L'aide sous la tête du formulaire : elle ne paraît que pour dire une hésitation —
  // plusieurs libellés portent ce texte, ou aucun ne l'a porté.
  function aide(texte) {
    aideCle.textContent = String(texte || '');
    aideCle.hidden = String(texte || '') === '';
  }

  // La tête du formulaire quand on relit un libellé de l'OUTIL : de quel texte on parle, de
  // quelle clé, et dans quelle langue.
  function quoiInterface(msg, libelles) {
    ligneQuoi(TXT.cible, TXT.cibleInterface);
    const cles = Array.isArray(msg.cles) ? msg.cles : [];
    const dt = document.createElement('dt');
    dt.textContent = TXT.cle;
    quoi.appendChild(dt);
    const dd = document.createElement('dd');
    dd.className = 'slug';
    if (cles.length > 1) {
      // Plusieurs libellés portent ce texte : seule la personne devant l'écran sait lequel
      // elle est en train de relire. L'outil ne tranche pas à sa place.
      choixCle = document.createElement('select');
      choixCle.setAttribute('aria-label', TXT.cle);
      for (const c of cles) {
        const o = document.createElement('option');
        o.value = c;
        o.textContent = c;
        choixCle.appendChild(o);
      }
      choixCle.value = cles[0];
      dd.appendChild(choixCle);
      aide(TXT.clePlusieurs);
    } else if (cles.length === 1) {
      dd.textContent = cles[0];
    } else {
      // Aucune clé retrouvée : le formulaire s'ouvre quand même, sur le texte littéral.
      // Une suggestion sur un texte non identifié vaut mieux que rien, et c'est justement
      // là qu'un mainteneur voudra regarder.
      dd.textContent = TXT.cleInconnue;
      dd.classList.add('sans-cle');
      aide(TXT.cleInconnueAide);
    }
    quoi.appendChild(dd);
    ligneQuoi(TXT.langue, String(libelles.langue || msg.langue || ''));
  }

  // La clé retenue : celle qu'on a choisie, celle qu'on a trouvée, ou rien.
  function cleRetenue() {
    if (choixCle) { return choixCle.value; }
    const cles = Array.isArray(VISE.cles) ? VISE.cles : [];
    return cles.length === 1 ? cles[0] : '';
  }

  function rendre(msg) {
    VISE = msg;
    const libelles = msg.libelles || {};
    quoi.textContent = '';
    choixCle = null;
    aide('');
    if (String(msg.cible || '') === CIBLE_INTERFACE) {
      quoiInterface(msg, libelles);
    } else {
      ligneQuoi(TXT.article, String(msg.slug || ''), 'slug');
      ligneQuoi(TXT.champ, String(libelles.champ || msg.champ || ''));
      ligneQuoi(TXT.langue, String(libelles.langue || msg.langue || ''));
    }
    const texte = String(msg.actuel || '');
    actuel.textContent = texte !== '' ? texte : TXT.actuelVide;
    actuel.classList.toggle('vide', texte === '');
    // Pré-remplie du texte actuel : on corrige plus souvent qu'on ne réécrit.
    propose.value = texte;
    commentaire.value = '';
    // Le panneau se recharge sur un autre champ : le geste armé pour le précédent ne le
    // suit pas — il avait été armé pour CE texte-là.
    suppression = false;
    montrerGeste();
    afficher('');
    propose.focus();
    // Le curseur en fin de texte plutôt qu'en tête : la correction commence rarement au
    // premier caractère, et une sélection totale s'effacerait à la première frappe.
    try { propose.setSelectionRange(propose.value.length, propose.value.length); }
    catch (e) { /* pas de sélection possible */ }
  }

  // Une proposition identique au texte actuel ET sans commentaire ne dit rien : plutôt
  // qu'écrire un fichier que quelqu'un ouvrira pour n'y rien trouver, on le dit ici. Le
  // même refus existe côté hôte (lib/suggestion-traduction.js#estVide) : c'est lui qui
  // fait foi, celui-ci n'est que la réponse immédiate.
  //
  // Une SUPPRESSION y échappe : elle n'a pas de texte proposé, et ce n'est pas un oubli,
  // c'est tout son propos. La comparer au texte actuel la refuserait à tous les coups.
  function enregistrer() {
    if (!VISE) { return; }
    const p = suppression ? '' : propose.value;
    const c = commentaire.value;
    if (!suppression && p.trim() === String(VISE.actuel || '').trim() && c.trim() === '') {
      afficher(TXT.rien, true);
      commentaire.focus();
      return;
    }
    afficher('');
    boutonEnregistrer.disabled = true;
    boutonSupprimer.disabled = true;
    // Un seul message pour les deux cibles : ce qui change est ce qu'il y a à désigner —
    // un article et son champ, ou la clé d'un libellé de l'outil.
    const envoi = {
      type: SZH.MSG.ENREGISTRER,
      cible: String(VISE.cible || ''),
      langue: VISE.langue,
      geste: suppression ? 'supprimer' : 'remplacer',
      actuel: VISE.actuel, propose: p, commentaire: c
    };
    if (envoi.cible === CIBLE_INTERFACE) {
      envoi.cle = cleRetenue();
      envoi.cles = Array.isArray(VISE.cles) ? VISE.cles : [];
    } else {
      envoi.slug = VISE.slug;
      envoi.champ = VISE.champ;
    }
    vscodeApi.postMessage(envoi);
  }

  boutonEnregistrer.addEventListener('click', enregistrer);
  boutonSupprimer.addEventListener('click', function () {
    suppression = !suppression;
    montrerGeste();
    afficher('');
    if (!suppression) { propose.focus(); }
  });
  boutonAnnuler.addEventListener('click', function () {
    vscodeApi.postMessage({ type: SZH.MSG.FERMER });
  });

  window.addEventListener('message', function (e) {
    const msg = e.data || {};
    recu = true;
    if (msg.type === SZH.MSG.VALEURS) { rendre(msg); return; }
    if (msg.type === SZH.MSG.ENREGISTRE) {
      // C'est fait : on le dit, puis l'hôte referme le panneau. Les champs se verrouillent
      // entre les deux, pour qu'une frappe tardive ne laisse pas croire à une seconde
      // suggestion en cours.
      afficher(msg.message || '');
      propose.readOnly = true;
      commentaire.readOnly = true;
      boutonEnregistrer.disabled = true;
      boutonSupprimer.disabled = true;
      return;
    }
    if (msg.type === SZH.MSG.ERREUR) {
      afficher(msg.message || '', true);
      boutonEnregistrer.disabled = false;
      boutonSupprimer.disabled = false;
      return;
    }
  });
  SZH.annoncerPret(vscodeApi, function () { return recu; });
})();
