const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const ptp = require('pdf-to-printer');

const SITE =
    'https://sorveteria-sensacaoo-production.up.railway.app';

const CHAVE =
    'SENSAO-IMPRESSAO-2026';

const INTERVALO =
    2000;

const ARQUIVO_CONTROLE =
    path.join(
        __dirname,
        'ultimo_pedido_impresso.json'
    );

// ======================================================
// CONTROLE
// ======================================================

let ultimoPedidoImpresso = 0;

let verificacaoEmAndamento = false;

const pedidosEmProcessamento =
    new Set();

// ======================================================
// CARREGA ÚLTIMO PEDIDO
// ======================================================
if (
    fs.existsSync(
        ARQUIVO_CONTROLE
    )
) {

    try {

        const dados =
            JSON.parse(
                fs.readFileSync(
                    ARQUIVO_CONTROLE,
                    'utf8'
                )
            );

        ultimoPedidoImpresso =
            Number(
                dados.ultimoPedidoImpresso
            ) || 0;

    } catch {

        ultimoPedidoImpresso = 0;

    }
}

// ======================================================
// SALVA ÚLTIMO PEDIDO
// ======================================================

function salvarUltimoPedido(id) {

    fs.writeFileSync(
        ARQUIVO_CONTROLE,
        JSON.stringify(
            {
                ultimoPedidoImpresso: id
            },
            null,
            2
        )
    );
}

// ======================================================
// PROCURA IMPRESSORA
// ======================================================

async function verificarImpressora() {

    try {

        const impressoras =
            await ptp.getPrinters();

        console.log(
            '🖨️ Impressoras encontradas:'
        );

        if (
            !impressoras ||
            impressoras.length === 0
        ) {

            console.log(
                '❌ Nenhuma impressora encontrada.'
            );

            return null;
        }

        impressoras.forEach(
            impressora => {

                console.log(
                    ` - ${impressora.name}`
                );

            }
        );

        const encontrada =
            impressoras.find(
                impressora => {

                    const nome =
                        String(
                            impressora.name || ''
                        ).toLowerCase();

                    return (
                        nome.includes('im453h') ||
                        nome.includes('procomp') ||
                        nome.includes('diebold')
                    );
                }
            );

        if (encontrada) {

            console.log(
                `✅ Impressora encontrada: ${encontrada.name}`
            );

            return encontrada.name;
        }

        console.log(
            '❌ Diebold IM453H não encontrada.'
        );

        return null;

    } catch (erro) {

        console.error(
            '❌ Erro ao localizar impressora:',
            erro.message
        );

        return null;
    }
}

// ======================================================
// TEXTO SEGURO
// ======================================================

function textoSeguro(valor) {

    if (
        valor === null ||
        valor === undefined
    ) {

        return '';

    }

    return String(valor);
}

// ======================================================
// TRANSFORMA LISTAS
// ======================================================

function transformarLista(valor) {

    if (
        !valor ||
        String(valor).trim() === ''
    ) {

        return [];

    }

    return String(valor)
        .split(',')
        .map(
            item =>
                item
                    .trim()
                    .replace(/\s+/g, ' ')
        )
        .filter(Boolean);
}

// ======================================================
// QUEBRA TEXTO
// ======================================================

function quebrarTexto(
    texto,
    limite
) {

    texto =
        textoSeguro(texto)
            .trim();

    if (!texto) {
        return [''];
    }

    const palavras =
        texto.split(/\s+/);

    const linhas = [];

    let linha = '';

    for (
        const palavra of palavras
    ) {

        const teste =
            linha
                ? `${linha} ${palavra}`
                : palavra;

        if (
            teste.length <= limite
        ) {

            linha = teste;

        } else {

            if (linha) {

                linhas.push(
                    linha
                );

            }

            // Palavra muito grande
            if (
                palavra.length > limite
            ) {

                let restante =
                    palavra;

                while (
                    restante.length > limite
                ) {

                    linhas.push(
                        restante.substring(
                            0,
                            limite
                        )
                    );

                    restante =
                        restante.substring(
                            limite
                        );
                }

                linha =
                    restante;

            } else {

                linha =
                    palavra;

            }
        }
    }

    if (linha) {

        linhas.push(
            linha
        );
    }

    return linhas;
}

// ======================================================
// GERA COMANDA
// ======================================================

async function gerarComanda(pedido) {

    const pasta =
        path.join(
            __dirname,
            'comandas'
        );

    if (
        !fs.existsSync(pasta)
    ) {

        fs.mkdirSync(
            pasta,
            {
                recursive: true
            }
        );
    }

    const arquivo =
        path.join(
            pasta,
            `comanda_${pedido.id}.pdf`
        );

    // ==================================================
    // PAPEL 80 MM
    // ==================================================

    const LARGURA_PAPEL =
        226.77;

    const MARGEM =
        10;

    const LARGURA_CONTEUDO =
        LARGURA_PAPEL -
        (MARGEM * 2);

    // ==================================================
    // DATA E HORA
    // ==================================================

    const dataOriginal =
        textoSeguro(
            pedido.data_hora
        );

    let dataObj;

    if (dataOriginal) {

        dataObj =
            new Date(
                dataOriginal.replace(
                    ' ',
                    'T'
                )
            );

        if (
            isNaN(
                dataObj.getTime()
            )
        ) {

            dataObj =
                new Date();

        }

    } else {

        dataObj =
            new Date();

    }

    const dataFormatada =
        dataObj.toLocaleDateString(
            'pt-BR'
        );

    const horaFormatada =
        dataObj.toLocaleTimeString(
            'pt-BR',
            {
                hour: '2-digit',
                minute: '2-digit'
            }
        );

    // ==================================================
    // DADOS
    // ==================================================

    const cliente =
        textoSeguro(
            pedido.cliente
        );

    const produto =
        textoSeguro(
            pedido.tamanho
        );

    const observacoes =
        textoSeguro(
            pedido.observacoes
        ).trim();

    const acompanhamentos =
        transformarLista(
            pedido.acompanhamentos
        );

    const adicionais =
        transformarLista(
            pedido.adicionais
        );

    // ==================================================
    // JUNTA ACOMPANHAMENTOS + ADICIONAIS
    // ==================================================

    const itens =
        [
            ...acompanhamentos,
            ...adicionais
        ];

    // ==================================================
    // TAMANHO DAS LETRAS
    // ==================================================

    const TAMANHO_HEADER = 14;
    const TAMANHO_PEDIDO = 12;
    const TAMANHO_DATA = 10;
    const TAMANHO_CLIENTE = 11;
    const TAMANHO_PRODUTO = 12;
    const TAMANHO_ITEM = 11;
    const TAMANHO_OBSERVACAO = 10;
    const TAMANHO_TOTAL = 13;
    const TAMANHO_RODAPE = 10;

    // ==================================================
    // QUANTIDADE DE LINHAS
    // ==================================================

    const clienteLinhas =
        quebrarTexto(
            `Cliente: ${cliente}`,
            31
        );

    const produtoLinhas =
        quebrarTexto(
            produto,
            31
        );

    let quantidadeLinhas = 0;

    // Cabeçalho
    quantidadeLinhas += 1;

    // Linha
    quantidadeLinhas += 1;

    // Pedido
    quantidadeLinhas += 2;

    // Linha
    quantidadeLinhas += 1;

    // Cliente
    quantidadeLinhas +=
        clienteLinhas.length;

    // Linha
    quantidadeLinhas += 1;

    // Produto
    quantidadeLinhas +=
        produtoLinhas.length;

    // Linha
    quantidadeLinhas += 1;

    // Itens
    if (
        itens.length > 0
    ) {

        itens.forEach(
            item => {

                quantidadeLinhas +=
                    quebrarTexto(
                        `• ${item}`,
                        30
                    ).length;

            }
        );

    } else {

        quantidadeLinhas += 1;

    }

    // Observações
    if (
        observacoes
    ) {

        quantidadeLinhas += 1;

        quantidadeLinhas +=
            quebrarTexto(
                observacoes,
                31
            ).length;
    }

    // Linha antes do total
    quantidadeLinhas += 1;

    // Total
    quantidadeLinhas += 1;

    // Linha final
    quantidadeLinhas += 1;

    // Rodapé
    quantidadeLinhas += 2;

    // ==================================================
    // ALTURA DO PAPEL
    // ==================================================

    const ALTURA_PAPEL =
        Math.max(
            390,
            45 +
            (quantidadeLinhas * 17)
        );

    console.log(
        `📄 Tamanho: 80mm x ${ALTURA_PAPEL.toFixed(0)} pontos`
    );

    // ==================================================
    // CRIA PDF
    // ==================================================

    const doc =
        new PDFDocument({

            size: [
                LARGURA_PAPEL,
                ALTURA_PAPEL
            ],

            margins: {
                top: 8,
                bottom: 8,
                left: MARGEM,
                right: MARGEM
            },

            autoFirstPage: true
        });

    const stream =
        fs.createWriteStream(
            arquivo
        );

    doc.pipe(stream);

    // ==================================================
    // LINHA PONTILHADA DE PONTA A PONTA
    // ==================================================

    function linha() {

        const y =
            doc.y + 2;

        doc
            .save()
            .lineWidth(0.7)
            .dash(
                1.5,
                {
                    space: 2.5
                }
            )
            .moveTo(
                MARGEM,
                y
            )
            .lineTo(
                LARGURA_PAPEL - MARGEM,
                y
            )
            .stroke()
            .undash()
            .restore();

        doc.y =
            y + 7;

        doc.x =
            MARGEM;
    }

    // ==================================================
    // CABEÇALHO
    // ==================================================

    doc
        .font('Courier-Bold')
        .fontSize(
            TAMANHO_HEADER
        )
        .text(
            'SORVETERIA SENSACAO',
            MARGEM,
            doc.y,
            {
                width:
                    LARGURA_CONTEUDO,

                align:
                    'center',

                lineBreak:
                    false,

                lineGap:
                    0
            }
        );

    doc.moveDown(0.10);

    linha();

    // ==================================================
    // PEDIDO
    // ==================================================

    doc
        .font('Courier-Bold')
        .fontSize(
            TAMANHO_PEDIDO
        )
        .text(
            `PEDIDO #${pedido.id}`,
            MARGEM,
            doc.y,
            {
                width:
                    LARGURA_CONTEUDO,

                lineBreak:
                    false,

                lineGap:
                    0
            }
        );

    doc
        .font('Courier-Bold')
        .fontSize(
            TAMANHO_DATA
        )
        .text(
            `${dataFormatada}, ${horaFormatada}`,
            MARGEM,
            doc.y + 1,
            {
                width:
                    LARGURA_CONTEUDO,

                lineBreak:
                    false,

                lineGap:
                    0
            }
        );

    doc.moveDown(0.10);

    linha();

    // ==================================================
    // CLIENTE
    // ==================================================

    clienteLinhas.forEach(
        texto => {

            doc
                .font('Courier-Bold')
                .fontSize(
                    TAMANHO_CLIENTE
                )
                .text(
                    texto,
                    MARGEM,
                    doc.y,
                    {
                        width:
                            LARGURA_CONTEUDO,

                        lineBreak:
                            false,

                        lineGap:
                            0
                    }
                );

        }
    );

    doc.moveDown(0.08);

    linha();

    // ==================================================
    // PRODUTO
    // ==================================================

    produtoLinhas.forEach(
        texto => {

            doc
                .font('Courier-Bold')
                .fontSize(
                    TAMANHO_PRODUTO
                )
                .text(
                    texto,
                    MARGEM,
                    doc.y,
                    {
                        width:
                            LARGURA_CONTEUDO,

                        lineBreak:
                            false,

                        lineGap:
                            0
                    }
                );

        }
    );

    doc.moveDown(0.08);

    linha();

    // ==================================================
    // ACOMPANHAMENTOS + ADICIONAIS
    // SEM TÍTULO
    // SEM "(GRÁTIS)"
    // ==================================================

    if (
        itens.length > 0
    ) {

        itens.forEach(
            item => {

                const linhasItem =
                    quebrarTexto(
                        `• ${item}`,
                        30
                    );

                linhasItem.forEach(
                    texto => {

                        doc
                            .font('Courier-Bold')
                            .fontSize(
                                TAMANHO_ITEM
                            )
                            .text(
                                texto,
                                MARGEM,
                                doc.y,
                                {
                                    width:
                                        LARGURA_CONTEUDO,

                                    lineBreak:
                                        false,

                                    lineGap:
                                        0
                                }
                            );

                    }
                );

            }
        );

    } else {

        doc
            .font('Courier-Bold')
            .fontSize(
                TAMANHO_ITEM
            )
            .text(
                '• Nenhum',
                MARGEM,
                doc.y,
                {
                    width:
                        LARGURA_CONTEUDO,

                    lineBreak:
                        false,

                    lineGap:
                        0
                }
            );
    }

    // ==================================================
    // OBSERVAÇÕES
    // ==================================================

    if (
        observacoes
    ) {

        doc.moveDown(0.08);

        const linhasObs =
            quebrarTexto(
                observacoes,
                31
            );

        linhasObs.forEach(
            texto => {

                doc
                    .font('Courier-Bold')
                    .fontSize(
                        TAMANHO_OBSERVACAO
                    )
                    .text(
                        texto,
                        MARGEM,
                        doc.y,
                        {
                            width:
                                LARGURA_CONTEUDO,

                            lineBreak:
                                false,

                            lineGap:
                                0
                        }
                    );

            }
        );
    }

    doc.moveDown(0.10);

    // ==================================================
    // LINHA ANTES DO TOTAL
    // ==================================================

    linha();

    // ==================================================
    // TOTAL
    // ==================================================

    const valorTotal =
        parseFloat(
            pedido.total
        );

    const totalFormatado =
        !isNaN(valorTotal)
            ? valorTotal
                .toFixed(2)
                .replace('.', ',')
            : '0,00';

    const yTotal =
        doc.y;

    // --------------------------------------------------
    // TOTAL
    // --------------------------------------------------

    doc
        .font('Courier-Bold')
        .fontSize(
            TAMANHO_TOTAL
        )
        .text(
            'TOTAL',
            MARGEM,
            yTotal,
            {
                width:
                    70,

                align:
                    'left',

                lineBreak:
                    false,

                lineGap:
                    0
            }
        );

    // --------------------------------------------------
    // VALOR MAIS PARA DENTRO
    // --------------------------------------------------

    doc
        .font('Courier-Bold')
        .fontSize(
            TAMANHO_TOTAL
        )
        .text(
            `R$ ${totalFormatado}`,
            80,
            yTotal,
            {
                width:
                    125,

                align:
                    'right',

                lineBreak:
                    false,

                lineGap:
                    0,

                ellipsis:
                    false
            }
        );

    doc.y =
        yTotal + 19;

    doc.x =
        MARGEM;

    // ==================================================
    // LINHA FINAL
    // ==================================================

    linha();

    // ==================================================
    // RODAPÉ
    // ==================================================

    doc
        .font('Courier-Bold')
        .fontSize(
            TAMANHO_RODAPE
        )
        .text(
            'Obrigado pela preferência!',
            MARGEM,
            doc.y,
            {
                width:
                    LARGURA_CONTEUDO,

                align:
                    'center',

                lineBreak:
                    false,

                lineGap:
                    0
            }
        );

    doc.moveDown(0.08);

    doc
        .font('Courier-Bold')
        .fontSize(
            TAMANHO_RODAPE
        )
        .text(
            'Volte sempre!',
            MARGEM,
            doc.y,
            {
                width:
                    LARGURA_CONTEUDO,

                align:
                    'center',

                lineBreak:
                    false,

                lineGap:
                    0
            }
        );

    // ==================================================
    // FINALIZA PDF
    // ==================================================

    doc.end();

    await new Promise(
        (resolve, reject) => {

            stream.on(
                'finish',
                resolve
            );

            stream.on(
                'error',
                reject
            );
        }
    );

    return arquivo;
}

// ======================================================
// IMPRIME PEDIDO
// ======================================================

async function imprimirPedido(
    pedido,
    impressora
) {

    try {

        console.log(
            `🖨️ Imprimindo pedido #${pedido.id}...`
        );

        const arquivo =
            await gerarComanda(
                pedido
            );

        await ptp.print(
            arquivo,
            {
                printer:
                    impressora,

                silent:
                    true,

                scale:
                    'noscale'
            }
        );

        console.log(
            `✅ Pedido #${pedido.id} impresso com sucesso!`
        );

        ultimoPedidoImpresso =
            Number(
                pedido.id
            );

        salvarUltimoPedido(
            ultimoPedidoImpresso
        );

        fs.unlink(
            arquivo,
            () => {}
        );

        return true;

    } catch (erro) {

        console.error(
            `❌ Erro ao imprimir pedido #${pedido.id}:`,
            erro.message
        );

        console.error(
            `🖨️ Impressora: "${impressora}"`
        );

        return false;
    }
}

// ======================================================
// BUSCA PEDIDOS
// ======================================================

async function verificarPedidos(
    impressora
) {

    if (
        verificacaoEmAndamento
    ) {

        return;
    }

    verificacaoEmAndamento =
        true;

    try {

        console.log(
            '🔎 Verificando novos pedidos...'
        );

        const resposta =
            await fetch(
                `${SITE}/api/impressao/pedidos`,
                {
                    headers: {
                        'x-chave-impressao':
                            CHAVE
                    }
                }
            );

        console.log(
            `📡 Status da API: ${resposta.status}`
        );

        if (
            !resposta.ok
        ) {

            console.error(
                '❌ API retornou:',
                resposta.status
            );

            const textoErro =
                await resposta.text();

            console.error(
                'Resposta:',
                textoErro
            );

            return;
        }

        const pedidos =
            await resposta.json();

        if (
            !Array.isArray(
                pedidos
            )
        ) {

            console.error(
                '❌ A resposta da API não é uma lista.'
            );

            return;
        }

        console.log(
            `📦 Pedidos recebidos: ${pedidos.length}`
        );

        if (
            pedidos.length === 0
        ) {

            console.log(
                '✅ Nenhum pedido pendente.'
            );

            return;
        }

        // ==================================================
        // DETECTA RESET DO CONTADOR
        // ==================================================

        const maiorIdAtual =
            Math.max(
                ...pedidos.map(
                    p =>
                        Number(
                            p.id
                        ) || 0
                )
            );

        if (
            maiorIdAtual <
            ultimoPedidoImpresso
        ) {

            console.log(
                '🔄 Reset do contador detectado.'
            );

            ultimoPedidoImpresso =
                0;

            salvarUltimoPedido(
                0
            );
        }

        // ==================================================
        // PROCESSA PEDIDOS
        // ==================================================

        for (
            const pedido
            of pedidos
        ) {

            const idPedido =
                Number(
                    pedido.id
                );

            console.log(
                `📋 Pedido encontrado: #${idPedido}`
            );

            if (
                !idPedido
            ) {

                console.log(
                    '⚠️ Pedido sem ID válido.'
                );

                continue;
            }

            if (
                idPedido <=
                ultimoPedidoImpresso
            ) {

                console.log(
                    `⏭️ Pedido #${idPedido} já foi processado.`
                );

                continue;
            }

            if (
                pedidosEmProcessamento.has(
                    idPedido
                )
            ) {

                console.log(
                    `⏳ Pedido #${idPedido} já está sendo processado.`
                );

                continue;
            }

            pedidosEmProcessamento.add(
                idPedido
            );

            try {

                const sucesso =
                    await imprimirPedido(
                        pedido,
                        impressora
                    );

                if (
                    sucesso
                ) {

                    console.log(
                        `✅ Pedido #${idPedido} finalizado.`
                    );

                } else {

                    console.log(
                        `⚠️ Pedido #${idPedido} não foi marcado como impresso.`
                    );
                }

            } finally {

                pedidosEmProcessamento.delete(
                    idPedido
                );
            }
        }

    } catch (erro) {

        console.error(
            '❌ Erro consultando pedidos:',
            erro.message
        );

    } finally {

        verificacaoEmAndamento =
            false;
    }
}

// ======================================================
// INICIA AGENTE
// ======================================================

async function iniciar() {

    console.log(
        '========================================'
    );

    console.log(
        '🍧 AGENTE DE IMPRESSÃO - SENSAÇÃO'
    );

    console.log(
        '========================================'
    );

    const impressora =
        await verificarImpressora();

    if (
        !impressora
    ) {

        console.error(
            '❌ A Diebold IM453H não foi encontrada.'
        );

        process.exit(1);
    }

    console.log(
        `🖨️ Usando impressora: ${impressora}`
    );

    console.log(
        `🌐 Site: ${SITE}`
    );

    console.log(
        '📏 Papel: 80 mm'
    );

    console.log(
        '🖨️ Escala: noscale'
    );

    console.log(
        '🔤 Letras aumentadas'
    );

    console.log(
        '📏 Linhas pontilhadas de ponta a ponta'
    );

    console.log(
        '💰 Total ajustado para aparecer completo'
    );

    console.log(
        '🍨 Acompanhamentos e adicionais juntos'
    );

    console.log(
        '========================================'
    );

    console.log(
        '✅ Agente iniciado.'
    );

    // ==================================================
    // PRIMEIRA VERIFICAÇÃO
    // ==================================================

    await verificarPedidos(
        impressora
    );

    // ==================================================
    // CONTINUA VERIFICANDO
    // ==================================================

    setInterval(
        () => {

            verificarPedidos(
                impressora
            );

        },
        INTERVALO
    );
}

// ======================================================
// START
// ======================================================

iniciar();