#!/usr/bin/env node
// build.mjs — HyperAudio : sons.json → SonsConfig.lua + AUDIO.md + console.html + banc.lua
//
//   node .claude/skills/hyperaudio/scripts/build.mjs audio/sons.json
//   node … build.mjs audio/sons.json --mesures audio/mesures.json
//   node … build.mjs audio/sons.json --biblio <chemin>   (défaut : roblox/_assets/audio/)
//
// POURQUOI UN GÉNÉRATEUR ET PAS UN FICHIER LUA ÉCRIT À LA MAIN. Parce que le
// volume d'un son n'est pas une donnée qu'on écrit : c'est un RÉSULTAT. Il dépend
// de la force réelle de l'asset (mesurée dans Studio) et de l'échelon qu'on lui a
// assigné. Écrit à la main, il est faux dès que l'asset change — et il est faux
// SANS LE DIRE, parce qu'un son mal mixé ne lève aucune erreur.
//
// Le même sons.json produit donc quatre choses qui ne peuvent pas diverger : le
// catalogue que le jeu lit, la carte que l'humain lit, la console qui montre les
// écarts, et le banc qui refait les mesures.
//
// Les chemins sont résolus depuis import.meta.url, jamais depuis le cwd : on peut
// lancer l'outil de n'importe où.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = resolve(ICI, "..", "templates");

const argv = process.argv.slice(2);
const cible = argv.find((a) => !a.startsWith("--"));
if (!cible) {
  console.error("Usage : node build.mjs <sons.json> [--mesures <mesures.json>] [--biblio <dossier>]");
  process.exit(1);
}
const opt = (nom) => {
  const i = argv.indexOf("--" + nom);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};

const FICHIER = resolve(cible);
const RACINE = resolve(dirname(FICHIER), "..");          // <projet>/audio/sons.json → <projet>
const BIBLIO = resolve(opt("biblio") || resolve(ICI, "../../../../..", "_assets", "audio"));

const doc = JSON.parse(readFileSync(FICHIER, "utf8"));
const SONS = doc.sons || {};
const MIX = doc.mixage || {};
const ECHELONS = MIX.echelons || { fond: -14, texture: -8, geste: -4, reussite: 0, evenement: 4, alarme: 7 };
const TOLERANCE = MIX.tolerance_db ?? 1.5;
const ETALON_ECHELON = MIX.etalon_echelon || "texture";
const RESERVE = (nom) => nom.startsWith("_");

// Seuils de recevabilite d'une mesure. Voir le commentaire au report des mesures
// et banc.lua : ce ne sont pas des reglages de confort, ce sont les deux signes
// qui distinguent une mesure d'un tirage au sort.
const MIN_IMAGES = MIX.min_images ?? 20;
const MAX_DISPERSION = MIX.max_dispersion_db ?? 3;

const MARQUE = { pose: "✅", regler: "🔊", devine: "🎚️", trouve: "🔎", manquant: "⬜" };
const ETAT_MOT = { pose: "posé", regler: "à régler", devine: "deviné", trouve: "trouvé", manquant: "manquant" };

const alertes = [];
const infos = [];
const av = (nom, texte) => alertes.push(`${nom} — ${texte}`);

// ───────────────────────────── 1. mesures ─────────────────────────────
// Reportées DANS sons.json : le fichier de mesures est un transit, pas un
// second lieu de vérité. Une mesure qui vivrait à côté finirait désynchronisée
// du catalogue qu'elle décrit.
const fMesures = opt("mesures");
if (fMesures) {
  const m = JSON.parse(readFileSync(resolve(fMesures), "utf8"));
  const le = m.le || new Date().toISOString().slice(0, 10);
  let posees = 0;
  for (const [nom, mes] of Object.entries(m.sons || {})) {
    if (!SONS[nom]) { av(nom, "mesuré mais absent du catalogue — banc.lua est périmé, régénérer"); continue; }
    if (mes.erreur || !(mes.duree > 0)) { av(nom, `NE CHARGE PAS dans cet univers (${mes.erreur || "durée nulle"}) — droits de l'asset, cf. sourcing.md § 2`); continue; }
    // Une mesure qui survit à l'asset qu'elle décrivait est un piège : le son a
    // été vidé de ses ids (asset écarté), la remettre le ferait passer pour
    // mesuré et calculé alors qu'il n'a plus rien à mesurer.
    if (!(SONS[nom].ids || []).length) { infos.push(`${nom} : mesure ignorée, le son n'a plus d'asset (écarté ?)`); continue; }
    // UNE MESURE PAUVRE NE SE CORRIGE PAS, ELLE SE REFAIT. Le banc echantillonne
    // au rythme des images : fenetre Studio en arriere-plan, Roblox tombe a ~15
    // images/s et un bruitage de 0,5 s n'est plus decrit que par huit points
    // pris au hasard dans son onde. Mesure le 21/08 : 82,7 fenetre active contre
    // 23,8 fenetre derriere, soit 11 dB d'erreur — de quoi fausser tout le
    // mixage avec l'aplomb d'un chiffre.
    const pauvre = mes.images !== undefined && mes.images < MIN_IMAGES;
    const dispersee = mes.dispersionDb !== undefined && mes.dispersionDb > MAX_DISPERSION;
    if (pauvre || dispersee) {
      av(nom, pauvre
        ? `mesure REJETEE : ${mes.images} images seulement (minimum ${MIN_IMAGES}). La fenetre Studio n'etait pas au premier plan — la remettre devant et relancer banc.lua`
        : `mesure REJETEE : ${r1(mes.dispersionDb)} dB d'ecart entre les trois passes (maximum ${MAX_DISPERSION}). L'echantillonnage est instable — fenetre Studio au premier plan, puis relancer`);
      continue;
    }
    SONS[nom].mesure = { id: mes.id ?? SONS[nom].ids[0], corps: r2(mes.corps), crete: r2(mes.crete), rms: r2(mes.rms), duree: r2(mes.duree), teteMs: mes.teteMs === undefined ? null : r1(mes.teteMs), images: mes.images ?? null, le };
    posees++;
  }
  // Sans étalon mesurable, aucun volume ne peut être calculé : c'est un échec
  // franc, pas un détail. On refuse d'écrire un étalon à zéro, qui ferait passer
  // tout le mixage pour calculé alors qu'il serait resté une opinion.
  if (m.etalon && m.etalon.corps > 0 && m.etalon.volumeJeu > 0) {
    doc.mixage = doc.mixage || {};
    doc.mixage.etalon = {
      quoi: "le pas du personnage Roblox (Running), cf. mixage.md § 2",
      id: m.etalon.id, volumeJeu: r2(m.etalon.volumeJeu),
      corps: r2(m.etalon.corps), duree: r2(m.etalon.duree), le,
    };
  } else if (m.etalon) {
    av("_Etalon", `le pas ne s'est pas mesuré (${m.etalon.erreur || "corps nul"}) — aucun volume ne peut être calculé, cf. banc.lua § étalon`);
  }
  infos.push(`${posees} mesure(s) reportée(s) dans ${cible}`);
}
const ETALON = (doc.mixage && doc.mixage.etalon) || null;

// ─────────────────────── 2. le calcul des volumes ───────────────────────
// cible(e) = niveau du pas, remonté à 0 dB, redescendu à l'échelon e.
// volume   = cible / force réelle de l'asset.   (mixage.md § 5)
const dB = (x) => Math.pow(10, x / 20);
let N0 = null;
if (ETALON && ETALON.corps > 0 && ETALON.volumeJeu > 0) {
  N0 = ETALON.corps * ETALON.volumeJeu * dB(-(ECHELONS[ETALON_ECHELON] ?? -8));
} else {
  infos.push("pas d'étalon mesuré : les volumes restent ceux du fichier (cf. SKILL.md § 4)");
}

let alarmes = 0;
for (const [nom, s] of Object.entries(SONS)) {
  s.ids = s.ids || [];
  if (RESERVE(nom)) continue;

  if (!s.echelon || ECHELONS[s.echelon] === undefined)
    av(nom, `échelon inconnu : « ${s.echelon} » — attendus : ${Object.keys(ECHELONS).join(", ")}`);
  if (!s.pourquoi) av(nom, "pas de `pourquoi` — un son sans raison écrite se fait supprimer par erreur dans six mois");
  if (!s.declencheurs || !s.declencheurs.length) av(nom, "son orphelin : aucun déclencheur, personne ne le joue");
  if (s.echelon === "alarme" && ++alarmes > 1)
    av(nom, "DEUXIÈME alarme : dès qu'il y a deux « non », aucun des deux ne veut plus dire non (mixage.md § 3)");
  if (s.echelon === "texture" && s.ids.length === 1)
    av(nom, "texture à une seule variante : rejoué plusieurs fois par seconde, ça s'entend comme une mitrailleuse — il en faut 2, idéalement 3");
  // Un silence de tete sur un son de geste rend le retour MOU : le joueur voit
  // l'action partir avant de l'entendre. Aucun volume ne le rattrape — seul un
  // autre asset le corrige. Le seuil est bas exprès : 40 ms se sentent deja.
  if (s.mesure && s.mesure.teteMs > 40 && ["texture", "geste"].includes(s.echelon))
    av(nom, `attaque molle : ${Math.round(s.mesure.teteMs)} ms de silence avant que le son sonne. Sur un ${s.echelon}, le retour parait desynchronise du geste — chercher un echantillon qui attaque tout de suite`);
  if (!s.ids.length && !s.cherche)
    av(nom, "manquant sans `cherche` : rien à taper dans le Toolbox, la ligne est un vœu et pas une décision");

  for (const d of s.declencheurs || []) {
    for (const champ of ["systeme", "sujet", "geste", "condition", "ou", "canal"])
      if (!d[champ]) av(nom, `déclencheur incomplet : champ « ${champ} » manquant`);
    if (d.canal && !["serveur", "client", "tous"].includes(d.canal))
      av(nom, `canal inconnu : « ${d.canal} » — serveur, client ou tous`);
  }

  // état + volume
  s.etat = "manquant";
  if (!s.ids.length) continue;

  if (s.volumeFixe !== undefined) {
    s.volume = s.volumeFixe;
    s.etat = "pose";
    s.note = "volume fixé à la main";
    if (!s.pourquoi) av(nom, "volumeFixe sans raison écrite dans `pourquoi` — dans trois mois personne ne saura si c'est un réglage ou un oubli");
    continue;
  }

  // UNE MESURE QUI NE DECRIT PLUS SON ASSET EST PIRE QUE PAS DE MESURE : elle
  // fait passer pour calcule un volume tire des chiffres de l'asset precedent.
  // C'est arrive le 21/08 en remplacant BilletsRamasses — le generateur a sorti
  // un volume de 10 avec l'aplomb d'un resultat.
  // Une mesure sans `id` est traitée comme périmée elle aussi : c'est une mesure
  // d'avant ce garde-fou, donc une mesure dont personne ne peut dire quel asset
  // elle décrivait. On la refait plutôt que de la croire.
  if (s.mesure && s.mesure.id !== s.ids[0]) {
    av(nom, s.mesure.id === undefined
      ? "mesure sans asset identifié (antérieure au garde-fou) — relancer banc.lua"
      : `mesure périmée : elle décrit l'asset ${s.mesure.id}, le son porte maintenant ${s.ids[0]} — relancer banc.lua`);
    delete s.mesure;
  }

  if (!s.mesure || !(s.mesure.corps > 0) || N0 === null) {
    s.etat = "devine";
    s.volume = s.volume ?? 0.5;
    av(nom, "volume deviné : asset jamais mesuré, ce volume est une opinion — lancer banc.lua (SKILL.md § 4)");
    continue;
  }

  // Sound.Volume est borné à [0, 10] par Roblox — MESURÉ, pas supposé : au-delà
  // de 10 la propriété se clampe en silence. Au-dessus de 1 on AMPLIFIE, ce qui
  // remonte le souffle de l'enregistrement avec le son : praticable jusqu'à ~2,
  // douteux au-delà.
  const voulu = N0 * dB(ECHELONS[s.echelon] ?? 0) / s.mesure.corps;
  s.cibleVolume = r3(Math.min(10, Math.max(0.02, voulu)));
  s.ecartDb = r1(20 * Math.log10((s.volume || s.cibleVolume) / s.cibleVolume));

  if (voulu > 10)
    av(nom, `asset INUTILISABLE : il faudrait un volume de ${r2(voulu)} pour atteindre l'échelon « ${s.echelon} », or Roblox clampe Volume à 10. Aucun réglage ne le rattrape — il faut un AUTRE asset, et noter celui-ci dans \`rejetes\``);
  else if (voulu > 2)
    av(nom, `asset faible : volume calculé ${r2(voulu)}. Au-dessus de 2 on amplifie, et le souffle de l'enregistrement monte avec le son — préférer un asset mieux enregistré`);
  else if (voulu < 0.02)
    av(nom, `asset trop fort : volume calculé ${r3(voulu)}. Il jouera écrasé dans le bas de l'échelle et sonnera sale — chercher plus discret`);

  const dedans = s.volume !== undefined && Math.abs(s.ecartDb) <= TOLERANCE;

  // Un son à lecteur propre n'est PAS corrigé par le générateur : son volume vit
  // dans son script (AmbianceMusique et consorts), que HyperAudio ne génère pas.
  // Lui réécrire `volume` ici serait un mensonge — le fichier dirait 0.056 et le
  // jeu jouerait toujours 0.22. On dit donc l'écart, et où aller le corriger.
  if (s.moteur === "propre") {
    s.etat = dedans ? "pose" : "regler";
    if (!dedans) {
      const ou = (s.declencheurs || [])[0]?.ou || "son script";
      av(nom, `hors de son échelon de ${s.ecartDb > 0 ? "+" : ""}${s.ecartDb} dB (volume ${s.volume}, cible ${s.cibleVolume}) — LECTEUR PROPRE : à corriger à la main dans ${ou}, le générateur n'y touche pas`);
    }
    continue;
  }

  if (!dedans) {
    if (s.volume !== undefined)
      av(nom, `hors de son échelon de ${s.ecartDb > 0 ? "+" : ""}${s.ecartDb} dB — volume ${s.volume} → ${s.cibleVolume}`);
    s.volume = s.cibleVolume;
    s.etat = "regler";
  } else {
    s.etat = "pose";
  }
}

// ───────────────────────── 3. les quatre sorties ─────────────────────────
ecrire(join(RACINE, "studio", "SonsConfig.lua"), sonsConfigLua());
ecrire(join(RACINE, "docs", "AUDIO.md"), carteSonore());
ecrire(join(RACINE, "audio", "console.html"), console_html());
ecrire(join(RACINE, "audio", "banc.lua"), bancLua());
ecrire(join(RACINE, "audio", "A-TROUVER.md"), listeDeChasse());
// sons.json n'est réécrit QUE si des mesures sont arrivées. Un build sec ne
// touche pas à la source de vérité : elle n'a rien appris, et la reformater à
// chaque passe encombrerait le diff de bruit qui ne dit rien.
if (fMesures) writeFileSync(FICHIER, serialiser(doc) + "\n", "utf8");
verserBibliotheque();

for (const i of infos) console.log("   " + i);
if (alertes.length) {
  console.log(`\n⚠  ${alertes.length} avertissement(s) — ils se corrigent, ils ne se commentent pas :\n`);
  for (const a of alertes) console.log("   • " + a);
} else {
  console.log("\n✓ aucun avertissement");
}
console.log(`\n${resume()}\n`);

// ═══════════════════════════ générateurs ═══════════════════════════

function sonsConfigLua() {
  const L = [];
  L.push("--[[ SonsConfig — le catalogue des bruitages du jeu.");
  L.push("");
  L.push("\tFICHIER GÉNÉRÉ par HyperAudio. Ne pas l'éditer à la main : la source de");
  L.push("\tvérité est audio/sons.json, et toute retouche posée ici est perdue à la");
  L.push("\tprochaine régénération.");
  L.push("");
  L.push("\t\tnode .claude/skills/hyperaudio/scripts/build.mjs audio/sons.json");
  L.push("");
  L.push("\tUN SEUL ENDROIT où changer un son. Le reste du code ne connaît que le NOM de");
  L.push("\tl'événement (« OeufRamasse »), jamais un rbxassetid.");
  L.push("");
  L.push("\tLES VOLUMES NE SONT PAS ÉCRITS, ILS SONT CALCULÉS. Chaque son déclare un");
  L.push("\tÉCHELON (ce qu'il est dans la vie du joueur) ; le banc d'essai mesure la");
  L.push("\tforce réelle de l'asset dans Studio ; le volume est ce qui pose l'un sur");
  L.push("\tl'autre. Le mètre étalon est le PAS du personnage — le son qu'on veut");
  L.push("\tprotéger, donc celui contre lequel tout le reste se mesure.");
  L.push("");
  for (const [e, v] of Object.entries(ECHELONS))
    L.push(`\t\t${e.padEnd(10)} ${(v >= 0 ? "+" : "") + v} dB`);
  L.push("");
  L.push("\tChaque fiche :");
  L.push("\t  ids     asset(s) Roblox. Plusieurs = VARIANTES, tirées au hasard à chaque");
  L.push("\t          lecture — indispensable dès qu'un son se répète vite.");
  L.push("\t  volume  0-1, AVANT le curseur « Effets » des réglages.");
  L.push("\t  vitesse { min, max } — PlaybackSpeed tiré au hasard dans la fourchette.");
  L.push("");
  L.push("\tCe catalogue ne contient QUE les bruitages joues par SonsLecteur. Les sons a");
  L.push("\tlecteur propre (la musique de fond) sont cartographies dans docs/AUDIO.md et");
  L.push("\tmixes avec les autres, mais ils vivent dans leur propre script.");
  L.push("");
  L.push("\tLes Sound ne portent PAS de SoundGroup : c'est le mixeur des réglages");
  L.push("\t(SettingsGUI.SettingsController) qui les rattrape à la naissance et les range");
  L.push("\tdans SfxGroup. Leur en poser un ici les sortirait du curseur « Effets ».");
  L.push("]]");
  L.push("");
  L.push("local M = {}");
  L.push("");
  L.push("M.CATALOGUE = {");

  const parEchelon = Object.keys(ECHELONS);
  // `moteur: "propre"` = le son a son propre lecteur (la musique de fond, une
  // boucle d'ambiance). Il est cartographie et mixe comme les autres, mais il
  // n'entre PAS dans le catalogue : SonsLecteur ne sait pas boucler, et l'y
  // mettre laisserait croire qu'un `Sons.pour(plr, "Ambiance")` marcherait.
  const poses = Object.entries(SONS).filter(([n, s]) => !RESERVE(n) && s.ids.length && s.moteur !== "propre");
  poses.sort((a, b) => parEchelon.indexOf(a[1].echelon) - parEchelon.indexOf(b[1].echelon) || a[0].localeCompare(b[0]));

  let echelonCourant = null;
  for (const [nom, s] of poses) {
    if (s.echelon !== echelonCourant) {
      echelonCourant = s.echelon;
      L.push(`\t-- ═══ ${echelonCourant.toUpperCase()} (${signe(ECHELONS[echelonCourant])} dB) ${"═".repeat(Math.max(0, 48 - echelonCourant.length))}`);
    }
    for (const ligne of commentaire(s.pourquoi || "")) L.push("\t" + ligne);
    const bouts = [];
    bouts.push(s.ids.length === 1 ? `id = ${s.ids[0]}` : `ids = { ${s.ids.join(", ")} }`);
    bouts.push(`volume = ${s.volume}`);
    if (s.vitesse) bouts.push(`vitesse = { ${s.vitesse[0]}, ${s.vitesse[1]} }`);
    L.push(`\t${nom} = { ${bouts.join(", ")} },`);
    L.push("");
  }
  L.push("}");
  L.push("");
  L.push("-- Normalisation : une fiche porte TOUJOURS `ids`, même quand le catalogue n'en");
  L.push("-- déclare qu'un. Le lecteur n'a ainsi qu'un seul cas à traiter, et une fiche ne");
  L.push("-- peut pas être à moitié dans un format et à moitié dans l'autre.");
  L.push("for nom, f in pairs(M.CATALOGUE) do");
  L.push("\tif not f.ids then");
  L.push('\t\tassert(f.id, "[SonsConfig] " .. nom .. " n\'a ni id ni ids")');
  L.push("\t\tf.ids = { f.id }");
  L.push("\tend");
  L.push("end");
  L.push("");
  L.push("function M.fiche(nom)");
  L.push("\treturn M.CATALOGUE[nom]");
  L.push("end");
  L.push("");
  L.push("return M");
  return L.join("\n") + "\n";
}

// Un `pourquoi` de sons.json devient un commentaire Lua replié à 76 colonnes.
// Le texte reste écrit UNE fois, dans le JSON — pas deux, une fois par sortie.
function commentaire(texte) {
  if (!texte) return [];
  const mots = texte.split(/\s+/);
  const out = [];
  let ligne = "--";
  for (const m of mots) {
    if ((ligne + " " + m).length > 76) { out.push(ligne); ligne = "--"; }
    ligne += " " + m;
  }
  if (ligne !== "--") out.push(ligne);
  return out;
}

function carteSonore() {
  const L = [];
  L.push("# La carte sonore");
  L.push("");
  L.push("<!-- FICHIER GÉNÉRÉ par HyperAudio depuis `audio/sons.json`. Ne pas l'éditer à la");
  L.push("     main : toute correction va dans le JSON, sinon elle est perdue à la");
  L.push("     prochaine régénération.");
  L.push("     node .claude/skills/hyperaudio/scripts/build.mjs audio/sons.json -->");
  L.push("");
  L.push("Chaque geste du jeu, ce qu'il fait entendre, et à quel volume. Une ligne se lit");
  L.push("comme une phrase : **sujet — geste — quand**.");
  L.push("");

  // tableau de bord
  const parEtat = {};
  const lignes = [];
  for (const [nom, s] of Object.entries(SONS)) {
    if (RESERVE(nom)) continue;
    parEtat[s.etat] = (parEtat[s.etat] || 0) + 1;
    for (const d of s.declencheurs || []) lignes.push({ nom, s, d });
  }
  L.push("| État | | Combien | Sens |");
  L.push("|---|---|---:|---|");
  for (const e of ["pose", "regler", "devine", "trouve", "manquant"]) {
    if (!parEtat[e]) continue;
    const sens = {
      pose: "son en place, mesuré, dans son échelon",
      regler: "en place mais **hors de son échelon** — le volume corrigé est déjà appliqué",
      devine: "en place mais **jamais mesuré** : le volume est une opinion",
      trouve: "asset choisi, pas encore branché côté jeu",
      manquant: "**pas de son**, et il en faut un",
    }[e];
    L.push(`| ${ETAT_MOT[e]} | ${MARQUE[e]} | ${parEtat[e]} | ${sens} |`);
  }
  L.push("");
  L.push(`**${lignes.length} gestes recensés** sur **${Object.keys(SONS).filter((n) => !RESERVE(n)).length} sons**.`);
  if (ETALON)
    L.push(`Mètre étalon : le pas du personnage (asset \`${ETALON.id}\`, volume ${ETALON.volumeJeu} en jeu), mesuré le ${ETALON.le}.`);
  else
    L.push("**Aucun étalon mesuré** : les volumes ci-dessous sont des opinions, pas des calculs. Lancer `audio/banc.lua` en Play.");
  L.push("");
  L.push("---");
  L.push("");

  // par système
  // Tri NATUREL : un tri de chaînes range « 3.12 » avant « 3.3 », et la carte
  // ne suit plus l'ordre du GDD — or c'est tout l'intérêt de reprendre ses
  // numéros. Les sections sans numéro (« Arène & boss ») passent après.
  const rang = (s) => {
    const m = s.match(/^(\d+)(?:\.(\d+))?/);
    return m ? [Number(m[1]), Number(m[2] || 0)] : [Infinity, Infinity];
  };
  const systemes = [...new Set(lignes.map((l) => l.d.systeme))].sort((a, b) => {
    const [a1, a2] = rang(a), [b1, b2] = rang(b);
    return a1 - b1 || a2 - b2 || a.localeCompare(b);
  });
  for (const sys of systemes) {
    L.push(`## ${sys}`);
    L.push("");
    L.push("| Sujet | Geste | Quand | Son | Volume | Où | |");
    L.push("|---|---|---|---|---|---|---|");
    for (const { nom, s, d } of lignes.filter((l) => l.d.systeme === sys)) {
      const vol = s.ids.length ? `${Math.round(s.volume * 100)} % · ${s.echelon}` : `— · ${s.echelon}`;
      L.push(`| ${d.sujet} | ${d.geste} | ${d.condition} | \`${nom}\` | ${vol} | ${d.ou} | ${MARQUE[s.etat]} |`);
    }
    L.push("");
  }

  // liste de courses
  const manquants = Object.entries(SONS).filter(([n, s]) => !RESERVE(n) && !s.ids.length);
  L.push("---");
  L.push("");
  L.push("## La liste de courses");
  L.push("");
  if (!manquants.length) {
    L.push("Aucun son manquant.");
  } else {
    L.push("Groupée par échelon : c'est l'ordre dans lequel on la remonte, pour ne pas");
    L.push("changer de registre à chaque recherche. Les termes sont ceux à taper tels quels");
    L.push("dans le Toolbox (`search_asset`, `assetType: \"Audio\"`).");
    L.push("");
    for (const e of Object.keys(ECHELONS)) {
      const lot = manquants.filter(([, s]) => s.echelon === e);
      if (!lot.length) continue;
      L.push(`### ${e} — ${signe(ECHELONS[e])} dB · ${lot.length} son(s)`);
      L.push("");
      L.push("| Son | À chercher | Pourquoi |");
      L.push("|---|---|---|");
      for (const [nom, s] of lot) L.push(`| \`${nom}\` | \`${s.cherche || "—"}\` | ${(s.pourquoi || "").replace(/\|/g, "\\|")} |`);
      L.push("");
      // Les assets ÉCARTÉS se disent, sinon on les re-choisit. Un id rejeté pour
      // cause de niveau impossible a toutes les chances de ressortir en tête du
      // Toolbox à la recherche suivante — c'est comme ça qu'on refait la même
      // erreur six mois plus tard.
      const rejets = lot.filter(([, s]) => (s.rejetes || []).length);
      for (const [nom, s] of rejets)
        for (const rj of s.rejetes)
          L.push(`> **\`${nom}\` — ne pas reprendre l'asset \`${rj.id}\`.** ${rj.pourquoi}\n`);
    }
  }
  return L.join("\n") + "\n";
}

// LA LISTE DE CHASSE — le fichier qu'on emporte dans le Toolbox.
//
// Elle existe SEPAREMENT de la carte sonore parce qu'elle ne sert pas au meme
// moment : la carte dit ou en est le son du jeu, la liste sert pendant qu'on
// cherche, avec une seule question par ligne — « est-ce que celui-la fait
// l'affaire ? ». Groupee par FAMILLE de recherche et non par systeme de jeu :
// on tape « wood » une fois et on remplit quatre lignes d'un coup.
function listeDeChasse() {
  const manquants = Object.entries(SONS).filter(([n, s]) => !RESERVE(n) && !s.ids.length);
  const L = [];
  L.push("# Les sons à trouver");
  L.push("");
  L.push("<!-- FICHIER GÉNÉRÉ par HyperAudio depuis `audio/sons.json`. Toute correction va");
  L.push("     dans le JSON — ce qui est écrit ici est perdu à la régénération.");
  L.push("     node .claude/skills/hyperaudio/scripts/build.mjs audio/sons.json -->");
  L.push("");
  L.push(`**${manquants.length} sons.** Pour chacun : quand il se déclenche, ce qu'on veut`);
  L.push("entendre, la durée à ne pas dépasser, les mots à taper — et une ligne vide pour");
  L.push("noter l'id retenu.");
  L.push("");
  L.push("---");
  L.push("");
  L.push("## Où chercher");
  L.push("");
  L.push("Toolbox de Studio (onglet **Audio**), ou <https://create.roblox.com/store/audio>.");
  L.push("");
  L.push("**Trois règles qui vont à l'inverse de ce qu'on ferait spontanément** — mesurées");
  L.push("le 21/08 sur ce jeu :");
  L.push("");
  L.push("| | |");
  L.push("|---|---|");
  L.push("| **Un ou deux mots, jamais une phrase** | `wood`, `crack`, `chime`. Une formulation bien tournée comme `paper money rustle` rend **zéro résultat** — l'index audio ne fait pas de recherche sémantique |");
  L.push("| **Ne pas filtrer par durée ni par prix** | ces filtres **vident** les résultats au lieu de les affiner. On trie sur la durée après, à l'œil |");
  L.push("| **Ratisser, puis trier** | trois ou quatre requêtes d'un mot autour de l'idée valent mieux qu'une requête précise |");
  L.push("");
  L.push("**Écoutez tout avant de retenir.** Le nom ment souvent : « Money Collect » peut");
  L.push("être une pièce, un froissement de billet ou un jingle de jeu mobile.");
  L.push("");
  L.push("## Les deux critères qui éliminent le plus vite");
  L.push("");
  L.push("1. **La durée.** C'est ce qui rend un son insupportable, avant son timbre. Le");
  L.push("   plafond est donné pour chaque son — il vient de la fréquence du geste : un");
  L.push("   son joué cinquante fois par session ne peut pas durer deux secondes.");
  L.push("2. **Le démarrage.** Beaucoup d'échantillons commencent par 50 à 200 ms de");
  L.push("   silence. Sur un geste, ça se **sent** : le retour paraît mou, décalé. Si le son");
  L.push("   ne démarre pas tout de suite quand vous l'écoutez, écartez-le.");
  L.push("");
  L.push("Ce qu'on ne regarde **pas** : le volume de l'enregistrement. Il est recalculé");
  L.push("automatiquement (`references/mixage.md`).");
  L.push("");
  L.push("## Ce qu'il faut me renvoyer");
  L.push("");
  L.push("Une ligne par son, l'id suffit :");
  L.push("");
  L.push("```");
  L.push("OeufPose = 9126267420");
  L.push("OeufEclos = 9113959343");
  L.push("```");
  L.push("");
  L.push("Plusieurs ids pour le même son = **variantes**, tirées au hasard à chaque lecture.");
  L.push("C'est un plus pour tout ce qui se répète vite ; inutile ailleurs.");
  L.push("");
  L.push("Je m'occupe ensuite de vérifier qu'ils chargent dans l'univers, de les mesurer et");
  L.push("de calculer leur volume.");
  L.push("");
  L.push("---");
  L.push("");

  const MAX = { texture: "0,5 s", geste: "0,6 s", reussite: "1,5 s", evenement: "3 s", fond: "—" };
  const familles = [...new Set(manquants.map(([, s]) => s.famille || "Divers"))];
  for (const fam of familles) {
    const lot = manquants.filter(([, s]) => (s.famille || "Divers") === fam);
    L.push(`## ${fam}`);
    L.push("");
    for (const [nom, s] of lot) {
      const d = (s.declencheurs || [])[0] || {};
      L.push(`### \`${nom}\``);
      L.push("");
      L.push(`**Quand** — ${d.sujet} ${d.geste}, ${d.condition}.`);
      L.push("");
      L.push(`**Ce qu'on veut entendre** — ${s.veut || ""}`);
      L.push("");
      L.push(`**À taper** — ${(s.cherche || "").split(",").map((t) => "`" + t.trim() + "`").join(" · ")}`);
      L.push("");
      if (s.evite) L.push(`**À éviter** — ${s.evite}`);
      if (s.evite) L.push("");
      L.push(`**Durée max** — ${MAX[s.echelon] || "?"} (échelon \`${s.echelon}\`)`);
      L.push("");
      L.push("**id trouvé** : ` `");
      L.push("");
    }
  }

  // Ce qui n'est pas « manquant » mais attend quand meme une decision : le dire
  // ici evite qu'il se perde entre deux fichiers.
  const enAttente = Object.entries(SONS).filter(([n, s]) => !RESERVE(n) && s.ids.length && (s.etat === "devine" || s.etat === "regler"));
  if (enAttente.length) {
    L.push("---");
    L.push("");
    L.push("## Pas manquants, mais en attente");
    L.push("");
    for (const [nom, s] of enAttente) {
      const quoi = s.etat === "devine"
        ? "asset en place mais **jamais mesuré** — le volume est une opinion tant que le banc n'a pas tourné"
        : `**hors de son échelon** de ${s.ecartDb > 0 ? "+" : ""}${s.ecartDb} dB`;
      L.push(`- \`${nom}\` (${s.ids.join(", ")}) — ${quoi}.`);
    }
    L.push("");
  }
  return L.join("\n") + "\n";
}

function console_html() {
  const donnees = { echelons: ECHELONS, etalon: ETALON, tolerance: TOLERANCE, sons: {} };
  for (const [nom, s] of Object.entries(SONS)) {
    if (RESERVE(nom)) continue;
    donnees.sons[nom] = {
      echelon: s.echelon, etat: s.etat, volume: s.volume ?? null,
      cible: s.cibleVolume ?? null, ecart: s.ecartDb ?? null,
      ids: s.ids.length, mesure: s.mesure || null, pourquoi: s.pourquoi || "",
      cherche: s.cherche || "",
      declencheurs: (s.declencheurs || []).map((d) => `${d.sujet} — ${d.geste} — ${d.condition}`),
    };
  }
  const gabarit = readFileSync(join(TEMPLATES, "console.html"), "utf8");
  return gabarit.replace("/*DONNEES*/", JSON.stringify(donnees));
}

function bancLua() {
  const cibles = [];
  for (const [nom, s] of Object.entries(SONS)) {
    if (RESERVE(nom) || !s.ids.length) continue;
    // On mesure la PREMIÈRE variante : les variantes d'un même son viennent du
    // même créateur et du même enregistrement, leurs niveaux ne diffèrent pas
    // assez pour justifier de tripler la durée du banc.
    cibles.push(`\t{ nom = "${nom}", id = ${s.ids[0]}, fond = ${s.echelon === "fond"} },`);
  }
  const gabarit = readFileSync(join(TEMPLATES, "banc.lua"), "utf8");
  return gabarit.replace("--[[CIBLES]]", cibles.join("\n"));
}

function verserBibliotheque() {
  if (!existsSync(BIBLIO)) { infos.push(`bibliothèque absente (${BIBLIO}) — rien versé`); return; }
  const f = join(BIBLIO, "bibliotheque.json");
  const b = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { sons: [] };
  const parId = new Map(b.sons.map((s) => [s.id, s]));
  const jeu = doc.jeu || "?";
  let ajouts = 0;
  for (const [nom, s] of Object.entries(SONS)) {
    if (RESERVE(nom) || !s.ids.length || !s.mesure) continue;
    for (const id of s.ids) {
      const e = parId.get(id) || { id, nom, famille: s.echelon, projets: [], note: "" };
      // On n'écrase que ce qui se mesure. `note` et `nom` sont écrits à la main
      // dans la bibliothèque : les reprendre du catalogue les perdrait.
      if (id === s.ids[0]) { e.duree = s.mesure.duree; e.corps = s.mesure.corps; }
      if (!e.projets.includes(jeu)) e.projets.push(jeu);
      if (!parId.has(id)) { parId.set(id, e); ajouts++; }
    }
  }
  b.sons = [...parId.values()].sort((a, x) => (a.famille || "").localeCompare(x.famille || "") || a.id - x.id);
  writeFileSync(f, JSON.stringify(b, null, 2) + "\n", "utf8");
  infos.push(`bibliothèque partagée : ${b.sons.length} son(s), ${ajouts} nouveau(x) → ${f}`);
}

// Le JSON réécrit ne contient QUE ce qui a été décidé ou mesuré. `etat`,
// `cibleVolume` et `ecartDb` sont des CONCLUSIONS : les renvoyer dans la source
// de vérité en ferait des données qu'on croirait pouvoir éditer, alors qu'elles
// sont écrasées à chaque passe.
function serialiser(d) {
  const derive = ["etat", "cibleVolume", "ecartDb", "note"];
  const propre = JSON.parse(JSON.stringify(d));
  for (const s of Object.values(propre.sons || {})) for (const k of derive) delete s[k];
  // Les tableaux courts de nombres (ids, vitesse) restent sur une ligne :
  // éclatés, ils noient le fichier sous une colonne de chiffres.
  return JSON.stringify(propre, null, 2)
    .replace(/\[\s*\n\s*([\d.eE+-]+(?:,\s*\n\s*[\d.eE+-]+)*)\n\s*\]/g,
             (_, dedans) => "[" + dedans.split(/,\s*/).join(", ") + "]");
}

function resume() {
  const c = {};
  for (const [n, s] of Object.entries(SONS)) if (!RESERVE(n)) c[s.etat] = (c[s.etat] || 0) + 1;
  return ["pose", "regler", "devine", "trouve", "manquant"]
    .filter((e) => c[e]).map((e) => `${MARQUE[e]} ${c[e]} ${ETAT_MOT[e]}`).join("   ");
}

function ecrire(chemin, contenu) {
  mkdirSync(dirname(chemin), { recursive: true });
  writeFileSync(chemin, contenu, "utf8");
  console.log("→ " + chemin.replace(RACINE + (process.platform === "win32" ? "\\" : "/"), ""));
}
function signe(v) { return (v >= 0 ? "+" : "") + v; }
function r1(x) { return Math.round(x * 10) / 10; }
function r2(x) { return Math.round(x * 100) / 100; }
function r3(x) { return Math.round(x * 1000) / 1000; }
