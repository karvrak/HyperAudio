---
name: hyperaudio
description: >
  Son d'un jeu Roblox -> sons.json -> catalogue Luau + carte sonore + mixage
  mesure. Comme HyperBlox pour le 3D, HyperUI pour l'interface et HyperThumbnail
  pour les vignettes, mais pour l'audio : un sons.json (catalogue de bruitages +
  echelons de mixage + declencheurs) est la source de verite, d'ou sont generes
  SonsConfig.lua (le catalogue que le jeu lit), docs/AUDIO.md (LA CARTE SONORE :
  chaque objet, chaque geste, chaque condition -> quel son a quel volume, et ce
  qui manque), audio/console.html (la console de mixage, qui montre les niveaux
  MESURES face a leurs cibles) et audio/banc.lua (le banc d'essai qui mesure
  reellement chaque son dans Studio via Sound.PlaybackLoudness). L'equilibrage
  n'est PAS regle a l'oreille au juge : chaque son declare un ECHELON (fond,
  texture, geste, reussite, evenement, alarme), le banc mesure la force brute de
  l'asset, et le volume est CALCULE pour poser le son sur son echelon — le pas du
  personnage servant de metre etalon. Couvre aussi la recherche d'assets audio
  Roblox, leur verification de chargement dans l'univers, et la bibliotheque
  partagee entre projets. Utiliser pour : recenser les sons manquants d'un jeu ;
  corriger un son trop fort ou trop faible ; ajouter un bruitage ; equilibrer un
  mixage ; produire ou mettre a jour la carte sonore.
user-invocable: true
---

# HyperAudio — le son du jeu, mesuré au lieu d'être deviné

Trois problèmes, et un seul outil pour les trois :

1. **Il manque des sons.** Poser un œuf dans l'incubateur, ouvrir un œuf, placer
   un mob sur une base : des gestes majeurs sans retour sonore. On ne les trouve
   qu'en recensant le jeu **système par système**, pas en jouant au hasard.
2. **Les sons posés ne s'entendent pas ensemble.** Le tiroir-caisse du marchand
   écrase les pas ; baisser le curseur « Effets » enterre les pas avec lui, parce
   que **les deux sont dans le même groupe**. C'est un problème de **rapport**,
   pas de niveau : aucun curseur ne le règle.
3. **Personne ne sait où en est le son.** Quel geste a un son, lequel n'en a pas,
   lequel en a un mauvais.

---

## La chaîne

```
audio/sons.json          ←  SOURCE DE VÉRITÉ : catalogue + échelons + déclencheurs
        │
        ├──→ studio/SonsConfig.lua   le catalogue que le jeu lit (ModuleScript)
        ├──→ docs/AUDIO.md           LA CARTE SONORE — objet × geste × condition → son
        ├──→ audio/console.html      la console de mixage : niveaux mesurés vs cibles
        └──→ audio/banc.lua          le banc d'essai, à lancer en Play pour MESURER
                                      ↓
                              audio/mesures.json  →  relancé dans sons.json
```

```bash
node .claude/skills/hyperaudio/scripts/build.mjs audio/sons.json
node .claude/skills/hyperaudio/scripts/build.mjs audio/sons.json --mesures audio/mesures.json
```

**Ne jamais éditer `SonsConfig.lua`, `AUDIO.md`, `console.html` ni `banc.lua` à la
main** — tout part de `sons.json`. La règle du projet vaut ici comme ailleurs :
une section écrite à la main dans un fichier généré est perdue à la régénération.
Si une doc générée doit gagner un paragraphe écrit, il va dans le générateur.

---

## Lectures obligatoires

- `references/mixage.md` — **les six échelons, le mètre étalon, et le calcul du
  volume**. C'est le cœur du skill : à lire avant de toucher à un volume.
- `references/carte-sonore.md` — la méthode de recensement (faire le tour d'un
  jeu entier sans rien manquer), le **schéma de `sons.json`**, et le format de
  `docs/AUDIO.md`.
- `references/moteur.md` — le runtime Roblox : `SonsConfig` / `Sons` /
  `SonsLecteur` / `AmbianceMusique` / le mixeur des réglages. Comment brancher un
  son neuf, et les pièges qui font qu'un son ne sort pas.
- `references/sourcing.md` — trouver un asset audio, **vérifier qu'il charge dans
  cet univers**, et la bibliothèque partagée entre projets.

---

## Workflow

### 1. Reconnaissance — lire le jeu avant d'écrire une ligne

Comme HyperTuto, HyperAudio **commence toujours par observer**. Trois sources,
dans cet ordre :

1. **Le GDD** (`docs/GDD.md` § 3 Systèmes) : la liste des systèmes fait la liste
   des sections de la carte sonore. Un système du GDD sans aucune ligne dans
   `AUDIO.md`, c'est un oubli, pas un choix.
2. **Le lieu Studio**, pas `studio/` : `script_grep` sur `Sons.pour`,
   `Lecteur.jouer`, `Instance.new("Sound")`, `SoundId`. `studio/` est une copie
   poussée à un instant donné — le jeu peut avoir bougé depuis.
3. **Une partie**, en Play. Ce qui manque ne se voit pas dans le code : ça
   s'entend comme un silence là où le geste appelait une réponse.

### 2. Écrire `sons.json`

Un son = un nom + un **échelon** + des déclencheurs. L'asset peut venir plus
tard : **un son manquant est une entrée sans `ids`**, pas une absence d'entrée.
C'est ce qui fait que la carte recense les trous au lieu de les taire.

```json
"OeufIncube": {
  "echelon": "geste",
  "ids": [],
  "cherche": "mechanical latch clunk, wet egg placed in socket",
  "pourquoi": "Le geste qui lance la course de l'œuf. Sans réponse sonore, le joueur reste devant l'incubateur à se demander si ça a pris.",
  "declencheurs": [
    { "systeme": "3.3 Incubateur", "sujet": "Œuf", "geste": "posé dans l'incubateur",
      "condition": "le serveur accepte la mise en couveuse",
      "ou": "IncubateurConfig", "canal": "serveur" }
  ]
}
```

Schéma complet : `references/carte-sonore.md` § format.

### 2 bis. Combler les trous — faire écouter avant de choisir

Un son manquant (`ids: []`) a besoin d'un asset. On ne le choisit pas sur son nom :

```bash
node .claude/skills/hyperaudio/scripts/audition.mjs audio/candidats.json
```

Produit `audio/ecoute/ecoute.html` — un lecteur par candidat, groupés par son,
triés recevables en tête, avec une **version retaillée** (silence de tête coupé,
durée ramenée sous le plafond de l'échelon) à côté de chaque original. C'est la
retaillée qu'on juge : elle seule ressemble à ce que le jeu jouerait.

Détail, et les pièges du téléchargement : `references/sourcing.md` § 3 bis.

### 3. Générer, et traiter les avertissements

```bash
node .claude/skills/hyperaudio/scripts/build.mjs audio/sons.json
```

**Les avertissements ne se commentent pas, ils se corrigent.** Le générateur voit
ce que l'oreille ne peut pas juger sur une écoute isolée :

| Avertissement | Ce qu'il veut dire |
|---|---|
| `son orphelin` | aucun déclencheur : personne ne le joue, c'est du poids mort |
| `volume deviné` | l'asset n'a jamais été mesuré — le volume est une opinion |
| `écart de X dB` | mesuré, et **hors de son échelon** : le volume à poser est donné |
| `texture à une seule variante` | rejoué plusieurs fois par seconde avec un seul échantillon = **mitrailleuse** |
| `deuxième alarme` | il ne peut y avoir **qu'un seul** son négatif dans un jeu (cf. mixage.md) |
| `échelon inconnu` | faute de frappe : le son ne serait calé sur rien |

L'état à maintenir : **zéro avertissement**, sauf des `⬜ manquant` assumés.

### 4. Mesurer — la seule étape qui doit se faire en Play

Deux conditions, et **les deux sont silencieuses quand on les rate** :

1. **En Play, jamais en Edit.** En Edit le moteur audio n'avance pas :
   `TimePosition` reste à 0 et `PlaybackLoudness` à 0.
2. **La fenêtre Studio au premier plan.** En arrière-plan, Roblox bride le rendu
   à ~15 images/s ; comme le banc échantillonne au rythme des images, un bruitage
   de 0,5 s n'est plus décrit que par **huit points** pris au hasard dans son
   onde. Mesuré le 21/08 : le même son sort à **82,7** fenêtre active et **23,8**
   fenêtre derrière — 11 dB d'erreur, avec l'aplomb d'un chiffre.

Le banc se protège des deux : il refuse de démarrer sous 45 images/s, il fait
**trois passes** dont il garde la **médiane**, et il renvoie le nombre d'images
et l'écart entre passes. Le générateur **rejette** une mesure sous 20 images ou
au-delà de 3 dB de dispersion — une mesure pauvre ne se corrige pas, elle se
refait.

**C'est aussi pourquoi il ne faut pas demander à quelqu'un de lancer le banc en
allant faire autre chose.** La fenêtre doit rester devant pendant toute la passe.

1. `start_stop_play(is_start: true)`, puis **cliquer sur la fenêtre Studio**
2. Exécuter `audio/banc.lua` — MCP `execute_luau` en datamodel **`Client`**, ou
   la barre de commande. Il joue chaque son à `Volume = 1`, **hors groupe**, et
   renvoie un JSON.
3. Écrire ce JSON dans `audio/mesures.json`, puis :

```bash
node .claude/skills/hyperaudio/scripts/build.mjs audio/sons.json --mesures audio/mesures.json
```

Le générateur reporte les mesures dans `sons.json`, **calcule les volumes**, et
réécrit `SonsConfig.lua`. Détail du calcul : `references/mixage.md`.

> **Tout mesurer en une seule passe.** Seuls les **rapports entre sons** ont un
> sens, et ils ne valent que si tout a été mesuré dans les mêmes conditions. Une
> mesure isolée ajoutée après coup ne se compare à rien.
>
> **Et on ne vérifie pas un mixage en le remesurant** : `PlaybackLoudness` ignore
> le `Volume` (mesuré : 282 à `Volume = 1`, 282 à `0.5`). Elle décrit la matière
> de l'asset, pas la sortie. Le résultat se juge à l'oreille, en jeu.

### 5. Valider

Ouvrir `audio/console.html` : une barre par son, sa **cible** en trait, son
niveau **mesuré** en barre, groupées par échelon. Un son hors de son échelon se
voit d'un coup d'œil, sans rien écouter.

Puis **écouter en jeu**, dans cet ordre :

1. **Marcher.** Le pas est le mètre étalon : il doit rester audible en toutes
   circonstances. S'il disparaît quand autre chose joue, c'est l'autre qui est
   trop fort — pas le pas qui est trop faible.
2. **Enchaîner les gestes répétés** (ramasser vingt œufs, traverser la rivière) :
   la fatigue n'apparaît jamais sur une écoute isolée.
3. **Bouger les deux curseurs des réglages**, y compris jusqu'à 0 : aucun son ne
   doit échapper à son curseur, aucun ne doit rester seul en vie.

### 6. Poser dans Studio

`SonsConfig.lua` est un ModuleScript de `ReplicatedStorage`. Il transporte des
**données**, pas du code : il reste très loin du plafond des 200 000 caractères,
et `execute_luau` en datamodel **`Edit`** suffit — pas besoin du serveur HTTP.
Voir `references/moteur.md` § poser.

Un son **neuf** demande deux choses : l'entrée dans `SonsConfig` (générée) **et**
l'appel côté jeu (`Sons.pour(plr, "Nom")`). Le second est du code de jeu :
HyperAudio dit **où** il va (le champ `ou` du déclencheur), il ne l'écrit pas à
votre place.

---

## Rappels

- Répondre en français ; noms de sons en **PascalCase sans accent**
  (`OeufIncube`, `PotionPrete`) — le code de jeu s'y accroche.
- **Un son ne se juge jamais seul.** Un bruitage « bien » à l'écoute isolée est
  souvent 6 dB trop fort en jeu : isolé, il n'a rien à écraser.
- **La fréquence commande l'échelon.** Ce qui se répète descend, ce qui est rare
  monte. C'est la règle qui règle la grande majorité des plaintes de mixage.
- HyperAudio fait le **catalogue et le mixage**, pas le câblage. Les appels
  restent dans le code de jeu.
- Les assets audio Roblox ont des **droits qui ne suivent pas toujours** : un id
  qui marche ailleurs peut se jouer en silence ici, sans erreur. Rien n'entre au
  catalogue sans passer la vérification de `references/sourcing.md`.
