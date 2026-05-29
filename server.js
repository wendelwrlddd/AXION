const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const monitor = require('./monitor');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Set de conexões SSE ativas para envio em tempo real
const clients = new Set();

// Endpoint do Stream Server-Sent Events (SSE) para atualizações instantâneas
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  clients.add(res);
  
  // Envia ping de conexão estabelecida
  res.write(`data: ${JSON.stringify({ event: "connected", timestamp: Date.now() })}\n\n`);

  req.on('close', () => {
    clients.delete(res);
  });
});

// Vincula a transmissão do monitor ao nosso canal SSE
monitor.setSSEBroadcast((payload) => {
  const dataString = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    try {
      client.write(dataString);
    } catch (err) {
      // Ignora conexões quebradas que não foram limpas
    }
  }
});

/**
 * API: Obter todas as moedas na Triagem 2 (ativas nos 15 minutos pós-DEX paid)
 * Retorna também o histórico temporal de cada uma para remontar os gráficos no front-end ao atualizar a tela.
 */
app.get('/api/active', async (req, res) => {
  try {
    const active = await db.getActiveCoins();
    const result = [];
    
    for (const coin of active) {
      const history = await db.getHistoryForCoin(coin.address);
      result.push({
        address: coin.address,
        ticker: coin.ticker,
        name: coin.name,
        initialMarketCap: coin.initial_market_cap,
        initialProgress: coin.initial_progress,
        initialDevHold: coin.initial_dev_hold,
        paidAt: new Date(coin.paid_at).getTime(),
        history: history.map(h => ({
          marketCap: h.market_cap,
          progress: h.progress,
          devHold: h.dev_hold,
          timestamp: new Date(h.timestamp).getTime(),
          elapsedSeconds: Math.round((new Date(h.timestamp) - new Date(coin.paid_at)) / 1000)
        }))
      });
    }
    
    res.json(result);
  } catch (err) {
    console.error("❌ API: Erro em /api/active:", err.message);
    res.status(500).json({ error: "Erro interno ao buscar moedas ativas." });
  }
});

/**
 * API: Obter todas as moedas na Triagem 3 (histórico estático arquivado)
 */
app.get('/api/history', async (req, res) => {
  try {
    const history = await db.getHistoricalCoins();
    res.json(history);
  } catch (err) {
    console.error("❌ API: Erro em /api/history:", err.message);
    res.status(500).json({ error: "Erro interno ao buscar histórico." });
  }
});

/**
 * API: Exportar dados em formato CSV plano
 */
app.get('/api/export/csv', async (req, res) => {
  try {
    const csvContent = await db.exportToCSV();
    const filename = `axiom_triagem3_export_${new Date().toISOString().substring(0,10)}_${Date.now()}.csv`;
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.status(200).send(csvContent);
  } catch (err) {
    console.error("❌ API: Erro ao gerar CSV:", err.message);
    res.status(500).send("Erro interno ao exportar banco em CSV.");
  }
});

/**
 * API: Exportar dados em formato JSON estruturado
 */
app.get('/api/export/json', async (req, res) => {
  try {
    const jsonContent = await db.exportToJSON();
    const filename = `axiom_triagem3_export_${new Date().toISOString().substring(0,10)}_${Date.now()}.json`;
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.json(jsonContent);
  } catch (err) {
    console.error("❌ API: Erro ao gerar JSON:", err.message);
    res.status(500).send("Erro interno ao exportar banco em JSON.");
  }
});

// Inicialização do servidor Express e disparo do Monitor de Segundo Plano
async function startServer() {
  try {
    // 1. Inicializa o monitoramento de segundo plano
    // O monitor por sua vez conecta ao MySQL e valida os esquemas
    await monitor.initMonitor();
    
    // 2. Escuta na porta configurada
    app.listen(PORT, '0.0.0.0', () => {
      console.log("=".repeat(60));
      console.log(`🚀 SERVIDOR WEB ONLINE EM: http://localhost:${PORT}`);
      console.log(`📡 MONITOR ATIVO E CONECTADO AO MYSQL DA RAILWAY!`);
      console.log("=".repeat(60));
    });
  } catch (err) {
    console.error("💥 Falha fatal na inicialização da aplicação:", err.message);
    process.exit(1);
  }
}

// Inicia a aplicação se executada diretamente
if (require.main === module) {
  startServer();
}

module.exports = app;
