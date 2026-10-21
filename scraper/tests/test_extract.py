import unittest

import fakes  # noqa: F401  (ajuste sys.path)
from extract import extract_quotes, parse_price


def ld(obj_text):
    return f'<html><head><script type="application/ld+json">{obj_text}</script></head></html>'


class ParsePrice(unittest.TestCase):
    def test_formats_francais_et_anglais(self):
        cases = {"1 319,99 €": 1319.99, "1.319,99": 1319.99, "1,319.99": 1319.99, "1319.99": 1319.99,
                 "444": 444.0, "1.319": 1319.0, "12,5": 12.5, "€ 99,90": 99.9, "1 319,99 €": 1319.99,
                 "À partir de 1 299 €": 1299.0}
        for text, expected in cases.items():
            self.assertEqual(parse_price(text), expected, text)

    def test_illisible_ou_nul(self):
        for bad in (None, "", "abc", "0", "0,00", -5, True):
            self.assertIsNone(parse_price(bad), repr(bad))

    def test_nombres(self):
        self.assertEqual(parse_price(1319.989), 1319.99)


class JsonLd(unittest.TestCase):
    def test_produit_simple(self):
        q = extract_quotes(ld('{"@type":"Product","name":"CPU X","offers":{"price":"444.00","priceCurrency":"EUR",'
                              '"availability":"https://schema.org/InStock"}}'))
        self.assertEqual((q[0].price, q[0].currency, q[0].available, q[0].name), (444.0, "EUR", True, "CPU X"))

    def test_prix_decimal_virgule_et_espaces(self):
        q = extract_quotes(ld('{"@type":"Product","name":"X","offers":{"price":"1 319,99","priceCurrency":"EUR"}}'))
        self.assertEqual(q[0].price, 1319.99)

    def test_graph_et_aggregate_offer_imbriquee(self):
        q = extract_quotes(ld('{"@graph":[{"@type":"BreadcrumbList"},{"@type":"Product","name":"P","offers":'
                              '{"@type":"AggregateOffer","lowPrice":"1","offers":[{"price":"449.9","priceCurrency":"EUR"},'
                              '{"price":"460","priceCurrency":"EUR","availability":"OutOfStock"}]}}]}'))
        self.assertEqual([x.price for x in q], [449.9, 460.0])
        self.assertEqual([x.available for x in q], [None, False])

    def test_aggregate_offer_sans_offres_prend_le_prix_bas(self):
        q = extract_quotes(ld('{"@type":"Product","name":"P","offers":{"@type":"AggregateOffer","lowPrice":"99,5","priceCurrency":"EUR"}}'))
        self.assertEqual(q[0].price, 99.5)

    def test_prix_catalogue_ignore_dans_price_specification(self):
        q = extract_quotes(ld('{"@type":"Product","name":"P","offers":{"priceSpecification":['
                              '{"price":"199","priceType":"https://schema.org/ListPrice"},{"price":"149","priceCurrency":"EUR"}]}}'))
        self.assertEqual(q[0].price, 149.0)

    def test_devise_etrangere_conservee_pour_etre_filtree_plus_tard(self):
        q = extract_quotes(ld('{"@type":"Product","name":"P","offers":{"price":"500","priceCurrency":"usd"}}'))
        self.assertEqual(q[0].currency, "USD")

    def test_json_ld_invalide_avec_virgule_finale_est_lu(self):
        # extruct tolère ce que beaucoup de sites émettent ; notre premier extracteur l'ignorait
        q = extract_quotes(ld('{ "@type": "Product", "name": "Carrousel", "offers": {"price": "9.99", "priceCurrency":"EUR"}, }'))
        self.assertEqual(q[0].price, 9.99)

    def test_plusieurs_produits_gardent_leur_rang(self):
        script = '<script type="application/ld+json">{}</script>'
        html = ("<html><head>"
                + script.format('{"@type":"Product","name":"Principal","offers":{"price":"100","priceCurrency":"EUR"}}')
                + script.format('{"@type":"Product","name":"Suggestion","offers":{"price":"9","priceCurrency":"EUR"}}')
                + "</head></html>")
        q = extract_quotes(html)
        self.assertEqual([(x.name, x.product_index) for x in q], [("Principal", 0), ("Suggestion", 1)])


class AutresSyntaxes(unittest.TestCase):
    def test_microdata_avec_nom_et_offre_imbriquee(self):
        html = ('<div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Produit micro</span>'
                '<div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="price" content="1299.00">'
                '<meta itemprop="priceCurrency" content="EUR"><link itemprop="availability" href="https://schema.org/InStock"></div></div>')
        q = extract_quotes(html)
        self.assertEqual((q[0].price, q[0].name, q[0].available, q[0].method), (1299.0, "Produit micro", True, "microdata"))

    def test_open_graph(self):
        html = ('<html><head><meta property="og:title" content="Un produit"><meta property="product:price:amount" content="1 099,90">'
                '<meta property="product:price:currency" content="EUR"></head></html>')
        q = extract_quotes(html)
        self.assertEqual((q[0].price, q[0].currency, q[0].name, q[0].method), (1099.9, "EUR", "Un produit", "opengraph"))

    def test_aucune_donnee_structuree_aucun_prix(self):
        # pas de repli sur « le premier montant en € du texte » : trop souvent un accessoire
        self.assertEqual(extract_quotes("<html><body><p>Prix : 12,00 €</p><span class='price'>99 €</span></body></html>"), [])
        self.assertEqual(extract_quotes(""), [])


if __name__ == "__main__":
    unittest.main()
