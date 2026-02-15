import { EventEmitter } from "node:events";
import { PendingApproval } from "./types.js";

export class ApprovalGate extends EventEmitter {
  private pending: PendingApproval | null = null;
  private resolver: ((value: boolean) => void) | null = null;

  public requestApproval(request: PendingApproval): Promise<boolean> {
    if (this.pending) {
      throw new Error("Approval already pending");
    }

    this.pending = request;

    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
      this.emit("pending", request);
    });
  }

  public approve(): boolean {
    return this.resolvePending(true);
  }

  public deny(): boolean {
    return this.resolvePending(false);
  }

  public getPending(): PendingApproval | null {
    return this.pending;
  }

  private resolvePending(approved: boolean): boolean {
    if (!this.pending || !this.resolver) {
      return false;
    }

    const resolver = this.resolver;
    this.pending = null;
    this.resolver = null;
    resolver(approved);
    this.emit("resolved", approved);

    return true;
  }
}
