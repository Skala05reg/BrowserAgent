import { loadModelApiKey, loadRuntimeConfig } from "./config/loadConfig.js";
import { BrowserRuntime } from "./browser/browserRuntime.js";
import { ToolRegistry } from "./tools/toolRegistry.js";
import { ConsoleLogger } from "./telemetry/consoleLogger.js";
import { ModelGateway } from "./model/modelGateway.js";
import { PauseController } from "./core/pauseController.js";
import { ApprovalGate } from "./core/approvalGate.js";
import { AgentOrchestrator } from "./core/orchestrator.js";
import { AgentCli } from "./cli/repl.js";

async function bootstrap(): Promise<void> {
  const runtimeConfig = loadRuntimeConfig();
  const modelApiKey = loadModelApiKey(runtimeConfig);

  const logger = new ConsoleLogger(runtimeConfig.logging);
  const browserRuntime = new BrowserRuntime(runtimeConfig.browser);
  const toolRegistry = new ToolRegistry(browserRuntime);
  const modelGateway = new ModelGateway(runtimeConfig, modelApiKey);
  const pauseController = new PauseController();
  const approvalGate = new ApprovalGate();

  const orchestrator = new AgentOrchestrator(
    runtimeConfig,
    logger,
    browserRuntime,
    toolRegistry,
    modelGateway,
    pauseController,
    approvalGate
  );

  const cli = new AgentCli(runtimeConfig, logger, orchestrator, approvalGate, browserRuntime);
  await cli.run();
}

void bootstrap();
