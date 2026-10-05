"""Texte déposé d'une intervention, pour le champ facultatif `texte` d'une proposition (docs/FORMAT-PROPOSITIONS.md).

Le document qui porte l'intervention elle-même (ni la réponse du gouvernement, ni le procès-verbal), nettoyé : sans
balisage ni CSS, sans en-tête ni nom de signataire en tête, plafonné à PLAFOND caractères.
"""
import html
import re
import unicodedata

PLAFOND = 20000
SUITE = ' […]'
# Documents qui portent le texte déposé, et ceux qui n'en sont jamais (réponse, décision, débat).
PREFERES = re.compile(r"(?i)texte déposé|développement|vorstoss|interpellation|motion|postulat|anfrage|interpellanza|"
                      r"mozione|interrogazione|dumonda|question|résolution|initiative|p[ée]tition|^text\b|wortlaut")
EXCLUS = re.compile(r"(?i)réponse|antwort|beantwortung|risposta|resposta|beschluss|protokoll|abstimmung|vote|débat|"
                    r"stellungnahme|botschaft|bericht|rapport|weisung|schreiben|antrag|message|messaggio|medienmitteilung|"
                    r"kommissionsbestellung|traktand|amendement|versione pdf|bundesblatt|feuille fédérale")
CHE_ORDRE = ('Texte déposé', 'Développement')
# Un paragraphe de tête qui annonce un auteur, un signataire ou une fonction d'élu part, même au milieu du corps.
SIGNATAIRE = re.compile(r"(?i)unterzeichn|signataire|signé|firmat|auteur|urheber|eingereicht|namens der|au nom d|"
                        r"sprecher|déposée? par|dépôt|presentat[ao] da|et consorts|und mit\b|landrät|landrat\b|"
                        r"grossrät|grossrat\b|kantonsrät|kantonsrat\b|gemeinderät|stadträt|député|deputat|"
                        r"conseill[eè]re? (communal|municipal|national|d.état)|madame|monsieur|herr |frau ")
MIN_UTILE = 40
TETE_MAX = 25           # paragraphes examinés pour l'en-tête
CORPS_SURVEILLE = 4     # premiers paragraphes du corps où un signataire part encore


def nettoyer(brut):
    """Texte lisible : sans balisage, CSS, entités, images ni blancs en trop ; une ligne coupée au milieu d'une phrase
    est recollée ; paragraphes séparés par une ligne vide."""
    t = str(brut or '')
    if t.strip() in ('[extraction_failed]', ''):
        return ''
    t = re.sub(r'(?is)<(style|script)\b.*?</\1\s*>', ' ', t)
    t = re.sub(r'(?s)<!--.*?-->', ' ', t)
    t = re.sub(r'(?i)<br\s*/?>|</p\s*>|</div\s*>|</li\s*>', '\n\n', t)
    t = re.sub(r'<[^<>]{0,500}>', ' ', t)
    t = html.unescape(t)
    t = re.sub(r'(?m)^[^\n{}]{0,200}\{[^{}]*:[^{}]*\}', ' ', t)          # règles CSS restées en texte
    t = re.sub(r'\[image:[^\]]*\]', ' ', t)
    t = unicodedata.normalize('NFC', t).replace('\r\n', '\n').replace('\r', '\n')
    t = re.sub(r'[\t   ]', ' ', t)
    lignes = []
    for l in t.split('\n'):
        l = re.sub(r' {2,}', ' ', l).strip()
        if re.fullmatch(r'(?i)(seite|page|pagina)?\s*\d+\s*(/\s*\d+)?|\|?\w?\s*\|?\w?', l):
            l = ''
        lignes.append(l)
    paragraphes, courant = [], ''
    for l in lignes:
        if not l:
            continue
        if courant and (l[0].islower() or courant.endswith((',', '-', '–'))):
            courant = (courant[:-1] + l) if re.search(r'\w-$', courant) and l[0].islower() else courant + ' ' + l
        else:
            if courant:
                paragraphes.append(courant)
            courant = l
    if courant:
        paragraphes.append(courant)
    return '\n\n'.join(paragraphes)


def _plat(s):
    s = unicodedata.normalize('NFD', str(s or '').lower())
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return ' '.join(re.findall(r'[a-z0-9]+', s))


def _corps(p):
    """Un paragraphe de corps : assez long, des mots-outils en minuscules, aucun signal de signataire."""
    minuscules = len(re.findall(r'(?<![\w-])[a-zà-öø-ÿ]{2,}', p))
    return len(p) >= 60 and minuscules >= 4 and not SIGNATAIRE.search(p)


def sans_entete(texte, titre=''):
    """Retire l'en-tête (adresse, date, numéro, titre, auteurs) : tout ce qui précède le premier paragraphe de corps,
    et le titre s'il revient en tête. Dans les premiers paragraphes du corps, un paragraphe qui nomme un signataire
    part aussi."""
    paragraphes = texte.split('\n\n')
    mots = _plat(titre).split()
    ancre = ' '.join(mots[:4]) if len(mots) >= 3 else ''
    debut = 0
    for i, p in enumerate(paragraphes[:TETE_MAX]):
        if ancre and ancre in _plat(p):
            debut = i + 1
            continue
        if _corps(p):
            break
        debut = i + 1
    corps = paragraphes[debut:]
    garde = [p for i, p in enumerate(corps) if not (i < CORPS_SURVEILLE and SIGNATAIRE.search(p))]
    reste = '\n\n'.join(garde)
    return reste if len(reste) >= MIN_UTILE else ''


def plafonner(texte, plafond=PLAFOND):
    """Au plus `plafond` caractères : coupé à la dernière fin de paragraphe ou de phrase, suivi de « […] »."""
    if len(texte) <= plafond:
        return texte
    limite = plafond - len(SUITE)
    morceau = texte[:limite]
    coupe = max([morceau.rfind('\n\n')] + [morceau.rfind(s) + 1 for s in ('. ', '? ', '! ', '.\n')])
    if coupe < limite // 2:
        coupe = morceau.rfind(' ')
    return morceau[:coupe if coupe > 0 else limite].rstrip() + SUITE


def choisir(documents, body_key, langue=''):
    """Le ou les documents déposés, dans l'ordre : [(nom, texte brut)]. `documents` : [{nom, langue, texte}]."""
    docs = [d for d in documents if nettoyer(d.get('texte'))]
    if body_key == 'CHE':
        che = [d for nom in CHE_ORDRE for d in docs if (d.get('nom') or '').strip() == nom]
        if che:
            return [(d.get('nom') or '', d['texte']) for d in che]
    preferes = [d for d in docs if PREFERES.search(d.get('nom') or '') and not EXCLUS.search(d.get('nom') or '')]
    if langue:
        preferes.sort(key=lambda d: (d.get('langue') or langue) != langue)     # tri stable : l'ordre reste sinon
    if preferes:
        return [(preferes[0].get('nom') or '', preferes[0]['texte'])]
    autres = [d for d in docs if not EXCLUS.search(d.get('nom') or '')]
    return [(autres[0].get('nom') or '', autres[0]['texte'])] if autres else []


def texte_depose(documents, body_key, titre='', langue='', plafond=PLAFOND):
    """Le texte déposé nettoyé et plafonné, ou '' s'il n'y en a pas. Plusieurs documents : chacun commence par la
    ligne `[Document : nom]`."""
    morceaux = [(nom, sans_entete(nettoyer(t), titre)) for nom, t in choisir(documents, body_key, langue)]
    morceaux = [(nom, m) for nom, m in morceaux if m]
    if len(morceaux) > 1:
        texte = '\n\n'.join(f'[Document : {nom}]\n{m}' for nom, m in morceaux)
    else:
        texte = morceaux[0][1] if morceaux else ''
    return plafonner(texte, plafond) if len(texte) >= MIN_UTILE else ''
