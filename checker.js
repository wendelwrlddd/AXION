require('dotenv').config();
const db = require('./database');

// URL do servidor principal para enviar o Webhook
const MAIN_SERVER_URL = process.env.MAIN_SERVER_URL || process.env.URL_PRINCIPAL_DO_SERVIDOR || 'http://comfortable-simplicity.railway.internal:3000';

async function logChecker(msg, type = "INFO") {
  const ts = new Date().toISOString().substring(11, 19);
  const icon = type === "WARN" ? "⚠️" : type === "ERROR" ? "❌" : type === "ALERT" ? "🚨" : "⚡";
  console.log(`[${ts}] [CHECKER] [${type}] ${icon} ${msg}`);
}

/**
 * Consulta a API de ordens da DexScreener para verificação rápida.
 */
async function checkDexPaidOrders(mintAddress) {
  if (!mintAddress) return false;
  const cleanMint = mintAddress.replace("solana:", "");
  const ordersUrl = `https://api.dexscreener.com/orders/v1/solana/${cleanMint}`;
  try {
    const res = await fetch(ordersUrl);
    if (res.ok) {
      const json = await res.json();
      if (json.orders && Array.isArray(json.orders)) {
        if (json.orders.some(o => o.type === "tokenProfile" && o.status === "approved")) {
          return true;
        }
      }
    }
  } catch (err) {
    // Falha silenciosa para não poluir os logs em rate limits
  }
  return false;
}

/**
 * Envia um alerta de Webhook para o servidor principal
 */
async function triggerWebhook(coin) {
  try {
    const res = await fetch(`${MAIN_SERVER_URL}/webhook/dex-paid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coin, source: "Checker Worker (30min)" })
    });
    if (!res.ok) {
      logChecker(`Falha ao avisar servidor principal para ${coin.ticker}. Status: ${res.status}`, "WARN");
    } else {
      logChecker(`Servidor principal avisado com sucesso para ${coin.ticker}!`, "INFO");
    }
  } catch (err) {
    logChecker(`Erro de rede ao avisar servidor principal: ${err.message}`, "ERROR");
  }
}

async function startChecker() {
  await db.initDB();
  logChecker("Checker Worker Inicializado com Sucesso!", "INFO");
  logChecker(`Servidor Principal configurado em: ${MAIN_SERVER_URL}`, "INFO");

  let checkQueue = [];
  let checkQueueIndex = 0;

  // Intervalo de processamento
  setInterval(async () => {
    // 1. Recarrega a fila se estiver vazia
    if (checkQueue.length === 0) {
      try {
        const pool = db.getPool();
        const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
        
        const [rows] = await pool.query(
          "SELECT address, ticker, name, initial_market_cap, initial_progress, initial_dev_hold FROM coins WHERE status = 'unpaid' AND created_at >= ? ORDER BY created_at DESC",
          [thirtyMinsAgo]
        );
        checkQueue = rows;
        checkQueueIndex = 0;
      } catch (err) {
        logChecker(`Erro ao buscar moedas: ${err.message}`, "ERROR");
      }
    }

    // 2. Processa um lote da fila
    if (checkQueue.length > 0) {
      // 4 requisições por segundo para respeitar o limite de 300 req/minuto
      const batchSize = 4;
      const currentBatch = checkQueue.slice(checkQueueIndex, checkQueueIndex + batchSize);
      checkQueueIndex += batchSize;

      // Se passou do fim da fila, limpa para forçar recarregamento do banco
      if (checkQueueIndex >= checkQueue.length) {
        checkQueue = [];
      }

      if (currentBatch.length > 0) {
        const checks = currentBatch.map(coin => checkDexPaidOrders(coin.address).then(isPaid => {
          if (isPaid) {
            logChecker(`DEX Paid detectado para ${coin.ticker}! Acionando webhook...`, "ALERT");
            // Remove a moeda da fila local para não checar duas vezes antes de recarregar
            checkQueue = checkQueue.filter(c => c.address !== coin.address);
            
            // Avisa o servidor principal (que vai atualizar o banco para 'paid')
            return triggerWebhook(coin);
          }
        }));
        await Promise.all(checks);
      }
    }
  }, 1000); // Executa a cada 1 segundo exato
}

// Inicia o Worker
startChecker().catch(err => {
  console.error("Erro fatal no Checker Worker:", err);
  process.exit(1);
});
