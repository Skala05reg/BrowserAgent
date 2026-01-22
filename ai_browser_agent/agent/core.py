import asyncio
from typing import Optional
from ..browser.manager import BrowserManager
from .brain import AgentBrain
from ..utils.logger import logger
from rich.prompt import Confirm

class Agent:
    def __init__(self, start_url: str = "https://google.com"):
        self.browser = BrowserManager(headless=False)
        self.brain = AgentBrain(provider="anthropic")
        self.start_url = start_url

    async def run(self, task: str):
        """Standalone run mode."""
        logger.info(f"🚀 Starting Agent (Standalone) with task: {task}")
        await self.browser.start()
        await self.browser.navigate(self.start_url)
        return await self.run_subtask(task)

    async def run_subtask(self, task: str) -> str:
        """Runs the agent loop for a specific subtask."""
        logger.info(f"🏃 [bold green]Navigator working on:[/bold green] {task}")
        
        step = 0
        max_steps = 20
        
        try:
            while step < max_steps:
                step += 1
                logger.info(f"\n--- Subtask Step {step} ---")
                
                # 1. Observe
                state = await self.browser.get_state()
                
                # 2. Think
                decision = await self.brain.think(state, task)
                choice = decision.get("action", {})
                thought = decision.get("thought", "No thought provided.")
                
                logger.info(f"🧠 Thought: [bold cyan]{thought}[/bold cyan]")
                logger.info(f"⚡ Action: {choice}")
                
                action_name = choice.get("name")
                params = choice.get("params", {})
                
                if action_name == "finish":
                    result = params.get("result", "Done")
                    logger.info(f"✅ Subtask Finished: {result}")
                    return result
                
                # 3. Security Check (Human-in-the-loop)
                if self._is_sensitive_action(action_name, params, thought):
                    if not Confirm.ask(f"⚠️  Security Alert: Agent wants to {action_name} with params {params}. Allow?"):
                        logger.warning("❌ User denied action.")
                        continue
                
                # 4. Act
                if action_name == "ask_user":
                     question = params.get("question", "User attention required.")
                     logger.info(f"🛑 [bold red]HANDOVER REQUESTED[/bold red]: {question}")
                     logger.info("⏸️  Agent paused. Perform manual actions in the browser (Login/Captcha).")
                     input("⌨️  Press ENTER in this terminal when you are ready to resume...")
                     logger.info("▶️  Resuming agent...")
                     result = "User confirmed manual action complete."
                else:
                    result = await self.browser.act(action_name, params)
                
                logger.info(f"👉 Result: {result}")
                await asyncio.sleep(1)
                
            return "Max steps reached without finish."

        except KeyboardInterrupt:
            logger.info("🛑 Stopped by user.")
            return "Stopped by user"
        except Exception as e:
            logger.error(f"Error in subtask: {e}")
            return f"Error: {e}"

    def _is_sensitive_action(self, action: str, params: dict, thought: str = "") -> bool:
        """
        Determines if an action triggers the Security Layer using heuristics.
        """
        sensitive_keywords = ["buy", "checkout", "pay", "delete", "remove", "unsubscribe", "confirm order", "place order"]
        
        if action == "type":
            text = params.get("text", "").lower()
            if "password" in text or "credit card" in text:
                return True
        
        thought_lower = thought.lower()
        if any(keyword in thought_lower for keyword in sensitive_keywords):
            return True
            
        if action == "goto":
            url = params.get("url", "").lower()
            if "checkout" in url or "payment" in url:
                return True

        return False
