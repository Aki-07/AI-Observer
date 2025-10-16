import { EventType } from '../types';

/**
 * Simple publish/subscribe event bus used to decouple components inside the
 * extension. Instead of components talking to each other directly, they emit
 * events that other pieces can listen to, greatly reducing coupling and making
 * testing easier.
 */
export class EventBus {
  /**
   * Internal registry of listeners. The map key represents the event type and
   * each value is an array of callbacks that should fire for that event. Using a
   * Map allows O(1) lookups and isolates listeners by event type.
   */
  private listeners: Map<EventType, Array<(data: unknown) => void | Promise<void>>> = new Map();

  /**
   * Register a listener for a specific event type.
   *
   * @param eventType - The event to subscribe to.
   * @param listener - Callback invoked whenever the event is emitted.
   */
  public on<T>(eventType: EventType, listener: (data: T) => void | Promise<void>): void {
    const existing = this.listeners.get(eventType) ?? [];
    existing.push(listener as (data: unknown) => void | Promise<void>);
    this.listeners.set(eventType, existing);
  }

  /**
   * Remove a previously registered listener.
   *
   * @param eventType - The event type to unsubscribe from.
   * @param listener - The listener function originally passed to {@link on}.
   */
  public off<T>(eventType: EventType, listener: (data: T) => void | Promise<void>): void {
    const existing = this.listeners.get(eventType);
    if (!existing) {
      return;
    }

    const filtered = existing.filter((registered) => registered !== listener);
    if (filtered.length === 0) {
      this.listeners.delete(eventType);
    } else {
      this.listeners.set(eventType, filtered);
    }
  }

  /**
   * Emit an event to all listeners registered for the event type.
   *
   * We execute callbacks in parallel using {@link Promise.all} so that one slow
   * listener does not block others. Each callback is wrapped in a try/catch so
   * that failures are isolated and reported without disrupting the rest of the
   * event pipeline.
   *
   * @param eventType - The event type being emitted.
   * @param data - Payload passed to subscribers.
   */
  public async emit<T>(eventType: EventType, data: T): Promise<void> {
    const existing = this.listeners.get(eventType);
    if (!existing || existing.length === 0) {
      return;
    }

    const executions = existing.map(async (listener) => {
      try {
        await listener(data as unknown);
      } catch (error) {
        // Capture and log individual listener failures while allowing the rest
        // of the listeners to continue running.
        console.error(`EventBus listener for ${eventType} failed`, error);
      }
    });

    await Promise.all(executions);
  }

  /**
   * Clear all registered listeners. Handy for disposing the bus when the
   * extension is deactivated or during tests to reset state.
   */
  public clear(): void {
    this.listeners.clear();
  }

  /**
   * Returns the number of listeners currently registered for the given event
   * type. Useful for debugging to verify subscriptions.
   *
   * @param eventType - The event to inspect.
   */
  public getListenerCount(eventType: EventType): number {
    const existing = this.listeners.get(eventType);
    return existing ? existing.length : 0;
  }
}
