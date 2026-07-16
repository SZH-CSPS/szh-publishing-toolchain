(function(){
'use strict';
var api=acquireVsCodeApi();
var modele=null, dispo=null, TXT={}, accent='', accentMode='gris', selection=null, ancre=null, premierChargement=true, ctl={};
var barre=document.getElementById('barre'), zone=document.getElementById('zone'), aide=document.getElementById('aide');
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
function plage(){return selection&&(selection.rMax>selection.rMin||selection.cMax>selection.cMin);}
function clampSel(s){if(!s||!dispo)return null;var rMax=Math.min(s.rMax,dispo.nbLignes-1),cMax=Math.min(s.cMax,dispo.nbColonnes-1);if(s.rMin>rMax||s.cMin>cMax||s.rMin<0||s.cMin<0)return null;return etendre({rMin:s.rMin,cMin:s.cMin,rMax:rMax,cMax:cMax});}
function hx(h){h=String(h||'').replace('#','');if(h.length===3){h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];}return [parseInt(h.slice(0,2),16)||0,parseInt(h.slice(2,4),16)||0,parseInt(h.slice(4,6),16)||0];}
function hx2(v){var s=Math.max(0,Math.min(255,Math.round(v))).toString(16);return s.length<2?'0'+s:s;}
function melange(a,b,t){var x=hx(a),y=hx(b);return '#'+hx2(x[0]+(y[0]-x[0])*t)+hx2(x[1]+(y[1]-x[1])*t)+hx2(x[2]+(y[2]-x[2])*t);}
function accBrut(){return (accentMode==='couleur'&&accent)?accent:null;}
function fondClair(coul){var a=coul?accBrut():null;return a?melange(a,'#ffffff',0.82):'#eeeeee';}
function fondFonce(coul){var a=coul?accBrut():null;return a?melange(a,'#000000',0.35):'#4a4a4a';}
function ligne(coul){var a=coul?accBrut():null;return a?a:'#c9c9c9';}
function styleEnt(el,st){if(st==='gras'){el.style.fontWeight='700';}else if(st==='fond'){el.style.background=fondClair(true);el.style.fontWeight='700';}else if(st==='negatif'){el.style.background=fondFonce(true);el.style.color='#ffffff';el.style.fontWeight='700';}}
function stylerApercu(){if(!dispo||!modele)return;var a=modele.attrs;zone.querySelectorAll('.cell').forEach(function(el){
  el.style.background='';el.style.color='';el.style.fontWeight='';el.style.borderBottom='';el.style.borderTop='';
  var r=+el.dataset.r0,c=+el.dataset.c0,rs=+el.dataset.rs,li=+el.dataset.li,lg=dispo.lignes[li];
  var entL=r<a.enteteLignes,entC=(c<a.enteteColonnes)&&!entL,tot=lg&&lg.total;
  if(a.zebre==='lignes'&&!entL&&!entC&&!tot){var di=r-a.enteteLignes;if(di>=0&&di%2===1)el.style.background=fondClair(a.zebreTeinte==='couleur');}
  else if(a.zebre==='colonnes'&&!entC&&!entL&&!tot){var dc=c-a.enteteColonnes;if(dc>=0&&dc%2===1)el.style.background=fondClair(a.zebreTeinte==='couleur');}
  if(entL){styleEnt(el,a.enteteLigneStyle);}else if(entC){styleEnt(el,a.enteteColonneStyle);}
  if(tot){el.style.background=fondClair(lg.teinte==='couleur');if(lg.gras==='oui')el.style.fontWeight='700';}
  if(a.separateurs!=='non'){el.style.borderBottom='1px solid '+ligne(a.separateurs==='couleur');}
  if(a.bordureHaute==='oui'){if(a.enteteLignes>0&&r===a.enteteLignes-1)el.style.borderBottom='2px solid '+ligne(true);else if(a.enteteLignes===0&&r===0)el.style.borderTop='2px solid '+ligne(true);}
  if(a.bordureBasse==='oui'&&(r+rs===dispo.nbLignes))el.style.borderBottom='2px solid '+ligne(true);
});}
function cellDom(c){var el=document.createElement(c.th?'th':'td');el.className='cell';el.dataset.li=c.li;el.dataset.ci=c.ci;
  el.dataset.r0=c.r0;el.dataset.c0=c.c0;el.dataset.rs=c.rowspan;el.dataset.cs=c.colspan;
  if(c.colspan>1)el.colSpan=c.colspan;if(c.rowspan>1)el.rowSpan=c.rowspan;
  poserInline(el,c.contenu);
  el.addEventListener('mousedown',function(ev){onCell(ev,c);});
  el.addEventListener('contextmenu',function(ev){ouvrirMenu(ev,{lignes:true,colonnes:true,rMin:c.r0,rMax:c.r0+c.rowspan-1,cMin:c.c0,cMax:c.c0+c.colspan-1,fusionnee:(c.rowspan>1||c.colspan>1)});});
  el.addEventListener('input',function(){etat('');});
  return el;}
function colLettre(n){var s='';n=n+1;while(n>0){var r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}return s;}
function rendre(){zone.textContent='';if(!dispo)return;
  var t=document.createElement('table');t.className='grille';
  var trh=document.createElement('tr');var coin=document.createElement('th');coin.className='coin';trh.appendChild(coin);
  for(var c=0;c<dispo.nbColonnes;c++){var ph=document.createElement('th');ph.className='poignee';ph.dataset.pcol=c;ph.textContent=colLettre(c);(function(cc){ph.addEventListener('click',function(){selCol(cc);});ph.addEventListener('contextmenu',function(ev){selCol(cc);ouvrirMenu(ev,{lignes:false,colonnes:true,rMin:0,rMax:dispo.nbLignes-1,cMin:cc,cMax:cc,fusionnee:false});});})(c);trh.appendChild(ph);}
  t.appendChild(trh);
  dispo.lignes.forEach(function(lg,r){var tr=document.createElement('tr');
    var pl=document.createElement('td');pl.className='poignee pnum';pl.dataset.prow=r;pl.textContent=String(r+1);(function(rr){pl.addEventListener('click',function(){selLigne(rr);});pl.addEventListener('contextmenu',function(ev){selLigne(rr);ouvrirMenu(ev,{lignes:true,colonnes:false,rMin:rr,rMax:rr,cMin:0,cMax:dispo.nbColonnes-1,fusionnee:false});});})(r);tr.appendChild(pl);
    lg.cellules.forEach(function(c){tr.appendChild(cellDom(c));});t.appendChild(tr);});
  zone.appendChild(t);majEditable();marquer();stylerApercu();}
function majEditable(){var ed=!plage();zone.querySelectorAll('.cell').forEach(function(el){el.contentEditable=ed?'true':'false';});}
function marquer(){zone.querySelectorAll('.cell').forEach(function(el){
  var cr={rMin:+el.dataset.r0,cMin:+el.dataset.c0,rMax:+el.dataset.r0+ +el.dataset.rs-1,cMax:+el.dataset.c0+ +el.dataset.cs-1};
  var dans=selection&&cr.rMin>=selection.rMin&&cr.rMax<=selection.rMax&&cr.cMin>=selection.cMin&&cr.cMax<=selection.cMax;
  el.classList.toggle('sel',!!dans);});
  zone.querySelectorAll('.poignee[data-pcol]').forEach(function(el){var c=+el.dataset.pcol;el.classList.toggle('selh',!!(selection&&c>=selection.cMin&&c<=selection.cMax));});
  zone.querySelectorAll('.poignee[data-prow]').forEach(function(el){var r=+el.dataset.prow;el.classList.toggle('selh',!!(selection&&r>=selection.rMin&&r<=selection.rMax));});}
function onCell(ev,c){if(ev.button===2){return;}if(ev.shiftKey&&ancre){ev.preventDefault();var sel=window.getSelection&&window.getSelection();if(sel)sel.removeAllRanges();
  selection=etendre(union(rectCell(ancre),rectCell(c)));majEditable();marquer();return;}
  ancre=c;selection=rectCell(c);majEditable();marquer();}
function selLigne(r){ancre=null;selection=etendre({rMin:r,cMin:0,rMax:r,cMax:dispo.nbColonnes-1});majEditable();marquer();}
function selCol(c){ancre=null;selection=etendre({rMin:0,cMin:c,rMax:dispo.nbLignes-1,cMax:c});majEditable();marquer();}
var menu=null;
function fermerMenu(){if(!menu)return;if(menu.parentNode)menu.parentNode.removeChild(menu);menu=null;document.removeEventListener('mousedown',surMenuMousedown,true);document.removeEventListener('keydown',surMenuKey,true);window.removeEventListener('blur',fermerMenu);}
function surMenuMousedown(ev){if(menu&&menu.contains(ev.target))return;fermerMenu();}
function surMenuKey(ev){if(ev.key==='Escape'){ev.preventDefault();fermerMenu();}}
function itemMenu(txt,fn){var d=document.createElement('div');d.className='ctxitem';d.setAttribute('role','menuitem');d.textContent=txt;d.addEventListener('click',function(){fermerMenu();fn();});return d;}
function sepMenu(m){var d=document.createElement('div');d.className='ctxsep';m.appendChild(d);}
function ouvrirMenu(ev,ctx){fermerMenu();ev.preventDefault();var m=document.createElement('div');m.className='ctxmenu';m.setAttribute('role','menu');
  m.addEventListener('contextmenu',function(e){e.preventDefault();});
  if(ctx.lignes){m.appendChild(itemMenu(TXT['ctx.ligneAvant'],function(){op('ajouterLigne',{pos:ctx.rMin});}));
    m.appendChild(itemMenu(TXT['ctx.ligneApres'],function(){op('ajouterLigne',{pos:ctx.rMax+1});}));
    m.appendChild(itemMenu(TXT['ctx.ligneSuppr'],function(){op('supprimerLigne',{rMin:ctx.rMin,rMax:ctx.rMax});}));}
  if(ctx.lignes&&ctx.colonnes)sepMenu(m);
  if(ctx.colonnes){m.appendChild(itemMenu(TXT['ctx.colAvant'],function(){op('ajouterColonne',{pos:ctx.cMin});}));
    m.appendChild(itemMenu(TXT['ctx.colApres'],function(){op('ajouterColonne',{pos:ctx.cMax+1});}));
    m.appendChild(itemMenu(TXT['ctx.colSuppr'],function(){op('supprimerColonne',{cMin:ctx.cMin,cMax:ctx.cMax});}));}
  if(plage()){sepMenu(m);m.appendChild(itemMenu(TXT.fusionner,function(){op('fusionner',{rMin:selection.rMin,cMin:selection.cMin,rMax:selection.rMax,cMax:selection.cMax});}));}
  if(ctx.fusionnee){if(!plage())sepMenu(m);m.appendChild(itemMenu(TXT.scinder,function(){op('scinder',{rMin:ctx.rMin,cMin:ctx.cMin,rMax:ctx.rMax,cMax:ctx.cMax});}));}
  document.body.appendChild(m);
  var vw=window.innerWidth||document.documentElement.clientWidth,vh=window.innerHeight||document.documentElement.clientHeight,rc=m.getBoundingClientRect();
  var x=ev.clientX,y=ev.clientY;if(x+rc.width>vw)x=Math.max(2,vw-rc.width-2);if(y+rc.height>vh)y=Math.max(2,vh-rc.height-2);
  m.style.left=x+'px';m.style.top=y+'px';menu=m;
  document.addEventListener('mousedown',surMenuMousedown,true);document.addEventListener('keydown',surMenuKey,true);window.addEventListener('blur',fermerMenu);}
function bouton(txt,fn,cls){var b=document.createElement('button');b.type='button';b.textContent=txt;if(cls)b.className=cls;b.addEventListener('click',fn);return b;}
function groupe(label){var g=document.createElement('span');g.className='grp';if(label){var l=document.createElement('span');l.className='lbl';l.textContent=label;g.appendChild(l);}return g;}
function op(nom,args){recolter();api.postMessage({type:'operation',nom:nom,args:args,modele:modele});}
function construireBarre(){barre.textContent='';
  barreT2(barre);
  var enr=bouton(TXT.enregistrer,function(){recolter();api.postMessage({type:'enregistrer',modele:modele});},'principal');
  barre.appendChild(enr);
  var e=document.createElement('span');e.id='etat';e.setAttribute('role','status');barre.appendChild(e);}
function selCtrl(parent,label,options,onCh){var g=groupe('');var l=document.createElement('span');l.className='lbl';l.textContent=label;g.appendChild(l);var s=document.createElement('select');options.forEach(function(o){var op=document.createElement('option');op.value=o[0];op.textContent=o[1];s.appendChild(op);});s.addEventListener('change',function(){onCh(s.value);});g.appendChild(s);parent.appendChild(g);return s;}
function STYLES(){return [['normal',TXT['st.normal']],['gras',TXT['st.gras']],['negatif',TXT['st.negatif']],['fond',TXT['st.fond']]];}
function onDefinirEntete(){if(!selection){etat(TXT.rien);return;}var s=selection,nbC=dispo.nbColonnes,nbL=dispo.nbLignes;
  if(s.rMin===0&&(s.cMax-s.cMin+1)===nbC&&!(s.rMax===nbL-1&&nbC===1)){op('entete',{sens:'lignes',n:Math.min(2,s.rMax+1)});}
  else if(s.cMin===0&&(s.rMax-s.rMin+1)===nbL){op('entete',{sens:'colonnes',n:Math.min(2,s.cMax+1)});}
  else if(s.rMin===0){op('entete',{sens:'lignes',n:Math.min(2,s.rMax+1)});}
  else if(s.cMin===0){op('entete',{sens:'colonnes',n:Math.min(2,s.cMax+1)});}
  else{etat(TXT.rien);}}
function appliquerTotal(){if(!selection){etat(TXT.rien);return;}op('total',{rMin:selection.rMin,rMax:selection.rMax,teinte:ctl.total.value,gras:ctl.totalGras.checked?'oui':'non'});}
function barreT2(barre){
  var ge=groupe(TXT.grpEntetes);
  ge.appendChild(bouton(TXT.entete,onDefinirEntete));
  ge.appendChild(bouton(TXT.enteteRetirer,function(){op('enteteRetirer',{});}));
  barre.appendChild(ge);
  ctl.styleLigne=selCtrl(barre,TXT.styleLigne,STYLES(),function(v){op('styleEntete',{cible:'ligne',valeur:v});});
  ctl.styleColonne=selCtrl(barre,TXT.styleColonne,STYLES(),function(v){op('styleEntete',{cible:'colonne',valeur:v});});
  var etiq=groupe('');var le=document.createElement('span');le.className='lbl';le.textContent=TXT.grpStyles;etiq.appendChild(le);barre.appendChild(etiq);
  ctl.zebre=selCtrl(barre,TXT.zebre,[['non',TXT['zebre.non']],['lignes',TXT['zebre.lignes']],['colonnes',TXT['zebre.colonnes']]],function(v){op('reglage',{champ:'zebre',valeur:v});});
  ctl.zebreTeinte=selCtrl(barre,TXT.teinte,[['gris',TXT['teinte.gris']],['couleur',TXT['teinte.couleur']]],function(v){op('reglage',{champ:'zebreTeinte',valeur:v});});
  ctl.separateurs=selCtrl(barre,TXT.separateurs,[['non',TXT['sep.non']],['gris',TXT['sep.gris']],['couleur',TXT['sep.couleur']]],function(v){op('reglage',{champ:'separateurs',valeur:v});});
  ctl.bordureHaute=selCtrl(barre,TXT.bordureHaute,[['non',TXT.non],['oui',TXT.oui]],function(v){op('reglage',{champ:'bordureHaute',valeur:v});});
  ctl.bordureBasse=selCtrl(barre,TXT.bordureBasse,[['non',TXT.non],['oui',TXT.oui]],function(v){op('reglage',{champ:'bordureBasse',valeur:v});});
  ctl.total=selCtrl(barre,TXT.total,[['non',TXT['total.non']],['gris',TXT['total.gris']],['couleur',TXT['total.couleur']]],function(v){appliquerTotal();});
  var gg=groupe('');var lab=document.createElement('label');lab.style.display='inline-flex';lab.style.alignItems='center';lab.style.gap='.25em';var cb=document.createElement('input');cb.type='checkbox';ctl.totalGras=cb;cb.addEventListener('change',appliquerTotal);lab.appendChild(cb);lab.appendChild(document.createTextNode(TXT['total.gras']));gg.appendChild(lab);barre.appendChild(gg);
  ctl.accent=selCtrl(barre,TXT.accent,[['gris',TXT['accent.gris']],['couleur',TXT['accent.couleur']]],function(v){accentMode=v;stylerApercu();});
  if(!accent){ctl.accent.title=TXT['accent.aucune'];}
}
function majT2(){if(!modele||!ctl.zebre)return;var a=modele.attrs;
  ctl.styleLigne.value=a.enteteLigneStyle;ctl.styleColonne.value=a.enteteColonneStyle;
  ctl.zebre.value=a.zebre;ctl.zebreTeinte.value=a.zebreTeinte;ctl.separateurs.value=a.separateurs;
  ctl.bordureHaute.value=a.bordureHaute;ctl.bordureBasse.value=a.bordureBasse;ctl.accent.value=accentMode;}
function etat(msg){var e=document.getElementById('etat');if(e)e.textContent=msg;}
try{document.execCommand('styleWithCSS',false,false);}catch(e){}
document.addEventListener('keydown',function(ev){if(!(ev.ctrlKey||ev.metaKey))return;var k=(ev.key||'').toLowerCase();
  if(k==='b'){ev.preventDefault();try{document.execCommand('bold');}catch(e){}}
  else if(k==='i'){ev.preventDefault();try{document.execCommand('italic');}catch(e){}}
  else if(k==='s'){ev.preventDefault();recolter();api.postMessage({type:'enregistrer',modele:modele});}});
window.addEventListener('message',function(ev){var msg=ev.data||{};
  if(msg.type==='charger'){modele=msg.modele;dispo=msg.disposition;if(msg.i18n)TXT=msg.i18n;if(msg.accent!==undefined)accent=msg.accent;
    if(premierChargement){accentMode=accent?'couleur':'gris';premierChargement=false;}
    selection=clampSel(selection);ancre=null;aide.textContent=TXT.aide||'';construireBarre();rendre();majT2();etat('');}
  else if(msg.type==='enregistre'){etat(TXT.enregistre||'');}
  else if(msg.type==='erreur'){etat('\u26A0 '+msg.message);}});
api.postMessage({type:'pret'});
})();