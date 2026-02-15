import { describe, expect, it } from "vitest";
import { PauseController } from "../../src/core/pauseController.js";

describe("PauseController", () => {
  it("blocks while paused and continues after resume", async () => {
    const controller = new PauseController();
    controller.pause();

    let released = false;
    const waiter = controller.waitIfPaused().then(() => {
      released = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(released).toBe(false);

    controller.resume();
    await waiter;
    expect(released).toBe(true);
  });

  it("marks stopped state", () => {
    const controller = new PauseController();
    controller.stop();
    expect(controller.isStopped()).toBe(true);
    expect(controller.isPaused()).toBe(false);
  });
});
