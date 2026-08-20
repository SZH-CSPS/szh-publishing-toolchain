(function(){
'use strict';
// Fiche image, aux mêmes règles que les autres webviews : aucune donnée injectée dans le
// HTML, tout arrive par postMessage, page construite en DOM sans innerHTML. L'aperçu est
// une data: URI fournie par l'hôte, d'où le img-src data: de la CSP.
//
// Protocole. Vers l'hôte : pret, modifie, ouvrirImage, enregistrer { valeurs },
// retourArticle { modifie, valeurs }. Depuis l'hôte : charger { nom, description, apercu,
// occurrences, valeurs, i18n }, enregistre { occurrences }, erreur { message }, où
// valeurs = { legende, alt, altDefini, copyright, source }.
var api=acquireVsCodeApi();
var TXT={}, ctl={}, enregistrees=null, occurrences=0, dernierModifie=false, apercuUrl=null, nomFichier='';
var barre=document.getElementById('barre'), avis=document.getElementById('avis');
var visuel=document.getElementById('visuel'), fiche=document.getElementById('fiche');

function bouton(txt,fn,cls,titre){var b=document.createElement('button');b.type='button';b.textContent=txt;
  if(cls)b.className=cls;if(titre)b.title=titre;b.addEventListener('click',fn);return b;}
function etat(msg){if(ctl.etat)ctl.etat.textContent=msg||'';}

// ---- Valeurs du formulaire ----
// Les deux états du texte alternatif viennent du choix de rôle, jamais d'un champ vide :
//   « décrit »     -> altDefini vaut vrai si le champ porte un texte ; sinon l'attribut
//                     est absent et le pipeline retombe sur la légende ;
//   « décorative » -> altDefini vaut vrai avec une valeur vide, ce qui écrit alt="" et
//                     fait ignorer l'image par les lecteurs d'écran.
function decorative(){return !!(ctl.roleDeco&&ctl.roleDeco.checked);}
function valeurs(){
  var alt=decorative()?'':String(ctl.alt.value||'').replace(/[\r\n]+/g,' ').trim();
  return {
    legende:String(ctl.legende.value||'').replace(/[\r\n]+/g,' ').trim(),
    alt:alt, altDefini:decorative()||alt!=='',
    copyright:String(ctl.copyright.value||'').replace(/[\r\n]+/g,' ').trim(),
    source:String(ctl.source.value||'').replace(/[\r\n]+/g,' ').trim()
  };}
function poserValeurs(v){
  v=v||{};
  ctl.legende.value=String(v.legende||'');
  var deco=!!v.altDefini&&String(v.alt||'')==='';
  ctl.roleDeco.checked=deco;ctl.roleDecrit.checked=!deco;
  ctl.alt.value=deco?'':String(v.alt||'');
  ctl.copyright.value=String(v.copyright||'');
  ctl.source.value=String(v.source||'');
  majRole();}
function majRole(){if(!ctl.alt)return;ctl.alt.disabled=decorative();
  if(ctl.aideAlt)ctl.aideAlt.textContent=decorative()?(TXT.altAideDeco||''):(TXT.altAide||'');}
function estModifie(){if(!enregistrees)return false;return JSON.stringify(valeurs())!==JSON.stringify(enregistrees);}
function majModifie(){var m=estModifie();
  if(ctl.indic){ctl.indic.textContent=m?' ●':'';ctl.indic.title=m?(TXT.nonEnregistre||''):'';}
  if(m!==dernierModifie){dernierModifie=m;api.postMessage({type:'modifie',modifie:m});}}

function champ(parent,cle,cls){
  var d=document.createElement('div');d.className='champ'+(cls?' '+cls:'');
  var l=document.createElement('label');l.textContent=TXT[cle]||'';l.setAttribute('for','ch-'+cle);
  var i=document.createElement('input');i.type='text';i.id='ch-'+cle;i.maxLength=500;
  i.placeholder=TXT[cle+'Indice']||'';
  i.addEventListener('input',function(){etat('');majModifie();});
  d.appendChild(l);d.appendChild(i);parent.appendChild(d);ctl[cle]=i;return d;}
function radioRole(parent,libelle,sous){
  var l=document.createElement('label');l.className='opt';
  var i=document.createElement('input');i.type='radio';i.name='role-alt';
  i.addEventListener('change',function(){if(i.checked){etat('');majRole();majModifie();}});
  var t=document.createElement('span');t.className='txt';
  var t1=document.createElement('span');t1.textContent=libelle;t.appendChild(t1);
  var t2=document.createElement('span');t2.className='sous';t2.textContent=sous;t.appendChild(t2);
  l.appendChild(i);l.appendChild(t);parent.appendChild(l);return i;}

function construireBarre(){barre.textContent='';
  barre.appendChild(bouton(TXT.ouvrir,function(){api.postMessage({type:'ouvrirImage'});},'',TXT.ouvrirTip));
  barre.appendChild(bouton(TXT.retour,function(){
    api.postMessage({type:'retourArticle',modifie:estModifie(),valeurs:valeurs()});},'',TXT.retourTip));
  ctl.enregistrer=bouton(TXT.enregistrer,function(){enregistrer(false);},'principal',TXT.enregistrerTip);
  barre.appendChild(ctl.enregistrer);
  var e=document.createElement('span');e.id='etat';e.setAttribute('role','status');barre.appendChild(e);ctl.etat=e;
  var ind=document.createElement('span');ind.id='indic';ind.setAttribute('aria-live','polite');barre.appendChild(ind);ctl.indic=ind;}

function construireFiche(){fiche.textContent='';
  champ(fiche,'legende');
  var a1=document.createElement('p');a1.className='aide';a1.textContent=TXT.legendeAide||'';fiche.appendChild(a1);
  var z=document.createElement('fieldset');z.className='zone';
  var lg=document.createElement('legend');lg.textContent=TXT.roleTitre||'';z.appendChild(lg);
  ctl.roleDecrit=radioRole(z,TXT.roleDecrit,TXT.roleDecritSous);
  ctl.roleDeco=radioRole(z,TXT.roleDeco,TXT.roleDecoSous);
  fiche.appendChild(z);
  champ(fiche,'alt');
  ctl.aideAlt=document.createElement('p');ctl.aideAlt.className='aide';fiche.appendChild(ctl.aideAlt);
  var deux=document.createElement('div');deux.className='deuxcol';
  champ(deux,'copyright');champ(deux,'source');
  fiche.appendChild(deux);}

function construireVisuel(nom,description,apercu){visuel.textContent='';
  if(apercu){var img=document.createElement('img');img.src=apercu;img.alt=nom||'';visuel.appendChild(img);}
  else{var p=document.createElement('p');p.className='absent';p.textContent=TXT.apercuAbsent||'';visuel.appendChild(p);}
  var n=document.createElement('p');n.className='nom';n.textContent=nom||'';visuel.appendChild(n);
  if(description){var d=document.createElement('p');d.className='desc';d.textContent=description;visuel.appendChild(d);}}

// Sans insertion dans le texte de l'article, la fiche le dit et se verrouille, n'ayant
// rien où écrire ; s'il y en a plusieurs, l'enregistrement les met toutes à jour.
function majAvis(){avis.className='avis';avis.textContent='';
  if(occurrences===0){avis.textContent=TXT.occZero||'';avis.className='avis visible alerte';}
  else if(occurrences>1){avis.textContent=(TXT.occPlusieurs||'').split('{0}').join(String(occurrences));
    avis.className='avis visible info';}
  var verrou=(occurrences===0);
  ['legende','alt','copyright','source'].forEach(function(k){if(ctl[k])ctl[k].disabled=verrou;});
  if(ctl.roleDecrit)ctl.roleDecrit.disabled=verrou;
  if(ctl.roleDeco)ctl.roleDeco.disabled=verrou;
  if(ctl.enregistrer)ctl.enregistrer.disabled=verrou;
  if(!verrou)majRole();}

function enregistrer(auto){if(occurrences===0){if(!auto)etat(TXT.occZero||'');return;}
  api.postMessage({type:'enregistrer',auto:!!auto,valeurs:valeurs()});}
// Ni minuteur ni enregistrement au changement de champ ici : l'écriture passe par un
// WorkspaceEdit et un doc.save() sur le .md, qui recompilent l'article. Reste le filet
// principal, l'écriture quand la webview perd le focus.
var autoEnr=SZH.autoEnregistrement({delai:0,estModifie:estModifie,enregistrer:enregistrer});

document.addEventListener('keydown',function(ev){if(!(ev.ctrlKey||ev.metaKey))return;
  if((ev.key||'').toLowerCase()==='s'){ev.preventDefault();enregistrer(false);}});

window.addEventListener('message',function(ev){var msg=ev.data||{};
  if(msg.type==='charger'){
    if(msg.i18n){TXT=msg.i18n;construireBarre();construireFiche();}
    nomFichier=String(msg.nom||'');apercuUrl=msg.apercu||null;
    occurrences=Number(msg.occurrences)||0;
    construireVisuel(nomFichier,msg.description,apercuUrl);
    poserValeurs(msg.valeurs);
    majAvis();
    enregistrees=valeurs();dernierModifie=false;
    etat('');majModifie();return;}
  if(msg.type==='enregistre'){autoEnr.confirme();enregistrees=valeurs();
    etat(msg.auto?'':(TXT.enregistre||''));majModifie();return;}
  if(msg.type==='erreur'){autoEnr.confirme();etat('⚠ '+msg.message);return;}});
api.postMessage({type:'pret'});
})();
