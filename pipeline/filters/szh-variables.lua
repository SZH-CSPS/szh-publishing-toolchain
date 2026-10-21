-- Remplace `{{cle}}` dans le texte par la valeur de `cle` dans les métadonnées : buch.yaml
-- pour un livre, ausgabe.yaml pour un numéro, puis la fiche du chapitre ou de l'article,
-- qui l'emporte. `{{isbn-print}}` imprime l'ISBN saisi dans le formulaire du livre.
--
-- Le nom est la clé YAML telle quelle, sans espace entre les accolades. Une valeur
-- traduite (`title: {fr: …, de: …}`) donne celle de la langue du document. Une liste, une
-- valeur absente ou vide ne remplace rien : `{{cle}}` reste imprimé, et un avertissement
-- le signale une fois par document.
--
-- Le texte et la cible d'un lien sont remplacés ; le code (`{{cle}}` entre accents graves)
-- ne l'est pas, ce qui permet d'écrire le nom d'une variable sans la remplacer.
--
-- Placé avant typographie dans la chaîne (filtres.mk) : la valeur reçoit la même
-- typographie que le texte qui l'entoure.

local commun
do
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[variables] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

local MOTIF = '{{([%w_%.%-]+)}}'

-- La valeur texte de `cle`, ou nil et le code du constat.
local function valeur(meta, cle)
  local v = meta[cle]
  if v == nil then return nil, 'variable-inconnue' end
  local t = pandoc.utils.type(v)
  if t == 'table' or t == 'Meta' then
    local lang = commun.texte(meta.lang)
    if v[lang] == nil then return nil, 'variable-composee' end
    v = v[lang]
    t = pandoc.utils.type(v)
  end
  if t == 'List' then return nil, 'variable-composee' end
  local texte = commun.texte(v)
  if texte == '' then return nil, 'variable-vide' end
  return texte
end

local PHRASES = {
  ['variable-inconnue'] = {
    'La variable « {{%s}} » n’existe pas dans les métadonnées : elle reste imprimée telle quelle. Vérifiez son nom, ou ajoutez la clé.',
    'Die Variable «{{%s}}» gibt es in den Metadaten nicht: sie bleibt so gedruckt. Prüfen Sie den Namen, oder ergänzen Sie den Schlüssel.' },
  ['variable-vide'] = {
    'La variable « {{%s}} » est vide : elle reste imprimée telle quelle. Remplissez le champ dans le formulaire.',
    'Die Variable «{{%s}}» ist leer: sie bleibt so gedruckt. Füllen Sie das Feld im Formular aus.' },
  ['variable-composee'] = {
    'La variable « {{%s}} » n’est pas une valeur simple (liste, ou langue absente) : elle reste imprimée telle quelle.',
    'Die Variable «{{%s}}» ist kein einfacher Wert (Liste, oder Sprache fehlt): sie bleibt so gedruckt.' },
}

local signales = {}

local function signaler(cle, code)
  if signales[cle] then return end
  signales[cle] = true
  local fr, de = PHRASES[code][1], PHRASES[code][2]
  commun.constat('variables', 'avertissement', code,
    { 'article « ' .. commun.sans_barre(commun.slug_article()) .. ' »', 'variable « ' .. cle .. ' »' },
    commun.sans_barre(fr:format(cle)), commun.sans_barre(de:format(cle)))
end

-- Un texte en Str et Space, pour que les filtres suivants voient des mots.
local function en_inlines(texte, sortie)
  local premier = true
  for mot in texte:gmatch('%S+') do
    if not premier then sortie:insert(pandoc.Space()) end
    sortie:insert(pandoc.Str(mot))
    premier = false
  end
end

return {
  {
    Pandoc = function(doc)
      local meta = doc.meta

      -- Le lecteur markdown encode les accolades d'une adresse (%7B%7Bcle%7D%7D) ; le
      -- lecteur de l'aperçu les laisse telles quelles.
      local function remplacer_cible(s)
        local function remplacer(cle)
          local v, code = valeur(meta, cle)
          if v then return v end
          signaler(cle, code)
          return nil
        end
        s = s:gsub('%%7[Bb]%%7[Bb]([%w_%.%-]+)%%7[Dd]%%7[Dd]', remplacer)
        return (s:gsub(MOTIF, remplacer))
      end

      return doc:walk({
        Str = function(el)
          if not el.text:find('{{', 1, true) then return nil end
          local sortie = pandoc.Inlines({})
          local pos = 1
          while true do
            local debut, fin, cle = el.text:find(MOTIF, pos)
            if not debut then break end
            local v, code = valeur(meta, cle)
            if v then
              if debut > pos then sortie:insert(pandoc.Str(el.text:sub(pos, debut - 1))) end
              en_inlines(v, sortie)
            else
              signaler(cle, code)
              sortie:insert(pandoc.Str(el.text:sub(pos, fin)))
            end
            pos = fin + 1
          end
          if pos <= #el.text then sortie:insert(pandoc.Str(el.text:sub(pos))) end
          return sortie
        end,
        Link = function(el)
          if not el.target:find('{{', 1, true) and not el.target:upper():find('%7B%7B', 1, true) then
            return nil
          end
          el.target = remplacer_cible(el.target)
          return el
        end,
      })
    end,
  },
}
