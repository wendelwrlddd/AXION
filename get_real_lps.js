const BOME_MINT = 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82';
const POPCAT_MINT = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';
const WIF_MINT = 'EKpQGSJtjMFqKZ9KQGWjh69dCoSKJ9M18GnmHs1LD2t2';
const BONK_MINT = 'HeLPr5JGUtj4Xx4vYQamAro43Fw8AqyGt1d8R2y6yJZ';

async function fetchGeckoPools(name, mint) {
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/pools`;
  console.log(`\n🔍 Buscando Pools para ${name} via GeckoTerminal...`);
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.data && json.data.length > 0) {
      // Filtra por pools da Raydium
      const raydiumPools = json.data.filter(p => p.attributes.dex_id === 'raydium');
      if (raydiumPools.length > 0) {
        console.log(`✅ Pools da Raydium encontradas para ${name}:`);
        raydiumPools.forEach((pool, index) => {
          console.log(`  [Pool #${index+1}] Nome: ${pool.attributes.name} | AMM Pair Address: ${pool.attributes.address}`);
        });
      } else {
        console.log(`⚠️ Nenhuma pool da Raydium encontrada para ${name}, listando outras pools:`);
        json.data.slice(0, 3).forEach((pool, index) => {
          console.log(`  [Pool #${index+1}] Dex: ${pool.attributes.dex_id} | Nome: ${pool.attributes.name} | Address: ${pool.attributes.address}`);
        });
      }
    } else {
      console.log(`❌ Sem dados retornados pela GeckoTerminal para ${name}`);
    }
  } catch (err) {
    console.error(`❌ Erro ao buscar ${name}:`, err.message);
  }
}

async function start() {
  await fetchGeckoPools("WIF", WIF_MINT);
  await fetchGeckoPools("BONK", BONK_MINT);
  await fetchGeckoPools("BOME", BOME_MINT);
  await fetchGeckoPools("POPCAT", POPCAT_MINT);
}

start();
