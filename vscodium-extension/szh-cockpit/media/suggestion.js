// Panneau « Proposer une traduction » : un champ traduisible, le texte en place, le texte
// proposé à la place, et pourquoi.
//
// Ce panneau n'écrit pas dans la fiche de l'article. Il envoie une proposition, que l'hôte
// range dans le dossier traduction/ du numéro (lib/suggestion-traduction.js). Le panneau
// « Traductions », lui, édite la fiche.
//
// La proposition s'ouvre pré-remplie du texte actuel : on corrige plus souvent qu'on ne
// réécrit.
//
// ---- Les deux gestes -------------------------------------------------------------
//
// « remplacer » propose un autre texte. « supprimer » propose que le texte disparaisse ;
// une zone laissée vide serait ambiguë (oubli ou intention ?).
//
// Le bouton « Proposer de supprimer ce texte » arme la suppression sans rien envoyer ; le
// bouton principal enregistre. Le formulaire change à vue et dit ce qu'il va enregistrer,
// pour qu'on ne croie pas le texte supprimé tout de suite. Le bouton est un interrupteur
// (aria-pressed) : son libellé ne bouge pas, et un second clic revient en arrière.
//
// ---- Deux cibles -----------------------------------------------------------------
//
// « article » vise un champ traduisible d'un article, ouvert par la pastille du
// vérificateur. « interface » vise un libellé de l'outil, cliqué dans le mode « Trad » :
// pas d'article ni de champ, mais la clé du libellé (parfois plusieurs candidates, parfois
// aucune) et la langue de l'interface. Le reste est identique.
//
// Une cible absente vaut « article » (lib/suggestion-traduction.js#normaliserCible).
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
  // Le mode « Trad » ne détourne pas les clics de ce formulaire, qu'il ouvre lui-même :
  // sinon « Enregistrer » serait inatteignable.
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

  // Ce que l'hôte a envoyé, renvoyé tel quel. `actuel` est le texte au moment du clic sur
  // la pastille : c'est lui qui est consigné, même si la fiche change ensuite.
  let VISE = null;
  let suppression = false;
  // Le <select> des clés candidates, quand le texte cliqué en a plusieurs ; null sinon.
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

  // Suppression armée : le bandeau dit ce qui sera enregistré, et la zone « Traduction
  // proposée » disparaît, puisque son contenu ne compte plus.
  function montrerGeste() {
    boutonSupprimer.setAttribute('aria-pressed', suppression ? 'true' : 'false');
    gesteQuoi.textContent = suppression ? TXT.supprimerQuoi : '';
    gesteQuoi.hidden = !suppression;
    blocPropose.hidden = suppression;
  }

  // L'aide sous la tête du formulaire, quand plusieurs libellés portent ce texte ou aucun.
  function aide(texte) {
    aideCle.textContent = String(texte || '');
    aideCle.hidden = String(texte || '') === '';
  }

  // La tête du formulaire pour un libellé de l'outil : le texte, la clé et la langue.
  function quoiInterface(msg, libelles) {
    ligneQuoi(TXT.cible, TXT.cibleInterface);
    const cles = Array.isArray(msg.cles) ? msg.cles : [];
    const dt = document.createElement('dt');
    dt.textContent = TXT.cle;
    quoi.appendChild(dt);
    const dd = document.createElement('dd');
    dd.className = 'slug';
    if (cles.length > 1) {
      // Plusieurs libellés portent ce texte : la personne choisit celui qu'elle relit.
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
    // Pré-remplie du texte actuel.
    propose.value = texte;
    commentaire.value = '';
    // Le panneau se recharge sur un autre champ : la suppression armée ne le suit pas.
    suppression = false;
    montrerGeste();
    afficher('');
    propose.focus();
    // Le curseur en fin de texte : une sélection totale s'effacerait à la première frappe.
    try { propose.setSelectionRange(propose.value.length, propose.value.length); }
    catch (e) { /* pas de sélection possible */ }
  }

  // Une proposition identique au texte actuel et sans commentaire est refusée ici. L'hôte
  // fait le même contrôle (lib/suggestion-traduction.js#estVide), qui fait foi ; celui-ci
  // donne la réponse immédiate.
  //
  // Une suppression n'a pas de texte proposé : elle échappe à ce contrôle.
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
    // Un seul message pour les deux cibles : seul change ce qu'il faut désigner (un article
    // et son champ, ou la clé d'un libellé).
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
      // entre les deux, pour qu'une frappe tardive ne semble pas ouvrir une autre suggestion.
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
