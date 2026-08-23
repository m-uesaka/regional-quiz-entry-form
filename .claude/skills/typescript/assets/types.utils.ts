/**
 * Custom utility type definition template
 *
 * Usage:
 * 1. Copy this file and adapt it for your project.
 * 2. TypeScript's built-in utility types are available without any import:
 *    - Partial, Required, Readonly, Pick, Omit, Record
 *    - NonNullable, ReturnType, Parameters, Awaited
 *    - Exclude, Extract, InstanceType, etc.
 * 3. This file should only define custom utility types.
 */

// Nullable: adds null or undefined
export type Nullable<T> = T | null | undefined;

// DeepPartial: Partial, recursively into nested objects
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// DeepReadonly: Readonly, recursively into nested objects
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

// DeepRequired: Required, recursively into nested objects
export type DeepRequired<T> = {
  [P in keyof T]-?: T[P] extends object ? DeepRequired<T[P]> : T[P];
};

// Optional: make only specific keys optional
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// RequiredKeys: extract only the required keys
export type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

// OptionalKeys: extract only the optional keys
export type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];

// Function type utilities

// Extract the type of a function's first parameter
// Note: ReturnType, Parameters, and Awaited are built into TypeScript
export type FirstParameter<T extends (...args: any) => any> = Parameters<T>[0];

// Array type utilities

// Extract the element type of an array
export type ArrayElement<T> = T extends (infer U)[] ? U : never;

// Type of an array's first element
export type First<T extends readonly unknown[]> = T extends readonly [
  infer F,
  ...unknown[]
]
  ? F
  : never;

// Type of an array's last element
export type Last<T extends readonly unknown[]> = T extends readonly [
  ...unknown[],
  infer L
]
  ? L
  : never;

// Object type utilities

// Extract the value type
export type ValueOf<T> = T[keyof T];

// Branded type (distinguishes otherwise-identical primitive types)
export type Brand<T, B> = T & { readonly __brand: B };

// Example: distinguishing UserId from ProductId
export type UserId = Brand<string, "UserId">;
export type ProductId = Brand<string, "ProductId">;
