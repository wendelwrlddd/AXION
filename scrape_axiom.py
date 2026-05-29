import sys
import time
import re
from playwright.sync_api import sync_playwright

def scrape_axiom():
    print("=" * 60)
    print("🚀 INICIANDO SCRAPER DE AXIOM.TRADE (SOLANA PULSE) - PYTHON...")
    print("=" * 60)
    print("💡 Abrindo o navegador (modo visível para contornar Cloudflare)...")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        
        page = context.new_page()
        
        print("🔗 Acessando: https://axiom.trade/pulse?chain=sol")
        try:
            page.goto("https://axiom.trade/pulse?chain=sol", wait_until="commit", timeout=60000)
        except Exception as e:
            print(f"❌ Erro ao abrir a página: {e}")
            browser.close()
            return

        print("\n⏳ Aguardando a página carregar e o Cloudflare ser resolvido...")
        print("👉 Se aparecer um desafio do Cloudflare (Turnstile/Captcha), clique nele para passar!")
        
        # Aguarda 15 segundos para dar tempo do Cloudflare validar
        for i in range(15, 0, -1):
            sys.stdout.write(f"\rAguardando carregamento... {i}s restantes ")
            sys.stdout.flush()
            time.sleep(1)
        print("\n\n🔍 Iniciando verificação de login...")

        # --- FLUXO DE LOGIN AUTOMÁTICO ---
        try:
            login_link = page.locator('text="Login"').first
            if login_link.is_visible():
                print("🔑 Botão de Login detectado! Realizando autenticação automática...")
                login_link.click()
                
                # Aguarda o modal de login terminar de renderizar e o input ficar visível
                print("⏳ Aguardando campos de formulário ficarem visíveis...")
                email_input = page.locator('input[type="email"], input[placeholder*="email"], input[placeholder*="Email"], input[placeholder*="Enter email"]').first
                pass_input = page.locator('input[type="password"], input[placeholder*="password"], input[placeholder*="Password"], input[placeholder*="Enter password"]').first
                
                email_input.wait_for(state="visible", timeout=15000)

                print("📧 Inserindo credenciais de login...")
                email_input.fill('tobizinho12345678@gmail.com')
                pass_input.fill('laisa1.9')
                
                print("🔘 Clicando no botão de confirmação de Login...")
                submit_btn = page.locator('button:has-text("Login")').last
                submit_btn.click()
                
                print("⏳ Aguardando redirecionamento após login (10s)...")
                page.wait_for_timeout(10000)
            else:
                print("ℹ️ Botão de Login inicial não encontrado. Você já pode estar logado ou a página foi direto para o painel.")
        except Exception as e:
            print(f"⚠️ Não foi possível automatizar o login ou já estava logado: {e}")

        # --- SCREENSHOT DE SEGURANÇA ---
        try:
            page.screenshot(path="axiom_pulse_screenshot_py.png")
            print("📸 Screenshot da página salvo como 'axiom_pulse_screenshot_py.png'")
        except Exception as e:
            print(f"⚠️ Não foi possível tirar screenshot: {e}")

        # --- EXTRAÇÃO E PROCESSAMENTO DOS DADOS ---
        print("\n🔍 Capturando dados da tabela Pulse...")
        try:
            body_text = page.locator("body").inner_text()
            lines = [line.strip() for line in body_text.split("\n") if line.strip()]
            
            print("\n" + "=" * 50)
            print("🎯 PROCESSANDO TOKENS DETECTADOS (PULSE SOLANA):")
            print("=" * 50)
            
            detected_tokens = []
            current_token = None
            
            i = 0
            while i < len(lines):
                line = lines[i]
                
                if re.match(r'^\d+[smhd]\s+ago$', line):
                    if current_token and current_token.get("ticker"):
                        detected_tokens.append(current_token)
                        
                    current_token = {
                        "age": line,
                        "ticker": "N/A",
                        "name": "N/A",
                        "market_cap": "N/A",
                        "dev_hold": "N/A",
                        "progress": "N/A"
                    }
                    
                    if i + 1 < len(lines): current_token["ticker"] = lines[i + 1]
                    if i + 2 < len(lines): current_token["name"] = lines[i + 2]
                    if i + 3 < len(lines): current_token["market_cap"] = lines[i + 3]
                    if i + 4 < len(lines): current_token["dev_hold"] = lines[i + 4]
                    if i + 5 < len(lines): current_token["progress"] = lines[i + 5]
                    
                    i += 5
                i += 1
                
            if current_token and current_token.get("ticker") and current_token["ticker"] != "N/A":
                detected_tokens.append(current_token)

            if detected_tokens:
                print(f"✅ Sucesso! Detectamos {len(detected_tokens)} moedas ativas na Pulse:")
                print("-" * 80)
                for idx, t in enumerate(detected_tokens):
                    ticker = t["ticker"].ljust(8)
                    mcap = t["market_cap"].ljust(8)
                    prog = t["progress"].ljust(6)
                    dev = t["dev_hold"].ljust(6)
                    age = t["age"]
                    print(f"✨ Coin #{idx+1:02d} | Ticker: {ticker} | MCap: {mcap} | Curva: {prog} | Dev Hold: {dev} | Idade: {age}")
                print("-" * 80)
            else:
                print("⚠️ Nenhum padrão de moeda foi extraído com sucesso.")
                print("Dica: Verifique se a página carregou completamente ou se a conta do usuário precisa resolver algum desafio manual.")
                
        except Exception as e:
            print(f"❌ Erro ao extrair textos: {e}")

        print("\n" + "=" * 60)
        print("🏁 Finalizando o scraper. Fechando navegador...")
        print("=" * 60)
        browser.close()

if __name__ == "__main__":
    scrape_axiom()
