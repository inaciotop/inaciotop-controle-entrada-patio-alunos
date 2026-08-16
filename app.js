// ================================================================
// CONFIGURAÇÃO DO FIREBASE
// Copiada da tela "Configurações do projeto" no Firebase Console.
// ================================================================
const firebaseConfig = {
    apiKey: "AIzaSyCu-ZW5TIWUa9O2gih9nr-68GGdrkNnMqA",
    authDomain: "controle-entrada-patio.firebaseapp.com",
    projectId: "controle-entrada-patio",
    storageBucket: "controle-entrada-patio.firebasestorage.app",
    messagingSenderId: "885071218390",
    appId: "1:885071218390:web:1f7591eef59e213d9aab77"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Permite continuar usando o app offline (fila as gravações e sincroniza depois)
db.enablePersistence({ synchronizeTabs: true }).catch((erro) => {
    console.warn('Persistência offline não disponível neste navegador:', erro.code);
});

const NOME_COLECAO_REGISTROS = 'registros';
const NOME_COLECAO_USUARIOS = 'usuarios';

let registrosCache = []; // fonte única usada por toda a interface
let unsubscribeRegistros = null;
let papelUsuarioAtual = 'lancador'; // 'lancador' (lança e lê), 'gestor' (lança, lê e edita) ou 'leitor' (só lê)
let idRegistroEmEdicao = null; // usado quando um "gestor" está editando um registro existente

function obterHistorico() {
    return registrosCache;
}

document.addEventListener('DOMContentLoaded', () => {
    atualizarStatusOffline();
    registrarServiceWorker();
    configurarAutenticacao();
});

// ================================================================
// AUTENTICAÇÃO (Firebase Auth — e-mail e senha)
// ================================================================
function configurarAutenticacao() {
    auth.onAuthStateChanged(async (usuario) => {
        if (usuario) {
            document.getElementById('tela-login').style.display = 'none';
            document.getElementById('app-principal').style.display = 'block';
            document.getElementById('texto-usuario-logado').innerText = `👤 ${usuario.email}`;
            await carregarPapelUsuario(usuario.uid);
            aplicarPermissoesNaTela();
            iniciarListenerRegistros();
        } else {
            document.getElementById('tela-login').style.display = 'block';
            document.getElementById('app-principal').style.display = 'none';
            pararListenerRegistros();
        }
    });
}

async function carregarPapelUsuario(uid) {
    try {
        const doc = await db.collection(NOME_COLECAO_USUARIOS).doc(uid).get();
        const papel = doc.exists ? doc.data().papel : null;
        papelUsuarioAtual = (papel === 'gestor' || papel === 'leitor') ? papel : 'lancador';
    } catch (erro) {
        console.warn('Não foi possível verificar o papel do usuário, assumindo "lancador":', erro);
        papelUsuarioAtual = 'lancador';
    }
}

function aplicarPermissoesNaTela() {
    const cardFormulario = document.getElementById('form-registro').closest('.card');
    const avisoLeitor = document.getElementById('aviso-somente-leitura');

    if (papelUsuarioAtual === 'leitor') {
        if (cardFormulario) cardFormulario.style.display = 'none';
        if (avisoLeitor) avisoLeitor.style.display = 'block';
    } else {
        if (cardFormulario) cardFormulario.style.display = 'block';
        if (avisoLeitor) avisoLeitor.style.display = 'none';
    }
    atualizarTabelaTela(); // reexibe a lista já mostrando/escondendo o botão Editar
}

function podeEditarRegistros() {
    return papelUsuarioAtual === 'gestor';
}

async function fazerLogin() {
    const email = document.getElementById('login_email').value.trim();
    const senha = document.getElementById('login_senha').value;
    const caixaErro = document.getElementById('erro-login');
    caixaErro.style.display = 'none';

    const botao = document.querySelector('#form-login button[type="submit"]');
    try {
        if (botao) { botao.disabled = true; botao.innerText = 'Entrando...'; }
        await auth.signInWithEmailAndPassword(email, senha);
    } catch (erro) {
        console.error('Erro de login:', erro);
        caixaErro.innerText = traduzirErroLogin(erro.code);
        caixaErro.style.display = 'block';
    } finally {
        if (botao) { botao.disabled = false; botao.innerText = 'Entrar'; }
    }
}

function traduzirErroLogin(codigo) {
    const mapa = {
        'auth/invalid-email': 'E-mail inválido.',
        'auth/user-not-found': 'Usuário não encontrado. Peça ao administrador para cadastrar seu e-mail.',
        'auth/wrong-password': 'Senha incorreta.',
        'auth/invalid-credential': 'E-mail ou senha incorretos.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente novamente.',
        'auth/user-disabled': 'Este usuário foi desativado.'
    };
    return mapa[codigo] || 'Não foi possível entrar. Verifique seus dados e tente novamente.';
}

function fazerLogout() {
    auth.signOut();
}

window.addEventListener('online', atualizarStatusOffline);
window.addEventListener('offline', atualizarStatusOffline);

function atualizarStatusOffline() {
    const aviso = document.getElementById('status-offline');
    if (!aviso) return;
    aviso.style.display = navigator.onLine ? 'none' : 'block';
}

function registrarServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('sw.js').then((registro) => {
        if (registro.waiting) {
            mostrarBannerAtualizacao(registro.waiting);
        }

        registro.addEventListener('updatefound', () => {
            const novoWorker = registro.installing;
            if (!novoWorker) return;

            novoWorker.addEventListener('statechange', () => {
                if (novoWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    mostrarBannerAtualizacao(novoWorker);
                }
            });
        });

        registro.update();
    }).catch(err => {
        console.warn('Falha ao registrar o Service Worker:', err);
    });

    let jaRecarregou = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (jaRecarregou) return;
        jaRecarregou = true;
        window.location.reload();
    });
}

function mostrarBannerAtualizacao(workerEmEspera) {
    const banner = document.getElementById('banner-atualizacao');
    if (!banner) return;
    banner.style.display = 'flex';
    banner.querySelector('button').onclick = () => {
        workerEmEspera.postMessage({ tipo: 'SKIP_WAITING' });
        banner.style.display = 'none';
    };
}

function escaparHTML(texto) {
    const div = document.createElement('div');
    div.innerText = texto;
    return div.innerHTML;
}

function alternarCamposPorTipo() {
    const tipo = document.getElementById('tipo_registro').value;
    document.getElementById('campos_saida').style.display = tipo === 'SAÍDA' ? 'block' : 'none';
    document.getElementById('campos_atraso').style.display = tipo === 'ATRASO' ? 'block' : 'none';
    document.getElementById('campos_ocorrencia').style.display = tipo === 'OCORRENCIA' ? 'block' : 'none';

    if (tipo !== 'SAÍDA') {
        document.getElementById('motivo_obs').value = '';
        document.getElementById('autorizado_por').value = '';
    }
    if (tipo !== 'ATRASO') {
        document.getElementById('status_atraso').value = 'Justificado';
        document.getElementById('justificativa_atraso').value = '';
    }
    if (tipo !== 'OCORRENCIA') {
        document.getElementById('local_ocorrencia').value = 'Pátio';
        document.getElementById('detalhe_ocorrencia').value = '';
        document.getElementById('funcionario_ocorrencia').value = '';
    }
    document.getElementById('funcionario_ocorrencia').required = tipo === 'OCORRENCIA';
    verificarReincidencia();
}

function verificarReincidencia() {
    const nome = document.getElementById('aluno_nome').value.toLowerCase().trim();
    const turma = document.getElementById('aluno_turma').value.toLowerCase().trim();

    const alerta = document.getElementById('alerta-reincidencia');
    const inputTelefone = document.getElementById('responsavel_telefone');
    const labelTelefone = document.getElementById('label-telefone');

    if (!nome || !turma) {
        esconderCamposReincidencia();
        return;
    }

    const historico = obterHistorico();

    const ultimoRegistroComFone = [...historico].reverse().find(reg =>
        reg.aluno.toLowerCase().trim() === nome &&
        reg.turma.toLowerCase().trim() === turma &&
        reg.telefone
    );
    if (ultimoRegistroComFone && !inputTelefone.value) {
        inputTelefone.value = ultimoRegistroComFone.telefone;
    }

    const ultimoRegistroGeral = [...historico].reverse().find(reg =>
        reg.aluno.toLowerCase().trim() === nome &&
        reg.turma.toLowerCase().trim() === turma
    );
    if (ultimoRegistroGeral && ultimoRegistroGeral.matricula && ultimoRegistroGeral.matricula !== 'Não inf.') {
        if (!document.getElementById('aluno_matricula').value) {
            document.getElementById('aluno_matricula').value = ultimoRegistroGeral.matricula;
        }
    }

    const qtdAtrasos = historico.filter(reg =>
        reg.aluno.toLowerCase().trim() === nome &&
        reg.turma.toLowerCase().trim() === turma &&
        reg.tipo === 'ATRASO'
    ).length;

    if (qtdAtrasos > 0) {
        alerta.style.display = 'block';
        alerta.innerText = `⚠️ Aluno reincidente! Este será o ${qtdAtrasos + 1}º atraso do(a) aluno(a) na turma ${turma.toUpperCase()}.`;
    } else {
        alerta.style.display = 'none';
    }

    if (qtdAtrasos >= 2) {
        inputTelefone.required = true;
        labelTelefone.innerHTML = '🚨 WhatsApp do Responsável (Exigido - 3º Atraso):';
        labelTelefone.style.color = '#d63031';
    } else {
        inputTelefone.required = false;
        labelTelefone.innerHTML = '📱 WhatsApp do Responsável (Opcional):';
        labelTelefone.style.color = '';
    }
}

function esconderCamposReincidencia() {
    document.getElementById('alerta-reincidencia').style.display = 'none';
    document.getElementById('responsavel_telefone').required = false;
    document.getElementById('label-telefone').innerHTML = '📱 WhatsApp do Responsável (Opcional):';
    document.getElementById('label-telefone').style.color = '';
}

async function salvarOcorrencia() {
    const agora = new Date();
    const dataAtual = agora.toLocaleDateString('pt-BR');
    const horarioAtual = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const telefoneInput = document.getElementById('responsavel_telefone').value;
    const telefoneLimpo = telefoneInput ? telefoneInput.replace(/\D/g, '') : '';

    const nomeAtual = document.getElementById('aluno_nome').value.trim().toUpperCase();
    const turmaAtual = document.getElementById('aluno_turma').value.trim().toUpperCase();
    const tipoReg = document.getElementById('tipo_registro').value;

    let motivoFinal = '';
    let localOcorrencia = '-';
    let responsavelRegistro = document.getElementById('autorizado_por').value.trim().toUpperCase() || '-';
    if (tipoReg === 'ATRASO') {
        const status = document.getElementById('status_atraso').value;
        const detalhe = document.getElementById('justificativa_atraso').value.trim().toUpperCase();
        motivoFinal = detalhe ? `${status} (${detalhe})` : status;
    } else if (tipoReg === 'OCORRENCIA') {
        localOcorrencia = document.getElementById('local_ocorrencia').value;
        const detalhe = document.getElementById('detalhe_ocorrencia').value.trim().toUpperCase();
        motivoFinal = detalhe || 'Ocorrência registrada';
        const funcionario = document.getElementById('funcionario_ocorrencia').value.trim().toUpperCase();
        if (!funcionario) {
            alert('Informe quem fez o registro da ocorrência.');
            return;
        }
        responsavelRegistro = funcionario;
    } else {
        motivoFinal = document.getElementById('motivo_obs').value.trim().toUpperCase() || 'Saída antecipada';
    }

    const novoRegistro = {
        data: dataAtual,
        horario: horarioAtual,
        tipo: tipoReg,
        aluno: nomeAtual,
        matricula: document.getElementById('aluno_matricula').value.trim().toUpperCase() || 'Não inf.',
        turma: turmaAtual,
        telefone: telefoneLimpo,
        local: localOcorrencia,
        motivo: motivoFinal,
        autorizado: responsavelRegistro
    };

    if (!novoRegistro.telefone) {
        const historicoAtual = obterHistorico();
        const registroAntigoComFone = [...historicoAtual].reverse().find(reg =>
            reg.aluno.toLowerCase().trim() === nomeAtual.toLowerCase() &&
            reg.turma.toLowerCase().trim() === turmaAtual.toLowerCase() &&
            reg.telefone
        );
        if (registroAntigoComFone) {
            novoRegistro.telefone = registroAntigoComFone.telefone;
        }
    }

    const btnSalvar = document.querySelector('#form-registro button[type="submit"]');

    try {
        if (idRegistroEmEdicao) {
            if (btnSalvar) { btnSalvar.disabled = true; btnSalvar.innerText = 'Salvando edição...'; }
            await db.collection(NOME_COLECAO_REGISTROS).doc(idRegistroEmEdicao).update({
                ...novoRegistro,
                editadoEm: firebase.firestore.FieldValue.serverTimestamp(),
                editadoPor: auth.currentUser ? auth.currentUser.email : '-'
            });
        } else {
            if (btnSalvar) { btnSalvar.disabled = true; btnSalvar.innerText = 'Salvando...'; }
            await db.collection(NOME_COLECAO_REGISTROS).add({
                ...novoRegistro,
                criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
                criadoPor: auth.currentUser ? auth.currentUser.email : '-'
            });
        }
        // Não precisa atualizar registrosCache manualmente: o listener em tempo
        // real (onSnapshot) recebe a mudança automaticamente, inclusive offline.
    } catch (erro) {
        console.error('Erro ao salvar o registro:', erro);
        alert('Falha ao salvar o registro. Verifique sua internet e tente de novo.');
        return;
    } finally {
        if (btnSalvar) { btnSalvar.disabled = false; }
    }

    cancelarEdicao(); // limpa o modo de edição e o formulário, se estava ativo
    document.getElementById('form-registro').reset();
    document.getElementById('campo-busca').value = '';
    esconderCamposReincidencia();
    alternarCamposPorTipo();
    alert(idRegistroEmEdicao ? "Edição salva com sucesso!" : "Salvo com sucesso!");
}

function iniciarEdicaoRegistro(id) {
    if (!podeEditarRegistros()) return;
    const reg = registrosCache.find(r => r.id === id);
    if (!reg) return;

    idRegistroEmEdicao = id;

    document.getElementById('tipo_registro').value = reg.tipo;
    alternarCamposPorTipo();
    document.getElementById('aluno_nome').value = reg.aluno;
    document.getElementById('aluno_turma').value = reg.turma;
    document.getElementById('aluno_matricula').value = reg.matricula === 'Não inf.' ? '' : reg.matricula;
    document.getElementById('responsavel_telefone').value = reg.telefone || '';

    if (reg.tipo === 'ATRASO') {
        const [status, ...resto] = reg.motivo.split(' (');
        document.getElementById('status_atraso').value = status.trim();
        document.getElementById('justificativa_atraso').value = resto.length ? resto.join(' (').replace(/\)$/, '') : '';
    } else if (reg.tipo === 'OCORRENCIA') {
        document.getElementById('local_ocorrencia').value = reg.local;
        document.getElementById('detalhe_ocorrencia').value = reg.motivo;
        document.getElementById('funcionario_ocorrencia').value = reg.autorizado;
    } else {
        document.getElementById('motivo_obs').value = reg.motivo;
        document.getElementById('autorizado_por').value = reg.autorizado === '-' ? '' : reg.autorizado;
    }

    const btnSalvar = document.querySelector('#form-registro button[type="submit"]');
    if (btnSalvar) btnSalvar.innerText = 'Salvar Edição';
    const avisoEdicao = document.getElementById('aviso-modo-edicao');
    if (avisoEdicao) avisoEdicao.style.display = 'flex';

    document.querySelector('.card').scrollIntoView({ behavior: 'smooth' });
}

function cancelarEdicao() {
    idRegistroEmEdicao = null;
    const btnSalvar = document.querySelector('#form-registro button[type="submit"]');
    if (btnSalvar) btnSalvar.innerText = 'Salvar Registro';
    const avisoEdicao = document.getElementById('aviso-modo-edicao');
    if (avisoEdicao) avisoEdicao.style.display = 'none';
    document.getElementById('form-registro').reset();
    alternarCamposPorTipo();
}

function criarBotaoWhats(reg) {
    if (!reg.telefone) {
        return `<span style="color:#aaa; font-size:12px;">Sem fone</span>`;
    }

    let mensagem = `Olá! Informamos que o(a) aluno(a) *${reg.aluno}* (Turma: ${reg.turma}) registrou um *ATRASO* de entrada às *${reg.horario}*.\nSituação: ${reg.motivo}`;
    if (reg.tipo === "SAÍDA") {
        mensagem = `Olá! Informamos que o(a) aluno(a) *${reg.aluno}* (Turma: ${reg.turma}) teve uma *SAÍDA ANTECIPADA* às *${reg.horario}*.\nMotivo: ${reg.motivo}`;
    } else if (reg.tipo === "OCORRENCIA") {
        mensagem = `Olá! Informamos que o(a) aluno(a) *${reg.aluno}* (Turma: ${reg.turma}) teve uma *OCORRÊNCIA* registrada às *${reg.horario}* (Local: ${reg.local}).\nDescrição: ${reg.motivo}\nRegistrado por: ${reg.autorizado}`;
    }

    const link = `https://api.whatsapp.com/send?phone=55${reg.telefone}&text=${encodeURIComponent(mensagem)}`;
    return `<a href="${link}" target="_blank" class="btn-whatsapp">📲 Enviar</a>`;
}

function classeBadge(tipo) {
    if (tipo === 'SAÍDA') return 'badge-saida';
    if (tipo === 'OCORRENCIA') return 'badge-ocorrencia';
    return 'badge-atraso';
}

function linhaTabela(reg) {
    const classe = classeBadge(reg.tipo);
    const btnWhats = criarBotaoWhats(reg);
    const btnEditar = podeEditarRegistros()
        ? `<br><button type="button" class="btn-editar-linha" onclick="iniciarEdicaoRegistro('${reg.id}')">✏️ Editar</button>`
        : '';
    return `
        <tr>
            <td><strong>${escaparHTML(reg.horario)}</strong><br><span class="badge ${classe}">${escaparHTML(reg.tipo)}</span><br><small style="color:#777;">${escaparHTML(reg.data || '-')}</small></td>
            <td>${escaparHTML(reg.aluno)}</td>
            <td>${escaparHTML(reg.turma)}</td>
            <td>${btnWhats}${btnEditar}</td>
        </tr>
    `;
}

function atualizarTabelaTela() {
    const lista = document.getElementById('lista-ocorrencias');
    const historico = obterHistorico();
    lista.innerHTML = '';

    if (historico.length === 0) {
        lista.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#777;">Sem registros.</td></tr>`;
        return;
    }

    [...historico].reverse().forEach(reg => {
        lista.innerHTML += linhaTabela(reg);
    });
}

function filtrarRegistros() {
    const termoBusca = document.getElementById('campo-busca').value.toLowerCase().trim();
    const lista = document.getElementById('lista-ocorrencias');
    const resumo = document.getElementById('resumo-busca');
    const historico = obterHistorico();

    lista.innerHTML = '';

    if (!termoBusca) {
        resumo.style.display = 'none';
        atualizarTabelaTela();
        return;
    }

    const registrosFiltrados = [...historico].reverse().filter(reg => {
        return reg.aluno.toLowerCase().includes(termoBusca) ||
               reg.turma.toLowerCase().includes(termoBusca) ||
               reg.matricula.toLowerCase().includes(termoBusca);
    });

    if (registrosFiltrados.length === 0) {
        lista.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#777;">Nenhum registro encontrado.</td></tr>`;
        resumo.style.display = 'block';
        resumo.innerText = '🔎 Nenhum registro encontrado para essa busca.';
        return;
    }

    const qtdAtraso = registrosFiltrados.filter(r => r.tipo === 'ATRASO').length;
    const qtdSaida = registrosFiltrados.filter(r => r.tipo === 'SAÍDA').length;
    const qtdOcorrencia = registrosFiltrados.filter(r => r.tipo === 'OCORRENCIA').length;

    resumo.style.display = 'block';
    resumo.innerText = `🔎 ${registrosFiltrados.length} registro(s) no histórico completo (ano letivo): ${qtdAtraso} atraso(s), ${qtdOcorrencia} ocorrência(s), ${qtdSaida} saída(s) antecipada(s).`;

    registrosFiltrados.forEach(reg => {
        lista.innerHTML += linhaTabela(reg);
    });
}

function exportarParaCSV() {
    const historico = obterHistorico();
    if (historico.length === 0) return alert("Sem dados para exportar.");

    let csv = "\uFEFFDATA;HORARIO;TIPO;ALUNO;MATRICULA;TURMA;LOCAL;TELEFONE;MOTIVO;AUTORIZADO/REGISTRADO POR\r\n";
    historico.forEach(reg => {
        csv += `"${reg.data || '-'}";"${reg.horario}";"${reg.tipo}";"${reg.aluno}";"${reg.matricula}";"${reg.turma}";"${reg.local || '-'}";"${reg.telefone}";"${reg.motivo}";"${reg.autorizado || '-'}"\r\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio_secretaria_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

function gerarPlanilhaXLSX() {
    const historico = obterHistorico();
    const linhas = historico.map(reg => ({
        Data: reg.data || '-',
        Horario: reg.horario,
        Tipo: reg.tipo,
        Aluno: reg.aluno,
        Matricula: reg.matricula,
        Turma: reg.turma,
        Local: reg.local || '-',
        Telefone: reg.telefone,
        Motivo: reg.motivo,
        'Autorizado/Registrado por': reg.autorizado
    }));
    const planilha = XLSX.utils.json_to_sheet(linhas);
    planilha['!cols'] = [{ wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 25 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 30 }, { wch: 16 }];
    const livro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(livro, planilha, 'Registros');
    adicionarAbaResumoPorAluno(livro, historico);
    return livro;
}

// Aba "Resumo por Aluno": 3 tabelas lado a lado —
// 1) contagem por aluno+data+tipo · 2) total por aluno+tipo · 3) total geral por aluno (todos os tipos somados)
function adicionarAbaResumoPorAluno(livro, historico) {
    const contagemPorDia = new Map();
    historico.forEach(reg => {
        const chave = `${reg.aluno}||${reg.data || '-'}||${reg.tipo}`;
        contagemPorDia.set(chave, (contagemPorDia.get(chave) || 0) + 1);
    });
    const tabelaContagemDiaria = [...contagemPorDia.entries()].map(([chave, quantidade]) => {
        const [aluno, data, tipo] = chave.split('||');
        return { Aluno: aluno, Data: data, Tipo: tipo, Quantidade: quantidade };
    });

    const totalPorTipo = new Map();
    historico.forEach(reg => {
        const chave = `${reg.aluno}||${reg.tipo}`;
        totalPorTipo.set(chave, (totalPorTipo.get(chave) || 0) + 1);
    });
    const tabelaTotalPorAluno = [...totalPorTipo.entries()].map(([chave, total]) => {
        const [aluno, tipo] = chave.split('||');
        return { Aluno: aluno, Tipo: tipo, Total: total };
    });

    // Total geral por aluno, somando TODOS os tipos (atraso + ocorrência + saída) —
    // responde direto "quantas vezes esse aluno apareceu no total, no ano letivo".
    const totalGeralPorAluno = new Map();
    historico.forEach(reg => {
        totalGeralPorAluno.set(reg.aluno, (totalGeralPorAluno.get(reg.aluno) || 0) + 1);
    });
    const tabelaTotalGeral = [...totalGeralPorAluno.entries()]
        .sort((a, b) => b[1] - a[1]) // do aluno com mais registros para o com menos
        .map(([aluno, total]) => ({ Aluno: aluno, 'Total Geral (todos os tipos)': total }));

    const planilhaResumo = XLSX.utils.aoa_to_sheet([[]]);
    XLSX.utils.sheet_add_json(planilhaResumo, tabelaContagemDiaria, { origin: 'A1' });
    XLSX.utils.sheet_add_json(planilhaResumo, tabelaTotalPorAluno, { origin: 'F1' });
    XLSX.utils.sheet_add_json(planilhaResumo, tabelaTotalGeral, { origin: 'J1' });
    planilhaResumo['!cols'] = [
        { wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 11 }, { wch: 3 },
        { wch: 20 }, { wch: 14 }, { wch: 8 }, { wch: 3 },
        { wch: 20 }, { wch: 24 }
    ];
    XLSX.utils.book_append_sheet(livro, planilhaResumo, 'Resumo por Aluno');
}


function exportarParaXLSX() {
    const historico = obterHistorico();
    if (historico.length === 0) return alert("Sem dados para exportar.");

    if (typeof XLSX === 'undefined') {
        alert('A biblioteca de exportação XLSX não carregou. Verifique sua conexão com a internet.');
        return;
    }

    const livro = gerarPlanilhaXLSX();
    XLSX.writeFile(livro, `relatorio_secretaria_${new Date().toISOString().split('T')[0]}.xlsx`);
}


// ================================================================
// SINCRONIZAÇÃO EM TEMPO REAL — Firestore
// Substitui o antigo polling do Google Sheets: o onSnapshot recebe
// as mudanças automaticamente (inclusive as feitas por outros
// usuários) e também funciona com a fila offline do navegador.
// ================================================================
function iniciarListenerRegistros() {
    pararListenerRegistros();

    unsubscribeRegistros = db.collection(NOME_COLECAO_REGISTROS)
        .orderBy('criadoEm', 'asc')
        .onSnapshot((snapshot) => {
            registrosCache = snapshot.docs.map((doc) => {
                const dados = doc.data();
                return {
                    id: doc.id,
                    data: dados.data || '',
                    horario: dados.horario || '',
                    tipo: dados.tipo || '',
                    aluno: dados.aluno || '',
                    matricula: dados.matricula || '',
                    turma: dados.turma || '',
                    local: dados.local || '-',
                    telefone: dados.telefone || '',
                    motivo: dados.motivo || '',
                    autorizado: dados.autorizado || '-'
                };
            });
            atualizarTabelaTela();

            const textoSync = document.getElementById('texto-ultima-sync');
            if (textoSync) {
                const agora = new Date();
                const origem = snapshot.metadata.fromCache ? '(dados locais)' : '';
                textoSync.innerText = `atualizado às ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ${origem}`;
            }
        }, (erro) => {
            console.error('Erro ao sincronizar com o Firestore:', erro);
            const textoSync = document.getElementById('texto-ultima-sync');
            if (textoSync) textoSync.innerText = 'falha ao atualizar — verifique a internet';
        });
}

function pararListenerRegistros() {
    if (unsubscribeRegistros) {
        unsubscribeRegistros();
        unsubscribeRegistros = null;
    }
    registrosCache = [];
}
