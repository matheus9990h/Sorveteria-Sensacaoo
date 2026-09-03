process.env.TZ = 'America/Sao_Paulo';

const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Módulos de Impressão Automática
const ptp = require('pdf-to-printer');
let PDFDocument;
try {
    PDFDocument = require('pdfkit');
} catch (e) {
    console.log('💡 Para gerar comandas em PDF para impressão, instale: npm install pdfkit');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração para suporte a proxies reversos em servidores de hospedagem
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'sensacao_acai_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

// Definição do caminho do banco de dados (permite disco persistente via variável DB_PATH em nuvem)
const dbPath = process.env.DB_PATH || path.join(__dirname, 'database.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("❌ Erro ao conectar ao banco:", err.message);
    else console.log(`🗄️ Banco de dados SQLite conectado em: ${dbPath}`);
});

// Utilitários para auditoria dos acessos e ações do sistema
function obterIpCliente(req) {
    if (!req) return 'N/D';
    let ip = req.ip || req.socket?.remoteAddress || 'N/D';
    if (ip.startsWith('::ffff:')) ip = ip.substring(7);
    return ip;
}

function obterDispositivo(req) {
    const ua = String(req?.get?.('user-agent') || '').toLowerCase();
    let tipo = 'Computador';
    if (/ipad|tablet/.test(ua)) tipo = 'Tablet';
    else if (/android/.test(ua) && /mobile/.test(ua)) tipo = 'Celular Android';
    else if (/iphone|ipod/.test(ua)) tipo = 'iPhone';

    let navegador = 'Navegador';
    if (/edg\//.test(ua)) navegador = 'Edge';
    else if (/opr\//.test(ua) || /opera/.test(ua)) navegador = 'Opera';
    else if (/chrome\//.test(ua) && !/edg\//.test(ua)) navegador = 'Chrome';
    else if (/firefox\//.test(ua)) navegador = 'Firefox';
    else if (/safari\//.test(ua) && !/chrome\//.test(ua)) navegador = 'Safari';

    return `${tipo} • ${navegador}`;
}

function registrarLog(usuario, acao, detalhes = '', req = null) {
    const dataHoraBrasil = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace('T', ' ');
    const ip = obterIpCliente(req);
    const dispositivo = obterDispositivo(req);
    const userAgent = req?.get?.('user-agent') || '';
    const query = `INSERT INTO logs_sistema
        (usuario, acao, detalhes, data_hora, ip, dispositivo, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?)`;
    db.run(query, [usuario || 'Sistema', acao, detalhes, dataHoraBrasil, ip, dispositivo, userAgent], (err) => {
        if (err) console.error('Erro ao registrar log:', err.message);
    });
}

// FUNÇÃO DE IMPRESSÃO AUTOMÁTICA DE COMANDA NAS IMPRESSORAS TÉRMICAS
async function imprimirComandaAuto(pedido) {
    if (!PDFDocument) {
        console.log('⚠️ PDFKit não instalado. A comanda não foi impressa automaticamente.');
        return;
    }

    try {
        const tempDir = path.join(__dirname, 'temp_prints');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const filePath = path.join(tempDir, `comanda_${pedido.id}.pdf`);
        
        // Tamanho padrão de cupom térmico (80mm x 140mm aproximadamente em pontos)
        const doc = new PDFDocument({
            size: [226, 400],
            margin: 10
        });

        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        // Montagem do layout da comanda em PDF
        doc.fontSize(12).font('Helvetica-Bold').text('SORVETERIA SENSAÇÃO', { align: 'center' });
        doc.fontSize(10).text('Comanda de Produção', { align: 'center' });
        doc.moveDown(0.4);
        doc.fontSize(9).font('Helvetica').text('----------------------------------------', { align: 'center' });
        
        doc.font('Helvetica-Bold').text(`PEDIDO: #${pedido.id}`);
        doc.text(`CLIENTE: ${pedido.cliente}`);
        doc.font('Helvetica').text(`DATA: ${pedido.data_hora}`);
        doc.text('----------------------------------------', { align: 'center' });
        
        doc.font('Helvetica-Bold').fontSize(11).text(`ITEM: ${pedido.tamanho}`);
        doc.moveDown(0.4);

        doc.fontSize(9).font('Helvetica-Bold').text('Acompanhamentos:');
        doc.font('Helvetica').text(pedido.acompanhamentos || 'Nenhum');
        doc.moveDown(0.3);

        doc.font('Helvetica-Bold').text('Adicionais Pagos:');
        doc.font('Helvetica').text(pedido.adicionais || 'Nenhum');
        doc.moveDown(0.3);

        if (pedido.observacoes) {
            doc.font('Helvetica-Bold').text('Observações:');
            doc.font('Helvetica').text(pedido.observacoes);
            doc.moveDown(0.3);
        }

        doc.text('----------------------------------------', { align: 'center' });
        doc.font('Helvetica-Bold').fontSize(11).text(`TOTAL: R$ ${parseFloat(pedido.total || 0).toFixed(2).replace('.', ',')}`);
        doc.text('----------------------------------------', { align: 'center' });

        doc.end();

        stream.on('finish', async () => {
            try {
                // Imprime diretamente na Diebold IM453H
                await ptp.print(filePath, {
                    printer: 'Diebold IM453H'
                });

                console.log(`🖨️ Comanda do Pedido #${pedido.id} impressa com sucesso na Diebold IM453H!`);

            } catch (err) {
                console.error('❌ Falha ao enviar para a impressora:', err.message);
                console.error('⚠️ Verifique se a impressora está instalada no Windows com o nome exato: Diebold IM453H');

            } finally {
                // Remove o arquivo temporário após a tentativa de impressão
                setTimeout(() => {
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                }, 4000);
            }
        });

    } catch (err) {
        console.error('❌ Erro na geração da comanda em PDF:', err);
    }
}

// Inicialização das tabelas
db.serialize(() => {
    // Tabela de Usuários
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT NOT NULL UNIQUE,
        senha TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'funcionario'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS tamanhos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        preco REAL NOT NULL,
        disponivel INTEGER DEFAULT 1
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS acompanhamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL UNIQUE,
        disponivel INTEGER DEFAULT 1
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS adicionais (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        preco REAL NOT NULL,
        disponivel INTEGER DEFAULT 1
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS pedidos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente TEXT NOT NULL,
        tamanho TEXT NOT NULL,
        acompanhamentos TEXT,
        adicionais TEXT,
        observacoes TEXT,
        total REAL NOT NULL,
        status TEXT DEFAULT 'PENDENTE',
        data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
        data_conclusao DATETIME
    )`);

    // Tabela para salvar os registros de caixa fechado
    db.run(`CREATE TABLE IF NOT EXISTS fechamento_caixa (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data TEXT NOT NULL,
        fundo_troco REAL,
        dinheiro REAL,
        cartao REAL,
        pix REAL,
        ifood REAL,
        sangria REAL,
        total_gaveta REAL,
        faturamento_total REAL,
        responsavel TEXT,
        data_hora DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela para salvar os registros de logs no SQLite
    db.run(`CREATE TABLE IF NOT EXISTS logs_sistema (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario TEXT,
        acao TEXT NOT NULL,
        detalhes TEXT,
        data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
        ip TEXT,
        dispositivo TEXT,
        user_agent TEXT
    )`);

    // Migração automática para bancos já existentes.
    db.all("PRAGMA table_info(logs_sistema)", (err, colunas) => {
        if (err) {
            console.error('Erro ao verificar estrutura dos logs:', err.message);
            return;
        }
        const existentes = new Set((colunas || []).map(c => c.name));
        [['ip', 'TEXT'], ['dispositivo', 'TEXT'], ['user_agent', 'TEXT']].forEach(([nome, tipo]) => {
            if (!existentes.has(nome)) {
                db.run(`ALTER TABLE logs_sistema ADD COLUMN ${nome} ${tipo}`, (alterErr) => {
                    if (alterErr) console.error(`Erro ao adicionar coluna ${nome} aos logs:`, alterErr.message);
                });
            }
        });
    });

    // Carga inicial de Usuários
    db.get("SELECT COUNT(*) as count FROM usuarios", (err, row) => {
        if (row && row.count === 0) {
            const stmt = db.prepare("INSERT INTO usuarios (login, senha, role) VALUES (?, ?, ?)");
            stmt.run("Administrador", "Administrador2512*", "admin");
            stmt.run("Funcionario", "Funcionario2512*", "funcionario");
            stmt.finalize();
        }
    });

    // Carga inicial de Cardápio
    db.get("SELECT COUNT(*) as count FROM tamanhos", (err, row) => {
        if (row && row.count === 0) {
            const stmt = db.prepare("INSERT INTO tamanhos (nome, preco, disponivel) VALUES (?, ?, 1)");
            stmt.run("Copo 300ml", 14.00);
            stmt.run("Copo 400ml", 16.00);
            stmt.run("Copo 500ml", 18.00);
            stmt.run("Copo 700ml", 23.00);
            stmt.run("Copo 1L", 30.00);
            stmt.run("Tigela 500ml", 19.00);
            stmt.finalize();
        }
    });

    db.get("SELECT COUNT(*) as count FROM acompanhamentos", (err, row) => {
        if (row && row.count === 0) {
            const stmt = db.prepare("INSERT INTO acompanhamentos (nome, disponivel) VALUES (?, 1)");
            const lista = [
                'Abacaxi', 'Amendoim', 'Banana', 'Castanha de caju', 'Chocoball', 
                'Chocolate granulado', 'Confete', 'Farinha láctea', 'Granola', 
                'Jujuba', 'Leite condensado', 'Leite em pó', 'Mel', 
                'Minichocopower', 'Ovomaltine', 'Paçoca', 'Sucrilhos'
            ];
            lista.forEach(item => stmt.run(item));
            stmt.finalize();
        }
    });

    db.get("SELECT COUNT(*) as count FROM adicionais", (err, row) => {
        if (row && row.count === 0) {
            const stmt = db.prepare("INSERT INTO adicionais (nome, disponivel, preco) VALUES (?, 1, ?)");
            stmt.run("Morango", 2.00);
            stmt.run("Nutella", 5.00);
            stmt.run("Bombom Sonho de Valsa", 3.00);
            stmt.run("Bis Marrom", 3.00);
            stmt.run("Bis Branco", 3.00);
            stmt.finalize();
        }
    });
});

// Retorna a data formato YYYY-MM-DD no fuso horário do Brasil
function getLocalDateString(dateObj = new Date()) {
    return new Date(dateObj).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

// Middlewares
function authRequired(req, res, next) {
    if (req.session.user) return next();
    res.status(401).json({ error: 'Não autorizado. Faça login primeiro.' });
}

function adminOnly(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') return next();
    res.status(403).json({ error: 'Acesso negado. Requer permissão de Admin.' });
}

// Permite acesso a funcionários e administradores, bloqueando 'cliente'
function staffOnly(req, res, next) {
    if (req.session.user && req.session.user.role !== 'cliente') return next();
    res.status(403).json({ error: 'Acesso negado para o cargo cliente.' });
}

// --- PROTEÇÃO DE NAVEGAÇÃO DE PÁGINAS HTML ---
app.get('/admin.html', (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    return res.redirect('/atendimento.html');
});

app.get('/logs.html', (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    return res.redirect('/atendimento.html');
});

app.get(['/cozinha.html', '/historico.html'], (req, res, next) => {
    if (req.session.user && req.session.user.role !== 'cliente') {
        return next();
    }
    return res.redirect('/atendimento.html');
});

app.use(express.static(path.join(__dirname, 'public')));

// Rota raiz inicial
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/atendimento.html');
    }
    res.redirect('/index.html');
});

// Login / Sessão
app.post('/api/login', (req, res) => {
    const { login, senha } = req.body;
    db.get("SELECT * FROM usuarios WHERE login = ? AND senha = ?", [login, senha], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro interno no banco de dados.' });
        if (!row) {
            registrarLog('Visitante', 'LOGIN_FALHA', `Tentativa de login malsucedida para usuário: "${login}"`, req);
            return res.status(401).json({ success: false, message: 'Usuário ou senha incorretos.' });
        }

        req.session.user = { login: row.login, role: row.role };
        registrarLog(row.login, 'LOGIN', `Sessão iniciada com sucesso [Cargo: ${row.role}]`, req);

        const redirect = row.role === 'admin' ? '/admin.html' : '/atendimento.html';
        return res.json({ success: true, role: row.role, redirect });
    });
});

app.get('/api/session', (req, res) => {
    if (req.session.user) res.json({ loggedIn: true, user: req.session.user });
    else res.json({ loggedIn: false });
});

app.post('/api/logout', (req, res) => {
    const usuario = req.session.user ? req.session.user.login : 'Usuário';
    registrarLog(usuario, 'LOGOUT', 'Sessão encerrada', req);
    req.session.destroy();
    res.json({ success: true });
});

// CRUD de Usuários (Apenas Admin)
app.get('/api/admin/usuarios', adminOnly, (req, res) => {
    db.all("SELECT id, login, role FROM usuarios ORDER BY id ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/admin/usuarios', adminOnly, (req, res) => {
    const { login, senha, role } = req.body;
    if (!login || !senha) return res.status(400).json({ error: 'Login e senha são obrigatórios.' });
    
    const rolesValidos = ['admin', 'funcionario', 'cliente'];
    const userRole = rolesValidos.includes(role) ? role : 'funcionario';
    const adminUser = req.session.user ? req.session.user.login : 'Admin';

    db.run("INSERT INTO usuarios (login, senha, role) VALUES (?, ?, ?)", [login, senha, userRole], function (err) {
        if (err) return res.status(500).json({ error: 'Erro ao cadastrar usuário ou login já em uso.' });
        registrarLog(adminUser, 'CRIAR_USUARIO', `Cadastrado novo usuário "${login}" [Role: ${userRole}]`, req);
        res.json({ success: true, id: this.lastID });
    });
});

app.put('/api/admin/usuarios/:id', adminOnly, (req, res) => {
    const { id } = req.params;
    const { login, senha, role } = req.body;
    const adminUser = req.session.user ? req.session.user.login : 'Admin';

    if (!login) {
        return res.status(400).json({ error: 'O login é obrigatório.' });
    }

    const rolesValidos = ['admin', 'funcionario', 'cliente'];
    const userRole = rolesValidos.includes(role) ? role : 'funcionario';

    if (senha && senha.trim() !== '') {
        const query = "UPDATE usuarios SET login = ?, senha = ?, role = ? WHERE id = ?";
        db.run(query, [login, senha, userRole, id], function (err) {
            if (err) return res.status(500).json({ error: 'Erro ao atualizar usuário ou login já existe.' });
            registrarLog(adminUser, 'EDITAR_USUARIO', `Atualizado usuário ID #${id} (${login}) [Role: ${userRole}, Senha Alterada]`, req);
            res.json({ success: true });
        });
    } else {
        const query = "UPDATE usuarios SET login = ?, role = ? WHERE id = ?";
        db.run(query, [login, userRole, id], function (err) {
            if (err) return res.status(500).json({ error: 'Erro ao atualizar usuário ou login já existe.' });
            registrarLog(adminUser, 'EDITAR_USUARIO', `Atualizado usuário ID #${id} (${login}) [Role: ${userRole}]`, req);
            res.json({ success: true });
        });
    }
});

app.delete('/api/admin/usuarios/:id', adminOnly, (req, res) => {
    const adminUser = req.session.user ? req.session.user.login : 'Admin';
    db.run("DELETE FROM usuarios WHERE id = ?", [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        registrarLog(adminUser, 'EXCLUIR_USUARIO', `Usuário ID #${req.params.id} excluído do sistema`, req);
        res.json({ success: true });
    });
});

// Cardápio (Consulta)
app.get('/api/tamanhos', authRequired, (req, res) => {
    db.all("SELECT * FROM tamanhos", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/acompanhamentos', authRequired, (req, res) => {
    db.all("SELECT * FROM acompanhamentos ORDER BY nome ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/adicionais', authRequired, (req, res) => {
    db.all("SELECT * FROM adicionais", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Pedidos
app.post('/api/pedidos', authRequired, (req, res) => {
    const { cliente, tamanho, acompanhamentos, adicionais, observacoes, total } = req.body;
    const acompStr = Array.isArray(acompanhamentos) ? acompanhamentos.join(', ') : (acompanhamentos || '');
    const adicStr = Array.isArray(adicionais) ? adicionais.join(', ') : (adicionais || '');
    const dataHoraBrasil = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace('T', ' ');
    const usuarioAtivo = req.session.user ? req.session.user.login : 'Atendimento';

    const query = `INSERT INTO pedidos (cliente, tamanho, acompanhamentos, adicionais, observacoes, total, data_hora) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`;
    db.run(query, [cliente, tamanho, acompStr, adicStr, observacoes, total, dataHoraBrasil], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        
        const pedidoCriado = {
            id: this.lastID,
            cliente,
            tamanho,
            acompanhamentos: acompStr,
            adicionais: adicStr,
            observacoes,
            total,
            data_hora: dataHoraBrasil
        };

        // DISPARO DA IMPRESSÃO AUTOMÁTICA
        imprimirComandaAuto(pedidoCriado);

        // Log do Envio do Pedido para a Cozinha
        registrarLog(usuarioAtivo, 'NOVO_PEDIDO', `Pedido #${this.lastID} enviado para a cozinha (Cliente: ${cliente}, Item: ${tamanho}, Total: R$ ${parseFloat(total).toFixed(2)})`, req);
        res.json({ success: true, id: this.lastID });
    });
});

app.get('/api/pedidos', staffOnly, (req, res) => {
    db.all("SELECT * FROM pedidos ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/pedidos/ativos', staffOnly, (req, res) => {
    db.all("SELECT * FROM pedidos WHERE status = 'PENDENTE' ORDER BY id ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/pedidos/historico', staffOnly, (req, res) => {
    db.all("SELECT * FROM pedidos ORDER BY id DESC LIMIT 50", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.put('/api/pedidos/:id/concluir', staffOnly, (req, res) => {
    const { id } = req.params;
    const dataConclusaoLocal = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace('T', ' ');
    const usuarioAtivo = req.session.user ? req.session.user.login : 'Cozinha';

    db.run("UPDATE pedidos SET status = 'PRONTO', data_conclusao = ? WHERE id = ?", [dataConclusaoLocal, id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        
        // Log da Conclusão do Pedido
        registrarLog(usuarioAtivo, 'PEDIDO_CONCLUIDO', `Pedido #${id} finalizado na cozinha e marcado como pronto`, req);
        res.json({ success: true });
    });
});

// Rota para limpar todo o histórico de pedidos (Apenas Admin)
app.delete('/api/pedidos/limpar', adminOnly, (req, res) => {
    const adminUser = req.session.user ? req.session.user.login : 'Admin';
    db.serialize(() => {
        db.run("DELETE FROM pedidos", (err) => {
            if (err) {
                return res.status(500).json({ success: false, error: 'Erro ao limpar pedidos.' });
            }
            db.run("DELETE FROM sqlite_sequence WHERE name='pedidos'", (err2) => {
                if (err2) {
                    return res.status(500).json({ success: false, error: 'Erro ao resetar contador.' });
                }
                registrarLog(adminUser, 'LIMPAR_HISTORICO', 'Todo o histórico de pedidos foi excluído e o contador de ID foi resetado', req);
                res.json({ success: true, message: 'Histórico limpo e ID resetado com sucesso!' });
            });
        });
    });
});

// Fechamento de Caixa
app.post('/api/caixa/fechar', adminOnly, (req, res) => {
    const { fundo_troco, dinheiro, cartao, pix, ifood, sangria, total_gaveta, faturamento_total } = req.body;
    const dataAtual = getLocalDateString();
    const dataHoraBrasil = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace('T', ' ');
    const responsavel = req.session.user ? req.session.user.login : 'Administrador';

    const query = `INSERT INTO fechamento_caixa (data, fundo_troco, dinheiro, cartao, pix, ifood, sangria, total_gaveta, faturamento_total, responsavel, data_hora) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    db.run(query, [dataAtual, fundo_troco || 0, dinheiro || 0, cartao || 0, pix || 0, ifood || 0, sangria || 0, total_gaveta || 0, faturamento_total || 0, responsavel, dataHoraBrasil], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        registrarLog(responsavel, 'FECHAR_CAIXA', `Fechamento de caixa registrado para o dia ${dataAtual} - Total: R$ ${parseFloat(faturamento_total || 0).toFixed(2)}`, req);
        res.json({ success: true, id: this.lastID });
    });
});

app.get('/api/admin/relatorio', adminOnly, (req, res) => {
    const dataFiltro = req.query.data || getLocalDateString();

    db.all("SELECT * FROM pedidos WHERE status = 'PRONTO' AND data_conclusao LIKE ?", [`${dataFiltro}%`], (err, pedidosDoDia) => {
        if (err) return res.status(500).json({ error: err.message });

        const totalVendas = pedidosDoDia.reduce((acc, p) => acc + (parseFloat(p.total) || 0), 0);
        const totalPedidos = pedidosDoDia.length;

        const tamanhosCount = {};
        const adicionaisCount = {};
        const acompanhamentosCount = {};

        pedidosDoDia.forEach(p => {
            if (p.tamanho) {
                const match = p.tamanho.match(/^(\d+)x\s+(.+)$/);
                let qtdCopo = 1;
                let nomeCopo = p.tamanho;

                if (match) {
                    qtdCopo = parseInt(match[1]);
                    nomeCopo = match[2];
                }

                tamanhosCount[nomeCopo] = (tamanhosCount[nomeCopo] || 0) + qtdCopo;
            }

            if (p.adicionais && p.adicionais.trim() !== '') {
                p.adicionais.split(',').map(s => s.trim()).forEach(adic => {
                    if (adic) adicionaisCount[adic] = (adicionaisCount[adic] || 0) + 1;
                });
            }

            if (p.acompanhamentos && p.acompanhamentos.trim() !== '') {
                p.acompanhamentos.split(',').map(s => s.trim()).forEach(acomp => {
                    if (acomp) acompanhamentosCount[acomp] = (acompanhamentosCount[acomp] || 0) + 1;
                });
            }
        });

        const topTamanhos = Object.entries(tamanhosCount)
            .map(([nome, qtd]) => ({ nome, qtd }))
            .sort((a, b) => b.qtd - a.qtd);

        const topAdicionais = Object.entries(adicionaisCount)
            .map(([nome, qtd]) => ({ nome, qtd }))
            .sort((a, b) => b.qtd - a.qtd);

        const topAcompanhamentos = Object.entries(acompanhamentosCount)
            .map(([nome, qtd]) => ({ nome, qtd }))
            .sort((a, b) => b.qtd - a.qtd);

        res.json({
            totalVendas,
            totalPedidos,
            topTamanhos,
            topAdicionais,
            topAcompanhamentos
        });
    });
});

app.delete('/api/admin/relatorio/reset', adminOnly, (req, res) => {
    const adminUser = req.session.user ? req.session.user.login : 'Admin';
    db.run("DELETE FROM pedidos", [], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        registrarLog(adminUser, 'RESET_RELATORIO', 'Todos os dados de relatórios e vendas do sistema foram resetados', req);
        res.json({ success: true, message: 'Relatório resetado com sucesso!' });
    });
});

app.delete('/api/admin/resetar-pedidos', adminOnly, (req, res) => {
    const adminUser = req.session.user ? req.session.user.login : 'Admin';
    db.serialize(() => {
        db.run("DELETE FROM pedidos", (err) => {
            if (err) {
                return res.status(500).json({ success: false, message: 'Erro ao limpar pedidos.' });
            }

            db.run("DELETE FROM sqlite_sequence WHERE name='pedidos'", (err2) => {
                if (err2) {
                    return res.status(500).json({ success: false, message: 'Erro ao resetar contador.' });
                }

                registrarLog(adminUser, 'RESET_IDS_PEDIDOS', 'Pedidos apagados e contador de ID reiniciado para 1', req);
                res.json({ success: true, message: 'Pedidos zerados e ID resetado com sucesso!' });
            });
        });
    });
});

// Admin CRUD Cardápio & Controle de Disponibilidade
app.post('/api/tamanhos', adminOnly, (req, res) => {
    const { nome, preco, disponivel } = req.body;
    const statusDisp = disponivel !== undefined ? (disponivel ? 1 : 0) : 1;
    const adminUser = req.session.user ? req.session.user.login : 'Admin';

    db.run("INSERT INTO tamanhos (nome, preco, disponivel) VALUES (?, ?, ?)", [nome, preco, statusDisp], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        registrarLog(adminUser, 'CRIAR_TAMANHO', `Cadastrado novo tamanho/copo "${nome}" - Preço: R$ ${parseFloat(preco).toFixed(2)}`, req);
        res.json({ success: true, id: this.lastID });
    });
});

app.put('/api/tamanhos/:id', adminOnly, (req, res) => {
    const { nome, preco, disponivel } = req.body;
    const adminUser = req.session.user ? req.session.user.login : 'Admin';

    if (disponivel !== undefined && nome === undefined && preco === undefined) {
        db.run("UPDATE tamanhos SET disponivel = ? WHERE id = ?", [disponivel ? 1 : 0, req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            registrarLog(adminUser, 'BLOQUEIO_ESTOQUE', `Disponibilidade do Tamanho ID #${req.params.id} alterada para [${disponivel ? 'Disponível' : 'Indisponível'}]`, req);
            res.json({ success: true });
        });
    } else if (nome) {
        const statusDisp = disponivel !== undefined ? (disponivel ? 1 : 0) : 1;
        db.run("UPDATE tamanhos SET nome = ?, preco = ?, disponivel = ? WHERE id = ?", [nome, preco, statusDisp, req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            registrarLog(adminUser, 'EDITAR_TAMANHO', `Tamanho ID #${req.params.id} alterado para "${nome}" - R$ ${parseFloat(preco).toFixed(2)}`, req);
            res.json({ success: true });
        });
    } else {
        db.run("UPDATE tamanhos SET preco = ? WHERE id = ?", [preco, req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            registrarLog(adminUser, 'EDITAR_TAMANHO', `Preço do Tamanho ID #${req.params.id} alterado para R$ ${parseFloat(preco).toFixed(2)}`, req);
            res.json({ success: true });
        });
    }
});

app.put('/api/tamanhos/:id/status', adminOnly, (req, res) => {
    const { disponivel } = req.body;
    const adminUser = req.session.user ? req.session.user.login : 'Admin';
    db.run("UPDATE tamanhos SET disponivel = ? WHERE id = ?", [disponivel ? 1 : 0, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        registrarLog(adminUser, 'BLOQUEIO_ESTOQUE', `Disponibilidade do Tamanho ID #${req.params.id} alterada para [${disponivel ? 'Disponível' : 'Indisponível'}]`, req);
        res.json({ success: true });
    });
});

app.delete('/api/tamanhos/:id', adminOnly, (req, res) => {
    const adminUser = req.session.user ? req.session.user.login : 'Admin';
    db.run("DELETE FROM tamanhos WHERE id = ?", [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        registrarLog(adminUser, 'EXCLUIR_TAMANHO', `Tamanho/Copo ID #${req.params.id} excluído do cardápio`, req);
        res.json({ success: true });
    });
});

app.post('/api/acompanhamentos', adminOnly, (req, res) => {
    const { nome, disponivel } = req.body;
    const statusDisp = disponivel !== undefined ? (disponivel ? 1 : 0) : 1;
    const adminUser = req.session.user ? req.session.user.login : 'Admin';

    db.run("INSERT INTO acompanhamentos (nome, disponivel) VALUES (?, ?)", [nome, statusDisp], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        registrarLog(adminUser, 'CRIAR_ACOMPANHAMENTO', `Cadastrado novo acompanhamento "${nome}"`, req);
        res.json({ success: true, id: this.lastID });
    });
});

app.put('/api/acompanhamentos/:id', adminOnly, (req, res) => {
    const { nome, disponivel } = req.body;
    const adminUser = req.session.user ? req.session.user.login : 'Admin';

    if (disponivel !== undefined && nome === undefined) {
        db.run("UPDATE acompanhamentos SET disponivel = ? WHERE id = ?", [disponivel ? 1 : 0, req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            registrarLog(adminUser, 'BLOQUEIO_ESTOQUE', `Disponibilidade do Acompanhamento ID #${req.params.id} alterada para [${disponivel ? 'Disponível' : 'Indisponível'}]`, req);
            res.json({ success: true });
        });
    } else {
        db.run("UPDATE acompanhamentos SET nome = ? WHERE id = ?", [nome, req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            registrarLog(adminUser, 'EDITAR_ACOMPANHAMENTO', `Acompanhamento ID #${req.params.id} renomeado para "${nome}"`, req);
            res.json({ success: true });
        });
    }
});

app.put('/api/acompanhamentos/:id/status', adminOnly, (req, res) => {
    const { disponivel } = req.body;
    const adminUser = req.session.user ? req.session.user.login : 'Admin';
    db.run("UPDATE acompanhamentos SET disponivel = ? WHERE id = ?", [disponivel ? 1 : 0, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        registrarLog(adminUser, 'BLOQUEIO_ESTOQUE', `Disponibilidade do Acompanhamento ID #${req.params.id} alterada para [${disponivel ? 'Disponível' : 'Indisponível'}]`, req);
        res.json({ success: true });
    });
});

app.delete('/api/acompanhamentos/:id', adminOnly, (req, res) => {
    const adminUser = req.session.user ? req.session.user.login : 'Admin';
    db.run("DELETE FROM acompanhamentos WHERE id = ?", [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        registrarLog(adminUser, 'EXCLUIR_ACOMPANHAMENTO', `Acompanhamento ID #${req.params.id} excluído do cardápio`, req);
        res.json({ success: true });
    });
});

app.post('/api/adicionais', adminOnly, (req, res) => {
    const { nome, preco, disponivel } = req.body;
    const statusDisp = disponivel !== undefined ? (disponivel ? 1 : 0) : 1;
    const adminUser = req.session.user ? req.session.user.login : 'Admin';

    db.run("INSERT INTO adicionais (nome, preco, disponivel) VALUES (?, ?, ?)", [nome, preco, statusDisp], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        registrarLog(adminUser, 'CRIAR_ADICIONAL', `Cadastrado novo adicional "${nome}" - Preço: R$ ${parseFloat(preco).toFixed(2)}`, req);
        res.json({ success: true, id: this.lastID });
    });
});

app.put('/api/adicionais/:id', adminOnly, (req, res) => {
    const { nome, preco, disponivel } = req.body;
    const adminUser = req.session.user ? req.session.user.login : 'Admin';

    if (disponivel !== undefined && nome === undefined && preco === undefined) {
        db.run("UPDATE adicionais SET disponivel = ? WHERE id = ?", [disponivel ? 1 : 0, req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            registrarLog(adminUser, 'BLOQUEIO_ESTOQUE', `Disponibilidade do Adicional ID #${req.params.id} alterada para [${disponivel ? 'Disponível' : 'Indisponível'}]`, req);
            res.json({ success: true });
        });
    } else {
        const statusDisp = disponivel !== undefined ? (disponivel ? 1 : 0) : 1;
        db.run("UPDATE adicionais SET nome = ?, preco = ?, disponivel = ? WHERE id = ?", [nome, preco, statusDisp, req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            registrarLog(adminUser, 'EDITAR_ADICIONAL', `Adicional ID #${req.params.id} alterado para "${nome}" - R$ ${parseFloat(preco).toFixed(2)}`, req);
            res.json({ success: true });
        });
    }
});

app.put('/api/adicionais/:id/status', adminOnly, (req, res) => {
    const { disponivel } = req.body;
    const adminUser = req.session.user ? req.session.user.login : 'Admin';
    db.run("UPDATE adicionais SET disponivel = ? WHERE id = ?", [disponivel ? 1 : 0, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        registrarLog(adminUser, 'BLOQUEIO_ESTOQUE', `Disponibilidade do Adicional ID #${req.params.id} alterada para [${disponivel ? 'Disponível' : 'Indisponível'}]`, req);
        res.json({ success: true });
    });
});

app.delete('/api/adicionais/:id', adminOnly, (req, res) => {
    const adminUser = req.session.user ? req.session.user.login : 'Admin';
    db.run("DELETE FROM adicionais WHERE id = ?", [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        registrarLog(adminUser, 'EXCLUIR_ADICIONAL', `Adicional ID #${req.params.id} excluído do cardápio`, req);
        res.json({ success: true });
    });
});

// Endpoint da API para buscar os logs cadastrados (Apenas Admin)
app.get('/api/admin/logs', adminOnly, (req, res) => {
    db.all(`SELECT id, usuario, acao, detalhes, data_hora, ip, dispositivo, user_agent
            FROM logs_sistema
            ORDER BY id DESC
            LIMIT 300`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ======================================================
// API EXCLUSIVA DO AGENTE DE IMPRESSÃO
// ======================================================

const CHAVE_AGENTE_IMPRESSAO =
    process.env.CHAVE_AGENTE_IMPRESSAO || 'SENSAO-IMPRESSAO-2026';

app.get('/api/impressao/pedidos', (req, res) => {
    const chaveRecebida = req.headers['x-chave-impressao'];

    if (chaveRecebida !== CHAVE_AGENTE_IMPRESSAO) {
        console.log('❌ Tentativa de acesso não autorizada à API de impressão.');

        return res.status(403).json({
            success: false,
            error: 'Acesso negado.'
        });
    }

    db.all(
        "SELECT * FROM pedidos WHERE status = 'PENDENTE' ORDER BY id ASC",
        [],
        (err, rows) => {
            if (err) {
                console.error(
                    '❌ Erro ao buscar pedidos para impressão:',
                    err.message
                );

                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.json(rows);
        }
    );
});

app.listen(PORT, () => {
    console.log(`
  🍧 SORVETERIA SENSAÇÃO - GESTOR DE PEDIDOS AÇAI
  🚀 Servidor rodando com sucesso!
  📌 Porta ativa: ${PORT}
  🔗 Acesse o sistema em: http://localhost:${PORT}
    `);
});