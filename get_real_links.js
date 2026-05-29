const { chromium } = require('playwright');

async function getLinks() {
  console.log("🚀 Lançando Playwright para descobrir a estrutura de links do Axiom...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log("🔗 Acessando: https://axiom.trade/pulse?chain=sol");
  try {
    await page.goto("https://axiom.trade/pulse?chain=sol", { waitUntil: "commit", timeout: 60000 });
    console.log("⏳ Aguardando a página carregar...");
    await page.waitForTimeout(10000);
    
    console.log("🔍 Extraindo todos os links (tags <a>)...");
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a'));
      return anchors.map(a => ({
        text: a.innerText.trim(),
        href: a.getAttribute('href') || ''
      })).filter(item => item.href.length > 0);
    });
    
    console.log(`\n✅ Sucesso! Encontrados ${links.length} links na página.`);
    console.log("=".repeat(50));
    console.log("Links potenciais de moedas/tokens:");
    console.log("=".repeat(50));
    
    const tokenLinks = links.filter(l => l.href.includes('token') || l.href.includes('trade') || l.href.includes('solana') || l.href.match(/\/[a-zA-Z0-9]{32,44}/));
    
    tokenLinks.forEach(l => {
      console.log(`- Texto: "${l.text}" | URL: "${l.href}"`);
    });
    
    console.log("\nOutros links interessantes:");
    links.slice(0, 20).forEach(l => {
      console.log(`- Texto: "${l.text}" | URL: "${l.href}"`);
    });
    
  } catch (err) {
    console.error("❌ Erro no Playwright:", err.message);
  } finally {
    await browser.close();
  }
}

getLinks();
