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

    async def start(self):
        self.playwright = await async_playwright().start()
        
        # Try launching different browsers if configured
        # Default to chromium, but allow webkit/firefox if chromium crashes
        browser_type = "webkit" # Switched to webkit due to chromium instability
        
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
            viewport={"width": 1280, "height": 800}
        )
        
        self.page = await self.context.new_page()
        self.parser = DOMParser(self.page)
        
        # Anti-detection / QoL
        await self.page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

    async def get_state(self) -> str:
        """Returns the Accessibility Tree string."""
        return await self.parser.get_interactive_tree()

    async def navigate(self, url: str):
        if not url.startswith('http'):
            url = f'https://{url}'
        await self.page.goto(url)
        await self.page.wait_for_load_state("domcontentloaded")

    async def act(self, action_name: str, params: dict):
        """
        Executes an action: click, type, scroll, wait, goto.
        Params should contain 'id' for element interactions.
        """
        try:
            if action_name == "goto":
                await self.navigate(params['url'])
            
            elif action_name == "click":
                target_id = params['id']
                selector = f"[data-agent-id='{target_id}']"
                # Check if visible
                if await self.page.is_visible(selector):
                    await self.page.click(selector)
                else:
                    return f"Error: Element {target_id} is not visible."
            
            elif action_name == "type":
                target_id = params['id']
                text = params['text']
                selector = f"[data-agent-id='{target_id}']"
                await self.page.fill(selector, text)
            
            elif action_name == "scroll":
                direction = params.get('direction', 'down')
                if direction == 'down':
                    await self.page.evaluate("window.scrollBy(0, 500)")
                else:
                    await self.page.evaluate("window.scrollBy(0, -500)")
                
            elif action_name == "press":
                key = params['key']
                await self.page.keyboard.press(key)
                
            elif action_name == "wait":
                await asyncio.sleep(2)
                
            # Save state after action
            await self.context.storage_state(path=self.session_file)
            return "Success"
            
        except Exception as e:
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
