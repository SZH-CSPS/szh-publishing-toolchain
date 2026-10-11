-- EPUB du livre : rend tel quel le XHTML qu'un <div data-szh-brut="…"> porte en attribut.
--
-- livre-epub-prepare.py met ainsi de côté chaque tableau du livre (avec sa note et sa
-- description longue), pour que pandoc --from=html ne le reconstruise pas : relu dans le
-- modèle de tableau de pandoc, un tableau complexe perdrait ses <th> de rangée, ses
-- headers= et l'identifiant de sa note. Filtre passé à la seule commande qui écrit l'EPUB
-- (profils/livre.mk).

function Div(div)
  -- Le lecteur HTML de pandoc range data-szh-brut sous la clé szh-brut.
  local xhtml = div.attributes['szh-brut']
  if xhtml then
    return pandoc.RawBlock('html', xhtml)
  end
end
