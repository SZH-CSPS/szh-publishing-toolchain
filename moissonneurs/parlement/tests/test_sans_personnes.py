"""Noms de personnes dans les titres : on coupe le segment qui porte le nom, on garde le sens du titre.
Tous les noms de ces fixtures sont fictifs : le dépôt n'accueille aucun nom réel."""
import json
import unittest

from parlement import correspondances as corr, export_propositions as ep
from parlement.tests.test_propositions import TestPropositions, aff

# (forme, titre brut, titre attendu)
CAS = [
    ('AG queue eingereicht am', 'Motion betreffend Förderung der Berufsbildung; eingereicht am 8. September 2026; von Hans Keller, EDU, Musterdorf (Sprecher), Dr. Anna Dubois, FDP, Beispielhausen',
     'Motion betreffend Förderung der Berufsbildung'),
    ('AG élu et remplacé', 'Hans Keller, CVP, Musterdorf (anstelle von Anna Dubois-Roth, Beispielhausen); Inpflichtnahme als Mitglied des Grossen Rats',
     'Inpflichtnahme als Mitglied des Grossen Rats'),
    ('TI presentata da', 'Rapporto sulla mozione del 16 ottobre 2023 presentata da Marco Bianchi e Lara Rossi per MPS-Indipendenti “Creazione di un servizio”',
     'Rapporto sulla mozione del 16 ottobre 2023 per MPS-Indipendenti “Creazione di un servizio”'),
    ('TI e cofirmatari', 'Rapporto sulla mozione del 13 marzo 2023 presentata da Marco Bianchi e cofirmatari per il Gruppo UDC “Risparmi”',
     'Rapporto sulla mozione del 13 marzo 2023 per il Gruppo UDC “Risparmi”'),
    ('TI nella forma elaborata da', 'Rapporto sull’iniziativa parlamentare presentata il 4 maggio 2021 nella forma elaborata da Lara Rossi e Marco Bianchi per la modifica dell’art. 29',
     'Rapporto sull’iniziativa parlamentare presentata il 4 maggio 2021 per la modifica dell’art. 29'),
    ('TI M. seul', 'Rapporto sulla mozione del 19 settembre 2022 presentata da M. Bianchi e cofirmatari, per MPS', 'Rapporto sulla mozione del 19 settembre 2022, per MPS'),
    ('VD et consorts', "Rapport du Conseil d'Etat au Grand Conseil sur le Postulat Jean Martin et consorts - Lutte contre le bruit routier",
     "Rapport du Conseil d'Etat au Grand Conseil sur le Postulat - Lutte contre le bruit routier"),
    ('VD au nom de', "Rapport du Conseil d'Etat au Grand Conseil sur le Postulat Anne Muller et consorts au nom au nom de la CTSI - Sobriété numérique",
     "Rapport du Conseil d'Etat au Grand Conseil sur le Postulat - Sobriété numérique"),
    ('LU und Mit.', 'Motion Keller Hans und Mit. Über die Beibehaltung der Abschlussprüfung', 'Motion Über die Beibehaltung der Abschlussprüfung'),
    ('ZG Motion von', 'Berichts-Motion von Tomas Musterli und Erna Exempel betreffend Künstliche Intelligenz im Kanton', 'Berichts-Motion betreffend Künstliche Intelligenz im Kanton'),
    ('ZH Mitunterzeichnende', 'Motion von Anna Keller, Hans Dubois und 7 Mitunterzeichnenden betreffend Allmend, Bericht und Abschreibung',
     'Motion betreffend Allmend, Bericht und Abschreibung'),
    ('SH Kleine Anfrage Nr.', 'Kleine Anfrage Nr. 2026/13 von Hans Keller vom 4. Mai 2026 PFAS-Belastung', 'Kleine Anfrage Nr. 2026/13 vom 4. Mai 2026 PFAS-Belastung'),
    ('GE Projet de loi de', 'Projet de loi de Anna Dubois, Hans Keller, Jean Martin ... modifiant la loi sur la santé', 'Projet de loi modifiant la loi sur la santé'),
    ('GE Proposition de motion de.', 'Proposition de motion de. Anna Dubois, Hans Keller exigeant le remboursement des ressources', 'Proposition de motion exigeant le remboursement des ressources'),
    ('TG Frage von', 'Sonderschulung im Thurgau, Frage von Hans Keller', 'Sonderschulung im Thurgau, Frage'),
    ('BE Élection de Madame', 'Élection au Grand Conseil de Madame Anna Dubois (UDF), La Ferrière', 'Élection au Grand Conseil'),
    ('BE nouveau membre', 'Entrée d`un nouveau membre au Grand Conseil:Monsieur Hans Keller (PS)', 'Entrée d`un nouveau membre au Grand Conseil'),
    ('BE en remplacement', "Election d'un membre de la Commission de justice en remplacement de Hans Keller, Meiringen (PS), démissionnaire",
     "Election d'un membre de la Commission de justice"),
    ('FR en remplacement', 'Un membre suppléant de la Commission des naturalisations, en remplacement de Anna Dubois', 'Un membre suppléant de la Commission des naturalisations'),
    ('SO Vereidigung', 'Vereidigung von Anna Dubois (GRÜNE, Biberist) als Mitglied des Kantonsrats (anstelle von Hans Keller)', 'Vereidigung als Mitglied des Kantonsrats'),
    ('SO anstelle von', 'Wahl einer Stimmenzählerin für den Rest der Amtsperiode 2025-2029 (anstelle von Hans Keller, GRÜNE)', 'Wahl einer Stimmenzählerin für den Rest der Amtsperiode 2025-2029'),
    ('BS Nachfolge', 'Wahl eines Mitglieds der Geschäftsprüfungskommission (Nachfolge Anna Dubois, SP)', 'Wahl eines Mitglieds der Geschäftsprüfungskommission'),
    ('BS Wahl von Frau', 'MCH Group AG; Wahl von Frau Prof. Dr. M.F. Muster-Keller als baselstädtische Delegierte im Verwaltungsrat',
     'MCH Group AG; Wahl als baselstädtische Delegierte im Verwaltungsrat'),
    ('BS Rücktritt', 'Rücktritt von Anna Dubois als Richterin am Appellationsgericht per 31. Dezember 2024 - Bericht', 'Rücktritt als Richterin am Appellationsgericht per 31. Dezember 2024 - Bericht'),
    ('BL Anlobung', 'Nachrücken in den Landrat / Anlobung von Hans Keller', 'Nachrücken in den Landrat / Anlobung'),
    ('6621 de M.', 'Prestation de serment de M. Jean Martin en tant que membre suppléant', 'Prestation de serment en tant que membre suppléant'),
    ('NE de Mme', 'CFA de Boudry : étude de Mme Dubois, et après ?', 'CFA de Boudry : étude, et après ?'),
    ('GE par Mme', 'Ressources publiques indûment utilisées par Mme Dubois pendant sa campagne', 'Ressources publiques indûment utilisées pendant sa campagne'),
    ('5192 Signora', 'Donazione di 36 sculture appartenute alla Signora Anna Dubois', 'Donazione di 36 sculture appartenute'),
    ('351 alle PARTI', 'Hans Keller, Anna Dubois und Jean Martin; alle SVP. «Transparent» auf öffentlichen Gebäuden?', '«Transparent» auf öffentlichen Gebäuden?'),
    ('351 Nom, PARTI', 'Kleine Anfrage: Hans Keller, SVP, Anna Dubois, SVP Verbesserung der Ernährung', 'Kleine Anfrage: Verbesserung der Ernährung'),
    ('SZ Neues Mitglied', 'Neues Mitglied des Kantonsrates: Anna Dubois, Schübelbach', 'Neues Mitglied des Kantonsrates'),
    ('UR MLaw', 'MLaw Hans Keller, nebenamtlicher Datenschutzbeauftragter des Kantons Uri; Wahl durch den Landrat',
     'nebenamtlicher Datenschutzbeauftragter des Kantons Uri; Wahl durch den Landrat'),
    ('LU Nachfolge', 'Wahl einer Richterin am Bezirksgericht Kriens für den Rest der Amtsdauer 2023–2026 (Nachfolge Hans Keller, FDP)',
     'Wahl einer Richterin am Bezirksgericht Kriens für den Rest der Amtsdauer 2023–2026'),
    ('LU (Nom, G)', 'Wahl in die Kommission für die Amtsdauer 2025–2029 (Anna Dubois, G)', 'Wahl in die Kommission für die Amtsdauer 2025–2029'),
    ('TG Amtsgelübde', 'Amtsgelübde von Kantonsrat Hans Keller', 'Amtsgelübde'),
    ('AG Dr. Prénom Nom', 'Dr. Hans Keller, Grüne, Schöftland (anstelle von Anna Dubois, Menziken); Inpflichtnahme als Mitglied des Grossen Rats',
     'Inpflichtnahme als Mitglied des Grossen Rats'),
    ('AG parti en minuscules', 'Hans Keller, glp, Möriken-Wildegg (anstelle von Anna Dubois, Lenzburg); Inpflichtnahme als Mitglied des Grossen Rats',
     'Inpflichtnahme als Mitglied des Grossen Rats'),
    ('351 Nom, Nom (PARTI)', 'Hans Keller, SVP, Anna Dubois, Jean Martin (SVP); Nebenbeschäftigung', 'Nebenbeschäftigung'),
    ('351 parenthèse de signataires', 'Änderungsantrag Fraktionen Mitte, GFL (Anna Dubois, Mitte/Hans Keller, GFL/Jean Martin, GLP): Rückweisung von Vorstössen',
     'Änderungsantrag Fraktionen Mitte, GFL: Rückweisung von Vorstössen'),
    ('5192 Signora Van der', 'Donazione da parte della Signora Anna Van der Keller', 'Donazione da parte'),
    ('5586 et crts', 'Rapport-préavis N° 2026/02 - Postulat de Dubois Anna et crts - Faisons le mur !', 'Rapport-préavis N° 2026/02 - Postulat - Faisons le mur !'),
    ('5586 MM. et', 'Constitution d’un droit au profit de MM. Hans Keller et Jean Martin', 'Constitution d’un droit au profit'),
    ('TI forma generica', 'Rapporto sull’iniziativa presentata il 18 ottobre 2021 nella forma generica da Anna Dubois e cofirmatari “Concedere autonomia”',
     'Rapporto sull’iniziativa presentata il 18 ottobre 2021 “Concedere autonomia”'),
    ('VD au nom sans de', 'Rapport sur le Postulat Hans Keller et consorts au nom Anna DUBOIS - Une table-ronde', 'Rapport sur le Postulat - Une table-ronde'),
    ('titre et élu à la succession', 'Grand Conseil. Élection de M. Hans Keller à la succession de Mme Anna Dubois', 'Grand Conseil. Élection à la succession'),
    ('TI presentata il <date> da', 'Rapporto sulla mozione presentata il 18 settembre 2023 da Marco Bianchi e Lara Rossi per il Gruppo X', 'Rapporto sulla mozione per il Gruppo X'),
    ('TI ripresa da', 'Rapporto sulla mozione del 14 dicembre 2020 (ripresa da Lara Rossi) “Un piano d’azione”', 'Rapporto sulla mozione del 14 dicembre 2020 “Un piano d’azione”'),
    ('FR mandat de députée', 'Validation du mandat de députée de Anna Dubois', 'Validation du mandat de députée'),
    ('GE remplaçante', 'Prestation de serment de la remplaçante de Hans de KELLER, député suppléant démissionnaire', 'Prestation de serment de la remplaçante, député suppléant démissionnaire'),
    ('261 Ersatzwahl, von X für Y', 'Gemeinderat, Ersatzwahl, von Anna Dubois für Dr. Hans Keller', 'Gemeinderat, Ersatzwahl'),
    ('BL Anlobung und von X als', 'Anlobung als Jugendanwalt, von Anna Dubois als Präsidentin für das Zivilkreisgericht', 'Anlobung als Jugendanwalt als Präsidentin für das Zivilkreisgericht'),
    ('NW Nachrücken', 'Wahlfeststellung. Nachrücken von Anna Dubois, Buochs, als Mitglied des Landrats', 'Wahlfeststellung. Nachrücken als Mitglied des Landrats'),
    ('BE en remplacement, Lieu (PBD)', "Election d'un membre en remplacement de Hans Keller, Trubschachen (PBD), démissionnaire", "Election d'un membre"),
    ('BE Remplacement par', 'Grand Conseil. Remplacement de Monsieur Hans Keller par Madame Anna Dubois', 'Grand Conseil. Remplacement'),
    ('TI primo firmatario (parenthèse)', 'Petizione promossa dalla Conferenza Cantonale dei Genitori (primo firmatario Anna Dubois) e sottoscritta da 2’756 cittadini',
     'Petizione promossa dalla Conferenza Cantonale dei Genitori e sottoscritta da 2’756 cittadini'),
    ('TI prima firmataria', 'Petizione per le scuole, prima firmataria Anna Dubois, sulle mense', 'Petizione per le scuole, sulle mense'),
    ('TI firmatari', 'Petizione firmatari Hans Keller e Jean Martin per la scuola', 'Petizione per la scuola'),
    ('FR premier signataire', 'Pétition (premier signataire Hans Keller) pour les écoles', 'Pétition pour les écoles'),
    ('FR première signataire', 'Pétition pour les écoles, première signataire Anna Dubois', 'Pétition pour les écoles'),
    ('DE Erstunterzeichner', 'Petition Erstunterzeichner Hans Keller für bessere Schulen', 'Petition für bessere Schulen'),
    ('DE Erstunterzeichnerin (parenthèse)', 'Petition (Erstunterzeichnerin: Anna Dubois, Basel) für bessere Schulen', 'Petition für bessere Schulen'),
    ('FR déposé par', 'Projet déposé par Anna Dubois pour une école ouverte', 'Projet pour une école ouverte'),
    ('DE eingereicht von', 'Vorstoss eingereicht von Hans Keller und Anna Dubois betreffend Schulen', 'Vorstoss betreffend Schulen'),
    ('TI deposto da', 'Atto deposto da Hans Keller per la scuola', 'Atto per la scuola'),
    ('motion en minuscules', 'Réponse à la motion Hans Keller et consorts au nom de Anna Dubois, Jean Martin - Une idée', 'Réponse à la motion - Une idée'),
    ('TG Standesinitiative von', 'Standesinitiative von Hans Keller, Anna Dubois, Jean Martin betreffend Steuern', 'Standesinitiative betreffend Steuern'),
    ('ZG Berichtsmotion von', 'Berichtsmotion von Hans Keller und Anna Dubois betreffend Fragen', 'Berichtsmotion betreffend Fragen'),
    ('GE question écrite urgente de', "Réponse à la question écrite urgente de Hans Keller concernant l'école", "Réponse à la question écrite urgente concernant l'école"),
    ('GE Proposition de postulat de', 'Proposition de postulat de Hans Keller, Anna Dubois pour une école ouverte', 'Proposition de postulat pour une école ouverte'),
    ('261 Dr. Prénom Nom', 'Motion von Dr. Hans Keller und Anna Dubois betreffend Förderung der Schulen', 'Motion betreffend Förderung der Schulen'),
    ('GR Dumonda Nom concernent', "Dumonda Keller concernent ina pagina d'infurmaziun", "Dumonda concernent ina pagina d'infurmaziun"),
    ('GR Incarico Nom concernente', 'Incarico Dubois-Keller concernente il diritto di voto', 'Incarico concernente il diritto di voto'),
    ('GL Nom, Lieu, und Unterzeichnende', 'Klimagesetz (Motion Hans Keller, Ennenda, und Unterzeichnende «Kantonale Gesetzgebung»)', 'Klimagesetz (Motion «Kantonale Gesetzgebung»)'),
    ('NW Landrat Nom, Lieu, und Mitunterzeichnender', 'Einfaches Auskunftsbegehren von Landrat Hans Keller, Buochs, und Mitunterzeichnender, zur Stellungnahme',
     'Einfaches Auskunftsbegehren, zur Stellungnahme'),
    ('ZG sowie vier Mitunterzeichnenden', 'Postulat von Hans Keller sowie vier Mitunterzeichnenden zur Förderung der Grundversorgung', 'Postulat zur Förderung der Grundversorgung'),
    ('TI promossa da', 'Petizione promossa da Hans Keller e sottoscritta da 879 cittadini', 'Petizione e sottoscritta da 879 cittadini'),
    ('TI promossa da (Lieu) e da', 'Petizione promossa da Hans Keller (Medeglia) e da Anna Dubois (Bellinzona) e sottoscritta da 10 cittadini', 'Petizione e sottoscritta da 10 cittadini'),
    ('TI primo proponente', 'Petizione promossa da Hans Keller (primo proponente) e sottoscritta da 6 cittadini', 'Petizione e sottoscritta da 6 cittadini'),
    ('TI presentato dai signori', 'Ricorso presentato dai signori Hans Keller, Lavertezzo, Anna Dubois contro la decisione', 'Ricorso contro la decisione'),
    ('GE Hommage à', 'Hommage à Hans KELLER, député de 1979 à 1985, décédé', 'Hommage, député de 1979 à 1985, décédé'),
    ('AG als Stellvertretung von', '(als Stellvertretung von Anna Dubois, Windisch); Inpflichtnahme als Mitglied des Grossen Rats', 'Inpflichtnahme als Mitglied des Grossen Rats'),
    ('BS « Titre » von Nom (Ville)', 'Unterstützung, Spielfilm «Provinzhauptstadt» von Hans Keller (Luzern), Produktionsfirma Beispiel AG',
     'Unterstützung, Spielfilm «Provinzhauptstadt», Produktionsfirma Beispiel AG'),
    ('CHE Nom, ancien conseiller', 'Pointages demandés par Hans Keller, ancien conseiller national, président du parti', 'Pointages demandés, ancien conseiller national, président du parti'),
    ('BE est remplacé par', 'Grand Conseil. Démission et remplacement. Hans Keller (PSR) est remplacé par Anna Dubois (PSR)', 'Grand Conseil. Démission et remplacement. est remplacé'),
    ('VD au nom de Nom et Nom', 'Voies express cyclables – une infrastructure clé, au nom de Hans Keller et Anna Dubois', 'Voies express cyclables – une infrastructure clé'),
    ('BE Ersatz von', 'Grosser Rat. Rücktritt und Ersatz. Nachrücken als Ersatz von Anna Dubois', 'Grosser Rat. Rücktritt und Ersatz. Nachrücken als Ersatz'),
    ('GE Prestation de serment de (majuscules)', 'Prestation de serment de Hans KELLER, élu procureur', 'Prestation de serment, élu procureur'),
    ("BE en remplacement d'", "Election d'un membre de la Commission en remplacement d'Anna Dubois, Bienne (PS), démissionnaire", "Election d'un membre de la Commission"),
    ('OW Kantonsrätin Nom, Lieu', 'Eröffnung durch das ratsälteste Mitglied, Kantonsrätin Anna Dubois-Keller, Kerns', 'Eröffnung durch das ratsälteste Mitglied'),
    ('CHE Conseiller national Nom', 'Immunité du Conseiller national Hans Keller. Demande de levée', 'Immunité. Demande de levée'),
    ('261 Ersatzwahl von Dr. X für Dr. Y', 'Gemeinderat, Ersatzwahl, von Dr. Anna Dubois für Dr. Hans Keller', 'Gemeinderat, Ersatzwahl'),
    ('TI presentata dal deputato', 'Mozione presentata dal deputato Hans Keller e cofirmatari per la scuola', 'Mozione per la scuola'),
]
INTACTS = [
    'Petizione promossa dall’Associazione Human Flag “Tassa”', 'Petizione promossa da Associazione genitori Ticino e sottoscritta da 292 cittadini',
    'Plan crack : où en est-on après plus d’un an et plusieurs textes déposés au Grand Conseil ?',
    'Building Information Modeling BIM. Strategie und Umsetzung. Sonderkredit', 'Luzern braucht ein zweites Hallenbad - das Geld ist da',
    'Initiative populaire &quot;Pour en finir avec le renchérissement&quot;;', 'Police cantonale bernoise ; transfert, surveillance', 'Frau Holle in Betrieb – strassen.gr.ch ausser Betrieb: Warum?',
    'Sauver EMS et consorts de la précarité financière', 'Geheime Wahl des Verwaltungsrates EKZ und des Bankrates ZKB', 'Modification partielle du Plan directeur cantonal (art. 9 al. 1 LcAT)',
    'Une procédure d’engagement particulière au sein de la',
    'Rapporto sulla mozione del 16 ottobre 2023', 'Tiktok et consorts doivent financer un fonds de prévention', 'Motion Klimaschutz jetzt',
    'Projet de budget de la Ville de Genève 2027', 'Wahl von 7 Mitgliedern der IGPK Universitäts-Kinderspital beider Basel',
    'Geschäftsbericht 2025 von Entsorgung St.Gallen', 'Einsatz von Forensic Nurses im Kanton St.Gallen', 'Finanzierung von Zusatzangeboten im öffentlichen Verkehr',
    'Interpellation betreffend Wirkung der Massnahmen aus dem Postulat 21.181', 'Élection complémentaire au Conseil d’État',
]
NOMS = ['Van der', 'Keller', 'Dubois', 'Martin', 'Muller', 'Bianchi', 'Rossi', 'Musterli', 'Exempel', 'Muster-Keller']


class TestSansPersonnes(unittest.TestCase):
    def test_chaque_forme(self):
        for forme, brut, attendu in CAS:
            with self.subTest(forme=forme):
                self.assertEqual(corr.sans_personnes(brut), attendu)

    def test_aucun_nom_ne_reste(self):
        for forme, brut, _ in CAS:
            propre = corr.sans_personnes(brut)
            for nom in NOMS:
                self.assertNotIn(nom, propre, forme)

    def test_un_titre_sans_personne_ne_change_pas(self):
        for t in INTACTS:
            with self.subTest(titre=t):
                self.assertEqual(corr.sans_personnes(t), t)

    def test_vide_et_none(self):
        self.assertEqual(corr.sans_personnes(''), '')
        self.assertIsNone(corr.sans_personnes(None))


class TestDansLeLot(unittest.TestCase):
    setUp, tearDown, ajouter, lot = (TestPropositions.setUp, TestPropositions.tearDown, TestPropositions.ajouter,
                                     TestPropositions.lot)

    def test_titre_valeurs_et_brut_sans_nom_pour_chaque_corps(self):
        t = 'Motion von Hans Keller und Anna Dubois betreffend Sonderschulung'
        self.ajouter(aff('ZG', 'z1', t, number='1', brut={'title': t}))
        multi = {'de': t, 'fr': 'Motion de Hans Keller et consorts - Sonderschulung'}
        self.ajouter(aff('BE', 'b1', t + ' / ' + multi['fr'], number='2', brut={'title': multi}))
        lot = self.lot(ep.exporter(self.cfg, self.base))
        self.assertEqual(len(lot), 2)
        for p in lot:
            texte = json.dumps(p, ensure_ascii=False)
            for nom in ('Keller', 'Dubois'):
                self.assertNotIn(nom, texte)
        mono = next(p for p in lot if p['cle'].endswith(':z1'))
        self.assertEqual(mono['valeurs']['title'], 'Motion betreffend Sonderschulung')


if __name__ == '__main__':
    unittest.main()
