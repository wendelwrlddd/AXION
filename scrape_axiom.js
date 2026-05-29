const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeAxiom() {
  console.log("=".repeat(60));
  console.log("🚀 INICIANDO SCRAPER DE AXIOM.TRADE (SOLANA PULSE) - NODE.JS...");
  console.log("=".repeat(60));
  console.log("💡 Abrindo o navegador (modo visível para contornar Cloudflare)...");

  // Inicia o navegador Chromium visível
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();

  console.log("🔗 Acessando: https://axiom.trade/pulse?chain=sol");
  try {
    // Usamos waitUntil: "commit" para não travar indefinidamente em websockets/analytics
    await page.goto("https://axiom.trade/pulse?chain=sol", { waitUntil: "commit", timeout: 60000 });
  } catch (err) {
    console.error(`❌ Erro ao abrir a página: ${err.message}`);
    await browser.close();
    return;
  }

  console.log("\n⏳ Aguardando a página carregar e o Cloudflare ser resolvido...");
  console.log("👉 Se aparecer um desafio do Cloudflare (Turnstile/Captcha), clique nele para passar!");
  
  // Aguarda 15 segundos para dar tempo de resolver o Cloudflare e carregar a página
  for (let i = 15; i > 0; i--) {
    process.stdout.write(`\rAguardando carregamento... ${i}s restantes `);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  console.log("\n\n🔍 Iniciando verificação de login...");

  // --- FLUXO DE LOGIN AUTOMÁTICO ---
  try {
    const loginLink = page.locator('text="Login"').first();
    if (await loginLink.isVisible()) {
      console.log("🔑 Botão de Login detectado! Realizando autenticação automática...");
      await loginLink.click();
      
      // Aguarda o modal de login terminar de renderizar e o input ficar visível
      console.log("⏳ Aguardando campos de formulário ficarem visíveis...");
      const emailInput = page.locator('input[type="email"], input[placeholder*="email"], input[placeholder*="Email"], input[placeholder*="Enter email"]').first();
      const passInput = page.locator('input[type="password"], input[placeholder*="password"], input[placeholder*="Password"], input[placeholder*="Enter password"]').first();
      
      await emailInput.waitFor({ state: 'visible', timeout: 15000 });

      console.log("📧 Inserindo credenciais de login...");
      await emailInput.fill('tobizinho12345678@gmail.com');
      await passInput.fill('laisa1.9');
      
      console.log("🔘 Clicando no botão de confirmação de Login...");
      const submitBtn = page.locator('button:has-text("Login")').last();
      await submitBtn.click();
      
      console.log("⏳ Aguardando redirecionamento após login (10s)...");
      await page.waitForTimeout(10000);
    } else {
      console.log("ℹ️ Botão de Login inicial não encontrado. Você já pode estar logado ou a página foi direto para o painel.");
    }
  } catch (err) {
    console.warn(`⚠️ Não foi possível automatizar o login ou já estava logado: ${err.message}`);
  }

  // --- SCREENSHOT DE SEGURANÇA ---
  try {
    await page.screenshot({ path: "axiom_pulse_screenshot_node.png" });
    console.log("📸 Screenshot salvo como 'axiom_pulse_screenshot_node.png'");
  } catch (err) {
    console.warn(`⚠️ Não foi possível tirar screenshot: ${err.message}`);
  }

  // --- EXTRAÇÃO E PROCESSAMENTO DOS DADOS ---
  console.log("\n🔍 Capturando dados da tabela Pulse...");
  try {
    const bodyText = await page.locator("body").innerText();
    const lines = bodyText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    
    console.log("\n" + "=".repeat(50));
    console.log("🎯 PROCESSANDO TOKENS DETECTADOS (PULSE SOLANA):");
    console.log("=".repeat(50));

    const detectedTokens = [];
    let currentToken = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Encontra a linha de idade como âncora (ex: "15s ago", "2m ago", "1h ago")
      if (/^\d+[smhd]\s+ago$/.test(line)) {
        if (currentToken && currentToken.ticker) {
          detectedTokens.push(currentToken);
        }
        
        currentToken = {
          age: line,
          ticker: "N/A",
          name: "N/A",
          marketCap: "N/A",
          devHold: "N/A",
          progress: "N/A"
        };
        
        if (i + 1 < lines.length) currentToken.ticker = lines[i + 1];
        if (i + 2 < lines.length) currentToken.name = lines[i + 2];
        if (i + 3 < lines.length) currentToken.marketCap = lines[i + 3];
        if (i + 4 < lines.length) currentToken.devHold = lines[i + 4];
        if (i + 5 < lines.length) currentToken.progress = lines[i + 5];
        
        i += 5;
      }
    }
    
    if (currentToken && currentToken.ticker && currentToken.ticker !== "N/A") {
      detectedTokens.push(currentToken);
    }

    if (detectedTokens.length > 0) {
      console.log(`✅ Sucesso! Detectamos ${detectedTokens.length} moedas ativas na Pulse:`);
      console.log("-".repeat(80));
      detectedTokens.forEach((t, idx) => {
        console.log(`✨ Coin #${(idx+1).toString().padStart(2, '0')} | Ticker: ${t.ticker.padEnd(8)} | MCap: ${t.marketCap.padEnd(8)} | Curva: ${t.progress.padEnd(6)} | Dev Hold: ${t.devHold.padEnd(6)} | Idade: ${t.age}`);
      });
      console.log("-".repeat(80));
    } else {
      console.log("⚠️ Nenhum padrão de moeda foi extraído com sucesso.");
      console.log("Dica: Verifique se a página carregou completamente ou se a conta do usuário precisa resolver algum desafio manual.");
    }

  } catch (err) {
    console.error(`❌ Erro ao extrair textos da página: ${err.message}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("🏁 Finalizando o scraper. Fechando navegador...");
  console.log("=".repeat(60));
  await browser.close();
}

scrapeAxiom();
