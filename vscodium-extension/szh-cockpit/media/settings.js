(function () {
  'use strict';
  const TXT = __TXT__;
  const vscodeApi = acquireVsCodeApi();
  let recu = false;
  const zones = document.getElementById('zones');
  const GROUPES = [
    { cle: 'theme', legende: TXT.theme, options: [['systeme', TXT.themeSysteme], ['clair', TXT.themeClair], ['sombre', TXT.themeSombre]] },
    { cle: 'zoom', legende: TXT.zoom, options: [['0', TXT.zoomNormal], ['1', TXT.zoomGrand], ['2', TXT.zoomTresGrand]] },
    { cle: 'policeMd', legende: TXT.policeMd, options: [['14', '14 px'], ['16', '16 px'], ['18', '18 px']] },
    { cle: 'apercu', legende: TXT.apercu, options: [['html', TXT.apercuHtml], ['pdf', TXT.apercuPdf]] },
    { cle: 'assets', legende: TXT.assets, options: [['oui', TXT.assetsOui], ['non', TXT.assetsNon]] },
    { cle: 'cmyk', legende: TXT.cmyk, options: [['oui', TXT.cmykOui], ['non', TXT.cmykNon]] },
    { cle: 'langue', legende: TXT.langue, options: [['fr', 'Français'], ['de', 'Deutsch']] },
    { cle: 'dev', legende: TXT.dev, options: [['oui', TXT.devOui], ['non', TXT.devNon]] }
  ];
  function rendre() {
    for (const g of GROUPES) {
      const zone = document.createElement('fieldset');
      const legende = document.createElement('legend');
      legende.textContent = g.legende;
      zone.appendChild(legende);
      for (const [valeur, libelle] of g.options) {
        const l = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = g.cle;
        radio.value = valeur;
        radio.addEventListener('change', function () {
          vscodeApi.postMessage({ type: 'regler', cle: g.cle, valeur: valeur });
        });
        l.appendChild(radio);
        l.appendChild(document.createTextNode(libelle));
        zone.appendChild(l);
      }
      zones.appendChild(zone);
    }
  }
  function cocher(valeurs) {
    for (const cle of Object.keys(valeurs)) {
      const radio = document.querySelector('input[name="' + cle + '"][value="' + String(valeurs[cle]) + '"]');
      if (radio) { radio.checked = true; }
    }
  }

  // ---- Export OJS -----------------------------------------------------------------
  //
  // OJS apparie le genre de fichier, le groupe d'auteur et les rubriques PAR NOM à
  // l'import : un intitulé approximatif crée un doublon ou range l'article ailleurs. Ce
  // bloc est la seule façon de corriger un intitulé, ou d'ajouter une rubrique, sans
  // republier l'extension. Tout arrive par postMessage — la page ne connaît ni les
  // rubriques ni les revues avant que l'hôte ne les envoie.
  const ojsZone = document.getElementById('ojs');
  let ojs = null;              // { config, champs, locales, revues, typesArticle }
  let ojsModifie = false;
  const selectsType = [];      // reconstruits dès qu'une clé de rubrique change

  function marquer() { ojsModifie = true; auto.programmer(); }

  function champTexte(valeur, aria, marque, placeholder) {
    const i = document.createElement('input');
    i.type = 'text';
    i.value = valeur === undefined || valeur === null ? '' : String(valeur);
    i.setAttribute('aria-label', aria);
    i.placeholder = placeholder || TXT.ojsVide;
    for (const cle of Object.keys(marque)) { i.dataset[cle] = marque[cle]; }
    i.classList.toggle('vide', i.value.trim() === '');
    i.addEventListener('input', function () {
      i.classList.toggle('vide', i.value.trim() === '');
      marquer();
    });
    return i;
  }

  function caseACocher(coche, aria, marque) {
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = !!coche;
    c.setAttribute('aria-label', aria);
    for (const cle of Object.keys(marque)) { c.dataset[cle] = marque[cle]; }
    c.addEventListener('change', marquer);
    return c;
  }

  function grille(colonnes) {
    const g = document.createElement('div');
    g.className = 'ojs-grille';
    g.style.gridTemplateColumns = colonnes;
    return g;
  }

  function entete(g, libelles) {
    for (const libelle of libelles) {
      const t = document.createElement('span');
      t.className = 'ojs-entete';
      t.textContent = libelle;
      g.appendChild(t);
    }
  }

  function zone(legende) {
    const f = document.createElement('fieldset');
    const l = document.createElement('legend');
    l.textContent = legende;
    f.appendChild(l);
    return f;
  }

  function note(parent, texte) {
    const p = document.createElement('p');
    p.className = 'ojs-note';
    p.textContent = texte;
    parent.appendChild(p);
    return p;
  }

  // Un champ par revue. Les valeurs relevées sur l'instance sont là ; celles qui n'ont
  // jamais pu l'être sont vides, et la note dit dans quel écran d'OJS aller les lire.
  function rendreRevues() {
    const f = zone(TXT.ojsRevues);
    const g = grille('minmax(9em, 1.1fr) repeat(' + ojs.locales.length + ', minmax(8em, 1fr))');
    entete(g, [''].concat(ojs.locales.map((l) => ojs.revues[l])));
    for (const champ of ojs.champs) {
      const etiquette = document.createElement('span');
      etiquette.className = 'ojs-libelle';
      etiquette.textContent = champ.libelle + (champ.requis ? ' *' : '');
      g.appendChild(etiquette);
      for (const loc of ojs.locales) {
        g.appendChild(champTexte(ojs.config.revues[loc][champ.cle],
          champ.libelle + ' — ' + ojs.revues[loc], { revue: loc, champ: champ.cle }));
      }
    }
    f.appendChild(g);
    for (const champ of ojs.champs) { note(f, champ.libelle + ' — ' + champ.ou); }
    ojsZone.appendChild(f);
  }

  function rangeeRubrique(g, r) {
    const nom = r.cle || TXT.ojsCleNouvelle;
    const cle = champTexte(r.cle, TXT.ojsColCle + ' — ' + nom, { rubriqueCle: '1' },
      TXT.ojsCleNouvelle);
    // La clé ne part pas dans le XML : elle relie la rubrique à un type d'article. Les
    // listes de types se reconstruisent donc dès qu'elle est fixée. Celle d'une rubrique
    // livrée ne se renomme pas : l'ancienne resterait en place et le type d'article
    // pointerait dans le vide. Les intitulés, eux, restent modifiables.
    if ((ojs.clesDefaut || []).indexOf(r.cle) !== -1) {
      cle.readOnly = true;
      cle.classList.add('fige');
    } else {
      cle.addEventListener('change', majOptionsTypes);
    }
    g.appendChild(cle);
    for (const loc of ojs.locales) {
      g.appendChild(champTexte(r.abbrev[loc],
        TXT.ojsColAbbrev + ' ' + ojs.revues[loc] + ' — ' + nom, { rubriqueAbbrev: loc }));
      g.appendChild(champTexte(r.titre[loc],
        TXT.ojsColTitre + ' ' + ojs.revues[loc] + ' — ' + nom, { rubriqueTitre: loc }));
    }
    g.appendChild(caseACocher(!r.sansResume, TXT.ojsColResume + ' — ' + nom, { rubriqueResume: '1' }));
    g.appendChild(caseACocher(!r.sansDoi, TXT.ojsColDoi + ' — ' + nom, { rubriqueDoi: '1' }));
  }

  function rendreRubriques() {
    const f = zone(TXT.ojsRubriques);
    note(f, TXT.ojsRubriquesAide);
    const g = grille('minmax(4.5em, .6fr)' +
      ' repeat(' + ojs.locales.length + ', minmax(4.5em, .6fr) minmax(8em, 1.4fr))' +
      ' 4.5em 4.5em');
    const titres = [TXT.ojsColCle];
    for (const loc of ojs.locales) {
      titres.push(TXT.ojsColAbbrev + ' ' + loc.toUpperCase());
      titres.push(TXT.ojsColTitre + ' ' + loc.toUpperCase());
    }
    titres.push(TXT.ojsColResume);
    titres.push(TXT.ojsColDoi);
    entete(g, titres);
    for (const r of ojs.config.rubriques) { rangeeRubrique(g, r); }
    f.appendChild(g);
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'ojs-ajouter';
    plus.textContent = TXT.ojsAjouter;
    plus.addEventListener('click', function () {
      const vide = {};
      for (const loc of ojs.locales) { vide[loc] = ''; }
      ojs.config = collecter();
      ojs.config.rubriques.push({
        cle: '', sansResume: 1, sansDoi: 1,
        abbrev: Object.assign({}, vide), titre: Object.assign({}, vide)
      });
      ojsModifie = true;
      rendreOjs();
      const champs = ojsZone.querySelectorAll('[data-rubrique-cle]');
      if (champs.length) { champs[champs.length - 1].focus(); }
    });
    f.appendChild(plus);
    ojsZone.appendChild(f);
  }

  // La rubrique qui reçoit chaque type d'article. C'est ce choix qui rend une rubrique
  // ajoutée atteignable par un article, et donc visible dans le XML.
  function rendreTypes() {
    const f = zone(TXT.ojsTypes);
    note(f, TXT.ojsTypesAide);
    const g = grille('minmax(9em, 1fr) minmax(9em, 1fr)');
    selectsType.length = 0;
    for (const type of ojs.typesArticle) {
      const etiquette = document.createElement('span');
      etiquette.className = 'ojs-libelle';
      etiquette.textContent = type.libelle;
      g.appendChild(etiquette);
      const select = document.createElement('select');
      select.dataset.type = type.valeur;
      select.setAttribute('aria-label', TXT.ojsTypes + ' — ' + type.libelle);
      select.addEventListener('change', marquer);
      selectsType.push(select);
      g.appendChild(select);
    }
    f.appendChild(g);
    ojsZone.appendChild(f);
    majOptionsTypes();
  }

  function majOptionsTypes() {
    const rubriques = lireRubriques().filter((r) => r.cle !== '');
    for (const select of selectsType) {
      const choisi = select.value || ojs.config.types[select.dataset.type] || '';
      select.textContent = '';
      for (const r of rubriques) {
        const opt = document.createElement('option');
        opt.value = r.cle;
        opt.textContent = r.cle + ' — ' + (r.titre[ojs.locales[0]] || r.titre[ojs.locales[1]] || r.cle);
        select.appendChild(opt);
      }
      select.value = rubriques.some((r) => r.cle === choisi) ? choisi
        : (rubriques.length ? rubriques[0].cle : '');
    }
  }

  function lireRubriques() {
    const cles = ojsZone.querySelectorAll('[data-rubrique-cle]');
    const abbrevs = ojsZone.querySelectorAll('[data-rubrique-abbrev]');
    const titres = ojsZone.querySelectorAll('[data-rubrique-titre]');
    const resumes = ojsZone.querySelectorAll('[data-rubrique-resume]');
    const dois = ojsZone.querySelectorAll('[data-rubrique-doi]');
    const n = ojs.locales.length;
    const sortie = [];
    for (let i = 0; i < cles.length; i++) {
      const abbrev = {};
      const titre = {};
      for (let l = 0; l < n; l++) {
        const loc = ojs.locales[l];
        abbrev[loc] = abbrevs[i * n + l] ? abbrevs[i * n + l].value.trim() : '';
        titre[loc] = titres[i * n + l] ? titres[i * n + l].value.trim() : '';
      }
      sortie.push({
        cle: cles[i].value.trim(), abbrev: abbrev, titre: titre,
        sansResume: resumes[i] && resumes[i].checked ? 0 : 1,
        sansDoi: dois[i] && dois[i].checked ? 0 : 1
      });
    }
    return sortie;
  }

  // Relit l'écran : ce qui est affiché est ce qui part, sans état parallèle. Même forme
  // que celle envoyée par l'hôte et que celle écrite dans config.json — une seule forme.
  function collecter() {
    const revues = {};
    for (const loc of ojs.locales) { revues[loc] = {}; }
    for (const champ of ojsZone.querySelectorAll('[data-champ]')) {
      revues[champ.dataset.revue][champ.dataset.champ] = champ.value.trim();
    }
    const types = {};
    for (const select of selectsType) {
      if (select.value) { types[select.dataset.type] = select.value; }
    }
    return { revues: revues, rubriques: lireRubriques(), types: types };
  }

  function rendreOjs() {
    ojsZone.textContent = '';
    rendreRevues();
    rendreRubriques();
    rendreTypes();
  }

  const auto = SZH.autoEnregistrement({
    estModifie: function () { return ojsModifie; },
    enregistrer: function (autoEcriture) {
      ojsModifie = false;
      vscodeApi.postMessage({ type: 'reglerOjs', ojs: collecter(), auto: autoEcriture });
    }
  });

  rendre();
  window.addEventListener('message', function (e) {
    const msg = e.data || {};
    recu = true;
    if (msg.type === 'enregistre') { auto.confirme(); return; }
    if (msg.type !== 'valeurs') { return; }
    cocher(msg.valeurs || {});
    // Une saisie en cours ne se fait pas écraser par un renvoi de valeurs : le panneau
    // reste tel quel, l'enregistrement automatique s'en occupe.
    if (msg.ojs && !ojsModifie) {
      ojs = msg.ojs;
      rendreOjs();
    }
  });
  SZH.annoncerPret(vscodeApi, function () { return recu; });
})();
