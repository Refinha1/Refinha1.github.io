// =====================================================================
// Backend: cria o PIX no Mercado Pago e confirma o pagamento via webhook
// =====================================================================
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

// São Paulo + limite de instâncias (evita custo inesperado em caso de abuso)
setGlobalOptions({ region: "southamerica-east1", maxInstances: 5 });

// Segredos guardados no Secret Manager (nunca ficam no código)
const MP_ACCESS_TOKEN = defineSecret("MP_ACCESS_TOKEN");     // credencial de produção
const MP_WEBHOOK_SECRET = defineSecret("MP_WEBHOOK_SECRET"); // assinatura secreta do webhook

const MP_API = "https://api.mercadopago.com";
const VALOR_COTA = 10;        // R$ por cota
const MAX_COTAS = 500;
const EXPIRACAO_MIN = 60;     // validade do PIX em minutos

// ---------------------------------------------------------------------
// 1) Chamada pelo site: valida, grava como "pendente" e gera o PIX
// ---------------------------------------------------------------------
exports.criarContribuicao = onCall({ secrets: [MP_ACCESS_TOKEN] }, async (request) => {
  const { presenteId, nome, mensagem, cotas } = request.data || {};

  // --- Validação (o servidor nunca confia no que o navegador manda) ---
  const nomeLimpo = String(nome ?? "").trim();
  const msgLimpa = String(mensagem ?? "").trim();

  if (typeof presenteId !== "string" || !presenteId) {
    throw new HttpsError("invalid-argument", "Presente inválido.");
  }
  if (nomeLimpo.length < 1 || nomeLimpo.length > 60) {
    throw new HttpsError("invalid-argument", "Informe um nome de até 60 caracteres.");
  }
  if (msgLimpa.length > 300) {
    throw new HttpsError("invalid-argument", "A mensagem pode ter no máximo 300 caracteres.");
  }
  if (!Number.isInteger(cotas) || cotas < 1 || cotas > MAX_COTAS) {
    throw new HttpsError("invalid-argument", "Quantidade de cotas inválida.");
  }

  // --- O presente existe e ainda tem cotas disponíveis? ---
  const presenteSnap = await db.collection("presentes").doc(presenteId).get();
  if (!presenteSnap.exists) throw new HttpsError("not-found", "Presente não encontrado.");
  const presente = presenteSnap.data();

  const confirmadas = await db.collection("contribuicoes")
    .where("presenteId", "==", presenteId)
    .where("status", "==", "confirmado")
    .get();
  const jaDoadas = confirmadas.docs.reduce((soma, d) => soma + d.data().cotas, 0);
  const restantes = presente.metaCotas - jaDoadas;

  if (restantes <= 0) throw new HttpsError("failed-precondition", "Este presente já atingiu a meta. 🎉");
  if (cotas > restantes) {
    throw new HttpsError("failed-precondition", `Restam apenas ${restantes} cotas para este presente.`);
  }

  // --- Grava a contribuição como "pendente" ---
  const valor = cotas * VALOR_COTA;
  const ref = db.collection("contribuicoes").doc(); // ID aleatório
  await ref.set({
    presenteId,
    nome: nomeLimpo,
    mensagem: msgLimpa,
    cotas,
    valor,
    status: "pendente",
    criadoEm: FieldValue.serverTimestamp(),
  });

  // --- Cria o pagamento PIX no Mercado Pago ---
  // O Mercado Pago espera a data de expiração com fuso (Brasil: -03:00)
  const expira = new Date(Date.now() + EXPIRACAO_MIN * 60000 - 3 * 3600000)
    .toISOString().replace("Z", "-03:00");

  try {
    const resp = await fetch(`${MP_API}/v1/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN.value()}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": ref.id, // evita pagamento duplicado em caso de retry
      },
      body: JSON.stringify({
        transaction_amount: valor,
        description: `${cotas} cota(s) - ${presente.nome}`.slice(0, 200),
        payment_method_id: "pix",
        payer: { email: "convidado@listadepresentes.com.br" }, // campo obrigatório
        external_reference: ref.id,    // volta no webhook: liga o pagamento à contribuição
        date_of_expiration: expira,
      }),
    });

    const pagamento = await resp.json();
    const pix = pagamento?.point_of_interaction?.transaction_data;
    if (!resp.ok || !pix?.qr_code) {
      throw new Error(`Mercado Pago recusou: ${JSON.stringify(pagamento)}`);
    }

    await ref.update({ mpPagamentoId: String(pagamento.id) });

    return {
      contribuicaoId: ref.id,
      valor,
      copiaECola: pix.qr_code,
      qrCodeBase64: pix.qr_code_base64,
    };
  } catch (erro) {
    logger.error("Falha ao criar PIX", erro);
    await ref.delete(); // não deixa contribuição pendente sem PIX
    throw new HttpsError("internal", "Não foi possível gerar o PIX. Tente novamente.");
  }
});

// ---------------------------------------------------------------------
// 2) Chamada pelo Mercado Pago quando um pagamento muda de status
// ---------------------------------------------------------------------
exports.webhookMercadoPago = onRequest(
  { secrets: [MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET] },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).send("Método não permitido");

    // --- a) Valida a assinatura (garante que a chamada veio do Mercado Pago) ---
    const xSignature = req.get("x-signature") || "";
    const xRequestId = req.get("x-request-id") || "";
    // O ID vem na query string; se for alfanumérico, deve estar em minúsculas
    const dataId = String(req.query["data.id"] ?? req.body?.data?.id ?? "").toLowerCase();

    const partes = {};
    for (const trecho of xSignature.split(",")) {
      const i = trecho.indexOf("=");
      if (i > 0) partes[trecho.slice(0, i).trim()] = trecho.slice(i + 1).trim();
    }
    const { ts, v1 } = partes;
    if (!ts || !v1 || !dataId) return res.status(401).send("Assinatura ausente");

    const manifesto = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const esperado = crypto
      .createHmac("sha256", MP_WEBHOOK_SECRET.value())
      .update(manifesto)
      .digest("hex");

    const valida =
      esperado.length === v1.length &&
      crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(v1));
    if (!valida) {
      logger.warn("Assinatura inválida no webhook");
      return res.status(401).send("Assinatura inválida");
    }

    // --- b) Só nos interessa o evento de pagamento ---
    const tipo = req.query.type ?? req.body?.type;
    if (tipo !== "payment") return res.status(200).send("Evento ignorado");

    // --- c) Nunca confie no corpo do webhook: consulte o pagamento na API ---
    const r = await fetch(`${MP_API}/v1/payments/${dataId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN.value()}` },
    });
    if (r.status === 404) return res.status(200).send("Pagamento não encontrado"); // ex.: notificação de teste
    if (!r.ok) return res.status(500).send("Erro ao consultar pagamento"); // MP tentará de novo

    const pagamento = await r.json();
    if (pagamento.status !== "approved" || !pagamento.external_reference) {
      return res.status(200).send("Ainda não aprovado");
    }

    // --- d) Confirma a contribuição (transação = idempotente) ---
    const ref = db.collection("contribuicoes").doc(String(pagamento.external_reference));
    await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) {
        logger.error("Pagamento aprovado sem contribuição", { pagamento: pagamento.id });
        return;
      }
      const c = snap.data();
      if (c.status === "confirmado") return; // webhook repetido: nada a fazer

      // Confere que o pagamento é o mesmo gerado por nós e que o valor bate
      if (String(pagamento.id) !== c.mpPagamentoId ||
          Number(pagamento.transaction_amount) !== c.valor) {
        logger.error("Divergência de pagamento/valor", { contribuicao: ref.id, pagamento: pagamento.id });
        return;
      }
      t.update(ref, { status: "confirmado", confirmadoEm: FieldValue.serverTimestamp() });
    });

    return res.status(200).send("ok");
  }
);

// ---------------------------------------------------------------------
// 3) Faxina diária: remove contribuições pendentes com mais de 48 h
//    (o PIX já expirou em 60 min, então nunca serão pagas)
// ---------------------------------------------------------------------
exports.limparPendentes = onSchedule(
  { schedule: "every 24 hours", timeZone: "America/Sao_Paulo" },
  async () => {
    const limite = Timestamp.fromMillis(Date.now() - 48 * 3600000);
    const snap = await db.collection("contribuicoes").where("criadoEm", "<", limite).get();

    const writer = db.bulkWriter();
    snap.docs.filter((d) => d.data().status === "pendente").forEach((d) => writer.delete(d.ref));
    await writer.close();
  }
);
