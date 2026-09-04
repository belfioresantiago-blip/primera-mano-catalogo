import { firebaseConfig, ADMIN_EMAILS } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc,
  writeBatch, getDocs, query, limit
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---------- Firebase init ----------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// ---------- State ----------
let products = {};        // id -> product
let settings = {};        // settings/site doc
let cart = {};             // id -> qty
let currentUser = null;
let isAdmin = false;
let activeCategory = "__all__";
let searchTerm = "";
let editingProductId = null; // null = new product
let pendingImages = [];       // base64 data-URLs, being edited for the current product (up to 4)
let uploadTargetId = null;    // product id used when creating a brand-new product
let pendingLogoImage = null;
let pendingCoverImage = null;

try { cart = JSON.parse(localStorage.getItem("pm_cart_v1") || "{}"); } catch (e) { cart = {}; }

let cartStep = "items"; // "items" | "form" | "summary"
let checkoutData = { nombre: "", pago: "", entrega: "", entreCalles: "", localidad: "", provincia: "", cp: "", telefono: "", dni: "", notas: "" };

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
function fmtARS(n) { return "$" + Math.round(n).toLocaleString("es-AR"); }
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.remove("show"), 2200);
}
function saveCart() {
  try { localStorage.setItem("pm_cart_v1", JSON.stringify(cart)); } catch (e) {}
}

function fileToDataUrl(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) { height = Math.round(height * maxSize / width); width = maxSize; }
        else if (height > maxSize) { width = Math.round(width * maxSize / height); height = maxSize; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Convierte una foto de producto a un data-URL base64, nítida pero acotada en
// peso para que hasta 4 fotos por producto entren en el límite de 1MB por
// documento de Firestore. Prueba tamaños/calidad decrecientes hasta que el
// resultado quede por debajo de targetBytes (por defecto ~220KB en base64,
// que para 4 fotos deja el documento en ~900KB, con margen para el resto de
// los campos).
async function processProductPhoto(file, targetBytes = 220000) {
  const steps = [
    [1280, 0.85], [1280, 0.72], [1024, 0.72], [1024, 0.6],
    [800, 0.65], [800, 0.5], [640, 0.5], [480, 0.45]
  ];
  let last = null;
  for (const [size, q] of steps) {
    const dataUrl = await fileToDataUrl(file, size, q);
    last = dataUrl;
    if (dataUrl.length <= targetBytes) return dataUrl;
  }
  return last; // ya achicado al máximo, se usa igual aunque no llegue al target
}

// ---------- Theme ----------
function applyTheme() {
  const theme = settings.theme || {};
  const root = document.documentElement.style;
  root.setProperty("--brand", theme.brand || "#1f8a4c");
  root.setProperty("--bg", theme.bg || "#f7f7f5");
  $("#page-title").textContent = settings.brand || "Primera Mano";
  $("#brand-name").textContent = settings.brand || "Primera Mano";
  $("#hero-title").textContent = settings.brand || "Primera Mano";
  $("#hero-desc").textContent = settings.description || "Catálogo de productos. Armá tu pedido y enviálo por WhatsApp.";
  $("#meta-desc").setAttribute("content", settings.description || "");
  document.title = settings.brand || "Primera Mano";
  if (settings.logo) { $("#brand-logo").src = settings.logo; $("#brand-logo").hidden = false; }
  else { $("#brand-logo").hidden = true; }
}

// ---------- Categories ----------
function categoriesFromProducts() {
  const set = new Set(Object.values(products).map(p => p.category).filter(Boolean));
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}
function renderCats() {
  const cats = categoriesFromProducts();
  const wrap = $("#cats");
  wrap.innerHTML = "";
  const allChip = document.createElement("button");
  allChip.className = "cat-chip" + (activeCategory === "__all__" ? " active" : "");
  allChip.textContent = "Todos";
  allChip.onclick = () => { activeCategory = "__all__"; renderCats(); renderGrid(); };
  wrap.appendChild(allChip);
  cats.forEach(c => {
    const chip = document.createElement("button");
    chip.className = "cat-chip" + (activeCategory === c ? " active" : "");
    chip.textContent = c;
    chip.onclick = () => { activeCategory = c; renderCats(); renderGrid(); };
    wrap.appendChild(chip);
  });
  // datalist for admin product category autocomplete
  const dl = $("#cat-list");
  dl.innerHTML = cats.map(c => `<option value="${c.replace(/"/g,'&quot;')}">`).join("");
}

// ---------- Grid ----------
function filteredProducts() {
  const term = searchTerm.trim().toLowerCase();
  return Object.values(products).filter(p => {
    if (activeCategory !== "__all__" && p.category !== activeCategory) return false;
    if (term && !(p.title || "").toLowerCase().includes(term)) return false;
    return true;
  });
}
function cardHTML(p) {
  return `
    <div class="card" data-id="${p.id}">
      <div class="thumb-wrap" data-open="1">
        <img src="${p.img}" alt="${escapeAttr(p.title)}" loading="lazy">
        ${isAdmin ? `<button class="admin-edit-mini" data-edit="${p.id}">✎</button>` : ""}
      </div>
      <div class="body">
        <span class="cat">${escapeHtml(p.category || "")}</span>
        <h3 data-open="1">${escapeHtml(p.title || "")}</h3>
        <div class="price">${fmtARS(p.price || 0)}</div>
        <div class="add-row">
          <div class="qty-stepper" data-qty>
            <button data-d="-1">−</button><span>1</span><button data-d="1">+</button>
          </div>
          <button class="add-btn" data-add>Agregar</button>
        </div>
      </div>
    </div>`;
}
function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function escapeAttr(s) { return escapeHtml(s); }

function renderGrid() {
  const list = filteredProducts();
  $("#result-count").textContent = list.length + (list.length === 1 ? " producto" : " productos");
  const grid = $("#grid");
  grid.innerHTML = list.map(cardHTML).join("");
  $("#empty-state").hidden = list.length > 0;

  $$(".card").forEach(card => {
    const id = card.dataset.id;
    const stepper = card.querySelector("[data-qty]");
    let localQty = 1;
    stepper.querySelectorAll("button").forEach(b => {
      b.onclick = () => {
        localQty = Math.max(1, localQty + parseInt(b.dataset.d, 10));
        stepper.querySelector("span").textContent = localQty;
      };
    });
    card.querySelector("[data-add]").onclick = () => {
      addToCart(id, localQty);
      localQty = 1;
      stepper.querySelector("span").textContent = 1;
    };
    card.querySelectorAll("[data-open]").forEach(el => {
      el.onclick = () => openProductModal(id);
    });
    const editBtn = card.querySelector("[data-edit]");
    if (editBtn) editBtn.onclick = (e) => { e.stopPropagation(); openEditProduct(id); };
  });
}

// ---------- Cart ----------
function cartLines() {
  return Object.entries(cart).map(([id, qty]) => ({ item: products[id], qty })).filter(l => l.item && l.qty > 0);
}
function cartCount() { return cartLines().reduce((s, l) => s + l.qty, 0); }
function cartTotal() { return cartLines().reduce((s, l) => s + l.qty * l.item.price, 0); }
function addToCart(id, qty) { cart[id] = (cart[id] || 0) + qty; saveCart(); renderCart(); }
function setQty(id, qty) { if (qty <= 0) delete cart[id]; else cart[id] = qty; saveCart(); renderCart(); }

function renderCart() {
  // floating bottom bar
  const count = cartCount();
  const fc = $("#floating-cart");
  fc.hidden = count === 0;
  $("#fc-count").textContent = count + (count === 1 ? " item" : " items");
  $("#fc-total").textContent = fmtARS(cartTotal());

  renderCartDrawer();
}

function openCartDrawer(step) {
  if (step) cartStep = step;
  $("#cart-overlay").classList.add("open");
  $("#cart-drawer").classList.add("open");
  renderCartDrawer();
}
function closeCartDrawer() {
  $("#cart-overlay").classList.remove("open");
  $("#cart-drawer").classList.remove("open");
}

function renderCartDrawer() {
  const backBtn = $("#cart-back-btn");
  const title = $("#cart-drawer-title");
  const body = $("#cart-drawer-body");
  const foot = $("#cart-drawer-foot");
  const lines = cartLines();

  if (cartStep === "items") {
    backBtn.hidden = true;
    title.textContent = "Tu pedido";
    if (lines.length === 0) {
      body.innerHTML = `<p style="color:var(--muted);font-size:.9rem;">Todavía no agregaste productos.</p>`;
    } else {
      body.innerHTML = lines.map(l => `
        <div class="cart-line" data-id="${l.item.id}">
          <img src="${l.item.img}" alt="">
          <div class="info">
            <h4>${escapeHtml(l.item.title)}</h4>
            <div class="p">${l.qty} x ${fmtARS(l.item.price)} = ${fmtARS(l.qty * l.item.price)}</div>
            <button class="remove" data-remove>Quitar</button>
          </div>
        </div>`).join("");
      body.querySelectorAll("[data-remove]").forEach(btn => {
        btn.onclick = () => setQty(btn.closest(".cart-line").dataset.id, 0);
      });
    }
    foot.innerHTML = `
      <div class="total-row"><span>Total</span><span>${fmtARS(cartTotal())}</span></div>
      <button class="wa-btn" id="cart-continue-btn" ${lines.length === 0 ? "disabled" : ""}>Continuar</button>`;
    $("#cart-continue-btn").onclick = () => {
      if (cartLines().length === 0) return;
      cartStep = "form";
      renderCartDrawer();
    };

  } else if (cartStep === "form") {
    backBtn.hidden = false;
    title.textContent = "Completá tu pedido";
    const d = checkoutData;
    body.innerHTML = `
      <div class="field">
        <label>Nombre completo *</label>
        <input type="text" id="co-nombre" value="${escapeAttr(d.nombre)}" maxlength="70">
      </div>
      <div class="field">
        <label>Forma de pago *</label>
        <div class="radio-group">
          <label class="radio-opt"><input type="radio" name="co-pago" value="efectivo" ${d.pago === "efectivo" ? "checked" : ""}> Efectivo<span class="hint">El pago se coordina por WhatsApp</span></label>
          <label class="radio-opt"><input type="radio" name="co-pago" value="transferencia" ${d.pago === "transferencia" ? "checked" : ""}> Transferencia<span class="hint">El pago se coordina por WhatsApp</span></label>
        </div>
      </div>
      <div class="field">
        <label>Método de entrega *</label>
        <div class="radio-group">
          <label class="radio-opt"><input type="radio" name="co-entrega" value="retiro" ${d.entrega === "retiro" ? "checked" : ""}> Retiro en el local</label>
          <label class="radio-opt"><input type="radio" name="co-entrega" value="domicilio" ${d.entrega === "domicilio" ? "checked" : ""}> Envío a domicilio</label>
        </div>
      </div>
      <div id="co-address-fields" ${d.entrega === "domicilio" ? "" : "hidden"}>
        <div class="field">
          <label>Dirección / entre calles *</label>
          <input type="text" id="co-calles" value="${escapeAttr(d.entreCalles)}" maxlength="70">
        </div>
        <div class="field-row">
          <div class="field">
            <label>Localidad *</label>
            <input type="text" id="co-localidad" value="${escapeAttr(d.localidad)}" maxlength="70">
          </div>
          <div class="field">
            <label>Provincia *</label>
            <input type="text" id="co-provincia" value="${escapeAttr(d.provincia)}" maxlength="70">
          </div>
        </div>
        <div class="field">
          <label>Código postal *</label>
          <input type="text" id="co-cp" value="${escapeAttr(d.cp)}" maxlength="20">
        </div>
      </div>
      <div class="field">
        <label>Teléfono *</label>
        <input type="text" id="co-telefono" value="${escapeAttr(d.telefono)}" maxlength="30">
      </div>
      <div class="field">
        <label>DNI</label>
        <input type="text" id="co-dni" value="${escapeAttr(d.dni)}" maxlength="20">
      </div>
      <div class="field">
        <label>¿Algo más que quieras agregar?</label>
        <textarea id="co-notas" maxlength="200">${escapeHtml(d.notas)}</textarea>
      </div>`;
    $$('input[name="co-entrega"]').forEach(r => {
      r.onchange = () => { $("#co-address-fields").hidden = $('input[name="co-entrega"]:checked').value !== "domicilio"; };
    });
    foot.innerHTML = `<button class="wa-btn" id="checkout-continue-btn">Ver resumen</button>`;
    $("#checkout-continue-btn").onclick = () => {
      d.nombre = $("#co-nombre").value.trim();
      const pagoEl = $('input[name="co-pago"]:checked');
      const entregaEl = $('input[name="co-entrega"]:checked');
      d.pago = pagoEl ? pagoEl.value : "";
      d.entrega = entregaEl ? entregaEl.value : "";
      d.entreCalles = $("#co-calles").value.trim();
      d.localidad = $("#co-localidad").value.trim();
      d.provincia = $("#co-provincia").value.trim();
      d.cp = $("#co-cp").value.trim();
      d.telefono = $("#co-telefono").value.trim();
      d.dni = $("#co-dni").value.trim();
      d.notas = $("#co-notas").value.trim();

      if (!d.nombre) return toast("Falta tu nombre completo");
      if (!d.pago) return toast("Elegí una forma de pago");
      if (!d.entrega) return toast("Elegí un método de entrega");
      if (d.entrega === "domicilio" && (!d.entreCalles || !d.localidad || !d.provincia || !d.cp)) return toast("Completá los datos de envío");
      if (!d.telefono) return toast("Falta tu teléfono");

      cartStep = "summary";
      renderCartDrawer();
    };

  } else if (cartStep === "summary") {
    backBtn.hidden = false;
    title.textContent = "Detalle de tu compra";
    body.innerHTML = `
      <div class="summary-status"><span>Estado del pago</span><span class="pill warn">Pendiente</span></div>
      ${lines.map(l => `
        <div class="summary-line">
          <span class="qty">${l.qty}</span>
          <div class="info"><div class="t">${escapeHtml(l.item.title)}</div><div class="c">${escapeHtml(l.item.category || "")}</div></div>
          <div class="amt">${fmtARS(l.item.price * l.qty)}</div>
        </div>`).join("")}
      <div class="summary-buyer">
        <div><b>${escapeHtml(checkoutData.nombre)}</b> · ${checkoutData.telefono}</div>
        <div>${checkoutData.pago === "efectivo" ? "Efectivo" : "Transferencia"} · ${checkoutData.entrega === "retiro" ? "Retiro en el local" : "Envío a domicilio"}</div>
        ${checkoutData.entrega === "domicilio" ? `<div>${escapeHtml(checkoutData.entreCalles)}, ${escapeHtml(checkoutData.localidad)}, ${escapeHtml(checkoutData.provincia)} (${escapeHtml(checkoutData.cp)})</div>` : ""}
      </div>`;
    foot.innerHTML = `
      <div class="total-row"><span>Total estimado</span><span>${fmtARS(cartTotal())}</span></div>
      <a id="wa-btn" class="wa-btn" href="${waOrderLink()}" target="_blank" rel="noopener">Completar pedido en WhatsApp</a>`;
    $("#wa-btn").onclick = () => {
      setTimeout(() => {
        cart = {};
        saveCart();
        cartStep = "items";
        checkoutData = { nombre: "", pago: "", entrega: "", entreCalles: "", localidad: "", provincia: "", cp: "", telefono: "", dni: "", notas: "" };
        renderCart();
        closeCartDrawer();
        toast("¡Pedido enviado!");
      }, 300);
    };
  }
}

$("#cart-back-btn").onclick = () => {
  cartStep = cartStep === "summary" ? "form" : "items";
  renderCartDrawer();
};

function waOrderLink() {
  const number = (settings.whatsapp || "").replace(/\D/g, "");
  const lines = cartLines();
  if (!number) return "#";
  const d = checkoutData;
  let msg = `Hola! Quiero hacer este pedido de ${settings.brand || "Primera Mano"}:\n\n`;
  lines.forEach(l => { msg += `• ${l.item.title} x${l.qty} — ${fmtARS(l.item.price * l.qty)}\n`; });
  msg += `\nTotal: ${fmtARS(cartTotal())}\n\n`;
  msg += `Nombre: ${d.nombre}\n`;
  msg += `Forma de pago: ${d.pago === "efectivo" ? "Efectivo" : "Transferencia"}\n`;
  msg += `Entrega: ${d.entrega === "retiro" ? "Retiro en el local" : "Envío a domicilio"}\n`;
  if (d.entrega === "domicilio") {
    msg += `Dirección: ${d.entreCalles}, ${d.localidad}, ${d.provincia} (CP ${d.cp})\n`;
  }
  msg += `Teléfono: ${d.telefono}\n`;
  if (d.dni) msg += `DNI: ${d.dni}\n`;
  if (d.notas) msg += `Nota: ${d.notas}\n`;
  msg += `\n¿Está todo disponible?`;
  return `https://wa.me/${number}?text=${encodeURIComponent(msg)}`;
}

// ---------- Product modal (public detail view) ----------
let modalQty = 1;
function openProductModal(id) {
  const p = products[id];
  if (!p) return;
  modalQty = 1;
  const imgs = (p.images && p.images.length ? p.images : [p.imgHi || p.img]).filter(Boolean);
  $("#pmodal-img").src = imgs[0] || "";
  const thumbs = $("#pmodal-thumbs");
  if (imgs.length > 1) {
    thumbs.hidden = false;
    thumbs.innerHTML = imgs.map((u, i) => `<img src="${u}" class="${i === 0 ? "active" : ""}" data-i="${i}">`).join("");
    thumbs.querySelectorAll("img").forEach(t => {
      t.onclick = () => {
        $("#pmodal-img").src = t.src;
        thumbs.querySelectorAll("img").forEach(x => x.classList.remove("active"));
        t.classList.add("active");
      };
    });
  } else {
    thumbs.hidden = true;
    thumbs.innerHTML = "";
  }
  $("#pmodal-cat").textContent = p.category || "";
  $("#pmodal-title").textContent = p.title || "";
  $("#pmodal-price").textContent = fmtARS(p.price || 0);
  $("#pmodal-desc").textContent = p.description || "";
  $("#pmodal-qty span").textContent = "1";
  $("#pmodal-overlay").classList.add("open");
  $("#pmodal-overlay").dataset.id = id;
}
function closeProductModal() { $("#pmodal-overlay").classList.remove("open"); }

// ================================================================
// AUTH
// ================================================================
function renderAuthSlot() {
  const slot = $("#auth-slot");
  if (!currentUser) {
    slot.innerHTML = `<button class="google-btn" id="google-signin">
      <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4c-7.4 0-13.8 4.2-17 10.3.1-.1 -.1-.1 0-.1z"/><path fill="#4CAF50" d="M24 44c5.5 0 10.4-2.1 14.1-5.6l-6.5-5.5C29.6 34.6 26.9 35.5 24 35.5c-5.3 0-9.7-3.4-11.3-8.1l-6.6 5.1C9.9 39.6 16.4 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.6l6.5 5.5C40.5 36.6 44 30.9 44 24c0-1.3-.1-2.7-.4-3.5z"/></svg>
      Ingresar
    </button>`;
    $("#google-signin").onclick = () => signInWithPopup(auth, provider).catch(e => toast("No se pudo iniciar sesión"));
  } else if (!isAdmin) {
    slot.innerHTML = `<img class="avatar" src="${currentUser.photoURL || ""}" title="${currentUser.email}">`;
  } else {
    slot.innerHTML = `
      <button class="admin-toggle off" id="admin-toggle-btn">✎ Editar catálogo</button>
      <img class="avatar" src="${currentUser.photoURL || ""}" title="${currentUser.email}">`;
    $("#admin-toggle-btn").onclick = openAdminDrawer;
  }
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  isAdmin = !!(user && user.email && ADMIN_EMAILS.includes(user.email));
  renderAuthSlot();
  renderGrid(); // toggles the little edit pencil on cards
});

// ================================================================
// FIRESTORE — live data
// ================================================================
onSnapshot(collection(db, "products"), (snap) => {
  const next = {};
  snap.forEach(d => { next[d.id] = { id: d.id, ...d.data() }; });
  products = next;
  renderCats();
  renderGrid();
  renderCart();
  refreshAdminProductList();
  maybeShowSeedBanner();
}, (err) => { console.error(err); });

onSnapshot(doc(db, "settings", "site"), (snap) => {
  settings = snap.exists() ? snap.data() : {};
  applyTheme();
  renderCart();
  fillConfigForm();
});

// ================================================================
// ADMIN — drawer, tabs
// ================================================================
function openAdminDrawer() {
  $("#admin-overlay").classList.add("open");
  $("#admin-drawer").classList.add("open");
  refreshAdminProductList();
  maybeShowSeedBanner();
}
function closeAdminDrawer() {
  $("#admin-overlay").classList.remove("open");
  $("#admin-drawer").classList.remove("open");
}
$("#admin-close").onclick = closeAdminDrawer;
$("#admin-overlay").onclick = closeAdminDrawer;

$$(".admin-tab").forEach(tab => {
  tab.onclick = () => {
    $$(".admin-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    $("#tab-productos").hidden = tab.dataset.tab !== "productos";
    $("#tab-diseno").hidden = tab.dataset.tab !== "diseno";
  };
});

// ---------- Seed (first run only) ----------
async function maybeShowSeedBanner() {
  if (!isAdmin) return;
  const banner = $("#seed-banner");
  if (Object.keys(products).length > 0) { banner.hidden = true; return; }
  banner.hidden = false;
}
$("#seed-btn").onclick = async () => {
  $("#seed-btn").disabled = true;
  $("#seed-progress").textContent = "Descargando catálogo inicial...";
  try {
    const res = await fetch("products_seed.json");
    const items = await res.json();
    $("#seed-progress").textContent = `Importando ${items.length} productos...`;
    const chunkSize = 450;
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      chunk.forEach(p => {
        const ref = doc(db, "products", p.id);
        batch.set(ref, {
          title: p.title, category: p.category, price: p.price,
          description: p.description || "", img: p.img, imgHi: p.imgHi || p.img
        });
      });
      await batch.commit();
      $("#seed-progress").textContent = `Importado ${Math.min(i + chunkSize, items.length)} de ${items.length}...`;
    }
    if (!settings || !settings.brand) {
      await setDoc(doc(db, "settings", "site"), {
        brand: "Primera Mano",
        description: "Catálogo de productos. Armá tu pedido y enviálo por WhatsApp.",
        whatsapp: "541159436724",
        logo: null, cover: null,
        theme: { brand: "#1f8a4c", bg: "#f7f7f5" }
      }, { merge: true });
    }
    $("#seed-progress").textContent = "¡Listo! Catálogo importado.";
    toast("Catálogo importado con éxito");
  } catch (e) {
    console.error(e);
    $("#seed-progress").textContent = "Hubo un error importando. Probá de nuevo.";
    $("#seed-btn").disabled = false;
  }
};

// ---------- Admin product list ----------
let adminSearchTerm = "";
$("#admin-search").oninput = (e) => { adminSearchTerm = e.target.value; refreshAdminProductList(); };
function refreshAdminProductList() {
  if (!$("#admin-drawer").classList.contains("open")) return;
  const term = adminSearchTerm.trim().toLowerCase();
  const list = Object.values(products)
    .filter(p => !term || (p.title || "").toLowerCase().includes(term))
    .sort((a, b) => (a.title || "").localeCompare(b.title || "", "es"));
  const wrap = $("#admin-product-list");
  wrap.innerHTML = list.map(p => `
    <div class="admin-product-row" data-id="${p.id}">
      <img src="${p.img}" alt="">
      <div class="apr-info">
        <div class="t">${escapeHtml(p.title)}</div>
        <div class="p">${escapeHtml(p.category || "")} · ${fmtARS(p.price || 0)}</div>
      </div>
      <div class="apr-actions">
        <button data-edit title="Editar">✎</button>
        <button data-del title="Eliminar">🗑</button>
      </div>
    </div>`).join("") || `<p style="color:var(--muted);font-size:.85rem;">Sin productos.</p>`;
  wrap.querySelectorAll("[data-edit]").forEach(btn => {
    btn.onclick = () => openEditProduct(btn.closest(".admin-product-row").dataset.id);
  });
  wrap.querySelectorAll("[data-del]").forEach(btn => {
    btn.onclick = () => deleteProduct(btn.closest(".admin-product-row").dataset.id);
  });
}

async function deleteProduct(id) {
  if (!confirm("¿Eliminar este producto del catálogo?")) return;
  try { await deleteDoc(doc(db, "products", id)); toast("Producto eliminado"); }
  catch (e) { console.error(e); toast("No se pudo eliminar"); }
}

// ---------- New / edit product modal ----------
$("#new-product-btn").onclick = () => openEditProduct(null);
function openEditProduct(id) {
  editingProductId = id;
  const p = id ? products[id] : null;
  pendingImages = p ? (p.images && p.images.length ? [...p.images] : (p.img ? [p.img] : [])) : [];
  uploadTargetId = id || ("p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  $("#edit-title").textContent = id ? "Editar producto" : "Nuevo producto";
  $("#p-title").value = p ? p.title : "";
  $("#p-category").value = p ? p.category : "";
  $("#p-price").value = p ? p.price : "";
  $("#p-desc").value = p ? (p.description || "") : "";
  renderPhotoStrip();
  $("#p-delete").hidden = !id;
  $("#edit-overlay").classList.add("open");
}
$("#edit-close").onclick = () => $("#edit-overlay").classList.remove("open");
$("#edit-overlay").addEventListener("click", (e) => { if (e.target.id === "edit-overlay") $("#edit-overlay").classList.remove("open"); });

function renderPhotoStrip() {
  const wrap = $("#photo-strip");
  wrap.innerHTML = pendingImages.map((url, i) => `
    <div class="ph"><img src="${url}"><button type="button" data-rm="${i}">✕</button></div>`).join("");
  wrap.querySelectorAll("[data-rm]").forEach(btn => {
    btn.onclick = () => { pendingImages.splice(parseInt(btn.dataset.rm, 10), 1); renderPhotoStrip(); };
  });
  const drop = $("#drop-product");
  drop.textContent = pendingImages.length >= 4 ? "Máximo 4 fotos" : `Click para subir fotos (hasta 4) — ${pendingImages.length}/4`;
}

$("#drop-product").onclick = () => { if (pendingImages.length < 4) $("#file-product").click(); };
$("#file-product").onchange = async (e) => {
  const files = Array.from(e.target.files).slice(0, Math.max(0, 4 - pendingImages.length));
  e.target.value = "";
  if (!files.length) return;
  toast("Procesando fotos...");
  for (const file of files) {
    try {
      const dataUrl = await processProductPhoto(file);
      pendingImages.push(dataUrl);
      renderPhotoStrip();
    } catch (err) { console.error(err); toast("Error procesando una foto"); }
  }
  toast("Fotos listas");
};

$("#p-save").onclick = async () => {
  const title = $("#p-title").value.trim();
  const category = $("#p-category").value.trim();
  const price = parseFloat($("#p-price").value) || 0;
  const description = $("#p-desc").value.trim();
  if (!title) { toast("Ponele un nombre al producto"); return; }
  if (pendingImages.length === 0) { toast("Subí al menos una foto"); return; }
  const body = {
    title, category, price, description,
    images: pendingImages, img: pendingImages[0], imgHi: pendingImages[0]
  };
  try {
    if (editingProductId) {
      await updateDoc(doc(db, "products", editingProductId), body);
      toast("Producto actualizado");
    } else {
      await setDoc(doc(db, "products", uploadTargetId), body);
      toast("Producto agregado");
    }
    $("#edit-overlay").classList.remove("open");
  } catch (e) { console.error(e); toast("No se pudo guardar"); }
};
$("#p-delete").onclick = async () => {
  if (!editingProductId) return;
  await deleteProduct(editingProductId);
  $("#edit-overlay").classList.remove("open");
};

// ---------- Config (Diseño y datos) tab ----------
function fillConfigForm() {
  $("#cfg-brand").value = settings.brand || "";
  $("#cfg-desc").value = settings.description || "";
  $("#cfg-whatsapp").value = settings.whatsapp || "";
  const theme = settings.theme || {};
  $("#cfg-color-brand").value = theme.brand || "#1f8a4c";
  $("#cfg-color-brand-hex").textContent = theme.brand || "#1f8a4c";
  $("#cfg-color-bg").value = theme.bg || "#f7f7f5";
  $("#cfg-color-bg-hex").textContent = theme.bg || "#f7f7f5";
  if (settings.logo) { $("#preview-logo").src = settings.logo; $("#preview-logo").hidden = false; }
  if (settings.cover) { $("#preview-cover").src = settings.cover; $("#preview-cover").hidden = false; }
}
$("#cfg-color-brand").oninput = (e) => { $("#cfg-color-brand-hex").textContent = e.target.value; };
$("#cfg-color-bg").oninput = (e) => { $("#cfg-color-bg-hex").textContent = e.target.value; };

$("#drop-logo").onclick = () => $("#file-logo").click();
$("#file-logo").onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  const dataUrl = await fileToDataUrl(file, 300, 0.85);
  pendingLogoImage = dataUrl;
  $("#preview-logo").src = dataUrl; $("#preview-logo").hidden = false;
};
$("#drop-cover").onclick = () => $("#file-cover").click();
$("#file-cover").onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  const dataUrl = await fileToDataUrl(file, 1200, 0.8);
  pendingCoverImage = dataUrl;
  $("#preview-cover").src = dataUrl; $("#preview-cover").hidden = false;
};

$("#save-config-btn").onclick = async () => {
  const body = {
    brand: $("#cfg-brand").value.trim() || "Primera Mano",
    description: $("#cfg-desc").value.trim(),
    whatsapp: $("#cfg-whatsapp").value.replace(/\D/g, ""),
    theme: { brand: $("#cfg-color-brand").value, bg: $("#cfg-color-bg").value },
    updatedAt: Date.now()
  };
  if (pendingLogoImage) body.logo = pendingLogoImage;
  if (pendingCoverImage) body.cover = pendingCoverImage;
  try {
    await setDoc(doc(db, "settings", "site"), body, { merge: true });
    toast("Cambios guardados");
  } catch (e) { console.error(e); toast("No se pudo guardar"); }
};

// ================================================================
// WIRING — search, cart drawer, product modal, cart badge
// ================================================================
$("#search-input").oninput = (e) => { searchTerm = e.target.value; renderGrid(); };

$("#floating-cart-btn").onclick = () => openCartDrawer("items");
$("#cart-close").onclick = closeCartDrawer;
$("#cart-overlay").onclick = closeCartDrawer;

$("#pmodal-close").onclick = closeProductModal;
$("#pmodal-overlay").addEventListener("click", (e) => { if (e.target.id === "pmodal-overlay") closeProductModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeProductModal(); } });
$("#pmodal-qty").querySelectorAll("button").forEach(b => {
  b.onclick = () => {
    modalQty = Math.max(1, modalQty + parseInt(b.dataset.d, 10));
    $("#pmodal-qty span").textContent = modalQty;
  };
});
$("#pmodal-add").onclick = () => {
  const id = $("#pmodal-overlay").dataset.id;
  if (!id) return;
  addToCart(id, modalQty);
  closeProductModal();
  toast("Agregado al pedido");
};

// initial paint (before first snapshot arrives)
renderCart();
