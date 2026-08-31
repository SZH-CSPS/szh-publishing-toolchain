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
// L'aperçu des métadonnées, lui, est propre à cette page — il n'existe nulle part
// ailleurs : partout ailleurs, les métadonnées d'un article sont un FORMULAIRE. Ici on
// regarde, on ne saisit pas, et les deux boutons du pied mènent aux formulaires qui, eux,
// écrivent. La carte reste celle de SZH.listeCartes : cette page n'en refait pas une, elle
// insère son aperçu dedans.
//
// Protocole. Vers l'hôte :
//   pret ; ouvrir { cle } ; action { cle, id } ; tache { cle, id, cochee } ;
//   sansdoi { cle, coche } ; commande { id } ; taches-enregistrer { revue, taches } ;
//   enregistrer { auto, modifies } ; couverture-deposer { nomFichier, donneesBase64 }
// Depuis l'hôte :
//   valeurs { titre, boutons, lignes, accent, valeurs, couverture, taches, revue } ;
//   etat { message } ; avancement { cle, pastilles } ; enregistre ; erreur { message } ;
//   couverture { nom, description, apercu } ; taches { taches }
// où une ligne vaut { cle, titre, meta, notif, pastilles, ouvrir, actions, taches,
//                     apercu, constats, sansDoi } ,
//   apercu   = { lignes: [{ libelle, valeurs: [{ marque, texte, marques, ton }] }] }
//   constats = [{ ton, texte }]
//   sansDoi  = { coche, verrouille }
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

  var cartes = document.getElementById('cartes');
  var liste = SZH.listeCartes({
    conteneur: cartes,
    textes: function () { return TXT; },
    onOuvrir: function (cle) { api.postMessage({ type: 'ouvrir', cle: cle }); },
    onAction: function (cle, id) { api.postMessage({ type: 'action', cle: cle, id: id }); },
    onTache: function (cle, id, cochee) {
      api.postMessage({ type: 'tache', cle: cle, id: id, cochee: cochee });
    }
  });

  // ---- L'aperçu, posé dans la carte ----
  //
  // Les cartes viennent de SZH.listeCartes, le composant des trois vues d'ensemble. Cette
  // page n'en écrit pas une seconde : elle prend celles qui viennent d'être posées, dans
  // l'ordre où elles l'ont été — le même que celui des lignes — et glisse son bloc juste
  // avant les tâches, donc entre l'en-tête et le pied.
  //
  // Rien n'y est modifiable, à une exception près et elle est explicite : la case « pas de
  // DOI », qui n'est pas une métadonnée de l'article mais une décision sur le numéro.
  function decorer(lignes) {
    var boites = cartes.querySelectorAll('.szh-carte');
    for (var i = 0; i < boites.length && i < lignes.length; i++) {
      var ligne = lignes[i] || {};
      decorerTete(boites[i], ligne);
      var bloc = construireBloc(ligne);
      if (!bloc) { continue; }
      var cible = boites[i].querySelector('.szh-taches') || boites[i].querySelector('.ligne-pied');
      if (cible) { boites[i].insertBefore(bloc, cible); } else { boites[i].appendChild(bloc); }
    }
  }

  // La tête de la carte (A7.4) : le nom du dossier n'y est plus répété à côté du titre —
  // « 01 · Construire sa propre rampe » porte déjà le rang, et redire le slug juste après
  // ne faisait que doubler la même information. Le slug reste l'identifiant technique de
  // l'article ; il se lit maintenant en infobulle du titre plutôt que sur sa propre ligne.
  // Les avertissements de la carte montent dans cette même tête, alignés à droite du
  // titre : c'est là qu'on les voit d'un coup d'œil, avant même d'ouvrir la carte — ils ne
  // vivent plus, en double, dans le corps replié sous l'aperçu.
  function decorerTete(carte, ligne) {
    var tete = carte.querySelector('.szh-tete');
    if (!tete) { return; }
    // L'hôte n'envoie plus `meta` pour cette vue (voir extension.js, chargeArticles) ; le
    // retrait ci-dessous reste une garde, au cas où un ancien message traînerait encore.
    var meta = tete.querySelector('.szh-tete-meta');
    if (meta) { meta.remove(); }
    var nom = tete.querySelector('.szh-tete-nom');
    if (nom) { nom.title = String(ligne.cle || ''); }
    var constats = ligne.constats || [];
    if (constats.length === 0) { return; }
    var alerte = poser(tete, 'div', 'carte-alerte');
    for (var i = 0; i < constats.length; i++) {
      alerte.appendChild(SZH.notif(constats[i].ton || 'attention', constats[i].texte || ''));
    }
  }

  // -> l'élément à insérer, ou null quand la ligne n'apporte ni aperçu ni case. Les
  // avertissements (ligne.constats) sont posés dans la tête de la carte par decorerTete()
  // ci-dessus (A7.4) : ce bloc ne porte plus que l'aperçu des métadonnées et l'échappatoire.
  function construireBloc(ligne) {
    var apercu = ligne.apercu || null;
    var sansDoi = ligne.sansDoi || null;
    if (!apercu && !sansDoi) { return null; }
    var bloc = document.createElement('div');
    bloc.className = 'carte-apercu';
    if (apercu) { poserGrille(bloc, apercu.lignes || []); }
    if (sansDoi) {
      // Sur la même ligne que le DOI qu'elle concerne (A7.1) : la case rejoint la valeur
      // de la dernière rangée de la grille — la ligne DOI, toujours en fin d'aperçu — au
      // lieu de rester un bloc à part sous la grille entière.
      var valeurs = bloc.querySelectorAll('.apercu-valeur');
      poserCaseDoi(valeurs.length > 0 ? valeurs[valeurs.length - 1] : bloc, ligne);
    }
    return bloc;
  }

  // Une rangée par champ : l'intitulé d'un côté, une valeur par langue de l'autre. Une liste
  // de définitions, et non un tableau : ce sont des couples nom/valeur, et un lecteur
  // d'écran les annonce alors comme tels.
  function poserGrille(bloc, lignes) {
    var dl = poser(bloc, 'dl', 'apercu-grille');
    for (var i = 0; i < lignes.length; i++) {
      var rangee = poser(dl, 'div', 'apercu-rangee');
      poser(rangee, 'dt', 'apercu-cle', lignes[i].libelle || '');
      var dd = poser(rangee, 'dd', 'apercu-val');
      var valeurs = lignes[i].valeurs || [];
      for (var v = 0; v < valeurs.length; v++) { poserValeur(dd, valeurs[v]); }
    }
  }

  function poserValeur(dd, valeur) {
    var ton = valeur.ton ? ' apercu-valeur--' + valeur.ton : '';
    var el = poser(dd, 'div', 'apercu-valeur' + ton);
    // Le badge de langue tient la place d'un intitulé répété : « Titre (français) » trois
    // fois de suite ne se lit pas, « FR » se voit.
    if (valeur.marque) { poser(el, 'span', 'apercu-langue', valeur.marque); }
    poser(el, 'span', 'apercu-texte', valeur.texte || '');
    var marques = valeur.marques || [];
    for (var m = 0; m < marques.length; m++) {
      poser(el, 'span', 'apercu-marque', marques[m]);
    }
  }

  // La case « pas de DOI ». Verrouillée quand c'est la rubrique qui décide : la case montre
  // alors l'état sans laisser croire qu'on peut en changer. `parent` est la valeur de la
  // ligne DOI de l'aperçu (A7.1) — ou, à défaut d'aperçu, le bloc entier.
  function poserCaseDoi(parent, ligne) {
    var etat = ligne.sansDoi || {};
    var l = poser(parent, 'label', 'apercu-doi');
    var case_ = document.createElement('input');
    case_.type = 'checkbox';
    case_.checked = !!etat.coche;
    case_.disabled = !!etat.verrouille;
    case_.dataset.sansdoi = String(ligne.cle || '');
    case_.addEventListener('change', function () {
      api.postMessage({ type: 'sansdoi', cle: String(ligne.cle || ''), coche: !!case_.checked });
    });
    l.appendChild(case_);
    poser(l, 'span', null, TXT.doiCase || '');
    l.title = TXT.doiCaseTip || '';
    return l;
  }

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
      decorer(msg.lignes || []);
      return;
    }
    // Une case cochée ne renvoie que sa pastille : reconstruire la liste ferait perdre au
    // clavier le focus de la case qu'il vient d'utiliser.
    if (msg.type === 'avancement') {
      liste.majPastilles(msg.cle, msg.pastilles || [], msg.tachesResume);
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
