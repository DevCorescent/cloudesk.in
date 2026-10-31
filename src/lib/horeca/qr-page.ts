// The guest's QR menu for a table: browse, choose add-ons, order, follow the
// order live, call a waiter and ask for the bill. One small script (pinned by
// hash in the page's CSP) does the interactive parts; the menu data travels as
// JSON in the page.
import { esc, safeImageUrl } from "../site/html";
import { formatPrice } from "../store/money";
import type { HorecaSettings } from "./model";

export type QrMenuData = {
  venue: { name: string; kind: string; currency: string; taxBps: number; serviceChargeBps: number };
  table: { name: string; kind: string };
  settings: HorecaSettings["qr"];
  valetLink: string | null;
  categories: { id: string; name: string; servedNow: boolean; window: string; items: { id: string; name: string; description: string; price: number; image: string; diet: string; spice: number; tags: string[]; available: boolean; prepMinutes: number; groups: { id: string; name: string; min: number; max: number; options: { id: string; name: string; price: number }[] }[] }[] }[];
};

const THEME = {
  warm: "--bg:#f7f2ea;--card:#fffdf9;--ink:#1f1a17;--muted:#7a6f66;--line:#e9e0d4;--chip:#efe6da",
  light: "--bg:#f5f5f7;--card:#ffffff;--ink:#111114;--muted:#6e6e76;--line:#e6e6ea;--chip:#efeff2",
  dark: "--bg:#0e0e11;--card:#17171c;--ink:#f4f1ea;--muted:#9a978f;--line:#26262d;--chip:#202027",
};

const CSS = `*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}html,body{margin:0}
body{background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;padding-bottom:110px}
button{font:inherit;color:inherit}img{display:block}
.hero{position:relative;height:210px;background:var(--chip) center/cover;}
.hero:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgb(0 0 0/.05),rgb(0 0 0/.65))}
.hero-in{position:absolute;left:0;right:0;bottom:0;z-index:1;padding:18px 18px 20px;color:#fff;display:flex;align-items:flex-end;gap:12px}
.logo{width:54px;height:54px;border-radius:16px;object-fit:cover;background:#fff;box-shadow:0 8px 20px rgb(0 0 0/.3)}
.hero h1{margin:0;font-size:24px;letter-spacing:-.02em;line-height:1.1}.hero p{margin:4px 0 0;font-size:13px;opacity:.88}
.tchip{display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:4px 10px;border-radius:999px;background:rgb(255 255 255/.2);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);font-size:12px;font-weight:600}
.wrap{max-width:720px;margin:0 auto;padding:0 14px}
.welcome{margin:14px 0 0;padding:12px 14px;border-radius:16px;background:var(--card);border:1px solid var(--line);font-size:13.5px;color:var(--muted)}
.bar{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);padding:10px 0 8px;margin-top:6px}
.search{display:flex;gap:8px}.search label{flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:14px;background:var(--card);border:1px solid var(--line)}
.search input{flex:1;border:0;outline:0;background:none;color:var(--ink);font:inherit;min-width:0}
.veg{display:flex;align-items:center;gap:6px;padding:0 12px;border-radius:14px;background:var(--card);border:1px solid var(--line);font-size:13px;font-weight:600;cursor:pointer}
.veg[aria-pressed=true]{border-color:#16a34a;color:#16a34a;background:color-mix(in srgb,#16a34a 10%,var(--card))}
.tabs{display:flex;gap:8px;overflow-x:auto;padding-top:10px;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}
.tabs a{flex:none;padding:7px 13px;border-radius:999px;background:var(--chip);text-decoration:none;color:var(--ink);font-size:13px;font-weight:600}.tabs a.on{background:var(--ink);color:var(--bg)}
.cat{padding-top:18px}.cat h2{margin:0 0 4px;font-size:19px;letter-spacing:-.02em}.cat .win{font-size:12px;color:var(--muted);margin-bottom:8px}
.item{display:grid;grid-template-columns:1fr auto;gap:12px;padding:14px;margin-top:10px;border-radius:20px;background:var(--card);border:1px solid var(--line)}
.item.off{opacity:.55}
.mark{display:inline-grid;place-items:center;width:15px;height:15px;border:1.6px solid;border-radius:3px;vertical-align:-2px;margin-right:6px}.mark i{width:7px;height:7px;border-radius:50%;background:currentColor}
.mark.veg{color:#16a34a}.mark.vegan{color:#15803d}.mark.nonveg{color:#b45309}.mark.nonveg i{border-radius:0;width:0;height:0;background:none;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:7px solid currentColor}.mark.egg{color:#ca8a04}
.item h3{margin:0;font-size:15.5px;letter-spacing:-.01em;display:inline}
.tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}.tag{font-size:11px;font-weight:700;padding:3px 7px;border-radius:999px;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}
.price{margin-top:6px;font-weight:700}.desc{margin:6px 0 0;font-size:13px;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.meta{margin-top:6px;font-size:12px;color:var(--muted)}
.side{position:relative;width:112px}.side img{width:112px;height:104px;border-radius:16px;object-fit:cover;background:var(--chip)}
.add{position:absolute;left:50%;bottom:-10px;transform:translateX(-50%);min-width:84px;padding:8px 14px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--accent);font-weight:800;font-size:13px;letter-spacing:.04em;box-shadow:0 6px 16px rgb(0 0 0/.12);cursor:pointer}
.side.noimg{width:auto}.side.noimg .add{position:static;transform:none}
.add:disabled{color:var(--muted);cursor:not-allowed}
.cartbar{position:fixed;left:12px;right:12px;bottom:14px;z-index:30;max-width:696px;margin:0 auto;display:none;align-items:center;justify-content:space-between;padding:14px 18px;border-radius:18px;background:var(--accent);color:var(--accent-ink);font-weight:700;box-shadow:0 18px 40px -12px rgb(0 0 0/.45);cursor:pointer;border:0;width:calc(100% - 24px)}
.cartbar.on{display:flex}
.track{position:fixed;left:12px;right:12px;bottom:14px;z-index:29;max-width:696px;margin:0 auto;display:none;padding:12px 16px;border-radius:18px;background:var(--card);border:1px solid var(--line);box-shadow:0 18px 40px -12px rgb(0 0 0/.25);cursor:pointer;width:calc(100% - 24px);text-align:left}
.track.on{display:flex;align-items:center;justify-content:space-between;gap:10px}.cartbar.on~.track{bottom:80px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#16a34a;margin-right:8px;animation:pulse 1.6s infinite}@keyframes pulse{50%{opacity:.35}}
.sheet{position:fixed;inset:0;z-index:50;display:none;background:rgb(0 0 0/.45)}.sheet.on{display:block}
.panel{position:absolute;left:0;right:0;bottom:0;max-height:88vh;overflow:auto;background:var(--card);border-radius:24px 24px 0 0;padding:18px 16px 22px;max-width:720px;margin:0 auto;animation:up .3s cubic-bezier(.2,.9,.2,1)}@keyframes up{from{transform:translateY(40px);opacity:.4}}
.panel h3{margin:0;font-size:19px}.panel .x{float:right;border:0;background:var(--chip);width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:16px}
.grp{margin-top:16px}.grp b{font-size:14px}.grp small{color:var(--muted);margin-left:6px}
.opt{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 2px;border-bottom:1px solid var(--line);font-size:14px}.opt input{accent-color:var(--accent);width:18px;height:18px}
textarea,.field{width:100%;margin-top:12px;padding:12px;border-radius:14px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font:inherit;resize:none}
.row{display:flex;align-items:center;gap:12px;margin-top:16px}
.qty{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:12px}.qty button{border:0;background:none;width:38px;height:40px;font-size:18px;cursor:pointer}.qty span{min-width:22px;text-align:center;font-weight:700}
.primary{flex:1;border:0;border-radius:14px;padding:14px;background:var(--accent);color:var(--accent-ink);font-weight:800;font-size:15px;cursor:pointer}.primary:disabled{opacity:.5}
.line{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);font-size:14px}.line small{display:block;color:var(--muted);font-size:12px}
.sum{display:grid;gap:4px;margin-top:12px;font-size:13.5px;color:var(--muted)}.sum div{display:flex;justify-content:space-between}.sum .t{color:var(--ink);font-weight:800;font-size:16px}
.st{font-size:11.5px;font-weight:700;padding:3px 8px;border-radius:999px;background:var(--chip);white-space:nowrap}.st.ready{background:#dcfce7;color:#166534}.st.preparing,.st.new{background:#fef3c7;color:#92400e}.st.pending{background:#e0e7ff;color:#3730a3}
.acts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}.acts button{border:1px solid var(--line);background:var(--bg);border-radius:14px;padding:12px 6px;font-size:13px;font-weight:700;cursor:pointer}
.toast{position:fixed;left:50%;top:16px;transform:translate(-50%,-80px);z-index:60;padding:12px 16px;border-radius:14px;background:var(--ink);color:var(--bg);font-weight:600;font-size:14px;transition:transform .35s cubic-bezier(.2,.9,.2,1);max-width:calc(100% - 24px)}.toast.on{transform:translate(-50%,0)}
.foot{text-align:center;color:var(--muted);font-size:12px;padding:28px 16px}.foot a{color:var(--accent);font-weight:700}
.empty{display:none;text-align:center;color:var(--muted);padding:30px 0}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;

/** Everything interactive on the QR menu. */
export const QR_MENU_SCRIPT = `(function(){var D=JSON.parse(document.getElementById("menu-data").textContent),S=D.settings,cur=D.venue.currency;var loc=cur==="INR"?"en-IN":undefined,fmt0=new Intl.NumberFormat(loc,{style:"currency",currency:cur,maximumFractionDigits:0}),fmt2=new Intl.NumberFormat(loc,{style:"currency",currency:cur});var dig=Number(document.body.dataset.dig||2);function money(v){var x=v/Math.pow(10,dig);return Math.round(x*100)%100?fmt2.format(x):fmt0.format(x)}
var items={};D.categories.forEach(function(c){c.items.forEach(function(i){i.cat=c;items[i.id]=i})});var cart=[];var $=function(s){return document.querySelector(s)};
function toast(t){var e=$("#toast");e.textContent=t;e.classList.add("on");clearTimeout(e._t);e._t=setTimeout(function(){e.classList.remove("on")},2600)}
function cartTotal(){return cart.reduce(function(a,l){return a+l.unit*l.qty},0)}
function renderBar(){var n=cart.reduce(function(a,l){return a+l.qty},0),b=$("#cartbar");if(!b)return;b.classList.toggle("on",n>0);$("#cart-n").textContent=n+" item"+(n===1?"":"s");$("#cart-t").textContent=money(cartTotal())}
function open(id){var s=$(id);s.classList.add("on");document.body.style.overflow="hidden"}function close(){document.querySelectorAll(".sheet").forEach(function(s){s.classList.remove("on")});document.body.style.overflow=""}
var cur_item=null,cur_qty=1;
function showItem(id){var it=items[id];cur_item=it;cur_qty=1;var h="<button class=x type=button data-close aria-label=Close>✕</button><h3>"+esc(it.name)+"</h3><div class=price>"+money(it.price)+"</div>"+(it.description?"<p class=desc style='-webkit-line-clamp:6'>"+esc(it.description)+"</p>":"");it.groups.forEach(function(g){var multi=g.max>1;h+="<div class=grp data-g='"+g.id+"' data-min="+g.min+" data-max="+g.max+"><b>"+esc(g.name)+"</b><small>"+(g.min?"Required":"Optional")+(multi?" · up to "+g.max:"")+"</small>";g.options.forEach(function(o,i){h+="<label class=opt><span>"+esc(o.name)+(o.price?" <small>+"+money(o.price)+"</small>":"")+"</span><input type="+(multi?"checkbox":"radio")+" name='g"+g.id+"' value='"+o.id+"' data-p="+o.price+(!multi&&g.min&&i===0?" checked":"")+"></label>"});h+="</div>"});if(S.allowNotes)h+="<textarea id=it-notes rows=2 maxlength=200 placeholder='Any requests? (less spicy, no onion…)'></textarea>";h+="<div class=row><span class=qty><button type=button data-q=-1 aria-label='One less'>−</button><span id=it-q>1</span><button type=button data-q=1 aria-label='One more'>+</button></span><button class=primary type=button id=it-add>Add</button></div>";$("#item-panel").innerHTML=h;updItem();open("#item-sheet")}
function picked(){var out=[],ok=true;document.querySelectorAll("#item-panel .grp").forEach(function(g){var sel=g.querySelectorAll("input:checked"),n=sel.length,max=Number(g.dataset.max),min=Number(g.dataset.min);if(n<min||n>max)ok=false;sel.forEach(function(i){out.push({id:i.value,p:Number(i.dataset.p)})})});return{opts:out,ok:ok}}
function updItem(){var p=picked(),unit=cur_item.price+p.opts.reduce(function(a,o){return a+o.p},0);$("#it-q").textContent=cur_qty;var b=$("#it-add");b.textContent="Add · "+money(unit*cur_qty);b.disabled=!p.ok}
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c]})}
function showCart(){var h="<button class=x type=button data-close aria-label=Close>✕</button><h3>Your order</h3>";cart.forEach(function(l,i){h+="<div class=line><div><b>"+l.qty+" × "+esc(l.name)+"</b>"+(l.optNames.length?"<small>"+esc(l.optNames.join(", "))+"</small>":"")+(l.notes?"<small>“"+esc(l.notes)+"”</small>":"")+"</div><div style='text-align:right'>"+money(l.unit*l.qty)+"<br><button type=button data-rm="+i+" style='border:0;background:none;color:var(--muted);font-size:12px;cursor:pointer'>Remove</button></div></div>"});var sub=cartTotal();h+="<div class=sum><div><span>Items</span><span>"+money(sub)+"</span></div><div><span>GST and charges</span><span>added to the bill</span></div><div class=t><span>Total</span><span>"+money(sub)+" +</span></div></div>";if(S.askName)h+="<input class=field id=g-name maxlength=80 placeholder='Your name' autocomplete=name>";if(S.askPhone)h+="<input class=field id=g-phone maxlength=20 inputmode=tel placeholder='Phone number' autocomplete=tel>";if(S.minOrder&&sub<S.minOrder)h+="<p class=desc style='color:#b45309'>Minimum for table orders is "+money(S.minOrder)+".</p>";h+="<div class=row><button class=primary type=button id=place"+(S.minOrder&&sub<S.minOrder?" disabled":"")+">Place order</button></div>";$("#cart-panel").innerHTML=h;open("#cart-sheet")}
function post(body){return fetch(location.pathname,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j&&j.error&&j.error.message||"Something went wrong");return j})})}
var ST={pending:"Waiting to confirm",new:"In the kitchen",preparing:"Being prepared",ready:"Ready",served:"Served"};var last=null;
function poll(){fetch(location.pathname+"?status=1",{cache:"no-store"}).then(function(r){return r.json()}).then(function(j){last=j.order;fb=j.feedback||null;var t=$("#track");if(!t)return;if(!j.order){if(fb&&!rated){t.innerHTML="<span><span class=dot></span><b>Thanks for visiting!</b> · How was it?</span><b>Rate us ›</b>";t.classList.add("on")}else t.classList.remove("on");return}var o=j.order,ready=o.items.filter(function(i){return i.status==="ready"}).length,cook=o.items.filter(function(i){return i.status==="new"||i.status==="preparing"}).length;t.innerHTML="<span><span class=dot></span><b>Order #"+o.number+"</b> · "+(o.status==="billed"?"Bill ready":ready?ready+" ready to serve":cook?cook+" in the kitchen":"All served")+"</span><b>"+money(o.totals.total)+" ›</b>";t.classList.add("on");if($("#status-sheet").classList.contains("on"))showStatus()}).catch(function(){})}
var fb=null,rated=false,stars=0;function showFeedback(){var keep=($("#fb-text")||{}).value||"";var h="<button class=x type=button data-close aria-label=Close>✕</button><h3>How was your meal?</h3><div style='display:flex;gap:8px;justify-content:center;margin:18px 0'>";for(var i=1;i<=5;i++)h+="<button type=button data-star="+i+" aria-label='"+i+" star"+(i>1?"s":"")+"' style='font-size:34px;background:none;border:0;cursor:pointer;color:"+(i<=stars?"var(--accent)":"#d6cfc6")+"'>★</button>";h+="</div><textarea id=fb-text rows=3 maxlength=500 placeholder='Tell us more (optional)' style='width:100%;border-radius:12px;border:1px solid var(--line);padding:12px;font:inherit;background:var(--bg);color:inherit'>"+esc(keep)+"</textarea><div class=row><button class=primary id=fb-send type=button"+(stars?"":" disabled")+">Send</button></div>";$("#status-panel").innerHTML=h;open("#status-sheet")}
function showStatus(){var o=last;if(!o)return;var h="<button class=x type=button data-close aria-label=Close>✕</button><h3>Order #"+o.number+"</h3>";o.items.forEach(function(i){h+="<div class=line><div>"+i.qty+" × "+esc(i.name)+"</div><span class='st "+i.status+"'>"+(ST[i.status]||i.status)+"</span></div>"});var t=o.totals;h+="<div class=sum><div><span>Subtotal</span><span>"+money(t.subtotal)+"</span></div>"+(t.discount?"<div><span>Discount</span><span>−"+money(t.discount)+"</span></div>":"")+(t.service?"<div><span>Service charge</span><span>"+money(t.service)+"</span></div>":"")+"<div><span>GST</span><span>"+money(t.tax)+"</span></div>"+(t.tip?"<div><span>Tip</span><span>"+money(t.tip)+"</span></div>":"")+"<div class=t><span>Total</span><span>"+money(t.total)+"</span></div>"+(t.paid?"<div><span>Paid</span><span>"+money(t.paid)+"</span></div>":"")+"</div>";if(o.status==="billed"&&S.upiId&&t.due>0)h+="<div class=row><a class=primary style='text-align:center;text-decoration:none' href='upi://pay?pa="+encodeURIComponent(S.upiId)+"&pn="+encodeURIComponent(D.venue.name)+"&am="+(t.due/Math.pow(10,dig)).toFixed(2)+"&cu=INR&tn="+encodeURIComponent("Order "+o.number)+"'>Pay "+money(t.due)+" by UPI</a></div>";var a="";if(S.callWaiter)a+="<button type=button data-req=waiter>🙋 Call waiter</button><button type=button data-req=water>💧 Water</button>";if(S.requestBill)a+="<button type=button data-req=bill>🧾 Ask for bill</button>";if(a)h+="<div class=acts>"+a+"</div>";$("#status-panel").innerHTML=h;open("#status-sheet")}
document.addEventListener("click",function(e){var t=e.target;if(t.closest("[data-close]")||t.classList.contains("sheet")){close();return}var add=t.closest("[data-add]");if(add){showItem(add.dataset.add);return}var q=t.closest("[data-q]");if(q){cur_qty=Math.max(1,Math.min(50,cur_qty+Number(q.dataset.q)));updItem();return}if(t.id==="it-add"){var p=picked();var names=[];document.querySelectorAll("#item-panel input:checked").forEach(function(i){names.push(i.closest(".opt").querySelector("span").firstChild.textContent.trim())});cart.push({itemId:cur_item.id,name:cur_item.name,qty:cur_qty,options:p.opts.map(function(o){return o.id}),optNames:names,unit:cur_item.price+p.opts.reduce(function(a,o){return a+o.p},0),notes:($("#it-notes")||{}).value||""});close();renderBar();toast("Added "+cur_item.name);return}
if(t.closest("#cartbar")){showCart();return}var rm=t.closest("[data-rm]");if(rm){cart.splice(Number(rm.dataset.rm),1);renderBar();if(!cart.length){close();return}showCart();return}
if(t.id==="place"){t.disabled=true;t.textContent="Placing…";post({action:"order",lines:cart.map(function(l){return{itemId:l.itemId,qty:l.qty,options:l.options,notes:l.notes}}),name:($("#g-name")||{}).value||"",phone:($("#g-phone")||{}).value||""}).then(function(r){cart=[];renderBar();close();toast(r.approval==="staff"?"Sent! A server will confirm it shortly.":"Order placed — it's in the kitchen!");poll()}).catch(function(err){t.disabled=false;t.textContent="Place order";toast(err.message)});return}
if(t.closest("#track")){if(!last&&fb){showFeedback();return}showStatus();return}var star=t.closest("[data-star]");if(star){stars=Number(star.dataset.star);showFeedback();return}if(t.id==="fb-send"){t.disabled=true;post({action:"feedback",rating:stars,comment:($("#fb-text")||{}).value||""}).then(function(){rated=true;close();$("#track").classList.remove("on");toast("Thank you — we read every one.")}).catch(function(err){t.disabled=false;toast(err.message)});return}var rq=t.closest("[data-req]");if(rq){post({action:"request",kind:rq.dataset.req}).then(function(){toast({waiter:"A server is on the way",water:"Water is on the way",bill:"Your bill is on the way"}[rq.dataset.req])}).catch(function(err){toast(err.message)});return}
var v=t.closest("#veg");if(v){var on=v.getAttribute("aria-pressed")!=="true";v.setAttribute("aria-pressed",String(on));filter();return}});
document.addEventListener("change",function(e){if(e.target.closest("#item-panel"))updItem()});
function filter(){var q=($("#q")||{}).value||"";q=q.trim().toLowerCase();var veg=$("#veg")&&$("#veg").getAttribute("aria-pressed")==="true";var any=0;document.querySelectorAll(".cat").forEach(function(c){var n=0;c.querySelectorAll(".item").forEach(function(i){var ok=(!q||i.dataset.q.indexOf(q)>-1)&&(!veg||i.dataset.diet==="veg"||i.dataset.diet==="vegan");i.style.display=ok?"":"none";if(ok)n++});c.style.display=n?"":"none";any+=n});$("#none").style.display=any?"none":"block"}
document.addEventListener("input",function(e){if(e.target.id==="q")filter()});
var tabs=document.querySelectorAll(".tabs a");if("IntersectionObserver" in window){var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){tabs.forEach(function(a){a.classList.toggle("on",a.getAttribute("href")==="#"+en.target.id)})}})},{rootMargin:"-40% 0px -55% 0px"});document.querySelectorAll(".cat").forEach(function(c){io.observe(c)})}
poll();setInterval(poll,8000)})();`;

const dietMark = (d: string) => (d === "none" ? "" : `<span class="mark ${d}" title="${d === "veg" ? "Veg" : d === "vegan" ? "Vegan" : d === "egg" ? "Contains egg" : "Non-veg"}"><i></i></span>`);

export function qrMenuPage(d: QrMenuData) {
  const s = d.settings;
  const money = (n: number) => formatPrice(n, d.venue.currency);
  const ordering = s.enabled && s.mode === "order";
  const digits = (() => {
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency: d.venue.currency }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      return 2;
    }
  })();
  const lum = (() => {
    const n = parseInt(s.accent.slice(1), 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  })();
  const firstImage = d.categories.flatMap((c) => c.items).find((i) => i.image)?.image ?? "";
  const cover = safeImageUrl(s.cover) || safeImageUrl(firstImage);
  const cats = d.categories.filter((c) => c.items.length);
  const item = (i: QrMenuData["categories"][number]["items"][number], served: boolean) => {
    const can = ordering && i.available && served;
    const img = s.showImages ? safeImageUrl(i.image) : "";
    return `<article class="item${i.available && served ? "" : " off"}" data-q="${esc((i.name + " " + i.description + " " + i.tags.join(" ")).toLowerCase())}" data-diet="${esc(i.diet)}">
<div>${s.showDiet ? dietMark(i.diet) : ""}<h3>${esc(i.name)}</h3>
${i.tags.length ? `<div class="tags">${i.tags.slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
<div class="price">${esc(money(i.price))}</div>
${i.description ? `<p class="desc">${esc(i.description)}</p>` : ""}
<div class="meta">${[s.showSpice && i.spice ? "🌶".repeat(i.spice) : "", s.showPrep && i.prepMinutes ? `${i.prepMinutes} min` : "", !i.available ? "Sold out today" : !served ? "Not served now" : ""].filter(Boolean).join(" · ")}</div></div>
<div class="side${img ? "" : " noimg"}">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ""}${ordering ? `<button class="add" type="button" data-add="${esc(i.id)}"${can ? "" : " disabled"}>${can ? "ADD" : i.available ? "LATER" : "SOLD OUT"}</button>` : ""}</div></article>`;
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<title>${esc(d.venue.name)} — Menu</title><meta name="theme-color" content="${esc(s.accent)}">
<style>:root{${THEME[s.theme]};--accent:${s.accent};--accent-ink:${lum > 0.6 ? "#111" : "#fff"}}${CSS}</style></head>
<body data-dig="${digits}">
<header class="hero"${cover ? ` style="background-image:url('${esc(cover)}')"` : ""}><div class="hero-in">${safeImageUrl(s.logo) ? `<img class="logo" src="${esc(safeImageUrl(s.logo))}" alt="">` : ""}<div><h1>${esc(d.venue.name)}</h1><span class="tchip">${d.table.kind === "room" ? "🛎️" : "🍽️"} ${esc(d.table.name)}</span></div></div></header>
<main class="wrap">
${s.welcome ? `<p class="welcome">${esc(s.welcome)}</p>` : ""}
<div class="bar"><div class="search"><label><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" type="search" placeholder="Search the menu" aria-label="Search the menu"></label>${s.showDiet ? `<button class="veg" id="veg" type="button" aria-pressed="false">${dietMark("veg")}Veg only</button>` : ""}</div>
<nav class="tabs" aria-label="Menu sections">${cats.map((c) => `<a href="#c-${esc(c.id)}">${esc(c.name)}</a>`).join("")}</nav></div>
${cats.map((c) => `<section class="cat" id="c-${esc(c.id)}"><h2>${esc(c.name)}</h2>${c.window ? `<div class="win">Served ${esc(c.window)}${c.servedNow ? "" : " · not right now"}</div>` : ""}${c.items.map((i) => item(i, c.servedNow)).join("")}</section>`).join("")}
<p class="empty" id="none">Nothing matches — try another word.</p>
<div class="foot">${s.footer ? `${esc(s.footer)}<br>` : ""}Prices exclude GST${d.venue.serviceChargeBps ? ` · a ${d.venue.serviceChargeBps / 100}% service charge applies` : ""}.${d.valetLink ? `<br><br>🚗 <a href="${esc(d.valetLink)}">Book valet parking</a>` : ""}</div>
</main>
${ordering ? `<button class="cartbar" id="cartbar" type="button"><span id="cart-n">0 items</span><span>View order · <span id="cart-t">${esc(money(0))}</span></span></button>` : ""}
<button class="track" id="track" type="button" aria-live="polite"></button>
<div class="sheet" id="item-sheet"><div class="panel" id="item-panel" role="dialog" aria-label="Item"></div></div>
<div class="sheet" id="cart-sheet"><div class="panel" id="cart-panel" role="dialog" aria-label="Your order"></div></div>
<div class="sheet" id="status-sheet"><div class="panel" id="status-panel" role="dialog" aria-label="Order status"></div></div>
<div class="toast" id="toast" role="status"></div>
<script type="application/json" id="menu-data">${JSON.stringify(d).replace(/</g, "\\u003c")}</script>
<script>${QR_MENU_SCRIPT}</script>
</body></html>`;
}

const guestCss = (accent: string) => `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:#f5f2ec;color:#1f1a17;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif}
.card{width:min(420px,100%);background:#fff;border-radius:28px;padding:28px;box-shadow:0 30px 70px -35px rgb(0 0 0/.35);text-align:center}
.card h1{margin:6px 0 4px;font-size:24px;letter-spacing:-.02em}.muted{color:#7a6f66;font-size:14px;margin:0}
.big{font-size:56px;font-weight:800;letter-spacing:-.04em;margin:10px 0 0}
.steps{display:flex;justify-content:space-between;margin:22px 0 6px;position:relative}.steps:before{content:"";position:absolute;left:10%;right:10%;top:13px;height:2px;background:#eadfd2}
.step{position:relative;z-index:1;flex:1;font-size:12px;color:#9a8f86}.step i{display:grid;place-items:center;width:28px;height:28px;margin:0 auto 6px;border-radius:50%;background:#eadfd2;font-style:normal;font-weight:800;color:#fff}.step.on{color:#1f1a17;font-weight:700}.step.on i{background:${accent}}
button,.btn{display:block;width:100%;margin-top:18px;border:0;border-radius:16px;padding:16px;background:${accent};color:#fff;font:800 16px/1 inherit;cursor:pointer;text-decoration:none}
button:disabled{opacity:.5}
label{display:block;text-align:left;font-size:13px;font-weight:600;margin-top:12px}input,select{width:100%;margin-top:6px;padding:13px;border-radius:12px;border:1px solid #e3d9cc;font:inherit;background:#fff}
.msg{margin-top:14px;padding:10px 12px;border-radius:12px;font-size:14px}.msg.bad{background:#fee2e2;color:#7f1d1d}.msg.ok{background:#dcfce7;color:#14532d}`;

/** The valet guest's ticket: where their car is, and "Bring my car". Refreshes itself, no script. */
export function valetTicketPage(t: { venue: string; ticket: number; status: string; plate: string; car: string; accent: string; expectedAt: string | null }, msg?: string) {
  const steps = ["parked", "requested", "ready", "delivered"];
  const at = t.status === "booked" ? -1 : steps.indexOf(t.status);
  const label = t.status === "booked" ? "Booked — see you soon" : t.status === "parked" ? "Parked safely" : t.status === "requested" ? "Bringing your car" : t.status === "ready" ? "Ready at the entrance" : t.status === "delivered" ? "Handed over — drive safe!" : "Cancelled";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">${t.status === "requested" || t.status === "ready" || t.status === "booked" || t.status === "parked" ? '<meta http-equiv="refresh" content="15">' : ""}<title>Valet ticket #${t.ticket} — ${esc(t.venue)}</title><style>${guestCss(t.accent)}</style></head><body>
<main class="card"><p class="muted">${esc(t.venue)} · Valet</p><div class="big">#${t.ticket}</div><h1>${esc(label)}</h1><p class="muted">${esc([t.plate, t.car].filter(Boolean).join(" · ") || (t.expectedAt ? `Arriving ${t.expectedAt}` : ""))}</p>
${t.status === "booked" ? "" : `<div class="steps">${["Parked", "Requested", "Ready", "Delivered"].map((s, i) => `<div class="step${i <= at ? " on" : ""}"><i>${i <= at ? "✓" : i + 1}</i>${s}</div>`).join("")}</div>`}
${msg ? `<div class="msg ${msg.startsWith("!") ? "bad" : "ok"}">${esc(msg.replace(/^!/, ""))}</div>` : ""}
${t.status === "parked" ? `<form method="post"><button type="submit">🚗 Bring my car</button></form><p class="muted" style="margin-top:10px">We'll start bringing it round right away.</p>` : t.status === "requested" ? `<p class="muted" style="margin-top:14px">This page updates by itself.</p>` : ""}
</main></body></html>`;
}

/** Book valet ahead of a visit — a plain form, no script. */
export function valetBookingPage(v: { venue: string; accent: string }, msg?: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Book valet — ${esc(v.venue)}</title><style>${guestCss(v.accent)}</style></head><body>
<main class="card"><p class="muted">${esc(v.venue)}</p><h1>Book valet parking</h1><p class="muted">Tell us when you're arriving — we'll be ready at the entrance.</p>
${msg ? `<div class="msg bad">${esc(msg)}</div>` : ""}
<form method="post"><label>Your name<input name="guestName" required maxlength="80" autocomplete="name"></label><label>Phone<input name="guestPhone" required maxlength="20" inputmode="tel" autocomplete="tel"></label><label>Car number<input name="plate" maxlength="20" placeholder="KA 01 AB 1234" style="text-transform:uppercase"></label><label>Car (optional)<input name="car" maxlength="60" placeholder="White Honda City"></label><label>Arriving at<input name="expectedAt" type="datetime-local" required></label><button type="submit">Book valet</button></form>
</main></body></html>`;
}

/** Request a table: /r/<venue token>. Script-free; posts a form. */
export function reservePage(v: { venue: string; accent: string; maxParty: number; openFrom: string; openTo: string }, msg?: { ok: boolean; text: string }) {
  const sizes = Array.from({ length: Math.min(20, v.maxParty) }, (_, i) => i + 1).map((n) => `<option value="${n}"${n === 2 ? " selected" : ""}>${n} ${n === 1 ? "person" : "people"}</option>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Reserve a table — ${esc(v.venue)}</title><style>${guestCss(v.accent)}</style></head><body>
<main class="card"><p class="muted">${esc(v.venue)}</p><h1>${msg?.ok ? "Request received" : "Reserve a table"}</h1>
${msg?.ok ? `<div class="msg ok">${esc(msg.text)}</div><p class="muted">We'll call or message you to confirm.</p>` : `<p class="muted">Tables from ${esc(v.openFrom)} to ${esc(v.openTo)}. We'll confirm by phone.</p>
${msg ? `<div class="msg bad">${esc(msg.text)}</div>` : ""}
<form method="post"><label>Your name<input name="guestName" required maxlength="80" autocomplete="name"></label><label>Phone<input name="guestPhone" required maxlength="20" inputmode="tel" autocomplete="tel"></label><label>Guests<select name="partySize">${sizes}</select></label><label>Date and time<input name="at" type="datetime-local" required></label><label>Anything we should know? (optional)<input name="notes" maxlength="300" placeholder="Birthday, high chair, window seat…"></label><button type="submit">Request a table</button></form>`}
</main></body></html>`;
}
