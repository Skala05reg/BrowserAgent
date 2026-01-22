import asyncio
import sys
import os
from rich.console import Console

# Add project root to path so we can import the agent
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from ai_browser_agent.agent.planner import PlannerAgent
from ai_browser_agent.utils.logger import logger
from dotenv import load_dotenv

load_dotenv()
console = Console()

async def run_test(name: str, task: str):
    console.rule(f"[bold yellow]Running Test: {name}[/bold yellow]")
    console.print(f"[bold]Task:[/bold] {task}")
    
    try:
        agent = PlannerAgent()
        # Create a new browser instance for each test to keep it clean
        # The agent.run() method handles browser start/close internally in the provided code? 
        # Checking planner.py: run() starts checking browser, loop, finally doesn't close yet (commented out).
        # We'll rely on the agent's internal management for this test script.
        
        await agent.run(task)
        console.print(f"[bold green]✔ Test '{name}' completed.[/bold green]")
        
        # Cleanup manually if the class doesn't auto-close (based on code inspection, it doesn't auto-close strictly)
        if agent.navigator and agent.navigator.browser:
            await agent.navigator.browser.close()
            
    except Exception as e:
        console.print(f"[bold red]✘ Test '{name}' Failed: {e}[/bold red]")
        import traceback
        traceback.print_exc()

async def duplicate_check():
    # Small helper to skip tests if needed during dev, but we will run all.
    pass

async def main():
    logger.setLevel("INFO") # Ensure we see what's happening
    
    # Test 1: Wikipedia
    await run_test(
        "Wikipedia Fact Check", 
        "Go to wikipedia.org, search for 'Turing Test', and tell me the year it was introduced or proposed."
    )

    # Test 2: Hacker News
    await run_test(
        "Hacker News Top Story",
        "Go to https://news.ycombinator.com/ and return the exact title and link of the top (first) story in the list."
    )

    # Test 3: ToScrape
    await run_test(
        "Book Price Extraction",
        "Go to http://books.toscrape.com/, search/find the book 'A Light in the Attic' (it should be on the home page), and tell me its price."
    )

if __name__ == "__main__":
    asyncio.run(main())
