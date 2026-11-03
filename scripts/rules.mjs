/** Pure functions — independent of Foundry for validation and future testing. */
export const MODULE_ID = "gemini-vehicles";

export const SIZE_OPTIONS = [
  ["pequeno", "Pequeno"], ["medio", "Médio"], ["grande", "Grande"],
  ["imenso", "Imenso"], ["enorme", "Enorme"], ["colossal", "Colossal"]
];
export const SPEED_OPTIONS = [
  ["parado", "Parado"], ["lento", "Lento"], ["moderado", "Moderado"],
  ["rapido", "Rápido"], ["muito-rapido", "Muito rápido"],
  ["veloz", "Veloz"], ["extremo", "Extremo"]
];
export const GRADES = [
  ["muito-facil", "Muito fácil"], ["facil", "Fácil"], ["padrao", "Padrão"],
  ["dificil", "Difícil"], ["formidavel", "Formidável"], ["herculeo", "Hercúleo"]
];
const GRADE_MULTIPLIER = {
  "muito-facil": 2, facil: 1.5, padrao: 1,
  dificil: 2 / 3, formidavel: 0.5, herculeo: 0.1
};
export const DEFAULT_SYSTEMS = [
  {id: "motor", name: "Motorização", hits: 0, max: 2, detail: "Motor, propulsão e alimentação"},
  {id: "controles", name: "Controles", hits: 0, max: 2, detail: "Direção, lemes e painel"},
  {id: "rodagem", name: "Rodagem / tração", hits: 0, max: 2, detail: "Rodas, suspensão ou trem de pouso"},
  {id: "sensores", name: "Sensores e comunicações", hits: 0, max: 2, detail: "Radar, rádio, eletrônica"},
  {id: "ocupantes", name: "Compartimento de ocupantes", hits: 0, max: 2, detail: "Cabine e alojamento"},
  {id: "carga", name: "Compartimento de carga", hits: 0, max: 2, detail: "Bagageiro, equipamento e suprimentos"}
];
export const DEFAULT_VEHICLE = {
  schemaVersion: 1, isVehicle: true, driverUuid: "",
  category: "terrestre", size: "medio", handling: "padrao", speed: "moderado",
  casco: 4, structure: { value: 24, max: 24 }, shields: {value: 0, max: 0},
  passengers: 4, movementPoints: 0, powerplant: "", features: "", notes: "",
  systems: DEFAULT_SYSTEMS
};
export const SKILL_DEFINITIONS = [
  {id:"drive",label:"Condução",aliases:["conducao", "drive", "mythras.drive"]},
  {id:"pilot",label:"Pilotar",aliases:["pilotar", "pilotagem", "pilot", "mythras.pilot"]},
  {id:"boating",label:"Canoagem",aliases:["canoagem", "boating", "mythras.boating"]},
  {id:"endurance",label:"Tolerância",aliases:["tolerancia", "tolerãncia", "endurance", "mythras.endurance"]},
  {id:"navigation",label:"Navegação",aliases:["navegacao", "navigation", "mythras.navigation"]}
];
export const normalize = s => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export const number = (value, fallback=0) => { const n = Number(value); return Number.isFinite(n) ? n : fallback; };
export const bounded = (n, min, max) => Math.min(max, Math.max(min, n));
export const deepClone = v => JSON.parse(JSON.stringify(v));
export function coerceVehicle(original = {}) {
  const v = {...deepClone(DEFAULT_VEHICLE), ...deepClone(original || {})};
  v.structure = {...DEFAULT_VEHICLE.structure, ...(v.structure || {})};
  v.shields = {...DEFAULT_VEHICLE.shields, ...(v.shields || {})};
  v.systems = Array.isArray(v.systems) ? v.systems : deepClone(DEFAULT_SYSTEMS);
  return v;
}
export function findSkill(items, definition, translate=(value)=>value) {
  const aliases = definition.aliases.map(normalize);
  const matches = Array.from(items || []).filter(item =>
    ["standardSkill", "professionalSkill", "combatStyle"].includes(item.type) &&
    [item.name, translate(item.name)].some(name=>aliases.includes(normalize(name)))
  );
  matches.sort((a,b) => skillTotal(b)-skillTotal(a));
  return matches[0] ?? null;
}
export function skillTotal(item) {
  if (!item) return null;
  const data = item.system ?? {};
  // Gemini's SkillMythras exposes a computed item.totalVal getter. It is not saved in system.totalVal.
  if (Number.isFinite(item.totalVal)) return number(item.totalVal);
  if (Number.isFinite(Number(data.totalVal)) && data.totalVal !== "" && data.totalVal != null) return number(data.totalVal);
  const base = typeof data.baseVal === "object" ? number(data.baseVal?.value) : number(data.baseVal);
  return base + number(data.trainingVal) + number(data.miscBonus);
}
export function modifiedSkill(base, grade="padrao") {
  return Math.max(0, Math.round(number(base)* (GRADE_MULTIPLIER[grade] ?? 1)));
}
/** Exact success/fumble thresholds used by the supplied Gemini Mythras v1.4 roller. */
export function resultLevel(dice,target) {
  const d=number(dice),t=Math.max(0,number(target));
  if(d>95) {
    if(d===100 || (d===99 && t<=100)) return {label:"Falha crítica",level:0,kind:"fumble",description:"MYTHRAS.FUMBLE!",descriptionClass:"text-darkred"};
    return {label:"Falha",level:1,kind:"failure",description:"MYTHRAS.FAILURE!",descriptionClass:"text-red"};
  }
  if((d<=5 && (d===1 || d<=Math.ceil(t/10))) || d<=Math.ceil(t/10))
    return {label:"Sucesso crítico",level:3,kind:"critical",description:"MYTHRAS.CRITICAL!",descriptionClass:"text-goldenrod"};
  if(d<=5 || d<=t)
    return {label:"Sucesso",level:2,kind:"success",description:"MYTHRAS.SUCCESS!",descriptionClass:"text-green"};
  return {label:"Falha",level:1,kind:"failure",description:"MYTHRAS.FAILURE!",descriptionClass:"text-red"};
}
/** Same six-grade table as the native character sheet, not an independent difficulty subsystem. */
export function rollResultRows(die,base) {
  return [2,1.5,1,2/3,0.5,0.1].map(multiplier=>{
    const target=Math.ceil(Math.max(0,number(base))*multiplier);
    return {...resultLevel(die,target),target};
  });
}
/** Damage order: Shields -> Hull -> Structure; chance for a system hit = penetration percent. */
export function resolveDamage(vehicle, rawDamage) {
  const v=coerceVehicle(vehicle); const total=Math.max(0,Math.trunc(number(rawDamage)));
  const shieldNow=bounded(number(v.shields.value),0,Math.max(0,number(v.shields.max)));
  const absorbedShields=Math.min(shieldNow,total);
  const afterShields=total-absorbedShields;
  const absorbedHull=Math.min(Math.max(0,Math.trunc(number(v.casco))),afterShields);
  const penetration=afterShields-absorbedHull;
  const oldStructure=bounded(number(v.structure.value),0,Math.max(0,number(v.structure.max)));
  return {
    total, absorbedShields, absorbedHull, penetration,
    structureDamage:Math.min(oldStructure,penetration),
    nextShields:shieldNow-absorbedShields,
    nextStructure:Math.max(0,oldStructure-penetration),
    systemChance:bounded(penetration,0,100), destroyed:oldStructure>0 && penetration>=oldStructure
  };
}
export function improveSpeed(speed,steps) {
  const i=SPEED_OPTIONS.findIndex(x=>x[0]===speed);
  return SPEED_OPTIONS[bounded((i < 0 ? 0 : i)+steps,0,SPEED_OPTIONS.length-1)][1];
}
