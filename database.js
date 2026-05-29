const mysql = require('mysql2/promise');
require('dotenv').config();

// Mapeamento e controle em memória para testes no Localhost caso MySQL falhe
let isMock = false;
const mockCoins = [];
const mockHistory = [];

// Resolve connection credentials (supports public URL for local dev, and internal variables for Railway production)
function getConnectionConfig() {
  const publicUrl = process.env.DATABASE_URL || process.env.MYSQL_PUBLIC_URL;
  const isCloud = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_STATIC_URL || (process.env.PORT && !publicUrl);
  
  if (isCloud) {
    const internalUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;
    if (internalUrl && !internalUrl.includes('proxy.rlwy.net') && internalUrl.includes('internal')) {
      return internalUrl;
    }
    return {
      host: process.env.MYSQLHOST || 'mysql.railway.internal',
      user: process.env.MYSQLUSER || 'root',
      password: process.env.MYSQLPASSWORD || 'HWOJHYShbuIpuaKszfHPVgyGgnnxIZVB',
      database: process.env.MYSQLDATABASE || 'railway',
      port: parseInt(process.env.MYSQLPORT || '3306', 10),
    };
  }

  if (publicUrl) {
    return publicUrl;
  }
  return "mysql://root:HWOJHYShbuIpuaKszfHPVgyGgnnxIZVB@zephyr.proxy.rlwy.net:16223/railway";
}

let pool = null;

// Initialize MySQL pool and create tables if they do not exist
async function initDB() {
  const config = getConnectionConfig();
  const options = {
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
  };

  try {
    if (typeof config === 'string') {
      pool = mysql.createPool({ uri: config, ...options });
    } else {
      pool = mysql.createPool({ ...config, ...options });
    }

    // Tenta uma consulta simples para validar a conexão ativa com o MySQL
    const conn = await pool.getConnection();
    conn.release();

    console.log("🔌 Database: MySQL conectado com sucesso! Verificando e criando tabelas...");

    // 1. Tabela de Moedas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coins (
        address VARCHAR(150) PRIMARY KEY,
        ticker VARCHAR(50) NOT NULL,
        name VARCHAR(150),
        initial_market_cap VARCHAR(50),
        initial_progress VARCHAR(20),
        initial_dev_hold VARCHAR(20),
        status VARCHAR(30) DEFAULT 'unpaid',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        paid_at TIMESTAMP NULL DEFAULT NULL,
        INDEX idx_status (status),
        INDEX idx_paid_at (paid_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Tabela de Histórico
    await pool.query(`
      CREATE TABLE IF NOT EXISTS price_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        coin_address VARCHAR(150) NOT NULL,
        market_cap VARCHAR(50),
        progress VARCHAR(20),
        dev_hold VARCHAR(20),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_coin_address (coin_address),
        INDEX idx_timestamp (timestamp),
        FOREIGN KEY (coin_address) REFERENCES coins(address) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log("✅ Database: Tabelas prontas e banco MySQL ativado!");
    isMock = false;
    return pool;
  } catch (err) {
    console.warn("⚠️ Database: Não foi possível conectar ao banco de dados MySQL:", err.message);
    console.warn("⚡ MODO LOCALHOST ATIVADO: Usando Banco de Dados In-Memory (Sem necessidade de MySQL local)!");
    isMock = true;
    // Cria um pool fake mínimo para evitar falhas em outros comandos de query
    pool = {
      query: async (queryStr, params) => {
        // Tratamento simples para a query de delete do faxineiro
        if (queryStr.includes("DELETE FROM coins")) {
          const twoHoursAgo = params[0];
          let removedCount = 0;
          for (let i = mockCoins.length - 1; i >= 0; i--) {
            const coin = mockCoins[i];
            if (coin.status === 'unpaid' && coin.created_at < twoHoursAgo) {
              mockCoins.splice(i, 1);
              removedCount++;
            }
          }
          return [{ affectedRows: removedCount }, null];
        }
        // Para consultas customizadas, retorna array vazio compatível com desestruturação
        return [[], []];
      }
    };
    return pool;
  }
}

// Return the active connection pool
function getPool() {
  if (!pool) {
    throw new Error("Pool de banco de dados não inicializado. Chame initDB() primeiro.");
  }
  return pool;
}

/**
 * Insere uma nova moeda se ela ainda não existir no banco.
 */
async function upsertCoin(address, ticker, name, initialMarketCap, initialProgress, initialDevHold, initialStatus = 'unpaid') {
  if (isMock) {
    const idx = mockCoins.findIndex(c => c.address === address);
    if (idx === -1) {
      mockCoins.push({
        address,
        ticker,
        name,
        initial_market_cap: initialMarketCap,
        initial_progress: initialProgress,
        initial_dev_hold: initialDevHold,
        status: initialStatus,
        created_at: new Date(),
        paid_at: initialStatus === 'pre_paid' ? new Date() : null
      });
      return true;
    }
    return false;
  }

  const p = getPool();
  try {
    const [result] = await p.query(
      `INSERT INTO coins (address, ticker, name, initial_market_cap, initial_progress, initial_dev_hold, status, paid_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) 
       ON DUPLICATE KEY UPDATE address=address`, 
      [
        address, 
        ticker, 
        name, 
        initialMarketCap, 
        initialProgress, 
        initialDevHold, 
        initialStatus,
        initialStatus === 'pre_paid' ? new Date() : null
      ]
    );
    return result.affectedRows > 0;
  } catch (err) {
    console.error(`⚠️ Database: Erro ao dar upsert no coin ${ticker}:`, err.message);
    return false;
  }
}

/**
 * Marca uma moeda como "DEX Paid".
 */
async function markCoinAsPaid(address) {
  if (isMock) {
    const coin = mockCoins.find(c => c.address === address);
    if (coin && coin.status === 'unpaid') {
      coin.status = 'paid';
      coin.paid_at = new Date();
      return true;
    }
    return false;
  }

  const p = getPool();
  try {
    const now = new Date();
    const [result] = await p.query(
      `UPDATE coins SET status = 'paid', paid_at = ? WHERE address = ? AND status = 'unpaid'`,
      [now, address]
    );
    return result.affectedRows > 0;
  } catch (err) {
    console.error(`❌ Database: Erro ao marcar coin ${address} como pago:`, err.message);
    return false;
  }
}

/**
 * Insere um ponto de histórico de alta frequência.
 */
async function insertHistoryPoint(coinAddress, marketCap, progress, devHold) {
  if (isMock) {
    mockHistory.push({
      coin_address: coinAddress,
      market_cap: marketCap,
      progress: progress,
      dev_hold: devHold,
      timestamp: new Date()
    });
    return;
  }

  const p = getPool();
  try {
    await p.query(
      `INSERT INTO price_history (coin_address, market_cap, progress, dev_hold, timestamp) 
       VALUES (?, ?, ?, ?, ?)`,
      [coinAddress, marketCap, progress, devHold, new Date()]
    );
  } catch (err) {
    console.error(`⚠️ Database: Erro ao inserir ponto de histórico para ${coinAddress}:`, err.message);
  }
}

/**
 * Obtém todas as moedas na Triagem 2 (DEX Paid nas últimas 15 minutos)
 */
async function getActiveCoins() {
  if (isMock) {
    const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
    return mockCoins.filter(c => c.status === 'paid' && new Date(c.paid_at).getTime() >= fifteenMinutesAgo);
  }

  const p = getPool();
  try {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const [rows] = await p.query(
      `SELECT * FROM coins WHERE status = 'paid' AND paid_at >= ? ORDER BY paid_at DESC`,
      [fifteenMinutesAgo]
    );
    return rows;
  } catch (err) {
    console.error("❌ Database: Erro ao obter moedas ativas da Triagem 2:", err.message);
    return [];
  }
}

/**
 * Obtém todas as moedas arquivadas na Triagem 3 (DEX Paid há mais de 15 minutos)
 */
async function getHistoricalCoins() {
  if (isMock) {
    const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
    return mockCoins.filter(c => c.status === 'paid' && new Date(c.paid_at).getTime() < fifteenMinutesAgo);
  }

  const p = getPool();
  try {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const [rows] = await p.query(
      `SELECT * FROM coins WHERE status = 'paid' AND paid_at < ? ORDER BY paid_at DESC`,
      [fifteenMinutesAgo]
    );
    return rows;
  } catch (err) {
    console.error("❌ Database: Erro ao obter histórico estático da Triagem 3:", err.message);
    return [];
  }
}

/**
 * Busca todo o histórico de alta frequência de uma moeda.
 */
async function getHistoryForCoin(coinAddress) {
  if (isMock) {
    return mockHistory
      .filter(h => h.coin_address === coinAddress)
      .map(h => ({
        market_cap: h.market_cap,
        progress: h.progress,
        dev_hold: h.dev_hold,
        timestamp: h.timestamp
      }));
  }

  const p = getPool();
  try {
    const [rows] = await p.query(
      `SELECT * FROM price_history WHERE coin_address = ? ORDER BY timestamp ASC`,
      [coinAddress]
    );
    return rows;
  } catch (err) {
    console.error(`❌ Database: Erro ao obter histórico de ${coinAddress}:`, err.message);
    return [];
  }
}

/**
 * Exporta todos os dados históricos acumulados como JSON estruturado.
 */
async function exportToJSON() {
  if (isMock) {
    const result = [];
    const paidCoins = mockCoins.filter(c => c.status === 'paid');
    for (const coin of paidCoins) {
      const history = mockHistory.filter(h => h.coin_address === coin.address);
      result.push({
        address: coin.address,
        ticker: coin.ticker,
        name: coin.name,
        initialMarketCap: coin.initial_market_cap,
        initialProgress: coin.initial_progress,
        initialDevHold: coin.initial_dev_hold,
        paidAt: coin.paid_at,
        historyPointsCount: history.length,
        history: history.map(h => ({
          marketCap: h.market_cap,
          progress: h.progress,
          devHold: h.dev_hold,
          timestamp: h.timestamp,
          elapsedSeconds: Math.round((new Date(h.timestamp) - new Date(coin.paid_at)) / 1000)
        }))
      });
    }
    return result;
  }

  const p = getPool();
  try {
    const [coins] = await p.query(
      `SELECT * FROM coins WHERE status = 'paid' ORDER BY paid_at ASC`
    );

    const result = [];
    for (const coin of coins) {
      const [history] = await p.query(
        `SELECT market_cap, progress, dev_hold, timestamp FROM price_history WHERE coin_address = ? ORDER BY timestamp ASC`,
        [coin.address]
      );
      result.push({
        address: coin.address,
        ticker: coin.ticker,
        name: coin.name,
        initialMarketCap: coin.initial_market_cap,
        initialProgress: coin.initial_progress,
        initialDevHold: coin.initial_dev_hold,
        paidAt: coin.paid_at,
        historyPointsCount: history.length,
        history: history.map(h => ({
          marketCap: h.market_cap,
          progress: h.progress,
          devHold: h.dev_hold,
          timestamp: h.timestamp,
          elapsedSeconds: Math.round((new Date(h.timestamp) - new Date(coin.paid_at)) / 1000)
        }))
      });
    }
    return result;
  } catch (err) {
    console.error("❌ Database: Erro ao exportar dados em JSON:", err.message);
    throw err;
  }
}

/**
 * Exporta todos os dados em formato CSV plano.
 */
async function exportToCSV() {
  if (isMock) {
    const paidCoins = mockCoins.filter(c => c.status === 'paid');
    let csvContent = "Coin Address,Ticker,Name,Initial Market Cap,Initial Bonding Curve,Initial Dev Hold,Paid At,Snapshot Time,Elapsed Seconds,Snapshot Market Cap,Snapshot Bonding Curve,Snapshot Dev Hold\n";

    for (const coin of paidCoins) {
      const history = mockHistory.filter(h => h.coin_address === coin.address);
      const cleanAddress = coin.address.replace(/"/g, '""');
      const cleanTicker = coin.ticker.replace(/"/g, '""');
      const cleanName = coin.name ? coin.name.replace(/"/g, '""') : '';
      const cleanMCap = coin.initial_market_cap.replace(/"/g, '""');
      const cleanProg = coin.initial_progress.replace(/"/g, '""');
      const cleanDev = coin.initial_dev_hold.replace(/"/g, '""');
      const paidAtStr = coin.paid_at ? new Date(coin.paid_at).toISOString() : '';

      if (history.length === 0) {
        csvContent += `"${cleanAddress}","${cleanTicker}","${cleanName}","${cleanMCap}","${cleanProg}","${cleanDev}","${paidAtStr}",N/A,N/A,"${cleanMCap}","${cleanProg}","${cleanDev}"\n`;
      } else {
        for (const snap of history) {
          const snapTimeStr = new Date(snap.timestamp).toISOString();
          const elapsedSecs = Math.round((new Date(snap.timestamp) - new Date(coin.paid_at)) / 1000);
          const snapMCap = snap.market_cap.replace(/"/g, '""');
          const snapProg = snap.progress.replace(/"/g, '""');
          const snapDev = snap.dev_hold.replace(/"/g, '""');
          csvContent += `"${cleanAddress}","${cleanTicker}","${cleanName}","${cleanMCap}","${cleanProg}","${cleanDev}","${paidAtStr}","${snapTimeStr}",${elapsedSecs},"${snapMCap}","${snapProg}","${snapDev}"\n`;
        }
      }
    }
    return csvContent;
  }

  const p = getPool();
  try {
    const [coins] = await p.query(
      `SELECT * FROM coins WHERE status = 'paid' ORDER BY paid_at ASC`
    );

    let csvContent = "Coin Address,Ticker,Name,Initial Market Cap,Initial Bonding Curve,Initial Dev Hold,Paid At,Snapshot Time,Elapsed Seconds,Snapshot Market Cap,Snapshot Bonding Curve,Snapshot Dev Hold\n";

    for (const coin of coins) {
      const [history] = await p.query(
        `SELECT market_cap, progress, dev_hold, timestamp FROM price_history WHERE coin_address = ? ORDER BY timestamp ASC`,
        [coin.address]
      );

      const cleanAddress = coin.address.replace(/"/g, '""');
      const cleanTicker = coin.ticker.replace(/"/g, '""');
      const cleanName = coin.name ? coin.name.replace(/"/g, '""') : '';
      const cleanMCap = coin.initial_market_cap.replace(/"/g, '""');
      const cleanProg = coin.initial_progress.replace(/"/g, '""');
      const cleanDev = coin.initial_dev_hold.replace(/"/g, '""');
      const paidAtStr = coin.paid_at ? new Date(coin.paid_at).toISOString() : '';

      if (history.length === 0) {
        csvContent += `"${cleanAddress}","${cleanTicker}","${cleanName}","${cleanMCap}","${cleanProg}","${cleanDev}","${paidAtStr}",N/A,N/A,"${cleanMCap}","${cleanProg}","${cleanDev}"\n`;
      } else {
        for (const snap of history) {
          const snapTimeStr = new Date(snap.timestamp).toISOString();
          const elapsedSecs = Math.round((new Date(snap.timestamp) - new Date(coin.paid_at)) / 1000);
          const snapMCap = snap.market_cap.replace(/"/g, '""');
          const snapProg = snap.progress.replace(/"/g, '""');
          const snapDev = snap.dev_hold.replace(/"/g, '""');
          
          csvContent += `"${cleanAddress}","${cleanTicker}","${cleanName}","${cleanMCap}","${cleanProg}","${cleanDev}","${paidAtStr}","${snapTimeStr}",${elapsedSecs},"${snapMCap}","${snapProg}","${snapDev}"\n`;
        }
      }
    }
    return csvContent;
  } catch (err) {
    console.error("❌ Database: Erro ao exportar dados em CSV:", err.message);
    throw err;
  }
}

module.exports = {
  initDB,
  getPool,
  upsertCoin,
  markCoinAsPaid,
  insertHistoryPoint,
  getActiveCoins,
  getHistoricalCoins,
  getHistoryForCoin,
  exportToJSON,
  exportToCSV
};
