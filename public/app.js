// Estado Global do Front-end
let activeCoins = [];
let historicalCoins = [];
const charts = new Map(); // Guarda instâncias do Chart.js por moeda (address => chart)
let currentTab = 'triagem2';

// Cache de Elementos do DOM
const serverStatus = document.getElementById('serverStatus');
const activeCount = document.getElementById('activeCount');
const historyCount = document.getElementById('historyCount');
const stage2Grid = document.getElementById('stage2Grid');
const stage3TableBody = document.getElementById('stage3TableBody');
const searchTickerInput = document.getElementById('searchTicker');
const minMCapInput = document.getElementById('minMCap');
const mcapDisplay = document.getElementById('mcapDisplay');
const soundToggle = document.getElementById('soundToggle');

/**
 * Utilitário: Converte string de Market Cap para número puro para o gráfico
 * Exemplo: "$15.5K" -> 15500 | "$1.2M" -> 1200000
 */
function parseMarketCapToNumber(str) {
  if (!str || str === 'N/A') return 0;
  const clean = str.replace(/[$,\s]/g, '').toUpperCase();
  if (clean.endsWith('K')) {
    return parseFloat(clean) * 1000;
  }
  if (clean.endsWith('M')) {
    return parseFloat(clean) * 1000000;
  }
  if (clean.endsWith('B')) {
    return parseFloat(clean) * 1000000000;
  }
  const val = parseFloat(clean);
  return isNaN(val) ? 0 : val;
}

/**
 * Sintetizador de Áudio Premium usando Web Audio API nativa
 * Não precisa de arquivos mp3 externos, toca de forma 100% garantida e sem atrasos.
 */
function playPremiumChime() {
  if (!soundToggle.checked) return;
  
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    // Oscilador 1: Som agudo cristalino
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(987.77, ctx.currentTime); // Nota Si (B5)
    osc1.frequency.exponentialRampToValueAtTime(1318.51, ctx.currentTime + 0.15); // E6
    
    gain1.gain.setValueAtTime(0.12, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    
    // Oscilador 2: Harmônico de suporte
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
    gain2.gain.setValueAtTime(0.06, ctx.currentTime);
    gain2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.7);
    
    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc1.start();
    osc2.start();
    
    osc1.stop(ctx.currentTime + 0.5);
    osc2.stop(ctx.currentTime + 0.7);
  } catch (e) {
    console.warn("Áudio bloqueado pelo navegador até o usuário interagir:", e);
  }
}

/**
 * Inicializa ou atualiza o Sparkline Chart.js dentro do card da moeda
 */
function initOrUpdateChart(address, historyPoints = []) {
  const canvas = document.getElementById(`chart-${address}`);
  if (!canvas) return;

  const sortedHistory = [...historyPoints].sort((a, b) => a.timestamp - b.timestamp);
  const labels = sortedHistory.map(h => `${h.elapsedSeconds}s`);
  const data = sortedHistory.map(h => parseMarketCapToNumber(h.marketCap));

  if (charts.has(address)) {
    // Atualiza o gráfico existente
    const chart = charts.get(address);
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.update('none'); // Update suave sem animações bruscas
  } else {
    // Cria novo gráfico
    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          borderColor: '#a855f7', // accent-purple
          borderWidth: 2,
          pointRadius: sortedHistory.length > 15 ? 0 : 2, // remove pontos se forem muitos dados
          pointHoverRadius: 4,
          fill: true,
          backgroundColor: 'rgba(168, 85, 247, 0.06)',
          tension: 0.35
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                const val = context.parsed.y;
                if (val >= 1000000) return `$${(val/1000000).toFixed(1)}M`;
                if (val >= 1000) return `$${(val/1000).toFixed(0)}K`;
                return `$${val}`;
              }
            }
          }
        },
        scales: {
          x: { display: false },
          y: { display: false }
        }
      }
    });
    charts.set(address, chart);
  }
}

/**
 * Navegação por abas
 */
function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
  
  if (tabId === 'triagem2') {
    document.querySelector('[onclick="switchTab(\'triagem2\')"]').classList.add('active');
    document.getElementById('triagem2Tab').classList.remove('hidden');
  } else {
    document.querySelector('[onclick="switchTab(\'triagem3\')"]').classList.add('active');
    document.getElementById('triagem3Tab').classList.remove('hidden');
    fetchStage3History();
  }
}

/**
 * Atualiza o label numérico do controle deslizante de Market Cap
 */
function updateMCapLabel(value) {
  mcapDisplay.innerText = value === "0" ? "Sem limite" : `$${value}K`;
}

/**
 * Carrega as moedas ativas (Triagem 2) do backend Express
 */
async function fetchActiveCoins() {
  try {
    const res = await fetch('/api/active');
    activeCoins = await res.json();
    renderStage2Grid();
    updateHeaderStats();
  } catch (err) {
    console.error("Erro ao carregar moedas ativas:", err);
  }
}

/**
 * Carrega o histórico consolidado (Triagem 3) do MySQL
 */
async function fetchStage3History() {
  try {
    const res = await fetch('/api/history');
    historicalCoins = await res.json();
    renderStage3Table();
    updateHeaderStats();
  } catch (err) {
    console.error("Erro ao carregar banco histórico:", err);
  }
}

/**
 * Renderiza os cards ativos na Triagem 2
 */
function renderStage2Grid() {
  // Limpa gráficos existentes para evitar vazamentos de memória
  charts.forEach(chart => chart.destroy());
  charts.clear();

  const filtered = filterCoins(activeCoins);

  if (filtered.length === 0) {
    stage2Grid.innerHTML = `
      <div class="no-data-card" id="noActiveData">
        <div class="spinner-neon"></div>
        <p>Nenhuma moeda ativa na Triagem 2 satisfaz os filtros atuais...</p>
        <span class="subtext">Ajuste o filtro de Market Cap Mínimo ou aguarde novos lançamentos do Axiom.</span>
      </div>
    `;
    return;
  }

  stage2Grid.innerHTML = '';
  filtered.forEach(coin => {
    const card = createCoinCardElement(coin);
    stage2Grid.appendChild(card);
    initOrUpdateChart(coin.address, coin.history || []);
  });
}

/**
 * Cria o elemento HTML de um Card de Moeda ativa
 */
function createCoinCardElement(coin) {
  const card = document.createElement('div');
  card.className = 'coin-card';
  card.id = `card-${coin.address}`;
  
  // Se a moeda pagou nos últimos 30 segundos, brilha verde neon
  const timeSincePaid = Date.now() - coin.paidAt;
  if (timeSincePaid < 30000) {
    card.classList.add('newly-added');
    setTimeout(() => {
      card.classList.remove('newly-added');
    }, 30000 - timeSincePaid);
  }

  // Prepara links rápidos de utilitários
  const tokenAddress = coin.address.replace('solana:', '');
  const axiomLink = `https://axiom.trade/meme/${tokenAddress}?chain=sol`;
  const dexscreenerLink = `https://dexscreener.com/solana/${tokenAddress}`;

  card.innerHTML = `
    <div class="card-header">
      <div class="token-info">
        <span class="token-ticker">${coin.ticker}</span>
        <span class="token-name" title="${coin.name || ''}">${coin.name || 'N/A'}</span>
      </div>
      <div class="countdown-box" id="timer-${coin.address}">15:00</div>
    </div>
    
    <div class="card-metrics">
      <div class="metric-item">
        <span class="metric-label">M. Cap</span>
        <span class="metric-value value-green" id="mcap-${coin.address}">${coin.initialMarketCap}</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">Progresso</span>
        <span class="metric-value" id="prog-${coin.address}">${coin.initialProgress}</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">Dev Hold</span>
        <span class="metric-value" id="dev-${coin.address}">${coin.initialDevHold}</span>
      </div>
    </div>
    
    <div class="card-chart-area">
      <canvas id="chart-${coin.address}"></canvas>
    </div>
    
    <div class="card-footer">
      <span class="card-time-ago" id="elapsed-${coin.address}">paid 0s ago</span>
      <div class="trade-links">
        <a href="${axiomLink}" target="_blank" class="trade-link link-highlight">Axiom</a>
        <a href="${dexscreenerLink}" target="_blank" class="trade-link">DexS</a>
      </div>
    </div>
  `;

  return card;
}

/**
 * Renderiza a Tabela de Moedas da Triagem 3 (Histórico MySQL)
 */
function renderStage3Table() {
  const filtered = filterCoins(historicalCoins);
  
  if (filtered.length === 0) {
    stage3TableBody.innerHTML = `
      <tr>
        <td colspan="7" class="table-no-data">Nenhuma moeda arquivada satisfaz os filtros atuais.</td>
      </tr>
    `;
    return;
  }

  stage3TableBody.innerHTML = '';
  filtered.forEach(coin => {
    const row = document.createElement('tr');
    
    const paidDate = new Date(coin.paid_at);
    const timeFormatted = paidDate.toLocaleTimeString() + ' (' + paidDate.toLocaleDateString() + ')';
    
    // Limpa endereço interno para exibição
    const displayAddress = coin.address.startsWith('solana:') ? coin.address.substring(7) : coin.address;

    row.innerHTML = `
      <td>${coin.ticker}</td>
      <td>${coin.name || 'N/A'}</td>
      <td class="text-accent-green">${coin.initial_market_cap}</td>
      <td>${coin.initial_progress}</td>
      <td>${coin.initial_dev_hold}</td>
      <td>${timeFormatted}</td>
      <td><span class="table-address" title="${displayAddress}">${displayAddress.substring(0,6)}...${displayAddress.substring(displayAddress.length-4)}</span></td>
    `;
    stage3TableBody.appendChild(row);
  });
}

/**
 * Aplica filtros dinâmicos de Busca e Market Cap Mínimo
 */
function filterCoins(coinList) {
  const search = searchTickerInput.value.toLowerCase().trim();
  const minMCap = parseInt(minMCapInput.value, 10) * 1000;

  return coinList.filter(coin => {
    // 1. Filtro de Texto (Ticker ou Nome)
    const matchesSearch = !search || 
      coin.ticker.toLowerCase().includes(search) || 
      (coin.name && coin.name.toLowerCase().includes(search));
      
    // 2. Filtro de Capitalização
    const capStr = coin.initialMarketCap || coin.initial_market_cap;
    const numericCap = parseMarketCapToNumber(capStr);
    const matchesCap = minMCap === 0 || numericCap >= minMCap;

    return matchesSearch && matchesCap;
  });
}

/**
 * Aplica os filtros instantaneamente em ambas as abas
 */
function applyFilters() {
  if (currentTab === 'triagem2') {
    renderStage2Grid();
  } else {
    renderStage3Table();
  }
}

/**
 * Atualiza os valores do Header (Totalizadores)
 */
function updateHeaderStats() {
  activeCount.innerText = activeCoins.length;
  // Para Triagem 3, fazemos uma chamada rápida ao banco se a aba não estiver ativa
  historyCount.innerText = historicalCoins.length;
}

/**
 * Cronômetros Ativos de Contagem Regressiva e Tempo Decorrido (Atualizados a cada segundo)
 */
setInterval(() => {
  if (activeCoins.length === 0) return;

  const now = Date.now();
  const fifteenMinutesMs = 15 * 60 * 1000;

  activeCoins.forEach(coin => {
    const elapsed = now - coin.paidAt;
    
    // 1. Calcula o Timer Regressivo (15m -> 0s)
    const timerElem = document.getElementById(`timer-${coin.address}`);
    if (timerElem) {
      if (elapsed >= fifteenMinutesMs) {
        timerElem.innerText = "00:00";
      } else {
        const remainingMs = fifteenMinutesMs - elapsed;
        const totalSecs = Math.floor(remainingMs / 1000);
        const mins = Math.floor(totalSecs / 60).toString().padStart(2, '0');
        const secs = (totalSecs % 60).toString().padStart(2, '0');
        timerElem.innerText = `${mins}:${secs}`;
      }
    }

    // 2. Calcula o Tempo Decorrido desde a DEX paga
    const elapsedElem = document.getElementById(`elapsed-${coin.address}`);
    if (elapsedElem) {
      const totalSecs = Math.floor(elapsed / 1000);
      if (totalSecs < 60) {
        elapsedElem.innerText = `paid ${totalSecs}s ago`;
      } else {
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        elapsedElem.innerText = `paid ${mins}m ${secs}s ago`;
      }
    }
  });
}, 1000);

/**
 * Conexão do Stream em Tempo Real Server-Sent Events (SSE)
 */
function initRealTimeStream() {
  console.log("📡 Conectando ao canal de atualizações em tempo real (SSE)...");
  
  const eventSource = new EventSource('/api/stream');

  eventSource.onopen = () => {
    console.log("✅ SSE: Conexão estabelecida com sucesso!");
    serverStatus.className = "pulse-indicator glow-green";
  };

  eventSource.onerror = (err) => {
    console.warn("⚠️ SSE: Conexão interrompida. Tentando reconectar...", err);
    serverStatus.className = "pulse-indicator glow-red";
  };

  // Escuta os eventos transmitidos pelo monitor do backend
  eventSource.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      
      if (payload.event === "transition") {
        // Nova moeda acabou de pagar a taxa DEX!
        const newCoin = payload.data;
        
        // Evita duplicados em memória
        if (!activeCoins.some(c => c.address === newCoin.address)) {
          // Adiciona ao topo da lista ativa
          newCoin.history = [];
          activeCoins.unshift(newCoin);
          
          // Toca chime agradável se ativado
          playPremiumChime();
          
          console.log(`🚨 Nova moeda paga recebida via SSE: ${newCoin.ticker}`);
          renderStage2Grid();
          updateHeaderStats();
        }
      } 
      
      else if (payload.event === "history_point") {
        // Recebeu um snapshot de alta frequência a cada 30 segundos
        const point = payload.data;
        const coin = activeCoins.find(c => c.address === point.address);
        
        if (coin) {
          // Atualiza as métricas no card do DOM diretamente (resposta rápida)
          const mcapElem = document.getElementById(`mcap-${point.address}`);
          const progElem = document.getElementById(`prog-${point.address}`);
          const devElem = document.getElementById(`dev-${point.address}`);
          
          if (mcapElem) mcapElem.innerText = point.marketCap;
          if (progElem) progElem.innerText = point.progress;
          if (devElem) devElem.innerText = point.devHold;
          
          // Adiciona o ponto ao array histórico em memória
          if (!coin.history) coin.history = [];
          coin.history.push({
            marketCap: point.marketCap,
            progress: point.progress,
            devHold: point.devHold,
            timestamp: point.timestamp,
            elapsedSeconds: point.elapsedSeconds
          });

          // Atualiza a linha do gráfico Chart.js instantaneamente
          initOrUpdateChart(point.address, coin.history);
        }
      } 
      
      else if (payload.event === "archived") {
        // O cronômetro de 15 minutos de uma moeda expirou no servidor!
        const address = payload.data.address;
        console.log(`📦 SSE: Moeda arquivada da Triagem 2 para Triagem 3: ${address}`);
        
        // Remove da lista em memória ativa
        activeCoins = activeCoins.filter(c => c.address !== address);
        
        // Destrói gráfico do card
        if (charts.has(address)) {
          charts.get(address).destroy();
          charts.clear();
        }
        
        // Atualiza a interface
        renderStage2Grid();
        
        // Se a aba do banco estiver visível, atualiza a tabela para incluir o novo arquivado
        if (currentTab === 'triagem3') {
          fetchStage3History();
        } else {
          // Se não, só atualiza os contadores superiores
          updateHeaderStats();
        }
      }
    } catch (e) {
      console.error("Erro ao analisar mensagem do stream SSE:", e);
    }
  };
}

// Funções de Download
function downloadCSV() {
  window.open('/api/export/csv', '_blank');
}

function downloadJSON() {
  window.open('/api/export/json', '_blank');
}

// Inicialização Geral da Página
window.addEventListener('DOMContentLoaded', async () => {
  updateMCapLabel(minMCapInput.value);
  
  // 1. Carrega o estado inicial das moedas do banco de dados
  await fetchActiveCoins();
  await fetchStage3History();
  
  // 2. Conecta ao SSE para atualizações contínuas de tempo real
  initRealTimeStream();
  
  // 3. Destrava áudio premium ao primeiro clique do usuário na tela
  document.body.addEventListener('click', () => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
    } catch (e) {}
  }, { once: true });
});
