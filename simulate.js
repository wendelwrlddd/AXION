const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Set de conexões SSE ativas para envio em tempo real no simulador
const clients = new Set();

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.add(res);
  res.write(`data: ${JSON.stringify({ event: "connected", timestamp: Date.now() })}\n\n`);
  req.on('close', () => clients.delete(res));
});

function broadcast(payload) {
  const dataString = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    try {
      client.write(dataString);
    } catch (err) {}
  }
}

// Endpoints da API idênticos ao server.js para suportar a UI
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
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const history = await db.getHistoricalCoins();
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/export/csv', async (req, res) => {
  try {
    const csvContent = await db.exportToCSV();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=simulated_triagem3_export_${Date.now()}.csv`);
    res.status(200).send(csvContent);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/api/export/json', async (req, res) => {
  try {
    const jsonContent = await db.exportToJSON();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=simulated_triagem3_export_${Date.now()}.json`);
    res.json(jsonContent);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Lista de moedas simuladas ativas em memória
const simulatedCoins = new Map();

// Helper para converter string Market Cap
function parseMarketCapToNumber(str) {
  if (!str || str === 'N/A') return 0;
  const clean = str.replace(/[$,\s]/g, '').toUpperCase();
  if (clean.endsWith('K')) return parseFloat(clean) * 1000;
  if (clean.endsWith('M')) return parseFloat(clean) * 1000000;
  return parseFloat(clean) || 0;
}

// Gera valores de Market Cap simulando a curva (Queda de Dip e posterior Pump)
function generateSimulatedMCap(baseVal, elapsedSeconds) {
  const elapsedMins = elapsedSeconds / 60;
  let factor = 1.0;
  
  if (elapsedMins <= 4) {
    // Queda/Dip inicial suave nos primeiros 4 minutos (queda de até 25%)
    factor = 1.0 - (elapsedMins * 0.06); 
  } else {
    // Reconstrução e Pump explosivo a partir do minuto 4 (até 2.5x do valor inicial no final)
    factor = 0.76 + ((elapsedMins - 4) * 0.16); 
  }
  
  const val = Math.round(baseVal * factor);
  if (val >= 1000000) return `$${(val/1000000).toFixed(2)}M`;
  return `$${Math.round(val/1000)}K`;
}

async function runSimulator() {
  console.log("🛠️ Simulator: Inicializando conexão com o MySQL...");
  await db.initDB();
  
  // Limpa o banco de simulações anteriores para testes puros
  const pool = db.getPool();
  console.log("🧹 Simulator: Limpando dados antigos para testes consistentes...");
  await pool.query("DELETE FROM price_history");
  await pool.query("DELETE FROM coins");

  app.listen(PORT, '0.0.0.0', () => {
    console.log("=".repeat(70));
    console.log(`🚀 SIMULADOR WEB ONLINE EM: http://localhost:${PORT}`);
    console.log("📡 MODO DE SIMULAÇÃO ATIVO! NENHUM NAVEGADOR REAL SERÁ LANÇADO.");
    console.log("💡 Abra no seu navegador o link acima para ver a mágica acontecer!");
    console.log("=".repeat(70));
  });

  const mockTickers = ['WIF', 'BONK', 'POPCAT', 'BOME', 'MEW', 'BRETT', 'MYRO'];
  const realSolAddresses = {
    'WIF': 'EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMx', // WIF/SOL Raydium V4 Pair ID
    'BONK': 'GGj7YKTJdavHv2F7WcCic2SqEdPcZK1EWFfGDZMbDLo4', // BONK/SOL Raydium V4 Pair ID
    'POPCAT': 'FRhB8L7Y9Qq41qZXYLtC2nw8An1RJfLLxRF2x9RwLLMo', // POPCAT/SOL Raydium V4 Pair ID
    'BOME': 'DSUvc5qf5LJHHV5e2tD184ixotSnCnwj7i4jJa4Xsrmt', // BOME/SOL Raydium V4 Pair ID
    'MEW': 'MEW1gQWJ3nEXg2qg4zbdLy8sC84A65EP4A9s75y1F2A',
    'BRETT': 'HhJpBhRRn4g7JuUA2g1q12pq744Gq61726a718b2c',
    'MYRO': 'HhJpBhRRn4g7JuUA2g1q12pq744Gq61726a718b2c'
  };
  let coinIndex = 0;

  // 1. Gera uma nova moeda "Unpaid" a cada 20 segundos
  setInterval(async () => {
    if (coinIndex >= mockTickers.length) coinIndex = 0;
    const ticker = mockTickers[coinIndex++];
    const solAddress = realSolAddresses[ticker] || `mock${ticker.toLowerCase()}${Date.now()}`;
    const address = `solana:${solAddress}`;
    const name = `Mock ${ticker} Token`;
    const initialMCap = `$${Math.round(15 + Math.random() * 25)}K`; // $15K a $40K
    const initialProgress = `${Math.round(75 + Math.random() * 15)}%`;
    const initialDevHold = `${(1.5 + Math.random() * 4).toFixed(1)}%`;
    
    // Insere no banco como unpaid (Triagem 1)
    await db.upsertCoin(address, ticker, name, initialMCap, initialProgress, initialDevHold, 'unpaid');
    console.log(`[SIMULADOR] [TRIAGEM 1] Nova moeda unpaid descoberta: ${ticker} (${initialMCap})`);

    // 2. Aguarda 5 segundos e transita para Paid (DEX Paid)!
    setTimeout(async () => {
      const success = await db.markCoinAsPaid(address);
      if (success) {
        console.log(`[SIMULADOR] 🚨🚨🚨 [TRIAGEM 2 - DEX PAID] Moeda ${ticker} pagou a DEX agora!`);
        const paidAt = new Date();
        
        simulatedCoins.set(address, {
          ticker,
          name,
          baseVal: parseMarketCapToNumber(initialMCap),
          progress: initialProgress,
          devHold: initialDevHold,
          paidAt: paidAt,
          elapsedSeconds: 0
        });

        // Primeiro ponto do histórico
        await db.insertHistoryPoint(address, initialMCap, initialProgress, initialDevHold);
        
        // Transmite evento instantâneo via SSE
        broadcast({
          event: "transition",
          data: {
            address,
            ticker,
            name,
            initialMarketCap: initialMCap,
            initialProgress,
            initialDevHold,
            paidAt: paidAt.getTime()
          }
        });
      }
    }, 5000);

  }, 20000);

  // 3. Loop de atualização de alta frequência ACELERADO
  // Roda a cada 5 segundos. 
  // No simulador, cada 5 segundos reais = 1 minuto simulado (para acelerar os 15 minutos em 75 segundos e podermos testar o arquivamento rápido!)
  setInterval(async () => {
    if (simulatedCoins.size === 0) return;
    
    const now = Date.now();
    
    for (const [address, meta] of simulatedCoins.entries()) {
      // Simula a passagem de 1 minuto a cada tick de 5 segundos
      meta.elapsedSeconds += 60;
      
      if (meta.elapsedSeconds > 15 * 60) {
        // Expirou os 15 minutos simulados! Mover para Triagem 3 (Arquivar)
        console.log(`[SIMULADOR] 🏁 [TRIAGEM 3 ARQUIVADA] Moeda ${meta.ticker} completou o tempo limite e foi arquivada.`);
        simulatedCoins.delete(address);
        
        // No MySQL, atualizamos o paid_at para simular que ela foi paga há mais de 15 minutos reais,
        // para que a rota /api/history e /api/active respondam de acordo com as abas da UI.
        const pool = db.getPool();
        const fakePaidAt = new Date(Date.now() - 16 * 60 * 1000); // 16 minutos atrás
        await pool.query("UPDATE coins SET paid_at = ? WHERE address = ?", [fakePaidAt, address]);

        broadcast({
          event: "archived",
          data: { address }
        });
        continue;
      }

      // Gera novo market cap simulando a curva (Queda de Dip e posterior Pump)
      const currentMCap = generateSimulatedMCap(meta.baseVal, meta.elapsedSeconds);
      
      // Incrementa Bonding curve progress em direção a 100%
      const progNum = Math.min(100, parseInt(meta.progress) + Math.round(Math.random() * 2));
      meta.progress = `${progNum}%`;

      await db.insertHistoryPoint(address, currentMCap, meta.progress, meta.devHold);
      console.log(`[SIMULADOR] 📈 Ponto salvo para ${meta.ticker} | Mapeado: ${meta.elapsedSeconds}s | MCap: ${currentMCap}`);

      // Envia ponto histórico via SSE para o gráfico dinâmico
      broadcast({
        event: "history_point",
        data: {
          address,
          marketCap: currentMCap,
          progress: meta.progress,
          devHold: meta.devHold,
          timestamp: now,
          elapsedSeconds: meta.elapsedSeconds
        }
      });
    }
  }, 5000);
}

runSimulator();
