"""Type harmonisé -> jeton `instrument` du contrat de Pronto ; corps -> canton ; langue de la fiche.

Aucun jeton n'est inventé : un type sans jeton rend None et l'export le signale.
Les correspondances viennent de l'étude des types de l'API (septembre 2026).
"""
import re

from .lexique import normaliser

# id de type harmonisé -> (jeton instrument | None, libellé court, à confirmer)
TYPES_HARMONISES = {
    2: ('motion', 'Motion', False),
    3: ('postulat', 'Postulat', False),
    8: ('interpellation', 'Interpellation', False),
    12: ('question', 'Anfrage / Question', False),
    10: ('question-heure', 'Fragestunde', False),
    4: ('initiative-parlementaire', 'Parlamentarische Initiative', False),
    11: ('petition', 'Petition', False),
    9: ('objet-gouvernement', 'Regierungsgeschäft', True),
    5: ('objet-gouvernement', 'Vernehmlassung', True),
    17: ('objet-parlement', 'Genehmigungsbeschluss', True),
    16: (None, 'Bericht', False),
    7: (None, 'Volksinitiative', False),
    1: (None, 'Diverses', False),
    15: (None, 'Informationsdokument', False),
    6: (None, 'Wahl', False),
    14: (None, 'Einbürgerung', False),
    13: (None, 'Ergänzungsantrag', False),
}

# Genève : le type est en préfixe du champ `number` (étude, 776 affaires sans exception).
PREFIXES_GE = {
    'M': ('motion', 'Motion'), 'PO': ('postulat', 'Postulat'),
    'IU': ('interpellation', 'Interpellation urgente'), 'IUE': ('interpellation', 'Interpellation urgente écrite'),
    'Q': ('question', 'Question'), 'QUE': ('question', 'Question écrite urgente'),
    'PL': ('objet-gouvernement', 'Projet de loi'), 'P': ('petition', 'Pétition'),
    'RD': (None, 'Rapport divers'), 'IN': (None, 'Initiative populaire'), 'R': (None, 'Résolution (à vérifier)'),
    'E': (None, 'Élection'), 'GR': (None, 'Grâce'), 'C': ('objet-gouvernement', 'Consultation cantonale'),
}
PREFIXES_GE_ECARTES = {'E': 'élection', 'GR': 'grâce'}

# Lucerne : le type est la lettre du numéro (`2026A 835`) quand l'API ne le donne pas. Table du rapport des catégories,
# vérifiée sur les affaires lucernoises dont l'API donne le type (A 251/251, P 224/224, M 67/74, B 61/61, E 1/1).
# lettre -> (jeton, libellé, id harmonisé, à confirmer)
PREFIXES_LU = {
    'A': ('question', 'Anfrage', 12, False), 'P': ('postulat', 'Postulat', 3, False), 'M': ('motion', 'Motion', 2, False),
    'B': ('objet-gouvernement', 'Botschaft', None, True), 'E': ('initiative-parlementaire', 'Einzelinitiative', 4, False),
}
# Vaud : le type est le mot central du numéro (`25_DET_6`) quand l'API ne le donne pas.
# mot -> (jeton, libellé, motif d'écart | None, à confirmer)
PREFIXES_VD = {
    'PET': ('petition', 'Pétition', None, False), 'LEG': ('objet-gouvernement', 'Décret/Loi', None, True),
    'DET': (None, 'Détermination', None, False), 'RAP': (None, 'Rapport', None, False),
    'PAR': (None, 'Rapport de commission', None, False), 'RES': (None, 'Résolution', None, False),
    'INI': (None, 'Initiative', None, False), 'REP': (None, 'Réponse', None, False),
    'PRE': (None, 'Préavis', None, False), 'RAI': (None, 'Rapport intermédiaire', None, False),
    'GRA': (None, 'Grâce', 'grâce', False),
}
# Types dont seul l'ancrage fort au titre est retenu (rapport des catégories, 03.10.2026) : Parlamentarische Initiative,
# Vernehmlassung, Volksinitiative, Fragestunde, Informationsdokument, Bericht ; Genève PL, RD, IN, R ; Standesinitiative.
HARM_RESTREINTS = {4, 5, 7, 10, 15, 16}
PREFIXES_GE_RESTREINTS = {'PL', 'RD', 'IN', 'R'}

# Bâle-Campagne : la « Vorlage » (type 9) recouvre des interpellations et des postulats ; le document dit `Geschäftstyp: X`.
TYPES_DOCUMENT_BL = {'interpellation': 8, 'postulat': 3, 'verfahrenspostulat': 3, 'motion': 2, 'schriftliche anfrage': 12,
                     'kleine anfrage': 12, 'anfrage': 12, 'parlamentarische initiative': 4}
RE_GESCHAEFTSTYP = re.compile(r'Gesch[aä]ftstyp:[ \t]*([^\n]+)')

RE_STANDESINITIATIVE = re.compile(r'standesinitiative|initiative deposee par un canton|iniziativa cantonale|initiative cantonale')


def _libelles(type_name):
    if isinstance(type_name, dict):
        return [str(v) for v in type_name.values() if v]
    return [str(type_name)] if type_name else []


def type_corrige(body_key, type_harmonized_id, texte):
    """(id harmonisé, {'de': libellé}) lu dans `Geschäftstyp:` du document pour une « Vorlage » de BL, sinon None."""
    if body_key != 'BL' or str(type_harmonized_id) != '9' or not texte:
        return None
    m = RE_GESCHAEFTSTYP.search(texte)
    if not m:
        return None
    libelle = m.group(1).strip()
    hid = TYPES_DOCUMENT_BL.get(normaliser(libelle))
    return (hid, {'de': libelle}) if hid else None


RE_OBJET_GENERIQUE = re.compile(r'^(geschaeft|geschaft|objet|oggetto) (des|du|del) parl[ae]m[ae]nt', re.I)


def _type_effectif(body_key, number, type_name, type_harmonized_id):
    """{'jeton', 'libelle', 'origine', 'ecarte', 'a_confirmer'} pour une affaire.

    Priorité : règle Standesinitiative (harmonisé NULL), type harmonisé, préfixe genevois.
    """
    libs = [normaliser(x) for x in _libelles(type_name)]
    if type_harmonized_id in (None, '') and any(RE_STANDESINITIATIVE.search(x) for x in libs):
        return {'jeton': 'initiative-cantonale', 'libelle': 'Standesinitiative', 'origine': 'type_name',
                'ecarte': None, 'a_confirmer': False, 'restreint': True}
    if type_harmonized_id == 6 and any(RE_OBJET_GENERIQUE.search(x) for x in libs):
        type_harmonized_id = None          # l'export classe à tort tout « Objet du Parlement » en élection ; l'API n'avait pas de type
    if type_harmonized_id not in (None, ''):
        try:
            hid = int(type_harmonized_id)
        except (TypeError, ValueError):
            hid = None
        if hid in TYPES_HARMONISES:
            jeton, lib, conf = TYPES_HARMONISES[hid]
            return {'jeton': jeton, 'libelle': lib, 'origine': 'harmonise', 'ecarte': None,
                    'a_confirmer': conf, 'harm': hid, 'restreint': hid in HARM_RESTREINTS}
    if body_key == 'GE':
        m = re.match(r'^\s*([A-Za-z]+)', str(number or ''))
        pref = m.group(1).upper() if m else ''
        if pref in PREFIXES_GE:
            jeton, lib = PREFIXES_GE[pref]
            return {'jeton': jeton, 'libelle': lib, 'origine': 'prefixe-ge',
                    'ecarte': PREFIXES_GE_ECARTES.get(pref), 'a_confirmer': pref in ('R', 'C'),
                    'restreint': pref in PREFIXES_GE_RESTREINTS}
    if body_key == 'LU':
        m = re.match(r'^\s*\d+([A-Z])\s*\d+', str(number or ''))
        if m and m.group(1) in PREFIXES_LU:
            jeton, lib, hid, conf = PREFIXES_LU[m.group(1)]
            return {'jeton': jeton, 'libelle': lib, 'origine': 'prefixe-lu', 'ecarte': None, 'a_confirmer': conf,
                    'harm': hid, 'restreint': hid in HARM_RESTREINTS}
    if body_key == 'VD':
        m = re.match(r'^\s*\d+_([A-Z]+)_\d+', str(number or ''))
        if m and m.group(1) in PREFIXES_VD:
            jeton, lib, ecarte, conf = PREFIXES_VD[m.group(1)]
            return {'jeton': jeton, 'libelle': lib, 'origine': 'prefixe-vd', 'ecarte': ecarte, 'a_confirmer': conf,
                    'restreint': False}
    return {'jeton': None, 'libelle': '', 'origine': 'inconnu', 'ecarte': None, 'a_confirmer': False, 'restreint': False}


# Types d'origine sans type harmonisé exploitable : le libellé de la source donne le jeton (forme normalisée, sans accents)
TYPES_ORIGINE = {
    'regierungsratsbeschluss': 'objet-gouvernement', 'rapport': 'objet-gouvernement', 'vorlage': 'objet-gouvernement',
    'vorlage parlament': 'objet-gouvernement', 'bericht': 'objet-gouvernement', 'oberaufsicht': 'objet-gouvernement',
    'rapport d activite': 'objet-gouvernement', 'proposition ca au cm': 'objet-gouvernement', 'messaggio': 'objet-gouvernement',
    'rapporti vari': 'objet-gouvernement', 'petition': 'petition', 'kleine anfrage': 'question', 'determination': 'question',
}


def type_effectif(body_key, number, type_name, type_harmonized_id):
    """Comme `_type_effectif`, avec en dernier recours le jeton du libellé d'origine (TYPES_ORIGINE)."""
    t = _type_effectif(body_key, number, type_name, type_harmonized_id)
    if t['jeton'] is None and t.get('ecarte') is None:
        for lib in _libelles(type_name):
            jeton = TYPES_ORIGINE.get(normaliser(lib))
            if jeton:
                return dict(t, jeton=jeton, libelle=lib, origine='type_name', a_confirmer=False)
    return t


def canton_de(body_key, config=None):
    """Code canton du contrat : CH pour la Confédération, le canton d'une ville, sinon le code du corps."""
    if body_key == (config or {}).get('moisson', {}).get('confederation', 'CHE') or body_key == 'CHE':
        return 'CH'
    for v in (config or {}).get('villes', {}).get('suivies', []):
        if v.get('cle') == body_key:
            return v['canton']
    return body_key if len(body_key) == 2 else ''


LANGUE_MAJORITAIRE = {'BE': 'de', 'FR': 'fr', 'VS': 'fr', 'GR': 'de', 'CH': 'de'}
ALLEMAND = {'AG', 'AI', 'AR', 'BL', 'BS', 'GL', 'LU', 'NW', 'OW', 'SG', 'SH', 'SO', 'SZ', 'TG', 'UR', 'ZG', 'ZH'}
FRANCAIS = {'GE', 'VD', 'NE', 'JU'}
ITALIEN = {'TI'}   # fiche .fr pour la Revue (décision du 02.10.2026), titre gardé en italien

MOTS = {
    'fr': {'le', 'la', 'les', 'des', 'du', 'de', 'pour', 'et', 'en', 'une', 'un', 'sur', 'dans', 'au', 'aux', 'que', 'qui'},
    'de': {'der', 'die', 'das', 'und', 'für', 'von', 'zur', 'zum', 'im', 'in', 'mit', 'den', 'dem', 'des', 'ein', 'eine', 'auf'},
    'it': {'il', 'lo', 'la', 'le', 'gli', 'dei', 'delle', 'del', 'della', 'per', 'e', 'in', 'una', 'un', 'su', 'nel', 'che'},
}


def detecter_langue(texte):
    """'fr' | 'de' | 'it' | '' d'après les mots-outils (titres courts : suffisant, pas infaillible)."""
    mots = re.findall(r"[a-zäöüéèêàçùîôâ]+", normaliser_simple(texte))
    score = {l: sum(1 for m in mots if m in ens) for l, ens in MOTS.items()}
    meilleur = max(score, key=score.get)
    return meilleur if score[meilleur] > 0 and list(score.values()).count(score[meilleur]) == 1 else ''


def normaliser_simple(s):
    return str(s or '').lower().replace('’', "'")


def langue_fiche(body_key, canton, titre_brut, langue_document=''):
    """(langue du fichier .fr/.de, langue du titre). Voir LISEZMOI.md."""
    c = canton or body_key
    if c in ITALIEN:
        return 'fr', 'it'
    if c in ALLEMAND:
        return 'de', 'de'
    if c in FRANCAIS:
        return 'fr', 'fr'
    # bilingue ou fédéral : la langue du texte déposé
    if isinstance(titre_brut, dict):
        langues = [l for l in ('fr', 'de') if titre_brut.get(l)]
        if len(langues) == 1:
            return langues[0], langues[0]
        if len(langues) == 2 and langue_document in ('fr', 'de'):
            return langue_document, langue_document
    l = langue_document if langue_document in ('fr', 'de') else ''
    if not l:
        titre = titre_brut if isinstance(titre_brut, str) else next(iter((titre_brut or {}).values()), '')
        l = detecter_langue(titre)
        l = l if l in ('fr', 'de') else ''
    return (l or 'de'), (l or 'de')


CORPS_MULTILINGUES = ('CHE', 'BE', 'FR', 'VS', 'GR')       # Confédération et cantons bilingues


def titres_non_vides(titre_brut):
    """{langue: titre} des titres fr, de, it présents et non blancs d'un dict de titres de la source."""
    if not isinstance(titre_brut, dict):
        return {}
    return {l: ' '.join(str(titre_brut[l]).split()) for l in ('fr', 'de', 'it') if str(titre_brut.get(l) or '').strip()}


def titres_multilingues(body_key, titre_brut):
    """{fr, de[, it]} si l'affaire est multilingue (corps bilingue ou fédéral, titres fr ET de présents), sinon None."""
    t = titres_non_vides(titre_brut)
    return t if body_key in CORPS_MULTILINGUES and 'fr' in t and 'de' in t else None


def langue_proposition(body_key, canton, titre_brut, langue_document=''):
    """(langue 'fr'|'de'|'', devinée, détail). Une affaire = une langue.

    Sûre : canton unilingue (le Tessin donne `fr`, titre en italien), titre à une seule langue, langue du
    document. Devinée : canton bilingue ou Confédération sans indice structuré, langue lue sur les mots du titre.
    """
    c = canton or body_key
    if c in ITALIEN or c in ALLEMAND or c in FRANCAIS:
        return langue_fiche(body_key, canton, titre_brut, langue_document)[0], False, ''
    if isinstance(titre_brut, dict):
        titres = titres_non_vides(titre_brut)
        langues = [l for l in ('fr', 'de') if l in titres]
        if len(langues) == 1:
            return langues[0], False, ''
        if not langues and 'it' in titres:
            return 'fr', False, ''             # titre italien seul : fr, comme le Tessin
        if len(langues) == 2 and langue_document in ('fr', 'de'):
            return langue_document, False, ''
    if langue_document in ('fr', 'de'):
        return langue_document, False, ''
    titre = titre_brut if isinstance(titre_brut, str) else next(iter((titre_brut or {}).values()), '')
    l = detecter_langue(titre)
    if l in ('fr', 'de'):
        return l, True, f'langue lue sur les mots du titre ({c})'
    majoritaire = LANGUE_MAJORITAIRE.get(c, 'de')
    return majoritaire, True, f'langue majoritaire du corps ({c}) : {majoritaire}, aucun indice sur le titre'


# -- titres fédéraux ----------------------------------------------------------------------------------------------------------
# Certains objets fédéraux (initiatives parlementaires et cantonales en consultation surtout) portent un titre de la forme
# « 21.498 n Iv.pa. <Nom>. <titre> » : numéro, conseil (n, s, é), abréviation du type, NOM de l'auteur. La fiche garde le titre
# seul ; l'abréviation sert d'indice pour le type.
ABREVIATIONS_FEDERALES = [
    (re.compile(r'(?:Iv\.\s?pa\.|Pa\.\s?Iv\.|Iv\.\s?Pa\.)', re.I), 'initiative-parlementaire'),
    (re.compile(r'(?:Iv\.\s?ct\.|Kt\.\s?Iv\.|Iv\.\s?cant\.)', re.I), 'initiative-cantonale'),
    (re.compile(r'Mo\.', re.I), 'motion'),
    (re.compile(r'Po\.', re.I), 'postulat'),
    (re.compile(r'Ip\.', re.I), 'interpellation'),
    (re.compile(r'Fra\.', re.I), 'question'),
]
RE_NUMERO_FEDERAL = re.compile(r'^\s*\d{2}\.\d{3,4}\s+(?:[nsNSéÉeE]\s+)?')
RE_AUTEUR = re.compile(r"^[A-ZÀ-ÖØ-Ý][^\s.]*(?:\s+[A-ZÀ-ÖØ-Ý][^\s.]*){0,2}\.\s+(?=\S)")
RE_FRAGESTUNDE = re.compile(r'^(?:Fragestunde|Heure des questions|Ora delle domande)\.?\s*', re.I)


def titre_federal(titre):
    """(titre seul, jeton d'instrument ou None) pour un titre fédéral : sans numéro, conseil, abréviation du type ni nom de l'auteur.

    Le nom de l'auteur (un à trois mots capitalisés suivis d'un point, juste après l'abréviation) est supprimé ; sans abréviation, rien
    d'autre que le numéro et le conseil n'est touché (« Cyberbullismo. Une nouvelle… » est un vrai titre)."""
    t = ' '.join((titre or '').split())
    m = RE_NUMERO_FEDERAL.match(t)
    if not m:
        return t, None
    reste = t[m.end():]
    f = RE_FRAGESTUNDE.match(reste)
    if f:
        return reste[f.end():].strip(), 'question'
    for motif, jeton in ABREVIATIONS_FEDERALES:
        a = re.match(r'(' + motif.pattern + r')\s+', reste, motif.flags)
        if a:
            reste = reste[a.end():]
            au = RE_AUTEUR.match(reste)
            if au:
                reste = reste[au.end():]
            return reste.strip(), jeton
    return reste.strip(), None


RE_REFERENCE_FEDERALE = re.compile(
    r'\b\d{2}\.\d{3,4}\s+(?:[nsNSéÉ]\s+)?(?i:' + '|'.join(m.pattern for m, _ in ABREVIATIONS_FEDERALES) + r')\s+'
    r"(?:[A-ZÀ-ÖØ-Ý][^\s.;]*(?:\s+[A-ZÀ-ÖØ-Ý][^\s.;]*){0,2}\.\s+)?")


def sans_reference_federale(texte):
    """Retire d'un titre d'un autre corps la référence fédérale citée (« 21.498 n Pa. Iv. <Nom>. ») : numéro, conseil, abréviation, nom."""
    return re.sub(r'\s+', ' ', RE_REFERENCE_FEDERALE.sub('', texte)).strip() if texte else texte


# -- noms de personnes dans les titres -----------------------------------------------------------------------------------------
# Une fiche n'a pas à porter le nom d'un auteur, d'un signataire ou d'un élu : on coupe le segment qui le porte et on garde le sens
# du titre. Les noms propres qui sont le SUJET d'un titre (« … de Franz Kafka ») ne se distinguent pas d'un lieu : ils ne sont pas coupés.
_TOK = r"[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’\-]*"
_INIT = r"[A-Z]\.(?:[A-Z]\.)?"
_PART = r"(?:de|von|van|der|di|da|du|le|la)"
_AC = r"(?:(?:Prof\.|Dr\.|PD|med\.|iur\.)\s+)*"
_T1 = r"(?<![\w])(?:Monsieur|Madame|Mmes?|MM?\.|Signor[a]?|Sig\.ra|Sig\.)\s+" + _AC       # le titre peut précéder un seul mot
_T2 = r"(?<![\w])(?:Herrn?|Frau)\s+" + _AC                                                 # « Frau Holle » : deux mots exigés
_NOM = rf"(?:{_INIT}|{_TOK})(?:\s+(?:{_PART}\s+)?(?:{_INIT}|{_TOK})){{1,3}}"       # prénom + nom : deux mots capitalisés au moins
_NOM_SP = rf"(?:{_INIT}|{_TOK})(?:\s+(?:{_INIT}|{_TOK})){{1,3}}"                    # sans particule : « Wahl von Mitgliedern der IGPK »
_FONCT = (r"(?:Landrat|Landrätin|Kantonsrat|Kantonsrätin|Regierungsrat|Grossrat|Grossrätin|Gemeinderat|Gemeinderätin|Stadtrat|Nationalrat|"
          r"Ständerat|conseiller|conseillère|députée?|deputat[oa])\s+")
_NOMX = rf"(?:(?:{_T1}|{_T2}|{_FONCT})?{_AC}{_NOM}|{_T1}{_TOK})"
_NB = r"(?:\d+|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)"
_COLLECTIF = (rf"(?:(?:und|et|e|sowie)\s+(?:{_NB}\s+)?(?:Mitunterzeichnende[nr]?|Unterzeichnende[nr]?|Mit\.|Konsorten|consorts|cons\.|crts?\.?|"
              rf"cofirmatari[ae]?|cosignataires))")
_SEP = r"(?:\s*,\s*|\s+(?:und|et|e)\s+)"
_LISTE = rf"{_NOMX}(?:{_SEP}{_NOMX})*(?:\s*,?\s*\.\.\.)?(?:\s+{_COLLECTIF})?"
_PARTI = (r"(?:SVP|SP|FDP(?:\.Die Liberalen)?|FDP-Liberale|GLP|glp|CVP|EVP|EDU|BDP|Die Mitte|Mitte|GRÜNE|Grüne|GPS|gps|PLR|PS|UDC|PDC|PPD|UDF|"
          r"PBD|LDP|PSR|PEV|Verts|Les Vert-e-s|MCG|Lega|PdA|AL|JUSO|MPS|POP|parteilos|ehem\. GLP)(?![\w\-])")
_PARTI_L = rf"(?:{_PARTI}|(?:GFL|JGLP|SD)(?![\w\-]))"       # dans une parenthèse de signataires seulement : « Fraktionen Mitte, GFL » n'est pas un nom
_LIEU = rf"{_TOK}(?:[ \-]{_TOK}){{0,2}}"
_LIEU1 = rf"{_TOK}(?![\w\-]|\s+{_TOK})"
_MOT_AUTEUR = (r"(?i:Berichts-?Motion|Incarico|Incumbensa|Dumonda|Postulato|Einzelinitiative|Standesinitiative|Proposition de postulat|Interpellanza|Interrogazione|Dringliche[nr]? (?:Motion|Interpellation|Anfrage|Postulat)|Motion|Postulat|Interpellation urgente|Interpellation|"
               r"Einfache Anfrage|Kleine Anfrage|Schriftliche Anfrage|Dringliche Anfrage|Anfrage|Anzug|Auftrag|Frage|Antrag|Initiative|Petition|"
               r"Resolution|Projet de loi|Projet de résolution|Proposition de motion|Proposition de résolution|Proposition de loi|"
               r"Question écrite urgente|Question urgente écrite|Question écrite|Question orale|Question|Résolution|Pétition|Petizione|Mozione)")
_MOT_EVENEMENT = (r"(?i:Ersatz|Nachrücken|Nachwahl|Réélection|réélection|mandat|remplaçante?|Ersatzwahl|Wahl|Vereidigung|Inpflichtnahme|Anlobung|Beeidigung|Rücktritt|Entlassung|Verabschiedung|Amtsgelübde|Demission|"
                  r"Élection|Election|prestation de serment|assermentation|démission|nomination|Nomination)")
_FONCTION = r"(?:(?:Kantonsrat|Landrat|Landrätin|Regierungsrat|Gemeinderat|Stadtrat|Grossrat|Nationalrat|Ständerat|Conseiller|Député)\s+)?"
_PREP = r"(?:\b(?:de|von|du|des|par|da|di|vom)\s+|\bd['’])"
_PREP_E = r"(?:\b(?:de|von|du|vom)\s+|\bd['’])"

# (motif, remplacement) appliqués dans l'ordre
_ORG_TI = r"(?!(?:Associazione|Società|Federazione|Comune|Consorzio|Gruppo|Partito|Movimento|Fondazione|Sindacato|Conferenza|Commissione|Cantone)\b)"
_SIGN = (r"(?i:primo firmatario|primo proponente|prima proponente|prima firmataria|firmatari[oae]?|premiers? signataires?|première signataire|"
         r"Erstunterzeichner(?:in|innen)?|Erstunterzeichnende[nr]?|Mitunterzeichner(?:in|innen)?)")
_COUPES = [
    (re.compile(r"\s*;\s*eingereicht am\b.*$"), ''),                                                # AG : « ; eingereicht am …; von … »
    (re.compile(rf"\s*\((?:[^()]*\s)?{_SIGN}\b[^()]*\)"), ''),                                       # « (primo firmatario X) » : parenthèse entière
    (re.compile(rf"\b{_SIGN}\s*:?\s+{_LISTE}"), ''),                                                 # « primo firmatario X », « Erstunterzeichner X »
    (re.compile(rf"\b(?i:déposée?|depositat[ao]|deposto|eingereicht)\s+(?:par|da|von)\s+{_LISTE}"), ''),
    (re.compile(rf"\b(?i:promoss[ao])\s+da\s+{_ORG_TI}{_LISTE}(?:\s*\([^()]*\))?(?:\s+e\s+da\s+{_ORG_TI}{_LISTE}(?:\s*\([^()]*\))?)*"), ''),    # TI
    (re.compile(rf"\b(?i:presentat[oai]|inoltrat[oai])\s+(?:dal|dai|dalla|dallo)\s+(?i:deputat[oai]|signor[ei]?|signori|signora)\s+"
                rf"(?:{_NOMX}(?:\s*,\s*{_LIEU1})?(?:{_SEP}{_NOMX}(?:\s*,\s*{_LIEU1})?)*)(?:\s+{_COLLECTIF})?"), ''),             # TI : « presentato dai signori … »
    (re.compile(r"\s*\((?:als )?(?:anstelle (?:von|des|der)|Nachfolge|en remplacement de|Ersatz für|Stellvertretung von)\s+[^()]*\)"), ''),
    (re.compile(rf"\s*\({_NOM}\s*,\s*[A-Za-zÄÖÜäöüéè/\-]{{1,12}}\)"), ''),                          # « (Prénom Nom, SP) »
    (re.compile(rf"\s*\(\s*(?:{_NOM}\s*,\s*{_PARTI_L}\s*/?\s*)+\)"), ''),                              # « (Prénom Nom, SP/Prénom Nom, GLP) »
    (re.compile(rf",?\s*(?:anstelle (?:von|des|der)\s+|en remplacement (?:de|du)\s+|en remplacement d['’])(?:(?:feu|zurück\w+)\s+)?{_NOMX}(?:\s*,\s*{_LIEU})?"
                rf"(?:\s*\({_PARTI}\))?(?:\s*,\s*(?:démissionnaire|{_PARTI}))?"), ''),
    (re.compile(rf"\b(?:nella forma\s+(?:elaborata|generica)\s+da|(?:presentat[ao]|inoltrat[ao]|depositat[ao]|elaborata|ripres[ao])(?:\s+(?:il\s+)?\d{{1,2}}\s+\w+\s+\d{{4}})?\s+da)\s+{_LISTE}"), ''),     # TI
    (re.compile(rf"(?:(\b{_MOT_AUTEUR})\s+(?:{_PREP})?|{_PREP})(?!{_MOT_AUTEUR}\b){_NOMX}(?:{_SEP}{_NOMX})*(?:\s*,\s*{_LIEU1})?\s*,?\s+{_COLLECTIF}"
                rf"(?:\s+au nom (?:au nom )?(?:de |du |des |d['’])?[^-–:“”\"«»]+?(?=\s*[-–:“”\"«»]|$))?"), r'\g<1>'),
    (re.compile(rf"\b({_MOT_AUTEUR})(\s+(?:Nr\.|no|n°)\s*[\w/.\-]+)?\s*[.:]?\s+(?:(?:von|de|du|d['’])\s*\.?\s*){_LISTE}"), r'\1\2'),
    (re.compile(rf"(?:{_PREP})?(?:{_T1}(?:{_NOM}|{_TOK})|{_T2}{_NOM})(?:{_SEP}{_NOMX})*(?:\s*\({_PARTI}\))?"
                rf"(?:\s*,\s*{_LIEU}(?=\s*(?:\(|,|$)))?(?:\s*\({_PARTI}\))?"), ''),
    (re.compile(rf"^(?:(?:Dr\.|Prof\.|med\.|iur\.)\s+)*{_NOM}\s*,\s*{_PARTI}\s*,\s*{_LIEU}\s*;\s*"), ''),          # AG : « Prénom Nom, PARTI, Lieu; … »
    (re.compile(rf"^(?:(?:MLaw|Dr\.|Prof\.|iur\.|med\.|lic\.)\s+)+{_NOM}\s*,\s*"), ''),                    # « MLaw Prénom Nom, fonction »
    (re.compile(rf"^{_LISTE}\s*;\s*alle\s+{_PARTI}\.?\s*"), ''),
    (re.compile(rf"\b{_NOM}\s*,\s*{_PARTI}(?:\s*,\s*{_LIEU1})?(?:\s*(?:,|;|und)\s*)?"), ''),               # « Prénom Nom, SVP[, Lieu] »
    (re.compile(rf"\b{_NOM}(?:\s*,\s*{_NOM})*\s*\({_PARTI}\)(?:\s*;)?"), ''),                               # « Prénom Nom, Prénom Nom (SVP) »
    (re.compile(rf"(?:{_PREP})?(?:{_FONCT}|Conseiller national |Conseillère nationale |Conseiller fédéral |Conseillère fédérale ){_AC}{_NOM_SP}"
                rf"(?:\s*\({_PARTI}\))?(?:\s*,\s*{_LIEU1})?"), ''),                                     # « Kantonsrätin Prénom Nom, Lieu »
    (re.compile(rf"({_MOT_EVENEMENT})(?:\s*,)?\s+{_PREP_E}\s*{_AC}{_FONCTION}{_NOM_SP}(?:\s*\([^()]{{1,40}}\))?(?:\s*,\s*{_LIEU})?(?:\s*,(?=\s+als\b))?"
                rf"(?:\s+für\s+{_AC}{_NOM_SP})?"), r'\1'),
    (re.compile(rf"(?:,|\s+und)\s+von\s+{_NOM_SP}(?=\s+als\b)"), ''),                                  # « Anlobung als X, von Prénom Nom als Y »
    (re.compile(rf"(ad hoc)\s+de\s+{_NOM_SP}"), r'\1'),
    (re.compile(rf"(mandat de (?:député|députée|député-e|conseiller|conseillère|juge)|remplaçante?)\s+de\s+{_NOM}"), r'\1'),
    (re.compile(rf"(Neues Mitglied[^:]{{0,40}}):\s*{_NOM_SP}(?:\s*,\s*{_LIEU})?"), r'\1'),
    (re.compile(rf"\b({_MOT_AUTEUR})\s+{_TOK}\s+(?=(?:concern\w*|betreffend)\b)"), r'\1 '),            # GR : « Dumonda Nom concernent … »
    (re.compile(rf"(Hommage à|Hommage au|Nachruf auf|Gedenken an|En souvenir de)\s+{_AC}{_NOM_SP}"), r'\1'),            # « Hommage à Prénom NOM, député… »
    (re.compile(rf"\s*(?:{_NOM_SP}(?:\s*\({_PARTI}\))?\s+)?(?i:est remplacée? par|ist ersetzt durch)\s+{_NOM_SP}(?:\s*\({_PARTI}\))?"), ''),
    (re.compile(rf"\bau nom de\s+{_LISTE}"), ''),                                                                       # VD : « au nom de Prénom Nom et Prénom Nom »
    (re.compile(rf"(«[^»]{{2,120}}»|\"[^\"]{{2,120}}\")\s+von\s+{_NOM_SP}(?:\s*\([^()]{{1,30}}\))?"), r'\1'),         # « Titre » von Prénom Nom (Ville)
    (re.compile(rf"(?:{_PREP})?{_NOM}(?=\s*,\s*(?i:ancien|ancienne|alt|ex)\b)"), ''),                                 # « Prénom Nom, ancien conseiller… »
]
_RE_ESPACES = re.compile(r'\s+')


def sans_personnes(texte):
    """Titre sans les noms d'auteurs, de signataires et d'élus ; le reste du titre garde son sens.

    Un titre qu'aucune règle ne touche revient tel quel."""
    if not texte:
        return texte
    t = _RE_ESPACES.sub(' ', texte).strip()
    original = t
    for motif, rempl in _COUPES:
        t = motif.sub(rempl, t)
    if t == original:
        return original
    t = re.sub(r'\(\s*\)', '', t)
    t = re.sub(r'\s+([,;])', r'\1', t)
    t = re.sub(r'\s+\.(?=\s|$)', '.', t)
    t = re.sub(r'([,;])\s*(?=[,;])', '', t)
    t = re.sub(r'(?:\s+(?:de|von|du|des|par|da|di|vom|il|lo|la|le|al|alla|del|della|au|à|con|d[\'’]))+\s*([,;:.]|$)', r'\1', t)
    t = re.sub(r'^[\s,;:.\-–]+|[\s,:\-–]+$|(?<!&\w{2})(?<!&\w{3})(?<!&\w{4});$', '', t)
    return _RE_ESPACES.sub(' ', t).strip()
