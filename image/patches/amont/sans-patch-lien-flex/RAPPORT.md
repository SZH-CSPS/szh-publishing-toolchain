# Sans patch : un lien enfant direct d'un conteneur flex

Pas de correctif dans `image/patches/weasyprint-70.0/` : la chaîne contourne le défaut en
HTML. Ce dossier garde la mesure, la cause et l'état amont pour rejuger à la montée de version.

## Le défaut

Dans WeasyPrint 70.0, un `<a href>` qui est **enfant direct d'un conteneur flex**
n'a aucune annotation `/Link` dans le PDF : le texte s'affiche, il n'est pas cliquable, rien
n'est écrit sur stderr. Selon le fil amont (non mesuré ici), veraPDF passe, puisqu'il n'y a plus de
lien à contrôler. Un `<span>` entre le conteneur et le `<a>` rend l'annotation.

Mesuré le 01.10.2026 sur la 70.0 installée dans la WSL (`demo/demo.sh`, HTML dans
`demo/lien-flex.html`) :

```
== sans <span> intermédiaire
  annotations /Link : 0
== avec <span> intermédiaire
  annotations /Link : 1
    https://example.org/b
```

## La cause dans le code de la 70.0

`weasyprint/html.py`, `handle_a()` (ligne 237) pose le lien **sur la boîte** de l'élément :
`box.link = get_link(href, base_url)`. `weasyprint/anchors.py`, `gather_anchors()` (lignes
84-113) lit `box.link or parent_link` à chaque boîte non textuelle et ajoute l'annotation.

Un item flex doit être de niveau bloc. `flex_children()` (`formatting_structure/build.py`,
ligne 1045) appelle `blockify(child, 'flex')`, qui, pour une boîte en ligne (`InlineBox`, le
cas d'un `<a>`), **remplace** la boîte :

```python
elif isinstance(box, boxes.InlineLevelBox):
    anonymous = boxes.BlockBox.anonymous_from(box, box.children)
...
anonymous.style = box.style
```

`anonymous_from()` ne reprend ni `link` (attribut d'instance posé par `handle_a`, `None` en
classe, `boxes.py` ligne 88) ; seuls `style` et `is_flex_item` sont recopiés. La boîte
d'origine est jetée, ses enfants passent sous la nouvelle : plus aucune boîte du sous-arbre
ne porte le lien, et `gather_anchors()` n'a rien à hériter. Avec un `<span>` intermédiaire,
c'est le `<span>` qui est remplacé ; le `<a>` reste un `InlineBox` dans son sous-arbre,
avec son `link`. Les liens sur un bloc hors flex (`display: block`) fonctionnent : la boîte
n'est pas passée par `blockify`.

## Notre contournement

Jamais d'`<a>` enfant direct d'un conteneur flex (règle de CLAUDE.md §6). Le `<span>`
intermédiaire, sans classe, est posé dans `pipeline/templates/szh-article.html` (ligne du
DOI, commentaire sur le flex de `.szh-doi`) et dans `pipeline/livre-assembler.py`. Le
contournement n'a aucun effet visuel.

## Ce que dit l'amont (lecture seule, 01.10.2026)

- [#2941](https://github.com/Kozea/WeasyPrint/issues/2941) « A link that is a flex item gets
  no link annotation », **ouverte** le 28.09.2026, étiquette `bug`. liZe : « There's
  definitely something wrong, we'll find a way to fix that. » Pas de correctif fusionné ni de
  PR liée.
- Un commentaire, d'un compte qui se présente comme un agent, donne la même cause que
  ci-dessus, une régression de la 70.0 (le lien est passé du style hérité à un attribut de
  boîte, et `blockify()` a cessé d'envelopper la boîte), le même défaut pour
  `bookmark-label` d'un item flex ou grille, et un diff de deux lignes qui recopie `link` et
  `bookmark_label`. liZe a répondu à son offre de PR : « Don't. » Nous n'avons mesuré ni la
  régression (versions antérieures) ni `bookmark-label` : à ne pas citer comme nôtre.
- Recherches `gh search issues --repo Kozea/WeasyPrint` sur « flex link », « flex item
  link », « blockify » : seule #2941 correspond. Aucune PR.

## Recommandation

**Ne rien publier.** L'issue existe, un mainteneur l'a reconnue, la cause y est déjà écrite.
Un commentaire de plus n'apporterait que notre démo ; `ISSUE.md` en garde le texte, au cas
où Robin voudrait la joindre. **Ne pas patcher** : le contournement HTML suffit. Garder la
règle « pas d'`<a>` enfant direct d'un flex », et la rejuger à chaque montée : si #2941 est
corrigée, le `<span>` devient inutile sans être gênant.

## Démo

```
wsl.exe -d SZH-Publishing -- bash /mnt/c/Users/robin/Documents/Prog/szh-publishing-toolchain/image/patches/amont/sans-patch-lien-flex/demo/demo.sh
```

Elle rend deux PDF avec le `/opt/weasyprint` installé (rien n'est copié ni patché) et compte
les annotations `/Link` avec pypdf.
