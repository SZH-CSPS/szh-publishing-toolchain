"""Étage 2 : classement local, hors ligne. Score transparent, verdict avec raison lisible.

Entrée : une affaire de la base, son titre, le texte de ses documents. Sortie : verdict
`retenu` | `a-relire` | `ecarte`, domaine CDPH, jeton d'instrument, raison. Aucun réseau.
"""
import json
import re
from dataclasses import dataclass, field

from . import correspondances as corr
from .lexique import normaliser as lexique_normaliser

# Barèmes (voir LISEZMOI.md).
PTS_TITRE_FORT = 4.0       # par terme d'ancrage fort distinct dans le titre (2 au plus)
PTS_TEXTE_FORT = 1.0       # par terme fort distinct dans le texte (5 au plus)
PTS_OCCURRENCE = 0.25      # par occurrence forte dans le texte (20 au plus)
PTS_TITRE_FAIBLE = 1.0     # par terme ambigu distinct dans le titre (2 au plus)
PTS_TEXTE_FAIBLE = 0.25    # par terme ambigu distinct dans le texte (4 au plus)
# Un texte seul ne fait « retenu » que s'il parle vraiment du sujet : assez d'occurrences ET assez dense.
TEXTE_MIN_OCCURRENCES = 5
TEXTE_MIN_DENSITE = 1.0    # occurrences fortes par 1 000 caractères
FAIBLE_TEXTE_MIN = 3       # occurrences d'un ancrage ambigu dans le texte pour « a-relire »

VERDICTS = ('retenu', 'a-relire', 'ecarte')
VIVIER_MIN_TERMES = 2           # vivier élargi : termes forts distincts dans le texte
PREFIXE_VIVIER = 'vivier élargi (texte-large)'


@dataclass
class Resultat:
    verdict: str
    score: float
    domaine: str = ''
    jeton: str = ''
    raison: str = ''
    details: dict = field(default_factory=dict)


def _forts_faibles(touches):
    forts = [t for t in touches if not t.terme.ambigu]
    faibles = [t for t in touches if t.terme.ambigu]
    return forts, faibles


def _distincts(touches):
    return sorted({t.terme.texte for t in touches})


def classer(lex, a, texte, candidat=True, ecole_generale=False, themes_elargis=False, extrait=False, vivier_large=False):
    """a : dict avec body_key, number, title, type_name (JSON ou dict), type_harmonized_id.

    `texte` : texte des documents ('' si absent). `candidat` : l'affaire vient de la recherche serveur.
    `vivier_large` : un objet sinon écarté qui a au moins 2 termes forts distincts dans le texte devient « à relire »
    (catégorie `texte-large`, jamais « retenu »).
    `extrait` : `texte` n'est pas un document mais les extraits de la recherche serveur (texte absent).
    `ecole_generale` : palier facultatif, une affaire d'école ordinaire sans ancrage passe en « à relire ».
    """
    tn = a.get('type_name')
    if isinstance(tn, str):
        try:
            tn = json.loads(tn)
        except ValueError:
            pass
    type_ = corr.type_effectif(a['body_key'], a.get('number'), tn, a.get('type_harmonized_id'))
    harm = type_.get('harm')
    titre = a.get('title') or ''

    def fin(verdict, score, raison, domaine='', details=None):
        return Resultat(verdict, round(score, 2), domaine, type_['jeton'] or '', raison, details or {})

    # 0. Arriéré historique : objets anciens que la source date de la période suivie (revue adverse, constat 5)
    arriere = _arriere(a)
    if arriere:
        return fin('ecarte', 0, 'arriéré historique : ' + arriere)

    # 1. Types écartés d'office
    if type_['ecarte']:
        return fin('ecarte', 0, f"type écarté : {type_['ecarte']}")
    if harm in lex.types_ecartes:
        return fin('ecarte', 0, f'type écarté : {lex.types_ecartes[harm]}')
    libs = [str(v) for v in (tn.values() if isinstance(tn, dict) else [tn] if tn else []) if v]
    regie = None
    if harm in (9, None) and libs:
        regie = next((r for r in (lex.type_regierung(l) for l in libs) if r), None)
        if regie == 'jeter' and not _forts_faibles(lex.ancrages(titre))[0]:     # sauf si le titre a un ancrage fort
            return fin('ecarte', 0, f'affaire du gouvernement de type écarté ({libs[0]})')

    # 2. Ancrages
    t_forts, t_faibles = _forts_faibles(lex.ancrages(titre))
    # Les termes « titre seul » (sigles ambigus IV, AI, droits politiques, inklusiv…) ne comptent jamais dans le texte
    x_forts, x_faibles = (_forts_faibles([t for t in lex.ancrages(texte) if not t.terme.titre_seul])
                          if texte else ([], []))
    if extrait:      # dans l'extrait de recherche, la famille AI/handicap n'est qu'une mention (scénario R)
        x_forts = [t for t in x_forts if lexique_normaliser(t.terme.texte) not in lex.hors_extrait]
    abaisse = lex.abaissements(titre + ' ' + texte[:20000])
    dom_titre = lex.compter_domaines(titre)
    dom_texte = lex.compter_domaines(texte[:50000]) if texte else {}
    scores_dom = {}
    for d, n in dom_titre.items():
        scores_dom[d] = scores_dom.get(d, 0) + 3 * n
    for d, n in dom_texte.items():
        scores_dom[d] = scores_dom.get(d, 0) + min(n, 5)
    rang = {d.id: d.rang for d in lex.domaines}
    domaine = min(scores_dom, key=lambda d: (-scores_dom[d], rang[d])) if scores_dom else ''

    score = (PTS_TITRE_FORT * min(len(_distincts(t_forts)), 2)
             + PTS_TEXTE_FORT * min(len(_distincts(x_forts)), 5)
             + PTS_OCCURRENCE * min(len(x_forts), 20)
             + PTS_TITRE_FAIBLE * min(len(_distincts(t_faibles)), 2)
             + PTS_TEXTE_FAIBLE * min(len(_distincts(x_faibles)), 4))
    details = {'titre_forts': _distincts(t_forts), 'titre_faibles': _distincts(t_faibles),
               'texte_forts': _distincts(x_forts), 'texte_faibles': _distincts(x_faibles),
               'occurrences_fortes': len(x_forts), 'longueur_texte': len(texte),
               'abaisse': _distincts(abaisse), 'domaines': scores_dom}

    plafond = harm in lex.types_a_relire
    plafond_motif = lex.types_a_relire.get(harm, '')

    def plafonner(verdict, raison):
        if verdict == 'retenu' and plafond:
            return 'a-relire', raison + f' ; plafonné à « à relire » ({plafond_motif})'
        if verdict == 'retenu' and regie is None and harm == 9:
            return 'a-relire', raison + ' ; affaire du gouvernement de type non listé, à relire'
        return verdict, raison

    # Types restreints (rapport des catégories) : seul un ancrage fort au titre garde l'objet ; messages gouvernementaux
    # sans type harmonisé (TI Messaggio, JU Message, SH Vorlage Parlament : régie « garder ») compris.
    restreint = type_.get('restreint') or (harm is None and regie == 'garder' and type_.get('origine') != 'prefixe-vd')
    if restreint and not t_forts:
        return fin('ecarte', score, "type restreint à l'ancrage fort au titre : "
                   + (type_['libelle'] or 'message du gouvernement'), domaine, details)

    # 3. Verdict
    if t_forts:
        v, r = plafonner('retenu', 'ancrage dans le titre : ' + ', '.join(_distincts(t_forts)))
        return fin(v, score, r, domaine, details)
    if x_forts and extrait:
        # Extrait de recherche : un passage, pas le texte. Jamais « retenu », et seulement un ancrage fort.
        return fin('a-relire', score, "ancrage dans l'extrait de recherche : " + ', '.join(_distincts(x_forts)[:5]),
                   domaine, details)
    if x_forts and not extrait:
        dens = 1000.0 * len(x_forts) / max(len(texte), 1)
        det = ', '.join(_distincts(x_forts)[:5])
        if len(x_forts) >= TEXTE_MIN_OCCURRENCES and dens >= TEXTE_MIN_DENSITE and not abaisse:
            v, r = plafonner('retenu', f'ancrage dans le texte ({len(x_forts)} occurrences, '
                                       f'{dens:.1f} pour 1 000 caractères) : {det}')
            return fin(v, score, r, domaine, details)
    if t_faibles and not abaisse:
        return fin('a-relire', score, 'ancrage ambigu dans le titre : ' + ', '.join(_distincts(t_faibles)),
                   domaine, details)
    # Un thème n'est accepté que si le titre porte aussi un mot d'enfance, de jeunesse ou d'école.
    if themes_elargis and lex.contexte_theme_dans(titre):   # une thématique l'emporte sur le terme de migration
        th = lex.themes_dans(titre)
        if th:
            details['themes'] = [{'id': t.id, 'libelle': t.libelle['fr'], 'sources': t.sources,
                                  'termes': sorted({x.terme.texte for x in tou})} for t, tou in th]
            lib = '; '.join(f"« {d['libelle']} » ({', '.join(d['termes'][:3])})" for d in details['themes'])
            return fin('a-relire', score, 'thématique de la Revue sans ancrage handicap ni besoins particuliers '
                                          '(périmètre élargi) : ' + lib, domaine, details)
    vivier = None
    if vivier_large and not extrait and len(_distincts(x_forts)) >= VIVIER_MIN_TERMES:
        vivier = fin('a-relire', score, PREFIXE_VIVIER + ' : ancrage fort dans le texte, au moins '
                     f'{VIVIER_MIN_TERMES} termes distincts : ' + ', '.join(_distincts(x_forts)[:5]), domaine, details)
    if abaisse and (t_faibles or x_faibles):
        return vivier or fin('ecarte', score, 'ancrage ambigu seulement, et terme de migration ou de procédure : '
                                    + ', '.join(_distincts(abaisse)), domaine, details)
    if ecole_generale:
        eg = lex.ecole_generale_dans(titre)
        if eg and not abaisse:
            return fin('a-relire', score, 'école ordinaire sans ancrage handicap ni besoins particuliers '
                                          '(palier ecole_generale) : ' + ', '.join(sorted({t.terme.texte for t in eg})),
                       domaine or 'education', details)
    return vivier or fin('ecarte', score, 'aucun ancrage handicap ou besoins particuliers dans le titre ni le texte',
                         domaine, details)


def classer_base(config, base, lex):
    """Classe tous les candidats de la base (hors ligne) et écrit `verdicts`. Rend les comptes par verdict.

    Un verdict existant est recalculé : le classement se rejoue à volonté après un changement de lexique. Une affaire
    figée (texte resté au poste de développement, voir etat.py) garde le sien : sans texte, il serait faux.
    """
    from .stockage import avant_date_min, maintenant
    mini = config['criblage'].get('date_min_fiche', '')
    comptes = {v: 0 for v in VERDICTS}
    lignes = base.c.execute(
        """SELECT DISTINCT a.* FROM candidats c JOIN affaires a
           ON a.body_key=c.body_key AND a.external_id=c.external_id
           WHERE NOT EXISTS (SELECT 1 FROM figees f WHERE f.body_key=a.body_key AND f.external_id=a.external_id)""").fetchall()
    for r in lignes:
        if avant_date_min(r['date_depot'], mini):
            continue
        a, texte, extrait = entree_de_base(base, r)
        res = classer(lex, a, texte, candidat=True, extrait=extrait,
                      ecole_generale=bool(config.get('classement', {}).get('ecole_generale', False)),
                      themes_elargis=bool(config.get('classement', {}).get('themes_elargis', False)),
                      vivier_large=bool(config.get('classement', {}).get('vivier_large', False)))
        base.c.execute(
            """INSERT OR REPLACE INTO verdicts(body_key, external_id, verdict, score, domaine, categorie, raison,
               calcule_le) VALUES (?,?,?,?,?,?,?,?)""",
            (a['body_key'], a['external_id'], res.verdict, res.score, res.domaine, res.jeton, res.raison, maintenant()))
        comptes[res.verdict] += 1
    base.commit()
    return comptes


def entree_de_base(base, r):
    """(affaire, texte, extrait) tels que `classer` les veut, pour une ligne `affaires` : tous les titres, le texte des
    documents (à défaut, les extraits de la recherche serveur), et le type d'une « Vorlage » de BL lu dans le document."""
    a = dict(r)
    a['title'] = base.titre_complet(r)        # tous les titres déposés (fr / de / it)
    textes = [d['texte'] for d in base.c.execute(
        'SELECT texte FROM documents WHERE body_key=? AND id_api=? ORDER BY doc_id', (a['body_key'], a['id_api']))]
    texte = '\n'.join(t for t in textes if t)
    corrige = corr.type_corrige(a['body_key'], a.get('type_harmonized_id'), texte)
    if corrige:
        a['type_harmonized_id'], a['type_name'] = corrige
    extrait = False
    if not texte:       # texte absent de la source : on juge l'extrait de la recherche, à défaut on écarte
        texte = '\n'.join(base.extraits_recherche(a['body_key'], a['external_id']))
        extrait = bool(texte)
    return a, texte, extrait


def _arriere(a):
    """Raison d'écarter un objet ancien daté par la source de la période suivie, ou ''."""
    corps, numero = a.get('body_key') or '', str(a.get('number') or '').strip()
    if corps == 'CHE' and numero.upper().startswith('VIS'):
        return f'initiative populaire fédérale historique, numéro {numero} (sans date de dépôt)'
    m = re.match(r'^(\d{4})\.', numero)
    if corps == 'BE' and m and int(m.group(1)) < 2024:
        return f"numéro bernois d'avant 2024 ({numero}) daté de la période suivie par la source"
    return ''
