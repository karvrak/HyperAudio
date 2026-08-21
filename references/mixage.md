# Le mixage — six échelons, un mètre étalon, un calcul

Ce fichier est le cœur du skill. Tout le reste (le catalogue, la carte, la
console) sert à appliquer ce qui est écrit ici.

---

## 1. Pourquoi le curseur ne règle rien

Plainte type, mot pour mot :

> quand on pose des pièces au marchand le bruit est beaucoup trop fort et
> j'aimerais baisser le son, mais si je baisse le son j'entends plus mes pas

Ce n'est pas un problème de **niveau**, c'est un problème de **rapport**. Le
tiroir-caisse et les pas sont tous les deux dans `SfxGroup` — le mixeur des
réglages y range **tout `Sound` qui naît sans groupe**, y compris les sons de
personnage que Roblox crée lui-même (`RbxCharacterSounds` : `Running`,
`Jumping`, `Climbing`, `Swimming`, `FreeFalling`).

Le curseur « Effets » multiplie donc les deux par le même nombre. Leur écart ne
bouge pas d'un décibel, quel que soit le réglage. **Un rapport ne se corrige que
dans les volumes individuels.**

Corollaire : dès qu'un son « écrase » un autre, la question n'est jamais « de
combien je baisse ce son ? » mais « **de combien d'échelons ces deux-là
doivent-ils être séparés ?** ».

---

## 2. Le mètre étalon : le pas du joueur

Il faut un son de référence. Ce ne peut pas être un son qu'on choisit, parce
qu'un son qu'on choisit, on le change — et tout le mixage bougerait avec.

C'est donc **le pas du personnage Roblox** (`Running`, dans le `HumanoidRootPart`,
posé par `RbxCharacterSounds`). Trois raisons :

- Il est **toujours là**, dans tous les jeux Roblox, et il ne change pas.
- Il est **continu pendant tout le jeu** : c'est le seul son que le joueur
  entend en permanence, donc le seul contre lequel son oreille se recalibre.
- C'est **celui qu'on veut protéger**. En faire l'étalon, c'est le poser comme
  la chose qui ne doit jamais disparaître — au lieu d'en faire la victime.

Le banc d'essai le mesure comme les autres, sous le nom réservé **`_Etalon`**, et
lit son `Volume` réel sur le personnage vivant. Tout le reste du mixage se
calcule à partir de là.

---

## 3. Les six échelons

Un son ne déclare **jamais un volume**. Il déclare un **échelon** : ce qu'il est
dans la vie du joueur. Le volume en est déduit (§ 5).

| Échelon | dB | Ce qui y va | Fréquence typique |
|---|---:|---|---|
| `fond` | −14 | musique, ambiance de zone, boucles de décor | continu |
| `texture` | −8 | pas, clapotis, ce qui accompagne le déplacement | **plusieurs fois par seconde** |
| `geste` | −4 | ramasser, poser, ouvrir, appuyer — le joueur a fait quelque chose | plusieurs fois par minute |
| `reussite` | 0 | vendre, éclore, acheter, monter un palier — **le serveur a validé** | quelques fois par session |
| `evenement` | +4 | boss, renaissance, portail, gros palier | une fois par session ou moins |
| `alarme` | +7 | le refus **définitif** | rarissime — **un seul dans tout le jeu** |

Le pas est à `texture`. C'est cet ancrage qui donne l'échelle son sens : un
`reussite` est 8 dB au-dessus du pas, soit environ **2,5 fois plus fort** —
audible, net, mais il n'efface pas la marche.

### La règle qui règle presque tout : la fréquence commande l'échelon

**Ce qui se répète descend. Ce qui est rare monte.**

Un son joué deux fois par seconde et un son joué une fois par session ne peuvent
pas partager un échelon, même s'ils ont la même importance dramatique. La
répétition fait le volume perçu : vingt clapotis à `geste`, ce n'est pas vingt
gestes, c'est du bruit blanc.

Test à appliquer à chaque son : **combien de fois dans les dix prochaines
minutes ?**

| Réponse | Échelon plafond |
|---|---|
| plus d'une fois par seconde | `texture` |
| dizaines de fois | `geste` |
| quelques fois | `reussite` |
| zéro ou une fois | `evenement` |

Un son au-dessus de son plafond de fréquence est un son que le joueur finira par
détester, quel que soit sa qualité.

### `alarme` : un seul, sinon aucun

Un jeu n'a droit qu'à **un** son négatif. Dès qu'il y en a deux, aucun des deux
ne veut plus dire « non » — ils disent tous les deux « il s'est passé un truc ».

Dans Récolte de monstres, c'est le refus définitif de l'incubateur (coquille déjà
fêlée, œuf qui a déjà fait sa course) : le seul « non » du jeu qui veuille dire
**plus jamais**. Partout ailleurs, un refus veut dire « pas encore » — pas assez
d'argent, pas encore éclos, pas le bon palier — et **un « pas encore » ne prend
pas de son négatif**, il prend un `geste` neutre ou rien du tout.

Le générateur refuse la deuxième `alarme`.

### `texture` exige des variantes

Un échantillon unique rejoué deux fois par seconde s'entend comme une
mitrailleuse, même avec la hauteur qui bouge. Tout son à l'échelon `texture` doit
porter **au moins deux `ids`**, tirés au hasard à chaque lecture — trois est le
bon nombre. Le générateur avertit si un `texture` n'en a qu'un.

La variation de hauteur (`vitesse`) est un complément, jamais un substitut :
`{ 0.9, 1.15 }` sur trois échantillons rend une marche crédible ; sur un seul
échantillon, elle rend une mitrailleuse désaccordée.

---

## 4. La mesure : `Sound.PlaybackLoudness`

**Le volume d'un `Sound` ne dit rien de sa force.** Deux assets à `Volume = 0.5`
peuvent différer de 20 dB, parce que ce sont deux enregistrements différents,
faits par deux personnes, à deux niveaux. C'est exactement pourquoi un mixage
réglé à l'oreille son par son ne tient jamais : chaque son a été jugé seul, à un
moment différent, contre un fond différent.

`Sound.PlaybackLoudness` donne la force **réellement produite** par le moteur
Roblox, image par image. C'est la seule mesure qui vaille : elle intègre le
décodage, le format, le niveau d'enregistrement.

### Le protocole, et pourquoi chaque contrainte est là

| Contrainte | Ce qui casse sans elle |
|---|---|
| **en Play, jamais en Edit** | en Edit le moteur audio n'avance pas : `TimePosition` reste à 0 et la loudness à 0. Le banc renverrait des zéros, silencieusement |
| **`Volume = 1`** | hygiène : on mesure l'**asset**. Voir l'encadré ci-dessous — la propriété ignore de toute façon le `Volume` |
| **`SoundGroup = nil`** | sinon la mesure passe par les curseurs du joueur, et dépend de son réglage |
| **échantillonnage sur `RenderStepped`** | c'est la cadence à laquelle la propriété est rafraîchie. Un `task.wait(0.1)` rate les transitoires, donc rate exactement ce qui rend un son agressif |
| **tout d'une seule passe** | les valeurs sont petites et dépendent du contexte de session. Seuls les **rapports** ont un sens, et seulement à conditions égales |

> **`PlaybackLoudness` ignore `Volume`.** Mesuré le 21/08 : le même asset donne
> 282 à `Volume = 1`, 282 à `0.5`, 326 à `0.25`, 338 à `0.065` — l'écart est du
> bruit de mesure, pas une décroissance. La propriété rapporte la force de la
> **matière** décodée, **avant** le gain.
>
> Deux conséquences, et la seconde est un piège :
>
> 1. C'est exactement ce qu'on veut mesurer. Le `corps` est une propriété de
>    l'asset, stable, indépendante du réglage courant — le calcul du § 5 est donc
>    fondé, `Volume` étant un gain linéaire appliqué après.
> 2. **On ne peut pas vérifier un mixage en le remesurant.** Remesurer après
>    avoir posé les volumes rend les mêmes nombres qu'avant : la vérification du
>    résultat se fait à l'oreille, en jeu, et seulement là.

### Ce qu'on retient de la mesure : le `corps`

Trois nombres sortent de chaque son : `crete`, `rms`, `corps`.

- `crete` — le maximum. Trompeur seul : un son avec un unique transitoire sec a
  une crête énorme et ne s'entend pas.
- `rms` — la moyenne sur toute la durée. Trompeur aussi : un échantillon avec
  deux secondes de silence à la fin voit son rms s'effondrer, alors que l'oreille
  n'a rien entendu de plus faible.
- **`corps`** — la moyenne quadratique **sur les seules images où le son dépasse
  10 % de sa crête**. C'est-à-dire : la force du son *pendant qu'il sonne*.
  C'est ce que l'oreille juge, et c'est ce que le calcul utilise.

---

## 5. Le calcul du volume

Une fois les mesures faites, le volume n'est plus une opinion.

```
N_pas  = corps(_Etalon) × volume réel du pas sur le personnage
N_0dB  = N_pas × 10^( -dB(texture) / 20 )      ← remonte le pas à l'échelon 0
cible  = N_0dB × 10^( dB(echelon) / 20 )
volume = cible / corps(son)                     ← borné à [0.02, 1]
```

En clair : **on remonte du pas jusqu'au 0 dB de l'échelle, puis on redescend
jusqu'à l'échelon du son, et on demande à l'asset le volume qui l'y pose.**

Trois cas que le générateur signale au lieu de les avaler :

- **`volume > 2`** — au-dessus de 1 on n'ajuste plus, on **amplifie** : le souffle
  de l'enregistrement monte avec le son. Praticable jusqu'à 2 environ, douteux
  au-delà. Préférer un asset mieux enregistré.
- **`volume > 10`** — impossible. `Sound.Volume` est **borné à [0, 10]** par
  Roblox, et il se clampe **en silence** : demander 28 pose 10, sans erreur.
  Aucun réglage ne rattrape l'asset ; il faut en changer, et noter l'ancien dans
  `rejetes` pour ne pas le reprendre.
- **`volume < 0.02`** — l'asset est énorme. Le poser à 0,01 marche, mais toute sa
  dynamique se retrouve écrasée dans le bas de l'échelle et il sonnera sale.
  Chercher un enregistrement plus discret.

> Le plafond de 10 est **mesuré**, pas lu dans une doc : `s.Volume = 12` rend
> `10`, `s.Volume = 50` rend `10`. La croyance courante que Roblox plafonne à 1
> vient de ce que 1 est la valeur *recommandée*, pas la limite.

### Écart toléré

Un son déjà mesuré dont le volume actuel s'écarte de sa cible de **plus de 1,5 dB**
est signalé. En dessous, on ne touche à rien : la différence n'est pas audible et
un mixage qui bouge à chaque régénération n'est plus un mixage.

### Le volume écrit à la main gagne

Un son peut porter `"volumeFixe": 0.42` : le calcul est alors ignoré pour lui, et
la carte le note. À réserver aux cas où le calcul est faux pour une raison qu'on
sait nommer (un asset dont le corps mesuré ne reflète pas la sensation, par
exemple une nappe très longue). **Écrire la raison dans `pourquoi`** — sinon,
dans trois mois, personne ne saura si c'est un réglage ou un oubli.

---

## 6. Les règles qui ne se calculent pas

Le calcul pose les niveaux. Il ne dit rien de ces quatre-là.

**La musique se tait pour l'événement, pas l'inverse.** Un combat de boss ne se
gagne pas en montant le boss : il se gagne en descendant l'ambiance. C'est ce que
fait `AmbianceMusique` (fondu à 0, pause, reprise après 1,4 s). Toute nouvelle
musique doit s'inscrire dans le même mécanisme, et s'assigner `MusicGroup`
**avant** de se parenter — sinon le mixeur la range dans les effets.

**Tout se joue en 2D, dans la tête du joueur.** Pas de position dans l'API des
bruitages. Un son 3D suppose un point du monde encore chargé chez le joueur, or
`StreamingEnabled` retire les bases lointaines : le son partirait dans le vide.
Un son de décor (une cascade, une machine) est une exception assumée, et il doit
porter son `RollOffMaxDistance` explicitement.

**Le son part du serveur quand le geste peut être refusé.** Acheter un œuf, c'est
un `ProximityPrompt` — donc le client. Mais le serveur peut refuser : solde
insuffisant, œuf déjà pris. Un son joué sur l'appui de touche mentirait une fois
sur trois. Il part donc **après coup**, quand le serveur a vraiment fait quelque
chose. Le champ `canal` du déclencheur tranche ce point pour chaque son :

| `canal` | Quand |
|---|---|
| `serveur` | le geste peut être refusé, ou il concerne l'état sauvegardé |
| `client` | rien à valider (survol, ouverture d'un menu), ou cadence trop élevée pour un remote (les pas) |
| `tous` | tout le serveur doit l'entendre (une mise à mort de boss) — volume **plus bas** que la version locale : la plupart de ceux qui l'entendent font autre chose |

**Deux sons à moins de 50 ms, ce n'est pas deux gestes, c'est un doublon.** Joués
ensemble, ils ne font pas « deux fois plus fort », ils font une bouillie. Le
lecteur les filtre déjà (`ANTI_DOUBLON`) ; ne pas contourner ce filtre en
appelant deux noms différents pour un même geste.
