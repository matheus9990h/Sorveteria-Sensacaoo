
const express = require('express');
const cors = require('cors');
const { print } = require('pdf-to-printer'); // ou biblioteca de impressão direta
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/imprimir-silencioso', async (req, res) => {
    const { pedido } = req.body;
    
    // Cria o HTML/Texto da comanda
    const textoComanda = `
=================================
       SORVETERIA SENSAÇÃO
=================================
PEDIDO #${pedido.id}
Data: ${pedido.data_hora || new Date().toLocaleString('pt-BR')}
---------------------------------
Cliente: ${pedido.cliente}
---------------------------------
${pedido.tamanho}

Acompanhamentos:
${(pedido.acompanhamentos || '').split(',').map(a => ' • ' + a.trim()).join('\n')}

${pedido.adicionais ? 'Adicionais:\n' + pedido.adicionais.split(',').map(a => ' • ' + a.trim()).join('\n') : ''}
${pedido.observacoes ? '\nObs: ' + pedido.observacoes : ''}
---------------------------------
TOTAL: R$ ${parseFloat(pedido.total).toFixed(2)}
---------------------------------
    Obrigado pela preferência!
          Volte sempre! 🍧
=================================\n\n\n`;

    // Salva arquivo temporário para enviar à impressora
    const filePath = path.join(__dirname, 'comanda_temp.txt');
    fs.writeFileSync(filePath, textoComanda, 'utf-8');

    // Executa comando de impressão direta do sistema operacional (Windows/Linux)
    const exec = require('child_process').exec;
    exec(`cmd /c print /d:LPT1 "${filePath}"`, (err) => { // Ou usando a impressora padrão do Windows
        if (err) {
            console.error('Erro ao imprimir:', err);
            return res.status(500).send('Erro na impressão');
        }
        res.send({ status: 'Impresso com sucesso!' });
    });
});

app.listen(3001, () => console.log('🖨️ Servidor de Impressão rodando na porta 3001'));