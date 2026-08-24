/**
 * CLOUD FUNCTION — Sincronização em tempo real com Google Sheets
 * -----------------------------------------------------------------
 * Dispara automaticamente toda vez que um documento é criado, editado
 * ou apagado na coleção "registros" do Firestore, e reescreve as abas
 * "Registros (ao vivo)" e "Resumo por Aluno" na planilha do Google
 * Sheets — na hora, sem esperar nenhum intervalo de tempo.
 *
 * Não precisa mais do usuário "robô" (e-mail/senha) que era usado no
 * script antigo do Apps Script — a Cloud Function já tem acesso
 * interno e seguro ao Firestore por ser parte do próprio projeto Firebase.
 */

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { google } = require("googleapis");

initializeApp();
const db = getFirestore();

// ===================== CONFIGURAÇÃO =====================
const ID_PLANILHA_DESTINO = "1sxyop2Jn1808a8vrsBOuD7CtWY4tEQA-SiU8fci6KAE";
// ==========================================================

function chaveNormalizada(texto) {
  return (texto || "").toString().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}
function paraMaiuscula(texto) {
  return (texto || "").toString().toUpperCase();
}
function chaveDoAluno(reg) {
  return chaveNormalizada(reg.aluno) + "||" + chaveNormalizada(reg.turma);
}

async function obterClienteSheets() {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

/**
 * Gatilho principal: qualquer escrita (criar/editar/apagar) na coleção
 * "registros" dispara esta função, que relê a coleção inteira e
 * reescreve as duas abas da planilha do zero — garantindo que a
 * planilha sempre reflete exatamente o que está no Firestore.
 */
exports.sincronizarPlanilhaAoVivo = onDocumentWritten("registros/{registroId}", async (event) => {
  const snapshot = await db.collection("registros").get();
  const registros = snapshot.docs.map(doc => {
    const d = doc.data();
    return {
      data: d.data || "-",
      horario: d.horario || "",
      tipo: d.tipo || "",
      aluno: d.aluno || "",
      matricula: d.matricula || "",
      turma: d.turma || "",
      local: d.local || "-",
      telefone: d.telefone || "",
      motivo: d.motivo || "",
      autorizado: d.autorizado || "-"
    };
  });

  const sheets = await obterClienteSheets();
  await escreverRegistros_(sheets, registros);
  await escreverResumo_(sheets, registros);
});

async function garantirAba_(sheets, nomeAba) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: ID_PLANILHA_DESTINO });
  const existe = meta.data.sheets.some(s => s.properties.title === nomeAba);
  if (!existe) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: ID_PLANILHA_DESTINO,
      requestBody: { requests: [{ addSheet: { properties: { title: nomeAba } } }] }
    });
  }
}

async function limparEEscrever_(sheets, nomeAba, valores) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: ID_PLANILHA_DESTINO,
    range: `${nomeAba}`
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: ID_PLANILHA_DESTINO,
    range: `${nomeAba}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: valores }
  });
}

async function escreverRegistros_(sheets, registros) {
  const NOME_ABA = "Registros (ao vivo)";
  await garantirAba_(sheets, NOME_ABA);

  const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const cabecalho = ["Data", "Horario", "Tipo", "Aluno", "Matricula", "Turma", "Local", "Telefone", "Motivo", "Autorizado/Registrado por", "Última atualização"];

  const linhas = registros.map(reg => [
    reg.data, reg.horario, paraMaiuscula(reg.tipo), paraMaiuscula(reg.aluno),
    paraMaiuscula(reg.matricula), paraMaiuscula(reg.turma), paraMaiuscula(reg.local),
    reg.telefone, paraMaiuscula(reg.motivo), paraMaiuscula(reg.autorizado), agora
  ]);

  await limparEEscrever_(sheets, NOME_ABA, [cabecalho, ...linhas]);
}

async function escreverResumo_(sheets, registros) {
  const NOME_ABA = "Resumo por Aluno";
  await garantirAba_(sheets, NOME_ABA);

  const contagemPorDia = {};
  registros.forEach(reg => {
    const chave = chaveDoAluno(reg) + "||" + reg.data + "||" + reg.tipo;
    if (!contagemPorDia[chave]) {
      contagemPorDia[chave] = { nome: paraMaiuscula(reg.aluno), turma: paraMaiuscula(reg.turma), data: reg.data, tipo: paraMaiuscula(reg.tipo), quantidade: 0 };
    }
    contagemPorDia[chave].quantidade++;
  });
  const tabela1 = Object.values(contagemPorDia);

  const totalGeral = {};
  registros.forEach(reg => {
    const chave = chaveDoAluno(reg);
    if (!totalGeral[chave]) {
      totalGeral[chave] = { nome: paraMaiuscula(reg.aluno), turma: paraMaiuscula(reg.turma), total: 0 };
    }
    totalGeral[chave].total++;
  });
  const tabela2 = Object.values(totalGeral).sort((a, b) => b.total - a.total);

  // Monta as duas tabelas lado a lado (A-E e G-I) numa única escrita
  const linhasMax = Math.max(tabela1.length, tabela2.length);
  const valores = [["Aluno", "Turma", "Data", "Tipo", "Quantidade", "", "Aluno", "Turma", "Total Geral (todos os tipos)"]];
  for (let i = 0; i < linhasMax; i++) {
    const item1 = tabela1[i];
    const item2 = tabela2[i];
    valores.push([
      item1 ? item1.nome : "", item1 ? item1.turma : "", item1 ? item1.data : "", item1 ? item1.tipo : "", item1 ? item1.quantidade : "",
      "",
      item2 ? item2.nome : "", item2 ? item2.turma : "", item2 ? item2.total : ""
    ]);
  }

  await limparEEscrever_(sheets, NOME_ABA, valores);
}
