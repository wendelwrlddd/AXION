const { Connection, PublicKey } = require('@solana/web3.js');
const db = require('./database');
// Vamos precisar da referência ao monitor para chamar o processPaidTransition
// Para evitar ciclo de dependência, injetamos a função
let processTransitionFn = null;

// Mapa local rápido para consulta de O(1) de carteiras de dev para moedas unpaid
// Estrutura: { [devWallet]: { address: coinAddress, ticker: coinTicker } }
let activeDevWallets = new Map();

function setProcessTransition(fn) {
  processTransitionFn = fn;
}

/**
 * Atualiza o mapa de desenvolvedores com base no banco de dados.
 * Isso permite saber de quem veio o pagamento.
 */
async function syncUnpaidDevs() {
  try {
    const pool = db.getPool();
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
    const [rows] = await pool.query(
      "SELECT address, ticker FROM coins WHERE status = 'unpaid' AND created_at >= ?",
      [thirtyMinsAgo]
    );
    
    // Na sua infraestrutura, os devs de cada token estão no 'coinCreators' do monitor.
    // Aqui não temos acesso direto ao dev_wallet na tabela coins (não foi salvo lá).
    // Então, expomos uma forma de sincronizar via monitor.
  } catch (err) {
    console.error(`[INTERCEPTOR] Erro ao sincronizar unpaid devs:`, err.message);
  }
}

/**
 * Inicia a escuta via WebSocket da Solana na carteira da DexScreener.
 * @param {Map} coinCreators - Mapa em memória vindo do monitor.js {coinAddress -> devWallet}
 * @param {Array} getCheckQueue - Função que retorna as moedas atualmente na fila de Unpaid
 */
function startInterceptor(coinCreators, getCheckQueue) {
  const wsUrl = process.env.SOLANA_WSS_URL || "wss://api.mainnet-beta.solana.com";
  const feeWalletStr = process.env.DEXSCREENER_FEE_WALLET;

  if (!feeWalletStr) {
    console.warn(`[INTERCEPTOR] ⚠️ DEXSCREENER_FEE_WALLET não configurado. Interceptação da blockchain desativada.`);
    return;
  }

  let feeWallet;
  try {
    feeWallet = new PublicKey(feeWalletStr);
  } catch (e) {
    console.error(`[INTERCEPTOR] ❌ DEXSCREENER_FEE_WALLET inválido no .env.`);
    return;
  }

  console.log(`[INTERCEPTOR] 📡 Conectando ao RPC WebSocket: ${wsUrl.split('//')[1].split('/')[0]}...`);
  const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", {
    wsEndpoint: wsUrl,
    commitment: 'confirmed'
  });

  console.log(`[INTERCEPTOR] 🎧 Escutando logs de transações para a carteira DexScreener: ${feeWalletStr}`);

  // Ouve qualquer transação confirmada que envolva a carteira de taxas da DexScreener
  connection.onLogs(
    feeWallet,
    async (logs, context) => {
      if (logs.err) return; // Ignora transações que falharam

      try {
        const signature = logs.signature;
        
        // Pega a transação completa para verificar as carteiras envolvidas
        const tx = await connection.getTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        });

        if (!tx || !tx.transaction || !tx.transaction.message) return;

        // Extrai todas as carteiras que assinaram ou participaram da transação
        const accountKeys = tx.transaction.message.accountKeys.map(k => {
          return k.pubkey ? k.pubkey.toString() : k.toString();
        });

        // Pega os tokens "unpaid" diretamente da fila do monitor
        const unpaidCoins = getCheckQueue();

        // Para cada moeda unpaid, verificamos se a carteira do Dev dela está nessa transação
        for (const coin of unpaidCoins) {
          const devWallet = coinCreators.get(coin.address);
          
          if (devWallet && accountKeys.includes(devWallet)) {
            console.log(`[INTERCEPTOR] 🚨🚨🚨 INTERCEPÇÃO DIRETA! Pagamento confirmado na blockchain pelo Dev do token ${coin.ticker}`);
            console.log(`[INTERCEPTOR] 🔗 Tx Hash: ${signature}`);
            
            // Removemos da fila de escuta imediatamente
            const index = unpaidCoins.findIndex(c => c.address === coin.address);
            if (index !== -1) unpaidCoins.splice(index, 1);

            // Transição instantânea para Dex Paid!
            if (processTransitionFn) {
              processTransitionFn(coin, "Blockchain Interceptor");
            }
          }
        }
      } catch (err) {
        console.error(`[INTERCEPTOR] Erro ao processar transação capturada:`, err.message);
      }
    },
    'confirmed'
  );
}

module.exports = {
  startInterceptor,
  setProcessTransition
};
