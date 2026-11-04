// =====================================================================
// 1) CONFIGURAÇÃO
// =====================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, query, where, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getFunctions, httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

// Cole aqui o seu "firebaseConfig" (não são segredos: as Security Rules protegem os dados)
const firebaseConfig = {
  apiKey: "AIzaSyD7396GnE9pVule0uYPb6XObIs3yrBTVDg",
  authDomain: "casa-nova-refinha.firebaseapp.com",
  projectId: "casa-nova-refinha",
  storageBucket: "casa-nova-refinha.firebasestorage.app",
  messagingSenderId: "48902111617",
  appId: "1:48902111617:web:8d642eda94297134e3a880"
};

// ---------------------------------------------------------------------
// PERSONALIZE AQUI: textos e foto do topo da página
// ---------------------------------------------------------------------
const SITE = {
  rotulo: "Chá de casa nova ",                 // frase pequena acima do título
  titulo: "Nossa Primeira casa",                      // título grande
  subtitulo: "Escolha um presente, contribua com quantas cotas quiser e deixe uma mensagem de carinho.",
  fotoTopo: "fotos/casa.jpg",                     // foto do topo (suba em /fotos no GitHub)
  posicaoFoto: "center",                          // enquadramento: "center", "top", "center 30%"...
  rodape: "powered by Rafael Bonitão  ",
};

const VALOR_COTA = 20; // R$ por cota (só para exibição; o servidor recalcula o valor)

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
// A região precisa ser a mesma das Cloud Functions
const functions = getFunctions(app, "southamerica-east1");
const criarContribuicao = httpsCallable(functions, "criarContribuicao");

// =====================================================================
// 2) ESTADO E UTILITÁRIOS
// =====================================================================
let presentes = [];       // docs de "presentes"
let contribuicoes = [];   // somente contribuições CONFIRMADAS (as regras só liberam essas)
let presenteAtual = null; // presente aberto no modal
let copiaECola = "";      // código PIX copia e cola da contribuição atual
let pararEspera = null;   // função que cancela a escuta da confirmação

const $ = (id) => document.getElementById(id);
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Evita injeção de HTML vindo de nomes/mensagens digitados pelos convidados
const esc = (texto) =>
  String(texto ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Soma de cotas confirmadas por presente: { presenteId: total } */
function totaisPorPresente() {
  const totais = {};
  for (const c of contribuicoes) {
    totais[c.presenteId] = (totais[c.presenteId] || 0) + c.cotas;
  }
  return totais;
}

// =====================================================================
// 3) TOPO DA PÁGINA (textos e foto)
// =====================================================================
function aplicarSite() {
  document.title = SITE.titulo;
  $("hero-rotulo").textContent = SITE.rotulo;
  $("hero-titulo").textContent = SITE.titulo;
  $("hero-subtitulo").textContent = SITE.subtitulo;
  $("rodape").textContent = SITE.rodape;

  const foto = $("foto-topo");
  // Se a foto não existir, esconde a imagem e o escurecimento: fica o degradê rosa/amarelo
  foto.onerror = () => {
    foto.classList.add("hidden");
    $("foto-overlay").classList.add("hidden");
  };
  foto.style.objectPosition = SITE.posicaoFoto;
  foto.src = SITE.fotoTopo;
}
aplicarSite();

// =====================================================================
// 4) LEITURA EM TEMPO REAL
// =====================================================================
onSnapshot(
  collection(db, "presentes"),
  (snap) => {
    presentes = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    renderCatalogo();
    renderRanking();
  },
  (erro) => {
    console.error(erro);
    $("estado-catalogo").textContent = "Não foi possível carregar os presentes.";
  }
);

// IMPORTANTE: o filtro por status é obrigatório, senão as regras bloqueiam a consulta
onSnapshot(
  query(collection(db, "contribuicoes"), where("status", "==", "confirmado")),
  (snap) => {
    contribuicoes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCatalogo(); // atualiza barras de progresso
    renderRanking();
  },
  (erro) => console.error(erro)
);

// =====================================================================
// 5) RENDERIZAÇÃO
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
      <article class="flex w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white text-center shadow-md ring-1 ring-stone-200 sm:w-80">
        <img src="${esc(p.imagem)}" alt="${esc(p.nome)}" loading="lazy"
             class="h-56 w-full bg-stone-100 object-cover" />
        <div class="flex flex-1 flex-col gap-3 p-5">
          <h3 class="text-xl font-semibold">${esc(p.nome)}</h3>

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

// Estilos do pódio (1º, 2º e 3º) e dos demais
const ESTILO_TOP = [
  "p-5 sm:p-6 ring-2 ring-amber-400 bg-gradient-to-br from-amber-50 to-white shadow-lg",
  "p-5 ring-2 ring-slate-300 bg-white shadow-md",
  "p-5 ring-2 ring-orange-300 bg-white shadow-md",
];
const ESTILO_NORMAL = "p-4 ring-1 ring-stone-200 bg-white shadow-sm";

function renderRanking() {
  const lista = $("lista-ranking");
  $("estado-ranking").classList.toggle("hidden", contribuicoes.length > 0);

  // Resumo no topo do mural
  const totalCotas = contribuicoes.reduce((soma, c) => soma + c.cotas, 0);
  const n = contribuicoes.length;
  $("resumo-mural").textContent = n === 0
    ? "Cada mensagem de vocês vai ficar guardada aqui."
    : `${totalCotas} ${totalCotas === 1 ? "cota" : "cotas"} de carinho · ${n} ${n === 1 ? "convidado" : "convidados"}`;

  const nomePresente = Object.fromEntries(presentes.map((p) => [p.id, p.nome]));
  const medalhas = ["🥇", "🥈", "🥉"];

  // Mais cotas primeiro; empate: quem contribuiu antes aparece antes
  const ordenadas = [...contribuicoes].sort((a, b) =>
    b.cotas - a.cotas || (a.criadoEm?.seconds ?? 0) - (b.criadoEm?.seconds ?? 0));

  lista.innerHTML = ordenadas.map((c, i) => {
    const top = i < 3;
    return `
    <li class="flex gap-4 rounded-2xl ${top ? ESTILO_TOP[i] : ESTILO_NORMAL}">
      <div class="${top ? "w-10 text-3xl" : "w-8 text-xl"} shrink-0 text-center">${medalhas[i] ?? i + 1}</div>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-baseline justify-between gap-x-3">
          <p class="${top ? "text-lg" : ""} font-semibold">${esc(c.nome)}</p>
          <p class="text-sm font-semibold text-rose-600">${c.cotas} ${c.cotas === 1 ? "cota" : "cotas"}</p>
        </div>
        ${c.mensagem
          ? `<p class="mt-2 break-words ${top ? "text-lg italic" : ""} text-stone-600">“${esc(c.mensagem)}”</p>`
          : ""}
        <p class="mt-2 text-xs text-stone-400">${esc(nomePresente[c.presenteId] ?? "")}</p>
      </div>
    </li>`;
  }).join("");
}

// =====================================================================
// 6) MODAL E FORMULÁRIO
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

function encerrarEspera() {
  if (pararEspera) { pararEspera(); pararEspera = null; }
}

function abrirModal(presenteId) {
  presenteAtual = presentes.find((p) => p.id === presenteId);
  if (!presenteAtual) return;

  encerrarEspera();
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
  encerrarEspera();
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
$("menos").addEventListener("click", () => { campoCotas.value = (parseInt(campoCotas.value, 20) || 1) - 1; atualizarTotal(); });
$("mais").addEventListener("click",  () => { campoCotas.value = (parseInt(campoCotas.value, 20) || 0) + 1; atualizarTotal(); });
campoCotas.addEventListener("input", atualizarTotal);

/** Mostra o QR Code e passa a escutar o documento até ele virar "confirmado". */
function mostrarPix({ contribuicaoId, valor, copiaECola: codigo, qrCodeBase64 }) {
  copiaECola = codigo;
  $("pix-valor").textContent = brl.format(valor);
  $("pix-qr").src = `data:image/png;base64,${qrCodeBase64}`;
  $("btn-copiar").textContent = "Copiar código PIX (copia e cola)";

  $("pix-aguardando").classList.remove("hidden");
  $("pix-confirmado").classList.add("hidden");
  $("passo-form").classList.add("hidden");
  $("passo-pix").classList.remove("hidden");

  // O webhook do backend altera o status → a tela reage em tempo real
  encerrarEspera();
  pararEspera = onSnapshot(doc(db, "contribuicoes", contribuicaoId), (snap) => {
    if (snap.data()?.status === "confirmado") {
      $("pix-aguardando").classList.add("hidden");
      $("pix-confirmado").classList.remove("hidden");
      encerrarEspera();
    }
  });
}

// Envio: o backend valida, grava como "pendente" e devolve o PIX
$("passo-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const erro = $("erro-form");
  const btn = $("btn-confirmar");

  const nome = $("campo-nome").value.trim();
  const mensagem = $("campo-mensagem").value.trim();
  const cotas = parseInt(campoCotas.value, 20);

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
  btn.textContent = "Gerando PIX…";
  erro.classList.add("hidden");

  try {
    const { data } = await criarContribuicao({
      presenteId: presenteAtual.id,
      nome,
      mensagem,
      cotas,
    });
    mostrarPix(data);
  } catch (err) {
    console.error(err);
    // Mensagens "esperadas" do backend são amigáveis; o resto vira texto genérico
    const amigaveis = ["functions/invalid-argument", "functions/failed-precondition", "functions/not-found"];
    erro.textContent = amigaveis.includes(err.code)
      ? err.message
      : "Não foi possível gerar o PIX. Tente novamente.";
    erro.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Gerar PIX";
  }
});

// Copia e cola
$("btn-copiar").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(copiaECola);
    $("btn-copiar").textContent = "Código copiado ✔";
  } catch {
    $("btn-copiar").textContent = "Não foi possível copiar";
  }
});
// =====================================================================
// 7) CONFIRMAÇÃO DE PRESENÇA
// =====================================================================
const confirmarPresenca = httpsCallable(functions, "confirmarPresenca");

const campoDoc = $("presenca-doc");
const tipoDoc = () => document.querySelector('input[name="presenca-tipo"]:checked').value;

/** Validação do CPF (dígitos verificadores) para dar retorno imediato; o servidor valida de novo. */
function cpfValido(cpf) {
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digito = (base) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(d.slice(0, 9)) === Number(d[9]) && digito(d.slice(0, 10)) === Number(d[10]);
}

/** Máscara 000.000.000-00 enquanto digita */
const mascaraCpf = (v) => v.replace(/\D/g, "").slice(0, 11)
  .replace(/(\d{3})(\d)/, "$1.$2")
  .replace(/(\d{3})(\d)/, "$1.$2")
  .replace(/(\d{3})(\d{1,2})$/, "$1-$2");

// Troca CPF/RG: ajusta o campo
document.querySelectorAll('input[name="presenca-tipo"]').forEach((r) =>
  r.addEventListener("change", () => {
    campoDoc.value = "";
    const cpf = tipoDoc() === "CPF";
    campoDoc.placeholder = cpf ? "000.000.000-00" : "Número do RG";
    campoDoc.inputMode = cpf ? "numeric" : "text";
  }));

campoDoc.addEventListener("input", () => {
  if (tipoDoc() === "CPF") campoDoc.value = mascaraCpf(campoDoc.value);
});

$("form-presenca").addEventListener("submit", async (e) => {
  e.preventDefault();
  const erro = $("presenca-erro");
  const btn = $("presenca-btn");
  const mostrarErro = (msg) => { erro.textContent = msg; erro.classList.remove("hidden"); };

  const nome = $("presenca-nome").value.trim().replace(/\s+/g, " ");
  const tipo = tipoDoc();
  const documento = campoDoc.value.trim();

  erro.classList.add("hidden");
  if (nome.length < 3) return mostrarErro("Informe seu nome completo.");
  if (tipo === "CPF" && !cpfValido(documento)) return mostrarErro("CPF inválido. Confira os números.");
  if (tipo === "RG" && !/^[0-9A-Za-z]{5,14}$/.test(documento.replace(/[.\-\s/]/g, ""))) {
    return mostrarErro("Informe um RG válido.");
  }
  if (!$("presenca-aceite").checked) return mostrarErro("Marque a autorização para continuar.");

  btn.disabled = true;
  btn.textContent = "Enviando…";

  try {
    await confirmarPresenca({ nome, tipo, documento, consentimento: true });
    $("form-presenca").classList.add("hidden");
    $("presenca-ok-texto").textContent = `Obrigado, ${nome}! Estamos te esperando.`;
    $("presenca-ok").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    mostrarErro(err.code === "functions/invalid-argument"
      ? err.message
      : "Não foi possível confirmar. Tente novamente.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirmar presença";
  }
});
