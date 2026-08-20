-- Nettoie le galley Word de l'export OJS (HTML autonome -> .docx) : le lecteur html de
-- pandoc voit le balisage, jamais le CSS, donc tout ce que print.css masque
-- réapparaîtrait en clair dans le Word. Un seul cas aujourd'hui, .szh-description : la
-- description longue d'un tableau, qui n'existe que pour être la cible d'un
-- aria-describedby et n'aurait aucun équivalent en Word.
-- Rien d'autre n'est retiré : le galley doit rester le texte complet de l'article.

local A_RETIRER = { ['szh-description'] = true }

function Div(div)
  for _, classe in ipairs(div.classes) do
    if A_RETIRER[classe] then return {} end
  end
  return nil
end
