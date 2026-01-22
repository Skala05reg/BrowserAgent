import os
from typing import List, Dict, Any
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI
from ..utils.logger import logger
from dotenv import load_dotenv

load_dotenv()

class AgentBrain:
    def __init__(self, provider: str = "anthropic", model: str = None, system_prompt: str = None):
        self.provider = provider
        self.history: List[Dict[str, str]] = []
        self._custom_system_prompt = system_prompt
        
        if provider == "anthropic":

            api_key = os.getenv("ANTHROPIC_API_KEY")
            base_url = os.getenv("ANTHROPIC_BASE_URL")
            
            # Try loading from ~/.claude/settings.json if no env var
            if not api_key:
                try:
                    config_path = os.path.expanduser("~/.claude/settings.json")
                    if os.path.exists(config_path):
                        import json
                        with open(config_path, 'r') as f:
                            data = json.load(f)
                            env_config = data.get("env", {})
                            api_key = env_config.get("ANTHROPIC_AUTH_TOKEN")
                            base_url = env_config.get("ANTHROPIC_BASE_URL")
                            # Also check for model preference
                            if not model:
                                model = env_config.get("ANTHROPIC_DEFAULT_SONNET_MODEL")
                except Exception as e:
                    logger.warning(f"Failed to load claude settings: {e}")

            if not api_key:
                 raise ValueError("No API Key found. Set ANTHROPIC_API_KEY in .env or ~/.claude/settings.json")
            
            self.client = AsyncAnthropic(
                api_key=api_key,
                base_url=base_url
            )
            self.model = model or "claude-3-5-sonnet-20241022"

    def _system_prompt(self) -> str:
        if self._custom_system_prompt:
             return self._custom_system_prompt
             
        return """
You are an expert AI Browser Agent. Your goal is to navigate the web to accomplish the user's task efficiently.

# Architecture & Tools
You interact with a browser via a simplified "Accessibility Tree". 
- **State**: You verify the page content by reading the provided Tree.
- **IDs**: Interactive elements have IDs like [12]. Use ONLY these IDs for actions.

## Available Tools
1. **click(id: int)**: Click a button/link. 
   - *Tip*: If a link opens a new tab, use `wait()` to let it load.
2. **type(id: int, text: str)**: Type text into an input.
   - *Tip*: For search bars, usually type first, then click the search button/icon.
3. **act(action: str, params: dict)**: Generic fallback.
4. **scroll(direction: "up" | "down")**: revealing more content.
   - *Tip*: If you don't see the element, scroll down.
5. **goto(url: str)**: Navigate to a URL.
   - *Tip*: Use full URLs (https://...).
6. **wait()**: Wait 2 seconds. Use this if the page feels transient or loading.
7. **ask_user(question: str)**: Pause execution and ask the user for help (e.g., for login, CAPTCHA, or 2FA).
   - *Tip*: Use this if you are stuck at a Login screen or need a 2FA code.
8. **finish(result: str)**: CRITICAL. Call this ONLY when you have the final answer.

# Strategy (CoT)
1. **Analyze**: Look at the *Current Browser State*. Identify key elements (search bars, nav links).
2. **Plan**: If looking for info, find a search bar -> type -> click search -> read results.
3. **Refine**: If you get an error, try a different approach (e.g., scroll, or try a different generic selector if ID fails).

# Output Format (Strict JSON)
{
  "thought": "I see a search bar [5]. I will type 'Turing Test' into it.",
  "action": {
    "name": "type",
    "params": { "id": 5, "text": "Turing Test" }
  }
}
"""

    async def think(self, state: str, task: str) -> Dict[str, Any]:
        """
        Sends the current state and task history to the LLM and returns the next action.
        """
        import json
        
        # Prepare context
        # We don't want to send the *entire* history of huge trees if possible, 
        # but for this prototype we will keep it simple.
        # Ideally we only keep the last state or summary.
        
        prompt = f"""
Current Task: {task}

Current Browser State:
{state}

What is your next move?
"""
        messages = [
            {"role": "system", "content": self._system_prompt()},
        ]
        
        # Add abbreviated history to maintain context without blowing tokens
        # (For now, just appending the new message, but in a real app would trunk)
        for msg in self.history:
            messages.append(msg)
            
        messages.append({"role": "user", "content": prompt})
        
        try:
            if self.provider == "anthropic":
                response = await self.client.messages.create(
                    model=self.model,
                    max_tokens=1000,
                    messages=[m for m in messages if m['role'] != 'system'], # System is separate param
                    system=self._system_prompt()
                )
                content = response.content[0].text
                
            elif self.provider == "openai":
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    response_format={"type": "json_object"}
                )
                content = response.choices[0].message.content

            # Parse JSON
            try:
                # Cleanup markdown code blocks if present
                clean_content = content.replace('```json', '').replace('```', '').strip()
                action_data = json.loads(clean_content)
                
                # Update history
                self.history.append({"role": "user", "content": f"State: [Hidden to save space, was {len(state)} chars]"}) 
                self.history.append({"role": "assistant", "content": content})
                
                return action_data
            except json.JSONDecodeError:
                logger.error(f"Failed to parse JSON from LLM: {content}")
                return {
                    "thought": "Error parsing response",
                    "action": {"name": "wait", "params": {}}
                }

        except Exception as e:
            logger.error(f"LLM Error: {e}")
            return {
                "thought": f"Error: {e}",
                "action": {"name": "wait", "params": {}}
            }
