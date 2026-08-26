import {seedDatabase} from './seed';

// Playwright requires the global setup module to default-export its entry
// point, which is why this file breaks the "named exports only" rule.
export default async function globalSetup(): Promise<void> {
  await seedDatabase();
}
