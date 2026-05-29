const mysql = require('mysql2/promise');
require('dotenv').config();

async function test() {
  console.log("🧪 Diagnostic: Testando conexões MySQL...");
  
  // Imprime variáveis disponíveis para ver o que está ativo
  console.log("Variáveis de ambiente ativas (presença):");
  console.log("- DATABASE_URL:", !!process.env.DATABASE_URL);
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    console.log(`  -> Host: ${url.host}, User: ${url.username}, Database: ${url.pathname}`);
  }
  console.log("- MYSQLHOST:", process.env.MYSQLHOST);
  console.log("- MYSQLPORT:", process.env.MYSQLPORT);
  console.log("- MYSQLUSER:", process.env.MYSQLUSER);
  console.log("- MYSQLDATABASE:", process.env.MYSQLDATABASE);
  console.log("- MYSQL_URL:", !!process.env.MYSQL_URL);

  const testUrls = [
    process.env.DATABASE_URL,
    "mysql://root:HWOJHYShbuIpuaKszfHPVgyGgnnxIZVB@zephyr.proxy.rlwy.net:16223/railway"
  ].filter(Boolean);

  for (const url of testUrls) {
    try {
      const parsed = new URL(url);
      console.log(`\nAttempting connection to ${parsed.host} as ${parsed.username}...`);
      
      const conn = await mysql.createConnection({
        uri: url,
        connectTimeout: 10000
      });
      
      console.log("✅ Conectado com sucesso!");
      const [rows] = await conn.query("SELECT USER(), DATABASE(), VERSION()");
      console.log("User/DB/Version:", rows[0]);
      await conn.end();
      return;
    } catch (err) {
      console.error("❌ Falha na conexão:", err.message);
      console.error("Código do Erro:", err.code);
      console.error("Número do Erro (errno):", err.errno);
    }
  }
}

test();
