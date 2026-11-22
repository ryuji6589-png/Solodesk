(() => {
  "use strict";
  const KEY = "solodesk_v1";
  const $ = (id) => document.getElementById(id);
  const today = () => new Date().toISOString().slice(0,10);
  const uid = (prefix) => prefix + "_" + Math.random().toString(36).slice(2,10);
  const money = (amount, currency="USD") => {
    try { return new Intl.NumberFormat(undefined,{style:"currency",currency,maximumFractionDigits:2}).format(Number(amount)||0); }
    catch { return `${currency} ${(Number(amount)||0).toFixed(2)}`; }
  };
  const statusNames = {pending:"Pending",in_progress:"In progress",review:"Review",completed:"Completed",cancelled:"Cancelled"};
  const escapeHtml = (s="") => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const blankState = () => ({currency:"USD",clients:[],orders:[]});
  let state = loadState();
  function loadState(){
    try { const raw=localStorage.getItem(KEY); if(!raw) return blankState(); const parsed=JSON.parse(raw); return {currency:parsed.currency||"USD",clients:Array.isArray(parsed.clients)?parsed.clients:[],orders:Array.isArray(parsed.orders)?parsed.orders:[]}; }
    catch { return blankState(); }
  }
  function save(){ localStorage.setItem(KEY,JSON.stringify(state)); render(); }
  function clientName(id){ return state.clients.find(c=>c.id===id)?.name || "Unknown client"; }
  function paidFor(order){ return (order.payments||[]).reduce((sum,p)=>sum+(Number(p.amount)||0),0); }
  function remaining(order){ return Math.max(0,(Number(order.price)||0)-paidFor(order)); }
  function paymentLabel(order){ const rem=remaining(order); if(rem<=0) return "Paid"; if(paidFor(order)>0) return "Partial"; return "Unpaid"; }
  function paymentClass(order){ return paymentLabel(order)==="Paid"?"paid":paymentLabel(order)==="Partial"?"partial":"unpaid"; }
  function fmtDate(value){ if(!value)return "No deadline"; const d=new Date(value+"T00:00:00"); return d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}); }
  function isActive(o){ return ["pending","in_progress","review"].includes(o.status); }
  function showToast(msg){ const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>t.classList.remove("show"),2400); }
  function render(){
    const active=state.orders.filter(o=>["in_progress","review"].includes(o.status));
    const due=state.orders.filter(o=>isActive(o)&&o.deadline&&o.deadline>=today()&&o.deadline<=new Date(Date.now()+7*86400000).toISOString().slice(0,10));
    const overdue=state.orders.filter(o=>isActive(o)&&o.deadline&&o.deadline<today());
    const dueCardSmall=document.querySelector("#stat-due")?.parentElement?.querySelector("small");
    if(dueCardSmall){
      dueCardSmall.textContent=overdue.length?`Due within 7 days · ${overdue.length} overdue`:"Due within the next 7 days";
      dueCardSmall.style.color=overdue.length?"#dc2626":"";
      dueCardSmall.style.fontWeight=overdue.length?"600":"";
    }
    const received=state.orders.flatMap(o=>(o.payments||[]).map(p=>({...p,currency:o.currency}))).filter(p=>p.paidAt&&p.paidAt.slice(0,7)===today().slice(0,7));
    const receivedByCurrency=received.reduce((a,p)=>{a[p.currency]=(a[p.currency]||0)+Number(p.amount||0);return a;},{});
    $("stat-active").textContent=active.length;
    $("stat-due").textContent=due.length;
    $("stat-received").textContent=multiCurrency(receivedByCurrency);
    $("stat-outstanding").textContent=multiCurrency(sumByCurrency(state.orders,o=>remaining(o)));
    $("nav-order-count").textContent=state.orders.filter(isActive).length;
    $("today-label").textContent=new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"}).toUpperCase();
    renderRecent();renderAttention();renderOrders();renderClients();renderEarnings();
    $("default-currency").value=state.currency;
  }
  function sumByCurrency(orders,fn){return orders.reduce((a,o)=>{a[o.currency]=(a[o.currency]||0)+fn(o);return a;},{});}
  function multiCurrency(obj){const entries=Object.entries(obj).filter(([,v])=>v>0);if(!entries.length)return money(0,state.currency);return entries.map(([c,v])=>money(v,c)).join(" · ");}
  function renderRecent(){
    const list=[...state.orders].sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||"")).slice(0,5);
    $("recent-orders").innerHTML=list.length?list.map(o=>`<div class="recent-row"><div><div class="order-name">${escapeHtml(o.title)}</div><div class="order-client">${escapeHtml(clientName(o.clientId))}</div></div><span class="status ${o.status}">${statusNames[o.status]||"Pending"}</span><span class="order-price">${money(o.price,o.currency)}</span></div>`).join(""):`<div class="empty-state"><div class="empty-icon">▤</div><strong>No orders yet</strong><p>Create your first order to see it here.</p></div>`;
  }
  function renderAttention(){
    const items=[];
    state.orders.filter(o=>isActive(o)&&o.deadline&&o.deadline<today()).forEach(o=>items.push({red:true,title:`${o.title} is overdue`,desc:`${clientName(o.clientId)} · Due ${fmtDate(o.deadline)}`}));
    state.orders.filter(o=>isActive(o)&&o.deadline&&o.deadline>=today()&&o.deadline<=new Date(Date.now()+3*86400000).toISOString().slice(0,10)).forEach(o=>items.push({title:`${o.title} is due soon`,desc:`${clientName(o.clientId)} · Due ${fmtDate(o.deadline)}`}));
    state.orders.filter(o=>remaining(o)>0&&o.status==="completed").forEach(o=>items.push({title:`Payment outstanding: ${money(remaining(o),o.currency)}`,desc:`${o.title} · ${clientName(o.clientId)}`}));
    $("attention-list").innerHTML=items.length?items.slice(0,5).map(i=>`<div class="attention-item"><span class="attention-symbol ${i.red?"red":""}">${i.red?"!":"◷"}</span><div><strong>${escapeHtml(i.title)}</strong><p>${escapeHtml(i.desc)}</p></div></div>`).join(""):`<div class="empty-state"><div class="empty-icon">✓</div><strong>All caught up</strong><p>No urgent items right now.</p></div>`;
  }
  function deadlineCell(o){
    const isOverdue = isActive(o) && o.deadline && o.deadline < today();
    if(!isOverdue) return fmtDate(o.deadline);
    return `<span style="color:#dc2626;font-weight:600">${fmtDate(o.deadline)} · Overdue</span>`;
  }
  function renderOrders(){
    const q=($("order-search").value||"").toLowerCase(),filter=$("status-filter").value;
    const rows=state.orders.filter(o=>(filter==="all"||o.status===filter)&&(`${o.title} ${clientName(o.clientId)} ${o.service||""}`).toLowerCase().includes(q)).sort((a,b)=>(a.deadline||"9999").localeCompare(b.deadline||"9999"));
    $("orders-table").innerHTML=rows.map(o=>`<tr><td>${escapeHtml(o.title)}<div class="order-client">${escapeHtml(o.service||"")}</div></td><td>${escapeHtml(clientName(o.clientId))}</td><td>${deadlineCell(o)}</td><td><span class="status ${o.status}">${statusNames[o.status]}</span></td><td><span class="payment ${paymentClass(o)}">${paymentLabel(o)}</span></td><td>${money(o.price,o.currency)}</td><td><div class="table-actions"><button class="mini-btn" data-action="edit-order" data-id="${o.id}">Edit</button><button class="mini-btn" data-action="payment" data-id="${o.id}">＋ Pay</button><button class="mini-btn" data-action="delete-order" data-id="${o.id}">×</button></div></td></tr>`).join("");
    $("orders-empty").classList.toggle("hidden",rows.length>0);
  }
  function renderClients(){
    const q=($("client-search").value||"").toLowerCase();
    const clients=state.clients.filter(c=>(`${c.name} ${c.email||""}`).toLowerCase().includes(q));
    $("client-total").textContent=`${state.clients.length} client${state.clients.length===1?"":"s"}`;
    $("clients-grid").innerHTML=clients.map(c=>{const orders=state.orders.filter(o=>o.clientId===c.id);return `<article class="client-card"><div class="client-card-top"><div class="client-avatar">${escapeHtml(c.name.charAt(0).toUpperCase())}</div><div><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(c.email||"No email added")}</small></div></div><div class="client-meta"><span>${orders.length} order${orders.length===1?"":"s"}</span><button class="text-btn" data-action="edit-client" data-id="${c.id}">Edit</button></div></article>`}).join("");
    $("clients-empty").classList.toggle("hidden",clients.length>0);
  }
  function renderEarnings(){
    const payments=state.orders.flatMap(o=>(o.payments||[]).map(p=>({...p,currency:o.currency})));
    const month=payments.filter(p=>p.paidAt&&p.paidAt.slice(0,7)===today().slice(0,7)).reduce((a,p)=>{a[p.currency]=(a[p.currency]||0)+Number(p.amount||0);return a;},{});
    const total=payments.reduce((a,p)=>{a[p.currency]=(a[p.currency]||0)+Number(p.amount||0);return a;},{});
    $("earn-month").textContent=multiCurrency(month);$("earn-total").textContent=multiCurrency(total);$("earn-due").textContent=multiCurrency(sumByCurrency(state.orders,remaining));
    const rows=state.orders.filter(o=>Number(o.price)>0).map(o=>`<tr><td>${escapeHtml(o.title)}</td><td>${escapeHtml(clientName(o.clientId))}</td><td>${money(o.price,o.currency)}</td><td>${money(paidFor(o),o.currency)}</td><td>${money(remaining(o),o.currency)}</td><td><span class="payment ${paymentClass(o)}">${paymentLabel(o)}</span></td></tr>`).join("");
    $("earnings-table").innerHTML=rows;$("earnings-empty").classList.toggle("hidden",!!rows);
  }
  function openOrder(id=null){
    if(!state.clients.length){openClient();showToast("Add a client before creating an order.");return;}
    $("order-form").reset();$("order-id").value=id||"";
    $("order-client").innerHTML=state.clients.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
    $("order-currency").value=state.currency;$("order-revision-limit").value=2;$("order-revisions-used").value=0;
    if(id){const o=state.orders.find(x=>x.id===id);if(!o)return;$("modal-title").textContent="Edit order";$("order-title").value=o.title;$("order-client").value=o.clientId;$("order-service").value=o.service||"";$("order-price").value=o.price;$("order-currency").value=o.currency;$("order-deadline").value=o.deadline||"";$("order-status").value=o.status;$("order-revision-limit").value=o.revisionLimit??2;$("order-revisions-used").value=o.revisionsUsed??0;$("order-notes").value=o.notes||"";}else{$("modal-title").textContent="New order";}
    $("modal-backdrop").classList.remove("hidden");
  }
  function closeOrder(){$("modal-backdrop").classList.add("hidden");}
  function openClient(id=null){
    $("client-form").reset();$("client-id").value=id||"";
    if(id){const c=state.clients.find(x=>x.id===id);if(!c)return;$("client-modal-title").textContent="Edit client";$("client-name").value=c.name;$("client-email").value=c.email||"";$("client-notes").value=c.notes||"";}else{$("client-modal-title").textContent="Add client";}
    $("client-modal-backdrop").classList.remove("hidden");
  }
  function closeClient(){$("client-modal-backdrop").classList.add("hidden");}
  function go(view){
    document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));
    $(view+"-view").classList.remove("hidden");
    document.querySelectorAll(".nav-item[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
    $("crumb-current").textContent=view.charAt(0).toUpperCase()+view.slice(1);
    $("sidebar").classList.remove("open");window.scrollTo(0,0);
  }
  $("order-form").addEventListener("submit",e=>{
    e.preventDefault();
    const id=$("order-id").value,old=state.orders.find(o=>o.id===id);
    const price=Number($("order-price").value),limit=Number($("order-revision-limit").value),used=Number($("order-revisions-used").value);
    if(!Number.isFinite(price)||price<0||limit<0||used<0){showToast("Please check the price and revision values.");return;}
    const obj={id:id||uid("order"),title:$("order-title").value.trim(),clientId:$("order-client").value,service:$("order-service").value.trim(),price,currency:$("order-currency").value,deadline:$("order-deadline").value,status:$("order-status").value,revisionLimit:limit,revisionsUsed:used,notes:$("order-notes").value.trim(),payments:old?.payments||[],createdAt:old?.createdAt||new Date().toISOString()};
    if(used>limit&&!confirm("Revisions used exceed the allowance. Save anyway?"))return;
    if(old)state.orders=state.orders.map(o=>o.id===id?obj:o);else state.orders.push(obj);
    save();closeOrder();showToast(old?"Order updated.":"Order created.");
  });
  $("client-form").addEventListener("submit",e=>{
    e.preventDefault();const id=$("client-id").value,old=state.clients.find(c=>c.id===id);
    const obj={id:id||uid("client"),name:$("client-name").value.trim(),email:$("client-email").value.trim(),notes:$("client-notes").value.trim(),createdAt:old?.createdAt||new Date().toISOString()};
    if(old)state.clients=state.clients.map(c=>c.id===id?obj:c);else state.clients.push(obj);
    save();closeClient();showToast(old?"Client updated.":"Client added.");
  });
  document.addEventListener("click",e=>{
    const nav=e.target.closest("[data-view]");if(nav){go(nav.dataset.view);return;}
    const goBtn=e.target.closest("[data-go]");if(goBtn){go(goBtn.dataset.go);return;}
    const action=e.target.closest("[data-action]");if(!action)return;
    const {action:act,id}=action.dataset;
    if(act==="edit-order")openOrder(id);
    if(act==="edit-client")openClient(id);
    if(act==="delete-order"){const o=state.orders.find(x=>x.id===id);if(o&&confirm(`Delete "${o.title}"? This also removes its payment records.`)){state.orders=state.orders.filter(x=>x.id!==id);save();showToast("Order deleted.");}}
    if(act==="payment"){const o=state.orders.find(x=>x.id===id);if(!o)return;const left=remaining(o);if(left<=0){showToast("This order is already fully paid.");return;}const raw=prompt(`Remaining balance: ${money(left,o.currency)}\nEnter payment received:`,left.toFixed(2));if(raw===null)return;const amount=Number(raw);if(!Number.isFinite(amount)||amount<=0||amount>left){showToast("Enter an amount greater than 0 and no more than the balance.");return;}o.payments=o.payments||[];o.payments.push({id:uid("payment"),amount,paidAt:today()});save();showToast("Payment recorded.");}
  });
  $("new-order-main").onclick=()=>openOrder();$("new-order-list").onclick=()=>openOrder();$("new-client").onclick=()=>openClient();
  $("modal-close").onclick=closeOrder;$("order-cancel").onclick=closeOrder;$("client-modal-close").onclick=closeClient;$("client-cancel").onclick=closeClient;
  $("modal-backdrop").addEventListener("click",e=>{if(e.target===$("modal-backdrop"))closeOrder();});
  $("client-modal-backdrop").addEventListener("click",e=>{if(e.target===$("client-modal-backdrop"))closeClient();});
  $("order-search").addEventListener("input",renderOrders);$("status-filter").addEventListener("change",renderOrders);$("client-search").addEventListener("input",renderClients);
  $("default-currency").addEventListener("change",e=>{state.currency=e.target.value;save();showToast("Default currency updated.");});
  $("export-data").onclick=()=>{const blob=new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="solodesk-backup-"+today()+".json";a.click();URL.revokeObjectURL(a.href);showToast("Backup exported.");};
  $("import-data").onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const parsed=JSON.parse(await file.text());if(!Array.isArray(parsed.clients)||!Array.isArray(parsed.orders))throw new Error("Invalid backup");if(!confirm("Importing replaces the current local workspace. Continue?"))return;state={currency:parsed.currency||"USD",clients:parsed.clients,orders:parsed.orders};save();showToast("Backup imported.");}catch{showToast("That file is not a valid SoloDesk backup.");}e.target.value="";};
  $("clear-data").onclick=()=>{if(confirm("Permanently clear all SoloDesk data saved in this browser? Export a backup first if needed.")){state=blankState();save();showToast("Local workspace cleared.");}};
  $("mobile-menu").onclick=()=>$("sidebar").classList.toggle("open");
  $("top-avatar").onclick=()=>go("settings");
  $("today-label").textContent=new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"}).toUpperCase();
  render();
})();

function parseClientMessageMock(rawText) {
  const text = String(rawText || "").trim();

  const priceMatch = text.match(/(?:\$|USD|EUR|GBP|BDT|INR|CAD|AUD|৳|€|£|₹)\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:\$|USD|EUR|GBP|BDT|INR|CAD|AUD|taka)/i);
  const rawPrice = priceMatch ? Number(priceMatch[1] || priceMatch[2]) : "";

  const currencyEl = document.getElementById("order-currency");
  let currency = (currencyEl && currencyEl.value) ? currencyEl.value : "USD";
  if (/\bBDT\b|৳|taka/i.test(text)) currency = "BDT";
  else if (/\bEUR\b|€/i.test(text)) currency = "EUR";
  else if (/\bGBP\b|£/i.test(text)) currency = "GBP";
  else if (/\bINR\b|₹/i.test(text)) currency = "INR";
  else if (/\bCAD\b/i.test(text)) currency = "CAD";
  else if (/\bAUD\b/i.test(text)) currency = "AUD";
  else if (/\bUSD\b|\$/i.test(text)) currency = "USD";

  let service = "";
  if (/book cover|cover design|front and back cover/i.test(text)) service = "Book Cover Design";
  else if (/thumbnail/i.test(text)) service = "Thumbnail Design";
  else if (/logo/i.test(text)) service = "Logo Design";
  else if (/video|editing|reel|shorts/i.test(text)) service = "Video Editing";
  else if (/website|landing page|web design/i.test(text)) service = "Web Design";

  let deadline = "";
  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    deadline = isoMatch[1];
  } else {
    const monthMatch = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i);
    if (monthMatch) {
      const now = new Date();
      let year = monthMatch[3] ? Number(monthMatch[3]) : now.getFullYear();
      const candidate = new Date(`${monthMatch[1]} ${monthMatch[2]}, ${year}`);
      if (!Number.isNaN(candidate.getTime())) {
        if (!monthMatch[3] && candidate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
          year += 1;
        }
        const y = String(year);
        const m = String(candidate.getMonth() + 1).padStart(2, "0");
        const d = String(candidate.getDate()).padStart(2, "0");
        deadline = `${y}-${m}-${d}`;
      }
    }
  }

  const firstLine = text.split(/\r?\n/)[0].replace(/\s+/g, " ").trim();
  const shortPart = firstLine.split(/,| budget\b|\bby\b|\bdue\b/i)[0].trim();
  const title = (shortPart || firstLine || "New Client Order").slice(0, 75);

  return {
    title,
    service,
    price: rawPrice,
    currency,
    deadline,
    notes: text.slice(0, 950)
  };
}

async function parseOrderFromBackend(rawText) {
  const response = await fetch("/api/parse-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: rawText })
  });

  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`);
  }

  const payload = await response.json();
  const data = payload && typeof payload === "object" && payload.data && typeof payload.data === "object"
    ? payload.data
    : payload;

  return {
    title: typeof data.title === "string" && data.title.trim() ? data.title.trim().slice(0, 75) : "New Client Order",
    service: typeof data.service === "string" ? data.service.trim() : "",
    price: data.price === "" || data.price === null || data.price === undefined ? "" : Number(data.price),
    currency: typeof data.currency === "string" && data.currency.trim() ? data.currency.trim().toUpperCase() : "USD",
    deadline: typeof data.deadline === "string" ? data.deadline.trim() : "",
    notes: typeof data.notes === "string" && data.notes.trim() ? data.notes.trim().slice(0, 950) : String(rawText).slice(0, 950)
  };
}

function applyParsedOrderToForm(parsed) {
  const titleEl = document.getElementById("order-title");
  const serviceEl = document.getElementById("order-service");
  const priceEl = document.getElementById("order-price");
  const currencyEl = document.getElementById("order-currency");
  const deadlineEl = document.getElementById("order-deadline");
  const notesEl = document.getElementById("order-notes");

  if (titleEl && parsed.title) titleEl.value = parsed.title;
  if (serviceEl && parsed.service) serviceEl.value = parsed.service;
  if (priceEl && parsed.price !== "" && Number.isFinite(Number(parsed.price))) {
    priceEl.value = parsed.price;
  }
  if (currencyEl && parsed.currency) currencyEl.value = parsed.currency;
  if (deadlineEl && parsed.deadline) deadlineEl.value = parsed.deadline;
  if (notesEl && parsed.notes) notesEl.value = parsed.notes;
}

document.addEventListener("click", async (e) => {
  if (e.target.closest("#new-order-main, #new-order-list")) {
    const box = document.getElementById("ai-message-input");
    const status = document.getElementById("ai-intake-status");
    if (box) box.value = "";
    if (status) status.textContent = "Paste a client message to auto-fill";
  }

  const parseBtn = e.target.closest("#ai-parse-btn");
  if (parseBtn) {
    const box = document.getElementById("ai-message-input");
    const status = document.getElementById("ai-intake-status");
    const text = (box && box.value ? box.value : "").trim();

    if (!text) {
      if (status) status.textContent = "Please paste a message first.";
      return;
    }

    const originalLabel = parseBtn.textContent;
    parseBtn.disabled = true;
    parseBtn.textContent = "Parsing...";
    if (status) status.textContent = "Parsing message with AI...";

    try {
      const parsed = await parseOrderFromBackend(text);
      applyParsedOrderToForm(parsed);
      if (status) status.textContent = "Auto-filled with AI — review & save.";
      if (typeof showToast === "function") showToast("Order fields auto-filled with AI.");
    } catch (err) {
      console.warn("AI parse failed, falling back to local parser:", err);
      const fallback = parseClientMessageMock(text);
      applyParsedOrderToForm(fallback);
      if (status) status.textContent = "AI unavailable — filled with basic parser.";
      if (typeof showToast === "function") showToast("Auto-filled using basic parser.");
    } finally {
      parseBtn.disabled = false;
      parseBtn.textContent = originalLabel;
    }
  }
});
