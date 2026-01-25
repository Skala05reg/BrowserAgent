import asyncio
import os
import sys
from ai_browser_agent.utils.logger import logger
from dotenv import load_dotenv

# Fix for Windows asyncio loop policy if needed
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

async def main():
    load_dotenv()
    
    logger.info("🤖 AI Browser Agent CLI")
    
    try:
        # Switch to PlannerAgent for advanced capabilities
        from ai_browser_agent.agent.planner import PlannerAgent
        agent = PlannerAgent()
        
        # Start the browser session once
        await agent.start_session()
        
        while True:
            try:
                task = input("\nEnter your task (or press ENTER to exit): ")
                if not task.strip():
                    break
                
                await agent.run(task)
                logger.info("✨ Task completed. Waiting for next instruction...")
                
            except KeyboardInterrupt:
                logger.info("\n🛑 Interrupted by user.")
                break
            except Exception as e:
                logger.error(f"Error during task execution: {e}")
                
    except Exception as e:
        logger.error(f"Failed to start agent: {e}")
    finally:
        logger.info("👋 Exiting...")
        # Ideally we close the browser here, but the user requested:
        # "Make it so that when the task is finished the browser does not close... script also let not close"
        # However, when the script *finally* exits (user pressed Enter), we should probably cleanup.
        if 'agent' in locals() and agent.navigator.browser:
             await agent.navigator.browser.close()

if __name__ == "__main__":
    asyncio.run(main())