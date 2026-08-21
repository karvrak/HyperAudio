--[[ banc.lua — le banc d'essai : MESURER la force réelle de chaque son.

	FICHIER GÉNÉRÉ par HyperAudio depuis audio/sons.json. Ne pas l'éditer.

	À EXÉCUTER EN PLAY, datamodel Client (MCP execute_luau, ou la barre de
	commande une fois la partie lancée).

	POURQUOI EN PLAY ET PAS EN EDIT. En mode Edit, le moteur audio de Roblox
	n'avance pas : le Sound se déclare IsPlaying, mais TimePosition reste à 0 et
	PlaybackLoudness renvoie 0 sur toute la durée. Le banc rendrait des zéros
	SANS ERREUR — et on en déduirait des volumes absurdes.

	CE QU'IL MESURE. Sound.PlaybackLoudness, image par image, sur RenderStepped.
	C'est la force de la MATIÈRE décodée : elle intègre le format et le niveau
	d'enregistrement de l'asset. Le Volume d'un Sound, lui, ne dit RIEN de sa
	force — deux assets à Volume 0.5 peuvent différer de 45 dB, et c'est
	exactement ce qu'on a trouvé dans ce jeu le 21/08.

	LA PROPRIÉTÉ IGNORE LE VOLUME. Mesuré : le même asset rend 282 à Volume 1,
	282 à 0.5, 338 à 0.065. C'est ce qui rend la mesure utile (elle décrit
	l'asset, pas le réglage du jour) — et c'est aussi un piège : REMESURER APRÈS
	AVOIR POSÉ LES VOLUMES NE VÉRIFIE RIEN, on retrouve les mêmes nombres. Le
	résultat d'un mixage se juge à l'oreille, en jeu, et seulement là.

	TROIS NOMBRES SORTENT, ET C'EST LE TROISIÈME QUI SERT :
	  crete  le maximum. Trompeur seul : un transitoire sec fait une crête énorme
	         sans qu'on entende un son fort.
	  rms    la moyenne sur toute la durée. Trompeur aussi : deux secondes de
	         silence en fin d'échantillon l'effondrent, alors que l'oreille n'a
	         rien entendu de plus faible.
	  corps  la moyenne quadratique sur les seules images où le son dépasse 10 %
	         de sa crête — la force du son PENDANT QU'IL SONNE. C'est ce que juge
	         l'oreille, et c'est ce que le calcul des volumes utilise.

	L'ÉTALON. Le pas du personnage (Running, posé par RbxCharacterSounds dans le
	HumanoidRootPart) est mesuré comme les autres, et son Volume réel est relevé
	sur le personnage vivant. Tout le mixage se calcule à partir de là : c'est le
	son qu'on veut protéger, donc celui contre lequel tout le reste se mesure.

	TOUT EN UNE SEULE PASSE. Seuls les RAPPORTS entre sons ont un sens, et ils ne
	valent que si tout a été mesuré dans les mêmes conditions. Ne jamais ajouter
	une mesure isolée après coup à un jeu de mesures existant.

	*** LA FENÊTRE STUDIO DOIT ÊTRE AU PREMIER PLAN. *** C'est la contrainte la
	plus facile à rater et la plus coûteuse. Non focalisée, Roblox bride le rendu
	à ~15 images/s ; l'échantillonnage suit, et un bruitage de 0,5 s n'est plus
	décrit que par HUIT points pris au hasard dans sa forme d'onde. Mesuré le
	21/08 : le même son est sorti à 82,7 fenêtre active et à 23,8 fenêtre en
	arrière-plan — un facteur 3,5, soit 11 dB d'erreur sur un mixage.

	Deux garde-fous ici même, parce qu'une consigne ne suffit pas :
	  · TROIS PASSES par son, dont on garde la MÉDIANE. Trois échantillonnages
	    tombent sur trois découpages différents de l'onde ; la médiane ignore
	    celui qui est parti de travers.
	  · Le nombre d'images est RENVOYÉ avec chaque mesure, et le générateur
	    refuse celles qui en ont trop peu. Une mesure pauvre ne se corrige pas,
	    elle se refait.

	Le résultat est un JSON à coller dans audio/mesures.json, puis :
	  node .claude/skills/hyperaudio/scripts/build.mjs audio/sons.json --mesures audio/mesures.json
]]

local ContentProvider = game:GetService("ContentProvider")
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")

local CIBLES = {
--[[CIBLES]]
}

-- Plafonds de durée : au-delà, on n'apprend plus rien sur le niveau et on fait
-- expirer l'appel MCP. Un son de geste dure moins d'une seconde de toute façon ;
-- une musique se juge sur ses premières secondes comme sur les suivantes.
local MAX_COURT, MAX_FOND = 3, 6
local SEUIL_CORPS = 0.10 -- part de la crête en dessous de laquelle on considère
                         -- que le son ne sonne pas (silence de tête, queue)

-- ===================== l'étalon : le pas du personnage =====================
-- LE PAS N'A PAS D'ID NUMÉRIQUE. RbxCharacterSounds le pose en
-- `rbxasset://sounds/action_footsteps_plastic.mp3` — un chemin interne au
-- client, pas un asset du catalogue. Toute tentative d'en extraire un nombre
-- rend « 3 » (le 3 de mp3) et mesure un asset au hasard : c'est ce qui est
-- arrivé le 21/08, et l'erreur était silencieuse.
--
-- On CLONE donc l'instance vivante, quel que soit le schéma de son SoundId, et
-- on lit son Volume réel sur le personnage.
local function etalon()
	local plr = Players.LocalPlayer
	local char = plr and (plr.Character or plr.CharacterAdded:Wait())
	local hrp = char and char:WaitForChild("HumanoidRootPart", 10)
	local run = hrp and hrp:FindFirstChild("Running")
	if not run then return nil end
	return run.SoundId, run.Volume
end

-- ===================== la mesure =====================
-- `soundId` est la CHAÎNE complète (« rbxassetid://123 » ou « rbxasset://… ») :
-- le banc doit pouvoir mesurer l'étalon comme le catalogue.
local function mesurer(soundId, fond)
	local s = Instance.new("Sound")
	s.SoundId = soundId
	s.Volume = 1        -- on mesure l'ASSET, pas le réglage courant
	s.Looped = false
	s.Parent = SoundService
	-- Pas de SoundGroup : sinon la mesure passerait par les curseurs du joueur
	-- et dépendrait de son réglage. Le mixeur range à la naissance tout Sound
	-- sans groupe dans SfxGroup — on le ressort donc explicitement.
	s.SoundGroup = nil

	pcall(function() ContentProvider:PreloadAsync({ s }) end)
	s.SoundGroup = nil

	local duree = s.TimeLength
	if not (duree > 0) then
		s:Destroy()
		return { erreur = "ne charge pas (droits de l'asset ?)", duree = 0 }
	end

	local fenetre = math.min(duree, fond and MAX_FOND or MAX_COURT)
	local ech = {}
	s.TimePosition = 0
	s:Play()
	local co = RunService.RenderStepped:Connect(function()
		ech[#ech + 1] = s.PlaybackLoudness
	end)
	task.wait(fenetre + 0.05)
	co:Disconnect()
	s:Stop()
	s:Destroy()

	if #ech == 0 then return { erreur = "aucune image echantillonnee", duree = duree } end

	local crete, somme = 0, 0
	for _, v in ipairs(ech) do
		if v > crete then crete = v end
		somme += v * v
	end
	local rms = math.sqrt(somme / #ech)

	local sommeCorps, n = 0, 0
	local seuil = crete * SEUIL_CORPS
	for _, v in ipairs(ech) do
		if v >= seuil and v > 0 then sommeCorps += v * v ; n += 1 end
	end
	local corps = n > 0 and math.sqrt(sommeCorps / n) or rms

	-- LE SILENCE DE TETE : combien de temps avant que le son sonne vraiment.
	-- Beaucoup d'echantillons du Toolbox commencent par 50 a 200 ms de vide. Sur
	-- un son de geste, ce retard se SENT — le clic parait mou, desynchronise de
	-- l'action — et aucun volume ne le rattrape. C'est le critere qui a departage
	-- sept candidats le 21/08 : le retenu attaquait en 17 ms, les autres en 50+.
	local tete = 0
	for _, v in ipairs(ech) do
		if v >= seuil then break end
		tete += 1
	end
	local teteMs = duree > 0 and (tete / #ech) * duree * 1000 or 0

	return { corps = corps, crete = crete, rms = rms, duree = duree,
	         teteMs = teteMs, images = #ech }
end

-- Trois passes, on garde la mediane du `corps`. Les autres champs viennent de la
-- passe mediane elle-meme, pour qu'une fiche reste coherente avec elle-meme.
local function mesurerRobuste(soundId, fond)
	local passes = {}
	for _ = 1, 3 do
		local m = mesurer(soundId, fond)
		if m.erreur then return m end
		table.insert(passes, m)
	end
	table.sort(passes, function(a, b) return a.corps < b.corps end)
	local med = passes[2]
	med.corpsPasses = { passes[1].corps, passes[2].corps, passes[3].corps }
	-- L'ECART ENTRE PASSES EST LE JUGE DE LA MESURE. Serre, la mesure tient ;
	-- large, la fenetre n'etait pas au premier plan et rien n'est exploitable.
	med.dispersionDb = passes[1].corps > 0 and 20 * math.log10(passes[3].corps / passes[1].corps) or 99
	return med
end

-- ===================== controle d'entree =====================
-- ON REFUSE DE MESURER PLUTOT QUE DE MESURER FAUX. Le banc echantillonne au
-- rythme des images ; si la fenetre Studio n'est pas au premier plan, Roblox
-- bride le rendu a ~15 images/s et un bruitage de 0,5 s n'est plus decrit que
-- par huit points pris au hasard dans son onde. Le pire est que ca SORT QUAND
-- MEME des chiffres, d'allure raisonnable, faux de 10 dB.
local function cadence()
	local n = 0
	local co = RunService.RenderStepped:Connect(function() n += 1 end)
	task.wait(1)
	co:Disconnect()
	return n
end

local fps = cadence()
if fps < 45 then
	return HttpService:JSONEncode({
		erreur = ("BANC REFUSE : %d images/s (il en faut 45). La fenetre Roblox Studio "):format(fps)
			.. "n'est pas au premier plan — Roblox bride le rendu, et la mesure serait un "
			.. "tirage au sort. Cliquer sur la fenetre Studio, puis relancer.",
		fps = fps,
	})
end

-- ===================== la passe =====================
local sortie = { le = os.date("!%Y-%m-%d"), fps = fps, sons = {} }

local idEtalon, volEtalon = etalon()
if idEtalon then
	local m = mesurerRobuste(idEtalon, false)
	m.id = idEtalon
	m.volumeJeu = volEtalon
	sortie.etalon = m
	if m.erreur then
		sortie.avertissement = "L'ETALON ne se mesure pas (" .. m.erreur .. "). Sans lui, aucun volume "
			.. "ne peut etre calcule : tout le mixage resterait une opinion."
	end
else
	sortie.avertissement = "PAS D'ETALON : le son Running est introuvable sur le personnage. "
		.. "Marcher une fois avant de relancer, ou verifier que RbxCharacterSounds tourne."
end

for _, c in ipairs(CIBLES) do
	local m = mesurerRobuste("rbxassetid://" .. c.id, c.fond)
	-- On renvoie l'id MESURE avec la mesure : c'est ce qui permet au generateur
	-- de detecter qu'une mesure ne decrit plus l'asset en place. Sans lui, un
	-- changement d'asset laisse en face de lui les chiffres de l'ancien, et le
	-- volume calcule est faux SANS QUE RIEN NE LE DISE.
	m.id = c.id
	sortie.sons[c.nom] = m
end

return HttpService:JSONEncode(sortie)
