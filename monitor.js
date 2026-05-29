const WebSocket = require('ws');
const db = require('./database');
require('dotenv').config();

// Armazena as moedas ativas em memória na Triagem 2 com seus cronômetros
// Estrutura: { [address]: { ticker, name, paidAt, lastHistoryTime } }
const activeTriagem2 = new Map();

// Armazena os endereços de criadores (devs) em memória para calcular holdings em tempo real
const coinCreators = new Map();

// Canal de transmissão SSE para enviar eventos instantâneos ao front-end
let sseBroadcastFn = null;

// Referências de Timers e Sockets para limpeza limpa
let ws = null;
let reconnectTimeout = null;
let activeStage2Tracker = null;
let cleanupInterval = null;
let staggeredCheckerInterval = null;

// Fila e índice para checagem staggered de DEX Paid
let checkQueue = [];
let checkQueueIndex = 0;

function setSSEBroadcast(fn) {
  sseBroadcastFn = fn;
}

/**
 * Função utilitária para registrar logs organizados
 */
function logMonitor(msg, type = "INFO") {
  const stamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${stamp}] [MONITOR] [${type}] ${msg}`);
}

/**
 * Consulta a posse do desenvolvedor (devHold) via chamada JSON-RPC direta na blockchain Solana.
 */
async function getDevHold(traderPublicKey, mintAddress) {
  if (!traderPublicKey || traderPublicKey === "N/A" || !mintAddress) {
    return "0%";
  }
  const cleanMint = mintAddress.replace("solana:", "");
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          traderPublicKey,
          { mint: cleanMint },
          { encoding: "jsonParsed" }
        ]
      })
    });

    const json = await response.json();
    if (json.result && json.result.value && json.result.value.length > 0) {
      const balanceInfo = json.result.value[0].account.data.parsed.info.tokenAmount;
      const uiAmount = balanceInfo.uiAmount || 0;
      const percentage = (uiAmount / 1000000000) * 100; // pump.fun total supply é sempre 1 Bilhão
      return `${percentage.toFixed(1)}%`;
    }
  } catch (err) {
    logMonitor(`Erro ao obter devHold via RPC para ${cleanMint}: ${err.message}`, "WARN");
  }
  return "0%";
}

/**
 * Consulta a API de ordens da DexScreener para verificar se o token pagou o perfil avançado.
 */
async function checkDexPaid(mintAddress) {
  if (!mintAddress) return false;
  const cleanMint = mintAddress.replace("solana:", "");
  const url = `https://api.dexscreener.com/orders/v1/solana/${cleanMint}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const json = await res.json();
    if (json.orders && Array.isArray(json.orders)) {
      return json.orders.some(o => o.type === "tokenProfile" && o.status === "approved");
    }
  } catch (err) {
    logMonitor(`Erro ao checar DEX Paid no DexScreener para ${cleanMint}: ${err.message}`, "WARN");
  }
  return false;
}

/**
 * Busca as métricas atuais de mercado (Market Cap e Dex ID) do token na DexScreener.
 */
async function getDexTokenMetrics(mintAddress) {
  if (!mintAddress) return null;
  const cleanMint = mintAddress.replace("solana:", "");
  const url = `https://api.dexscreener.com/latest/dex/tokens/${cleanMint}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.pairs && json.pairs.length > 0) {
      // Prioriza par da Raydium se houver, senão pega o primeiro ativo
      const raydiumPair = json.pairs.find(p => p.dexId === 'raydium');
      const bestPair = raydiumPair || json.pairs[0];
      return {
        marketCap: bestPair.marketCap ? `$${Math.round(bestPair.marketCap).toLocaleString()}` : "N/A",
        rawMarketCap: bestPair.marketCap || 0,
        dexId: bestPair.dexId,
        priceUsd: bestPair.priceUsd,
        name: bestPair.baseToken?.name,
        symbol: bestPair.baseToken?.symbol
      };
    }
  } catch (err) {
    logMonitor(`Erro ao buscar métricas de token no DexScreener para ${cleanMint}: ${err.message}`, "WARN");
  }
  return null;
}

/**
 * Inicializa a conexão persistente com o WebSocket da PumpPortal com auto-reconexão.
 */
function connectWebSocket() {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);

  const apiKey = process.env.PUMPPORTAL_API_KEY || '';
  const wsUrl = apiKey ? `wss://pumpportal.fun/api/data?api-key=${apiKey}` : 'wss://pumpportal.fun/api/data';

  logMonitor(`🔌 Conectando ao WebSocket do PumpPortal: ${wsUrl.split('?')[0]}...`);

  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    logMonitor('🟢 Conexão WebSocket com PumpPortal estabelecida!');
    // Se inscreve na criação de novas moedas (gratuito)
    ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
  });

  ws.on('message', async (data) => {
    try {
      const eventData = JSON.parse(data);

      if (eventData.mint && eventData.symbol && eventData.traderPublicKey) {
        const address = eventData.mint;
        const ticker = eventData.symbol;
        const name = eventData.name || "N/A";
        const devWallet = eventData.traderPublicKey;

        // Armazena o criador na memória para consultas posteriores de posse
        coinCreators.set(address, devWallet);

        // Insere a moeda no banco com status inicial unpaid
        const initialMCap = "$5K";
        const initialProgress = "0%";
        const initialStatus = "unpaid";

        const isNew = await db.upsertCoin(address, ticker, name, initialMCap, initialProgress, "Calculating...", initialStatus);
        if (isNew) {
          logMonitor(`✨ [TRIAGEM 1] Nova moeda unpaid detectada via WebSocket: ${ticker} (Address: ${address})`);

          // Calcula holdings em background com delay de 3 segundos para indexação da rede Solana
          setTimeout(() => {
            getDevHold(devWallet, address).then(async (holdPct) => {
              try {
                const pool = db.getPool();
                await pool.query("UPDATE coins SET initial_dev_hold = ? WHERE address = ?", [holdPct, address]);
                logMonitor(`💻 Holdings do Dev calculadas para ${ticker}: ${holdPct}`);
              } catch (err) {
                logMonitor(`Erro ao atualizar holdings do Dev para ${ticker}: ${err.message}`, "WARN");
              }
            });
          }, 3000);
        }
      }
    } catch (err) {
      logMonitor(`Erro ao processar mensagem do WebSocket: ${err.message}`, "ERROR");
    }
  });

  ws.on('close', (code, reason) => {
    logMonitor(`🔴 WebSocket fechado (Código: ${code}, Razão: ${reason}). Tentando reconectar em 5 segundos...`, "WARN");
    reconnectTimeout = setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (err) => {
    logMonitor(`❌ Erro no WebSocket: ${err.message}`, "ERROR");
  });
}

/**
 * Worker recorrente em segundo plano para rastreamento de alta frequência da Triagem 2 (Janela de 15 minutos).
 */
async function startActiveStage2Worker() {
  logMonitor("Iniciando Worker de rastreamento de alta frequência (Triagem 2)...");

  activeStage2Tracker = setInterval(async () => {
    if (activeTriagem2.size === 0) return;

    logMonitor(`Rastreando histórico para ${activeTriagem2.size} moedas ativas na Triagem 2...`);
    const now = Date.now();
    const fifteenMinutesMs = 15 * 60 * 1000;

    for (const [address, meta] of activeTriagem2.entries()) {
      const elapsed = now - meta.paidAt.getTime();

      if (elapsed > fifteenMinutesMs) {
        // 🏁 FIM DOS 15 MINUTOS! Mover para a Triagem 3 (Histórico Estático)
        logMonitor(`🏁 [TRIAGEM 3 ARQUIVADA] Moeda ${meta.ticker} completou 15 minutos e foi arquivada na Triagem 3.`);
        activeTriagem2.delete(address);

        // Notifica o front-end
        if (sseBroadcastFn) {
          sseBroadcastFn({
            event: "archived",
            data: { address }
          });
        }
        continue;
      }

      // Busca dados atualizados da DexScreener
      const metrics = await getDexTokenMetrics(address);
      let currentMCap = meta.marketCap;
      let currentProgress = meta.progress;
      let currentDevHold = meta.devHold;

      if (metrics) {
        currentMCap = metrics.marketCap;
        if (metrics.dexId === 'raydium') {
          currentProgress = "100%";
        } else {
          const progressVal = Math.min(99, Math.round((metrics.rawMarketCap / 69000) * 100));
          currentProgress = `${progressVal}%`;
        }
      }

      // Atualiza holdings do dev em tempo real
      const devWallet = coinCreators.get(address);
      if (devWallet) {
        currentDevHold = await getDevHold(devWallet, address);
      }

      // Atualiza metadados em memória
      meta.marketCap = currentMCap;
      meta.progress = currentProgress;
      meta.devHold = currentDevHold;

      // Salva o ponto de histórico no MySQL
      await db.insertHistoryPoint(address, currentMCap, currentProgress, currentDevHold);
      logMonitor(`📈 Ponto de histórico salvo para ${meta.ticker} | MCap: ${currentMCap} | Progresso: ${currentProgress}`);

      // Transmite o ponto de dados em tempo real via SSE
      if (sseBroadcastFn) {
        sseBroadcastFn({
          event: "history_point",
          data: {
            address,
            marketCap: currentMCap,
            progress: currentProgress,
            devHold: currentDevHold,
            timestamp: now,
            elapsedSeconds: Math.round(elapsed / 1000)
          }
        });
      }
    }
  }, 30000); // 30 segundos
}

/**
 * Inicializa todo o monitor de segundo plano
 */
async function initMonitor() {
  await db.initDB();

  // 1. Inicia conexão WebSocket para Triagem 1
  connectWebSocket();

  // 2. Loop staggered para checar transições "DEX Paid" via API DexScreener de forma segura (Max 30 req/min)
  logMonitor("Iniciando Verificador Staggered de Transições DEX Paid...");
  staggeredCheckerInterval = setInterval(async () => {
    if (checkQueue.length === 0) {
      try {
        const pool = db.getPool();
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const [rows] = await pool.query(
          "SELECT address, ticker, name, initial_market_cap, initial_progress, initial_dev_hold FROM coins WHERE status = 'unpaid' AND created_at >= ? ORDER BY created_at DESC",
          [twoHoursAgo]
        );
        checkQueue = rows;
        checkQueueIndex = 0;
      } catch (err) {
        logMonitor(`Erro ao alimentar fila de checagem DEX Paid: ${err.message}`, "WARN");
      }
    }

    if (checkQueue.length > 0) {
      const coin = checkQueue[checkQueueIndex];
      checkQueueIndex = (checkQueueIndex + 1) % checkQueue.length;

      if (checkQueueIndex === 0) {
        checkQueue = []; // Limpa fila para nova consulta
      }

      if (coin) {
        const isPaid = await checkDexPaid(coin.address);
        if (isPaid) {
          // 🚨 TRANSITOU! DEX PAGA AGORA!
          const success = await db.markCoinAsPaid(coin.address);
          if (success) {
            logMonitor(`🚨🚨🚨 [TRIAGEM 2 - DEX PAID] A moeda ${coin.ticker} PAGOU A DEX AGORA!`, "ALERT");

            const paidAt = new Date();
            const metrics = await getDexTokenMetrics(coin.address);
            const currentMCap = metrics ? metrics.marketCap : coin.initial_market_cap;

            const devWallet = coinCreators.get(coin.address);
            const devHold = await getDevHold(devWallet, coin.address);

            activeTriagem2.set(coin.address, {
              ticker: coin.ticker,
              name: coin.name,
              marketCap: currentMCap,
              progress: metrics && metrics.dexId === 'raydium' ? "100%" : "0%",
              devHold: devHold,
              paidAt: paidAt,
              lastHistoryTime: Date.now()
            });

            await db.insertHistoryPoint(coin.address, currentMCap, metrics && metrics.dexId === 'raydium' ? "100%" : "0%", devHold);

            if (sseBroadcastFn) {
              sseBroadcastFn({
                event: "transition",
                data: {
                  address: coin.address,
                  ticker: coin.ticker,
                  name: coin.name,
                  initialMarketCap: currentMCap,
                  initialProgress: metrics && metrics.dexId === 'raydium' ? "100%" : "0%",
                  initialDevHold: devHold,
                  paidAt: paidAt.getTime()
                }
              });
            }
          }
        }
      }
    }
  }, 2000); // Executa checagem de 1 moeda a cada 2 segundos

  // 3. Worker de alta frequência para Triagem 2 (30s)
  await startActiveStage2Worker();

  // 4. Limpeza automática do MySQL: Deleta moedas Unpaid com mais de 2 horas a cada 5 minutos
  cleanupInterval = setInterval(async () => {
    try {
      const pool = db.getPool();
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const [result] = await pool.query(
        "DELETE FROM coins WHERE status = 'unpaid' AND created_at < ?",
        [twoHoursAgo]
      );
      if (result.affectedRows > 0) {
        logMonitor(`🧹 Limpeza MySQL: Removidas ${result.affectedRows} moedas Unpaid com +2h de vida.`);
      }
    } catch (err) {
      logMonitor(`Erro no ciclo de limpeza do MySQL: ${err.message}`, "ERROR");
    }
  }, 300000);
}

/**
 * Para todos os loops de monitoramento e fecha a conexão WebSocket
 */
async function stopMonitor() {
  logMonitor("Finalizando monitoramento...");
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  if (ws) ws.close();
  if (staggeredCheckerInterval) clearInterval(staggeredCheckerInterval);
  if (activeStage2Tracker) clearInterval(activeStage2Tracker);
  if (cleanupInterval) clearInterval(cleanupInterval);
  logMonitor("WebSocket fechado, loops parados e monitor finalizado.");
}

module.exports = {
  initMonitor,
  stopMonitor,
  setSSEBroadcast,
  activeTriagem2
};
