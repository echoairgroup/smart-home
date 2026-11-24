const config = window.SMART_HOME_CONFIG || {};
const hasBackend = Boolean(config.supabaseUrl && config.supabaseAnonKey);
let supabase = null;
let backendImportError = "";
if (hasBackend) {
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.119.2");
    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, { auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true} });
  } catch (error) {
    backendImportError = error?.message || "Supabase client kon niet worden geladen.";
    console.error("Haven backend import:", error);
  }
}
const state = {user:null,household:null,role:null,rooms:[],devices:[],automations:[],events:[],members:[],presence:[],realtimeChannel:null,realtimeHouseholdId:null,refreshTimer:null,pendingInviteRunning:false,view:"overview",authMode:"login",inviteToken:"",installPrompt:null,weather:null};
const $ = (selector,root=document) => root.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const isManager = () => state.role === "owner" || state.role === "admin";
const toast = message => { const node=$("#toast"); node.textContent=message; node.classList.add("show"); clearTimeout(toast.timer); toast.timer=setTimeout(()=>node.classList.remove("show"),3400); };
const openModal = id => $("#"+id).showModal();
function updateDate(){ $("#todayDate").textContent=new Intl.DateTimeFormat("nl-NL",{weekday:"long",day:"numeric",month:"long"}).format(new Date()); }
function setConnection(connected,title,detail){ $("#connectionCard").classList.toggle("connected",connected); $("#connectionTitle").textContent=title; $("#connectionText").textContent=detail; }
function updateProfile(){
  const name=state.user?.user_metadata?.full_name || state.user?.email?.split("@")[0] || "Welkom";
  $("#userName").textContent=name; $("#userAvatar").textContent=name.slice(0,1).toUpperCase();
  $("#userRole").textContent=state.role?({owner:"Eigenaar",admin:"Beheerder",family:"Gezinslid",guest:"Gast"}[state.role]):(state.user?"Nog geen huisruimte":"Nog niet ingelogd");
  $("#authButton").textContent=state.user?"↗":"⋯";
}
function setSetupBanner(){
  const banner=$("#setupBanner");
  if(!hasBackend || backendImportError){banner.hidden=false;banner.querySelector("strong").textContent=backendImportError?"Supabase kon niet worden geladen":"Cloud-backend nog niet ingesteld";banner.querySelector("p").textContent=backendImportError?"Controleer de internetverbinding en probeer opnieuw.":"Het weer werkt al. Stel je gratis Supabase-project in voor gezinsaccounts en huisgegevens." ;$("#setupButton").textContent="Installatie bekijken →";}
  else if(!state.user){banner.hidden=false;banner.querySelector("strong").textContent="Log in om jullie huis te openen";banner.querySelector("p").textContent="Je gezinsgegevens zijn privé en laden pas nadat je bent ingelogd.";}
  else if(!state.household){banner.hidden=false;banner.querySelector("strong").textContent="Maak jullie huisruimte aan";banner.querySelector("p").textContent="Je account is verbonden. Maak een huishouden of gebruik een gezinsuitnodiging.";}
  else banner.hidden=true;
}
function roomIcon(icon){return ({living:"⌂",bed:"▤",kitchen:"♨",bath:"◌",garden:"❋",office:"▣",other:"⌂"})[icon]||"⌂";}
function deviceIcon(kind){return ({tv:"▣",speaker:"♫",light:"☼",plug:"ϟ",sensor:"◉",climate:"❉",other:"◈"})[kind]||"◈";}
function kindLabel(kind){return ({tv:"Televisie",speaker:"Speaker",light:"Verlichting",plug:"Stopcontact",sensor:"Sensor",climate:"Klimaat",other:"Overig"})[kind]||"Apparaat";}
function heading(eyebrow,title,description,action){return '<div class="page-heading"><div><div class="eyebrow">'+eyebrow+'</div><h1>'+title+'</h1><p>'+description+'</p></div>'+(action?'<button class="button button-primary" data-action="page-add">＋ '+action+'</button>':"")+'</div>';}
function empty(icon,title,description,button,action){return '<div class="empty-state"><span class="empty-icon">'+icon+'</span><strong>'+title+'</strong><p>'+description+'</p>'+(button?'<button class="button button-outline" style="margin-top:15px" data-action="'+action+'">'+button+'</button>':"")+'</div>';}
function roomsMarkup(){
  if(!state.rooms.length)return empty("⌂","Nog geen kamers","Maak kamers aan om apparaten straks per ruimte te groeperen.",isManager()?"Eerste kamer toevoegen":"","room");
  return '<div class="list-grid">'+state.rooms.map(room=>'<article class="room-card"><div class="room-card-top"><span class="room-glyph">'+roomIcon(room.icon)+'</span><span class="pill">'+state.devices.filter(d=>d.room_id===room.id).length+' apparaten</span></div><h3>'+esc(room.name)+'</h3><div class="card-subtitle">Ruimte in jullie huis</div>'+(isManager()?'<div class="card-actions"><button class="delete-button" data-delete="rooms" data-id="'+esc(room.id)+'" type="button">Verwijderen</button></div>':'')+'</article>').join("")+'</div>';
}
function devicesMarkup(){
  if(!state.devices.length)return empty("◉","Nog geen apparaten geregistreerd","Voeg apparaten toe aan je inventaris. Ze worden niet als verbonden getoond zonder echte integratie.",isManager()?"Apparaat registreren":"","device");
  return '<div class="device-list">'+state.devices.map(device=>{const room=state.rooms.find(r=>r.id===device.room_id);return '<article class="device-row"><span class="device-glyph">'+deviceIcon(device.kind)+'</span><div class="device-row-main"><strong>'+esc(device.name)+'</strong><small>'+esc(kindLabel(device.kind))+' · '+esc(room?.name||"Geen kamer")+(device.manufacturer?" · "+esc(device.manufacturer):"")+'</small></div><span class="pill '+(device.connection_state==="connected"?"ok":"pending")+'">'+(device.connection_state==="connected"?"Verbonden":"Niet gekoppeld")+'</span>'+(isManager()?'<button class="delete-button" data-delete="devices" data-id="'+esc(device.id)+'" type="button">Verwijderen</button>':'')+'</article>';}).join("")+'</div>';
}
function automationsMarkup(){
  if(!state.automations.length)return empty("⌁","Nog geen automatiseringen","Leg alvast vast wat er moet gebeuren. Regels worden als concept bewaard; ze voeren nog niets automatisch uit.",isManager()?"Regel aanmaken":"","automation");
  return '<div class="automation-list">'+state.automations.map(rule=>'<article class="automation-card"><div class="room-card-top"><span class="pill pending">Concept · niet actief</span><span class="card-subtitle">'+new Date(rule.created_at).toLocaleDateString("nl-NL")+'</span></div><h3>'+esc(rule.name)+'</h3><div class="rule-line"><b>ALS</b>'+esc(rule.trigger_description)+'</div><div class="rule-line"><b>DAN</b>'+esc(rule.action_description)+'</div>'+(isManager()?'<div class="card-actions"><button class="delete-button" data-delete="automation_drafts" data-id="'+esc(rule.id)+'" type="button">Verwijderen</button></div>':'')+'</article>').join("")+'</div>';
}
function activityMarkup(){
  if(!state.events.length)return empty("◷","Nog geen activiteit","Nieuwe kamers, uitnodigingen en wijzigingen verschijnen later in dit overzicht.");
  return '<div class="device-list">'+state.events.map(event=>'<article class="device-row"><span class="device-glyph">◷</span><div class="device-row-main"><strong>'+esc(event.description)+'</strong><small>'+new Date(event.created_at).toLocaleString("nl-NL")+'</small></div></article>').join("")+'</div>';
}
function presenceLabel(value){
  return ({home:"Thuis",away:"Afwezig",unknown:"Niet ingesteld"})[value] || "Niet ingesteld";
}
function presenceGlyph(value){
  return ({home:"⌂",away:"↗",unknown:"·"})[value] || "·";
}
function presenceMarkup(){
  if(!state.user || !state.household) {
    return '<section class="panel presence-panel"><div class="panel-heading"><div><div class="eyebrow">AANWEZIGHEID</div><h2>Wie is thuis?</h2></div></div><p class="muted">Log in en open jullie huisruimte om aanwezigheidsstatussen te bekijken.</p></section>';
  }
  const mine = state.presence.find(item=>item.user_id===state.user.id);
  const current = mine?.presence || "unknown";
  const controls = '<div class="presence-controls"><button class="presence-choice '+(current==="home"?"active":"")+'" data-presence="home" type="button">⌂ Thuis</button><button class="presence-choice '+(current==="away"?"active":"")+'" data-presence="away" type="button">↗ Afwezig</button></div>';
  const rows = state.members.map(member=>{
    const person = state.presence.find(item=>item.user_id===member.user_id);
    const name = member.profiles?.full_name || "Gezinslid";
    const value = person?.presence || "unknown";
    const label = presenceLabel(value);
    return '<div class="presence-person"><span class="avatar">'+esc(name.slice(0,1).toUpperCase())+'</span><div class="presence-person-meta"><strong>'+esc(name)+(member.user_id===state.user.id?' <span class="you-label">JIJ</span>':'')+'</strong><small>'+esc(label)+(person?.updated_at?' · '+new Date(person.updated_at).toLocaleString("nl-NL",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):'')+'</small></div><span class="presence-indicator '+esc(value)+'" aria-label="'+esc(label)+'">'+presenceGlyph(value)+'</span></div>';
  }).join("");
  return '<section class="panel presence-panel"><div class="panel-heading"><div><div class="eyebrow">AANWEZIGHEID</div><h2>Wie is thuis?</h2></div>'+controls+'</div><div class="presence-people">'+(rows||'<p class="muted">Nog geen gezinsleden.</p>')+'</div><p class="presence-note">Handmatig bijgehouden door ieder gezinslid. Haven volgt geen GPS-locatie.</p></section>';
}
function familyMarkup(){
  if(!state.members.length)return empty("♧","Nog geen gezinsleden","De eigenaar verschijnt hier zodra het huishouden is geladen.");
  return '<div class="list-grid">'+state.members.map(member=>{const name=member.profiles?.full_name||"Gezinslid";const role=({owner:"Eigenaar",admin:"Beheerder",family:"Gezinslid",guest:"Gast"})[member.role]||member.role;return '<article class="member-card"><div class="member-card-top"><span class="avatar">'+esc(name.slice(0,1).toUpperCase())+'</span><span class="role-badge">'+esc(role)+'</span></div><h3>'+esc(name)+'</h3><div class="card-subtitle">Lid sinds '+new Date(member.created_at).toLocaleDateString("nl-NL")+'</div>'+(state.role==="owner"&&member.role!=="owner"?'<label class="role-editor">Toegangsrol<select data-role-user="'+esc(member.user_id)+'"><option value="admin" '+(member.role==="admin"?"selected":"")+'>Beheerder</option><option value="family" '+(member.role==="family"?"selected":"")+'>Gezinslid</option><option value="guest" '+(member.role==="guest"?"selected":"")+'>Gast</option></select></label>':'')+'</article>';}).join("")+'</div>';
}
function weatherMarkup(){
 const w=state.weather;
 return '<section class="weather-card"><div class="weather-main"><div class="eyebrow light-eyebrow">VANDAAG IN HEINO</div><div class="weather-temp">'+(w?Math.round(w.temperature)+"°":"--°")+'</div><div class="weather-description">'+esc(w?.description||"Weer ophalen…")+'</div><div class="weather-updated">'+esc(w?.updated||"Open-Meteo · Heino, Overijssel")+'</div></div><div class="weather-symbol">'+(w?.symbol||"☁")+'</div><div class="weather-details"><div><span>GEVOELD</span><strong>'+(w?Math.round(w.feels)+"°":"--°")+'</strong></div><div><span>WIND</span><strong>'+(w?Math.round(w.wind)+" km/u":"-- km/u")+'</strong></div><div><span>LUCHTVOCHTIGHEID</span><strong>'+(w?Math.round(w.humidity)+"%":"--%")+'</strong></div><div><span>VANDAAG</span><strong>'+(w?Math.round(w.min)+"° / "+Math.round(w.max)+"°":"--° / --°")+'</strong></div></div></section>';
}
function render(){
  const titles={overview:"Overzicht",rooms:"Kamers",devices:"Apparaten",automations:"Automatiseringen",energy:"Energie",activity:"Activiteit",family:"Gezin",settings:"Instellingen"};
  $("#pageLabel").textContent=titles[state.view]||"Overzicht";
  $$(".nav-item").forEach(button=>button.classList.toggle("active",button.dataset.view===state.view));
  $$(".mobile-nav button").forEach(button=>button.classList.toggle("active",button.dataset.view===state.view));
  $("#roomCount").textContent=state.rooms.length;$("#deviceCount").textContent=state.devices.length;
  $("#topAction").hidden=!["rooms","devices","automations"].includes(state.view);
  let body="";
  if(state.view==="overview"){
    body='<div class="welcome-row"><div><div class="eyebrow">JOUW THUIS, IN ÉÉN OVERZICHT</div><h1>Goedendag<span class="accent-dot">.</span></h1><p>Een rustig overzicht van wat er thuis gebeurt.</p></div><div class="home-state"><span class="state-orb"></span><div><strong>'+esc(state.household?.name||"Huisstatus")+'</strong><small>'+(state.household?"Gezinsruimte verbonden":state.user?"Nog niet ingesteld":"Nog niet verbonden")+'</small></div></div></div>'+weatherMarkup()+presenceMarkup()+
    '<section class="metric-grid"><article class="metric-card"><div class="metric-top"><span>APPARATEN</span><span class="metric-icon">◉</span></div><strong>'+state.devices.length+'</strong><small>Geregistreerd in je huis</small></article><article class="metric-card"><div class="metric-top"><span>KAMERS</span><span class="metric-icon">▦</span></div><strong>'+state.rooms.length+'</strong><small>Ingericht in je woning</small></article><article class="metric-card"><div class="metric-top"><span>AUTOMATISERINGEN</span><span class="metric-icon">⌁</span></div><strong>'+state.automations.length+'</strong><small>Opgeslagen conceptregels</small></article><article class="metric-card"><div class="metric-top"><span>ENERGIE VANDAAG</span><span class="metric-icon">ϟ</span></div><strong>—</strong><small>Wacht op een echte energiemeter</small></article></section>'+
    '<section class="content-grid"><article class="panel"><div class="panel-heading"><div><div class="eyebrow">RUIMTES</div><h2>In huis</h2></div><button class="text-button" data-go="rooms">Alle kamers →</button></div>'+(state.rooms.length?roomsMarkup():'<div class="empty-state compact-empty"><span class="empty-icon">⌂</span><strong>Je kamers verschijnen hier</strong><p>Maak je eerste kamer aan zodra je huisruimte is ingesteld.</p></div>')+'</article><article class="panel"><div class="panel-heading"><div><div class="eyebrow">RECENT</div><h2>Gebeurtenissen</h2></div><button class="text-button" data-go="activity">Alles bekijken →</button></div>'+(state.events.length?activityMarkup():'<div class="empty-state compact-empty"><span class="empty-icon">◷</span><strong>Nog geen gebeurtenissen</strong><p>Activiteit verschijnt hier zodra er gegevens zijn.</p></div>')+'</article></section>';
  }else if(state.view==="rooms")body=heading("INDELING","Kamers","Organiseer apparaten per ruimte in je huis.",isManager()?"Kamer toevoegen":"")+roomsMarkup();
  else if(state.view==="devices")body=heading("APPARAATBEHEER","Apparaten","Geregistreerde apparaten en hun echte verbindingsstatus.",isManager()?"Apparaat registreren":"")+devicesMarkup()+'<div class="guide-panel" style="margin-top:16px"><h3>Apparaten zijn nog niet rechtstreeks gekoppeld</h3><p>Een apparaat toevoegen registreert alleen merk, type en kamer. Rechtstreekse bediening vraagt om een echte lokale integratie. Haven verzint geen verbindingsstatus of bediening.</p></div>';
  else if(state.view==="automations")body=heading("REGELS & ROUTINES","Automatiseringen","Maak ALS/DAN-regels en bewaar ze als concept.",isManager()?"Regel aanmaken":"")+automationsMarkup()+'<div class="guide-panel" style="margin-top:16px"><h3>Waarom zijn regels nog niet actief?</h3><p>Een website die gesloten is kan niet betrouwbaar 24/7 voorwaarden controleren. Voor uitvoering is een apparaat nodig dat thuis continu beschikbaar is. Daarom zet Haven regels bewust niet op actief.</p></div>';
  else if(state.view==="energy")body=heading("INZICHTEN","Energie","Volg verbruik zodra een geschikte energiemeter is aangesloten.")+empty("ϟ","Nog geen energiebron gekoppeld","Er zijn nog geen energiemetingen beschikbaar. Haven verzint geen verbruikswaarden.");
  else if(state.view==="activity")body=heading("HUISGESCHIEDENIS","Activiteit","Recente wijzigingen binnen jullie huisruimte.")+activityMarkup();
  else if(state.view==="family")body=heading("SAMEN THUIS","Gezin","Beheer wie toegang heeft tot jullie gedeelde huisruimte.",isManager()?"Gezinslid uitnodigen":"")+familyMarkup()+presenceMarkup()+'<div class="guide-panel" style="margin-top:16px"><h3>Gezinsrollen</h3><p><b>Eigenaar</b> — volledige controle. <b>Beheerder</b> — huis beheren. <b>Gezinslid</b> — gegevens bekijken. <b>Gast</b> — kamers en apparaten bekijken. In deze eerste release kunnen alleen eigenaar en beheerders wijzigingen aanmaken.</p></div>';
  else body=heading("PERSOONLIJK","Instellingen","Verbindingen, account en privacy.")+'<div class="content-grid"><section class="guide-panel"><h3>Backendverbinding</h3><p>'+(hasBackend?(state.user?"Je Supabase-project is verbonden en je sessie is actief.":"Supabase is ingesteld. Log in om verder te gaan."):"Vul de Supabase Project URL en anon/publishable key in config.js in. Voer daarna supabase/schema.sql uit in de SQL Editor.")+'</p><button class="button button-outline" data-action="setup-guide">Installatiestappen bekijken</button></section><section class="guide-panel"><h3>Huisruimte</h3><p>'+esc(state.household?.name||"Nog geen huisruimte")+'</p><p>Je rol: '+esc(state.role||"Niet ingelogd")+'</p>'+(state.user?'<button class="button button-outline" data-action="signout">Uitloggen</button>':'<button class="button button-primary" data-action="auth">Inloggen / account maken</button>')+'</section></div><div class="guide-panel" style="margin-top:16px"><h3>Privacy en beveiliging</h3><p>Supabase Auth beheert accounts. Databasegegevens worden beschermd met Row Level Security. De app cachet geen ingelogde gegevens voor offline gebruik. Zet nooit een service-role key of databasewachtwoord in config.js.</p></div>';
  $("#pageContent").innerHTML=body+'<footer class="page-footer"><span>HAVEN HOME</span><span>Privé voor jouw gezin · Gebouwd om uit te breiden</span></footer>';
  updateRoomSelect();updateProfile();setSetupBanner();
}
function updateRoomSelect(){const select=$("#deviceRoom");if(!select)return;select.innerHTML='<option value="">Geen kamer</option>'+state.rooms.map(room=>'<option value="'+esc(room.id)+'">'+esc(room.name)+'</option>').join("");}
async function logEvent(type,description){if(supabase&&state.household)await supabase.from("activity_events").insert({household_id:state.household.id,actor_id:state.user.id,event_type:type,description});}
async function loadHousehold(){
  if(!supabase||!state.user)return;
  const {data,error}=await supabase.from("household_members").select("household_id,role,created_at,households(id,name)").eq("user_id",state.user.id).order("created_at",{ascending:true});
  if(error){toast("Huisgegevens laden is niet gelukt: "+error.message);return;}
  if(!data?.length){state.household=null;state.role=null;render();openModal("householdDialog");return;}
  state.household=data[0].households;state.role=data[0].role;await loadHouseholdData();
}
async function loadHouseholdData(){
  const id=state.household?.id;if(!id||!supabase)return;
  const results=await Promise.all([
    supabase.from("rooms").select("*").eq("household_id",id).order("created_at"),
    supabase.from("devices").select("*").eq("household_id",id).order("created_at"),
    supabase.from("automation_drafts").select("*").eq("household_id",id).order("created_at",{ascending:false}),
    supabase.from("activity_events").select("*").eq("household_id",id).order("created_at",{ascending:false}).limit(30),
    supabase.from("household_members").select("user_id,role,created_at,profiles(full_name)").eq("household_id",id).order("created_at"),
    supabase.from("member_presence").select("household_id,user_id,presence,updated_at").eq("household_id",id).order("updated_at",{ascending:false})
  ]);
  results.forEach((result,index)=>{if(result.error)console.error("Haven data "+index,result.error.message);});
  state.rooms=results[0].data||[];state.devices=results[1].data||[];state.automations=results[2].data||[];state.events=results[3].data||[];state.members=results[4].data||[];state.presence=results[5].data||[];
  setConnection(true,"Cloud verbonden","Privé huisruimte actief");render();subscribeHouseholdRealtime(id);
}
function subscribeHouseholdRealtime(householdId){
  if(!supabase || !householdId) return;
  if(state.realtimeChannel && state.realtimeHouseholdId===householdId) return;
  if(state.realtimeChannel) supabase.removeChannel(state.realtimeChannel);
  let channel=supabase.channel("haven-household-"+householdId);
  for(const table of ["rooms","devices","automation_drafts","activity_events","household_members","member_presence"]){
    channel=channel.on("postgres_changes",{event:"*",schema:"public",table,filter:"household_id=eq."+householdId},()=>{
      clearTimeout(state.refreshTimer);
      state.refreshTimer=setTimeout(()=>loadHouseholdData(),350);
    });
  }
  state.realtimeChannel=channel;
  state.realtimeHouseholdId=householdId;
  channel.subscribe((status)=>{
    if(status==="CHANNEL_ERROR" || status==="TIMED_OUT") console.warn("Haven realtime status:",status);
  });
}
async function setPresence(value){
  if(!state.user || !state.household || !["home","away"].includes(value)) return;
  const {error}=await supabase.from("member_presence").upsert({
    household_id:state.household.id,user_id:state.user.id,presence:value,updated_at:new Date().toISOString()
  },{onConflict:"household_id,user_id"});
  if(error){toast("Aanwezigheid bijwerken is niet gelukt: "+error.message);return;}
  toast(value==="home"?"Je status staat op thuis.":"Je status staat op afwezig.");
  await loadHouseholdData();
}
async function acceptPendingInvite(){
  const token=sessionStorage.getItem("haven_pending_invite");
  if(!token || !supabase || !state.user || state.pendingInviteRunning) return false;
  state.pendingInviteRunning=true;
  try{
    const {error}=await supabase.rpc("accept_household_invite",{p_token:token});
    if(error){sessionStorage.removeItem("haven_pending_invite");toast("De bewaarde gezinsuitnodiging kon niet worden gebruikt: "+error.message);return false;}
    sessionStorage.removeItem("haven_pending_invite");
    toast("Je bent aan het gezin toegevoegd.");
    return true;
  }finally{state.pendingInviteRunning=false;}
}
async function refreshSession(){
  if(!supabase){setConnection(false,backendImportError?"Backend niet bereikbaar":"Niet verbonden",backendImportError?"Supabase client laden mislukt":"Supabase nog instellen");render();return;}
  const {data,error}=await supabase.auth.getSession();if(error)toast("Sessie controleren is niet gelukt.");
  state.user=data?.session?.user||null;
  if(state.user){setConnection(true,"Ingelogd","Cloud verbonden");await acceptPendingInvite();await loadHousehold();}
  else{
    if(state.realtimeChannel)supabase.removeChannel(state.realtimeChannel);
    state.realtimeChannel=null;state.realtimeHouseholdId=null;
    state.household=null;state.role=null;state.rooms=[];state.devices=[];state.automations=[];state.events=[];state.members=[];state.presence=[];
    setConnection(false,"Niet ingelogd","Meld je aan om te beginnen");render();
  }
}
async function loadWeather(){
  const url="https://api.open-meteo.com/v1/forecast?latitude=52.43661&longitude=6.23282&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe%2FAmsterdam&forecast_days=1";
  try{
    const response=await fetch(url,{signal:AbortSignal.timeout(9000),cache:"no-store"});if(!response.ok)throw new Error("Weerbron reageert niet.");
    const data=await response.json();const c=data.current,d=data.daily;const info=weatherCode(c.weather_code,c.is_day);
    state.weather={temperature:c.temperature_2m,feels:c.apparent_temperature,humidity:c.relative_humidity_2m,wind:c.wind_speed_10m,min:d.temperature_2m_min[0],max:d.temperature_2m_max[0],description:info.label,symbol:info.icon,updated:"Bijgewerkt om "+new Date(c.time).toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"})+" · Heino"};
    if(state.view==="overview")render();
  }catch(error){if(!state.weather){const node=$("#weatherDescription");if(node)node.textContent="Weer tijdelijk niet beschikbaar";}}
}
function weatherCode(code,isDay){
  if(code===0)return{label:"Onbewolkt",icon:isDay?"☀":"☾"};if(code===1)return{label:"Overwegend helder",icon:"🌤"};if(code===2)return{label:"Half bewolkt",icon:"⛅"};if(code===3)return{label:"Bewolkt",icon:"☁"};if([45,48].includes(code))return{label:"Mistig",icon:"〰"};if([51,53,55,56,57].includes(code))return{label:"Motregen",icon:"🌦"};if([61,63,65,66,67,80,81,82].includes(code))return{label:"Regen",icon:"🌧"};if([71,73,75,77,85,86].includes(code))return{label:"Sneeuw",icon:"❄"};if([95,96,99].includes(code))return{label:"Onweer",icon:"⛈"};return{label:"Wisselend weer",icon:"☁"};
}

async function deleteHouseholdRecord(table, recordId){
  if(!canManage()) return;
  const names={rooms:"kamer",devices:"apparaat",automation_drafts:"automatisering"};
  const label=names[table];
  if(!label || !recordId) return;
  if(!window.confirm("Weet je zeker dat je dit "+label+" wilt verwijderen?")) return;
  const {error}=await supabase.from(table).delete().eq("id",recordId).eq("household_id",state.household.id);
  if(error){toast("Verwijderen is niet gelukt: "+error.message);return;}
  await logEvent(table+".deleted",label.charAt(0).toUpperCase()+label.slice(1)+" verwijderd");
  toast(label.charAt(0).toUpperCase()+label.slice(1)+" verwijderd.");
  await loadHouseholdData();
}
async function changeMemberRole(userId,role){
  if(state.role!=="owner" || !["admin","family","guest"].includes(role)) return;
  const member=state.members.find(item=>item.user_id===userId);
  if(!member || member.role===role) return;
  const {error}=await supabase.from("household_members").update({role}).eq("household_id",state.household.id).eq("user_id",userId);
  if(error){toast("Rol wijzigen is niet gelukt: "+error.message);await loadHouseholdData();return;}
  await logEvent("member.role_changed","Toegangsrol gewijzigd naar "+({admin:"beheerder",family:"gezinslid",guest:"gast"}[role]));
  toast("Toegangsrol bijgewerkt.");
  await loadHouseholdData();
}

function canManage(){if(!state.user){openModal("authDialog");return false;}if(!state.household){toast("Maak eerst een huisruimte aan.");return false;}if(!isManager()){toast("Alleen de eigenaar of beheerder kan dit aanpassen.");return false;}return true;}
function addDialog(type){if(!canManage())return;const id={room:"roomDialog",device:"deviceDialog",automation:"automationDialog",invite:"inviteDialog"}[type];if(id)openModal(id);}
async function processForm(form,callback){
  const button=form.querySelector("button[type=submit]")||form.querySelector("button:not([type])");const old=button?.textContent;
  if(button){button.disabled=true;button.textContent="Opslaan…";}
  try{await callback(new FormData(form));form.reset();}
  catch(error){toast(error.message||"Er ging iets mis.");}
  finally{if(button){button.disabled=false;button.textContent=old;}}
}
$("#authButton").addEventListener("click",()=>{if(state.user){state.view="settings";render();}else if(!hasBackend){state.view="settings";render();toast("Stel eerst Supabase in config.js in.");}else openModal("authDialog");});
$("#connectionHelp").addEventListener("click",()=>{state.view="settings";render();});
$("#setupButton").addEventListener("click",()=>{if(hasBackend&&!state.user)openModal("authDialog");else if(state.user&&!state.household)openModal("householdDialog");else{state.view="settings";render();}});
$("#menuButton").addEventListener("click",()=>$("#sidebar").classList.toggle("open"));
$("#installButton").addEventListener("click",async()=>{if(!state.installPrompt)return;state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;$("#installButton").hidden=true;});
$("#topAction").addEventListener("click",()=>addDialog(state.view==="rooms"?"room":state.view==="devices"?"device":"automation"));
document.addEventListener("change",event=>{
  const roleSelect=event.target.closest("[data-role-user]");
  if(roleSelect) changeMemberRole(roleSelect.dataset.roleUser,roleSelect.value);
});
document.addEventListener("click",event=>{
  const deleteButton=event.target.closest("[data-delete]");
  if(deleteButton){deleteHouseholdRecord(deleteButton.dataset.delete,deleteButton.dataset.id);return;}
  const nav=event.target.closest("[data-view]");if(nav){state.view=nav.dataset.view;$("#sidebar").classList.remove("open");render();history.replaceState(null,"","#"+state.view);return;}
  const go=event.target.closest("[data-go]");if(go){state.view=go.dataset.go;render();return;}
  const presenceButton=event.target.closest("[data-presence]");
  if(presenceButton){setPresence(presenceButton.dataset.presence);return;}
  const action=event.target.closest("[data-action]");if(!action)return;
  const type=action.dataset.action;
  if(type==="room")addDialog("room");else if(type==="device")addDialog("device");else if(type==="automation")addDialog("automation");else if(type==="invite")addDialog("invite");else if(type==="page-add")addDialog(state.view==="rooms"?"room":state.view==="devices"?"device":state.view==="family"?"invite":"automation");else if(type==="signout")supabase?.auth.signOut().then(()=>refreshSession());else if(type==="auth")openModal("authDialog");else if(type==="setup-guide"){state.view="settings";render();}
});
$("#authModeButton").addEventListener("click",()=>{
 state.authMode=state.authMode==="login"?"signup":"login";
 $("#authTitle").textContent=state.authMode==="login"?"Welkom terug":"Account aanmaken";
 $("#authSubtitle").textContent=state.authMode==="login"?"Log in om je huis te openen.":"Maak een persoonlijk account voor Haven.";
 $("#authNameField").hidden=state.authMode!=="signup";
 $("#authSubmit").textContent=state.authMode==="login"?"Inloggen":"Account aanmaken";
 $("#authModeButton").textContent=state.authMode==="login"?"Nog geen account? Account aanmaken":"Heb je al een account? Inloggen";
});
$("#authForm").addEventListener("submit",event=>{
 event.preventDefault();processForm(event.currentTarget,async data=>{
  if(!supabase)throw new Error("Supabase is nog niet ingesteld.");
  const email=data.get("email"),password=data.get("password");let result;
  if(state.authMode==="signup"){result=await supabase.auth.signUp({email,password,options:{data:{full_name:data.get("full_name")||""},emailRedirectTo:new URL("./",window.location.href).toString()}});if(result.error)throw result.error;if(!result.data.session){const pendingInvite=String(data.get("invite_token")||"").trim();if(pendingInvite)sessionStorage.setItem("haven_pending_invite",pendingInvite);toast("Controleer je e-mail om je account te bevestigen. Je uitnodigingscode is op dit apparaat bewaard.");$("#authDialog").close();return;}}
  else{result=await supabase.auth.signInWithPassword({email,password});if(result.error)throw result.error;}
  const token=String(data.get("invite_token")||sessionStorage.getItem("haven_pending_invite")||"").trim();
  if(token){const accepted=await supabase.rpc("accept_household_invite",{p_token:token});if(accepted.error)throw accepted.error;sessionStorage.removeItem("haven_pending_invite");toast("Je bent aan het huishouden toegevoegd.");}
  $("#authDialog").close();await refreshSession();
 });
});
$("#householdForm").addEventListener("submit",event=>{
 event.preventDefault();processForm(event.currentTarget,async data=>{
  const {error}=await supabase.rpc("create_household",{p_name:data.get("name")});if(error)throw error;
  $("#householdDialog").close();toast("Jullie huisruimte is aangemaakt.");await loadHousehold();
 });
});
$("#roomForm").addEventListener("submit",event=>{
 event.preventDefault();processForm(event.currentTarget,async data=>{
  const {error}=await supabase.from("rooms").insert({household_id:state.household.id,name:data.get("name"),icon:data.get("icon")});if(error)throw error;
  await logEvent("room.created","Kamer toegevoegd: "+data.get("name"));$("#roomDialog").close();toast("Kamer opgeslagen.");await loadHouseholdData();
 });
});
$("#deviceForm").addEventListener("submit",event=>{
 event.preventDefault();processForm(event.currentTarget,async data=>{
  const {error}=await supabase.from("devices").insert({household_id:state.household.id,name:data.get("name"),kind:data.get("kind"),room_id:data.get("room_id")||null,manufacturer:data.get("manufacturer")||"",integration:data.get("integration"),connection_state:"not_connected"});if(error)throw error;
  await logEvent("device.registered","Apparaat geregistreerd: "+data.get("name"));$("#deviceDialog").close();toast("Apparaat geregistreerd als niet gekoppeld.");await loadHouseholdData();
 });
});
$("#automationForm").addEventListener("submit",event=>{
 event.preventDefault();processForm(event.currentTarget,async data=>{
  const {error}=await supabase.from("automation_drafts").insert({household_id:state.household.id,name:data.get("name"),trigger_description:data.get("trigger"),action_description:data.get("action"),enabled:false,created_by:state.user.id});if(error)throw error;
  await logEvent("automation.draft_created","Automatisering opgeslagen als concept: "+data.get("name"));$("#automationDialog").close();toast("Concept opgeslagen.");await loadHouseholdData();
 });
});
$("#inviteForm").addEventListener("submit",event=>{
 event.preventDefault();processForm(event.currentTarget,async data=>{
  const {data:token,error}=await supabase.rpc("create_household_invite",{p_household:state.household.id,p_role:data.get("role")});if(error)throw error;
  state.inviteToken=token;$("#inviteCode").textContent=token;$("#inviteResult").hidden=false;toast("Uitnodigingscode gemaakt. Deel deze veilig.");
 });
});
$("#copyInvite").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(state.inviteToken);toast("Uitnodigingscode gekopieerd.");}catch{toast("Kopiëren is niet beschikbaar in deze browser.");}});
$$(".modal").forEach(dialog=>dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close();}));
window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();state.installPrompt=event;$("#installButton").hidden=false;});
window.addEventListener("appinstalled",()=>{$("#installButton").hidden=true;toast("Haven is geïnstalleerd.");});
window.addEventListener("online",()=>toast("Internetverbinding hersteld."));
window.addEventListener("offline",()=>toast("Offline: alleen de opgeslagen app-shell is beschikbaar."));
window.addEventListener("hashchange",()=>{const next=location.hash.slice(1);if(["overview","rooms","devices","automations","energy","activity","family","settings"].includes(next)){state.view=next;render();}});
if("serviceWorker" in navigator&&location.protocol!=="file:")window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(error=>console.warn("Service worker:",error)));
updateDate();const hash=location.hash.slice(1);if(["overview","rooms","devices","automations","energy","activity","family","settings"].includes(hash))state.view=hash;
render();loadWeather();refreshSession();setInterval(loadWeather,30*60*1000);
if(supabase)supabase.auth.onAuthStateChange((_event,session)=>{const next=session?.user||null;if(next?.id!==state.user?.id){state.user=next;queueMicrotask(()=>refreshSession().catch(error=>toast(error.message)));}});
