#!/usr/bin/env python3
# Rapport de conversion trilingue FR/DE/EN (D30) — HTML autonome sur stdout.
# Langue par défaut : celle du navigateur (navigator.language), boutons pour changer.
# usage: rapport.py <rapport.json> <slug>
import json, sys, html

donnees = {}
try:
    with open(sys.argv[1], encoding='utf-8') as f:
        donnees = json.load(f)
except Exception:
    pass
slug = sys.argv[2] if len(sys.argv) > 2 else 'article'

def g(*chemin, defaut=0):
    d = donnees
    for c in chemin:
        if not isinstance(d, dict) or c not in d:
            return defaut
        d = d[c]
    return d

T = {
  'fr': {
    'titre': 'Rapport de conversion',
    'intro': 'Ce document Word a été converti automatiquement. Voici ce qui a été fait et ce qu''il vaut la peine de vérifier.',
    'converti': 'Ce qui a été converti',
    'verifier': 'À vérifier',
    'conseils': 'Conseils pour les prochains documents Word',
    's_titres': 'titres repris des styles Word',
    's_titres_deduits': 'titres déduits de paragraphes en gras',
    's_titres_vides': 'titres vides supprimés',
    's_notes': 'notes de bas de page',
    's_images': 'images',
    's_fig_leg': 'figures avec légende reconnue',
    's_tab': 'tableaux',
    's_tab_leg': 'dont avec légende reconnue',
    's_tab_simple': 'tableaux simplifiés (cellules fusionnées ou multi-lignes aplaties)',
    's_listes': 'listes reconstruites à partir de puces manuelles',
    's_refs': 'références bibliographiques structurées (fichier .bib créé)',
    's_cit': 'citations liées à la bibliographie',
    's_alt': 'descriptions d''images parasites supprimées',
    'v_cit_titre': 'Citations non reliées (laissées telles quelles dans le texte) :',
    'v_fig': 'figure(s) sans légende reconnue — ajouter une légende « Figure n : … » sous l''image.',
    'v_tab': 'tableau(x) contenaient des cellules fusionnées ou multi-lignes : ils ont été aplatis — vérifier leur lisibilité.',
    'v_num': 'Les numéros de figures/tableaux sont désormais automatiques : vérifier que les renvois du texte (« voir Figure 2 ») correspondent toujours.',
    'v_refs_aucune': 'Aucune liste de références n''a été détectée — si l''article en contient une, elle est restée telle quelle dans le texte.',
    'v_relire': 'Relire une fois l''article converti côte à côte avec l''original Word.',
    'c_styles': 'Utiliser les styles Word « Titre 1 », « Titre 2 »… plutôt que du gras.',
    'c_legendes': 'Légender images et tableaux : « Figure 1 : … », « Tableau 1 : … » juste au-dessus ou en dessous.',
    'c_listes': 'Utiliser les vraies listes à puces de Word, pas des tirets tapés à la main.',
    'c_refs': 'Terminer par la liste de références, une référence par paragraphe.',
    'c_cit': 'Citer dans le texte au format (Auteur, année) ou (Auteur, année, p. 5).',
    'c_tableaux': 'Garder les tableaux simples (éviter les cellules fusionnées).',
  },
  'de': {
    'titre': 'Konvertierungsbericht',
    'intro': 'Dieses Word-Dokument wurde automatisch konvertiert. Hier steht, was gemacht wurde und was Sie prüfen sollten.',
    'converti': 'Was konvertiert wurde',
    'verifier': 'Bitte prüfen',
    'conseils': 'Tipps für die nächsten Word-Dokumente',
    's_titres': 'Überschriften aus Word-Formatvorlagen übernommen',
    's_titres_deduits': 'Überschriften aus Fett-Absätzen abgeleitet',
    's_titres_vides': 'leere Überschriften entfernt',
    's_notes': 'Fussnoten',
    's_images': 'Bilder',
    's_fig_leg': 'Abbildungen mit erkannter Legende',
    's_tab': 'Tabellen',
    's_tab_leg': 'davon mit erkannter Legende',
    's_tab_simple': 'Tabellen vereinfacht (verbundene oder mehrzeilige Zellen aufgelöst)',
    's_listes': 'Listen aus manuellen Aufzählungszeichen rekonstruiert',
    's_refs': 'Literaturangaben strukturiert (.bib-Datei erstellt)',
    's_cit': 'Zitate mit der Literaturliste verknüpft',
    's_alt': 'störende Bildbeschreibungen entfernt',
    'v_cit_titre': 'Nicht verknüpfte Zitate (unverändert im Text belassen):',
    'v_fig': 'Abbildung(en) ohne erkannte Legende — eine Legende « Abbildung n: … » unter dem Bild ergänzen.',
    'v_tab': 'Tabelle(n) enthielten verbundene oder mehrzeilige Zellen: sie wurden aufgelöst — Lesbarkeit prüfen.',
    'v_num': 'Abbildungs-/Tabellennummern sind jetzt automatisch: prüfen Sie, ob Verweise im Text («siehe Abbildung 2») noch stimmen.',
    'v_refs_aucune': 'Es wurde keine Literaturliste erkannt — falls der Artikel eine enthält, blieb sie unverändert im Text.',
    'v_relire': 'Den konvertierten Artikel einmal neben dem Word-Original gegenlesen.',
    'c_styles': 'Word-Formatvorlagen «Überschrift 1», «Überschrift 2»… statt Fettdruck verwenden.',
    'c_legendes': 'Bilder und Tabellen beschriften: «Abbildung 1: …», «Tabelle 1: …» direkt darüber oder darunter.',
    'c_listes': 'Echte Word-Aufzählungen verwenden, keine von Hand getippten Striche.',
    'c_refs': 'Mit der Literaturliste abschliessen, eine Angabe pro Absatz.',
    'c_cit': 'Im Text im Format (Autor, Jahr) oder (Autor, Jahr, S. 5) zitieren.',
    'c_tableaux': 'Tabellen einfach halten (verbundene Zellen vermeiden).',
  },
  'en': {
    'titre': 'Conversion report',
    'intro': 'This Word document was converted automatically. Here is what was done and what is worth checking.',
    'converti': 'What was converted',
    'verifier': 'Please check',
    'conseils': 'Tips for the next Word documents',
    's_titres': 'headings taken from Word styles',
    's_titres_deduits': 'headings deduced from bold paragraphs',
    's_titres_vides': 'empty headings removed',
    's_notes': 'footnotes',
    's_images': 'images',
    's_fig_leg': 'figures with a recognised caption',
    's_tab': 'tables',
    's_tab_leg': 'of which with a recognised caption',
    's_tab_simple': 'tables simplified (merged or multi-line cells flattened)',
    's_listes': 'lists rebuilt from manual bullets',
    's_refs': 'references structured (.bib file created)',
    's_cit': 'citations linked to the bibliography',
    's_alt': 'noisy image descriptions removed',
    'v_cit_titre': 'Unlinked citations (left as-is in the text):',
    'v_fig': 'figure(s) without a recognised caption — add “Figure n: …” below the image.',
    'v_tab': 'table(s) contained merged or multi-line cells: they were flattened — check readability.',
    'v_num': 'Figure/table numbers are now automatic: check that in-text references (“see Figure 2”) still match.',
    'v_refs_aucune': 'No reference list was detected — if the article has one, it was left unchanged in the text.',
    'v_relire': 'Proofread the converted article once, side by side with the Word original.',
    'c_styles': 'Use Word styles “Heading 1”, “Heading 2”… instead of bold text.',
    'c_legendes': 'Caption images and tables: “Figure 1: …”, “Table 1: …” right above or below.',
    'c_listes': 'Use real Word bullet lists, not hand-typed dashes.',
    'c_refs': 'End with the reference list, one reference per paragraph.',
    'c_cit': 'Cite in the text as (Author, year) or (Author, year, p. 5).',
    'c_tableaux': 'Keep tables simple (avoid merged cells).',
  },
}

def bloc_langue(lg):
    t = T[lg]
    e = html.escape
    lignes = []
    def item(n, cle, toujours=False):
        if n or toujours:
            lignes.append(f'<li><b>{n}</b> {e(t[cle])}</li>')
    item(g('titres_reels'), 's_titres', toujours=True)
    item(g('titres_deduits') and len(g('titres_deduits', defaut=[])), 's_titres_deduits')
    item(g('titres_vides_supprimes'), 's_titres_vides')
    item(g('notes'), 's_notes')
    item(g('images'), 's_images', toujours=True)
    item(g('figures_legendees'), 's_fig_leg')
    item(g('tableaux'), 's_tab', toujours=True)
    item(g('tableaux_legendes'), 's_tab_leg')
    item(g('tableaux_simplifies'), 's_tab_simple')
    item(g('listes_reconstruites'), 's_listes')
    item(g('refs', 'n'), 's_refs')
    item(g('citations', 'liees'), 's_cit')
    item(g('alt_ia_purges'), 's_alt')
    converti = '\n'.join(lignes)

    averts = []
    non_res = g('citations', 'non_resolues', defaut=[]) or []
    if non_res:
        li = '\n'.join(f'<li><code>{e(c)}</code></li>' for c in non_res[:30])
        averts.append(f'<li>{e(t["v_cit_titre"])}<ul>{li}</ul></li>')
    if g('figures_sans_legende'):
        averts.append(f'<li><b>{g("figures_sans_legende")}</b> {e(t["v_fig"])}</li>')
    if g('tableaux_simplifies'):
        averts.append(f'<li><b>{g("tableaux_simplifies")}</b> {e(t["v_tab"])}</li>')
    if g('numeros_figures_retires', defaut=[]) or g('tableaux_legendes'):
        averts.append(f'<li>{e(t["v_num"])}</li>')
    if 'pas-de-liste-references-detectee' in (g('avertissements', defaut=[]) or []):
        averts.append(f'<li>{e(t["v_refs_aucune"])}</li>')
    averts.append(f'<li>{e(t["v_relire"])}</li>')
    verifier = '\n'.join(averts)

    conseils = '\n'.join(f'<li>{e(t[c])}</li>' for c in
                         ('c_styles', 'c_legendes', 'c_listes', 'c_refs', 'c_cit', 'c_tableaux'))

    return f'''<div class="langue" id="langue-{lg}">
<h1>{e(t['titre'])} — {html.escape(slug)}</h1>
<p class="intro">{e(t['intro'])}</p>
<h2>{e(t['converti'])}</h2>
<ul>{converti}</ul>
<h2>{e(t['verifier'])}</h2>
<ul>{verifier}</ul>
<h2>{e(t['conseils'])}</h2>
<ul>{conseils}</ul>
</div>'''

corps = '\n'.join(bloc_langue(lg) for lg in ('fr', 'de', 'en'))

print(f'''<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rapport — {html.escape(slug)}</title>
<style>
body {{ font-family: "Segoe UI", system-ui, sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; line-height: 1.5; }}
h1 {{ font-size: 1.4rem; border-bottom: 2px solid #0a6e8a; padding-bottom: .4rem; }}
h2 {{ font-size: 1.05rem; color: #0a6e8a; margin-top: 1.6rem; }}
.intro {{ color: #444; }}
li {{ margin: .25rem 0; }}
code {{ background: #f2f2f2; padding: .05rem .3rem; border-radius: 3px; font-size: .9em; }}
.langues {{ text-align: right; }}
.langues button {{ border: 1px solid #bbb; background: #fff; padding: .25rem .7rem; cursor: pointer; border-radius: 4px; margin-left: .3rem; }}
.langues button.actif {{ background: #0a6e8a; color: #fff; border-color: #0a6e8a; }}
.langue {{ display: none; }}
.langue.actif {{ display: block; }}
</style>
</head>
<body>
<div class="langues">
<button data-lg="fr">FR</button><button data-lg="de">DE</button><button data-lg="en">EN</button>
</div>
{corps}
<script>
(function () {{
  function montre(lg) {{
    document.querySelectorAll('.langue').forEach(function (d) {{ d.classList.toggle('actif', d.id === 'langue-' + lg); }});
    document.querySelectorAll('.langues button').forEach(function (b) {{ b.classList.toggle('actif', b.dataset.lg === lg); }});
  }}
  document.querySelectorAll('.langues button').forEach(function (b) {{
    b.addEventListener('click', function () {{ montre(b.dataset.lg); }});
  }});
  var nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  montre(nav === 'fr' || nav === 'de' ? nav : 'en');
}})();
</script>
</body>
</html>''')
