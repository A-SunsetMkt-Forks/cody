import { defineConfig } from '@playwright/test'

export default defineConfig({
    workers: 1,
    // Give failing tests a second chance
    retries: 0,
    testDir: 'test/e2e',
})
