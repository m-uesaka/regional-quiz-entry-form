/**
 * Custom event type definition template
 *
 * Use the built-in types for DOM/React events:
 * - DOM: MouseEvent, KeyboardEvent, FocusEvent, Event, etc. (lib: ["DOM"])
 * - React: import type { MouseEvent, ChangeEvent, FormEvent } from "react"
 *
 * This file should only define project-specific custom event patterns.
 */

// Project-specific CustomEvent map (edit names/payloads as needed)
export interface CustomEventMap {
  /** Login event */
  "user-login": CustomEvent<{ userId: string; timestamp: number }>;
  /** Logout event */
  "user-logout": CustomEvent<{ userId: string }>;
  /** Data update event */
  "data-updated": CustomEvent<{ resource: string; id: string }>;
}

export type CustomEventListener<K extends keyof CustomEventMap> = (
  event: CustomEventMap[K]
) => void;

// Event emitter type (e.g. for a custom event bus)
export interface EventEmitter<T extends Record<string, unknown>> {
  /** Register an event listener */
  on<K extends keyof T>(event: K, listener: (data: T[K]) => void): void;
  /** Remove an event listener */
  off<K extends keyof T>(event: K, listener: (data: T[K]) => void): void;
  /** Emit an event */
  emit<K extends keyof T>(event: K, data: T[K]): void;
}

// Example: app event payload types
export interface AppEvents {
  /** Login event */
  "user:login": { userId: string; timestamp: number };
  /** Logout event */
  "user:logout": { userId: string };
  /** Data update event */
  "data:updated": { resource: string; id: string };
}
