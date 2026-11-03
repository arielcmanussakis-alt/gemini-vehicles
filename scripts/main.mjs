import {
  MODULE_ID, SIZE_OPTIONS, SPEED_OPTIONS, GRADES, DEFAULT_SYSTEMS, DEFAULT_VEHICLE,
  SKILL_DEFINITIONS, coerceVehicle, findSkill, skillTotal, modifiedSkill,
  resultLevel, rollResultRows, resolveDamage, improveSpeed, number, bounded, deepClone
} from "./rules.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const OPEN_SHEETS = new Set();
const FORM_FIELDS = ["category", "size", "handling", "speed", "casco", "passengers", "movementPoints", "powerplant", "features", "notes"];
const FORM_NUMBERS = new Set(["casco", "passengers", "movementPoints"]);
const ALLOWED_CATEGORIES = ["terrestre", "aereo", "aquatico", "espacial", "outro"];
const VEHICLE_SHEET_ID = `${MODULE_ID}.GeminiVehicleSheet`;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g,c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}
function getVehicle(actor) { return coerceVehicle(actor.getFlag(MODULE_ID, "vehicle")); }
async function setVehicle(actor, vehicle) {
  if (!actor.isOwner) { ui.notifications.warn("Você não tem permissão para editar este veículo."); return; }
  await actor.setFlag(MODULE_ID, "vehicle", coerceVehicle(vehicle));
}
async function getDriver(vehicle) {
  if (!vehicle.driverUuid) return null;
  try {
    const actor = await fromUuid(vehicle.driverUuid);
    if (actor?.documentName !== "Actor" || actor.getFlag?.(MODULE_ID, "vehicle")?.isVehicle) return null;
    if (!actor.testUserPermission(game.user,"OBSERVER")) return null;
    return actor;
  } catch (err) {
    console.warn(`${MODULE_ID} | Não foi possível resolver condutor`,err);
    return null;
  }
}
function skillContext(actor) {
  return SKILL_DEFINITIONS.map(def => {
    const skill = actor ? findSkill(actor.items, def, value=>game.i18n.localize(value)) : null;
    return {
      ...def,
      available: !!skill, skillId:skill?.id || "", total:skillTotal(skill),
      title: skill ? game.i18n.localize(skill.name) : "Perícia não encontrada"
    };
  });
}
const DIFFICULTY_KEYS = ["MYTHRAS.very_easy_dif", "MYTHRAS.easy_dif", "MYTHRAS.standard_dif", "MYTHRAS.hard_dif", "MYTHRAS.formidable_dif", "MYTHRAS.herculean_dif"];
function driverTheme(driver) {
  const value=driver?.system?.gemini?.theme;
  // The native actor sheet uses system.gemini.theme and theme-${code}.
  return typeof value === "string" && /^[a-z0-9_-]{1,80}$/i.test(value) ? value : "default";
}
async function getNativeThemeMedia(driver, code) {
  if(!driver) return {};
  let record=globalThis.GEMINI?.themes?.cache?.[code];
  // This system exposes theme loading through its own ActorSheet.getData(),
  // which initializes the theme CSS/media, including premium themes.
  if(!record && typeof driver.sheet?.getData === "function") {
    try { await driver.sheet.getData(); record=globalThis.GEMINI?.themes?.cache?.[code]; }
    catch(error){console.warn(`${MODULE_ID} | Tema do condutor indisponível`, error);}
  }
  return record?.media ?? {};
}
async function rollD100(actor,title,skill,grade="padrao",extra="") {
  const goal=modifiedSkill(skill,grade);
  const roll=await new Roll("1d100", actor.system).evaluate();
  const resolution=resultLevel(roll.total,goal);
  // Same six difficulty lines / classes / official chat template as the native Mythras roller.
  const rollResults=rollResultRows(roll.total,skill).map((row,i)=>({
    difficultyName:DIFFICULTY_KEYS[i], difficultyGrade:row.target,
    rollValue:roll.total, description:row.description, descriptionClass:row.descriptionClass
  }));
  const modifiers=[{name:"Dificuldade usada",value:GRADES.find(([id])=>id===grade)?.[1]||grade}];
  if(extra) modifiers.push({name:"Operação",value:extra});
  const content=await renderTemplate("systems/mythras/templates/chat/skill-roll.hbs",{
    game, rollResults, modifiers, themeClass:`theme-${driverTheme(actor)}`
  });
  await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:`${title} · ${resolution.label} (${goal}%)`,content});
  return {roll,goal,resolution};
}
function systemsState(system) {
  const hits=bounded(number(system.hits),0,Math.max(1,number(system.max,1)));
  const max=Math.max(1,Math.trunc(number(system.max,1)));
  return {...system, hits, max,
    severity: hits >= max ? "Inoperante" : hits >= Math.ceil(max/2) ? "Avariado" : "Operacional",
    percent: Math.round(100*hits/max), inactive: hits>=max,
    damaged:hits>0,
    icon:({motor:"fa-gears",controles:"fa-sliders",rodagem:"fa-car",sensores:"fa-satellite-dish",ocupantes:"fa-users",carga:"fa-box-open"})[system.id] ||
      (/motor|propuls|combust/i.test(system.name)?"fa-gears":/roda|pneu|traç|suspens/i.test(system.name)?"fa-car":/controle|direç/i.test(system.name)?"fa-sliders":/sensor|rádio|comunic|radar/i.test(system.name)?"fa-satellite-dish":/cabine|passageir|ocupante/i.test(system.name)?"fa-users":"fa-triangle-exclamation")};
}

class GeminiVehicleSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["gemini-vehicle-sheet"],
    tag: "form", position:{width:1260,height:870},
    window:{resizable:true, title:"Gemini · Veículo",icon:"fa-solid fa-car-side"},
    form:{submitOnChange:true,closeOnSubmit:false,handler:GeminiVehicleSheet.saveForm},
    // Interactions are delegated explicitly in _onRender, instead of relying on
    // a fragile mix of Foundry V12/V14 data-action behaviors.
  };
  static PARTS = {main:{template:`modules/${MODULE_ID}/templates/vehicle-sheet.hbs`}};
  _activeTab="operations";
  _rollGrade=null;

  async _prepareContext(options) {
    const context=await super._prepareContext(options);
    const vehicle=getVehicle(this.actor);
    const driver=await getDriver(vehicle);
    const skills=skillContext(driver);
    const structurePercent=vehicle.structure.max>0 ? bounded(100*vehicle.structure.value/vehicle.structure.max,0,100):0;
    const shieldsPercent=vehicle.shields.max>0 ? bounded(100*vehicle.shields.value/vehicle.shields.max,0,100):0;
    const sys=vehicle.systems.map(systemsState);
    const themeCode=driverTheme(driver);
    const themeMedia=await getNativeThemeMedia(driver,themeCode);
    return {...context,
      vehicle, driver:driver && {uuid:driver.uuid,name:driver.name,img:driver.img,id:driver.id},
      missingDriver: !!vehicle.driverUuid && !driver, skills, viewTab:this._activeTab,
      structurePercent, shieldsPercent, systems:sys, damagedSystems:sys.filter(s=>s.damaged),themeCode,themeMedia,
      handlingLabel:GRADES.find(x=>x[0]===vehicle.handling)?.[1]||vehicle.handling,
      gradeOptions:GRADES.map(([value,label])=>({value,label,selected:(this._rollGrade||vehicle.handling)===value})),
      activeSystems:sys.filter(s=>!s.inactive).length,
      canEdit:this.actor.isOwner, canConfigure:game.user.isGM,
      sizeOptions:SIZE_OPTIONS.map(([value,label])=>({value,label,selected:vehicle.size===value})),
      speedOptions:SPEED_OPTIONS.map(([value,label])=>({value,label,selected:vehicle.speed===value})),
      handlingOptions:GRADES.map(([value,label])=>({value,label,selected:vehicle.handling===value})),
      categories:ALLOWED_CATEGORIES.map(value=>({value,label:({terrestre:"Terrestre",aereo:"Aéreo",aquatico:"Aquático",espacial:"Espacial",outro:"Outro"}[value]), selected:vehicle.category===value})),
      vehicleImg:this.actor.img || "icons/svg/wing.svg"
    };
  }

  async _onRender(context, options) {
    await super._onRender(context,options);
    OPEN_SHEETS.add(this);
    const themeCode=context.themeCode || "default";
    for(const cls of Array.from(this.element.classList)) if(cls.startsWith("theme-")) this.element.classList.remove(cls);
    this.element.classList.add(`theme-${themeCode}`);
    const root=this.element.querySelector(".gv-shell");
    if (!root) return;
    const showTab = () => {
      root.querySelectorAll("[data-gv-page]").forEach(node => {
        node.hidden = node.dataset.gvPage !== this._activeTab;
      });
      root.querySelectorAll("[data-gv-nav]").forEach(node => {
        const active=node.dataset.gvNav===this._activeTab;
        node.classList.toggle("active",active);
        node.setAttribute("aria-pressed",String(active));
      });
    };
    showTab();
    root.querySelector("[name='roll.grade']")?.addEventListener("change",event=>{
      this._rollGrade=event.currentTarget.value;
      event.stopPropagation(); // transient roll preference, not vehicle data
    },true);
    // Foundry ActorSheetV2 compatibility: do not use framework data-action.
    // This direct listener dispatches even if the host sheet handles actions differently.
    const commands={
      editImage:"editImage",rollSkill:"rollSkill",rollPushSpeed:"rollPushSpeed",
      rollLossControl:"rollLossControl",applyDamage:"applyDamage",
      recoverStructure:"recoverStructure",setSystemHit:"setSystemHit",
      editSystem:"editSystem",addSystem:"addSystem",removeSystem:"removeSystem",
      clearDriver:"clearDriver",openDriver:"openDriver",addMovement:"addMovement",
      tab:"changeViewTab"
    };
    root.addEventListener("click",event=>{
      const control=event.target.closest("[data-gv-action]");
      if(!control || !root.contains(control) || control.disabled) return;
      event.preventDefault();
      const method=commands[control.dataset.gvAction];
      if(!method) return;
      Promise.resolve(GeminiVehicleSheet[method].call(this,event,control))
        .catch(error=>{
          console.error(`${MODULE_ID} | Ação ${method} falhou`,error);
          ui.notifications.error(`Erro na ficha de Veículos: ${error.message}`);
        });
    });
    // Drop a character Actor precisely into the driver quadrant.
    // Use native drag/drop; older _onDropActor is kept as fallback.
    const driverZone=root.querySelector(".gv-driver-drop");
    if(driverZone){
      driverZone.addEventListener("dragover",event=>{
        event.preventDefault();event.stopPropagation();
        if(event.dataTransfer) event.dataTransfer.dropEffect="copy";
        driverZone.classList.add("gv-dragover");
      },true);
      driverZone.addEventListener("dragleave",event=>{
        if(!driverZone.contains(event.relatedTarget)) driverZone.classList.remove("gv-dragover");
      },true);
      driverZone.addEventListener("drop",async event=>{
        event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
        driverZone.classList.remove("gv-dragover");
        try {
          const raw=event.dataTransfer?.getData("text/plain");
          let data={};
          if(raw){try{data=JSON.parse(raw);}catch{}}
          if(data.type!=="Actor") {
            const parser=globalThis.TextEditor?.getDragEventData;
            if(parser) data=parser.call(globalThis.TextEditor,event);
          }
          if(data?.type!=="Actor") {ui.notifications.warn("Arraste uma ficha de personagem.");return;}
          const actor=data.uuid ? await fromUuid(data.uuid) : game.actors.get(data.id);
          await this._onDropActor(event,actor);
        } catch(error){console.error(`${MODULE_ID} | Vínculo do condutor falhou`,error);ui.notifications.error(`Não foi possível vincular o condutor: ${error.message}`);}
      },true);
    }
  }
  async _onClose(options) {
    OPEN_SHEETS.delete(this);
    return super._onClose(options);
  }
  async _onDropActor(event, actor) {
    if (!this.actor.isOwner) return null;
    if (!actor || actor.documentName!=="Actor" || actor.type!=="character" || actor.uuid===this.actor.uuid || actor.getFlag(MODULE_ID,"vehicle")?.isVehicle) {
      ui.notifications.warn("Arraste uma ficha de personagem, não outro veículo.");
      return null;
    }
    if (!actor.testUserPermission(game.user,"OBSERVER")) {
      ui.notifications.warn("Você não tem permissão para consultar essa ficha de personagem.");
      return null;
    }
    const v=getVehicle(this.actor); v.driverUuid=actor.uuid;
    await setVehicle(this.actor,v);
    ui.notifications.info(`${actor.name} vinculado como condutor de ${this.actor.name}.`);
    return actor;
  }

  static async saveForm(event,form,formData) {
    if (!this.actor.isOwner) return;
    const data=foundry.utils.expandObject(formData.object);
    const fields=data.gv || {};
    const v=getVehicle(this.actor);
    for(const key of FORM_FIELDS) {
      if (fields[key]===undefined) continue;
      if(["category","size","handling","speed","passengers"].includes(key) && !game.user.isGM) continue;
      v[key]=FORM_NUMBERS.has(key) ? Math.max(0,number(fields[key])) : String(fields[key]);
    }
    if (!ALLOWED_CATEGORIES.includes(v.category)) v.category="outro";
    for(const section of ["structure","shields"]) {
      if (fields[section]) {
        v[section].max=Math.max(0,Math.trunc(number(fields[section].max,v[section].max)));
        v[section].value=bounded(Math.trunc(number(fields[section].value,v[section].value)),0,v[section].max);
      }
    }
    const name=String(data.name??this.actor.name).trim()||this.actor.name;
    await this.actor.update({name, [`flags.${MODULE_ID}.vehicle`]:v});
  }

  static async editImage() {
    if (!this.actor.isOwner) return;
    // FilePicker follows the standard Actor portrait workflow in Foundry.
    const Picker = foundry.applications?.apps?.FilePicker?.implementation || globalThis.FilePicker;
    if (!Picker) {ui.notifications.warn("Seletor de arquivos indisponível.");return;}
    const picker=new Picker({type:"image",current:this.actor.img||"",callback:async path=> {
      if (!path) return;
      await this.actor.update({img:path,"prototypeToken.texture.src":path});
    }});
    await picker.browse();
  }
  static changeViewTab(event,target) {
    const next=target.dataset.page;
    if(!["operations","systems","notes"].includes(next)) return;
    this._activeTab=next;
    this.element.querySelectorAll("[data-gv-page]").forEach(node=>node.hidden=node.dataset.gvPage!==this._activeTab);
    this.element.querySelectorAll("[data-gv-nav]").forEach(node=>{
      const active=node.dataset.gvNav===this._activeTab;
      node.classList.toggle("active",active);node.setAttribute("aria-pressed",String(active));
    });
  }
  static async rollSkill(event,target) {
    const vehicle=getVehicle(this.actor);
    const driver=await getDriver(vehicle);
    if(!driver) {ui.notifications.warn("Primeiro vincule um condutor válido."); return;}
    const definition=SKILL_DEFINITIONS.find(x=>x.id===target.dataset.skill);
    if(!definition) return;
    const item=findSkill(driver.items,definition,value=>game.i18n.localize(value));
    if(!item) {ui.notifications.warn(`${definition.label} não encontrada na ficha de ${driver.name}.`);return;}
    // The original Gemini sheet supplies a Roller instance. Delegate to it so
    // Tolerância (and all other driver skills) get its exact grade table,
    // situational penalties, fumble/critical logic and theme-aware colored chat.
    const native=driver.sheet?.roller;
    if(native && typeof native.rollSkill==="function") {
      await native.rollSkill(item);
      return;
    }
    // Fallback only for custom/alternate character sheets without native Roller.
    // No duplicate character stat: always read the live Skill item.
    await rollD100(driver,`${definition.label} · ${this.actor.name}`,skillTotal(item),
      this._rollGrade || (target.dataset.skill==="endurance"?"padrao":vehicle.handling),
      `Condutor: ${driver.name}`);
  }
  static async rollPushSpeed(event,target) {
    const vehicle=getVehicle(this.actor);const driver=await getDriver(vehicle);
    if(!driver) {ui.notifications.warn("Vincule um condutor.");return;}
    const which=vehicle.category==="aereo"||vehicle.category==="espacial" ? "pilot" : vehicle.category==="aquatico"?"boating":"drive";
    const def=SKILL_DEFINITIONS.find(x=>x.id===which);
    const item=findSkill(driver.items,def,value=>game.i18n.localize(value));
    if(!item){ui.notifications.warn(`Perícia ${def.label} não encontrada.`);return;}
    const steps=bounded(number(target.dataset.steps,1),1,2);
    const grade=steps===2?"herculeo":vehicle.handling;
    const {resolution}=await rollD100(driver,
      `Forçar velocidade +${steps} · ${this.actor.name}`,
      skillTotal(item),grade,`Velocidade potencial: ${improveSpeed(vehicle.speed,steps)}. Duração: ${steps===2?"1d3":"1d6"} minutos${steps===1?" (1d12 se crítico)":""}.`);
    if (resolution.level>=2) {
      const duration=await new Roll(steps===2?"1d3":resolution.kind==="critical"?"1d12":"1d6").evaluate();
      await duration.toMessage({speaker:ChatMessage.getSpeaker({actor:driver}),flavor:`${this.actor.name}: velocidade ${improveSpeed(vehicle.speed,steps)} por ${duration.total} minuto(s).`});
    } else ui.notifications.warn("A tentativa de forçar a velocidade falhou; o Mestre avalia a perda de controle.");
  }
  static async rollLossControl() {
    const roll=await new Roll("1d100").evaluate();
    await roll.toMessage({speaker:ChatMessage.getSpeaker({actor:this.actor}),flavor:`${this.actor.name} · Perda de Controle (1d100). Consulte a tabela aplicável do Mythras.`});
  }
  static async applyDamage() {
    if(!this.actor.isOwner) return;
    // Read transient input before submission; submitOnChange may re-render the sheet.
    const total=Math.max(0,Math.trunc(number(this.element.querySelector("[data-gv-damage]")?.value,0)));
    await this.submit();
    if(total<=0){ui.notifications.warn("Informe um dano maior que zero.");return;}
    const v=getVehicle(this.actor);const calc=resolveDamage(v,total);
    v.shields.value=calc.nextShields;v.structure.value=calc.nextStructure;
    let systemHit=null;let systemRoll=null;let systemIndexRoll=null;
    if(calc.penetration>0 && v.systems.length) {
      systemRoll=await new Roll("1d100").evaluate();
      if(systemRoll.total<=calc.systemChance) {
        systemIndexRoll=await new Roll(`1d${v.systems.length}`).evaluate();
        const index=systemIndexRoll.total-1;
        const system=v.systems[index];
        system.hits=bounded(number(system.hits)+1,0,Math.max(1,number(system.max,1)));
        systemHit=system.name;
      }
    }
    await setVehicle(this.actor,v);
    const detail=`Dano bruto: ${total} · Escudo: −${calc.absorbedShields} · Casco: −${calc.absorbedHull} · Estrutura: −${calc.penetration} · Chance de avaria: ${calc.systemChance}%${systemRoll?` · d100: ${systemRoll.total}`:""}${systemHit?` · Sistema atingido: ${systemHit}`:""}${calc.nextStructure<=0?" · PERDA TOTAL":""}`;
    await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:this.actor}),
      content:`<div class="gv-chat"><strong>${escapeHTML(this.actor.name)} · Dano veicular</strong><p>${escapeHTML(detail)}</p></div>`,
      flavor:`Impacto em ${escapeHTML(this.actor.name)} · ${total} de dano`,
      rolls:[systemRoll,systemIndexRoll].filter(Boolean)});
  }
  static async recoverStructure(event,target) {
    if(!this.actor.isOwner) return;
    const amount=Math.max(0,Math.trunc(number(this.element.querySelector("[data-gv-repair]")?.value,0)));
    await this.submit();const v=getVehicle(this.actor);
    if(!amount) return;
    v.structure.value=bounded(number(v.structure.value)+amount,0,number(v.structure.max));
    await setVehicle(this.actor,v);
    ui.notifications.info(`Estrutura restaurada (${amount}). Exige reparo narrativamente justificado.`);
  }
  static async setSystemHit(event,target) {
    if(!this.actor.isOwner) return;
    const v=getVehicle(this.actor);
    const index=v.systems.findIndex(s=>s.id===target.dataset.system);
    if(index===-1)return;
    const sys=v.systems[index];
    sys.hits=bounded(number(sys.hits)+number(target.dataset.delta),0,Math.max(1,number(sys.max,1)));
    await setVehicle(this.actor,v);
  }
  static async editSystem(event,target) {
    if(!this.actor.isOwner)return;
    const v=getVehicle(this.actor);
    const index=v.systems.findIndex(s=>s.id===target.dataset.system);
    if(index===-1)return;
    const sys=v.systems[index];
    const title=await foundry.applications.api.DialogV2.prompt({
      window:{title:"Editar Sistema do veículo"},
      content:`<label>Nome <input name="system-name" value="${escapeHTML(sys.name)}" required></label><label>Impactos para falha <input name="system-max" type="number" min="1" max="99" value="${number(sys.max,2)}"></label><label>Descrição <input name="system-detail" value="${escapeHTML(sys.detail)}"></label>`,
      ok:{label:"Salvar",callback:(event,button)=>({name:button.form.elements.namedItem("system-name")?.value,max:button.form.elements.namedItem("system-max")?.value,detail:button.form.elements.namedItem("system-detail")?.value})}
    });
    if(!title) return;
    sys.name=String(title.name??sys.name).slice(0,80);
    sys.max=bounded(Math.trunc(number(title.max,2)),1,99);
    sys.hits=bounded(number(sys.hits),0,sys.max);
    sys.detail=String(title.detail??"").slice(0,250);
    await setVehicle(this.actor,v);
  }
  static async addSystem() {
    if(!this.actor.isOwner)return;
    const v=getVehicle(this.actor);
    if(v.systems.length>=20){ui.notifications.warn("Limite de 20 Sistemas por veículo.");return;}
    v.systems.push({id:foundry.utils.randomID(),name:"Novo sistema",hits:0,max:2,detail:""});
    await setVehicle(this.actor,v);
  }
  static async removeSystem(event,target) {
    if(!this.actor.isOwner)return;
    const v=getVehicle(this.actor);
    v.systems=v.systems.filter(s=>s.id!==target.dataset.system);
    await setVehicle(this.actor,v);
  }
  static async clearDriver(){if(!this.actor.isOwner)return;const v=getVehicle(this.actor);v.driverUuid="";await setVehicle(this.actor,v);}
  static async openDriver(){const v=getVehicle(this.actor);const d=await getDriver(v);if(d)d.sheet.render({force:true});}
  static async addMovement(event,target) {
    if(!this.actor.isOwner)return;
    const v=getVehicle(this.actor);
    v.movementPoints=Math.max(0,number(v.movementPoints)+number(target.dataset.delta));
    await setVehicle(this.actor,v);
  }
}

async function createVehicle(name="Novo Veículo") {
  if(game.system.id!=="mythras") throw new Error("Gemini Vehicles só funciona com o sistema mythras.");
  if(!game.user.can("ACTOR_CREATE")) {ui.notifications.warn("Você não possui permissão para criar atores.");return null;}
  const actor=await Actor.create({
    name, type:"character", img:`modules/${MODULE_ID}/assets/vehicle-placeholder.svg`,
    flags:{
      [MODULE_ID]:{vehicle:deepClone(DEFAULT_VEHICLE)},
      core:{sheetClass:VEHICLE_SHEET_ID}
    },
    prototypeToken:{name,actorLink:true,displayName:30,displayBars:0}
  });
  if(actor) {
    // Assign a specialized sheet without changing character sheets globally.
    await actor.setFlag("core","sheetClass",VEHICLE_SHEET_ID);
    const selected=actor.sheet;
    if(selected instanceof GeminiVehicleSheet) selected.render({force:true});
    else new GeminiVehicleSheet({document:actor}).render({force:true});
  }
  return actor;
}
function injectCreateButton(app, html) {
  if(game.system.id!=="mythras" || !game.user.can("ACTOR_CREATE"))return;
  const root=html instanceof HTMLElement ? html : (html?.[0] || app?.element);
  if(!root?.querySelector)return;
  if(root.querySelector(".gv-create-vehicle"))return;
  const container=root.querySelector(".directory-header .header-actions") || root.querySelector(".directory-header") || root.querySelector("header.directory-header");
  if(!container)return;
  const button=document.createElement("button");
  button.type="button";button.className="gv-create-vehicle";
  button.innerHTML="<i class='fa-solid fa-car-side'></i> Criar Veículo";
  button.addEventListener("click",()=>createVehicle().catch(err=>{console.error(err);ui.notifications.error(err.message);}));
  container.append(button);
}
Hooks.once("init",()=>{
  if(game.system.id!=="mythras")return;
  foundry.applications.apps.DocumentSheetConfig.registerSheet(foundry.documents.Actor,MODULE_ID,GeminiVehicleSheet,{
    types:["character","summon"],makeDefault:false,label:"Gemini · Veículo"
  });
});
Hooks.once("ready",()=>{
  if(game.system.id!=="mythras")return;
  game.geminiVehicles=Object.freeze({createVehicle,openVehicle:async uuid=>{
    const a=await fromUuid(uuid);
    if(a?.getFlag?.(MODULE_ID,"vehicle")?.isVehicle) a.sheet.render({force:true});
  }});
  console.info("Gemini Vehicles | Módulo carregado. Use game.geminiVehicles.createVehicle() ou o botão do diretório.");
});
Hooks.on("renderActorDirectory",injectCreateButton);
Hooks.on("renderActorDirectoryV2",injectCreateButton);
Hooks.on("updateActor",async (actor,changes)=>{
  if(changes?.img && actor.getFlag?.(MODULE_ID,"vehicle")?.isVehicle) {
    // Keep future placed tokens aligned with the vehicle image.
    await actor.update({"prototypeToken.texture.src":changes.img});
  }
  for(const sheet of OPEN_SHEETS) {
    if(sheet.actor.uuid===actor.uuid) continue;
    if(getVehicle(sheet.actor).driverUuid===actor.uuid) sheet.render({force:true});
  }
});
Hooks.on("updateItem",(item)=>{
  const owner=item.parent;
  if(owner?.documentName!=="Actor")return;
  for(const sheet of OPEN_SHEETS)
    if(getVehicle(sheet.actor).driverUuid===owner.uuid) sheet.render({force:true});
});
