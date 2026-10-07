-- Aperçu seulement : rend à l'arbre la forme que les autres filtres attendent.
--
-- L'aperçu se lit avec `commonmark_x+sourcepos` : c'est le seul lecteur qui pose les
-- positions dans le source, dont la webview a besoin pour le clic vers le .md
-- (`markdown+sourcepos` n'existe pas). Mais sourcepos modifie l'arbre de trois façons :
--
--   1. chaque inline est enveloppé dans un Span « wrapper=1 » : une liste d'inlines n'a
--      plus de Str ni de Space de premier niveau ;
--   2. chaque bloc imbriqué (item de liste, bloc d'un div) est enveloppé dans un Div
--      « wrapper=1 » ;
--   3. les mots sont découpés à chaque signe : « p. » arrive en Str « p » + Str « . »,
--      « 12-25 » en Str « 12 » + Str « - » + Str « 25 ».
--
-- Sans correction, les filtres qui lisent les voisins d'un Space (szh-typographie.lua) ou
-- aplatissent le texte (szh-citations.lua) ne trouvent plus rien, sans le signaler.
--
-- Ce filtre défait 1 et 3. Il garde les Div de 2 : c'est d'eux que vient l'attribut
-- data-pos des blocs, sur lequel repose le clic vers la source. Un filtre qui doit voir à
-- travers ces Div les traverse lui-même (voir szh-grille.lua).
--
-- Les positions des inlines perdues ici ne servent pas : media/apercu.js les écarte (table
-- BLOCS) et retrouve le mot par recherche de texte dans le bloc.
--
-- Selon la version de pandoc, le Div sort en <div data-pos> autour du bloc ou se fond dans
-- l'élément enfant (<p data-pos>). blocDe() accepte les deux ; un contrôle qui chercherait
-- l'attribut sur une balise précise dépendrait de la version.
--
-- Premier filtre de la chaîne d'aperçu. Il n'est pas chargé ailleurs : le lecteur
-- `markdown` ne produit ni enveloppe ni mot coupé.

-- Remplace le Span d'enveloppe par son contenu. Les autres Span n'ont pas cet attribut.
local function deballer(el)
  if el.attributes['wrapper'] == '1' then return el.content end
end

-- Recolle les Str voisins : « p » et « . » redeviennent « p. », que cherchent les règles
-- d'abréviation (p. ex., pp. 12-25, n° 4) et de plage de pages.
local function recoller(inlines)
  local sortie, colle = pandoc.Inlines({}), false
  for _, il in ipairs(inlines) do
    local dernier = sortie[#sortie]
    if il.t == 'Str' and dernier and dernier.t == 'Str' then
      sortie[#sortie] = pandoc.Str(dernier.text .. il.text)
      colle = true
    else
      sortie:insert(il)
    end
  end
  if colle then return sortie end
end

-- Deux passes : les Str ne sont côte à côte qu'une fois les Span retirés.
return {
  { Span = deballer },
  { Inlines = recoller }
}
