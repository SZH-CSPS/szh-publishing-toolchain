(function(){
'use strict';
var api=acquireVsCodeApi();
var modele=null, dispo=null, occ2=null, TXT={}, accent='', accentMode='gris';
var selection=null, ancre=null, cellActive=null, premierChargement=true, ctl={};
// Historique (D60, F1) : deux piles d'états du MODÈLE, dans la webview. Chaque
// opération de structure empile l'état PRÉ-op (voir op) ; les éditions de texte sont
// empilées au blur d'une cellule (avantEdition = instantané pris au focus).
// modeleEnregistre = état écrit sur disque (garde non-enregistré).
var annuler=[], retablir=[], avantEdition=null, modeleEnregistre=null, enrEnCours=null, dernierModifie=false;
var glisse=null;   // sélection par glisser : { ancre:cellule, actif:bool }
var barre=document.getElementById('barre'), zone=document.getElementById('zone'), aide=document.getElementById('aide');
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

// ---- Teintes de l'aperçu (mêmes valeurs que print.css / --szh-accent) ----
function hx(h){h=String(h||'').replace('#','');if(h.length===3){h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];}return [parseInt(h.slice(0,2),16)||0,parseInt(h.slice(2,4),16)||0,parseInt(h.slice(4,6),16)||0];}
function hx2(v){var s=Math.max(0,Math.min(255,Math.round(v))).toString(16);return s.length<2?'0'+s:s;}
function accBrut(){return (accentMode==='couleur'&&accent)?accent:null;}
// Teintes IDENTIQUES à print.css/accent-css.py (aperçu fidèle, RV3) : clair = 18% couleur
// + 82% blanc ; foncé = assombri jusqu'à luminance <= 0.16 (contraste blanc >= 4.5:1).
function lum(r){var f=function(c){c=c/255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);};return 0.2126*f(r[0])+0.7152*f(r[1])+0.0722*f(r[2]);}
function clairAccent(hex){var r=hx(hex);return '#'+hx2(r[0]*0.18+255*0.82)+hx2(r[1]*0.18+255*0.82)+hx2(r[2]*0.18+255*0.82);}
function fonceAccent(hex){var r=hx(hex);if(lum(r)<=0.16)return hex;var bas=0,haut=1;for(var i=0;i<24;i++){var k=(bas+haut)/2;if(lum([r[0]*k,r[1]*k,r[2]*k])>0.16)haut=k;else bas=k;}return '#'+hx2(r[0]*bas)+hx2(r[1]*bas)+hx2(r[2]*bas);}
// --szh-accent-clair : #ededed (gris) OU clair(couleur annuelle) si aperçu « couleur ».
function fondVarClair(useColor){if(!useColor)return '#ededed';var a=accBrut();return a?clairAccent(a):'#ededed';}
// --szh-accent-fonce : #4a4a4a (gris) OU foncé(couleur).   --szh-accent : #9a9a9a OU couleur.
function fondVarFonce(){var a=accBrut();return a?fonceAccent(a):'#4a4a4a';}
function accentVar(){var a=accBrut();return a?a:'#9a9a9a';}
function styleEnt(el,st){if(st==='gras'){el.style.fontWeight='700';}else if(st==='fond'){el.style.background=fondVarClair(true);el.style.fontWeight='700';}else if(st==='negatif'){el.style.background=fondVarFonce();el.style.color='#ffffff';el.style.fontWeight='700';}}
function stylerApercu(){if(!dispo||!modele)return;var a=modele.attrs;zone.querySelectorAll('.cell').forEach(function(el){
  el.style.background='';el.style.color='';el.style.fontWeight='';el.style.borderBottom='';el.style.borderTop='';
  var r=+el.dataset.r0,c=+el.dataset.c0,rs=+el.dataset.rs,li=+el.dataset.li,lg=dispo.lignes[li];
  var entL=r<a.enteteLignes,entC=(c<a.enteteColonnes)&&!entL,tot=lg&&lg.total,zc=a.zebreTeinte==='couleur';
  if(a.zebre==='lignes'&&!entL&&!entC&&!tot){var di=r-a.enteteLignes;if(di>=0&&di%2===1)el.style.background=zc?fondVarClair(true):'#f2f2f2';}
  else if(a.zebre==='colonnes'&&!entC&&!entL&&!tot){var dc=c-a.enteteColonnes;if(dc>=0&&dc%2===1)el.style.background=zc?fondVarClair(true):'#f2f2f2';}
  if(entL){styleEnt(el,a.enteteLigneStyle);}else if(entC){styleEnt(el,a.enteteColonneStyle);}
  if(tot){el.style.background=fondVarClair(lg.teinte==='couleur');if(lg.gras==='oui')el.style.fontWeight='700';}
  if(a.separateurs!=='non'){el.style.borderBottom='1px solid '+(a.separateurs==='couleur'?accentVar():'#cccccc');}
  if(a.bordureHaute==='oui'){if(a.enteteLignes>0&&r===a.enteteLignes-1)el.style.borderBottom='2px solid '+accentVar();else if(a.enteteLignes===0&&r===0)el.style.borderTop='2px solid '+accentVar();}
  if(a.bordureBasse==='oui'&&(r+rs===dispo.nbLignes))el.style.borderBottom='2px solid '+accentVar();
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
  el.addEventListener('contextmenu',function(ev){ouvrirMenu(ev,{lignes:true,colonnes:true,rMin:c.r0,rMax:c.r0+c.rowspan-1,cMin:c.c0,cMax:c.c0+c.colspan-1,fusionnee:(c.rowspan>1||c.colspan>1)});});
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
  barreT2(barre);
  var ret=bouton(TXT.retour,retourArticle,'',TXT['tip.retour']);barre.appendChild(ret);
  var enr=bouton(TXT.enregistrer,enregistrerTable,'principal',TXT['tip.enregistrer']);barre.appendChild(enr);
  var e=document.createElement('span');e.id='etat';e.setAttribute('role','status');barre.appendChild(e);
  var ind=document.createElement('span');ind.id='indic';ind.setAttribute('aria-live','polite');barre.appendChild(ind);}
function selCtrl(parent,label,options,onCh,titre){var g=groupe('');var l=document.createElement('span');l.className='lbl';l.textContent=label;g.appendChild(l);var s=document.createElement('select');if(titre)s.title=titre;options.forEach(function(o){var op=document.createElement('option');op.value=o[0];op.textContent=o[1];s.appendChild(op);});s.addEventListener('change',function(){onCh(s.value);});g.appendChild(s);parent.appendChild(g);return s;}
function STYLES(){return [['normal',TXT['st.normal']],['gras',TXT['st.gras']],['negatif',TXT['st.negatif']],['fond',TXT['st.fond']]];}
function onDefinirEntete(){if(!selection){etat(TXT.rien);return;}var s=selection,nbC=dispo.nbColonnes,nbL=dispo.nbLignes;
  if(s.rMin===0&&(s.cMax-s.cMin+1)===nbC&&!(s.rMax===nbL-1&&nbC===1)){op('entete',{sens:'lignes',n:Math.min(2,s.rMax+1)});}
  else if(s.cMin===0&&(s.rMax-s.rMin+1)===nbL){op('entete',{sens:'colonnes',n:Math.min(2,s.cMax+1)});}
  else if(s.rMin===0){op('entete',{sens:'lignes',n:Math.min(2,s.rMax+1)});}
  else if(s.cMin===0){op('entete',{sens:'colonnes',n:Math.min(2,s.cMax+1)});}
  else{etat(TXT.rien);}}
function appliquerTotal(){if(!selection){etat(TXT.rien);return;}op('total',{rMin:selection.rMin,rMax:selection.rMax,teinte:ctl.total.value,gras:ctl.totalGras.checked?'oui':'non'});}
function viderSel(mode){if(!selection){etat(TXT.rien);return;}op('vider',{rMin:selection.rMin,cMin:selection.cMin,rMax:selection.rMax,cMax:selection.cMax,mode:mode});}
function aligner(v){if(!selection){etat(TXT.rien);return;}op('aligner',{rMin:selection.rMin,cMin:selection.cMin,rMax:selection.rMax,cMax:selection.cMax,valeur:v});}
function barreT2(barre){
  var ge=groupe(TXT.grpEntetes);
  ge.appendChild(bouton(TXT.entete,onDefinirEntete,'',TXT['tip.entete']));
  ge.appendChild(bouton(TXT.enteteRetirer,function(){op('enteteRetirer',{});},'',TXT['tip.enteteRetirer']));
  barre.appendChild(ge);
  ctl.styleLigne=selCtrl(barre,TXT.styleLigne,STYLES(),function(v){op('styleEntete',{cible:'ligne',valeur:v});},TXT['tip.styleEntete']);
  ctl.styleColonne=selCtrl(barre,TXT.styleColonne,STYLES(),function(v){op('styleEntete',{cible:'colonne',valeur:v});},TXT['tip.styleEntete']);
  var etiq=groupe('');var le=document.createElement('span');le.className='lbl';le.textContent=TXT.grpStyles;etiq.appendChild(le);barre.appendChild(etiq);
  ctl.zebre=selCtrl(barre,TXT.zebre,[['non',TXT['zebre.non']],['lignes',TXT['zebre.lignes']],['colonnes',TXT['zebre.colonnes']]],function(v){op('reglage',{champ:'zebre',valeur:v});},TXT['tip.zebre']);
  ctl.zebreTeinte=selCtrl(barre,TXT.teinte,[['gris',TXT['teinte.gris']],['couleur',TXT['teinte.couleur']]],function(v){op('reglage',{champ:'zebreTeinte',valeur:v});});
  ctl.separateurs=selCtrl(barre,TXT.separateurs,[['non',TXT['sep.non']],['gris',TXT['sep.gris']],['couleur',TXT['sep.couleur']]],function(v){op('reglage',{champ:'separateurs',valeur:v});},TXT['tip.separateurs']);
  ctl.bordureHaute=selCtrl(barre,TXT.bordureHaute,[['non',TXT.non],['oui',TXT.oui]],function(v){op('reglage',{champ:'bordureHaute',valeur:v});});
  ctl.bordureBasse=selCtrl(barre,TXT.bordureBasse,[['non',TXT.non],['oui',TXT.oui]],function(v){op('reglage',{champ:'bordureBasse',valeur:v});});
  ctl.total=selCtrl(barre,TXT.total,[['non',TXT['total.non']],['gris',TXT['total.gris']],['couleur',TXT['total.couleur']]],function(v){appliquerTotal();},TXT['tip.total']);
  var gg=groupe('');var lab=document.createElement('label');lab.style.display='inline-flex';lab.style.alignItems='center';lab.style.gap='.25em';var cb=document.createElement('input');cb.type='checkbox';ctl.totalGras=cb;cb.addEventListener('change',appliquerTotal);lab.appendChild(cb);lab.appendChild(document.createTextNode(TXT['total.gras']));gg.appendChild(lab);barre.appendChild(gg);
  ctl.accent=selCtrl(barre,TXT.accent,[['gris',TXT['accent.gris']],['couleur',TXT['accent.couleur']]],function(v){accentMode=v;stylerApercu();},TXT['tip.accent']);
  if(!accent){ctl.accent.title=TXT['accent.aucune'];}
}
function majT2(){if(!modele||!ctl.zebre)return;var a=modele.attrs;
  ctl.styleLigne.value=a.enteteLigneStyle;ctl.styleColonne.value=a.enteteColonneStyle;
  ctl.zebre.value=a.zebre;ctl.zebreTeinte.value=a.zebreTeinte;ctl.separateurs.value=a.separateurs;
  ctl.bordureHaute.value=a.bordureHaute;ctl.bordureBasse.value=a.bordureBasse;ctl.accent.value=accentMode;}
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
    modele=msg.modele;dispo=msg.disposition;if(msg.accent!==undefined)accent=msg.accent;
    if(msg.i18n){TXT=msg.i18n;
      if(premierChargement){accentMode=accent?'couleur':'gris';premierChargement=false;}
      modeleEnregistre=clone(modele);annuler=[];retablir=[];avantEdition=null;dernierModifie=false;
      aide.textContent=TXT.aide||'';construireBarre();}
    // F1 : un « charger » sans i18n = résultat d'une opération / d'une annulation-
    // rétablissement. On NE réinitialise PLUS l'historique ici (c'était la cause de
    // « Annuler ne fait rien ») : les piles vivent uniquement dans op / commitTexte.
    selection=clampSel(selection);ancre=null;rendre();majT2();etat('');majModifie();}
  else if(msg.type==='enregistre'){modeleEnregistre=enrEnCours||clone(modele);etat(TXT.enregistre||'');majModifie();}
  else if(msg.type==='erreur'){etat('⚠ '+msg.message);}});
api.postMessage({type:'pret'});
})();
