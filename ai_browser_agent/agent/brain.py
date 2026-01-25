import os
from typing import List, Dict, Any, Optional
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI
from ..utils.logger import logger
from .memory import MemorySystem
from dotenv import load_dotenv

load_dotenv()

class AgentBrain:
    def __init__(self, provider: str = "anthropic", model: str = None, system_prompt: str = None):
        self.provider = provider
        self.history: List[Dict[str, str]] = []
        self._custom_system_prompt = system_prompt
        
        # Initialize Memory
        self.memory = MemorySystem()
        
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
You are an expert AI Browser Agent using the ReAct (Reasoning + Acting) pattern. 
Your goal is to navigate the web to accomplish the user's task efficiently and robustly.

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
7. **rollback()**: Go back to the previous page. Use this if you clicked the wrong link.
8. **reload()**: Refresh the current page. Use this if the page seems broken or stuck.
9. **ask_user(question: str)**: Pause execution and ask the user for help (e.g., for login, CAPTCHA, or 2FA).
   - *Tip*: Use this if you are stuck at a Login screen or need a 2FA code.
10. **finish(result: str)**: CRITICAL. Call this ONLY when you have the final answer.

# ReAct Strategy (Thought -> Action -> Observation)
1. **Observe**: Analyze the *Current Browser State* and the *History* of your previous actions.
2. **Think**: 
    - **Analyze**: What did my last action achieve? Did it fail? Am I closer to the goal?
    - **Plan**: What is the immediate next step? Do I need to search? Scroll? Click?
    - **Refine**: If I encountered an error previously, how will I try differently?
    - **CRITICAL - JOB APPLICATIONS**: When applying on sites like hh.ru, **NEVER** click the main "Apply" (Откликнуться) button immediately if you need to write a cover letter. First, look for a "Write cover letter" (Сопроводительное письмо) link/toggle. The main button often sends the application *instantly* without a letter.
3. **Act**: Execute the chosen tool.

# Output Format (Strict JSON)
You must output a JSON object with two keys: "thought" and "action".
- "thought": A clear string explaining your reasoning. trace your steps.
- "action": An object with "name" and "params".

Example:
{
  "thought": "I see a search bar [5] and the user wants to search for 'Turing Test'. I will type the query.",
  "action": {
    "name": "type",
    "params": { "id": 5, "text": "Turing Test" }
  }
}
"""

    async def reflect(self, task: str, result: str, success: bool) -> str:
        """
        Analyzes the session history and generates a reflection/lesson learned.
        """
        history_text = "\n".join([f"{h['role']}: {h['content']}" for h in self.history if isinstance(h['content'], str)])
        
        prompt = f"""
I just completed (or attempted) a task.
Task: {task}
Result: {result}
Success: {success}

History of actions:
{history_text}

Please generate a concise "lesson learned" or "reflection" (max 2 sentences) that will help me handle similar tasks better in the future.
If I failed, explain why and what to avoid. If I succeeded, note the key successful strategy.
"""
        try:
            if self.provider == "anthropic":
                response = await self.client.messages.create(
                    model=self.model,
                    max_tokens=200,
                    messages=[{"role": "user", "content": prompt}],
                )
                return response.content[0].text
            elif self.provider == "openai":
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=[{"role": "user", "content": prompt}],
                )
                return response.choices[0].message.content
        except Exception as e:
            logger.error(f"Reflection failed: {e}")
            return "Could not generate reflection."

    async def think(self, state: str, task: str, last_action_result: str = None, screenshot_b64: str = None) -> Dict[str, Any]:
        """
        Sends the current state and task history to the LLM and returns the next action.
        """
        import json
        
        # Retrieve Memory
        memories = self.memory.retrieve_relevant(task)
        memory_context = ""
        if memories:
            memory_context = "\n## Relevant Past Experiences (Memory)\n"
            for mem in memories:
                memory_context += f"- Task: {mem['task']}\n  Reflection: {mem['reflection']}\n"
        
        # Prepare context
        previous_result_str = f"\nPrevious Action Result: {last_action_result}" if last_action_result else ""
        
        prompt_text = f"""
Current Task: {task}
{previous_result_str}
{memory_context}

Current Browser State:
{state}

What is your next move?
"""
        # Construct the content part of the message
        user_content = []
        
        if screenshot_b64:
            if self.provider == "anthropic":
                user_content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": screenshot_b64
                    }
                })
                user_content.append({"type": "text", "text": prompt_text})
            elif self.provider == "openai":
                user_content.append({"type": "text", "text": prompt_text})
                user_content.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{screenshot_b64}"
                    }
                })
        else:
            # Text only
            user_content = prompt_text

        messages = [
            {"role": "system", "content": self._system_prompt()},
        ]
        
        # Add abbreviated history
        for msg in self.history:
            messages.append(msg)
            
        messages.append({"role": "user", "content": user_content})
        
        try:
            if self.provider == "anthropic":
                response = await self.client.messages.create(
                    model=self.model,
                    max_tokens=1000,
                    messages=[m for m in messages if m['role'] != 'system'], 
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
                # Handle cases where the model puts text before the JSON
                if '{' in clean_content:
                    clean_content = clean_content[clean_content.find('{'):clean_content.rfind('}')+1]
                
                action_data = json.loads(clean_content)
                
                # Validation
                if "thought" not in action_data or "action" not in action_data:
                    raise ValueError("Missing 'thought' or 'action' in response")
                
                if not isinstance(action_data["action"], dict):
                    raise ValueError("'action' must be a dictionary")
                    
                if "name" not in action_data["action"]:
                    raise ValueError("Action missing 'name'")
                    
                # Ensure params exists
                if "params" not in action_data["action"]:
                    action_data["action"]["params"] = {}
                
                # Update history
                # We record the user's prompt (summarized) and the assistant's response.
                # Including the result in the history summary is useful for the *next* turn's context.
                history_content = f"State: [Hidden to save space, was {len(state)} chars]"
                if last_action_result:
                     history_content = f"Result: {last_action_result}\n" + history_content
                     
                self.history.append({"role": "user", "content": history_content}) 
                self.history.append({"role": "assistant", "content": content})
                
                return action_data
            except (json.JSONDecodeError, ValueError) as e:
                logger.error(f"Failed to parse/validate JSON from LLM: {e}. Content: {content}")
                return {
                    "thought": f"Error parsing response: {e}. I will wait.",
                    "action": {"name": "wait", "params": {}}
                }

        except Exception as e:
            logger.error(f"LLM Error: {e}")
            return {
                "thought": f"Error: {e}",
                "action": {"name": "wait", "params": {}}
            }
