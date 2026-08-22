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
  rendre();
  window.addEventListener('message', function (e) {
    const msg = e.data || {};
    recu = true;
    if (msg.type === 'valeurs') { cocher(msg.valeurs || {}); }
  });
  SZH.annoncerPret(vscodeApi, function () { return recu; });
})();