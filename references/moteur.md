# Le moteur — ce qui joue les sons, et comment y brancher le vôtre

HyperAudio ne remplace pas le runtime : il **alimente** celui qui existe. Ce
fichier décrit ce runtime, pour savoir où poser un son neuf et pourquoi il ne
sort pas quand il ne sort pas.

---

## 1. Les cinq pièces

```
ReplicatedStorage/
  SonsConfig    ← GÉNÉRÉ par HyperAudio. Le catalogue : nom → ids, volume, vitesse.
  SonsLecteur   ← le moteur de lecture, côté client : piscines, variantes, préchargement
  SonsRemote    ← RemoteEvent, créé par le module serveur lui-même
ServerScriptService/
  Sons          ← le canal serveur : Sons.pour(plr, nom) / Sons.tous(nom, sauf)
StarterPlayerScripts/
  SonsClient    ← branche le remote sur le lecteur, et précharge
  AmbianceMusique ← la playlist de fond (indépendante du catalogue)
SettingsGUI/
  SettingsController ← le MIXEUR : range tout Sound dans MusicGroup ou SfxGroup
```

**Seul `SonsConfig` est généré.** Les quatre autres sont du code de jeu écrit à la
main ; HyperAudio les lit, ne les réécrit pas.

---

## 2. Brancher un son neuf — les deux moitiés

Un son neuf n'est jamais fini quand `SonsConfig` est régénéré. Il faut **les deux
moitiés**, et l'oubli de la seconde est l'erreur la plus fréquente :

**Moitié 1 — le catalogue** (générée) : l'entrée dans `sons.json`, puis
`build.mjs`, puis poser `SonsConfig.lua` dans Studio.

**Moitié 2 — l'appel** (à la main, dans le code de jeu), à l'adresse donnée par
le champ `ou` du déclencheur :

```lua
-- canal "serveur" — le geste pouvait être refusé
local Sons = require(game:GetService("ServerScriptService").Sons)
Sons.pour(plr, "OeufIncube")

-- canal "tous" — tout le serveur doit l'entendre
Sons.tous("BossMort", plr)   -- sauf celui qui l'a tué : il a déjà sa version locale

-- canal "client" — rien à valider, ou cadence trop élevée pour un remote
local Lecteur = require(game:GetService("ReplicatedStorage"):WaitForChild("SonsLecteur"))
Lecteur.jouer("PasRiviere")
```

Un nom absent du catalogue **avertit dans la console** au lieu de se perdre en
silence — c'est voulu, et c'est ce qui rattrape les fautes de frappe.

---

## 3. Les pièges — un son qui ne sort pas

Dans l'ordre où ils se présentent réellement.

**Le son n'était pas chargé.** Un `Sound` qui n'a pas fini de charger ne joue
**pas** quand on appelle `Play()` — et il ne joue pas plus tard non plus, il est
simplement perdu. `SonsLecteur.precharger()` crée un exemplaire de chaque
variante au démarrage et les passe à `PreloadAsync`. Un son ajouté au catalogue
en est couvert automatiquement ; un `Sound` créé à la main ailleurs, non.

**Les droits de l'asset ne suivent pas.** Un asset audio dont les droits ne
couvrent pas cet univers se joue **en silence, sans erreur**. C'est le piège le
plus coûteux, parce que tout paraît correct. Vérification : `sourcing.md` § 2.

**Le `Sound` vivait dans le personnage.** Un respawn détruit le personnage et le
`PlayerGui` en pleine lecture : le son se coupe net, et la piscine pointe sur des
Instances mortes. Les `Sound` du lecteur vivent dans `SoundService/Sons`, qui
traverse la session entière.

**On lui a posé un `SoundGroup` à la main.** Le mixeur range dans `SfxGroup`
**tout `Sound` qui naît sans groupe**. Lui en poser un dans le code le **sort** du
curseur « Effets ». Seule la musique s'assigne `MusicGroup` explicitement, et
elle doit le faire **avant de se parenter**.

**On est en mode Edit.** Le moteur audio n'avance pas : `TimePosition` reste à 0,
`PlaybackLoudness` renvoie 0. Rien ne s'entend, rien ne se mesure. Toute écoute
et toute mesure se font en **Play**.

**Le module était en cache.** Un `ModuleScript` est mis en cache **par
environnement**. Après avoir repoussé `SonsConfig`, un `require` rend l'ancienne
version : il faut **cloner le module** pour en obtenir une neuve, ou relancer la
partie.

---

## 4. Ce que le lecteur fait pour vous — et ses limites

| Il fait | Détail |
|---|---|
| **piscines** | 3 exemplaires par variante. Deux ramassages dans la même seconde se chevauchent au lieu de se couper ; au-delà, on recycle le plus ancien |
| **variantes** | tirage au hasard parmi les `ids` à chaque lecture |
| **hauteur** | `PlaybackSpeed` tiré dans `vitesse` |
| **anti-doublon** | deux fois le même nom à moins de 50 ms : la seconde est ignorée |
| **préchargement** | un exemplaire de chaque variante au démarrage |

| Il ne fait **pas** | Conséquence |
|---|---|
| **les boucles** | un son `boucle: true` demande son propre `Sound` persistant, pas une piscine. Le champ existe dans le catalogue pour la carte, le câblage est à part |
| **la 3D** | pas de position dans l'API : tout se joue dans la tête du joueur. `StreamingEnabled` retire les décors lointains, un son 3D partirait dans le vide |
| **les fondus** | à faire au `TweenService` côté appelant (c'est ce que fait `AmbianceMusique`) |
| **la musique** | `AmbianceMusique` est un lecteur séparé, avec sa playlist remélangée et sa pause de combat |

---

## 5. Poser `SonsConfig.lua` dans Studio

C'est un ModuleScript de `ReplicatedStorage`, et il transporte des **données** :
quelques kilo-octets, très loin du plafond des 200 000 caractères d'une source de
script. Pas besoin du serveur HTTP de HyperBlox/HyperUI.

MCP `execute_luau`, datamodel **`Edit`** (en Play, un `Script not found` est
trompeur) :

```lua
local RS = game:GetService("ReplicatedStorage")
local m = RS:FindFirstChild("SonsConfig") or Instance.new("ModuleScript")
m.Name = "SonsConfig"
m.Source = [[ ... contenu de studio/SonsConfig.lua ... ]]
m.Parent = RS
return "SonsConfig posé, " .. #m.Source .. " caractères"
```

Si la source contient `]]`, passer par `serve.mjs` + `GetAsync` comme pour les
autres modules — c'est la méthode déjà en service dans le projet.

**Vérifier après coup**, sans quoi on croit avoir posé ce qu'on n'a pas posé :

```lua
local C = require(game:GetService("ReplicatedStorage").SonsConfig:Clone())
local n = 0 ; for _ in pairs(C.CATALOGUE) do n += 1 end
return n .. " sons au catalogue"
```

Le `:Clone()` n'est pas une précaution de style : sans lui, `require` rend la
version en cache, et on validerait l'ancienne.
