import asyncio
import re
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

    async def start_session(self):
        """Starts the browser session."""
        logger.info("🚀 Starting Browser Session...")
        await self.browser.start()
        await self.browser.navigate(self.start_url)

    async def run(self, task: str):
        """Standalone run mode."""
        logger.info(f"🚀 Starting Agent (Standalone) with task: {task}")
        if not self.browser.playwright:
             await self.start_session()
        return await self.run_subtask(task)

    async def run_subtask(self, task: str) -> str:
        """Runs the agent loop for a specific subtask."""
        logger.info(f"🏃 Navigator working on: {task}")
        
        step = 0
        max_steps = 20
        result = None
        
        try:
            while step < max_steps:
                step += 1
                logger.info(f"\n--- Subtask Step {step} ---")
                
                # 1. Observe
                state = await self.browser.get_state()
                
                # Capture Visual State (Multimodal)
                screenshot = await self.browser.take_screenshot(with_som=True)
                if screenshot:
                    logger.info("📸 Visual state captured (with SoM).")
                else:
                    logger.warning("⚠️ Failed to capture visual state.")

                # 2. Think
                decision = await self.brain.think(state, task, last_action_result=result, screenshot_b64=screenshot)
                choice = decision.get("action", {})
                thought = decision.get("thought", "No thought provided.")
                
                # Clean rich tags
                thought = re.sub(r'\[/?bold.*?\]', '', thought)
                
                logger.info(f"🧠 Thought: {thought}")
                logger.info(f"⚡ Action: {choice}")
                
                action_name = choice.get("name")
                params = choice.get("params", {})
                
                if action_name == "finish":
                    result = params.get("result", "Done")
                    logger.info(f"✅ Subtask Finished: {result}")
                    
                    # Reflection & Memory
                    logger.info("🤔 Reflecting on task...")
                    reflection = await self.brain.reflect(task, result, success=True)
                    self.brain.memory.add_experience(task, result, reflection, success=True)
                    logger.info(f"🧠 Learned: {reflection}")
                    
                    return result
                
                # 3. Security Check (Human-in-the-loop)
                if self._is_sensitive_action(action_name, params, thought):
                    if not Confirm.ask(f"⚠️  Security Alert: Agent wants to {action_name} with params {params}. Allow?"):
                        logger.warning("❌ User denied action.")
                        result = "User denied action via security check."
                        continue
                
                # 4. Act
                if action_name == "ask_user":
                     question = params.get("question", "User attention required.")
                     logger.info(f"🛑 HANDOVER REQUESTED: {question}")
                     logger.info("⏸️  Agent paused. Perform manual actions in the browser (Login/Captcha).")
                     input("⌨️  Press ENTER in this terminal when you are ready to resume...")
                     logger.info("▶️  Resuming agent...")
                     result = "User confirmed manual action complete."
                else:
                    result = await self.browser.act(action_name, params)
                
                logger.info(f"👉 Result: {result}")
                await asyncio.sleep(1)
            
            msg = "Max steps reached without finish."
            logger.warning(f"❌ {msg}")
            reflection = await self.brain.reflect(task, msg, success=False)
            self.brain.memory.add_experience(task, msg, reflection, success=False)
            return msg

        except KeyboardInterrupt:
            logger.info("🛑 Stopped by user.")
            return "Stopped by user"
        except Exception as e:
            logger.error(f"Error in subtask: {e}")
            msg = f"Error: {e}"
            # Attempt reflection even on error
            try:
                reflection = await self.brain.reflect(task, msg, success=False)
                self.brain.memory.add_experience(task, msg, reflection, success=False)
            except Exception as mem_e:
                logger.warning(f"Failed to reflect on error: {mem_e}")
            return msg

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
