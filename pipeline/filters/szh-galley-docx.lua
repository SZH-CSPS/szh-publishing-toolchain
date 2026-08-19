-- szh-galley-docx.lua — nettoyage du galley Word (F7), HTML autonome -> .docx.
--
-- Le .docx d'export OJS est régénéré depuis le HTML final, pas depuis le .md : le
-- lecteur html de pandoc voit le balisage, jamais le CSS. Tout ce que print.css
-- masque à l'écran ou à l'impression réapparaît donc EN CLAIR dans le Word.
--
-- Un seul cas aujourd'hui : .szh-description, la description longue d'un tableau
-- (D104). Elle n'existe que pour être la cible d'un aria-describedby ; en Word, où
-- aucun mécanisme équivalent n'existe, elle ne serait qu'un paragraphe de prose
-- surnuméraire collé sous le tableau. On la retire.
--
-- ⚠ Rien d'autre n'est retiré : le galley doit rester le texte COMPLET de l'article.
-- N'ajouter une classe ici que si elle est, comme celle-ci, purement technique.

local A_RETIRER = { ['szh-description'] = true }

function Div(div)
  for _, classe in ipairs(div.classes) do
    if A_RETIRER[classe] then return {} end
  end
  return nil
end
