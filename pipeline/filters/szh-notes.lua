-- Notes de bas de page : chaque Note devient un <span class="szh-note"> à l'endroit de
-- l'appel, pour être imprimée au bas de sa page.
--
-- Le writer HTML de pandoc regroupe les notes dans une <section class="footnotes"> en fin
-- de document. WeasyPrint sait imprimer en bas de page un élément `float: footnote` (CSS
-- GCPM) : il le place dans la zone @footnote de la page de l'appel et numérote appel et
-- marque (::footnote-call, ::footnote-marker). Il faut pour cela que le contenu de la note
-- soit en ligne, à l'endroit de l'appel.
--
-- Dernier filtre de la chaîne, après szh-citations.lua : les autres filtres voient des
-- Note ordinaires.
--
-- Ne s'applique pas :
--   * aux sorties non HTML, qui ne sauraient que faire du Span (le galley DOCX, lui, part
--     du HTML final) ;
--   * à l'aperçu du cockpit (SZH_APERCU=1), non paginé, où les notes de fin avec leurs
--     liens aller-retour conviennent.
--
-- Un navigateur ne connaît pas `float: footnote` : à l'écran, print.css (@media screen)
-- pose la note en bloc détaché sous son paragraphe.

if FORMAT == nil or not FORMAT:match('html') then return {} end
if (os.getenv('SZH_APERCU') or '') ~= '' then return {} end

local blocs_en_inlines = pandoc.utils.blocks_to_inlines

-- Le contenu de la note doit tenir sur une seule ligne de HTML : dans la zone @footnote,
-- WeasyPrint rend un saut de ligne du source comme une coupure dure (`white-space: normal`
-- n'y change rien). Or le writer HTML de pandoc replie ses lignes vers la 72e colonne, et
-- --wrap=none s'appliquerait à tout le document. La note est donc écrite ici en HTML
-- déplié et rendue en RawInline, que pandoc recopie tel quel.
local function html_deplie(inlines)
  local html = pandoc.write(pandoc.Pandoc({ pandoc.Plain(inlines) }), 'html')
  -- Toute suite de blancs, saut de ligne compris, devient une espace.
  return (html:gsub('%s+', ' '):gsub('^ +', ''):gsub(' +$', ''))
end

return {
  {
    Note = function(note)
      -- Une note de plusieurs blocs est aplatie avec une espace : dans la zone @footnote,
      -- une note tient en un paragraphe.
      local contenu = blocs_en_inlines(note.content, { pandoc.Space() })
      return pandoc.RawInline('html',
        '<span class="szh-note">' .. html_deplie(contenu) .. '</span>')
    end
  }
}
