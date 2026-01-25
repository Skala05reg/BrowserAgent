import asyncio
import re
from typing import Dict, Any
from .brain import AgentBrain
from .core import Agent
from ..utils.logger import logger

PLANNER_PROMPT = """
You are a High-Level Planner Agent (CEO).
Your goal is to break down the User's Task into a sequence of specific Browser Sub-tasks.
You have a 'Navigator' worker who controls the browser.

# Available Tools
1. **delegate(subtask: str)**: Send a clear, actionable sub-task to the Navigator.
   - Example: "Go to google.com and search for 'python'"
   - Example: "Find the price of the first item"
2. **ask_user(question: str)**: Pause and ask user for help (Login, CAPTCHA).
3. **finish(result: str)**: The GLOBAL task is complete.

# Strategy
- Don't try to click things yourself. You can't. You only Delegate.
- Keep subtasks focused.
- If the Navigator fails, try a different approach or ask the user.

# Response Format (JSON)
{
  "thought": "I need to find the movie first.",
  "action": { "name": "delegate", "params": { "subtask": "Go to imdb.com and search for 'Matrix'" } }
}
"""

class PlannerAgent:
    def __init__(self):
        self.brain = AgentBrain(provider="anthropic", system_prompt=PLANNER_PROMPT)
        self.navigator = Agent() # The worker
        
    async def start_session(self):
        """Initializes the browser session once."""
        await self.navigator.start_session()

    async def run(self, user_task: str):
        logger.info(f"👔 Planner Agent started with task: {user_task}")
        
        # Ensure browser is running
        if not self.navigator.browser.playwright:
            await self.start_session()
        
        completed_steps = []
        
        try:
            while True:
                # 1. Plan
                # Construct state from completed steps
                history_str = "\n".join([f"- {s}" for s in completed_steps])
                state_desc = f"Global Task: {user_task}\nCompleted Steps:\n{history_str}\n"
                
                decision = await self.brain.think(state_desc, "What is the next sub-task?")
                
                choice = decision.get("action", {})
                thought = decision.get("thought", "")
                
                # Clean rich tags from thought if LLM generates them
                thought = re.sub(r'\[/?bold.*?\]', '', thought)
                
                logger.info(f"👔 Planner Thought: {thought}")
                action_name = choice.get("name")
                params = choice.get("params", {})
                
                if action_name == "finish":
                    logger.info(f"🎉 Global Task Finished: {params.get('result')}")
                    break
                    
                elif action_name == "ask_user":
                     # Reuse logic or delegate to core? Let's handle here for Planner level
                     question = params.get("question")
                     logger.info(f"🛑 HANDOVER: {question}")
                     input("Press ENTER to resume...")
                     completed_steps.append(f"User helped with: {question}")
                     
                elif action_name == "delegate":
                    subtask = params.get("subtask")
                    logger.info(f"👉 Delegating to Navigator: {subtask}")
                    
                    # Run the navigator in a generic way
                    # We need to modify Navigator to run a single subtask and RETURN.
                    # Current Navigator runs a while loop 30 steps.
                    # Let's use it as is, but maybe limit steps or expect a 'finish' from it.
                    
                    result = await self.navigator.run_subtask(subtask)
                    completed_steps.append(f"Subtask '{subtask}' result: {result}")
                    
                else:
                    logger.warning(f"Unknown tool: {action_name}")

        finally:
            # await self.navigator.browser.close()
            pass
