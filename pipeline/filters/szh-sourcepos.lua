-- Aperçu seulement : rend à l'arbre la forme que les autres filtres attendent.
--
-- L'aperçu HTML se lit avec `commonmark_x+sourcepos`, et non avec le lecteur `markdown`
-- de la chaîne PDF : c'est le seul lecteur qui pose les positions source, dont la webview
-- a besoin pour le clic vers le .md — `markdown+sourcepos` n'existe pas, pandoc le refuse.
-- Mais sourcepos ne se contente pas d'ajouter des positions, il déforme l'arbre de trois
-- façons, et deux d'entre elles rendaient des filtres entiers inertes SANS RIEN DIRE :
--
--   1. chaque en-ligne est enveloppé dans un Span « wrapper=1 » : une liste d'inlines n'a
--      donc plus un seul Str ni un seul Space de premier niveau ;
--   2. chaque bloc imbriqué (item de liste, bloc d'un div fencé) est enveloppé dans un
--      Div « wrapper=1 » ;
--   3. les mots sont découpés à chaque signe : « p. » arrive en Str « p » + Str « . »,
--      « 12-25 » en Str « 12 » + Str « - » + Str « 25 ».
--
-- Ce que cela coûtait, mesuré sur un article d'essai (11.09.2026) :
--   * szh-typographie.lua : 6 espaces insécables dans le PDF, 0 dans l'aperçu. Ses règles
--     de frontière lisent les inlines voisins d'un Space, et il n'y avait plus de Space.
--   * szh-citations.lua : 3 appels et 2 liens dans le PDF, 0 et 0 dans l'aperçu. Son
--     aplatir() écrit \1 pour tout inline qui n'est ni Str ni Space — le texte plat n'était
--     plus qu'une suite de \1, qu'aucun motif d'appel ne traverse.
--   Le rédacteur relisait donc un aperçu sans typographie maison et sans un seul lien de
--   bibliographie, y compris le soulignement en pointillé des appels non résolus, qui est
--   précisément ce qui lui montre le travail qui reste.
--
-- Ce filtre défait 1 et 3. Il ne touche PAS aux Div « wrapper=1 » (2), et c'est délibéré :
-- pandoc fond ce Div dans l'élément qu'il contient à l'écriture, et c'est de là que vient
-- le `<p data-pos="…">` sur lequel repose le clic vers la source. Les déballer faisait
-- tomber les blocs positionnés de 9 à 2 sur le même essai — le clic n'aurait plus marché
-- que sur les titres. Un filtre qui a besoin de voir à travers ces Div les traverse
-- lui-même ; szh-grille.lua le fait.
--
-- Les positions en ligne, elles, ne servent à personne : media/apercu.js les écarte
-- explicitement (table BLOCS) et retrouve le mot par recherche de texte dans la plage du
-- bloc. Les perdre ne coûte rien.
--
-- À poser en TÊTE de la chaîne d'aperçu, avant tout autre filtre. Hors de l'aperçu il
-- n'est pas chargé : sous le lecteur `markdown` il n'y a ni Span d'enveloppe ni mot coupé.

-- Le Span d'enveloppe disparaît, son contenu prend sa place. Un Span écrit par un rédacteur
-- ou posé par un autre filtre ne porte pas cet attribut et n'est pas touché.
local function deballer(el)
  if el.attributes['wrapper'] == '1' then return el.content end
end

-- Recolle les Str voisins. Sans enveloppe entre eux, « p » et « . » redeviennent « p. » :
-- c'est ce que les règles d'abréviation (p. ex., pp. 12-25, n° 4) et la plage de pages
-- cherchent en fin de chaîne. Rien n'est perdu — deux Str collés et un seul Str s'écrivent
-- pareil ; seule la position du second s'en va, et elle ne servait pas.
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

-- Deux passes, dans cet ordre : le recollage ne voit les Str côte à côte qu'une fois les
-- enveloppes parties. Les faire dans la même passe ne recollerait rien.
return {
  { Span = deballer },
  { Inlines = recoller }
}
