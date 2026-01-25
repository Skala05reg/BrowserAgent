from rich.console import Console
from rich.logging import RichHandler
import logging
import os
from datetime import datetime

console = Console()

def setup_logger():
    # Suppress HTTP request logs
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("hpack").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)

    # Create logs directory
    os.makedirs("logs", exist_ok=True)
    
    # Unique log file per session
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_file = f"logs/agent_{timestamp}.log"

    # File Handler (Detailed)
    file_handler = logging.FileHandler(log_file, encoding='utf-8')
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))

    # Console Handler (Rich, User-friendly)
    rich_handler = RichHandler(console=console, rich_tracebacks=True, show_level=False, show_path=False, markup=False)
    rich_handler.setLevel(logging.INFO)

    logging.basicConfig(
        level="DEBUG", # Capture DEBUG in root to allow file handler to see it
        handlers=[rich_handler, file_handler]
    )
    
    # Silence external libraries in console but keep in file if needed, 
    # but strictly setting root to DEBUG might be too noisy for console handler even if set to INFO?
    # logging.basicConfig configures the root logger. 
    # Handlers filter their own messages.
    
    # Re-apply noise reduction for specific noisy libs on the ROOT level
    logging.getLogger("asyncio").setLevel(logging.WARNING)
    logging.getLogger("charset_normalizer").setLevel(logging.WARNING)
    
    return logging.getLogger("agent")

logger = setup_logger()
