import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ═══════════════════════════════════════ STORAGE LAYER ══════════════════════
// Compatible Capacitor (iOS prod) / Artifact (preview) / Memory (fallback)
const _mem = {};
const Storage = {
  async get(key) {
    try {
      if (typeof window !== "undefined" && window.Capacitor?.Plugins?.Preferences) {
        const { value } = await window.Capacitor.Plugins.Preferences.get({ key });
        return value;
      }
      if (typeof window !== "undefined" && window.storage) {
        try { const r = await window.storage.get(key, false); return r?.value || null; } catch { return null; }
      }
    } catch (e) {}
    return _mem[key] || null;
  },
  async set(key, value) {
    try {
      if (typeof window !== "undefined" && window.Capacitor?.Plugins?.Preferences) {
        await window.Capacitor.Plugins.Preferences.set({ key, value }); return true;
      }
      if (typeof window !== "undefined" && window.storage) {
        await window.storage.set(key, value, false); return true;
      }
    } catch (e) {}
    _mem[key] = value; return true;
  },
  async remove(key) {
    try {
      if (typeof window !== "undefined" && window.Capacitor?.Plugins?.Preferences) {
        await window.Capacitor.Plugins.Preferences.remove({ key }); return;
      }
      if (typeof window !== "undefined" && window.storage) {
        await window.storage.delete(key, false); return;
      }
    } catch (e) {}
    delete _mem[key];
  },
  // Shared storage for community content (only available in artifact preview / requires backend in iOS)
  async getShared(key) {
    try {
      if (typeof window !== "undefined" && window.storage) {
        const r = await window.storage.get(key, true); return r?.value || null;
      }
    } catch {}
    return null;
  },
  async setShared(key, value) {
    try {
      if (typeof window !== "undefined" && window.storage) {
        await window.storage.set(key, value, true); return true;
      }
    } catch {}
    return false;
  },
  async listShared(prefix) {
    try {
      if (typeof window !== "undefined" && window.storage) {
        const r = await window.storage.list(prefix, true); return r?.keys || [];
      }
    } catch {}
    return [];
  },
};

// ═══════════════════════════════════════ MODERATION ═════════════════════════
// Apple Guideline 1.2 — Content filtering for User-Generated Content
const BLOCKED_WORDS = [
  // Insults FR
  "connard","connasse","salope","salaud","enculé","encule","pute","putain","merde","batard","bâtard","tapette",
  "pédé","pede","fdp","ntm","tg","bouffon","ducon","gueule","crever","creve","chier",
  // Slurs / hate (covers common variants)
  "nègre","negre","bougnoule","youpin","sale arabe","sale juif","sale noir","sale blanc","sale chinois",
  // Insults EN
  "fuck","shit","bitch","asshole","bastard","cunt","dick","pussy","slut","whore","faggot","nigger","retard",
  // Sexual / inappropriate
  "porn","sex","xxx","viol","rape",
];
const checkContent = (text) => {
  if (!text) return null;
  const normalized = text.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "");
  for (const w of BLOCKED_WORDS) {
    const norm = w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (normalized.includes(norm)) return "Contenu inapproprié détecté";
  }
  return null;
};
const validateUsername = (name) => {
  if (!name || name.trim().length < 3) return "Min. 3 caractères";
  if (name.length > 16) return "Max. 16 caractères";
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return "Lettres, chiffres, _ et - uniquement";
  const c = checkContent(name); if (c) return c;
  return null;
};

const REPORT_THRESHOLD = 3; // Auto-hide after 3 reports
const APP_VERSION = "1.0.0";
const CONTACT_EMAIL = "support@worlddomination-game.example.com";

// ═══════════════════════════════════════ DATA ═══════════════════════════════
const GW = 9, GH = 7, CX = 4, CY = 3;
const CELL = 44;

const BIOMES = {
  forest:      { name:"Forêt",          e:"🌿", col:"#39ff14", bg:"#071a07", res:"food",     bonus:0.35, diff:1 },
  mountain:    { name:"Montagne",        e:"⛰️", col:"#60a5fa", bg:"#07101f", res:"minerals", bonus:0.45, diff:2 },
  energy_field:{ name:"Champ Énergie",  e:"⚡", col:"#ffe600", bg:"#1a1700", res:"energy",   bonus:0.5,  diff:1 },
  desert:      { name:"Désert",          e:"🏜️", col:"#ff8c42", bg:"#1a0d00", res:"credits",  bonus:0.3,  diff:1 },
  radioactive: { name:"Zone Radio",      e:"☢️", col:"#b347ff", bg:"#0e0718", res:"rare",     bonus:0.7,  diff:3 },
  city:        { name:"Ruines Urbaines", e:"🏙️", col:"#00f5d4", bg:"#001a1a", res:"all",      bonus:0.2,  diff:2 },
  wasteland:   { name:"Terres Dévastées",e:"💀", col:"#475569", bg:"#0a0a0a", res:"none",     bonus:0,    diff:3 },
  jackpot:     { name:"Zone Jackpot ⭐", e:"⭐", col:"#ffd700", bg:"#1a1500", res:"all",      bonus:1.2,  diff:2 },
};
const BIOME_POOL = ["forest","mountain","energy_field","desert","radioactive","city","wasteland","wasteland"];

const RES_CFG = {
  food:     { e:"🌾", col:"#39ff14" }, minerals:{ e:"💎", col:"#60a5fa" },
  energy:   { e:"⚡", col:"#ffe600" }, credits: { e:"🪙", col:"#ff8c42" },
  rare:     { e:"☢️", col:"#b347ff" },
};

const LEAGUES = [
  { name:"Bronze",  min:0,    col:"#cd7f32", e:"🥉" }, { name:"Argent", min:200,  col:"#c0c0c0", e:"🥈" },
  { name:"Or",      min:500,  col:"#ffd700", e:"🥇" }, { name:"Platine",min:1000, col:"#00f5d4", e:"💎" },
  { name:"Diamant", min:2000, col:"#60a5fa", e:"💠" }, { name:"Légende",min:5000, col:"#ff2d78", e:"⭐" },
];

const WORKER_CFG = {
  miner: {
    name:"Mineur", e:"⛏️", col:"#60a5fa", bonus:"prod",
    desc:"Augmente la production de toutes tes zones",
    utility:"Chaque Mineur ajoute +40% de ressources récoltées dans tes zones capturées. Plus tu en as, plus ta production grimpe vite.",
    tips:["Priorité #1 en début de partie","Indispensable pour progresser vite","Efficace sur les zones Épiques/Légendaires"],
    stat:"Production zones",
    statVal:"+40% par Mineur",
  },
  engineer: {
    name:"Ingénieur", e:"⚙️", col:"#ffe600", bonus:"tech",
    desc:"Réduit le coût des recherches technologiques",
    utility:"Chaque Ingénieur réduit le coût des technologies de 20%. Avec 5 Ingénieurs, les techs coûtent 0€ ! Essentiel pour débloquer Robots IA et Fusion.",
    tips:["Utile pour débloquer l'arbre tech rapidement","Essentiel avant les techs Tier 3","Libère des ressources pour construire"],
    stat:"Réduction tech",
    statVal:"-20% coût par Ingénieur",
  },
  defender: {
    name:"Défenseur", e:"🛡️", col:"#4ade80", bonus:"def",
    desc:"Augmente ta puissance de combat et de défense",
    utility:"Chaque Défenseur ajoute +50% de force de combat. Indispensable pour capturer des zones ennemies difficiles et repousser les raids. Sans eux, tu perds ta base.",
    tips:["Obligatoire pour les zones Épiques/Légendaires","Augmente les chances de victoire en raid","Protège tes meilleures zones de production"],
    stat:"Force de combat",
    statVal:"+50% par Défenseur",
  },
};

// ═══════════════════════════════════════ TECH TREE ══════════════════════════
// cost(prestige) — scales with prestige level
const TECHS = [
  // ── TIER 1 : Fondations ──
  {
    id:"tools", tier:1, req:[], col:"#39ff14",
    name:"Outils Avancés", e:"🔧",
    cost:(p=0) => ({ credits:Math.round(200*(1+p*0.5)), food:Math.round(80*(1+p*0.4)) }),
    researchTime:(p=0) => 30 + p*20,
    desc:"Améliore les outils de tes fermiers",
    effect:"🌾 Production Ferme +30%",
    detail:"Tes fermiers récoltent 30% de nourriture en plus. Prérequis indispensable pour débloquer les Foreuses Auto.",
    impact:"medium", category:"Production",
  },
  {
    id:"solar", tier:1, req:[], col:"#ffe600",
    name:"Panneaux Solaires", e:"☀️",
    cost:(p=0) => ({ credits:Math.round(250*(1+p*0.5)), minerals:Math.round(100*(1+p*0.4)) }),
    researchTime:(p=0) => 30 + p*20,
    desc:"Installe des panneaux solaires sur ta base",
    effect:"⚡ Production Générateur +30%",
    detail:"Réduit la dépendance aux carburants fossiles. L'énergie produite alimente ton empire plus efficacement. Débloque le Bouclier Radiatif.",
    impact:"medium", category:"Énergie",
  },
  {
    id:"trade", tier:1, req:[], col:"#ff8c42",
    name:"Routes Commerciales", e:"🛤️",
    cost:(p=0) => ({ food:Math.round(150*(1+p*0.5)), minerals:Math.round(80*(1+p*0.4)) }),
    researchTime:(p=0) => 25 + p*18,
    desc:"Établis des routes commerciales sécurisées",
    effect:"🪙 Production Marché +25% · Coût marche -15%",
    detail:"Des routes sécurisées permettent à tes marchands de commercer plus vite. Réduit aussi le temps de marche de tes troupes.",
    impact:"medium", category:"Économie",
  },

  // ── TIER 2 : Développement ──
  {
    id:"drills", tier:2, req:["tools"], col:"#60a5fa",
    name:"Foreuses Automatiques", e:"🦾",
    cost:(p=0) => ({ credits:Math.round(500*(1+p*0.6)), minerals:Math.round(200*(1+p*0.5)), food:Math.round(100*(1+p*0.4)) }),
    researchTime:(p=0) => 90 + p*45,
    desc:"Des foreuses robotisées qui creusent sans s'arrêter",
    effect:"⛏️ Production Carrière +40% · Mineurs +1 gratuit",
    detail:"Les foreuses travaillent 24h/24 sans fatigue. Un Mineur bonus est recruté automatiquement. Prérequis pour les Robots IA.",
    impact:"high", category:"Production",
  },
  {
    id:"shield", tier:2, req:["solar"], col:"#b347ff",
    name:"Bouclier Radiatif", e:"🛡️",
    cost:(p=0) => ({ credits:Math.round(600*(1+p*0.6)), energy:Math.round(250*(1+p*0.5)), minerals:Math.round(120*(1+p*0.4)) }),
    researchTime:(p=0) => 90 + p*45,
    desc:"Protège tes troupes des zones irradiées",
    effect:"☢️ Capture zones radioactives · Résistance raids +20%",
    detail:"Sans ce bouclier, tes troupes ne peuvent pas entrer dans les zones radioactives. Augmente aussi la résistance de ta base contre les pillards.",
    impact:"high", category:"Combat",
  },
  {
    id:"logistics", tier:2, req:["trade"], col:"#ff8c42",
    name:"Logistique Avancée", e:"🚚",
    cost:(p=0) => ({ credits:Math.round(450*(1+p*0.6)), food:Math.round(200*(1+p*0.5)), energy:Math.round(80*(1+p*0.4)) }),
    researchTime:(p=0) => 75 + p*40,
    desc:"Optimise le transport des ressources",
    effect:"📦 Stockage +50% · Collecte cooldown -20s",
    detail:"Améliore ta chaîne logistique pour stocker plus et collecter plus souvent. Réduit le temps d'attente entre les collectes.",
    impact:"medium", category:"Économie",
  },

  // ── TIER 3 : Maîtrise ──
  {
    id:"robots", tier:3, req:["drills","shield"], col:"#00f5d4",
    name:"Robots IA", e:"🤖",
    cost:(p=0) => ({ credits:Math.round(1200*(1+p*0.7)), rare:Math.round(30*(1+p*0.6)), minerals:Math.round(400*(1+p*0.5)) }),
    researchTime:(p=0) => 180 + p*90,
    desc:"Une armée de robots intelligents à tes ordres",
    effect:"⚙️ Efficacité workers ×2 · Attaque automatique des zones contestées",
    detail:"Les Robots IA doublent la productivité de tous tes travailleurs. Ils peuvent aussi défendre automatiquement les zones contestées pendant 10s.",
    impact:"critical", category:"Automation",
  },
  {
    id:"fusion", tier:3, req:["robots","logistics"], col:"#ef4444",
    name:"Réacteur à Fusion", e:"🔋",
    cost:(p=0) => ({ credits:Math.round(2000*(1+p*0.8)), rare:Math.round(80*(1+p*0.7)), minerals:Math.round(600*(1+p*0.6)), energy:Math.round(300*(1+p*0.5)) }),
    researchTime:(p=0) => 300 + p*150,
    desc:"La source d'énergie ultime — alimente tout l'empire",
    effect:"🔥 Production GLOBALE ×1.5 · Débloque le Prestige",
    detail:"Le Réacteur à Fusion est le sommet technologique. Il multiplie la production de TOUS tes bâtiments par 1.5 et est requis pour activer le Prestige.",
    impact:"critical", category:"Énergie",
  },
];

const TECH_TIER_NAMES = { 1:"⚗️ FONDATIONS", 2:"🏭 DÉVELOPPEMENT", 3:"🚀 MAÎTRISE" };
const TECH_TIER_DESC  = {
  1:"Les bases de ton empire. Commence ici.",
  2:"Nécessite les techs Tier 1. Coûts plus élevés, gains majeurs.",
  3:"Le sommet. Transforme ton empire. Très difficile à obtenir.",
};

const EVENTS_POOL = [
  { msg:"⛈️ Tempête EM — Production -50% (20s)!",  type:"bad",     eff:"storm"      },
  { msg:"💀 Pillards! Ressources volées!",           type:"bad",     eff:"steal"      },
  { msg:"✨ Découverte rare! Bonus ressources!",     type:"good",    eff:"bonus_res"  },
  { msg:"🚐 Caravane de commerce! +200 Crédits!",   type:"good",    eff:"bonus_cred" },
  { msg:"👥 Survivants! +2 travailleurs recrutés!", type:"good",    eff:"bonus_work" },
  { msg:"⭐ Zone Jackpot apparue sur la map!",       type:"jackpot", eff:"jackpot"    },
];

const ENEMY_NAMES = ["Delta-7","Omega-X","Sigma-9","Alpha-Z","Beta-0","Void-13","Ghost-1","Storm-X"];

// ═══════════════════════════════════════ RARITY SYSTEM ══════════════════════
const RARITIES = {
  common:    { name:"Commun",     col:"#94a3b8", multi:1,  e:"⚪", chance:0.55, glow:"none" },
  rare:      { name:"Rare",       col:"#3b82f6", multi:2,  e:"🔵", chance:0.27, glow:"0 0 12px rgba(59,130,246,0.5)" },
  epic:      { name:"Épique",     col:"#a855f7", multi:4,  e:"🟣", chance:0.13, glow:"0 0 18px rgba(168,85,247,0.6)" },
  legendary: { name:"Légendaire", col:"#f59e0b", multi:8,  e:"🟠", chance:0.05, glow:"0 0 28px rgba(245,158,11,0.85)" },
};
const rollRarity = (rng) => {
  const r = rng();
  let acc = 0;
  for (const [k, v] of Object.entries(RARITIES)) {
    acc += v.chance;
    if (r < acc) return k;
  }
  return "common";
};

// ═══════════════════════════════════════ RAID SYSTEM ════════════════════════
const RAID_INTERVAL_MIN = 60;  // seconds between raid attempts (minimum)
const RAID_INTERVAL_MAX = 120; // (maximum)
const RAID_WARNING_TIME = 20;  // seconds of warning before attack

// Brigade combat — units that fight in auto-battler
const BRIGADE_UNITS = {
  miner:    { name:"Mineur",    hp:30, atk:5,  e:"⛏️", col:"#60a5fa" },
  engineer: { name:"Ingénieur", hp:40, atk:8,  e:"⚙️", col:"#ffe600" },
  defender: { name:"Défenseur", hp:60, atk:12, e:"🛡️", col:"#4ade80" },
};
const ENEMY_UNITS = {
  raider:    { name:"Pillard",  hp:35, atk:7,  e:"💀", col:"#ef4444" },
  marauder:  { name:"Maraudeur",hp:50, atk:10, e:"🗡️", col:"#dc2626" },
  warlord:   { name:"Seigneur", hp:80, atk:15, e:"👹", col:"#991b1b" },
};

// ═══════════════════════════════════════ UTILS ══════════════════════════════
const fmt = n => n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"k" : Math.floor(n).toString();
const adj = (x1,y1,x2,y2) => Math.max(Math.abs(x1-x2), Math.abs(y1-y2)) === 1;
const afford = (res, cost) => !cost || Object.entries(cost).every(([k,v]) => (res[k]||0) >= v);
const costStr = cost => Object.entries(cost).map(([k,v]) => `${fmt(v)}${RES_CFG[k]?.e||k}`).join(" + ");
const getLeague = rp => [...LEAGUES].reverse().find(l => rp >= l.min) || LEAGUES[0];

function seededRng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
}

function makeMap(seed = 42, prestigeN = 0) {
  const rng = seededRng(seed);
  const cells = [];
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const id = y * GW + x;
    const isBase = x === CX && y === CY;
    const dist = Math.max(Math.abs(x - CX), Math.abs(y - CY));
    const biome = isBase ? "city"
      : rng() > 0.998 ? "jackpot"   // jackpot très rare (0.2% au lieu de 4%)
      : BIOME_POOL[Math.floor(rng() * BIOME_POOL.length)];
    // La zone radioactive est toujours légendaire
    const rarity = isBase ? "epic"
      : biome === "radioactive" ? "legendary"
      : rollRarity(rng);
    cells.push({
      id, x, y, biome, isBase, rarity,
      fog: dist > 1,
      owner: isBase ? "player" : "neutral",
      defLv: isBase ? 3 : Math.floor(rng() * 3) + 1,
      enemyName: ENEMY_NAMES[Math.floor(rng() * ENEMY_NAMES.length)],
    });
  }
  // Scatter enemies — jamais sur les cases cardinales de la base
  const baseCardinals = [
    [CX, CY-1], [CX, CY+1], [CX-1, CY], [CX+1, CY]
  ].filter(([x,y]) => x>=0&&x<GW&&y>=0&&y<GH).map(([x,y]) => y*GW+x);

  [[1,0],[7,2],[2,6],[8,4],[0,3],[5,0],[8,6],[1,5]].forEach(([x,y]) => {
    const id = y * GW + x;
    // Ne pas placer d'ennemi sur les cases cardinales adjacentes à la base
    if (baseCardinals.includes(id)) return;
    const c = cells[id];
    if (c) { c.owner = "enemy"; c.fog = false; }
  });

  // Garantir au moins une zone capturable au départ :
  // La case directement en haut de la base = Ferme neutre visible
  const startCell = cells[(CY-1)*GW + CX];
  if (startCell) {
    startCell.biome  = "forest";   // 🌾 Ferme = nourriture
    startCell.rarity = "common";
    startCell.owner  = "neutral";
    startCell.fog    = false;
  }
  // La case à droite = Carrière neutre visible
  const startCell2 = cells[CY*GW + (CX+1)];
  if (startCell2) {
    startCell2.biome  = "mountain"; // ⛏️ Minerais
    startCell2.rarity = "common";
    startCell2.owner  = "neutral";
    startCell2.fog    = false;
  }

  // Prestige bonus: la zone du haut est déjà capturée
  if (prestigeN > 0) {
    if (startCell) { startCell.owner = "player"; startCell.fog = false; }
  }
  return cells;
}

// ═══════════════════════════════════════ MAGIC CHEST SYSTEM ════════════════
const CHEST_RARITIES = {
  common:    { name:"Coffre Commun",     col:"#94a3b8", chance:0.55, multi:1,   e:"📦", glow:"rgba(148,163,184,0.5)" },
  rare:      { name:"Coffre Rare",       col:"#3b82f6", chance:0.27, multi:2.5, e:"🎁", glow:"rgba(59,130,246,0.7)" },
  epic:      { name:"Coffre Épique",     col:"#a855f7", chance:0.13, multi:5,   e:"💎", glow:"rgba(168,85,247,0.8)" },
  legendary: { name:"Coffre Légendaire", col:"#f59e0b", chance:0.05, multi:12,  e:"👑", glow:"rgba(245,158,11,1)" },
};

function rollChestRarity() {
  const r = Math.random();
  let acc = 0;
  for (const [k, v] of Object.entries(CHEST_RARITIES)) {
    acc += v.chance;
    if (r < acc) return k;
  }
  return "common";
}

function generateChestRewards(zoneCount, prestige) {
  const rarityKey = rollChestRarity();
  const rarity = CHEST_RARITIES[rarityKey];
  const scale = 1 + (zoneCount * 0.3) + (prestige * 0.2); // grows with progression
  const m = rarity.multi * scale;

  // Always 2-4 different resources
  const numRewards = 2 + Math.floor(Math.random() * 3);
  const allResources = ["food", "minerals", "energy", "credits", "rare"];
  const shuffled = [...allResources].sort(() => Math.random() - 0.5);
  const chosen = shuffled.slice(0, numRewards);

  const rewards = chosen.map(res => {
    let baseAmount;
    if (res === "rare") baseAmount = 3 + Math.random() * 5;
    else if (res === "credits") baseAmount = 50 + Math.random() * 80;
    else baseAmount = 30 + Math.random() * 50;
    return {
      type: res,
      amount: Math.round(baseAmount * m),
    };
  });

  return { rarityKey, rarity, items: rewards };
}

// ═══════════════════════════════════════ BUILDINGS SYSTEM ═══════════════════
const BUILDINGS = {
  farm:      { name:"Ferme",          e:"🌾", res:"food",    baseProd:2,   upgCost:(lv,p=0)=>({ credits:Math.round((lv*80+40)  *(1+p*0.35)), minerals:Math.round((lv*20)   *(1+p*0.3))  }), col:"#39ff14", maxLv:10 },
  quarry:    { name:"Carrière",       e:"⛏️", res:"minerals",baseProd:1.5, upgCost:(lv,p=0)=>({ credits:Math.round((lv*100+60) *(1+p*0.35)), food:Math.round((lv*30)       *(1+p*0.3))  }), col:"#60a5fa", maxLv:10 },
  generator: { name:"Générateur",    e:"⚡", res:"energy",  baseProd:1,   upgCost:(lv,p=0)=>({ credits:Math.round((lv*120+80) *(1+p*0.35)), minerals:Math.round((lv*40)   *(1+p*0.3))  }), col:"#ffe600", maxLv:10 },
  market:    { name:"Marché",        e:"🪙", res:"credits", baseProd:0.8, upgCost:(lv,p=0)=>({ food:Math.round((lv*50+30)    *(1+p*0.35)), minerals:Math.round((lv*30+20) *(1+p*0.3))  }), col:"#ff8c42", maxLv:10 },
  lab:       { name:"Labo Nucléaire",e:"☢️", res:"rare",    baseProd:0.1, upgCost:(lv,p=0)=>({ credits:Math.round((lv*300+200)*(1+p*0.4)), energy:Math.round((lv*80+50)   *(1+p*0.35)) }), col:"#b347ff", maxLv:5  },
  warehouse: { name:"Entrepôt",      e:"📦", res:"storage", baseProd:0,   upgCost:(lv,p=0)=>({ credits:Math.round((lv*60+30)  *(1+p*0.3)), minerals:Math.round((lv*40+20) *(1+p*0.25)) }), col:"#94a3b8", maxLv:10 },
};

const BASE_STORAGE  = { food:500, minerals:400, energy:300, credits:300, rare:50 };
const STORAGE_BONUS = { food:200, minerals:150, energy:120, credits:120, rare:20 };

function getBuildingProd(type, lv) {
  const b = BUILDINGS[type];
  return b.baseProd * lv * (1 + lv * 0.1);
}

function getStorage(buildingLv) {
  const wLv = buildingLv.warehouse || 0;
  return Object.fromEntries(
    Object.entries(BASE_STORAGE).map(([k,v])=>[k, v + STORAGE_BONUS[k]*wLv])
  );
}

// ═══════════════════════════════════════ MARCH SYSTEM ═══════════════════════
// March duration scales with player territory size + biome difficulty + troops sent
function calcMarchDuration(fromCell, toCell, playerZones=1, prestige=0, troops={}) {
  const dist = Math.max(Math.abs(fromCell.x-toCell.x), Math.abs(fromCell.y-toCell.y));
  const baseTime = 120 + Math.min(playerZones, 20) * 28 + prestige * 45;
  const distMulti = 1 + (dist - 1) * 0.35;

  // Biome difficulty multiplier — nuclear zones much harder to reach
  const biomeMulti = {
    radioactive: 3.0,  // centrale nucléaire = 3× plus long
    mountain:    1.8,
    wasteland:   1.5,
    desert:      1.3,
    city:        1.2,
    forest:      1.0,
    energy_field:1.0,
    jackpot:     1.0,
  }[toCell.biome] || 1.0;

  // More troops = slightly faster (coordination bonus), max -25%
  const totalTroops = (troops.miner||0) + (troops.engineer||0) + (troops.defender||0);
  const troopSpeedBonus = Math.min(0.25, totalTroops * 0.03);

  return Math.round(baseTime * distMulti * biomeMulti * (1 - troopSpeedBonus));
}
export default function WorldDomination() {
  useEffect(() => {
    const s = document.createElement("style");
    s.id = "wd-css";
    s.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@400;500;600;700&display=swap');
      *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
      html, body { overflow-x:hidden; min-height:100vh; }
      body {
        background-color: #02050b;
        background-image:
          radial-gradient(ellipse 90% 60% at 50% -10%, rgba(0,245,212,0.10), transparent 55%),
          radial-gradient(ellipse 80% 50% at 100% 100%, rgba(179,71,255,0.08), transparent 60%),
          radial-gradient(ellipse 60% 40% at 0% 80%, rgba(255,45,120,0.05), transparent 65%),
          linear-gradient(180deg, #060c18 0%, #020509 100%);
        background-attachment: fixed;
      }
      body::before {
        content:''; position:fixed; inset:0; pointer-events:none; z-index:0;
        background-image:
          linear-gradient(rgba(0,245,212,0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,245,212,0.04) 1px, transparent 1px);
        background-size: 36px 36px;
        -webkit-mask-image: radial-gradient(ellipse 75% 65% at 50% 35%, black 0%, transparent 95%);
                mask-image: radial-gradient(ellipse 75% 65% at 50% 35%, black 0%, transparent 95%);
      }
      body::after {
        content:''; position:fixed; inset:0; pointer-events:none; z-index:0;
        background: repeating-linear-gradient(0deg, transparent 0, transparent 3px, rgba(255,255,255,0.014) 3px, rgba(255,255,255,0.014) 4px);
      }
      .wd { font-family:'Rajdhani',sans-serif; color:#dde4f0; min-height:100vh; max-width:480px; margin:0 auto; position:relative; z-index:1; background:transparent; }
      .orb { font-family:'Orbitron',monospace !important; }

      @keyframes pls  { 0%,100%{opacity:1;box-shadow:0 0 8px currentColor} 50%{opacity:.65;box-shadow:0 0 22px currentColor} }
      @keyframes slIn { from{transform:translateX(110%);opacity:0} to{transform:translateX(0);opacity:1} }
      @keyframes jkpt { 0%,100%{box-shadow:0 0 10px #ffd700, inset 0 0 14px rgba(255,215,0,0.25)} 50%{box-shadow:0 0 32px #ffd700, 0 0 60px rgba(255,215,0,0.3), inset 0 0 22px rgba(255,215,0,0.5)} }
      @keyframes rng  { 0%,100%{box-shadow:0 0 6px rgba(239,68,68,0.7), inset 0 0 10px rgba(239,68,68,0.4)} 50%{box-shadow:0 0 24px rgba(239,68,68,0.9), inset 0 0 16px rgba(239,68,68,0.7)} }
      @keyframes plyr { 0%,100%{box-shadow:inset 0 0 14px rgba(0,245,212,0.4), 0 0 8px rgba(0,245,212,0.4)} 50%{box-shadow:inset 0 0 20px rgba(0,245,212,0.65), 0 0 18px rgba(0,245,212,0.55)} }
      @keyframes scnSwp { 0%{transform:translateY(-120%)} 100%{transform:translateY(640%)} }
      @keyframes flick { 0%,93%,100%{opacity:1} 95%{opacity:0.85} 97%{opacity:1} 98%{opacity:0.92} }
      @keyframes drift { 0%,100%{transform:translate(0,0);opacity:0.3} 50%{transform:translate(15px,-25px);opacity:0.7} }

      @keyframes starFall { 0%{transform:translateY(-30px)} 100%{transform:translateY(110vh)} }
      @keyframes streak  { 0%{transform:translateY(-100px);opacity:0} 8%{opacity:0.85} 92%{opacity:0.85} 100%{transform:translateY(110vh);opacity:0} }
      @keyframes shake   { 0%{transform:translate(-50%,0) rotate(-0.6deg)} 50%{transform:translate(calc(-50% + 1px),-1px) rotate(0.5deg)} 100%{transform:translate(calc(-50% - 1px),0px) rotate(-0.4deg)} }
      @keyframes flame   { 0%{opacity:0.85;transform:translateX(-50%) scaleY(0.92) scaleX(0.95)} 100%{opacity:1;transform:translateX(-50%) scaleY(1.08) scaleX(1.05)} }
      @keyframes ttl     { 0%,100%{filter:drop-shadow(0 0 10px #00f5d499)} 50%{filter:drop-shadow(0 0 22px #00f5d4)} }
      @keyframes spark   { 0%{transform:translate(0,0) scale(1);opacity:1} 100%{transform:translate(var(--dx),var(--dy)) scale(0);opacity:0} }

      @keyframes screenShake {
        0%,100%{transform:translate(0,0)}
        10%{transform:translate(-3px,-2px)} 20%{transform:translate(3px,2px)}
        30%{transform:translate(-3px,2px)}  40%{transform:translate(3px,-2px)}
        50%{transform:translate(-2px,-3px)} 60%{transform:translate(2px,3px)}
        70%{transform:translate(-2px,3px)}  80%{transform:translate(2px,-3px)}
        90%{transform:translate(-1px,1px)}
      }
      @keyframes flashRed {
        0%,100%{background:transparent}
        20%{background:rgba(239,68,68,0.4)}
        40%{background:rgba(239,68,68,0.1)}
        60%{background:rgba(255,140,0,0.3)}
      }
      @keyframes flashCy {
        0%,100%{background:transparent}
        30%{background:rgba(0,245,212,0.25)}
        70%{background:rgba(0,245,212,0.1)}
      }
      @keyframes explode {
        0%   {transform:translate(-50%,-50%) scale(0);opacity:1}
        50%  {transform:translate(-50%,-50%) scale(1.4);opacity:1}
        100% {transform:translate(-50%,-50%) scale(2.2);opacity:0}
      }
      @keyframes lightning {
        0%   {opacity:0;transform:translate(-50%,-50%) rotate(var(--rot)) scaleY(0)}
        20%  {opacity:1;transform:translate(-50%,-50%) rotate(var(--rot)) scaleY(1)}
        40%  {opacity:0.9}
        100% {opacity:0;transform:translate(-50%,-50%) rotate(var(--rot)) scaleY(1.1)}
      }
      @keyframes sparkOut {
        0%   {transform:translate(0,0) scale(1);opacity:1}
        100% {transform:translate(var(--dx),var(--dy)) scale(0);opacity:0}
      }
      @keyframes capturePulse {
        0%,100% {box-shadow:0 0 0 0 rgba(0,245,212,0.6)}
        50%     {box-shadow:0 0 0 18px rgba(0,245,212,0)}
      }
      @keyframes ringExpand {
        0%   {transform:translate(-50%,-50%) scale(0.3);opacity:1;border-width:3px}
        100% {transform:translate(-50%,-50%) scale(2.5);opacity:0;border-width:1px}
      }
      .screen-shake { animation: screenShake 0.4s ease-in-out 2; }

      @keyframes lostZoneIn {
        0% { transform: translate(-50%, -50%) scale(0.5) rotate(-8deg); opacity: 0; }
        50% { transform: translate(-50%, -50%) scale(1.05) rotate(2deg); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(1) rotate(0); opacity: 1; }
      }
      @keyframes lostZoneShake {
        0%,100% { transform: translate(-50%, -50%) rotate(0); }
        25% { transform: translate(calc(-50% - 4px), -50%) rotate(-1deg); }
        75% { transform: translate(calc(-50% + 4px), -50%) rotate(1deg); }
      }
      @keyframes redPulse {
        0%,100% { box-shadow: 0 0 30px rgba(239,68,68,0.5), inset 0 0 20px rgba(239,68,68,0.3); }
        50% { box-shadow: 0 0 60px rgba(239,68,68,0.9), inset 0 0 30px rgba(239,68,68,0.5); }
      }
      @keyframes crackIn {
        0% { transform: scale(0); opacity: 0; }
        100% { transform: scale(1); opacity: 0.8; }
      }
      @keyframes chestPopIn {
        0% { transform: translate(-50%, -50%) scale(0.2) rotate(-12deg); opacity: 0; }
        60% { transform: translate(-50%, -50%) scale(1.15) rotate(4deg); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(1) rotate(0); opacity: 1; }
      }
      @keyframes chestBob {
        0%,100% { transform: translateY(0) rotate(-1deg); }
        50% { transform: translateY(-6px) rotate(1deg); }
      }
      @keyframes chestShake {
        0%,100% { transform: translate(-50%,-50%) rotate(-2deg); }
        25% { transform: translate(calc(-50% - 3px),-50%) rotate(2deg); }
        50% { transform: translate(-50%,-50%) rotate(-3deg); }
        75% { transform: translate(calc(-50% + 3px),-50%) rotate(2deg); }
      }
      @keyframes chestOpen {
        0% { transform: translate(-50%,-50%) scale(1); }
        50% { transform: translate(-50%,-50%) scale(1.4); filter: brightness(2); }
        100% { transform: translate(-50%,-50%) scale(1.1); }
      }
      @keyframes lightBurst {
        0% { transform: translate(-50%,-50%) scale(0); opacity: 1; }
        100% { transform: translate(-50%,-50%) scale(3); opacity: 0; }
      }
      @keyframes itemPop {
        0% { transform: scale(0) translateY(20px); opacity: 0; }
        70% { transform: scale(1.2) translateY(-2px); opacity: 1; }
        100% { transform: scale(1) translateY(0); opacity: 1; }
      }
      @keyframes glowBg {
        0%,100% { opacity: 0.6; }
        50% { opacity: 1; }
      }
      @keyframes floatUp {
        0% { transform: translateY(0); opacity: 0; }
        20% { opacity: 1; }
        100% { transform: translateY(-80px); opacity: 0; }
      }
      @keyframes spinSlow {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      @keyframes capturable {
        0%,100% { box-shadow: 0 0 4px rgba(160,120,32,0.3), inset 0 0 6px rgba(160,120,32,0.1); }
        50%     { box-shadow: 0 0 9px rgba(160,120,32,0.55), inset 0 0 10px rgba(160,120,32,0.2); }
      }
      @keyframes flagWave {
        0%,100% { transform: rotate(-3deg); }
        50%     { transform: rotate(3deg); }
      }
      @keyframes flagPlant {
        0%   { transform: translate(-50%, -150%) rotate(40deg); opacity: 0; }
        60%  { transform: translate(-50%, -50%) rotate(-15deg); opacity: 1; }
        80%  { transform: translate(-50%, -50%) rotate(8deg); }
        100% { transform: translate(-50%, -50%) rotate(0); opacity: 1; }
      }
      @keyframes zoneCorrupt {
        0%   { filter: grayscale(0%) brightness(1); }
        100% { filter: grayscale(85%) brightness(0.5); }
      }
      @keyframes adProgress {
        from { width: 0%; }
        to { width: 100%; }
      }
      @keyframes slotSpin {
        0%   { transform: translateY(0); }
        100% { transform: translateY(-100%); }
      }
      @keyframes wheelSpin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(var(--final-rotation)); }
      }
      @keyframes glowWin {
        0%,100% { filter: drop-shadow(0 0 8px gold); }
        50%     { filter: drop-shadow(0 0 24px gold) drop-shadow(0 0 40px gold); }
      }
      @keyframes coinFlip {
        0%   { transform: rotateY(0); }
        100% { transform: rotateY(1800deg); }
      }
      @keyframes shopButtonPulse {
        0%,100% { box-shadow: 0 0 14px rgba(255,215,0,0.4); }
        50%     { box-shadow: 0 0 28px rgba(255,215,0,0.8); }
      }
      @keyframes prestigeRocketLaunch {
        0%   { transform: translateX(-50%) translateY(0) rotate(0deg); opacity:1; }
        15%  { transform: translateX(-50%) translateY(-20px) rotate(-2deg); opacity:1; }
        30%  { transform: translateX(-50%) translateY(-60px) rotate(3deg); opacity:1; }
        55%  { transform: translateX(-50%) translateY(-200px) rotate(-5deg); opacity:0.8; }
        80%  { transform: translateX(-52%) translateY(-500px) rotate(8deg); opacity:0.3; }
        100% { transform: translateX(-48%) translateY(-900px) rotate(-3deg); opacity:0; }
      }
      @keyframes groundShake {
        0%,100% { transform:translateX(0); }
        10% { transform:translateX(-4px); }
        20% { transform:translateX(4px); }
        30% { transform:translateX(-3px); }
        40% { transform:translateX(3px); }
        50% { transform:translateX(-2px); }
        60% { transform:translateX(2px); }
      }
      @keyframes smokeRise {
        0%   { transform:translateX(-50%) translateY(0) scaleX(1); opacity:0.8; }
        100% { transform:translateX(-50%) translateY(-180px) scaleX(3); opacity:0; }
      }
      @keyframes starWarp {
        0%   { transform:translateY(0) scaleY(1); opacity:0.7; }
        100% { transform:translateY(-110vh) scaleY(8); opacity:0; }
      }
      @keyframes proposalSlideUp {
        from { transform:translateY(100%); opacity:0; }
        to   { transform:translateY(0); opacity:1; }
      }
      @keyframes proposalPulse {
        0%,100% { box-shadow: 0 0 20px rgba(179,71,255,0.5), 0 0 60px rgba(179,71,255,0.2); }
        50%     { box-shadow: 0 0 40px rgba(179,71,255,0.9), 0 0 100px rgba(179,71,255,0.4); }
      }
      @keyframes starFloat {
        0%,100% { transform:translateY(0) rotate(0deg); opacity:0.8; }
        50%     { transform:translateY(-8px) rotate(15deg); opacity:1; }
      }
      @keyframes warpLine {
        0%   { transform:scaleY(0) translateY(0); opacity:1; }
        100% { transform:scaleY(12) translateY(-50vh); opacity:0; }
      }
      @keyframes flashWhite {
        0%,100% { opacity:0; }
        40%,60% { opacity:1; }
      }
      @keyframes newMapReveal {
        from { transform:scale(0.85); opacity:0; filter:blur(8px); }
        to   { transform:scale(1);   opacity:1; filter:blur(0); }
      }

      @keyframes raidMarch {
        0%   { transform: translate(var(--startX), var(--startY)) scale(0.8); opacity:0; }
        5%   { opacity:1; }
        90%  { opacity:1; }
        100% { transform: translate(var(--endX), var(--endY)) scale(1.1); opacity:0; }
      }
      @keyframes raidBobWalk {
        0%,100% { transform: translateY(0) scaleX(1); }
        25%     { transform: translateY(-4px) scaleX(0.95); }
        75%     { transform: translateY(-2px) scaleX(1.05); }
      }
      @keyframes raidAlertBlink {
        0%,100% { opacity:1; }
        50%     { opacity:0.4; }
      }
      @keyframes targetPulse {
        0%,100% {
          box-shadow: 0 0 0 0 rgba(239,68,68,0), inset 0 0 0 0 rgba(239,68,68,0);
        }
        50% {
          box-shadow: 0 0 0 6px rgba(239,68,68,0.5), inset 0 0 12px rgba(239,68,68,0.5);
        }
      }
      @keyframes dangerRing {
        0%   { transform:translate(-50%,-50%) scale(0.5); opacity:1; border-width:3px; }
        100% { transform:translate(-50%,-50%) scale(2.5); opacity:0; border-width:1px; }
      }
      @keyframes skullFloat {
        0%,100% { transform:translateY(0) rotate(-5deg); }
        50%     { transform:translateY(-6px) rotate(5deg); }
      }
      @keyframes raidRun {
        0%   { transform: translateX(-120px) scaleX(1); opacity:0; }
        5%   { opacity:1; }
        40%  { transform: translateX(0px) scaleX(1); }
        55%  { transform: translateX(0px) scaleX(1); }
        70%  { transform: translateX(30px) scaleX(-1); }
        95%  { transform: translateX(160px) scaleX(-1); opacity:1; }
        100% { transform: translateX(180px) scaleX(-1); opacity:0; }
      }
      @keyframes bagBounce {
        0%,100% { transform: rotate(-8deg) translateY(0); }
        50%     { transform: rotate(8deg) translateY(-4px); }
      }
      @keyframes troopMarch {
        0%   { transform: translateX(var(--startX)) translateY(var(--startY)); opacity:0; }
        8%   { opacity:1; }
        90%  { opacity:1; }
        100% { transform: translateX(var(--endX)) translateY(var(--endY)); opacity:0; }
      }
      @keyframes swordSlash {
        0%   { transform: rotate(-40deg) scale(0.5); opacity:0; }
        40%  { transform: rotate(20deg) scale(1.3); opacity:1; }
        100% { transform: rotate(60deg) scale(0.7); opacity:0; }
      }
      @keyframes mapBoom {
        0%   { transform:translate(-50%,-50%) scale(0); opacity:1; }
        60%  { transform:translate(-50%,-50%) scale(1.5); opacity:0.8; }
        100% { transform:translate(-50%,-50%) scale(2.5); opacity:0; }
      }

      .pls { animation:pls 2s infinite; }
      .jkp { animation:jkpt 1.4s infinite; }
      .rng { animation:rng 1.1s infinite; }
      .plyr { animation:plyr 2.6s ease-in-out infinite; }
      .nt  { animation:slIn .35s ease; }
      .rip:active { transform:scale(.92); }

      .map-frame {
        position:relative;
        background:
          radial-gradient(ellipse at 50% 50%, rgba(0,245,212,0.04), transparent 70%),
          linear-gradient(135deg, #030710 0%, #060d1c 50%, #030710 100%);
        border:1px solid rgba(0,245,212,0.18);
        border-radius:14px;
        padding:14px 8px 8px;
        overflow:hidden;
        box-shadow: inset 0 0 30px rgba(0,245,212,0.05), 0 4px 30px rgba(0,0,0,0.5);
      }
      .map-frame::before {
        content:''; position:absolute; inset:0; pointer-events:none;
        background: repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(0,245,212,0.02) 2px, rgba(0,245,212,0.02) 3px);
        animation:flick 3s infinite;
      }
      .map-scan {
        position:absolute; left:0; right:0; height:50px; pointer-events:none; z-index:2;
        background:linear-gradient(180deg, transparent 0%, rgba(0,245,212,0.10) 45%, rgba(0,245,212,0.18) 50%, rgba(0,245,212,0.10) 55%, transparent 100%);
        animation:scnSwp 7s linear infinite;
      }
      .map-title {
        position:absolute; top:3px; left:50%; transform:translateX(-50%);
        font-size:8px; color:rgba(0,245,212,0.7); letter-spacing:4px;
        font-family:'Orbitron',monospace; pointer-events:none; z-index:3;
        text-shadow:0 0 8px rgba(0,245,212,0.6);
      }
      .corner-br {
        position:absolute; width:14px; height:14px; pointer-events:none;
        border:1.5px solid rgba(0,245,212,0.6);
      }

      .cell {
        position:relative; transition:transform .15s, border-color .15s, box-shadow .2s;
        overflow:hidden;
      }
      .cell:hover { transform:scale(1.06); z-index:5; }
      .cell-fog {
        background-image:
          repeating-linear-gradient(45deg, transparent 0, transparent 5px, rgba(30,58,95,0.22) 5px, rgba(30,58,95,0.22) 6px),
          linear-gradient(135deg, #060c16 0%, #02050b 100%) !important;
      }
      .cell-top { position:absolute; top:0; left:6%; right:6%; height:1px; background:linear-gradient(90deg, transparent, currentColor 50%, transparent); opacity:0.7; }
      .cell-coord { position:absolute; top:1px; right:3px; font-size:6px; font-family:'Orbitron',monospace; opacity:0.4; letter-spacing:0; line-height:1; }

      ::-webkit-scrollbar { width:3px; height:3px; }
      ::-webkit-scrollbar-thumb { background:#1e3a5f; border-radius:2px; }
      ::-webkit-scrollbar-track { background:transparent; }
    `;
    document.head.appendChild(s);
    return () => document.getElementById("wd-css")?.remove();
  }, []);

  const [res, setRes] = useState({ food:80, minerals:60, energy:20, credits:50, rare:0 });
  const [buildingLv, setBuildingLv] = useState({ farm:1, quarry:1, generator:1, market:1, lab:0, warehouse:1 });
  const [collectCooldown, setCollectCooldown] = useState(60); // seconds until next collect available
  const [pendingRes, setPendingRes] = useState({ food:0, minerals:0, energy:0, credits:0, rare:0 }); // non-collected
  const [marches, setMarches] = useState([]); // [{id, fromCell, toCell, troops, timeLeft, totalTime, type}]
  const [gatherQ, setGatherQ] = useState({}); // cellId -> {timeLeft, totalTime, res, amount}

  // Ad shop state
  const [adShopCooldown, setAdShopCooldown] = useState(0);
  const [adShopAdsWatched, setAdShopAdsWatched] = useState(0);
  const [showAdShop, setShowAdShop] = useState(false);
  const [adSpeedActive, setAdSpeedActive] = useState({}); // marchId -> cooldownLeft (5min)
  const [resourceReminder, setResourceReminder] = useState(120); // reminder every 2 min

  const [cells, setCells] = useState(() => makeMap(Date.now()));
  const [wks, setWks] = useState({ miner:{n:3,lv:1}, engineer:{n:1,lv:1}, defender:{n:1,lv:1} });

  // ── Troupes en déplacement (indisponibles) — calculé après wks
  const troopsInMarches = marches.reduce((acc, m) => ({
    miner:    (acc.miner||0)    + (m.troops.miner||0),
    engineer: (acc.engineer||0) + (m.troops.engineer||0),
    defender: (acc.defender||0) + (m.troops.defender||0),
  }), {miner:0, engineer:0, defender:0});

  // ── Troupes disponibles = total - en marche
  const availableTroops = {
    miner:    Math.max(0, wks.miner.n    - troopsInMarches.miner),
    engineer: Math.max(0, wks.engineer.n - troopsInMarches.engineer),
    defender: Math.max(0, wks.defender.n - troopsInMarches.defender),
  };

  // ── Vulnérabilité de la base selon troupes absentes
  const totalTroops = wks.miner.n + wks.engineer.n + wks.defender.n;
  const troopsAway  = troopsInMarches.miner + troopsInMarches.engineer + troopsInMarches.defender;
  const baseVulnerability = totalTroops > 0 ? troopsAway / totalTroops : 0;

  const [rp, setRp] = useState(0);
  const [prestige, setPrestige] = useState(0);
  const [tech, setTech] = useState([]);
  const [researchQueue, setResearchQueue] = useState(null); // { id, timeLeft, totalTime }
  const [notifs, setNotifs] = useState([]);
  const [selId, setSelId] = useState(null);
  const [tab, setTab] = useState("map");
  const [capProg, setCapProg] = useState({});   // cellId -> 0..100
  const [storm, setStorm] = useState(0);        // seconds left of storm
  const [tick, setTick] = useState(0);
  const [mapSeed] = useState(() => Date.now());
  const [screen, setScreen] = useState("loading"); // loading until profile loaded
  const [profile, setProfile] = useState(null); // { username, ageOk, eulaAccepted, blockedUsers }
  const [incomingRaid, setIncomingRaid] = useState(null); // { cellId, attackers:[], timeLeft, totalTime, enemyName }
  const [combatLog, setCombatLog] = useState(null); // { rounds:[], result, defenderUnits, attackerUnits }
  const [raidNextAt, setRaidNextAt] = useState(Date.now() + 45000);
  const [attackAnim, setAttackAnim] = useState(null); // { cellId, x, y, phase }
  const [lostZoneAnim, setLostZoneAnim] = useState(null); // { cellName, biomeEmoji, biomeName, rarity }
  const [chest, setChest] = useState(null); // { rewards, opened }
  const [chestNextAt, setChestNextAt] = useState(Date.now() + 180000 + Math.random()*120000);
  const [troopAnim, setTroopAnim] = useState(null);
  const [raidRunAnim, setRaidRunAnim] = useState(false);
  const [raidMarchAnim, setRaidMarchAnim] = useState(null); // { targetX, targetY, enemyName, attackers }
  const [prestigeProposal, setPrestigeProposal] = useState(false); // map complète → proposition prestige
  const [rocketLaunch, setRocketLaunch] = useState(false); // animation fusée avant transition

  // Load profile on mount — determines first-launch flow
  useEffect(() => {
    (async () => {
      const raw = await Storage.get("profile");
      if (raw) {
        try {
          const p = JSON.parse(raw);
          if (p.username && p.ageOk && p.eulaAccepted) {
            setProfile(p);
            setScreen("menu");
            return;
          }
        } catch {}
      }
      setScreen("welcome");
    })();
  }, []);

  const saveProfile = useCallback(async (p) => {
    setProfile(p);
    await Storage.set("profile", JSON.stringify(p));
  }, []);

  const blockUser = useCallback(async (username) => {
    const next = { ...profile, blockedUsers: [...(profile?.blockedUsers || []), username] };
    await saveProfile(next);
  }, [profile, saveProfile]);

  const unblockUser = useCallback(async (username) => {
    const next = { ...profile, blockedUsers: (profile?.blockedUsers || []).filter(u => u !== username) };
    await saveProfile(next);
  }, [profile, saveProfile]);

  const deleteAllData = useCallback(async () => {
    await Storage.remove("profile");
    await Storage.remove("reports");
    setProfile(null);
    setScreen("welcome");
  }, []);

  const rRef = useRef(res); const cRef = useRef(cells); const wRef = useRef(wks);
  const tRef = useRef(tech); const pRef = useRef(prestige); const sRef = useRef(storm);
  const pendingRef = useRef(pendingRes);
  useEffect(()=>{ rRef.current=res; },[res]);
  useEffect(()=>{ cRef.current=cells; },[cells]);
  useEffect(()=>{ wRef.current=wks; },[wks]);
  useEffect(()=>{ tRef.current=tech; },[tech]);
  useEffect(()=>{ pRef.current=prestige; },[prestige]);
  useEffect(()=>{ sRef.current=storm; },[storm]);
  useEffect(()=>{ pendingRef.current=pendingRes; },[pendingRes]);

  const notify = useCallback((msg, type="good") => {
    const id = Date.now()+Math.random();
    setNotifs(n => [...n.slice(-4),{id,msg,type}]);
    setTimeout(()=> setNotifs(n=>n.filter(x=>x.id!==id)), 4200);
  }, []);

  // ─── BRIGADE AUTO-BATTLER SIMULATION ───
  const simulateCombat = useCallback((defenderTroops, attackerTroops) => {
    // defenderTroops: { miner: n, engineer: n, defender: n }
    // attackerTroops: { raider: n, marauder: n, warlord: n }
    const def = [];
    const atk = [];
    Object.entries(defenderTroops).forEach(([type, count]) => {
      const u = BRIGADE_UNITS[type];
      for (let i = 0; i < count; i++) def.push({ type, name:u.name, e:u.e, col:u.col, hp:u.hp, maxHp:u.hp, atk:u.atk, side:"def" });
    });
    Object.entries(attackerTroops).forEach(([type, count]) => {
      const u = ENEMY_UNITS[type];
      for (let i = 0; i < count; i++) atk.push({ type, name:u.name, e:u.e, col:u.col, hp:u.hp, maxHp:u.hp, atk:u.atk, side:"atk" });
    });

    const rounds = [];
    const initialDef = def.map(u => ({...u}));
    const initialAtk = atk.map(u => ({...u}));
    let round = 0;
    const maxRounds = 20;

    while (def.some(u=>u.hp>0) && atk.some(u=>u.hp>0) && round < maxRounds) {
      round++;
      const events = [];
      // Defenders attack first
      def.filter(u=>u.hp>0).forEach(d => {
        const targets = atk.filter(u=>u.hp>0);
        if (!targets.length) return;
        const target = targets[Math.floor(Math.random()*targets.length)];
        const dmg = Math.max(1, d.atk + Math.floor(Math.random()*5) - 2);
        target.hp = Math.max(0, target.hp - dmg);
        events.push({ from:d.e, to:target.e, dmg, side:"def", killed:target.hp===0, fromCol:d.col, toCol:target.col });
      });
      // Attackers attack back
      atk.filter(u=>u.hp>0).forEach(a => {
        const targets = def.filter(u=>u.hp>0);
        if (!targets.length) return;
        const target = targets[Math.floor(Math.random()*targets.length)];
        const dmg = Math.max(1, a.atk + Math.floor(Math.random()*5) - 2);
        target.hp = Math.max(0, target.hp - dmg);
        events.push({ from:a.e, to:target.e, dmg, side:"atk", killed:target.hp===0, fromCol:a.col, toCol:target.col });
      });
      rounds.push({
        round, events,
        defState: def.map(u => ({...u})),
        atkState: atk.map(u => ({...u})),
      });
    }

    const defAlive = def.filter(u=>u.hp>0).length;
    const atkAlive = atk.filter(u=>u.hp>0).length;
    const result = defAlive > atkAlive ? "victory" : atkAlive > 0 ? "defeat" : "draw";
    const defLost = def.filter(u=>u.hp===0).length;

    return { rounds, result, defLost, initialDef, initialAtk };
  }, []);

  const bldRef = useRef(buildingLv);
  useEffect(()=>{ bldRef.current=buildingLv; },[buildingLv]);

  const calcProd = useCallback(() => {
    const t = tRef.current; const p = pRef.current; const w = wRef.current;
    const c = cRef.current; const bld = bldRef.current;
    const mB = 1 + w.miner.n * 0.4 * w.miner.lv * (t.includes("robots") ? 2 : 1);
    const presB = 1 + p * 0.20;
    const stB = sRef.current > 0 ? 0.5 : 1;
    const fusB = t.includes("fusion") ? 1.5 : 1;
    const tradeB = t.includes("trade") ? 1.25 : 1;

    // Building production (Whiteout style — main income source)
    const base = { food:0, minerals:0, energy:0, credits:0, rare:0 };
    Object.entries(BUILDINGS).forEach(([type, bld2]) => {
      if (bld2.res === "storage") return;
      const lv = bld[type] || 0;
      if (lv === 0) return;
      const prod = getBuildingProd(type, lv) * presB * stB * fusB;
      if (bld2.res === "food"     && t.includes("tools"))    base.food     += prod * 1.3;
      else if (bld2.res === "minerals" && t.includes("drills"))  base.minerals += prod * 1.4;
      else if (bld2.res === "energy"   && t.includes("solar"))   base.energy   += prod * 1.3;
      else if (bld2.res === "credits"  && t.includes("trade"))   base.credits  += prod * tradeB;
      else base[bld2.res] = (base[bld2.res]||0) + prod;
    });

    // Zone bonuses (secondary income — boosted by miners)
    c.filter(cl=>cl.owner==="player"&&!cl.isBase).forEach(cl=>{
      const bm = BIOMES[cl.biome]; if(!bm||bm.res==="none") return;
      const rb = 1 + bm.bonus;
      const rarityMulti = (RARITIES[cl.rarity]?.multi) || 1;
      const r = 0.18 * rb * mB * presB * stB * fusB * rarityMulti;
      if(bm.res==="all") Object.keys(base).forEach(k=>{ base[k]+= r*0.35; });
      else base[bm.res] = (base[bm.res]||0) + r;
    });
    return base;
  }, []);

  // Game tick
  useEffect(() => {
    const iv = setInterval(() => {
      setTick(t=>t+1);
      const prod = calcProd();
      const storage = getStorage(bldRef.current);

      // Production accumulates every tick but is only collectable every 60s (Whiteout style)
      setPendingRes(prev => {
        const n={...prev};
        Object.entries(prod).forEach(([k,v])=>{
          n[k] = Math.min((n[k]||0)+v, (storage[k]||999)*0.6);
        });
        return n;
      });

      // Collect cooldown — ticks down each second
      setCollectCooldown(prev => Math.max(0, prev - 1));

      // Enforce storage cap on actual resources
      setRes(prev => {
        const n={...prev};
        Object.keys(n).forEach(k=>{ n[k]=Math.min(n[k], storage[k]||999); });
        return n;
      });

      setStorm(s => Math.max(0, s-1));

      // ─── AD SHOP COOLDOWN ───
      setAdShopCooldown(v => Math.max(0, v-1));

      // ─── SPEED BOOST COOLDOWNS per march ───
      setAdSpeedActive(prev => {
        const next = {...prev};
        Object.keys(next).forEach(k => { next[k] = Math.max(0, next[k]-1); });
        return next;
      });

      // ─── RESOURCE REMINDER ───
      setResourceReminder(prev => {
        if (prev <= 1) {
          const pending = pendingRef.current;
          const total = Object.values(pending).reduce((s,v)=>s+v,0);
          if (total > 5) {
            notify(`📦 N'oublie pas de récupérer tes ressources ! (+${Math.round(total)} en attente)`, "info");
          }
          return 120;
        }
        return prev - 1;
      });

      // ─── RESEARCH TIMER ───
      setResearchQueue(prev => {
        if (!prev) return null;
        const t = prev.timeLeft - 1;
        if (t <= 0) {
          const techDef = TECHS.find(x=>x.id===prev.id);
          setTech(arr => [...arr, prev.id]);
          notify(`✅ ${techDef?.name || "Technologie"} recherchée avec succès !`, "good");
          return null;
        }
        return { ...prev, timeLeft: t };
      });

      // ─── MARCH TIMERS ───
      setMarches(prev => {
        if (!prev.length) return prev;
        const done = [];
        const next = prev.map(m => {
          const t = m.timeLeft - 1;
          if (t <= 0) { done.push(m); return null; }
          return { ...m, timeLeft: t };
        }).filter(Boolean);
        done.forEach(m => {
          if (m.type === "attack") {
            const cell = cRef.current.find(c=>c.id===m.toCell.id);
            if (cell?.owner !== "player") {
              const bm = BIOMES[cell?.biome]; const rarity = RARITIES[cell?.rarity]?.multi||1;
              const defPow = (bm?.diff||1)*50 + (cell?.defLv||1)*25 * Math.sqrt(rarity);
              const atkPow = (m.troops.total||1)*10*(1+m.troops.defender*0.5);
              const win = Math.random() < Math.min(0.85, atkPow/(atkPow+defPow));
              if(win) {
                setCells(cs=>cs.map(c=>c.id===m.toCell.id?{...c,owner:"player",fog:false}:c));
                setCells(cs=>cs.map(c=>adj(c.x,c.y,m.toCell.x,m.toCell.y)&&c.fog?{...c,fog:false}:c));
                setRp(r=>r+20);
                notify(`⚔️ Troupes victorieuses! Zone ${String.fromCharCode(65+m.toCell.x)}${m.toCell.y+1} conquise!`, "good");
              } else {
                notify(`💀 Troupes défaites! ${m.toCell.enemyName||"L'ennemi"} résiste.`, "bad");
              }
            }
          } else if (m.type === "gather") {
            const cell = cRef.current.find(c=>c.id===m.toCell.id);
            const bm = BIOMES[cell?.biome]; if(!bm) return;
            const amount = Math.round((m.troops.miner||1) * 80 * (RARITIES[cell?.rarity]?.multi||1));
            const resKey = bm.res==="all"?"credits":bm.res;
            if(resKey!=="none") {
              setRes(r=>({...r,[resKey]:Math.min((r[resKey]||0)+amount, storage[resKey]||999)}));
              notify(`✅ Récolte terminée! +${amount} ${RES_CFG[resKey]?.e||"📦"}`, "good");
            }
          }
        });
        return next;
      });

      // ─── GATHER TIMERS ───
      setGatherQ(prev => {
        if (!Object.keys(prev).length) return prev;
        const next={...prev};
        Object.entries(next).forEach(([id,g])=>{
          next[id]={...g, timeLeft: g.timeLeft-1};
          if(next[id].timeLeft<=0) delete next[id];
        });
        return next;
      });
      setCapProg(prev => {
        if(!Object.keys(prev).length) return prev;
        const next={...prev}; const done=[];
        Object.entries(next).forEach(([id,p])=>{ next[id]=Math.min(100,p+4); if(next[id]>=100) done.push(+id); });
        if(done.length) {
          done.forEach(id => {
            delete next[id];
            setCells(cs=>cs.map(c=>{
              if(c.id===id) return {...c,owner:"player",fog:false};
              if(adj(c.x,c.y,cRef.current.find(x=>x.id===id)?.x??-9,cRef.current.find(x=>x.id===id)?.y??-9)) return{...c,fog:false};
              return c;
            }));
            setRp(r=>r+10);
            notify("✅ Zone capturée! +10 RP", "good");
          });
        }
        return next;
      });

      // ─── INCOMING RAID COUNTDOWN ───
      setIncomingRaid(prev => {
        if (!prev) return null;
        const newTime = prev.timeLeft - 1;
        if (newTime <= 0) {
          // Auto-resolve as defeat if player did nothing
          const lostCell = cRef.current.find(c => c.id === prev.cellId);
          setCells(cs => cs.map(c => c.id === prev.cellId
            ? { ...c, owner: "enemy", defLv: Math.max(1, c.defLv - 1) }
            : c));
          setRp(r => Math.max(0, r - 15));
          notify(`💀 Raid réussi! Zone perdue... -15 RP`, "bad");
          setRaidMarchAnim(null);
          // Animation pillard qui part avec le butin
          setRaidRunAnim(true);
          setTimeout(() => setRaidRunAnim(false), 4500);
          // Show lost zone animation
          if (lostCell) {
            const bm = BIOMES[lostCell.biome];
            setLostZoneAnim({
              cellName: `${String.fromCharCode(65+lostCell.x)}${lostCell.y+1}`,
              biomeEmoji: bm.e,
              biomeName: bm.name,
              rarity: lostCell.rarity,
              reason: "raid",
            });
          }
          return null;
        }
        return { ...prev, timeLeft: newTime };
      });

      // ─── TRIGGER NEW RAID ───
      const playerOwnedNonBase = cRef.current.filter(c => c.owner === "player" && !c.isBase);
      if (Date.now() >= raidNextAt && playerOwnedNonBase.length >= 2 && !incomingRaid) {
        const target = playerOwnedNonBase[Math.floor(Math.random() * playerOwnedNonBase.length)];
        const raritytier = RARITIES[target.rarity]?.multi || 1;
        // Raid scales with player size AND base vulnerability (troops away = easier raid)
        const baseEnemies = Math.max(1, Math.floor(playerOwnedNonBase.length / 2));
        const vulnBonus = Math.round(baseVulnerability * 3); // up to +3 attackers when base is empty
        const attackers = {
          raider:   baseEnemies + Math.floor(Math.random()*2) + vulnBonus,
          marauder: Math.floor(baseEnemies / 2) + (raritytier >= 4 ? 1 : 0) + Math.floor(vulnBonus/2),
          warlord:  raritytier >= 4 ? 1 : 0,
        };
        setIncomingRaid({
          cellId: target.id,
          cellName: `${String.fromCharCode(65+target.x)}${target.y+1}`,
          attackers,
          timeLeft: RAID_WARNING_TIME,
          totalTime: RAID_WARNING_TIME,
          enemyName: ENEMY_NAMES[Math.floor(Math.random()*ENEMY_NAMES.length)],
        });
        // Lance l'animation des pillards qui marchent vers la zone
        setRaidMarchAnim({ targetX: target.x, targetY: target.y, enemyName: ENEMY_NAMES[Math.floor(Math.random()*ENEMY_NAMES.length)], attackers });
        notify(`⚠️ RAID INCOMING! Zone ${String.fromCharCode(65+target.x)}${target.y+1} sous attaque!`, "bad");
        setRaidNextAt(Date.now() + (RAID_INTERVAL_MIN + Math.random()*(RAID_INTERVAL_MAX-RAID_INTERVAL_MIN))*1000);
      }

      // ─── SPAWN MAGIC CHEST ───
      if (Date.now() >= chestNextAt && !chest) {
        const rewards = generateChestRewards(playerOwnedNonBase.length, prestige);
        setChest({ rewards, opened: false });
        setChestNextAt(Date.now() + (180 + Math.random()*120)*1000); // 3min - 5min
        notify(`🎁 Un coffre magique est apparu!`, "jackpot");
      }

      // ─── PRESTIGE PROPOSAL ─── when map fully revealed + 70% owned
      const allC = cRef.current;
      const totalNB = allC.filter(c=>!c.isBase).length;
      const revNB   = allC.filter(c=>!c.isBase&&!c.fog).length;
      const ownedNB = allC.filter(c=>c.owner==="player"&&!c.isBase).length;
      if (revNB >= totalNB && ownedNB >= Math.floor(totalNB*0.7)) {
        setPrestigeProposal(prev => prev ? prev : "ready");
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [calcProd, notify, raidNextAt, incomingRaid, chestNextAt, chest, prestige]);

  // Random events every ~35s
  useEffect(() => {
    const iv = setInterval(() => {
      const ev = EVENTS_POOL[Math.floor(Math.random()*EVENTS_POOL.length)];
      notify(ev.msg, ev.type);
      if(ev.eff==="storm")      setStorm(20);
      else if(ev.eff==="steal") setRes(p=>({...p,food:Math.max(0,p.food-40),minerals:Math.max(0,p.minerals-25)}));
      else if(ev.eff==="bonus_res") setRes(p=>({...p,food:p.food+60,minerals:p.minerals+40}));
      else if(ev.eff==="bonus_cred") setRes(p=>({...p,credits:p.credits+200}));
      else if(ev.eff==="bonus_work") setWks(w=>({...w,miner:{...w.miner,n:w.miner.n+2}}));
      else if(ev.eff==="jackpot") {
        setCells(cs=>{
          // Uniquement sur zones neutres non-fog, jamais sur zones joueur
          const candidates = cs.filter(c=>c.owner==="neutral"&&!c.fog&&c.biome!=="jackpot"&&!c.isBase);
          if(!candidates.length) return cs;
          const t = candidates[Math.floor(Math.random()*candidates.length)];
          return cs.map(c=>c.id===t.id?{...c,biome:"jackpot"}:c);
        });
      }
    }, 35000);
    return () => clearInterval(iv);
  }, [notify]);

  const playerCells = cells.filter(c=>c.owner==="player");
  const prod = calcProd();
  const league = getLeague(rp);
  const nextLeague = LEAGUES[LEAGUES.indexOf(league)+1]||null;
  const selCell = selId !== null ? cells.find(c=>c.id===selId) : null;
  const totalWorkers = Object.values(wks).reduce((s,w)=>s+w.n,0);

  const collectAll = () => {
    if (collectCooldown > 0) {
      notify(`⏳ Collecte disponible dans ${collectCooldown}s`, "bad");
      return;
    }
    const storage = getStorage(buildingLv);
    // Collect only 25-35% of pending at a time — forces multiple taps over time
    const ratio = 0.28 + Math.random() * 0.07;
    let total = 0;
    setRes(prev => {
      const n={...prev};
      Object.entries(pendingRes).forEach(([k,v])=>{
        const amt = Math.floor(v * ratio);
        n[k] = Math.min((n[k]||0)+amt, storage[k]||999);
        total += amt;
      });
      return n;
    });
    setPendingRes(prev => {
      const n={...prev};
      Object.keys(n).forEach(k=>{ n[k] = Math.max(0, n[k] - Math.floor((pendingRes[k]||0)*ratio)); });
      return n;
    });
    if(total > 0) notify(`📦 +${Math.round(total)} ressources collectées`, "good");
    setCollectCooldown(60); // reset 60s cooldown
  };

  const upgradeBuilding = (type) => {
    const b = BUILDINGS[type]; const lv = buildingLv[type]||0;
    if(lv >= b.maxLv) return notify("Niveau maximum atteint !", "bad");
    const cost = b.upgCost(lv+1, prestige);
    if(!afford(res, cost)) return notify("Ressources insuffisantes !", "bad");
    setRes(p=>{ const n={...p}; Object.entries(cost).forEach(([k,v])=>n[k]-=v); return n; });
    setBuildingLv(prev=>({...prev,[type]:(prev[type]||0)+1}));
    notify(`🏗️ ${b.name} → Niv.${lv+1} !`, "good");
  };

  const sendMarch = (toCell, troops, type="attack") => {
    const baseCell = cells.find(c=>c.isBase);
    if(!baseCell) return;
    const pZones = cells.filter(c=>c.owner==="player"&&!c.isBase).length;
    const duration = calcMarchDuration(baseCell, toCell, pZones, prestige, troops);
    const id = `march_${Date.now()}`;
    const mins = Math.floor(duration/60);
    const secs = duration%60;
    const durStr = mins>0?`${mins}m${secs>0?` ${secs}s`:""}`:`${secs}s`;
    setMarches(prev=>[...prev, {
      id, fromCell:baseCell, toCell, troops,
      timeLeft:duration, totalTime:duration, type,
      startedAt: Date.now(),
    }]);
    if(type==="attack") notify(`⚔️ Troupes en marche → ${String.fromCharCode(65+toCell.x)}${toCell.y+1} — ${durStr}`, "info");
    else notify(`⛏️ Récolte → ${String.fromCharCode(65+toCell.x)}${toCell.y+1} — ${durStr}`, "info");
  };

  const recallMarch = (id) => {
    setMarches(prev=>prev.filter(m=>m.id!==id));
    notify("🔙 Troupes rappelées", "info");
  };

  const captureZone = (cell, customTroops=null) => {
    // Adjacence cardinale uniquement
    const isAdj = playerCells.some(pc =>
      (Math.abs(pc.x - cell.x) === 1 && pc.y === cell.y) ||
      (Math.abs(pc.y - cell.y) === 1 && pc.x === cell.x)
    );
    if(!isAdj) return notify("Zone non adjacente à votre territoire!", "bad");
    const bm = BIOMES[cell.biome];
    const rarityMulti = (RARITIES[cell.rarity]?.multi) || 1;
    const troops = customTroops || { miner:availableTroops.miner, engineer:availableTroops.engineer, defender:availableTroops.defender, total:availableTroops.miner+availableTroops.engineer+availableTroops.defender };
    if((troops.total||0) === 0) return notify("Toutes tes troupes sont déjà en mission !", "bad");

    if(cell.owner==="enemy" || cell.owner==="neutral" || cell.owner==="contested") {
      const cost = cell.owner==="enemy"
        ? { credits: Math.round((bm.diff*60+50)*(1+(rarityMulti-1)*0.5)), minerals: Math.round((bm.diff*30+10)*(1+(rarityMulti-1)*0.5)), food: Math.round(bm.diff*20+10) }
        : { food: Math.round((bm.diff*40+10)*(1+(rarityMulti-1)*0.4)), minerals: Math.round((bm.diff*20+5)*(1+(rarityMulti-1)*0.4)) };
      if(!afford(res, cost)) return notify("Ressources insuffisantes!", "bad");
      setRes(p=>{ const n={...p}; Object.entries(cost).forEach(([k,v])=>n[k]-=v); return n; });

      // Launch march — Whiteout style
      sendMarch(cell, troops, "attack");

      // Visual animation at the same time
      setAttackAnim({ cellId:cell.id, x:cell.x, y:cell.y, phase:"attack", win:true });
      const baseCell = cRef.current.find(c=>c.isBase);
      setTroopAnim({ fromCell:baseCell, toCell:cell, win:true });
      setTimeout(()=>setTroopAnim(null), 2400);
      setTimeout(()=>setAttackAnim(null), 2200);
      setSelId(null);
    }
  };

  const researchTech = (tid) => {
    const t = TECHS.find(x=>x.id===tid);
    if(!t || tech.includes(tid)) return;
    if(researchQueue) return notify("Une recherche est déjà en cours !", "bad");
    if(!t.req.every(r=>tech.includes(r))) return notify("Prérequis non satisfaits !", "bad");
    const cost = t.cost(prestige);
    if(!afford(res, cost)) return notify("Ressources insuffisantes !", "bad");
    setRes(p=>{ const n={...p}; Object.entries(cost).forEach(([k,v])=>n[k]-=v); return n; });
    const duration = t.researchTime(prestige);
    setResearchQueue({ id:tid, timeLeft:duration, totalTime:duration });
    notify(`🔬 Recherche lancée : ${t.name} (${duration}s)`, "good");
  };

  const recruitWorker = (type) => {
    const cost = { credits:80, food:40 };
    if(!afford(res,cost)) return notify("Ressources insuffisantes!","bad");
    setRes(p=>{ const n={...p}; Object.entries(cost).forEach(([k,v])=>n[k]-=v); return n; });
    setWks(w=>({...w,[type]:{...w[type],n:w[type].n+1}}));
    notify(`👤 ${WORKER_CFG[type].name} recruté!`);
  };

  const upgradeWorker = (type) => {
    const w = wks[type]; if(w.lv>=5) return notify("Niveau maximum!","bad");
    const cost = { credits:w.lv*100, rare:w.lv*5 };
    if(!afford(res,cost)) return notify("Ressources insuffisantes!","bad");
    setRes(p=>{ const n={...p}; Object.entries(cost).forEach(([k,v])=>n[k]-=v); return n; });
    setWks(w2=>({...w2,[type]:{...w2[type],lv:w2[type].lv+1}}));
    notify(`⬆️ ${WORKER_CFG[type].name} → Niv.${w.lv+1}!`);
  };

  const defendRaid = (defenderUnits) => {
    if (!incomingRaid) return;
    const result = simulateCombat(defenderUnits, incomingRaid.attackers);
    setCombatLog({
      ...result,
      cellName: incomingRaid.cellName,
      cellId: incomingRaid.cellId,
      enemyName: incomingRaid.enemyName,
    });
    setIncomingRaid(null);
    setRaidMarchAnim(null);
  };

  const finishCombat = () => {
    if (!combatLog) return;
    if (combatLog.result === "victory") {
      setRp(r => r + 25);
      notify(`🏆 VICTOIRE! Raid repoussé! +25 RP`, "good");
    } else if (combatLog.result === "draw") {
      notify(`⚖️ Match nul! Zone conservée.`, "info");
    } else {
      const lostCell = cRef.current.find(c => c.id === combatLog.cellId);
      setCells(cs => cs.map(c => c.id === combatLog.cellId
        ? { ...c, owner: "enemy", defLv: Math.max(1, c.defLv - 1) }
        : c));
      setRp(r => Math.max(0, r - 15));
      notify(`💀 DÉFAITE! Zone perdue! -15 RP`, "bad");
      // Animation pillard qui part avec le butin
      setRaidRunAnim(true);
      setTimeout(() => setRaidRunAnim(false), 4500);
      // Show lost zone animation
      if (lostCell) {
        const bm = BIOMES[lostCell.biome];
        setLostZoneAnim({
          cellName: combatLog.cellName,
          biomeEmoji: bm.e,
          biomeName: bm.name,
          rarity: lostCell.rarity,
          reason: "combat",
        });
      }
    }
    // Lose units
    if (combatLog.defLost > 0) {
      setWks(w => {
        const newW = {...w};
        // Lose units proportionally to losses
        let lost = combatLog.defLost;
        const keys = Object.keys(newW);
        while (lost > 0) {
          const k = keys[Math.floor(Math.random()*keys.length)];
          if (newW[k].n > 0) {
            newW[k] = {...newW[k], n: newW[k].n - 1};
            lost--;
          } else if (keys.every(k => newW[k].n === 0)) break;
        }
        return newW;
      });
    }
    setCombatLog(null);
  };

  const openChest = () => {
    if (!chest || chest.opened) return;
    setChest(c => ({ ...c, opened: true }));
  };

  const claimChest = () => {
    if (!chest || !chest.opened) return;
    setRes(prev => {
      const n = { ...prev };
      chest.rewards.items.forEach(r => {
        n[r.type] = (n[r.type] || 0) + r.amount;
      });
      return n;
    });
    notify(`✨ ${chest.rewards.rarity.name} récupéré!`, "good");
    setChest(null);
  };

  const openAdShop = () => setShowAdShop(true);

  const watchAdForShop = () => {
    if (adShopCooldown > 0) return notify(`Boutique disponible dans ${Math.ceil(adShopCooldown/60)}min`, "bad");
    const next = adShopAdsWatched + 1;
    if (next >= 2) {
      // 2 pubs regardées → 1 coffre magique
      const pZones = cells.filter(c=>c.owner==="player"&&!c.isBase).length;
      const rewards = generateChestRewards(pZones, prestige);
      setChest({ rewards, opened: false });
      setAdShopAdsWatched(0);
      setAdShopCooldown(900); // 15 min cooldown
      setShowAdShop(false);
      notify("🎁 Coffre magique obtenu ! (2 pubs regardées)", "jackpot");
    } else {
      setAdShopAdsWatched(next);
      notify(`📺 Pub ${next}/2 regardée ! Encore 1 pour obtenir le coffre.`, "good");
    }
  };

  const watchAdSpeedBoost = (marchId) => {
    if ((adSpeedActive[marchId]||0) > 0) return notify(`Disponible dans ${Math.ceil(adSpeedActive[marchId]/60)}min`, "bad");
    setMarches(prev => prev.map(m => m.id===marchId ? {...m, timeLeft: Math.max(10, m.timeLeft-60)} : m));
    setAdSpeedActive(prev => ({...prev, [marchId]: 300})); // 5 min cooldown per march
    notify("⚡ -1 minute retirée de l'attaque !", "good");
  };

  const dismissLostZone = () => setLostZoneAnim(null);

  const doPrestige = () => {
    const totalNonBase = cells.filter(c => !c.isBase).length;
    const revealedNonBase = cells.filter(c => !c.isBase && !c.fog);
    const ownedNonBase = playerCells.filter(c => !c.isBase);
    if (revealedNonBase.length < totalNonBase) {
      return notify("Débloquez toute la map d'abord !","bad");
    }
    if (ownedNonBase.length < Math.floor(totalNonBase * 0.7)) {
      return notify(`Capturez au moins ${Math.floor(totalNonBase * 0.7)} zones !`,"bad");
    }
    // Lance l'animation fusée, puis applique le prestige après 4.5s
    setPrestigeProposal(false);
    setRocketLaunch(true);
    setTimeout(() => {
      const newP = prestige+1;
      setPrestige(newP);
      setRes({ food:150+newP*50, minerals:120+newP*40, energy:60+newP*20, credits:100+newP*30, rare:newP*3 });
      setCells(makeMap(Date.now(), newP));
      setWks({ miner:{n:4+newP,lv:1}, engineer:{n:2+newP,lv:1}, defender:{n:2+newP,lv:1} });
      setTech([]); setCapProg({}); setStorm(0); setIncomingRaid(null);
      setRocketLaunch(false);
      setPrestigeProposal(false);
      notify(`⭐ PRESTIGE ${newP}! +${newP*20}% prod · +${newP*15}% combat permanent!`,"good");
    }, 4500);
  };

  // Styles
  const C = { bg:"#040810", card:"#0b1424", brd:"#1a3050", cy:"#00f5d4", pk:"#ff2d78", ye:"#ffe600", pu:"#b347ff" };

  // Screen routing — onboarding & legal screens before the game
  if (screen === "loading")     return <LoadingScreen C={C}/>;
  if (screen === "welcome")     return <WelcomeFlow onComplete={async (p) => { await saveProfile(p); setScreen("menu"); }} C={C}/>;
  if (screen === "menu")        return <MainMenu setScreen={setScreen} profile={profile} C={C}/>;
  if (screen === "suggestions") return <SuggestionsScreen onBack={() => setScreen("menu")} profile={profile} blockUser={blockUser} C={C}/>;
  if (screen === "rank-menu")   return <RankMenuScreen onBack={() => setScreen("menu")} profile={profile} C={C}/>;
  if (screen === "settings")    return <SettingsScreen setScreen={setScreen} profile={profile} saveProfile={saveProfile} deleteAllData={deleteAllData} C={C}/>;
  if (screen === "privacy")     return <PrivacyPolicyScreen onBack={() => setScreen("settings")} C={C}/>;
  if (screen === "terms")       return <TermsScreen onBack={() => setScreen("settings")} C={C}/>;
  if (screen === "blocked")     return <BlockedUsersScreen onBack={() => setScreen("settings")} profile={profile} unblockUser={unblockUser} C={C}/>;
  if (screen === "support")     return <SupportScreen onBack={() => setScreen("settings")} C={C}/>;
  const St = {
    hdr:  { background:"linear-gradient(180deg,#0a1828,#040810)", borderBottom:`1px solid ${C.brd}`, padding:"10px 14px", position:"sticky", top:0, zIndex:50 },
    rbar: { display:"flex", gap:5, padding:"7px 10px", background:"#070f1c", borderBottom:`1px solid ${C.brd}`, overflowX:"auto", flexWrap:"nowrap" },
    chip: (col) => ({ background:`${col}28`, border:`1.5px solid ${col}99`, borderRadius:20, padding:"4px 10px", fontSize:12, color:"#ffffff", display:"flex", alignItems:"center", gap:4, flexShrink:0, boxShadow:`0 0 6px ${col}44` }),
    tabs: { display:"flex", position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, background:"#070f1c", borderTop:`1px solid ${C.brd}`, zIndex:60 },
    tab:  (a) => ({ flex:1, padding:"7px 0 5px", textAlign:"center", cursor:"pointer", color:a?C.cy:"#445", borderTop:a?`2px solid ${C.cy}`:"2px solid transparent", transition:"all .2s", fontSize:8 }),
    wrap: { padding:"10px 12px", paddingBottom:70 },
    card: { background:C.card, border:`1px solid ${C.brd}`, borderRadius:12, padding:13, marginBottom:11 },
    btn:  (col,sm) => ({ background:`linear-gradient(135deg,${col}20,${col}45)`, border:`1px solid ${col}88`, color:col, borderRadius:8, padding:sm?"5px 11px":"9px 16px", cursor:"pointer", fontSize:sm?11:13, fontFamily:"'Rajdhani',sans-serif", fontWeight:600, letterSpacing:.4, transition:"all .15s", display:"inline-flex", alignItems:"center", justifyContent:"center" }),
    modal:{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, background:"#0b1424", borderTop:`2px solid ${C.cy}`, borderRadius:"18px 18px 0 0", padding:18, zIndex:80, maxHeight:"65vh", overflowY:"auto" },
    ovl:  { position:"fixed", inset:0, background:"#000000bb", zIndex:79 },
    notB: { position:"fixed", top:12, right:12, zIndex:200, display:"flex", flexDirection:"column", gap:5, maxWidth:235 },
    notif:(t) => ({ background:t==="bad"?"#140506":t==="jackpot"?"#1a1400":t==="good"?"#051408":"#060d18", border:`1px solid ${t==="bad"?"#ef4444":t==="jackpot"?"#ffd700":t==="good"?"#4ade80":C.cy}44`, borderRadius:8, padding:"7px 10px", fontSize:11, color:"#dde4f0", boxShadow:"0 4px 18px #00000055" }),
  };

  return (
    <div className={`wd${attackAnim?" screen-shake":""}`}>
      {/* Full-screen flash effect during attack */}
      {attackAnim && (
        <div style={{
          position:"fixed", inset:0, pointerEvents:"none", zIndex:150,
          animation: attackAnim.phase==="attack"
            ? (attackAnim.win ? "flashCy 0.6s ease-out 2" : "flashRed 0.6s ease-out 2")
            : "flashCy 0.6s ease-out 1",
        }}/>
      )}
      {/* Attack animation overlay */}
      {attackAnim && (
        <AttackAnimation anim={attackAnim} C={C}/>
      )}

      {/* Notifications */}
      <div style={St.notB}>
        {notifs.map(n=>(
          <div key={n.id} className="nt" style={St.notif(n.type)}>{n.msg}</div>
        ))}
      </div>

      {selId!==null && <div style={St.ovl} onClick={()=>setSelId(null)}/>}

      {/* Header */}
      <div style={St.hdr}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button onClick={() => setScreen("menu")} className="rip" style={{
              background:"#0d1828", border:`1px solid ${C.brd}`, borderRadius:8,
              width:32, height:32, color:C.cy, fontSize:16, cursor:"pointer", flexShrink:0,
            }}>☰</button>
            <div>
              <div className="orb" style={{fontSize:13,color:C.cy,letterSpacing:2,textShadow:`0 0 18px ${C.cy}66`}}>🌍 WORLD DOMINATION</div>
              <div style={{fontSize:10,color:"#445",marginTop:1}}>
                S1 · {playerCells.length} zones {storm>0?`· ⛈️ ${storm}s`:""} {prestige>0?`· ⭐×${prestige}`:""}
              </div>
            </div>
          </div>
          <div style={{textAlign:"right", display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4}}>
            <div className="orb" style={{fontSize:12,color:league.col}}>{league.e} {league.name}</div>
            <button onClick={openAdShop} className="rip" style={{
              background: adShopCooldown===0 ? "linear-gradient(135deg,#fbbf2422,#fbbf2455)" : "#0d1828",
              border:`1px solid ${adShopCooldown===0?"#fbbf24":"#334155"}`,
              borderRadius:8, padding:"3px 8px",
              color: adShopCooldown===0?"#fbbf24":"#475569",
              fontSize:10, cursor:"pointer",
              fontFamily:"'Rajdhani',sans-serif", fontWeight:700,
              animation: adShopCooldown===0?"pls 2s infinite":"none",
            }}>
              🛍️ {adShopCooldown===0 ? "BOUTIQUE" : `${Math.ceil(adShopCooldown/60)}min`}
            </button>
          </div>
        </div>
      </div>

      {/* Resources */}
      <div style={St.rbar}>
        {Object.entries(RES_CFG).map(([k,r])=>{
          const storage = getStorage(buildingLv);
          const pct = Math.min(100, ((res[k]||0)/(storage[k]||999))*100);
          return (
            <div key={k} style={{...St.chip(r.col), flexDirection:"column", padding:"3px 8px", gap:1}}>
              <div style={{display:"flex", alignItems:"center", gap:4}}>
                <span style={{fontSize:13}}>{r.e}</span>
                <span className="orb" style={{fontSize:11, color:"#fff", fontWeight:700}}>{fmt(res[k]||0)}</span>
                {prod[k]>0 && <span style={{color:r.col, fontSize:9}}>+{prod[k].toFixed(1)}</span>}
              </div>
              {/* Storage bar */}
              <div style={{width:"100%", height:2, background:`${r.col}22`, borderRadius:1}}>
                <div style={{width:`${pct}%`, height:"100%", background:r.col, borderRadius:1, transition:"width 1s"}}/>
              </div>
            </div>
          );
        })}
        {/* Collect button — with cooldown timer */}
        {Object.values(pendingRes).some(v=>v>0.5) && (
          <button onClick={collectAll} className="rip" style={{
            flexShrink:0,
            background: collectCooldown===0
              ? "linear-gradient(135deg,#4ade8033,#4ade8088)"
              : "linear-gradient(135deg,#1e3a5f,#0d1828)",
            border: collectCooldown===0 ? "1.5px solid #4ade80" : "1px solid #445",
            borderRadius:16, padding:"3px 10px",
            color: collectCooldown===0 ? "#fff" : "#64748b",
            fontSize:10, cursor: collectCooldown===0 ? "pointer":"default",
            fontFamily:"'Rajdhani',sans-serif", fontWeight:700,
            boxShadow: collectCooldown===0 ? "0 0 12px rgba(74,222,128,0.6)" : "none",
            animation: collectCooldown===0 ? "pls 1.5s infinite" : "none",
            display:"flex", alignItems:"center", gap:4, transition:"all .3s",
          }}>
            <span>📦</span>
            <span>{collectCooldown===0 ? "COLLECTER" : `${collectCooldown}s`}</span>
          </button>
        )}
        {/* Active march badge */}
        {marches.length > 0 && (
          <div style={{...St.chip("#ffe600"), flexShrink:0, animation:"pls 1.5s infinite"}}>
            ⚔️ {marches.length} marche{marches.length>1?"s":""}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={St.wrap}>
        {tab==="map"     && <MapTab     cells={cells} capProg={capProg} selId={selId} setSelId={setSelId} marches={marches} recallMarch={recallMarch} sendMarch={sendMarch} wks={wks} storm={storm} adSpeedActive={adSpeedActive} onSpeedBoost={watchAdSpeedBoost} St={St} C={C}/>}
        {tab==="base"    && <BaseTab    res={res} cells={cells} playerCells={playerCells} prod={prod} prestige={prestige} tech={tech} researchTech={researchTech} researchQueue={researchQueue} doPrestige={doPrestige} buildingLv={buildingLv} upgradeBuilding={upgradeBuilding} pendingRes={pendingRes} collectAll={collectAll} storage={getStorage(buildingLv)} collectCooldown={collectCooldown} St={St} C={C}/>}
        {tab==="workers" && <WorkersTab wks={wks} res={res} recruitWorker={recruitWorker} upgradeWorker={upgradeWorker} totalWorkers={totalWorkers} St={St} C={C}/>}
        {tab==="casino"  && <CasinoTab  res={res} setRes={setRes} notify={notify} St={St} C={C}/>}
        {tab==="rank"    && <RankTab    rp={rp} league={league} nextLeague={nextLeague} playerCells={playerCells} prod={prod} tech={tech} St={St} C={C}/>}
      </div>

      {/* Cell modal */}
      {selCell && (
        <div style={St.modal}>
          <CellModal cell={selCell} cells={cells} capProg={capProg} res={res} captureZone={captureZone} setSelId={setSelId} St={St} C={C} wks={wks} totalWorkers={totalWorkers} availableTroops={availableTroops}/>
        </div>
      )}

      {/* Incoming raid alert banner */}
      {incomingRaid && !combatLog && (
        <RaidAlert raid={incomingRaid} wks={wks} defendRaid={defendRaid} C={C}/>
      )}

      {/* Combat replay modal */}
      {combatLog && (
        <CombatReplay log={combatLog} onClose={finishCombat} C={C}/>
      )}

      {/* Raid march animation — pillards qui approchent */}
      {raidMarchAnim && incomingRaid && (
        <RaidMarchAnim anim={raidMarchAnim} timeLeft={incomingRaid.timeLeft} totalTime={incomingRaid.totalTime} C={C}/>
      )}

      {/* Troop march animation on map */}
      {troopAnim && <TroopMarchAnim anim={troopAnim} C={C}/>}

      {/* Raider escaping with loot */}
      {raidRunAnim && <RaiderRunAnim C={C}/>}

      {/* Ad Shop overlay */}
      {showAdShop && (
        <AdShopModal
          onClose={()=>setShowAdShop(false)}
          onWatchAd={watchAdForShop}
          adsWatched={adShopAdsWatched}
          cooldown={adShopCooldown}
          C={C}
        />
      )}

      {/* Prestige proposal — map complete */}
      {prestigeProposal && !rocketLaunch && !combatLog && !incomingRaid && (
        <PrestigeProposal prestige={prestige} doPrestige={doPrestige} onDismiss={()=>setPrestigeProposal(false)} C={C}/>
      )}

      {/* Rocket launch animation */}
      {rocketLaunch && <RocketLaunchAnim prestige={prestige} C={C}/>}

      {/* Lost zone animation */}
      {lostZoneAnim && !combatLog && (
        <LostZonePopup data={lostZoneAnim} onClose={dismissLostZone} C={C}/>
      )}

      {/* Magic chest popup */}
      {chest && !incomingRaid && !combatLog && !lostZoneAnim && (
        <MagicChest chest={chest} openChest={openChest} claimChest={claimChest} dismiss={() => setChest(null)} C={C}/>
      )}

      {/* Bottom tabs */}
      <div style={St.tabs}>
        {[["map","🗺️","MAP"],["base","🏗️","BASE"],["workers","🤖","BOTS"],["casino","🎰","CASINO"],["rank","🏆","RANK"]].map(([t,e,l])=>(
          <div key={t} style={St.tab(tab===t)} onClick={()=>setTab(t)}>
            <div style={{position:"relative",display:"inline-block"}}>
              <div style={{fontSize:20}}>{e}</div>
              {t==="base" && researchQueue && (
                <div style={{
                  position:"absolute",top:-2,right:-4,
                  width:8,height:8,borderRadius:"50%",
                  background:"#60a5fa",
                  boxShadow:"0 0 6px #60a5fa",
                  animation:"pls 1.5s infinite",
                }}/>
              )}
            </div>
            <div className="orb" style={{fontSize:7,marginTop:1}}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ MAP TAB ════════════════════════════
function MapTab({ cells, capProg, selId, setSelId, marches, recallMarch, sendMarch, wks, storm, adSpeedActive, onSpeedBoost, St, C }) {
  const playerCells = cells.filter(c => c.owner === "player");
  const isCapturable = (cell) => {
    if (cell.fog || cell.owner === "player" || cell.isBase) return false;
    if (cell.owner !== "neutral" && cell.owner !== "enemy" && cell.owner !== "contested") return false;
    // Adjacence cardinale uniquement (haut, bas, gauche, droite) — pas de diagonale
    return playerCells.some(pc =>
      (Math.abs(pc.x - cell.x) === 1 && pc.y === cell.y) ||
      (Math.abs(pc.y - cell.y) === 1 && pc.x === cell.x)
    );
  };
  const canGather = (cell) => cell.owner==="player" && !cell.isBase && BIOMES[cell.biome]?.res!=="none";
  const CELL_PX = CELL + 3;

  return (
    <div>
      {/* ⛈️ Tempête — alerte visible */}
      {storm > 0 && (
        <div style={{
          background:"linear-gradient(135deg,#1a1000,#2a1a00)",
          border:"2px solid #fbbf24", borderRadius:12,
          padding:"10px 14px", marginBottom:10,
          display:"flex", alignItems:"center", gap:12,
          boxShadow:"0 0 24px rgba(251,191,36,0.6)",
          animation:"raidAlertBlink 1.2s ease-in-out infinite",
        }}>
          <span style={{fontSize:36, filter:"drop-shadow(0 0 10px #fbbf24)"}}>⛈️</span>
          <div style={{flex:1}}>
            <div className="orb" style={{fontSize:15,color:"#fbbf24",fontWeight:900,letterSpacing:2,textShadow:"0 0 12px #fbbf24"}}>
              TEMPÊTE ÉLECTROMAGNÉTIQUE
            </div>
            <div style={{fontSize:12,color:"#94a3b8",marginTop:2}}>
              Production −50% · encore <span className="orb" style={{color:"#fff",fontWeight:700}}>{storm}s</span>
            </div>
          </div>
        </div>
      )}

      {/* Map */}
      <div className="map-frame" style={{ marginBottom:11 }}>
        {/* Corner brackets */}
        <div className="corner-br" style={{top:5,left:5,borderRight:"none",borderBottom:"none",borderTopLeftRadius:3}}/>
        <div className="corner-br" style={{top:5,right:5,borderLeft:"none",borderBottom:"none",borderTopRightRadius:3}}/>
        <div className="corner-br" style={{bottom:5,left:5,borderRight:"none",borderTop:"none",borderBottomLeftRadius:3}}/>
        <div className="corner-br" style={{bottom:5,right:5,borderLeft:"none",borderTop:"none",borderBottomRightRadius:3}}/>
        {/* Scan sweep animation */}
        <div className="map-scan"/>
        {/* Tactical map title */}
        <div className="map-title">◢ TACTICAL GRID ◣</div>

        <div style={{ overflowX:"auto", overflowY:"hidden", marginTop:14, position:"relative", zIndex:1, paddingBottom:2 }}>
          <div className="map-grid-inner" style={{ display:"grid", gridTemplateColumns:`repeat(${GW},${CELL}px)`, gap:3, width:GW*(CELL+3), minWidth:GW*(CELL+3), margin:"0 auto" }}>
            {cells.map(cell=>{
              const bm = BIOMES[cell.biome];
              const cp = capProg[cell.id];
              const isSel = selId===cell.id;
              const isJk = cell.biome==="jackpot" && !cell.fog;
              const isPl = cell.owner==="player";
              const isEn = cell.owner==="enemy";
              const isCt = cell.owner==="contested";
              const canCapture = isCapturable(cell);
              const rarity = RARITIES[cell.rarity] || RARITIES.common;
              const rarityCol = rarity.col;
              const ownerCol = isPl?C.cy:isEn?"#ef4444":isCt?"#fbbf24":bm.col;

              const cellBg = cell.fog ? null
                : isPl ? `radial-gradient(circle at 50% 25%, rgba(0,245,212,0.22) 0%, ${bm.bg} 70%)`
                : isEn ? `radial-gradient(circle at 50% 25%, rgba(239,68,68,0.18) 0%, #0a0305 80%)`
                : isCt ? `radial-gradient(circle at 50% 25%, rgba(251,191,36,0.15) 0%, #0a0a03 80%)`
                : canCapture ? `radial-gradient(circle at 50% 30%, rgba(160,120,32,0.08) 0%, #0c0c06 80%)`
                : `linear-gradient(135deg, #050810 0%, #020408 100%)`;

              const borderColor = cell.fog ? "#0d1828"
                : isSel ? "#ffffff"
                : canCapture ? "#a07820"
                : ownerCol+(isPl?"":"66");

              const cellShadow = isSel ? `0 0 0 2px #fff, 0 0 22px rgba(255,255,255,0.5)`
                : isPl && !cell.isBase ? undefined  // handled by .plyr animation
                : isPl && cell.isBase ? `inset 0 0 18px rgba(0,245,212,0.5), 0 0 14px rgba(0,245,212,0.5)`
                : isEn ? `inset 0 0 16px rgba(239,68,68,0.55), 0 0 10px rgba(239,68,68,0.5)`
                : !cell.fog ? `inset 0 1px 0 ${bm.col}33, 0 1px 4px rgba(0,0,0,0.4)` : "none";

              return (
                <div key={cell.id}
                  onClick={()=>!cell.fog&&setSelId(cell.id===selId?null:cell.id)}
                  className={`cell ${cell.fog?"cell-fog":""} ${isJk?"jkp":""} ${isCt?"rng":""} ${isPl&&!cell.isBase?"plyr":""} ${canCapture?"capturable":""}`}
                  style={{
                    width:CELL, height:CELL,
                    background: cellBg || undefined,
                    border:`1.5px solid ${borderColor}`,
                    borderRadius:7,
                    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                    cursor:cell.fog?"default":"pointer",
                    color: canCapture ? "#a07820" : ownerCol,
                    boxShadow: cellShadow,
                    ...(canCapture && !isSel ? { animation:"capturable 1.6s ease-in-out infinite" } : {}),
                  }}
                >
                  {/* Enemy flag overlay */}
                  {isEn && !cell.fog && (
                    <div style={{
                      position:"absolute", top:1, right:1,
                      fontSize:11, lineHeight:1,
                      filter:"drop-shadow(0 0 4px rgba(239,68,68,0.8))",
                      transformOrigin:"bottom center",
                      animation:"flagWave 1.8s ease-in-out infinite",
                      zIndex:3,
                    }}>🚩</div>
                  )}
                  {!cell.fog && <div className="cell-top"/>}
                  {!cell.fog && (
                    <div className="cell-coord" style={{color: canCapture ? "#ffd700" : ownerCol}}>
                      {String.fromCharCode(65+cell.x)}{cell.y+1}
                    </div>
                  )}
                  {!cell.fog && cell.rarity !== "common" && !cell.isBase && (
                    <div style={{
                      position:"absolute", top:2, left:2,
                      width:7, height:7, borderRadius:"50%",
                      background:rarityCol,
                      boxShadow:rarity.glow,
                    }}/>
                  )}

                  {cell.fog ? (
                    <span className="orb" style={{fontSize:13,color:"#1e3550",fontWeight:700,opacity:0.55}}>?</span>
                  ) : (
                    <>
                      <span style={{
                        fontSize: bm.e.length>2?13:18, lineHeight:1, marginTop:2,
                        filter: isPl
                          ? `drop-shadow(0 0 5px ${C.cy}aa)`
                          : isEn ? "drop-shadow(0 0 5px rgba(239,68,68,0.7)) brightness(0.8)"
                          : isJk ? "drop-shadow(0 0 6px #ffd700)"
                          : canCapture ? "brightness(0.75)"
                          : "brightness(0.45) saturate(0.4)",
                      }}>
                        {cell.isBase?"🏠":bm.e}
                      </span>
                      <span className="orb" style={{
                        fontSize:7, color:ownerCol, marginTop:2, fontWeight:700,
                        textShadow: isPl||isEn||isCt ? `0 0 5px currentColor` : "none"
                      }}>
                        {isPl?"▲":isEn?"✕":isCt?"⚡":"◇"}
                      </span>

                      {cp!==undefined && (
                        <div style={{
                          position:"absolute", bottom:0, left:0, width:`${cp}%`, height:3,
                          background:`linear-gradient(90deg,${C.cy},#0096ff)`,
                          boxShadow:`0 0 8px ${C.cy}, 0 0 4px ${C.cy}`,
                          transition:"width 1s linear"
                        }}/>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      {/* Active Marches Panel — Whiteout style */}
      {marches.length > 0 && (
        <div style={{...St.card, border:"1px solid #ffe60055", background:"linear-gradient(135deg,#1a1500,#0b1424)", marginBottom:11}}>
          <div className="orb" style={{fontSize:10, color:"#ffe600", marginBottom:8, letterSpacing:2}}>
            ⚔️ MARCHES EN COURS ({marches.length})
          </div>
          {marches.map(m => {
            const pct = ((m.totalTime - m.timeLeft)/m.totalTime)*100;
            const mins = Math.floor(m.timeLeft/60);
            const secs = m.timeLeft%60;
            return (
              <div key={m.id} style={{
                background:"#040810", border:"1px solid #ffe60033",
                borderRadius:10, padding:"10px 12px", marginBottom:8,
              }}>
                <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6}}>
                  <div style={{display:"flex", gap:8, alignItems:"center"}}>
                    <span style={{fontSize:20}}>{m.type==="attack"?"⚔️":"⛏️"}</span>
                    <div>
                      <div className="orb" style={{fontSize:11, color:"#ffe600", letterSpacing:1}}>
                        {m.type==="attack"?"ATTAQUE":"RÉCOLTE"} → Zone {String.fromCharCode(65+m.toCell.x)}{m.toCell.y+1}
                      </div>
                      <div style={{fontSize:10, color:"#64748b", marginTop:2}}>
                        ⛏️{m.troops.miner||0} ⚙️{m.troops.engineer||0} 🛡️{m.troops.defender||0}
                      </div>
                    </div>
                  </div>
                  <div style={{textAlign:"right", display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4}}>
                    <div className="orb" style={{fontSize:13, color:"#fff", fontWeight:700}}>
                      {mins>0?`${mins}m `:""}{secs}s
                    </div>
                    <div style={{display:"flex", gap:4}}>
                      {/* Speed boost button */}
                      <button onClick={()=>onSpeedBoost(m.id)} className="rip" style={{
                        background: (adSpeedActive[m.id]||0)===0 ? "linear-gradient(135deg,#ffe60022,#ffe60055)" : "#0d1828",
                        border:`1px solid ${(adSpeedActive[m.id]||0)===0?"#ffe60088":"#334155"}`,
                        borderRadius:6, padding:"3px 7px",
                        color:(adSpeedActive[m.id]||0)===0?"#ffe600":"#475569",
                        fontSize:9, cursor:"pointer", fontFamily:"'Rajdhani',sans-serif", fontWeight:700,
                        whiteSpace:"nowrap",
                      }}>
                        {(adSpeedActive[m.id]||0)===0 ? "📺 −1min" : `${Math.ceil((adSpeedActive[m.id]||0)/60)}min`}
                      </button>
                      <button onClick={()=>recallMarch(m.id)} className="rip" style={{
                        background:"#1a0505", border:"1px solid #ef444488",
                        borderRadius:6, padding:"3px 8px", color:"#ef4444",
                        fontSize:10, cursor:"pointer", fontFamily:"'Rajdhani',sans-serif", fontWeight:600,
                      }}>🔙</button>
                    </div>
                  </div>
                </div>
                {/* March progress bar */}
                <div style={{background:"#0d1828", borderRadius:4, height:6, overflow:"hidden"}}>
                  <div style={{
                    width:`${pct}%`, height:"100%",
                    background:`linear-gradient(90deg,${m.type==="attack"?"#ef4444":"#60a5fa"},${m.type==="attack"?"#fbbf24":"#4ade80"})`,
                    borderRadius:4, transition:"width 1s linear",
                    boxShadow:`0 0 8px ${m.type==="attack"?"#ef4444":"#60a5fa"}66`,
                  }}/>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={St.card}>
        <div className="orb" style={{fontSize:10,color:C.cy,marginBottom:8,letterSpacing:2}}>◆ LÉGENDE</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:10}}>
          {[["▲",C.cy,"Vous"],["✕","#ef4444","Ennemi"],["⚡","#fbbf24","Contesté"],["⭐","#ffd700","Capturable"],["◇","#475569","Neutre"],["?","#1e3550","Inconnu"]].map(([s,c,l])=>(
            <div key={l} style={{display:"flex",alignItems:"center",gap:4,fontSize:11}}>
              <span className="orb" style={{color:c,fontSize:10,textShadow:`0 0 4px ${c}66`}}>{s}</span>
              <span style={{color:"#64748b"}}>{l}</span>
            </div>
          ))}
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:8,paddingTop:8,borderTop:`1px solid ${C.brd}`}}>
          {Object.values(BIOMES).map(b=>(
            <div key={b.name} style={{display:"flex",alignItems:"center",gap:3,fontSize:10}}>
              <span>{b.e}</span><span style={{color:b.col,fontSize:10}}>{b.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tips */}
      <div style={{...St.card,border:`1px solid ${C.pu}44`,background:`linear-gradient(135deg,${C.card},#180b28)`}}>
        <div className="orb" style={{fontSize:10,color:C.pu,marginBottom:6,letterSpacing:2}}>◆ STRATÉGIE</div>
        <div style={{fontSize:11,color:"#94a3b8",lineHeight:1.5}}>
          Tapez une zone pour voir ses détails · Capturez les zones adjacentes · Attaquez les ennemis avec assez de Défenseurs · ⭐ Jackpot = bonus massif!
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ CELL MODAL ═════════════════════════
function CellModal({ cell, cells, capProg, res, captureZone, setSelId, St, C, wks, totalWorkers, availableTroops }) {
  const bm = BIOMES[cell.biome];
  const rarity = RARITIES[cell.rarity] || RARITIES.common;
  const cp = capProg[cell.id];
  const playerCells = cells.filter(c=>c.owner==="player");
  const isAdj = playerCells.some(pc =>
    (Math.abs(pc.x - cell.x) === 1 && pc.y === cell.y) ||
    (Math.abs(pc.y - cell.y) === 1 && pc.x === cell.x)
  );
  const isEnemy = cell.owner === "enemy";
  const isNeutral = cell.owner === "neutral" || cell.owner === "contested";
  const isPlayer = cell.owner === "player";
  const rarityMulti = (RARITIES[cell.rarity]?.multi) || 1;
  const avail = availableTroops || { miner:wks.miner.n, engineer:wks.engineer.n, defender:wks.defender.n };
  const [deployed, setDeployed] = useState({
    miner: Math.min(1, avail.miner),
    engineer: Math.min(1, avail.engineer),
    defender: Math.min(1, avail.defender),
  });
  const totalDeployed = Object.values(deployed).reduce((s,v)=>s+v,0);
  const atkPow = Math.round(
    (deployed.miner + deployed.engineer*1.2 + deployed.defender*2) * 10 *
    (1 + deployed.defender * 0.5 * wks.defender.lv)
  );
  const enemyPow = Math.round((bm.diff * 50 + cell.defLv * 25) * Math.sqrt(rarityMulti));
  const winChance = Math.min(95, Math.round(atkPow / (atkPow + enemyPow) * 100 + 5));
  const capCost = isEnemy
    ? { credits: Math.round((bm.diff*60+50)*(1+(rarityMulti-1)*0.5)), minerals: Math.round((bm.diff*30+10)*(1+(rarityMulti-1)*0.5)), food: Math.round(bm.diff*20+10) }
    : { food: Math.round((bm.diff*40+10)*(1+(rarityMulti-1)*0.4)), minerals: Math.round((bm.diff*20+5)*(1+(rarityMulti-1)*0.4)) };
  const canAfford = afford(res, capCost);
  const canAttack = isAdj && canAfford && cp===undefined && totalDeployed > 0;
  const TROOP_CFG = [
    { key:"miner",    label:"Mineur",    e:"⛏️", col:"#60a5fa", max:avail.miner,    total:wks.miner.n,    role:"Récolte bonus après victoire" },
    { key:"engineer", label:"Ingénieur", e:"⚙️", col:"#ffe600", max:avail.engineer, total:wks.engineer.n, role:"Réduit le délai de marche" },
    { key:"defender", label:"Défenseur", e:"🛡️", col:"#4ade80", max:avail.defender, total:wks.defender.n, role:"Force de combat principale" },
  ];
  return (
    <>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <span style={{fontSize:36,filter:isEnemy?"drop-shadow(0 0 8px rgba(239,68,68,0.8))":isPlayer?`drop-shadow(0 0 8px #00f5d4)`:"none"}}>{cell.isBase?"🏠":bm.e}</span>
          <div>
            <div className="orb" style={{fontSize:13,color:bm.col,fontWeight:700}}>{bm.name}</div>
            <div style={{fontSize:11,color:isPlayer?"#00f5d4":isEnemy?"#ef4444":isNeutral?"#fbbf24":"#475569",marginTop:2}}>
              {isPlayer?"✅ Contrôlée":isEnemy?`🚩 ${cell.enemyName}`:cell.owner==="contested"?"⚡ Contestée":"⬜ Neutre"}
            </div>
            {!cell.isBase&&<div style={{display:"inline-block",marginTop:4,fontSize:10,padding:"2px 8px",background:`${rarity.col}22`,border:`1px solid ${rarity.col}`,borderRadius:10,color:rarity.col,fontFamily:"Orbitron",letterSpacing:1,fontWeight:700}}>{rarity.e} {rarity.name.toUpperCase()} ×{rarity.multi}</div>}
          </div>
        </div>
        <button onClick={()=>setSelId(null)} style={{background:"none",border:"none",color:"#64748b",fontSize:22,cursor:"pointer"}}>✕</button>
      </div>

      <div style={{display:"flex",gap:5,marginBottom:12,flexWrap:"wrap"}}>
        {[[`${RES_CFG[bm.res]?.e||"📦"} ${bm.res==="all"?"Toutes":bm.res==="none"?"Aucune":bm.res}`,bm.col],[`+${Math.round(bm.bonus*100)}%`,"#4ade80"],[`Diff. ${"⭐".repeat(bm.diff)}`,"#ef4444"],[`Déf. ${cell.defLv}/5`,"#fbbf24"]].map(([l,c])=>(
          <div key={l} style={{background:`${c}11`,border:`1px solid ${c}44`,borderRadius:8,padding:"4px 9px",fontSize:11,color:c}}>{l}</div>
        ))}
      </div>

      {cp!==undefined ? (
        <div style={{marginBottom:12}}>
          <div style={{fontSize:12,color:"#94a3b8",marginBottom:6}}>🏗️ Capture en cours...</div>
          <div style={{background:"#040810",borderRadius:4,height:10,overflow:"hidden"}}>
            <div style={{width:`${cp}%`,height:"100%",background:"linear-gradient(90deg,#00f5d4,#0096ff)",transition:"width 1s",borderRadius:4}}/>
          </div>
          <div className="orb" style={{fontSize:11,color:"#00f5d4",textAlign:"right",marginTop:4}}>{Math.round(cp)}%</div>
        </div>
      ) : isPlayer ? (
        <div style={{textAlign:"center",color:"#00f5d4",fontFamily:"Orbitron",fontSize:12,padding:"12px 0"}}>
          {cell.isBase?"🏠 QUARTIER GÉNÉRAL":"✅ TERRITOIRE SOUS CONTRÔLE"}
        </div>
      ) : !isAdj ? (
        <div style={{background:"#1a0a0a",border:"1px solid #ef444444",borderRadius:10,padding:"14px",textAlign:"center"}}>
          <div style={{fontSize:24,marginBottom:6}}>🚫</div>
          <div className="orb" style={{fontSize:11,color:"#ef4444",letterSpacing:1}}>ZONE NON ACCESSIBLE</div>
          <div style={{fontSize:11,color:"#64748b",marginTop:5,lineHeight:1.5}}>
            Capture d'abord une zone directement à gauche, droite, au-dessus ou en-dessous.
          </div>
        </div>
      ) : (
        <>
          <div style={{background:"linear-gradient(135deg,#040d1a,#0a1424)",border:`1px solid ${isEnemy?"#ef444444":"#00f5d444"}`,borderRadius:12,padding:12,marginBottom:10}}>
            <div className="orb" style={{fontSize:10,color:isEnemy?"#ef4444":"#00f5d4",letterSpacing:2,marginBottom:10}}>
              ⚔️ DÉPLOIEMENT DES TROUPES
            </div>
            {TROOP_CFG.map(tr=>(
              <div key={tr.key} style={{marginBottom:9}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:16}}>{tr.e}</span>
                    <div>
                      <div style={{fontSize:11,color:tr.col,fontWeight:700}}>{tr.label}</div>
                      <div style={{fontSize:9,color:"#475569"}}>{tr.role}</div>
                    </div>
                  </div>
                  <div className="orb" style={{fontSize:13,color:"#fff",fontWeight:900}}>{deployed[tr.key]}/{tr.max}</div>
                </div>
                <div style={{display:"flex",gap:5,alignItems:"center"}}>
                  <button onClick={()=>setDeployed(d=>({...d,[tr.key]:Math.max(0,d[tr.key]-1)}))} style={{width:30,height:30,borderRadius:6,background:"#0d1828",border:"1px solid #334155",color:"#94a3b8",fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
                  <div style={{flex:1,display:"flex",gap:2}}>
                    {Array.from({length:Math.max(tr.max,1)}).map((_,i)=>(
                      <div key={i} onClick={()=>setDeployed(d=>({...d,[tr.key]:i+1}))} style={{flex:1,height:22,borderRadius:4,cursor:"pointer",background:i<deployed[tr.key]?tr.col:"#1e3a5f",opacity:i<deployed[tr.key]?1:0.4,transition:"background .15s",boxShadow:i<deployed[tr.key]?`0 0 4px ${tr.col}66`:"none",border:i<deployed[tr.key]?`1px solid ${tr.col}88`:"1px solid transparent"}}/>
                    ))}
                  </div>
                  <button onClick={()=>setDeployed(d=>({...d,[tr.key]:Math.min(tr.max,d[tr.key]+1)}))} style={{width:30,height:30,borderRadius:6,background:`${tr.col}22`,border:`1px solid ${tr.col}88`,color:tr.col,fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                  <button onClick={()=>setDeployed(d=>({...d,[tr.key]:tr.max}))} style={{padding:"0 8px",height:30,borderRadius:6,background:"#0d1828",border:"1px solid #334155",color:"#64748b",fontSize:9,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700}}>MAX</button>
                </div>
              </div>
            ))}
            {totalDeployed>0 && isEnemy && (
              <div style={{marginTop:10,padding:"8px 10px",background:"#040810",borderRadius:8,border:"1px solid #1e3a5f"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span className="orb" style={{fontSize:14,color:atkPow>enemyPow?"#4ade80":"#fbbf24",fontWeight:900}}>{atkPow}</span>
                  <span style={{fontSize:10,color:"#64748b",alignSelf:"center"}}>VS</span>
                  <span className="orb" style={{fontSize:14,color:"#ef4444",fontWeight:900}}>{enemyPow}</span>
                </div>
                <div style={{height:7,background:"#ef444433",borderRadius:4,overflow:"hidden"}}>
                  <div style={{width:`${winChance}%`,height:"100%",background:winChance>=60?"#4ade80":winChance>=40?"#fbbf24":"#ef4444",transition:"width .3s",borderRadius:4}}/>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontSize:10}}>
                  <span style={{color:winChance>=60?"#4ade80":winChance>=40?"#fbbf24":"#ef4444",fontWeight:700}}>{winChance}% victoire</span>
                  <span style={{color:"#475569"}}>{100-winChance}% défaite</span>
                </div>
              </div>
            )}
          </div>
          <div style={{fontSize:11,color:"#64748b",marginBottom:8,display:"flex",justifyContent:"space-between"}}>
            <span>{isEnemy?"Coût d'attaque :":"Coût de capture :"}</span>
            <span style={{color:canAfford?"#dde4f0":"#ef4444",fontWeight:600}}>{costStr(capCost)}</span>
          </div>
          <button onClick={()=>canAttack&&captureZone(cell,{...deployed,total:totalDeployed})} disabled={!canAttack} className="rip" style={{width:"100%",padding:"13px",background:canAttack?(isEnemy?"linear-gradient(135deg,#ef444433,#ef444477)":"linear-gradient(135deg,#00f5d433,#00f5d477)"):"#1e3a5f",border:`1.5px solid ${canAttack?(isEnemy?"#ef4444":"#00f5d4"):"#334155"}`,borderRadius:10,color:"#fff",fontSize:13,cursor:canAttack?"pointer":"not-allowed",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,letterSpacing:2,opacity:canAttack?1:0.5,boxShadow:canAttack?`0 0 16px ${isEnemy?"#ef444466":"#00f5d466"}`:"none",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            {!canAfford?"❌ Ressources insuffisantes":totalDeployed===0?"Sélectionnez des troupes":isEnemy?`⚔️ ATTAQUER — ${totalDeployed} troupes`:`🏗️ CAPTURER — ${totalDeployed} troupes`}
          </button>
        </>
      )}
    </>
  );
}


// ═══════════════════════════════════════ BASE TAB ═══════════════════════════
function BaseTab({ res, cells, playerCells, prod, prestige, tech, researchTech, researchQueue, doPrestige, buildingLv, upgradeBuilding, pendingRes, collectAll, storage, collectCooldown, St, C }) {
  const [subTab, setSubTab] = useState("buildings");
  const stage = Math.min(4, Math.floor(playerCells.length/3));
  const STAGES = [["🏚️","Ruines Abandonnées"],["🏕️","Avant-Poste"],["🏗️","Camp Fortifié"],["🏭","Colonie Industrielle"],["🌆","Empire Galactique ⭐"]];
  const totalPending = Object.values(pendingRes).reduce((s,v)=>s+v,0);

  return (
    <div>
      {/* Base stage card */}
      <div style={{...St.card,textAlign:"center",background:`linear-gradient(135deg,${C.card},#0a1f1a)`}}>
        <div style={{fontSize:48,marginBottom:4}}>{STAGES[stage][0]}</div>
        <div className="orb" style={{fontSize:14,color:C.cy}}>{STAGES[stage][1]}</div>
        <div style={{fontSize:11,color:"#445",marginTop:4}}>{playerCells.length} zones · {prestige>0?`⭐ Prestige ${prestige}`:""}</div>
      </div>

      {/* Collect banner — Whiteout style */}
      {totalPending > 0.5 && (
        <button onClick={collectAll} className="rip" style={{
          width:"100%", padding:"12px", marginBottom:11,
          background: collectCooldown===0
            ? "linear-gradient(135deg,#4ade8022,#4ade8055)"
            : "linear-gradient(135deg,#1e3a5f,#0d1828)",
          border: collectCooldown===0 ? "1.5px solid #4ade80" : "1px solid #334155",
          borderRadius:12,
          cursor: collectCooldown===0 ? "pointer" : "default",
          display:"flex", alignItems:"center", justifyContent:"space-between",
          fontFamily:"'Rajdhani',sans-serif",
          boxShadow: collectCooldown===0 ? "0 0 18px rgba(74,222,128,0.4)" : "none",
          animation: collectCooldown===0 ? "pls 1.8s infinite" : "none",
          transition:"all .3s",
        }}>
          <div style={{display:"flex", alignItems:"center", gap:10}}>
            <span style={{fontSize:28}}>📦</span>
            <div style={{textAlign:"left"}}>
              <div className="orb" style={{
                fontSize:13, fontWeight:700, letterSpacing:2,
                color: collectCooldown===0 ? "#4ade80" : "#94a3b8",
              }}>
                {collectCooldown===0 ? "COLLECTER !" : `DISPONIBLE DANS ${collectCooldown}s`}
              </div>
              <div style={{fontSize:11, color:"#64748b"}}>
                {collectCooldown===0
                  ? Object.entries(pendingRes).filter(([,v])=>v>0.5).map(([k,v])=>`+${Math.round(v*0.3)} ${RES_CFG[k].e}`).join(" ")
                  : "Les ressources s'accumulent..."}
              </div>
            </div>
          </div>
          {collectCooldown===0
            ? <span style={{fontSize:22, color:"#4ade80"}}>›</span>
            : <div className="orb" style={{fontSize:16, color:"#475569", fontWeight:700}}>{collectCooldown}s</div>
          }
        </button>
      )}

      {/* Sub tabs */}
      <div style={{display:"flex", gap:4, marginBottom:11, background:"#040810", borderRadius:10, padding:4}}>
        {[["buildings","🏗️ Bâtiments"],["tech","🔬 Tech"],["prestige","⭐ Prestige"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSubTab(k)} className="rip" style={{
            flex:1, padding:"8px 6px", borderRadius:8, border:"none", cursor:"pointer",
            background: subTab===k ? `linear-gradient(135deg,${C.cy}22,${C.cy}44)` : "transparent",
            color: subTab===k ? C.cy : "#475569", fontSize:11,
            fontFamily:"'Rajdhani',sans-serif", fontWeight:600,
            border: subTab===k ? `1px solid ${C.cy}66` : "1px solid transparent",
          }}>{l}</button>
        ))}
      </div>

      {/* Buildings sub-tab */}
      {subTab==="buildings" && (
        <div>
          <div style={{fontSize:11,color:"#94a3b8",marginBottom:10,lineHeight:1.5}}>
            Améliore tes bâtiments pour produire plus de ressources. Les ressources s'accumulent et doivent être <span style={{color:"#4ade80",fontWeight:600}}>collectées</span>.
          </div>
          {Object.entries(BUILDINGS).map(([type,b])=>{
            const lv = buildingLv[type]||0;
            const nextLv = lv+1;
            const cost = lv<b.maxLv ? b.upgCost(nextLv, prestige) : null;
            const canUpg = cost && afford(res, cost);
            const prodPerS = lv>0 ? getBuildingProd(type,lv) : 0;
            const storageInfo = b.res==="storage" ? getStorage({...buildingLv,[type]:nextLv}) : null;
            return (
              <div key={type} style={{
                background:"#040810", border:`1px solid ${b.col}33`,
                borderRadius:12, padding:13, marginBottom:8,
                boxShadow: canUpg ? `0 0 10px ${b.col}22` : "none",
              }}>
                <div style={{display:"flex", gap:10, alignItems:"center", marginBottom:8}}>
                  <div style={{
                    width:46, height:46, borderRadius:10, flexShrink:0,
                    background:`linear-gradient(135deg,${b.col}22,${b.col}44)`,
                    border:`1.5px solid ${b.col}88`,
                    display:"flex", alignItems:"center", justifyContent:"center", fontSize:22,
                  }}>{b.e}</div>
                  <div style={{flex:1}}>
                    <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                      <div className="orb" style={{fontSize:12, color:b.col, fontWeight:700}}>{b.name}</div>
                      <div className="orb" style={{fontSize:13, color:"#fff", fontWeight:900}}>
                        Niv.{lv}<span style={{color:"#445", fontSize:10}}>/{b.maxLv}</span>
                      </div>
                    </div>
                    {/* Level progress bar */}
                    <div style={{display:"flex", gap:2, marginTop:5}}>
                      {Array.from({length:b.maxLv}).map((_,i)=>(
                        <div key={i} style={{
                          flex:1, height:4, borderRadius:2,
                          background: i<lv?b.col:"#1e3a5f",
                          transition:"background .3s",
                          boxShadow: i<lv?`0 0 3px ${b.col}66`:"none",
                        }}/>
                      ))}
                    </div>
                    <div style={{fontSize:10, color:"#64748b", marginTop:4}}>
                      {b.res==="storage"
                        ? `Stockage: ${Object.entries(getStorage(buildingLv)).map(([k,v])=>`${RES_CFG[k].e}${fmt(v)}`).join(" ")}`
                        : lv>0 ? `Production: ${prodPerS.toFixed(2)}/s ${RES_CFG[b.res]?.e||""}` : "Construire pour activer"
                      }
                    </div>
                  </div>
                </div>
                {cost ? (
                  <div>
                    <div style={{fontSize:10, color:"#64748b", marginBottom:6}}>
                      Amélioration Niv.{nextLv} : {costStr(cost)}
                    </div>
                    <button onClick={()=>upgradeBuilding(type)} className="rip" style={{
                      width:"100%", padding:"9px",
                      background: canUpg ? `linear-gradient(135deg,${b.col}22,${b.col}55)` : "#1e3a5f",
                      border:`1px solid ${canUpg?b.col:"#445"}`, borderRadius:8,
                      color: canUpg?"#fff":"#475569", fontSize:12, cursor:canUpg?"pointer":"not-allowed",
                      fontFamily:"'Rajdhani',sans-serif", fontWeight:700, letterSpacing:1,
                    }}>
                      {canUpg ? `⬆️ Améliorer → Niv.${nextLv}` : `🔒 ${costStr(cost)}`}
                    </button>
                  </div>
                ) : (
                  <div className="orb" style={{textAlign:"center",color:"#4ade80",fontSize:11,padding:"4px 0"}}>
                    ✅ NIVEAU MAXIMUM
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Tech sub-tab */}
      {subTab==="tech" && (
        <div>
          {/* Research intro */}
          <div style={{
            background:"linear-gradient(135deg,#040d1a,#0b1a2a)",
            border:"1px solid #1e3a5f", borderRadius:12, padding:13, marginBottom:14,
          }}>
            <div className="orb" style={{fontSize:11,color:"#60a5fa",marginBottom:6,letterSpacing:2}}>🔬 CENTRE DE RECHERCHE</div>
            <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.6}}>
              Les technologies débloquent des bonus permanents et ouvrent de nouvelles possibilités. <span style={{color:"#fff"}}>Une seule recherche à la fois.</span> Plus le prestige est élevé, plus elles coûtent cher et prennent du temps.
            </div>
          </div>

          {/* Active research banner */}
          {researchQueue && (() => {
            const activeTech = TECHS.find(t=>t.id===researchQueue.id);
            const pct = ((researchQueue.totalTime - researchQueue.timeLeft)/researchQueue.totalTime)*100;
            const mins = Math.floor(researchQueue.timeLeft/60);
            const secs = researchQueue.timeLeft%60;
            return (
              <div style={{
                background:`linear-gradient(135deg,${activeTech?.col||"#60a5fa"}18,${activeTech?.col||"#60a5fa"}05)`,
                border:`1.5px solid ${activeTech?.col||"#60a5fa"}88`,
                borderRadius:12, padding:13, marginBottom:14,
                boxShadow:`0 0 18px ${activeTech?.col||"#60a5fa"}22`,
              }}>
                <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:10}}>
                  <span style={{
                    fontSize:32, animation:"spinSlow 3s linear infinite",
                    filter:`drop-shadow(0 0 8px ${activeTech?.col||"#60a5fa"})`,
                  }}>{activeTech?.e}</span>
                  <div style={{flex:1}}>
                    <div className="orb" style={{fontSize:12,color:activeTech?.col||"#60a5fa",fontWeight:700,letterSpacing:1}}>
                      🔬 EN COURS : {activeTech?.name}
                    </div>
                    <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{activeTech?.effect}</div>
                  </div>
                  <div className="orb" style={{fontSize:16,color:"#fff",fontWeight:900,textAlign:"right"}}>
                    {mins>0?`${mins}m `:""}{secs}s
                  </div>
                </div>
                <div style={{background:"#040810",borderRadius:4,height:8,overflow:"hidden"}}>
                  <div style={{
                    width:`${pct}%`,height:"100%",
                    background:`linear-gradient(90deg,${activeTech?.col||"#60a5fa"},#ffffff44)`,
                    transition:"width 1s linear", borderRadius:4,
                    boxShadow:`0 0 10px ${activeTech?.col||"#60a5fa"}`,
                  }}/>
                </div>
                <div style={{fontSize:10,color:"#475569",marginTop:5,textAlign:"right"}}>
                  {Math.round(pct)}% terminé
                </div>
              </div>
            );
          })()}

          {/* Tech tiers */}
          {[1,2,3].map(tier=>(
            <div key={tier} style={{marginBottom:18}}>
              {/* Tier header */}
              <div style={{
                display:"flex",justifyContent:"space-between",alignItems:"center",
                marginBottom:10, padding:"8px 12px",
                background:"#040810", borderRadius:8,
                border:"1px solid #1e3a5f",
              }}>
                <div>
                  <div className="orb" style={{fontSize:11,color:"#94a3b8",letterSpacing:2}}>
                    {TECH_TIER_NAMES[tier]}
                  </div>
                  <div style={{fontSize:10,color:"#475569",marginTop:2}}>{TECH_TIER_DESC[tier]}</div>
                </div>
                <div className="orb" style={{
                  fontSize:11, padding:"3px 8px",
                  background: tech.filter(id=>TECHS.find(t=>t.id===id)?.tier===tier).length > 0 ? "#0a1f12" : "#1e3a5f",
                  border: tech.filter(id=>TECHS.find(t=>t.id===id)?.tier===tier).length > 0 ? "1px solid #4ade8066" : "1px solid #334155",
                  borderRadius:10,
                  color: tech.filter(id=>TECHS.find(t=>t.id===id)?.tier===tier).length > 0 ? "#4ade80" : "#475569",
                }}>
                  {tech.filter(id=>TECHS.find(t=>t.id===id)?.tier===tier).length}/{TECHS.filter(t=>t.tier===tier).length}
                </div>
              </div>

              {TECHS.filter(t=>t.tier===tier).map(t=>{
                const owned = tech.includes(t.id);
                const avail = t.req.every(r=>tech.includes(r));
                const isResearching = researchQueue?.id === t.id;
                const cost = t.cost(prestige);
                const canAfford = afford(res, cost);
                const duration = t.researchTime(prestige);
                const mins = Math.floor(duration/60);
                const secs = duration%60;
                const durationStr = mins>0?`${mins}m${secs>0?` ${secs}s`:""}`:` ${secs}s`;
                const missingReqs = t.req.filter(r=>!tech.includes(r)).map(r=>TECHS.find(x=>x.id===r)?.name);

                return (
                  <div key={t.id} style={{
                    background: owned
                      ? "linear-gradient(135deg,#051408,#0a1f12)"
                      : avail ? `linear-gradient(135deg,#0b1424,${t.col}08)` : "#040810",
                    border:`1.5px solid ${owned?"#4ade8066":avail?t.col+"44":"#1a3050"}`,
                    borderRadius:12, padding:13, marginBottom:10,
                    opacity: !owned && !avail ? 0.5 : 1,
                    transition:"all .25s",
                    boxShadow: owned ? "0 0 12px rgba(74,222,128,0.15)" : avail ? `0 0 10px ${t.col}18` : "none",
                  }}>
                    <div style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:owned||!avail?0:10}}>
                      {/* Icon */}
                      <div style={{
                        width:44,height:44,borderRadius:10,flexShrink:0,
                        background: owned ? "#0a1f12" : avail ? `${t.col}18` : "#0d1828",
                        border:`1.5px solid ${owned?"#4ade80":avail?t.col:"#1e3a5f"}`,
                        display:"flex",alignItems:"center",justifyContent:"center",
                        fontSize:22,
                        boxShadow: owned ? "0 0 8px rgba(74,222,128,0.3)" : avail ? `0 0 8px ${t.col}44` : "none",
                      }}>
                        {owned ? "✅" : avail ? t.e : "🔒"}
                      </div>

                      {/* Info */}
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div className="orb" style={{
                            fontSize:12,fontWeight:700,
                            color: owned?"#4ade80":avail?t.col:"#475569",
                            letterSpacing:1,
                          }}>{t.name}</div>
                          <span style={{
                            fontSize:9,padding:"2px 7px",borderRadius:8,
                            background: t.impact==="critical"?"#1a0505":t.impact==="high"?"#1a1500":"#0d1828",
                            color: t.impact==="critical"?"#ef4444":t.impact==="high"?"#fbbf24":"#64748b",
                            border:`1px solid ${t.impact==="critical"?"#ef444444":t.impact==="high"?"#fbbf2444":"#334155"}`,
                            fontFamily:"Orbitron",letterSpacing:1,
                          }}>
                            {t.impact==="critical"?"ESSENTIEL":t.impact==="high"?"IMPORTANT":"UTILE"}
                          </span>
                        </div>
                        <div style={{fontSize:11,color:owned?"#4ade8099":"#64748b",marginTop:2}}>{t.desc}</div>

                        {/* Effect highlight */}
                        <div style={{
                          marginTop:6, padding:"5px 8px",
                          background: owned?"rgba(74,222,128,0.08)":"rgba(255,255,255,0.04)",
                          border:`1px solid ${owned?"#4ade8033":"#1e3a5f"}`,
                          borderRadius:7, fontSize:11,
                          color: owned?"#4ade80":"#94a3b8", fontWeight:600,
                        }}>
                          {t.effect}
                        </div>

                        {/* Detail */}
                        {avail && !owned && (
                          <div style={{fontSize:10,color:"#64748b",marginTop:6,lineHeight:1.5}}>
                            {t.detail}
                          </div>
                        )}

                        {/* Missing prereqs */}
                        {!avail && missingReqs.length>0 && (
                          <div style={{fontSize:10,color:"#475569",marginTop:5}}>
                            🔒 Requiert : {missingReqs.join(", ")}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Research button */}
                    {avail && !owned && !isResearching && (
                      <div style={{marginTop:10}}>
                        <div style={{
                          display:"flex",justifyContent:"space-between",
                          fontSize:10,color:"#64748b",marginBottom:6,
                        }}>
                          <span>Coût : <span style={{color:"#fff"}}>{costStr(cost)}</span></span>
                          <span>⏱️ {durationStr}</span>
                        </div>
                        <button
                          onClick={()=>!researchQueue&&researchTech(t.id)}
                          disabled={!canAfford||!!researchQueue}
                          className="rip"
                          style={{
                            width:"100%",padding:"10px",
                            background: canAfford&&!researchQueue ? `linear-gradient(135deg,${t.col}33,${t.col}66)` : "#1e3a5f",
                            border:`1.5px solid ${canAfford&&!researchQueue?t.col:"#334155"}`,
                            borderRadius:9,color:"#fff",fontSize:12,
                            cursor:canAfford&&!researchQueue?"pointer":"not-allowed",
                            fontFamily:"'Rajdhani',sans-serif",fontWeight:700,letterSpacing:2,
                            opacity:!canAfford||!!researchQueue?0.6:1,
                          }}>
                          {researchQueue ? "⏳ Autre recherche en cours" : canAfford ? `🔬 LANCER LA RECHERCHE (${durationStr})` : "❌ Ressources insuffisantes"}
                        </button>
                      </div>
                    )}

                    {isResearching && (
                      <div style={{marginTop:8,fontSize:11,color:"#60a5fa",fontFamily:"Orbitron",letterSpacing:1,textAlign:"center",animation:"pls 1.5s infinite"}}>
                        🔬 RECHERCHE EN COURS...
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Prestige sub-tab */}
      {subTab==="prestige" && (
        <div style={{...St.card, border:`1px solid ${C.pu}44`, background:"linear-gradient(135deg,#0b1424,#180b28)"}}>
          <div className="orb" style={{fontSize:11,color:C.pu,marginBottom:6}}>⭐ PRESTIGE</div>
          <div style={{fontSize:11,color:"#94a3b8",marginBottom:10,lineHeight:1.5}}>
            Réinitialisez avec des bonus permanents (+20% prod, +15% combat par niveau). Débloque de nouveaux robots et biomes.
          </div>
          <div style={{fontSize:11,color:"#64748b",marginBottom:6}}>
            ✅ Débloqué : Toute la map révélée <span style={{color: cells.every(c=>!c.fog)?"#4ade80":"#ef4444"}}>{cells.every(c=>!c.fog)?"OUI":"NON"}</span>
          </div>
          <div style={{fontSize:11,color:"#64748b",marginBottom:10}}>
            ✅ 70% zones capturées : <span style={{color: playerCells.filter(c=>!c.isBase).length>=Math.floor((cells.length-1)*0.7)?"#4ade80":"#ef4444"}}>
              {playerCells.filter(c=>!c.isBase).length}/{Math.floor((cells.length-1)*0.7)}
            </span>
          </div>
          <button style={{
            ...St.btn(C.pu), width:"100%",
            opacity: (cells.every(c=>!c.fog) && playerCells.filter(c=>!c.isBase).length>=Math.floor((cells.length-1)*0.7)) ? 1 : 0.4,
          }} className="rip" onClick={doPrestige}>
            ⭐ Effectuer Prestige {prestige>0?`(×${prestige+1})`:""}
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════ WORKERS TAB ════════════════════════
function WorkersTab({ wks, res, recruitWorker, upgradeWorker, totalWorkers, St, C }) {
  const [expanded, setExpanded] = useState(null);
  return (
    <div>
      {/* Summary banner */}
      <div style={{
        ...St.card, marginBottom:12,
        background:"linear-gradient(135deg,#051a12,#0a1f1a)",
        border:`1px solid ${C.cy}44`, textAlign:"center", padding:"12px 14px",
      }}>
        <div className="orb" style={{fontSize:10,color:C.cy,letterSpacing:3,marginBottom:4}}>
          👷 {totalWorkers} TRAVAILLEURS ACTIFS
        </div>
        <div style={{fontSize:11,color:"#94a3b8",lineHeight:1.5}}>
          Tes travailleurs récoltent des ressources, font des recherches et défendent ton empire.<br/>
          <span style={{color:C.cy,fontWeight:600}}>Clique sur un travailleur</span> pour voir son rôle en détail.
        </div>
      </div>

      {Object.entries(WORKER_CFG).map(([type,wt])=>{
        const w=wks[type];
        const isExpanded = expanded === type;
        return (
          <div key={type} style={{
            background:"#040810", border:`1px solid ${wt.col}${isExpanded?"88":"33"}`,
            borderRadius:12, padding:13, marginBottom:10,
            boxShadow: isExpanded ? `0 0 16px ${wt.col}33` : "none",
            transition:"all .25s",
          }}>
            {/* Header — always visible */}
            <div
              style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",marginBottom:isExpanded?12:0}}
              onClick={()=>setExpanded(isExpanded?null:type)}
            >
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <div style={{
                  width:46,height:46,borderRadius:10,
                  background:`linear-gradient(135deg,${wt.col}22,${wt.col}44)`,
                  border:`1.5px solid ${wt.col}88`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:24, flexShrink:0,
                  boxShadow:`0 0 10px ${wt.col}44`,
                }}>{wt.e}</div>
                <div>
                  <div className="orb" style={{fontSize:13,color:wt.col,fontWeight:700}}>{wt.name}</div>
                  <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{wt.desc}</div>
                </div>
              </div>
              <div style={{textAlign:"right",display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3}}>
                <div className="orb" style={{fontSize:22,color:wt.col,fontWeight:900,lineHeight:1}}>{w.n}</div>
                <div style={{fontSize:9,color:"#445",fontFamily:"Orbitron"}}>Niv.{w.lv}/5</div>
                <div style={{fontSize:18,color:"#475569",lineHeight:1}}>{isExpanded?"▲":"▼"}</div>
              </div>
            </div>

            {/* Level bar */}
            <div style={{display:"flex",gap:3,marginBottom:isExpanded?12:8}}>
              {Array.from({length:5}).map((_,i)=>(
                <div key={i} style={{
                  flex:1,height:4,borderRadius:2,
                  background:i<w.lv?wt.col:C.brd,
                  transition:"background .3s",
                  boxShadow:i<w.lv?`0 0 4px ${wt.col}88`:"none",
                }}/>
              ))}
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div style={{animation:"slIn .25s ease"}}>
                {/* Utility explanation */}
                <div style={{
                  background:`${wt.col}11`, border:`1px solid ${wt.col}33`,
                  borderRadius:10, padding:12, marginBottom:10,
                }}>
                  <div className="orb" style={{fontSize:9,color:wt.col,marginBottom:6,letterSpacing:2}}>
                    ❓ À QUOI ÇA SERT ?
                  </div>
                  <div style={{fontSize:12,color:"#dde4f0",lineHeight:1.6}}>
                    {wt.utility}
                  </div>
                </div>

                {/* Stat highlight */}
                <div style={{
                  display:"flex",gap:8,marginBottom:10,
                }}>
                  <div style={{
                    flex:1,background:"#040810",border:`1px solid ${wt.col}44`,
                    borderRadius:8,padding:"8px 10px",textAlign:"center",
                  }}>
                    <div style={{fontSize:10,color:"#64748b",marginBottom:3}}>{wt.stat}</div>
                    <div className="orb" style={{fontSize:13,color:wt.col,fontWeight:700}}>{wt.statVal}</div>
                  </div>
                  <div style={{
                    flex:1,background:"#040810",border:`1px solid ${wt.col}44`,
                    borderRadius:8,padding:"8px 10px",textAlign:"center",
                  }}>
                    <div style={{fontSize:10,color:"#64748b",marginBottom:3}}>Effectif actuel</div>
                    <div className="orb" style={{fontSize:13,color:wt.col,fontWeight:700}}>×{w.n} {wt.e}</div>
                  </div>
                </div>

                {/* Tips */}
                <div style={{marginBottom:12}}>
                  {wt.tips.map((tip,i)=>(
                    <div key={i} style={{display:"flex",gap:6,fontSize:11,color:"#94a3b8",marginBottom:5,alignItems:"flex-start"}}>
                      <span style={{color:wt.col,flexShrink:0}}>▸</span>
                      <span>{tip}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action buttons — always visible */}
            <div style={{display:"flex",gap:7}}>
              <button style={{...St.btn(wt.col,true),flex:1}} className="rip" onClick={()=>recruitWorker(type)}>
                ＋ Recruter
              </button>
              <button style={{...St.btn(w.lv<5?C.pu:"#445",true),flex:1}} className="rip" onClick={()=>upgradeWorker(type)}>
                ⬆️ Niv.{Math.min(w.lv+1,5)}
              </button>
            </div>
            <div style={{fontSize:9,color:"#475569",marginTop:6,display:"flex",gap:8}}>
              <span>Recruter: <span style={{color:"#fbbf24"}}>80🪙+40🌾</span></span>
              <span>Upgrade: <span style={{color:C.pu}}>{w.lv*100}🪙+{w.lv*5}☢️</span></span>
            </div>
          </div>
        );
      })}

      <div style={{...St.card,border:`1px solid ${C.pu}44`,background:"linear-gradient(135deg,#0b1424,#180b28)"}}>
        <div className="orb" style={{fontSize:11,color:C.pu,marginBottom:8}}>🤖 ROBOTS SPÉCIAUX</div>
        <div style={{fontSize:11,color:"#94a3b8",marginBottom:10}}>
          Déblocables après Prestige. Capacités uniques, bien plus puissantes que les travailleurs normaux.
        </div>
        <div style={{display:"flex",gap:8}}>
          {[
            ["Proto-Bot","🤖","Récolte automatique +×2 dans toutes les zones","#60a5fa"],
            ["Nano-Bot","⚙️","Auto-répare les zones perdues en 30s","#4ade80"],
            ["War-Bot","💀","Force de combat ×3, indestructible en raid","#ef4444"],
          ].map(([n,e,d,col])=>(
            <div key={n} style={{flex:1,background:"#040810",border:`1px solid ${col}33`,borderRadius:8,padding:"10px 8px",textAlign:"center",opacity:.45}}>
              <div style={{fontSize:28}}>{e}</div>
              <div className="orb" style={{fontSize:9,color:col,marginTop:4}}>{n}</div>
              <div style={{fontSize:9,color:"#64748b",marginTop:4,lineHeight:1.4}}>{d}</div>
              <div style={{fontSize:9,color:"#2a3a4a",marginTop:6,fontFamily:"Orbitron"}}>🔒 Prestige 1</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ RANK TAB ═══════════════════════════
function RankTab({ rp, league, nextLeague, playerCells, prod, tech, St, C }) {
  const progress = nextLeague ? Math.min(100,(rp-league.min)/(nextLeague.min-league.min)*100) : 100;
  const lb = [
    {n:"NEXUS_7",rp:4892,c:19},{n:"ALPHA_RISE",rp:3241,c:15},{n:"STORM_X",rp:2108,c:11},
    {n:"VOUS",rp,c:playerCells.length},{n:"VOID_NINE",rp:Math.max(0,rp-55),c:Math.max(1,playerCells.length-2)},
    {n:"ECHO_ONE",rp:Math.max(0,rp-130),c:Math.max(1,playerCells.length-4)},
  ].sort((a,b)=>b.rp-a.rp);

  return (
    <div>
      <div style={{...St.card,background:`linear-gradient(135deg,${St.card.background||"#0b1424"},${league.col}18)`,border:`2px solid ${league.col}44`,textAlign:"center"}}>
        <div style={{fontSize:52,marginBottom:4}}>{league.e}</div>
        <div className="orb" style={{fontSize:20,color:league.col}}>{league.name}</div>
        <div style={{fontSize:13,color:"#64748b",marginTop:4}}>{rp} Points de Classement</div>
        {nextLeague&&(
          <div style={{marginTop:12}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#334155",marginBottom:5}}>
              <span className="orb">{league.name}</span><span className="orb">{nextLeague.name} ({nextLeague.min})</span>
            </div>
            <div style={{background:"#040810",borderRadius:4,height:8,overflow:"hidden"}}>
              <div style={{width:`${progress}%`,height:"100%",background:`linear-gradient(90deg,${league.col},${nextLeague.col})`,transition:"width 1s",borderRadius:4}}/>
            </div>
            <div style={{fontSize:10,color:"#445",marginTop:4}}>{nextLeague.min-rp} RP pour monter</div>
          </div>
        )}
      </div>

      <div style={St.card}>
        <div className="orb" style={{fontSize:11,color:C.cy,marginBottom:10}}>📊 PERFORMANCE</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[["Zones","🗺️",playerCells.length,C.cy],["Technos","🔬",tech.length,"#b347ff"],["Prod/s","📈",Object.values(prod).reduce((s,v)=>s+v,0).toFixed(1),"#4ade80"],["Saison","📅","1","#ffe600"]].map(([l,e,v,col])=>(
            <div key={l} style={{background:"#040810",borderRadius:8,padding:"10px 8px",textAlign:"center"}}>
              <div style={{fontSize:10,color:"#445",marginBottom:3}}>{e} {l}</div>
              <div className="orb" style={{fontSize:18,color:col}}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={St.card}>
        <div className="orb" style={{fontSize:11,color:C.cy,marginBottom:10}}>🏆 CLASSEMENT GLOBAL</div>
        {lb.map((p,i)=>{
          const lg=getLeague(p.rp), isMe=p.n==="VOUS";
          return (
            <div key={p.n} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",borderRadius:9,marginBottom:6,background:isMe?"#051a12":"#040810",border:`1px solid ${isMe?C.cy:C.brd}`}}>
              <span className="orb" style={{fontSize:13,color:i===0?"#ffd700":i===1?"#c0c0c0":i===2?"#cd7f32":"#445",minWidth:18}}>{i+1}</span>
              <span style={{fontSize:14}}>{lg.e}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:700,color:isMe?C.cy:"#dde4f0"}}>{p.n}</div>
                <div style={{fontSize:10,color:"#445"}}>{p.c} zones · {lg.name}</div>
              </div>
              <span className="orb" style={{fontSize:11,color:lg.col}}>{p.rp} RP</span>
            </div>
          );
        })}
      </div>

      <div style={{...St.card,border:"1px solid #ffe60033"}}>
        <div className="orb" style={{fontSize:11,color:"#ffe600",marginBottom:10}}>🎁 RÉCOMPENSES SAISON 1</div>
        <div style={{fontSize:11,color:"#445",marginBottom:10}}>Reset dans 7 jours. Grimpez pour décrocher les meilleurs prix!</div>
        {[["Top 3","Skin Légende + Titre Doré + Robot War-Bot","🥇"],["Top 10","Skin Platine + Boost ×2 permanent","🥈"],["Top 50","Badge Saison + 500 Crédits bonus","🎖️"],["Tous","Badge Participant + 200 Crédits","🏅"]].map(([r,d,e])=>(
          <div key={r} style={{display:"flex",gap:10,padding:"8px 0",borderBottom:`1px solid ${C.brd}`,alignItems:"flex-start"}}>
            <span style={{fontSize:18,flexShrink:0}}>{e}</span>
            <div><div style={{fontSize:12,color:"#ffe600"}}>{r}</div><div style={{fontSize:10,color:"#445"}}>{d}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ MENU PRINCIPAL ═════════════════════
function MenuButton({ color, emoji, label, sub, onClick }) {
  return (
    <button onClick={onClick} className="rip" style={{
      background:`linear-gradient(135deg, ${color}1a 0%, ${color}33 100%)`,
      border:`1px solid ${color}88`,
      borderRadius:14, padding:"14px 18px",
      cursor:"pointer", display:"flex", alignItems:"center", gap:14, width:"100%",
      transition:"all .25s ease", textAlign:"left",
      boxShadow:`0 0 24px ${color}26, inset 0 0 24px ${color}10`,
      fontFamily:"'Rajdhani',sans-serif",
      backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)",
    }}>
      <div style={{fontSize:34, filter:`drop-shadow(0 0 10px ${color}aa)`, flexShrink:0}}>{emoji}</div>
      <div style={{flex:1, minWidth:0}}>
        <div className="orb" style={{fontSize:15, color, letterSpacing:3, fontWeight:700, textShadow:`0 0 10px ${color}66`}}>{label}</div>
        <div style={{fontSize:11, color:"#94a3b8", marginTop:3, letterSpacing:0.4}}>{sub}</div>
      </div>
      <div className="orb" style={{color, fontSize:24, opacity:0.8, fontWeight:300}}>›</div>
    </button>
  );
}

function MainMenu({ setScreen, profile, C }) {
  const stars = useMemo(() =>
    Array.from({length: 80}).map(() => ({
      x: Math.random() * 100,
      size: Math.random() * 1.8 + 0.5,
      duration: 6 + Math.random() * 14,
      delay: -Math.random() * 20,
      opacity: Math.random() * 0.7 + 0.3,
      color: Math.random() > 0.86 ? "#00f5d4" : Math.random() > 0.74 ? "#b347ff" : "#ffffff",
    })), []);

  const streaks = useMemo(() =>
    Array.from({length: 10}).map(() => ({
      x: Math.random() * 100,
      duration: 1.8 + Math.random() * 3,
      delay: -Math.random() * 8,
    })), []);

  return (
    <div style={{
      position:"fixed", inset:0,
      background:"radial-gradient(ellipse 100% 70% at 50% 25%, #0f1f3a 0%, #050a18 50%, #02050a 100%)",
      overflow:"hidden", zIndex:9999,
      fontFamily:"'Rajdhani',sans-serif",
    }}>
      <div style={{
        width:"100%", maxWidth:480, height:"100%",
        margin:"0 auto", position:"relative", overflow:"hidden",
        display:"flex", flexDirection:"column",
      }}>
        {/* Top bar with profile + settings */}
        <div style={{
          position:"absolute", top:0, left:0, right:0, padding:"14px 16px",
          display:"flex", justifyContent:"space-between", alignItems:"center",
          zIndex:10, pointerEvents:"none",
        }}>
          <div style={{
            background:"rgba(13,24,40,0.7)", border:`1px solid ${C.cy}33`,
            borderRadius:18, padding:"5px 12px", display:"flex", alignItems:"center", gap:6,
            backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)",
            pointerEvents:"auto",
          }}>
            <span style={{fontSize:14}}>👤</span>
            <span className="orb" style={{fontSize:11, color:C.cy, letterSpacing:1}}>{profile?.username || "PLAYER"}</span>
          </div>
          <button onClick={() => setScreen("settings")} className="rip" style={{
            background:"rgba(13,24,40,0.7)", border:`1px solid ${C.cy}33`,
            borderRadius:18, width:36, height:36, color:C.cy, fontSize:16, cursor:"pointer",
            backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)",
            pointerEvents:"auto",
          }}>⚙️</button>
        </div>

        {/* Stars layer */}
        {stars.map((s, i) => (
          <div key={`s${i}`} style={{
            position:"absolute", left:`${s.x}%`, top:0,
            width:s.size, height:s.size, borderRadius:"50%",
            background:s.color, opacity:s.opacity,
            boxShadow:`0 0 ${s.size*3}px ${s.color}`,
            animation:`starFall ${s.duration}s linear infinite`,
            animationDelay:`${s.delay}s`, zIndex:1,
          }}/>
        ))}
        {/* Streaks (warp effect) */}
        {streaks.map((s, i) => (
          <div key={`st${i}`} style={{
            position:"absolute", left:`${s.x}%`, top:0,
            width:1, height:60,
            background:"linear-gradient(180deg, transparent, #00f5d4 50%, transparent)",
            animation:`streak ${s.duration}s linear infinite`,
            animationDelay:`${s.delay}s`, zIndex:2,
          }}/>
        ))}

        {/* Top horizon glow */}
        <div style={{
          position:"absolute", top:0, left:0, right:0, height:240,
          background:"radial-gradient(ellipse 70% 100% at 50% 0%, rgba(0,245,212,0.18), transparent)",
          pointerEvents:"none", zIndex:1,
        }}/>

        {/* Bottom launch glow */}
        <div style={{
          position:"absolute", bottom:0, left:0, right:0, height:200,
          background:"radial-gradient(ellipse 80% 100% at 50% 100%, rgba(255,140,66,0.22), rgba(255,80,30,0.08) 30%, transparent 60%)",
          pointerEvents:"none", zIndex:1,
        }}/>

        {/* Rocket scene */}
        <div style={{position:"absolute", left:"50%", top:"30%", transform:"translateX(-50%)", zIndex:3, pointerEvents:"none"}}>
          {/* Outer smoke trail */}
          <div style={{
            position:"absolute", left:"50%", top:"82%", transform:"translateX(-50%)",
            width:80, height:240,
            background:"radial-gradient(ellipse 50% 100% at 50% 0%, rgba(255,140,66,0.55) 0%, rgba(255,80,30,0.2) 35%, rgba(80,40,20,0.12) 65%, transparent 100%)",
            filter:"blur(10px)", borderRadius:"50%",
            animation:"flame 0.18s infinite alternate",
          }}/>
          {/* Mid flame */}
          <div style={{
            position:"absolute", left:"50%", top:"86%", transform:"translateX(-50%)",
            width:42, height:140,
            background:"radial-gradient(ellipse 50% 100% at 50% 0%, #ff8c42 0%, #ff5028 50%, transparent 100%)",
            filter:"blur(5px)", borderRadius:"50%",
            animation:"flame 0.12s infinite alternate-reverse",
          }}/>
          {/* Inner core flame */}
          <div style={{
            position:"absolute", left:"50%", top:"88%", transform:"translateX(-50%)",
            width:18, height:80,
            background:"radial-gradient(ellipse 50% 100% at 50% 0%, #ffffff 0%, #ffe600 30%, #ff8c42 70%, transparent 100%)",
            filter:"blur(2px)", borderRadius:"50%",
            animation:"flame 0.08s infinite alternate",
          }}/>
          {/* Rocket emoji */}
          <div style={{
            fontSize:96, lineHeight:1,
            filter:"drop-shadow(0 0 20px rgba(255,140,66,0.7)) drop-shadow(0 0 40px rgba(255,80,30,0.4))",
            animation:"shake 0.09s infinite alternate",
            position:"relative", zIndex:1,
          }}>🚀</div>
        </div>

        {/* Title */}
        <div style={{
          position:"relative", zIndex:5, textAlign:"center",
          marginTop:74, padding:"0 20px",
        }}>
          <div className="orb" style={{
            fontSize:10, color:"#00f5d4", letterSpacing:8, opacity:0.65, fontWeight:400,
          }}>━━━ EST. 2026 ━━━</div>
          <h1 className="orb" style={{
            fontSize:32, letterSpacing:5, fontWeight:900,
            margin:"8px 0 6px", lineHeight:1.05,
            background:"linear-gradient(180deg, #ffffff 0%, #00f5d4 100%)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
            backgroundClip:"text", color:"transparent",
            animation:"ttl 3.5s ease-in-out infinite",
          }}>WORLD<br/>DOMINATION</h1>
          <div style={{
            fontSize:10, color:"#94a3b8", letterSpacing:5, marginTop:6,
            textTransform:"uppercase", fontWeight:600,
          }}>◇ Stratégie · Conquête · Empire ◇</div>
        </div>

        {/* Spacer */}
        <div style={{flex:1, minHeight:60}}/>

        {/* Buttons */}
        <div style={{
          position:"relative", zIndex:5, padding:"20px 22px 36px",
          display:"flex", flexDirection:"column", gap:13,
        }}>
          <MenuButton color="#00f5d4" emoji="🚀" label="DÉMARRER"   sub="Lancer une nouvelle partie"   onClick={() => setScreen("game")}/>
          <MenuButton color="#ffe600" emoji="🏆" label="CLASSEMENT"  sub="Saison 1 · Top joueurs"        onClick={() => setScreen("rank-menu")}/>
          <MenuButton color="#b347ff" emoji="💡" label="SUGGESTIONS" sub="Proposer une idée à la commu"  onClick={() => setScreen("suggestions")}/>
          <div className="orb" style={{textAlign:"center", fontSize:9, color:"#334155", marginTop:6, letterSpacing:3}}>
            v{APP_VERSION}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ SUGGESTIONS ════════════════════════
function SuggestionsScreen({ onBack, profile, blockUser, C }) {
  const [suggs, setSuggs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [voted, setVoted] = useState(new Set());
  const [storageOk, setStorageOk] = useState(true);

  const SEED = useMemo(() => ([
    { id:"sugg:_seed1", text:"Système d'alliance entre joueurs avec chat privé et bonus de groupe", votes:24, date:new Date(Date.now()-86400000*3).toISOString(), seed:true },
    { id:"sugg:_seed2", text:"Mode raid: attaquer une grosse base ennemie en équipe", votes:18, date:new Date(Date.now()-86400000*2).toISOString(), seed:true },
    { id:"sugg:_seed3", text:"Plus de biomes: Toundra glaciale, Volcan actif, Marais toxique", votes:15, date:new Date(Date.now()-86400000*1).toISOString(), seed:true },
    { id:"sugg:_seed4", text:"Personnalisation visuelle de la base avec décorations", votes:9, date:new Date(Date.now()-3600000*5).toISOString(), seed:true },
    { id:"sugg:_seed5", text:"Quêtes journalières avec récompenses uniques", votes:7, date:new Date(Date.now()-3600000*2).toISOString(), seed:true },
  ]), []);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      if (!window.storage) { setSuggs(SEED); setStorageOk(false); setLoading(false); return; }
      const list = await window.storage.list("sugg:", true);
      const items = [];
      if (list && list.keys) {
        for (const key of list.keys) {
          try {
            const data = await window.storage.get(key, true);
            if (data) items.push(JSON.parse(data.value));
          } catch (e) {}
        }
      }
      const merged = [...SEED, ...items].sort((a,b) => b.votes - a.votes);
      setSuggs(merged);
    } catch (e) {
      setSuggs(SEED); setStorageOk(false);
    }
    setLoading(false);
  };

  const submit = async () => {
    const text = input.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    const id = `sugg:${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`;
    const sug = { id, text: text.slice(0, 200), votes: 1, date: new Date().toISOString() };
    try {
      if (window.storage) await window.storage.set(id, JSON.stringify(sug), true);
      setSuggs(arr => [...arr, sug].sort((a,b) => b.votes - a.votes));
      setVoted(v => new Set([...v, id]));
      setInput("");
    } catch (e) { setStorageOk(false); }
    setSubmitting(false);
  };

  const upvote = async (s) => {
    if (voted.has(s.id) || s.seed) {
      // Allow upvoting seeds locally for fun
      if (s.seed && !voted.has(s.id)) {
        const updated = { ...s, votes: s.votes + 1 };
        setSuggs(arr => arr.map(x => x.id === s.id ? updated : x).sort((a,b) => b.votes - a.votes));
        setVoted(v => new Set([...v, s.id]));
      }
      return;
    }
    const updated = { ...s, votes: s.votes + 1 };
    try {
      if (window.storage) await window.storage.set(s.id, JSON.stringify(updated), true);
      setSuggs(arr => arr.map(x => x.id === s.id ? updated : x).sort((a,b) => b.votes - a.votes));
      setVoted(v => new Set([...v, s.id]));
    } catch (e) {}
  };

  const fmtDate = (iso) => {
    const d = new Date(iso); const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return "à l'instant";
    if (diff < 3600) return `il y a ${Math.floor(diff/60)}m`;
    if (diff < 86400) return `il y a ${Math.floor(diff/3600)}h`;
    return `il y a ${Math.floor(diff/86400)}j`;
  };

  return (
    <div style={{
      minHeight:"100vh", maxWidth:480, margin:"0 auto",
      fontFamily:"'Rajdhani',sans-serif", color:"#dde4f0",
      padding:"16px 14px 40px", position:"relative", zIndex:1,
    }}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
        <button onClick={onBack} className="rip" style={{
          background:"#0d1828", border:`1px solid ${C.brd}`, borderRadius:10,
          width:38, height:38, color:C.cy, fontSize:18, cursor:"pointer", flexShrink:0,
        }}>←</button>
        <div style={{flex:1}}>
          <div className="orb" style={{fontSize:15, color:C.pu, letterSpacing:3, textShadow:`0 0 14px ${C.pu}66`}}>
            💡 SUGGESTIONS
          </div>
          <div style={{fontSize:11, color:"#64748b"}}>Idées de la communauté pour le jeu</div>
        </div>
      </div>

      {/* New idea form */}
      <div style={{
        background:`linear-gradient(135deg, ${C.card}, #1a0a2a)`,
        border:`1px solid ${C.pu}55`, borderRadius:12,
        padding:14, marginBottom:14,
        boxShadow:`0 0 22px ${C.pu}1a`,
      }}>
        <div className="orb" style={{fontSize:10, color:C.pu, marginBottom:8, letterSpacing:2}}>
          ✏️ NOUVELLE IDÉE
        </div>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value.slice(0, 200))}
          placeholder="Une nouvelle feature ? Un bâtiment ? Une mécanique ? Décris ton idée..."
          maxLength={200}
          style={{
            width:"100%", minHeight:78,
            background:"#040810", border:`1px solid ${C.brd}`, borderRadius:8,
            padding:"10px 12px", color:"#dde4f0", fontSize:13,
            fontFamily:"'Rajdhani',sans-serif", resize:"none", outline:"none",
            transition:"border-color .2s",
          }}
          onFocus={(e) => e.target.style.borderColor = C.pu}
          onBlur={(e) => e.target.style.borderColor = C.brd}
        />
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10}}>
          <span style={{fontSize:10,color:"#445"}}>{input.length}/200</span>
          <button onClick={submit} disabled={!input.trim() || submitting} className="rip" style={{
            background: input.trim() ? `linear-gradient(135deg, ${C.pu}22, ${C.pu}45)` : "#1e3a5f",
            border:`1px solid ${input.trim() ? `${C.pu}88` : "#445"}`,
            borderRadius:8, padding:"7px 18px",
            color: input.trim() ? C.pu : "#475569",
            fontSize:12, cursor: input.trim() ? "pointer" : "not-allowed",
            fontFamily:"'Rajdhani',sans-serif", fontWeight:700, letterSpacing:1.5,
          }}>
            {submitting ? "..." : "📤 ENVOYER"}
          </button>
        </div>
      </div>

      {!storageOk && (
        <div style={{background:"#1a0d05",border:"1px solid #fbbf2444",borderRadius:8,padding:"8px 10px",marginBottom:14,fontSize:10,color:"#fbbf24"}}>
          ⚠️ Stockage en lecture seule — vos idées sont visibles localement.
        </div>
      )}

      <div style={{
        background:"#0d1828", border:`1px solid ${C.brd}`, borderRadius:8,
        padding:"8px 10px", marginBottom:14, fontSize:10, color:"#64748b",
      }}>
        ℹ️ Vos idées sont partagées avec tous les joueurs. Votez pour les meilleures !
      </div>

      <div className="orb" style={{fontSize:10, color:C.cy, marginBottom:10, letterSpacing:2,display:"flex",justifyContent:"space-between"}}>
        <span>◆ TOP IDÉES ({suggs.length})</span>
        <span style={{color:"#445"}}>TRIÉ PAR VOTES</span>
      </div>

      {loading && <div style={{textAlign:"center",color:"#475569",padding:30}}>Chargement...</div>}

      {!loading && suggs.length === 0 && (
        <div style={{
          textAlign:"center", color:"#475569", padding:40,
          background:C.card, borderRadius:12, border:`1px dashed ${C.brd}`,
        }}>
          <div style={{fontSize:42,marginBottom:8}}>💭</div>
          <div style={{fontSize:13}}>Aucune idée pour le moment.<br/>Sois le premier à en proposer !</div>
        </div>
      )}

      {suggs.map((s, i) => {
        const v = voted.has(s.id);
        const isTop = i < 3;
        return (
          <div key={s.id} style={{
            background: isTop ? `linear-gradient(135deg, ${C.card}, ${C.pu}10)` : C.card,
            border:`1px solid ${isTop ? `${C.pu}33` : C.brd}`, borderRadius:12,
            padding:12, marginBottom:8, display:"flex", gap:11, alignItems:"center",
            position:"relative", overflow:"hidden",
          }}>
            {isTop && (
              <div style={{
                position:"absolute", top:6, right:8, fontSize:9, color:C.pu,
                fontFamily:"Orbitron", letterSpacing:1.5,
              }}>TOP {i+1}</div>
            )}
            <div style={{width:38,textAlign:"center",flexShrink:0}}>
              <button onClick={() => upvote(s)} disabled={v} className="rip" style={{
                background: v ? "#0a1f12" : "#040810",
                border:`1px solid ${v ? "#4ade80" : C.brd}`,
                borderRadius:8, padding:"4px 0", width:38, cursor: v ? "default" : "pointer",
                color: v ? "#4ade80" : "#94a3b8", fontSize:14, transition:"all .2s",
              }}>▲</button>
              <div className="orb" style={{fontSize:13, color: v ? "#4ade80" : "#94a3b8", marginTop:3, fontWeight:700}}>{s.votes}</div>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,color:"#dde4f0",lineHeight:1.42,wordBreak:"break-word"}}>{s.text}</div>
              <div style={{fontSize:10,color:"#445",marginTop:5,display:"flex",gap:6,alignItems:"center"}}>
                <span>#{i+1}</span>·<span>{fmtDate(s.date)}</span>{s.seed && <><span>·</span><span style={{color:C.pu}}>communauté</span></>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════ CLASSEMENT MENU ════════════════════
function RankMenuScreen({ onBack, profile, C }) {
  const lb = [
    { name:"NEXUS_7",     rp:8492, c:42, country:"🇫🇷" },
    { name:"VOID_KING",   rp:6321, c:34, country:"🇺🇸" },
    { name:"ALPHA_RISE",  rp:5891, c:31, country:"🇯🇵" },
    { name:"STORM_X",     rp:4108, c:28, country:"🇩🇪" },
    { name:"OMEGA_FIVE",  rp:3892, c:25, country:"🇧🇷" },
    { name:"PHANTOM_OPS", rp:3241, c:22, country:"🇰🇷" },
    { name:"CIPHER_999",  rp:2890, c:19, country:"🇨🇦" },
    { name:"DELTA_NINE",  rp:2108, c:14, country:"🇪🇸" },
    { name:"ECHO_ONE",    rp:1450, c:11, country:"🇮🇹" },
    { name:"VEIL_BREAKER",rp:980,  c:8,  country:"🇲🇽" },
  ];

  const lg = (rp) => [...LEAGUES].reverse().find(l => rp >= l.min) || LEAGUES[0];

  const seasonEnd = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
  }, []);

  const [countdown, setCountdown] = useState("");
  useEffect(() => {
    const t = setInterval(() => {
      const diff = seasonEnd - new Date();
      const d = Math.floor(diff / (86400000));
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(`${d}j ${h.toString().padStart(2,"0")}h ${m.toString().padStart(2,"0")}m ${s.toString().padStart(2,"0")}s`);
    }, 1000);
    return () => clearInterval(t);
  }, [seasonEnd]);

  return (
    <div style={{
      minHeight:"100vh", maxWidth:480, margin:"0 auto",
      fontFamily:"'Rajdhani',sans-serif", color:"#dde4f0",
      padding:"16px 14px 40px", position:"relative", zIndex:1,
    }}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
        <button onClick={onBack} className="rip" style={{
          background:"#0d1828", border:`1px solid ${C.brd}`, borderRadius:10,
          width:38, height:38, color:C.cy, fontSize:18, cursor:"pointer", flexShrink:0,
        }}>←</button>
        <div style={{flex:1}}>
          <div className="orb" style={{fontSize:15, color:C.ye, letterSpacing:3, textShadow:`0 0 14px ${C.ye}66`}}>
            🏆 CLASSEMENT SAISON 1
          </div>
          <div style={{fontSize:11, color:"#64748b"}}>Top mondial · Reset hebdomadaire</div>
        </div>
      </div>

      {/* Season info */}
      <div style={{
        background:`linear-gradient(135deg, ${C.card}, #1a1500)`,
        border:`1px solid ${C.ye}44`, borderRadius:12,
        padding:14, marginBottom:14,
        boxShadow:`0 0 22px ${C.ye}1a`, textAlign:"center",
      }}>
        <div className="orb" style={{fontSize:10, color:C.ye, letterSpacing:3, marginBottom:5}}>⏱️ FIN DE SAISON DANS</div>
        <div className="orb" style={{fontSize:22, color:"#fff", letterSpacing:2, textShadow:`0 0 18px ${C.ye}88`}}>
          {countdown}
        </div>
        <div style={{fontSize:10, color:"#64748b", marginTop:6, letterSpacing:1}}>
          Les meilleurs joueurs gagnent skins exclusifs et boosts permanents
        </div>
      </div>

      {/* Top 3 podium */}
      <div style={{display:"flex",gap:8,marginBottom:14,alignItems:"flex-end"}}>
        {[1,0,2].map(idx => {
          const p = lb[idx]; const l = lg(p.rp);
          const heights = [110, 130, 95]; const order = idx===0?1:idx===1?0:2;
          const podiumCols = ["#c0c0c0","#ffd700","#cd7f32"];
          return (
            <div key={p.name} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center"}}>
              <div style={{fontSize:28,marginBottom:4,filter:`drop-shadow(0 0 12px ${podiumCols[idx]}88)`}}>{l.e}</div>
              <div className="orb" style={{fontSize:10,color:"#fff",marginBottom:2,textAlign:"center",wordBreak:"break-all"}}>{p.name.length>10?p.name.slice(0,10)+"...":p.name}</div>
              <div className="orb" style={{fontSize:11,color:l.col,marginBottom:6}}>{p.rp}</div>
              <div style={{
                width:"100%", height:heights[idx],
                background:`linear-gradient(180deg, ${podiumCols[idx]}55, ${podiumCols[idx]}11)`,
                border:`1.5px solid ${podiumCols[idx]}88`, borderRadius:"6px 6px 0 0",
                display:"flex",alignItems:"flex-start",justifyContent:"center",paddingTop:6,
                boxShadow:`0 0 20px ${podiumCols[idx]}44, inset 0 0 14px ${podiumCols[idx]}22`,
              }}>
                <div className="orb" style={{fontSize:22,color:podiumCols[idx],fontWeight:900,textShadow:`0 0 8px ${podiumCols[idx]}`}}>
                  {idx+1}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="orb" style={{fontSize:10, color:C.cy, marginBottom:10, letterSpacing:2}}>
        ◆ CLASSEMENT GLOBAL
      </div>

      {/* Full list */}
      {lb.map((p, i) => {
        const l = lg(p.rp);
        return (
          <div key={p.name} style={{
            display:"flex", alignItems:"center", gap:11,
            padding:"10px 12px", borderRadius:10, marginBottom:6,
            background: i<3 ? `linear-gradient(90deg, ${C.card}, ${l.col}15)` : C.card,
            border:`1px solid ${i<3?l.col+"44":C.brd}`,
            boxShadow: i<3 ? `0 0 12px ${l.col}22` : "none",
          }}>
            <div className="orb" style={{
              fontSize:14, color: i===0?"#ffd700":i===1?"#c0c0c0":i===2?"#cd7f32":"#475569",
              minWidth:24, fontWeight:700, textAlign:"center",
            }}>#{i+1}</div>
            <span style={{fontSize:18,filter:`drop-shadow(0 0 6px ${l.col}66)`}}>{l.e}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,color:"#dde4f0",display:"flex",alignItems:"center",gap:6}}>
                <span>{p.country}</span>
                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</span>
              </div>
              <div style={{fontSize:10,color:"#445"}}>{p.c} zones · {l.name}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div className="orb" style={{fontSize:12,color:l.col,fontWeight:700}}>{p.rp}</div>
              <div style={{fontSize:9,color:"#445"}}>RP</div>
            </div>
          </div>
        );
      })}

      {/* Rewards */}
      <div style={{
        marginTop:14,
        background:`linear-gradient(135deg, ${C.card}, #1a1500)`,
        border:`1px solid ${C.ye}33`, borderRadius:12, padding:14,
      }}>
        <div className="orb" style={{fontSize:10, color:C.ye, marginBottom:10, letterSpacing:2}}>
          🎁 RÉCOMPENSES SAISON 1
        </div>
        {[
          ["🥇","Top 1-3","Skin Légende + Titre Doré + Robot War-Bot rare"],
          ["🥈","Top 4-10","Skin Platine + Boost ×2 permanent (1 saison)"],
          ["🥉","Top 11-50","Skin Or + 1000 Crédits bonus"],
          ["🎖️","Tous","Badge Saison 1 + 200 Crédits"],
        ].map(([e,r,d])=>(
          <div key={r} style={{display:"flex",gap:11,padding:"9px 0",borderBottom:`1px solid ${C.brd}`,alignItems:"center"}}>
            <span style={{fontSize:22,flexShrink:0}}>{e}</span>
            <div style={{flex:1}}>
              <div style={{fontSize:12,color:C.ye,fontWeight:700}}>{r}</div>
              <div style={{fontSize:11,color:"#94a3b8",marginTop:1}}>{d}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ LOADING SCREEN ═════════════════════
function LoadingScreen({ C }) {
  return (
    <div style={{
      position:"fixed", inset:0,
      background:"radial-gradient(ellipse at 50% 30%, #0f1f3a, #050a18)",
      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      fontFamily:"'Rajdhani',sans-serif", zIndex:9999,
    }}>
      <div style={{fontSize:64, animation:"shake 0.1s infinite alternate", filter:`drop-shadow(0 0 18px ${C.cy})`}}>🚀</div>
      <div className="orb" style={{color:C.cy, fontSize:14, letterSpacing:5, marginTop:18, animation:"ttl 1.5s ease-in-out infinite"}}>
        CHARGEMENT...
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ WELCOME / ONBOARDING ═══════════════
function WelcomeFlow({ onComplete, C }) {
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState("");
  const [unameErr, setUnameErr] = useState(null);
  const [ageOk, setAgeOk] = useState(false);
  const [eulaAccepted, setEulaAccepted] = useState(false);
  const [tutStep, setTutStep] = useState(0);

  const TUTORIAL = [
    {
      e:"🌍", title:"Bienvenue dans World Domination",
      text:"Tu commences avec une petite base abandonnée dans un monde post-apocalyptique. Ton objectif : conquérir la carte entière et devenir la puissance la plus redoutée de la galaxie.",
      col:"#00f5d4",
    },
    {
      e:"🗺️", title:"La carte stratégique",
      text:"La carte est divisée en zones. Les zones entourées en doré sont directement capturables (adjacentes à ton territoire). Clique dessus pour voir leur contenu et les capturer !",
      col:"#a07820",
    },
    {
      e:"⛏️", title:"Tes travailleurs",
      text:"Recrute des Mineurs pour produire des ressources, des Ingénieurs pour débloquer des technologies, et des Défenseurs pour gagner les combats. Plus tu en as, plus tu es puissant.",
      col:"#60a5fa",
    },
    {
      e:"⚔️", title:"Combats & Raids",
      text:"Des ennemis attaqueront tes zones régulièrement. Quand une alerte raid apparaît, tu as 20 secondes pour envoyer tes brigades défendre ! Si tu ne défends pas, tu perds la zone.",
      col:"#ef4444",
    },
    {
      e:"🎰", title:"Casino & Coffres",
      text:"Des coffres magiques apparaissent pendant la partie avec des récompenses aléatoires (ouvre-les après une pub). Le Casino te permet de parier tes ressources pour en gagner plus !",
      col:"#fbbf24",
    },
    {
      e:"⭐", title:"Le Prestige",
      text:"Une fois toute la carte débloquée et 70% des zones capturées, tu peux faire un Prestige. Tu recommences avec des bonus permanents et des travailleurs supplémentaires dès le départ !",
      col:"#b347ff",
    },
  ];

  const finish = () => {
    onComplete({
      username: username.trim(),
      ageOk: true,
      eulaAccepted: true,
      blockedUsers: [],
      createdAt: new Date().toISOString(),
    });
  };

  const validateAndNext = () => {
    const err = validateUsername(username);
    if (err) { setUnameErr(err); return; }
    setUnameErr(null);
    setStep(1);
  };

  return (
    <div style={{
      minHeight:"100vh", maxWidth:480, margin:"0 auto",
      fontFamily:"'Rajdhani',sans-serif", color:"#dde4f0",
      padding:"30px 20px 30px", display:"flex", flexDirection:"column",
      background:"radial-gradient(ellipse at 50% 0%, #0f1f3a, #050a18)",
      position:"relative", zIndex:1,
    }}>
      {/* Progress dots */}
      <div style={{display:"flex", justifyContent:"center", gap:8, marginBottom:30}}>
        {[0,1,2].map(i => (
          <div key={i} style={{
            width: i === step ? 28 : 8, height:8, borderRadius:4,
            background: i <= step ? C.cy : C.brd, transition:"all .3s",
          }}/>
        ))}
      </div>

      {step === 0 && (
        <>
          <div style={{textAlign:"center", marginBottom:24}}>
            <div style={{fontSize:64, marginBottom:14}}>👋</div>
            <h1 className="orb" style={{fontSize:22, color:C.cy, letterSpacing:3, marginBottom:8, textShadow:`0 0 14px ${C.cy}66`}}>
              BIENVENUE
            </h1>
            <div style={{fontSize:13, color:"#94a3b8", lineHeight:1.5}}>
              Choisissez un pseudo pour rejoindre la communauté
            </div>
          </div>
          <div style={{flex:1}}>
            <label style={{fontSize:11, color:C.cy, letterSpacing:1.5, display:"block", marginBottom:8, fontFamily:"Orbitron"}}>
              PSEUDO
            </label>
            <input
              value={username}
              onChange={e => { setUsername(e.target.value); setUnameErr(null); }}
              placeholder="ex: COMMANDER_X"
              maxLength={16}
              style={{
                width:"100%", background:"#040810",
                border:`1.5px solid ${unameErr?"#ef4444":C.brd}`,
                borderRadius:10, padding:"14px 16px",
                color:"#fff", fontSize:16, outline:"none",
                fontFamily:"'Rajdhani',sans-serif", fontWeight:600,
                letterSpacing:1,
              }}
            />
            {unameErr && <div style={{fontSize:12, color:"#ef4444", marginTop:8}}>⚠️ {unameErr}</div>}
            <div style={{fontSize:11, color:"#475569", marginTop:8, lineHeight:1.5}}>
              3-16 caractères · Lettres, chiffres, _ et - uniquement · Pas de contenu offensant
            </div>
          </div>
          <button onClick={validateAndNext} className="rip" style={{
            background:`linear-gradient(135deg, ${C.cy}22, ${C.cy}55)`,
            border:`1px solid ${C.cy}`, borderRadius:12,
            padding:"16px", color:C.cy, fontSize:14,
            cursor:"pointer", fontFamily:"'Rajdhani',sans-serif",
            fontWeight:700, letterSpacing:3,
            boxShadow:`0 0 22px ${C.cy}33`,
          }}>CONTINUER →</button>
        </>
      )}

      {step === 1 && (
        <>
          <div style={{textAlign:"center", marginBottom:20}}>
            <div style={{fontSize:60, marginBottom:14}}>🛡️</div>
            <h1 className="orb" style={{fontSize:18, color:C.cy, letterSpacing:2, marginBottom:8}}>
              VÉRIFICATION D'ÂGE
            </h1>
          </div>
          <div style={{flex:1}}>
            <div style={{
              background:C.card, border:`1px solid ${C.brd}`, borderRadius:12,
              padding:18, fontSize:13, color:"#94a3b8", lineHeight:1.6, marginBottom:16,
            }}>
              Cette application contient un système de communauté permettant aux utilisateurs de partager des suggestions. Pour utiliser ce service, vous devez confirmer avoir au moins 13 ans (16 ans dans l'UE).
              <br/><br/>
              <strong style={{color:"#fff"}}>Note :</strong> Si vous êtes mineur, demandez à un parent ou tuteur de valider l'utilisation de cette application.
            </div>
            <label style={{
              display:"flex", alignItems:"flex-start", gap:12, padding:14,
              background: ageOk ? `${C.cy}11` : C.card,
              border:`1.5px solid ${ageOk?C.cy:C.brd}`, borderRadius:12,
              cursor:"pointer", transition:"all .2s",
            }}>
              <input type="checkbox" checked={ageOk} onChange={e => setAgeOk(e.target.checked)} style={{
                marginTop:3, width:18, height:18, cursor:"pointer", accentColor:C.cy,
              }}/>
              <div style={{fontSize:13, color: ageOk?"#fff":"#94a3b8", lineHeight:1.5}}>
                <strong style={{color:ageOk?C.cy:"#dde4f0"}}>Je confirme avoir 13 ans ou plus</strong>
                <div style={{fontSize:11, color:"#64748b", marginTop:3}}>
                  (16 ans pour les résidents de l'UE)
                </div>
              </div>
            </label>
          </div>
          <div style={{display:"flex", gap:8}}>
            <button onClick={() => setStep(0)} style={{
              padding:"14px 18px", background:"#0d1828", border:`1px solid ${C.brd}`,
              borderRadius:10, color:"#94a3b8", fontSize:13, cursor:"pointer",
              fontFamily:"'Rajdhani',sans-serif",
            }}>← Retour</button>
            <button onClick={() => ageOk && setStep(2)} disabled={!ageOk} className="rip" style={{
              flex:1, background: ageOk ? `linear-gradient(135deg, ${C.cy}22, ${C.cy}55)` : "#1e3a5f",
              border:`1px solid ${ageOk?C.cy:"#445"}`, borderRadius:10,
              padding:"14px", color: ageOk?C.cy:"#475569", fontSize:13,
              cursor: ageOk?"pointer":"not-allowed", fontFamily:"'Rajdhani',sans-serif",
              fontWeight:700, letterSpacing:2,
            }}>CONTINUER →</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div style={{textAlign:"center", marginBottom:18}}>
            <div style={{fontSize:60, marginBottom:14}}>📜</div>
            <h1 className="orb" style={{fontSize:16, color:C.cy, letterSpacing:2, marginBottom:8}}>
              CONDITIONS D'UTILISATION
            </h1>
          </div>
          <div style={{flex:1, overflowY:"auto", maxHeight:"50vh"}}>
            <div style={{
              background:C.card, border:`1px solid ${C.brd}`, borderRadius:12,
              padding:16, fontSize:12, color:"#94a3b8", lineHeight:1.6, marginBottom:14,
            }}>
              <strong style={{color:"#fff", display:"block", marginBottom:8}}>RÈGLES DE LA COMMUNAUTÉ</strong>
              En utilisant cette application, vous acceptez de :
              <ul style={{paddingLeft:18, marginTop:8, marginBottom:12}}>
                <li>Ne pas publier de contenu offensant, haineux, sexuel ou illégal</li>
                <li>Ne pas harceler ou insulter d'autres utilisateurs</li>
                <li>Ne pas usurper l'identité d'autres personnes</li>
                <li>Respecter le droit d'auteur et la propriété intellectuelle</li>
                <li>Signaler tout contenu inapproprié rencontré</li>
              </ul>
              <strong style={{color:"#fff", display:"block", marginBottom:8}}>MODÉRATION</strong>
              Tout contenu signalé est examiné sous 24h. Les contrevenants peuvent être bannis sans préavis. Les utilisateurs peuvent bloquer d'autres comptes à tout moment.
              <br/><br/>
              <strong style={{color:"#fff", display:"block", marginBottom:8}}>TOLÉRANCE ZÉRO</strong>
              Pour tout comportement abusif, contenu sexuel impliquant des mineurs, propos haineux ou incitation à la violence.
            </div>
            <label style={{
              display:"flex", alignItems:"flex-start", gap:12, padding:14,
              background: eulaAccepted ? `${C.cy}11` : C.card,
              border:`1.5px solid ${eulaAccepted?C.cy:C.brd}`, borderRadius:12,
              cursor:"pointer", transition:"all .2s",
            }}>
              <input type="checkbox" checked={eulaAccepted} onChange={e => setEulaAccepted(e.target.checked)} style={{
                marginTop:3, width:18, height:18, cursor:"pointer", accentColor:C.cy,
              }}/>
              <div style={{fontSize:12, color: eulaAccepted?"#fff":"#94a3b8", lineHeight:1.5}}>
                <strong style={{color:eulaAccepted?C.cy:"#dde4f0"}}>J'accepte les conditions d'utilisation et la politique de confidentialité</strong>
              </div>
            </label>
          </div>
          <div style={{display:"flex", gap:8, marginTop:14}}>
            <button onClick={() => setStep(1)} style={{
              padding:"14px 18px", background:"#0d1828", border:`1px solid ${C.brd}`,
              borderRadius:10, color:"#94a3b8", fontSize:13, cursor:"pointer",
              fontFamily:"'Rajdhani',sans-serif",
            }}>← Retour</button>
            <button onClick={() => eulaAccepted && setStep(3)} disabled={!eulaAccepted} className="rip" style={{
              flex:1, background: eulaAccepted ? `linear-gradient(135deg, ${C.cy}22, ${C.cy}55)` : "#1e3a5f",
              border:`1px solid ${eulaAccepted?C.cy:"#445"}`, borderRadius:10,
              padding:"14px", color: eulaAccepted?C.cy:"#475569", fontSize:13,
              cursor: eulaAccepted?"pointer":"not-allowed", fontFamily:"'Rajdhani',sans-serif",
              fontWeight:700, letterSpacing:2,
            }}>CONTINUER →</button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          {/* Progress dots — 4 dots now */}
          <div style={{display:"flex", justifyContent:"center", gap:8, marginBottom:24}}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{
                width: i===3?28:8, height:8, borderRadius:4,
                background: i<=3 ? C.cy : C.brd, transition:"all .3s",
              }}/>
            ))}
          </div>

          <div style={{textAlign:"center", marginBottom:16}}>
            <div style={{fontSize:56, marginBottom:10, filter:`drop-shadow(0 0 14px ${TUTORIAL[tutStep].col})`}}>
              {TUTORIAL[tutStep].e}
            </div>
            <div className="orb" style={{
              fontSize:16, color:TUTORIAL[tutStep].col, letterSpacing:2,
              marginBottom:10, textShadow:`0 0 10px ${TUTORIAL[tutStep].col}66`,
            }}>{TUTORIAL[tutStep].title}</div>
            <div style={{
              fontSize:13, color:"#94a3b8", lineHeight:1.6, padding:"0 4px",
            }}>{TUTORIAL[tutStep].text}</div>
          </div>

          {/* Tutorial progress dots */}
          <div style={{display:"flex", justifyContent:"center", gap:6, marginBottom:20}}>
            {TUTORIAL.map((_,i)=>(
              <div key={i} onClick={()=>setTutStep(i)} style={{
                width: i===tutStep?22:8, height:8, borderRadius:4, cursor:"pointer",
                background: i===tutStep ? TUTORIAL[tutStep].col : i<tutStep ? "#334155" : "#1e3a5f",
                transition:"all .3s",
              }}/>
            ))}
          </div>

          {/* Navigation */}
          <div style={{display:"flex", gap:8}}>
            {tutStep > 0 && (
              <button onClick={()=>setTutStep(t=>t-1)} style={{
                padding:"14px 18px", background:"#0d1828", border:`1px solid ${C.brd}`,
                borderRadius:10, color:"#94a3b8", fontSize:13, cursor:"pointer",
                fontFamily:"'Rajdhani',sans-serif",
              }}>← Préc.</button>
            )}
            <button
              onClick={()=> tutStep < TUTORIAL.length-1 ? setTutStep(t=>t+1) : finish()}
              className="rip"
              style={{
                flex:1, padding:"14px",
                background:`linear-gradient(135deg, ${TUTORIAL[tutStep].col}22, ${TUTORIAL[tutStep].col}55)`,
                border:`1px solid ${TUTORIAL[tutStep].col}`,
                borderRadius:10, color:"#fff", fontSize:13, cursor:"pointer",
                fontFamily:"'Rajdhani',sans-serif", fontWeight:700, letterSpacing:2,
                boxShadow:`0 0 14px ${TUTORIAL[tutStep].col}44`,
              }}
            >
              {tutStep < TUTORIAL.length-1 ? "Suivant →" : "🚀 JOUER !"}
            </button>
          </div>
          <div style={{textAlign:"center",fontSize:10,color:"#2a3a4a",marginTop:10}}>
            {tutStep+1} / {TUTORIAL.length}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════ LEGAL PAGE WRAPPER ═════════════════
function LegalPage({ title, color, onBack, children, C }) {
  return (
    <div style={{
      minHeight:"100vh", maxWidth:480, margin:"0 auto",
      fontFamily:"'Rajdhani',sans-serif", color:"#dde4f0",
      padding:"16px 14px 40px", position:"relative", zIndex:1,
    }}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
        <button onClick={onBack} className="rip" style={{
          background:"#0d1828", border:`1px solid ${C.brd}`, borderRadius:10,
          width:38, height:38, color:C.cy, fontSize:18, cursor:"pointer", flexShrink:0,
        }}>←</button>
        <div style={{flex:1}}>
          <div className="orb" style={{fontSize:14, color, letterSpacing:2, textShadow:`0 0 14px ${color}66`}}>
            {title}
          </div>
        </div>
      </div>
      <div style={{
        background:C.card, border:`1px solid ${C.brd}`, borderRadius:12,
        padding:18, fontSize:13, color:"#94a3b8", lineHeight:1.7,
      }}>{children}</div>
    </div>
  );
}

// ═══════════════════════════════════════ PRIVACY POLICY ═════════════════════
function PrivacyPolicyScreen({ onBack, C }) {
  return (
    <LegalPage title="🔒 POLITIQUE DE CONFIDENTIALITÉ" color={C.cy} onBack={onBack} C={C}>
      <p style={{color:"#64748b", fontSize:11, marginBottom:14}}>Dernière mise à jour : Mai 2026 · Version {APP_VERSION}</p>

      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>1. DONNÉES COLLECTÉES</h3>
      <p style={{marginBottom:14}}>Nous collectons uniquement les données nécessaires au fonctionnement du jeu :</p>
      <ul style={{paddingLeft:20, marginBottom:14}}>
        <li>Pseudo choisi (stocké localement sur votre appareil)</li>
        <li>Progression de jeu (locale)</li>
        <li>Suggestions publiées et votes (avec votre pseudo associé)</li>
        <li>Liste des utilisateurs bloqués (locale)</li>
      </ul>

      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>2. AUCUNE DONNÉE PERSONNELLE</h3>
      <p style={{marginBottom:14}}>Nous ne collectons <strong>aucune</strong> donnée personnelle identifiante : pas d'email, pas de numéro de téléphone, pas de localisation, pas de carnet d'adresses, pas de tracking publicitaire.</p>

      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>3. STOCKAGE LOCAL</h3>
      <p style={{marginBottom:14}}>Toutes vos données de progression sont stockées localement sur votre appareil via le système de stockage sécurisé d'iOS. Aucun envoi vers un serveur externe.</p>

      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>4. CONTENU PUBLIÉ</h3>
      <p style={{marginBottom:14}}>Les suggestions que vous publiez dans la section communautaire sont visibles par les autres joueurs. Elles sont associées à votre pseudo. Vous pouvez supprimer toutes vos données via Réglages → Supprimer mes données.</p>

      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>5. MINEURS</h3>
      <p style={{marginBottom:14}}>L'application est destinée aux 13 ans et plus (16+ dans l'UE). Nous ne collectons sciemment aucune donnée d'enfants en dessous de cet âge.</p>

      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>6. VOS DROITS (RGPD)</h3>
      <p style={{marginBottom:14}}>Vous avez le droit de :</p>
      <ul style={{paddingLeft:20, marginBottom:14}}>
        <li>Accéder à vos données</li>
        <li>Les rectifier ou les supprimer</li>
        <li>Vous opposer à leur traitement</li>
        <li>Retirer votre consentement à tout moment</li>
      </ul>

      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>7. CONTACT</h3>
      <p>Pour toute question : <span style={{color:C.cy}}>{CONTACT_EMAIL}</span></p>
    </LegalPage>
  );
}

// ═══════════════════════════════════════ TERMS OF USE ═══════════════════════
function TermsScreen({ onBack, C }) {
  return (
    <LegalPage title="📜 CONDITIONS D'UTILISATION" color="#fbbf24" onBack={onBack} C={C}>
      <p style={{color:"#64748b", fontSize:11, marginBottom:14}}>Dernière mise à jour : Mai 2026 · Version {APP_VERSION}</p>

      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>1. ACCEPTATION</h3>
      <p style={{marginBottom:14}}>En utilisant World Domination, vous acceptez les présentes conditions. Si vous n'acceptez pas ces conditions, n'utilisez pas l'application.</p>

      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>2. RÈGLES DE LA COMMUNAUTÉ</h3>
      <p style={{marginBottom:8}}>Il est strictement interdit de publier :</p>
      <ul style={{paddingLeft:20, marginBottom:14}}>
        <li>Contenu insultant, harcelant ou menaçant</li>
        <li>Propos haineux, racistes, sexistes ou homophobes</li>
        <li>Contenu sexuel, pornographique ou inapproprié</li>
        <li>Contenu impliquant des mineurs de manière inappropriée</li>
        <li>Spam, contenu commercial non autorisé</li>
        <li>Usurpation d'identité</li>
        <li>Contenu illégal ou violant des droits d'auteur</li>
      </ul>

      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>3. MODÉRATION</h3>
      <p style={{marginBottom:14}}>Tout contenu signalé sera examiné sous 24h par notre équipe. Les contenus contraires aux règles sont supprimés. Les contrevenants peuvent voir leur compte suspendu ou banni définitivement, sans préavis ni remboursement.</p>

      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>4. SIGNALEMENT</h3>
      <p style={{marginBottom:14}}>Chaque utilisateur peut signaler un contenu inapproprié via le menu ⋮ ou bloquer un autre utilisateur. Les utilisateurs bloqués ne peuvent plus interagir avec vous.</p>

      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>5. PROPRIÉTÉ INTELLECTUELLE</h3>
      <p style={{marginBottom:14}}>Tout contenu original publié reste votre propriété, mais vous accordez à l'éditeur une licence non-exclusive d'utilisation au sein de l'application.</p>

      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>6. LIMITATION DE RESPONSABILITÉ</h3>
      <p style={{marginBottom:14}}>L'application est fournie "telle quelle". L'éditeur n'est pas responsable des contenus publiés par les utilisateurs. Le contenu utilisateur ne reflète pas l'opinion de l'éditeur.</p>

      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>7. RÉSILIATION</h3>
      <p style={{marginBottom:14}}>Vous pouvez supprimer votre compte et toutes vos données à tout moment via Réglages → Supprimer mes données. Cette action est irréversible.</p>

      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>8. MODIFICATIONS</h3>
      <p>Ces conditions peuvent être mises à jour. Une notification vous sera envoyée en cas de modification importante.</p>
    </LegalPage>
  );
}

// ═══════════════════════════════════════ BLOCKED USERS ══════════════════════
function BlockedUsersScreen({ onBack, profile, unblockUser, C }) {
  const blocked = profile?.blockedUsers || [];
  return (
    <div style={{
      minHeight:"100vh", maxWidth:480, margin:"0 auto",
      fontFamily:"'Rajdhani',sans-serif", color:"#dde4f0",
      padding:"16px 14px 40px",
    }}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
        <button onClick={onBack} className="rip" style={{
          background:"#0d1828", border:`1px solid ${C.brd}`, borderRadius:10,
          width:38, height:38, color:C.cy, fontSize:18, cursor:"pointer", flexShrink:0,
        }}>←</button>
        <div style={{flex:1}}>
          <div className="orb" style={{fontSize:14, color:"#ef4444", letterSpacing:2}}>🚫 UTILISATEURS BLOQUÉS</div>
          <div style={{fontSize:11, color:"#64748b"}}>{blocked.length} utilisateur(s) bloqué(s)</div>
        </div>
      </div>

      {blocked.length === 0 ? (
        <div style={{
          textAlign:"center", padding:50, background:C.card,
          borderRadius:12, border:`1px dashed ${C.brd}`, color:"#475569",
        }}>
          <div style={{fontSize:48, marginBottom:12}}>✨</div>
          <div style={{fontSize:13}}>Aucun utilisateur bloqué.<br/>Profitez bien de la communauté !</div>
        </div>
      ) : (
        blocked.map(u => (
          <div key={u} style={{
            display:"flex", justifyContent:"space-between", alignItems:"center",
            padding:"12px 14px", background:C.card,
            border:`1px solid ${C.brd}`, borderRadius:10, marginBottom:8,
          }}>
            <div style={{display:"flex", gap:10, alignItems:"center"}}>
              <span style={{fontSize:18}}>🚫</span>
              <span style={{fontSize:13, fontWeight:600}}>@{u}</span>
            </div>
            <button onClick={() => unblockUser(u)} className="rip" style={{
              background:`linear-gradient(135deg, ${C.cy}22, ${C.cy}44)`,
              border:`1px solid ${C.cy}88`, borderRadius:8,
              padding:"6px 12px", color:C.cy, fontSize:11,
              cursor:"pointer", fontFamily:"'Rajdhani',sans-serif", fontWeight:700,
            }}>Débloquer</button>
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════ SUPPORT SCREEN ═════════════════════
function SupportScreen({ onBack, C }) {
  return (
    <LegalPage title="📨 SUPPORT & CONTACT" color={C.cy} onBack={onBack} C={C}>
      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>BESOIN D'AIDE ?</h3>
      <p style={{marginBottom:14}}>Notre équipe est là pour vous aider. Voici comment nous contacter :</p>

      <div style={{
        background:"#040810", border:`1px solid ${C.cy}33`, borderRadius:10,
        padding:14, marginBottom:14,
      }}>
        <div style={{fontSize:11, color:C.cy, marginBottom:6, fontFamily:"Orbitron"}}>📧 EMAIL SUPPORT</div>
        <div style={{fontSize:14, color:"#fff", wordBreak:"break-all"}}>{CONTACT_EMAIL}</div>
        <div style={{fontSize:11, color:"#64748b", marginTop:6}}>Réponse sous 24-48h</div>
      </div>

      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>SIGNALER UN BUG</h3>
      <p style={{marginBottom:14}}>Décrivez le bug avec : votre version d'iOS, le modèle d'iPhone, et les étapes pour reproduire le problème.</p>

      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>SIGNALER UN UTILISATEUR</h3>
      <p style={{marginBottom:14}}>Pour signaler un comportement abusif, utilisez le menu ⋮ sur la suggestion concernée. Notre équipe traite les signalements sous 24h.</p>

      <h3 style={{color:"#fff", fontSize:13, marginBottom:8}}>RGPD / SUPPRESSION DE COMPTE</h3>
      <p style={{marginBottom:14}}>Vous pouvez supprimer toutes vos données via <strong>Réglages → Supprimer mes données</strong>, ou nous écrire pour toute demande RGPD.</p>

      <p style={{color:"#475569", fontSize:11, marginTop:20, textAlign:"center"}}>Version {APP_VERSION} · World Domination © 2026</p>
    </LegalPage>
  );
}

// ═══════════════════════════════════════ SETTINGS SCREEN ════════════════════
function SettingsScreen({ setScreen, profile, saveProfile, deleteAllData, C }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(profile?.username || "");
  const [nameErr, setNameErr] = useState(null);

  const saveNewName = async () => {
    const err = validateUsername(newName);
    if (err) { setNameErr(err); return; }
    await saveProfile({ ...profile, username: newName.trim() });
    setEditingName(false);
    setNameErr(null);
  };

  const Item = ({ icon, label, value, onClick, danger }) => (
    <button onClick={onClick} className="rip" style={{
      width:"100%", display:"flex", alignItems:"center", gap:12,
      padding:"14px 14px", background:C.card,
      border:`1px solid ${danger?"#ef444433":C.brd}`, borderRadius:10,
      color: danger?"#ef4444":"#dde4f0", fontSize:13,
      cursor:"pointer", fontFamily:"'Rajdhani',sans-serif",
      textAlign:"left", marginBottom:8, transition:"all .2s",
    }}>
      <span style={{fontSize:18}}>{icon}</span>
      <div style={{flex:1}}>
        <div style={{fontWeight:600}}>{label}</div>
        {value && <div style={{fontSize:11, color:"#64748b", marginTop:2}}>{value}</div>}
      </div>
      <span style={{color:"#475569", fontSize:18}}>›</span>
    </button>
  );

  return (
    <div style={{
      minHeight:"100vh", maxWidth:480, margin:"0 auto",
      fontFamily:"'Rajdhani',sans-serif", color:"#dde4f0",
      padding:"16px 14px 40px",
    }}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
        <button onClick={() => setScreen("menu")} className="rip" style={{
          background:"#0d1828", border:`1px solid ${C.brd}`, borderRadius:10,
          width:38, height:38, color:C.cy, fontSize:18, cursor:"pointer", flexShrink:0,
        }}>←</button>
        <div className="orb" style={{fontSize:15, color:C.cy, letterSpacing:3}}>⚙️ RÉGLAGES</div>
      </div>

      {/* Profile section */}
      <div style={{
        background:`linear-gradient(135deg, ${C.card}, ${C.cy}10)`,
        border:`1px solid ${C.cy}44`, borderRadius:12,
        padding:16, marginBottom:18, textAlign:"center",
      }}>
        <div style={{fontSize:42, marginBottom:6}}>👤</div>
        {editingName ? (
          <>
            <input
              value={newName}
              onChange={e => { setNewName(e.target.value); setNameErr(null); }}
              maxLength={16}
              style={{
                width:"100%", maxWidth:240, background:"#040810",
                border:`1.5px solid ${nameErr?"#ef4444":C.brd}`, borderRadius:8,
                padding:"8px 12px", color:"#fff", fontSize:14, fontFamily:"'Rajdhani',sans-serif",
                fontWeight:600, textAlign:"center", outline:"none", marginBottom:6,
              }}
            />
            {nameErr && <div style={{fontSize:11, color:"#ef4444", marginBottom:6}}>{nameErr}</div>}
            <div style={{display:"flex", gap:8, justifyContent:"center", marginTop:6}}>
              <button onClick={() => { setEditingName(false); setNewName(profile?.username||""); setNameErr(null); }} style={{
                background:"#0d1828", border:`1px solid ${C.brd}`, borderRadius:8,
                padding:"6px 14px", color:"#94a3b8", fontSize:11, cursor:"pointer",
                fontFamily:"'Rajdhani',sans-serif",
              }}>Annuler</button>
              <button onClick={saveNewName} style={{
                background:`linear-gradient(135deg, ${C.cy}22, ${C.cy}55)`,
                border:`1px solid ${C.cy}88`, borderRadius:8, padding:"6px 14px",
                color:C.cy, fontSize:11, cursor:"pointer", fontFamily:"'Rajdhani',sans-serif", fontWeight:700,
              }}>Sauvegarder</button>
            </div>
          </>
        ) : (
          <>
            <div className="orb" style={{fontSize:18, color:"#fff", letterSpacing:2}}>{profile?.username}</div>
            <button onClick={() => setEditingName(true)} style={{
              background:"transparent", border:"none", color:C.cy, fontSize:11,
              marginTop:8, cursor:"pointer", fontFamily:"'Rajdhani',sans-serif", textDecoration:"underline",
            }}>✏️ Modifier le pseudo</button>
          </>
        )}
      </div>

      <div className="orb" style={{fontSize:10, color:"#475569", letterSpacing:2, marginBottom:8, paddingLeft:4}}>
        ◆ COMMUNAUTÉ
      </div>
      <Item icon="🚫" label="Utilisateurs bloqués" value={`${profile?.blockedUsers?.length || 0} bloqué(s)`} onClick={() => setScreen("blocked")}/>

      <div className="orb" style={{fontSize:10, color:"#475569", letterSpacing:2, marginTop:18, marginBottom:8, paddingLeft:4}}>
        ◆ INFORMATIONS LÉGALES
      </div>
      <Item icon="🔒" label="Politique de confidentialité" onClick={() => setScreen("privacy")}/>
      <Item icon="📜" label="Conditions d'utilisation" onClick={() => setScreen("terms")}/>
      <Item icon="📨" label="Support & Contact" onClick={() => setScreen("support")}/>

      <div className="orb" style={{fontSize:10, color:"#475569", letterSpacing:2, marginTop:18, marginBottom:8, paddingLeft:4}}>
        ◆ DONNÉES
      </div>
      <Item icon="🗑️" label="Supprimer mes données" value="Action irréversible" onClick={() => setConfirmDelete(true)} danger/>

      <div style={{textAlign:"center", marginTop:24, fontSize:11, color:"#334155"}}>
        World Domination v{APP_VERSION}<br/>© 2026 — Tous droits réservés
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <>
          <div onClick={() => setConfirmDelete(false)} style={{position:"fixed",inset:0,background:"#000000bb",zIndex:99}}/>
          <div style={{
            position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)",
            width:"100%", maxWidth:480, background:C.card,
            borderTop:`2px solid #ef4444`, borderRadius:"18px 18px 0 0",
            padding:20, zIndex:100,
          }}>
            <div className="orb" style={{fontSize:14, color:"#ef4444", marginBottom:12, letterSpacing:2}}>
              ⚠️ SUPPRIMER MES DONNÉES
            </div>
            <div style={{fontSize:13, color:"#94a3b8", marginBottom:18, lineHeight:1.6}}>
              Cette action va supprimer <strong style={{color:"#fff"}}>définitivement</strong> :
              <ul style={{paddingLeft:18, marginTop:8}}>
                <li>Votre pseudo et profil</li>
                <li>Votre progression de jeu</li>
                <li>Votre liste d'utilisateurs bloqués</li>
                <li>Vos signalements</li>
              </ul>
              <div style={{marginTop:10, color:"#fbbf24"}}>Cette action est <strong>irréversible</strong>.</div>
            </div>
            <div style={{display:"flex", gap:8}}>
              <button onClick={() => setConfirmDelete(false)} style={{
                flex:1, padding:"12px", background:"#0d1828", border:`1px solid ${C.brd}`,
                borderRadius:10, color:"#94a3b8", fontSize:13, cursor:"pointer",
                fontFamily:"'Rajdhani',sans-serif",
              }}>Annuler</button>
              <button onClick={async () => { await deleteAllData(); }} style={{
                flex:1, padding:"12px", background:`linear-gradient(135deg,#ef444422,#ef444466)`,
                border:`1px solid #ef4444`, borderRadius:10, color:"#ef4444", fontSize:13,
                cursor:"pointer", fontFamily:"'Rajdhani',sans-serif", fontWeight:700,
              }}>Supprimer tout</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════ RAID ALERT BANNER ══════════════════
function RaidAlert({ raid, wks, defendRaid, C }) {
  const [showDeploy, setShowDeploy] = useState(false);
  const [deployUnits, setDeployUnits] = useState({ miner:0, engineer:0, defender:0 });
  const totalDeployed = Object.values(deployUnits).reduce((a,b)=>a+b,0);
  const maxAvail = (type) => wks[type].n;
  const totalEnemies = Object.values(raid.attackers).reduce((a,b)=>a+b,0);

  const launch = () => {
    if (totalDeployed === 0) return;
    defendRaid(deployUnits);
  };

  const skipDefense = () => {
    defendRaid({ miner:0, engineer:0, defender:0 });
  };

  const pct = (raid.timeLeft / raid.totalTime) * 100;

  if (!showDeploy) {
    return (
      <div style={{
        position:"fixed", top:64, left:"50%", transform:"translateX(-50%)",
        width:"calc(100% - 24px)", maxWidth:455, zIndex:90,
        background:"linear-gradient(135deg, #2a0a0a, #1a0505)",
        border:"2px solid #ef4444", borderRadius:14,
        padding:"12px 14px",
        boxShadow:"0 0 30px rgba(239,68,68,0.6), inset 0 0 20px rgba(239,68,68,0.2)",
        animation:"rng 1s infinite",
      }}>
        <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:8}}>
          <span style={{fontSize:24}}>⚠️</span>
          <div style={{flex:1}}>
            <div className="orb" style={{fontSize:13, color:"#ef4444", letterSpacing:2, fontWeight:700}}>
              RAID INCOMING — Zone {raid.cellName}
            </div>
            <div style={{fontSize:11, color:"#fca5a5", marginTop:2}}>
              {raid.enemyName} · {totalEnemies} unités hostiles · {raid.timeLeft}s
            </div>
          </div>
        </div>
        {/* Countdown bar */}
        <div style={{background:"#1a0505", borderRadius:4, height:5, overflow:"hidden", marginBottom:10}}>
          <div style={{
            width:`${pct}%`, height:"100%",
            background:"linear-gradient(90deg, #ef4444, #fbbf24)",
            transition:"width 1s linear",
          }}/>
        </div>
        <div style={{display:"flex", gap:8}}>
          <button onClick={skipDefense} style={{
            flex:1, padding:"8px", background:"#0d1828", border:`1px solid ${C.brd}`,
            borderRadius:8, color:"#94a3b8", fontSize:12, cursor:"pointer",
            fontFamily:"'Rajdhani',sans-serif", fontWeight:600,
          }}>🏃 Abandonner</button>
          <button onClick={() => setShowDeploy(true)} className="rip" style={{
            flex:2, padding:"8px",
            background:"linear-gradient(135deg, #ef444433, #ef444466)",
            border:"1px solid #ef4444", borderRadius:8,
            color:"#fff", fontSize:12, cursor:"pointer",
            fontFamily:"'Rajdhani',sans-serif", fontWeight:700, letterSpacing:1,
          }}>⚔️ DÉFENDRE LA ZONE</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div onClick={() => setShowDeploy(false)} style={{position:"fixed", inset:0, background:"#000000bb", zIndex:90}}/>
      <div style={{
        position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)",
        width:"100%", maxWidth:480, background:"#0b1424",
        borderTop:"2px solid #ef4444", borderRadius:"18px 18px 0 0",
        padding:18, zIndex:100, maxHeight:"75vh", overflowY:"auto",
      }}>
        <div className="orb" style={{fontSize:14, color:"#ef4444", letterSpacing:2, marginBottom:6}}>
          ⚔️ DÉPLOIEMENT BRIGADE
        </div>
        <div style={{fontSize:11, color:"#94a3b8", marginBottom:14}}>
          Zone {raid.cellName} · Temps restant: {raid.timeLeft}s
        </div>

        {/* Enemy preview */}
        <div style={{
          background:"#1a0505", border:"1px solid #ef444444", borderRadius:10,
          padding:12, marginBottom:14,
        }}>
          <div className="orb" style={{fontSize:10, color:"#ef4444", marginBottom:8, letterSpacing:1.5}}>
            🚨 FORCES ENNEMIES
          </div>
          <div style={{display:"flex", gap:10, flexWrap:"wrap"}}>
            {Object.entries(raid.attackers).map(([type, count]) => {
              if (count === 0) return null;
              const u = ENEMY_UNITS[type];
              return (
                <div key={type} style={{
                  display:"flex", alignItems:"center", gap:5,
                  background:"#040810", border:`1px solid ${u.col}66`,
                  borderRadius:8, padding:"5px 10px",
                }}>
                  <span style={{fontSize:18}}>{u.e}</span>
                  <div>
                    <div style={{fontSize:11, color:u.col, fontWeight:700}}>×{count}</div>
                    <div style={{fontSize:9, color:"#64748b"}}>{u.name}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Player unit selection */}
        <div className="orb" style={{fontSize:10, color:C.cy, marginBottom:8, letterSpacing:1.5}}>
          ◆ VOS BRIGADES DISPONIBLES
        </div>
        {Object.entries(BRIGADE_UNITS).map(([type, u]) => {
          const avail = maxAvail(type);
          return (
            <div key={type} style={{
              background:"#040810", border:`1px solid ${u.col}33`, borderRadius:10,
              padding:12, marginBottom:8,
            }}>
              <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:8}}>
                <span style={{fontSize:24}}>{u.e}</span>
                <div style={{flex:1}}>
                  <div className="orb" style={{fontSize:12, color:u.col}}>{u.name}</div>
                  <div style={{fontSize:10, color:"#64748b"}}>HP {u.hp} · ATK {u.atk}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div className="orb" style={{fontSize:14, color:"#fff"}}>{deployUnits[type]}/{avail}</div>
                </div>
              </div>
              <div style={{display:"flex", gap:6}}>
                <button onClick={() => setDeployUnits(d => ({...d, [type]: Math.max(0, d[type]-1)}))}
                  className="rip" style={{
                  flex:1, padding:"6px", background:"#0d1828", border:`1px solid ${C.brd}`,
                  borderRadius:6, color:"#94a3b8", fontSize:14, cursor:"pointer",
                }}>−</button>
                <button onClick={() => setDeployUnits(d => ({...d, [type]: Math.min(avail, d[type]+1)}))}
                  className="rip" style={{
                  flex:1, padding:"6px",
                  background:`linear-gradient(135deg, ${u.col}22, ${u.col}55)`,
                  border:`1px solid ${u.col}88`, borderRadius:6,
                  color:u.col, fontSize:14, cursor:"pointer",
                }}>+</button>
                <button onClick={() => setDeployUnits(d => ({...d, [type]: avail}))}
                  className="rip" style={{
                  padding:"6px 12px", background:"#0d1828", border:`1px solid ${C.brd}`,
                  borderRadius:6, color:"#94a3b8", fontSize:11, cursor:"pointer",
                  fontFamily:"'Rajdhani',sans-serif", fontWeight:600,
                }}>MAX</button>
              </div>
            </div>
          );
        })}

        <div style={{
          background:"#040810", border:`1px solid ${C.brd}`,
          borderRadius:10, padding:"10px 12px", marginBottom:12, marginTop:14,
        }}>
          <div style={{display:"flex", justifyContent:"space-between", fontSize:11, color:"#94a3b8"}}>
            <span>⚔️ Brigade déployée</span>
            <span className="orb" style={{color:totalDeployed > 0 ? C.cy : "#475569"}}>{totalDeployed} unités</span>
          </div>
        </div>

        <button onClick={launch} disabled={totalDeployed === 0} className="rip" style={{
          width:"100%", padding:"14px",
          background: totalDeployed > 0
            ? "linear-gradient(135deg, #ef444433, #ef444466)"
            : "#1e3a5f",
          border: totalDeployed > 0 ? "1.5px solid #ef4444" : `1px solid ${C.brd}`,
          borderRadius:10, color: totalDeployed > 0 ? "#fff" : "#475569",
          fontSize:14, cursor: totalDeployed > 0 ? "pointer" : "not-allowed",
          fontFamily:"'Rajdhani',sans-serif", fontWeight:700, letterSpacing:2,
        }}>
          {totalDeployed > 0 ? "⚔️ LANCER LE COMBAT" : "Sélectionnez des unités"}
        </button>
      </div>
    </>
  );
}

// ═══════════════════════════════════════ COMBAT REPLAY ══════════════════════
function CombatReplay({ log, onClose, C }) {
  const [currentRound, setCurrentRound] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    if (!playing) return;
    if (currentRound >= log.rounds.length) {
      setTimeout(() => setShowResult(true), 600);
      return;
    }
    const timer = setTimeout(() => {
      setCurrentRound(r => r + 1);
    }, 1100);
    return () => clearTimeout(timer);
  }, [currentRound, playing, log.rounds.length]);

  const round = log.rounds[Math.min(currentRound, log.rounds.length - 1)];
  const defState = currentRound > 0 && round ? round.defState : log.initialDef;
  const atkState = currentRound > 0 && round ? round.atkState : log.initialAtk;
  const events = round?.events || [];

  const resultColors = {
    victory: { col:"#4ade80", title:"🏆 VICTOIRE", glow:"#4ade8088" },
    defeat:  { col:"#ef4444", title:"💀 DÉFAITE", glow:"#ef444488" },
    draw:    { col:"#fbbf24", title:"⚖️ MATCH NUL", glow:"#fbbf2488" },
  };
  const resCol = resultColors[log.result];

  if (showResult) {
    return (
      <>
        <div style={{position:"fixed", inset:0, background:"#000000ee", zIndex:200}}/>
        <div style={{
          position:"fixed", top:"50%", left:"50%", transform:"translate(-50%,-50%)",
          width:"calc(100% - 30px)", maxWidth:380,
          background:"#0b1424", border:`2px solid ${resCol.col}`,
          borderRadius:16, padding:24, zIndex:201, textAlign:"center",
          boxShadow:`0 0 40px ${resCol.glow}`,
        }}>
          <div className="orb" style={{
            fontSize:24, color:resCol.col, letterSpacing:3, marginBottom:12,
            textShadow:`0 0 20px ${resCol.col}`,
          }}>
            {resCol.title}
          </div>
          <div style={{fontSize:13, color:"#94a3b8", marginBottom:14}}>
            Zone <span style={{color:"#fff", fontFamily:"Orbitron"}}>{log.cellName}</span>
          </div>
          <div style={{
            background:"#040810", borderRadius:8, padding:12, marginBottom:14,
            display:"flex", justifyContent:"space-around",
          }}>
            <div>
              <div className="orb" style={{fontSize:18, color:"#4ade80"}}>{log.initialDef.filter((_,i) => log.rounds[log.rounds.length-1]?.defState[i]?.hp > 0).length}</div>
              <div style={{fontSize:10, color:"#64748b", marginTop:2}}>Survivants</div>
            </div>
            <div style={{borderLeft:`1px solid ${C.brd}`}}/>
            <div>
              <div className="orb" style={{fontSize:18, color:"#ef4444"}}>{log.defLost}</div>
              <div style={{fontSize:10, color:"#64748b", marginTop:2}}>Pertes</div>
            </div>
          </div>
          <button onClick={onClose} className="rip" style={{
            width:"100%", padding:"12px",
            background:`linear-gradient(135deg, ${resCol.col}22, ${resCol.col}55)`,
            border:`1.5px solid ${resCol.col}`, borderRadius:10,
            color:"#fff", fontSize:13, cursor:"pointer",
            fontFamily:"'Rajdhani',sans-serif", fontWeight:700, letterSpacing:2,
          }}>CONTINUER</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={{position:"fixed", inset:0, background:"#000000ee", zIndex:200}}/>
      <div style={{
        position:"fixed", top:0, left:"50%", transform:"translateX(-50%)",
        width:"100%", maxWidth:480, height:"100%", background:"#040810",
        zIndex:201, display:"flex", flexDirection:"column", padding:14,
        overflowY:"auto",
      }}>
        {/* Header */}
        <div style={{textAlign:"center", marginBottom:18}}>
          <div className="orb" style={{fontSize:14, color:"#ef4444", letterSpacing:3, textShadow:"0 0 18px #ef4444"}}>
            ⚔️ COMBAT EN COURS
          </div>
          <div style={{fontSize:11, color:"#64748b", marginTop:3}}>
            Round {Math.min(currentRound, log.rounds.length)} / {log.rounds.length}
          </div>
        </div>

        {/* Defenders side */}
        <div style={{
          background:"linear-gradient(135deg, #051a12, #0a1f1a)",
          border:`1px solid ${C.cy}55`, borderRadius:12, padding:12, marginBottom:8,
        }}>
          <div className="orb" style={{fontSize:10, color:C.cy, marginBottom:10, letterSpacing:1.5}}>
            🛡️ DÉFENSEURS
          </div>
          <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
            {defState.map((u, i) => (
              <UnitCard key={i} unit={u} />
            ))}
          </div>
        </div>

        {/* VS */}
        <div style={{textAlign:"center", padding:"6px 0"}}>
          <div className="orb" style={{
            fontSize:18, color:"#fff", letterSpacing:4,
            textShadow:"0 0 14px #fff",
          }}>VS</div>
        </div>

        {/* Attackers side */}
        <div style={{
          background:"linear-gradient(135deg, #1a0505, #2a0a0a)",
          border:"1px solid #ef444455", borderRadius:12, padding:12, marginBottom:14,
        }}>
          <div className="orb" style={{fontSize:10, color:"#ef4444", marginBottom:10, letterSpacing:1.5}}>
            💀 ATTAQUANTS
          </div>
          <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
            {atkState.map((u, i) => (
              <UnitCard key={i} unit={u} />
            ))}
          </div>
        </div>

        {/* Combat events log */}
        <div style={{
          background:"#0b1424", border:`1px solid ${C.brd}`, borderRadius:10,
          padding:10, flex:1, minHeight:120, marginBottom:12,
        }}>
          <div className="orb" style={{fontSize:9, color:"#64748b", marginBottom:6, letterSpacing:1}}>
            📜 ROUND {Math.min(currentRound, log.rounds.length)}
          </div>
          {events.length === 0 && <div style={{fontSize:11, color:"#475569", textAlign:"center", padding:10}}>En attente...</div>}
          {events.map((ev, i) => (
            <div key={i} style={{
              fontSize:11, color:"#94a3b8", padding:"4px 0",
              display:"flex", alignItems:"center", gap:6,
              animation:"slIn 0.3s ease",
            }}>
              <span>{ev.from}</span>
              <span style={{color:ev.side==="def"?C.cy:"#ef4444"}}>→</span>
              <span>{ev.to}</span>
              <span style={{color:"#fbbf24", fontWeight:700, marginLeft:"auto"}}>−{ev.dmg} HP</span>
              {ev.killed && <span style={{color:"#ef4444"}}>💀</span>}
            </div>
          ))}
        </div>

        {/* Skip button */}
        <button onClick={() => { setPlaying(false); setShowResult(true); }} className="rip" style={{
          padding:"10px", background:"#0d1828", border:`1px solid ${C.brd}`,
          borderRadius:8, color:"#94a3b8", fontSize:12, cursor:"pointer",
          fontFamily:"'Rajdhani',sans-serif",
        }}>⏩ Passer la simulation</button>
      </div>
    </>
  );
}

function UnitCard({ unit }) {
  const dead = unit.hp <= 0;
  const hpPct = (unit.hp / unit.maxHp) * 100;
  return (
    <div style={{
      background: dead ? "#1a0505" : "#040810",
      border:`1px solid ${dead ? "#ef444444" : unit.col + "66"}`,
      borderRadius:8, padding:"6px 8px",
      minWidth:62, textAlign:"center",
      opacity: dead ? 0.4 : 1,
      filter: dead ? "grayscale(100%)" : "none",
      transition:"all 0.3s",
      boxShadow: !dead ? `0 0 8px ${unit.col}33` : "none",
    }}>
      <div style={{fontSize:18, lineHeight:1, marginBottom:2}}>{dead ? "💀" : unit.e}</div>
      <div style={{fontSize:9, color:dead?"#475569":unit.col, fontFamily:"Orbitron"}}>
        {unit.hp}/{unit.maxHp}
      </div>
      <div style={{
        height:3, background:"#1e3a5f", borderRadius:2,
        marginTop:3, overflow:"hidden",
      }}>
        <div style={{
          width:`${hpPct}%`, height:"100%",
          background: hpPct > 50 ? "#4ade80" : hpPct > 25 ? "#fbbf24" : "#ef4444",
          transition:"width 0.5s",
        }}/>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ ATTACK ANIMATION ═══════════════════
function AttackAnimation({ anim, C }) {
  const isAttack = anim.phase === "attack";
  const isWin = anim.win;
  const mainColor = isAttack ? (isWin ? "#00f5d4" : "#ef4444") : "#00f5d4";
  const mainEmoji = isAttack ? (isWin ? "💥" : "💢") : "🏗️";

  // Generate sparks positions
  const sparks = Array.from({length: 14}).map((_, i) => {
    const angle = (i / 14) * Math.PI * 2;
    const distance = 80 + Math.random() * 60;
    return {
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance,
      delay: Math.random() * 0.15,
      color: i % 3 === 0 ? "#ffe600" : mainColor,
    };
  });

  // Lightning bolts (only for attack phase)
  const lightnings = isAttack ? Array.from({length: 6}).map((_, i) => ({
    rot: (i * 60) + (Math.random() * 30 - 15),
    delay: Math.random() * 0.3,
  })) : [];

  return (
    <div style={{
      position:"fixed", inset:0, pointerEvents:"none", zIndex:160,
      display:"flex", alignItems:"center", justifyContent:"center",
    }}>
      {/* Central explosion */}
      <div style={{
        position:"absolute", top:"50%", left:"50%",
        width:120, height:120, borderRadius:"50%",
        background:`radial-gradient(circle, ${mainColor}cc 0%, ${mainColor}66 30%, transparent 70%)`,
        filter:"blur(2px)",
        animation:"explode 0.9s ease-out forwards",
      }}/>

      {/* Inner bright core */}
      <div style={{
        position:"absolute", top:"50%", left:"50%",
        width:60, height:60, borderRadius:"50%",
        background: `radial-gradient(circle, #ffffff 0%, ${mainColor} 50%, transparent 100%)`,
        animation:"explode 0.7s ease-out forwards",
      }}/>

      {/* Big emoji in center */}
      <div style={{
        position:"absolute", top:"50%", left:"50%",
        transform:"translate(-50%,-50%)",
        fontSize:62, zIndex:5,
        filter:`drop-shadow(0 0 20px ${mainColor}) drop-shadow(0 0 40px ${mainColor}88)`,
        animation:"explode 1.1s ease-out forwards",
      }}>{mainEmoji}</div>

      {/* Expanding rings */}
      {[0, 0.15, 0.3].map((delay, i) => (
        <div key={`ring${i}`} style={{
          position:"absolute", top:"50%", left:"50%",
          width:120, height:120, borderRadius:"50%",
          border:`2px solid ${mainColor}`,
          animation:`ringExpand 1.2s ease-out ${delay}s forwards`,
          opacity:0,
        }}/>
      ))}

      {/* Lightning bolts (attack only) */}
      {lightnings.map((l, i) => (
        <div key={`l${i}`} style={{
          position:"absolute", top:"50%", left:"50%",
          width:3, height:140,
          background:`linear-gradient(180deg, transparent, ${mainColor}, #ffffff, ${mainColor}, transparent)`,
          boxShadow:`0 0 10px ${mainColor}, 0 0 20px ${mainColor}`,
          transformOrigin:"center",
          "--rot": `${l.rot}deg`,
          animation:`lightning 0.5s ease-out ${l.delay}s forwards`,
          opacity:0,
        }}/>
      ))}

      {/* Sparks flying outward */}
      {sparks.map((s, i) => (
        <div key={`s${i}`} style={{
          position:"absolute", top:"50%", left:"50%",
          width:6, height:6, borderRadius:"50%",
          background: s.color,
          boxShadow:`0 0 8px ${s.color}, 0 0 14px ${s.color}88`,
          "--dx": `${s.dx}px`,
          "--dy": `${s.dy}px`,
          animation: `sparkOut 0.85s ease-out ${s.delay}s forwards`,
        }}/>
      ))}

      {/* Top text */}
      <div style={{
        position:"absolute", top:"30%", left:"50%",
        transform:"translateX(-50%)",
        textAlign:"center",
        animation:"explode 1.2s ease-out forwards",
      }}>
        <div className="orb" style={{
          fontSize:11, color:mainColor, letterSpacing:5,
          textShadow:`0 0 14px ${mainColor}`, opacity:0.9,
        }}>
          {isAttack ? (isWin ? "▶ ATTAQUE LANCÉE" : "▶ ATTAQUE LANCÉE") : "▶ CAPTURE EN COURS"}
        </div>
      </div>

      {/* Result text appearing later */}
      {isAttack && (
        <div style={{
          position:"absolute", top:"58%", left:"50%",
          transform:"translateX(-50%)",
          textAlign:"center", opacity:0,
          animation:"explode 0.8s ease-out 0.9s forwards",
        }}>
          <div className="orb" style={{
            fontSize:18, color:isWin?"#4ade80":"#ef4444", letterSpacing:4, fontWeight:900,
            textShadow:`0 0 18px ${isWin?"#4ade80":"#ef4444"}`,
          }}>
            {isWin ? "✓ ZONE CONQUISE" : "✗ DÉFAITE"}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════ LOST ZONE POPUP ════════════════════
function LostZonePopup({ data, onClose, C }) {
  const rarity = RARITIES[data.rarity] || RARITIES.common;
  const [phase, setPhase] = useState("appear"); // appear -> takeover -> done

  // Phases d'animation
  useEffect(() => {
    const t1 = setTimeout(() => setPhase("takeover"), 800);
    const t2 = setTimeout(() => setPhase("done"), 2200);
    const t3 = setTimeout(onClose, 6000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onClose]);

  return (
    <>
      <div onClick={onClose} style={{
        position:"fixed", inset:0, zIndex:170,
        background:"radial-gradient(circle at 50% 50%, rgba(239,68,68,0.25), rgba(0,0,0,0.92))",
        animation:"flashRed 0.4s ease-out",
      }}/>
      <div style={{
        position:"fixed", top:"50%", left:"50%",
        width:"calc(100% - 40px)", maxWidth:340,
        background:"linear-gradient(135deg, #2a0a0a 0%, #0a0204 100%)",
        border:"2px solid #ef4444", borderRadius:18,
        padding:"22px 18px", zIndex:171, textAlign:"center",
        animation:"lostZoneIn 0.5s cubic-bezier(.34,1.56,.64,1) forwards, redPulse 2s ease-in-out 0.5s infinite",
      }}>
        {/* Crack overlay decoration */}
        <div style={{
          position:"absolute", inset:0, borderRadius:18, pointerEvents:"none",
          background:`url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><path d='M30 10 L45 35 L40 50 L55 65 L50 90' stroke='%23ef4444' stroke-width='0.4' fill='none' opacity='0.5'/><path d='M70 5 L60 30 L75 45 L65 70 L80 95' stroke='%23ef4444' stroke-width='0.4' fill='none' opacity='0.4'/></svg>")`,
          opacity:0.3,
        }}/>

        {/* Big skull */}
        <div style={{
          fontSize:60, marginBottom:10,
          filter:"drop-shadow(0 0 18px rgba(239,68,68,0.9))",
          animation:"chestBob 1.5s ease-in-out infinite",
        }}>💀</div>

        <div className="orb" style={{
          fontSize:18, color:"#ef4444", letterSpacing:4, fontWeight:900,
          marginBottom:6, textShadow:"0 0 14px #ef4444",
        }}>ZONE PERDUE</div>

        <div style={{fontSize:11, color:"#fca5a5", marginBottom:14, letterSpacing:1}}>
          {data.reason === "raid" ? "Vous n'avez pas défendu à temps" : "Votre brigade a été vaincue"}
        </div>

        {/* Zone info with flag takeover animation */}
        <div style={{
          background:"rgba(0,0,0,0.5)", border:`1px solid ${rarity.col}66`,
          borderRadius:12, padding:14, marginBottom:14,
          boxShadow: rarity.glow,
          position:"relative", overflow:"hidden",
        }}>
          {/* Biome icon corrupting */}
          <div style={{
            fontSize:42, marginBottom:6,
            filter: phase === "appear" ? "grayscale(0%) brightness(1)" : "grayscale(85%) brightness(0.4)",
            transition:"filter 1.4s ease-out",
            position:"relative",
            display:"inline-block",
          }}>
            {data.biomeEmoji}
            {/* Big enemy flag planting on the zone */}
            {phase !== "appear" && (
              <div style={{
                position:"absolute", top:"50%", left:"50%",
                fontSize:50, lineHeight:1,
                filter:"drop-shadow(0 0 14px rgba(239,68,68,0.9))",
                animation:"flagPlant 0.8s cubic-bezier(.34,1.56,.64,1) forwards",
                transformOrigin:"bottom center",
                zIndex:5,
              }}>🚩</div>
            )}
          </div>
          <div className="orb" style={{
            fontSize:16, color:"#fff", letterSpacing:3, fontWeight:700,
          }}>ZONE {data.cellName}</div>
          <div style={{fontSize:12, color:"#94a3b8", marginTop:4}}>{data.biomeName}</div>
          {data.rarity !== "common" && (
            <div style={{
              display:"inline-block", marginTop:8,
              fontSize:10, padding:"3px 10px",
              background:`${rarity.col}22`, border:`1px solid ${rarity.col}`,
              borderRadius:10, color:rarity.col, fontFamily:"Orbitron",
              letterSpacing:1.5, fontWeight:700,
            }}>
              {rarity.e} {rarity.name.toUpperCase()}
            </div>
          )}
          {phase === "done" && (
            <div style={{
              marginTop:10, padding:"6px 12px",
              background:"#1a0505", border:"1px solid #ef4444",
              borderRadius:8, fontSize:11, color:"#ef4444",
              fontFamily:"Orbitron", letterSpacing:1.5, fontWeight:700,
              animation:"slIn 0.4s ease",
            }}>
              🚩 OCCUPÉE PAR L'ENNEMI
            </div>
          )}
        </div>

        {/* Penalties */}
        <div style={{
          display:"flex", gap:8, marginBottom:14, justifyContent:"center", flexWrap:"wrap",
        }}>
          <div style={{
            background:"#1a0505", border:"1px solid #ef444466",
            borderRadius:8, padding:"6px 12px", fontSize:12, color:"#ef4444",
          }}>
            🏆 −15 RP
          </div>
          <div style={{
            background:"#1a0505", border:"1px solid #ef444466",
            borderRadius:8, padding:"6px 12px", fontSize:12, color:"#ef4444",
          }}>
            🗺️ −1 zone
          </div>
        </div>

        <button onClick={onClose} className="rip" style={{
          padding:"10px 28px", background:"linear-gradient(135deg, #ef444433, #ef444466)",
          border:"1.5px solid #ef4444", borderRadius:10,
          color:"#fff", fontSize:13, cursor:"pointer",
          fontFamily:"'Rajdhani',sans-serif", fontWeight:700, letterSpacing:2,
        }}>RECONQUÉRIR PLUS TARD</button>
      </div>
    </>
  );
}

// ═══════════════════════════════════════ MAGIC CHEST ════════════════════════
function MagicChest({ chest, openChest, claimChest, dismiss, C }) {
  const r = chest.rewards.rarity;
  const opened = chest.opened;
  const [showAd, setShowAd] = useState(false);
  const [adProgress, setAdProgress] = useState(0);
  const [adComplete, setAdComplete] = useState(false);

  // Ad simulation - 5 seconds countdown
  useEffect(() => {
    if (!showAd || adComplete) return;
    const start = Date.now();
    const duration = 5000;
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(100, (elapsed / duration) * 100);
      setAdProgress(pct);
      if (pct >= 100) {
        setAdComplete(true);
        clearInterval(interval);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [showAd, adComplete]);

  const handleWatchAd = () => {
    setShowAd(true);
    setAdProgress(0);
    setAdComplete(false);
    // 📺 IMPLÉMENTATION ADMOB FUTURE :
    // Sur Android/iOS via Capacitor + plugin admob, remplacer cette simulation par :
    //   AdMob.showRewardVideoAd().then(() => { setAdComplete(true); openChest(); })
    // Voir DEPLOIEMENT_AdMob.md pour les détails
  };

  const handleAdComplete = () => {
    setShowAd(false);
    openChest();
  };

  // Sparkles for the chest
  const sparkles = useMemo(() =>
    Array.from({length: 12}).map((_, i) => ({
      x: 20 + Math.random() * 60,
      y: 20 + Math.random() * 60,
      delay: i * 0.2,
      size: 4 + Math.random() * 4,
    })), []);

  // ─── AD OVERLAY ───
  if (showAd) {
    return (
      <>
        <div style={{position:"fixed", inset:0, zIndex:200, background:"#000"}}/>
        <div style={{
          position:"fixed", inset:0, zIndex:201,
          display:"flex", flexDirection:"column",
          fontFamily:"'Rajdhani',sans-serif",
        }}>
          {/* Top bar with progress */}
          <div style={{
            background:"#0b1424", borderBottom:`1px solid ${C.brd}`,
            padding:"10px 14px",
          }}>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6}}>
              <span className="orb" style={{fontSize:10, color:"#94a3b8", letterSpacing:2}}>📺 PUBLICITÉ</span>
              <span className="orb" style={{fontSize:11, color: adComplete ? "#4ade80" : "#94a3b8"}}>
                {adComplete ? "✓ TERMINÉ" : `${Math.ceil((100-adProgress)/20)}s`}
              </span>
            </div>
            <div style={{height:3, background:"#1e3a5f", borderRadius:2, overflow:"hidden"}}>
              <div style={{
                width:`${adProgress}%`, height:"100%",
                background: adComplete ? "#4ade80" : `linear-gradient(90deg, ${C.cy}, ${r.col})`,
                transition:"width .1s linear, background .3s",
              }}/>
            </div>
          </div>

          {/* Fake ad content */}
          <div style={{
            flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
            padding:24, textAlign:"center",
            background:"radial-gradient(circle at 50% 30%, #1a2a4a 0%, #050a18 100%)",
          }}>
            <div style={{fontSize:80, marginBottom:18, animation:"chestBob 2s ease-in-out infinite"}}>🎮</div>
            <div className="orb" style={{
              fontSize:22, color:"#fff", letterSpacing:4, marginBottom:10,
              textShadow:`0 0 18px ${C.cy}`,
            }}>WORLD DOMINATION</div>
            <div style={{fontSize:14, color:"#94a3b8", marginBottom:22, maxWidth:280, lineHeight:1.5}}>
              Conquiers le monde dans un jeu de stratégie cyberpunk addictif. Bâtis ton empire post-apocalyptique !
            </div>
            <div style={{
              display:"flex", gap:8, marginBottom:24,
            }}>
              {[1,2,3,4,5].map(i => <span key={i} style={{fontSize:18, color:"#fbbf24"}}>⭐</span>)}
              <span style={{fontSize:13, color:"#94a3b8", marginLeft:6}}>4.8 · 10k+ joueurs</span>
            </div>
            <div style={{
              padding:"14px 36px", background:`linear-gradient(135deg, ${C.cy}33, ${C.cy}66)`,
              border:`1px solid ${C.cy}`, borderRadius:12,
              color:"#fff", fontSize:15, fontWeight:700, letterSpacing:2,
              fontFamily:"Orbitron",
            }}>
              JOUER MAINTENANT →
            </div>
            <div style={{fontSize:10, color:"#475569", marginTop:24, letterSpacing:1}}>
              [ Simulation publicitaire — vraie pub via AdMob en production ]
            </div>
          </div>

          {/* Bottom action */}
          <div style={{padding:14, background:"#0b1424", borderTop:`1px solid ${C.brd}`}}>
            {adComplete ? (
              <button onClick={handleAdComplete} className="rip" style={{
                width:"100%", padding:"14px",
                background:`linear-gradient(135deg, #4ade8033, #4ade8066)`,
                border:`1.5px solid #4ade80`, borderRadius:10,
                color:"#fff", fontSize:14, cursor:"pointer",
                fontFamily:"'Rajdhani',sans-serif", fontWeight:700, letterSpacing:2,
                boxShadow:`0 0 18px #4ade8088`,
              }}>✨ RÉCUPÉRER MA RÉCOMPENSE</button>
            ) : (
              <div style={{textAlign:"center", fontSize:11, color:"#64748b"}}>
                Patientez jusqu'à la fin pour obtenir votre récompense...
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div onClick={dismiss} style={{
        position:"fixed", inset:0, zIndex:170,
        background:`radial-gradient(circle at 50% 50%, ${r.glow}, rgba(0,0,0,0.92))`,
      }}/>
      <div style={{
        position:"fixed", top:"50%", left:"50%",
        width:"calc(100% - 40px)", maxWidth:360,
        background:`linear-gradient(135deg, #0b1424 0%, ${r.col}15 100%)`,
        border:`2px solid ${r.col}`, borderRadius:18,
        padding:"24px 18px", zIndex:171, textAlign:"center",
        animation: opened
          ? "chestPopIn 0.4s cubic-bezier(.34,1.56,.64,1) forwards"
          : "chestPopIn 0.5s cubic-bezier(.34,1.56,.64,1) forwards",
        boxShadow:`0 0 60px ${r.glow}, inset 0 0 30px ${r.col}22`,
      }}>
        {/* Background glow circle */}
        <div style={{
          position:"absolute", top:"30%", left:"50%",
          transform:"translate(-50%,-50%)",
          width:200, height:200, borderRadius:"50%",
          background:`radial-gradient(circle, ${r.col}44 0%, transparent 70%)`,
          animation:"glowBg 2s ease-in-out infinite",
          pointerEvents:"none",
        }}/>

        {/* Sparkles */}
        {sparkles.map((s, i) => (
          <div key={i} style={{
            position:"absolute", left:`${s.x}%`, top:`${s.y}%`,
            width:s.size, height:s.size, borderRadius:"50%",
            background:r.col,
            boxShadow:`0 0 ${s.size*2}px ${r.col}`,
            animation:`floatUp 2.5s ease-out ${s.delay}s infinite`,
            pointerEvents:"none",
          }}/>
        ))}

        <div className="orb" style={{
          fontSize:11, color:r.col, letterSpacing:5, opacity:0.85, marginBottom:6,
          textShadow:`0 0 10px ${r.col}`,
        }}>━━ TROUVÉ ━━</div>

        <div className="orb" style={{
          fontSize:17, color:"#fff", letterSpacing:3, fontWeight:900, marginBottom:14,
          textShadow:`0 0 14px ${r.col}`,
        }}>{r.name.toUpperCase()}</div>

        {!opened ? (
          <>
            {/* Closed chest */}
            <div style={{position:"relative", height:140, marginBottom:14}}>
              <div style={{
                position:"absolute", top:"50%", left:"50%",
                width:80, height:80, borderRadius:"50%",
                background:`radial-gradient(circle, ${r.col}88, transparent 70%)`,
                filter:"blur(8px)",
                animation:"lightBurst 1.8s ease-out infinite",
              }}/>
              <div style={{
                position:"absolute", top:"50%", left:"50%",
                fontSize:90, lineHeight:1,
                filter:`drop-shadow(0 0 18px ${r.col}) drop-shadow(0 0 40px ${r.glow})`,
                animation:"chestShake 0.7s ease-in-out infinite",
              }}>{r.e}</div>
            </div>

              {/* Reward preview — tease the player */}
              <div style={{
                background:"rgba(0,0,0,0.45)", border:`1px solid ${r.col}55`,
                borderRadius:12, padding:"10px 12px", marginBottom:14,
              }}>
                <div className="orb" style={{fontSize:9, color:r.col, marginBottom:8, letterSpacing:2}}>
                  🎁 APERÇU DES RÉCOMPENSES
                </div>
                <div style={{display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap"}}>
                  {chest.rewards.items.map((item,i) => {
                    const cfg = RES_CFG[item.type];
                    return (
                      <div key={i} style={{
                        background:`${cfg.col}15`, border:`1px solid ${cfg.col}55`,
                        borderRadius:8, padding:"6px 10px",
                        display:"flex", alignItems:"center", gap:5,
                      }}>
                        <span style={{fontSize:18}}>{cfg.e}</span>
                        <span className="orb" style={{fontSize:13, color:"#fff", fontWeight:700}}>+{item.amount}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{fontSize:10, color:"#64748b", textAlign:"center", marginTop:8}}>
                  ✅ Ces ressources vous attendent — regardez juste 5s de pub !
                </div>
              </div>

              <div style={{display:"flex", flexDirection:"column", gap:8}}>
                <button onClick={handleWatchAd} className="rip" style={{
                  width:"100%", padding:"14px",
                  background:`linear-gradient(135deg, ${r.col}44, ${r.col}88)`,
                  border:`2px solid ${r.col}`, borderRadius:10,
                  color:"#fff", fontSize:14, cursor:"pointer",
                  fontFamily:"'Rajdhani',sans-serif", fontWeight:900, letterSpacing:2,
                  boxShadow:`0 0 28px ${r.col}66, inset 0 0 12px ${r.col}22`,
                  display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                  animation:"pls 1.6s infinite",
                }}>
                  <span style={{fontSize:20}}>📺</span>
                  <span>PUB (5s) → OUVRIR GRATUITEMENT</span>
                </button>
                <div style={{textAlign:"center", fontSize:10, color:"#475569"}}>
                  ⏱️ Seulement 5 secondes · Pas d'achat requis
                </div>
                <button onClick={dismiss} className="rip" style={{
                  width:"100%", padding:"8px",
                  background:"transparent", border:`1px solid #334155`, borderRadius:8,
                  color:"#475569", fontSize:10, cursor:"pointer",
                  fontFamily:"'Rajdhani',sans-serif", fontWeight:500,
                }}>↩ Ignorer (coffre perdu)</button>
              </div>
          </>
        ) : (
          <>
            {/* Opened chest */}
            <div style={{position:"relative", height:80, marginBottom:14}}>
              <div style={{
                position:"absolute", top:"50%", left:"50%",
                width:120, height:120, borderRadius:"50%",
                background:`radial-gradient(circle, ${r.col}88, transparent 70%)`,
                filter:"blur(12px)",
                animation:"lightBurst 1.5s ease-out infinite",
                transform:"translate(-50%,-50%)",
              }}/>
              <div style={{
                position:"absolute", top:"50%", left:"50%",
                transform:"translate(-50%,-50%)",
                fontSize:60, lineHeight:1,
                filter:`drop-shadow(0 0 22px ${r.col})`,
                animation:"chestOpen 0.6s ease-out forwards",
              }}>✨</div>
            </div>

            {/* Rewards list */}
            <div style={{
              background:"rgba(0,0,0,0.4)", border:`1px solid ${r.col}44`,
              borderRadius:12, padding:14, marginBottom:14,
            }}>
              <div className="orb" style={{
                fontSize:9, color:r.col, marginBottom:10, letterSpacing:2,
              }}>RÉCOMPENSES</div>
              <div style={{display:"flex", flexDirection:"column", gap:8}}>
                {chest.rewards.items.map((item, i) => {
                  const cfg = RES_CFG[item.type];
                  return (
                    <div key={i} style={{
                      display:"flex", alignItems:"center", gap:10,
                      padding:"8px 12px", background:`${cfg.col}11`,
                      border:`1px solid ${cfg.col}44`, borderRadius:8,
                      animation:`itemPop 0.5s cubic-bezier(.34,1.56,.64,1) ${i*0.15}s both`,
                    }}>
                      <span style={{fontSize:22, filter:`drop-shadow(0 0 6px ${cfg.col}88)`}}>{cfg.e}</span>
                      <span style={{flex:1, textAlign:"left", fontSize:12, color:"#dde4f0", textTransform:"capitalize"}}>
                        {item.type}
                      </span>
                      <span className="orb" style={{
                        fontSize:14, color:cfg.col, fontWeight:700,
                        textShadow:`0 0 8px ${cfg.col}66`,
                      }}>+{item.amount}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <button onClick={claimChest} className="rip" style={{
              width:"100%", padding:"12px",
              background:`linear-gradient(135deg, ${r.col}44, ${r.col}88)`,
              border:`1.5px solid ${r.col}`, borderRadius:10,
              color:"#fff", fontSize:13, cursor:"pointer",
              fontFamily:"'Rajdhani',sans-serif", fontWeight:700, letterSpacing:2,
              boxShadow:`0 0 22px ${r.col}88`,
            }}>🎁 RÉCUPÉRER</button>
          </>
        )}
      </div>
    </>
  );
}

// ═══════════════════════════════════════ CASINO TAB ════════════════════════
function CasinoTab({ res, setRes, notify, St, C }) {
  const [game, setGame] = useState(null); // 'slots' | 'wheel' | 'bet'

  if (game === "slots") return <SlotMachineGame res={res} setRes={setRes} notify={notify} onBack={()=>setGame(null)} C={C}/>;
  if (game === "wheel") return <WheelGame res={res} setRes={setRes} notify={notify} onBack={()=>setGame(null)} C={C}/>;
  if (game === "bet")   return <BetGame res={res} setRes={setRes} notify={notify} onBack={()=>setGame(null)} C={C}/>;

  const games = [
    { id:"slots", e:"🎰", name:"Machine à Sous", desc:"3 rouleaux · jackpot ×100", col:"#fbbf24", min:"50 🪙" },
    { id:"wheel", e:"🎡", name:"Roue de la Fortune", desc:"8 secteurs · gains variables", col:"#a855f7", min:"100 🪙" },
    { id:"bet",   e:"🎲", name:"Pari Double ou Rien", desc:"Pile ou face · ×2 ou 0", col:"#ef4444", min:"30 🪙" },
  ];

  return (
    <div>
      <div style={{
        ...St.card,
        background:"linear-gradient(135deg, #1a1500, #2a1500)",
        border:"1px solid #fbbf2466", textAlign:"center",
      }}>
        <div style={{fontSize:48, marginBottom:6, animation:"chestBob 2s ease-in-out infinite"}}>🎰</div>
        <div className="orb" style={{fontSize:16, color:"#fbbf24", letterSpacing:3, fontWeight:900, textShadow:"0 0 14px #fbbf2488"}}>
          NEON CASINO
        </div>
        <div style={{fontSize:11, color:"#94a3b8", marginTop:4}}>
          Tente ta chance avec tes ressources !
        </div>
      </div>

      <div className="orb" style={{fontSize:10, color:C.cy, marginBottom:10, letterSpacing:2, paddingLeft:4}}>
        ◆ JEUX DISPONIBLES
      </div>

      {games.map(g => (
        <button key={g.id} onClick={()=>setGame(g.id)} className="rip" style={{
          width:"100%", display:"flex", alignItems:"center", gap:12,
          padding:"14px 14px", marginBottom:10,
          background:`linear-gradient(135deg, ${C.card}, ${g.col}11)`,
          border:`1px solid ${g.col}44`, borderRadius:12,
          color:"#dde4f0", textAlign:"left", cursor:"pointer",
          fontFamily:"'Rajdhani',sans-serif",
          boxShadow:`0 0 14px ${g.col}22`,
        }}>
          <div style={{
            fontSize:32, filter:`drop-shadow(0 0 10px ${g.col}88)`,
            width:48, textAlign:"center",
          }}>{g.e}</div>
          <div style={{flex:1}}>
            <div className="orb" style={{fontSize:13, color:g.col, letterSpacing:2, fontWeight:700}}>
              {g.name}
            </div>
            <div style={{fontSize:11, color:"#94a3b8", marginTop:3}}>{g.desc}</div>
            <div style={{fontSize:10, color:"#fbbf24", marginTop:3}}>Mise min: {g.min}</div>
          </div>
          <div className="orb" style={{color:g.col, fontSize:22, opacity:0.7}}>›</div>
        </button>
      ))}

      <div style={{
        ...St.card, marginTop:14,
        background:"#0d1828", border:`1px solid ${C.brd}`,
      }}>
        <div className="orb" style={{fontSize:10, color:"#94a3b8", marginBottom:6, letterSpacing:2}}>
          ⚠️ JOUEZ RESPONSABLE
        </div>
        <div style={{fontSize:11, color:"#64748b", lineHeight:1.5}}>
          Le casino est un jeu de pur hasard. Ne misez que ce que vous pouvez vous permettre de perdre. Pas de monnaie réelle utilisée.
        </div>
      </div>
    </div>
  );
}

// ─── 🎰 SLOT MACHINE ───
// ─── HELPER: Casino Styles (standalone, no St dependency) ───
const CASINO_CARD = { background:"#0b1424", border:"1px solid #1a3050", borderRadius:12, padding:13, marginBottom:11 };
const fmt2 = n => n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"k" : Math.floor(n).toString();

// ─── HELPER: Casino Game Wrapper ───
function CasinoGameWrapper({ children, onBack, title, color, credits }) {
  return (
    <div>
      <div style={{display:"flex", alignItems:"center", gap:12, marginBottom:14}}>
        <button onClick={onBack} className="rip" style={{
          background:"#0d1828", border:"1px solid #1a3050", borderRadius:10,
          width:36, height:36, color:"#00f5d4", fontSize:16, cursor:"pointer", flexShrink:0,
        }}>←</button>
        <div className="orb" style={{
          fontSize:13, color, letterSpacing:3, flex:1, fontWeight:700,
          textShadow:`0 0 14px ${color}66`,
        }}>{title}</div>
        <div style={{
          background:"#0d1828", border:"1px solid #fbbf2466", borderRadius:18,
          padding:"4px 10px", fontSize:11, color:"#fbbf24",
        }}>
          🪙 {fmt2(credits)}
        </div>
      </div>
      {children}
    </div>
  );
}

// ─── HELPER: Bet Amount Control ───
function CasinoBetControl({ bet, setBet, maxBet, minBet, disabled }) {
  return (
    <div style={{...CASINO_CARD, marginBottom:14}}>
      <div className="orb" style={{fontSize:10, color:"#fbbf24", marginBottom:10, letterSpacing:2}}>
        💰 MISE
      </div>
      <div style={{display:"flex", gap:8, alignItems:"center", marginBottom:10}}>
        <button onClick={()=>setBet(b => Math.max(minBet, b - minBet))} disabled={disabled} className="rip" style={{
          width:40, height:40, background:"#040810", border:"1px solid #1a3050",
          borderRadius:8, color:"#94a3b8", fontSize:18, cursor: disabled?"not-allowed":"pointer",
        }}>−</button>
        <div style={{
          flex:1, textAlign:"center", padding:"10px",
          background:"#040810", border:"1px solid #fbbf2466", borderRadius:8,
        }}>
          <span className="orb" style={{fontSize:18, color:"#fbbf24", fontWeight:700}}>
            {bet} 🪙
          </span>
        </div>
        <button onClick={()=>setBet(b => Math.min(maxBet, b + minBet))} disabled={disabled} className="rip" style={{
          width:40, height:40, background:"#040810", border:"1px solid #1a3050",
          borderRadius:8, color:"#fbbf24", fontSize:18, cursor: disabled?"not-allowed":"pointer",
        }}>+</button>
      </div>
      <div style={{display:"flex", gap:6}}>
        {[1,2,5,10].map(m => (
          <button key={m} onClick={()=>setBet(Math.min(maxBet, minBet * m))} disabled={disabled} className="rip" style={{
            flex:1, padding:"6px", background:"#040810", border:"1px solid #1a3050",
            borderRadius:6, color:"#94a3b8", fontSize:10, cursor: disabled?"not-allowed":"pointer",
            fontFamily:"'Rajdhani',sans-serif", fontWeight:600,
          }}>×{m}</button>
        ))}
        <button onClick={()=>setBet(maxBet)} disabled={disabled} className="rip" style={{
          flex:1, padding:"6px", background:"#1a1500", border:"1px solid #fbbf2466",
          borderRadius:6, color:"#fbbf24", fontSize:10, cursor: disabled?"not-allowed":"pointer",
          fontFamily:"'Rajdhani',sans-serif", fontWeight:600,
        }}>MAX</button>
      </div>
    </div>
  );
}

// ─── 🎰 SLOT MACHINE ───
function SlotMachineGame({ res, setRes, notify, onBack, C }) {
  const SYMBOLS = ["🍒","💎","⭐","🔔","💰","7️⃣","🍋","🎰"];
  const PAYOUTS = { "7️⃣":100, "💰":50, "💎":25, "⭐":15, "🔔":10, "🍒":5, "🍋":3, "🎰":2 };
  const [bet, setBet] = useState(50);
  const [reels, setReels] = useState([0,1,2]);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);

  const spin = () => {
    if (spinning) return;
    if ((res.credits||0) < bet) { notify("Crédits insuffisants !", "bad"); return; }

    setRes(r => ({...r, credits:(r.credits||0) - bet}));
    setSpinning(true);
    setResult(null);

    // Use refs to hold live reel values during animation
    const live = [0,1,2];
    let stopped = [false,false,false];

    const iv = setInterval(() => {
      if (!stopped[0]) live[0] = Math.floor(Math.random()*SYMBOLS.length);
      if (!stopped[1]) live[1] = Math.floor(Math.random()*SYMBOLS.length);
      if (!stopped[2]) live[2] = Math.floor(Math.random()*SYMBOLS.length);
      setReels([...live]);
    }, 80);

    // Stop reels one by one
    const stop = (idx, delay) => setTimeout(() => {
      stopped[idx] = true;
    }, delay);
    stop(0, 900);
    stop(1, 1400);
    stop(2, 1900);

    setTimeout(() => {
      clearInterval(iv);
      // Final result — sometimes force a triple for excitement
      let finals = live.map(() => Math.floor(Math.random()*SYMBOLS.length));
      if (Math.random() < 0.07) finals = [finals[0], finals[0], finals[0]]; // 7% jackpot chance
      setReels([...finals]);
      setSpinning(false);

      const syms = finals.map(i => SYMBOLS[i]);
      let payout = 0;
      let type = "lose";
      if (syms[0]===syms[1] && syms[1]===syms[2]) {
        payout = bet * (PAYOUTS[syms[0]]||2);
        type = syms[0]==="7️⃣" ? "jackpot" : "win";
      } else if (syms[0]===syms[1] || syms[1]===syms[2] || syms[0]===syms[2]) {
        payout = bet * 2; type = "small";
      }
      if (payout > 0) {
        setRes(r => ({...r, credits:(r.credits||0)+payout}));
        notify(type==="jackpot" ? `🎰 JACKPOT ! +${payout} 🪙` : `✅ Gagné ! +${payout} 🪙`, type==="jackpot"?"jackpot":"good");
      } else {
        notify("😔 Perdu... retente ta chance !", "bad");
      }
      setResult({syms, payout, type});
    }, 2100);
  };

  const maxBet = Math.min(1000, Math.max(50, res.credits||0));

  return (
    <CasinoGameWrapper onBack={onBack} title="🎰 MACHINE À SOUS" color="#fbbf24" credits={res.credits||0}>
      <div style={{
        background:"linear-gradient(135deg,#1a1500,#2a1500)",
        border:"2px solid #fbbf24", borderRadius:14, padding:18, marginBottom:14,
        boxShadow:"0 0 30px rgba(251,191,36,0.3), inset 0 0 20px rgba(251,191,36,0.15)",
      }}>
        {/* Reels */}
        <div style={{display:"flex", gap:8, justifyContent:"center", marginBottom:14}}>
          {reels.map((idx,i) => (
            <div key={i} style={{
              width:80, height:88,
              background:"linear-gradient(180deg,#fff9dc,#f0d050)",
              border:"3px solid #fbbf24", borderRadius:10,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:44, lineHeight:1,
              boxShadow:"inset 0 2px 8px rgba(0,0,0,0.35)",
              animation: spinning?"shake 0.09s infinite alternate":"none",
              filter: result?.type==="jackpot"?"drop-shadow(0 0 14px gold)":"none",
              transition:"filter 0.3s",
            }}>
              {SYMBOLS[idx]}
            </div>
          ))}
        </div>

        {/* Result banner */}
        {result && !spinning && (
          <div style={{
            textAlign:"center", padding:"9px",
            background: result.payout>0 ? "rgba(74,222,128,0.15)" : "rgba(239,68,68,0.15)",
            border:`1px solid ${result.payout>0?"#4ade80":"#ef4444"}66`, borderRadius:8,
          }}>
            <div className="orb" style={{
              fontSize:13, color:result.payout>0?"#4ade80":"#ef4444",
              letterSpacing:2, fontWeight:700,
            }}>
              {result.type==="jackpot" ? "💰 JACKPOT !" : result.payout>0 ? `+${result.payout} 🪙` : "PERDU"}
            </div>
          </div>
        )}
      </div>

      <CasinoBetControl bet={bet} setBet={setBet} maxBet={maxBet} minBet={50} disabled={spinning}/>

      <button onClick={spin} disabled={spinning || (res.credits||0)<bet} className="rip" style={{
        width:"100%", padding:"15px",
        background: spinning||((res.credits||0)<bet) ? "#1e3a5f" : "linear-gradient(135deg,#fbbf2444,#fbbf2488)",
        border: spinning ? "1px solid #445" : "1.5px solid #fbbf24",
        borderRadius:12, color:"#fff", fontSize:14,
        cursor: spinning||(res.credits||0)<bet ? "not-allowed":"pointer",
        fontFamily:"'Rajdhani',sans-serif", fontWeight:700, letterSpacing:3,
        boxShadow: spinning ? "none" : "0 0 22px rgba(251,191,36,0.5)",
        opacity: (res.credits||0)<bet ? 0.5:1,
      }}>
        {spinning ? "🎰 EN COURS..." : `🎰 LANCER (−${bet} 🪙)`}
      </button>

      <div style={{...CASINO_CARD, marginTop:14, fontSize:11, color:"#94a3b8"}}>
        <div className="orb" style={{fontSize:10, color:"#fbbf24", marginBottom:8, letterSpacing:2}}>💰 TABLE DES GAINS</div>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:5}}>
          {[["7️⃣ 7️⃣ 7️⃣","×100"],["💰 💰 💰","×50"],["💎 💎 💎","×25"],["⭐ ⭐ ⭐","×15"],["🔔 🔔 🔔","×10"],["2 identiques","×2"]].map(([s,p])=>(
            <div key={s} style={{display:"flex", justifyContent:"space-between", padding:"3px 0"}}>
              <span>{s}</span>
              <span style={{color:"#fbbf24", fontFamily:"Orbitron", fontSize:10}}>{p}</span>
            </div>
          ))}
        </div>
      </div>
    </CasinoGameWrapper>
  );
}

// ─── 🎡 WHEEL OF FORTUNE ───
function WheelGame({ res, setRes, notify, onBack, C }) {
  const SECTORS = [
    { label:"×0",  color:"#374151", multi:0 },
    { label:"×1.5",color:"#6b7280", multi:1.5 },
    { label:"×0",  color:"#374151", multi:0 },
    { label:"×3",  color:"#2563eb", multi:3 },
    { label:"×0",  color:"#374151", multi:0 },
    { label:"×2",  color:"#059669", multi:2 },
    { label:"×5",  color:"#7c3aed", multi:5 },
    { label:"×10", color:"#d97706", multi:10 },
  ];
  const N = SECTORS.length;
  const [bet, setBet] = useState(100);
  const [deg, setDeg] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const degRef = useState(0);
  const totalDeg = useState(0);

  const spin = () => {
    if (spinning) return;
    if ((res.credits||0) < bet) { notify("Crédits insuffisants !", "bad"); return; }
    setRes(r => ({...r, credits:(r.credits||0)-bet}));
    setSpinning(true); setResult(null);

    const target = Math.floor(Math.random()*N);
    const sectorDeg = 360/N;
    const landAngle = sectorDeg*target + sectorDeg/2;
    const spins = (5+Math.floor(Math.random()*3))*360;
    const finalDeg = deg + spins + (360 - landAngle);
    setDeg(finalDeg);

    setTimeout(()=>{
      const sec = SECTORS[target];
      const payout = Math.round(bet * sec.multi);
      if (payout>0) {
        setRes(r=>({...r, credits:(r.credits||0)+payout}));
        notify(sec.multi>=5 ? `🎰 ${sec.label} ! +${payout} 🪙` : `✅ ${sec.label} ! +${payout} 🪙`, sec.multi>=5?"jackpot":"good");
      } else notify("😔 Perdu !", "bad");
      setResult({sector:target, payout, label:sec.label});
      setSpinning(false);
    }, 4200);
  };

  const maxBet = Math.min(2000, Math.max(100, res.credits||0));
  const sectorDeg = 360/N;

  return (
    <CasinoGameWrapper onBack={onBack} title="🎡 ROUE DE LA FORTUNE" color="#a855f7" credits={res.credits||0}>
      <div style={{position:"relative", width:260, height:260, margin:"0 auto 16px"}}>
        {/* Wheel SVG */}
        <svg width="260" height="260" style={{
          transform:`rotate(${deg}deg)`,
          transition: spinning ? "transform 4.2s cubic-bezier(.17,.67,.12,1)" : "none",
          filter:"drop-shadow(0 0 14px rgba(168,85,247,0.5))",
        }}>
          <circle cx="130" cy="130" r="128" fill="#0b1424" stroke="#a855f7" strokeWidth="3"/>
          {SECTORS.map((sec,i) => {
            const startAngle = (i*sectorDeg - 90) * Math.PI/180;
            const endAngle   = ((i+1)*sectorDeg - 90) * Math.PI/180;
            const x1 = 130 + 125*Math.cos(startAngle);
            const y1 = 130 + 125*Math.sin(startAngle);
            const x2 = 130 + 125*Math.cos(endAngle);
            const y2 = 130 + 125*Math.sin(endAngle);
            const midAngle = ((i+0.5)*sectorDeg - 90) * Math.PI/180;
            const lx = 130 + 88*Math.cos(midAngle);
            const ly = 130 + 88*Math.sin(midAngle);
            return (
              <g key={i}>
                <path d={`M130,130 L${x1},${y1} A125,125 0 0,1 ${x2},${y2} Z`}
                  fill={sec.color} stroke="#0b1424" strokeWidth="1.5"/>
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                  fill="#fff" fontSize="13" fontFamily="Orbitron" fontWeight="bold"
                  style={{userSelect:"none"}}>
                  {sec.label}
                </text>
              </g>
            );
          })}
          {/* Center */}
          <circle cx="130" cy="130" r="22" fill="#fbbf24" stroke="#fff" strokeWidth="2"/>
          <text x="130" y="135" textAnchor="middle" fontSize="18" style={{userSelect:"none"}}>🎯</text>
        </svg>
        {/* Pointer */}
        <div style={{
          position:"absolute", top:-6, left:"50%", transform:"translateX(-50%)",
          width:0, height:0,
          borderLeft:"13px solid transparent",
          borderRight:"13px solid transparent",
          borderTop:"22px solid #ef4444",
          filter:"drop-shadow(0 2px 4px rgba(0,0,0,0.6))",
          zIndex:5,
        }}/>
      </div>

      {result && !spinning && (
        <div style={{
          textAlign:"center", padding:"10px", marginBottom:14,
          background: result.payout>0?"rgba(74,222,128,0.15)":"rgba(239,68,68,0.15)",
          border:`1px solid ${result.payout>0?"#4ade80":"#ef4444"}66`, borderRadius:8,
        }}>
          <div className="orb" style={{
            fontSize:14, color:result.payout>0?"#4ade80":"#ef4444",
            letterSpacing:2, fontWeight:700,
          }}>
            {result.payout>0 ? `${result.label} — +${result.payout} 🪙` : "❌ PERDU"}
          </div>
        </div>
      )}

      <CasinoBetControl bet={bet} setBet={setBet} maxBet={maxBet} minBet={100} disabled={spinning}/>

      <button onClick={spin} disabled={spinning||(res.credits||0)<bet} className="rip" style={{
        width:"100%", padding:"15px",
        background: spinning||(res.credits||0)<bet ? "#1e3a5f":"linear-gradient(135deg,#a855f744,#a855f788)",
        border: spinning?"1px solid #445":"1.5px solid #a855f7",
        borderRadius:12, color:"#fff", fontSize:14,
        cursor: spinning||(res.credits||0)<bet?"not-allowed":"pointer",
        fontFamily:"'Rajdhani',sans-serif", fontWeight:700, letterSpacing:3,
        boxShadow: spinning?"none":"0 0 22px rgba(168,85,247,0.5)",
        opacity:(res.credits||0)<bet?0.5:1,
      }}>
        {spinning ? "🎡 EN COURS..." : `🎡 LANCER (−${bet} 🪙)`}
      </button>
    </CasinoGameWrapper>
  );
}

// ─── 🎲 PILE OU FACE ───
function BetGame({ res, setRes, notify, onBack, C }) {
  const [bet, setBet] = useState(30);
  const [flipping, setFlipping] = useState(false);
  const [coinSide, setCoinSide] = useState("🪙");
  const [result, setResult] = useState(null);
  const [stack, setStack] = useState(0);
  const [flipCount, setFlipCount] = useState(0);

  const flip = (choice) => {
    if (flipping) return;
    const wager = stack > 0 ? stack : bet;
    if (stack === 0 && (res.credits||0) < bet) { notify("Crédits insuffisants !", "bad"); return; }
    if (stack === 0) setRes(r => ({...r, credits:(r.credits||0)-bet}));

    setFlipping(true);
    setResult(null);
    setCoinSide("🪙");
    setFlipCount(c => c+1);

    setTimeout(()=>{
      const flipResult = Math.random()<0.5 ? "heads" : "tails";
      const won = choice === flipResult;
      setCoinSide(flipResult==="heads" ? "🟡" : "⚪");
      setResult({flipResult, won, choice, wager});
      if (won) {
        const newStack = wager*2;
        setStack(newStack);
        notify(`✅ ${flipResult==="heads"?"PILE":"FACE"} ! Stack → ${newStack} 🪙`, "good");
      } else {
        setStack(0);
        notify(`💔 ${flipResult==="heads"?"PILE":"FACE"} ! Perdu.`, "bad");
      }
      setFlipping(false);
    }, 1500);
  };

  const cashOut = () => {
    if (!stack) return;
    setRes(r=>({...r, credits:(r.credits||0)+stack}));
    notify(`💰 Encaissé : +${stack} 🪙 !`, "jackpot");
    setStack(0); setResult(null);
  };

  const maxBet = Math.min(500, Math.max(30, res.credits||0));
  const canPlay = !flipping && (stack>0 || (res.credits||0)>=bet);

  return (
    <CasinoGameWrapper onBack={onBack} title="🎲 PILE OU FACE" color="#ef4444" credits={res.credits||0}>
      <div style={{
        background:"linear-gradient(135deg,#1a0505,#2a0a0a)",
        border:"2px solid #ef4444", borderRadius:14, padding:24, marginBottom:14,
        textAlign:"center",
        boxShadow:"0 0 30px rgba(239,68,68,0.3), inset 0 0 20px rgba(239,68,68,0.1)",
      }}>
        {/* Coin */}
        <div key={flipCount} style={{
          fontSize:80, lineHeight:1, marginBottom:16,
          display:"inline-block",
          animation: flipping ? "coinFlip 1.4s cubic-bezier(.17,.67,.34,1) forwards" : "none",
          filter: result?.won ? "drop-shadow(0 0 18px gold)" : "none",
        }}>
          {flipping ? "🪙" : coinSide}
        </div>

        {result && !flipping && (
          <div className="orb" style={{
            fontSize:14, letterSpacing:3, fontWeight:700,
            color: result.won?"#4ade80":"#ef4444", marginBottom:8,
          }}>
            {result.flipResult==="heads"?"🟡 PILE":"⚪ FACE"} — {result.won?"✓ GAGNÉ":"✗ PERDU"}
          </div>
        )}

        {stack>0 && (
          <div style={{
            display:"inline-block", padding:"6px 14px",
            background:"rgba(74,222,128,0.15)", border:"1px solid #4ade80",
            borderRadius:8,
          }}>
            <span className="orb" style={{fontSize:13, color:"#4ade80", letterSpacing:1.5}}>
              💰 STACK : {stack} 🪙
            </span>
          </div>
        )}
      </div>

      {stack===0 && <CasinoBetControl bet={bet} setBet={setBet} maxBet={maxBet} minBet={30} disabled={flipping}/>}

      <div style={{display:"flex", gap:10, marginBottom:10}}>
        <button onClick={()=>flip("heads")} disabled={!canPlay} className="rip" style={{
          flex:1, padding:"14px",
          background:"linear-gradient(135deg,#fbbf2433,#fbbf2466)",
          border:"1.5px solid #fbbf24", borderRadius:12,
          color:"#fff", fontSize:14, cursor:canPlay?"pointer":"not-allowed",
          fontFamily:"'Rajdhani',sans-serif", fontWeight:700, letterSpacing:2,
          opacity:canPlay?1:0.4,
        }}>🟡 PILE</button>
        <button onClick={()=>flip("tails")} disabled={!canPlay} className="rip" style={{
          flex:1, padding:"14px",
          background:"linear-gradient(135deg,#64748b33,#64748b66)",
          border:"1.5px solid #94a3b8", borderRadius:12,
          color:"#fff", fontSize:14, cursor:canPlay?"pointer":"not-allowed",
          fontFamily:"'Rajdhani',sans-serif", fontWeight:700, letterSpacing:2,
          opacity:canPlay?1:0.4,
        }}>⚪ FACE</button>
      </div>

      {stack>0 && (
        <button onClick={cashOut} disabled={flipping} className="rip" style={{
          width:"100%", padding:"13px", marginBottom:10,
          background:"linear-gradient(135deg,#4ade8033,#4ade8066)",
          border:"1.5px solid #4ade80", borderRadius:12,
          color:"#fff", fontSize:14, cursor:"pointer",
          fontFamily:"'Rajdhani',sans-serif", fontWeight:700, letterSpacing:2,
          boxShadow:"0 0 18px rgba(74,222,128,0.5)",
        }}>💰 ENCAISSER {stack} 🪙</button>
      )}

      <div style={{...CASINO_CARD, marginTop:6, fontSize:11, color:"#94a3b8", lineHeight:1.6}}>
        <div className="orb" style={{fontSize:10, color:"#ef4444", marginBottom:6, letterSpacing:2}}>📜 RÈGLES</div>
        <div>• 50% de chance · choisis Pile ou Face</div>
        <div>• Victoire → ta mise est <strong style={{color:"#4ade80"}}>doublée dans le stack</strong></div>
        <div>• Relance pour doubler encore et encore</div>
        <div>• Encaisse avant de perdre tout le stack !</div>
      </div>
    </CasinoGameWrapper>
  );
}

// ═══════════════════════════════════════ TROOP MARCH ANIMATION ══════════════
function TroopMarchAnim({ anim, C }) {
  // Génère 4-6 petits soldats qui marchent depuis la base vers la zone cible
  const troops = useMemo(() => {
    const CELL_PX = CELL + 3; // CELL size + gap
    const mapLeft = 8; // padding map
    const mapTop = 80; // approximate header height
    // Base is always at CX, CY
    const bx = CX * CELL_PX + mapLeft + CELL_PX/2;
    const by = CY * CELL_PX + mapTop + CELL_PX/2;
    const tx = anim.toCell.x * CELL_PX + mapLeft + CELL_PX/2;
    const ty = anim.toCell.y * CELL_PX + mapTop + CELL_PX/2;
    return Array.from({length:5}).map((_, i) => ({
      offsetX: (Math.random()-0.5)*22,
      offsetY: (Math.random()-0.5)*22,
      delay: i * 0.18,
      e: ["🗡️","⚔️","🛡️","🗡️","⚔️"][i],
      startX: bx + (Math.random()-0.5)*20,
      startY: by + (Math.random()-0.5)*20,
      endX: tx + (Math.random()-0.5)*20,
      endY: ty + (Math.random()-0.5)*20,
    }));
  }, [anim]);

  return (
    <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:155 }}>
      {troops.map((t,i) => (
        <div key={i} style={{
          position:"absolute",
          left: t.startX,
          top: t.startY,
          fontSize:20,
          lineHeight:1,
          "--startX": "0px",
          "--startY": "0px",
          "--endX": `${t.endX - t.startX}px`,
          "--endY": `${t.endY - t.startY}px`,
          animation:`troopMarch 1.8s ease-in ${t.delay}s forwards`,
          filter:`drop-shadow(0 0 6px ${anim.win?"#00f5d4":"#ef4444"})`,
        }}>
          {t.e}
        </div>
      ))}
      {/* Explosion on arrival */}
      <div style={{
        position:"absolute",
        left: anim.toCell.x * (CELL+3) + 8 + CELL/2,
        top:  anim.toCell.y * (CELL+3) + 80 + CELL/2,
        pointerEvents:"none",
        animation:"mapBoom 0.8s ease-out 1.9s forwards",
        opacity:0,
        fontSize:28,
        transform:"translate(-50%,-50%)",
        filter:`drop-shadow(0 0 10px ${anim.win?"#00f5d4":"#ef4444"})`,
      }}>
        {anim.win ? "💥" : "💢"}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ RAIDER RUN ANIMATION ═══════════════
function RaiderRunAnim({ C }) {
  const raiders = useMemo(() => Array.from({length:3}).map((_,i)=>({
    y: 30 + i*18 + Math.random()*10,
    delay: i*0.5,
    scale: 0.8 + Math.random()*0.5,
    color: ["#ef4444","#dc2626","#991b1b"][i],
  })), []);

  return (
    <div style={{
      position:"fixed", inset:0, pointerEvents:"none", zIndex:165,
    }}>
      {/* Dark flash overlay */}
      <div style={{
        position:"absolute", inset:0,
        background:"radial-gradient(circle at 50% 60%, rgba(239,68,68,0.15), transparent 60%)",
        animation:"flashRed 0.5s ease-out",
      }}/>

      {/* Raiders running across screen */}
      {raiders.map((r,i) => (
        <div key={i} style={{
          position:"absolute",
          top:`${r.y}%`,
          left:0,
          display:"flex", alignItems:"flex-end", gap:4,
          animation:`raidRun 3.5s ease-in-out ${r.delay}s forwards`,
          transform:`scale(${r.scale})`,
          transformOrigin:"left center",
          filter:`drop-shadow(0 0 8px rgba(239,68,68,0.9))`,
        }}>
          {/* Raider body */}
          <div style={{fontSize:32, lineHeight:1, display:"flex", gap:2}}>
            <span>🏃</span>
            {/* Bag avec butin qui se balance */}
            <span style={{
              fontSize:20,
              animation:`bagBounce 0.4s ease-in-out infinite`,
              filter:"drop-shadow(0 0 4px gold)",
            }}>💰</span>
          </div>
        </div>
      ))}

      {/* Text label */}
      <div style={{
        position:"absolute", top:"15%", left:"50%",
        transform:"translateX(-50%)",
        fontFamily:"Orbitron", fontSize:13, color:"#ef4444",
        letterSpacing:4, fontWeight:900,
        textShadow:"0 0 14px #ef4444",
        animation:"raidRun 3.5s ease-in-out forwards",
        whiteSpace:"nowrap",
      }}>
        PILLARDS EN FUITE !
      </div>

      {/* Loot items falling behind raiders */}
      {["🌾","💎","⚡","🪙"].map((e,i)=>(
        <div key={e} style={{
          position:"absolute",
          top:`${raiders[0]?.y||35}%`,
          left:`${20+i*15}%`,
          fontSize:18,
          animation:`floatUp 2s ease-out ${0.8+i*0.3}s forwards`,
          opacity:0,
          filter:"drop-shadow(0 0 6px gold)",
        }}>{e}</div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════ PRESTIGE PROPOSAL ══════════════════
function PrestigeProposal({ prestige, doPrestige, onDismiss, C }) {
  const nextP = prestige + 1;
  const BONUSES = [
    { e:"⭐", label:`Prestige ${nextP}`, desc:"Nouveau départ, empire plus fort" },
    { e:"📈", label:`+${nextP*20}% production`, desc:"Toutes tes fermes, mines, etc." },
    { e:"⚔️", label:`+${nextP*15}% combat`, desc:"Troupes plus redoutables" },
    { e:"👷", label:`${4+nextP} Mineurs · ${2+nextP} Ingé · ${2+nextP} Déf`, desc:"Équipe de départ améliorée" },
    { e:"💎", label:`${nextP*3} ressources rares`, desc:"Pour commencer avec une avance" },
  ];

  const stars = useMemo(()=>Array.from({length:30}).map(()=>({
    x:Math.random()*100, y:Math.random()*100,
    size:4+Math.random()*8, delay:Math.random()*2,
  })),[]);

  return (
    <>
      {/* Dark backdrop */}
      <div style={{
        position:"fixed", inset:0, zIndex:300,
        background:"radial-gradient(ellipse at 50% 60%, rgba(179,71,255,0.25), rgba(0,0,0,0.92))",
      }}/>

      {/* Floating stars */}
      {stars.map((s,i)=>(
        <div key={i} style={{
          position:"fixed",
          left:`${s.x}%`, top:`${s.y}%`,
          width:s.size, height:s.size, borderRadius:"50%",
          background:"#b347ff",
          boxShadow:`0 0 ${s.size*2}px #b347ff`,
          zIndex:301, pointerEvents:"none",
          animation:`starFloat ${1.5+s.delay}s ease-in-out ${s.delay}s infinite`,
          opacity:0.6,
        }}/>
      ))}

      {/* Main panel */}
      <div style={{
        position:"fixed", bottom:0, left:"50%",
        transform:"translateX(-50%)",
        width:"100%", maxWidth:480,
        background:"linear-gradient(180deg, #0d0a1f 0%, #050210 100%)",
        border:"2px solid #b347ff",
        borderRadius:"22px 22px 0 0",
        padding:"24px 20px 36px",
        zIndex:302,
        animation:"proposalSlideUp 0.6s cubic-bezier(.34,1.56,.64,1) forwards, proposalPulse 3s ease-in-out 0.6s infinite",
        boxShadow:"0 -10px 60px rgba(179,71,255,0.6), inset 0 0 40px rgba(179,71,255,0.1)",
        maxHeight:"85vh", overflowY:"auto",
      }}>
        {/* Header */}
        <div style={{textAlign:"center", marginBottom:20}}>
          <div style={{
            fontSize:70, lineHeight:1, marginBottom:10,
            filter:"drop-shadow(0 0 24px #b347ff) drop-shadow(0 0 50px #b347ff88)",
            animation:"starFloat 2s ease-in-out infinite",
          }}>🚀</div>
          <div className="orb" style={{
            fontSize:11, color:"#b347ff", letterSpacing:6, marginBottom:6, opacity:0.8,
          }}>MISSION ACCOMPLIE</div>
          <h2 className="orb" style={{
            fontSize:22, color:"#fff", letterSpacing:4, fontWeight:900, marginBottom:6,
            textShadow:"0 0 20px #b347ff",
            background:"linear-gradient(180deg,#fff,#b347ff)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
          }}>
            PRESTIGE {nextP}
          </h2>
          <div style={{fontSize:12, color:"#94a3b8", lineHeight:1.6}}>
            Tu as conquis la carte entière. Ton empire est prêt pour<br/>
            un nouveau départ — <span style={{color:"#b347ff", fontWeight:700}}>plus puissant que jamais.</span>
          </div>
        </div>

        {/* Bonus list */}
        <div style={{
          background:"rgba(179,71,255,0.07)", border:"1px solid rgba(179,71,255,0.3)",
          borderRadius:14, padding:"14px 12px", marginBottom:16,
        }}>
          <div className="orb" style={{fontSize:9, color:"#b347ff", letterSpacing:3, marginBottom:12}}>
            ◆ BONUS PERMANENTS DÉBLOQUÉS
          </div>
          {BONUSES.map((b,i)=>(
            <div key={i} style={{
              display:"flex", gap:12, alignItems:"center",
              padding:"8px 0",
              borderBottom:i<BONUSES.length-1?"1px solid rgba(179,71,255,0.15)":"none",
            }}>
              <span style={{
                fontSize:24, filter:"drop-shadow(0 0 8px #b347ff88)",
                animation:`starFloat ${1.5+i*0.3}s ease-in-out ${i*0.2}s infinite`,
              }}>{b.e}</span>
              <div>
                <div className="orb" style={{fontSize:12, color:"#fff", fontWeight:700, letterSpacing:1}}>
                  {b.label}
                </div>
                <div style={{fontSize:10, color:"#64748b", marginTop:2}}>{b.desc}</div>
              </div>
              <span style={{marginLeft:"auto", color:"#4ade80", fontSize:16}}>✓</span>
            </div>
          ))}
        </div>

        {/* Warning */}
        <div style={{
          background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.3)",
          borderRadius:10, padding:"10px 12px", marginBottom:16,
          fontSize:11, color:"#fbbf24", lineHeight:1.5, textAlign:"center",
        }}>
          ⚠️ La map actuelle sera <strong>réinitialisée</strong>.<br/>
          Tes bâtiments, recherches et ressources repartent à zéro.
        </div>

        {/* Buttons */}
        <div style={{display:"flex", gap:10}}>
          <button onClick={onDismiss} className="rip" style={{
            padding:"13px 18px", background:"#0d1828",
            border:"1px solid #334155", borderRadius:12,
            color:"#64748b", fontSize:12, cursor:"pointer",
            fontFamily:"'Rajdhani',sans-serif", fontWeight:600,
          }}>Pas encore</button>
          <button onClick={doPrestige} className="rip" style={{
            flex:1, padding:"14px",
            background:"linear-gradient(135deg, #b347ff44, #b347ffaa)",
            border:"2px solid #b347ff",
            borderRadius:12, color:"#fff", fontSize:14, cursor:"pointer",
            fontFamily:"'Rajdhani',sans-serif", fontWeight:900, letterSpacing:3,
            boxShadow:"0 0 30px rgba(179,71,255,0.7)",
            display:"flex", alignItems:"center", justifyContent:"center", gap:8,
            animation:"proposalPulse 1.8s ease-in-out infinite",
          }}>
            <span style={{fontSize:20}}>🚀</span>
            <span>DÉCOLLER !</span>
          </button>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════ ROCKET LAUNCH ANIMATION ═════════════
function RocketLaunchAnim({ prestige, C }) {
  const nextP = prestige + 1;

  const warpLines = useMemo(()=>Array.from({length:24}).map(()=>({
    x: Math.random()*100,
    height: 40 + Math.random()*120,
    delay: Math.random()*1.5,
    col: Math.random()>0.6?"#b347ff":Math.random()>0.5?"#00f5d4":"#ffffff",
  })),[]);

  const sparks = useMemo(()=>Array.from({length:20}).map(()=>({
    angle: Math.random()*360,
    dist: 60+Math.random()*100,
    delay: Math.random()*0.8,
    size: 4+Math.random()*6,
  })),[]);

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:400,
      background:"#02050b",
      overflow:"hidden",
      fontFamily:"'Rajdhani',sans-serif",
    }}>
      {/* Warp lines — star warp effect */}
      {warpLines.map((l,i)=>(
        <div key={i} style={{
          position:"absolute",
          left:`${l.x}%`, top:"50%",
          width:1.5, height:l.height,
          background:`linear-gradient(180deg, transparent, ${l.col}, transparent)`,
          boxShadow:`0 0 4px ${l.col}`,
          animation:`starWarp 4.5s ease-in ${l.delay}s forwards`,
          opacity:0.7,
        }}/>
      ))}

      {/* Ground glow */}
      <div style={{
        position:"absolute", bottom:0, left:0, right:0, height:200,
        background:"radial-gradient(ellipse at 50% 100%, rgba(179,71,255,0.6), rgba(255,140,66,0.3) 30%, transparent 70%)",
        animation:"groundShake 0.15s ease-in-out 0.5s 8",
      }}/>

      {/* Smoke cloud */}
      <div style={{
        position:"absolute", bottom:"20%", left:"50%",
        width:200, height:80, borderRadius:"50%",
        background:"radial-gradient(ellipse, rgba(255,140,66,0.4), rgba(100,80,60,0.2), transparent)",
        filter:"blur(20px)",
        animation:"smokeRise 4s ease-out 0.3s forwards",
      }}/>

      {/* Sparks from launch */}
      {sparks.map((s,i)=>(
        <div key={i} style={{
          position:"absolute", bottom:"25%", left:"50%",
          width:s.size, height:s.size, borderRadius:"50%",
          background:"#ffe600",
          boxShadow:`0 0 ${s.size*2}px #ff8c42`,
          "--dx":`${Math.cos(s.angle*Math.PI/180)*s.dist}px`,
          "--dy":`${Math.sin(s.angle*Math.PI/180)*s.dist - 80}px`,
          animation:`sparkOut 1.2s ease-out ${s.delay}s forwards`,
        }}/>
      ))}

      {/* The rocket */}
      <div style={{
        position:"absolute", bottom:"22%", left:"50%",
        animation:"prestigeRocketLaunch 4.2s cubic-bezier(.2,.6,.4,1) 0.4s forwards",
      }}>
        {/* Flame */}
        <div style={{
          position:"absolute", bottom:"-80px", left:"50%",
          transform:"translateX(-50%)",
          width:60, height:180,
          background:"radial-gradient(ellipse 50% 100% at 50% 0%, #fff 0%, #ffe600 20%, #ff8c42 50%, transparent 100%)",
          filter:"blur(6px)",
          animation:"flame 0.08s infinite alternate",
          borderRadius:"50%",
        }}/>
        <div style={{
          position:"absolute", bottom:"-50px", left:"50%",
          transform:"translateX(-50%)",
          width:25, height:90,
          background:"radial-gradient(ellipse 50% 100% at 50% 0%, #fff, #ffe600, transparent)",
          filter:"blur(2px)",
          borderRadius:"50%",
          animation:"flame 0.06s infinite alternate-reverse",
        }}/>
        {/* Rocket */}
        <div style={{
          fontSize:110, lineHeight:1,
          filter:"drop-shadow(0 0 30px rgba(255,140,66,0.9)) drop-shadow(0 0 60px rgba(179,71,255,0.6))",
        }}>🚀</div>
      </div>

      {/* Flash white at peak */}
      <div style={{
        position:"absolute", inset:0,
        background:"#fff",
        animation:"flashWhite 1s ease-in-out 3.8s forwards",
        opacity:0, pointerEvents:"none",
      }}/>

      {/* Center text */}
      <div style={{
        position:"absolute", top:"15%", left:"50%",
        transform:"translateX(-50%)",
        textAlign:"center", pointerEvents:"none",
      }}>
        <div className="orb" style={{
          fontSize:13, color:"#b347ff", letterSpacing:6,
          textShadow:"0 0 20px #b347ff",
          animation:"pls 1.5s infinite",
        }}>DÉCOLLAGE !</div>
      </div>

      <div style={{
        position:"absolute", bottom:"8%", left:"50%",
        transform:"translateX(-50%)", textAlign:"center",
        pointerEvents:"none",
      }}>
        <div className="orb" style={{
          fontSize:10, color:"#475569", letterSpacing:4,
        }}>CHARGEMENT PRESTIGE {nextP}...</div>
        <div style={{
          width:200, height:3, background:"#1e3a5f", borderRadius:2,
          margin:"8px auto 0", overflow:"hidden",
        }}>
          <div style={{
            height:"100%", borderRadius:2,
            background:"linear-gradient(90deg,#b347ff,#00f5d4)",
            animation:"adProgress 4s linear 0.5s forwards",
          }}/>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ RAID MARCH ANIMATION ═══════════════
function RaidMarchAnim({ anim, timeLeft, totalTime, C }) {
  const CELL_PX = CELL + 3;
  const mapRef = useRef(null);
  const [mapRect, setMapRect] = useState(null);

  // Trouve la position réelle de la map dans le viewport
  useEffect(() => {
    const el = document.querySelector('.map-grid-inner');
    if (el) {
      const rect = el.getBoundingClientRect();
      setMapRect(rect);
    }
  }, []);

  const targetPxX = mapRect
    ? mapRect.left + anim.targetX * CELL_PX + CELL/2
    : 200; // fallback au centre
  const targetPxY = mapRect
    ? mapRect.top + anim.targetY * CELL_PX + CELL/2
    : 300;

  // Pillards — viennent de différents bords selon la position de la cible
  const raiders = useMemo(() => {
    const count = Object.values(anim.attackers).reduce((s,v)=>s+v, 0);
    const clampedCount = Math.min(count, 8);
    return Array.from({length: clampedCount}).map((_, i) => {
      // Départ depuis un bord aléatoire
      const side = (i + Math.floor(Math.random()*4)) % 4;
      let startX, startY;
      if (side === 0)       { startX = -60;   startY = 80 + i*30; }      // gauche
      else if (side === 1)  { startX = 520;   startY = 80 + i*30; }      // droite
      else if (side === 2)  { startX = 50+i*50; startY = -60; }          // haut
      else                  { startX = 50+i*50; startY = window.innerHeight+40; } // bas

      const delay = i * 0.35;
      const emojis = ["💀","🗡️","💀","🗡️","👹","💀","🗡️","🔥"];
      return { startX, startY, delay, e: emojis[i % emojis.length] };
    });
  }, [anim]);

  const pct = ((totalTime - timeLeft) / totalTime) * 100;
  const urgency = timeLeft <= 8;

  return (
    <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:140, overflow:"hidden" }}>

      {/* Danger rings expanding from target */}
      {[0, 0.6, 1.2].map((d,i) => (
        <div key={i} style={{
          position:"absolute",
          left: targetPxX, top: targetPxY,
          width: 60, height: 60,
          borderRadius:"50%",
          border:`2px solid #ef4444`,
          animation:`dangerRing 1.8s ease-out ${d}s infinite`,
          opacity:0,
        }}/>
      ))}

      {/* Target cell red highlight */}
      <div style={{
        position:"absolute",
        left: targetPxX - CELL/2, top: targetPxY - CELL/2,
        width: CELL, height: CELL,
        borderRadius:7,
        animation:`targetPulse 1s ease-in-out infinite`,
        border:`2px solid #ef4444`,
        background:"rgba(239,68,68,0.12)",
        pointerEvents:"none",
      }}/>

      {/* Skull on target */}
      <div style={{
        position:"absolute",
        left: targetPxX - 12, top: targetPxY - 28,
        fontSize:22, lineHeight:1,
        animation:`skullFloat 1.2s ease-in-out infinite`,
        filter:"drop-shadow(0 0 8px rgba(239,68,68,0.9))",
        zIndex:141,
      }}>💀</div>

      {/* Raider units marching toward target */}
      {raiders.map((r, i) => (
        <div key={i} style={{
          position:"absolute",
          left: r.startX,
          top:  r.startY,
          fontSize: 20,
          lineHeight:1,
          "--startX":"0px", "--startY":"0px",
          "--endX":`${targetPxX - r.startX + (Math.random()-0.5)*30}px`,
          "--endY":`${targetPxY - r.startY + (Math.random()-0.5)*30}px`,
          animation:`raidMarch ${Math.max(timeLeft,3)}s linear ${r.delay}s forwards`,
          filter:"drop-shadow(0 0 6px rgba(239,68,68,0.8))",
          zIndex:142,
        }}>
          <div style={{
            animation:`raidBobWalk 0.4s ease-in-out ${r.delay*0.3}s infinite`,
          }}>{r.e}</div>
        </div>
      ))}

      {/* Alert banner top — count down */}
      <div style={{
        position:"absolute", top:68, left:"50%",
        transform:"translateX(-50%)",
        display:"flex", alignItems:"center", gap:8,
        background: urgency ? "#2a0505" : "#1a0505",
        border:`2px solid ${urgency?"#ff0000":"#ef444499"}`,
        borderRadius:20, padding:"5px 14px",
        boxShadow: urgency ? "0 0 24px rgba(255,0,0,0.8)" : "0 0 12px rgba(239,68,68,0.5)",
        animation: urgency ? "raidAlertBlink 0.5s infinite" : "raidAlertBlink 1.5s infinite",
        zIndex:143, whiteSpace:"nowrap",
      }}>
        <span style={{fontSize:16, animation:`skullFloat 0.8s ease-in-out infinite`}}>💀</span>
        <span className="orb" style={{
          fontSize:11, color: urgency?"#ff5555":"#ef4444",
          letterSpacing:2, fontWeight:900,
          textShadow:"0 0 8px #ef4444",
        }}>RAID — {timeLeft}s</span>
        <div style={{width:50, height:4, background:"#440000", borderRadius:2, overflow:"hidden"}}>
          <div style={{
            width:`${pct}%`, height:"100%",
            background: urgency?"#ff0000":"#ef4444",
            borderRadius:2, transition:"width 1s linear",
            boxShadow:"0 0 6px #ef4444",
          }}/>
        </div>
        <span style={{fontSize:16, animation:`skullFloat 0.8s ease-in-out 0.4s infinite`}}>💀</span>
      </div>

      {/* Screen edge red vignette — urgency */}
      <div style={{
        position:"absolute", inset:0,
        background:"radial-gradient(ellipse at 50% 50%, transparent 65%, rgba(239,68,68,0.18) 100%)",
        animation:"raidAlertBlink 1.5s ease-in-out infinite",
        pointerEvents:"none",
      }}/>
    </div>
  );
}

// ═══════════════════════════════════════ AD SHOP MODAL ══════════════════════
function AdShopModal({ onClose, onWatchAd, adsWatched, cooldown, C }) {
  const [watching, setWatching] = useState(false);
  const [adProgress, setAdProgress] = useState(0);
  const [adDone, setAdDone] = useState(false);

  useEffect(() => {
    if (!watching) return;
    setAdProgress(0); setAdDone(false);
    const start = Date.now();
    const iv = setInterval(() => {
      const pct = Math.min(100, ((Date.now()-start)/5000)*100);
      setAdProgress(pct);
      if (pct >= 100) { setAdDone(true); clearInterval(iv); }
    }, 60);
    return () => clearInterval(iv);
  }, [watching]);

  const handleClaim = () => {
    setWatching(false); setAdProgress(0); setAdDone(false);
    onWatchAd();
  };

  const pct = (adsWatched / 2) * 100;

  return (
    <>
      <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:300}}/>
      <div style={{
        position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",
        width:"100%",maxWidth:480,
        background:"linear-gradient(180deg,#0b1424,#050a18)",
        border:"2px solid #fbbf24",
        borderRadius:"20px 20px 0 0",
        padding:"20px 18px 36px",
        zIndex:301,
        boxShadow:"0 -10px 40px rgba(251,191,36,0.4)",
        animation:"proposalSlideUp 0.5s ease",
      }}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div>
            <div className="orb" style={{fontSize:15,color:"#fbbf24",letterSpacing:3,fontWeight:900}}>🛍️ BOUTIQUE</div>
            <div style={{fontSize:11,color:"#64748b",marginTop:2}}>Regardez des pubs pour gagner des récompenses</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#64748b",fontSize:22,cursor:"pointer"}}>✕</button>
        </div>

        {/* Offer 1: 2 pubs = 1 coffre (every 15 min) */}
        <div style={{
          background:"linear-gradient(135deg,#1a1500,#2a1a00)",
          border:`2px solid ${cooldown>0?"#334155":"#fbbf24"}`,
          borderRadius:14,padding:16,marginBottom:12,
          boxShadow:cooldown===0?"0 0 20px rgba(251,191,36,0.3)":"none",
        }}>
          <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:12}}>
            <span style={{fontSize:42,filter:"drop-shadow(0 0 10px #fbbf24)"}}>🎁</span>
            <div style={{flex:1}}>
              <div className="orb" style={{fontSize:13,color:"#fbbf24",fontWeight:900,letterSpacing:1}}>
                2 PUBS → 1 COFFRE MAGIQUE
              </div>
              <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>Disponible toutes les 15 minutes</div>
            </div>
          </div>

          {cooldown > 0 ? (
            <div style={{textAlign:"center",padding:"10px",background:"#0d1828",borderRadius:10}}>
              <div className="orb" style={{fontSize:13,color:"#475569"}}>
                ⏳ Disponible dans {Math.ceil(cooldown/60)}m {cooldown%60}s
              </div>
            </div>
          ) : watching ? (
            /* Ad screen */
            <div style={{background:"#040810",borderRadius:10,padding:14}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                <span className="orb" style={{fontSize:10,color:"#94a3b8",letterSpacing:2}}>📺 PUB EN COURS</span>
                <span className="orb" style={{fontSize:11,color:adDone?"#4ade80":"#94a3b8"}}>
                  {adDone?"✓ TERMINÉ":`${Math.ceil((100-adProgress)/20)}s`}
                </span>
              </div>
              <div style={{height:6,background:"#1e3a5f",borderRadius:3,overflow:"hidden",marginBottom:12}}>
                <div style={{width:`${adProgress}%`,height:"100%",background:"linear-gradient(90deg,#fbbf24,#4ade80)",transition:"width .1s"}}/>
              </div>
              {adDone ? (
                <button onClick={handleClaim} className="rip" style={{
                  width:"100%",padding:"11px",
                  background:"linear-gradient(135deg,#4ade8033,#4ade8066)",
                  border:"1.5px solid #4ade80",borderRadius:10,
                  color:"#fff",fontSize:13,cursor:"pointer",
                  fontFamily:"'Rajdhani',sans-serif",fontWeight:700,letterSpacing:2,
                }}>✨ RÉCLAMER ({adsWatched+1}/2)</button>
              ) : (
                <div style={{textAlign:"center",fontSize:11,color:"#64748b"}}>
                  Patientez jusqu'à la fin pour réclamer...
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Progress indicator */}
              <div style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#64748b",marginBottom:4}}>
                  <span>Pubs regardées</span>
                  <span className="orb" style={{color:"#fbbf24"}}>{adsWatched}/2</span>
                </div>
                <div style={{height:8,background:"#1e3a5f",borderRadius:4,overflow:"hidden"}}>
                  <div style={{width:`${pct}%`,height:"100%",background:"linear-gradient(90deg,#fbbf24,#ff8c42)",borderRadius:4,transition:"width .3s"}}/>
                </div>
              </div>
              <button onClick={()=>setWatching(true)} className="rip" style={{
                width:"100%",padding:"12px",
                background:"linear-gradient(135deg,#fbbf2433,#fbbf2488)",
                border:"1.5px solid #fbbf24",borderRadius:10,
                color:"#fff",fontSize:13,cursor:"pointer",
                fontFamily:"'Rajdhani',sans-serif",fontWeight:700,letterSpacing:2,
                boxShadow:"0 0 18px rgba(251,191,36,0.4)",
                display:"flex",alignItems:"center",justifyContent:"center",gap:8,
              }}>
                <span>📺</span><span>REGARDER PUB {adsWatched+1}/2</span>
              </button>
            </>
          )}
        </div>

        <div style={{fontSize:10,color:"#334155",textAlign:"center",lineHeight:1.5}}>
          Les pubs financent le développement du jeu. Merci de votre soutien ! 🙏
        </div>
      </div>
    </>
  );
}
