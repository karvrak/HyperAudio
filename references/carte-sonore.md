# La carte sonore — recensement, schéma, format

Ce fichier répond à une seule question : **comment faire le tour d'un jeu entier
sans rien manquer**, et sous quelle forme l'écrire.

---

## 1. Le recensement

Jouer au hasard en écoutant ce qui manque ne marche pas : on retrouve les trois
mêmes trous à chaque session et jamais les vingt autres. Il faut une grille.

### La grille objet × verbe

Pour chaque système du GDD, écrire **les noms** puis **les verbes**, et croiser.

> **Noms** (Récolte de monstres) : œuf · créature · aura · essence · potion ·
> mutation · billet · cristal · étage · base · dalle · travailleur · caisse ·
> item · jeton · pack · trophée
>
> **Verbes** : acheter · vendre · ramasser · poser · retirer · ouvrir · fermer ·
> équiper · déséquiper · lancer · récupérer · améliorer · fusionner · échanger ·
> jeter · débloquer

Le croisement donne la liste **exhaustive** des gestes possibles. La plupart des
cases sont vides (on n'« équipe » pas une caisse) ; celles qui restent sont
exactement ce que la carte doit couvrir. C'est long, et c'est le but : c'est la
seule méthode qui trouve « retirer un œuf d'une base », que personne ne pense à
tester.

### Les quatre moments qui appellent toujours un son

Passer chaque case retenue au filtre suivant. Chaque ligne cochée est une entrée
de la carte.

| Moment | Question | Exemple |
|---|---|---|
| **1. Ça marche** | le joueur a agi et le jeu a dit oui | l'œuf est posé dans l'incubateur |
| **2. Ça ne marche pas** | le joueur a agi et le jeu a dit non | pas assez d'argent, base pleine |
| **3. Ça se termine tout seul** | le jeu a fini quelque chose **sans le joueur** | la potion est prête, l'œuf a éclos |
| **4. Un seuil est franchi** | un palier, un niveau, un record | palier de rivière, niveau de créature |

Le **3** est celui qu'on oublie systématiquement, et c'est le plus rentable : un
joueur qui n'entend pas que sa potion est prête ne revient pas la chercher.

Le **2** ne prend un son **que s'il apprend quelque chose**. Un refus muet est
souvent le bon choix (cf. `mixage.md` § alarme) : un « non » sonore à chaque clic
raté transforme le jeu en réveil-matin.

### Les trois sources, dans l'ordre

1. **Le GDD** § 3 — la liste des systèmes fait la liste des sections. Un système
   du GDD absent de la carte est un oubli, pas un choix.
2. **Le lieu Studio** (`script_grep`, pas les copies de `studio/`) :
   `Sons.pour` · `Lecteur.jouer` · `Instance.new("Sound")` · `SoundId` ·
   `ProximityPrompt` · `.Triggered` · `RemoteEvent`. Les `ProximityPrompt` sont
   la mine principale : **chaque prompt est un geste du joueur**, donc une ligne
   de carte, avec ou sans son.
3. **Une partie**, en Play, la carte sous les yeux — pour vérifier ce qui est
   marqué posé, pas pour découvrir ce qui manque.

---

## 2. Le schéma de `sons.json`

```json
{
  "jeu": "Récolte de monstres",
  "mixage": {
    "etalon": { "nom": "_Etalon", "quoi": "le pas du personnage Roblox (Running)" },
    "echelons": { "fond": -14, "texture": -8, "geste": -4, "reussite": 0, "evenement": 4, "alarme": 7 },
    "tolerance_db": 1.5
  },
  "sons": {
    "OeufRamasse": {
      "echelon": "geste",
      "ids": [117813075686953],
      "vitesse": [0.92, 1.10],
      "volume": 0.5,
      "mesure": { "corps": 8.21, "crete": 14.9, "rms": 5.02, "duree": 0.44, "le": "2026-08-21" },
      "pourquoi": "Le geste le plus répété du jeu : tout ce qui traîne y devient un bruit de fond.",
      "declencheurs": [
        { "systeme": "3.1 Rivière", "sujet": "Œuf", "geste": "acheté sur la rivière",
          "condition": "le serveur a débité le prix", "ou": "FarmGame · prompt Rivière",
          "canal": "serveur" }
      ]
    }
  }
}
```

### Champs d'un son

| Champ | Obligatoire | Sens |
|---|---|---|
| `echelon` | **oui** | `fond` `texture` `geste` `reussite` `evenement` `alarme`. C'est **la seule décision de niveau** qu'on prend à la main |
| `ids` | oui (peut être `[]`) | assets Roblox. **`[]` = son manquant**, et c'est une entrée valide : c'est ce qui fait que la carte recense les trous |
| `cherche` | si `ids` est vide | ce qu'on va chercher, en anglais, comme on le taperait dans le Toolbox |
| `volume` | généré | **calculé** depuis la mesure et l'échelon. Ne pas l'écrire à la main |
| `volumeFixe` | non | force le volume et court-circuite le calcul. Exige une raison dans `pourquoi` |
| `vitesse` | non | `[min, max]` de `PlaybackSpeed`, tiré au hasard. `[1, 1]` fige la hauteur |
| `mesure` | généré | rempli par `--mesures`. Son absence déclenche l'avertissement « volume deviné » |
| `pourquoi` | **oui** | pourquoi ce son existe et pourquoi il sonne comme ça. Reprise telle quelle dans `SonsConfig.lua` et dans la carte |
| `declencheurs` | **oui** | au moins un, sinon personne ne joue ce son |
| `boucle` | non | `true` pour une ambiance qui tourne (le lecteur ne gère pas les boucles : voir `moteur.md`) |
| `famille` | pour un manquant | le **registre de recherche** (`Bois & objet posé`, `Magie`…). C'est ce qui groupe la liste de chasse : on tape un mot une fois et on remplit quatre lignes d'un coup, au lieu de changer de registre à chaque son |
| `veut` | pour un manquant | **ce qu'on veut entendre**, en une phrase, en français. Le `cherche` donne les mots à taper ; celui-ci dit à quoi reconnaître le bon quand on l'entend |
| `evite` | non | le piège connu pour ce son — ce qui remonte en tête des résultats et qui ne convient pas |
| `rejetes` | non | assets **écartés**, `[{ id, pourquoi }]`. À remplir chaque fois qu'on retire un id : sans ça, un asset rejeté pour cause de niveau impossible ressort en tête du Toolbox à la recherche suivante, et on refait la même erreur six mois plus tard. Repris en encadré dans la liste de courses |

### Champs d'un déclencheur

| Champ | Sens |
|---|---|
| `systeme` | section du GDD, ex. `"3.3 Incubateur"`. C'est ce qui groupe la carte |
| `sujet` | **l'objet** : `Œuf`, `Aura`, `Potion`, `Étage` |
| `geste` | **ce qui lui arrive**, au participe : `posé dans l'incubateur`, `vendu au marchand` |
| `condition` | **quand exactement** — la condition qui distingue ce cas d'un cas voisin |
| `ou` | **où le brancher** : module et point d'accroche. C'est l'adresse que le développeur suit |
| `canal` | `serveur` · `client` · `tous` (cf. `mixage.md` § 6) |

Le triplet **sujet · geste · condition** est ce que l'utilisateur lit. Il doit se
lire comme une phrase : *« Œuf — posé dans l'incubateur — quand le serveur
accepte la mise en couveuse. »* Si ça ne fait pas une phrase, le découpage est
mauvais.

---

## 3. Le format de `docs/AUDIO.md`

Généré. Trois niveaux, du plus large au plus fin.

### En haut : le tableau de bord

Le compte par état, et le compte par système. C'est ce qu'on regarde pour savoir
où on en est sans lire les 80 lignes.

| État | Marque | Sens |
|---|---|---|
| posé | ✅ | son en place, mesuré, dans son échelon |
| à régler | 🔊 | son en place mais **hors de son échelon** — le volume corrigé est donné |
| deviné | 🎚️ | son en place, **jamais mesuré** : le volume est une opinion |
| trouvé | 🔎 | asset choisi, pas encore branché côté jeu |
| manquant | ⬜ | pas de son, et il en faut un |

### Au milieu : une section par système

Un tableau par système du GDD, dans l'ordre du GDD :

```
### 3.3 Incubateur

| Sujet | Geste | Quand | Son | Volume | Où | État |
|---|---|---|---|---|---|---|
| Œuf | posé dans l'incubateur | le serveur accepte | `OeufIncube` | — | IncubateurConfig | ⬜ |
| Œuf | refusé définitivement | coquille déjà fêlée | `IncubRefus` | 45 % · alarme | RefusIncubationController | ✅ |
```

Le volume est écrit **en pourcentage**, suivi de son échelon : `45 % · alarme`.
Le pourcentage est ce que l'utilisateur reconnaît ; l'échelon est ce qui explique
pourquoi il vaut ça.

### En bas : la liste de courses

Toutes les entrées `⬜ manquant`, avec leur `cherche`, groupées par échelon —
c'est la liste qu'on emmène dans le Toolbox, et l'ordre par échelon évite d'aller
chercher vingt fois de suite dans des registres différents.

---

## 3 bis. `audio/A-TROUVER.md` — la liste de chasse

Généré lui aussi, et **séparé de la carte** parce qu'il ne sert pas au même
moment : la carte dit où en est le son du jeu, la liste sert **pendant** qu'on
cherche, avec une seule question par fiche — « est-ce que celui-là fait
l'affaire ? ».

Groupée par **famille de recherche**, pas par système de jeu : on cherche par
registre sonore (`wood`, `chime`, `magic`), pas par mécanique. Chaque fiche
porte le déclencheur, ce qu'on veut entendre, les mots à taper, le piège à
éviter, la durée plafond, et une ligne vide pour l'id.

Elle se termine par les sons **qui ne sont pas manquants mais attendent une
décision** (jamais mesurés, ou hors de leur échelon) : sans ça, ils se perdent
entre deux fichiers.

## 4. Ce que la carte n'est pas

- **Ce n'est pas la doc du système audio.** Le fonctionnement du moteur est dans
  `references/moteur.md` et dans les en-têtes des modules Luau.
- **Ce n'est pas une liste de souhaits.** Une ligne `⬜` veut dire « ce geste doit
  faire un bruit », décidé, pas « ce serait bien un jour ». Ce qui n'est pas
  décidé ne rentre pas dans le fichier.
- **Ce n'est pas éditable à la main.** Toute correction va dans `sons.json`. Une
  phrase écrite dans `AUDIO.md` disparaît à la régénération suivante.
