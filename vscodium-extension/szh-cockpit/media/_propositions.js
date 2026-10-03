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
//                     propRecreer { cle, valeurs } ; docDateFormer (media/_fiche-doc.js)
//   hôte -> webview : propDonnees { langue, cible, revueAutre, types, propositions, refusees,
//                     etats, colonnes, resultat? } ;
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
  // largeurs mémorisées. Valeur provisoire, à fixer dans une vraie fenêtre VSCodium.
  var SEUIL_DETAIL_PLEIN = 960;
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
    function comptes(type) {
      var att = attente().filter(function (p) { return p.type === type; });
      return { n: att.length, b: att.filter(estB).length };
    }
    function filtre(p) { return !filtrePertinence || (p.pertinence && p.pertinence.verdict === filtrePertinence); }
    // Les lignes de l'onglet : en attente dans l'ordre de l'hôte, puis les refusées si demandé.
    function lignesOnglet() {
      var l = attente().filter(function (p) { return p.type === onglet && filtre(p); });
      if (!afficherRefusees) { return l; }
      return l.concat(refusees().filter(function (p) { return p.type === onglet && filtre(p); }));
    }
    function attenteOnglet() { return lignesOnglet().filter(enAttente); }
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
      barreOnglets.hidden = visibles.length === 0;
      if (visibles.length > 0 && visibles.indexOf(onglet) === -1) { onglet = visibles[0]; }
      if (visibles.length === 0) { onglet = null; }
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
        b.addEventListener('keydown', function (ev) {
          if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') { return; }
          ev.preventDefault();
          var i = visibles.indexOf(t) + (ev.key === 'ArrowRight' ? 1 : -1);
          var cible = visibles[(i + visibles.length) % visibles.length];
          changerOnglet(cible);
          var nb = barreOnglets.querySelector('[data-type="' + cible + '"]');
          if (nb) { nb.focus(); }
        });
        barreOnglets.appendChild(b);
      });
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
      var lf = poser(f, 'label', 'doc-reservoir-case');
      poser(lf, 'span', 'doc-reservoir-filtre-label', TXT.propFiltrePertinence);
      var sel = poser(lf, 'select', 'prop-filtre-pertinence');
      [['', TXT.propToutes], ['retenu', TXT.propPertinenceRetenu], ['a-relire', TXT.propPertinenceARelire]].forEach(function (o) {
        var opt = poser(sel, 'option', null, o[1]);
        opt.value = o[0];
      });
      sel.value = filtrePertinence;
      sel.addEventListener('change', function () { filtrePertinence = sel.value; selection.clear(); rendreTable(); rendrePied(); });
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
      zone.filtres = f;

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
      cols.push({ id: 'pertinence', libelle: TXT.propColPertinence, defaut: 108, min: 56, masquable: true });
      cols.push({ id: 'gestes', libelle: TXT.propColGestes, fixe: true });
      return cols;
    }
    function reglageDe(type) {
      var r = (reglages || {})[type] || {};
      return { largeurs: Object.assign({}, r.largeurs || {}), masquees: (r.masquees || []).slice() };
    }
    function reglageVide(r) { return Object.keys(r.largeurs).length === 0 && r.masquees.length === 0; }
    function poserReglage(type, r) {
      reglages = reglages || {};
      if (reglageVide(r)) { delete reglages[type]; } else { reglages[type] = r; }
    }
    // Mémorise le réglage d'un type chez l'hôte, dans le globalState du poste.
    function sauverReglage(type, r) {
      poserReglage(type, r);
      api.postMessage({ type: SZH.MSG.PROP_COLONNES, typeFiche: type, reglage: reglageVide(r) ? null : r });
    }
    function detailPlein() { return !!detailCle && largeurVue > 0 && largeurVue < SEUIL_DETAIL_PLEIN; }
    function colonnesVisibles(type) {
      var m = reglageDe(type).masquees;
      var serre = pertinenceAuto && !!detailCle && !detailPlein();
      return colonnesDe(type).filter(function (c) {
        if (c.fixe || c.masquable === false) { return true; }
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
      var att = lignes.filter(enAttente);
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
        var tr = poser(tbody, 'tr', 'prop-ligne' + (p.cle === courant ? ' prop-ligne--courante' : '') + (refusee ? ' prop-ligne--refusee' : ''));
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
      var r = reglageDe(onglet), i = r.masquees.indexOf(id);
      if (i === -1) { r.masquees.push(id); } else { r.masquees.splice(i, 1); }
      sauverReglage(onglet, r);
      rendreTable();
    }
    function retablirColonnes() {
      sauverReglage(onglet, { largeurs: {}, masquees: [] });
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
        var m = reglageDe(onglet).masquees;
        colonnesDe(onglet).forEach(function (c) {
          if (c.id === 'case') { return; }
          var it = poser(menu, 'button', 'szh-sugg-item prop-menu-case');
          it.type = 'button';
          it.setAttribute('role', 'menuitemcheckbox');
          it.dataset.col = c.id;
          var fixe = c.fixe || c.masquable === false;
          var coche = fixe || m.indexOf(c.id) === -1;
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
      Object.keys(p.brut || {}).map(function (k) { var c = champDe(p.type, k); return [c ? c.libelle : k, p.brut[k]]; })
        .concat([[TXT.propBrutCle, p.cle]])
        .forEach(function (x) {
          poser(dl, 'dt', null, x[0]);
          poser(dl, 'dd', null, x[1] === '' || x[1] === null || x[1] === undefined ? '–' : typeof x[1] === 'object' ? JSON.stringify(x[1]) : String(x[1]));
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
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
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
        if (ev.key === 'Tab') { fermerMenu(false); }
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
      if (ev.ctrlKey || ev.altKey || ev.metaKey || !onglet) { return; }
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
      if (reglages === null) { reglages = Object.assign({}, msg.colonnes || {}); }
      // La marque de l'autre revue : la valeur d'office la première fois qu'on voit la proposition.
      (msg.propositions || []).forEach(function (p) { if (!(p.cle in aussi)) { aussi[p.cle] = !!p.aussi; } });
      if (msg.resultat) { appliquerResultat(msg.resultat); }
      if (!panel.hidden) { toutRendre(!!msg.resultat); }
      return true;
    }
    return { afficher: afficher, recevoir: recevoir };
  }

  SZH.vuePropositions = vuePropositions;
})();
