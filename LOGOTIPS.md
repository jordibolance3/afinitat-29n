# Logotips de les candidatures

Descarregats el 17-11-2026 amb el permís de l'usuari. Només s'utilitzen per identificar cada candidatura al catàleg «Els programes». No impliquen cap relació amb els partits. El servidor només serveix fitxers d'aquesta carpeta amb noms `nom.svg`, `nom.png` o `nom.webp`; aquest document no es publica. Abans d'utilitzar els SVG s'ha comprovat que no contenen scripts ni gestors d'esdeveniments.

| Fitxer | Candidatura | Font | Llicència indicada a la font |
|---|---|---|---|
| `psc.svg` | PSOE (candidatura PSC–PSOE) | [Commons: Logo_PSOE_41_Congreso.svg](https://commons.wikimedia.org/wiki/File:Logo_PSOE_41_Congreso.svg) | Domini públic |
| `erc-simbol.png` | ERC (el que es mostra) | Només el símbol, retallat localment de `erc.png` sense modificar-ne els colors (99×99 px, fons transparent) | No indicada; ús identificatiu |
| `erc.png` | ERC (original) | [Web oficial: erc-logo.png](https://www.esquerra.cat/wp-content/uploads/erc-logo.png), enllaçat des d'esquerrarepublicana.cat | No indicada; ús identificatiu |
| `vox.svg` | VOX | [Commons: VOX_logo.svg](https://commons.wikimedia.org/wiki/File:VOX_logo.svg) | Domini públic |
| `pp.svg` | PP | [Commons: Logo_del_PP_(2022).svg](https://commons.wikimedia.org/wiki/File:Logo_del_PP_(2022).svg) | Domini públic |
| `comuns.svg` | Comuns – Front Ampli | [Web oficial: logo_comuns_granat.svg](https://comuns.cat/wp-content/uploads/2024/04/logo_comuns_granat.svg) | No indicada; ús identificatiu |
| `alhora.png` | Alhora | [Web oficial: logo-alhora.png](https://alhora.cat/wp-content/uploads/2024/07/logo-alhora.png) | No indicada; ús identificatiu |
| `pctc.svg` | PCTC | [Web oficial de campanya: CAT-PCTC-siglas.svg](https://oposicionobrera.pcte.es/assets/CAT-PCTC-siglas.svg) | No indicada; ús identificatiu |
| `fo.png` | Frente Obrero | [Commons: Logo_Frente_Obrero_español.png](https://commons.wikimedia.org/wiki/File:Logo_Frente_Obrero_espa%C3%B1ol.png) | CC BY-SA 4.0 (autoria indicada a la pàgina de Commons) |
| `salf.png` | SALF | [Commons: Se_acabo_la_fiesta_wordmark.png](https://commons.wikimedia.org/wiki/File:Se_acabo_la_fiesta_wordmark.png) | Domini públic |
| `junts.svg` | Junts | [Web oficial: logo-junts.svg](https://junts.cat/wp-content/uploads/2026/03/logo-junts.svg) (més recent que la versió de Commons del 2020) | No indicada; ús identificatiu |
| `d21.svg` | D21 | [Web oficial: favicon.svg](https://democracia21.es/favicon.svg) | No indicada; ús identificatiu |

Wikimedia Commons va bloquejar repetidament la descàrrega dels logotips d'ERC, Comuns, Alhora i PCTC (HTTP 429). A petició de l'usuari, aquests quatre es van obtenir dels webs oficials dels partits.

El logotip oficial del PCTC és blanc. Amb `logoBackground: "dark"` a `contingut.json`, el catàleg el mostra sobre fons fosc.

Si un fitxer no és en aquesta carpeta, el catàleg mostra les inicials de la candidatura. El validador (`npm run check`) comprova que existeixin tots els logotips referenciats a `contingut.json`.
