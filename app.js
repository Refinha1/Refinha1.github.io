import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, query, where, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyD7396GnE9pVule0uYPb6XObIs3yrBTVDg",
  authDomain: "casa-nova-refinha.firebaseapp.com",
  projectId: "casa-nova-refinha",
  storageBucket: "casa-nova-refinha.firebasestorage.app",
  messagingSenderId: "48902111617",
  appId: "1:48902111617:web:8d642eda94297134e3a880",
};

const VALOR_COTA = 20;
const MAX_COTAS = 500;
const MP_PUBLIC_KEY = "APP_USR-a0bef11d-f38e-44a7-b86a-467e06296bd2";
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const functions = getFunctions(app, "southamerica-east1");
const criarContribuicao = httpsCallable(functions, "criarContribuicao");
const pagarComCartao = httpsCallable(functions, "pagarComCartao");
const $ = (id) => document.getElementById(id);
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

let presentes = [];
let contribuicoes = [];
let presenteAtual = null;
let copiaECola = "";
let pararEspera = null;
let mp = null;
let cardBrick = null;

const esc = (texto) => String(texto ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function cotasDoadas(presenteId) {
  return contribuicoes
    .filter((contribuicao) => contribuicao.presenteId === presenteId)
    .reduce((total, contribuicao) => total + (Number(contribuicao.cotas) || 0), 0);
}

function renderCatalogo() {
  const grid = $("lista-presentes");
  $("estado-catalogo").classList.toggle("hidden", presentes.length > 0);
  if (presentes.length === 0) {
    $("estado-catalogo").textContent = "Nenhum presente disponível no momento.";
    grid.innerHTML = "";
    return;
  }

  grid.innerHTML = presentes.map((presente) => {
    const meta = Number(presente.metaCotas) || 0;
    const doadas = cotasDoadas(presente.id);
    const pct = meta > 0 ? Math.min(100, Math.round((doadas / meta) * 100)) : 0;
    const completo = meta <= 0 || doadas >= meta;
    const nome = presente.nome || presente.titulo || `Presente: ${presente.id.replace(/[-_]/g, " ")}`;
    return `
      <article class="gift-card">
        ${presente.imagem ? `<img src="${esc(presente.imagem)}" alt="${esc(nome)}" loading="lazy" />` : ""}
        <div class="gift-copy">
          <h3>${esc(nome)}</h3>
          <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
            <span style="width:${pct}%"></span>
          </div>
          <p>${doadas} de ${meta} cotas · ${brl.format(meta * VALOR_COTA)}</p>
          <button type="button" class="primary" data-presente="${esc(presente.id)}" ${completo ? "disabled" : ""}>
            ${completo ? "Meta atingida" : "Contribuir"}
          </button>
        </div>
      </article>`;
  }).join("");
}

function cotasRestantes(presente) {
  return Math.max(0, Number(presente.metaCotas) - cotasDoadas(presente.id));
}

function atualizarTotal() {
  const restantes = Math.min(MAX_COTAS, cotasRestantes(presenteAtual));
  let quantidade = Number.parseInt($("campo-cotas").value, 10);
  if (!Number.isInteger(quantidade) || quantidade < 1) quantidade = 1;
  quantidade = Math.min(quantidade, restantes);
  $("campo-cotas").value = quantidade || 1;
  $("campo-cotas").max = restantes;
  $("total-valor").textContent = brl.format(quantidade * VALOR_COTA);
}

function encerrarEspera() {
  if (pararEspera) {
    pararEspera();
    pararEspera = null;
  }
}

function resetarCartao() {
  if (cardBrick) {
    try { cardBrick.unmount(); } catch (erro) { console.error("Não foi possível fechar o formulário do cartão:", erro); }
    cardBrick = null;
  }
  $("passo-cartao").classList.add("hidden");
  $("cartao-erro").classList.add("hidden");
}

function abrirModal(presenteId) {
  presenteAtual = presentes.find((presente) => presente.id === presenteId);
  if (!presenteAtual) return;
  encerrarEspera();
  resetarCartao();
  $("modal-titulo").textContent = presenteAtual.nome || presenteAtual.titulo || `Presente: ${presenteAtual.id.replace(/[-_]/g, " ")}`;
  $("modal-restantes").textContent = `Disponíveis: ${cotasRestantes(presenteAtual)} cotas`;
  $("campo-cotas").value = 1;
  $("campo-nome").value = "";
  $("campo-mensagem").value = "";
  $("erro-form").classList.add("hidden");
  $("passo-form").classList.remove("hidden");
  $("passo-pix").classList.add("hidden");
  $("pix-aguardando").classList.remove("hidden");
  $("pagamento-analise").classList.add("hidden");
  $("pix-confirmado").classList.add("hidden");
  atualizarTotal();
  $("modal").classList.add("open");
  document.body.style.overflow = "hidden";
  $("campo-nome").focus();
}

function fecharModal() {
  resetarCartao();
  encerrarEspera();
  $("modal").classList.remove("open");
  document.body.style.overflow = "";
  presenteAtual = null;
}

function observarConfirmacao(contribuicaoId) {
  encerrarEspera();
  pararEspera = onSnapshot(doc(db, "contribuicoes", contribuicaoId), (snapshot) => {
    if (snapshot.data()?.status !== "confirmado") return;
    $("pix-aguardando").classList.add("hidden");
    $("pagamento-analise").classList.add("hidden");
    $("pix-confirmado").classList.remove("hidden");
  }, (erro) => {
    console.error("Não foi possível acompanhar a confirmação do pagamento:", erro);
  });
}

function mostrarPix({ contribuicaoId, valor, copiaECola: codigo, qrCodeBase64 }) {
  copiaECola = codigo;
  $("pix-valor").textContent = brl.format(valor);
  $("pix-qr").src = `data:image/png;base64,${qrCodeBase64}`;
  $("btn-copiar").textContent = "Copiar código PIX";
  $("passo-form").classList.add("hidden");
  $("passo-pix").classList.remove("hidden");
  $("pix-aguardando").classList.remove("hidden");
  $("pagamento-analise").classList.add("hidden");
  $("pix-confirmado").classList.add("hidden");
  observarConfirmacao(contribuicaoId);
}

function mensagemErro(erro, alternativa) {
  const amigaveis = ["functions/invalid-argument", "functions/failed-precondition", "functions/not-found"];
  return amigaveis.includes(erro.code) ? erro.message : alternativa;
}

function dadosPedido() {
  const nome = $("campo-nome").value.trim();
  const mensagem = $("campo-mensagem").value.trim();
  const cotas = Number.parseInt($("campo-cotas").value, 10);
  if (!nome || nome.length > 60) throw new Error("Informe seu nome (até 60 caracteres).");
  if (mensagem.length > 300) throw new Error("A mensagem pode ter no máximo 300 caracteres.");
  if (!Number.isInteger(cotas) || cotas < 1 || cotas > cotasRestantes(presenteAtual)) {
    throw new Error("Escolha uma quantidade válida de cotas disponíveis.");
  }
  return { presenteId: presenteAtual.id, nome, mensagem, cotas };
}

$("lista-presentes").addEventListener("click", (evento) => {
  const botao = evento.target.closest("[data-presente]");
  if (botao) abrirModal(botao.dataset.presente);
});

document.querySelectorAll("[data-fechar]").forEach((botao) => botao.addEventListener("click", fecharModal));
$("modal").addEventListener("click", (evento) => {
  if (evento.target === $("modal")) fecharModal();
});
document.addEventListener("keydown", (evento) => {
  if (evento.key === "Escape" && $("modal").classList.contains("open")) fecharModal();
});
$("menos").addEventListener("click", () => {
  $("campo-cotas").value = Number.parseInt($("campo-cotas").value, 10) - 1;
  atualizarTotal();
});
$("mais").addEventListener("click", () => {
  $("campo-cotas").value = Number.parseInt($("campo-cotas").value, 10) + 1;
  atualizarTotal();
});
$("campo-cotas").addEventListener("input", atualizarTotal);

$("btn-confirmar").addEventListener("click", async () => {
  const erro = $("erro-form");
  const botao = $("btn-confirmar");
  let pedido;
  try {
    pedido = dadosPedido();
  } catch (falha) {
    erro.textContent = falha.message;
    erro.classList.remove("hidden");
    return;
  }

  erro.classList.add("hidden");
  botao.disabled = true;
  botao.textContent = "Gerando PIX…";
  try {
    const resposta = await criarContribuicao(pedido);
    mostrarPix(resposta.data);
  } catch (falha) {
    console.error("Falha ao gerar PIX:", falha);
    erro.textContent = mensagemErro(falha, "Não foi possível gerar o PIX. Tente novamente.");
    erro.classList.remove("hidden");
  } finally {
    botao.disabled = false;
    botao.textContent = "Pagar com PIX";
  }
});

$("btn-copiar").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(copiaECola);
    $("btn-copiar").textContent = "Código copiado";
  } catch (erro) {
    console.error("Não foi possível copiar o código PIX:", erro);
    $("btn-copiar").textContent = "Falha ao copiar; tente selecionar o código no app do banco";
  }
});

$("btn-cartao").addEventListener("click", async () => {
  const erroForm = $("erro-form");
  let pedido;
  try {
    pedido = dadosPedido();
  } catch (falha) {
    erroForm.textContent = falha.message;
    erroForm.classList.remove("hidden");
    return;
  }
  erroForm.classList.add("hidden");
  $("cartao-erro").classList.add("hidden");
  $("cartao-resumo").textContent = `${pedido.cotas} ${pedido.cotas === 1 ? "cota" : "cotas"} · ${brl.format(pedido.cotas * VALOR_COTA)}`;
  $("passo-form").classList.add("hidden");
  $("passo-cartao").classList.remove("hidden");

  try {
    if (!window.MercadoPago) throw new Error("O Mercado Pago não foi carregado.");
    if (!mp) mp = new window.MercadoPago(MP_PUBLIC_KEY, { locale: "pt-BR" });
    if (cardBrick) {
      await cardBrick.unmount();
      cardBrick = null;
    }
    cardBrick = await mp.bricks().create("cardPayment", "cartao-brick", {
      initialization: { amount: pedido.cotas * VALOR_COTA },
      customization: {
        visual: { style: { theme: "default" } },
        paymentMethods: { maxInstallments: 1 },
      },
      callbacks: {
        onReady: () => {},
        onSubmit: async (dados) => {
          try {
            const resposta = await pagarComCartao({
              ...pedido,
              token: dados.token,
              paymentMethodId: dados.payment_method_id,
              issuerId: dados.issuer_id,
              email: dados.payer?.email,
              docTipo: dados.payer?.identification?.type,
              docNumero: dados.payer?.identification?.number,
              deviceId: window.MP_DEVICE_SESSION_ID,
            });

            $("passo-cartao").classList.add("hidden");
            $("passo-pix").classList.remove("hidden");
            if (resposta.data.status === "approved") {
              $("pix-aguardando").classList.add("hidden");
              $("pix-confirmado").classList.remove("hidden");
            } else {
              $("pix-aguardando").classList.add("hidden");
              $("pagamento-analise").classList.remove("hidden");
              observarConfirmacao(resposta.data.contribuicaoId);
            }
          } catch (falha) {
            console.error("Falha ao processar cartão:", falha);
            $("cartao-erro").textContent = mensagemErro(falha, "Não foi possível processar o cartão. Tente novamente ou use o PIX.");
            $("cartao-erro").classList.remove("hidden");
            throw falha;
          }
        },
        onError: (falha) => console.error("Erro no formulário do cartão:", falha),
      },
    });
  } catch (falha) {
    console.error("Não foi possível abrir o formulário do cartão:", falha);
    $("cartao-erro").textContent = "Não foi possível carregar o formulário do cartão. Tente novamente ou use o PIX.";
    $("cartao-erro").classList.remove("hidden");
  }
});

$("cartao-voltar").addEventListener("click", () => {
  resetarCartao();
  $("passo-form").classList.remove("hidden");
});

const gradeFotos = $("photo-grid");
const galeriaVazia = $("empty-gallery");
const lightbox = $("lightbox");
const imagemAmpliada = $("lightbox-image");

async function carregarGaleria() {
  try {
    const resposta = await fetch("fotos/cha/fotos.json");
    if (!resposta.ok) throw new Error(`Não foi possível carregar a lista de fotos (${resposta.status}).`);
    const dados = await resposta.json();
    if (!Array.isArray(dados.fotos)) throw new Error("A lista de fotos está em um formato inválido.");

    const nomes = dados.fotos.filter((nome) =>
      typeof nome === "string" && /^\d{2,}\.(jpe?g|png|webp)$/i.test(nome));
    if (nomes.length === 0) {
      galeriaVazia.hidden = false;
      return;
    }

    nomes.forEach((nome, indice) => {
      const cartao = document.createElement("article");
      cartao.className = "photo-card";
      const botao = document.createElement("button");
      botao.type = "button";
      botao.dataset.foto = String(indice);
      botao.setAttribute("aria-label", `Ampliar foto ${indice + 1}`);
      const foto = document.createElement("img");
      foto.src = `fotos/cha/${encodeURIComponent(nome)}`;
      foto.alt = `Lembrança ${indice + 1} do nosso chá de panela`;
      foto.loading = "lazy";
      botao.append(foto);
      cartao.append(botao);
      gradeFotos.append(cartao);
    });

    gradeFotos.addEventListener("click", (evento) => {
      const botao = evento.target.closest("[data-foto]");
      if (!botao) return;
      const foto = botao.querySelector("img");
      imagemAmpliada.src = foto.src;
      imagemAmpliada.alt = foto.alt;
      lightbox.showModal();
    });
  } catch (erro) {
    console.error("Erro ao carregar a galeria:", erro);
    galeriaVazia.textContent = "Não foi possível carregar a galeria. Atualize a página e tente novamente.";
    galeriaVazia.hidden = false;
  }
}

carregarGaleria();
lightbox.querySelector(".lightbox-close").addEventListener("click", () => lightbox.close());
lightbox.addEventListener("click", (evento) => {
  if (evento.target === lightbox) lightbox.close();
});
lightbox.addEventListener("close", () => {
  imagemAmpliada.removeAttribute("src");
  imagemAmpliada.alt = "";
});

onSnapshot(collection(db, "presentes"), (snapshot) => {
  presentes = snapshot.docs
    .map((presente) => ({ id: presente.id, ...presente.data() }))
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  renderCatalogo();
}, (erro) => {
  console.error("Não foi possível carregar os presentes:", erro);
  $("estado-catalogo").textContent = "Não foi possível carregar os presentes. Atualize a página e tente novamente.";
});

onSnapshot(
  query(collection(db, "contribuicoes"), where("status", "==", "confirmado")),
  (snapshot) => {
    contribuicoes = snapshot.docs.map((contribuicao) => contribuicao.data());
    renderCatalogo();
    if (presenteAtual) {
      $("modal-restantes").textContent = `Disponíveis: ${cotasRestantes(presenteAtual)} cotas`;
    }
  },
  (erro) => {
    console.error("Não foi possível atualizar o total das contribuições:", erro);
  }
);
