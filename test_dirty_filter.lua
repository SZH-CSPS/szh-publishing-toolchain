
function Pandoc(doc)
  doc = doc:walk({
    Header = function(h)
      if h.attributes then
        if h.attributes.class then
          h.attributes.class = h.attributes.class .. ' test-class(with-parens) classe-avec-espace!'
        else
          h.attributes.class = 'test-class(with-parens) classe-avec-espace!'
        end
      end
      return h
    end
  })
  return doc
end
