# HyperAudio

**Le son d'un jeu Roblox, mesuré au lieu d'être deviné.**

Un skill [Claude Code](https://claude.com/claude-code) qui fait trois choses qu'on
fait mal à la main : recenser les sons qui manquent, équilibrer ceux qui sont là,
et garder trace de pourquoi chacun sonne comme il sonne.

---

## Le problème

Trois plaintes, toujours les mêmes :

1. **Il manque des sons.** Poser un œuf dans l'incubateur, ouvrir un coffre,
   placer une unité : des gestes majeurs sans retour sonore. On ne les trouve pas
   en jouant au hasard — on retrouve les trois mêmes trous à chaque session et
   jamais les vingt autres.
2. **Les sons posés ne s'entendent pas ensemble.** *« Le bruit du marchand est
   beaucoup trop fort, mais si je baisse le son je n'entends plus mes pas. »*
   C'est un problème de **rapport**, pas de niveau : aucun curseur ne le règle,
   parce que le curseur multiplie les deux par le même nombre.
3. **Personne ne sait où en est le son.** Quel geste a un son, lequel n'en a pas,
   lequel en a un mauvais.

## L'idée

**Un son ne déclare jamais un volume. Il déclare un ÉCHELON** — ce qu'il est dans
la vie du joueur :

| Échelon | dB | Ce qui y va | Fréquence |
|---|---:|---|---|
| `fond` | −14 | musique, ambiance | continu |
| `texture` | −8 | pas, clapotis | **plusieurs fois par seconde** |
| `geste` | −4 | ramasser, poser, ouvrir | par minute |
| `reussite` | 0 | vendre, éclore, acheter | par session |
| `evenement` | +4 | boss, palier, renaissance | une fois ou moins |
| `alarme` | +7 | le refus définitif | **un seul dans tout le jeu** |

Ensuite un banc d'essai **mesure la force réelle de chaque asset** dans Studio
(`Sound.PlaybackLoudness`, image par image), et le volume est **calculé** pour
poser le son sur son échelon.

Le mètre étalon est **le pas du personnage Roblox** — il est dans tous les jeux,
il ne change jamais, et c'est le seul son que le joueur entend en permanence.
En faire la référence, c'est le poser comme la chose qui ne doit jamais
disparaître, au lieu d'en faire la victime.

La règle qui règle le reste : **la fréquence commande l'échelon.** Ce qui se
répète descend, ce qui est rare monte.

---

## La chaîne

```
audio/sons.json          ←  SOURCE DE VÉRITÉ : catalogue + échelons + déclencheurs
        │
        ├──→ SonsConfig.lua     le catalogue que le jeu lit (ModuleScript)
        ├──→ docs/AUDIO.md      LA CARTE SONORE — objet × geste × condition → son
        ├──→ audio/console.html la console de mixage : niveaux mesurés vs cibles
        └──→ audio/banc.lua     le banc, à lancer en Play pour MESURER
                                      ↓
                              audio/mesures.json  →  relancé dans sons.json
```

Quatre sorties depuis une seule source : elles **ne peuvent pas diverger**.

```bash
node scripts/build.mjs audio/sons.json
node scripts/build.mjs audio/sons.json --mesures audio/mesures.json
```

---

## Installation

```bash
git clone https://github.com/karvrak/HyperAudio .claude/skills/hyperaudio
```

Puis, dans un projet Roblox, créer `audio/sons.json` et lancer le générateur.
Prérequis : Node.js, et un accès à Roblox Studio (MCP ou barre de commande) pour
l'étape de mesure.

Le skill s'invoque ensuite par `/hyperaudio`, ou se déclenche de lui-même sur une
demande qui touche au son.

---

## Trois choses mesurées qui contredisent ce qu'on croit

Elles ont toutes coûté une erreur avant d'être écrites ici.

**`Sound.Volume` plafonne à 10, pas à 1** — et se clampe *en silence*. Demander
12 pose 10, sans erreur. La croyance que la limite est 1 vient de ce que 1 est la
valeur *recommandée*.

**`PlaybackLoudness` ignore le `Volume`.** Le même asset rend 282 à `Volume = 1`,
282 à `0.5`, 338 à `0.065`. Elle décrit la **matière décodée**, pas la sortie.
Conséquence utile : la mesure est une propriété stable de l'asset. Conséquence
piégeuse : **on ne vérifie pas un mixage en le remesurant**.

**La fenêtre Studio doit être au premier plan pendant la mesure.** En
arrière-plan, Roblox bride le rendu à ~15 images/s ; comme le banc échantillonne
au rythme des images, un bruitage de 0,5 s n'est plus décrit que par **huit
points** pris au hasard dans son onde. Le même son est sorti à **82,7** fenêtre
active et **23,8** fenêtre derrière — 11 dB d'erreur, avec l'aplomb d'un chiffre.
Le banc refuse maintenant de démarrer sous 45 images/s, fait trois passes et en
garde la médiane ; le générateur rejette toute mesure trop pauvre ou trop
dispersée.

---

## Ce que ça trouve, concrètement

Première passe sur un vrai jeu (~30 000 lignes de Luau) :

- La rivière sortait **+7,2 dB** au-dessus de son échelon. Elle écrasait la marche.
- Le son du marchand n'avait pas un problème de volume mais **d'échelon** :
  vendre est fait des dizaines de fois par session, donc `geste` et pas
  `reussite`. Huit décibels de trop, exactement la plainte du joueur.
- Un bruitage était **inaudible depuis toujours** — mesuré à −61 LUFS (confirmé
  hors Roblox par ffmpeg) ; il aurait fallu un volume de 28,9 pour l'entendre.
  Personne ne s'en était plaint, justement parce qu'on ne l'entendait pas.
- **19 gestes sans le moindre son**, recensés système par système.

---

## Ce que c'est, ce que ce n'est pas

HyperAudio fait le **catalogue et le mixage**. Il dit *où* brancher un son (module
et point d'accroche) ; il n'écrit pas le câblage à votre place — ça reste du code
de jeu.

Les fichiers de référence portent les exemples d'un jeu réel (noms de modules,
décisions de design, dates de playtest). C'est volontaire : une règle sans le cas
qui l'a fait naître ne se retient pas. Adaptez les noms, gardez les règles.

## Documentation

| Fichier | Contenu |
|---|---|
| [`SKILL.md`](SKILL.md) | le workflow complet |
| [`references/mixage.md`](references/mixage.md) | **les six échelons, le mètre étalon, le calcul du volume** — le cœur |
| [`references/carte-sonore.md`](references/carte-sonore.md) | la méthode de recensement, le schéma de `sons.json`, le format de la carte |
| [`references/moteur.md`](references/moteur.md) | le runtime Roblox, et les pièges qui font qu'un son ne sort pas |
| [`references/sourcing.md`](references/sourcing.md) | trouver un asset, vérifier qu'il charge, la bibliothèque partagée |

---

Fait avec [Claude Code](https://claude.com/claude-code).
