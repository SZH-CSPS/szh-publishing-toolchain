-- Rend la mise en évidence (::: {.highlight}, alias .hervorhebung) muette pour un lecteur
-- d'écran dans le HTML publié, quand elle répète un passage du texte : son texte, ramené à
-- ses lettres et chiffres, figure tel quel dans le reste du document. Une exergue dont le
-- texte n'existe nulle part ailleurs reste lue.
--
-- aria-hidden="true" sur le bloc, et tabindex="-1" sur ses liens : un lien atteignable au
-- clavier dans un bloc masqué est un défaut d'accessibilité. Le lien n'est pas retiré, car
-- il perdrait sa couleur et son soulignement dans le PDF.
--
-- WeasyPrint ignore aria-hidden : dans le PDF, l'exergue reste lue.
--
-- Absent de la chaîne de l'aperçu : la personne qui relit son article avec un lecteur
-- d'écran doit y entendre l'exergue.

local CLASSES = { highlight = true, hervorhebung = true }

local function est_exergue(d)
  for _, c in ipairs(d.classes) do
    if CLASSES[c] then return true end
  end
  return false
end

-- Texte comparable : minuscules, et tout ce qui n'est ni lettre ni chiffre (ponctuation,
-- espaces, insécables, apostrophes) ramené à une espace. Le trait de césure conditionnel
-- disparaît sans laisser d'espace. Rend le texte entouré d'espaces, pour chercher des mots
-- entiers.
local function normaliser(texte)
  local bas = pandoc.text.lower(texte)
  local morceaux = {}
  for _, cp in utf8.codes(bas) do
    if cp == 0xAD then
      -- césure conditionnelle : rien
    elseif (cp >= 0x30 and cp <= 0x39) or (cp >= 0x61 and cp <= 0x7A)
        or (cp >= 0xC0 and cp ~= 0xD7 and cp ~= 0xF7
            and not (cp >= 0x2000 and cp <= 0x206F)
            and not (cp >= 0x2E00 and cp <= 0x2E7F)
            and not (cp >= 0x3000 and cp <= 0x303F)
            and cp ~= 0xFEFF) then
      morceaux[#morceaux + 1] = utf8.char(cp)
    else
      morceaux[#morceaux + 1] = ' '
    end
  end
  local s = table.concat(morceaux):gsub('%s+', ' ')
  return ' ' .. s:gsub('^ ', ''):gsub(' $', '') .. ' '
end

local function masquer(d)
  d.attributes['aria-hidden'] = 'true'
  return d:walk({ Link = function(l)
    l.attributes['tabindex'] = '-1'
    return l
  end })
end

function Pandoc(doc)
  -- Le document sans ses exergues : c'est là que leur texte doit se retrouver.
  local reste = doc.blocks:walk({
    Div = function(d) if est_exergue(d) then return {} end end,
  })
  local corps = normaliser(pandoc.utils.stringify(reste))
  doc.blocks = doc.blocks:walk({
    Div = function(d)
      if not est_exergue(d) then return nil end
      local texte = normaliser(pandoc.utils.stringify(d))
      if texte == '  ' or not corps:find(texte, 1, true) then return nil end
      return masquer(d)
    end,
  })
  return doc
end
