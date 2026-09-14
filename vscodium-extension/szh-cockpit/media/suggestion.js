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
// Protocole avec l'hôte :
//   webview -> hôte : pret ; enregistrer { slug, champ, langue, actuel, propose,
//                     commentaire } ; fermer
//   hôte -> webview : valeurs { slug, champ, langue, libelles, actuel } ;
//                     enregistre { message } ; erreur { message }
(function () {
  'use strict';
  const TXT = __TXT__;
  const vscodeApi = acquireVsCodeApi();
  let recu = false;

  const quoi = document.getElementById('quoi');
  const actuel = document.getElementById('actuel');
  const propose = document.getElementById('propose');
  const commentaire = document.getElementById('commentaire');
  const etat = document.getElementById('etat');
  const boutonEnregistrer = document.getElementById('enregistrer');
  const boutonAnnuler = document.getElementById('annuler');

  // Ce que l'hôte a envoyé : le panneau ne le recalcule jamais, il le renvoie tel quel.
  // `actuel` en fait partie — c'est le texte au moment où la pastille a été cliquée, et
  // c'est lui qui doit être consigné, même si la fiche change ensuite ailleurs.
  let VISE = null;

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

  function rendre(msg) {
    VISE = msg;
    const libelles = msg.libelles || {};
    quoi.textContent = '';
    ligneQuoi(TXT.article, String(msg.slug || ''), 'slug');
    ligneQuoi(TXT.champ, String(libelles.champ || msg.champ || ''));
    ligneQuoi(TXT.langue, String(libelles.langue || msg.langue || ''));
    const texte = String(msg.actuel || '');
    actuel.textContent = texte !== '' ? texte : TXT.actuelVide;
    actuel.classList.toggle('vide', texte === '');
    // Pré-remplie du texte actuel : on corrige plus souvent qu'on ne réécrit.
    propose.value = texte;
    commentaire.value = '';
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
  function enregistrer() {
    if (!VISE) { return; }
    const p = propose.value;
    const c = commentaire.value;
    if (p.trim() === String(VISE.actuel || '').trim() && c.trim() === '') {
      afficher(TXT.rien, true);
      commentaire.focus();
      return;
    }
    afficher('');
    boutonEnregistrer.disabled = true;
    vscodeApi.postMessage({
      type: SZH.MSG.ENREGISTRER,
      slug: VISE.slug, champ: VISE.champ, langue: VISE.langue,
      actuel: VISE.actuel, propose: p, commentaire: c
    });
  }

  boutonEnregistrer.addEventListener('click', enregistrer);
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
      return;
    }
    if (msg.type === SZH.MSG.ERREUR) {
      afficher(msg.message || '', true);
      boutonEnregistrer.disabled = false;
      return;
    }
  });
  SZH.annoncerPret(vscodeApi, function () { return recu; });
})();
