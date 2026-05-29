# Instruções para Executar o Scraper da Axiom Trade

Este projeto contém dois scripts de scraping básicos criados para extrair dados da aba **Pulse** do site **Axiom Trade** (especificamente da blockchain Solana: `https://axiom.trade/pulse?chain=sol`).

Como o site é protegido pelo **Cloudflare Managed Challenge**, requisições normais (via HTTP pura) são bloqueadas. Por isso, ambos os scrapers usam **Playwright**, abrindo um navegador visível temporariamente para resolver o desafio do Cloudflare e extrair a tabela de moedas.

Escolha a opção que preferir (Python ou Node.js) para rodar o scraper.

---

## Opção A: Executar usando Node.js (Recomendado)

### 1. Instalar o Node.js
Se você não tem o Node.js instalado:
1. Baixe e instale a versão **LTS** do site oficial: [nodejs.org](https://nodejs.org/).
2. A instalação no Windows é um assistente simples do tipo "Avançar -> Avançar -> Concluir".

### 2. Configurar o Projeto no Terminal
Abra o PowerShell ou Prompt de Comando na pasta deste projeto (`c:\Users\wendel\Desktop\axion`) e execute:

```powershell
# Inicializa o projeto Node.js
npm init -y

# Instala a biblioteca Playwright
npm install playwright
```

### 3. Executar o Scraper
Rode o comando:

```powershell
node scrape_axiom.js
```

---

## Opção B: Executar usando Python

### 1. Instalar o Python
Se você não tem o Python instalado:
1. Baixe e instale o Python 3.10 ou superior do site oficial: [python.org](https://python.org/).
2. **IMPORTANTE:** Durante a instalação no Windows, marque a caixinha que diz **"Add Python to PATH"** (Adicionar Python às variáveis de ambiente) na primeira tela do instalador.

### 2. Configurar o Playwright no Terminal
Abra o PowerShell ou Prompt de Comando na pasta do projeto e execute:

```powershell
# Instala o pacote do Playwright para Python
pip install playwright

# Instala os navegadores necessários para o Playwright rodar
playwright install
```

### 3. Executar o Scraper
Rode o comando:

```powershell
python scrape_axiom.py
```

---

## Como o Scraper Funciona e o que ele Puxa:

1. **Abertura do Navegador:** Ele abre uma janela do navegador Chromium (visível na sua tela).
2. **Resolução de Cloudflare:** Ele entra em `axiom.trade/pulse?chain=sol`. Se aparecer a tela do Cloudflare pedindo para "Marcar a caixinha" ou resolver o desafio, o navegador dará 15 segundos para você interagir e o desafio ser resolvido de forma legítima.
3. **Screenshot de Segurança:** Ele salva um screenshot da tela com o nome `axiom_pulse_screenshot.png` para você ver exatamente o que o script enxergou.
4. **Extração de Texto Bruto:** Ele puxa todo o conteúdo visível de texto da página.
5. **Processamento Inteligente (Regex):** O script analisa o texto linha por linha para detectar o padrão de cada moeda. Ele procura por:
   - **Ticker (Símbolo):** Identifica os símbolos em letras maiúsculas.
   - **Market Cap:** Extrai valores como `$15K`, `$1.2M`, `$500K` etc.
   - **Progresso da Curva (Bonding Curve):** Identifica a porcentagem de migração da moeda (ex: `85%`, `99%` etc. que indica o quão perto ela está de migrar para a Raydium).
   - **Idade:** Extrai há quanto tempo a moeda foi criada (ex: `5m`, `1h`, `10s`).
6. **Resultados no Terminal:** Ele formata tudo em uma lista limpa no terminal para você ver.
