(function(){
'use strict';
var api=acquireVsCodeApi();
var modele=null, dispo=null, occ2=null, TXT={}, accent='', teintes={};
var selection=null, ancre=null, cellActive=null, ctl={};
// Historique (D60, F1) : deux piles d'états du MODÈLE, dans la webview. Chaque
// opération de structure empile l'état PRÉ-op (voir op) ; les éditions de texte sont
// empilées au blur d'une cellule (avantEdition = instantané pris au focus).
// modeleEnregistre = état écrit sur disque (garde non-enregistré).
var annuler=[], retablir=[], avantEdition=null, modeleEnregistre=null, enrEnCours=null, dernierModifie=false;
var glisse=null;   // sélection par glisser : { ancre:cellule, actif:bool }
var barre=document.getElementById('barre'), zone=document.getElementById('zone'), aide=document.getElementById('aide'), panneau=document.getElementById('panneau');
function clone(o){return JSON.parse(JSON.stringify(o));}
function dechap(s){return String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'\"').replace(/&#x27;/g,"'").replace(/&#39;/g,"'").replace(/&amp;/g,'&');}
function echap(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function poserInline(el,contenu){el.textContent='';var re=/<\/?(?:strong|em)>|<br>/g,dernier=0,m,pile=[el];
  while((m=re.exec(contenu))!==null){var txt=contenu.slice(dernier,m.index);if(txt){pile[pile.length-1].appendChild(document.createTextNode(dechap(txt)));}
    dernier=re.lastIndex;var tg=m[0];
    if(tg==='<br>'){pile[pile.length-1].appendChild(document.createElement('br'));}
    else if(tg==='<strong>'){var s=document.createElement('strong');pile[pile.length-1].appendChild(s);pile.push(s);}
    else if(tg==='<em>'){var e=document.createElement('em');pile[pile.length-1].appendChild(e);pile.push(e);}
    else if(pile.length>1){pile.pop();}}
  var reste=contenu.slice(dernier);if(reste){pile[pile.length-1].appendChild(document.createTextNode(dechap(reste)));}}
function inlineDeNoeud(n){var out='';n.childNodes.forEach(function(ch){
  if(ch.nodeType===3){out+=echap(ch.nodeValue);}
  else if(ch.nodeType===1){var tg=ch.tagName.toLowerCase();
    if(tg==='br'){out+='<br>';}
    else if(tg==='strong'||tg==='b'){out+='<strong>'+inlineDeNoeud(ch)+'</strong>';}
    else if(tg==='em'||tg==='i'){out+='<em>'+inlineDeNoeud(ch)+'</em>';}
    else{out+=inlineDeNoeud(ch);}}});return out;}
function recolter(){if(!modele)return;zone.querySelectorAll('[data-li]').forEach(function(el){
  var li=+el.dataset.li,ci=+el.dataset.ci;if(modele.lignes[li]&&modele.lignes[li].cellules[ci]){modele.lignes[li].cellules[ci].contenu=inlineDeNoeud(el).trim();}});}
function rectCell(c){return {rMin:c.r0,cMin:c.c0,rMax:c.r0+c.rowspan-1,cMax:c.c0+c.colspan-1};}
function union(a,b){return {rMin:Math.min(a.rMin,b.rMin),cMin:Math.min(a.cMin,b.cMin),rMax:Math.max(a.rMax,b.rMax),cMax:Math.max(a.cMax,b.cMax)};}
function chevauche(a,b){return !(a.rMax<b.rMin||a.rMin>b.rMax||a.cMax<b.cMin||a.cMin>b.cMax);}
function etendre(rect){var change=true;while(change){change=false;dispo.lignes.forEach(function(lg){lg.cellules.forEach(function(c){
  var cr=rectCell(c);if(chevauche(cr,rect)){var nr=union(rect,cr);if(nr.rMin!==rect.rMin||nr.cMin!==rect.cMin||nr.rMax!==rect.rMax||nr.cMax!==rect.cMax){rect=nr;change=true;}}});});}return rect;}
// F2 : « plage » = plus d'UNE cellule DISTINCTE sélectionnée (comptée via occ2). Une
// cellule fusionnée seule couvre plusieurs cases visuelles mais reste UNE cellule ->
// pas une plage -> éditable (majEditable).
function plage(){if(!selection||!occ2)return false;var vu={},n=0;
  for(var r=selection.rMin;r<=selection.rMax;r++){for(var c=selection.cMin;c<=selection.cMax;c++){
    var ce=occ2[r]&&occ2[r][c];if(!ce)continue;var k=ce.li+'/'+ce.ci;if(vu[k])continue;vu[k]=1;if(++n>1)return true;}}
  return false;}
function clampSel(s){if(!s||!dispo)return null;var rMax=Math.min(s.rMax,dispo.nbLignes-1),cMax=Math.min(s.cMax,dispo.nbColonnes-1);if(s.rMin>rMax||s.cMin>cMax||s.rMin<0||s.cMin<0)return null;return etendre({rMin:s.rMin,cMin:s.cMin,rMax:rMax,cMax:cMax});}

// ---- Teintes de l'aperçu (mêmes valeurs que print.css / couleurs.css) ----
// Couleur annuelle brute (repli gris si non définie -> l'aperçu retombe sur les valeurs
// par défaut de print.css, comme le PDF d'un numéro sans couleur).
function accBrut(){return accent||null;}
// Teintes de l'aperçu : LUES, jamais recalculées (D76). L'hôte les transmet dans
// `teintes` — il les a prises dans out/.szh-accent.css, le fichier que le pipeline
// écrit et que WeasyPrint applique. Un aperçu WYSIWYG ne doit pas réimplémenter une
// formule de contraste : la version WCAG qui vivait ici a divergé du PDF au passage
// à APCA (fonds trop pâles). Sans valeur reçue (numéro jamais compilé), on retombe
// sur les gris neutres de print.css — comme le PDF d'un numéro sans couleur.
function clairAccent(){return teintes.clair||null;}
function fonceAccent(){return teintes.fonce||null;}
// Repli neutre (= --szh-gris-clair / --szh-zebre / --szh-accent de couleurs.css/print.css).
var GRIS_CLAIR='#e6e6e6', TEINTE_ZEBRE='#f2f2f2', ACCENT_GRIS='#9a9a9a';
// fond (D67) -> { bg, fg } ou null : negatif = accent foncé + blanc ; couleur = accent
// clair + noir ; gris = gris clair neutre + noir ; aucun = pas de remplissage.
function fondDe(v){
  if(v==='negatif'){return {bg:fonceAccent()||'#4a4a4a',fg:'#ffffff'};}
  if(v==='couleur'){return {bg:clairAccent()||'#ededed',fg:'#000000'};}
  if(v==='gris'){return {bg:GRIS_CLAIR,fg:'#000000'};}
  return null;}
// Aperçu fidèle des styles au NIVEAU tableau (D64/D67, miroir de print.css) : zébrage
// colonnes/lignes, fonds des en-têtes (el=th[scope=row], ec=th[scope=col]), ligne de
// total (dernière rangée du <tbody>), bordures haute/basse. Appliqué en style INLINE sur
// les .cell (le round-trip reste piloté par le modèle, jamais par ces styles). L'ordre
// suit print.css : zébrage, puis en-têtes, puis total, puis bordures (le dernier gagne).
function stylerApercu(){if(!dispo||!modele)return;var a=modele.attrs;
  var eL=a.enteteLignes,N=dispo.nbLignes;
  var accLigne=teintes.filet||accBrut()||ACCENT_GRIS;
  zone.querySelectorAll('.cell').forEach(function(el){
    el.style.background='';el.style.color='';el.style.fontWeight='';el.style.borderTop='';el.style.borderBottom='';
    var r=+el.dataset.r0,li=+el.dataset.li,ci=+el.dataset.ci;
    var cell=dispo.lignes[li]&&dispo.lignes[li].cellules[ci];if(!cell)return;
    var thead=r<eL;
    // Zébrage des lignes : rangées de données (tbody) ; « en-têtes » l'étend au thead.
    if(a.zebreLig!=='aucun'){
      if(thead){if(a.zebreLigEntetes&&((a.zebreLig==='paires')===((r+1)%2===0)))el.style.background=TEINTE_ZEBRE;}
      else if((a.zebreLig==='paires')===(((r-eL)+1)%2===0))el.style.background=TEINTE_ZEBRE;
    }
    // Zébrage des colonnes (miroir de nth-child : ordinal = rang de la cellule dans sa
    // rangée). Sans « en-têtes » : uniquement les cellules de données (td) du tbody.
    if(a.zebreCol!=='aucun'){
      var par=(a.zebreCol==='paires')===((ci+1)%2===0);
      if(a.zebreColEntetes){if(par)el.style.background=TEINTE_ZEBRE;}
      else if(!thead&&!cell.th&&par)el.style.background=TEINTE_ZEBRE;
    }
    // Fonds des en-têtes (el = scope row / colonnes de gauche ; ec = scope col / rangées du haut).
    if(cell.th&&cell.scope==='row'){var fe=fondDe(a.elFond);if(fe){el.style.background=fe.bg;el.style.color=fe.fg;}if(a.elGras)el.style.fontWeight='700';}
    else if(cell.th&&cell.scope==='col'){var fc=fondDe(a.ecFond);if(fc){el.style.background=fc.bg;el.style.color=fc.fg;}if(a.ecGras)el.style.fontWeight='700';}
    // Ligne de total = dernière rangée du tbody (D65) : toutes ses cellules.
    if(!thead&&r===N-1){var ft=fondDe(a.totalFond);if(ft){el.style.background=ft.bg;el.style.color=ft.fg;}if(a.totalGras)el.style.fontWeight='700';}
    // Bordures : haute sous la zone d'en-tête (ou en tête du tableau si aucun en-tête) ; basse en pied.
    if(a.bordureHaute){if(eL>0){if(r===eL-1)el.style.borderBottom='2px solid '+accLigne;}else if(r===0)el.style.borderTop='2px solid '+accLigne;}
    if(a.bordureBasse&&!thead&&r===N-1)el.style.borderBottom='2px solid '+accLigne;
  });}

// ---- Grille : rendu, matrice d'occupation visuelle, sélection ----
function construireOcc(){occ2=[];if(!dispo)return;for(var r=0;r<dispo.nbLignes;r++){occ2[r]=new Array(dispo.nbColonnes).fill(null);}
  dispo.lignes.forEach(function(lg){lg.cellules.forEach(function(c){for(var dr=0;dr<c.rowspan;dr++){for(var dc=0;dc<c.colspan;dc++){var rr=c.r0+dr,cc=c.c0+dc;if(occ2[rr])occ2[rr][cc]=c;}}});});}
function cellDeEl(el){return {li:+el.dataset.li,ci:+el.dataset.ci,r0:+el.dataset.r0,c0:+el.dataset.c0,rowspan:+el.dataset.rs,colspan:+el.dataset.cs};}
function domDeCell(c){return zone.querySelector('.cell[data-li="'+c.li+'"][data-ci="'+c.ci+'"]');}
function cellDom(c){var el=document.createElement(c.th?'th':'td');el.className='cell';el.dataset.li=c.li;el.dataset.ci=c.ci;
  el.dataset.r0=c.r0;el.dataset.c0=c.c0;el.dataset.rs=c.rowspan;el.dataset.cs=c.colspan;
  if(c.colspan>1)el.colSpan=c.colspan;if(c.rowspan>1)el.rowSpan=c.rowspan;
  poserInline(el,c.contenu);
  if(c.align&&c.align!=='left')el.style.textAlign=c.align;
  el.addEventListener('mousedown',function(ev){onCell(ev,c);});
  el.addEventListener('focus',function(){cellActive=c;if(!avantEdition&&modele)avantEdition=clone(modele);});
  el.addEventListener('blur',function(){commitTexte();});
  el.addEventListener('contextmenu',function(ev){
    var cr={rMin:c.r0,cMin:c.c0,rMax:c.r0+c.rowspan-1,cMax:c.c0+c.colspan-1};
    var dans=selection&&cr.rMin>=selection.rMin&&cr.rMax<=selection.rMax&&cr.cMin>=selection.cMin&&cr.cMax<=selection.cMax;
    if(!dans){ancre=c;cellActive=c;selection=etendre(cr);majEditable();marquer();}
    ouvrirMenu(ev,{lignes:true,colonnes:true,rMin:c.r0,rMax:c.r0+c.rowspan-1,cMin:c.c0,cMax:c.c0+c.colspan-1,fusionnee:(c.rowspan>1||c.colspan>1)});});
  el.addEventListener('input',function(){etat('');majModifie();});
  return el;}
function colLettre(n){var s='';n=n+1;while(n>0){var r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}return s;}
function rendre(){avantEdition=null;zone.textContent='';if(!dispo)return;construireOcc();
  var t=document.createElement('table');t.className='grille';
  var trh=document.createElement('tr');var coin=document.createElement('th');coin.className='coin';trh.appendChild(coin);
  for(var c=0;c<dispo.nbColonnes;c++){var ph=document.createElement('th');ph.className='poignee';ph.dataset.pcol=c;ph.textContent=colLettre(c);ph.title=TXT.tirerReordonner||'';(function(cc,el){el.addEventListener('mousedown',function(ev){onPoignee(ev,'col',cc);});el.addEventListener('click',function(){if(!aGlisseFait)selCol(cc);});el.addEventListener('contextmenu',function(ev){selCol(cc);ouvrirMenu(ev,{lignes:false,colonnes:true,rMin:0,rMax:dispo.nbLignes-1,cMin:cc,cMax:cc,fusionnee:false});});})(c,ph);trh.appendChild(ph);}
  t.appendChild(trh);
  dispo.lignes.forEach(function(lg,r){var tr=document.createElement('tr');
    var pl=document.createElement('td');pl.className='poignee pnum';pl.dataset.prow=r;pl.textContent=String(r+1);pl.title=TXT.tirerReordonner||'';(function(rr,el){el.addEventListener('mousedown',function(ev){onPoignee(ev,'row',rr);});el.addEventListener('click',function(){if(!aGlisseFait)selLigne(rr);});el.addEventListener('contextmenu',function(ev){selLigne(rr);ouvrirMenu(ev,{lignes:true,colonnes:false,rMin:rr,rMax:rr,cMin:0,cMax:dispo.nbColonnes-1,fusionnee:false});});})(r,pl);tr.appendChild(pl);
    lg.cellules.forEach(function(c){tr.appendChild(cellDom(c));});t.appendChild(tr);});
  zone.appendChild(t);
  cellActive=(selection&&occ2[selection.rMin])?occ2[selection.rMin][selection.cMin]:null;
  majEditable();marquer();stylerApercu();}
function majEditable(){var ed=!plage();zone.querySelectorAll('.cell').forEach(function(el){el.contentEditable=ed?'true':'false';});}
function marquer(){zone.querySelectorAll('.cell').forEach(function(el){
  var cr={rMin:+el.dataset.r0,cMin:+el.dataset.c0,rMax:+el.dataset.r0+ +el.dataset.rs-1,cMax:+el.dataset.c0+ +el.dataset.cs-1};
  var dans=selection&&cr.rMin>=selection.rMin&&cr.rMax<=selection.rMax&&cr.cMin>=selection.cMin&&cr.cMax<=selection.cMax;
  el.classList.toggle('sel',!!dans);});
  zone.querySelectorAll('.poignee[data-pcol]').forEach(function(el){var c=+el.dataset.pcol;el.classList.toggle('selh',!!(selection&&c>=selection.cMin&&c<=selection.cMax));});
  zone.querySelectorAll('.poignee[data-prow]').forEach(function(el){var r=+el.dataset.prow;el.classList.toggle('selh',!!(selection&&r>=selection.rMin&&r<=selection.rMax));});}

// ---- Sélection à la souris (clic, Maj+clic, glisser) ----
function onCell(ev,c){if(ev.button===2){return;}
  if(ev.shiftKey&&ancre){ev.preventDefault();var sel=window.getSelection&&window.getSelection();if(sel)sel.removeAllRanges();
    selection=etendre(union(rectCell(ancre),rectCell(c)));majEditable();marquer();return;}
  ancre=c;cellActive=c;selection=rectCell(c);majEditable();marquer();
  glisse={ancre:c,actif:false};document.addEventListener('mousemove',onDocMove,true);document.addEventListener('mouseup',onDocUp,true);}
function cellSousPointeur(ev){var t=document.elementFromPoint(ev.clientX,ev.clientY);var el=t&&t.closest?t.closest('.cell'):null;return el?cellDeEl(el):null;}
function onDocMove(ev){if(!glisse)return;var c=cellSousPointeur(ev);if(!c)return;
  if(!glisse.actif&&c.r0===glisse.ancre.r0&&c.c0===glisse.ancre.c0)return;
  glisse.actif=true;ev.preventDefault();var s=window.getSelection&&window.getSelection();if(s)s.removeAllRanges();
  selection=etendre(union(rectCell(glisse.ancre),rectCell(c)));majEditable();marquer();}
function onDocUp(){document.removeEventListener('mousemove',onDocMove,true);document.removeEventListener('mouseup',onDocUp,true);glisse=null;}
function selLigne(r){ancre=null;selection=etendre({rMin:r,cMin:0,rMax:r,cMax:dispo.nbColonnes-1});cellActive=occ2[r]?occ2[r][0]:null;majEditable();marquer();}
function selCol(c){ancre=null;selection=etendre({rMin:0,cMin:c,rMax:dispo.nbLignes-1,cMax:c});cellActive=occ2[0]?occ2[0][c]:null;majEditable();marquer();}

// ---- Navigation clavier (Tab / Maj+Tab / Entrée / flèches ; respecte les fusions) ----
function placerCaretFin(el){try{var r=document.createRange();r.selectNodeContents(el);r.collapse(false);var s=window.getSelection();s.removeAllRanges();s.addRange(r);}catch(e){}}
function caretAuDebut(el){var s=window.getSelection&&window.getSelection();if(!s||!s.rangeCount)return true;var g=s.getRangeAt(0);var r=document.createRange();r.selectNodeContents(el);try{r.setEnd(g.startContainer,g.startOffset);}catch(e){return true;}return r.toString().length===0;}
function caretALaFin(el){var s=window.getSelection&&window.getSelection();if(!s||!s.rangeCount)return true;var g=s.getRangeAt(0);var r=document.createRange();r.selectNodeContents(el);try{r.setStart(g.endContainer,g.endOffset);}catch(e){return true;}return r.toString().length===0;}
function insererSaut(){var s=window.getSelection&&window.getSelection();if(!s||!s.rangeCount)return;var r=s.getRangeAt(0);r.deleteContents();var br=document.createElement('br');r.insertNode(br);r.setStartAfter(br);r.collapse(true);s.removeAllRanges();s.addRange(r);majModifie();}
function bougerA(R,C){if(!dispo||!occ2)return;R=Math.max(0,Math.min(R,dispo.nbLignes-1));C=Math.max(0,Math.min(C,dispo.nbColonnes-1));var c=occ2[R]&&occ2[R][C];if(!c)return;
  ancre=c;cellActive=c;selection=rectCell(c);majEditable();marquer();var el=domDeCell(c);if(el){el.focus();placerCaretFin(el);}}
function navClavier(ev){if(ev.ctrlKey||ev.metaKey||ev.altKey)return;
  var el=ev.target&&ev.target.closest?ev.target.closest('.cell'):null;
  var c=el?cellDeEl(el):cellActive;if(!c)return;
  var editable=!!(el&&el.isContentEditable),k=ev.key;
  if(k==='Tab'){ev.preventDefault();
    if(ev.shiftKey){if(c.c0>0)bougerA(c.r0,c.c0-1);else if(c.r0>0)bougerA(c.r0-1,dispo.nbColonnes-1);}
    else{if(c.c0+c.colspan<dispo.nbColonnes)bougerA(c.r0,c.c0+c.colspan);else if(c.r0+1<dispo.nbLignes)bougerA(c.r0+1,0);}return;}
  if(k==='Enter'){if(ev.shiftKey){if(editable){ev.preventDefault();insererSaut();}return;}ev.preventDefault();bougerA(c.r0+c.rowspan,c.c0);return;}
  if(k==='ArrowRight'){if(editable&&!caretALaFin(el))return;ev.preventDefault();bougerA(c.r0,c.c0+c.colspan);return;}
  if(k==='ArrowLeft'){if(editable&&!caretAuDebut(el))return;ev.preventDefault();bougerA(c.r0,c.c0-1);return;}
  if(k==='ArrowDown'){if(editable&&!caretALaFin(el))return;ev.preventDefault();bougerA(c.r0+c.rowspan,c.c0);return;}
  if(k==='ArrowUp'){if(editable&&!caretAuDebut(el))return;ev.preventDefault();bougerA(c.r0-1,c.c0);return;}}
zone.addEventListener('keydown',navClavier);

// ---- Réordonner par glisser (poignées A/B/C — 1/2/3) + boutons « + » au survol ----
var aGlisseFait=false, dragP=null, plusCol=null, plusRow=null;
function onPoignee(ev,sens,idx){if(ev.button!==0)return;aGlisseFait=false;dragP={sens:sens,de:idx,actif:false,x:ev.clientX,y:ev.clientY};
  document.addEventListener('mousemove',onPoigneeMove,true);document.addEventListener('mouseup',onPoigneeUp,true);}
function poigneeSousPointeur(ev,sens){var t=document.elementFromPoint(ev.clientX,ev.clientY);if(!t||!t.closest)return null;var el=t.closest(sens==='col'?'.poignee[data-pcol]':'.poignee[data-prow]');if(!el)return null;return sens==='col'?+el.dataset.pcol:+el.dataset.prow;}
function onPoigneeMove(ev){if(!dragP)return;if(!dragP.actif&&Math.abs(ev.clientX-dragP.x)<5&&Math.abs(ev.clientY-dragP.y)<5)return;dragP.actif=true;aGlisseFait=true;ev.preventDefault();masquerPlus();indiquerDrop(dragP.sens,poigneeSousPointeur(ev,dragP.sens));}
function onPoigneeUp(ev){document.removeEventListener('mousemove',onPoigneeMove,true);document.removeEventListener('mouseup',onPoigneeUp,true);
  var d=dragP;dragP=null;retirerIndicateurDrop();
  if(d&&d.actif){var vers=poigneeSousPointeur(ev,d.sens);if(vers!==null&&vers!==d.de){op(d.sens==='col'?'deplacerColonne':'deplacerLigne',{de:d.de,vers:vers});}}
  setTimeout(function(){aGlisseFait=false;},0);}
function indiquerDrop(sens,idx){retirerIndicateurDrop();if(idx===null)return;var el=zone.querySelector(sens==='col'?'.poignee[data-pcol="'+idx+'"]':'.poignee[data-prow="'+idx+'"]');if(el)el.classList.add('drop');}
function retirerIndicateurDrop(){zone.querySelectorAll('.poignee.drop').forEach(function(el){el.classList.remove('drop');});}
function creerPlus(){plusCol=document.createElement('button');plusCol.type='button';plusCol.className='plusins';plusCol.textContent='+';plusCol.title=TXT.plusColonne||'';plusCol.style.display='none';plusCol.addEventListener('mousedown',function(e){e.preventDefault();});plusCol.addEventListener('click',function(){op('ajouterColonne',{pos:+plusCol.dataset.idx});});document.body.appendChild(plusCol);
  plusRow=document.createElement('button');plusRow.type='button';plusRow.className='plusins';plusRow.textContent='+';plusRow.title=TXT.plusLigne||'';plusRow.style.display='none';plusRow.addEventListener('mousedown',function(e){e.preventDefault();});plusRow.addEventListener('click',function(){op('ajouterLigne',{pos:+plusRow.dataset.idx});});document.body.appendChild(plusRow);}
function masquerPlus(){if(plusCol)plusCol.style.display='none';if(plusRow)plusRow.style.display='none';}
document.addEventListener('mousemove',function(ev){if(dragP||glisse){masquerPlus();return;}if(!plusCol)creerPlus();
  var t=ev.target;if(t===plusCol||t===plusRow)return;
  var pc=t&&t.closest?t.closest('.poignee[data-pcol]'):null;var pr=t&&t.closest?t.closest('.poignee[data-prow]'):null;
  if(pc){var rc=pc.getBoundingClientRect();var av=ev.clientX<rc.left+rc.width/2;plusCol.dataset.idx=av?+pc.dataset.pcol:+pc.dataset.pcol+1;plusCol.style.left=((av?rc.left:rc.right)-9)+'px';plusCol.style.top=(rc.top-9)+'px';plusCol.style.display='block';plusRow.style.display='none';return;}
  if(pr){var rr=pr.getBoundingClientRect();var a2=ev.clientY<rr.top+rr.height/2;plusRow.dataset.idx=a2?+pr.dataset.prow:+pr.dataset.prow+1;plusRow.style.top=((a2?rr.top:rr.bottom)-9)+'px';plusRow.style.left=(rr.left-9)+'px';plusRow.style.display='block';plusCol.style.display='none';return;}
  masquerPlus();});

// ---- Menu contextuel ----
var menu=null;
function fermerMenu(){if(!menu)return;if(menu.parentNode)menu.parentNode.removeChild(menu);menu=null;document.removeEventListener('mousedown',surMenuMousedown,true);document.removeEventListener('keydown',surMenuKey,true);window.removeEventListener('blur',fermerMenu);}
function surMenuMousedown(ev){if(menu&&menu.contains(ev.target))return;fermerMenu();}
function surMenuKey(ev){if(ev.key==='Escape'){ev.preventDefault();fermerMenu();}}
function itemMenu(txt,fn){var d=document.createElement('div');d.className='ctxitem';d.setAttribute('role','menuitem');d.textContent=txt;d.addEventListener('click',function(){fermerMenu();fn();});return d;}
function sepMenu(m){var d=document.createElement('div');d.className='ctxsep';m.appendChild(d);}
// Vrai si une cellule de la plage visuelle contient du texte (V2d : confirmation de
// suppression). <br> ignoré (une cellule « vide » avec sauts reste vide).
function texteDansPlage(rMin,cMin,rMax,cMax){recolter();if(!occ2)return false;var vu={};
  for(var r=rMin;r<=rMax;r++){for(var c=cMin;c<=cMax;c++){var ce=occ2[r]&&occ2[r][c];if(!ce)continue;var k=ce.li+'/'+ce.ci;if(vu[k])continue;vu[k]=1;
    var cell=modele.lignes[ce.li]&&modele.lignes[ce.li].cellules[ce.ci];if(cell&&String(cell.contenu).replace(/<br>/g,'').trim()!=='')return true;}}return false;}
function supprimer(nom,args,rMin,cMin,rMax,cMax){op(nom,args,texteDansPlage(rMin,cMin,rMax,cMax)?{confirmer:true}:null);}
function ouvrirMenu(ev,ctx){fermerMenu();ev.preventDefault();var m=document.createElement('div');m.className='ctxmenu';m.setAttribute('role','menu');
  m.addEventListener('contextmenu',function(e){e.preventDefault();});
  if(ctx.lignes){m.appendChild(itemMenu(TXT['ctx.ligneAvant'],function(){op('ajouterLigne',{pos:ctx.rMin});}));
    m.appendChild(itemMenu(TXT['ctx.ligneApres'],function(){op('ajouterLigne',{pos:ctx.rMax+1});}));
    m.appendChild(itemMenu(TXT['ctx.ligneSuppr'],function(){supprimer('supprimerLigne',{rMin:ctx.rMin,rMax:ctx.rMax},ctx.rMin,0,ctx.rMax,dispo.nbColonnes-1);}));}
  if(ctx.lignes&&ctx.colonnes)sepMenu(m);
  if(ctx.colonnes){m.appendChild(itemMenu(TXT['ctx.colAvant'],function(){op('ajouterColonne',{pos:ctx.cMin});}));
    m.appendChild(itemMenu(TXT['ctx.colApres'],function(){op('ajouterColonne',{pos:ctx.cMax+1});}));
    m.appendChild(itemMenu(TXT['ctx.colSuppr'],function(){supprimer('supprimerColonne',{cMin:ctx.cMin,cMax:ctx.cMax},0,ctx.cMin,dispo.nbLignes-1,ctx.cMax);}));}
  if(plage()){sepMenu(m);m.appendChild(itemMenu(TXT.fusionner,function(){op('fusionner',{rMin:selection.rMin,cMin:selection.cMin,rMax:selection.rMax,cMax:selection.cMax});}));}
  if(ctx.fusionnee){if(!plage())sepMenu(m);m.appendChild(itemMenu(TXT.scinder,function(){op('scinder',{rMin:ctx.rMin,cMin:ctx.cMin,rMax:ctx.rMax,cMax:ctx.cMax});}));}
  // En-têtes (F3, déplacés de la barre en menu contextuel) : le SENS est déduit de la
  // sélection (rangée du haut -> lignes ; colonne de gauche -> colonnes). « Retirer »
  // n'apparaît que si l'en-tête correspondant existe.
  var sens=sensEntete(selection);
  if(sens){sepMenu(m);m.appendChild(itemMenu(TXT.entete,onDefinirEntete));
    var aRetirer=sens==='lignes'?(modele.attrs.enteteLignes>0):(modele.attrs.enteteColonnes>0);
    if(aRetirer){m.appendChild(itemMenu(TXT.enteteRetirer,onRetirerEntete));}}
  document.body.appendChild(m);
  var vw=window.innerWidth||document.documentElement.clientWidth,vh=window.innerHeight||document.documentElement.clientHeight,rc=m.getBoundingClientRect();
  var x=ev.clientX,y=ev.clientY;if(x+rc.width>vw)x=Math.max(2,vw-rc.width-2);if(y+rc.height>vh)y=Math.max(2,vh-rc.height-2);
  m.style.left=x+'px';m.style.top=y+'px';menu=m;
  document.addEventListener('mousedown',surMenuMousedown,true);document.addEventListener('keydown',surMenuKey,true);window.addEventListener('blur',fermerMenu);}

// ---- Barre d'outils ----
function bouton(txt,fn,cls,titre){var b=document.createElement('button');b.type='button';b.textContent=txt;if(cls)b.className=cls;if(titre)b.title=titre;b.addEventListener('click',fn);return b;}
function groupe(label){var g=document.createElement('span');g.className='grp';if(label){var l=document.createElement('span');l.className='lbl';l.textContent=label;g.appendChild(l);}return g;}
// F1 : valide une éventuelle saisie de texte en cours, empile l'état PRÉ-op sur la
// pile d'annulation et vide la pile de rétablissement AVANT d'envoyer l'opération.
function op(nom,args,extra){if(modele){commitTexte();annuler.push(clone(modele));if(annuler.length>100)annuler.shift();retablir.length=0;}
  var msg={type:'operation',nom:nom,args:args,modele:modele};if(extra){for(var k in extra){msg[k]=extra[k];}}api.postMessage(msg);}
function construireBarre(){barre.textContent='';
  var ge=groupe(TXT.grpEdition);
  ctl.annuler=bouton(TXT.annuler,annulerAction,'',TXT['tip.annuler']);ge.appendChild(ctl.annuler);
  ctl.retablir=bouton(TXT.retablir,retablirAction,'',TXT['tip.retablir']);ge.appendChild(ctl.retablir);
  ge.appendChild(bouton(TXT.vider,function(){viderSel('contenu');},'',TXT['tip.vider']));
  ge.appendChild(bouton(TXT.effacerForme,function(){viderSel('forme');},'',TXT['tip.effacerForme']));
  barre.appendChild(ge);
  var ga=groupe(TXT.grpAlign);
  ga.appendChild(bouton(TXT.alignGauche,function(){aligner('left');},'',TXT['tip.alignGauche']));
  ga.appendChild(bouton(TXT.alignCentre,function(){aligner('center');},'',TXT['tip.alignCentre']));
  ga.appendChild(bouton(TXT.alignDroite,function(){aligner('right');},'',TXT['tip.alignDroite']));
  barre.appendChild(ga);
  var ret=bouton(TXT.retour,retourArticle,'',TXT['tip.retour']);barre.appendChild(ret);
  var enr=bouton(TXT.enregistrer,enregistrerTable,'principal',TXT['tip.enregistrer']);barre.appendChild(enr);
  var e=document.createElement('span');e.id='etat';e.setAttribute('role','status');barre.appendChild(e);
  var ind=document.createElement('span');ind.id='indic';ind.setAttribute('aria-live','polite');barre.appendChild(ind);
  construirePanneau();}
// « Sens » d'en-tête déduit de la sélection (F3) : rangée du haut pleine largeur ->
// 'lignes' (fixe enteteLignes) ; colonne de gauche pleine hauteur -> 'colonnes' (fixe
// enteteColonnes) ; sinon selon le bord touché ; null si la sélection ne touche ni le
// haut ni la gauche. Partagé par le menu contextuel et onDefinir/onRetirerEntete.
function sensEntete(s){if(!s||!dispo)return null;var nbC=dispo.nbColonnes,nbL=dispo.nbLignes;
  var pleineLargeur=(s.cMin===0&&s.cMax===nbC-1),pleineHauteur=(s.rMin===0&&s.rMax===nbL-1);
  // Bande de rangées touchant le haut (ligne entière) -> en-têtes de colonnes (haut).
  if(s.rMin===0&&pleineLargeur&&!(pleineHauteur&&nbC===1))return 'lignes';
  // Bande de colonnes touchant la gauche (colonne entière) -> en-têtes de lignes (gauche).
  if(s.cMin===0&&pleineHauteur)return 'colonnes';
  // Cellule/plage touchant le bord haut -> lignes ; touchant SEULEMENT le bord gauche -> colonnes.
  if(s.rMin===0&&!pleineLargeur)return 'lignes';
  if(s.cMin===0&&!pleineLargeur&&s.rMin!==0)return 'colonnes';
  return null;}
function onDefinirEntete(){var sens=sensEntete(selection);if(!sens){etat(TXT.rien);return;}var s=selection;
  if(sens==='lignes'){op('entete',{sens:'lignes',n:Math.min(2,s.rMax+1)});}
  else{op('entete',{sens:'colonnes',n:Math.min(2,s.cMax+1)});}}
// F3 : « Retirer l'en-tête » déduit le SENS de la sélection (même logique) et ne retire
// QUE cet en-tête (lignes OU colonnes, pas les deux).
function onRetirerEntete(){var sens=sensEntete(selection);if(!sens){etat(TXT.rien);return;}op('enteteRetirer',{sens:sens});}
function viderSel(mode){if(!selection){etat(TXT.rien);return;}op('vider',{rMin:selection.rMin,cMin:selection.cMin,rMax:selection.rMax,cMax:selection.cMax,mode:mode});}
function aligner(v){if(!selection){etat(TXT.rien);return;}op('aligner',{rMin:selection.rMin,cMin:selection.cMin,rMax:selection.rMax,cMax:selection.cMax,valeur:v});}

// ---- Panneau de mise en forme : 3 zones (Preset désactivé / En-têtes / Tableau) ----
// Les contrôles LISENT le modèle (majPanneau) et POSTENT au changement les opérations
// styleEntete/reglage (mêmes qu'appliquerOperationTable côté hôte) -> l'hôte met à jour
// les attrs -> renvoie « charger » -> aperçu live. Annuler/rétablir : via op() (empile
// l'état pré-op comme toute autre opération). Aucune injection HTML : DOM uniquement.
function fmt(s,v){return String(s||'').split('{0}').join(v);}
function fieldsetZone(legende){var fs=document.createElement('fieldset');fs.className='zone';var lg=document.createElement('legend');lg.textContent=legende;fs.appendChild(lg);return fs;}
function caseACocher(label,onCh){var l=document.createElement('label');l.className='opt';var i=document.createElement('input');i.type='checkbox';i.addEventListener('change',onCh);l.appendChild(i);l.appendChild(document.createTextNode(label));return {label:l,input:i};}
function groupeRadios(nom,options,onCh){var wrap=document.createElement('div');wrap.className='radios';var inputs={};
  options.forEach(function(o){var l=document.createElement('label');l.className='opt';var i=document.createElement('input');i.type='radio';i.name=nom;i.value=o[0];
    i.addEventListener('change',function(){if(i.checked)onCh(o[0]);});l.appendChild(i);l.appendChild(document.createTextNode(o[1]));wrap.appendChild(l);inputs[o[0]]=i;});
  return {wrap:wrap,inputs:inputs};}
function FONDS_OPT(){return [['aucun',TXT['fond.aucun']],['negatif',TXT['fond.negatif']],['couleur',TXT['fond.couleur']],['gris',TXT['fond.gris']]];}
function ZEBRES_OPT(){return [['aucun',TXT['zebre.aucun']],['paires',TXT['zebre.paires']],['impaires',TXT['zebre.impaires']]];}
function fondChoisi(rd){for(var k in rd.inputs){if(rd.inputs[k].checked)return k;}return 'aucun';}
function envoyerEntete(o){op('styleEntete',{cible:o.cible,gras:o.gras.checked,fond:fondChoisi(o.radios)});}
function sousBlocEntete(parent,titre,cible){var bloc=document.createElement('div');bloc.className='sousbloc';
  var h=document.createElement('div');h.className='sbtitre';h.textContent=titre;bloc.appendChild(h);
  var o={cible:cible,bloc:bloc};
  var g=caseACocher(TXT.gras,function(){envoyerEntete(o);});bloc.appendChild(g.label);o.gras=g.input;
  o.radios=groupeRadios('fond-'+cible,FONDS_OPT(),function(){envoyerEntete(o);});bloc.appendChild(o.radios.wrap);
  var hint=document.createElement('p');hint.className='note';hint.textContent=TXT['entetes.aucun'];hint.style.display='none';bloc.appendChild(hint);o.hint=hint;
  parent.appendChild(bloc);return o;}
function sousBlocZebre(parent,titre,champ,champEnt){var bloc=document.createElement('div');bloc.className='sousbloc';
  var h=document.createElement('div');h.className='sbtitre';h.textContent=titre;bloc.appendChild(h);
  var o={bloc:bloc};
  o.radios=groupeRadios(champ,ZEBRES_OPT(),function(v){op('reglage',{champ:champ,valeur:v});});bloc.appendChild(o.radios.wrap);
  var ent=caseACocher(TXT['zebre.entetes'],function(){op('reglage',{champ:champEnt,valeur:ent.input.checked});});bloc.appendChild(ent.label);o.entetes=ent.input;
  parent.appendChild(bloc);return o;}
function construirePanneau(){panneau.textContent='';panneau.setAttribute('aria-label',TXT['zone.styles']||'');
  // Zone 1 : Preset (désactivé — à implémenter plus tard).
  var z1=fieldsetZone(TXT['zone.preset']);
  var rp=groupeRadios('preset',[['1',fmt(TXT.modele,1)],['2',fmt(TXT.modele,2)],['3',fmt(TXT.modele,3)],['4',fmt(TXT.modele,4)]],function(){});
  Object.keys(rp.inputs).forEach(function(k){rp.inputs[k].disabled=true;});z1.appendChild(rp.wrap);
  var note=document.createElement('p');note.className='note';note.textContent=TXT['preset.bientot'];z1.appendChild(note);
  panneau.appendChild(z1);
  // Zone 2 : Styles des en-têtes (en-têtes de lignes / colonnes / ligne de total).
  var z2=fieldsetZone(TXT['zone.entetes']);
  ctl.el=sousBlocEntete(z2,TXT.entetesLignes,'lignes');
  ctl.ec=sousBlocEntete(z2,TXT.entetesColonnes,'colonnes');
  ctl.tot=sousBlocEntete(z2,TXT.total,'total');
  panneau.appendChild(z2);
  // Zone 3 : Styles du tableau (bordures + zébrage colonnes/lignes).
  var z3=fieldsetZone(TXT['zone.tableau']);
  var cbh=caseACocher(TXT.bordureHaute,function(){op('reglage',{champ:'bordureHaute',valeur:cbh.input.checked});});z3.appendChild(cbh.label);ctl.bordureHaute=cbh.input;
  var cbb=caseACocher(TXT.bordureBasse,function(){op('reglage',{champ:'bordureBasse',valeur:cbb.input.checked});});z3.appendChild(cbb.label);ctl.bordureBasse=cbb.input;
  ctl.zebreCol=sousBlocZebre(z3,TXT.zebreCol,'zebreCol','zebreColEntetes');
  ctl.zebreLig=sousBlocZebre(z3,TXT.zebreLig,'zebreLig','zebreLigEntetes');
  panneau.appendChild(z3);}
function cocherRadio(rd,val){for(var k in rd.inputs){rd.inputs[k].checked=(k===val);}}
// Un sous-bloc d'en-tête n'agit que si l'en-tête correspondant existe (el = colonnes de
// gauche -> enteteColonnes ; ec = rangées du haut -> enteteLignes) : sinon grisé + indice.
function majEntete(o,gras,fond,actif){o.gras.checked=!!gras;cocherRadio(o.radios,fond);
  o.gras.disabled=!actif;for(var k in o.radios.inputs){o.radios.inputs[k].disabled=!actif;}
  o.bloc.classList.toggle('inactif',!actif);if(o.hint)o.hint.style.display=actif?'none':'';}
function majZebre(o,val,ent){cocherRadio(o.radios,val);o.entetes.checked=!!ent;o.entetes.disabled=(val==='aucun');}
function majPanneau(){if(!modele||!ctl.el)return;var a=modele.attrs;
  majEntete(ctl.el,a.elGras,a.elFond,a.enteteColonnes>0);
  majEntete(ctl.ec,a.ecGras,a.ecFond,a.enteteLignes>0);
  majEntete(ctl.tot,a.totalGras,a.totalFond,true);
  ctl.bordureHaute.checked=!!a.bordureHaute;ctl.bordureBasse.checked=!!a.bordureBasse;
  majZebre(ctl.zebreCol,a.zebreCol,a.zebreColEntetes);
  majZebre(ctl.zebreLig,a.zebreLig,a.zebreLigEntetes);}
function etat(msg){var e=document.getElementById('etat');if(e)e.textContent=msg;}

// ---- Historique, garde non-enregistré, enregistrement, retour ----
// F1 : au blur d'une cellule, valide (empile) l'édition de texte. avantEdition = état
// pris au focus ; on n'empile QUE si le texte a réellement changé, puis on l'oublie.
function commitTexte(){if(!modele)return;recolter();
  if(avantEdition&&JSON.stringify(modele)!==JSON.stringify(avantEdition)){annuler.push(clone(avantEdition));if(annuler.length>100)annuler.shift();retablir.length=0;}
  avantEdition=null;majModifie();}
function restaurer(m){api.postMessage({type:'restaurer',modele:m});}
// Annuler / rétablir : « courant » = clone(modele) (après recolte + validation d'une
// saisie en cours par commitTexte) est poussé sur l'autre pile, puis on restaure l'état
// dépilé (l'hôte renvoie la disposition via un message « charger » sans i18n).
function annulerAction(){commitTexte();if(!annuler.length){return;}retablir.push(clone(modele));restaurer(annuler.pop());}
function retablirAction(){commitTexte();if(!retablir.length){return;}annuler.push(clone(modele));restaurer(retablir.pop());}
function estModifie(){if(!modele||!modeleEnregistre)return false;recolter();return JSON.stringify(modele)!==JSON.stringify(modeleEnregistre);}
function majModifie(){var m=estModifie();var ind=document.getElementById('indic');if(ind){ind.textContent=m?' ●':'';ind.title=m?(TXT.nonEnregistre||''):'';}
  if(m!==dernierModifie){dernierModifie=m;api.postMessage({type:'modifie',modifie:m});}}
function enregistrerTable(){recolter();enrEnCours=clone(modele);api.postMessage({type:'enregistrer',modele:modele});}
function retourArticle(){recolter();api.postMessage({type:'retourArticle',modifie:estModifie(),modele:modele});}

// ---- Collage d'un tableau (Ctrl+V) : HTML -> table (fusions préservées), sinon TSV ----
function collerDepuisPresse(ev){var cd=ev.clipboardData||window.clipboardData;if(!cd)return;
  var html=cd.getData?cd.getData('text/html'):'';var texte=cd.getData?cd.getData('text/plain'):'';
  if(!/<table/i.test(html)&&!/[\t\n]/.test(texte))return;   // texte simple d'une cellule -> collage natif
  ev.preventDefault();var aR=selection?selection.rMin:0,aC=selection?selection.cMin:0;
  op('coller',{ancreR:aR,ancreC:aC,html:html,texte:texte});}
zone.addEventListener('paste',collerDepuisPresse);

// ---- Raccourcis clavier globaux ----
try{document.execCommand('styleWithCSS',false,false);}catch(e){}
document.addEventListener('keydown',function(ev){if(!(ev.ctrlKey||ev.metaKey))return;var k=(ev.key||'').toLowerCase();
  if(k==='b'){ev.preventDefault();try{document.execCommand('bold');}catch(e){}majModifie();}
  else if(k==='i'){ev.preventDefault();try{document.execCommand('italic');}catch(e){}majModifie();}
  else if(k==='z'&&!ev.shiftKey){ev.preventDefault();annulerAction();}
  else if(k==='y'||(k==='z'&&ev.shiftKey)){ev.preventDefault();retablirAction();}
  else if(k==='s'){ev.preventDefault();enregistrerTable();}});

window.addEventListener('message',function(ev){var msg=ev.data||{};
  if(msg.type==='charger'){
    modele=msg.modele;dispo=msg.disposition;if(msg.accent!==undefined)accent=msg.accent;if(msg.teintes)teintes=msg.teintes;
    if(msg.i18n){TXT=msg.i18n;
      modeleEnregistre=clone(modele);annuler=[];retablir=[];avantEdition=null;dernierModifie=false;
      aide.textContent=TXT.aide||'';construireBarre();}
    // F1 : un « charger » sans i18n = résultat d'une opération / d'une annulation-
    // rétablissement. On NE réinitialise PLUS l'historique ici (c'était la cause de
    // « Annuler ne fait rien ») : les piles vivent uniquement dans op / commitTexte.
    selection=clampSel(selection);ancre=null;rendre();majPanneau();etat('');majModifie();}
  else if(msg.type==='enregistre'){modeleEnregistre=enrEnCours||clone(modele);etat(TXT.enregistre||'');majModifie();}
  else if(msg.type==='erreur'){etat('⚠ '+msg.message);}});
api.postMessage({type:'pret'});
})();
