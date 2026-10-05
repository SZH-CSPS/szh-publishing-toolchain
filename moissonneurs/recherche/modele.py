"""Ce qu'une source rend au moissonneur. Voir LISEZMOI.md."""
from dataclasses import dataclass, field, asdict


@dataclass
class Projet:
    source: str            # 'snf', 'skbf', 'site:hfh', 'site:phbern'...
    source_id: str         # stable dans la source : n° de subside, n° SKBF, URL de la page
    url: str               # page publique du projet (va dans Lien)
    title: str
    langue: str = ''       # 'de' | 'fr' | 'en' | '' si inconnue
    institutions: str = '' # « A, B, C », comme dans les fiches existantes
    debut: str = ''        # AAAA, AAAA-MM ou AAAA-MM-JJ
    fin: str = ''
    descriptif: str = ''
    date_source: str = ''  # dernière modification connue côté source (lastmod, date de décision...)
    extra: dict = field(default_factory=dict)  # tout le reste, conservé tel quel en base

    def en_dict(self):
        return asdict(self)
