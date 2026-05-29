# Base image oficial da Microsoft com Playwright pré-instalado (evita erros de libs no Linux)
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# Cria o diretório da aplicação
WORKDIR /usr/src/app

# Copia os arquivos de pacotes para otimizar cache de build do Docker
COPY package*.json ./

# Instala dependências de produção do Node.js
RUN npm install --only=production

# Instala especificamente os navegadores necessários se faltarem (apenas Chromium leve)
RUN npx playwright install chromium

# Copia o restante do código da aplicação
COPY . .

# Expõe a porta do servidor Express
EXPOSE 3000

# Comando para iniciar o servidor
CMD [ "npm", "start" ]
