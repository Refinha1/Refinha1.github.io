// =====================================================================
// 1) CONFIGURAÇÃO
// =====================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Cole aqui o objeto "firebaseConfig" do console do Firebase.

// Estes valores NÃO são segredos: quem protege os dados são as Security Rules.
const firebaseConfig = {
  apiKey: "AIzaSyD7396GnE9pVule0uYPb6XObIs3yrBTVDg",
  authDomain: "casa-nova-refinha.firebaseapp.com",
  projectId: "casa-nova-refinha",
  storageBucket: "casa-nova-refinha.firebasestorage.app",
  messagingSenderId: "48902111617",
  appId: "1:48902111617:web:8d642eda94297134e3a880",
};

const VALOR_COTA = 10; // R$ por cota (as regras do Firestore também assumem 10)
const PIX = {
  qrImagem: "qrcode-pix.png", // imagem do QR Code PIX da sua conta
  copiaECola: "",             // opcional: cole aqui o código "copia e cola"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// =====================================================================
// 2) ESTADO E UTILITÁRIOS
// =====================================================================
let presentes = [];      // docs de "presentes"
let contribuicoes = [];  // docs de "contribuicoes"
let presenteAtual = null; // presente aberto no modal

const $ = (id) => document.getElementById(id);
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Evita injeção de HTML vindo de nomes/mensagens digitados pelos convidados
const esc = (texto) =>
  String(texto ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Soma de cotas já doadas por presente: { presenteId: total } */
function totaisPorPresente() {
  const totais = {};
  for (const c of contribuicoes) {
    totais[c.presenteId] = (totais[c.presenteId] || 0) + c.cotas;
  }
  return totais;
}

// =====================================================================
// 3) LEITURA EM TEMPO REAL
// =====================================================================
onSnapshot(
  collection(db, "presentes"),
  (snap) => {
    presentes = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    renderCatalogo();
  },
  (erro) => {
    console.error(erro);
    $("estado-catalogo").textContent = "Não foi possível carregar os presentes.";
  }
);

onSnapshot(
  collection(db, "contribuicoes"),
  (snap) => {
    contribuicoes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCatalogo(); // atualiza barras de progresso
    renderRanking();
  },
  (erro) => console.error(erro)
);

// =====================================================================
// 4) RENDERIZAÇÃO
// =====================================================================
function renderCatalogo() {
  const grid = $("lista-presentes");
  const totais = totaisPorPresente();

  $("estado-catalogo").classList.toggle("hidden", presentes.length > 0);
  if (presentes.length === 0) $("estado-catalogo").textContent = "Nenhum presente cadastrado ainda.";

  grid.innerHTML = presentes.map((p) => {
    const doadas = totais[p.id] || 0;
    const pct = Math.min(100, Math.round((doadas / p.metaCotas) * 100));
    const completo = doadas >= p.metaCotas;

    return `
      <article class="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-200">
        <img src="${esc(p.imagem)}" alt="${esc(p.nome)}" loading="lazy"
             class="h-48 w-full object-cover bg-stone-100" />
        <div class="flex flex-1 flex-col gap-3 p-4">
          <h3 class="text-lg font-semibold">${esc(p.nome)}</h3>

          <div>
            <div class="h-3 w-full overflow-hidden rounded-full bg-stone-200">
              <div class="h-full rounded-full bg-gradient-to-r from-rose-500 to-amber-400 transition-all duration-700"
                   style="width:${pct}%"></div>
            </div>
            <p class="mt-1 text-sm text-stone-500">
              ${doadas} de ${p.metaCotas} cotas (${pct}%) · ${brl.format(p.metaCotas * VALOR_COTA)}
            </p>
          </div>

          <button data-presente="${esc(p.id)}" ${completo ? "disabled" : ""}
                  class="mt-auto h-11 rounded-lg bg-rose-500 font-medium text-white hover:bg-rose-600
                         disabled:cursor-not-allowed disabled:bg-stone-300">
            ${completo ? "Meta atingida 🎉" : "Contribuir"}
          </button>
        </div>
      </article>`;
  }).join("");
}

function renderRanking() {
  const lista = $("lista-ranking");
  $("estado-ranking").classList.toggle("hidden", contribuicoes.length > 0);

  const nomePresente = Object.fromEntries(presentes.map((p) => [p.id, p.nome]));
  const medalhas = ["🥇", "🥈", "🥉"];

  // Mais cotas primeiro; empate: quem contribuiu antes aparece antes
  const ordenadas = [...contribuicoes].sort((a, b) =>
    b.cotas - a.cotas || (a.criadoEm?.seconds ?? 0) - (b.criadoEm?.seconds ?? 0));

  lista.innerHTML = ordenadas.map((c, i) => `
    <li class="flex gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
      <div class="w-8 text-center text-xl">${medalhas[i] ?? i + 1}</div>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-baseline justify-between gap-x-3">
          <p class="font-semibold">${esc(c.nome)}</p>
          <p class="text-sm font-medium text-rose-600">${c.cotas} ${c.cotas === 1 ? "cota" : "cotas"}</p>
        </div>
        ${c.mensagem ? `<p class="mt-1 break-words text-stone-600">“${esc(c.mensagem)}”</p>` : ""}
        <p class="mt-1 text-xs text-stone-400">${esc(nomePresente[c.presenteId] ?? "")}</p>
      </div>
    </li>`).join("");
}

// =====================================================================
// 5) MODAL E FORMULÁRIO
// =====================================================================
const campoCotas = $("campo-cotas");

function cotasRestantes(p) {
  return Math.max(0, p.metaCotas - (totaisPorPresente()[p.id] || 0));
}

function atualizarTotal() {
  const max = cotasRestantes(presenteAtual);
  let n = parseInt(campoCotas.value, 10);
  if (!Number.isInteger(n) || n < 1) n = 1;
  if (n > max) n = max;
  campoCotas.value = n;
  $("total-valor").textContent = brl.format(n * VALOR_COTA);
}

function abrirModal(presenteId) {
  presenteAtual = presentes.find((p) => p.id === presenteId);
  if (!presenteAtual) return;

  $("modal-item").textContent = presenteAtual.nome;
  $("modal-restantes").textContent = `Faltam ${cotasRestantes(presenteAtual)} cotas`;
  $("passo-form").reset();
  campoCotas.value = 1;
  atualizarTotal();
  $("erro-form").classList.add("hidden");
  $("passo-form").classList.remove("hidden");
  $("passo-pix").classList.add("hidden");

  $("modal").classList.remove("hidden");
  $("modal").classList.add("flex");
  document.body.classList.add("overflow-hidden");
}

function fecharModal() {
  $("modal").classList.add("hidden");
  $("modal").classList.remove("flex");
  document.body.classList.remove("overflow-hidden");
  presenteAtual = null;
}

// Abre o modal ao clicar em "Contribuir" (delegação de eventos)
$("lista-presentes").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-presente]");
  if (btn) abrirModal(btn.dataset.presente);
});

// Fecha: botões, clique no fundo escuro ou tecla Esc
document.querySelectorAll("[data-fechar]").forEach((b) => b.addEventListener("click", fecharModal));
$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) fecharModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharModal(); });

// Controles de quantidade
$("menos").addEventListener("click", () => { campoCotas.value = (parseInt(campoCotas.value, 10) || 1) - 1; atualizarTotal(); });
$("mais").addEventListener("click",  () => { campoCotas.value = (parseInt(campoCotas.value, 10) || 0) + 1; atualizarTotal(); });
campoCotas.addEventListener("input", atualizarTotal);

// Envio: salva no Firestore e mostra o PIX
$("passo-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const erro = $("erro-form");
  const btn = $("btn-confirmar");

  const nome = $("campo-nome").value.trim();
  const mensagem = $("campo-mensagem").value.trim();
  const cotas = parseInt(campoCotas.value, 10);

  if (!nome) {
    erro.textContent = "Informe seu nome.";
    erro.classList.remove("hidden");
    return;
  }
  if (!Number.isInteger(cotas) || cotas < 1) {
    erro.textContent = "Escolha ao menos 1 cota.";
    erro.classList.remove("hidden");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Salvando…";
  erro.classList.add("hidden");

  try {
    const valor = cotas * VALOR_COTA;
    await addDoc(collection(db, "contribuicoes"), {
      presenteId: presenteAtual.id,
      nome,
      mensagem,
      cotas,
      valor,
      criadoEm: serverTimestamp(),
    });

    // Passo 2: exibe PIX
    $("pix-valor").textContent = brl.format(valor);
    $("pix-qr").src = PIX.qrImagem;
    $("pix-copia-bloco").classList.toggle("hidden", !PIX.copiaECola);
    $("passo-form").classList.add("hidden");
    $("passo-pix").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    erro.textContent = "Não foi possível salvar. Tente novamente.";
    erro.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirmar e ver PIX";
  }
});

// Copia e cola
$("btn-copiar").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(PIX.copiaECola);
    $("btn-copiar").textContent = "Código copiado ✔";
  } catch {
    $("btn-copiar").textContent = "Não foi possível copiar";
  }
});
