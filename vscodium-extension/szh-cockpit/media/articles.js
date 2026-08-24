// Vue « Articles » : l'ordre du numéro, l'avancement de chaque article, et les
// métadonnées du numéro. Trois choses au même endroit parce qu'on les regarde ensemble
// quand on monte un numéro.
//
// Rien n'est décidé ici. Les cartes sont posées par SZH.listeCartes et la barre par
// SZH.barreBoutons (media/_commun.js), les mêmes que « Traductions » et « Word en
// attente ». Le formulaire du numéro est SZH.formulaireNumero (media/_numero.js), le même
// que la page « Méta-données du numéro » : un champ ajouté à sa table apparaît ici sans
// seconde modification. La modale des tâches est bâtie sur SZH.modale, comme celle de la
// couverture. Ne reste propre à cette page que ce que la modale des tâches contient.
//
// Protocole. Vers l'hôte :
//   pret ; ouvrir { cle } ; action { cle, id } ; tache { cle, id, cochee } ;
//   commande { id } ; taches-enregistrer { revue, taches } ;
//   enregistrer { auto, modifies } ; couverture-deposer { nomFichier, donneesBase64 }
// Depuis l'hôte :
//   valeurs { titre, boutons, lignes, accent, valeurs, couverture, taches, revue } ;
//   etat { message } ; avancement { cle, pastilles } ; enregistre ; erreur { message } ;
//   couverture { nom, description, apercu } ; taches { taches }
// où une ligne vaut { cle, titre, meta, notif, pastilles, ouvrir, actions, taches }.
(function () {
  'use strict';
  var api = acquireVsCodeApi();
  var TXT = __TXT__;
  var poser = SZH.poser;
  var titre = document.getElementById('titre');
  var barre = document.getElementById('barre');
  var ctlEtat = null;
  var definitions = {};       // revue -> [{ id, fr, de }], tel que l'hôte l'envoie
  var revueCourante = '';

  var numero = SZH.formulaireNumero({
    conteneur: document.getElementById('numero'),
    api: api,
    txt: TXT,
    etat: document.getElementById('etatNumero'),
    couverture: true
  });
  numero.enregistrement(document.getElementById('enregistrer'));

  var liste = SZH.listeCartes({
    conteneur: document.getElementById('cartes'),
    textes: function () { return TXT; },
    onOuvrir: function (cle) { api.postMessage({ type: 'ouvrir', cle: cle }); },
    onAction: function (cle, id) { api.postMessage({ type: 'action', cle: cle, id: id }); },
    onTache: function (cle, id, cochee) {
      api.postMessage({ type: 'tache', cle: cle, id: id, cochee: cochee });
    }
  });

  // ---- Modale des tâches ----
  //
  // Les intitulés décrivent le processus éditorial d'une revue et non un numéro : ils
  // valent pour tous les numéros de cette revue, et les deux maisons ont chacune leur
  // liste. On règle donc les deux ici, l'une après l'autre, sans quitter la vue.
  //
  // ⚠ Passer d'une revue à l'autre, ou refermer, ENREGISTRE d'abord ce qui vient d'être
  // saisi : sans cela, taper trois intitulés français puis cliquer « Zeitschrift » les
  // jetterait sans un mot. C'est l'enregistrement automatique des autres formulaires,
  // appliqué aux deux gestes qui font sortir de la liste courante.
  var vue = { revue: '', modele: [], modifie: false };
  var modaleTaches = SZH.modale({
    classeBoite: 'modale modale-taches',
    construire: function (boite) {
      poser(boite, 'h3', null, TXT.tachesTitre || '');
      poser(boite, 'p', 'szh-notif szh-notif--info szh-notif--discret', TXT.tachesAide || '');
      vue.revues = poser(boite, 'div', 'taches-revues');
      vue.grille = poser(boite, 'div', 'taches-grille');
      var pied = poser(boite, 'div', 'taches-pied');
      vue.ajouter = document.createElement('button');
      vue.ajouter.type = 'button';
      vue.ajouter.className = 'szh-bouton';
      vue.ajouter.textContent = TXT.tachesAjouter || '';
      vue.ajouter.addEventListener('click', function () {
        absorber();
        vue.modele.push({ id: '', fr: '', de: '' });
        vue.modifie = true;
        rendreGrille();
      });
      pied.appendChild(vue.ajouter);
      poser(pied, 'span', 'szh-pousse');
      vue.etat = poser(pied, 'span', 'szh-barre-etat');
      vue.etat.setAttribute('role', 'status');
      var enregistrer = document.createElement('button');
      enregistrer.type = 'button';
      enregistrer.className = 'szh-bouton szh-bouton--principal';
      enregistrer.textContent = TXT.tachesEnregistrer || '';
      enregistrer.addEventListener('click', function () { enregistrerCourante(true); });
      pied.appendChild(enregistrer);
      var fermer = document.createElement('button');
      fermer.type = 'button';
      fermer.className = 'szh-bouton';
      fermer.textContent = TXT.tachesFermer || '';
      fermer.addEventListener('click', function () { modaleTaches.fermer(); });
      pied.appendChild(fermer);
    },
    surOuverture: function () {
      vue.revue = definitions[revueCourante] ? revueCourante : (Object.keys(definitions)[0] || '');
      charger(vue.revue);
      vue.etat.textContent = '';
      rendreRevues();
    },
    // Refermer n'est pas annuler : ce qui a été saisi part avant que la boîte disparaisse.
    surFermeture: function () { enregistrerCourante(false); },
    focus: function () { return vue.ajouter; }
  });

  function charger(cle) {
    vue.modele = (definitions[cle] || []).map(function (t) {
      return { id: t.id, fr: t.fr, de: t.de };
    });
    vue.modifie = false;
    rendreGrille();
  }

  // -> true si quelque chose est parti vers l'hôte.
  function enregistrerCourante(force) {
    absorber();
    if (!vue.modifie && !force) { return false; }
    if (vue.revue === '') { return false; }
    vue.modifie = false;
    api.postMessage({ type: 'taches-enregistrer', revue: vue.revue, taches: vue.modele });
    return true;
  }

  // Relit la grille avant toute reconstruction : sans cela, ajouter une rangée jetterait
  // la frappe en cours dans les autres.
  function absorber() {
    if (!vue.grille) { return; }
    var rangees = vue.grille.querySelectorAll('.taches-ligne');
    var n = 0;
    for (var i = 0; i < rangees.length; i++) {
      var fr = rangees[i].querySelector('[data-langue="fr"]');
      var de = rangees[i].querySelector('[data-langue="de"]');
      if (!fr && !de) { continue; }
      if (!vue.modele[n]) { vue.modele[n] = { id: '', fr: '', de: '' }; }
      if (fr) { vue.modele[n].fr = fr.value; }
      if (de) { vue.modele[n].de = de.value; }
      n++;
    }
    vue.modele.length = n;
  }

  function rendreRevues() {
    vue.revues.textContent = '';
    var cles = Object.keys(definitions);
    for (var i = 0; i < cles.length; i++) {
      (function (cle) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'szh-bouton';
        b.textContent = (TXT.revues || {})[cle] || cle;
        b.setAttribute('aria-pressed', cle === vue.revue ? 'true' : 'false');
        b.addEventListener('click', function () {
          if (cle === vue.revue) { return; }
          enregistrerCourante(false);         // ce qui vient d'être saisi part d'abord
          vue.revue = cle;
          charger(cle);
          rendreRevues();
        });
        vue.revues.appendChild(b);
      }(cles[i]));
    }
  }

  function rendreGrille() {
    vue.grille.textContent = '';
    var entete = poser(vue.grille, 'div', 'taches-rangee taches-entete');
    poser(entete, 'span', 'num', '');
    poser(entete, 'span', null, TXT.tachesFr || '');
    poser(entete, 'span', 'colonne-de', TXT.tachesDe || '');
    poser(entete, 'span', null, '');
    for (var i = 0; i < vue.modele.length; i++) {
      (function (tache, index) {
        var r = poser(vue.grille, 'div', 'taches-rangee taches-ligne');
        poser(r, 'span', 'num', String(index + 1));
        for (var l = 0; l < 2; l++) {
          var langue = l === 0 ? 'fr' : 'de';
          var champ = document.createElement('input');
          champ.type = 'text';
          champ.dataset.langue = langue;
          champ.value = tache[langue] || '';
          champ.setAttribute('aria-label',
            (langue === 'fr' ? (TXT.tachesFr || '') : (TXT.tachesDe || '')) + ' ' + String(index + 1));
          if (langue === 'de') { champ.className = 'colonne-de'; }
          champ.addEventListener('input', function () {
            vue.modifie = true;
            vue.etat.textContent = '';
          });
          r.appendChild(champ);
        }
        var retirer = document.createElement('button');
        retirer.type = 'button';
        retirer.className = 'szh-bouton bouton-danger';
        retirer.textContent = '×';
        retirer.title = TXT.tachesRetirer || '';
        retirer.setAttribute('aria-label', (TXT.tachesRetirer || '') + ' ' + String(index + 1));
        retirer.addEventListener('click', function () {
          absorber();
          vue.modele.splice(index, 1);
          vue.modifie = true;
          rendreGrille();
        });
        r.appendChild(retirer);
      }(vue.modele[i], i));
    }
  }

  // ---- Messages ----
  var recu = false;
  window.addEventListener('message', function (ev) {
    var msg = ev.data || {};
    recu = true;
    // Le formulaire du numéro traite « valeurs », « enregistre », « erreur » et
    // « couverture » ; la page continue sur ce que la vue ajoute autour. Un re-rendu ne
    // doit pas jeter une saisie en cours : le formulaire n'est rechargé que s'il n'a rien
    // de non enregistré, comme le panneau de traduction s'en garde.
    if (msg.type !== 'valeurs' || !numero.estModifie()) { numero.message(msg); }
    if (msg.type === 'valeurs') {
      SZH.poserAccent(msg.accent);
      titre.textContent = msg.titre || '';
      definitions = msg.taches || {};
      revueCourante = String(msg.revue || '');
      ctlEtat = SZH.barreBoutons(barre, msg.boutons || [], function (id) {
        if (id === 'taches') { modaleTaches.ouvrir(); return; }
        api.postMessage({ type: 'commande', id: id });
      });
      liste.rendre(msg.lignes || []);
      return;
    }
    // Une case cochée ne renvoie que sa pastille : reconstruire la liste ferait perdre au
    // clavier le focus de la case qu'il vient d'utiliser.
    if (msg.type === 'avancement') {
      liste.majPastilles(msg.cle, msg.pastilles || []);
      return;
    }
    if (msg.type === 'etat') {
      if (ctlEtat) { ctlEtat.textContent = msg.message || ''; }
      return;
    }
    if (msg.type === 'taches') {
      definitions = msg.taches || definitions;
      if (vue.etat) { vue.etat.textContent = TXT.tachesEnregistrees || ''; }
      return;
    }
  });
  SZH.annoncerPret(api, function () { return recu; });
})();
