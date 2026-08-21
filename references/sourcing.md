# Trouver un son, le vérifier, le garder

Un asset audio Roblox n'est pas un fichier : c'est un **id**, avec des droits.
Ce fichier dit comment en trouver un bon, comment prouver qu'il marche **ici**,
et où le ranger pour ne pas le rechercher au projet suivant.

---

## 1. Chercher

Outil : MCP `search_asset`, `assetType: "Audio"`. **Rien d'autre.**

```
search_asset(assetType: "Audio", query: "money", maxResults: 12)
```

### La recherche Audio est bien plus fragile que la recherche de modèles

Mesuré le 21/08, sur le même besoin, dans le même univers :

| Appel | Résultats |
|---|---:|
| `query: "money"` | **11** |
| `query: "coin"` | **10** |
| `query: "paper money handling"` + `audioMaxDuration: 1.5` | **0** |
| `query: "cash"` + `scope: "creator_store"` + `priceFilter: "free"` + `audioMaxDuration: 1.5` | **0** |
| `query: "paper money rustle"` + mêmes filtres | **0** |

Trois règles en découlent, et elles vont **à l'inverse** de ce qu'on ferait
spontanément :

- **Un ou deux mots, jamais une phrase.** L'index d'audio ne fait pas de
  recherche sémantique : `money`, `coin`, `crack`, `whoosh`, `chime`. Une
  formulation de bruiteur bien tournée (`paper money rustle`) rend zéro.
- **Ne pas filtrer.** `audioMaxDuration` et `priceFilter` **vident** les
  résultats au lieu de les affiner. Le tri par durée se fait après, sur les
  fiches (§ 3).
- **Ratisser large, trier soi-même.** Lancer trois ou quatre requêtes d'un mot
  autour de l'idée (`money`, `cash`, `coin`, `register`) et réunir les
  résultats, plutôt qu'une requête précise qui ne rend rien.

Le champ `cherche` de `sons.json` garde la **formulation longue** — elle décrit
l'intention pour un humain. Les mots à taper réellement en sont extraits.

Le `scope` par défaut (`auto`) ratisse déjà l'univers, l'inventaire du joueur
puis le Creator Store, et **marque la source** : un résultat `source:
"inventory"` est **déjà possédé par l'univers**, donc acquis pour toujours et
sans risque de droits. C'est toujours le meilleur candidat, à qualité égale.

---

## 2. Vérifier — l'étape qu'on ne saute jamais

**Un asset audio dont les droits ne couvrent pas cet univers se joue en silence,
sans lever la moindre erreur.** Tout paraît correct : l'instance existe, `Play()`
ne se plaint pas, le code est juste. On ne s'en aperçoit qu'en playtest, et on
cherche le bug ailleurs pendant une heure.

La vérification se fait **en Play**, sur les candidats d'un coup :

```lua
local CP = game:GetService("ContentProvider")
local SS = game:GetService("SoundService")
local ids = { 123456789, 987654321 }   -- les candidats

local sons, out = {}, {}
for _, id in ipairs(ids) do
  local s = Instance.new("Sound")
  s.SoundId = "rbxassetid://" .. id
  s.Parent = SS
  table.insert(sons, s)
end
pcall(function() CP:PreloadAsync(sons) end)
for i, s in ipairs(sons) do
  table.insert(out, ("%d  charge=%s  duree=%.2f")
    :format(ids[i], tostring(s.IsLoaded), s.TimeLength))
  s:Destroy()
end
return table.concat(out, "\n")
```

**`IsLoaded == true` ET `TimeLength > 0`.** Les deux. Un asset peut se déclarer
chargé et rendre une durée nulle — il ne jouera rien.

Rien n'entre dans `sons.json` sans être passé par là. Le banc d'essai refait la
vérification au passage (une durée nulle sort une mesure nulle), mais le faire
**avant** évite de découvrir en fin de chaîne qu'un des vingt candidats est mort.

### Écouter hors de Studio

Les assets **anciens** (ids à 10 chiffres) se téléchargent sans authentification :

```bash
curl -sL -o son.ogg "https://assetdelivery.roblox.com/v1/asset/?id=9117227841"
ffprobe -v error -show_entries format=duration -of default=nw=1 son.ogg
```

Les ids **récents** (15 chiffres) répondent `401 Authentication required` : ils ne
s'écoutent qu'en Studio. Ne pas construire de chaîne d'outil qui en dépende — le
banc d'essai mesure dans Studio précisément pour cette raison.

Proportion mesurée le 21/08, sur 98 candidats ramassés à la recherche : **55
publics, 43 privés**. Chercher en priorité les ids **anciens** et les
bibliothèques officielles (`ProSoundEffects`, `Roblox`) n'est donc pas un détail
— c'est ce qui décide si on pourra faire écouter le résultat.

`audition.mjs` (§ 3 bis) automatise tout ce paragraphe.

---

## 3. Choisir — les critères de rejet, dans l'ordre

**La durée d'abord.** C'est ce qui rend un son insupportable, avant son timbre.

| Échelon | Durée cible | Pourquoi |
|---|---:|---|
| `texture` | < 0,5 s | rejoué 2 à 4 fois par seconde : au-delà, les échantillons se chevauchent et font du bruit blanc |
| `geste` | < 0,6 s | le geste le plus répété du jeu. Tout ce qui traîne devient un bruit de fond |
| `reussite` | < 1,5 s | doit finir avant que le joueur ait fait le geste suivant |
| `evenement` | < 3 s | il a le droit d'occuper l'espace, il est rare |
| `fond` | > 30 s | une boucle courte s'entend comme une boucle en moins d'une minute |

**Le silence de tête ensuite.** Beaucoup d'échantillons du Toolbox commencent par
50 à 200 ms de silence. Sur un son de geste, ce retard se **sent** : le clic
paraît mou, désynchronisé de l'action. Ça se voit sur la mesure du banc (la
loudness reste à 0 sur les premières images).

Ce défaut-là **se répare** : `audition.mjs` coupe le silence et raccourcit le
fichier (§ 3 bis). Mais la version corrigée doit être **ré-uploadée** pour servir
en jeu — l'id d'origine, lui, joue toujours le fichier long. Tant qu'on garde
l'id d'origine, le silence de tête reste un motif de rejet.

**La queue de réverbération enfin.** Une réverbération longue sur un son répété
s'accumule et transforme vingt gestes en soupe. Sur `texture` et `geste`, prendre
le plus **sec** possible.

Ce qu'on ne regarde **pas** : le volume d'enregistrement. Il est rattrapé par le
calcul (`mixage.md` § 5) — sauf s'il est si faible que le volume calculé dépasse
1, ce que le générateur signale.

---

## 3 bis. Faire écouter — `audition.mjs`

Choisir un bruitage sur son NOM ne marche pas : « Money Collect » peut être une
pièce, un froissement de billet ou un jingle de jeu mobile. Il faut l'entendre.

```bash
node .claude/skills/hyperaudio/scripts/audition.mjs audio/candidats.json
```

`candidats.json` liste, par son à combler, les ids ramassés à la recherche. L'outil
récupère la fiche de chacun, tente de le **télécharger**, le **mesure** (mêmes
grandeurs que le banc Studio : `corps` et attaque), le **retaille** si besoin, puis
écrit `audio/ecoute/ecoute.html` : un lecteur par candidat, groupés par son,
triés — recevables en tête —, avec un bouton qui recopie la sélection.

### La retaille change ce qui est recevable

Deux des trois défauts qui disqualifient un bruitage ne sont pas des défauts de
l'échantillon, ce sont des défauts du **fichier** :

| Défaut | Rattrapable ? |
|---|---|
| silence de tête | **oui** — on le coupe |
| trop long | **oui** — on le raccourcit, avec un fondu de 30 ms |
| enregistrement quasi muet | **non** — il faut un autre asset |

L'outil produit donc une version retaillée à côté de l'originale, et c'est **elle**
qui est jugée. Mesuré le 21/08 : sans la retaille, 9 des 18 sons n'avaient aucun
candidat recevable ; avec, il n'en reste qu'un.

**Une version retaillée doit être ré-uploadée sur Roblox pour servir en jeu** —
l'id d'origine joue le fichier long. Tant qu'elle ne l'est pas, la retaille sert à
juger, pas à livrer.

### Deux pièges du téléchargement

**`--compressed` sur curl est indispensable.** Le CDN sert ces fichiers avec
`encoding=gzip` dans l'URL signée ; sans cet indicateur, curl écrit le flux gzip
tel quel. Le fichier a la bonne taille, aucune erreur n'est levée, et ffmpeg ne le
décode pas — le candidat passe pour privé alors qu'il était public.

**Un 401 arrive avec un code HTTP 200 sur le fichier.** On teste la **signature du
contenu** (`OggS`, `ID3`, `RIFF`), jamais le code de retour.

## 4. La bibliothèque partagée

`D:/VIBE-CODING/roblox/_assets/audio/bibliotheque.json`

Tout id **vérifié et mesuré** y est versé, quel que soit le projet. C'est le
capital qui s'accumule : au troisième jeu, la moitié des sons de geste sont déjà
là, déjà mesurés, déjà jugés.

```json
{
  "sons": [
    { "id": 117813075686953, "nom": "egg pickup pop", "famille": "geste",
      "duree": 0.44, "corps": 8.21,
      "projets": ["monster-harvest"], "note": "très sec, aucun silence de tête" }
  ]
}
```

| Champ | Sens |
|---|---|
| `famille` | le registre : `geste` `monnaie` `pas` `ui` `creature` `magie` `machine` `ambiance` `musique` |
| `corps` | la mesure (cf. `mixage.md` § 4). **Comparable entre projets** seulement si mesurée dans la même passe — sinon indicative |
| `projets` | où il sert déjà. Un son partagé par trois jeux du même studio, c'est une signature, pas une paresse — mais deux jeux qui se ressemblent déjà, non |
| `note` | ce qu'on a remarqué à l'écoute : silence de tête, réverbération, timbre |

`build.mjs` y verse automatiquement les sons mesurés (fusion par `id`, les notes
écrites à la main sont préservées).

**Le piège des droits reste entier :** un id présent dans la bibliothèque a été
vérifié **dans un autre univers**. La vérification du § 2 se refait à chaque
nouveau projet. La bibliothèque fait gagner la recherche et l'écoute, pas la
vérification.
