(function(){
'use strict';
var api=acquireVsCodeApi();
var modele=null, dispo=null, occ2=null, TXT={}, accent='', teintes={}, PRESETS=[];
var selection=null, ancre=null, cellActive=null, ctl={};
// Historique : deux piles d'états du modèle. Une opération de structure y empile l'état
// d'avant, une édition de texte est empilée à la perte de focus de la cellule,
// `avantEdition` étant l'instantané pris à la prise de focus. `modeleEnregistre` est
// l'état écrit sur le disque.
var annuler=[], retablir=[], avantEdition=null, modeleEnregistre=null, enrEnCours=null, dernierModifie=false;
// sélection par glisser : { ancre:cellule, actif:bool }
var glisse=null;
var barre=document.getElementById('barre'), zone=document.getElementById('zone'), panneau=document.getElementById('panneau');
var boiteChamps=document.getElementById('champs'), champs={};
function clone(o){return JSON.parse(JSON.stringify(o));}
function dechap(s){return String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'\"').replace(/&#x27;/g,"'").replace(/&#39;/g,"'").replace(/&amp;/g,'&');}
function echap(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function echapAttr(s){return echap(s).replace(/"/g,'&quot;');}
// `images` (facultatif) : ce que l'hôte a lu de chaque <img> du contenu, dans l'ordre
// (disposition -> imagesPourAffichage) ; `c` : la cellule, pour le clic droit sur l'image.
function poserInline(el,contenu,images,c){el.textContent='';var re=/<\/?(?:strong|em)>|<br>|<img\b[^>]*>/g,dernier=0,m,pile=[el],nImg=0;
  while((m=re.exec(contenu))!==null){var txt=contenu.slice(dernier,m.index);if(txt){pile[pile.length-1].appendChild(document.createTextNode(dechap(txt)));}
    dernier=re.lastIndex;var tg=m[0];
    if(tg.indexOf('<img')===0){pile[pile.length-1].appendChild(vignetteImage(tg,(images||[])[nImg],c,nImg));nImg++;}
    else if(tg==='<br>'){pile[pile.length-1].appendChild(document.createElement('br'));}
    else if(tg==='<strong>'){var s=document.createElement('strong');pile[pile.length-1].appendChild(s);pile.push(s);}
    else if(tg==='<em>'){var e=document.createElement('em');pile[pile.length-1].appendChild(e);pile.push(e);}
    else if(pile.length>1){pile.pop();}}
  var reste=contenu.slice(dernier);if(reste){pile[pile.length-1].appendChild(document.createTextNode(dechap(reste)));}}
function inlineDeNoeud(n){var out='';n.childNodes.forEach(function(ch){
  if(ch.nodeType===3){out+=echap(ch.nodeValue);}
  else if(ch.nodeType===1){var tg=ch.tagName.toLowerCase();
    // L'image rendue en vignette rend sa balise telle que l'hôte l'a écrite : ni l'aperçu
    // (data:) ni la pastille n'entrent jamais dans le fichier.
    if(ch.dataset&&ch.dataset.balise){out+=ch.dataset.balise;}
    // Une <img> nue vient d'un collage natif dans la cellule : son src d'origine, tel quel.
    else if(tg==='img'){var s0=ch.getAttribute('src')||'';if(s0&&!/^[a-z]+:/i.test(s0)){out+='<img src="'+echapAttr(s0)+'" alt="'+echapAttr(ch.getAttribute('alt')||'')+'">';}}
    else if(tg==='br'){out+='<br>';}
    else if(tg==='strong'||tg==='b'){out+='<strong>'+inlineDeNoeud(ch)+'</strong>';}
    else if(tg==='em'||tg==='i'){out+='<em>'+inlineDeNoeud(ch)+'</em>';}
    else{out+=inlineDeNoeud(ch);}}});return out;}
function recolter(){if(!modele)return;recolterChamps();zone.querySelectorAll('[data-li]').forEach(function(el){
  var li=+el.dataset.li,ci=+el.dataset.ci;if(modele.lignes[li]&&modele.lignes[li].cellules[ci]){modele.lignes[li].cellules[ci].contenu=inlineDeNoeud(el).trim();}});}
function rectCell(c){return {rMin:c.r0,cMin:c.c0,rMax:c.r0+c.rowspan-1,cMax:c.c0+c.colspan-1};}
function union(a,b){return {rMin:Math.min(a.rMin,b.rMin),cMin:Math.min(a.cMin,b.cMin),rMax:Math.max(a.rMax,b.rMax),cMax:Math.max(a.cMax,b.cMax)};}
function chevauche(a,b){return !(a.rMax<b.rMin||a.rMin>b.rMax||a.cMax<b.cMin||a.cMin>b.cMax);}
function etendre(rect){var change=true;while(change){change=false;dispo.lignes.forEach(function(lg){lg.cellules.forEach(function(c){
  var cr=rectCell(c);if(chevauche(cr,rect)){var nr=union(rect,cr);if(nr.rMin!==rect.rMin||nr.cMin!==rect.cMin||nr.rMax!==rect.rMax||nr.cMax!==rect.cMax){rect=nr;change=true;}}});});}return rect;}
function plage(){if(!selection||!occ2)return false;var vu={},n=0;
  for(var r=selection.rMin;r<=selection.rMax;r++){for(var c=selection.cMin;c<=selection.cMax;c++){
    var ce=occ2[r]&&occ2[r][c];if(!ce)continue;var k=ce.li+'/'+ce.ci;if(vu[k])continue;vu[k]=1;if(++n>1)return true;}}
  return false;}
function clampSel(s){if(!s||!dispo)return null;var rMax=Math.min(s.rMax,dispo.nbLignes-1),cMax=Math.min(s.cMax,dispo.nbColonnes-1);if(s.rMin>rMax||s.cMin>cMax||s.rMin<0||s.cMin<0)return null;return etendre({rMin:s.rMin,cMin:s.cMin,rMax:rMax,cMax:cMax});}

// ---- Teintes de l'aperçu, aux mêmes valeurs que print.css et couleurs.css ----

function accBrut(){return accent||null;}
// Les teintes sont lues, jamais recalculées : l'hôte les prend dans out/.szh-accent.css,
// le fichier que le pipeline écrit et que WeasyPrint applique. Réimplémenter ici une
// formule de contraste ferait diverger l'aperçu du PDF. Sans valeur reçue, faute de
// compilation, on retombe sur les gris neutres de print.css.
function clairAccent(){return teintes.clair||null;}
function fonceAccent(){return teintes.fonce||null;}
var GRIS_CLAIR='#e6e6e6', TEINTE_ZEBRE='#f2f2f2', ACCENT_GRIS='#9a9a9a';
function fondDe(v){
  if(v==='negatif'){return {bg:fonceAccent()||'#4a4a4a',fg:'#ffffff'};}
  if(v==='couleur'){return {bg:clairAccent()||'#ededed',fg:'#000000'};}
  if(v==='gris'){return {bg:GRIS_CLAIR,fg:'#000000'};}
  return null;}
// Aperçu des styles de niveau tableau, en miroir de print.css et posé en style en ligne
// sur les .cell ; le fichier écrit, lui, reste piloté par le modèle. L'ordre suit
// print.css — zébrage, en-têtes, total, bordures — le dernier l'emportant.
function stylerApercu(){if(!dispo||!modele)return;var a=modele.attrs;
  var eL=a.enteteLignes,N=dispo.nbLignes;
  var accLigne=teintes.filet||accBrut()||ACCENT_GRIS;
  zone.querySelectorAll('.cell').forEach(function(el){
    el.style.background='';el.style.color='';el.style.fontWeight='';el.style.borderTop='';el.style.borderBottom='';
    var r=+el.dataset.r0,li=+el.dataset.li,ci=+el.dataset.ci;
    var cell=dispo.lignes[li]&&dispo.lignes[li].cellules[ci];if(!cell)return;
    var thead=r<eL;
    if(a.zebreLig!=='aucun'){
      if(thead){if(a.zebreLigEntetes&&((a.zebreLig==='paires')===((r+1)%2===0)))el.style.background=TEINTE_ZEBRE;}
      else if((a.zebreLig==='paires')===(((r-eL)+1)%2===0))el.style.background=TEINTE_ZEBRE;
    }
    // En miroir de nth-child : l'ordinal est le rang de la cellule dans sa rangée.
    if(a.zebreCol!=='aucun'){
      var par=(a.zebreCol==='paires')===((ci+1)%2===0);
      if(a.zebreColEntetes){if(par)el.style.background=TEINTE_ZEBRE;}
      else if(!thead&&!cell.th&&par)el.style.background=TEINTE_ZEBRE;
    }
    /* Titre de section : print.css le style via th[scope^="row"] — même miroir ici. */
    if(cell.th&&(cell.scope==='row'||cell.section)){var fe=fondDe(a.elFond);if(fe){el.style.background=fe.bg;el.style.color=fe.fg;}if(a.elGras)el.style.fontWeight='700';}
    else if(cell.th&&cell.scope==='col'){var fc=fondDe(a.ecFond);if(fc){el.style.background=fc.bg;el.style.color=fc.fg;}if(a.ecGras)el.style.fontWeight='700';}
    if(!thead&&r===N-1){var ft=fondDe(a.totalFond);if(ft){el.style.background=ft.bg;el.style.color=ft.fg;}if(a.totalGras)el.style.fontWeight='700';}
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
  poserInline(el,c.contenu,c.images,c);
  if(c.align&&c.align!=='left')el.style.textAlign=c.align;
  el.addEventListener('mousedown',function(ev){onCell(ev,c);});
  el.addEventListener('focus',function(){cellActive=c;if(!avantEdition&&modele)avantEdition=clone(modele);});
  el.addEventListener('blur',function(){commitTexte();});
  el.addEventListener('contextmenu',function(ev){
    var cr={rMin:c.r0,cMin:c.c0,rMax:c.r0+c.rowspan-1,cMax:c.c0+c.colspan-1};
    var dans=selection&&cr.rMin>=selection.rMin&&cr.rMax<=selection.rMax&&cr.cMin>=selection.cMin&&cr.cMax<=selection.cMax;
    if(!dans){ancre=c;cellActive=c;selection=etendre(cr);majEditable();marquer();}
    // Clic droit SUR une image : ses deux gestes en tête du menu ; ailleurs dans la
    // cellule, « Insérer une image… ».
    var vi=vignetteSous(ev.target);
    ouvrirMenu(ev,{lignes:true,colonnes:true,rMin:c.r0,rMax:c.r0+c.rowspan-1,cMin:c.c0,cMax:c.c0+c.colspan-1,fusionnee:(c.rowspan>1||c.colspan>1),
      cellule:c,image:vi?+vi.dataset.n:null});});
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

// ---- Images des cellules ----
//
// Une <img> du contenu devient une vignette non éditable qui garde sa balise d'origine
// (data-balise), relue telle quelle par inlineDeNoeud : l'aperçu n'entre jamais dans le
// fichier. L'aperçu voyage en data: (l'hôte le lit, lib/table-images.js), la webview
// n'ayant aucune racine locale autorisée ; faute de fichier, un cadre le dit en toutes
// lettres, jamais une image cassée muette. La pastille rouge suit le verdict que l'hôte a
// calculé (disposition -> images[].sansAlternative) : elle tombe au rechargement qui suit
// la saisie du texte alternatif.
var APERCUS={};        // src relatif à l'article -> { etat:'ok'|'introuvable'|'indisponible', uri }
var saisieApres=null;  // { li, ci, n } : image tout juste insérée, dont la saisie s'ouvre au rechargement
var saisie=null;       // la boîte « Texte alternatif » ouverte
function vignetteSous(t){if(!t||!t.classList)return null;if(t.classList.contains('cimg'))return t;return t.closest?t.closest('.cimg'):null;}
function cadreAbsent(w,etat,src){var f=document.createElement('span');f.className='cimg-absente';f.setAttribute('role','img');
  var msg=fmt(TXT[etat==='indisponible'?'image.indisponible':'image.introuvable'],src||'?');f.setAttribute('aria-label',msg);
  f.appendChild(SZH.icone('attention'));var t=document.createElement('span');t.textContent=msg;f.appendChild(t);w.appendChild(f);}
function vignetteImage(balise,info,c,n){info=info||{};
  var w=document.createElement('span');w.className='cimg';w.contentEditable='false';
  w.dataset.balise=balise;w.dataset.n=n;w.dataset.src=info.src||'';w.title=info.src||'';
  var ap=APERCUS[info.src||''];
  if(ap&&ap.etat==='ok'&&ap.uri){var img=document.createElement('img');img.src=ap.uri;img.alt=info.alt||'';
    // Un aperçu illisible (fichier tronqué, format mal nommé) : le même cadre explicite.
    img.addEventListener('error',function(){retirerNoeud(img);cadreAbsent(w,'indisponible',info.src);});
    w.appendChild(img);}
  else{cadreAbsent(w,ap?ap.etat:'introuvable',info.src);}
  if(info.sansAlternative){var a=document.createElement('span');a.className='cimg-alerte';
    a.title=TXT['image.altManquant']||'';a.setAttribute('role','img');a.setAttribute('aria-label',TXT['image.altManquant']||'');
    a.appendChild(SZH.icone('attention'));w.appendChild(a);}
  return w;}
function imageDe(li,ci,n){var lg=dispo&&dispo.lignes[li];var c=lg&&lg.cellules[ci];return c&&c.images?c.images[n]:null;}
// Remplacer ou insérer : l'hôte ouvre le sélecteur de fichier, copie l'image dans media/
// sous un nom libre et répond par son src (TABLE_IMAGE_CHOISIE) ; l'opération part alors
// d'ici, pour entrer dans l'historique comme toute autre.
function choisirImage(action,c,n){fermerMenu();recolter();
  api.postMessage({type:SZH.MSG.TABLE_IMAGE_CHOISIR,action:action,li:c.li,ci:c.ci,n:n||0});}
function imageChoisie(msg){if(!msg||!msg.src||!modele)return;
  if(msg.apercu)APERCUS[msg.src]=msg.apercu;
  var li=+msg.li,ci=+msg.ci;
  if(msg.action==='inserer'){var cell=dispo&&dispo.lignes[li]&&dispo.lignes[li].cellules[ci];
    saisieApres={li:li,ci:ci,n:cell&&cell.images?cell.images.length:0};
    op('imageInserer',{li:li,ci:ci,src:msg.src});}
  else{op('imageRemplacer',{li:li,ci:ci,n:+msg.n||0,src:msg.src});}}
function retirerNoeud(n){if(!n)return;if(n.remove)n.remove();else if(n.parentNode)n.parentNode.removeChild(n);}
function fermerSaisie(){retirerNoeud(saisie);saisie=null;}
function radioSaisie(parent,libelle){var l=document.createElement('label');l.className='szh-opt';var i=document.createElement('input');i.type='radio';i.name='role-alt-cellule';
  l.appendChild(i);var s=document.createElement('span');s.className='txt';s.textContent=libelle||'';l.appendChild(s);parent.appendChild(l);return i;}
// La saisie reprend les mots du gestionnaire des médias (img.role.*, img.alt) : une image
// se décrit de la même façon, qu'elle soit dans le texte ou dans une cellule.
function ouvrirSaisieAlt(li,ci,n){fermerMenu();fermerSaisie();var info=imageDe(li,ci,n);if(!info)return;
  var v=document.createElement('div');v.className='szh-modale visible saisie-alt';
  v.setAttribute('role','dialog');v.setAttribute('aria-modal','true');v.setAttribute('aria-labelledby','saisie-alt-titre');
  var b=document.createElement('div');b.className='saisie-boite';v.appendChild(b);
  var h=document.createElement('p');h.className='szh-section';h.id='saisie-alt-titre';h.textContent=TXT['image.saisieTitre']||'';b.appendChild(h);
  var nom=document.createElement('p');nom.className='saisie-nom';nom.textContent=info.src;b.appendChild(nom);
  var fs=document.createElement('fieldset');fs.className='szh-groupe';var lg=document.createElement('legend');lg.textContent=TXT['img.role.titre']||'';fs.appendChild(lg);
  var rDecrit=radioSaisie(fs,TXT['img.role.decrit']),rDeco=radioSaisie(fs,TXT['img.role.deco']);b.appendChild(fs);
  var ch=document.createElement('div');ch.className='szh-champ';var l=document.createElement('label');l.textContent=TXT['img.alt']||'';l.setAttribute('for','saisie-alt');
  var i=document.createElement('input');i.type='text';i.id='saisie-alt';i.maxLength=500;i.placeholder=TXT['img.alt.indice']||'';
  ch.appendChild(l);ch.appendChild(i);b.appendChild(ch);
  // Le verdict en direct, à la frappe : même règle que la pastille de la grille.
  var al=document.createElement('p');al.className='szh-notif szh-notif--danger saisie-alerte';al.appendChild(SZH.icone('attention'));
  var alt2=document.createElement('span');alt2.textContent=TXT['image.altManquant']||'';al.appendChild(alt2);b.appendChild(al);
  function maj(){i.disabled=rDeco.checked;al.hidden=rDeco.checked||String(i.value||'').trim()!=='';}
  rDeco.checked=!!info.decorative;rDecrit.checked=!info.decorative;i.value=info.decorative?'':String(info.alt||'');
  rDecrit.addEventListener('change',maj);rDeco.addEventListener('change',maj);i.addEventListener('input',maj);maj();
  function valider(){op('imageAlt',{li:li,ci:ci,n:n,alt:String(i.value||''),decoratif:rDeco.checked});fermerSaisie();}
  var pied=document.createElement('div');pied.className='saisie-pied';
  pied.appendChild(bouton(TXT['image.annuler']||'',fermerSaisie));
  pied.appendChild(bouton(TXT['image.valider']||'',valider,'szh-bouton--principal'));b.appendChild(pied);
  v.addEventListener('keydown',function(ev){if(ev.key==='Escape'){ev.preventDefault();fermerSaisie();}
    else if(ev.key==='Enter'&&ev.target===i){ev.preventDefault();valider();}});
  v.addEventListener('mousedown',function(ev){if(ev.target===v)fermerSaisie();});
  document.body.appendChild(v);saisie=v;
  saisie.valider=valider;   // pour les tests : le geste « Valider » sans chercher le bouton
  if(rDeco.checked)rDeco.focus();else i.focus();}
// Le point d'entrée « aller à cette image » (item.focusImage à l'ouverture, ou FOCALISER sur
// un éditeur déjà ouvert) : nom de fichier seul, comparé sans casse au nom du src. La cellule
// est sélectionnée et amenée à l'écran ; sans texte alternatif, la saisie s'ouvre d'office.
function focaliserImage(nomVise){var nom=String(nomVise||'').replace(/\\/g,'/').split('/').pop().toLowerCase();if(!nom||!dispo)return false;
  var trouve=null;
  dispo.lignes.some(function(lg){return lg.cellules.some(function(c){return (c.images||[]).some(function(im,k){
    if(String(im.src||'').split('/').pop().toLowerCase()===nom){trouve={c:c,n:k,im:im};return true;}return false;});});});
  if(!trouve)return false;
  var c=trouve.c;ancre=c;cellActive=c;selection=rectCell(c);majEditable();marquer();
  // Recherche par comparaison numérique plutôt que par sélecteur d'attribut : le même
  // chemin sert au DOM des tests, où dataset n'est pas converti en chaîne.
  var el=Array.prototype.filter.call(zone.querySelectorAll('.cell'),function(e){return +e.dataset.li===c.li&&+e.dataset.ci===c.ci;})[0]||null;
  if(el&&el.scrollIntoView){try{el.scrollIntoView({block:'center',inline:'nearest'});}catch(e){el.scrollIntoView();}}
  if(trouve.im.sansAlternative)ouvrirSaisieAlt(c.li,c.ci,trouve.n);
  return true;}

// ---- Menu contextuel ----
var menu=null;
function fermerMenu(){if(!menu)return;if(menu.parentNode)menu.parentNode.removeChild(menu);menu=null;document.removeEventListener('mousedown',surMenuMousedown,true);document.removeEventListener('keydown',surMenuKey,true);window.removeEventListener('blur',fermerMenu);}
function surMenuMousedown(ev){if(menu&&menu.contains(ev.target))return;fermerMenu();}
function surMenuKey(ev){if(ev.key==='Escape'){ev.preventDefault();fermerMenu();}}
function itemMenu(txt,fn){var d=document.createElement('div');d.className='ctxitem';d.setAttribute('role','menuitem');d.textContent=txt;d.addEventListener('click',function(){fermerMenu();fn();});return d;}
function sepMenu(m){var d=document.createElement('div');d.className='ctxsep';m.appendChild(d);}
function texteDansPlage(rMin,cMin,rMax,cMax){recolter();if(!occ2)return false;var vu={};
  for(var r=rMin;r<=rMax;r++){for(var c=cMin;c<=cMax;c++){var ce=occ2[r]&&occ2[r][c];if(!ce)continue;var k=ce.li+'/'+ce.ci;if(vu[k])continue;vu[k]=1;
    var cell=modele.lignes[ce.li]&&modele.lignes[ce.li].cellules[ce.ci];if(cell&&String(cell.contenu).replace(/<br>/g,'').trim()!=='')return true;}}return false;}
function supprimer(nom,args,rMin,cMin,rMax,cMax){op(nom,args,texteDansPlage(rMin,cMin,rMax,cMax)?{confirmer:true}:null);}
function ouvrirMenu(ev,ctx){fermerMenu();ev.preventDefault();var m=document.createElement('div');m.className='ctxmenu';m.setAttribute('role','menu');
  m.addEventListener('contextmenu',function(e){e.preventDefault();});
  // Images : sur une image, décrire ou remplacer celle-là ; ailleurs dans une cellule
  // seule, en insérer une (ajoutée en fin de cellule, saisie du texte alternatif aussitôt).
  if(ctx.cellule){var ce=ctx.cellule;
    if(ctx.image!==null&&ctx.image!==undefined){var nI=ctx.image;
      m.appendChild(itemMenu(TXT['image.menuAlt'],function(){recolter();ouvrirSaisieAlt(ce.li,ce.ci,nI);}));
      m.appendChild(itemMenu(TXT['image.menuRemplacer'],function(){choisirImage('remplacer',ce,nI);}));
      sepMenu(m);}
    else if(!plage()){m.appendChild(itemMenu(TXT['image.menuInserer'],function(){choisirImage('inserer',ce,0);}));sepMenu(m);}}
  if(ctx.lignes){m.appendChild(itemMenu(TXT['ctx.ligneAvant'],function(){op('ajouterLigne',{pos:ctx.rMin});}));
    m.appendChild(itemMenu(TXT['ctx.ligneApres'],function(){op('ajouterLigne',{pos:ctx.rMax+1});}));
    m.appendChild(itemMenu(TXT['ctx.ligneSuppr'],function(){supprimer('supprimerLigne',{rMin:ctx.rMin,rMax:ctx.rMax},ctx.rMin,0,ctx.rMax,dispo.nbColonnes-1);}));}
  if(ctx.lignes&&ctx.colonnes)sepMenu(m);
  if(ctx.colonnes){m.appendChild(itemMenu(TXT['ctx.colAvant'],function(){op('ajouterColonne',{pos:ctx.cMin});}));
    m.appendChild(itemMenu(TXT['ctx.colApres'],function(){op('ajouterColonne',{pos:ctx.cMax+1});}));
    m.appendChild(itemMenu(TXT['ctx.colSuppr'],function(){supprimer('supprimerColonne',{cMin:ctx.cMin,cMax:ctx.cMax},0,ctx.cMin,dispo.nbLignes-1,ctx.cMax);}));}
  if(plage()){sepMenu(m);m.appendChild(itemMenu(TXT.fusionner,function(){op('fusionner',{rMin:selection.rMin,cMin:selection.cMin,rMax:selection.rMax,cMax:selection.cMax});}));}
  if(ctx.fusionnee){if(!plage())sepMenu(m);m.appendChild(itemMenu(TXT.scinder,function(){op('scinder',{rMin:ctx.rMin,cMin:ctx.cMin,rMax:ctx.rMax,cMax:ctx.cMax});}));}
  // L'alignement porte sur la sélection courante : une cellule, une plage, ou la ligne et
  // la colonne entières qu'une poignée vient de sélectionner. Il vit ici et non dans la
  // barre — c'est un geste local, qu'on fait sur ce qu'on a sous le curseur.
  if(selection){sepMenu(m);
    m.appendChild(itemMenu(TXT['ctx.alignGauche'],function(){aligner('left');}));
    m.appendChild(itemMenu(TXT['ctx.alignCentre'],function(){aligner('center');}));
    m.appendChild(itemMenu(TXT['ctx.alignDroite'],function(){aligner('right');}));}
  // « Retirer » n'apparaît que si l'en-tête correspondant existe. Au-delà d'une rangée
  // ou d'une colonne, le libellé dit combien l'action en définira : le geste part de la
  // 2e ligne, l'en-tête couvrira les deux premières — rien d'implicite.
  var sens=sensEntete(selection);
  if(sens){sepMenu(m);
    var nE=nEntete(sens,selection);
    var lblE=nE>1?fmt(TXT[sens==='lignes'?'entete.lignes':'entete.colonnes'],nE):TXT.entete;
    m.appendChild(itemMenu(lblE,onDefinirEntete));
    var aRetirer=sens==='lignes'?(modele.attrs.enteteLignes>0):(modele.attrs.enteteColonnes>0);
    if(aRetirer){m.appendChild(itemMenu(TXT.enteteRetirer,onRetirerEntete));}}
  // Titre de section (en-tête intermédiaire) : une seule rangée visée. Les deux
  // premières rangées (MAX_ENTETES) appartiennent à la zone d'en-tête — « Définir
  // comme en-tête » y a sa place, pas un titre de section : « définir » n'est offert
  // qu'à partir de la 3e rangée. « Retirer » reste toujours possible, pour un fichier
  // qui porterait déjà un titre plus haut. Le titre peut être partiel : il porte sur
  // la plage sélectionnée (fusionnée en une cellule si besoin — une cellule déjà
  // fusionnée n'est pas étendue) et couvre les colonnes de sa fusion pour les rangées
  // qui suivent, jusqu'au prochain titre. Inactif -> le rôle part, la fusion reste.
  if(selection&&selection.rMin===selection.rMax&&modele&&dispo&&dispo.nbLignes>1){
    var rSec=selection.rMin,lgSec=dispo.lignes[rSec];
    var estSec=!!(lgSec&&lgSec.cellules.some(function(c){
      return c.section&&c.c0<=selection.cMax&&c.c0+c.colspan-1>=selection.cMin;}));
    if(estSec||rSec>=MAX_ENTETES){
      if(!sens)sepMenu(m);
      m.appendChild(itemMenu(estSec?TXT.sectionTitreRetirer:TXT.sectionTitre,
        function(){op('section',{r:rSec,cMin:selection.cMin,cMax:selection.cMax,actif:!estSec});}));}}
  document.body.appendChild(m);
  var vw=window.innerWidth||document.documentElement.clientWidth,vh=window.innerHeight||document.documentElement.clientHeight,rc=m.getBoundingClientRect();
  var x=ev.clientX,y=ev.clientY;if(x+rc.width>vw)x=Math.max(2,vw-rc.width-2);if(y+rc.height>vh)y=Math.max(2,vh-rc.height-2);
  m.style.left=x+'px';m.style.top=y+'px';menu=m;
  document.addEventListener('mousedown',surMenuMousedown,true);document.addEventListener('keydown',surMenuKey,true);window.addEventListener('blur',fermerMenu);}

// ---- Barre d'outils ----
function bouton(txt,fn,cls,titre){var b=document.createElement('button');b.type='button';b.textContent=txt;
  b.className='szh-bouton'+(cls?' '+cls:'');if(titre)b.title=titre;b.addEventListener('click',fn);return b;}
function groupe(label){var g=document.createElement('span');g.className='grp';if(label){var l=document.createElement('span');l.className='lbl';l.textContent=label;g.appendChild(l);}return g;}
function op(nom,args,extra){if(modele){commitTexte();annuler.push(clone(modele));if(annuler.length>100)annuler.shift();retablir.length=0;}
  var msg={type: SZH.MSG.OPERATION,nom:nom,args:args,modele:modele};if(extra){for(var k in extra){msg[k]=extra[k];}}api.postMessage(msg);}
function construireBarre(){barre.textContent='';barre.className='szh-barre';
  var ge=groupe(TXT.grpEdition);
  ctl.annuler=bouton(TXT.annuler,annulerAction,'',TXT['tip.annuler']);ge.appendChild(ctl.annuler);
  ctl.retablir=bouton(TXT.retablir,retablirAction,'',TXT['tip.retablir']);ge.appendChild(ctl.retablir);
  ge.appendChild(bouton(TXT.vider,function(){viderSel('contenu');},'',TXT['tip.vider']));
  ge.appendChild(bouton(TXT.effacerForme,function(){viderSel('forme');},'',TXT['tip.effacerForme']));
  barre.appendChild(ge);
  // L'aperçu de l'article est fermé à l'ouverture de l'éditeur pour libérer de la largeur
  // et se rouvre ici à la demande.
  var ga2=groupe(TXT.grpApercu);
  ga2.appendChild(bouton(TXT.apercuVoir,function(){api.postMessage({type: SZH.MSG.APERCU_OUVRIR});},'',TXT['tip.apercuVoir']));
  ga2.appendChild(bouton(TXT.apercuCacher,function(){api.postMessage({type: SZH.MSG.APERCU_FERMER});},'',TXT['tip.apercuCacher']));
  barre.appendChild(ga2);
  var ret=bouton(TXT.retour,retourArticle,'',TXT['tip.retour']);barre.appendChild(ret);
  var enr=bouton(TXT.enregistrer,function(){autoEnr.annuler();enregistrerTable(false);},'szh-bouton--principal',TXT['tip.enregistrer']);barre.appendChild(enr);
  var ind=document.createElement('span');ind.id='indic';ind.className='szh-barre-indic';ind.setAttribute('aria-live','polite');barre.appendChild(ind);
  var e=document.createElement('span');e.id='etat';e.className='szh-barre-etat';e.setAttribute('role','status');barre.appendChild(e);
  construireChamps();construirePanneau();}
// ---- Légende, texte alternatif et crédits du tableau ----
//
// Cinq champs au-dessus de la grille : `legende` devient le <caption> du fichier, `alt`
// son data-alt, puis data-copyright, data-source et data-note (imprimée sous le tableau). Tous sont traités comme le texte d'une
// cellule — récoltés dans le modèle, photographiés à la prise de focus, empilés à la perte
// de focus — et participent donc à annuler et rétablir sans re-rendu de la grille.
//
// La légende seule est de l'en-ligne dans le modèle : le champ en montre le texte à plat,
// et le retoucher remet la légende à plat.
function texteDeInline(s){return dechap(String(s||'').replace(/<br>/g,' ').replace(/<img\b[^>]*>/g,'').replace(/<\/?(?:strong|em)>/g,''));}
function champTexte(cle,large,parent){
  var d=document.createElement('div');d.className='szh-champ'+(large?' large':'');
  var l=document.createElement('label');l.textContent=TXT[cle]||'';l.setAttribute('for','champ-'+cle);
  var i=document.createElement('input');i.type='text';i.id='champ-'+cle;i.maxLength=500;
  i.placeholder=TXT[cle+'.indice']||'';
  i.addEventListener('focus',function(){if(!avantEdition&&modele)avantEdition=clone(modele);});
  i.addEventListener('input',function(){etat('');majModifie();});
  i.addEventListener('blur',function(){commitTexte();});
  d.appendChild(l);d.appendChild(i);(parent||boiteChamps).appendChild(d);champs[cle]=i;}
// Même ordre que la fiche d'une image dans le gestionnaire des médias : ce qui s'affiche
// d'abord, les crédits ensuite, l'accessibilité en dernier, sous son intertitre.
function construireChamps(){if(!boiteChamps)return;boiteChamps.textContent='';champs={};
  champTexte('legende',true);
  var credits=document.createElement('div');credits.className='szh-grille-2';boiteChamps.appendChild(credits);
  champTexte('copyright',false,credits);
  champTexte('source',false,credits);
  champTexte('note',true);
  var titre=document.createElement('p');titre.className='szh-section';titre.textContent=TXT['section.a11y']||'';
  boiteChamps.appendChild(titre);
  // Le cas courant est le champ vide : un tableau bien fait se lit seul, ses en-têtes
  // suffisent. Le libellé le dit, pour que personne ne croie devoir le remplir.
  champTexte('alt',true);
  // Mais quand une description s'impose, encore faut-il savoir quoi écrire : ce texte
  // d'aide explique le rôle du champ, avec un exemple, dans le style discret des autres
  // aides du cockpit. Relié au champ, pour que la synthèse vocale le lise aussi.
  var aide=document.createElement('p');aide.id='aide-alt';
  aide.className='szh-notif szh-notif--info szh-notif--discret';
  aide.textContent=TXT['alt.aide']||'';boiteChamps.appendChild(aide);
  if(champs.alt)champs.alt.setAttribute('aria-describedby','aide-alt');}
// Champs -> modèle. Un champ vidé retire la valeur, donc l'attribut ou le <caption>. Pour
// la légende, la comparaison porte sur la projection à plat, si bien que le modèle garde
// sa légende en ligne tant que le champ n'est pas retouché.
function recolterChamps(){if(!modele)return;
  if(champs.legende){var saisi=String(champs.legende.value||'').replace(/[\r\n]+/g,' ').trim();
    if(saisi!==texteDeInline(modele.attrs.legende||'').trim())modele.attrs.legende=echap(saisi);}
  ['alt','copyright','source','note'].forEach(function(cle){if(!champs[cle])return;
    var v=String(champs[cle].value||'').replace(/[\r\n]+/g,' ').trim();
    if(v!==String(modele.attrs[cle]||''))modele.attrs[cle]=v;});}
function majChamps(){if(!modele)return;
  if(champs.legende){var v=texteDeInline(modele.attrs.legende||'');if(champs.legende.value!==v)champs.legende.value=v;}
  ['alt','copyright','source','note'].forEach(function(cle){if(!champs[cle])return;
    var x=String(modele.attrs[cle]||'');if(champs[cle].value!==x)champs[cle].value=x;});}
// Sens d'en-tête déduit de la sélection : une rangée du haut sur toute la largeur donne
// 'lignes', une colonne de gauche sur toute la hauteur donne 'colonnes', sinon le bord
// touché décide. Un en-tête est toujours contigu depuis le bord (c'est ce que th/scope
// savent décrire) : la sélection n'a donc pas besoin de partir du bord — désigner la
// 2e ligne suffit à demander « les 2 premières lignes en en-tête », le libellé du menu
// l'annonce. Au-delà de MAX_ENTETES rangées ou colonnes de profondeur, null.
var MAX_ENTETES=2;   // miroir de normaliserModele (lib/table-model.js)
function sensEntete(s){if(!s||!dispo)return null;var nbC=dispo.nbColonnes,nbL=dispo.nbLignes;
  var pleineLargeur=(s.cMin===0&&s.cMax===nbC-1),pleineHauteur=(s.rMin===0&&s.rMax===nbL-1);
  var versHaut=(s.rMin===0||s.rMax<MAX_ENTETES),versGauche=(s.cMin===0||s.cMax<MAX_ENTETES);
  if(pleineLargeur&&versHaut&&!(pleineHauteur&&nbC===1))return 'lignes';
  if(pleineHauteur&&versGauche)return 'colonnes';
  if(s.rMin===0&&!pleineLargeur)return 'lignes';
  if(s.cMin===0&&!pleineLargeur&&s.rMin!==0)return 'colonnes';
  if(s.rMax<MAX_ENTETES)return 'lignes';
  if(s.cMax<MAX_ENTETES)return 'colonnes';
  return null;}
function nEntete(sens,s){return Math.min(MAX_ENTETES,(sens==='lignes'?s.rMax:s.cMax)+1);}
function onDefinirEntete(){var sens=sensEntete(selection);if(!sens){etat(TXT.rien);return;}
  op('entete',{sens:sens,n:nEntete(sens,selection)});}
// Ne retire que l'en-tête du sens déduit, lignes ou colonnes, jamais les deux.
function onRetirerEntete(){var sens=sensEntete(selection);if(!sens){etat(TXT.rien);return;}op('enteteRetirer',{sens:sens});}
function viderSel(mode){if(!selection){etat(TXT.rien);return;}op('vider',{rMin:selection.rMin,cMin:selection.cMin,rMax:selection.rMax,cMax:selection.cMax,mode:mode});}
function aligner(v){if(!selection){etat(TXT.rien);return;}op('aligner',{rMin:selection.rMin,cMin:selection.cMin,rMax:selection.rMax,cMax:selection.cMax,valeur:v});}

// ---- Panneau de mise en forme : préréglages, en-têtes, tableau ----
//
// Les contrôles lisent le modèle et postent au changement les opérations styleEntete et
// reglage : l'hôte met à jour les attributs et renvoie « charger », d'où un aperçu qui
// suit. L'annulation passe par op(), comme pour toute autre opération.
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
  // Deux colonnes : les styles d'en-tête à droite, le reste à gauche. Sur une seule
  // colonne, l'ensemble dépasse la hauteur de la fenêtre.
  var colG=document.createElement('div');colG.className='colonne';
  var colD=document.createElement('div');colD.className='colonne';
  panneau.appendChild(colG);panneau.appendChild(colD);
  // La liste et l'ordre des préréglages viennent de l'hôte, via PRESETS_ORDRE : en retirer
  // un côté modèle le fait disparaître ici sans autre retouche.
  var z1=fieldsetZone(TXT['zone.preset']);
  var opts=(PRESETS||[]).map(function(cle){return [cle,TXT['preset.'+cle]||cle];});
  ctl.preset=groupeRadios('preset',opts,function(v){op('preset',{nom:v});});
  z1.appendChild(ctl.preset.wrap);
  colG.appendChild(z1);
  var z2=fieldsetZone(TXT['zone.entetes']);
  ctl.el=sousBlocEntete(z2,TXT.entetesLignes,'lignes');
  ctl.ec=sousBlocEntete(z2,TXT.entetesColonnes,'colonnes');
  ctl.tot=sousBlocEntete(z2,TXT.total,'total');
  colD.appendChild(z2);
  var z3=fieldsetZone(TXT['zone.tableau']);
  var cbh=caseACocher(TXT.bordureHaute,function(){op('reglage',{champ:'bordureHaute',valeur:cbh.input.checked});});z3.appendChild(cbh.label);ctl.bordureHaute=cbh.input;
  var cbb=caseACocher(TXT.bordureBasse,function(){op('reglage',{champ:'bordureBasse',valeur:cbb.input.checked});});z3.appendChild(cbb.label);ctl.bordureBasse=cbb.input;
  ctl.zebreCol=sousBlocZebre(z3,TXT.zebreCol,'zebreCol','zebreColEntetes');
  ctl.zebreLig=sousBlocZebre(z3,TXT.zebreLig,'zebreLig','zebreLigEntetes');
  colG.appendChild(z3);}
function cocherRadio(rd,val){for(var k in rd.inputs){rd.inputs[k].checked=(k===val);}}
// Un sous-bloc d'en-tête n'agit que si l'en-tête correspondant existe ; sinon il est grisé.
function majEntete(o,gras,fond,actif){o.gras.checked=!!gras;cocherRadio(o.radios,fond);
  o.gras.disabled=!actif;for(var k in o.radios.inputs){o.radios.inputs[k].disabled=!actif;}
  o.bloc.classList.toggle('inactif',!actif);if(o.hint)o.hint.style.display=actif?'none':'';}
function majZebre(o,val,ent){cocherRadio(o.radios,val);o.entetes.checked=!!ent;o.entetes.disabled=(val==='aucun');}
function majPanneau(){if(!modele||!ctl.el)return;var a=modele.attrs;
  // Les styles « en-têtes de lignes » couvrent aussi les titres de section
  // (print.css : th[scope^="row"]) : le bloc reste actif dès qu'il y en a un.
  var aSection=!!(dispo&&dispo.lignes.some(function(lg){return lg.cellules.length===1&&lg.cellules[0].section;}));
  majEntete(ctl.el,a.elGras,a.elFond,a.enteteColonnes>0||aSection);
  majEntete(ctl.ec,a.ecGras,a.ecFond,a.enteteLignes>0);
  majEntete(ctl.tot,a.totalGras,a.totalFond,true);
  ctl.bordureHaute.checked=!!a.bordureHaute;ctl.bordureBasse.checked=!!a.bordureBasse;
  majZebre(ctl.zebreCol,a.zebreCol,a.zebreColEntetes);
  majZebre(ctl.zebreLig,a.zebreLig,a.zebreLigEntetes);}
function etat(msg){var e=document.getElementById('etat');if(e)e.textContent=msg;}

// ---- Historique, garde de non-enregistré, enregistrement, retour ----

function commitTexte(){if(!modele)return;recolter();
  if(avantEdition&&JSON.stringify(modele)!==JSON.stringify(avantEdition)){annuler.push(clone(avantEdition));if(annuler.length>100)annuler.shift();retablir.length=0;}
  avantEdition=null;majModifie();}
function restaurer(m){api.postMessage({type: SZH.MSG.RESTAURER,modele:m});}
// Annuler et rétablir : l'état courant est poussé sur l'autre pile, puis on restaure
// l'état dépilé ; l'hôte renvoie la disposition par un « charger » sans i18n.
function annulerAction(){commitTexte();if(!annuler.length){return;}retablir.push(clone(modele));restaurer(annuler.pop());}
function retablirAction(){commitTexte();if(!retablir.length){return;}annuler.push(clone(modele));restaurer(retablir.pop());}
function estModifie(){if(!modele||!modeleEnregistre)return false;recolter();return JSON.stringify(modele)!==JSON.stringify(modeleEnregistre);}
function majModifie(){var m=estModifie();var ind=document.getElementById('indic');if(ind){ind.textContent=m?' ●':'';ind.title=m?(TXT.nonEnregistre||''):'';}
  if(m!==dernierModifie){dernierModifie=m;api.postMessage({type: SZH.MSG.MODIFIE,modifie:m});}}
function enregistrerTable(auto){recolter();enrEnCours=clone(modele);
  api.postMessage({type: SZH.MSG.ENREGISTRER,auto:!!auto,modele:modele});}
// Enregistrement automatique, sans risque ici : l'écriture ne touche que
// articles/<slug>/tables/<n>.html et ne déclenche aucune recompilation.
var autoEnr=SZH.autoEnregistrement({estModifie:estModifie,enregistrer:enregistrerTable});
function retourArticle(){recolter();api.postMessage({type: SZH.MSG.RETOUR_ARTICLE,modifie:estModifie(),modele:modele});}

// ---- Collage d'un tableau : le HTML d'abord, qui préserve les fusions, sinon le TSV ----
function collerDepuisPresse(ev){var cd=ev.clipboardData||window.clipboardData;if(!cd)return;
  var html=cd.getData?cd.getData('text/html'):'';var texte=cd.getData?cd.getData('text/plain'):'';
  if(!/<table/i.test(html)&&!/[\t\n]/.test(texte))return;   // texte d'une cellule : collage natif
  ev.preventDefault();var aR=selection?selection.rMin:0,aC=selection?selection.cMin:0;
  op('coller',{ancreR:aR,ancreC:aC,html:html,texte:texte});}
zone.addEventListener('paste',collerDepuisPresse);

// ---- Copie de la sélection (Ctrl+C) ----
//
// Une sélection de texte dans la cellule garde la copie native. Sinon, la sélection de
// cellules part au presse-papiers : une cellule seule -> son texte (et son balisage en
// text/html, que le collage natif ré-insère au curseur, strong/em compris) ; une plage ->
// TSV + <table> minimal, colspan/rowspan compris — c'est le format que le collage de
// l'éditeur (op coller) et Excel/Word savent relire. La sélection étant toujours étendue
// aux fusions entières (etendre), chaque origine de cellule tombe dans le rectangle.
function copierSelection(ev){
  var s=window.getSelection?window.getSelection():null;
  if(s&&String(s).length>0)return;                 // copie native du texte sélectionné
  if(!selection||!modele||!occ2)return;
  var cd=ev.clipboardData||window.clipboardData;if(!cd||!cd.setData)return;
  recolter();
  var tsv=[],html=[],unSeul=!plage();
  for(var r=selection.rMin;r<=selection.rMax;r++){
    var lt=[],lh=[];
    for(var c=selection.cMin;c<=selection.cMax;c++){
      var ce=occ2[r]&&occ2[r][c];
      if(!ce){lt.push('');continue;}
      if(ce.r0!==r||ce.c0!==c){lt.push('');continue;}   // case couverte par une fusion
      var cell=modele.lignes[ce.li].cellules[ce.ci];
      lt.push(texteDeInline(cell.contenu).replace(/\t/g,' '));
      var attrs=(ce.colspan>1?' colspan="'+ce.colspan+'"':'')+(ce.rowspan>1?' rowspan="'+ce.rowspan+'"':'');
      var tag=cell.th?'th':'td';
      lh.push('<'+tag+attrs+'>'+cell.contenu+'</'+tag+'>');
    }
    tsv.push(lt.join('\t'));html.push('<tr>'+lh.join('')+'</tr>');
  }
  ev.preventDefault();
  if(unSeul){
    var ce0=occ2[selection.rMin][selection.cMin];
    var seul=modele.lignes[ce0.li].cellules[ce0.ci];
    cd.setData('text/plain',texteDeInline(seul.contenu));
    cd.setData('text/html',seul.contenu);
  }else{
    cd.setData('text/plain',tsv.join('\n'));
    cd.setData('text/html','<table>'+html.join('')+'</table>');
  }}
zone.addEventListener('copy',copierSelection);

// ---- Raccourcis clavier globaux ----
try{document.execCommand('styleWithCSS',false,false);}catch(e){}
document.addEventListener('keydown',function(ev){if(!(ev.ctrlKey||ev.metaKey))return;var k=(ev.key||'').toLowerCase();
  if(k==='b'){ev.preventDefault();try{document.execCommand('bold');}catch(e){}majModifie();}
  else if(k==='i'){ev.preventDefault();try{document.execCommand('italic');}catch(e){}majModifie();}
  else if(k==='z'&&!ev.shiftKey){ev.preventDefault();annulerAction();}
  else if(k==='y'||(k==='z'&&ev.shiftKey)){ev.preventDefault();retablirAction();}
  else if(k==='s'){ev.preventDefault();autoEnr.annuler();enregistrerTable(false);}});

var recu=false;
window.addEventListener('message',function(ev){var msg=ev.data||{};
  recu=true;
  if(msg.type===SZH.MSG.CHARGER){
    modele=msg.modele;dispo=msg.disposition;if(msg.accent!==undefined){accent=msg.accent;SZH.poserAccent(accent);}if(msg.teintes)teintes=msg.teintes;if(msg.presets)PRESETS=msg.presets;
    // Les aperçus n'arrivent qu'avec un chargement depuis le disque ; une opération ou une
    // annulation ne ramène que des src déjà connus.
    if(msg.apercus)APERCUS=msg.apercus;
    if(msg.i18n){TXT=msg.i18n;
      modeleEnregistre=clone(modele);annuler=[];retablir=[];avantEdition=null;dernierModifie=false;
      construireBarre();}
    // Un « charger » sans i18n est le résultat d'une opération ou d'une annulation :
    // ⚠ ne pas réinitialiser l'historique ici, sans quoi « Annuler » reste sans effet.
    // Les piles ne sont touchées que par op et commitTexte.
    selection=clampSel(selection);ancre=null;rendre();majPanneau();majChamps();etat('');majModifie();
    if(saisieApres){var sa=saisieApres;saisieApres=null;if(imageDe(sa.li,sa.ci,sa.n))ouvrirSaisieAlt(sa.li,sa.ci,sa.n);}
    else if(msg.focusImage){focaliserImage(msg.focusImage);}}
  else if(msg.type===SZH.MSG.TABLE_IMAGE_CHOISIE){imageChoisie(msg);}
  else if(msg.type===SZH.MSG.FOCALISER){focaliserImage(msg.focusImage);}
  else if(msg.type===SZH.MSG.ENREGISTRE){autoEnr.confirme();modeleEnregistre=enrEnCours||clone(modele);
    etat(msg.auto?'':(TXT.enregistre||''));majModifie();}
  else if(msg.type===SZH.MSG.ERREUR){autoEnr.confirme();etat('⚠ '+msg.message);}
  else{console.warn('table-editor : type de message inconnu', msg.type);}});
SZH.annoncerPret(api,function(){return recu;});
})();
