import asyncio
import os
from ai_browser_agent.agent.core import Agent
from ai_browser_agent.utils.logger import logger
from dotenv import load_dotenv

async def main():
    load_dotenv()
    
    logger.info("🤖 AI Browser Agent CLI")
    task = input("Enter your task: ")
    
    try:
        # Switch to PlannerAgent for advanced capabilities
        from ai_browser_agent.agent.planner import PlannerAgent
        agent = PlannerAgent()
        await agent.run(task)
    except Exception as e:
        logger.error(f"Failed to start agent: {e}")

if __name__ == "__main__":
    asyncio.run(main())
