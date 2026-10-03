// Vue « Propositions » de la Documentation : ce que les moissonneurs déposent, un onglet par
// type de fiche, à accepter ou à refuser. La page ne décide rien : le classement A/B, l'ordre
// et les gestes viennent de l'hôte (lib/propositions.js), qui renvoie les données après
// chaque geste.
//
//   SZH.vuePropositions(opts) -> { afficher(), recevoir(msg) }
//     opts = { api, panel, barreOnglets, titre, txt(), types(), apresEcriture(geste) }
//
// Protocole avec l'hôte :
//   webview -> hôte : propCharger ; propAccepter { demandes: [{ cle, aussi, valeurs?, touches? }],
//                     dansNumero, depuisDetail } ; propRefuser { cles, motif } ;
//                     propAnnuler { cles } ; propColonnes { typeFiche, reglage } ;
//                     propOuvrirSource { cle } ; propVerifier { cle, jeton, valeurs, touches } ;
//                     propRecreer { cle, valeurs } ; docDateFormer (media/_fiche-doc.js) ;
//                     propFiltreTerme { typeFiche, terme, role, langue } ;
//                     propDemandeEcrire { moissonneur, terme, langue, sens }
//   hôte -> webview : propDonnees { langue, cible, revueAutre, types, propositions, refusees,
//                     etats, colonnes, termes, demandes, filtre, regleTerme, resultat?,
//                     ongletDemande?, demandeGeste? } ;
//                     propVerifie { cle, jeton, bloquants }
// Un geste qui recharge la Documentation du numéro passe par opts.apresEcriture : les cartes
// modifiées du numéro s'enregistrent d'abord, le geste part à l'accusé.
//
// Le détail porte les champs du contrat (media/_fiche-doc.js), préremplis par la proposition.
// Rien ne s'écrit avant un geste. Ce qui bloque l'acceptation vient de l'hôte (bloquants()),
// redemandé après chaque saisie. Une acceptation dont la fiche n'a pas pu être créée (raison
// fiche-introuvable) s'offre à recréer, avec les mêmes valeurs, dans le pied et dans son détail.

(function () {
  'use strict';

  var poser = SZH.poser, icone = SZH.icone;

  // Sous cette largeur de la webview, le détail prend toute la place et l'emporte sur les
  // largeurs mémorisées. Mesuré dans VSCodium (03.10.2026) : à 1160 px, le tableau à côté du
  // détail défile en largeur et tronque ses colonnes ; à 1290 px, il se lit sans défiler.
  var SEUIL_DETAIL_PLEIN = 1280;
  var LARGEUR_MAX = 900, PAS_CLAVIER = 16, PAS_CLAVIER_GRAND = 64;
  var DUREE_BANDEAU = 10000, DUREE_AVIS = 6000;
  // Au plus une vérification par l'hôte dans cet intervalle, pendant la frappe.
  var INTERVALLE_VERIFIER = 200;
  var CODES_DOUTE = {
    'date-illisible': 'propDouteDateIllisible', 'langue-devinee': 'propDouteLangueDevinee',
    'correspondance-incertaine': 'propDouteCorrespondanceIncertaine', 'valeur-hors-liste': 'propDouteValeurHorsListe',
    'champ-introuvable': 'propDouteChampIntrouvable', 'texte-tronque': 'propDouteTexteTronque'
  };
  var MOTIFS = { 'hors-sujet': 'propMotifHorsSujet', doublon: 'propMotifDoublon', autre: 'propMotifAutre' };
  var PERTINENCES = { retenu: 'propPertinenceRetenu', 'a-relire': 'propPertinenceARelire' };
  // « Pourquoi » : les jetons de catégorie, de rôle et d'emplacement que documente un moissonneur.
  var CATEGORIES = {
    titre: 'propCategorieTitre', 'texte-dense': 'propCategorieTexteDense', 'signal-faible': 'propCategorieSignalFaible',
    ecole: 'propCategorieEcole', theme: 'propCategorieTheme', 'texte-large': 'propCategorieTexteLarge'
  };
  var ROLES = { ancrage: 'propRoleAncrage', ambigu: 'propRoleAmbigu', ecole: 'propRoleEcole', theme: 'propRoleTheme' };
  var OU = { titre: 'propOuTitre', texte: 'propOuTexte', extrait: 'propOuExtrait' };
  var NB_CRANS = 10;

  function vuePropositions(opts) {
    var api = opts.api, panel = opts.panel, barreOnglets = opts.barreOnglets;
    var TXT = {};
    function remplir(cle, vals) { return SZH.remplir(TXT, cle, vals); }
    // Un nombre devant un nom : la variante .un ou .plus de la clé, selon n.
    function nombre(cle, n, vals) { return remplir(cle + (n === 1 ? 'Un' : 'Plus'), vals); }

    // ---- État -----------------------------------------------------------------------------
    var donnees = null;          // le dernier propDonnees
    var demande = false;         // propCharger déjà parti
    var reglages = null;         // colonnes par type : { largeurs, masquees }, lu une fois
    var aussi = {};              // cle -> la marque de l'autre revue
    var onglet = null;
    var selection = new Set();
    var dernierCoche = null;
    var courant = null;
    var detailCle = null;
    var filtrePertinence = '';
    var afficherRefusees = false;
    var annulable = null;        // { cles, texte, geste, minuteur, defaire? }
    var avis = null;             // { texte, minuteur }
    var enCours = null;          // le geste parti, en attente de son résultat
    var largeurVue = 0;
    var pertinenceAuto = false;  // Pertinence masquée d'elle-même, détail ouvert
    // La finesse : le cran posé par le curseur en attendant l'hôte, les masquées montrées, et le
    // bandeau qui suit « Garder » ({ typeFiche, cran, minuteur }).
    var apercuLocal = {};
    var voirMasquees = {};
    var finesseAvis = null;
    // L'onglet Termes : le moissonneur choisi, le tri, la recherche, les filtres, le formulaire
    // d'ajout et l'avis qui suit une demande ; puis la demande partie, en attente de sa réponse.
    var termesEtat = { moissonneur: null, tri: 'seul', sens: -1, q: '', role: '', langue: '', form: false, avis: null };
    var formTermes = null;
    var attenteDemande = null;
    var zone = {};
    var menu = null;
    var apresEcriture = opts.apresEcriture || function (geste) { geste(); };
    // Le formulaire du détail ouvert : { cle, c, element, touches, bloquants, formes, jeton,
    // dernier, minuteur }. Il survit aux rendus de la vue tant que le détail reste sur sa
    // proposition ; sa saisie se perd à la fermeture.
    var form = null;
    var echouees = [];
    var nForm = 0;
    var champsDoc = SZH.ficheDoc.creer({
      api: api,
      txt: function () { return TXT; },
      types: function () { return (opts.types && opts.types()) || []; },
      index: function () { nForm += 1; return 'p' + nForm; },
      surSaisie: function (c, cle) { toucher(c, cle); }
    });

    // ---- Données ----------------------------------------------------------------------------
    function typeDe(t) { return ((donnees && donnees.types) || []).filter(function (x) { return x.type === t; })[0] || null; }
    function champDe(t, cle) { var d = typeDe(t); return d ? d.champs.filter(function (c) { return c.cle === cle; })[0] || null : null; }
    function libelleChamp(t, cle) {
      if (cle === 'langue') { return TXT.propLangue; }
      var c = champDe(t, cle);
      return c ? c.libelle : String(cle || '');
    }
    function libelleJeton(t, cle, jeton) {
      var c = champDe(t, cle);
      return c && c.libelles && c.libelles[jeton] ? c.libelles[jeton] : jeton;
    }
    function attente() { return (donnees && donnees.propositions) || []; }
    function refusees() { return (donnees && donnees.refusees) || []; }
    // Les acceptations de cette session dont la fiche n'a pas pu être créée : { p, valeurs }.
    function echoueesP() { return echouees.map(function (x) { return x.p; }); }
    function trouver(cle) {
      var tous = attente().concat(echoueesP(), refusees());
      return tous.filter(function (p) { return p.cle === cle; })[0] || null;
    }
    function enAttente(p) { return attente().indexOf(p) !== -1; }
    function estEchouee(p) { return echoueesP().indexOf(p) !== -1; }
    function estB(p) { return p.cas === 'B'; }
    function ongletsVisibles() {
      return ((donnees && donnees.types) || []).map(function (t) { return t.type; })
        .filter(function (t) { return attente().some(function (p) { return p.type === t; }); });
    }
    // ---- Finesse du tri ----------------------------------------------------------------------
    // Un type a des crans quand l'hôte les envoie. Le cran regardé : celui que le curseur vient de
    // poser, sinon l'aperçu du poste, sinon le réglage de la rédaction, sinon le cran par défaut
    // du moissonneur (1 s'il n'en déclare pas).
    function finesseDe(t) { return (donnees && donnees.finesse && donnees.finesse[t]) || null; }
    function reglageEffectif(f) { return f.reglage ? f.reglage.cran : (f.cranDefaut || 1); }
    function cranPartage(t) { var f = finesseDe(t); return f ? reglageEffectif(f) : 1; }
    function cranVu(t) {
      var f = finesseDe(t);
      if (!f) { return 1; }
      return apercuLocal[t] || f.apercu || cranPartage(t);
    }
    function visibleAu(p, k) { return !finesseDe(p.type) || (p.cranMax || NB_CRANS) >= k; }
    // Sans aperçu du poste, une proposition suit le réglage de son moissonneur : les crans sont
    // les déciles de chacun, un même numéro de cran se compare d'un moissonneur à l'autre.
    function cranVuP(p) {
      var f = finesseDe(p.type);
      if (!f) { return 1; }
      if (apercuLocal[p.type] || f.apercu) { return apercuLocal[p.type] || f.apercu; }
      var pm = f.parMoissonneur && f.parMoissonneur[p.dossier];
      if (pm) { return reglageEffectif(pm); }
      return cranPartage(p.type);
    }
    function visible(p) { return visibleAu(p, cranVuP(p)); }
    // Les moissonneurs à crans du type : { libelle, crans, reglage… } pour chacun.
    function moissonneursDe(t) {
      var f = finesseDe(t), pm = (f && f.parMoissonneur) || {};
      var ms = (f && f.moissonneurs) || [];
      return ms.filter(function (m) { return !!pm[m]; }).map(function (m) { return pm[m]; });
    }
    // Un cran est identique au précédent quand il l'est chez chaque moissonneur du type.
    function identique(t, k) {
      var ms = moissonneursDe(t);
      var listes = ms.length > 1 ? ms.map(function (x) { return x.crans; }) : [finesseDe(t).crans];
      return listes.every(function (crans) { var c = crans[k - 1]; return !!(c && c.identique_au_cran_precedent); });
    }
    function comptesVus(t) {
      var att = attente().filter(function (p) { return p.type === t; });
      var v = att.filter(visible).length;
      return { visibles: v, masquees: att.length - v };
    }
    // Le premier cran de la suite de crans identiques qui finit en k.
    function cranRepere(t, k) { var j = k; while (j > 1 && identique(t, j)) { j--; } return j; }
    function comptesAu(t, k) {
      var att = attente().filter(function (p) { return p.type === t; });
      var v = att.filter(function (p) { return visibleAu(p, k); }).length;
      return { visibles: v, masquees: att.length - v };
    }

    function comptes(type) {
      var att = attente().filter(function (p) { return p.type === type && visible(p); });
      return { n: att.length, b: att.filter(estB).length };
    }
    // Le filtre de pertinence ne vaut que pour un type sans crans : il n'est pas affiché ailleurs.
    function filtre(p) {
      if (finesseDe(p.type)) { return true; }
      return !filtrePertinence || (p.pertinence && p.pertinence.verdict === filtrePertinence);
    }
    // Les lignes de l'onglet : en attente dans l'ordre de l'hôte, les masquées seulement si on
    // les montre, puis les refusées si demandé.
    // Le filtre sur un terme posé depuis la vue Termes, s'il vise cet onglet : l'hôte en donne les cles.
    function filtreTermeActif() { var f = donnees && donnees.filtre; return f && f.typeFiche === onglet ? f : null; }
    function lignesOnglet() {
      var ft = filtreTermeActif();
      var l = attente().filter(function (p) {
        return p.type === onglet && filtre(p) && (visible(p) || !!voirMasquees[onglet]) && (!ft || ft.cles.indexOf(p.cle) !== -1);
      });
      if (!afficherRefusees) { return l; }
      return l.concat(refusees().filter(function (p) { return p.type === onglet && filtre(p); }));
    }
    // Les masquées montrées ne comptent pas : ni dans la position, ni pour la case de tête.
    function attenteOnglet() { return lignesOnglet().filter(function (p) { return enAttente(p) && visible(p); }); }
    function titreDe(p) { return (p.valeurs && p.valeurs.title) || TXT.sansTitre || ''; }
    function titreCourt(p) { var t = titreDe(p); return t.length > 60 ? t.slice(0, 57) + '…' : t; }
    // Un champ en doute ne se répète pas comme vide ou hors format : le doute dit déjà tout.
    function enDoute(p, champ) { return (p.doutes || []).some(function (d) { return d.champ === champ; }); }
    function raisonsB(p) {
      var r = [], vus = {};
      (p.raisons || []).forEach(function (x) {
        var k = x.code + ':' + x.champ;
        if (vus[k] || (x.code !== 'doute' && x.champ && enDoute(p, x.champ))) { return; }
        vus[k] = true;
        if (x.code === 'doute') { r.push(remplir('propRaisonDoute', [enTexte(libelleChamp(p.type, x.champ))])); }
        else if (x.code === 'requis-vide') { r.push(remplir('propRaisonRequis', [libelleChamp(p.type, x.champ)])); }
        else if (x.code === 'doublon') { r.push(TXT.propRaisonDoublon); }
        else { r.push(remplir('propRaisonFormat', [libelleChamp(p.type, x.champ)])); }
      });
      return r;
    }
    // Ce qui bloque : la dernière réponse de l'hôte pour le détail ouvert, sinon celle des données.
    function bloquantsDe(p) { return form && form.cle === p.cle ? form.bloquants : (p.bloquants || []); }
    function nomsBloquants(p) {
      var vus = {}, noms = [];
      bloquantsDe(p).forEach(function (x) {
        if (vus[x.champ]) { return; }
        vus[x.champ] = true;
        noms.push(libelleChamp(p.type, x.champ));
      });
      return noms.join(', ');
    }
    // Un cas B ne s'accepte que depuis son détail ouvert ; depuis le détail, rien ne doit bloquer.
    function acceptable(p, depuisDetail) {
      if (depuisDetail && p.cle === detailCle) { return bloquantsDe(p).length === 0; }
      return !estB(p);
    }
    // Un libellé repris dans une phrase : en minuscule, sauf en allemand, où le nom garde sa majuscule.
    function enTexte(s) {
      var l = String((document.documentElement && document.documentElement.lang) || '').slice(0, 2);
      return l === 'de' ? String(s) : String(s).toLowerCase();
    }
    function marqueAussi() { return '+ ' + ((donnees && donnees.cible) || ''); }
    function dateCourte(iso) {
      var d = String(iso || '').slice(0, 10).split('-');
      return d.length === 3 ? d[2] + '.' + d[1] + '.' + d[0] : String(iso || '');
    }
    function heureCourte(iso) {
      var d = new Date(iso);
      if (isNaN(d)) { return ''; }
      return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    }

    // ---- Boutons --------------------------------------------------------------------------
    // Un geste : icône et libellé court ; dans un tableau serré, l'icône seule. Le nom complet
    // est dans aria-label (il commence par le libellé visible) et dans l'infobulle.
    function boutonGeste(libelle, nomComplet, tip, nomIcone, fn, cls) {
      var b = SZH.bouton('', fn, cls, tip);
      b.setAttribute('aria-label', nomComplet);
      var i = icone(nomIcone);
      i.classList.add('prop-ico-geste');
      b.appendChild(i);
      poser(b, 'span', 'prop-libelle-geste', libelle);
      return b;
    }
    function boutonRefus(fnRefus, fnMotif) {
      var w = document.createElement('span');
      w.className = 'prop-refus';
      w.appendChild(boutonGeste(TXT.propRefuser, TXT.propRefuser, TXT.propRefuserTip, 'croix', fnRefus, 'prop-bouton-refuser'));
      var m = SZH.bouton('', function (ev) { ouvrirMenuMotifs(ev.currentTarget || m, fnMotif); }, 'prop-refus-menu', TXT.propMotifsTip);
      m.setAttribute('aria-label', TXT.propMotifsTip);
      m.setAttribute('aria-haspopup', 'menu');
      m.setAttribute('aria-expanded', 'false');
      m.appendChild(icone('chevron'));
      w.appendChild(m);
      return w;
    }

    // ---- Menus (motifs, colonnes) : la boîte de suggestions du socle, posée en fixe -------
    function fermerMenu(rendreFocus) {
      if (!menu) { return; }
      var src = menu.source;
      src.setAttribute('aria-expanded', 'false');
      menu.remove();
      menu = null;
      if (rendreFocus) { src.focus(); }
    }
    function placerMenu(source, aDroite) {
      panel.appendChild(menu);
      var r = source.getBoundingClientRect ? source.getBoundingClientRect() : { left: 0, right: 0, top: 0, bottom: 0 };
      var largeur = menu.offsetWidth || 0, hauteur = menu.offsetHeight || 0;
      var lw = window.innerWidth || 0, lh = window.innerHeight || 0;
      var x = aDroite ? r.right - largeur : r.left;
      menu.style.left = Math.max(4, lw ? Math.min(x, lw - largeur - 4) : x) + 'px';
      menu.style.top = (lh && r.bottom + hauteur + 4 > lh ? r.top - hauteur - 2 : r.bottom + 2) + 'px';
      source.setAttribute('aria-expanded', 'true');
    }
    function ouvrirMenuMotifs(source, fnMotif) {
      if (menu && menu.source === source) { fermerMenu(true); return; }
      fermerMenu(false);
      menu = document.createElement('div');
      menu.className = 'szh-sugg prop-menu';
      menu.setAttribute('role', 'menu');
      menu.source = source;
      Object.keys(MOTIFS).forEach(function (m) {
        var it = poser(menu, 'button', 'szh-sugg-item', TXT[MOTIFS[m]]);
        it.type = 'button';
        it.setAttribute('role', 'menuitem');
        it.dataset.motif = m;
        it.addEventListener('click', function () { fermerMenu(false); fnMotif(m); });
      });
      placerMenu(source, true);
      menu.querySelector('button').focus();
    }

    // ---- Onglets de type -------------------------------------------------------------------
    function rendreOnglets() {
      barreOnglets.textContent = '';
      var visibles = ongletsVisibles();
      var nav = aTermes() ? visibles.concat(['_termes']) : visibles;
      barreOnglets.hidden = nav.length === 0;
      if (nav.length > 0 && nav.indexOf(onglet) === -1) { onglet = nav[0]; }
      if (nav.length === 0) { onglet = null; }
      visibles.forEach(function (t) {
        var k = comptes(t);
        var b = document.createElement('button');
        b.type = 'button';
        b.id = 'prop-onglet-' + t;
        b.className = 'doc-onglet' + (t === onglet ? ' doc-onglet--actif' : '');
        b.dataset.type = t;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', t === onglet ? 'true' : 'false');
        b.setAttribute('aria-controls', 'panel-propositions');
        b.tabIndex = t === onglet ? 0 : -1;
        b.title = k.b > 0 ? nombre('propOngletTip', k.n, [k.n, k.b]) : nombre('propOngletTipA', k.n, [k.n]);
        poser(b, 'span', null, typeDe(t).libelle);
        poser(b, 'span', 'doc-onglet-compte', String(k.n));
        if (k.b > 0) {
          var pb = poser(b, 'span', 'szh-pastille szh-pastille--attention prop-onglet-b');
          pb.appendChild(icone('attention'));
          poser(pb, 'span', 'prop-onglet-b-n', String(k.b));
          poser(pb, 'span', 'prop-masque', ' ' + remplir('propDontB', [k.b]));
        }
        b.addEventListener('click', function () { changerOnglet(t); });
        naviguer(b, t);
        barreOnglets.appendChild(b);
      });
      if (aTermes()) {
        poser(barreOnglets, 'span', 'prop-onglet-sep').setAttribute('aria-hidden', 'true');
        var bt = document.createElement('button');
        bt.type = 'button';
        bt.id = 'prop-onglet-_termes';
        bt.className = 'doc-onglet prop-onglet-termes' + (onglet === '_termes' ? ' doc-onglet--actif' : '');
        bt.dataset.type = '_termes';
        bt.setAttribute('role', 'tab');
        bt.setAttribute('aria-selected', onglet === '_termes' ? 'true' : 'false');
        bt.setAttribute('aria-controls', 'panel-propositions');
        bt.tabIndex = onglet === '_termes' ? 0 : -1;
        var ic = icone('loupe');
        ic.classList.add('prop-onglet-ico');
        bt.appendChild(ic);
        poser(bt, 'span', null, TXT.propTermesOnglet);
        bt.addEventListener('click', function () { changerOnglet('_termes'); });
        naviguer(bt, '_termes');
        barreOnglets.appendChild(bt);
      }
      // Les flèches passent d'un onglet à l'autre, Termes compris.
      function naviguer(b, t) {
        b.addEventListener('keydown', function (ev) {
          if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') { return; }
          ev.preventDefault();
          var i = nav.indexOf(t) + (ev.key === 'ArrowRight' ? 1 : -1);
          var cible = nav[(i + nav.length) % nav.length];
          changerOnglet(cible);
          var nb = barreOnglets.querySelector('[data-type="' + cible + '"]');
          if (nb) { nb.focus(); }
        });
      }
      panel.setAttribute('role', 'tabpanel');
      if (onglet) { panel.setAttribute('aria-labelledby', 'prop-onglet-' + onglet); }
    }
    function changerOnglet(t) {
      onglet = t;
      selection.clear();
      dernierCoche = null;
      detailCle = null;
      courant = null;
      toutRendre(false);
    }

    // ---- La vue ------------------------------------------------------------------------------
    function rendreVue() {
      panel.textContent = '';
      menu = null;
      zone = {};
      if (!donnees) {
        opts.titre.textContent = TXT.propVue || '';
        poser(panel, 'p', 'doc-vue-vide', TXT.propChargement);
        return;
      }
      if (!onglet) { opts.titre.textContent = TXT.propVue || ''; rendreVide(); return; }
      if (onglet === '_termes') { rendreTermes(); return; }
      opts.titre.textContent = remplir('propTitreVue', [typeDe(onglet).libelle]);
      var vue = poser(panel, 'div', 'prop-vue');
      // L'état des moissonneurs qui alimentent cet onglet (etat.json).
      var noms = {};
      attente().concat(refusees()).forEach(function (p) { if (p.type === onglet) { noms[p.moissonneur] = true; } });
      var m = poser(vue, 'div', 'prop-moissons');
      (donnees.etats || []).filter(function (e) { return noms[e.moissonneur] && e.connu; })
        .forEach(function (e) { ligneMoisson(m, e); });
      zone.moissons = m;

      var f = poser(vue, 'div', 'prop-filtres');
      // Un type qui a des crans prend le curseur de finesse à la place du filtre de pertinence.
      if (finesseDe(onglet)) { rendreCurseur(f, onglet); } else {
        var lf = poser(f, 'label', 'doc-reservoir-case');
        poser(lf, 'span', 'doc-reservoir-filtre-label', TXT.propFiltrePertinence);
        var sel = poser(lf, 'select', 'prop-filtre-pertinence');
        [['', TXT.propToutes], ['retenu', TXT.propPertinenceRetenu], ['a-relire', TXT.propPertinenceARelire]].forEach(function (o) {
          var opt = poser(sel, 'option', null, o[1]);
          opt.value = o[0];
        });
        sel.value = filtrePertinence;
        sel.addEventListener('change', function () { filtrePertinence = sel.value; selection.clear(); rendreTable(); rendrePied(); });
      }
      var lr = poser(f, 'label', 'doc-reservoir-case');
      var cr = poser(lr, 'input', 'prop-afficher-refusees');
      cr.type = 'checkbox';
      cr.checked = afficherRefusees;
      poser(lr, 'span', null, TXT.propAfficherRefusees);
      cr.addEventListener('change', function () { afficherRefusees = cr.checked; rendreTable(); });
      poser(f, 'span', 'szh-pousse');
      var bc = SZH.bouton('', function () { ouvrirMenuColonnes(bc); }, 'prop-bouton-colonnes', TXT.propColonnesTip);
      bc.appendChild(icone('tableau'));
      poser(bc, 'span', null, TXT.propColonnes);
      bc.setAttribute('aria-haspopup', 'menu');
      bc.setAttribute('aria-expanded', 'false');
      f.appendChild(bc);
      // La légende du clavier : une infobulle, et la même au clic pour qui n'a pas de survol.
      var aide = SZH.bouton('?', function () { basculerAide(aide); }, 'prop-aide', TXT.propRaccourcisDetail);
      aide.setAttribute('aria-label', TXT.propRaccourcis);
      aide.setAttribute('aria-expanded', 'false');
      aide.setAttribute('aria-controls', 'prop-aide-texte');
      f.appendChild(aide);
      var at = poser(f, 'p', 'prop-aide-texte', TXT.propRaccourcisDetail);
      at.id = 'prop-aide-texte';
      at.hidden = true;
      if (zone.finesseDetail) { f.appendChild(zone.finesseDetail); }
      zone.filtres = f;
      // Sous la ligne : « Garder ce cran pour la rédaction », puis le bandeau qui le suit.
      zone.garde = poser(vue, 'div', 'prop-finesse-garde');
      rendreGarde();
      // Le filtre sur un terme, et de quoi le retirer.
      zone.bandeau = poser(vue, 'div', 'prop-termes-bandeau-zone');
      rendreBandeauFiltre();

      var split = poser(vue, 'div', 'prop-split');
      zone.split = split;
      var z = poser(split, 'div', 'prop-zone');
      zone.liste = z;
      zone.defile = poser(z, 'div', 'prop-defile');
      // Le pied est sous la liste et le détail, pour rester visible quand le détail est plein.
      zone.pied = poser(vue, 'div', 'prop-pied');
      zone.pied.setAttribute('aria-live', 'polite');
      zone.detail = null;
      rendreTable();
      rendreDetail();
      rendrePied();
    }
    function basculerAide(b) {
      var t = panel.querySelector('.prop-aide-texte');
      t.hidden = !t.hidden;
      b.setAttribute('aria-expanded', t.hidden ? 'false' : 'true');
    }
    // Le curseur tient sur une ligne : « Finesse  Très large ━━●━━ Strict  Cran 6 : … · les voir · ? ».
    // Le reste des chiffres est dans l'infobulle du « ? », et dans les Réglages de l'Accueil.
    function rendreCurseur(f, type) {
      var g = poser(f, 'div', 'prop-finesse');
      g.setAttribute('role', 'group');
      var nom = poser(g, 'span', 'prop-finesse-nom', TXT.propFinesse);
      nom.id = 'prop-finesse-nom';
      g.setAttribute('aria-labelledby', nom.id);
      poser(g, 'span', 'prop-finesse-bout', TXT.propFinesseTresLarge).setAttribute('aria-hidden', 'true');
      var c = poser(g, 'input', 'prop-finesse-curseur');
      c.type = 'range';
      c.min = '1';
      c.max = String(NB_CRANS);
      c.step = '1';
      c.value = String(cranVu(type));
      c.setAttribute('aria-labelledby', nom.id);
      c.setAttribute('aria-describedby', 'prop-finesse-lecture');
      poser(g, 'span', 'prop-finesse-bout', TXT.propFinesseStrict).setAttribute('aria-hidden', 'true');
      var lecture = poser(g, 'output', 'prop-finesse-lecture');
      lecture.id = 'prop-finesse-lecture';
      var k0 = cranVu(type), n0 = comptesVus(type);
      if (n0.masquees > 0) {
        poser(g, 'span', 'prop-point', '·').setAttribute('aria-hidden', 'true');
        var voir = SZH.bouton(voirMasquees[type] ? TXT.propFinesseCacher : TXT.propFinesseVoir, function () {
          voirMasquees[type] = !voirMasquees[type];
          selection.clear();
          toutRendre(false);
          var nb = panel.querySelector('.prop-finesse-voir');
          if (nb) { nb.focus(); }
        }, 'prop-lien prop-finesse-voir', TXT.propFinesseVoirTip);
        voir.setAttribute('aria-pressed', voirMasquees[type] ? 'true' : 'false');
        g.appendChild(voir);
      }
      var aide = SZH.bouton('?', function () {
        zone.finesseDetail.hidden = !zone.finesseDetail.hidden;
        aide.setAttribute('aria-expanded', zone.finesseDetail.hidden ? 'false' : 'true');
      }, 'prop-aide prop-finesse-aide');
      aide.setAttribute('aria-label', TXT.propFinesseAide);
      aide.setAttribute('aria-expanded', 'false');
      aide.setAttribute('aria-controls', 'prop-finesse-detail');
      g.appendChild(aide);
      // Les chiffres, posés dans la ligne des filtres sous le curseur, au clic sur « ? ».
      var det = document.createElement('p');
      det.className = 'prop-finesse-detail';
      det.id = 'prop-finesse-detail';
      det.hidden = true;
      zone.finesseDetail = det;
      function lire(k) {
        var n = k === k0 ? comptesVus(type) : comptesAu(type, k);
        var vis = nombre('propFinesseVisibles', n.visibles, [n.visibles]);
        var mas = nombre('propFinesseMasquees', n.masquees, [n.masquees]);
        if (identique(type, k)) {
          lecture.textContent = remplir('propFinesseIdentique', [k, cranRepere(type, k), vis, mas]);
          c.setAttribute('aria-valuetext', remplir('propFinesseValeurIdentique', [k, cranRepere(type, k), vis]));
        } else {
          lecture.textContent = remplir('propFinesseLecture', [k, vis, mas]);
          c.setAttribute('aria-valuetext', remplir('propFinesseValeur', [k, vis]));
        }
        var t = texteAide(type, k);
        aide.title = t;
        det.textContent = t;
      }
      // Le texte suit en direct ; le cran ne part à l'hôte qu'au lâcher.
      c.addEventListener('input', function () { lire(Number(c.value)); });
      c.addEventListener('change', function () {
        var k = Number(c.value);
        apercuLocal[type] = k;
        api.postMessage({ type: SZH.MSG.PROP_FINESSE_APERCU, typeFiche: type, cran: k });
        selection.clear();
        toutRendre(false);
        var nc = panel.querySelector('.prop-finesse-curseur');
        if (nc) { nc.focus(); }
      });
      lire(k0);
    }
    // Les chiffres du cran k, une phrase par ligne.
    function texteAide(type, k) {
      var l = [];
      if (identique(type, k)) { l.push(remplir('propFinesseIdentiqueTip', [k, cranRepere(type, k)])); }
      var ms = moissonneursDe(type);
      if (ms.length > 1) {
        ms.forEach(function (x) { l.push(remplir('propFinesseDeMoissonneur', [x.libelle])); chiffresAide(l, x, k); });
      } else { chiffresAide(l, finesseDe(type), k); }
      l.push(TXT.propFinesseApercu);
      return l.join('\n');
    }
    // Les chiffres d'un moissonneur au cran k : place par rapport au cran par défaut, volume,
    // rappel, date des crans, réglage partagé.
    function chiffresAide(l, f, k) {
      var c = f.crans[k - 1] || {};
      var d = f.cranDefaut || 1;
      if (k < d) { l.push(remplir('propFinessePlusLarge', [d])); }
      if (k === d) { l.push(remplir('propFinesseNormal', [d])); }
      if (f.fenetre) { l.push(remplir('propFinesseParMois', [c.par_mois, dateCourte(f.fenetre.du), dateCourte(f.fenetre.au)])); }
      // Sans fiches de référence dans cette langue (rappel_sur = 0), le rappel n'est pas mesuré.
      l.push(typeof c.rappel === 'number' && c.rappel_sur > 0 ? remplir('propFinesseRappel', [c.rappel, c.rappel_sur]) : TXT.propFinesseRappelSans);
      if (f.calculeLe) { l.push(remplir('propFinesseCalcule', [dateCourte(f.calculeLe)])); }
      if (f.source === 'commun') { l.push(TXT.propFinesseCommun); }
      if (!f.calibree) { l.push(TXT.propFinesseNonCalibree); }
      l.push(f.reglage ? remplir('propFinesseRegle', [donnees.revue, f.reglage.cran, f.reglage.par, dateCourte(f.reglage.le)])
        : remplir('propFinesseRegleAucun', [donnees.revue, d]));
    }
    // « Garder ce cran pour la rédaction » n'apparait que si l'aperçu du poste diffère du réglage
    // effectif ; le bandeau qui suit le geste permet de l'annuler.
    function rendreGarde() {
      var z = zone.garde;
      if (!z) { return; }
      z.textContent = '';
      if (finesseDe(onglet) && cranVu(onglet) !== cranPartage(onglet)) {
        z.appendChild(SZH.bouton(TXT.propFinesseGarder, function () {
          api.postMessage({ type: SZH.MSG.PROP_FINESSE_GARDER, typeFiche: onglet });
        }, 'prop-finesse-garder', remplir('propFinesseGarderTip', [donnees.revue])));
      }
      if (finesseAvis && finesseAvis.typeFiche === onglet) {
        var t = finesseAvis.typeFiche;
        var n = SZH.notif('ok', [document.createTextNode(remplir('propFinesseGarde', [donnees.revue, finesseAvis.cran]))]);
        n.classList.add('prop-finesse-bandeau');
        n.setAttribute('role', 'status');
        n.querySelector('span').appendChild(SZH.bouton(TXT.propAnnuler, function () {
          poserFinesseAvis(null);
          api.postMessage({ type: SZH.MSG.PROP_FINESSE_ANNULER, typeFiche: t });
        }, 'prop-finesse-annuler', TXT.propAnnulerTip));
        z.appendChild(n);
      }
      z.hidden = !z.firstChild;
    }
    function poserFinesseAvis(a) {
      if (finesseAvis && finesseAvis.minuteur) { clearTimeout(finesseAvis.minuteur); }
      finesseAvis = a;
      if (a) { a.minuteur = setTimeout(function () { finesseAvis = null; rendreGarde(); }, DUREE_BANDEAU); }
    }

    function ligneMoisson(parent, e) {
      var l = poser(parent, 'p', 'prop-moisson');
      poser(l, 'span', null, nombre('propMoisson', e.propositions, [e.libelle, dateCourte(e.derniere), heureCourte(e.derniere), e.propositions]));
      e.echecs.forEach(function (x) {
        var s = poser(l, 'span', 'prop-echec');
        s.appendChild(icone('attention'));
        poser(s, 'span', null, remplir('propEchec', [x.source, x.raison]));
      });
    }
    function rendreVide() {
      var v = poser(panel, 'div', 'prop-vide');
      v.appendChild(SZH.notif('info', TXT.propVide));
      poser(v, 'h3', 'doc-vue-titre-section', TXT.propVideMoissons);
      var etats = (donnees.etats || []).filter(function (e) { return e.connu; });
      if (etats.length === 0) { poser(v, 'p', 'doc-vue-vide', TXT.propVideAucune); }
      var ul = poser(v, 'ul', 'prop-vide-liste');
      etats.forEach(function (e) {
        var li = poser(ul, 'li');
        poser(li, 'span', 'prop-vide-nom', e.libelle);
        poser(li, 'span', 'prop-vide-quand', nombre('propMoissonCourt', e.propositions, [dateCourte(e.derniere), heureCourte(e.derniere), e.propositions]));
        if (e.echecs.length === 0) { poser(li, 'span', 'prop-vide-quand', TXT.propVideSans); }
        e.echecs.forEach(function (x) {
          var s = poser(li, 'span', 'prop-echec');
          s.appendChild(icone('attention'));
          poser(s, 'span', null, remplir('propEchec', [x.source, x.raison]));
        });
      });
      zone.pied = poser(v, 'div', 'prop-pied');
      rendrePied();
    }

    // ---- Colonnes ------------------------------------------------------------------------------
    // La case et les gestes sont fixes ; le titre se règle mais ne se masque pas ; les autres se
    // règlent et se masquent. Largeurs en px, la valeur de aria-valuenow.
    function colonnesDe(type) {
      var d = typeDe(type);
      var cols = [{ id: 'case', fixe: true }];
      cols.push({ id: 'etat', libelle: TXT.propColEtat, defaut: 104, min: 44, masquable: true });
      cols.push({ id: 'titre', libelle: TXT.propColTitre, defaut: null, min: 180, masquable: false });
      d.tri.forEach(function (k) {
        cols.push({ id: 'champ:' + k, cle: k, libelle: libelleChamp(type, k), defaut: 76, min: 44, masquable: true });
      });
      if (d.categorie && d.tri.indexOf('categorie') === -1) {
        cols.push({ id: 'champ:categorie', cle: 'categorie', libelle: TXT.propColType, defaut: 118, min: 56, masquable: true });
      }
      // Un type qui a des crans montre son cran à la place de la pertinence, masqué tant qu'on ne
      // l'a pas demandé dans le menu.
      if (finesseDe(type)) { cols.push({ id: 'cran', libelle: TXT.propColCran, defaut: 76, min: 44, masquable: true, montrable: true }); }
      else { cols.push({ id: 'pertinence', libelle: TXT.propColPertinence, defaut: 108, min: 56, masquable: true }); }
      cols.push({ id: 'gestes', libelle: TXT.propColGestes, fixe: true });
      return cols;
    }
    function reglageDe(type) {
      var r = (reglages || {})[type] || {};
      return { largeurs: Object.assign({}, r.largeurs || {}), masquees: (r.masquees || []).slice(), montrees: (r.montrees || []).slice() };
    }
    function reglageVide(r) { return Object.keys(r.largeurs).length === 0 && r.masquees.length === 0 && r.montrees.length === 0; }
    // « montrees » n'est écrit que s'il sert : les réglages d'avant restent identiques.
    function aSauver(r) {
      var x = { largeurs: r.largeurs, masquees: r.masquees };
      if (r.montrees.length > 0) { x.montrees = r.montrees; }
      return x;
    }
    function poserReglage(type, r) {
      reglages = reglages || {};
      if (reglageVide(r)) { delete reglages[type]; } else { reglages[type] = aSauver(r); }
    }
    // Mémorise le réglage d'un type chez l'hôte, dans le globalState du poste.
    function sauverReglage(type, r) {
      poserReglage(type, r);
      api.postMessage({ type: SZH.MSG.PROP_COLONNES, typeFiche: type, reglage: reglageVide(r) ? null : aSauver(r) });
    }
    function detailPlein() { return !!detailCle && largeurVue > 0 && largeurVue < SEUIL_DETAIL_PLEIN; }
    function colonnesVisibles(type) {
      var m = reglageDe(type).masquees, montrees = reglageDe(type).montrees;
      var serre = pertinenceAuto && !!detailCle && !detailPlein();
      return colonnesDe(type).filter(function (c) {
        if (c.fixe || c.masquable === false) { return true; }
        if (c.montrable) { return montrees.indexOf(c.id) !== -1; }
        if (serre && c.id === 'pertinence') { return false; }
        return m.indexOf(c.id) === -1;
      });
    }

    // ---- Tableau -------------------------------------------------------------------------------
    // La deuxième ligne grise d'une recherche : institutions, puis le début du descriptif.
    function sousLigne(p) {
      if (p.type !== 'recherche') { return ''; }
      return [p.valeurs.institutions, p.valeurs.descriptif].filter(Boolean).join(' · ');
    }
    function rendreTable() {
      if (!zone.defile) { return; }
      var actif = document.activeElement;
      var garderFocus = actif && zone.defile.contains && zone.defile.contains(actif);
      var focusSep = actif && actif.dataset && actif.dataset.sep;
      zone.defile.textContent = '';
      var lignes = lignesOnglet();
      if (courant && !lignes.some(function (p) { return p.cle === courant; })) { courant = null; }
      if (!courant && lignes.length > 0) { courant = lignes[0].cle; }
      var cols = colonnesVisibles(onglet);
      var t = poser(zone.defile, 'table', 'prop-table');
      zone.table = t;
      t.setAttribute('role', 'grid');
      t.setAttribute('aria-label', remplir('propTitreVue', [typeDe(onglet).libelle]));
      t.setAttribute('aria-rowcount', String(lignes.length + 1));
      t.setAttribute('aria-colcount', String(cols.length));
      var cg = poser(t, 'colgroup');
      zone.cols = {};
      cols.forEach(function (c) { zone.cols[c.id] = poser(cg, 'col', 'prop-col-' + c.id.replace(':', '-')); });
      var trh = poser(poser(t, 'thead'), 'tr');
      // La case de tête ne coche que les visibles : une masquée montrée ne compte pas.
      var att = lignes.filter(function (p) { return enAttente(p) && visible(p); });
      cols.forEach(function (c) {
        var th = poser(trh, 'th', 'prop-th-' + c.id.replace(':', '-'));
        th.setAttribute('scope', 'col');
        if (c.id === 'case') {
          var caseTout = poser(th, 'input', 'prop-case-tout');
          caseTout.type = 'checkbox';
          caseTout.setAttribute('aria-label', TXT.propCaseTout);
          caseTout.title = TXT.propCaseTout;
          var nCoches = att.filter(function (p) { return selection.has(p.cle); }).length;
          caseTout.checked = att.length > 0 && nCoches === att.length;
          caseTout.indeterminate = nCoches > 0 && nCoches < att.length;
          caseTout.disabled = att.length === 0;
          caseTout.addEventListener('change', function () {
            att.forEach(function (p) { if (caseTout.checked) { selection.add(p.cle); } else { selection.delete(p.cle); } });
            rendreTable();
            rendrePied();
          });
          return;
        }
        poser(th, 'span', 'prop-th-libelle', c.libelle);
        if (c.id === 'gestes') { th.classList.add('prop-th-droite'); return; }
        poserPoignee(th, c);
      });
      var tbody = poser(t, 'tbody');
      lignes.forEach(function (p, i) {
        var refusee = !enAttente(p);
        var masquee = !refusee && !visible(p);
        var tr = poser(tbody, 'tr', 'prop-ligne' + (p.cle === courant ? ' prop-ligne--courante' : '') + (refusee ? ' prop-ligne--refusee' : '')
          + (masquee ? ' prop-ligne--masquee' : ''));
        tr.dataset.cle = p.cle;
        tr.tabIndex = p.cle === courant ? 0 : -1;
        tr.setAttribute('aria-rowindex', String(i + 2));
        tr.setAttribute('aria-selected', p.cle === detailCle ? 'true' : 'false');
        tr.addEventListener('click', function (ev) {
          if (ev.target && ev.target.closest && ev.target.closest('button, input, select, a')) { return; }
          definirCourant(p.cle, true);
          if (detailCle) { ouvrirDetail(p.cle, false); }
        });
        cols.forEach(function (c) { celluleLigne(tr, p, c, refusee, att); });
      });
      disposer();
      if (focusSep) {
        var sep = zone.defile.querySelector('[data-sep="' + focusSep + '"]');
        if (sep) { sep.focus(); }
      } else if (garderFocus) { focaliserCourant(); }
    }
    function celluleLigne(tr, p, c, refusee, att) {
      if (c.id === 'case') {
        var tdc = poser(tr, 'td');
        if (!enAttente(p)) { return; }
        var cb = poser(tdc, 'input', 'prop-case');
        cb.type = 'checkbox';
        cb.checked = selection.has(p.cle);
        cb.setAttribute('aria-label', remplir('propCaseLigne', [titreDe(p)]));
        cb.addEventListener('click', function (ev) {
          // Maj+clic coche toute la plage depuis la dernière case touchée.
          if (ev.shiftKey && dernierCoche) {
            var cles = att.map(function (x) { return x.cle; });
            var a = cles.indexOf(dernierCoche), b = cles.indexOf(p.cle);
            if (a !== -1 && b !== -1) {
              cles.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(function (k) {
                if (cb.checked) { selection.add(k); } else { selection.delete(k); }
              });
            }
          } else if (cb.checked) { selection.add(p.cle); } else { selection.delete(p.cle); }
          dernierCoche = p.cle;
          definirCourant(p.cle, false);
          rendreTable();
          rendrePied();
          var ret = ligneDe(p.cle);
          var c2 = ret && ret.querySelector('input');
          if (c2) { c2.focus(); }
        });
        return;
      }
      if (c.id === 'etat') {
        var tde = poser(tr, 'td', 'prop-td-etat');
        if (refusee) {
          var sr = poser(tde, 'span', 'prop-etat prop-etat--refusee');
          sr.appendChild(icone('croix'));
          poser(sr, 'span', null, TXT.propRefusee + (p.motif && MOTIFS[p.motif] ? ' (' + libelleMotif(p.motif) + ')' : ''));
        } else if (estB(p)) {
          var s = poser(tde, 'span', 'prop-etat');
          s.title = remplir('propResumeB', [raisonsB(p).join(', ')]);
          s.appendChild(icone('attention'));
          poser(s, 'span', null, TXT.propAVerifier);
        }
        return;
      }
      if (c.id === 'titre') {
        var tdt = poser(tr, 'td', 'prop-td-titre');
        var bt = poser(tdt, 'button', 'prop-titre', titreDe(p));
        bt.type = 'button';
        bt.title = titreDe(p);
        bt.addEventListener('click', function () { definirCourant(p.cle, false); ouvrirDetail(p.cle, true); });
        var sl = sousLigne(p);
        if (sl) { var ps = poser(tdt, 'span', 'prop-sousligne', sl); ps.title = sl; }
        // Une proposition visible des deux rédactions le dit en toutes lettres.
        if (p.langues && p.langues.length > 1) {
          var ml = poser(tdt, 'span', 'prop-langues', p.langues.join(' · '));
          ml.setAttribute('role', 'img');
          ml.setAttribute('aria-label', remplir('propLanguesTip', [p.langues.join(', ')]));
          ml.title = ml.getAttribute('aria-label');
        }
        // Une masquée montrée le dit en toutes lettres : le gris et l'italique ne font que le doubler.
        if (enAttente(p) && !visible(p)) { poser(tdt, 'span', 'prop-masquee-mot', TXT.propFinesseMasquee); }
        return;
      }
      if (c.cle) {
        var v = p.valeurs[c.cle] || '';
        // Le type se lit en clair ; le canton reste son sigle, son nom en infobulle.
        var court = c.cle === 'categorie' ? libelleJeton(p.type, c.cle, v) : v;
        var td = poser(tr, 'td', 'prop-td-cle', court || '–');
        if (v) { td.title = libelleJeton(p.type, c.cle, v); }
        return;
      }
      if (c.id === 'cran') {
        var k = p.cranMax || NB_CRANS;
        var score = p.pertinence && typeof p.pertinence.score === 'number' ? arrondi(p.pertinence.score) : '–';
        var tdk = poser(tr, 'td', 'prop-discret prop-td-cran', '1–' + k);
        tdk.title = remplir('propCranTip', [k, score]);
        return;
      }
      if (c.id === 'pertinence') {
        var verdict = p.pertinence ? p.pertinence.verdict : '';
        var tdp = poser(tr, 'td', 'prop-discret', PERTINENCES[verdict] ? TXT[PERTINENCES[verdict]] : '–');
        if (p.pertinence && p.pertinence.raison) { tdp.title = p.pertinence.raison; }
        return;
      }
      // Les gestes, et devant eux la marque de l'autre revue.
      var tda = poser(tr, 'td', 'prop-td-actions');
      var act = poser(tda, 'span', 'prop-actions');
      if (refusee) {
        act.appendChild(SZH.bouton(TXT.propReprendre, function () { reprendre(p.cle); }, 'prop-bouton-reprendre', TXT.propReprendreTip));
        return;
      }
      if (aussi[p.cle]) {
        var ma = SZH.bouton(marqueAussi(), function () { retirerAussi(p.cle); }, 'prop-aussi', remplir('propAussiTip', [donnees.revueAutre]));
        ma.setAttribute('aria-label', remplir('propAussiLabel', [marqueAussi(), donnees.revueAutre]));
        act.appendChild(ma);
      }
      if (estB(p)) {
        act.appendChild(boutonGeste(TXT.propVerifier, TXT.propVerifier, TXT.propVerifierTip, 'loupe',
          function () { definirCourant(p.cle, false); ouvrirDetail(p.cle, true); }, 'prop-bouton-verifier'));
      } else {
        act.appendChild(boutonGeste(TXT.propAccepterCourt, TXT.propAccepter, TXT.propAccepterTip, 'ok',
          function () { agir('accepte', [p.cle]); }, 'szh-bouton--principal prop-bouton-accepter'));
        act.appendChild(boutonGeste(TXT.propGarderCourt, TXT.propGarder, TXT.propGarderTip, 'bas',
          function () { agir('garde', [p.cle]); }, 'prop-bouton-garder'));
      }
      act.appendChild(boutonRefus(function () { agir('refuse', [p.cle]); }, function (m) { agir('refuse', [p.cle], m); }));
    }

    // Les largeurs : chaque colonne réglée garde sa valeur ; le titre non réglé prend le reste ;
    // les gestes ont la largeur de leurs boutons, et prennent le reste quand le titre est réglé.
    function disposer() {
      if (!zone.table || !zone.cols || !onglet) { return; }
      var dispo = zone.defile.clientWidth;
      if (!dispo) { return; }                 // pas de mise en page (page cachée)
      var r = reglageDe(onglet).largeurs;
      var cols = colonnesVisibles(onglet);
      var minTitre = 180;
      function calculer() {
        var gestes = 0;
        Array.prototype.forEach.call(zone.table.querySelectorAll('.prop-actions, .prop-th-gestes .prop-th-libelle'), function (e) {
          gestes = Math.max(gestes, Math.ceil(e.getBoundingClientRect().width));
        });
        var x = { w: {}, somme: 0 };
        cols.forEach(function (c) {
          if (c.id === 'case') { x.w[c.id] = 32; }
          else if (c.id === 'gestes') { x.w[c.id] = gestes + 18; }
          else if (r[c.id]) { x.w[c.id] = Math.max(c.min, r[c.id]); }
          else if (c.defaut) { x.w[c.id] = c.defaut; }
          if (x.w[c.id]) { x.somme += x.w[c.id]; }
        });
        return x;
      }
      // Faute de place, les gestes passent en icônes avant que le tableau ne défile.
      zone.liste.classList.remove('prop-zone--serre');
      var x = calculer();
      if (x.somme + (x.w.titre ? 0 : minTitre) > dispo) { zone.liste.classList.add('prop-zone--serre'); x = calculer(); }
      // Détail ouvert : Pertinence se retire avant que Type ne se tronque, et revient dès que
      // la place le permet.
      var deborde = x.somme + (x.w.titre ? 0 : minTitre) > dispo;
      var largeurPertinence = (r.pertinence || 108);
      if (!pertinenceAuto && deborde && detailCle && !detailPlein() && x.w.pertinence) {
        pertinenceAuto = true; rendreTable(); return;
      }
      if (pertinenceAuto && (!detailCle || x.somme + largeurPertinence + (x.w.titre ? 0 : minTitre) <= dispo)) {
        pertinenceAuto = false; rendreTable(); return;
      }
      var w = x.w, somme = x.somme;
      if (!w.titre) { w.titre = Math.max(minTitre, dispo - somme); somme += w.titre; }
      else if (somme < dispo) { w.gestes += dispo - somme; somme = dispo; }
      cols.forEach(function (c) { zone.cols[c.id].style.width = w[c.id] + 'px'; });
      zone.table.style.width = Math.max(somme, dispo) + 'px';
      Array.prototype.forEach.call(zone.table.querySelectorAll('[role="separator"]'), function (s) {
        s.setAttribute('aria-valuenow', String(w[s.dataset.sep]));
      });
      zone.largeurs = w;
    }
    function largeurCourante(c) {
      if (zone.largeurs && zone.largeurs[c.id]) { return zone.largeurs[c.id]; }
      return reglageDe(onglet).largeurs[c.id] || c.defaut || c.min;
    }

    // La poignée sur le bord droit d'un en-tête : glisser, ou flèches quand elle a le focus.
    function poserPoignee(th, c) {
      var s = poser(th, 'span', 'prop-poignee');
      s.setAttribute('role', 'separator');
      s.setAttribute('aria-orientation', 'vertical');
      s.setAttribute('aria-label', remplir('propSeparateur', [c.libelle]));
      s.setAttribute('aria-valuemin', String(c.min));
      s.setAttribute('aria-valuemax', String(LARGEUR_MAX));
      s.setAttribute('aria-valuenow', String(largeurCourante(c)));
      s.title = TXT.propSeparateurTip;
      s.tabIndex = 0;
      s.dataset.sep = c.id;
      s.addEventListener('pointerdown', function (ev) {
        if (ev.button !== 0) { return; }
        ev.preventDefault();
        var depart = ev.clientX, base = largeurCourante(c);
        try { s.setPointerCapture(ev.pointerId); } catch (e) { /* pointeur sans capture possible */ }
        s.classList.add('prop-poignee--active');
        function bouger(e) { appliquerLargeur(c, base + e.clientX - depart, false); }
        function lacher() {
          s.removeEventListener('pointermove', bouger);
          s.removeEventListener('pointerup', lacher);
          s.removeEventListener('pointercancel', lacher);
          s.classList.remove('prop-poignee--active');
          appliquerLargeur(c, largeurCourante(c), true);
        }
        s.addEventListener('pointermove', bouger);
        s.addEventListener('pointerup', lacher);
        s.addEventListener('pointercancel', lacher);
      });
      s.addEventListener('keydown', function (ev) {
        var pas = ev.shiftKey ? PAS_CLAVIER_GRAND : PAS_CLAVIER, v = largeurCourante(c);
        if (ev.key === 'ArrowRight') { v += pas; }
        else if (ev.key === 'ArrowLeft') { v -= pas; }
        else if (ev.key === 'Home') { v = c.min; }
        else if (ev.key === 'End') { v = LARGEUR_MAX; }
        else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') { ev.preventDefault(); ev.stopPropagation(); return; }
        else { return; }
        ev.preventDefault();
        ev.stopPropagation();
        appliquerLargeur(c, v, true);
      });
    }
    function appliquerLargeur(c, v, memoriser) {
      v = Math.round(Math.max(c.min, Math.min(LARGEUR_MAX, v)));
      var r = reglageDe(onglet);
      r.largeurs[c.id] = v;
      if (memoriser) { sauverReglage(onglet, r); } else { poserReglage(onglet, r); }
      if (zone.largeurs) { zone.largeurs[c.id] = v; }
      var s = zone.table && zone.table.querySelector('[data-sep="' + c.id + '"]');
      if (s) { s.setAttribute('aria-valuenow', String(v)); }
      disposer();
    }

    // Le menu « Colonnes » : une case par colonne, puis « Rétablir les largeurs ».
    function basculerColonne(id) {
      var r = reglageDe(onglet);
      var montrable = colonnesDe(onglet).some(function (c) { return c.id === id && c.montrable; });
      var liste = montrable ? r.montrees : r.masquees, i = liste.indexOf(id);
      if (i === -1) { liste.push(id); } else { liste.splice(i, 1); }
      sauverReglage(onglet, r);
      rendreTable();
    }
    function retablirColonnes() {
      sauverReglage(onglet, { largeurs: {}, masquees: [], montrees: [] });
      zone.largeurs = null;
      rendreTable();
    }
    function ouvrirMenuColonnes(source) {
      if (menu && menu.source === source) { fermerMenu(true); return; }
      fermerMenu(false);
      menu = document.createElement('div');
      menu.className = 'szh-sugg prop-menu prop-menu-colonnes';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', TXT.propColonnes);
      menu.source = source;
      // Espace est traité au keydown ; le keyup ne doit pas cocher une seconde fois.
      menu.addEventListener('keyup', function (ev) { if (ev.key === ' ') { ev.preventDefault(); } });
      function remplirMenu() {
        menu.textContent = '';
        var m = reglageDe(onglet).masquees, montrees = reglageDe(onglet).montrees;
        colonnesDe(onglet).forEach(function (c) {
          if (c.id === 'case') { return; }
          var it = poser(menu, 'button', 'szh-sugg-item prop-menu-case');
          it.type = 'button';
          it.setAttribute('role', 'menuitemcheckbox');
          it.dataset.col = c.id;
          var fixe = c.fixe || c.masquable === false;
          var coche = fixe || (c.montrable ? montrees.indexOf(c.id) !== -1 : m.indexOf(c.id) === -1);
          it.setAttribute('aria-checked', coche ? 'true' : 'false');
          var marque = poser(it, 'span', 'prop-menu-marque');
          marque.setAttribute('aria-hidden', 'true');
          if (coche) { marque.appendChild(icone('ok')); }
          poser(it, 'span', null, c.libelle);
          if (fixe) {
            it.setAttribute('aria-disabled', 'true');
            it.title = remplir('propColonneFixe', [c.libelle]);
            it.classList.add('prop-menu-case--fixe');
          }
          it.addEventListener('click', function () {
            if (fixe) { return; }
            basculerColonne(c.id);
            remplirMenu();
            var r = menu.querySelector('[data-col="' + c.id + '"]');
            if (r) { r.focus(); }
          });
        });
        poser(menu, 'div', 'prop-menu-filet').setAttribute('role', 'separator');
        var rt = poser(menu, 'button', 'szh-sugg-item', TXT.propRetablir);
        rt.type = 'button';
        rt.setAttribute('role', 'menuitem');
        rt.title = TXT.propRetablirTip;
        rt.dataset.col = '_retablir';
        rt.addEventListener('click', function () {
          retablirColonnes();
          remplirMenu();
          var r = menu.querySelector('[data-col="_retablir"]');
          if (r) { r.focus(); }
        });
      }
      remplirMenu();
      placerMenu(source, false);
      var premier = Array.prototype.filter.call(menu.querySelectorAll('button'), function (b) { return !b.getAttribute('aria-disabled'); })[0];
      if (premier) { premier.focus(); }
    }

    function ligneDe(cle) {
      if (!zone.defile) { return null; }
      return Array.prototype.filter.call(zone.defile.querySelectorAll('tr'), function (tr) { return tr.dataset.cle === cle; })[0] || null;
    }
    function focaliserCourant() { var tr = courant && ligneDe(courant); if (tr) { tr.focus(); } }
    function definirCourant(cle, focus) {
      courant = cle;
      if (!zone.defile) { return; }
      Array.prototype.forEach.call(zone.defile.querySelectorAll('tr'), function (tr) {
        if (tr.dataset.cle === undefined) { return; }
        var oui = tr.dataset.cle === cle;
        tr.classList.toggle('prop-ligne--courante', oui);
        tr.tabIndex = oui ? 0 : -1;
      });
      var tr = ligneDe(cle);
      if (tr) {
        try { tr.scrollIntoView({ block: 'nearest' }); } catch (e) { /* sans mise en page */ }
        if (focus) { tr.focus(); }
      }
    }

    // ---- Pied : avis, bandeau Annuler, barre de sélection --------------------------------
    function rendrePied() {
      if (!zone.pied) { return; }
      zone.pied.textContent = '';
      if (avis) {
        var na = SZH.notif('attention', [document.createTextNode(avis.texte)]);
        na.classList.add('prop-avis');
        na.setAttribute('role', 'status');
        zone.pied.appendChild(na);
      }
      if (termesEtat.avis && onglet !== '_termes') {
        var nt = SZH.notif(termesEtat.avis.ton, termesEtat.avis.texte);
        nt.classList.add('prop-avis');
        nt.setAttribute('role', 'status');
        zone.pied.appendChild(nt);
      }
      echouees.forEach(function (x) {
        var ne = SZH.notif('attention', [document.createTextNode(remplir('propIntrouvable', [titreCourt(x.p)]))]);
        ne.classList.add('prop-echouee');
        ne.setAttribute('role', 'status');
        var br = SZH.bouton(TXT.propRecreer, function () { recreer(x.p); }, 'prop-recreer', TXT.propRecreerTip);
        ne.querySelector('span').appendChild(br);
        zone.pied.appendChild(ne);
      });
      if (annulable) {
        var n = SZH.notif('ok', [document.createTextNode(annulable.texte)]);
        n.classList.add('prop-bandeau');
        n.setAttribute('role', 'status');
        if (annulable.cles.length > 0 || annulable.defaire) {
          n.querySelector('span').appendChild(SZH.bouton(TXT.propAnnuler, annuler, 'prop-bouton-annuler', TXT.propAnnulerTip));
        }
        zone.pied.appendChild(n);
      }
      if (!onglet) { return; }
      var cles = Array.from(selection).filter(function (c) { var p = trouver(c); return p && enAttente(p) && p.type === onglet; });
      if (cles.length === 0) { return; }
      var a = cles.filter(function (c) { return !estB(trouver(c)); });
      var nb = cles.length - a.length;
      var etiquette = nombre('propSelection', cles.length, [cles.length]);
      var bar = poser(zone.pied, 'div', 'prop-selbar');
      bar.setAttribute('role', 'region');
      bar.setAttribute('aria-label', etiquette);
      poser(bar, 'span', 'prop-selbar-compte', etiquette);
      var g = poser(bar, 'span', 'prop-gestes-lot');
      var suffixe = nb > 0 ? ' (' + a.length + ')' : '';
      var bA = SZH.bouton(TXT.propAccepter + suffixe, function () { agir('accepte', a); }, 'szh-bouton--principal prop-lot-accepter', TXT.propAccepterTip);
      var bG = SZH.bouton(TXT.propGarder + suffixe, function () { agir('garde', a); }, 'prop-lot-garder', TXT.propGarderTip);
      bA.disabled = bG.disabled = a.length === 0;
      g.appendChild(bA);
      poser(g, 'span', 'prop-point', '·').setAttribute('aria-hidden', 'true');
      g.appendChild(bG);
      poser(g, 'span', 'prop-point', '·').setAttribute('aria-hidden', 'true');
      var r = boutonRefus(function () { agir('refuse', cles); }, function (m) { agir('refuse', cles, m); });
      r.querySelector('.prop-libelle-geste').textContent = TXT.propRefuser + (nb > 0 ? ' (' + cles.length + ')' : '');
      r.firstChild.classList.add('prop-lot-refuser');
      g.appendChild(r);
      if (nb > 0) {
        var w = poser(bar, 'span', 'prop-selbar-b');
        w.title = TXT.propAVerifierDabordTip;
        w.appendChild(icone('attention'));
        poser(w, 'span', null, nombre('propAVerifierDabord', nb, [nb]));
      }
      poser(bar, 'span', 'szh-pousse');
      bar.appendChild(SZH.bouton(TXT.propDeselectionner, function () { selection.clear(); rendreTable(); rendrePied(); }));
    }
    function avertir(texte) {
      if (avis && avis.minuteur) { clearTimeout(avis.minuteur); }
      avis = { texte: texte };
      avis.minuteur = setTimeout(function () { avis = null; rendrePied(); }, DUREE_AVIS);
      rendrePied();
    }
    function poserAnnulable(a) {
      if (annulable && annulable.minuteur) { clearTimeout(annulable.minuteur); }
      annulable = a;
      if (a) { a.minuteur = setTimeout(function () { annulable = null; rendrePied(); }, DUREE_BANDEAU); }
    }

    // ---- Gestes ----------------------------------------------------------------------------------
    // Accepter et Garder rechargent la Documentation du numéro : ils passent par apresEcriture,
    // qui enregistre d'abord ses cartes modifiées. Refuser ne recharge rien et part aussitôt.
    function agir(geste, cles, motif) {
      var depuisDetail = !!detailCle && cles.length === 1 && cles[0] === detailCle;
      cles = cles.filter(function (c) { var p = trouver(c); return p && enAttente(p); });
      if (geste !== 'refuse') {
        cles = cles.filter(function (c) { return acceptable(trouver(c), depuisDetail); });
      }
      if (cles.length === 0 || enCours) { return; }
      var envoyer = function () {
        if (enCours) { return; }
        avis = null;
        enCours = {
          geste: geste, cles: cles, motif: motif || '', depuisDetail: depuisDetail,
          avant: attenteOnglet().map(function (p) { return p.cle; }),
          titres: cles.map(function (c) { return titreCourt(trouver(c)); }), envois: {}
        };
        if (geste === 'refuse') {
          api.postMessage({ type: SZH.MSG.PROP_REFUSER, cles: cles, motif: motif || '' });
          return;
        }
        api.postMessage({
          type: SZH.MSG.PROP_ACCEPTER, dansNumero: geste === 'accepte', depuisDetail: depuisDetail,
          demandes: cles.map(function (c) {
            var d = { cle: c, aussi: !!aussi[c] };
            var p = trouver(c);
            // Depuis le détail, la saisie part avec les champs touchés.
            if (depuisDetail && form && form.cle === c) {
              d.valeurs = champsDoc.valeursFiche(form.c);
              d.touches = Array.from(form.touches);
            }
            enCours.envois[c] = { p: p, valeurs: d.valeurs || p.valeurs };
            return d;
          })
        });
      };
      if (geste === 'refuse') { envoyer(); } else { apresEcriture(envoyer); }
    }
    // La fiche d'une acceptation dont la création a échoué : la saisie du détail s'il est ouvert
    // sur elle, sinon les valeurs envoyées à l'acceptation.
    function recreer(p) {
      var x = echouees.filter(function (e) { return e.p === p; })[0];
      if (enCours || !x || bloquantsDe(p).length > 0) { return; }
      apresEcriture(function () {
        if (enCours) { return; }
        avis = null;
        enCours = { geste: 'recree', cles: [p.cle], avant: [], titres: [titreCourt(p)] };
        var valeurs = form && form.cle === p.cle ? champsDoc.valeursFiche(form.c) : x.valeurs;
        api.postMessage({ type: SZH.MSG.PROP_RECREER, cle: p.cle, valeurs: valeurs });
      });
    }
    function annuler() {
      if (!annulable || enCours) { return; }
      if (annulable.defaire) {
        annulable.defaire();
        courant = annulable.cles[0] || courant;
        poserAnnulable(null);
        toutRendre(true);
        return;
      }
      var cles = annulable.cles;
      var envoyer = function () {
        if (enCours) { return; }
        enCours = { geste: 'annule', cles: cles, avant: [], titres: [] };
        api.postMessage({ type: SZH.MSG.PROP_ANNULER, cles: cles });
      };
      // Défaire une acceptation retire une fiche, et recharge le numéro.
      if (annulable.geste === 'refuse') { envoyer(); } else { apresEcriture(envoyer); }
    }
    function reprendre(cle) {
      if (enCours) { return; }
      enCours = { geste: 'reprise', cles: [cle], avant: [], titres: [titreCourt(trouver(cle))] };
      api.postMessage({ type: SZH.MSG.PROP_ANNULER, cles: [cle] });
    }
    // La marque de l'autre revue retirée depuis la ligne ; le bandeau permet de la remettre.
    function retirerAussi(cle) {
      aussi[cle] = false;
      poserAnnulable({ cles: [cle], texte: remplir('propAussiRetire', [titreCourt(trouver(cle)), donnees.revueAutre]),
        defaire: function () { aussi[cle] = true; } });
      courant = cle;
      toutRendre(false);
      focaliserCourant();
    }
    function libelleMotif(m) { return m && MOTIFS[m] ? enTexte(TXT[MOTIFS[m]]) : ''; }
    // Le texte du bandeau, d'après ce que l'hôte a fait.
    function texteResultat(e, r) {
      var n = r.faites.length;
      var t1 = n === 1 ? e.titres[e.cles.indexOf(r.faites[0])] || '' : '';
      var t;
      if (r.geste === 'accepte') { t = n === 1 ? remplir('propBAccepte', [t1]) : nombre('propBLotAccepte', n, [n]); }
      else if (r.geste === 'garde') { t = n === 1 ? remplir('propBGarde', [t1]) : nombre('propBLotGarde', n, [n]); }
      else if (r.geste === 'refuse') {
        var m = libelleMotif(r.motif);
        t = n === 1 ? (m ? remplir('propBRefuseMotif', [t1, m]) : remplir('propBRefuse', [t1]))
          : (m ? nombre('propBLotRefuseMotif', n, [n, m]) : nombre('propBLotRefuse', n, [n]));
      } else if (e.geste === 'reprise') { t = remplir('propBReprise', [e.titres[0]]); }
      else if (r.geste === 'recree') { t = remplir('propBRecree', [t1]); }
      else { t = remplir('propBAnnule', [n]); }
      if (r.geste === 'accepte' || r.geste === 'garde') {
        var nAussi = r.faites.filter(function (c) { return aussi[c]; }).length;
        if (nAussi > 0) { t += ' ' + (n === 1 ? remplir('propBAussi', [donnees.revueAutre]) : nombre('propBLotAussi', nAussi, [nAussi, donnees.revueAutre])); }
        var nb = (r.ignorees || []).filter(function (x) { return x.raison === 'a-verifier'; }).length;
        if (nb > 0) { t += ' ' + nombre('propBIgnorees', nb, [nb]); }
      }
      return t;
    }
    // Le résultat d'un geste : le bandeau, puis la suivante de l'onglet.
    function appliquerResultat(r) {
      var e = enCours || { geste: r.geste, cles: r.faites || [], avant: [], titres: [] };
      enCours = null;
      if (r.refus === 'verrou') { avertir(TXT.propVerrou); return; }
      if (r.geste === 'recree') {
        echouees = echouees.filter(function (x) { return r.faites.indexOf(x.p.cle) === -1; });
      }
      var autres = (r.echecs || []).filter(function (x) {
        if (x.raison !== 'fiche-introuvable' || !e.envois || !e.envois[x.cle]) { return true; }
        // Une acceptée, déjà décidée, ne se représente pas : seule sa fiche reste à créer.
        var envoi = e.envois[x.cle];
        echouees = echouees.filter(function (y) { return y.p.cle !== x.cle; });
        echouees.push({ p: Object.assign({}, envoi.p, { bloquants: [] }), valeurs: envoi.valeurs });
        return false;
      });
      if (autres.length > 0) {
        avertir(nombre('propBEchec', autres.length, [autres.length, autres.map(function (x) { return x.raison; }).join(', ')]));
      }
      r.faites.forEach(function (c) { selection.delete(c); });
      if (r.faites.length === 0) { return; }
      var defaisable = r.geste !== 'annule' && r.geste !== 'recree';
      poserAnnulable({ cles: defaisable ? r.faites.slice() : [], geste: r.geste, texte: texteResultat(e, r) });
      // L'autre langue, déjà dans un numéro, n'a pas été retirée : on le dit.
      if (r.autresGardees > 0) { avertir(TXT.propAutreGardee); }
      if (r.geste === 'annule') {
        // Défaire ramène la première proposition sous les yeux, dans son onglet.
        var p = trouver(r.faites[0]);
        if (p && enAttente(p)) { onglet = p.type; courant = p.cle; if (detailCle) { detailCle = p.cle; } }
        return;
      }
      // La suivante : la première en attente après la dernière décidée, sinon avant.
      var restantes = {};
      attente().forEach(function (p) { restantes[p.cle] = true; });
      var der = e.avant.indexOf(r.faites[r.faites.length - 1]);
      var suivante = null;
      for (var i = der + 1; i < e.avant.length && !suivante; i++) { if (restantes[e.avant[i]]) { suivante = e.avant[i]; } }
      for (var j = der - 1; j >= 0 && !suivante; j--) { if (restantes[e.avant[j]]) { suivante = e.avant[j]; } }
      if (der !== -1) { courant = suivante; }
      if (e.depuisDetail) { detailCle = suivante; }
    }

    // ---- Détail (coque) ------------------------------------------------------------------------
    function ouvrirDetail(cle, avecFocus) {
      if (detailCle === cle) { if (avecFocus) { focaliserDetail(); } return; }
      detailCle = cle;
      rendreDetail();
      if (avecFocus) { focaliserDetail(); }
      if (zone.defile) {
        Array.prototype.forEach.call(zone.defile.querySelectorAll('tr'), function (tr) {
          if (tr.dataset.cle !== undefined) { tr.setAttribute('aria-selected', tr.dataset.cle === cle ? 'true' : 'false'); }
        });
      }
      disposer();
    }
    // Un doublon probable : le focus va sur le geste qui le règle ; sinon le premier geste possible.
    function focaliserDetail() {
      if (!zone.detail) { return; }
      var cible = zone.detail.querySelector('.prop-doublon-refuser')
        || zone.detail.querySelector('.prop-detail-accepter:not(:disabled)')
        || (zone.bAccepter && !zone.bAccepter.disabled ? zone.bAccepter : null);
      if (cible) { cible.focus(); } else { zone.detail.focus(); }
    }
    function fermerDetail() {
      detailCle = null;
      form = null;
      pertinenceAuto = false;
      rendreDetail();
      rendreTable();
      focaliserCourant();
    }
    function rendreDetail() {
      if (!zone.split) { return; }
      if (zone.detail) { zone.detail.remove(); zone.detail = null; }
      var p = detailCle ? trouver(detailCle) : null;
      if (detailCle && !p) { detailCle = null; }
      var plein = detailPlein();
      zone.split.classList.toggle('prop-split--detail', !!detailCle && !plein);
      zone.split.classList.toggle('prop-split--plein', plein);
      zone.liste.hidden = plein;
      if (zone.filtres) { zone.filtres.hidden = plein; zone.moissons.hidden = plein; }
      if (zone.garde) { zone.garde.hidden = plein || !zone.garde.firstChild; }
      if (zone.bandeau) { zone.bandeau.hidden = plein || !zone.bandeau.firstChild; }
      if (!detailCle) { return; }
      var att = attenteOnglet();
      var a = poser(zone.split, 'aside', 'szh-carte prop-detail');
      a.tabIndex = -1;
      zone.detail = a;
      var tete = poser(a, 'div', 'szh-tete');
      var pos = att.map(function (x) { return x.cle; }).indexOf(p.cle);
      if (plein) { tete.appendChild(SZH.bouton(TXT.propListe, fermerDetail, 'prop-nav prop-nav-liste', TXT.propListeTip)); }
      var h = poser(tete, 'h3', 'szh-tete-nom', titreDe(p));
      h.id = 'prop-detail-titre';
      a.setAttribute('aria-labelledby', 'prop-detail-titre');
      if (plein) {
        var suiv = pos !== -1 && pos + 1 < att.length ? att[pos + 1].cle : null;
        var bs = SZH.bouton('', function () { definirCourant(suiv, false); ouvrirDetail(suiv, true); }, 'prop-nav prop-nav-suivante', TXT.propSuivanteTip);
        poser(bs, 'span', null, TXT.propSuivante);
        bs.appendChild(icone('fleche'));
        bs.disabled = !suiv;
        tete.appendChild(bs);
      } else {
        tete.appendChild(SZH.boutonIcone('croix', TXT.propFermer, fermerDetail, 'prop-fermer'));
      }
      var cps = poser(a, 'div', 'prop-detail-corps');

      // En haut : source, date de récolte, position, lien.
      var meta = poser(cps, 'div', 'prop-detail-meta');
      poser(meta, 'span', null, p.source + ' · ' + remplir('propRecolteeLe', [dateCourte(p.recolte)]));
      if (pos !== -1) { poser(meta, 'span', 'prop-position', remplir('propPosition', [pos + 1, att.length])); }
      var lien = poser(meta, 'button', 'prop-lien', TXT.propOuvrirSource);
      lien.type = 'button';
      lien.title = remplir('propOuvrirSourceTip', [(p.valeurs && p.valeurs.lien) || p.source]);
      lien.addEventListener('click', function () { api.postMessage({ type: SZH.MSG.PROP_OUVRIR_SOURCE, cle: p.cle }); });
      if (estB(p) && enAttente(p)) { cps.appendChild(SZH.notif('attention', remplir('propResumeB', [raisonsB(p).join(', ')]))); }

      if (estEchouee(p)) { cps.appendChild(SZH.notif('attention', remplir('propIntrouvable', [titreDe(p)]))); }

      // Les gestes restent collés en haut du détail quand on descend.
      var vivante = enAttente(p) || estEchouee(p);
      zone.colle = null;
      if (vivante) {
        zone.colle = poser(cps, 'div', 'prop-colle');
        rendreGestes(p);
      }

      if (p.doublon) { rendreDoublon(cps, p); }
      rendrePourquoi(cps, p);
      // Les champs du contrat, préremplis : on corrige, puis on accepte.
      if (vivante) { cps.appendChild(formulaireDe(p).element); }
      rendreDoutes(cps, p);
      if (!vivante) { valeursEnLecture(cps, p); }
      // Les valeurs lues à la source (brut), et l'identité de la proposition.
      var det = poser(cps, 'details', 'prop-brut-bloc');
      det.open = true;
      poser(det, 'summary', null, TXT.propBrut);
      var dl = poser(det, 'dl', 'prop-dl');
      // Une clé qui nomme un champ du contrat se lit par son libellé ; les autres restent telles quelles.
      // Les titres officiels d'une proposition multilingue, chacun dans sa langue.
      var titres = Object.keys(p.titres || {}).map(function (l) { return [remplir('propTitreOfficiel', [l]), p.titres[l], l]; });
      Object.keys(p.brut || {}).map(function (k) { var c = champDe(p.type, k); return [c ? c.libelle : k, p.brut[k]]; })
        .concat(titres, [[TXT.propBrutCle, p.cle]])
        .forEach(function (x) {
          poser(dl, 'dt', null, x[0]);
          var dd = poser(dl, 'dd', null, x[1] === '' || x[1] === null || x[1] === undefined ? '–' : typeof x[1] === 'object' ? JSON.stringify(x[1]) : String(x[1]));
          if (x[2] && x[2] !== donnees.langue) { dd.setAttribute('lang', x[2]); }
        });
    }
    // Une refusée se lit sans se corriger.
    function valeursEnLecture(cps, p) {
      var champs = typeDe(p.type).champs.filter(function (c) {
        var v = p.valeurs[c.cle];
        return c.saisie !== 'derive' && v !== undefined && v !== null && String(v) !== '';
      });
      if (champs.length === 0) { return; }
      var sv = poser(cps, 'section', 'prop-valeurs');
      poser(sv, 'h4', 'prop-sous-titre', TXT.propValeurs);
      var dlv = poser(sv, 'dl', 'prop-dl');
      champs.forEach(function (c) {
        poser(dlv, 'dt', null, c.libelle);
        poser(dlv, 'dd', null, valeurLisible(p.type, c, p.valeurs[c.cle]));
      });
    }
    // Les gestes du détail, refaits à chaque réponse de l'hôte sur ce qui bloque.
    function rendreGestes(p) {
      var colle = zone.colle;
      if (!colle) { return; }
      colle.textContent = '';
      var g = poser(colle, 'div', 'prop-gestes');
      var bloque = nomsBloquants(p);
      zone.bAccepter = zone.bGarder = null;
      if (estEchouee(p)) {
        var br = SZH.bouton(TXT.propRecreer, function () { recreer(p); }, 'szh-bouton--principal prop-recreer', TXT.propRecreerTip);
        br.disabled = !!bloque;
        if (bloque) { br.title = remplir('propBloque', [bloque]); }
        g.appendChild(br);
      } else {
        zone.bAccepter = SZH.bouton(TXT.propAccepter, function () { agir('accepte', [p.cle]); }, 'szh-bouton--principal prop-detail-accepter', TXT.propAccepterTip);
        zone.bGarder = SZH.bouton(TXT.propGarder, function () { agir('garde', [p.cle]); }, 'prop-detail-garder', TXT.propGarderTip);
        [zone.bAccepter, zone.bGarder].forEach(function (b) {
          b.disabled = !!bloque;
          if (bloque) { b.title = remplir('propBloque', [bloque]); }
        });
        g.appendChild(zone.bAccepter);
        g.appendChild(zone.bGarder);
        g.appendChild(boutonRefus(function () { agir('refuse', [p.cle]); }, function (m) { agir('refuse', [p.cle], m); }));
      }
      if (bloque) {
        var bl = poser(colle, 'p', 'prop-bloque');
        bl.appendChild(icone('attention'));
        poser(bl, 'span', null, remplir('propBloque', [bloque]));
      }
      if (!enAttente(p)) { return; }
      var manque = (p.raisons || []).filter(function (x) { return x.code === 'requis-vide' && !enDoute(p, x.champ); })
        .map(function (x) { return libelleChamp(p.type, x.champ); });
      if (manque.length > 0) {
        var mq = poser(colle, 'p', 'prop-bloque prop-manque');
        mq.appendChild(icone('info'));
        poser(mq, 'span', null, remplir('propManque', [manque.join(', ')]));
      }
      if (donnees.revueAutre) {
        var lc = poser(colle, 'label', 'prop-case-aussi');
        lc.title = remplir('propProposerAussiTip', [donnees.revueAutre]);
        var cc = poser(lc, 'input');
        cc.type = 'checkbox';
        cc.checked = !!aussi[p.cle];
        cc.addEventListener('change', function () { aussi[p.cle] = cc.checked; rendreTable(); });
        poser(lc, 'span', null, remplir('propProposerAussi', [donnees.revueAutre]));
      }
    }

    // ---- Le formulaire du détail -----------------------------------------------------------
    function typeDoc(type) {
      var types = (opts.types && opts.types()) || [];
      return types.filter(function (t) { return t.valeur === type; })[0] || null;
    }
    // Les dates passent par l'aperçu de l'hôte (lib/date-apercu.js) : le bouton montre la forme
    // imprimée, la valeur appliquée reste l'ISO.
    var SAISIES_DATE = { date: true, date_partielle: true };
    function libelleSuggestion(cfg, valeur) {
      if (form && form.formes[cfg.cle]) { return form.formes[cfg.cle]; }
      if (cfg.saisie === 'liste') {
        var o = (cfg.options || []).filter(function (x) { return x.valeur === valeur; })[0];
        return o ? o.libelle : valeur;
      }
      return valeur;
    }
    function formulaireDe(p) {
      if (form && form.cle === p.cle) { return form; }
      var t = typeDoc(p.type);
      // Une couverture se dépose sur la fiche, une fois acceptée : pas ici.
      var champs = t ? t.champs.filter(function (x) { return x.saisie !== 'fichier'; }) : [];
      var c = {
        famille: 'fiche', id: p.cle, type: p.type, index: 'p' + (++nForm), ctl: {}, champs: champs,
        avecImage: false, image: '', apercu: null, persistee: false, touchee: false, enregistree: null
      };
      var el = document.createElement('section');
      el.className = 'prop-formulaire';
      form = { cle: p.cle, c: c, element: el, touches: new Set(), bloquants: (p.bloquants || []).slice(),
        formes: {}, jeton: 0, dernier: 0, minuteur: null };
      poser(el, 'h4', 'prop-sous-titre', TXT.propChamps);
      var grille = poser(el, 'div', 'prop-champs');
      var v = p.valeurs || {};
      champs.forEach(function (cfg) {
        var conteneur = champsDoc.champ(grille, c, cfg, v);
        conteneur.dataset.champ = cfg.cle;
        conteneur.classList.add('prop-champ');
        marquerDoutes(p, cfg, conteneur);
      });
      champsDoc.majConditionnels(c);
      champsDoc.majDerives(c);
      if (t && t.champs.some(function (x) { return x.saisie === 'fichier'; })) {
        var lc = poser(el, 'p', 'prop-bloque prop-couverture');
        lc.appendChild(icone('info'));
        poser(lc, 'span', null, TXT.propCouverture);
      }
      // À la sortie d'un champ, l'hôte revoit aussitôt ce qui bloque.
      el.addEventListener('focusout', function () { verifierSaisie(); });
      return form;
    }
    // Un champ en doute : bordure, icône, le doute, la valeur lue à côté, et la recommandation.
    function marquerDoutes(p, cfg, conteneur) {
      var doutes = (p.doutes || []).filter(function (d) { return d.champ === cfg.cle; });
      if (doutes.length === 0) { return; }
      conteneur.classList.add('prop-champ--doute');
      var etiquette = conteneur.firstChild;
      if (etiquette) { etiquette.insertBefore(icone('attention'), etiquette.firstChild); }
      var brut = Object.prototype.hasOwnProperty.call(p.brut || {}, cfg.cle) ? p.brut[cfg.cle] : null;
      doutes.forEach(function (d) {
        var l = poser(conteneur, 'div', 'prop-champ-doute');
        poser(l, 'span', 'prop-champ-doute-code', CODES_DOUTE[d.code] ? TXT[CODES_DOUTE[d.code]] : d.code);
        if (d.detail) { poser(l, 'span', 'prop-doute', d.detail); }
        if (d.code === 'champ-introuvable') { poser(l, 'span', 'prop-brut', TXT.propDouteAbsent); }
        else if (brut !== null) { poser(l, 'span', 'prop-brut', remplir('propDouteLu', [String(brut)])); }
        if (!d.suggestion) { return; }
        var sug = String(d.suggestion);
        var b = SZH.bouton(remplir('propAppliquer', [libelleSuggestion(cfg, sug)]), function () { appliquer(cfg, sug); },
          'prop-appliquer', TXT.propAppliquerTip);
        b.dataset.champ = cfg.cle;
        l.appendChild(b);
        if (SAISIES_DATE[cfg.saisie]) { demanderForme(cfg, sug, b); }
      });
    }
    // Le bouton n'est peut-être pas encore dans le détail quand la réponse arrive : on le garde.
    function demanderForme(cfg, valeur, bouton) {
      var f0 = form;
      SZH.ficheDoc.former(api, cfg.saisie, [valeur], function (msg) {
        if (form !== f0 || !msg.ok || msg.erreur || !msg.forme) { return; }
        form.formes[cfg.cle] = msg.forme;
        bouton.textContent = remplir('propAppliquer', [msg.forme]);
        if (!zone.detail) { return; }
        Array.prototype.forEach.call(zone.detail.querySelectorAll('.prop-appliquer'), function (b) {
          if (b.dataset.champ === cfg.cle) { b.textContent = remplir('propAppliquer', [msg.forme]); }
        });
        Array.prototype.forEach.call(zone.detail.querySelectorAll('.prop-suggestion'), function (x) {
          if (x.dataset.champ === cfg.cle) { x.textContent = remplir('propDouteSuggestion', [msg.forme]); }
        });
      });
    }
    // Appliquer : la valeur recommandée dans le champ, comme une saisie.
    function appliquer(cfg, valeur) {
      if (!form) { return; }
      var i = form.c.ctl[cfg.cle];
      if (!i || typeof i.value !== 'string') { return; }
      if (cfg.saisie === 'liste') { champsDoc.poserOptions(i, cfg.options || [], valeur); }
      else if (cfg.saisie === 'date') { champsDoc.poserValeurDate(i, valeur); }
      else { i.value = valeur; }
      i.dispatchEvent(new Event(cfg.saisie === 'liste' ? 'change' : 'input'));
      i.dispatchEvent(new Event('blur'));
      verifierSaisie();
    }
    // Un champ touché ne bloque plus par son doute ; l'hôte le redit, au plus une fois par
    // intervalle pendant la frappe.
    function toucher(c, cle) {
      if (!form || form.c !== c) { return; }
      form.touches.add(cle);
      var ecoule = Date.now() - form.dernier;
      if (ecoule >= INTERVALLE_VERIFIER) { verifierSaisie(); return; }
      if (!form.minuteur) {
        var f0 = form;
        form.minuteur = setTimeout(function () { f0.minuteur = null; if (form === f0) { verifierSaisie(); } }, INTERVALLE_VERIFIER - ecoule);
      }
    }
    function verifierSaisie() {
      if (!form) { return; }
      clearTimeout(form.minuteur);
      form.minuteur = null;
      form.dernier = Date.now();
      form.jeton += 1;
      api.postMessage({ type: SZH.MSG.PROP_VERIFIER, cle: form.cle, jeton: form.jeton,
        valeurs: champsDoc.valeursFiche(form.c), touches: Array.from(form.touches) });
    }
    function recevoirVerification(msg) {
      if (!form || msg.cle !== form.cle || msg.jeton !== form.jeton) { return; }
      form.bloquants = Array.isArray(msg.bloquants) ? msg.bloquants : [];
      var p = trouver(form.cle);
      if (p && detailCle === p.cle) { rendreGestes(p); }
    }
    function valeurLisible(type, c, v) {
      if (Array.isArray(v)) {
        return v.map(function (x) { return typeof x === 'object' ? JSON.stringify(x) : libelleJeton(type, c.cle, x); }).join(', ');
      }
      if (c.libelles) { return libelleJeton(type, c.cle, v); }
      if (c.saisie === 'date') { return dateCourte(v); }
      return String(v);
    }
    function rendreDoutes(parent, p) {
      if (!p.doutes || p.doutes.length === 0) { return; }
      var s = poser(parent, 'section', 'prop-doutes');
      poser(s, 'h4', 'prop-sous-titre', TXT.propDoutes);
      p.doutes.forEach(function (d) {
        var b = poser(s, 'div', 'prop-doute-bloc');
        var t = poser(b, 'p', 'prop-doute-titre');
        t.appendChild(icone('attention'));
        poser(t, 'span', null, libelleChamp(p.type, d.champ) + ' · ' + (CODES_DOUTE[d.code] ? TXT[CODES_DOUTE[d.code]] : d.code));
        if (d.detail) { poser(b, 'p', 'prop-doute', d.detail); }
        var brut = Object.prototype.hasOwnProperty.call(p.brut || {}, d.champ) ? p.brut[d.champ] : null;
        if (d.code === 'champ-introuvable') { poser(b, 'p', 'prop-brut', TXT.propDouteAbsent); }
        else if (brut !== null) { poser(b, 'p', 'prop-brut', remplir('propDouteLu', [String(brut)])); }
        if (d.suggestion) {
          var forme = form && form.cle === p.cle && form.formes[d.champ];
          var ps = poser(b, 'p', 'prop-suggestion', remplir('propDouteSuggestion', [forme || String(d.suggestion)]));
          ps.dataset.champ = d.champ;
        }
      });
    }
    // « Pourquoi » : la note et le cran, la catégorie en clair, les termes par rôle avec leur
    // emplacement. Pour un type qui a des crans seulement.
    function arrondi(x) { return String(Math.round(x * 10) / 10); }
    function rendrePourquoi(parent, p) {
      var pe = p.pertinence;
      if (!finesseDe(p.type) || !pe) { return; }
      var s = poser(parent, 'section', 'prop-pourquoi');
      var h = poser(s, 'h4', 'prop-sous-titre', TXT.propPourquoi);
      h.id = 'prop-pourquoi-titre';
      s.setAttribute('aria-labelledby', h.id);
      poser(s, 'p', 'prop-pourquoi-note', typeof pe.score === 'number'
        ? remplir('propPourquoiNote', [arrondi(pe.score), p.cranMax || NB_CRANS]) : TXT.propPourquoiSansNote);
      if (pe.categorie) {
        poser(s, 'p', 'prop-pourquoi-categorie', remplir('propPourquoiCategorie',
          [(CATEGORIES[pe.categorie] && TXT[CATEGORIES[pe.categorie]]) || TXT.propCategorieAutre]));
      }
      var termes = Array.isArray(pe.termes) ? pe.termes.filter(function (x) { return x && x.terme; }) : [];
      // Un terme s'ouvre sur ses gestes quand le moissonneur a sa vue Termes.
      var cliquable = !!termesDonnes()[p.dossier || p.moissonneur] && enAttente(p);
      var rangOu = { titre: 0, texte: 1, extrait: 2 };
      var roles = Object.keys(ROLES);
      termes.forEach(function (x) { if (roles.indexOf(x.role) === -1) { roles.push(x.role); } });
      roles.forEach(function (role) {
        var ts = termes.filter(function (x) { return x.role === role; })
          .sort(function (a, b) { return (rangOu[a.ou] === undefined ? 9 : rangOu[a.ou]) - (rangOu[b.ou] === undefined ? 9 : rangOu[b.ou]); });
        if (ts.length === 0) { return; }
        var l = poser(s, 'p', 'prop-pourquoi-termes');
        poser(l, 'span', 'prop-pourquoi-role', ROLES[role] ? TXT[ROLES[role]] : String(role));
        ts.forEach(function (x) {
          var t = cliquable ? poser(l, 'button', 'prop-pourquoi-terme prop-pourquoi-puce') : poser(l, 'span', 'prop-pourquoi-terme');
          if (cliquable) { brancherTermePourquoi(t, p, x); }
          var mot = poser(t, 'span', 'prop-pourquoi-mot', String(x.terme));
          // Entre parenthèses : la langue du terme si elle n'est pas celle du numéro, puis l'emplacement.
          var precisions = [];
          if (x.langue && x.langue !== donnees.langue) { mot.setAttribute('lang', x.langue); precisions.push(String(x.langue)); }
          if (x.ou) { precisions.push(OU[x.ou] ? TXT[OU[x.ou]] : String(x.ou)); }
          if (precisions.length > 0) { poser(t, 'span', 'prop-pourquoi-ou', ' (' + precisions.join(', ') + ')'); }
        });
      });
      if (cliquable && termes.length > 0) { poser(s, 'p', 'prop-pourquoi-aide', TXT.propTermesPourquoiAide); }
    }
    function rendreDoublon(parent, p) {
      var f = p.doublonFiche;
      var b = poser(parent, 'section', 'prop-doublon');
      var h = poser(b, 'h4', 'prop-doublon-titre');
      h.appendChild(icone('attention'));
      poser(h, 'span', null, TXT.propDoublonTitre);
      var ou = (f ? (f.numero || TXT.propDoublonSansNumero) + ', ' : '') + p.doublon.slug;
      poser(b, 'p', null, f ? remplir('propDoublonTexte', [ou]) : remplir('propDoublonIntrouvable', [p.doublon.slug]));
      if (enAttente(p)) {
        var gb = poser(b, 'div', 'prop-gestes');
        gb.appendChild(SZH.bouton(TXT.propDoublonRefuser, function () { agir('refuse', [p.cle], 'doublon'); },
          'prop-doublon-refuser', TXT.propDoublonRefuserTip));
      }
      if (!f) { return; }
      var t = poser(b, 'table', 'prop-comparaison');
      var tr0 = poser(poser(t, 'thead'), 'tr');
      [TXT.propDoublonChamp, TXT.propDoublonProposition, TXT.propDoublonFiche].forEach(function (x) {
        poser(tr0, 'th', null, x).setAttribute('scope', 'col');
      });
      var tb = poser(t, 'tbody');
      typeDe(p.type).champs.forEach(function (c) {
        if (['derive', 'structure', 'texte_long', 'fichier', 'url'].indexOf(c.saisie) !== -1) { return; }
        var va = p.valeurs[c.cle], ve = f.valeurs[c.cle];
        var a = va === undefined || va === null ? '' : String(va), e = ve === undefined || ve === null ? '' : String(ve);
        if (!a && !e) { return; }
        var diff = a !== e;
        var tr = poser(tb, 'tr', diff ? 'prop-differe' : '');
        var th = poser(tr, 'th', null, c.libelle);
        th.setAttribute('scope', 'row');
        if (diff) { poser(th, 'div', 'prop-marque-differe', TXT.propDoublonDiffere); }
        poser(tr, 'td', null, a ? valeurLisible(p.type, c, va) : '–');
        poser(tr, 'td', null, e ? valeurLisible(p.type, c, ve) : '–');
      });
    }

    // ---- Termes : ce que chaque terme ramène, et les demandes sur le lexique ----------------
    // Les comptes viennent de l'hôte (lib/propositions.js, comptesTermes) ; la page trie, cherche
    // et filtre, puis envoie un filtre ou une demande, que l'hôte valide encore.
    var ROLES_ORDRE = ['ancrage', 'ambigu', 'ecole', 'theme'];
    var ST = {
      'en-attente': 'propStEnAttente', applique: 'propStApplique', 'applique-partiel': 'propStAppliquePartiel',
      'refuse-perte': 'propStRefusePerte', 'refuse-bruit': 'propStRefuseBruit', doublon: 'propStDoublon',
      'a-confirmer': 'propStAConfirmer', 'retrait-en-attente': 'propStRetraitEnAttente'
    };
    var TON_STATUT = { applique: 'ok', 'applique-partiel': 'ok', 'refuse-perte': 'attention', 'refuse-bruit': 'attention', 'a-confirmer': 'attention' };
    var SENS = { ajout: 'propTermesSensAjout', exclusion: 'propTermesSensExclusion', retrait: 'propTermesSensRetrait' };
    var COLS_TERMES = [
      { id: 'terme', lib: 'propTermesColTerme' }, { id: 'langue', lib: 'propTermesColLangue' },
      { id: 'role', lib: 'propTermesColRole' },
      { id: 'ramene', lib: 'propTermesColRamene', num: true, tip: 'propTermesTipRamene' },
      { id: 'seul', lib: 'propTermesColSeul', num: true, tip: 'propTermesTipSeul' },
      { id: 'ref', lib: 'propTermesColRef', num: true, tip: 'propTermesTipRef' },
      { id: 'refSeul', lib: 'propTermesColRefSeul', num: true, tip: 'propTermesTipRefSeul' },
      { id: 'demande', lib: 'propTermesColDemande' }, { id: 'geste', lib: 'propTermesColGeste', fixe: true }
    ];
    function termesDonnes() { return (donnees && donnees.termes) || {}; }
    function moissonneursTermes() { return Object.keys(termesDonnes()).sort(); }
    function aTermes() { return moissonneursTermes().length > 0; }
    function demandesDe(m) { return ((donnees && donnees.demandes) || {})[m] || []; }
    function memeTerme(a, b) {
      return String(a).normalize('NFC').trim().toLocaleLowerCase() === String(b).normalize('NFC').trim().toLocaleLowerCase();
    }
    // La plus récente demande sur ce terme dans cette langue (l'hôte les range de la plus récente).
    function derniereDemande(m, terme, langue) {
      return demandesDe(m).filter(function (d) { return d.langue === langue && memeTerme(d.terme, terme); })[0] || null;
    }
    function exclusionEnAttente(m, terme, langue) {
      return demandesDe(m).some(function (d) {
        return d.sens === 'exclusion' && d.statut === 'en-attente' && d.langue === langue && memeTerme(d.terme, terme);
      });
    }
    function libelleRole(r) { return ROLES[r] ? TXT[ROLES[r]] : String(r || ''); }
    function libelleStatut(s) { return ST[s] ? TXT[ST[s]] : String(s || ''); }
    function libelleSens(s) { return SENS[s] ? TXT[SENS[s]] : String(s || ''); }
    function tiret(v) { return v === null || v === undefined ? '–' : String(v); }
    function ligneDuTerme(m, x) {
      var t = termesDonnes()[m];
      var l = t ? t.termes.filter(function (y) { return y.terme === x.terme && y.langue === x.langue && y.role === x.role; })[0] : null;
      return l || { terme: x.terme, langue: x.langue, role: x.role, ramene: 0, seul: 0, approx: false, ref: null, refSeul: null };
    }
    // Le cran regardé pour les types que ce moissonneur alimente.
    function cransTermes(m) {
      var t = termesDonnes()[m] || {}, vus = [];
      Object.keys(t.types || {}).sort().forEach(function (ty) { if (vus.indexOf(t.types[ty]) === -1) { vus.push(t.types[ty]); } });
      return vus.join('/');
    }
    // L'onglet où voir les propositions d'un terme : le type de ce moissonneur qui en a le plus.
    function typeDuMoissonneur(m) {
      var t = termesDonnes()[m] || {}, meilleur = null, n = -1;
      Object.keys(t.types || {}).sort().forEach(function (ty) {
        var k = attente().filter(function (p) { return p.type === ty && (p.dossier || p.moissonneur) === m; }).length;
        if (k > n) { n = k; meilleur = ty; }
      });
      return meilleur;
    }

    // Le filtre sur un terme : l'hôte rend les cles qui le portent ; l'onglet du type s'ouvre.
    function filtrerSurTerme(typeFiche, x) {
      fermerMenu(false);
      if (!typeFiche) { return; }
      api.postMessage({ type: SZH.MSG.PROP_FILTRE_TERME, typeFiche: typeFiche, terme: x.terme, role: x.role, langue: x.langue });
      onglet = typeFiche;
      selection.clear();
      dernierCoche = null;
      detailCle = null;
      courant = null;
      toutRendre(false);
    }
    function retirerFiltre() {
      var f = donnees && donnees.filtre;
      if (f) { api.postMessage({ type: SZH.MSG.PROP_FILTRE_TERME, typeFiche: f.typeFiche, terme: '' }); }
    }
    function rendreBandeauFiltre() {
      var z = zone.bandeau;
      if (!z) { return; }
      z.textContent = '';
      var f = filtreTermeActif();
      if (f) {
        var att = attente().filter(function (p) { return p.type === onglet && f.cles.indexOf(p.cle) !== -1; });
        var vis = att.filter(visible).length;
        var texte = remplir('propTermesFiltre', [f.terme, libelleRole(f.role), vis, cranVu(onglet), att.length - vis]);
        var n = SZH.notif('info', [document.createTextNode(texte + ' · ')]);
        n.classList.add('prop-termes-bandeau');
        n.querySelector('span').appendChild(SZH.bouton(TXT.propTermesRetirerFiltre, retirerFiltre, 'prop-lien prop-termes-retirer-filtre'));
        z.appendChild(n);
      }
      z.hidden = !z.firstChild;
    }

    // Une demande part ; sa réponse revient avec les données (demandeGeste).
    function demander(m, terme, langue, sens, source) {
      attenteDemande = { source: source };
      api.postMessage({ type: SZH.MSG.PROP_DEMANDE_ECRIRE, moissonneur: m, terme: terme, langue: langue, sens: sens });
    }
    function poserAvisTermes(a) {
      if (termesEtat.avis && termesEtat.avis.minuteur) { clearTimeout(termesEtat.avis.minuteur); }
      termesEtat.avis = a;
      if (a) {
        a.minuteur = setTimeout(function () {
          termesEtat.avis = null;
          var z = panel.querySelector('.prop-termes-avis');
          if (z) { z.textContent = ''; }
          rendrePied();
        }, DUREE_BANDEAU);
      }
    }
    function texteRefusDemande(g) {
      if (g.raison === 'terme-vide') { return TXT.propTermesErrVide; }
      if (g.raison === 'terme-long') { return remplir('propTermesErrLong', [Array.from(String(g.terme).trim()).length]); }
      if (g.raison === 'terme-caractere') { return remplir('propTermesErrCaractere', [g.caractere || '']); }
      return remplir('propTermesRefus', [g.raison || '']);
    }
    function recevoirDemande(g) {
      var source = attenteDemande ? attenteDemande.source : '';
      attenteDemande = null;
      if (g.ok) {
        poserAvisTermes({ ton: 'ok', texte: remplir('propTermesEcrite', [libelleSens(g.sens), g.terme, g.langue]) });
        if (source === 'form') { termesEtat.form = false; formTermes = null; }
        return;
      }
      if (source === 'form' && formTermes) { formTermes.erreurHote = texteRefusDemande(g); return; }
      poserAvisTermes({ ton: 'attention', texte: texteRefusDemande(g) });
    }

    // « Ne plus proposer » : la mesure du terme, l'avertissement s'il ferait perdre des fiches de
    // référence, puis la demande. Rien ne change avant la prochaine passe du moissonneur.
    function ouvrirNePlus(source, m, x) {
      if (menu && menu.source === source) { fermerMenu(true); return; }
      fermerMenu(false);
      var l = ligneDuTerme(m, x), t = termesDonnes()[m] || {};
      menu = document.createElement('div');
      menu.className = 'szh-sugg prop-menu prop-termes-panneau';
      menu.setAttribute('role', 'dialog');
      menu.setAttribute('aria-label', remplir('propTermesNePlusLabel', [x.terme]));
      menu.source = source;
      poser(menu, 'p', 'prop-termes-panneau-titre', remplir('propTermesNePlusLabel', [x.terme]));
      poser(menu, 'p', 'prop-termes-mesure', remplir('propTermesMesure', [(l.approx ? '≈ ' : '') + l.seul, tiret(l.ref), tiret(l.refSeul)]));
      poser(menu, 'p', 'prop-termes-aide', remplir('propTermesMesureAu', [cransTermes(m), tiret(t.rappelSur)]));
      if (l.refSeul > 0) {
        var a = SZH.notif('attention', nombre('propTermesAvertRefSeul', l.refSeul, [l.refSeul]));
        a.classList.add('prop-termes-avert');
        menu.appendChild(a);
      }
      poser(menu, 'p', 'prop-termes-aide', TXT.propTermesInfo);
      var g = poser(menu, 'div', 'prop-gestes');
      if (exclusionEnAttente(m, x.terme, x.langue)) {
        poser(g, 'span', 'szh-pastille', TXT.propTermesDemandee);
      } else {
        g.appendChild(SZH.bouton(l.refSeul > 0 ? TXT.propTermesDemanderQuandMeme : TXT.propTermesDemander, function () {
          fermerMenu(false);
          demander(m, x.terme, x.langue, 'exclusion', 'panneau');
        }, (l.refSeul > 0 ? '' : 'szh-bouton--principal ') + 'prop-termes-demander'));
      }
      g.appendChild(SZH.bouton(TXT.propTermesFermer, function () { fermerMenu(true); }, 'prop-termes-fermer'));
      placerMenu(source, true);
      var cible = menu.querySelector('.prop-termes-demander') || menu.querySelector('.prop-termes-fermer');
      if (cible) { cible.focus(); }
    }

    // Pourquoi : un terme ouvre un petit menu, voir ses propositions ou ne plus le proposer.
    function brancherTermePourquoi(b, p, x) {
      var m = p.dossier || p.moissonneur;
      b.type = 'button';
      b.setAttribute('aria-haspopup', 'menu');
      b.setAttribute('aria-expanded', 'false');
      b.title = remplir('propTermesMenu', [x.terme]);
      if (exclusionEnAttente(m, x.terme, x.langue)) { b.classList.add('prop-pourquoi-puce--demandee'); }
      b.addEventListener('click', function () { ouvrirMenuTerme(b, p, x); });
    }
    function ouvrirMenuTerme(source, p, x) {
      if (menu && menu.source === source) { fermerMenu(true); return; }
      fermerMenu(false);
      var m = p.dossier || p.moissonneur;
      menu = document.createElement('div');
      menu.className = 'szh-sugg prop-menu prop-termes-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', remplir('propTermesMenu', [x.terme]));
      menu.source = source;
      var voir = poser(menu, 'button', 'szh-sugg-item', TXT.propTermesVoir);
      voir.type = 'button';
      voir.setAttribute('role', 'menuitem');
      voir.addEventListener('click', function () { filtrerSurTerme(p.type, x); });
      var ne = poser(menu, 'button', 'szh-sugg-item', TXT.propTermesNePlus);
      ne.type = 'button';
      ne.setAttribute('role', 'menuitem');
      ne.addEventListener('click', function () { fermerMenu(false); ouvrirNePlus(source, m, x); });
      placerMenu(source, false);
      voir.focus();
    }

    function selectTermes(parent, libelle, options, valeur, cls) {
      var l = poser(parent, 'label', 'doc-reservoir-case');
      poser(l, 'span', 'doc-reservoir-filtre-label', libelle);
      var s = poser(l, 'select', cls);
      options.forEach(function (o) { var op = poser(s, 'option', null, o[1]); op.value = o[0]; });
      s.value = valeur;
      return s;
    }
    function pastilleStatut(parent, d) {
      var ton = TON_STATUT[d.statut];
      var signe = d.sens === 'ajout' ? '+ ' : d.sens === 'exclusion' ? '− ' : '↺ ';
      var s = poser(parent, 'span', 'szh-pastille prop-termes-statut' + (ton ? ' szh-pastille--' + ton : ''), signe + libelleStatut(d.statut));
      s.title = libelleSens(d.sens) + ' · ' + libelleStatut(d.statut);
      return s;
    }

    // L'onglet Termes : un moissonneur, ses termes au cran regardé, triés, cherchés, filtrés.
    function rendreTermes() {
      var E = termesEtat;
      var ms = moissonneursTermes();
      if (ms.indexOf(E.moissonneur) === -1) { E.moissonneur = ms[0]; }
      var m = E.moissonneur, t = termesDonnes()[m];
      opts.titre.textContent = remplir('propTitreVue', [TXT.propTermesOnglet]);
      var vue = poser(panel, 'div', 'prop-vue prop-termes');
      var tete = poser(vue, 'div', 'prop-filtres');
      if (ms.length > 1) {
        var lbl = poser(tete, 'span', 'prop-finesse-nom', TXT.propTermesMoissonneur);
        lbl.id = 'prop-termes-moissonneur';
        var seg = poser(tete, 'div', 'prop-termes-segments');
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-labelledby', lbl.id);
        ms.forEach(function (x) {
          var l = poser(seg, 'label', 'prop-termes-segment');
          var ra = poser(l, 'input');
          ra.type = 'radio';
          ra.name = 'prop-termes-moissonneur';
          ra.value = x;
          ra.checked = x === m;
          ra.addEventListener('change', function () { E.moissonneur = x; E.form = false; formTermes = null; toutRendre(false); });
          poser(l, 'span', null, termesDonnes()[x].libelle || x);
        });
      }
      poser(tete, 'p', 'prop-termes-comptes', remplir('propTermesComptesAu', [cransTermes(m), t.visibles, t.total]));

      var fl = poser(vue, 'div', 'prop-filtres prop-termes-filtres');
      var q = poser(fl, 'input', 'prop-termes-chercher');
      q.type = 'search';
      q.placeholder = TXT.propTermesChercher;
      q.value = E.q;
      q.setAttribute('aria-label', TXT.propTermesChercher);
      var sr = selectTermes(fl, TXT.propTermesRole, [['', TXT.propTermesTous]].concat(ROLES_ORDRE.map(function (r) { return [r, libelleRole(r)]; })),
        E.role, 'prop-termes-role');
      var sl = selectTermes(fl, TXT.propTermesLangue, [['', TXT.propTermesToutes], ['fr', 'fr'], ['de', 'de'], ['it', 'it']], E.langue, 'prop-termes-langue');
      poser(fl, 'span', 'szh-pousse');
      var ba = SZH.bouton('', function () {
        E.form = !E.form;
        if (E.form && !formTermes) { formTermes = { terme: '', langue: donnees.langue, sens: 'ajout', essai: false, erreurHote: '' }; }
        toutRendre(false);
        var cible = E.form ? panel.querySelector('[id="prop-termes-form-terme"]') : panel.querySelector('.prop-termes-ajouter');
        if (cible) { cible.focus(); }
      }, 'prop-termes-ajouter');
      ba.appendChild(icone('plus'));
      poser(ba, 'span', null, TXT.propTermesAjouter);
      ba.setAttribute('aria-expanded', E.form ? 'true' : 'false');
      ba.setAttribute('aria-controls', 'prop-termes-form');
      fl.appendChild(ba);
      if (E.form && formTermes) { formulaireTerme(vue, m); }
      var avis = poser(vue, 'div', 'prop-termes-avis');
      avis.setAttribute('aria-live', 'polite');
      if (E.avis) { avis.appendChild(SZH.notif(E.avis.ton, E.avis.texte)); }

      var compte = poser(vue, 'p', 'prop-termes-compte');
      var defile = poser(vue, 'div', 'prop-defile prop-termes-defile');
      var table = poser(defile, 'table', 'prop-table prop-table-termes');
      table.setAttribute('aria-label', remplir('propTitreVue', [TXT.propTermesOnglet]));
      var trh = poser(poser(table, 'thead'), 'tr');
      var tbody = poser(table, 'tbody');
      COLS_TERMES.forEach(function (c) {
        var th = poser(trh, 'th', 'prop-termes-th-' + c.id + (c.num ? ' prop-termes-num' : ''));
        th.setAttribute('scope', 'col');
        th.dataset.col = c.id;
        if (c.fixe) { poser(th, 'span', 'prop-masque', TXT[c.lib]); return; }
        var b = poser(th, 'button', 'prop-tri', TXT[c.lib]);
        b.type = 'button';
        b.title = c.tip ? remplir(c.tip, [tiret(t.rappelSur)]) : remplir('propTermesTrier', [TXT[c.lib]]);
        b.addEventListener('click', function () {
          if (E.tri === c.id) { E.sens = -E.sens; } else { E.tri = c.id; E.sens = c.num ? -1 : 1; }
          remplirTable();
          b.focus();
        });
      });
      function valeur(x) {
        if (E.tri === 'demande') { var d = derniereDemande(m, x.terme, x.langue); return d ? libelleStatut(d.statut) : ''; }
        if (E.tri === 'role') { return libelleRole(x.role); }
        if (E.tri === 'terme' || E.tri === 'langue') { return String(x[E.tri] || ''); }
        var v = x[E.tri];
        return v === null || v === undefined ? -1 : v;
      }
      function comparer(a, b) {
        var va = valeur(a), vb = valeur(b);
        var d = (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), donnees.langue)) * E.sens;
        if (d === 0) { d = b.ramene - a.ramene; }
        if (d === 0) { d = a.terme.localeCompare(b.terme, donnees.langue); }
        return d;
      }
      function remplirTable() {
        trh.querySelectorAll('th').forEach(function (th) {
          var sens = th.querySelector('.prop-tri-sens');
          if (sens) { sens.remove(); }
          if (th.dataset.col === E.tri) {
            th.setAttribute('aria-sort', E.sens < 0 ? 'descending' : 'ascending');
            poser(th.querySelector('.prop-tri'), 'span', 'prop-tri-sens', E.sens < 0 ? ' ▼' : ' ▲').setAttribute('aria-hidden', 'true');
          } else { th.removeAttribute('aria-sort'); }
        });
        var qq = E.q.trim().toLocaleLowerCase();
        var l = t.termes.filter(function (x) {
          return (!qq || x.terme.toLocaleLowerCase().indexOf(qq) !== -1) && (!E.role || x.role === E.role) && (!E.langue || x.langue === E.langue);
        });
        l.sort(comparer);
        compte.textContent = remplir('propTermesLignes', [l.length, t.termes.length]);
        tbody.textContent = '';
        if (l.length === 0) {
          var td0 = poser(poser(tbody, 'tr'), 'td', 'prop-discret', TXT.propTermesAucun);
          td0.colSpan = COLS_TERMES.length;
        }
        l.forEach(function (x) { ligneTermeTable(tbody, m, x); });
      }
      q.addEventListener('input', function () { E.q = q.value; remplirTable(); });
      sr.addEventListener('change', function () { E.role = sr.value; remplirTable(); });
      sl.addEventListener('change', function () { E.langue = sl.value; remplirTable(); });
      remplirTable();
      var pied = poser(vue, 'div', 'prop-termes-precautions');
      poser(pied, 'p', null, TXT.propTermesPrecaution1);
      poser(pied, 'p', null, TXT.propTermesPrecaution2);
      if (t.approx) { poser(pied, 'p', 'prop-termes-approx', TXT.propTermesApprox); }
    }
    function ligneTermeTable(tbody, m, x) {
      var tr = poser(tbody, 'tr', 'prop-ligne-terme');
      tr.dataset.terme = x.terme;
      var td = poser(tr, 'td', 'prop-td-terme');
      var b = poser(td, 'button', 'prop-terme', x.terme);
      b.type = 'button';
      if (x.langue && x.langue !== donnees.langue) { b.setAttribute('lang', x.langue); }
      b.title = remplir('propTermesVoirTip', [x.terme]);
      b.addEventListener('click', function () { filtrerSurTerme(typeDuMoissonneur(m), x); });
      poser(tr, 'td', 'prop-discret', x.langue);
      poser(tr, 'td', null, libelleRole(x.role));
      poser(tr, 'td', 'prop-termes-num', String(x.ramene));
      var seul = poser(tr, 'td', 'prop-termes-num prop-termes-fort', (x.approx ? '≈ ' : '') + x.seul);
      if (x.approx) { seul.title = TXT.propTermesApproxTip; }
      poser(tr, 'td', 'prop-termes-num', tiret(x.ref));
      poser(tr, 'td', 'prop-termes-num', tiret(x.refSeul));
      var tdd = poser(tr, 'td');
      var d = derniereDemande(m, x.terme, x.langue);
      if (d) { pastilleStatut(tdd, d); }
      // Une icône, marquée quand des fiches de référence ne sont retrouvées que par ce terme.
      var tdg = poser(tr, 'td', 'prop-td-geste');
      var marque = x.refSeul > 0;
      var nom = remplir(marque ? 'propTermesNePlusRef' : 'propTermesNePlusLabel', [x.terme]);
      var g = SZH.bouton('', function () { ouvrirNePlus(g, m, x); }, 'prop-ne-plus' + (marque ? ' prop-ne-plus--ref' : ''), nom);
      g.setAttribute('aria-label', nom);
      g.setAttribute('aria-haspopup', 'dialog');
      g.setAttribute('aria-expanded', 'false');
      g.appendChild(icone('croix'));
      if (marque) { var ia = icone('attention'); ia.classList.add('prop-ne-plus-marque'); g.appendChild(ia); }
      if (exclusionEnAttente(m, x.terme, x.langue)) { g.disabled = true; g.title = TXT.propTermesDemandee; }
      tdg.appendChild(g);
    }

    // « Ajouter un terme » : la règle de saisie vient de l'hôte (regleTerme) ; l'erreur s'affiche
    // pendant la frappe, sous le champ, et la même demande en attente se signale.
    function erreurTerme(v, F, m) {
      var t = String(v || '').normalize('NFC').trim();
      if (!t) { return F.essai ? TXT.propTermesErrVide : ''; }
      var regle = (donnees && donnees.regleTerme) || {};
      var n = Array.from(t).length;
      if (regle.longueur && n > regle.longueur) { return remplir('propTermesErrLong', [n]); }
      var interdit = null;
      try { interdit = regle.interdit ? new RegExp(regle.interdit, 'u').exec(t) : null; } catch (e) { interdit = null; }
      if (interdit) { return remplir('propTermesErrCaractere', [interdit[0]]); }
      var d = demandesDe(m).filter(function (x) {
        return x.statut === 'en-attente' && x.sens === F.sens && x.langue === F.langue && memeTerme(x.terme, t);
      })[0];
      if (d) { return remplir('propTermesErrDoublon', [d.par, dateCourte(d.le)]); }
      return F.erreurHote || '';
    }
    function formulaireTerme(vue, m) {
      var F = formTermes;
      var f = poser(vue, 'form', 'szh-carte prop-termes-form');
      f.id = 'prop-termes-form';
      f.noValidate = true;
      var h = poser(f, 'h3', 'prop-termes-form-titre', TXT.propTermesFormTitre);
      h.id = 'prop-termes-form-titre';
      f.setAttribute('aria-labelledby', h.id);
      var ligne = poser(f, 'div', 'prop-termes-form-ligne');
      var c1 = poser(ligne, 'div', 'szh-champ prop-termes-form-terme');
      var l1 = poser(c1, 'label', null, TXT.propTermesFormTerme);
      l1.htmlFor = 'prop-termes-form-terme';
      var i1 = poser(c1, 'input');
      i1.id = 'prop-termes-form-terme';
      i1.type = 'text';
      i1.value = F.terme;
      i1.autocomplete = 'off';
      var err = poser(c1, 'p', 'prop-termes-erreur');
      err.id = 'prop-termes-form-erreur';
      err.hidden = true;
      var c2 = poser(ligne, 'div', 'szh-champ');
      var l2 = poser(c2, 'label', null, TXT.propTermesFormLangue);
      l2.htmlFor = 'prop-termes-form-langue';
      var s2 = poser(c2, 'select');
      s2.id = 'prop-termes-form-langue';
      ['fr', 'de', 'it'].forEach(function (l) { var o = poser(s2, 'option', null, l); o.value = l; });
      s2.value = F.langue;
      var fs = poser(ligne, 'fieldset', 'prop-termes-form-sens');
      poser(fs, 'legend', null, TXT.propTermesFormSens);
      [['ajout', TXT.propTermesFormAjout], ['exclusion', TXT.propTermesFormExclusion]].forEach(function (o) {
        var l = poser(fs, 'label', 'prop-termes-radio');
        var r = poser(l, 'input');
        r.type = 'radio';
        r.name = 'prop-termes-form-sens';
        r.value = o[0];
        r.checked = F.sens === o[0];
        r.addEventListener('change', function () { if (r.checked) { F.sens = o[0]; F.erreurHote = ''; } valider(); });
        poser(l, 'span', null, o[1]);
      });
      poser(f, 'p', 'prop-termes-aide', TXT.propTermesFormAide);
      var g = poser(f, 'div', 'prop-gestes');
      var env = SZH.bouton(TXT.propTermesFormEnvoyer, function () {}, 'szh-bouton--principal prop-termes-envoyer');
      env.type = 'submit';
      g.appendChild(env);
      g.appendChild(SZH.bouton(TXT.propTermesFormAnnuler, function () {
        termesEtat.form = false;
        formTermes = null;
        toutRendre(false);
        var b = panel.querySelector('.prop-termes-ajouter');
        if (b) { b.focus(); }
      }, 'prop-termes-annuler'));
      function valider() {
        var e = erreurTerme(i1.value, F, m);
        err.textContent = e;
        err.hidden = !e;
        i1.setAttribute('aria-invalid', e ? 'true' : 'false');
        if (e) { i1.setAttribute('aria-describedby', err.id); } else { i1.removeAttribute('aria-describedby'); }
        return e;
      }
      i1.addEventListener('input', function () { F.terme = i1.value; F.erreurHote = ''; valider(); });
      s2.addEventListener('change', function () { F.langue = s2.value; F.erreurHote = ''; valider(); });
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        F.essai = true;
        if (valider()) { i1.focus(); return; }
        demander(m, i1.value.normalize('NFC').trim(), F.langue, F.sens, 'form');
      });
      valider();
    }

    // ---- Clavier : sur le panneau, pour ne jamais agir hors de la vue ------------------------
    function enSaisie(el) {
      if (!el) { return false; }
      if (el.isContentEditable) { return true; }
      var tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT') { return true; }
      return tag === 'INPUT' && ['checkbox', 'radio', 'button'].indexOf(el.type) === -1;
    }
    function surTouche(ev) {
      if (menu) {
        if (ev.key === 'Escape') { ev.preventDefault(); fermerMenu(true); return; }
        if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && menu.getAttribute('role') !== 'dialog') {
          ev.preventDefault();
          var items = Array.prototype.slice.call(menu.querySelectorAll('button'));
          var i = items.indexOf(document.activeElement) + (ev.key === 'ArrowDown' ? 1 : -1);
          items[(i + items.length) % items.length].focus();
        }
        // Espace et Entrée cochent sans fermer : on garde le menu pour masquer plusieurs colonnes.
        if ((ev.key === ' ' || ev.key === 'Enter') && ev.target && ev.target.closest && ev.target.closest('.prop-menu-colonnes')) {
          ev.preventDefault();
          ev.target.click();
        }
        if (ev.key === 'Tab' && menu.getAttribute('role') !== 'dialog') { fermerMenu(false); }
        return;
      }
      var cible0 = ev.target;
      if (enSaisie(cible0)) {
        if (ev.key === 'Escape' && cible0.blur) { cible0.blur(); }
        return;
      }
      if (ev.ctrlKey && (ev.key === 'z' || ev.key === 'Z')) {
        if (annulable) { ev.preventDefault(); annuler(); }
        return;
      }
      if (ev.ctrlKey || ev.altKey || ev.metaKey || !onglet || onglet === '_termes') { return; }
      if (cible0 && cible0.getAttribute && cible0.getAttribute('role') === 'separator') { return; }
      var lignes = lignesOnglet();
      var idx = lignes.map(function (p) { return p.cle; }).indexOf(courant);
      var p = courant ? trouver(courant) : null;
      var cible = detailCle ? trouver(detailCle) : p;
      var surBouton = cible0 && cible0.tagName === 'BUTTON';
      switch (ev.key) {
        case 'ArrowDown': case 'ArrowUp': {
          ev.preventDefault();
          var n = Math.max(0, Math.min(lignes.length - 1, idx + (ev.key === 'ArrowDown' ? 1 : -1)));
          if (!lignes[n]) { return; }
          definirCourant(lignes[n].cle, true);
          if (detailCle) { ouvrirDetail(lignes[n].cle, false); }
          return;
        }
        case 'Enter':
          if (surBouton || !p) { return; }
          ev.preventDefault();
          ouvrirDetail(p.cle, true);
          return;
        case 'Escape':
          if (detailCle) { ev.preventDefault(); fermerDetail(); }
          return;
        case ' ':
          if (!p || !enAttente(p) || !cible0 || cible0.tagName !== 'TR') { return; }
          ev.preventDefault();
          if (selection.has(p.cle)) { selection.delete(p.cle); } else { selection.add(p.cle); }
          rendreTable();
          rendrePied();
          focaliserCourant();
          return;
        case 'a': case 'A': case 'g': case 'G': {
          if (!cible || !enAttente(cible)) { return; }
          ev.preventDefault();
          // Un cas B ne s'accepte pas d'une touche : on le dit, au lieu de ne rien faire.
          if (!acceptable(cible, true)) {
            avertir(cible.cle === detailCle ? remplir('propBloque', [nomsBloquants(cible)])
              : remplir('propVerifierDabord', [titreCourt(cible)]));
            return;
          }
          agir(ev.key.toLowerCase() === 'a' ? 'accepte' : 'garde', [cible.cle]);
          return;
        }
        case 'x': case 'X': case 'Delete':
          if (cible && enAttente(cible)) { ev.preventDefault(); agir('refuse', [cible.cle]); }
          return;
        case 'd': case 'D':
          if (cible && cible.doublon && enAttente(cible)) { ev.preventDefault(); agir('refuse', [cible.cle], 'doublon'); }
          return;
      }
    }
    panel.addEventListener('keydown', surTouche);
    document.addEventListener('mousedown', function (ev) {
      if (menu && !menu.contains(ev.target) && !menu.source.contains(ev.target)) { fermerMenu(false); }
    });

    // ---- Largeur de la vue -----------------------------------------------------------------
    // Mesurée sur le panneau, pas sur la fenêtre : la barre latérale de l'éditeur n'y compte pas.
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(function (entrees) {
        var w = entrees && entrees[0] && entrees[0].contentRect ? entrees[0].contentRect.width : 0;
        if (!w) { return; }
        var avant = detailPlein();
        largeurVue = w;
        if (detailPlein() !== avant) { rendreDetail(); }
        disposer();
      }).observe(panel);
    }

    // ---- Rendu d'ensemble ------------------------------------------------------------------
    function toutRendre(focus) {
      rendreOnglets();
      rendreVue();
      if (focus) {
        if (zone.detail) { focaliserDetail(); } else { focaliserCourant(); }
      }
    }
    function afficher() {
      TXT = opts.txt() || {};
      if (!demande) {
        demande = true;
        api.postMessage({ type: SZH.MSG.PROP_CHARGER });
      }
      toutRendre(false);
    }
    function recevoir(msg) {
      if (msg.type === SZH.MSG.PROP_VERIFIE) { recevoirVerification(msg); return true; }
      if (msg.type !== SZH.MSG.PROP_DONNEES) { return false; }
      TXT = opts.txt() || {};
      donnees = msg;
      // L'hôte a rangé le cran du curseur : son aperçu fait foi.
      apercuLocal = {};
      if (msg.finesseGeste) {
        poserFinesseAvis(msg.finesseGeste.geste === 'garde' ? { typeFiche: msg.finesseGeste.typeFiche, cran: msg.finesseGeste.cran } : null);
      }
      if (reglages === null) { reglages = Object.assign({}, msg.colonnes || {}); }
      // La marque de l'autre revue : la valeur d'office la première fois qu'on voit la proposition.
      (msg.propositions || []).forEach(function (p) { if (!(p.cle in aussi)) { aussi[p.cle] = !!p.aussi; } });
      // « Ouvrir Propositions › Termes » : l'onglet Termes, sur le moissonneur demandé.
      if (msg.ongletDemande && msg.ongletDemande.onglet === '_termes') {
        onglet = '_termes';
        if (msg.ongletDemande.moissonneur) { termesEtat.moissonneur = msg.ongletDemande.moissonneur; }
        selection.clear();
        detailCle = null;
        courant = null;
      }
      if (msg.demandeGeste) { recevoirDemande(msg.demandeGeste); }
      if (msg.resultat) { appliquerResultat(msg.resultat); }
      if (!panel.hidden) { toutRendre(!!msg.resultat); }
      return true;
    }
    return { afficher: afficher, recevoir: recevoir };
  }

  SZH.vuePropositions = vuePropositions;
})();
