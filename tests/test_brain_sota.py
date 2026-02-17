import pytest
import json
from unittest.mock import AsyncMock, MagicMock
pytest.importorskip("ai_browser_agent.agent.brain", reason="Legacy Python agent module is not present in this TypeScript repository")
from ai_browser_agent.agent.brain import AgentBrain

# Mock environment variables
import os
os.environ["ANTHROPIC_API_KEY"] = "fake-key"

@pytest.fixture
def brain():
    # Patch AsyncAnthropic to avoid actual connection
    with pytest.MonkeyPatch.context() as m:
        m.setattr("ai_browser_agent.agent.brain.AsyncAnthropic", MagicMock())
        m.setattr("ai_browser_agent.agent.brain.MemorySystem", MagicMock())
        brain = AgentBrain(provider="anthropic")
        # Mock client creation
        brain.client = AsyncMock()
        return brain

@pytest.mark.asyncio
async def test_think_react_prompt_structure(brain):
    """Test that think() constructs the prompt with history and result."""
    
    # Mock LLM response
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=json.dumps({
        "thought": "Test thought",
        "action": {"name": "wait", "params": {}}
    }))]
    brain.client.messages.create.return_value = mock_response

    state = "<div>State</div>"
    task = "Test Task"
    result = "Previous Success"
    
    await brain.think(state, task, last_action_result=result)
    
    # Check if create was called
    assert brain.client.messages.create.called
    call_kwargs = brain.client.messages.create.call_args.kwargs
    messages = call_kwargs['messages']
    
    # The prompt is in the last user message
    last_msg = messages[-1]['content']
    
    assert "Previous Action Result: Previous Success" in last_msg
    assert "Current Browser State" in last_msg
    
    # Check history update
    assert len(brain.history) == 2
    assert "Result: Previous Success" in brain.history[0]['content']

@pytest.mark.asyncio
async def test_think_validation_fail(brain):
    """Test that think() handles invalid JSON gracefully."""
    
    # Mock LLM response with bad JSON (missing 'thought')
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=json.dumps({
        "action": {"name": "click", "params": {"id": 1}}
    }))]
    brain.client.messages.create.return_value = mock_response

    res = await brain.think("state", "task")
    
    assert res['thought'].startswith("Error parsing response")
    assert res['action']['name'] == "wait"

@pytest.mark.asyncio
async def test_think_multimodal(brain):
    """Test that think() includes image payload when screenshot is provided."""
    
    # Mock LLM response
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=json.dumps({
        "thought": "I see the image.",
        "action": {"name": "click", "params": {"id": 1}}
    }))]
    brain.client.messages.create.return_value = mock_response

    state = "State"
    task = "Task"
    screenshot = "base64data"
    
    await brain.think(state, task, screenshot_b64=screenshot)
    
    call_kwargs = brain.client.messages.create.call_args.kwargs
    messages = call_kwargs['messages']
    last_msg = messages[-1]['content']
    
    # Check structure
    assert isinstance(last_msg, list)
    assert len(last_msg) == 2
    assert last_msg[0]['type'] == 'image'
    assert last_msg[0]['source']['data'] == "base64data"
    assert last_msg[1]['type'] == 'text'
