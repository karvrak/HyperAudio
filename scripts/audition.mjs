#!/usr/bin/env node
// audition.mjs — HyperAudio : des ids candidats → un dossier qu'on ÉCOUTE.
//
//   node .claude/skills/hyperaudio/scripts/audition.mjs audio/candidats.json
//   node … audition.mjs audio/candidats.json --dossier audio/ecoute
//
// POURQUOI CET OUTIL. Choisir un bruitage sur son NOM ne marche pas : « Money
// Collect » peut être une pièce, un froissement de billet ou un jingle de jeu
// mobile. Il faut l'entendre. Or on ne peut pas écouter vingt candidats dans
// Studio un par un sans y passer l'après-midi.
//
// CE QU'IL FAIT. Pour chaque id : il demande sa fiche à l'API catalogue (nom,
// créateur, description — sans authentification), essaie de TÉLÉCHARGER l'asset,
// et s'il y arrive le mesure pour de vrai avec ffmpeg. Puis il écrit une page
// `ecoute.html` autonome, un lecteur par candidat, groupés par son à combler,
// avec les mesures en face — de sorte qu'on écoute dans l'ordre du plus probable
// au moins probable, au lieu d'écouter au hasard.
//
// LA LIMITE, ET ELLE EST STRUCTURELLE. Depuis la refonte de 2022, un asset audio
// Roblox est PRIVÉ par défaut : `assetdelivery` répond 401. Les assets ANCIENS
// (ids à 10 chiffres) et les bibliothèques officielles (ProSoundEffects, Roblox)
// restent publics et se téléchargent. Les autres ne s'écoutent que dans Studio
// ou sur leur page du Creator Store — la page les liste quand même, avec le lien
// et le bouton qui va bien, mais sans lecteur local.
//
// Les chemins sont résolus depuis import.meta.url, jamais depuis le cwd.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, execSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

const ICI = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const cible = argv.find((a) => !a.startsWith("--"));
if (!cible) {
  console.error("Usage : node audition.mjs <candidats.json> [--dossier <chemin>]");
  process.exit(1);
}
const opt = (n) => {
  const i = argv.indexOf("--" + n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};

const FICHIER = resolve(cible);
const DOSSIER = resolve(opt("dossier") || join(dirname(FICHIER), "ecoute"));
const doc = JSON.parse(readFileSync(FICHIER, "utf8"));

mkdirSync(DOSSIER, { recursive: true });

// ── les critères du skill, appliqués automatiquement (sourcing.md § 3) ──
// La durée d'abord : c'est ce qui rend un son insupportable, avant son timbre.
const PLAFOND = { texture: 0.5, geste: 0.6, reussite: 1.5, evenement: 3, fond: Infinity };
const ATTAQUE_MAX = 40; // ms de silence de tête tolérés sur un texture/geste

const sortie = {};
let telecharges = 0, refuses = 0;

for (const [son, fiche] of Object.entries(doc.sons)) {
  const dossierSon = join(DOSSIER, son);
  const lot = [];
  for (const id of fiche.candidats) {
    process.stdout.write(`  ${son} · ${id} … `);
    const c = { id: String(id) };

    // 1. la fiche catalogue — nom, créateur, description. Sans authentification.
    try {
      const j = JSON.parse(curl(`https://economy.roblox.com/v2/assets/${id}/details`));
      c.nom = j.Name;
      c.createur = j.Creator?.Name || "?";
      c.description = (j.Description || "").trim();
      const m = c.description.match(/Duration:\s*([\d.]+)\s*seconds/i);
      if (m) c.dureeAnnoncee = Number(m[1]);
      const k = c.description.match(/Category:\s*(.+)/i);
      if (k) c.categorie = k[1].trim();
    } catch { c.nom = "(fiche indisponible)"; c.createur = "?"; }

    // 2. le téléchargement. C'est lui qui décide si on pourra l'écouter ici.
    mkdirSync(dossierSon, { recursive: true });
    const fichier = join(dossierSon, `${id}.ogg`);
    const ok = telecharger(id, fichier);
    if (ok) {
      c.fichier = `${son}/${id}.ogg`;
      Object.assign(c, mesurer(fichier));
      telecharges++;
      console.log(`ok — ${c.duree?.toFixed(2)}s, corps ${c.corpsDb} dBFS, attaque ${c.attaqueMs} ms`);
    } else {
      c.prive = true;
      refuses++;
      console.log("privé (401) — écoutable seulement dans Studio ou sur sa page");
    }

    // 3. LA RETAILLE. Deux des trois defauts qui disqualifient un bruitage — le
    //    silence de tete et la duree — ne sont pas des defauts de l'echantillon,
    //    ce sont des defauts du FICHIER : ffmpeg les corrige. On produit donc
    //    une version retaillee de tout candidat qui en a besoin, et c'est ELLE
    //    qu'on juge. Sans ca, on ecarte de bons sons pour un demi-quart de
    //    seconde de vide au debut.
    if (c.fichier) {
      const retaille = retailler(join(dossierSon, `${id}.ogg`), fiche.echelon, c);
      if (retaille) {
        c.retaille = `${son}/${id}-retaille.ogg`;
        Object.assign(c, { retailleInfo: retaille });
      }
    }

    // 4. le verdict, avant toute écoute : ce qui est hors critères ne mérite pas
    //    qu'on y passe dix secondes d'oreille.
    c.verdict = juger(c, fiche.echelon);
    lot.push(c);
  }

  // Les recevables d'abord, et parmi eux le plus court en tête : à qualité égale,
  // le plus sec est toujours le meilleur choix pour un son qui se répète.
  lot.sort((a, b) => (a.verdict.rang - b.verdict.rang) || ((a.duree ?? 9) - (b.duree ?? 9)));
  sortie[son] = { ...fiche, candidats: lot };
}

const gabarit = readFileSync(join(ICI, "..", "templates", "ecoute.html"), "utf8");
writeFileSync(join(DOSSIER, "ecoute.html"), gabarit.replace("/*DONNEES*/", JSON.stringify(sortie)), "utf8");

console.log(`\n${telecharges} écoutable(s) sur place, ${refuses} privé(s)`);
console.log(`→ ${join(DOSSIER, "ecoute.html")}`);

// ════════════════════════════════════════════════════════════

function curl(url) {
  return execFileSync("curl", ["-s", "--max-time", "20", url], { encoding: "utf8", maxBuffer: 1 << 24 });
}

function telecharger(id, dest) {
  if (existsSync(dest) && statSync(dest).size > 2000) return true; // déjà là
  try {
    // --compressed EST INDISPENSABLE : le CDN sert ces fichiers avec
    // `encoding=gzip` dans l'URL signée, et sans cet indicateur curl écrit le
    // flux gzip TEL QUEL. Le fichier fait la bonne taille, il ne lève aucune
    // erreur, et ffmpeg ne le décode pas — le candidat passe pour privé alors
    // qu'il était public. Perdu une passe entière là-dessus le 21/08.
    execFileSync("curl", ["-s", "-L", "--compressed", "--max-time", "30", "-o", dest,
      `https://assetdelivery.roblox.com/v1/asset/?id=${id}`], { stdio: "ignore" });
  } catch { return false; }
  if (!existsSync(dest)) return false;

  // Un 401 arrive en JSON, avec un code 200 sur le fichier : on regarde la
  // signature du contenu, pas le code HTTP.
  let tete = readFileSync(dest).subarray(0, 4);
  // Filet : si du gzip passe quand même (serveur qui l'annonce mal), on déballe.
  if (tete[0] === 0x1f && tete[1] === 0x8b) {
    try {
      writeFileSync(dest, gunzipSync(readFileSync(dest)));
      tete = readFileSync(dest).subarray(0, 4);
    } catch { return false; }
  }
  const sig = tete.toString("latin1");
  return sig === "OggS" || sig.startsWith("ID3") || sig === "RIFF";
}

// La mesure, hors Roblox. ffmpeg décode en PCM mono 8 kHz : à partir de là tout
// se calcule à la main, et on obtient les MÊMES grandeurs que le banc Studio —
// la force pendant que le son sonne, et le silence de tête.
function mesurer(fichier) {
  const out = {};
  try {
    const p = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration",
      "-of", "csv=p=0", fichier], { encoding: "utf8" }).trim();
    out.duree = Number(p);
  } catch { return out; }

  // Loudness intégrée EBU R128, pour référence — mais elle ne vaut que sur les
  // sons d'au moins ~3 s : en dessous, son gating rend le plancher (−70 LUFS)
  // et ne dit rien. C'est pourquoi le jugement s'appuie sur `corps`, ci-dessous.
  try {
    const r = execSync(`ffmpeg -hide_banner -nostats -i ${guillemets(fichier)} `
      + `-af ebur128=peak=true -f null - 2>&1`, { encoding: "utf8", maxBuffer: 1 << 24 });
    lireLoudness(r, out);
  } catch (e) {
    lireLoudness(String(e.stdout || "") + String(e.stderr || ""), out);
  }

  // LE CORPS ET L'ATTAQUE, en PCM — les deux mêmes grandeurs que le banc Studio,
  // calculées ici de la même façon, donc directement comparables :
  //   corps   la moyenne quadratique sur les seuls échantillons au-dessus de
  //           10 % de la crête — la force du son PENDANT QU'IL SONNE.
  //   attaque le temps avant le premier de ces échantillons. Un geste dont le
  //           son démarre 200 ms après le clic paraît mou, et aucun volume ne
  //           le rattrape.
  try {
    const pcm = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", fichier,
      "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { maxBuffer: 1 << 26 });
    const n = Math.floor(pcm.length / 2);
    let crete = 0;
    for (let k = 0; k < n; k++) {
      const v = Math.abs(pcm.readInt16LE(k * 2));
      if (v > crete) crete = v;
    }
    if (crete > 0) {
      const seuil = crete * 0.10;
      let somme = 0, compte = 0, premier = -1;
      for (let k = 0; k < n; k++) {
        const v = Math.abs(pcm.readInt16LE(k * 2));
        if (v >= seuil) {
          if (premier < 0) premier = k;
          somme += v * v; compte++;
        }
      }
      out.attaqueMs = Math.round((Math.max(premier, 0) / 8000) * 1000);
      // en dBFS : 32768 = pleine échelle. Un chiffre lisible et comparable.
      out.corpsDb = compte ? Math.round(20 * Math.log10(Math.sqrt(somme / compte) / 32768) * 10) / 10 : null;
      out.creteDb = Math.round(20 * Math.log10(crete / 32768) * 10) / 10;
    }
  } catch { /* pas grave : le verdict retombe sur la durée seule */ }

  return out;
}

// ebur128 imprime UNE LIGNE PAR IMAGE pendant l'analyse, chacune contenant
// « I: … LUFS », puis un resume final. Prendre la premiere occurrence rend donc
// la valeur a t=0, c'est-a-dire le plancher (-70) : c'est ce qui est arrive le
// 21/08, et tous les candidats sont sortis a -70 sans que rien n'echoue. On lit
// le bloc « Integrated loudness », et a defaut la DERNIERE occurrence.
// RETAILLER : couper le silence de tete, plafonner la duree a l'echelon, et
// poser un fondu de sortie de 30 ms pour ne pas laisser un clic a la coupe.
// Renvoie ce qui a ete fait, ou null si le fichier etait deja bon.
function retailler(source, echelon, mesure) {
  const plafond = PLAFOND[echelon] ?? 1.5;
  const debut = (mesure.attaqueMs ?? 0) > 15 ? (mesure.attaqueMs - 10) / 1000 : 0;
  const restant = (mesure.duree ?? 0) - debut;
  const duree = Math.min(restant, plafond);
  if (debut <= 0 && restant <= plafond) return null;   // rien a corriger

  const dest = source.replace(/\.ogg$/, "-retaille.ogg");
  const fondu = Math.min(0.03, duree / 4);
  try {
    execSync(`ffmpeg -y -hide_banner -loglevel error -ss ${debut.toFixed(3)} `
      + `-i ${guillemets(source)} -t ${duree.toFixed(3)} `
      + `-af "afade=t=out:st=${(duree - fondu).toFixed(3)}:d=${fondu.toFixed(3)}" `
      + `-c:a libvorbis -q:a 5 ${guillemets(dest)}`, { stdio: "ignore" });
  } catch { return null; }
  if (!existsSync(dest)) return null;
  return {
    coupeMs: Math.round(debut * 1000),
    duree: Math.round(duree * 100) / 100,
    quoi: [debut > 0 ? `${Math.round(debut * 1000)} ms de silence retires` : null,
           restant > plafond ? `raccourci a ${duree.toFixed(2)} s` : null].filter(Boolean).join(", "),
  };
}

function lireLoudness(texte, out) {
  const bloc = texte.match(/Integrated loudness:[\s\S]{0,120}?I:\s*(-?[\d.]+)\s*LUFS/);
  const toutes = [...texte.matchAll(/I:\s*(-?[\d.]+)\s*LUFS/g)];
  const i = bloc ? bloc[1] : (toutes.length ? toutes[toutes.length - 1][1] : null);
  if (i !== null) out.lufs = Number(i);
  const pk = texte.match(/Peak:\s*(-?[\d.]+)\s*dBFS/);
  if (pk) out.peak = Number(pk[1]);
}

// Les chemins Windows contiennent des espaces : sans guillemets, ffmpeg reçoit
// deux arguments au lieu d'un et se plaint d'un fichier introuvable.
function guillemets(p) { return `"${p}"`; }

// rang 0 = à écouter en premier · 1 = passable · 2 = hors critères · 3 = muet
function juger(c, echelon) {
  if (c.prive) return { rang: 1, mot: "à écouter dans Studio", pourquoi: "asset privé : pas de lecteur ici" };
  if (!(c.duree > 0)) return { rang: 3, mot: "illisible", pourquoi: "le fichier ne se décode pas" };

  const ennuis = [];
  const plafond = PLAFOND[echelon] ?? 1.5;
  // Si une version retaillee existe, c'est ELLE qui compte : duree et attaque y
  // sont corrigees par construction. Ne restent que les defauts irreparables.
  if (!c.retaille) {
    if (c.duree > plafond)
      ennuis.push(`${c.duree.toFixed(2)} s pour un ${echelon} (plafond ${plafond} s)`);
    if (["texture", "geste"].includes(echelon) && c.attaqueMs > ATTAQUE_MAX)
      ennuis.push(`attaque molle : ${c.attaqueMs} ms de silence avant que ça sonne`);
  }
  // Le seuil porte sur `corps` (la force pendant que le son sonne) et non sur
  // les LUFS : la loudness EBU ne veut rien dire sous ~3 s, et la plupart des
  // bruitages sont plus courts.
  if (c.corpsDb !== undefined && c.corpsDb !== null && c.corpsDb < -45)
    ennuis.push(`enregistrement quasi muet (corps ${c.corpsDb} dBFS) — aucun volume ne le rattrape`);

  if (!ennuis.length) return {
    rang: 0, mot: "recevable",
    pourquoi: c.retaille ? `retaillé : ${c.retailleInfo.quoi}` : "dans les critères de son échelon",
  };
  return { rang: ennuis.length > 1 ? 2 : 1, mot: ennuis.length > 1 ? "hors critères" : "réserve", pourquoi: ennuis.join(" · ") };
}
