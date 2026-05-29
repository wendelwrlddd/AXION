const { chromium } = require('playwright');
const db = require('./database');
const path = require('path');
require('dotenv').config();

let browser = null;
let context = null;
let page = null;
let monitorInterval = null;
let activeStage2Tracker = null;
let isConnectedOverCDP = false;

// Armazena as moedas ativas em memória na Triagem 2 com seus cronômetros
// Estrutura: { [address]: { ticker, name, paidAt, lastHistoryTime } }
const activeTriagem2 = new Map();

// Canal de transmissão SSE para enviar eventos instantâneos ao front-end
let sseBroadcastFn = null;

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
 * Converte strings de idade do Axiom (ex: "15s ago", "2m ago", "1h ago", "2y ago") para minutos reais.
 */
function parseAgeToMinutes(ageStr) {
  if (!ageStr) return 999999;
  const clean = ageStr.replace(' ago', '').trim();
  const val = parseInt(clean, 10);
  if (isNaN(val)) return 999999;
  
  const unit = clean.replace(val.toString(), '').trim().toLowerCase();
  if (unit === 's') return val / 60; // segundos -> minutos
  if (unit === 'm') return val;      // minutos
  if (unit === 'h') return val * 60; // horas -> minutos
  if (unit === 'd') return val * 24 * 60; // dias -> minutos
  if (unit === 'y') return val * 365 * 24 * 60; // anos -> minutos
  return val;
}

/**
 * Inicializa o navegador Playwright com Sessão Persistente (Bypass definitivo)
 * Tenta se conectar a um navegador aberto via CDP na porta 9222 primeiro.
 */
async function startBrowser() {
  const isCloud = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_STATIC_URL;
  const userDataDir = path.join(__dirname, 'user_data');

  if (!isCloud) {
    try {
      logMonitor("🔌 Tentando conectar ao seu Google Chrome aberto (porta 9222)...");
      browser = await chromium.connectOverCDP('http://localhost:9222');
      isConnectedOverCDP = true;
      
      const contexts = browser.contexts();
      context = contexts[0] || await browser.newContext();
      
      const pages = context.pages();
      // Procura uma aba do Axiom Trade aberta no seu navegador
      const axiomPage = pages.find(p => p.url().includes('axiom.trade'));
      if (axiomPage) {
        page = axiomPage;
        logMonitor("🎯 [CDP] Encontramos uma aba do Axiom.trade já aberta no seu Chrome! Reaproveitando esta aba...");
      } else {
        page = pages.length > 0 ? pages[0] : await context.newPage();
        logMonitor("ℹ️ [CDP] Nenhuma aba do Axiom.trade aberta. Abrindo uma nova aba no seu Chrome...");
        await page.goto("https://axiom.trade/pulse?chain=sol", { waitUntil: "commit", timeout: 60000 });
      }
      
      logMonitor("✅ Conectado com sucesso ao seu Google Chrome local em execução!");
      return;
    } catch (err) {
      logMonitor(`⚠️ Não foi possível conectar ao Chrome na porta 9222 (${err.message}). Iniciando navegador próprio do Playwright...`);
    }
  }

  // --- Caso contrário, inicia o navegador próprio do Playwright (Código Original) ---
  logMonitor("Iniciando navegador Playwright próprio com Sessão Persistente (user_data)...");
  
  // Opções para economizar memória e rodar perfeitamente em Linux
  const launchOptions = {
    headless: isCloud ? true : false, // Headless na nuvem (Railway), visível no PC local para resolver o Cloudflare!
    ignoreDefaultArgs: ['--enable-automation'], // Esconde o aviso de controle automatizado
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled', // Desativa a marca de automação interna (Bypass Cloudflare!)
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      isCloud ? '--single-process' : '', // Apenas em produção
      '--disable-gpu'
    ].filter(Boolean)
  };

  // Inicializa o contexto persistente diretamente
  context = await chromium.launchPersistentContext(userDataDir, launchOptions);
  
  // HACK ADICIONAL ANTI-BOT: Deleta a propriedade navigator.webdriver para ser indetectável
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });
  });

  // Configura bloqueio de recursos pesados para economizar 90% de tráfego de rede e CPU
  await context.route('**/*', (route, request) => {
    const type = request.resourceType();
    const url = request.url();
    
    // Bloqueia imagens, fontes, estilos CSS pesados, mídias e analytics
    if (
      type === 'image' || 
      type === 'font' || 
      type === 'media' ||
      url.includes('google-analytics') ||
      url.includes('mixpanel') ||
      url.includes('amplitude') ||
      url.includes('hotjar') ||
      url.includes('facebook')
    ) {
      route.abort();
    } else {
      route.continue();
    }
  });

  const pages = context.pages();
  page = pages.length > 0 ? pages[0] : await context.newPage();
  logMonitor("Navegador próprio pronto e otimizado!");
}

/**
 * Executa o login automático na plataforma Axiom Trade (se não estiver conectado via CDP)
 */
async function handleLogin() {
  if (isConnectedOverCDP) {
    logMonitor("🔗 Usando sessão do seu Chrome aberto. Garantindo que a aba esteja na página correta...");
    const currentUrl = page.url();
    if (!currentUrl.includes('/pulse')) {
      logMonitor("Redirecionando a aba do seu Chrome para https://axiom.trade/pulse?chain=sol...");
      await page.goto("https://axiom.trade/pulse?chain=sol", { waitUntil: "commit", timeout: 60000 });
      await page.waitForTimeout(3000);
    }
    return;
  }

  logMonitor("Acessando a aba Pulse em https://axiom.trade/pulse?chain=sol...");
  
  try {
    await page.goto("https://axiom.trade/pulse?chain=sol", { waitUntil: "commit", timeout: 60000 });
  } catch (err) {
    logMonitor(`Erro ao acessar página: ${err.message}`, "ERROR");
    throw err;
  }

  // Aguarda um momento para que o Cloudflare ou a página carregue
  logMonitor("Aguardando carregamento da página (10 segundos)...");
  await page.waitForTimeout(10000);

  // Captura se há um botão de Login
  try {
    const loginLink = page.locator('text="Login"').first();
    if (await loginLink.isVisible()) {
      logMonitor("🔑 Botão de Login detectado! Iniciando autenticação automática...");
      await loginLink.click();
      
      // Espera pelos inputs usando múltiplos seletores de fallback (robusto)
      const emailInput = page.locator('input[type="email"], input[placeholder*="email"], input[placeholder*="Email"], input[placeholder*="Enter email"]').first();
      const passInput = page.locator('input[type="password"], input[placeholder*="password"], input[placeholder*="Password"], input[placeholder*="Enter password"]').first();
      
      await emailInput.waitFor({ state: 'visible', timeout: 15000 });
      
      logMonitor("Preenchendo credenciais...");
      await emailInput.fill('tobizinho12345678@gmail.com');
      await passInput.fill('laisa1.9');
      
      // Usamos .last() pois o botão de submit da modal é o segundo (último) botão de "Login" do DOM
      const submitBtn = page.locator('button:has-text("Login")').last();
      await submitBtn.click();
      
      logMonitor("Login submetido! Aguardando redirecionamento de sessão (10s)...");
      await page.waitForTimeout(10000);
      
      // Verifica se logou com sucesso tirando um print (salvo na pasta do projeto)
      await page.screenshot({ path: "axiom_pulse_dashboard.png" });
      logMonitor("Sessão inicializada com sucesso!");
    } else {
      logMonitor("ℹ️ Botão de login não visível. Provavelmente já está logado ou no painel.");
    }
  } catch (err) {
    logMonitor(`Aviso durante fluxo de login: ${err.message}. Continuando mesmo assim...`, "WARN");
  }
}

/**
 * Varre a página atual para extrair todas as moedas e processar suas triagens
 */
async function sweepCoins(isFirstBoot = false) {
  try {
    logMonitor(`Iniciando varredura... (Primeiro Boot: ${isFirstBoot})`);
    
    // Extrai o conteúdo do body e processa via DOM ou texto
    const bodyText = await page.locator("body").innerText();
    const lines = bodyText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    
    const detectedTokens = [];
    let currentToken = null;

    // Parser robusto baseado no padrão de idade (ex: "15s ago", "2m ago")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (/^\d+[smhd]\s+ago$/.test(line)) {
        if (currentToken && currentToken.ticker && currentToken.ticker !== "N/A") {
          detectedTokens.push(currentToken);
        }
        
        currentToken = {
          age: line,
          ticker: "N/A",
          name: "N/A",
          marketCap: "N/A",
          devHold: "N/A",
          progress: "N/A",
          status: "unpaid" // Padrão
        };
        
        if (i + 1 < lines.length) currentToken.ticker = lines[i + 1];
        if (i + 2 < lines.length) currentToken.name = lines[i + 2];
        if (i + 3 < lines.length) currentToken.marketCap = lines[i + 3];
        if (i + 4 < lines.length) currentToken.devHold = lines[i + 4];
        if (i + 5 < lines.length) currentToken.progress = lines[i + 5];
        
        // Verifica se a palavra "Paid" ou "Unpaid" aparece perto do token
        // Normalmente está na linha do progresso ou como uma palavra chave
        // Vamos checar as próximas linhas próximas se contêm Paid/Unpaid
        let isPaidToken = false;
        for (let offset = 1; offset <= 7; offset++) {
          if (i + offset < lines.length) {
            const nextLine = lines[i + offset];
            if (nextLine.toLowerCase() === "paid") {
              isPaidToken = true;
              break;
            }
          }
        }
        
        if (isPaidToken) {
          currentToken.status = "paid";
        }
        
        i += 5;
      }
    }
    
    // Adiciona o último token detectado
    if (currentToken && currentToken.ticker && currentToken.ticker !== "N/A") {
      detectedTokens.push(currentToken);
    }

    // 1. Busca todos os links de tokens na página para pegar os endereços de contrato reais da Solana!
    const tokenLinks = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/meme/"], a[href*="/token/"]'));
      return anchors.map(a => {
        // Encontra o contêiner do card ou linha mais próximo para pegar o texto descritivo
        const parentRow = a.closest('tr') || a.closest('div') || a;
        return {
          href: a.getAttribute('href') || '',
          containerText: parentRow.innerText || '',
          linkText: a.innerText || ''
        };
      });
    });

    logMonitor(`Varredura de links concluída. Encontrados ${tokenLinks.length} endereços de contrato potenciais em tags /meme/ ou /token/.`);

    // Processa cada moeda no banco de dados MySQL
    for (const token of detectedTokens) {
      // Filtro de idade: Se a moeda tem mais de 2 horas de vida (120 minutos), ignoramos completamente
      const ageMins = parseAgeToMinutes(token.age);
      if (ageMins > 120) {
        continue; 
      }

      // Tenta associar a moeda ao seu endereço de contrato real pelo ticker presente no texto do link/contêiner
      let realSolAddress = null;
      for (const link of tokenLinks) {
        if (
          link.containerText.includes(token.ticker) || 
          link.linkText.includes(token.ticker) ||
          (token.name && link.containerText.includes(token.name))
        ) {
          // Extrai o endereço Solana de 32 a 44 caracteres do href (ex: /meme/EKpQGS...)
          const match = link.href.match(/\/(?:meme|token)\/([a-zA-Z0-9]{32,44})/);
          if (match) {
            realSolAddress = match[1];
            break;
          }
        }
      }

      // Se encontrar o endereço real, utiliza-o. Senão, cai no fallback determinístico
      const address = realSolAddress ? `solana:${realSolAddress}` : `solana:${token.ticker.toLowerCase()}:${token.name.toLowerCase().replace(/\s+/g, '')}`;
      
      // Limpeza de campos de texto
      const mcap = token.marketCap;
      const progress = token.progress;
      const devHold = token.devHold;

      // Executa lógica de Triagem
      if (isFirstBoot) {
        // --- 1º BOOT: IGNORAR AS QUE JÁ ESTÃO PAGAS ---
        if (token.status === "paid") {
          // Salva como 'pre_paid' para ser ignorado em alertas ativos
          await db.upsertCoin(address, token.ticker, token.name, mcap, progress, devHold, 'pre_paid');
        } else {
          // Salva como 'unpaid' para ser monitorado
          await db.upsertCoin(address, token.ticker, token.name, mcap, progress, devHold, 'unpaid');
        }
      } else {
        // --- RUNTIME DE VARREDURA CORRENTE ---
        
        // 1. Tenta buscar se a moeda já existe no banco
        const pool = db.getPool();
        const [existing] = await pool.query("SELECT * FROM coins WHERE address = ?", [address]);
        
        if (existing.length === 0) {
          // Nova moeda criada durante a execução!
          if (token.status === "paid") {
            // Se já nasceu paga (raro mas possível), salvamos como pre_paid para não dar trigger de transição falso
            await db.upsertCoin(address, token.ticker, token.name, mcap, progress, devHold, 'pre_paid');
          } else {
            // Nasceu unpaid, monitoramos normalmente
            await db.upsertCoin(address, token.ticker, token.name, mcap, progress, devHold, 'unpaid');
            logMonitor(`✨ [TRIAGEM 1] Nova moeda unpaid detectada em tempo real: ${token.ticker} (${mcap})`);
          }
        } else {
          // A moeda já é conhecida! Verifica se houve transição de Unpaid -> Paid
          const coinData = existing[0];
          
          if (coinData.status === "unpaid" && token.status === "paid") {
            // 🚨 TRANSITOU! DEX PAGA AGORA!
            const success = await db.markCoinAsPaid(address);
            if (success) {
              logMonitor(`🚨🚨🚨 [TRIAGEM 2 - DEX PAID] A moeda ${token.ticker} PAGOU A DEX AGORA! MCap: ${mcap}`, "ALERT");
              
              const paidAt = new Date();
              
              // Adiciona na nossa lista ativa de Triagem 2 (15 minutos)
              activeTriagem2.set(address, {
                ticker: token.ticker,
                name: token.name,
                marketCap: mcap,
                progress: progress,
                devHold: devHold,
                paidAt: paidAt,
                lastHistoryTime: Date.now()
              });

              // Salva o primeiro ponto de histórico imediatamente
              await db.insertHistoryPoint(address, mcap, progress, devHold);

              // Transmite o evento instantaneamente para todos os front-ends conectados via SSE
              if (sseBroadcastFn) {
                sseBroadcastFn({
                  event: "transition",
                  data: {
                    address,
                    ticker: token.ticker,
                    name: token.name,
                    initialMarketCap: mcap,
                    initialProgress: progress,
                    initialDevHold: devHold,
                    paidAt: paidAt.getTime()
                  }
                });
              }
            }
          }
        }
      }
    }
  } catch (err) {
    logMonitor(`Erro ao executar varredura de moedas: ${err.message}`, "ERROR");
  }
}

/**
 * Worker recorrente que roda a cada 30 segundos salvando os dados
 * de alta frequência das moedas que estão ativas na Triagem 2 (Janela de 15 min).
 */
async function startActiveStage2Worker() {
  logMonitor("Iniciando Worker de rastreamento de alta frequência (Triagem 2)...");
  
  activeStage2Tracker = setInterval(async () => {
    if (activeTriagem2.size === 0) return;

    logMonitor(`Rastreando histórico para ${activeTriagem2.size} moedas ativas na Triagem 2...`);
    const now = Date.now();
    const fifteenMinutesMs = 15 * 60 * 1000;

    // Como estamos na página principal, podemos capturar os valores mais recentes
    // dos tokens ativos da Triagem 2 que ainda estão visíveis no DOM
    try {
      const bodyText = await page.locator("body").innerText();
      const lines = bodyText.split("\n").map(l => l.trim()).filter(l => l.length > 0);

      for (const [address, meta] of activeTriagem2.entries()) {
        const elapsed = now - meta.paidAt.getTime();

        if (elapsed > fifteenMinutesMs) {
          // 🏁 FIM DOS 15 MINUTOS! Mover para a Triagem 3 (Histórico Estático)
          logMonitor(`🏁 [TRIAGEM 3 ARQUIVADA] Moeda ${meta.ticker} completou 15 minutos e foi arquivada na Triagem 3.`);
          activeTriagem2.delete(address);
          
          // Notifica o front-end para remover o card ativo e mover para a aba de histórico
          if (sseBroadcastFn) {
            sseBroadcastFn({
              event: "archived",
              data: { address }
            });
          }
          continue;
        }

        // Busca os dados atualizados da moeda nas linhas da tabela atual
        let currentMCap = meta.marketCap;
        let currentProgress = meta.progress;
        let currentDevHold = meta.devHold;

        // Localiza as informações mais recentes no texto do DOM baseado no ticker
        const tickerIndex = lines.indexOf(meta.ticker);
        if (tickerIndex !== -1) {
          // No padrão extraído, o MCAP fica duas linhas após o ticker, dev hold fica 3 linhas após, curva de bonding fica 4 linhas após
          if (tickerIndex + 2 < lines.length) currentMCap = lines[tickerIndex + 2];
          if (tickerIndex + 3 < lines.length) currentDevHold = lines[tickerIndex + 3];
          if (tickerIndex + 4 < lines.length) currentProgress = lines[tickerIndex + 4];
        }

        // Salva o ponto de histórico no MySQL
        await db.insertHistoryPoint(address, currentMCap, currentProgress, currentDevHold);
        logMonitor(`📈 Ponto de histórico salvo para ${meta.ticker} | MCap: ${currentMCap} | Progresso: ${currentProgress}`);

        // Transmite o ponto de dados em tempo real para desenhar o gráfico dinâmico no front-end
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
    } catch (err) {
      logMonitor(`Erro no Worker da Triagem 2: ${err.message}`, "ERROR");
    }
  }, 30000); // Roda a cada 30 segundos exatos
}

/**
 * Inicializa todo o monitor de segundo plano
 */
async function initMonitor() {
  await db.initDB();
  await startBrowser();
  await handleLogin();
  
  // 1. Primeiro Boot: Varre e cadastra o estado inicial ignorando as que já estão pagas
  logMonitor("Executando varredura do primeiro boot (Ignorando DEX Paid antigas)...");
  await sweepCoins(true);
  logMonitor("Primeiro boot concluído! Monitoramento ativo de segundo plano iniciado.");

  // 2. Loop de Varredura Recorrente a cada 5 segundos para capturar moedas novas e transições
  monitorInterval = setInterval(async () => {
    try {
      await sweepCoins(false);
    } catch (err) {
      logMonitor(`Erro no ciclo do monitor: ${err.message}`, "ERROR");
    }
  }, 5000);

  // 2.5 Limpeza automática do MySQL: Deleta moedas Unpaid com mais de 2 horas a cada 5 minutos
  setInterval(async () => {
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
  }, 300000); // 5 minutos

  // Recarga leve da página a cada 3 minutos para limpar vazamentos de memória do navegador (Railway friendly)
  setInterval(async () => {
    logMonitor("Recarregando página para limpar cache e renovar WebSocket...");
    try {
      await page.reload({ waitUntil: "commit", timeout: 60000 });
      await page.waitForTimeout(5000);
    } catch (err) {
      logMonitor(`Erro ao recarregar página: ${err.message}`, "WARN");
    }
  }, 180000);

  // 3. Inicializa o worker de alta frequência (30 segundos) para a Triagem 2
  await startActiveStage2Worker();
}

/**
 * Para todos os loops de monitoramento e fecha o navegador de forma limpa
 */
async function stopMonitor() {
  logMonitor("Finalizando monitoramento...");
  if (monitorInterval) clearInterval(monitorInterval);
  if (activeStage2Tracker) clearInterval(activeStage2Tracker);
  if (browser) await browser.close();
  logMonitor("Navegador fechado e monitor finalizado.");
}

module.exports = {
  initMonitor,
  stopMonitor,
  setSSEBroadcast,
  activeTriagem2
};
