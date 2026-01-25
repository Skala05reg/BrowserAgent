import asyncio
from playwright.async_api import async_playwright, Page, BrowserContext
from .dom_parser import DOMParser
from pathlib import Path
from ..utils.logger import logger

class BrowserManager:
    def __init__(self, headless: bool = False, session_file: str = "session.json"):
        self.headless = headless
        self.session_file = session_file
        self.playwright = None
        self.browser = None
        self.context = None
        self.page: Page = None
        self.parser = None

    async def _on_page_created(self, page: Page):
        logger.info("📄 New tab opened. Switching focus to it.")
        await page.wait_for_load_state("domcontentloaded")
        self.page = page
        self.parser = DOMParser(self.page)
        # Re-apply anti-detection
        await self.page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

    async def start(self):
        if self.playwright:
            return

        self.playwright = await async_playwright().start()
        
        # Try launching different browsers if configured
        # Default to chromium, but allow webkit/firefox if chromium crashes
        browser_type = "chromium" 
        
        if browser_type == "chromium":
            self.browser = await self.playwright.chromium.launch(headless=self.headless)
        elif browser_type == "webkit":
            self.browser = await self.playwright.webkit.launch(headless=self.headless)
        elif browser_type == "firefox":
            self.browser = await self.playwright.firefox.launch(headless=self.headless)
        
        # Load storage state if exists (Persistent Session)
        storage_state = self.session_file if Path(self.session_file).exists() else None
        
        self.context = await self.browser.new_context(
            storage_state=storage_state,
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        
        # Handle new tabs automatically
        self.context.on("page", self._on_page_created)
        
        self.page = await self.context.new_page()
        self.parser = DOMParser(self.page)
        
        # Anti-detection / QoL
        await self.page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

    async def get_state(self) -> str:
        """Returns the Accessibility Tree string."""
        return await self.parser.get_interactive_tree()

    async def take_screenshot(self, with_som: bool = False) -> str:
        """
        Takes a screenshot of the current page.
        If with_som is True, overlays Set-of-Marks (IDs) on the image.
        Returns base64 string.
        """
        if not self.page:
            return None

        try:
            if with_som:
                # Inject SoM overlay
                await self.page.evaluate("""() => {
                    const overlay = document.createElement('canvas');
                    overlay.id = 'som-overlay';
                    overlay.style.position = 'absolute';
                    overlay.style.top = '0';
                    overlay.style.left = '0';
                    overlay.style.zIndex = '100000';
                    overlay.style.pointerEvents = 'none';
                    
                    // Match document size
                    const width = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, document.documentElement.offsetWidth);
                    const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, document.documentElement.offsetHeight);
                    
                    overlay.width = width;
                    overlay.height = height;
                    
                    document.body.appendChild(overlay);
                    const ctx = overlay.getContext('2d');
                    
                    const elements = document.querySelectorAll('[data-agent-id]');
                    elements.forEach(el => {
                        const rect = el.getBoundingClientRect();
                        // Adjust for current scroll position since Rect is viewport relative
                        // but we are drawing on an absolute canvas at 0,0 of document
                        const x = rect.left + window.scrollX;
                        const y = rect.top + window.scrollY;
                        
                        // Only draw if visible-ish
                        if (rect.width > 0 && rect.height > 0) {
                            // Box
                            ctx.strokeStyle = '#ff0000';
                            ctx.lineWidth = 2;
                            ctx.strokeRect(x, y, rect.width, rect.height);
                            
                            // Label tag
                            const id = el.getAttribute('data-agent-id');
                            const labelWidth = 20 + (id.length * 8);
                            ctx.fillStyle = '#ff0000';
                            ctx.fillRect(x, Math.max(0, y - 20), labelWidth, 20);
                            
                            // Text
                            ctx.fillStyle = '#ffffff';
                            ctx.font = 'bold 14px monospace';
                            ctx.textBaseline = 'top';
                            ctx.fillText(id, x + 2, Math.max(0, y - 18));
                        }
                    });
                }""")
            
            # Take screenshot (full page or viewport? Viewport is usually better for Agents to see what's "visible")
            # But SoM draws on full document.
            # Let's take viewport screenshot for efficiency and relevance.
            # But if we used full document canvas, it might look weird if we only snap viewport.
            # Actually, Playwright screenshot takes viewport by default.
            
            import base64
            screenshot_bytes = await self.page.screenshot(type='jpeg', quality=70)
            
            if with_som:
                # Cleanup
                await self.page.evaluate("() => { const el = document.getElementById('som-overlay'); if(el) el.remove(); }")
                
            return base64.b64encode(screenshot_bytes).decode('utf-8')
            
        except Exception as e:
            logger.error(f"Screenshot failed: {e}")
            return None

    async def navigate(self, url: str):
        if not url.startswith('http'):
            url = f'https://{url}'
        # Use domcontentloaded for faster navigation on heavy sites
        try:
            await self.page.goto(url, wait_until="domcontentloaded", timeout=15000)
        except Exception as e:
            logger.warning(f"Navigation timeout/warning: {e}. Continuing as content might be loaded.")
        
        # Double check with a short wait
        await self.page.wait_for_load_state("domcontentloaded")

    async def _retry_action(self, func, *args, retries=3, **kwargs):
        """
        Retries an async function with exponential backoff.
        Useful for transient errors like timeouts or network glitches.
        """
        import random
        for i in range(retries):
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                # Check for transient errors
                error_msg = str(e)
                is_transient = "Timeout" in error_msg or "Target closed" in error_msg or "not connected" in error_msg
                
                if not is_transient or i == retries - 1:
                    raise e
                
                # Exponential backoff with jitter
                wait_time = (2 ** i) + random.uniform(0, 1)
                logger.info(f"⚠️ Action failed (Attempt {i+1}/{retries}). Retrying in {wait_time:.2f}s... Error: {e}")
                await asyncio.sleep(wait_time)

    async def act(self, action_name: str, params: dict):
        """
        Executes an action: click, type, scroll, wait, goto.
        Params should contain 'id' for element interactions.
        """
        try:
            # Check if browser is alive before acting
            if not self.page or self.page.is_closed():
                logger.info("♻️ Browser appears closed. Restarting session...")
                await self.close()
                self.playwright = None # Reset
                await self.start()

            if action_name == "goto":
                await self._retry_action(self.navigate, params['url'])
            
            elif action_name == "click":
                target_id = params['id']
                selector = f"[data-agent-id='{target_id}']"
                # Check if visible (using retry for transient visibility issues)
                async def do_click():
                    if await self.page.is_visible(selector, timeout=2000):
                        await self.page.click(selector, timeout=5000)
                    else:
                        raise Exception(f"Element {target_id} is not visible.")
                
                await self._retry_action(do_click)
            
            elif action_name == "type":
                target_id = params['id']
                text = params['text']
                selector = f"[data-agent-id='{target_id}']"
                async def do_type():
                    await self.page.fill(selector, text, timeout=5000)
                    # Trigger blur/change events
                    await self.page.keyboard.press("Tab")
                await self._retry_action(do_type)
            
            elif action_name == "scroll":
                direction = params.get('direction', 'down')
                if direction == 'down':
                    await self.page.evaluate("window.scrollBy(0, 500)")
                else:
                    await self.page.evaluate("window.scrollBy(0, -500)")
                
            elif action_name == "press":
                key = params['key']
                async def do_press():
                    await self.page.keyboard.press(key, timeout=5000)
                await self._retry_action(do_press)
                
            elif action_name == "wait":
                await asyncio.sleep(2)

            elif action_name == "close_tab":
                await self.page.close()
                pages = self.context.pages
                if pages:
                    self.page = pages[-1]
                    self.parser = DOMParser(self.page)
                    await self.page.bring_to_front()
                    return "Closed tab. Switched to previous tab."
                else:
                    return "Closed last tab. Browser empty."

            elif action_name == "switch_tab":
                # index 0 is first tab, -1 is last
                index = int(params.get('index', -1))
                pages = self.context.pages
                if -len(pages) <= index < len(pages):
                    self.page = pages[index]
                    self.parser = DOMParser(self.page)
                    await self.page.bring_to_front()
                    return f"Switched to tab {index} (Title: {await self.page.title()})"
                else:
                    return f"Invalid tab index. {len(pages)} tabs open."
            
            elif action_name == "rollback":
                await self.page.go_back()
                await self.page.wait_for_load_state("domcontentloaded")
                return "Rolled back to previous page."

            elif action_name == "reload":
                await self.page.reload()
                await self.page.wait_for_load_state("domcontentloaded")
                return "Reloaded page."
                
            # Save state after action
            await self.context.storage_state(path=self.session_file)
            return "Success"
            
        except Exception as e:
            error_msg = str(e)
            if "Target page, context or browser has been closed" in error_msg:
                 logger.info("♻️ Browser closed unexpectedly during action. Restarting...")
                 await self.close()
                 self.playwright = None
                 await self.start()
                 return "Error: Browser was closed and has been restarted. Please retry the previous step."

            logger.error(f"Action failed: {e}")
            # Helpful error message pattern
            return f"Error executing {action_name}: {str(e)}. Advice: Check if element ID exists in latest tree. Try 'scroll' if element is off-screen. If page is loading, use 'wait'."

    async def close(self):
        if self.context:
            await self.context.storage_state(path=self.session_file)
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
