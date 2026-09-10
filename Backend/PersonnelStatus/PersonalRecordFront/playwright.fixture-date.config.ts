/** Точечная приёмка DB-брони деловых дат e2e (Plane №890). */
import smokeConfig from './playwright.smoke.config'

export default {
  ...smokeConfig,
  testMatch: ['fixture-date-reservation.spec.ts', 'business-date-slices.spec.ts'],
}
